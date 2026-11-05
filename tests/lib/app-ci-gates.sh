#!/usr/bin/env bash
# app-ci-gates.sh <skeleton> <gate>...: run the skeleton's .devcontainer/app-ci.sh
# with stand-ins for gitleaks and trivy first on the PATH, then print every call
# they received, one per line, and "exit <app-ci.sh's exit code>". The test
# compares those calls with what app-ci itself runs (adhar-supply-chain
# 72-app-ci-stages.yaml). The gitleaks stand-in also checks what the real one
# needs before it can scan at all: a config file named *.toml (gitleaks picks
# the parser by the extension) holding the [extend] and [allowlist] tables.
# app-ci.sh's own output goes to stderr.
set -u
skeleton=$1
shift
stubs=$(mktemp -d) || exit 1
trap 'rm -f "$stubs/gitleaks" "$stubs/trivy" "$stubs/calls"; rmdir "$stubs"' EXIT
cat > "$stubs/gitleaks" << 'EOF'
#!/usr/bin/env bash
cfg=
for a in "$@"; do case $a in --config=*) cfg=${a#--config=} ;; esac; done
echo "gitleaks $*" >> "$CALLS"
case $cfg in
  *.toml) ;;
  *) echo "gitleaks stand-in: Unsupported Config Type: '$cfg' is not named *.toml" >&2; exit 2 ;;
esac
grep -q '^\[extend\]' "$cfg" && grep -q '^\[allowlist\]' "$cfg" || { echo "gitleaks stand-in: $cfg lacks [extend] or [allowlist]" >&2; exit 2; }
EOF
cat > "$stubs/trivy" << 'EOF'
#!/usr/bin/env bash
echo "trivy $*" >> "$CALLS"
EOF
chmod +x "$stubs/gitleaks" "$stubs/trivy"
CALLS="$stubs/calls" PATH="$stubs:$PATH" bash "$skeleton/.devcontainer/app-ci.sh" "$@" >&2
rc=$?
[ -f "$stubs/calls" ] && cat "$stubs/calls"
echo "exit $rc"
