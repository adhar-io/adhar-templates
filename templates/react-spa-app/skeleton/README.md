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

nginx access logs are collected to Loki automatically; the browser reports real-user
monitoring{% if values.withAnalytics %} and product analytics{% endif %} itself (see Telemetry below).

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
├── e2e/                 # Playwright end-to-end tests (npm run test:e2e)
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
`t()` (`src/i18n.jsx`). `en.json` holds the source text — add new keys there.
{%- if values.withLocalisation %}

Texts are managed in [Tolgee](https://tolgee.io); the platform created a Tolgee
project for this app — declared in `.adhar/app.yaml`
(`spec.parameters.localisation`) — with the languages
`${{ values.languages }}`.

**At runtime** the browser loads `/i18n/<language>.json` from the app's own
origin. nginx (`nginx-app.conf`) proxies it to Tolgee's export API with a
read-only key from the Secret `${{ values.name }}-tolgee` (`TOLGEE_API_URL`,
`TOLGEE_PROJECT_ID`, `TOLGEE_API_KEY`), so a translator's change is live within
a minute without a release, and the key never reaches the browser. Without the
Secret, or when Tolgee errors or is slow, nginx serves the copy built into the
image (`dist/i18n/`); if even that request fails, the app uses the copy bundled
into its JavaScript. A key missing in a language falls back to English.

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
file, and adding the tag to `LANGUAGES` in `src/i18n.jsx` puts it in the
language switcher.

**Editing in place while developing:** create `.env.development.local`
(git-ignored) with a Tolgee API key that may edit translations, then run
`npm run dev` and Alt + click any text:

```sh
VITE_TOLGEE_API_URL=https://tolgee.<platform domain>
VITE_TOLGEE_API_KEY=tgpak_…
```

The in-context tools and these variables exist only in `npm run dev`; a
production build contains neither.

**Testing:** `npm run test:e2e` covers runtime texts, switching language and the
fallback when `/i18n` fails; `npm run build && npm run test:nginx` runs
`nginx-app.conf` in a real nginx against a stand-in Tolgee (Docker or Podman).
{%- else %}

Localisation was turned off when this app was scaffolded, so there is one
language and no Tolgee project. The string table still keeps the texts out of
the components.
{%- endif %}
{%- if values.withCms %}

## Content (Strapi)

Text, articles and media come from the platform's **Strapi** CMS, so editors
change them without a release. The home page lists the latest published entries
of the `${{ values.cmsCollection }}` collection type, in the language the app is shown in.

The browser never talks to Strapi: `GET /cms/<path>` on this app's own origin is
Strapi's REST API at `/api/<path>`, proxied by nginx (`nginx-app.conf`) with a **read-only**
API token added on the server, and Strapi's media (`/uploads/…`) is served the same
way. Only GET passes, and Strapi's user, auth and media-library endpoints are never
proxied. Strapi's public address is behind the platform's single sign-on, which is
why the app proxies instead of calling it.

| Setting | Where | |
|---|---|---|
| `STRAPI_API_TOKEN` | Secret `${{ values.name }}-strapi`, key `api-token` | A read-only (or custom, read-only) Strapi API token. Without it `/cms/` answers `X-Cms: off` and the page shows a setup hint. |
| `STRAPI_URL` | same Secret, key `api-url` (optional) | Default: the platform's Strapi, `http://strapi.adhar-system.svc.cluster.local:1337` |

**Set it up once per environment:**

1. In Strapi (`https://strapi.<platform domain>/admin`), create the
   `${{ values.cmsCollection }}` collection type with at least a `title` field
   (`description`, a `cover` image and i18n are picked up when present), and
   publish an entry.
2. Under *Settings → API Tokens*, create a token of type **Read-only** — or
   **Custom** with only `find`/`findOne` on this app's content types, since the
   CMS is shared by every app on the platform.
3. Store it where the Rollout reads it:
   `kubectl -n <env> create secret generic ${{ values.name }}-strapi --from-literal=api-token=<token>`,
   then restart the Rollout. (When the platform provisions CMS tokens, it writes
   this Secret for you.)

**Use it in code** — `src/cms.js`: `fetchCollection(type, { locale, pageSize, sort, filters, populate })`
returns `{ status: 'ok' | 'off' | 'error', entries }` and never throws, so a CMS
outage costs a section, never the page. The section on the home page is in `src/App.jsx`.

**Locally:** run Strapi yourself or `kubectl -n adhar-system port-forward svc/strapi 1337`,
put `STRAPI_URL=http://localhost:1337` and `STRAPI_API_TOKEN=<token>` in `.env.development.local` (git-ignored)
and `npm run dev`; `vite.config.js` proxies `/cms/` the same way.

**Testing:** `npm run test:e2e` (`e2e/tests/cms.spec.ts`) checks every state of the page; `npm run build && npm run test:nginx` runs the proxy in a real nginx against a stand-in Strapi.
{%- endif %}

## Telemetry

The page reports to the platform on its own; nothing is configured in the code.
What it sends is decided at runtime by `GET /runtime-config.json`, which nginx
(`nginx-app.conf`) renders from the Pod's environment when the container starts,
so the one image promoted from dev to prod reports under each environment's
name. Without that configuration (`npm run dev`, `vite preview`, e2e tests) it
sends nothing.

- **Real-user monitoring (Grafana Faro).** `FARO_URL` (deploy/base/rollout.yaml)
  points at the platform's Faro receiver, `https://faro.<platform domain>/collect`,
  and falls back to `https://faro.adhar.localtest.me/collect` when no platform
  domain is injected by the scaffolder.
  Every visit reports page loads, web vitals (LCP, INP, CLS, FCP, TTFB),
  JavaScript errors, fetch/XHR timings and browser traces, tagged with the app's
  name, version (package.json) and environment. Requests to this origin and to
  services of the same environment (`<svc>.<env>.<domain>`) carry a W3C
  `traceparent`, so a click in the browser and the backend's work appear as one
  trace in Tempo. The **Frontend** section of the app's Grafana dashboard
  (`/d/app-${{ values.name }}`) shows it all.
{%- if values.withAnalytics %}
- **Product analytics (PostHog).** On when the optional Secret
  `${{ values.name }}-posthog` exists in the environment's namespace (keys
  `api-key`: the environment's project key `phc_…`; `host`: where `/ingest`
  forwards to, e.g. `http://posthog-events.adhar-system.svc.cluster.local:8000`;
  optional `ui-host` and `session-replay: "true"`). Events go to `/ingest` on
  this origin and nginx forwards them without cookies or the visitor's address.
  Autocapture and page views (route changes included) are on, session replay is
  off unless `session-replay` is `"true"`, element text is masked, and Do Not
  Track, Global Privacy Control and `window.adharAnalytics.optOut()` stop it.
{%- endif %}

**Testing:** `npm run test:e2e` checks what the page sends when configured and
that it sends nothing when not; `npm run build && npm run test:nginx` runs
`nginx-app.conf` in a real nginx (Docker or Podman).
