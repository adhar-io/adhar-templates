# ${{ values.name }}

${{ values.description }}

A **Node.js function** in strict **TypeScript**, scaffolded from the Adhar
`function-nodejs-service` golden path. It runs on the platform's Function API: a
Knative Service per environment that scales to zero when idle and out under
load, behind the platform Gateway.

## What you got

| Thing | Where |
| --- | --- |
| The function | `src/handler.ts` — `invoke`, called for every request and event; what it returns is the JSON answer ([The code](architecture.md#the-code)) |
| Around it | `src/http.ts` (HTTP on `$PORT`: `/healthz`, and every other path and method invokes the function), `src/server.ts` (the process), `src/config.ts`, `src/log.ts` |
| Its tests | `test/unit/` and `test/integration/`, TypeScript too (`node --test` through `tsx`) — `npm test`, which app-ci runs on every push |
| TypeScript | `tsconfig.json` — strict, read by the editor, `npm run typecheck` and ESLint; `tsconfig.build.json` — `npm run build` compiles `src/` to `dist/` |
| How it runs | `deploy/base/function.yaml` — a `Function` (platform.adhar.io/v1alpha1): runtime, trigger, scale, timeout |
| Where it runs | `deploy/envs/{dev,test,prod}` — one overlay per environment of the project |
| Its runtime | Node.js 24 — `BP_NODE_VERSION` in `project.toml` |
| Its HTTP interface | `api/openapi.yaml`, in the catalog as `${{ values.name }}-api` |
| Catalog entry | `catalog-info.yaml` |

In dev it answers at **https://${{ values.hostname }}** once the first build has
been promoted; test and prod each get their own host,
`<name>.<environment>.<platform domain>`.

## Run it locally

Requires Node.js 24 (the version `project.toml` pins).

```bash
npm install                    # the first time; commit the package-lock.json it writes
npm run dev                    # http://localhost:8080 — runs src/ as it is, restarts on every change
curl -s localhost:8080/healthz
npm test                       # lint, type-check, build, then every test — the suite app-ci runs
```

(`npm install`, not `npm ci`: the repository starts without a
`package-lock.json`, and `npm ci` refuses to run without one. Commit the lock
file it writes and `npm ci` works from then on — app-ci uses it when present.)

`npm run build && npm start` runs what the image runs instead: `src/` compiled
to `dist/`, started with `node --enable-source-maps dist/server.js`, so a stack
trace names the `.ts` file and line. Invoke it the way a trigger does:

```bash
curl -s -X POST localhost:8080/ -H 'content-type: application/json' -d '{"order":42}'
curl -s -X POST localhost:8080/ -H 'ce-specversion: 1.0' -H 'ce-type: dev.knative.sources.ping' \
  -H 'ce-source: local' -H 'ce-id: 1' -H 'content-type: application/json' -d '{}'
```

## Ship a change

```
git push → app-ci: build · test · scan · sign → Kargo: dev → test → prod → Argo CD → Knative
```

Pushing to `main` starts the platform's `app-ci` pipeline: the buildpacks build
the image on Node.js 24 — compiling the TypeScript with `npm run build` — your
tests run on the same runtime, the image and the source are scanned, and only a
build that passes is signed. Kargo then promotes the
signed digest: it pins it in `deploy/envs/dev`, renders that overlay to the
`stage/dev` branch Argo CD deploys, and verifies the function there before test
may take it. Prod waits for a Release.

[Architecture](architecture.md) describes the request path, scaling and
triggers; [Operations](operations.md) is the runbook.

## Who owns this

`${{ values.owner or 'group:platform-engineers' }}`. Ownership is declared in
`catalog-info.yaml` and is what the catalog, the scorecards and on-call routing
read — keep it current when the team changes.
