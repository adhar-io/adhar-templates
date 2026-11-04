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

export const CMS_COLLECTION: string = ${{ values.cmsCollection | dump }}

const TIMEOUT_MS = 8000

/** One published entry of a collection type: Strapi's own fields, then the content type's. */
export interface StrapiEntry {
  id?: number
  documentId?: string
  publishedAt?: string
  locale?: string
  [field: string]: unknown
}

export interface Pagination {
  page: number
  pageSize: number
  pageCount: number
  total: number
}

export type CollectionResult =
  | { status: 'ok'; entries: StrapiEntry[]; pagination: Pagination | null }
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

/** A Strapi media field, or one item of a multiple-media field. */
interface StrapiMedia {
  url?: unknown
  formats?: { small?: { url?: unknown } }
}

type CmsAnswer = { status: 'ok'; body: unknown } | { status: 'off' } | { status: 'error'; httpStatus: number }

/** Strapi's bracketed query string, e.g. { sort: ['publishedAt:desc'] } → sort[0]=publishedAt:desc. */
export function toQuery(params: object | undefined, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (typeof value === 'object') toQuery(value, name, out)
    else out.append(name, String(value))
  }
  return out
}

async function get(path: string, params: object, signal?: AbortSignal): Promise<CmsAnswer> {
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
 * @param type the collection's plural API ID, e.g. 'articles'
 */
export async function fetchCollection(type: string, options: CollectionOptions = {}): Promise<CollectionResult> {
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
    const body = (result.body ?? {}) as { data?: unknown; meta?: { pagination?: Pagination } }
    const entries = Array.isArray(body.data) ? (body.data as StrapiEntry[]) : []
    return { status: 'ok', entries, pagination: body.meta?.pagination ?? null }
  } catch {
    return { status: 'error' }
  }
}

export interface CollectionState {
  status: 'loading' | CollectionResult['status']
  entries: StrapiEntry[]
  pagination?: Pagination | null
  httpStatus?: number
}

/**
 * fetchCollection as React state: { status: 'loading' | 'ok' | 'off' | 'error', entries }.
 * 'loading' until the answer for THESE arguments is in — also after they change
 * (another language), when the previous answer is kept but no longer shown as 'ok'.
 */
export function useCollection(type: string, { locale, pageSize = 6 }: { locale?: string; pageSize?: number } = {}): CollectionState {
  const request = JSON.stringify([type, locale ?? null, pageSize])
  const [answer, setAnswer] = useState<{ request: string; state: CollectionState } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetchCollection(type, { locale, pageSize, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setAnswer({ request, state: { entries: [], ...result } })
    })
    return () => controller.abort()
  }, [request, type, locale, pageSize])
  if (answer?.request === request) return answer.state
  return { entries: [], ...answer?.state, status: 'loading' }
}

/** The first of an entry's fields that holds text, for content types that name them differently. */
export function textField(entry: StrapiEntry | null | undefined, ...names: string[]): string {
  for (const name of names) {
    const value = entry?.[name]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

/** The URL of an entry's image (Strapi media field), same-origin, or ''. */
export function imageUrl(entry: StrapiEntry | null | undefined, ...names: string[]): string {
  for (const name of names) {
    const field = entry?.[name]
    const media = (Array.isArray(field) ? field[0] : field) as StrapiMedia | null | undefined
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
