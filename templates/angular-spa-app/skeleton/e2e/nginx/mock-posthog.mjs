// A stand-in for PostHog's capture service, for e2e/nginx/test.sh. Plain Node,
// no dependencies. It answers every request with 200 and remembers the last one:
//   GET /__last   the last request it received (method, url, headers, body size)
import { createServer } from 'node:http'

let last = null

createServer((req, res) => {
  if (req.url === '/__last') {
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify(last))
  }
  let size = 0
  req.on('data', (chunk) => (size += chunk.length))
  req.on('end', () => {
    last = { method: req.method, url: req.url, headers: req.headers, size }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'ph_mock=1' })
    res.end('{"status":1}')
  })
}).listen(Number(process.env.PORT ?? 8086), () => console.log('mock posthog listening'))
