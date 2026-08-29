# Adhar Templates

Base **application templates** for the Adhar Internal Developer Platform — the
catalog the Adhar Console (Backstage/CNOE) shows under **Create**.

Each template is a [Backstage Software Template](https://backstage.io/docs/features/software-templates/)
(`scaffolder.backstage.io/v1beta3`) that scaffolds a **complete, production-shaped
application** wired into Adhar's secure software supply chain — no boilerplate, no
infra tickets.

## How it flows

```
 adhar-templates (this repo, public GitHub)
      │  platform bootstrap mirrors templates →
      ▼
 Gitea  ──catalog──►  Adhar Console (Create)
                            │  developer fills the form (dynamic values)
                            ▼
   fetch:template → publish:gitea → cnoe:kubernetes:apply → catalog:register
                            │
      the scaffolded app lands in its OWN Gitea repo (source + deploy/) so the
      team can customise + maintain it, and an ArgoCD Application is applied that:
                            ▼
   kpack builds + SIGNS the image (buildpacks, no Dockerfile) → Harbor
      → kyverno verifies the cosign signature at admission
      → ArgoCD deploys Deployment/Service/HTTPRoute (+ optional CNPG Postgres)
```

Everything a service needs is generated together: source, a GitOps `deploy/` tree,
a signed-image build, an ingress route, and — when asked — a managed PostgreSQL
database with its connection wired into the app via a Secret.

## Templates

| Template | Language | Database option | Notes |
|---|---|---|---|
| `nodejs-web-service` | Node.js (Express) | optional CNPG Postgres | Flagship; buildpacks build |
| `go-web-service` | Go (net/http) | optional CNPG Postgres | Minimal, fast image |
| `python-web-service` | Python (Flask) | optional CNPG Postgres | |

## Repo layout

```
adhar-templates/
├── catalog-info.yaml                 # Backstage Location — registers every template
├── templates/
│   └── <name>/
│       ├── template.yaml             # parameters (the form) + scaffolder steps
│       └── skeleton/                 # rendered into the new app's Gitea repo
│           ├── catalog-info.yaml     # the new component's catalog entry
│           ├── <app source>
│           └── deploy/               # GitOps tree ArgoCD syncs
│               ├── image.yaml        # kpack Image → build + cosign-sign → Harbor
│               ├── deployment.yaml   # runs the signed image (kyverno-gated)
│               ├── service.yaml
│               ├── httproute.yaml    # Cilium Gateway route
│               └── database.yaml     # CNPG Cluster + wiring (only if requested)
```

## Local dev

The whole chain runs on a local `adhar up` Kind cluster — build, sign, scan,
verify, deploy, and a real database — so "works on the platform" is the same as
"works on my laptop". No cloud account required.

## Prerequisites on the platform

The scaffolded apps depend on the `supply-chain` package (kpack builder
`adhar-builder`, the `adhar-pipeline` service account, cosign key, and the
`verify-supply-chain-images` kyverno policy) plus `harbor`, `cnpg`, and `kyverno`
— all enabled in the local profile.

## License

Apache-2.0.
