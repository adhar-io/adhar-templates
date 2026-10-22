// Translations for /i18n/<language>.json and the server render: Tolgee first,
// the files built into the app (src/i18n/<language>.json) as the fallback.
//
// No framework imports, so it is unit-tested directly (i18n.test.ts, run by
// `npm test`). src/server/translations.ts wires it to the real environment.
//
// Tolgee is asked for ONE language as flat JSON —
//   GET <TOLGEE_API_URL>/v2/projects/<TOLGEE_PROJECT_ID>/export
//       ?languages=<language>&format=JSON&zip=false&structureDelimiter=
//   X-API-Key: <TOLGEE_API_KEY>   (a read-only project key; it never leaves the server)
// — and the answer is laid over the built-in file, so a key added in code but
// not yet in Tolgee still has its English text.
//
// Behaviour, chosen so the app ALWAYS has its texts:
//   - Tolgee answers         → Tolgee's texts over the built-in ones, cached for `ttlMs`.
//   - no Tolgee configured   → the built-in file.
//   - Tolgee fails or is slow (`timeoutMs`) → the last texts Tolgee gave, if any,
//                              else the built-in file; Tolgee is not asked again
//                              for `retryMs`, so an outage does not add a timeout
//                              to every request.
//   - a language neither Tolgee nor the app has, or a malformed tag → null
//     (the route answers 404 and the browser falls back to English).

export type Texts = Record<string, string>

export interface TolgeeEnv {
  TOLGEE_API_URL?: string
  TOLGEE_PROJECT_ID?: string
  TOLGEE_API_KEY?: string
}

export interface TranslationSourceOptions {
  /** Read on every fetch, so a Secret mounted after start-up is picked up. */
  env: () => TolgeeEnv
  /** The built-in translations, by language tag. */
  bundled: Record<string, Texts>
  fetch?: typeof fetch
  now?: () => number
  ttlMs?: number
  retryMs?: number
  timeoutMs?: number
  log?: (message: string) => void
}

export type Source = 'tolgee' | 'tolgee-stale' | 'bundled'

export interface Translation {
  texts: Texts
  source: Source
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export function isLanguageTag(tag: string): boolean {
  return LANGUAGE_TAG.test(tag)
}

/** Flatten `{ "a": { "b": "x" } }` into `{ "a.b": "x" }`; keep only strings. */
export function flatten(value: unknown, prefix = '', out: Texts = {}): Texts {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out)
  } else if (typeof value === 'string' && prefix) {
    out[prefix] = value
  }
  return out
}

interface Entry {
  value: Translation | null
  expires: number
  fromTolgee?: Texts
}

export function createTranslationSource(options: TranslationSourceOptions) {
  const {
    env,
    bundled,
    fetch: fetchFn = globalThis.fetch,
    now = Date.now,
    ttlMs = 60_000,
    retryMs = 10_000,
    timeoutMs = 2_000,
    log = (message: string) => console.warn(message),
  } = options
  const cache = new Map<string, Entry>()
  const inFlight = new Map<string, Promise<Translation | null>>()

  async function fromTolgee(language: string): Promise<Texts | 'missing' | null> {
    const { TOLGEE_API_URL, TOLGEE_PROJECT_ID, TOLGEE_API_KEY } = env()
    if (!TOLGEE_API_URL || !TOLGEE_PROJECT_ID || !TOLGEE_API_KEY) return null
    const url =
      `${TOLGEE_API_URL.replace(/\/+$/, '')}/v2/projects/${encodeURIComponent(TOLGEE_PROJECT_ID)}/export` +
      `?languages=${encodeURIComponent(language)}&format=JSON&zip=false&structureDelimiter=`
    try {
      const response = await fetchFn(url, {
        headers: { 'X-API-Key': TOLGEE_API_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      // Tolgee answers 400/404 for a language the project does not have.
      if (response.status === 400 || response.status === 404) return 'missing'
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return flatten(await response.json())
    } catch (error) {
      log(`translations: Tolgee export of "${language}" failed (${error instanceof Error ? error.message : error}); serving the built-in copy`)
      throw error
    }
  }

  async function load(language: string): Promise<Translation | null> {
    const builtIn = bundled[language]
    const previous = cache.get(language)
    let texts: Texts | 'missing' | null
    try {
      texts = await fromTolgee(language)
    } catch {
      // Tolgee is down or slow: the last good answer, else the built-in copy.
      const value: Translation | null = previous?.fromTolgee
        ? { texts: { ...builtIn, ...previous.fromTolgee }, source: 'tolgee-stale' }
        : builtIn
          ? { texts: builtIn, source: 'bundled' }
          : null
      cache.set(language, { value, expires: now() + retryMs, fromTolgee: previous?.fromTolgee })
      return value
    }
    if (texts && texts !== 'missing') {
      const value: Translation = { texts: { ...builtIn, ...texts }, source: 'tolgee' }
      cache.set(language, { value, expires: now() + ttlMs, fromTolgee: texts })
      return value
    }
    const value: Translation | null = builtIn ? { texts: builtIn, source: 'bundled' } : null
    cache.set(language, { value, expires: now() + ttlMs })
    return value
  }

  async function get(language: string): Promise<Translation | null> {
    if (!isLanguageTag(language)) return null
    const cached = cache.get(language)
    if (cached && cached.expires > now()) return cached.value
    // One request to Tolgee per language at a time, however many arrive.
    let pending = inFlight.get(language)
    if (!pending) {
      pending = load(language).finally(() => inFlight.delete(language))
      inFlight.set(language, pending)
    }
    return pending
  }

  /** The HTTP answer for GET /i18n/<file>, e.g. "de.json". */
  async function respond(file: string): Promise<Response> {
    const language = /^(.+)\.json$/.exec(file)?.[1] ?? ''
    const translation = await get(language)
    if (!translation) {
      return Response.json({ error: `no translations for "${language}"` }, { status: 404 })
    }
    return Response.json(translation.texts, {
      headers: {
        'cache-control': `public, max-age=${Math.round(ttlMs / 1000)}`,
        'x-translations-source': translation.source,
      },
    })
  }

  return { get, respond }
}

/**
 * The language to render: a valid `lang` cookie, else the best match for the
 * browser's Accept-Language, else the base language.
 */
export function pickLanguage(
  languages: readonly string[],
  base: string,
  cookie: string | undefined,
  acceptLanguage: string | undefined,
): string {
  if (cookie && languages.includes(cookie)) return cookie
  const wanted = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1 }
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q)
  for (const { tag } of wanted) {
    const exact = languages.find((language) => language.toLowerCase() === tag.toLowerCase())
    if (exact) return exact
    const primary = languages.find((language) => language.toLowerCase() === tag.split('-')[0].toLowerCase())
    if (primary) return primary
  }
  return base
}
