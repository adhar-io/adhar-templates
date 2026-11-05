# Architecture

## Request path

```
client → Cilium Gateway (TLS) → HTTPRoute ${{ values.hostname }} → Service ${{ values.name }} → pod :${{ values.port }}
```

`deploy/base/httproute.yaml` attaches to the platform's shared Gateway. The hostname
is the one thing in that file worth reading carefully — it is what makes the
service reachable, and it must stay under the platform's base domain for the
wildcard certificate to cover it.

The process serves HTTP directly on `${{ values.port }}`. There is no sidecar
proxy in front of it inside the pod; TLS terminates at the platform Gateway.

## Code layout

```
src/server.ts     the process: configuration, listen on :${{ values.port }}, clean stop
 └─ src/app.ts    the Express app; a request passes through, in order:
     middleware/request-logger   one JSON log line per request
     routes/                     health/ (/healthz{% if values.withDatabase %}, /db{% endif %}), then controllers/ → services/{% if values.withDatabase %} → db/{% endif %}
     middleware/error-handler    no route: 404; an error: its problem document
```

| Folder | What it does |
| --- | --- |
| `src/server.ts` | Starts and stops the process: loads the configuration, builds the app, listens, and on SIGTERM lets the requests in flight finish{% if values.withDatabase %}, closes the database pool{% endif %} and flushes the telemetry. |
| `src/app.ts` | Builds the Express app from what it is given — configuration, logger{% if values.withDatabase %}, database{% endif %}. It never listens, so tests serve it in-process. |
| `src/config/` | Reads every environment variable the service uses, once, and refuses an invalid one at startup. Nothing else reads `process.env`. |
| `src/routes/` | Mounts each controller on its path. |
| `src/controllers/` | HTTP in, HTTP out: reads the request, calls a service, writes the status and body. No logic. |
| `src/services/` | The logic, as plain functions over plain data. No `req`, no `res`. |
{%- if values.withDatabase %}
| `src/db/` | The one PostgreSQL connection pool and the queries. Services call it; controllers do not. |
{%- endif %}
| `src/health/` | `/healthz` for both probes{% if values.withDatabase %}, and `/db` for diagnostics{% endif %}. |
| `src/middleware/` | The request log, and 404 and error responses as RFC 9457 problem documents that never carry an internal error message. |
| `src/telemetry/` | Starts OpenTelemetry before the application loads, and hands the logger the current trace. |
| `src/lib/` | The JSON logger, and source-map support so a stack trace names the `.ts` line. |
| `src/types/` | The contracts the layers share — what the app is built from, the JSON bodies it answers with. Types only: nothing in it exists at run time. |

Each module gets what it depends on passed in (`createApp({ config, logger{% if values.withDatabase %}, db{% endif %} })`)
rather than reaching for it, so a unit test hands it a{% if values.withDatabase %} fake database or a{% endif %}
recording logger and checks it without a network. `test/unit/` mirrors
`src/`; `test/integration/` starts the compiled `dist/server.js` the way the
image does.

## Build

The service is strict TypeScript (`tsconfig.json`: `strict` plus the checks
it leaves out, such as `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`). It compiles to CommonJS — `package.json` says
`"type": "commonjs"` — because OpenTelemetry instruments what `require` loads;
its hook for ES modules is still experimental.

| Where | What runs the TypeScript |
| --- | --- |
| `npm run dev` | `tsx` runs `src/server.ts` as it is and restarts it on every change |
| `npm test` | ESLint (typescript-eslint, type-checked rules), `tsc --noEmit`, `npm run build`, then the tests — TypeScript too — through `tsx` |
| The image | the Node.js buildpack runs `npm run build` (`BP_NODE_RUN_SCRIPTS` in `project.toml`): `tsc -p tsconfig.build.json` compiles `src/` to `dist/` with source maps, the devDependencies — `typescript`, `tsx`, ESLint — are pruned, and the container starts `node dist/server.js` |

A type error therefore fails the tests and the image build alike: nothing that
does not compile reaches a cluster. `dist/` is never committed.

Why compile, when Node.js 24 can run a `.ts` file itself? Its type stripping
erases the types without checking them, so `tsc` would have to run anyway, and
it accepts only the TypeScript that erases to plain JavaScript — no `enum`, no
`namespace`, no parameter properties, and every relative import spelled with
its `.ts` extension. Compiling in the build keeps the whole language, checks
the types where nothing can skip it, and gives the image JavaScript only, with
the source maps that point its stack traces back at `src/`.

## Deployment shape

`deploy/base/rollout.yaml` is an Argo **Rollout**, not a Deployment. The difference
matters when something is wrong: a Rollout can pause with old and new pods both
serving, so a bad version is caught by real traffic on a small share of requests
rather than by a full replacement.

- Replicas: `${{ values.replicas }}`
- Strategy: canary, with traffic shifted in steps
- Probes: readiness gates the Service endpoints; liveness restarts a wedged process

!!! warning "Probe timeouts"
    Never set a probe `timeoutSeconds` to `1`. A loaded node needs more than a
    second to answer, and the kubelet will kill a healthy pod — this has
    happened on this platform and cost a database 29 restarts before anyone
    looked at the probe rather than the process.

## Supply chain

The platform's `app-ci` pipeline runs on every push to `main` (a Gitea webhook;
nothing to define in this repository). The chain is:

1. **Build** — Cloud Native Buildpacks produce the image, compiling the
   TypeScript on the way ([Build](#build)); there is no Dockerfile to keep
   current. Beside it, in parallel: the tests (`npm test`), a secret scan
   (gitleaks) and a dependency + manifest scan (trivy) of the source.
2. **Scan** — Trivy scans the built image and fails the run on the severities
   the platform enforces; syft writes its SBOM.
3. **Sign** — cosign signs the digest only once every gate above passed, then
   attests the SBOM to it.
4. **Verify** — the pipeline verifies its own signature and attestation, and a
   Kyverno policy checks the signature again at admission. An image the
   platform did not build and sign does not start.
5. **Deploy** — the verified image tag is written back to `deploy/` and Argo CD
   rolls the canary.

Because verification is at admission, the guarantee holds for anything that
tries to run in the cluster, including an image someone applies by hand.

{%- if values.withDatabase %}

### Database

`deploy/base/database.yaml` declares a CloudNativePG `Cluster`. CloudNativePG — not
this repository — owns the credential: it generates the password, publishes it as
a Secret, and rotates it. The application reads `DATABASE_URL` from the
environment and never sees a literal password.

Two consequences worth knowing:

- **Do not commit a connection string.** If you find yourself wanting to, the
  environment variable is missing from `deploy/base/rollout.yaml`, not from the
  Secret.
- **Backups are the platform's, not yours.** The cluster is covered by the
  platform's backup schedule; the scorecard's backup-coverage signal reads that,
  which is why a stateful service with no schedule scores lower.
{%- endif %}

## Observability

Nothing to configure per service:

- **Traces and metrics.** `src/telemetry/instrumentation.ts`, compiled to
  `dist/telemetry/instrumentation.js`, starts the OpenTelemetry SDK before the
  application loads: `NODE_OPTIONS` in `deploy/base/rollout.yaml` preloads it
  with `--require`. It instruments HTTP and Express{% if values.withDatabase %} and
  PostgreSQL{% endif %} and exports over OTLP to the platform's collector, which writes
  the traces to Tempo and the metrics to Mimir; the `OTEL_*` variables in the
  Rollout say what is exported and where. On a stop, `src/server.ts` flushes
  them after the last request has finished, so a rollout does not lose the
  final requests. The integration tests read the preload from the Rollout, so
  a path that no longer matches the build fails `npm test`, not the pods.
- **Logs.** One JSON object per line on stdout (errors on stderr), which Loki
  collects from the container's output. A line written while a request is
  handled carries that request's `trace_id`, and Grafana turns it into a link
  to the trace in Tempo. `LOG_LEVEL` (default `info`) sets how much is
  written; the probe path is never logged.
- **Dashboards.** Grafana's are variable-driven: this service has one from its
  first request.

The Service Catalog's **Metrics** tab queries this workload by name, so keep
`catalog-info.yaml`'s name matching the workload name — that join is what makes
the tab show your service rather than nothing.
