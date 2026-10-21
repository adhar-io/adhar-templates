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

