#!/usr/bin/env bash
# Tests nginx-i18n.conf — /i18n/<language>.json proxied to Tolgee with the
# built-in translations as the fallback — in a real nginx, against a stand-in
# Tolgee (mock-tolgee.mjs). Needs Docker or Podman (CONTAINER_CLI=podman) and a
# production build in dist/:
#
#   npm run build && npm run test:nginx
#
# It renders the file the way the nginx buildpack does at container start
# (render.mjs), starts nginx with the server block the buildpack generates
# (nginx.conf) and checks: no Tolgee configured, Tolgee answering, Tolgee
# erroring, slow, unreachable, and a language nobody has.
set -euo pipefail
cd "$(dirname "$0")/../.."
CLI=${CONTAINER_CLI:-docker}
WEB_ROOT=${WEB_ROOT:-dist}
NGINX_IMAGE=${NGINX_IMAGE:-nginx:1.31-alpine}
NODE_IMAGE=${NODE_IMAGE:-node:22-alpine}
PORT=${NGINX_TEST_PORT:-18090}
NET=i18n-test-$$
WORK=$(mktemp -d)
failures=0

[ -f "$WEB_ROOT/i18n/en.json" ] || { echo "no $WEB_ROOT/i18n/en.json — run the production build first" >&2; exit 2; }

cleanup() {
  $CLI rm -f "$NET-nginx" "$NET-tolgee" >/dev/null 2>&1 || true
  $CLI network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

$CLI network create "$NET" >/dev/null
$CLI run -d --name "$NET-tolgee" --network "$NET" -v "$PWD/e2e/nginx:/mock:ro" "$NODE_IMAGE" node /mock/mock-tolgee.mjs >/dev/null

# Start nginx with the include rendered from the given environment.
# A fresh directory per start: Docker Desktop can keep serving a bind mount's
# old contents when the same path is deleted and recreated.
starts=0
start_nginx() {
  $CLI rm -f "$NET-nginx" >/dev/null 2>&1 || true
  starts=$((starts + 1))
  local ws="$WORK/ws$starts"
  mkdir -p "$ws/$WEB_ROOT"
  cp -R "$WEB_ROOT/." "$ws/$WEB_ROOT/"
  sed "s#WEB_ROOT#$WEB_ROOT#" e2e/nginx/nginx.conf > "$ws/nginx.conf"
  env -i PATH="$PATH" "$@" node e2e/nginx/render.mjs nginx-i18n.conf > "$ws/nginx-i18n.conf"
  $CLI run -d --name "$NET-nginx" --network "$NET" -p "127.0.0.1:$PORT:8080" -v "$ws:/workspace:ro" \
    "$NGINX_IMAGE" nginx -p /workspace -c /workspace/nginx.conf >/dev/null
  for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && return 0; sleep 0.2; done
  $CLI logs "$NET-nginx"; echo "nginx did not start" >&2; exit 1
}

tolgee_mode() { $CLI exec "$NET-tolgee" wget -q -O /dev/null --post-data= "http://localhost:8085/__mode/$1"; }

# check <description> <path> <expected status> <expected X-Translations-Source> [text the body must contain]
check() {
  local desc=$1 path=$2 status=$3 source=$4 body=${5:-}
  local got got_source
  got=$(curl -s -m 15 -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' -H 'Cookie: session=secret' "http://127.0.0.1:$PORT$path")
  got_source=$(tr -d '\r' < "$WORK/headers" | sed -n 's/^[Xx]-[Tt]ranslations-[Ss]ource: //p')
  if [ "$got" = "$status" ] && [ "$got_source" = "$source" ] && { [ -z "$body" ] || grep -qF "$body" "$WORK/body"; }; then
    echo "ok   $desc"
  else
    echo "FAIL $desc: status $got (want $status), source '$got_source' (want '$source')"; head -c 300 "$WORK/body"; echo
    failures=$((failures + 1))
  fi
}

BUILT_IN_EN=$(node -e "console.log(require('./src/i18n/en.json')['features.heading'])")

echo "# no Tolgee configured"
start_nginx
check "serves the built-in English" /i18n/en.json 200 bundled "$BUILT_IN_EN"
check "a language with no file is 404" /i18n/xx.json 404 bundled
check "anything else under /i18n is 404" /i18n/en.txt 404 ""
check "the app still answers /" / 200 ""

echo "# Tolgee configured"
TOLGEE=(TOLGEE_API_URL="http://$NET-tolgee:8085" TOLGEE_PROJECT_ID=7 TOLGEE_API_KEY=tgpak_test NGINX_RESOLVER=127.0.0.11)
[ "$CLI" = podman ] && TOLGEE[3]=NGINX_RESOLVER=$($CLI network inspect "$NET" -f '{{(index .Subnets 0).Gateway}}')
start_nginx "${TOLGEE[@]}"
tolgee_mode ok
check "proxies to Tolgee's export" /i18n/en.json 200 tolgee "From Tolgee (en)"
last=$($CLI exec "$NET-tolgee" wget -q -O- http://localhost:8085/__last)
if grep -q '"x-api-key":"tgpak_test"' <<<"$last" && ! grep -qi 'cookie' <<<"$last" \
  && grep -q 'export?languages=en&format=JSON&zip=false&structureDelimiter=' <<<"$last"; then
  echo "ok   sends the key and the flat-JSON export query, and no browser cookie"
else
  echo "FAIL request to Tolgee: $last"; failures=$((failures + 1))
fi
grep -qi '^content-disposition' "$WORK/headers" && { echo "FAIL Tolgee's attachment header reached the browser"; failures=$((failures + 1)); } || echo "ok   hides Tolgee's attachment and cookie headers"
tolgee_mode error
check "Tolgee 500 falls back to the built-in copy" /i18n/en.json 200 bundled "$BUILT_IN_EN"
tolgee_mode unknown-language
check "a language Tolgee lacks but the image has" /i18n/en.json 200 bundled "$BUILT_IN_EN"
check "a language neither has is 404" /i18n/xx.json 404 bundled
tolgee_mode slow
check "a Tolgee that does not answer in time falls back" /i18n/en.json 200 bundled "$BUILT_IN_EN"
tolgee_mode ok
$CLI stop "$NET-tolgee" >/dev/null
check "an unreachable Tolgee falls back" /i18n/en.json 200 bundled "$BUILT_IN_EN"

echo "# a wrong key"
$CLI start "$NET-tolgee" >/dev/null
start_nginx "${TOLGEE[@]/tgpak_test/tgpak_wrong}"
check "Tolgee refusing the key falls back" /i18n/en.json 200 bundled "$BUILT_IN_EN"

[ "$failures" -eq 0 ] && echo "all nginx /i18n checks passed" || { echo "$failures check(s) failed"; exit 1; }
