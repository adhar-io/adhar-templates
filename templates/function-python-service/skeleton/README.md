# ${{ values.name }}

${{ values.description }}

A Python function on the Adhar platform, scaffolded from the
`function-python-service` template. It runs on the platform's Function API: a
Knative Service per environment that scales to zero when idle and out under
load, with its own HTTPS URL.

## Layout

| Path | What it is |
| --- | --- |
| `app.py` | the function: a Flask app — `/healthz`, and every other path and method invokes it |
| `test_app.py` | its tests (pytest), which app-ci runs on every push |
| `requirements.txt` | Flask and gunicorn, pinned |
| `Procfile` | how the image starts it: gunicorn on `$PORT` |
| `.python-version` | the Python version, for local tooling (pyenv, uv) |
| `deploy/base/function.yaml` | the `Function` every environment runs: runtime, image, trigger, scale, timeout |
| `deploy/base/kustomizeconfig.yaml` | tells kustomize where a Function keeps its image, so Kargo can pin the signed digest |
| `deploy/envs/{dev,test,prod}/` | one overlay per environment of the project: namespace, image, environment |
| `project.toml` | the runtime the image ships (`BP_CPYTHON_VERSION`); the CI tests run on the same one |
| `api/openapi.yaml` | the function's HTTP interface, published in the catalog |
| `catalog-info.yaml` | the catalog entry (Component and API) |
| `docs/` | TechDocs: [overview](docs/index.md), [architecture](docs/architecture.md), [operations](docs/operations.md) |

## Run and test locally

Requires Python 3.13 (the version `project.toml` pins).

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest
flask --app app run --port 8080      # or, as the image runs it: gunicorn app:app
curl -s localhost:8080/healthz
python -m pytest                     # the suite app-ci runs
```

## Deploy

Push to `main`. app-ci builds the image, runs the tests on the same runtime,
scans and signs it; Kargo promotes the signed digest dev → test (automatically,
once verified) → prod (with a Release); Argo CD deploys each environment's
`Function`. In dev the function answers at https://${{ values.hostname }}.
