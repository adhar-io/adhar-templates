# ${{ values.name }}

${{ values.description }}

A Deno function on the Adhar platform, scaffolded from the
`function-deno-service` template. It runs on the platform's Function API: a
Knative Service per environment that scales to zero when idle and out under
load, with its own HTTPS URL.

## Layout

| Path | What it is |
| --- | --- |
| `src/handler.ts` | the function: a Web-standard handler (`Request` → `Response`) — `/healthz`, and every other path and method invokes it |
| `src/main.ts` | `Deno.serve(handler)` on `$PORT` |
| `compat/serve-on-node.mjs` | runs `src/main.ts` on Node.js 24 — the image's runtime, since the builder has no Deno buildpack |
| `test/handler.test.ts` | its tests (`node:test`; `deno test` and `node --test` both run them), which app-ci runs on every push |
| `deno.json` / `package.json` | tasks for Deno / scripts for Node; no dependencies |
| `deploy/base/function.yaml` | the `Function` every environment runs: runtime, image, trigger, scale, timeout |
| `deploy/base/kustomizeconfig.yaml` | tells kustomize where a Function keeps its image, so Kargo can pin the signed digest |
| `deploy/envs/{dev,test,prod}/` | one overlay per environment of the project: namespace, image, environment |
| `project.toml` | the runtime the image ships (`BP_NODE_VERSION`); the CI tests run on the same one |
| `api/openapi.yaml` | the function's HTTP interface, published in the catalog |
| `catalog-info.yaml` | the catalog entry (Component and API) |
| `docs/` | TechDocs: [overview](docs/index.md), [architecture](docs/architecture.md), [operations](docs/operations.md) |

## Run and test locally

Develop with Deno 2, or with Node.js 24 exactly as the image runs it.

```bash
deno task dev                  # Deno: http://localhost:8080
deno task test
npm start                      # Node.js 24 + compat/serve-on-node.mjs, as the image runs it
npm test                       # the suite app-ci runs
curl -s localhost:8080/healthz
```

Why Node in the image: the platform builds every image with Cloud Native Buildpacks, and paketo's builder has no Deno buildpack. `compat/serve-on-node.mjs` provides the two Deno APIs this code uses (`Deno.serve`, `Deno.env`) on Node.js 24, which also strips the TypeScript types natively. Keep the source to Web-standard APIs and type-only TypeScript (no `enum`, no `namespace`) and it runs unchanged on both.

## Deploy

Push to `main`. app-ci builds the image, runs the tests on the same runtime,
scans and signs it; Kargo promotes the signed digest dev → test (automatically,
once verified) → prod (with a Release); Argo CD deploys each environment's
`Function`. In dev the function answers at https://${{ values.hostname }}.
