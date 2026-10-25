const http = require('http')

const port = Number(process.env.PORT || 8080)

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const now = new Date().toISOString()
  if (req.method === 'GET' && req.url === '/healthz') {
    sendJson(res, { ok: true, at: now })
    return
  }
  sendJson(res, {
    ok: true,
    function: process.env.FUNCTION_NAME || 'unknown',
    runtime: process.env.FUNCTION_RUNTIME || 'node20',
    trigger: process.env.FUNCTION_TRIGGER || 'http',
    at: now,
  })
})

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`function listening on ${port}`)
})
