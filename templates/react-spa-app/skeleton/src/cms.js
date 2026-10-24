{% if values.withCms -%}
// Content from the platform's Strapi CMS (https://strapi.io), read-only.
//
// The browser never talks to Strapi directly: GET /cms/<path> on this app's own
// origin is Strapi's REST API at /api/<path>, proxied by nginx with a read-only
// token the browser never sees (nginx-app.conf), and media URLs Strapi returns
// (/uploads/<file>) are served the same way. So there is nothing to configure in
// the app and no secret in the bundle.
//
//   const result = await fetchCollection('articles', { locale: 'de', pageSize: 6 })
//   result.status   'ok'    — result.entries (Strapi 5 documents), result.pagination
//                   'off'   — this environment has no Strapi token yet (X-Cms: off)
//                   'error' — Strapi refused, failed or did not answer
//
// fetchCollection never throws, so a CMS outage costs a section of a page, never
// the page. Query parameters are Strapi's own:
// https://docs.strapi.io/cms/api/rest/parameters
import { useEffect, useState } from 'react'

export const CMS_COLLECTION = ${{ values.cmsCollection | dump }}

const TIMEOUT_MS = 8000

/** Strapi's bracketed query string, e.g. { sort: ['publishedAt:desc'] } → sort[0]=publishedAt:desc. */
export function toQuery(params, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (typeof value === 'object') toQuery(value, name, out)
    else out.append(name, String(value))
  }
  return out
}

async function get(path, params, signal) {
  const query = toQuery(params).toString()
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const response = await fetch(`/cms/${path}${query ? `?${query}` : ''}`, {
    headers: { accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (response.headers.get('x-cms') === 'off') return { status: 'off' }
  if (!response.ok) return { status: 'error', httpStatus: response.status }
  return { status: 'ok', body: await response.json() }
}

/**
 * The published entries of a collection type, newest first.
 *
 * @param {string} type the collection's plural API ID, e.g. 'articles'
 * @param {{ locale?: string, pageSize?: number, page?: number, sort?: string[], filters?: object, populate?: string | object, signal?: AbortSignal }} [options]
 */
export async function fetchCollection(type, options = {}) {
  const { locale, pageSize = 6, page = 1, sort = ['publishedAt:desc'], filters, populate = '*', signal } = options
  const params = { pagination: { page, pageSize }, sort, filters, populate }
  try {
    let result = await get(encodeURIComponent(type), { ...params, locale }, signal)
    // A content type that is not localised, or not in this language, refuses the
    // locale; the default language's entries are better than none.
    if (result.status === 'error' && locale && (result.httpStatus === 400 || result.httpStatus === 404)) {
      result = await get(encodeURIComponent(type), params, signal)
    }
    if (result.status !== 'ok') return result
    const entries = Array.isArray(result.body?.data) ? result.body.data : []
    return { status: 'ok', entries, pagination: result.body?.meta?.pagination ?? null }
  } catch {
    return { status: 'error' }
  }
}

/** fetchCollection as React state: { status: 'loading' | 'ok' | 'off' | 'error', entries }. */
export function useCollection(type, { locale, pageSize = 6 } = {}) {
  const [state, setState] = useState({ status: 'loading', entries: [] })
  useEffect(() => {
    const controller = new AbortController()
    setState((previous) => ({ ...previous, status: 'loading' }))
    fetchCollection(type, { locale, pageSize, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setState({ entries: [], ...result })
    })
    return () => controller.abort()
  }, [type, locale, pageSize])
  return state
}

/** The first of an entry's fields that holds text, for content types that name them differently. */
export function textField(entry, ...names) {
  for (const name of names) {
    if (typeof entry?.[name] === 'string' && entry[name].trim()) return entry[name]
  }
  return ''
}

/** The URL of an entry's image (Strapi media field), same-origin, or ''. */
export function imageUrl(entry, ...names) {
  for (const name of names) {
    const media = Array.isArray(entry?.[name]) ? entry[name][0] : entry?.[name]
    const url = media?.formats?.small?.url ?? media?.url
    if (typeof url === 'string' && url.startsWith('/uploads/')) return url
  }
  return ''
}
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false). To
// turn it on later, scaffold a new app with it to see the pieces: this module,
// the /cms/ and /uploads/ locations in nginx-app.conf, and the Secret
// <app>-strapi in deploy/base/rollout.yaml.
export {}
{%- endif %}
