#!/usr/bin/env bash
# app-ci's gates, on your working tree, before you push:
#
#   bash .devcontainer/app-ci.sh                    # every gate
#   bash .devcontainer/app-ci.sh secrets deps       # some of: tests secrets deps manifests e2e
#
# The SAME file in every application created from an Adhar template (no array
# lengths: an opening brace before a hash starts a Nunjucks comment). Each gate
# runs the command the matching app-ci stage runs (adhar-supply-chain
# 72-app-ci-stages.yaml: test-auto, gitleaks-scan, source-scan,
# e2e-playwright), with the scanners copied out of the images app-ci uses, the
# same skip lists and the platform's default threshold (HIGH,CRITICAL). What
# app-ci adds on top needs the platform and happens when you push: waivers
# approved in the Console, the image scan, the SBOM and the signature.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
gates=${*:-tests secrets deps manifests e2e}
SEVERITY=${SEVERITY:-HIGH,CRITICAL}
failed=()
gate() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
result() {
  if [ "$2" = 0 ]; then printf '\033[32m✓ %s\033[0m\n' "$1"; else
    printf '\033[31m✗ %s\033[0m\n' "$1"
    failed+=("$1")
  fi
}
npm_install() { # what app-ci does before npm test, without writing a lockfile you did not commit
  if [ -f pnpm-lock.yaml ]; then
    pnpm install --frozen-lockfile
    return
  fi
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund --no-package-lock; fi
}

for g in $gates; do
  case $g in
  tests)
    # test-auto: the runner is chosen by the files present, in this order.
    gate "tests (test-auto)"
    rc=0
    if [ -f pom.xml ]; then
      S=()
      [ -f settings.xml ] && S=(-s settings.xml)
      MVN=(mvn)
      [ -f mvnw ] && MVN=(sh ./mvnw)
      # verify, not test: the integration tests (*IT, failsafe) run too.
      "${MVN[@]}" -B -q "${S[@]}" verify || rc=$?
    elif [ -f gradlew ] || [ -f build.gradle ] || [ -f build.gradle.kts ]; then
      if [ -f gradlew ]; then sh ./gradlew --no-daemon -q test || rc=$?; else
        echo "no gradlew wrapper: app-ci cannot run the tests reproducibly" >&2
        rc=1
      fi
    elif [ -f package.json ]; then
      { [ -d node_modules ] || npm_install; } && npm test --if-present || rc=$?
    elif [ -f go.mod ]; then
      { go vet ./... && go test ./...; } || rc=$?
    elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
      PY=python3
      [ -x .venv/bin/python ] && PY=.venv/bin/python
      "$PY" -m pytest -q
      rc=$?
      [ "$rc" = 5 ] && rc=0 # 5: no tests collected
    else
      echo "no test runner detected"
    fi
    result tests "$rc"
    ;;
  secrets)
    # gitleaks-scan: the repository's own code; its .gitleaks.toml is extended
    # and its .gitleaksignore honoured.
    gate "committed secrets (gitleaks-scan)"
    # gitleaks picks the config's format from its file extension, so the file
    # is gitleaks.toml (app-ci writes /tmp/gitleaks.toml), in a private directory.
    if ! tmp=$(mktemp -d); then
      result secrets 1
      continue
    fi
    cfg="$tmp/gitleaks.toml"
    if [ -f .gitleaks.toml ]; then base="path = \"$(pwd)/.gitleaks.toml\""; else base="useDefault = true"; fi
    cat > "$cfg" << EOF
[extend]
${base}

[allowlist]
description = "Not the repository's own code: VCS metadata, dependencies, build output"
paths = [
  '''(^|/)\.git/''',
  '''(^|/)node_modules/''',
  '''(^|/)(vendor|third_party)/''',
  '''(^|/)(dist|build|out|target|coverage|generated|\.next|\.nuxt|\.svelte-kit|\.angular|\.cache)/''',
  '''(^|/)(\.venv|venv|__pycache__|\.tox)/''',
]
EOF
    gitleaks detect --source=. --no-git --no-banner --redact --verbose --config="$cfg" --exit-code=1
    rc=$?
    rm -f "$cfg"
    rmdir "$tmp"
    [ "$rc" = 0 ] || echo "A real secret: remove it and ROTATE it. A false positive: add its Fingerprint line to .gitleaksignore."
    result secrets "$rc"
    ;;
  deps)
    # source-scan, dependency half: what the lockfiles say the application
    # ships. The first run downloads trivy's vulnerability database.
    gate "dependency vulnerabilities (source-scan, fails on $SEVERITY)"
    SKIP='node_modules,**/node_modules,dist,**/dist,target,**/target,.git,**/.git,generated,**/generated,.venv,**/.venv'
    trivy fs --scanners vuln --severity "$SEVERITY" --exit-code 1 --skip-dirs "$SKIP" --timeout 20m --no-progress .
    result dependencies $?
    ;;
  manifests)
    # source-scan, manifest half: what Argo CD will apply.
    gate "manifest misconfigurations (source-scan, fails on $SEVERITY)"
    found=()
    for d in deploy manifests k8s kubernetes; do [ -d "$d" ] && found+=("$d"); done
    if [ -z "${found[*]-}" ]; then
      echo "no Kubernetes manifests in the repository; nothing to check"
      rc=0
    else
      trivy config -q --severity "$SEVERITY" --exit-code 1 --timeout 20m "${found[@]}"
      rc=$?
    fi
    result manifests "$rc"
    ;;
  e2e)
    # e2e-playwright: only when the repository ships a Playwright suite, which
    # builds and serves the production build itself.
    cfg=$(ls e2e/playwright.config.* 2> /dev/null | head -n 1)
    [ -n "$cfg" ] || continue
    gate "end-to-end (e2e-playwright)"
    rc=0
    [ -d node_modules ] || npm_install || rc=$?
    # The browser that matches the project's @playwright/test, downloaded once.
    [ "$rc" = 0 ] && { npx --no-install playwright install --with-deps chromium > /dev/null || rc=$?; }
    if [ "$rc" = 0 ]; then
      if npm run 2> /dev/null | grep -q '^  test:e2e$'; then CI=true npm run test:e2e || rc=$?; else CI=true npx playwright test -c "$cfg" || rc=$?; fi
    fi
    result e2e "$rc"
    ;;
  *)
    echo "unknown gate '$g' (tests, secrets, deps, manifests, e2e)" >&2
    exit 2
    ;;
  esac
done

echo
if [ -z "${failed[*]-}" ]; then echo "All gates passed."; else
  echo "Failed: ${failed[*]}"
  exit 1
fi
