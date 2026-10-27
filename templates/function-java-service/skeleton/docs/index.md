# ${{ values.name }}

${{ values.description }}

A **Java function** scaffolded from the Adhar `function-java-service` golden
path. It runs on the platform's Function API: a Knative Service per environment
that scales to zero when idle and out under load, behind the platform Gateway.

## What you got

| Thing | Where |
| --- | --- |
| The function | `src/main/java/io/adhar/function/App.java` — the JDK HttpServer: `/healthz`, and every other path and method invokes the function |
| Its tests | `src/test/java/io/adhar/function/AppTest.java` (JUnit, `mvn verify`) — app-ci runs them on every push |
| How it runs | `deploy/base/function.yaml` — a `Function` (platform.adhar.io/v1alpha1): runtime, trigger, scale, timeout |
| Where it runs | `deploy/envs/{dev,test,prod}` — one overlay per environment of the project |
| Its runtime | Java 25 — `BP_JVM_VERSION` in `project.toml` |
| Its HTTP interface | `api/openapi.yaml`, in the catalog as `${{ values.name }}-api` |
| Catalog entry | `catalog-info.yaml` |

In dev it answers at **https://${{ values.hostname }}** once the first build has
been promoted; test and prod each get their own host,
`<name>.<environment>.<platform domain>`.

## Run it locally

Requires JDK 25 and Maven 3.9 (the JDK `project.toml` pins).

```bash
mvn -q package && java -jar target/${{ values.name }}-0.1.0.jar   # http://localhost:8080
curl -s localhost:8080/healthz
mvn verify                     # the suite app-ci runs
```

## Ship a change

```
git push → app-ci: build · test · scan · sign → Kargo: dev → test → prod → Argo CD → Knative
```

Pushing to `main` starts the platform's `app-ci` pipeline: the buildpacks build
the image on Java 25, your tests run on the same runtime, the image and the source
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
