# ${{ values.name }}

${{ values.description }}

A **TanStack Start (full-stack React)** service scaffolded from the Adhar `tanstack-start-fullstack-app` golden path.

## What you got

| Thing | Where |
| --- | --- |
| Application source | `src/router.tsx` — routes and server functions; `vite.config.ts` — the build. |
| Kubernetes manifests | `deploy/` — Service, HTTPRoute, Argo Rollout, CloudNativePG Cluster |
| Build | the platform `app-ci` pipeline, on every push — nothing to define here |
| Catalog entry | `catalog-info.yaml` — what the Service Catalog reads |
| These docs | `docs/` + `mkdocs.yml` |

Your service is at **https://${{ values.hostname }}** once the first rollout
completes, and its repository is
`${{ values.gitOwner }}/${{ values.repoName }}`.

!!! note "Database"
    This service was scaffolded {% if values.withDatabase %}**with**{% else %}**without**{% endif %} a
    managed PostgreSQL cluster.
{%- if values.withDatabase %}
    `deploy/database.yaml` declares a CloudNativePG `Cluster` and the connection
    string arrives in the container as `DATABASE_URL`. Nothing in the application
    holds a password: the credential is a Secret CloudNativePG generates and
    rotates, and it is mounted by reference.
{%- else %}
    To add one later, re-scaffold with **Provision a PostgreSQL database** ticked,
    or copy `deploy/database.yaml` from the template and add the `DATABASE_URL`
    environment variable to `deploy/rollout.yaml`.
{%- endif %}

## Run it locally

Requires Node 20+.

```bash
npm ci
npm run dev
```

It listens on port `${{ values.port }}`, the same port the container exposes,
so what you see locally is what the cluster runs.

Tests:

```bash
npm test
```

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
