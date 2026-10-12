# ${{ values.name }}

${{ values.description }}

A React single-page app pre-wired with the **Adhar UI** design system
(`@adhar-ui/react` + Tailwind v4 preset + tokens), scaffolded by Adhar.

It builds with Vite and is served by nginx via Cloud Native Buildpacks, then
ships through the platform's **secure supply chain**:

```
git push → buildpacks (npm build → nginx) → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

nginx access logs are collected to Loki automatically. For rich browser RUM
(traces/metrics from the user's browser), enable the platform `faro` package.

## Adhar UI

`@adhar-ui/react` is resolved from the in-cluster Gitea npm registry (see
`.npmrc`), published by the `adhar-ui` release pipeline. Import components and
style variants directly:

```jsx
import { Button, buttonVariants } from '@adhar-ui/react'
import { cn } from '@adhar-ui/utils'
```

## Layout

```
.
├── index.html
├── vite.config.js
├── project.toml         # buildpack: npm build → serve dist/ with nginx
├── .npmrc               # @adhar-ui → Gitea npm registry
├── src/
│   ├── main.jsx
│   ├── App.jsx          # uses @adhar-ui/react
│   └── index.css        # Tailwind v4 + @adhar-ui/tailwind-preset
└── deploy/              # GitOps tree — ArgoCD syncs this
    ├── rollout.yaml     # Argo Rollout (canary) of the SIGNED image
    ├── service.yaml
    └── httproute.yaml   # https://${{ values.hostname }}:8443
```

## Local development

```sh
npm install
npm run dev
```

Access the deployed app at `https://${{ values.hostname }}:8443`.
