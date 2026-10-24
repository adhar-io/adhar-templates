{% if values.withCms -%}
// A stand-in for Strapi's REST API, for e2e/nginx/test.sh. Plain Node, no
// dependencies. It answers like Strapi 5 does for a collection type and serves
// one upload:
//   GET /api/<type>        { data: [...], meta: { pagination } }, Bearer token required
//   GET /api/users         what a read-only token could see, to prove nginx never asks
//   GET /uploads/cat.png   a public media file, no token
//   GET /__last            the last request it received (method, url, headers) and a count
import { createServer } from 'node:http'

const TOKEN = process.env.MOCK_API_TOKEN ?? 'test-strapi-token'
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
let last = null
let count = 0

createServer((req, res) => {
  const url = new URL(req.url, 'http://mock')
  if (url.pathname === '/__last') {
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify({ ...last, count }))
  }
  last = { method: req.method, url: req.url, headers: req.headers }
  count++
  if (url.pathname === '/uploads/cat.png') {
    return res.writeHead(200, { 'content-type': 'image/png', 'set-cookie': 'strapi=1' }).end(PNG)
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.writeHead(401, { 'content-type': 'application/json' }).end('{"data":null,"error":{"status":401,"name":"UnauthorizedError"}}')
  }
  const type = url.pathname.match(/^\/api\/([a-z][a-z0-9-]*)$/)?.[1]
  if (!type) return res.writeHead(404, { 'content-type': 'application/json' }).end('{"data":null,"error":{"status":404,"name":"NotFoundError"}}')
  const locale = url.searchParams.get('locale') ?? 'en'
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'strapi=1', 'cache-control': 'no-cache' })
  res.end(
    JSON.stringify({
      data: [{ id: 1, documentId: 'a1', title: `Hello from Strapi (${locale})`, publishedAt: '2026-10-01T09:00:00.000Z', locale, type }],
      meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    }),
  )
}).listen(Number(process.env.PORT ?? 8087), () => console.log('mock strapi listening'))
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false), so
// e2e/nginx/test.sh has no Strapi to stand in for.
export {}
{%- endif %}
