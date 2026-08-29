# ${{ values.name }}

${{ values.description }}

A fullstack React app built with **TanStack Start** (SSR + server routes) and
pre-wired with the **Adhar UI** design system (`@adhar-ui/react` + Tailwind v4).
It runs as a Node server and ships through Adhar's **secure supply chain**:

```
git push → buildpacks (vite build → Nitro server) → Harbor → trivy scan
        → cosign sign → kyverno verify → ArgoCD → Argo Rollouts (canary)
```

OpenTelemetry is auto-instrumented (Node auto-instrumentations via `NODE_OPTIONS`)
→ Tempo/Mimir; logs → Loki.

## Structure

```
src/
├── router.tsx
├── routes/
│   ├── __root.tsx        # HTML shell
│   ├── index.tsx         # home page (uses @adhar-ui/react)
│   └── api/hello.ts      # server route → /api/hello
└── styles.css            # Tailwind v4 + @adhar-ui/tailwind-preset
```

## Local development

```sh
npm install
npm run dev
```

> Targets TanStack Start ~1.87 (Vite plugin). If you pin a different version,
> align `vite.config.ts` and the route APIs accordingly.

Access the deployed app at `https://${{ values.hostname }}:8443`.
