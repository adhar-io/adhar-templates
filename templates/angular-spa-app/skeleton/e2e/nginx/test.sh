#!/usr/bin/env bash
# Tests nginx-app.conf in a real nginx: /runtime-config.json rendered from the
# Pod's environment{% if values.withAnalytics %}, /ingest/ forwarding to PostHog (a stand-in,
# mock-posthog.mjs){% endif %}{% if values.withLocalisation %} and /i18n/<language>.json proxied to Tolgee with the
# built-in translations as the fallback (against mock-tolgee.mjs){% endif %}{% if values.withCms %} and /cms/ + /uploads/ proxied read-only to
# Strapi (against mock-strapi.mjs){% endif %}. Needs Docker
# or Podman (CONTAINER_CLI=podman) and a production build (ng build):
#
#   npm run build && npm run test:nginx
#
# It renders the file the way the nginx buildpack does at container start
# (render.mjs) and starts nginx with the server block the buildpack generates
# (nginx.conf).
set -euo pipefail
cd "$(dirname "$0")/../.."
CLI=${CONTAINER_CLI:-docker}
WEB_ROOT=${WEB_ROOT:-dist/${{ values.name }}/browser}
NGINX_IMAGE=${NGINX_IMAGE:-nginx:1.31-alpine}
NODE_IMAGE=${NODE_IMAGE:-node:22-alpine}
PORT=${NGINX_TEST_PORT:-18090}
NET=nginx-test-$$
WORK=$(mktemp -d)
failures=0

[ -f "$WEB_ROOT/index.html" ] || { echo "no $WEB_ROOT/index.html — run the production build first" >&2; exit 2; }
{%- if values.withLocalisation %}
[ -f "$WEB_ROOT/i18n/en.json" ] || { echo "no $WEB_ROOT/i18n/en.json — run the production build first" >&2; exit 2; }
{%- endif %}

cleanup() {
  $CLI rm -f "$NET-nginx" "$NET-tolgee" "$NET-posthog"{% if values.withCms %} "$NET-strapi"{% endif %} >/dev/null 2>&1 || true
  $CLI network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

$CLI network create "$NET" >/dev/null
# The DNS server nginx resolves the stand-ins with: Docker's embedded one, or
# the network's gateway under Podman.
RESOLVER=127.0.0.11
[ "$CLI" = podman ] && RESOLVER=$($CLI network inspect "$NET" -f '{{(index .Subnets 0).Gateway}}')
{%- if values.withLocalisation %}
$CLI run -d --name "$NET-tolgee" --network "$NET" -v "$PWD/e2e/nginx:/mock:ro" "$NODE_IMAGE" node /mock/mock-tolgee.mjs >/dev/null
{%- endif %}
{%- if values.withAnalytics %}
$CLI run -d --name "$NET-posthog" --network "$NET" -v "$PWD/e2e/nginx:/mock:ro" "$NODE_IMAGE" node /mock/mock-posthog.mjs >/dev/null
{%- endif %}

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
  env -i PATH="$PATH" "$@" node e2e/nginx/render.mjs nginx-app.conf > "$ws/nginx-app.conf"
  $CLI run -d --name "$NET-nginx" --network "$NET" -p "127.0.0.1:$PORT:8080" -v "$ws:/workspace:ro" \
    "$NGINX_IMAGE" nginx -p /workspace -c /workspace/nginx.conf >/dev/null
  for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && return 0; sleep 0.2; done
  $CLI logs "$NET-nginx"; echo "nginx did not start" >&2; exit 1
}

ok() { echo "ok   $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }

# check <description> <path> <expected status> <expected X-Translations-Source> [text the body must contain]
check() {
  local desc=$1 path=$2 status=$3 source=$4 body=${5:-}
  local got got_source
  got=$(curl -s -m 15 -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' -H 'Cookie: session=secret' "http://127.0.0.1:$PORT$path")
  got_source=$(tr -d '\r' < "$WORK/headers" | sed -n 's/^[Xx]-[Tt]ranslations-[Ss]ource: //p')
  if [ "$got" = "$status" ] && [ "$got_source" = "$source" ] && { [ -z "$body" ] || grep -qF "$body" "$WORK/body"; }; then
    ok "$desc"
  else
    fail "$desc: status $got (want $status), source '$got_source' (want '$source')"; head -c 300 "$WORK/body"; echo
  fi
}

# runtime_config <description> <JavaScript expression over `c`, the parsed body>
runtime_config() {
  local got
  got=$(curl -s -m 15 -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' "http://127.0.0.1:$PORT/runtime-config.json")
  if [ "$got" = 200 ] && grep -qi '^content-type: application/json' "$WORK/headers" && grep -qi '^cache-control: no-store' "$WORK/headers" \
    && node -e "const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); process.exit(($2) ? 0 : 1)" "$WORK/body"; then
    ok "$1"
  else
    fail "$1: status $got, body $(head -c 300 "$WORK/body")"
  fi
}

echo "# nothing configured"
start_nginx
runtime_config "/runtime-config.json is valid JSON with telemetry off" "c.environment === '' && c.faro.url === ''{% if values.withAnalytics %} && c.posthog === null{% endif %}"
check "the app still answers /" / 200 ""
{%- if values.withAnalytics %}
check "/ingest/ answers 404 without a PostHog key" /ingest/e/ 404 ""
{%- endif %}

echo "# Faro{% if values.withAnalytics %} and PostHog{% endif %} configured"
TELEMETRY=(APP_ENVIRONMENT=dev FARO_URL=https://faro.example.test/collect{% if values.withAnalytics %} POSTHOG_KEY=phc_test POSTHOG_HOST="http://$NET-posthog:8086" NGINX_RESOLVER=$RESOLVER{% endif %})
start_nginx "${TELEMETRY[@]}"
runtime_config "/runtime-config.json carries the environment and the Faro receiver" "c.environment === 'dev' && c.faro.url === 'https://faro.example.test/collect'"
{%- if values.withAnalytics %}
runtime_config "... and the PostHog key, with events sent same-origin to /ingest" "c.posthog.key === 'phc_test' && c.posthog.apiHost === '/ingest' && c.posthog.replay !== 'true'"
# Placeholder credentials the proxy must strip before forwarding to PostHog —
# fixed test strings, not secrets. Kept out of the curl line so secret scanners
# (gitleaks' curl-auth-header rule) don't fail every app's CI on them.
FAKE_COOKIE='Cookie: session=test-only'  # gitleaks:allow
FAKE_AUTH='Authorization: Bearer test-only-not-a-token'  # gitleaks:allow
got=$(curl -s -m 15 -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' -X POST --data-binary '{"event":"$pageview"}' \
  -H 'Content-Type: application/json' -H "$FAKE_COOKIE" -H "$FAKE_AUTH" -H 'X-Forwarded-For: 203.0.113.7' \
  "http://127.0.0.1:$PORT/ingest/e/?compression=gzip-js")
last=$($CLI exec "$NET-posthog" wget -q -O- http://localhost:8086/__last)
if [ "$got" = 200 ] && node -e "
  const l = JSON.parse(process.argv[1]), h = l.headers
  process.exit(l.method === 'POST' && l.url === '/e/?compression=gzip-js' && l.size > 0 ? 0 : 1)" "$last"; then
  ok "/ingest/e/ reaches PostHog's /e/ with the query and body"
else
  fail "/ingest/e/: status $got, PostHog saw $last"
fi
if node -e "const h = JSON.parse(process.argv[1]).headers; process.exit(h.cookie || h.authorization || h['x-forwarded-for'] || h['x-real-ip'] ? 1 : 0)" "$last"; then
  ok "forwards no cookie, credential or visitor address"
else
  fail "headers PostHog received: $last"
fi
grep -qi '^set-cookie' "$WORK/headers" && fail "PostHog's Set-Cookie reached the browser" || ok "hides PostHog's Set-Cookie"
check "/ingest/static/array.js is forwarded as /static/array.js" /ingest/static/array.js 200 ""
last=$($CLI exec "$NET-posthog" wget -q -O- http://localhost:8086/__last)
grep -q '"url":"/static/array.js"' <<<"$last" && ok "PostHog saw /static/array.js" || fail "PostHog saw $last"
$CLI stop "$NET-posthog" >/dev/null
got=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST --data-binary '{}' "http://127.0.0.1:$PORT/ingest/e/")
[[ "$got" =~ ^50[24]$ ]] && ok "an unreachable PostHog is a quick 502/504, not a hang" || fail "unreachable PostHog answered $got"
check "the app still answers / without PostHog" / 200 ""
$CLI start "$NET-posthog" >/dev/null

echo "# session replay switched on"
start_nginx "${TELEMETRY[@]}" POSTHOG_SESSION_REPLAY=true
runtime_config "/runtime-config.json passes the replay switch on" "c.posthog.replay === 'true'"
{%- endif %}
{%- if values.withLocalisation %}

tolgee_mode() { $CLI exec "$NET-tolgee" wget -q -O /dev/null --post-data= "http://localhost:8085/__mode/$1"; }
BUILT_IN_EN=$(node -e "console.log(require('./src/i18n/en.json')['features.heading'])")

echo "# no Tolgee configured"
start_nginx
check "serves the built-in English" /i18n/en.json 200 bundled "$BUILT_IN_EN"
check "a language with no file is 404" /i18n/xx.json 404 bundled
check "anything else under /i18n is 404" /i18n/en.txt 404 ""
check "the app still answers /" / 200 ""

echo "# Tolgee configured"
TOLGEE=(TOLGEE_API_URL="http://$NET-tolgee:8085" TOLGEE_PROJECT_ID=7 TOLGEE_API_KEY=tgpak_test NGINX_RESOLVER=$RESOLVER)
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
{%- endif %}
{%- if values.withCms %}

strapi_last() { $CLI exec "$NET-strapi" wget -q -O- http://localhost:8087/__last; }

# cms <description> <method> <path> <expected status> <expected X-Cms> [text the body must contain]
cms() {
  local desc=$1 method=$2 path=$3 status=$4 cms=$5 body=${6:-}
  local got got_cms
  got=$(curl -s -m 20 -X "$method" -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' -H "$FAKE_STRAPI_COOKIE" "http://127.0.0.1:$PORT$path")
  got_cms=$(tr -d '\r' < "$WORK/headers" | sed -n 's/^[Xx]-[Cc]ms: //p')
  if [ "$got" = "$status" ] && [ "$got_cms" = "$cms" ] && { [ -z "$body" ] || grep -qF "$body" "$WORK/body"; }; then
    ok "$desc"
  else
    fail "$desc: status $got (want $status), X-Cms '$got_cms' (want '$cms')"; head -c 300 "$WORK/body"; echo
  fi
}
# A placeholder session cookie the proxy must not forward — a fixed test string.
FAKE_STRAPI_COOKIE='Cookie: session=test-only'  # gitleaks:allow
$CLI run -d --name "$NET-strapi" --network "$NET" -v "$PWD/e2e/nginx:/mock:ro" "$NODE_IMAGE" node /mock/mock-strapi.mjs >/dev/null

echo "# no Strapi token configured"
start_nginx
cms "/cms/ answers an empty 200 with X-Cms: off" GET /cms/articles 200 off '"cms":"off"'
grep -qi '^cache-control: no-store' "$WORK/headers" && ok "... uncached, so a token added later takes effect at once" || fail "cache headers: $(grep -i cache-control "$WORK/headers")"
cms "/uploads/ answers 404" GET /uploads/cat.png 404 ""
check "the app still answers /" / 200 ""

echo "# Strapi configured"
STRAPI=(STRAPI_API_TOKEN=test-strapi-token STRAPI_URL="http://$NET-strapi:8087" NGINX_RESOLVER=$RESOLVER)
start_nginx "${STRAPI[@]}"
cms "/cms/articles is Strapi's /api/articles" GET '/cms/articles?locale=de&pagination%5BpageSize%5D=3' 200 strapi 'Hello from Strapi (de)'
last=$(strapi_last)
if node -e "
  const l = JSON.parse(process.argv[1]), h = l.headers
  process.exit(l.url === '/api/articles?locale=de&pagination%5BpageSize%5D=3' && h.authorization === 'Bearer test-strapi-token' && !h.cookie ? 0 : 1)" "$last"; then
  ok "sends the token and the query, and no browser cookie"
else
  fail "request to Strapi: $last"
fi
grep -qi '^set-cookie' "$WORK/headers" && fail "Strapi's Set-Cookie reached the browser" || ok "hides Strapi's Set-Cookie"
grep -qi '^cache-control: public, max-age=60' "$WORK/headers" && ok "cached for a minute" || fail "cache headers: $(grep -i cache-control "$WORK/headers")"
before=$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$(strapi_last)")
cms "a POST is refused" POST /cms/articles 403 strapi
cms "Strapi's users are never proxied" GET /cms/users 404 strapi
cms "nor its auth endpoints" GET /cms/auth/local 404 strapi
cms "nor the media library listing" GET /cms/upload/files 404 strapi
after=$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$(strapi_last)")
[ "$before" = "$after" ] && ok "none of those reached Strapi" || fail "Strapi saw $((after - before)) refused request(s)"
got=$(curl -s -m 15 -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' "http://127.0.0.1:$PORT/uploads/cat.png")
last=$(strapi_last)
if [ "$got" = 200 ] && grep -qi '^content-type: image/png' "$WORK/headers" \
  && node -e "const h = JSON.parse(process.argv[1]).headers; process.exit(h.authorization ? 1 : 0)" "$last"; then
  ok "/uploads/ serves Strapi's media, without the token"
else
  fail "/uploads/cat.png: status $got, Strapi saw $last"
fi
$CLI stop "$NET-strapi" >/dev/null
got=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/cms/articles")
[[ "$got" =~ ^50[24]$ ]] && ok "an unreachable Strapi is a quick 502/504, not a hang" || fail "unreachable Strapi answered $got"
check "the app still answers / without Strapi" / 200 ""
{%- endif %}

[ "$failures" -eq 0 ] && echo "all nginx checks passed" || { echo "$failures check(s) failed"; exit 1; }
