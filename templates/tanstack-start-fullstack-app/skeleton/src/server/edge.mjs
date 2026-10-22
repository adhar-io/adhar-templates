// Server-side pieces of browser telemetry, run by server.mjs in front of the
// TanStack Start handler. Plain JavaScript, so the production server needs no
// TypeScript support at runtime; src/server/edge.test.ts covers it.
//
//   GET /runtime-config.json   what the browser turns on (src/telemetry.ts),
//                              answered from the Pod's environment because the
//                              same image runs in every environment
{%- if values.withAnalytics %}
//   /ingest/*                  PostHog, same-origin: forwarded to POSTHOG_HOST
//                              with the prefix removed, so no CORS and nothing
//                              third-party for an ad blocker to drop
{%- endif %}
//
// Environment (deploy/base/rollout.yaml), every value optional:
//   APP_ENVIRONMENT  the environment's name (dev, test, prod), set per overlay
//   FARO_URL         the platform's Faro receiver, for real-user monitoring
{%- if values.withAnalytics %}
//   POSTHOG_KEY, POSTHOG_HOST, POSTHOG_UI_HOST, POSTHOG_SESSION_REPLAY
//                    from the optional Secret <app>-posthog; without a key and a
//                    host analytics is off and /ingest answers 404
{%- endif %}

/** @param {Record<string, string | undefined>} env */
export function runtimeConfig(env) {
  const config = { environment: env.APP_ENVIRONMENT ?? '', faro: { url: env.FARO_URL ?? '' } }
{%- if values.withAnalytics %}
  config.posthog =
    env.POSTHOG_KEY && env.POSTHOG_HOST
      ? { key: env.POSTHOG_KEY, apiHost: '/ingest', uiHost: env.POSTHOG_UI_HOST ?? '', replay: env.POSTHOG_SESSION_REPLAY ?? '' }
      : null
{%- endif %}
  return config
}
{%- if values.withAnalytics %}

// Only what PostHog needs to read the request. No cookie, credential or client
// address is forwarded: PostHog sees this server as the sender, so it stores no
// visitor IP.
const FORWARDED_REQUEST_HEADERS = ['content-type', 'content-encoding', 'accept', 'accept-encoding']
const DROPPED_RESPONSE_HEADERS = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection']

/**
 * @param {{ env?: () => Record<string, string | undefined>, fetch?: typeof globalThis.fetch, timeoutMs?: number }} [options]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createIngestProxy({ env = () => process.env, fetch = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  return async (request) => {
    const { POSTHOG_KEY, POSTHOG_HOST } = env()
    if (!POSTHOG_KEY || !POSTHOG_HOST) return new Response('Not Found', { status: 404 })
    const url = new URL(request.url)
    const target = new URL(url.pathname.replace(/^\/ingest/, '') + url.search, POSTHOG_HOST.replace(/\/+$/, '') + '/')
    const headers = new Headers()
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      })
      const responseHeaders = new Headers(upstream.headers)
      for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name)
      return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders })
    } catch {
      return new Response('Bad Gateway', { status: 502 })
    }
  }
}
{%- endif %}

/**
 * A srvx middleware answering the telemetry paths and passing everything else on.
 * @param {{ env?: () => Record<string, string | undefined>, fetch?: typeof globalThis.fetch }} [options]
 */
export function telemetryMiddleware({ env = () => process.env{% if values.withAnalytics %}, fetch = globalThis.fetch{% endif %} } = {}) {
{%- if values.withAnalytics %}
  const ingest = createIngestProxy({ env, fetch })
{%- endif %}
  /** @param {Request} request @param {() => Response | Promise<Response>} next */
  return (request, next) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/runtime-config.json' && (request.method === 'GET' || request.method === 'HEAD')) {
      return Response.json(runtimeConfig(env()), { headers: { 'cache-control': 'no-store' } })
    }
{%- if values.withAnalytics %}
    if (pathname.startsWith('/ingest/')) return ingest(request)
{%- endif %}
    return next()
  }
}
