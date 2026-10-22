// Unit tests for the server's Prometheus metrics (metrics.mjs).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMetrics, routeOf } from './metrics.mjs'

describe('routeOf', () => {
  it('keeps the uri label a bounded route template', () => {
    assert.equal(routeOf('/'), '/')
    assert.equal(routeOf('/api/hello'), '/api/hello')
    assert.equal(routeOf('/api/orders/12345'), '/api/orders/{id}')
    assert.equal(routeOf('/api/orders/3f2c1a9e-6b1d-4c3a-9f1e-1234567890ab/items'), '/api/orders/{id}/items')
    assert.equal(routeOf('/assets/index-abc123.js'), '/assets/**')
    assert.equal(routeOf('/adhar-symbol.svg'), '/{static}')
    assert.equal(routeOf('/i18n/de.json'), '/i18n/{file}')
    assert.equal(routeOf('/ingest/i/v0/e/'), '/ingest/**')
    assert.equal(routeOf('/a/b/c/d/e/f'), '/a/b/c/d')
  })
})

describe('createMetrics', () => {
  it('records requests under the names the platform dashboard reads', async () => {
    const { registry, middleware } = createMetrics()
    await middleware(new Request('http://app/api/orders/42'), () => new Response('ok', { status: 201 }))
    await middleware(new Request('http://app/api/orders/43'), () => new Response('no', { status: 503 }))
    const text = await registry.metrics()
    assert.match(text, /http_server_requests_seconds_count\{method="GET",uri="\/api\/orders\/\{id\}",status="201"\} 1/)
    assert.match(text, /http_server_requests_seconds_count\{method="GET",uri="\/api\/orders\/\{id\}",status="503"\} 1/)
    assert.match(text, /http_server_requests_seconds_bucket\{le="0\.25",/)
    assert.match(text, /nodejs_heap_size_used_bytes/)
  })

  it('counts a request the app throws on as a 500', async () => {
    const { registry, middleware } = createMetrics()
    await assert.rejects(middleware(new Request('http://app/boom'), () => { throw new Error('boom') }))
    assert.match(await registry.metrics(), /uri="\/boom",status="500"\} 1/)
  })
})
