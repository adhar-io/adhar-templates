# Development container

This folder describes the environment the application is developed in: the
language toolchain at the version the repository declares, the platform's
command-line tools, and the editor extensions and IDE plugins, all installed
when the container is created. VS Code, IntelliJ IDEA, GitHub Codespaces and
the `devcontainer` CLI build it from the same files.

| File | What it is |
| --- | --- |
| `devcontainer.json` | What is specific to this application: the toolchain image, the features, the clients for its backing services, forwarded ports, editor extensions and IntelliJ plugins |
| `Dockerfile` | Only what no Dev Container Feature can install: app-ci's scanners, the Adhar CLI, kustomize, the clients |
| `post-create.sh` | Runs once when the container is created: checks the toolchain, fetches dependencies |
| `app-ci.sh` | Runs app-ci's gates on your working tree |
| `compose.yaml` | Only next to a `compose.yaml` in the repository root: runs those services in this container's network |

`Dockerfile`, `post-create.sh`, `app-ci.sh` and this README are the same in every
application created from an Adhar template, and in adhar-kit and adhar-ui.

## Open it

- **VS Code**: install the *Dev Containers* extension, then *Dev Containers:
  Reopen in Container*. The extensions in `customizations.vscode` are
  installed into the container. Opened without a container, VS Code offers the
  same list from `../.vscode/extensions.json`.
- **IntelliJ IDEA**: open `devcontainer.json` and choose *Create Dev Container
  and Mount Sources*, or *Remote Development → Dev Containers*. The plugins in
  `customizations.jetbrains` are installed into the IDE in the container.
  Opened without a container, IntelliJ asks to install the plugins listed in
  `../.idea/externalDependencies.xml`.
- **A Coder workspace** (the platform's Cloud Development Environment): nothing
  to do. Open the repository from the Console; see below.
- **Command line**: `npx @devcontainers/cli up --workspace-folder .`

## In a Coder workspace

A workspace opened on this repository builds this container and runs in it, with
no Docker daemon ([envbuilder](https://github.com/coder/envbuilder)). The first
start takes as long as the build; later ones replay it from a layer cache on the
workspace's home volume. `/home/coder` is that volume, and it is also your home
directory whichever user the container runs as, so `~/.m2`, `node_modules`, your
git identity and your editors survive a stop.

- **Editors**: code-server installs the extensions in `customizations.vscode`
  from Open VSX (every one is published there as well as on the VS Code
  Marketplace) and applies `customizations.vscode.settings`. VS Code Desktop gets
  them from the Marketplace the first time it connects. IntelliJ IDEA gets the
  plugins in `customizations.jetbrains` the first time its backend starts, and
  they take effect when it next restarts; until then it offers them from
  `../.idea/externalDependencies.xml`.
- **`post-create.sh`** runs once per version of `.devcontainer`, after the editors
  are reachable. Its output is in the Coder dashboard, under the workspace's agent
  logs. Your git push credentials are available to it.
- **The platform's libraries**: `~/.m2/settings.xml` and `~/.npmrc` resolve
  `adhar-kit` and `@adhar-ui` through the platform's Nexus, read anonymously, with
  no credential in the workspace or in this repository.
- **If the build fails** the workspace still opens, on a plain image without this
  toolchain, with the reason in `DEVCONTAINER-FAILED.md` at the top of the folder,
  in the dashboard's "Dev container" row and in each new terminal. Fix it, push or
  edit, and restart the workspace: every start tries again.
- **What does not apply there**: `forwardPorts` (use Coder's port forwarding or
  code-server's), `runArgs` and `mounts`, and anything that needs a Docker engine.
  The `docker` command is installed but nothing answers it, so run `mvn test`
  rather than Testcontainers' `mvn verify`, and let app-ci run the integration
  tests.

## What is installed

| Tool | Version | Where it comes from |
| --- | --- | --- |
| Language toolchain | `build.args.BASE_IMAGE` | The official Dev Containers image for the version the repository declares (`project.toml` `BP_*_VERSION`, `package.json` `engines.node`, `go.mod`, `.python-version`, the POM): the version app-ci tests on and the image ships |
| Build and test tools | | Maven 3.9 (the line app-ci builds with; `./mvnw` when the project has one); npm, pnpm, `tsx` and the project's own TypeScript (`npx tsc`); uv, Ruff and pytest; gopls, Delve and golangci-lint; Deno |
| `adhar` | latest release | The platform CLI, for this container's architecture (`ADHAR_VERSION` in the `Dockerfile` holds one back) |
| `kubectl`, `helm` | latest stable | The `kubectl-helm-minikube` feature (minikube itself is not installed; the feature still mounts an empty `minikube-config` volume, shared by every container that uses it) |
| `kustomize` | 5.8.1 | The version Argo CD renders `deploy/` with: `kustomize build deploy/envs/dev` is what Argo CD applies |
| `trivy` 0.58.1, `gitleaks` 8.21.2 | app-ci's | Copied out of the images app-ci scans with |
| `docker`, `docker compose` | latest | Only where the application needs an engine (Testcontainers, `compose.yaml`): the *host's* engine, through the `docker-outside-of-docker` feature. Never Docker-in-Docker |
| `psql`, `valkey-cli`, `kcat` | Debian's | Only for the database, cache or Kafka the application was created with |

When the container is created, `post-create.sh` compares the toolchain with
what the repository declares, exactly the way app-ci reads it, and fetches the
dependencies (`mvn dependency:go-offline`, `npm ci`, `go mod download`, a
`.venv` with uv). It never fails the container: offline, it says what it could
not do. Run it again any time: `bash .devcontainer/post-create.sh`.

The first build writes `devcontainer-lock.json` next to `devcontainer.json`:
the exact versions of the features it installed. Commit it, and everyone
builds the same container; delete it to move to the features' newest
releases.

## Before you push

```bash
bash .devcontainer/app-ci.sh           # tests, secrets, dependencies, manifests, e2e
bash .devcontainer/app-ci.sh secrets   # one gate
```

Each gate runs the command app-ci runs, with the same scanner versions, skip
lists and severity threshold (`HIGH,CRITICAL`). Waivers approved in the
Console, the image scan and the signature happen on the platform after you push.

## Changing the toolchain

Change the version where the repository declares it **and** `BASE_IMAGE` in
`devcontainer.json`, then rebuild the container. `post-create.sh` warns when the
two differ, and the template tests refuse a template whose container and
repository disagree.

## Reaching the platform

- **Kubernetes**: `kubectl` and `adhar` read `~/.kube/config`, which the
  container does not bring along. Copy a kubeconfig in, or mount yours by
  adding to `devcontainer.json`:
  `"mounts": ["source=${localEnv:HOME}/.kube,target=/home/vscode/.kube,type=bind"]`
  (the folder must exist; Node.js containers use `/home/node/.kube`). A local
  `adhar up` cluster listens on the host's `127.0.0.1`, which is not the
  container's: `docker network connect kind <container>` and point the
  kubeconfig's `server` at `https://adhar-control-plane:6443`.
- **Nexus**: `settings.xml` and `.npmrc` resolve the platform's own libraries
  through `nexus.adhar-system.svc.cluster.local`, which only the cluster can
  resolve: a Coder workspace just works. From your machine, run
  `kubectl -n adhar-system port-forward svc/nexus 8081:8081` on the host and add
  `"--add-host=nexus.adhar-system.svc.cluster.local:host-gateway"` to `runArgs`
  in `devcontainer.json` (on Linux, port-forward with `--address 0.0.0.0`).
- **Telemetry**: the container points OpenTelemetry at the platform's
  collector, `http://alloy.adhar-system.svc.cluster.local:4318`, the endpoint
  the deployed application uses, and marks what it sends
  `deployment.environment=local`, so a run from here shows up in Grafana
  without being mistaken for dev, test or prod. On your machine, run
  `kubectl -n adhar-system port-forward svc/alloy 4318:4318` and set
  `OTEL_EXPORTER_OTLP_ENDPOINT` to `http://localhost:4318` in a terminal or in
  `containerEnv`.
- **Backing services (`compose.yaml`)**: `docker compose up -d` inside the
  container starts them on the host's engine but in the container's own
  network, so the application's `localhost` defaults reach them as they do on
  a laptop. After rebuilding the container: `docker compose up -d --force-recreate`.
- **Testcontainers**: `mvn verify` starts its containers on the host's engine
  (Docker Desktop, or Docker on Linux). Their ports are published on the
  *host*, so `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` (with the
  `--add-host` in `runArgs`, for engines that do not define that name) tells
  Testcontainers to reach them there rather than at the container network's
  gateway, where Docker Desktop does not listen. Podman users: enable Podman's
  Docker compatibility socket (`/var/run/docker.sock`) first. Where there is
  no engine at all, run `mvn test` and let app-ci run the integration tests.
