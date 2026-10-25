# ${{ values.name }}

${{ values.description }}

This repository was scaffolded from the **Adhar Function Service (Go)** template.

## What it contains

- `main.go` — minimal Go HTTP handler with a health endpoint
- `deploy/function.yaml` — `platform.adhar.io/v1alpha1` `Function` resource
- `project.toml` — buildpack metadata for the app image

## Runtime model

The function is deployed through Adhar's `Function` composition:

- scale-to-zero when idle (`minScale: 0` default)
- autoscale up on traffic (`maxScale` ceiling)
- per-request timeout (`timeoutSeconds`)
