# ${{ values.name }}

${{ values.description }}

This repository was scaffolded from the **Adhar Function Service (Python)** template.

## What it contains

- `app.py` — minimal Flask handler with health and root endpoints
- `deploy/function.yaml` — `platform.adhar.io/v1alpha1` `Function` resource
- `project.toml` — buildpack metadata for the app image

## Runtime model

The function is deployed through Adhar's `Function` composition:

- scale-to-zero when idle (`minScale: 0` default)
- autoscale up on traffic (`maxScale` ceiling)
- per-request timeout (`timeoutSeconds`)
