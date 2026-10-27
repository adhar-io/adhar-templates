# ${{ values.name }}

${{ values.description }}

A **Deno function** scaffolded from the Adhar `function-deno-service` golden
path. It runs on the platform's Function API: a Knative Service per environment
that scales to zero when idle and out under load, behind the platform Gateway.

## What you got

| Thing | Where |
| --- | --- |
| The function | `src/handler.ts` — a Web-standard handler served by `src/main.ts` (`Deno.serve`) |
| Its tests | `test/handler.test.ts` (`node:test`, run by both `deno test` and `node --test`) — app-ci runs them on every push |
| How it runs | `deploy/base/function.yaml` — a `Function` (platform.adhar.io/v1alpha1): runtime, trigger, scale, timeout |
| Where it runs | `deploy/envs/{dev,test,prod}` — one overlay per environment of the project |
| Its runtime | Node.js 24 — `BP_NODE_VERSION` in `project.toml`; the source is Deno-style TypeScript served through `compat/serve-on-node.mjs`, so `runtime: node24` names what the image runs |
| Its HTTP interface | `api/openapi.yaml`, in the catalog as `${{ values.name }}-api` |
| Catalog entry | `catalog-info.yaml` |

In dev it answers at **https://${{ values.hostname }}** once the first build has
been promoted; test and prod each get their own host,
`<name>.<environment>.<platform domain>`.

## Run it locally

Develop with Deno 2, or with Node.js 24 exactly as the image runs it.

```bash
deno task dev                  # Deno: http://localhost:8080
deno task test
npm start                      # Node.js 24 + compat/serve-on-node.mjs, as the image runs it
npm test                       # the suite app-ci runs
curl -s localhost:8080/healthz
```

Why Node in the image: the platform builds every image with Cloud Native Buildpacks, and paketo's builder has no Deno buildpack. `compat/serve-on-node.mjs` provides the two Deno APIs this code uses (`Deno.serve`, `Deno.env`) on Node.js 24, which also strips the TypeScript types natively. Keep the source to Web-standard APIs and type-only TypeScript (no `enum`, no `namespace`) and it runs unchanged on both.

## Ship a change

```
git push → app-ci: build · test · scan · sign → Kargo: dev → test → prod → Argo CD → Knative
```

Pushing to `main` starts the platform's `app-ci` pipeline: the buildpacks build
the image on Node.js 24, your tests run on the same runtime, the image and the source
are scanned, and only a build that passes is signed. Kargo then promotes the
signed digest: it pins it in `deploy/envs/dev`, renders that overlay to the
`stage/dev` branch Argo CD deploys, and verifies the function there before test
may take it. Prod waits for a Release.

[Architecture](architecture.md) describes the request path, scaling and
triggers; [Operations](operations.md) is the runbook.

## Who owns this

`${{ values.owner or 'group:platform-engineers' }}`. Ownership is declared in
`catalog-info.yaml` and is what the catalog, the scorecards and on-call routing
read — keep it current when the team changes.
