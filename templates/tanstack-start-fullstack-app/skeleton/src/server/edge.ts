// Server-side pieces of browser telemetry, run by server.ts in front of the
// TanStack Start handler. Node runs this file as it is (it strips the types),
// so it keeps to erasable TypeScript; src/server/edge.test.ts covers it.
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
import type { Env, Middleware } from './middleware.ts'

/** GET /runtime-config.json: what src/telemetry.ts reads in the browser. */
export interface RuntimeConfig {
  environment: string
  faro: { url: string }
{%- if values.withAnalytics %}
  posthog: { key: string; apiHost: string; uiHost: string; replay: string } | null
{%- endif %}
}

export function runtimeConfig(env: Env): RuntimeConfig {
  return {
    environment: env.APP_ENVIRONMENT ?? '',
    faro: { url: env.FARO_URL ?? '' },
{%- if values.withAnalytics %}
    posthog:
      env.POSTHOG_KEY && env.POSTHOG_HOST
        ? { key: env.POSTHOG_KEY, apiHost: '/ingest', uiHost: env.POSTHOG_UI_HOST ?? '', replay: env.POSTHOG_SESSION_REPLAY ?? '' }
        : null,
{%- endif %}
  }
}
{%- if values.withAnalytics %}

// Only what PostHog needs to read the request. No cookie, credential or client
// address is forwarded: PostHog sees this server as the sender, so it stores no
// visitor IP.
const FORWARDED_REQUEST_HEADERS = ['content-type', 'content-encoding', 'accept', 'accept-encoding']
const DROPPED_RESPONSE_HEADERS = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection']

export interface IngestProxyOptions {
  env?: () => Env
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

export function createIngestProxy({ env = () => process.env, fetch = globalThis.fetch, timeoutMs = 15_000 }: IngestProxyOptions = {}): (request: Request) => Promise<Response> {
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

export interface TelemetryMiddlewareOptions {
  env?: () => Env
{%- if values.withAnalytics %}
  fetch?: typeof globalThis.fetch
{%- endif %}
}

/** A srvx middleware answering the telemetry paths and passing everything else on. */
export function telemetryMiddleware({ env = () => process.env{% if values.withAnalytics %}, fetch = globalThis.fetch{% endif %} }: TelemetryMiddlewareOptions = {}): Middleware {
{%- if values.withAnalytics %}
  const ingest = createIngestProxy({ env, fetch })
{%- endif %}
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
