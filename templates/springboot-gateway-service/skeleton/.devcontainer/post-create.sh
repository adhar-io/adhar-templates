#!/usr/bin/env bash
# Runs once when the development container is created (postCreateCommand), and
# any time after with:  bash .devcontainer/post-create.sh
#
# The SAME file in every application created from an Adhar template.
#
#   1. Compares this container's toolchain with the one the repository
#      declares, read exactly the way app-ci's detect-toolchain stage reads it,
#      so the editor, the CI tests and the buildpack build cannot drift apart
#      unnoticed.
#   2. Fetches dependencies the way app-ci's test stage resolves them, so the
#      first build in the editor does not start from nothing.
#   3. Lists the platform's tools on the PATH.
#
# It never fails the container: offline, or with the platform's registries out
# of reach, it says what it could not do and carries on.
set -uo pipefail
cd "${1:-.}" || exit 0

ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
# run <seconds> <what> <command...>: bounded, logged, never fatal.
run() {
  local limit=$1 what=$2 log rc
  shift 2
  log=$(mktemp "${TMPDIR:-/tmp}/post-create.XXXXXX")
  timeout "$limit" "$@" > "$log" 2>&1
  rc=$?
  if [ "$rc" = 0 ]; then
    ok "$what"
    rm -f "$log"
    return 0
  fi
  if [ "$rc" = 124 ]; then warn "$what: gave up after ${limit}s (full output: $log)"; else warn "$what failed (exit $rc, full output: $log)"; fi
  { grep -m 4 -E '(ERROR|ERR!|[Ee]rror:|FATAL|fatal:|denied|resolve|Could not|could not)' "$log" || tail -n 4 "$log"; } | cut -c1-200 | sed 's/^/      /'
  return 1
}

# ── 1. Toolchain ────────────────────────────────────────────────────────────
# The precedence of app-ci's detect-toolchain stage (adhar-supply-chain,
# 72-app-ci-stages.yaml): the buildpack's project.toml first, then the files
# each ecosystem declares a version in, then app-ci's own default.
bpenv() { # the value project.toml's [[build.env]] gives NAME
  [ -f project.toml ] || return 0
  awk -v n="$1" '$0 ~ "^[[:space:]]*name[[:space:]]*=[[:space:]]*\"" n "\"" {f=1; next} f && /^[[:space:]]*value/ {gsub(/.*=[[:space:]]*"?|"?[[:space:]]*$/, ""); print; exit}' project.toml || true
}
major() { sed -E 's/^[^0-9]*//; s/^(1\.)?([0-9]+).*/\2/'; }
minor() { sed -E 's/^[^0-9]*([0-9]+\.[0-9]+).*/\1/'; }
drift=0
check() { # check <tool> <declared> <where it is declared> <app-ci default> <in this container>
  local tool=$1 want=$2 where=$3 default=$4 have=$5
  if [ -z "$want" ]; then
    want=$default
    where="app-ci's default: the repository declares no $tool version"
  fi
  if [ "$want" = "$have" ]; then
    ok "$tool $have ($where)"
  else
    warn "$tool: $where says $want, this container has ${have:-none}."
    note "Set build.args.BASE_IMAGE in .devcontainer/devcontainer.json to the same version and rebuild the container."
    drift=1
  fi
}

echo "Toolchain (the version app-ci tests on and the image ships)"
if [ -f pom.xml ] || [ -f build.gradle ] || [ -f build.gradle.kts ]; then
  v=$(bpenv BP_JVM_VERSION) where="project.toml BP_JVM_VERSION"
  [ -z "$v" ] && [ -f .java-version ] && v=$(head -1 .java-version | major) where=.java-version
  [ -z "$v" ] && [ -f .sdkmanrc ] && v=$(sed -nE 's/^java=(.*)$/\1/p' .sdkmanrc | head -1 | major) where=.sdkmanrc
  [ -z "$v" ] && [ -f .tool-versions ] && v=$(sed -nE 's/^java[[:space:]]+(.*)$/\1/p' .tool-versions | head -1 | major) where=.tool-versions
  [ -z "$v" ] && [ -f pom.xml ] && v=$(sed -nE 's#.*<(java\.version|maven\.compiler\.release|maven\.compiler\.target)>[[:space:]]*([0-9.]+)[[:space:]]*</.*#\2#p' pom.xml | head -1 | major) where=pom.xml
  # A multi-module repository can declare it in its parent module.
  if [ -z "$v" ] && [ -f pom.xml ]; then
    for m in */pom.xml; do
      [ -f "$m" ] || continue
      v=$(sed -nE 's#.*<(java\.version|maven\.compiler\.release|maven\.compiler\.target)>[[:space:]]*([0-9.]+)[[:space:]]*</.*#\2#p' "$m" | head -1 | major) where=$m
      [ -z "$v" ] || break
    done
  fi
  check Java "$v" "$where" 25 "$(java -XshowSettings:properties -version 2>&1 | sed -nE 's/^[[:space:]]*java\.specification\.version = (.*)$/\1/p' | major)"
  if [ -f .mvn/wrapper/maven-wrapper.properties ]; then
    ok "Maven: the project's wrapper ($(sed -nE 's#.*apache-maven-([0-9.]+)-bin\.zip.*#\1#p' .mvn/wrapper/maven-wrapper.properties | head -1)), as app-ci uses it"
  elif [ -f pom.xml ]; then
    have=$(mvn -v 2> /dev/null | sed -nE '1s/^Apache Maven ([0-9.]+).*/\1/p')
    case "$have" in
      3.9.*) ok "Maven $have (app-ci builds with the 3.9 line when there is no wrapper)" ;;
      *) warn "Maven: app-ci builds with the 3.9 line, this container has ${have:-none}"; drift=1 ;;
    esac
  fi
fi
if [ -f package.json ]; then
  v=$(bpenv BP_NODE_VERSION | major) where="project.toml BP_NODE_VERSION"
  [ -z "$v" ] && [ -f .nvmrc ] && v=$(head -1 .nvmrc | major) where=.nvmrc
  [ -z "$v" ] && [ -f .node-version ] && v=$(head -1 .node-version | major) where=.node-version
  [ -z "$v" ] && [ -f .tool-versions ] && v=$(sed -nE 's/^nodejs[[:space:]]+(.*)$/\1/p' .tool-versions | head -1 | major) where=.tool-versions
  [ -z "$v" ] && v=$(sed -nE 's/.*"node"[[:space:]]*:[[:space:]]*"[^0-9]*([0-9]+).*/\1/p' package.json | head -1) where="package.json engines.node"
  check Node.js "$v" "$where" 24 "$(node -v 2> /dev/null | major)"
fi
if [ -f go.mod ]; then
  v=$(bpenv BP_GO_VERSION | minor) where="project.toml BP_GO_VERSION"
  [ -z "$v" ] && v=$(sed -nE 's/^go[[:space:]]+([0-9]+\.[0-9]+).*/\1/p' go.mod | head -1) where=go.mod
  check Go "$v" "$where" 1.24 "$(go env GOVERSION 2> /dev/null | minor)"
fi
if [ -f requirements.txt ] || [ -f pyproject.toml ] || [ -f .python-version ] || [ -f runtime.txt ]; then
  v=$(bpenv BP_CPYTHON_VERSION | minor) where="project.toml BP_CPYTHON_VERSION"
  [ -z "$v" ] && [ -f .python-version ] && v=$(head -1 .python-version | minor) where=.python-version
  [ -z "$v" ] && [ -f runtime.txt ] && v=$(sed -nE 's/^python-?([0-9]+\.[0-9]+).*/\1/p' runtime.txt | head -1) where=runtime.txt
  [ -z "$v" ] && [ -f pyproject.toml ] && v=$(sed -nE 's/^requires-python[[:space:]]*=[[:space:]]*"[^0-9]*([0-9]+\.[0-9]+).*/\1/p' pyproject.toml | head -1) where="pyproject.toml requires-python"
  check Python "$v" "$where" 3.12 "$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2> /dev/null)"
fi
if [ -f deno.json ] || [ -f deno.jsonc ]; then
  ok "Deno $(deno --version 2> /dev/null | sed -nE '1s/^deno ([^ ]+).*/\1/p') for development (the image runs the code on Node.js, checked above)"
fi

# ── 2. Dependencies ─────────────────────────────────────────────────────────
echo "Dependencies"
platform_registry_hint() { # <file>: the build resolves through the platform's in-cluster Nexus
  if [ -f "$1" ] && grep -q 'svc\.cluster\.local' "$1"; then
    note "$1 resolves through the platform's Nexus (nexus.adhar-system.svc.cluster.local), which only the"
    note "cluster can reach: in a Coder workspace it just works; elsewhere see \"Reaching the platform\" in .devcontainer/README.md."
  fi
}
if [ -f pom.xml ]; then
  S=()
  [ -f settings.xml ] && S=(-s settings.xml)
  # The project's own Maven when it ships a wrapper (run through sh: a scaffolded
  # repository's files carry no executable bit).
  MVN=(mvn)
  [ -f mvnw ] && MVN=(sh ./mvnw)
  # IntelliJ and VS Code import the project with ~/.m2/settings.xml: point it at
  # the repository's, unless this container already has one of its own.
  if [ -f settings.xml ] && [ ! -e "$HOME/.m2/settings.xml" ] && mkdir -p "$HOME/.m2" 2> /dev/null \
    && ln -s "$PWD/settings.xml" "$HOME/.m2/settings.xml" 2> /dev/null; then
    ok "$HOME/.m2/settings.xml -> settings.xml (the IDE resolves dependencies like the build)"
  fi
  run 900 "Maven dependencies (${MVN[*]} dependency:go-offline)" "${MVN[@]}" -B -q "${S[@]}" dependency:go-offline \
    || platform_registry_hint settings.xml
fi
has_npm_dependencies() { # package.json lists something to install (node decides; without node, try)
  command -v node > /dev/null || return 0
  node -e 'const p = require("./package.json"); process.exit(Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.optionalDependencies }).length ? 0 : 1)' 2> /dev/null
}
if [ -f pnpm-lock.yaml ] && command -v pnpm > /dev/null; then
  # A pnpm workspace: the lockfile says exactly what to install, and npm would
  # rewrite it into something else.
  run 900 "pnpm dependencies (pnpm install --frozen-lockfile)" pnpm install --frozen-lockfile || platform_registry_hint .npmrc
elif [ -f package.json ] && command -v npm > /dev/null && has_npm_dependencies; then
  if [ -f package-lock.json ]; then
    run 900 "npm dependencies (npm ci)" npm ci --no-audit --no-fund || platform_registry_hint .npmrc
  else
    # No lockfile committed yet: install without writing one, so creating the
    # container leaves your working tree exactly as it was.
    run 900 "npm dependencies (npm install --no-package-lock)" npm install --no-audit --no-fund --no-package-lock \
      || platform_registry_hint .npmrc
  fi
fi
if [ -f tsconfig.json ] && [ -f node_modules/typescript/package.json ] && command -v node > /dev/null; then
  # The editors are pointed at this copy (typescript.tsdk), not at the image's
  # global `tsc`: the project's own version is the one its build and tests use.
  ok "TypeScript $(node -p 'require("./node_modules/typescript/package.json").version') (the project's own: npx tsc, and the editor's language service)"
fi
if [ -f go.mod ]; then
  run 600 "Go modules (go mod download)" go mod download
fi
if [ -f requirements.txt ] || [ -f pyproject.toml ]; then
  # A project virtualenv in .venv, which VS Code, IntelliJ and uv all find on
  # their own; uv writes a .gitignore inside it, so git never sees it. pytest
  # too: app-ci runs the tests with it.
  if command -v uv > /dev/null; then
    run 120 "virtualenv .venv (uv venv)" env UV_PYTHON_DOWNLOADS=never uv venv --allow-existing --python "$(command -v python3)" .venv \
      && if [ -f requirements.txt ]; then
        run 900 "Python dependencies (requirements.txt + pytest)" uv pip install --python .venv/bin/python -r requirements.txt pytest
      else
        run 900 "Python dependencies (pyproject.toml + pytest)" uv pip install --python .venv/bin/python -e . pytest
      fi
  else
    # Python before 3.13 writes no .gitignore into the virtualenv: add the one
    # uv would, so `git status` never offers .venv for a commit.
    run 120 "virtualenv .venv (python3 -m venv)" python3 -m venv .venv \
      && { [ -e .venv/.gitignore ] || echo '*' > .venv/.gitignore; } \
      && if [ -f requirements.txt ]; then
        run 900 "Python dependencies (requirements.txt + pytest)" .venv/bin/pip install -q -r requirements.txt pytest
      else
        run 900 "Python dependencies (pyproject.toml + pytest)" .venv/bin/pip install -q -e . pytest
      fi
  fi
fi
if [ -f deno.json ] || [ -f deno.jsonc ]; then
  for entry in src/main.ts main.ts mod.ts; do
    if [ -f "$entry" ]; then
      run 300 "Deno modules (deno cache $entry)" deno cache "$entry"
      break
    fi
  done
fi

# ── 3. The platform's tools ─────────────────────────────────────────────────
echo "Tools"
version_of() {
  case $1 in
    adhar) adhar version 2> /dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 ;;
    kubectl) kubectl version --client 2> /dev/null | sed -nE '1s/^Client Version: //p' ;;
    helm) helm version --short 2> /dev/null ;;
    kustomize) kustomize version 2> /dev/null ;;
    trivy) trivy --version 2> /dev/null | sed -nE '1s/^Version: //p' ;;
    gitleaks) gitleaks version 2> /dev/null ;;
    docker) docker --version 2> /dev/null | sed -E 's/^Docker version ([^,]*).*/\1/' ;;
    psql) psql --version 2> /dev/null | sed -E 's/^psql \(PostgreSQL\) //' ;;
    valkey-cli) valkey-cli --version 2> /dev/null | sed -E 's/^valkey-cli //' ;;
    kcat) kcat -V 2> /dev/null | sed -nE 's/^Version ([^ ]+).*/\1/p' | head -1 ;;
    mvn) mvn -v 2> /dev/null | sed -nE '1s/^Apache Maven ([0-9.]+).*/\1/p' ;;
    pnpm) pnpm --version 2> /dev/null ;;
    tsc) tsc --version 2> /dev/null | sed -E 's/^Version //' ;;
    tsx) tsx --version 2> /dev/null | sed -nE '1s/^tsx v?//p' ;;
    uv) uv --version 2> /dev/null | sed -E 's/^uv //' ;;
    ruff) ruff --version 2> /dev/null | sed -E 's/^ruff //' ;;
    deno) deno --version 2> /dev/null | sed -nE '1s/^deno ([^ ]+).*/\1/p' ;;
    gopls) gopls version 2> /dev/null | sed -nE '1s/.*gopls (v[^ ]+).*/\1/p' ;;
    golangci-lint) golangci-lint --version 2> /dev/null | sed -nE '1s/.*version ([^ ]+).*/\1/p' ;;
    *) echo present ;;
  esac
}
for t in git adhar kubectl helm kustomize trivy gitleaks docker psql valkey-cli kcat mvn pnpm tsc tsx uv ruff deno gopls golangci-lint; do
  command -v "$t" > /dev/null && ok "$t $(version_of "$t")"
done
if command -v docker > /dev/null && ! timeout 10 docker version > /dev/null 2>&1; then
  warn "docker: no engine answers (in a Coder workspace there is none; on your machine, start Docker)."
fi
echo "Run app-ci's checks before you push:  bash .devcontainer/app-ci.sh"
[ "$drift" = 0 ] || warn "The toolchain does not match the repository; see above."
exit 0
