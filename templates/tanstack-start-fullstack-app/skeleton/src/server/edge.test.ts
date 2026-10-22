// Unit tests for /runtime-config.json{% if values.withAnalytics %} and the /ingest proxy{% endif %} (edge.mjs).
// `npm test` runs them with Node's own test runner.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { {% if values.withAnalytics %}createIngestProxy, {% endif %}runtimeConfig, telemetryMiddleware } from './edge.mjs'

const next = () => new Response('the app')

describe('runtimeConfig', () => {
  it('turns everything off when nothing is configured', () => {
    assert.deepEqual(runtimeConfig({}), { environment: '', faro: { url: '' }{% if values.withAnalytics %}, posthog: null{% endif %} })
  })

  it('carries the environment and the Faro receiver', () => {
    const config = runtimeConfig({ APP_ENVIRONMENT: 'prod', FARO_URL: 'https://faro.example.test/collect' })
    assert.equal(config.environment, 'prod')
    assert.equal(config.faro.url, 'https://faro.example.test/collect')
  })
{%- if values.withAnalytics %}

  it('offers PostHog only with both a key and a host, and always same-origin', () => {
    assert.equal(runtimeConfig({ POSTHOG_KEY: 'phc_x' }).posthog, null)
    assert.equal(runtimeConfig({ POSTHOG_HOST: 'http://posthog' }).posthog, null)
    assert.deepEqual(runtimeConfig({ POSTHOG_KEY: 'phc_x', POSTHOG_HOST: 'http://posthog' }).posthog, {
      key: 'phc_x',
      apiHost: '/ingest',
      uiHost: '',
      replay: '',
    })
  })
{%- endif %}
})

describe('telemetryMiddleware', () => {
  it('answers GET /runtime-config.json from the environment, uncached', async () => {
    const middleware = telemetryMiddleware({ env: () => ({ APP_ENVIRONMENT: 'dev' }) })
    const res = await middleware(new Request('http://app/runtime-config.json'), next)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    assert.equal((await res.json()).environment, 'dev')
  })

  it('passes every other request to the app', async () => {
    const middleware = telemetryMiddleware({ env: () => ({}) })
    assert.equal(await (await middleware(new Request('http://app/runtime-config.json.bak'), next)).text(), 'the app')
    assert.equal(await (await middleware(new Request('http://app/'), next)).text(), 'the app')
  })
})
{%- if values.withAnalytics %}

describe('the /ingest proxy', () => {
  const env = () => ({ POSTHOG_KEY: 'phc_x', POSTHOG_HOST: 'http://posthog-events.test:8000/' })

  function fakePostHog(reply: () => Response | Promise<Response> = () => new Response('{"status":1}', { headers: { 'set-cookie': 'ph=1', 'content-type': 'application/json' } })) {
    const calls: { url: string; init: RequestInit }[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      return reply()
    }) as typeof globalThis.fetch
    return { calls, fetch }
  }

  it('answers 404 and forwards nothing without a key', async () => {
    const posthog = fakePostHog()
    const res = await createIngestProxy({ env: () => ({ POSTHOG_HOST: 'http://posthog' }), fetch: posthog.fetch })(new Request('http://app/ingest/e/'))
    assert.equal(res.status, 404)
    assert.equal(posthog.calls.length, 0)
  })

  it('forwards to PostHog without the prefix, with the query and the body', async () => {
    const posthog = fakePostHog()
    const res = await createIngestProxy({ env, fetch: posthog.fetch })(
      new Request('http://app/ingest/i/v0/e/?compression=gzip-js', { method: 'POST', body: 'payload', headers: { 'content-type': 'text/plain' } }),
    )
    assert.equal(res.status, 200)
    assert.equal(posthog.calls[0].url, 'http://posthog-events.test:8000/i/v0/e/?compression=gzip-js')
    assert.equal(posthog.calls[0].init.method, 'POST')
    assert.equal(new TextDecoder().decode(posthog.calls[0].init.body as ArrayBuffer), 'payload')
    assert.equal(new Headers(posthog.calls[0].init.headers).get('content-type'), 'text/plain')
  })

  it('forwards no cookie, credential or visitor address, and returns no cookie', async () => {
    const posthog = fakePostHog()
    const res = await createIngestProxy({ env, fetch: posthog.fetch })(
      new Request('http://app/ingest/e/', {
        method: 'POST',
        body: '{}',
        headers: { cookie: 'session=secret', authorization: 'Bearer user', 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.7' },
      }),
    )
    const sent = new Headers(posthog.calls[0].init.headers)
    for (const name of ['cookie', 'authorization', 'x-forwarded-for', 'x-real-ip']) assert.equal(sent.get(name), null, name)
    assert.equal(res.headers.get('set-cookie'), null)
  })

  it('answers 502 when PostHog cannot be reached', async () => {
    const posthog = fakePostHog(() => Promise.reject(new TypeError('fetch failed')))
    const res = await createIngestProxy({ env, fetch: posthog.fetch })(new Request('http://app/ingest/e/', { method: 'POST', body: '{}' }))
    assert.equal(res.status, 502)
  })
})
{%- endif %}
