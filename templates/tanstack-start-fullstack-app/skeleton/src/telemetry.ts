// Browser telemetry: Grafana Faro real-user monitoring{% if values.withAnalytics %} and PostHog product
// analytics{% endif %}.
//
// Nothing here is baked into the bundle: the same image runs in dev, test and
// prod, so what to send and where comes from GET /runtime-config.json on this
// app's own origin, which server.mjs answers from the Pod's environment
// (src/server/edge.mjs, deploy/base/rollout.yaml). `npm run dev` has no such
// route, so it sends nothing.
//
//   faro.url        the platform's Faro receiver (https://faro.<platform domain>/collect):
//                   page loads, web vitals (LCP, INP, CLS, FCP, TTFB), JS errors,
//                   fetch/XHR timings and browser traces. The traces carry a W3C
//                   `traceparent` to this origin and to this environment's other
//                   services, so a click joins the backend's trace in Tempo.
{%- if values.withAnalytics %}
//   posthog.key     the PostHog project key (phc_..., public by design) for this
//                   environment, from the optional Secret <app>-posthog. Events go
//                   to /ingest on this origin, which server.mjs forwards to PostHog,
//                   so ad blockers that drop third-party analytics do not drop them.
//
// Analytics respects the browser's Do Not Track setting and the opt-out below,
// records no session replay unless the environment turns it on, masks element
// text in autocaptured events and creates no person profiles for anonymous
// visitors.
{%- endif %}
//
// Telemetry must never break the app: every failure here is swallowed and the
// app runs without it. It runs in the browser only (src/routes/__root.tsx
// starts it from an effect), never during server rendering.

// Only `version` is bundled: Vite keeps just the JSON keys that are imported.
import { version } from '../package.json'

export const APP_NAME: string = ${{ values.name | dump }}
export const APP_VERSION: string = version

type RuntimeConfig = {
  environment?: string
  faro?: { url?: string }
  posthog?: { key?: string; apiHost?: string; uiHost?: string; replay?: string | boolean } | null
}
{%- if values.withAnalytics %}

const OPT_OUT_KEY = 'analytics-opt-out'
let posthogClient: { opt_out_capturing(): void; opt_in_capturing(): void } | null = null

/** Stops product analytics in this browser, now and on later visits. */
export function optOutOfAnalytics(): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, '1')
  } catch {}
  posthogClient?.opt_out_capturing()
}

/** Undoes optOutOfAnalytics(); takes effect from the next page load. */
export function optInToAnalytics(): void {
  try {
    localStorage.removeItem(OPT_OUT_KEY)
  } catch {}
  posthogClient?.opt_in_capturing()
}

export function analyticsOptedOut(): boolean {
  try {
    if (localStorage.getItem(OPT_OUT_KEY) === '1') return true
  } catch {}
  return navigator.doNotTrack === '1' || (window as any).doNotTrack === '1' || (navigator as any).globalPrivacyControl === true
}
{%- endif %}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('/runtime-config.json', { cache: 'no-store', headers: { accept: 'application/json' } })
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return {}
    const config = await response.json()
    return config && typeof config === 'object' ? config : {}
  } catch {
    return {}
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The other services of THIS environment on the platform: <svc>.<env>.<domain>
// or <svc>-<env>.<domain>. Only those get a traceparent cross-origin; anything
// else (an identity provider, a CDN) would refuse the extra CORS header.
function traceOrigins(faroUrl: string, environment: string): RegExp[] {
  const domain = new URL(faroUrl).hostname.replace(/^[^.]+\./, '')
  if (!environment || !domain.includes('.')) return []
  return [new RegExp(`^https://[a-z0-9-]+[.-]${escapeRegExp(environment)}\\.${escapeRegExp(domain)}(:\\d+)?(/|$)`)]
}

async function startFaro(faro: { url: string }, environment: string): Promise<void> {
  const [{ initializeFaro, getWebInstrumentations }, { TracingInstrumentation }] = await Promise.all([
    import('@grafana/faro-web-sdk'),
    import('@grafana/faro-web-tracing'),
  ])
  initializeFaro({
    url: faro.url,
    app: { name: APP_NAME, version: APP_VERSION, environment },
    sessionTracking: { enabled: true, persistent: true },
    instrumentations: [
      // console.* is the app's own business; errors are captured without it.
      ...getWebInstrumentations({ captureConsole: false }),
      new TracingInstrumentation({
        instrumentationOptions: { propagateTraceHeaderCorsUrls: traceOrigins(faro.url, environment) },
      }),
    ],
  })
}
{%- if values.withAnalytics %}

async function startPostHog(config: NonNullable<RuntimeConfig['posthog']> & { key: string }, environment: string): Promise<void> {
  if (analyticsOptedOut()) return
  const { default: posthog } = await import('posthog-js')
  posthog.init(config.key, {
    api_host: config.apiHost || '/ingest',
    ui_host: config.uiHost || null,
    // Page views on every client-side route change, not only full loads.
    capture_pageview: 'history_change',
    capture_pageleave: true,
    autocapture: true,
    respect_dnt: true,
    person_profiles: 'identified_only',
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: String(config.replay) !== 'true',
    session_recording: { maskAllInputs: true, maskTextSelector: '*' },
    loaded: (client) => {
      client.register({ app: APP_NAME, app_version: APP_VERSION, environment })
    },
  })
  posthogClient = posthog
}
{%- endif %}

/** Starts whatever the runtime config turns on. Resolves once that is done; never rejects. */
export async function startTelemetry(): Promise<void> {
  if (typeof window === 'undefined') return
  const config = await loadRuntimeConfig()
  const environment = typeof config.environment === 'string' && config.environment ? config.environment : 'unknown'
  const started: Promise<void>[] = []
  if (typeof config.faro?.url === 'string' && /^https?:\/\//.test(config.faro.url)) {
    started.push(startFaro({ url: config.faro.url }, environment))
  }
{%- if values.withAnalytics %}
  if (typeof config.posthog?.key === 'string' && config.posthog.key) {
    started.push(startPostHog({ ...config.posthog, key: config.posthog.key }, environment))
  }
{%- endif %}
  await Promise.allSettled(started)
}
{%- if values.withAnalytics %}

if (typeof window !== 'undefined') {
  // For a cookie banner or a settings page: window.adharAnalytics.optOut().
  (window as any).adharAnalytics = { optOut: optOutOfAnalytics, optIn: optInToAnalytics, optedOut: analyticsOptedOut }
}
{%- endif %}
