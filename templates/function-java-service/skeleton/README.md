# ${{ values.name }}

${{ values.description }}

A Java function on the Adhar platform, scaffolded from the
`function-java-service` template. It runs on the platform's Function API: a
Knative Service per environment that scales to zero when idle and out under
load, with its own HTTPS URL.

## Layout

| Path | What it is |
| --- | --- |
| `src/main/java/io/adhar/function/App.java` | the function: the JDK's HttpServer on `$PORT` — `/healthz`, and every other path and method invokes it |
| `src/test/java/io/adhar/function/AppTest.java` | its tests (JUnit), which app-ci runs on every push |
| `pom.xml` | Java 25, an executable jar, no runtime dependencies |
| `deploy/base/function.yaml` | the `Function` every environment runs: runtime, image, trigger, scale, timeout |
| `deploy/base/kustomizeconfig.yaml` | tells kustomize where a Function keeps its image, so Kargo can pin the signed digest |
| `deploy/envs/{dev,test,prod}/` | one overlay per environment of the project: namespace, image, environment |
| `project.toml` | the runtime the image ships (`BP_JVM_VERSION`); the CI tests run on the same one |
| `api/openapi.yaml` | the function's HTTP interface, published in the catalog |
| `catalog-info.yaml` | the catalog entry (Component and API) |
| `docs/` | TechDocs: [overview](docs/index.md), [architecture](docs/architecture.md), [operations](docs/operations.md) |

## Run and test locally

Requires JDK 25 and Maven 3.9 (the JDK `project.toml` pins).

```bash
mvn -q package && java -jar target/${{ values.name }}-0.1.0.jar   # http://localhost:8080
curl -s localhost:8080/healthz
mvn verify                     # the suite app-ci runs
```

## Deploy

Push to `main`. app-ci builds the image, runs the tests on the same runtime,
scans and signs it; Kargo promotes the signed digest dev → test (automatically,
once verified) → prod (with a Release); Argo CD deploys each environment's
`Function`. In dev the function answers at https://${{ values.hostname }}.
