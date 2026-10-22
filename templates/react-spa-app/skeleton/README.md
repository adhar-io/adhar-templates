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
origin. nginx (`nginx-i18n.conf`) proxies it to Tolgee's export API with a
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
`nginx-i18n.conf` in a real nginx against a stand-in Tolgee (Docker or Podman).
{%- else %}

Localisation was turned off when this app was scaffolded, so there is one
language and no Tolgee project. The string table still keeps the texts out of
the components.
{%- endif %}
