# ${{ values.name }}

${{ values.description }}

A Node.js function on the Adhar platform, scaffolded from the
`function-nodejs-service` template. It runs on the platform's Function API: a
Knative Service per environment that scales to zero when idle and out under
load, with its own HTTPS URL.

## Layout

| Path | What it is |
| --- | --- |
| `index.js` | the function: an HTTP handler on `$PORT` (`/healthz`, everything else invokes it) |
| `test/handler.test.js` | its tests (`node --test`), which app-ci runs on every push |
| `package.json` | scripts (`start`, `dev`, `test`); no dependencies |
| `deploy/base/function.yaml` | the `Function` every environment runs: runtime, image, trigger, scale, timeout |
| `deploy/base/kustomizeconfig.yaml` | tells kustomize where a Function keeps its image, so Kargo can pin the signed digest |
| `deploy/envs/{dev,test,prod}/` | one overlay per environment of the project: namespace, image, environment |
| `project.toml` | the runtime the image ships (`BP_NODE_VERSION`); the CI tests run on the same one |
| `api/openapi.yaml` | the function's HTTP interface, published in the catalog |
| `catalog-info.yaml` | the catalog entry (Component and API) |
| `docs/` | TechDocs: [overview](docs/index.md), [architecture](docs/architecture.md), [operations](docs/operations.md) |

## Run and test locally

Requires Node.js 24 (the version `project.toml` pins).

```bash
npm start                      # http://localhost:8080
curl -s localhost:8080/healthz
npm test                       # the suite app-ci runs
```

## Deploy

Push to `main`. app-ci builds the image, runs the tests on the same runtime,
scans and signs it; Kargo promotes the signed digest dev → test (automatically,
once verified) → prod (with a Release); Argo CD deploys each environment's
`Function`. In dev the function answers at https://${{ values.hostname }}.
