// A stand-in for Tolgee's export API, for e2e/nginx/test.sh. Plain Node, no
// dependencies. It answers GET /v2/projects/<id>/export like Tolgee does and
// can be told to fail:
//   POST /__mode/ok | /__mode/error | /__mode/slow | /__mode/unknown-language
//   GET  /__last    the last export request it received (url + headers)
import { createServer } from 'node:http'

const API_KEY = process.env.MOCK_API_KEY ?? 'tgpak_test'
let mode = 'ok'
let last = null

createServer((req, res) => {
  const url = new URL(req.url, 'http://mock')
  if (req.method === 'POST' && url.pathname.startsWith('/__mode/')) {
    mode = url.pathname.slice('/__mode/'.length)
    return res.end(mode)
  }
  if (url.pathname === '/__last') {
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify(last))
  }
  const match = url.pathname.match(/^\/v2\/projects\/(\d+)\/export$/)
  if (!match) return res.writeHead(404).end()
  last = { url: req.url, headers: req.headers }
  if (req.headers['x-api-key'] !== API_KEY) return res.writeHead(401).end('{"code":"invalid_project_api_key"}')
  const language = url.searchParams.get('languages')
  if (mode === 'error') return res.writeHead(500).end('{"code":"unexpected_error_occurred"}')
  if (mode === 'unknown-language') return res.writeHead(404).end('{"code":"language_not_found"}')
  const send = () => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${language}.json"`,
      'set-cookie': 'tolgee=1',
    })
    res.end(JSON.stringify({ 'features.heading': `From Tolgee (${language})` }))
  }
  if (mode === 'slow') setTimeout(send, 10_000)
  else send()
}).listen(Number(process.env.PORT ?? 8085), () => console.log('mock tolgee listening'))
