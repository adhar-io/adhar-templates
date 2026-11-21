# ${{ values.name }}

${{ values.description }}

A Spring Boot microservice pre-configured with **Adhar Kit** (`adhar-kit-starter`
— observability, security, resilience, health), scaffolded by Adhar. It ships
through the platform's **secure supply chain** with **progressive delivery**:

```
git push → buildpacks (Maven build) → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

Traces, metrics and logs are exported via OpenTelemetry (OTLP) to the platform
collector and land in Tempo, Mimir and Loki — no wiring required.

## Adhar Kit

`adhar-kit-parent` / `adhar-kit-starter` resolve from the platform's **Nexus**
(`maven-public`, see `settings.xml`), published by the `adhar-kit` release
pipeline. The build points Maven at it via `BP_MAVEN_SETTINGS_PATH` (`project.toml`).
{%- if values.withDatabase or values.withCache or values.withKafka %}

## Backing services

Provisioned from `deploy/` alongside the app and injected as Spring's own
environment variables — nothing in the code holds a hostname or a password.

| Service | Manifest | Wired in as |
|---|---|---|
{%- if values.withDatabase %}
| PostgreSQL (CloudNativePG) | `deploy/database.yaml` | `SPRING_DATASOURCE_URL` / `_USERNAME` / `_PASSWORD` |
{%- endif %}
{%- if values.withCache %}
| Valkey cache (TTL `${{ values.cacheTtl }}`) | `deploy/cache.yaml` | `SPRING_DATA_REDIS_URL` → adhar-kit-cache, the `@Cacheable` store |
{%- endif %}
{%- if values.withKafka %}
| Kafka, topic `${{ values.kafkaTopic }}` | `deploy/kafka.yaml` | `SPRING_KAFKA_BOOTSTRAP_SERVERS` |
{%- endif %}
{%- endif %}
{%- if values.inServiceBatch %}

## In-service batch jobs

Small, frequent or business-hours jobs run inside this service on Adhar Kit's
clustered Quartz scheduler (design 0025 §5.20). The sample,
`batch/SettlementJobConfiguration`, settles a business day's
`public.payments` into `public.settlements`:

| Trigger | When | Identity |
|---|---|---|
| `close` | a Quartz cron, 18:00 UTC, on the `weekdays` calendar | `businessDate` = the slot's date, `cycle=close` |
| `intraday` | every 15 minutes, 09:00–17:00 UTC, on the `weekdays` calendar | `businessDate` = the slot's date, `cycle=intraday` |

- **Once across the replicas.** The schedule is one clustered Quartz store in
  schema `batch` of this service's database, beside Spring Batch's
  JobRepository, both migrated by the kit. A slot runs on one replica.
- **Once per identity.** A run's identity is its business date and cycle: a
  fire of a COMPLETED identity is skipped, a FAILED one restarts from its last
  commit — so `intraday` keeps trying every 15 minutes until the day settles.
- **A replica dying mid-run** is re-fired on another replica, which resumes
  after the last commit (`QuartzRestartIT` proves it on every build).
- **Started by the service itself:** `BatchTriggers.fireNow("settlementJob",
  Map.of("businessDate", "2026-11-03"))` stores a durable one-shot trigger
  keyed by the run's name, so asking twice is one run.
- **Seen in the Console** (Develop → Batch) **and** `adhar batch schedules`,
  from the `${{ values.name }}-batch-schedules` ConfigMap every replica writes
  (its Role is in `deploy/base/rbac.yaml`). They are read-only there: an
  in-service run is not a Kubernetes object.
- **Alerted** by `BatchInServiceRunFailed` and `BatchInServiceScheduleStalled`
  in `deploy/base/alerts.yaml`.

The scheduler, the calendar and the JVM all run in UTC (see
`application.properties`). A job that is long, heavy, partitioned, or that
operators must run, stop and restart belongs in a platform `BatchJob` (the
`springboot-batch-service` template) instead: an in-service run shares this
pod with its request traffic, and a rollout stops it.
{%- endif %}

## Endpoints

{% if values.withAuth -%}
Every endpoint except `/actuator/health*` and `/actuator/info` requires a bearer
JWT from the platform's Keycloak realm `adhar` (`Authorization: Bearer <token>`).
{%- else -%}
Every endpoint is public. See `application.properties` to require a Keycloak JWT.
{%- endif %}

| Path | Purpose |
|---|---|
| `/` | Service info |
| `/actuator/health` | Actuator health |
| `/actuator/health/liveness`, `/readiness` | Kubernetes probes |
{%- if values.withDatabase %}
| `/db` | Checks the PostgreSQL connection |
{%- endif %}
{%- if values.withCache %}
| `GET /cache/{key}` | Cached lookup — slow the first time, instant after (any replica) |
| `DELETE /cache/{key}` | Evicts a key |
{%- endif %}
{%- if values.withKafka %}
| `POST /events` | Publishes the request body to `${{ values.kafkaTopic }}` |
| `GET /events` | Last 20 events this replica consumed |
{%- endif %}

The contract is `api/openapi.yaml`, registered in the catalog as
`${{ values.name }}-api` (the Console lists it under Design → API & Spec).
Change a controller and the file together.

## Layout

```
.
├── pom.xml              # adhar-kit-parent + adhar-kit-starter
├── settings.xml         # platform Nexus (maven-public)
├── compose.yaml         # local backing services for `mvn spring-boot:run`
├── project.toml         # buildpack: BP_MAVEN_SETTINGS_PATH
├── api/openapi.yaml     # the HTTP contract, published in the catalog
├── src/main/java/io/adhar/service/
│   ├── Application.java
│   ├── HelloController.java
{%- if values.withCache %}
│   ├── cache/           # LookupService (@Cacheable) + CacheController
{%- endif %}
{%- if values.withKafka %}
│   ├── events/          # EventController (KafkaTemplate + @KafkaListener)
{%- endif %}
{%- if values.inServiceBatch %}
│   ├── batch/           # SettlementJobConfiguration: the in-service batch job
{%- endif %}
├── src/main/resources/application.properties
└── deploy/              # GitOps tree — ArgoCD syncs this
    ├── rollout.yaml     # Argo Rollout (canary) of the SIGNED image
    ├── service.yaml
    ├── httproute.yaml   # https://${{ values.hostname }}:8443
{%- if values.withDatabase %}
    ├── database.yaml    # CloudNativePG Postgres → SPRING_DATASOURCE_*
{%- endif %}
{%- if values.withCache %}
    ├── cache.yaml       # Valkey (control plane) → SPRING_DATA_REDIS_URL
{%- endif %}
{%- if values.withKafka %}
    ├── kafka.yaml       # Strimzi Kafka + topic → SPRING_KAFKA_BOOTSTRAP_SERVERS
{%- endif %}
```

## Local development

Requires JDK 25 and Maven 3.9+.

```sh
{%- if values.withDatabase or values.withCache or values.withKafka %}
docker compose up -d          # Postgres / Valkey / Kafka on localhost
{%- endif %}
mvn -s settings.xml spring-boot:run
```
{%- if values.withCache %}

```sh
curl localhost:${{ values.port }}/cache/hello    # ~500 ms
curl localhost:${{ values.port }}/cache/hello    # instant, same computedAt
```
{%- endif %}
{%- if values.withKafka %}

```sh
curl -X POST localhost:${{ values.port }}/events -H 'Content-Type: text/plain' -d 'hello'
curl localhost:${{ values.port }}/events         # ["hello"]
```
{%- endif %}

Access the deployed service at `https://${{ values.hostname }}:8443`.
