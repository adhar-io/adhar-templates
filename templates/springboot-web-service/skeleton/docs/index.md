# ${{ values.name }}

${{ values.description }}

A **Spring Boot (Web MVC)** service scaffolded from the Adhar `springboot-web-service` golden path.

## What you got

| Thing | Where |
| --- | --- |
| Application source | `pom.xml` — the build; `settings.xml` points Maven at the platform Nexus mirror. |
| Kubernetes manifests | `deploy/` — Service, HTTPRoute, Argo Rollout{% if values.withDatabase %}, CloudNativePG Cluster{% endif %}{% if values.withCache %}, Valkey cache claim{% endif %}{% if values.withKafka %}, Kafka claim{% endif %} |
| Local backing services | `compose.yaml` — `docker compose up -d` |
| Build | the platform `app-ci` pipeline, on every push — nothing to define here |
| Catalog entry | `catalog-info.yaml` — what the Service Catalog reads |
| These docs | `docs/` + `mkdocs.yml` |

Your service is at **https://${{ values.hostname }}** once the first rollout
completes, and its repository is
`${{ values.gitOwner }}/${{ values.repoName }}`.

## Backing services

| Service | Provisioned | How the app gets it |
| --- | --- | --- |
| PostgreSQL | {% if values.withDatabase %}**yes** — `deploy/database.yaml`{% else %}no{% endif %} | `SPRING_DATASOURCE_URL` / `_USERNAME` / `_PASSWORD` from the CloudNativePG Secret |
| Valkey cache | {% if values.withCache %}**yes** — `deploy/cache.yaml`{% else %}no{% endif %} | `SPRING_DATA_REDIS_URL` from the `${{ values.name }}-cache-app` Secret |
| Kafka | {% if values.withKafka %}**yes** — `deploy/kafka.yaml`, topic `${{ values.kafkaTopic }}`{% else %}no{% endif %} | `SPRING_KAFKA_BOOTSTRAP_SERVERS` |

Nothing in the application holds a password: each credential is a Secret the
platform generates, mounted by reference.

!!! tip "Adding one later"
    Copy the manifest from the template (`deploy/database.yaml`,
    `deploy/cache.yaml` or `deploy/kafka.yaml`), add its environment variables
    to `deploy/rollout.yaml` and its starter to `pom.xml`, and commit. Or use the
    standalone **PostgreSQL Database**, **Redis / Valkey Cache** and **Kafka
    Cluster** templates and point the variables at what they create.

## Run it locally

Requires JDK 25, Maven 3.9+ and — for the backing services — Docker.

```bash
docker compose up -d
mvn -s settings.xml spring-boot:run
```

It listens on port `${{ values.port }}`, the same port the container exposes,
so what you see locally is what the cluster runs. Every connection setting
falls back to the `compose.yaml` ports when the cluster's environment variables
are absent.

Tests:

```bash
mvn -s settings.xml test
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
