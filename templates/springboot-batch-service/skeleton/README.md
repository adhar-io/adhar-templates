# ${{ values.name }}

${{ values.description }}

A Spring Batch service pre-configured with **Adhar Kit** for secure, observable,
enterprise-grade batch workloads. It ships with a sample chunk-oriented job,
Spring Batch metadata support, and GitOps deployment wiring for scheduled job
execution and platform alerts.

## Adhar Kit

`adhar-kit-parent` / `adhar-kit-starter` resolve from the platform's Nexus and
provide observability, security, resilience, and health checks without any app
boilerplate.

## What is included

- Spring Batch 5 job scaffolding
- job metadata persistence with PostgreSQL when enabled
- optional Kafka completion event
- cron-based Kubernetes execution using `CronJob`
- actuator health and Prometheus metrics
- platform resilience suite in `deploy/base/resilience.yaml`
- secure supply chain and GitOps deployment from the platform

## Batch job

The generated sample job reads a list of payloads, transforms each one, and writes
it to the console or a writer sink. The business logic sits in a single chunk-based
step so it is easy to replace with a real extraction/processing/load workflow.

## Local development

Requires JDK 25 and Maven 3.9+ — or open the folder in its development
container (`.devcontainer/`, see its README), which carries both plus the
platform's tools, the editor extensions and the IntelliJ plugins.

```sh
{%- if values.withDatabase or values.withKafka %}
docker compose up -d          # Postgres / Kafka on localhost
{%- endif %}
mvn -s settings.xml spring-boot:run
```
{%- if values.withDatabase %}

`compose.yaml` starts the PostgreSQL that Spring Batch reads and writes its
metadata tables in, on the `localhost:5432` that `application.properties` falls
back to; the deployed job gets the CloudNativePG database instead.
{%- endif %}
{%- if values.withKafka %}

The completion event goes to the Kafka `compose.yaml` starts on
`localhost:9092`; the deployed job publishes to the platform's Strimzi cluster.
{%- endif %}

## Deployment

The generated `deploy/` tree includes the runtime manifests that Argo CD syncs into
your environment. If `${{ values.batchMode }}` is `cron`, the template deploys a
`CronJob`; if it is `on-demand`, it uses a one-shot `Job` pattern.

## Endpoints

{% if values.withAuth -%}
Every endpoint except `/actuator/health*` and `/actuator/info` requires a bearer
JWT from the platform's Keycloak realm `adhar`.
{%- else -%}
Every endpoint is public. See `application.properties` to require a Keycloak JWT.
{%- endif %}

| Path | Purpose |
|---|---|
| `/actuator/health` | Health check |
| `/actuator/health/liveness` | Liveness probe |
| `/actuator/health/readiness` | Readiness probe |
| `/actuator/prometheus` | Prometheus metrics |

## Layout

```
.
├── .devcontainer/       # development container: toolchain, platform tools, editor setup
├── pom.xml
├── settings.xml
├── project.toml
├── compose.yaml         # local backing services for `mvn spring-boot:run`
├── src/main/java/io/adhar/service/
│   ├── Application.java
│   └── BatchConfiguration.java
├── src/main/resources/application.properties
├── deploy/
│   ├── base/
│   │   ├── cronjob.yaml
│   │   ├── kustomization.yaml
│   │   ├── podmonitor.yaml
│   │   ├── rbac.yaml
│   │   └── service.yaml
│   └── envs/
└── docs/
```
