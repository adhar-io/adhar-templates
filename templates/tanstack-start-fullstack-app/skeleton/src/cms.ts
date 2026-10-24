{% if values.withCms -%}
// Content from the platform's Strapi CMS (https://strapi.io), read-only.
//
// The browser never talks to Strapi directly: GET /cms/<path> on this app's own
// origin is Strapi's REST API at /api/<path>, proxied by this app's own server
// with a read-only token the browser never sees (src/server/cms.mjs), and media
// URLs Strapi returns (/uploads/<file>) are served the same way. So there is nothing to configure in
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

export const CMS_COLLECTION: string = ${{ values.cmsCollection | dump }}

/** A Strapi document: its fields are whatever the content type defines. */
export type CmsEntry = { id?: number; documentId?: string; publishedAt?: string } & Record<string, unknown>

export type CmsResult =
  | { status: 'ok'; entries: CmsEntry[]; pagination: Record<string, number> | null }
  | { status: 'off' }
  | { status: 'error'; httpStatus?: number }

export interface CollectionOptions {
  locale?: string
  pageSize?: number
  page?: number
  sort?: string[]
  filters?: Record<string, unknown>
  populate?: string | Record<string, unknown>
  signal?: AbortSignal
}

const TIMEOUT_MS = 8000

/** Strapi's bracketed query string, e.g. { sort: ['publishedAt:desc'] } → sort[0]=publishedAt:desc. */
export function toQuery(params: Record<string, unknown> | undefined, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (typeof value === 'object') toQuery(value as Record<string, unknown>, name, out)
    else out.append(name, String(value))
  }
  return out
}

async function get(path: string, params: Record<string, unknown>, signal?: AbortSignal) {
  const query = toQuery(params).toString()
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const response = await fetch(`/cms/${path}${query ? `?${query}` : ''}`, {
    headers: { accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (response.headers.get('x-cms') === 'off') return { status: 'off' as const }
  if (!response.ok) return { status: 'error' as const, httpStatus: response.status }
  return { status: 'ok' as const, body: await response.json() }
}

/** The published entries of a collection type (its plural API ID, e.g. 'articles'), newest first. */
export async function fetchCollection(type: string, options: CollectionOptions = {}): Promise<CmsResult> {
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
    const entries = Array.isArray(result.body?.data) ? (result.body.data as CmsEntry[]) : []
    return { status: 'ok', entries, pagination: result.body?.meta?.pagination ?? null }
  } catch {
    return { status: 'error' }
  }
}

/** fetchCollection as React state: { status: 'loading' | 'ok' | 'off' | 'error', entries }. */
export function useCollection(type: string, { locale, pageSize = 6 }: { locale?: string; pageSize?: number } = {}) {
  const [state, setState] = useState<{ status: 'loading' | CmsResult['status']; entries: CmsEntry[] }>({ status: 'loading', entries: [] })
  useEffect(() => {
    const controller = new AbortController()
    setState((previous) => ({ ...previous, status: 'loading' }))
    fetchCollection(type, { locale, pageSize, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setState({ entries: result.status === 'ok' ? result.entries : [], status: result.status })
    })
    return () => controller.abort()
  }, [type, locale, pageSize])
  return state
}

/** The first of an entry's fields that holds text, for content types that name them differently. */
export function textField(entry: CmsEntry, ...names: string[]): string {
  for (const name of names) {
    const value = entry[name]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

/** The URL of an entry's image (Strapi media field), same-origin, or ''. */
export function imageUrl(entry: CmsEntry, ...names: string[]): string {
  for (const name of names) {
    const field = entry[name] as any
    const media = Array.isArray(field) ? field[0] : field
    const url = media?.formats?.small?.url ?? media?.url
    if (typeof url === 'string' && url.startsWith('/uploads/')) return url
  }
  return ''
}
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false). To
// turn it on later, scaffold a new app with it to see the pieces: this module,
// src/server/cms.mjs (mounted in server.mjs), and the Secret
// <app>-strapi in deploy/base/rollout.yaml.
export {}
{%- endif %}
