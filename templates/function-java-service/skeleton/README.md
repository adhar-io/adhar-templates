# ${{ values.name }}

${{ values.description }}

This repository was scaffolded from the **Adhar Function Service (Java)** template.

## What it contains

- `src/main/java/App.java` — a minimal Java HTTP function handler
- `pom.xml` — Maven build configuration
- `deploy/function.yaml` — `platform.adhar.io/v1alpha1` `Function` resource
- `project.toml` — buildpack metadata for the app image

## Runtime model

The function is deployed via the Adhar control plane's `Function` composition:

- scale-to-zero when idle (`minScale: 0` by default)
- autoscale up on traffic (`maxScale` controls burst ceiling)
- Knative request timeout (`timeoutSeconds`)

## Local run

```bash
mvn -q exec:java
```

Health check:

```bash
curl -s http://localhost:8080/healthz
```
