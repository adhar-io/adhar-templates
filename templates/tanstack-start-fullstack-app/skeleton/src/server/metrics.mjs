// Prometheus metrics of the production server (server.mjs), served on their own
// port (METRICS_PORT, 9464) so they are never reachable through the app's
// public route. deploy/base/podmonitor.yaml has Prometheus scrape them.
//
// The request histogram uses the names Spring's Micrometer publishes
// (http_server_requests_seconds, labels method/uri/status), so the platform's
// per-application Grafana dashboard reads it with no change: requests per
// second by status, error ratio, latency percentiles and per-route tables.
import { Histogram, Registry, collectDefaultMetrics } from 'prom-client'

// SLO buckets the dashboard's "Latency Buckets (SLO)" panel reads (0.1…2 s).
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]

/**
 * The `uri` label: a route TEMPLATE, never the raw path, so the number of series
 * stays bounded however many distinct URLs are requested.
 * @param {string} pathname
 */
export function routeOf(pathname) {
  if (pathname === '/') return '/'
  if (pathname === '/runtime-config.json') return pathname
  if (pathname.startsWith('/ingest/')) return '/ingest/**'
  if (pathname.startsWith('/i18n/')) return '/i18n/{file}'
  if (pathname.startsWith('/assets/')) return '/assets/**'
  if (/\.[A-Za-z0-9]{1,8}$/.test(pathname)) return '/{static}'
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .slice(0, 4)
    .map((s) => (/^\d+$|^[0-9a-f]{8,}$|^[0-9a-f-]{36}$|^[A-Za-z0-9_-]{24,}$/i.test(s) ? '{id}' : s.length > 40 ? '{value}' : s))
  return '/' + segments.join('/')
}

export function createMetrics() {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })
  const requests = new Histogram({
    name: 'http_server_requests_seconds',
    help: 'HTTP requests served, by method, route template and status',
    labelNames: ['method', 'uri', 'status'],
    buckets: BUCKETS,
    registers: [registry],
  })

  /** A srvx middleware that times every request. */
  const middleware = async (request, next) => {
    const end = requests.startTimer({ method: request.method, uri: routeOf(new URL(request.url).pathname) })
    try {
      const response = await next()
      end({ status: String(response.status) })
      return response
    } catch (error) {
      end({ status: '500' })
      throw error
    }
  }
  return { registry, middleware }
}
