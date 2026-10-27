'use strict'
// ${{ values.name }}: an HTTP function on Adhar's Function API (Knative).
//
// Knative starts this process on demand, sends it requests on $PORT (8080) and
// scales it to zero when no request has arrived for a while. Events from the
// function's trigger arrive as HTTP POSTs too: a CloudEvent in binary mode
// (ce-* headers) from a schedule or a Broker, or a Dapr topic delivery.
const http = require('node:http')

const NAME = process.env.FUNCTION_NAME || ${{ values.name | dump }}
const RUNTIME = process.env.FUNCTION_RUNTIME || 'node24'
const TRIGGER = process.env.FUNCTION_TRIGGER || 'http'
// Requests larger than this are refused rather than buffered.
const MAX_BODY = 1024 * 1024

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  })
  res.end(json)
}

// The function. Replace the body of `invoke` with what yours does.
async function invoke(req, body) {
  return {
    ok: true,
    function: NAME,
    runtime: RUNTIME,
    trigger: TRIGGER,
    method: req.method,
    path: new URL(req.url, 'http://function.local').pathname,
    event: req.headers['ce-type'] || null,
    received: body.length,
    at: new Date().toISOString(),
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handle(req, res) {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      send(res, 200, { ok: true, at: new Date().toISOString() })
      return
    }
    const body = await readBody(req)
    send(res, 200, await invoke(req, body))
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: err.message }))
    if (!res.headersSent) send(res, err.status || 500, { ok: false, error: err.message })
  }
}

function createServer() {
  return http.createServer(handle)
}

module.exports = { createServer, handle, invoke }

if (require.main === module) {
  const port = Number(process.env.PORT || 8080)
  const server = createServer()
  server.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', msg: 'listening', function: NAME, port }))
  })
  // Knative sends SIGTERM before it scales an instance away: finish what is
  // in flight, then exit.
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
}
