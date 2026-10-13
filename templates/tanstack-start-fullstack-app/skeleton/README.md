# ${{ values.name }}

${{ values.description }}

A fullstack React app built with **TanStack Start** (SSR + server routes) and
pre-wired with the **Adhar UI** design system (`@adhar-ui/react` + Tailwind v4).
It runs as a Node server and ships through Adhar's **secure supply chain**:

```
git push → buildpacks (vite build → srvx Node server) → Harbor → trivy scan
        → cosign sign → kyverno verify → ArgoCD → Argo Rollouts (canary)
```

OpenTelemetry is auto-instrumented (Node auto-instrumentations via `NODE_OPTIONS`)
→ Tempo/Mimir; logs → Loki.

## Structure

```
server.mjs                # production server: dist/server fetch handler + dist/client assets
public/adhar-mark.svg
src/
├── router.tsx            # getRouter() — TanStack Start's router factory
├── routes/
│   ├── __root.tsx        # HTML shell, theme applied before first paint
│   ├── index.tsx         # landing page + live status from /api/hello
│   └── api/hello.ts      # server route → /api/hello
├── components/           # icons, light/dark theme hook
└── styles.css            # Tailwind v4 + Adhar UI preset + Adhar brand theme
```

## Local development

```sh
npm install
npm run dev
```

> Targets TanStack Start ~1.87 (Vite plugin). If you pin a different version,
> align `vite.config.ts` and the route APIs accordingly.

Access the deployed app at `https://${{ values.hostname }}:8443`.
