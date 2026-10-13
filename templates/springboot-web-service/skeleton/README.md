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

## Layout

```
.
├── pom.xml              # adhar-kit-parent + adhar-kit-starter
├── settings.xml         # platform Nexus (maven-public)
├── compose.yaml         # local backing services for `mvn spring-boot:run`
├── project.toml         # buildpack: BP_MAVEN_SETTINGS_PATH
├── src/main/java/io/adhar/service/
│   ├── Application.java
│   ├── HelloController.java
{%- if values.withCache %}
│   ├── cache/           # LookupService (@Cacheable) + CacheController
{%- endif %}
{%- if values.withKafka %}
│   ├── events/          # EventController (KafkaTemplate + @KafkaListener)
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
