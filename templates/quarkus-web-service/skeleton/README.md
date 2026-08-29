# ${{ values.name }}

${{ values.description }}

A Quarkus REST service scaffolded by Adhar. It ships through the platform's
**secure supply chain** with **progressive delivery**:

```
git push → buildpacks (Maven → uber-jar) → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

Traces (quarkus-opentelemetry) and metrics (micrometer OTLP) are exported to the
platform collector → Tempo/Mimir; logs go to stdout → Loki.

## Endpoints

| Path | Purpose |
|---|---|
| `/` | Service info |
| `/healthz` | Simple health check |
| `/q/health` | SmallRye health (liveness/readiness) |
{%- if values.withDatabase %}
| `/db` | Checks the PostgreSQL connection |
{%- endif %}

## Local development

```sh
./mvnw quarkus:dev    # or: mvn quarkus:dev
```

Access the deployed service at `https://${{ values.hostname }}:8443`.
