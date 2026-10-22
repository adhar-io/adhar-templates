# ${{ values.name }}

${{ values.description }}

An Angular single-page app pre-wired with the **Adhar UI** design system
(`@adhar-ui/angular` + Tailwind v4 preset + tokens), scaffolded by Adhar.

Built with the Angular CLI and served by nginx via Cloud Native Buildpacks, then
shipped through the platform's **secure supply chain**:

```text
git push → buildpacks (ng build → nginx) → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

`@adhar-ui/angular` resolves from the in-cluster Gitea npm registry (see `.npmrc`).

## Adhar UI in Angular

`@adhar-ui/angular` ships its styles as variant functions. Compose them into a
class string and bind it:

```ts
protected readonly primary = buttonVariants({ size: 'lg' });
```

```html
<a href="#get-started" [class]="primary">Get started</a>
```

The Adhar brand theme (light and dark colors, radius, the logo gradient) lives in
`src/styles.css`. Change it there and every variant follows.

```text
src/
├── index.html               # applies the saved/system theme before first paint
├── styles.css               # Tailwind v4 + Adhar UI preset + Adhar brand theme
└── app/
    ├── app.component.ts     # landing page built from Adhar UI variants
    └── icon.component.ts    # inline line icons
public/adhar-symbol.svg
```

## Local development

```sh
npm install
npm start
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

Every user-visible string is a key in `src/i18n/<language>.json`, shown with the
`translate` pipe (`src/app/i18n.ts`). `en.json` holds the source text — add new
keys there.
{%- if values.withLocalisation %}

Texts are managed in [Tolgee](https://tolgee.io) with `@tolgee/ngx`; the
platform created a Tolgee project for this app — declared in `.adhar/app.yaml`
(`spec.parameters.localisation`) — with the languages `${{ values.languages }}`.

**At runtime** the browser loads `/i18n/<language>.json` from the app's own
origin. nginx (`nginx-app.conf`) proxies it to Tolgee's export API with a
read-only key from the Secret `${{ values.name }}-tolgee` (`TOLGEE_API_URL`,
`TOLGEE_PROJECT_ID`, `TOLGEE_API_KEY`), so a translator's change is live within
a minute without a release, and the key never reaches the browser. Without the
Secret, or when Tolgee errors or is slow, nginx serves the copy built into the
image (`i18n/` in the build output, copied from `src/i18n/` by `angular.json`);
if even that request fails, the app uses the English copy bundled into its
JavaScript. A key missing in a language falls back to English.

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
file, and adding the tag to `LANGUAGES` in `src/app/i18n.ts` puts it in the
language switcher.

**Editing in place while developing:** under `npm start` (`ng serve`), Alt +
click any text to edit it in Tolgee. The credentials come from the
Tolgee Tools browser
extension (enter the Tolgee URL and an API key that may edit translations), so
no key is ever written into the code. A production build does not contain the
in-context tools (`angular.json` resolves `@tolgee/web`'s production entry).

**Testing:** `npm run test:e2e` covers runtime texts, switching language and the
fallback when `/i18n` fails; `npm run build && npm run test:nginx` runs
`nginx-app.conf` in a real nginx against a stand-in Tolgee (Docker or Podman).
{%- else %}

Localisation was turned off when this app was scaffolded, so there is one
language and no Tolgee project. The string table still keeps the texts out of
the templates.
{%- endif %}

## Telemetry

The page reports to the platform on its own; nothing is configured in the code.
What it sends is decided at runtime by `GET /runtime-config.json`, which nginx
(`nginx-app.conf`) renders from the Pod's environment when the container starts,
so the one image promoted from dev to prod reports under each environment's
name. Without that configuration (`ng serve`, e2e tests) it
sends nothing.

- **Real-user monitoring (Grafana Faro).** `FARO_URL` (deploy/base/rollout.yaml)
  points at the platform's Faro receiver, `https://faro.<platform domain>/collect`.
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
