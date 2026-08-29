# ${{ values.name }}

${{ values.description }}

A Node.js (Express) service scaffolded by Adhar. It ships through the platform's
**secure software supply chain** and deploys with **progressive delivery**:

```
git push → kpack/Tekton build → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

Traces, metrics and logs are exported via OpenTelemetry (OTLP) to the platform
collector and land in Tempo, Mimir and Loki — no wiring required.

## Endpoints

| Path | Purpose |
|---|---|
| `/` | Service info |
| `/healthz` | Liveness/readiness probe |
{%- if values.withDatabase %}
| `/db` | Checks the PostgreSQL connection |
{%- endif %}

## Layout

```
.
├── server.js            # the app
├── package.json
└── deploy/              # GitOps tree — ArgoCD syncs this
    ├── secure-build.yaml   # Tekton build → Harbor → scan → sign
    ├── rollout.yaml        # Argo Rollout (canary) of the SIGNED image
    ├── service.yaml
    ├── httproute.yaml      # https://${{ values.hostname }}:8443
{%- if values.withDatabase %}
    └── database.yaml       # CloudNativePG Postgres + connection secret
{%- endif %}
```

## Local development

Runs entirely on your `adhar up` Kind cluster — build, scan, sign, verify,
deploy, and a real database, no cloud account needed.

```sh
# Re-run the secure build after code changes:
kubectl -n adhar-system create -f deploy/secure-build.yaml

# Watch the canary roll out:
kubectl -n adhar-system argo rollouts get rollout ${{ values.name }} --watch
```

Access: `https://${{ values.hostname }}:8443`
