// Production server. `vite build` emits the app as a fetch handler
// (dist/server/server.js) plus static client assets (dist/client); srvx runs
// both on Node. PORT comes from the Rollout.
import { createServer } from 'node:http'
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import app from './dist/server/server.js'
import { createMetrics } from './src/server/metrics.mjs'
import { telemetryMiddleware } from './src/server/edge.mjs'
{%- if values.withCms %}
import { cmsMiddleware } from './src/server/cms.mjs'
{%- endif %}

const metrics = createMetrics()

serve({
  port: Number(process.env.PORT ?? ${{ values.port }}),
  // Timing first, so it sees every request; then /runtime-config.json{% if values.withAnalytics %} and
  // /ingest (src/server/edge.mjs){% endif %}{% if values.withCms %}, /cms and /uploads (Strapi, src/server/cms.mjs){% endif %}, the static client files and the app.
  middleware: [metrics.middleware, telemetryMiddleware(), {% if values.withCms %}cmsMiddleware(), {% endif %}staticMiddleware({ dir: 'dist/client' })],
  fetch: app.fetch,
})

// GET /metrics for Prometheus, on a port the HTTPRoute does not expose. A port
// that is taken costs the metrics, never the app: an unhandled listen error
// would otherwise take the whole server down with it.
const metricsPort = Number(process.env.METRICS_PORT ?? 9464)
createServer(async (req, res) => {
  if (req.url !== '/metrics') return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': metrics.registry.contentType })
  res.end(await metrics.registry.metrics())
})
  .on('error', (error) => console.warn(`metrics endpoint not started on :${metricsPort}: ${error.message}`))
  .listen(metricsPort)
