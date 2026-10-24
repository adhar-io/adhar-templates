{% if values.withCms -%}
// Unit tests for the /cms/ and /uploads/ proxy (cms.mjs). `npm test` runs them
// with Node's own test runner.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cmsMiddleware, createCmsProxy, DEFAULT_STRAPI_URL } from './cms.mjs'

const TOKEN = 'test-strapi-token'
const next = () => new Response('the app')

/** A stand-in for Strapi that records what it was asked. */
function strapi(answer: (url: string) => Response = () => Response.json({ data: [{ id: 1, title: 'Hello' }], meta: {} })) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    return answer(String(url))
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

describe('without a token', () => {
  it('answers /cms/ with an empty, uncached 200 marked X-Cms: off, and asks no one', async () => {
    const { calls, fetch } = strapi()
    const res = await createCmsProxy({ env: () => ({}), fetch })(new Request('http://app/cms/articles'))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-cms'), 'off')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), { data: null, meta: { cms: 'off' } })
    assert.equal(calls.length, 0)
  })

  it('answers /uploads/ with 404', async () => {
    const res = await createCmsProxy({ env: () => ({}) })(new Request('http://app/uploads/cat.png'))
    assert.equal(res.status, 404)
  })
})

describe('with a token', () => {
  const env = () => ({ STRAPI_API_TOKEN: TOKEN })

  it("turns /cms/<path> into Strapi's /api/<path> with the query and the token, and nothing from the browser", async () => {
    const { calls, fetch } = strapi()
    const res = await createCmsProxy({ env, fetch })(
      new Request('http://app/cms/articles?locale=de&pagination%5BpageSize%5D=3', { headers: { cookie: 'session=1', authorization: 'Bearer browser' } }),
    )
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-cms'), 'strapi')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60')
    assert.equal((await res.json()).data[0].title, 'Hello')
    assert.equal(calls[0].url, `${DEFAULT_STRAPI_URL}/api/articles?locale=de&pagination%5BpageSize%5D=3`)
    const sent = new Headers(calls[0].init.headers)
    assert.equal(sent.get('authorization'), `Bearer ${TOKEN}`)
    assert.equal(sent.get('cookie'), null)
  })

  it('uses STRAPI_URL when set', async () => {
    const { calls, fetch } = strapi()
    await createCmsProxy({ env: () => ({ STRAPI_API_TOKEN: TOKEN, STRAPI_URL: 'http://cms.test:1337/' }), fetch })(new Request('http://app/cms/pages'))
    assert.equal(calls[0].url, 'http://cms.test:1337/api/pages')
  })

  it("drops Strapi's cookies and caching headers", async () => {
    const { fetch } = strapi(() => new Response('{}', { headers: { 'content-type': 'application/json', 'set-cookie': 'strapi=1', 'cache-control': 'no-cache' } }))
    const res = await createCmsProxy({ env, fetch })(new Request('http://app/cms/articles'))
    assert.equal(res.headers.get('set-cookie'), null)
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60')
  })

  it('refuses anything but GET and HEAD, without asking Strapi', async () => {
    const { calls, fetch } = strapi()
    const res = await createCmsProxy({ env, fetch })(new Request('http://app/cms/articles', { method: 'POST', body: '{}' }))
    assert.equal(res.status, 403)
    assert.equal(calls.length, 0)
  })

  it("never proxies Strapi's users, auth endpoints or media library listing", async () => {
    const { calls, fetch } = strapi()
    const proxy = createCmsProxy({ env, fetch })
    for (const path of ['/cms/users', '/cms/users/1', '/cms/users-permissions/roles', '/cms/auth/local', '/cms/connect/google', '/cms/upload/files']) {
      assert.equal((await proxy(new Request(`http://app${path}`))).status, 404, path)
    }
    assert.equal(calls.length, 0)
  })

  it("passes Strapi's own errors through", async () => {
    const { fetch } = strapi(() => Response.json({ error: { status: 400, name: 'ValidationError' } }, { status: 400 }))
    assert.equal((await createCmsProxy({ env, fetch })(new Request('http://app/cms/articles?locale=xx'))).status, 400)
  })

  it('serves /uploads/ without the token, cached for a day', async () => {
    const { calls, fetch } = strapi(() => new Response('png', { headers: { 'content-type': 'image/png' } }))
    const res = await createCmsProxy({ env, fetch })(new Request('http://app/uploads/cat_1a2b.png'))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400')
    assert.equal(calls[0].url, `${DEFAULT_STRAPI_URL}/uploads/cat_1a2b.png`)
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), null)
  })

  it('answers 502 when Strapi cannot be reached', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch
    assert.equal((await createCmsProxy({ env, fetch })(new Request('http://app/cms/articles'))).status, 502)
  })
})

describe('cmsMiddleware', () => {
  it('answers /cms/ and /uploads/ and passes every other request to the app', async () => {
    const middleware = cmsMiddleware({ env: () => ({}) })
    assert.equal((await middleware(new Request('http://app/cms/articles'), next)).headers.get('x-cms'), 'off')
    assert.equal((await middleware(new Request('http://app/uploads/a.png'), next)).status, 404)
    assert.equal(await (await middleware(new Request('http://app/cmsx'), next)).text(), 'the app')
    assert.equal(await (await middleware(new Request('http://app/'), next)).text(), 'the app')
  })
})
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false), so
// there is nothing to test here.
export {}
{%- endif %}
