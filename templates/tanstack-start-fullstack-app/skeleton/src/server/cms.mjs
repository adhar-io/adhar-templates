{% if values.withCms -%}
// The platform's Strapi CMS, same-origin and read-only, run by server.mjs in
// front of the TanStack Start handler. Plain JavaScript, so the production
// server needs no TypeScript support at runtime; src/server/cms.test.ts covers it.
//
//   GET /cms/<path>      Strapi's REST API at /api/<path>, with Strapi's own query
//                        string (locale, sort, pagination, populate, filters) and
//                        a READ-ONLY API token added here — the browser never sees
//                        it (src/cms.ts)
//   GET /uploads/<file>  Strapi's public media, so the URLs Strapi returns work as
//                        they are
//
// The CMS's public address sits behind the platform's single sign-on, so the
// browser could not call it directly anyway.
//
// Environment (deploy/base/rollout.yaml), from the optional Secret <app>-strapi:
//   STRAPI_API_TOKEN  the read-only token. Without it /cms/ answers an empty 200
//                     with X-Cms: off — not an error status, which the browser
//                     would log on every page — and the app shows its setup hint.
//   STRAPI_URL        optional; Strapi's base URL. Default: the platform's shared
//                     Strapi Service.
//
// Only GET and HEAD pass. Strapi's user and authentication endpoints and the
// media library listing are never proxied, whatever the token allows: the CMS
// is shared by every app on the platform.

export const DEFAULT_STRAPI_URL = 'http://strapi.adhar-system.svc.cluster.local:1337'
const REFUSED = /^\/cms\/(users|users-permissions|auth|connect|upload)(\/|$)/
const PASSED_RESPONSE_HEADERS = ['content-type', 'content-length', 'etag', 'last-modified']

/**
 * @param {{ env?: () => Record<string, string | undefined>, fetch?: typeof globalThis.fetch, timeoutMs?: number, mediaTimeoutMs?: number }} [options]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createCmsProxy({ env = () => process.env, fetch = globalThis.fetch, timeoutMs = 10_000, mediaTimeoutMs = 30_000 } = {}) {
  return async (request) => {
    const url = new URL(request.url)
    const api = url.pathname.startsWith('/cms/')
    const marker = api ? { 'x-cms': 'strapi' } : {}
    const { STRAPI_API_TOKEN, STRAPI_URL } = env()
    if (!STRAPI_API_TOKEN) {
      if (!api) return new Response('Not Found', { status: 404 })
      return Response.json({ data: null, meta: { cms: 'off' } }, { headers: { 'x-cms': 'off', 'cache-control': 'no-store' } })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 403, headers: marker })
    if (api && REFUSED.test(url.pathname)) return new Response(null, { status: 404, headers: marker })

    const base = (STRAPI_URL || DEFAULT_STRAPI_URL).replace(/\/+$/, '')
    const target = base + (api ? `/api/${url.pathname.slice('/cms/'.length)}` : url.pathname) + url.search
    // Nothing from the browser — cookies, its own authorization — is forwarded.
    const headers = new Headers({ accept: api ? 'application/json' : '*/*' })
    if (api) headers.set('authorization', `Bearer ${STRAPI_API_TOKEN}`)
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        signal: AbortSignal.timeout(api ? timeoutMs : mediaTimeoutMs),
        redirect: 'manual',
      })
      const out = new Headers(marker)
      for (const name of PASSED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) out.set(name, value)
      }
      // A minute for content (an edit is live within one); a day for media, whose
      // names Strapi hashes, so a file never changes.
      out.set('cache-control', api ? 'public, max-age=60' : 'public, max-age=86400')
      return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out })
    } catch {
      return new Response('Bad Gateway', { status: 502, headers: marker })
    }
  }
}

/**
 * A srvx middleware answering /cms/ and /uploads/ and passing everything else on.
 * @param {Parameters<typeof createCmsProxy>[0]} [options]
 */
export function cmsMiddleware(options) {
  const proxy = createCmsProxy(options)
  /** @param {Request} request @param {() => Response | Promise<Response>} next */
  return (request, next) => {
    const { pathname } = new URL(request.url)
    return pathname.startsWith('/cms/') || pathname.startsWith('/uploads/') ? proxy(request) : next()
  }
}
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false), so
// the server answers nothing at /cms/: this middleware passes every request on.
export function cmsMiddleware() {
  return (_request, next) => next()
}
{%- endif %}
