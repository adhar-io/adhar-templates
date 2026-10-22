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
public/adhar-symbol.svg
src/
├── router.tsx            # getRouter() — TanStack Start's router factory
├── routes/
│   ├── __root.tsx        # HTML shell, theme applied before first paint, 404 page
│   ├── index.tsx         # landing page + live status from /api/hello
│   └── api/hello.ts      # server route → /api/hello
├── components/           # icons, light/dark theme hook
└── styles.css            # Tailwind v4 + Adhar UI preset + Adhar brand theme
e2e/                      # Playwright end-to-end tests (npm run test:e2e)
```

## Local development

```sh
npm install
npm run dev
```

> Targets TanStack Start ~1.87 (Vite plugin). If you pin a different version,
> align `vite.config.ts` and the route APIs accordingly.

Access the deployed app at `https://${{ values.hostname }}:8443`.

## End-to-end tests

Playwright tests against the production build live in [`e2e/`](e2e/README.md):

```sh
npx playwright install chromium   # once per machine
npm run test:e2e                  # builds, serves and tests the production build
```

CI runs them on every build; `E2E_BASE_URL=<url> npm run test:e2e` tests a
deployed environment instead.


## Localisation

Every user-visible string is a key in `src/i18n/<language>.json`, looked up with
`t()` (`src/localisation.tsx`). `en.json` holds the source text — add new keys
there.
{%- if values.withLocalisation %}

Texts are managed in [Tolgee](https://tolgee.io); the platform created a Tolgee
project for this app — declared in `.adhar/app.yaml`
(`spec.parameters.localisation`) — with the languages
`${{ values.languages }}`.

**At runtime** the server reads the texts from Tolgee's export API with a
read-only key from the Secret `${{ values.name }}-tolgee` (`TOLGEE_API_URL`,
`TOLGEE_PROJECT_ID`, `TOLGEE_API_KEY`) and caches them for a minute, so a
translator's change is live without a release and the key never reaches the
browser (`src/server/i18n.ts`). Pages are server-rendered in the visitor's
language — the `lang` cookie the switcher sets, else the browser's
`Accept-Language` — and switching language loads `/i18n/<language>.json` from
the same source (`src/routes/i18n/$file.ts`). Without the Secret, or when Tolgee
errors or is slow (2 s), the server uses the last texts Tolgee gave or the files
built into the image; if the browser cannot reach `/i18n` at all, it uses the
copy bundled into its JavaScript. A key missing in a language falls back to
English, and `/i18n/<language>.json` answers 404 for a language neither Tolgee
nor the app has.

**At build time** CI runs `tolgee push` (new keys from `en.json`) and
`tolgee pull` (every language into `src/i18n/`) before the build, using
`.tolgeerc`, so the built-in fallback is as fresh as the last build.
`src/i18n/de.json` is an example translation.

**Tolgee owns the texts once a key exists there.** CI pushes with
`--force-mode KEEP`: a NEW key in `en.json` is created in Tolgee, but editing
the English text of an EXISTING key in the repository changes nothing in
Tolgee, and the next `tolgee pull` overwrites your edit in the files built into
the image. Change existing copy in Tolgee (or in place, below). The files are
pulled as flat JSON (`"pull.delimiter": ""`), the same shape `/i18n` serves.

**Adding a language:** add it to the Tolgee project; the next build pulls its
file, and adding the tag to `LANGUAGES` in `src/localisation.tsx` puts it in the
language switcher.

**Editing in place while developing:** create `.env.development.local`
(git-ignored) with a Tolgee API key that may edit translations, then run
`npm run dev` and Alt + click any text:

```sh
VITE_TOLGEE_API_URL=https://tolgee.<platform domain>
VITE_TOLGEE_API_KEY=tgpak_…
```

To develop against Tolgee's live texts without editing, set `TOLGEE_API_URL`,
`TOLGEE_PROJECT_ID` and a read-only `TOLGEE_API_KEY` in the shell instead.
The in-context tools and the `VITE_` variables exist only in `npm run dev`; a
production build contains neither.

**Testing:** `npm test` unit-tests the Tolgee source (Tolgee answering, down,
slow, not configured, unknown languages, caching); `npm run test:e2e` covers the
translated server render, switching language and the fallback when `/i18n`
fails.
{%- else %}

Localisation was turned off when this app was scaffolded, so there is one
language and no Tolgee project. The string table still keeps the texts out of
the components, and `/i18n/en.json` serves it.
{%- endif %}

## Telemetry

The page and the server report to the platform on their own.

- **Server metrics.** `server.mjs` serves Prometheus metrics on port 9464
  (`src/server/metrics.mjs`, scraped through `deploy/base/podmonitor.yaml`):
  requests by method, route template and status with a latency histogram,
  under the names the app's Grafana dashboard reads, plus Node.js runtime
  metrics. Traces and OTLP metrics also go to the platform collector
  (`OTEL_*` in deploy/base/rollout.yaml).
- **Real-user monitoring (Grafana Faro).** In the browser only
  (`src/telemetry.ts`, started from `src/routes/__root.tsx`). What it sends is
  decided at runtime by `GET /runtime-config.json`, which the server answers from
  the Pod's environment (`src/server/edge.mjs`), so the one image promoted from
  dev to prod reports under each environment's name. `FARO_URL` points at
  `https://faro.<platform domain>/collect`: page loads, web vitals (LCP, INP, CLS,
  FCP, TTFB), JavaScript errors, fetch timings and browser traces whose
  `traceparent` joins this server's own trace in Tempo. The **Frontend** section
  of the app's Grafana dashboard (`/d/app-${{ values.name }}`) shows it.
{%- if values.withAnalytics %}
- **Product analytics (PostHog).** On when the optional Secret
  `${{ values.name }}-posthog` exists in the environment's namespace (keys
  `api-key`: the environment's project key `phc_…`; `host`: where `/ingest`
  forwards to, e.g. `http://posthog-events.adhar-system.svc.cluster.local:8000`;
  optional `ui-host` and `session-replay: "true"`). Events go to `/ingest` on
  this origin and the server forwards them without cookies or the visitor's
  address. Autocapture and page views (route changes included) are on, session
  replay is off unless `session-replay` is `"true"`, element text is masked, and
  Do Not Track, Global Privacy Control and `window.adharAnalytics.optOut()` stop it.
{%- endif %}

**Testing:** `npm test` covers `/runtime-config.json`{% if values.withAnalytics %}, the `/ingest` proxy{% endif %} and the
metrics; `npm run test:e2e` checks what the page sends when configured and that
it sends nothing when not.
