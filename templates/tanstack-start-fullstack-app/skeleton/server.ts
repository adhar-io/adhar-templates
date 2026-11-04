// Production server. `vite build` emits the app as a fetch handler
// (dist/server/server.js) plus static client assets (dist/client); srvx runs
// both on Node. PORT comes from the Rollout.
//
// TypeScript that Node runs as it is: Node 24 (`engines` in package.json, the
// runtime the image ships) strips the types itself, so `npm start` is
// `node server.ts`, with no compile step. That is why imports name the .ts
// files, and why src/server/ keeps to erasable TypeScript (no enum, namespace
// or parameter property — `erasableSyntaxOnly` in tsconfig.json).
import { createServer } from 'node:http'
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import { createMetrics } from './src/server/metrics.ts'
import { telemetryMiddleware } from './src/server/edge.ts'
{%- if values.withCms %}
import { cmsMiddleware } from './src/server/cms.ts'
{%- endif %}

/** What `vite build` writes to dist/server/server.js: the app as a fetch handler. */
interface App {
  fetch: (request: Request) => Response | Promise<Response>
}

// Loaded when the server starts rather than imported: it is build output, so
// type-checking (`npm run typecheck`, before any build) must not depend on it.
const { default: app } = (await import(new URL('./dist/server/server.js', import.meta.url).href)) as { default: App }

const metrics = createMetrics()

serve({
  port: Number(process.env.PORT ?? ${{ values.port }}),
  // Timing first, so it sees every request; then /runtime-config.json{% if values.withAnalytics %} and
  // /ingest (src/server/edge.ts){% endif %}{% if values.withCms %}, /cms and /uploads (Strapi, src/server/cms.ts){% endif %}, the static client files and the app.
  middleware: [metrics.middleware, telemetryMiddleware(), {% if values.withCms %}cmsMiddleware(), {% endif %}staticMiddleware({ dir: 'dist/client' })],
  fetch: app.fetch,
})

// GET /metrics for Prometheus, on a port the HTTPRoute does not expose. A port
// that is taken costs the metrics, never the app: an unhandled listen error
// would otherwise take the whole server down with it.
const metricsPort = Number(process.env.METRICS_PORT ?? 9464)
const metricsServer = createServer(async (req, res) => {
  if (req.url !== '/metrics') return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': metrics.registry.contentType })
  res.end(await metrics.registry.metrics())
})
  .on('error', (error) => console.warn(`metrics endpoint not started on :${metricsPort}: ${error.message}`))
  .listen(metricsPort)

// srvx stops the app gracefully on SIGTERM (a rollout, a scale-down) and on
// SIGINT. The metrics endpoint stops with it: left open, its listener would keep
// the process alive until the kubelet's SIGKILL, so every Pod would take the
// whole termination grace period to go.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (!metricsServer.listening) return
    metricsServer.close()
    metricsServer.closeIdleConnections()
  })
}
