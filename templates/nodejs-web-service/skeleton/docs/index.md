# ${{ values.name }}

${{ values.description }}

A **Node.js (Express)** service in strict **TypeScript**, scaffolded from the
Adhar `nodejs-web-service` golden path.

## What you got

| Thing | Where |
| --- | --- |
| Application source | `src/`, TypeScript — `server.ts` runs the process, `app.ts` builds the Express app, and routes, controllers, services{% if values.withDatabase %}, the database{% endif %}, middleware, telemetry and the shared types each have a folder ([Code layout](architecture.md#code-layout)) |
| Tests | `test/unit/` (each module, in-process) and `test/integration/` (the compiled process the image runs), TypeScript too — `npm test` |
| TypeScript | `tsconfig.json` — strict, read by the editor, `npm run typecheck` and ESLint; `tsconfig.build.json` — `npm run build` compiles `src/` to `dist/` ([Build](architecture.md#build)) |
| Kubernetes manifests | `deploy/` — Service, HTTPRoute, Argo Rollout{% if values.withDatabase %}, CloudNativePG Cluster{% endif %} |
| Build | the platform `app-ci` pipeline, on every push — nothing to define here |
| Its runtime | Node.js 24 — `BP_NODE_VERSION` in `project.toml` |
| Catalog entry | `catalog-info.yaml` — what the Service Catalog reads |
| These docs | `docs/` + `mkdocs.yml` |

Your service is at **https://${{ values.hostname }}** once the first rollout
completes, and its repository is
`${{ values.gitOwner }}/${{ values.repoName }}`.

!!! note "Database"
    This service was scaffolded {% if values.withDatabase %}**with**{% else %}**without**{% endif %} a
    managed PostgreSQL cluster.
{%- if values.withDatabase %}
    `deploy/base/database.yaml` declares a CloudNativePG `Cluster` and the
    connection string arrives in the container as `DATABASE_URL`, which
    `src/db/` opens one connection pool with. Nothing in the application holds
    a password: the credential is a Secret CloudNativePG generates and rotates,
    and it is mounted by reference.
{%- else %}
    To add one later, re-scaffold with **Provision a PostgreSQL database** ticked,
    or copy from a template scaffolded with it: `deploy/base/database.yaml`
    (listed in `deploy/base/kustomization.yaml`), the patch in each
    `deploy/envs/<env>/kustomization.yaml` that gives that environment's
    database its own backup path, the `DATABASE_URL` variable in
    `deploy/base/rollout.yaml`, `src/db/index.ts` with its test, the `pg`
    dependency (and `@types/pg`) in `package.json`, and the `db` wiring in
    `src/config/`, `src/types/`, `src/server.ts`, `src/routes/` and
    `src/health/`. Once `db` is part of `AppDependencies` in `src/types/`,
    `npm run typecheck` names every place that still lacks it.
{%- endif %}

## Run it locally

Requires Node.js 24 (the version `project.toml` pins).

```bash
npm install
npm run dev
```

(`npm install`, not `npm ci`: the repository starts without a
`package-lock.json`, and `npm ci` refuses to run without one. Commit the lock
file it writes and `npm ci` works from then on — app-ci uses it when present.)

`npm run dev` runs the TypeScript in `src/` as it is (through `tsx`, no build
step) and restarts on every change. `npm run build && npm start` runs what the
image runs instead: `src/` compiled to `dist/`, started with
`node dist/server.js`. Stack traces name the `.ts` file and line either way.

It listens on port `${{ values.port }}`, the same port the container exposes,
so what you see locally is what the cluster runs.{% if values.withDatabase %} Set `DATABASE_URL` to a
local PostgreSQL for `/db` to answer; without it the service still starts, and
`/db` reports the database as unavailable.{% endif %} Its logs are JSON lines;
`LOG_LEVEL=debug` shows more. Every setting it reads is in `src/config/`.

Tests:

```bash
npm test               # lint, type-check, build, then every test
npm run test:unit      # just the unit tests
npm run lint           # just ESLint (with typescript-eslint)
npm run typecheck      # just the compiler's checks, src/ and test/ alike
```

`npm test` lints the code first, type-checks it, compiles `src/` to `dist/`,
then runs the unit tests — each module under `src/`, served in-process — and
the integration tests, which start the compiled `dist/server.js` the way the
image does, with the OpenTelemetry preload the Rollout sets. The tests are
TypeScript as well, run by Node's own test runner through `tsx`. Those check `/`, `/healthz` (the path both probes call){% if values.withDatabase %},
`/db` when the database is unreachable{% endif %}, that a request is logged as JSON with the
trace it belongs to, and that SIGTERM stops the process cleanly. app-ci runs
`npm test` on every push; a build whose tests fail is never signed, so it
never deploys.

## Ship a change

There is no separate deploy step, and that is the point:

```
git push  →  build + scan + sign  →  Argo CD  →  Argo Rollouts (canary)
```

Pushing to `main` triggers the platform's `app-ci` pipeline: unit tests, a secret
scan and a dependency scan run beside the buildpacks build; the image is scanned,
its SBOM attested, signed with the platform's cosign key and verified — and it is
admitted only if that signature verifies — an unsigned image is
rejected at admission, not at review time. Argo CD then syncs `deploy/` and Argo
Rollouts shifts traffic gradually.

See [Operations](operations.md) for what to do when a rollout does not go to plan.

## Who owns this

`${{ values.owner }}`. Ownership is declared in `catalog-info.yaml` and is what
the Service Catalog, the scorecards and the on-call routing all read — so keep it
current when the team changes.
