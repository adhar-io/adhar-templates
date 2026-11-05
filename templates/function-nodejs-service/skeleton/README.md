# ${{ values.name }}

${{ values.description }}

A Node.js function in strict TypeScript on the Adhar platform, scaffolded from
the `function-nodejs-service` template. It runs on the platform's Function API:
a Knative Service per environment that scales to zero when idle and out under
load, with its own HTTPS URL.

## Layout

| Path | What it is |
| --- | --- |
| `src/handler.ts` | the function: `invoke` gets every request and event and returns the JSON answer — replace its body with yours |
| `src/http.ts` | Knative's contract: HTTP on `$PORT`; `/healthz` answers itself, every other request invokes the function; bodies over 1 MiB get 413, an error the function throws a 500 that does not show its message |
| `src/server.ts` | the process: listens on `$PORT`, and on SIGTERM finishes the requests in flight before it exits |
| `src/config.ts` · `src/log.ts` | what the function reads from its environment at startup · its logs, one JSON object per line |
| `test/unit/` · `test/integration/` | its tests, in TypeScript (`node --test` through `tsx`); the integration tests run the compiled `dist/server.js` as the image does. app-ci runs them on every push |
| `package.json` | scripts (`dev`, `build`, `start`, `test`, `lint`, `typecheck`); no runtime dependencies — TypeScript, ESLint and `tsx` are devDependencies and never reach the image |
| `tsconfig.json` · `tsconfig.build.json` | strict TypeScript for the editor, `npm run typecheck` and ESLint · `npm run build`: `src/` → `dist/` |
| `eslint.config.mts` | ESLint with typescript-eslint's type-checked rules |
| `deploy/base/function.yaml` | the `Function` every environment runs: runtime, image, trigger, scale, timeout |
| `deploy/base/kustomizeconfig.yaml` | tells kustomize where a Function keeps its image, so Kargo can pin the signed digest |
| `deploy/envs/{dev,test,prod}/` | one overlay per environment of the project: namespace, image, environment |
| `project.toml` | the runtime the image ships (`BP_NODE_VERSION`) and its build step (`BP_NODE_RUN_SCRIPTS`: `npm run build`); the CI tests run on the same runtime |
| `api/openapi.yaml` | the function's HTTP interface, published in the catalog |
| `catalog-info.yaml` | the catalog entry (Component and API) |
| `docs/` | TechDocs: [overview](docs/index.md), [architecture](docs/architecture.md), [operations](docs/operations.md) |

## Run and test locally

Requires Node.js 24 (the version `project.toml` pins).

```bash
npm install                    # the first time; commit the package-lock.json it writes
npm run dev                    # http://localhost:8080 — runs src/ as it is, restarts on every change
curl -s localhost:8080/healthz
npm test                       # lint, type-check, build, then every test — the suite app-ci runs
npm run build && npm start     # the compiled dist/, exactly what the image runs
```

`dist/` is build output and is not committed: the image build compiles its own.

## Deploy

Push to `main`. app-ci builds the image — compiling the TypeScript — runs the
tests on the same runtime, scans and signs it; Kargo promotes the signed digest
dev → test (automatically, once verified) → prod (with a Release); Argo CD
deploys each environment's `Function`. In dev the function answers at
https://${{ values.hostname }}.
