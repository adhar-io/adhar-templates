// Unit tests for the /i18n translations source. `npm test` runs them with
// Node's own test runner (Node 22.18+ runs TypeScript directly).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTranslationSource, flatten, pickLanguage, type TolgeeEnv } from './i18n.ts'

const bundled = {
  en: { 'home.title': 'Hello', 'home.only-in-code': 'New key' },
  de: { 'home.title': 'Hallo' },
}
const TOLGEE: TolgeeEnv = {
  TOLGEE_API_URL: 'http://tolgee.test/',
  TOLGEE_PROJECT_ID: '7',
  TOLGEE_API_KEY: 'tgpak_read',
}

// A fake Tolgee: records each request and answers with `reply`.
function fakeTolgee(reply: (url: URL) => Response | Promise<Response>) {
  const calls: { url: URL; headers: Headers }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: new Headers(init?.headers) })
    return reply(url)
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

function source(env: TolgeeEnv, fetch: typeof globalThis.fetch, clock = { t: 0 }) {
  return createTranslationSource({ env: () => env, bundled, fetch, now: () => clock.t, log: () => {} })
}

describe('createTranslationSource', () => {
  it('serves Tolgee’s texts over the built-in ones when Tolgee answers', async () => {
    const tolgee = fakeTolgee(() => Response.json({ 'home.title': 'Hello from Tolgee' }))
    const res = await source(TOLGEE, tolgee.fetch).respond('en.json')

    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-translations-source'), 'tolgee')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60')
    // Tolgee wins; a key only the code has keeps its built-in text.
    assert.deepEqual(await res.json(), { 'home.title': 'Hello from Tolgee', 'home.only-in-code': 'New key' })

    const [call] = tolgee.calls
    assert.equal(call.url.origin + call.url.pathname, 'http://tolgee.test/v2/projects/7/export')
    assert.equal(call.url.searchParams.get('languages'), 'en')
    assert.equal(call.url.searchParams.get('format'), 'JSON')
    assert.equal(call.url.searchParams.get('zip'), 'false')
    assert.equal(call.url.searchParams.get('structureDelimiter'), '')
    assert.equal(call.headers.get('x-api-key'), 'tgpak_read')
  })

  it('flattens a nested export', async () => {
    const tolgee = fakeTolgee(() => Response.json({ home: { title: 'Nested' } }))
    const translation = await source(TOLGEE, tolgee.fetch).get('en')
    assert.equal(translation?.texts['home.title'], 'Nested')
  })

  it('falls back to the built-in file when Tolgee is down', async () => {
    const tolgee = fakeTolgee(() => {
      throw new TypeError('fetch failed')
    })
    const res = await source(TOLGEE, tolgee.fetch).respond('de.json')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-translations-source'), 'bundled')
    assert.deepEqual(await res.json(), bundled.de)
  })

  it('falls back to the built-in file when Tolgee answers 5xx or 401', async () => {
    for (const status of [500, 503, 401]) {
      const tolgee = fakeTolgee(() => new Response('nope', { status }))
      const translation = await source(TOLGEE, tolgee.fetch).get('de')
      assert.deepEqual(translation, { texts: bundled.de, source: 'bundled' }, `status ${status}`)
    }
  })

  it('falls back to the built-in file when Tolgee does not answer in time', async () => {
    const tolgee = fakeTolgee(() => new Promise<Response>(() => {}))
    const slow = createTranslationSource({ env: () => TOLGEE, bundled, fetch: (url, init) => {
      // Honour the abort signal like a real fetch.
      const pending = tolgee.fetch(url, init)
      return Promise.race([pending, new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))])
    }, timeoutMs: 50, log: () => {} })
    // AbortSignal.timeout's timer does not keep Node alive on its own (a real
    // request would); hold the loop open while the test waits on it.
    const keepAlive = setTimeout(() => {}, 5_000)
    const started = Date.now()
    const translation = await slow.get('en').finally(() => clearTimeout(keepAlive))
    assert.equal(translation?.source, 'bundled')
    assert.ok(Date.now() - started < 1_000, 'gave up on Tolgee at the timeout')
  })

  it('serves the built-in file when Tolgee is not configured, without calling anything', async () => {
    for (const env of [{}, { ...TOLGEE, TOLGEE_API_KEY: '' }, { ...TOLGEE, TOLGEE_PROJECT_ID: undefined }]) {
      const tolgee = fakeTolgee(() => Response.json({}))
      const translation = await source(env, tolgee.fetch).get('en')
      assert.deepEqual(translation, { texts: bundled.en, source: 'bundled' })
      assert.equal(tolgee.calls.length, 0)
    }
  })

  it('answers 404 for a language neither Tolgee nor the app has, and for a malformed tag', async () => {
    const tolgee = fakeTolgee(() => new Response('{"code":"language_not_found"}', { status: 404 }))
    const translations = source(TOLGEE, tolgee.fetch)
    assert.equal((await translations.respond('fr.json')).status, 404)
    const asked = tolgee.calls.length
    for (const file of ['../en.json', 'en', 'en.json.bak', 'e.json', '.json', 'en%2F..%2Fx.json']) {
      assert.equal((await translations.respond(file)).status, 404, file)
    }
    // A malformed tag is refused before anything is sent to Tolgee.
    assert.equal(tolgee.calls.length, asked)
    // A language only the app has is served from the built-in file.
    const de = await translations.get('de')
    assert.equal(de?.source, 'bundled')
  })

  it('serves a language that only Tolgee has', async () => {
    const tolgee = fakeTolgee(() => Response.json({ 'home.title': 'Bonjour' }))
    assert.deepEqual(await source(TOLGEE, tolgee.fetch).get('fr'), { texts: { 'home.title': 'Bonjour' }, source: 'tolgee' })
  })

  it('caches for the TTL and asks Tolgee once for concurrent requests', async () => {
    const clock = { t: 0 }
    const tolgee = fakeTolgee(() => Response.json({ 'home.title': `v${clock.t}` }))
    const translations = source(TOLGEE, tolgee.fetch, clock)
    await Promise.all([translations.get('en'), translations.get('en'), translations.get('en')])
    assert.equal(tolgee.calls.length, 1)

    clock.t = 59_000
    assert.equal((await translations.get('en'))?.texts['home.title'], 'v0')
    assert.equal(tolgee.calls.length, 1)

    clock.t = 61_000
    assert.equal((await translations.get('en'))?.texts['home.title'], 'v61000')
    assert.equal(tolgee.calls.length, 2)
  })

  it('keeps serving the last texts Tolgee gave while it is down, and does not hammer it', async () => {
    const clock = { t: 0 }
    let up = true
    const tolgee = fakeTolgee(() => (up ? Response.json({ 'home.title': 'From Tolgee' }) : new Response('', { status: 502 })))
    const translations = source(TOLGEE, tolgee.fetch, clock)
    await translations.get('en')

    up = false
    clock.t = 61_000
    assert.deepEqual(await translations.get('en'), {
      texts: { 'home.title': 'From Tolgee', 'home.only-in-code': 'New key' },
      source: 'tolgee-stale',
    })
    clock.t = 65_000 // within the retry interval: no new request
    await translations.get('en')
    assert.equal(tolgee.calls.length, 2)
  })
})

describe('pickLanguage', () => {
  const languages = ['en', 'de', 'pt-BR']
  it('prefers a valid cookie', () => {
    assert.equal(pickLanguage(languages, 'en', 'de', 'en-US'), 'de')
    assert.equal(pickLanguage(languages, 'en', 'xx', 'de-DE'), 'de')
  })
  it('matches Accept-Language by quality, exact tag, then primary subtag', () => {
    assert.equal(pickLanguage(languages, 'en', undefined, 'fr;q=0.9, de-AT;q=0.8, en;q=0.5'), 'de')
    assert.equal(pickLanguage(languages, 'en', undefined, 'pt-BR'), 'pt-BR')
    assert.equal(pickLanguage(languages, 'en', undefined, 'de;q=0'), 'en')
  })
  it('falls back to the base language', () => {
    assert.equal(pickLanguage(languages, 'en', undefined, undefined), 'en')
    assert.equal(pickLanguage(languages, 'en', undefined, 'ja'), 'en')
  })
})

describe('flatten', () => {
  it('flattens nested objects and drops non-strings', () => {
    assert.deepEqual(flatten({ a: { b: 'x', c: 1 }, d: 'y' }), { 'a.b': 'x', d: 'y' })
  })
})
