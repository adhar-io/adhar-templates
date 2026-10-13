// Production server. `vite build` emits the app as a fetch handler
// (dist/server/server.js) plus static client assets (dist/client); srvx runs
// both on Node. PORT comes from the Rollout.
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import app from './dist/server/server.js'

serve({
  port: Number(process.env.PORT ?? ${{ values.port }}),
  middleware: [staticMiddleware({ dir: 'dist/client' })],
  fetch: app.fetch,
})
