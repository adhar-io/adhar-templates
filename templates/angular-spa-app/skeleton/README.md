# ${{ values.name }}

${{ values.description }}

An Angular single-page app pre-wired with the **Adhar UI** design system
(`@adhar-ui/angular` + Tailwind v4 preset + tokens), scaffolded by Adhar.

Built with the Angular CLI and served by nginx via Cloud Native Buildpacks, then
shipped through the platform's **secure supply chain**:

```
git push → buildpacks (ng build → nginx) → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

`@adhar-ui/angular` resolves from the in-cluster Gitea npm registry (see `.npmrc`).

## Local development

```sh
npm install
npm start
```

Access the deployed app at `https://${{ values.hostname }}:8443`.
