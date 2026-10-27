'use strict'
// The function's tests. `npm test` runs them (node --test), locally and in
// app-ci, on the Node.js version project.toml pins.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('../index.js')

const server = createServer()
let base = ''

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

test('GET /healthz answers ok', async () => {
  const res = await fetch(`${base}/healthz`)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).ok, true)
})

test('GET / invokes the function', async () => {
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.method, 'GET')
  assert.equal(body.event, null)
})

test('a CloudEvent POSTed to / is handled', async () => {
  const res = await fetch(`${base}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'ce-type': 'com.example.ping', 'ce-source': 'test', 'ce-id': '1', 'ce-specversion': '1.0' },
    body: JSON.stringify({ hello: 'world' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.event, 'com.example.ping')
  assert.equal(body.received, 17)
})
