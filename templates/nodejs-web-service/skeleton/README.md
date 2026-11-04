# ${{ values.name }}

${{ values.description }}

A Node.js (Express) service scaffolded by Adhar. It ships through the platform's
**secure software supply chain** and deploys with **progressive delivery**:

```
git push → kpack/Tekton build → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

Traces and metrics are exported via OpenTelemetry (OTLP) to the platform
collector and land in Tempo and Mimir; the service logs JSON lines that Loki
collects, each carrying the trace it belongs to — no wiring required.

## Endpoints

| Path | Purpose |
|---|---|
| `/` | Service info |
| `/healthz` | Liveness/readiness probe |
{%- if values.withDatabase %}
| `/db` | Checks the PostgreSQL connection (diagnostics, not a probe) |
{%- endif %}

Errors answer as RFC 9457 problem documents (`application/problem+json`).

## Layout

```
.
├── src/
│   ├── server.js            # the process: config → app → listen; clean stop on SIGTERM
│   ├── app.js               # the Express app: middleware, routes, error handling
│   ├── config/              # every setting, read and checked once at startup
│   ├── routes/              # mounts every route
│   ├── controllers/         # HTTP in, HTTP out — no logic
│   ├── services/            # the logic — no HTTP
{%- if values.withDatabase %}
│   ├── db/                  # the PostgreSQL pool and its queries
{%- else %}
│   ├── db/                  # empty: scaffolded without a database
{%- endif %}
│   ├── health/              # /healthz{% if values.withDatabase %} and /db{% endif %}
│   ├── middleware/          # request log, 404 and error responses
│   ├── telemetry/           # OpenTelemetry: the SDK preload, trace ids for the logs
│   └── lib/                 # the JSON logger
├── test/
│   ├── unit/                # one file per module under src/, served in-process
│   ├── integration/         # src/server.js as the image runs it
│   └── support/             # helpers the tests share
├── package.json             # npm start · npm test · npm run lint
├── eslint.config.js
├── project.toml             # the Node.js version the image ships (BP_NODE_VERSION)
├── perf/                    # the k6 load test the Performance Center runs
├── docs/ + mkdocs.yml       # these docs, as TechDocs
└── deploy/                  # GitOps tree — ArgoCD syncs it
    ├── base/                # Rollout (canary) of the SIGNED image, Service, HTTPRoute{% if values.withDatabase %}, CloudNativePG database{% endif %}
    └── envs/                # dev · test · prod: what differs per environment
```

## Local development

Node.js 24 — the version `project.toml` pins and the image ships:

```sh
npm install     # the first time; commit the package-lock.json it writes
npm start       # http://localhost:${{ values.port }}
npm test        # lint, then the unit and integration tests — what app-ci runs
```

The whole platform runs on your `adhar up` Kind cluster too — build, scan,
sign, verify, deploy, and a real database, no cloud account needed.

```sh
# Every push to main runs the platform pipeline (app-ci): tests, secret and
# dependency scans, build, image scan, SBOM, signature, attestation, verify,
# then a GitOps writeback that rolls the canary. Watch it:
tkn -n adhar-system pipelinerun logs -f --last

# Watch the canary roll out in dev:
kubectl -n dev argo rollouts get rollout ${{ values.name }} --watch
```

Access: `https://${{ values.hostname }}` (on a local `adhar up` cluster, add the
platform's HTTPS port, `:8443`).
