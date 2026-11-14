# Template tests

The checks that hold every template to the
[template standards](../README.md#template-standards). They need only
[Deno](https://deno.com) 2 and `git`; the first run downloads the four
libraries pinned in `deno.json` (and `deno.lock`) into Deno's cache, never
into this repository.

```bash
cd tests
deno task test        # offline: every template, every check below
deno task test:net    # the editor ids against the VS Code Marketplace, Open VSX and the JetBrains Marketplace
```

`deno task test` fails when a template:

- has a directory under `templates/` with files but no `template.yaml` (the
  Console and the CLI list a template by its `template.yaml`);
- lacks `.devcontainer/devcontainer.json`, the shared `.devcontainer/` files,
  `.vscode/extensions.json` or `.idea/externalDependencies.xml`, or its copy of
  a shared file differs from the others;
- uses template syntax in those files that the platform's scaffolders cannot
  render (they drop such a file without telling anyone), or a `values.<key>`
  its `template.yaml` does not pass to the skeleton;
- keeps one of them out of git (a skeleton `.gitignore` applies to this
  repository too, and an ignored file never reaches the mirror the scaffolders
  read);
- renders a `devcontainer.json` (form defaults, every option on, every option
  off) that is not valid JSONC against the Dev Container schema
  (`schemas/`, from devcontainers/spec and microsoft/vscode);
- runs a toolchain other than the one the repository declares, read the way
  app-ci's `detect-toolchain` reads it (project.toml `BP_*_VERSION`,
  `.java-version`, `.nvmrc`, `package.json` `engines.node`, `go.mod`,
  `.python-version`, the POM, then app-ci's default), or a container family
  other than the test runner app-ci picks;
- misses the platform's tools, runs as root, sends telemetry elsewhere, does
  not forward the application's port, or installs a backing-service client
  the application was not created with;
- hands the host's Docker engine to an application that does not need one, or
  needs one (Testcontainers, `compose.yaml`) without the
  `TESTCONTAINERS_HOST_OVERRIDE` that lets Testcontainers reach it;
- lets `.devcontainer/compose.yaml` and `compose.yaml` name different services;
- lists different extensions in `devcontainer.json` and
  `.vscode/extensions.json`, or different plugins in `devcontainer.json` and
  `.idea/externalDependencies.xml`, misses the cross-cutting ones or the
  language's own, or uses an id that `editor-ids.json` does not record;
- is a TypeScript project whose editor does not use the project's own
  TypeScript, or whose container has no `tsx`;
- serves HTTP — a `service` Component with a `deploy/base/httproute.yaml`, or
  a `function` — without `api/openapi.yaml`, or without publishing it from
  `catalog-info.yaml` as a `kind: API` entity (`<name>-api`, its
  `definition.$text` naming the file, the same owner and lifecycle as the
  Component, which `providesApis` it), or with a contract that does not render,
  every way, to an OpenAPI 3 document titled after the application and served
  from its host (`api_contract_test.ts`). The Console registers that entity
  under Design → API & Spec when the application is created.
- is of the batch family (the label `adhar.io/workload: batch`, a
  `springboot-batch-*` name or the `batch` tag, as the Console reads it) and
  does not deploy a `BatchJob`: `deploy/base/batchjob.yaml` naming a job bean
  the sources declare, the application's `:latest` Harbor image and the
  `<Database>-app` Secret of its `deploy/base/database.yaml`;
  `deploy/base/kustomizeconfig.yaml` telling kustomize (and so Kargo's
  kustomize-set-image) that a BatchJob keeps its image at
  `spec/parameters/image`; and `deploy/envs/{dev,test,prod}` with the
  namespace, the Kargo-owned `images:` block, the schedule suspended in dev
  and `priority: critical` in prod — or ships a CronJob, Service, HPA, PDB,
  RBAC, PodMonitor or PrometheusRule of its own, which the platform composes
  from the BatchJob (`batch_deploy_test.ts`). An Application syncs the
  kustomize build of `deploy/envs/<env>`, so a batch skeleton with a raw
  CronJob and no overlays deployed nothing while reporting Healthy.
- is a partitioned batch template (`mode: partitioned`; there must be one,
  `springboot-batch-partitioned`) whose `workers` and `gridSize` do not come
  from the form or fall outside the XRD's bounds, whose POM lacks
  `spring-batch-integration` or `spring-integration-jdbc` (every worker pod
  would exit 2), whose job's `RemotePartitioning.manager(…)` names a worker
  step that is not a `@ConditionalOnBatchRole(BatchRole.WORKER)` bean (or
  whose job bean, or a `@StepScope` bean outside that role, is conditional
  the wrong way), that sets `ADHAR_BATCH_*` under the BatchJob's `env`, or
  that has no `PartitionedJobIT` starting its pods through
  `AdharBatchApplication.run`; and a single-pod batch template that sets
  `workers` or `gridSize` (`batch_deploy_test.ts`).

It also runs the shared `app-ci.sh` with stand-ins for `gitleaks` and `trivy`
(`lib/app-ci-gates.sh`) and fails when its scanner gates stop calling them the
way app-ci's `gitleaks-scan` and `source-scan` stages do: the working tree
rather than history, a `gitleaks.toml` config (gitleaks reads the format from
the file name), app-ci's skip list and the `HIGH,CRITICAL` threshold.

`editor-ids.json` is the list of extension and plugin ids a template may use,
with the versions each registry showed when it was last checked.
`deno task test:net` checks every entry again: VS Code extensions must be on
the VS Code Marketplace (VS Code and Dev Containers install from it) **and**
on Open VSX (code-server installs from it, and the two catalogues differ);
IntelliJ plugins must be on the JetBrains Marketplace. Add an id there only
after `deno task test:net` passes with it.

`lib/render.ts` is the template syntax both scaffolders implement — the
Console's `template-render.ts` and the CLI's `cmd/apps/scaffold.go` — and
nothing more.
