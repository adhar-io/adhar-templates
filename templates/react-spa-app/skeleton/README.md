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

// Adhar UI components are unstyled; the look comes from the variant functions.
<Button className={buttonVariants({ variant: 'outline' })}>Read the docs</Button>
```

The Adhar brand theme (light and dark colors, radius, the logo gradient) lives in
`src/index.css`. Change it there and every Adhar UI variant follows.

## Layout

```
.
├── index.html           # applies the saved/system theme before first paint
├── public/adhar-symbol.svg
├── vite.config.js
├── project.toml         # buildpack: npm build → serve dist/ with nginx
├── .npmrc               # @adhar-ui → Gitea npm registry
├── src/
│   ├── main.jsx
│   ├── App.jsx          # landing page built from Adhar UI variants
│   ├── icons.jsx        # inline line icons
│   ├── useTheme.js      # light/dark toggle, remembered per browser
│   └── index.css        # Tailwind v4 + Adhar UI preset + Adhar brand theme
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
