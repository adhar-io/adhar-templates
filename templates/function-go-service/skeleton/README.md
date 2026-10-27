# ${{ values.name }}

${{ values.description }}

A Go function on the Adhar platform, scaffolded from the
`function-go-service` template. It runs on the platform's Function API: a
Knative Service per environment that scales to zero when idle and out under
load, with its own HTTPS URL.

## Layout

| Path | What it is |
| --- | --- |
| `handler.go` | the function: `/healthz`, and every other path and method invokes it |
| `main.go` | serves the handler on `$PORT` and drains in-flight requests on SIGTERM |
| `handler_test.go` | its tests (`go test`), which app-ci runs on every push |
| `go.mod` | the module; standard library only |
| `deploy/base/function.yaml` | the `Function` every environment runs: runtime, image, trigger, scale, timeout |
| `deploy/base/kustomizeconfig.yaml` | tells kustomize where a Function keeps its image, so Kargo can pin the signed digest |
| `deploy/envs/{dev,test,prod}/` | one overlay per environment of the project: namespace, image, environment |
| `project.toml` | the runtime the image ships (`BP_GO_VERSION`); the CI tests run on the same one |
| `api/openapi.yaml` | the function's HTTP interface, published in the catalog |
| `catalog-info.yaml` | the catalog entry (Component and API) |
| `docs/` | TechDocs: [overview](docs/index.md), [architecture](docs/architecture.md), [operations](docs/operations.md) |

## Run and test locally

Requires Go 1.26 (the toolchain `project.toml` pins; `go.mod` says 1.25, the minimum language level).

```bash
go run .                       # http://localhost:8080
curl -s localhost:8080/healthz
go vet ./... && go test ./...  # what app-ci runs
```

## Deploy

Push to `main`. app-ci builds the image, runs the tests on the same runtime,
scans and signs it; Kargo promotes the signed digest dev → test (automatically,
once verified) → prod (with a Release); Argo CD deploys each environment's
`Function`. In dev the function answers at https://${{ values.hostname }}.
