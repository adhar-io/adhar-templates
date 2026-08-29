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

`adhar-kit-parent` / `adhar-kit-starter` resolve from the in-cluster **Gitea
Maven registry** (see `settings.xml`), published by the `adhar-kit` release
pipeline. The build points Maven at it via `BP_MAVEN_SETTINGS_PATH` (`project.toml`).

## Endpoints

| Path | Purpose |
|---|---|
| `/` | Service info |
| `/healthz` | Simple health check |
| `/actuator/health` | Actuator health (+ liveness/readiness probes) |
{%- if values.withDatabase %}
| `/db` | Checks the PostgreSQL connection |
{%- endif %}

## Layout

```
.
├── pom.xml              # adhar-kit-parent + adhar-kit-starter
├── settings.xml         # Gitea Maven registry
├── project.toml         # buildpack: BP_MAVEN_SETTINGS_PATH
├── src/main/java/io/adhar/service/
│   ├── Application.java
│   └── HelloController.java
├── src/main/resources/application.properties
└── deploy/              # GitOps tree — ArgoCD syncs this
    ├── secure-build.yaml
    ├── rollout.yaml     # Argo Rollout (canary) of the SIGNED image
    ├── service.yaml
    ├── httproute.yaml   # https://${{ values.hostname }}:8443
{%- if values.withDatabase %}
    └── database.yaml    # CloudNativePG Postgres → SPRING_DATASOURCE_*
{%- endif %}
```

## Local development

```sh
mvn -s settings.xml spring-boot:run
```

Access the deployed service at `https://${{ values.hostname }}:8443`.
