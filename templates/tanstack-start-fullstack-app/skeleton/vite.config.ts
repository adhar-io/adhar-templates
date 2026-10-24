import { defineConfig{% if values.withCms %}, loadEnv, type Plugin{% endif %} } from 'vite'
{%- if values.withCms %}
import type { IncomingMessage, ServerResponse } from 'node:http'
{%- endif %}
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
{%- if values.withCms %}

// /cms/ and /uploads/ under `npm run dev` and `vite preview`, behaving as the
// production server does (src/server/cms.mjs): Strapi's /api/ with the token added
// here, GET only, its user and auth endpoints refused. STRAPI_URL and
// STRAPI_API_TOKEN come from .env.development.local (git-ignored) or the shell;
// no VITE_ prefix, so neither ever reaches the bundle. Without a token /cms/
// answers an empty 200 with X-Cms: off, as an unconfigured environment does.
const CMS_REFUSED = /^\/cms\/(users|users-permissions|auth|connect|upload)(\/|\?|$)/

function strapiProxy(): Plugin {
  let token = ''
  const guard = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/cms/')) return next()
    if (!token) {
      res.writeHead(200, { 'content-type': 'application/json', 'x-cms': 'off', 'cache-control': 'no-store' })
      return res.end('{"data":null,"meta":{"cms":"off"}}')
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(403, { 'x-cms': 'strapi' }).end()
    if (CMS_REFUSED.test(req.url)) return res.writeHead(404, { 'x-cms': 'strapi' }).end()
    next()
  }
  return {
    name: 'strapi-proxy',
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), 'STRAPI_')
      token = env.STRAPI_API_TOKEN ?? ''
      if (!token) return
      const target = env.STRAPI_URL || 'http://localhost:1337'
      const proxy = {
        '/cms/': {
          target,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/cms\//, '/api/'),
          headers: { authorization: `Bearer ${token}`, cookie: '' },
        },
        '/uploads/': { target, changeOrigin: true, headers: { cookie: '' } },
      }
      return { server: { proxy }, preview: { proxy } }
    },
    configureServer: (server) => void server.middlewares.use(guard),
    configurePreviewServer: (server) => void server.middlewares.use(guard),
  }
}
{%- endif %}

export default defineConfig({
  server: { port: ${{ values.port }} },
  // tanstackStart() must come before viteReact().
  plugins: [tailwindcss(), tanstackStart(), viteReact(){% if values.withCms %}, strapiProxy(){% endif %}],
  // @adhar-ui/react ships TypeScript source; let Vite transpile it.
  optimizeDeps: {
    include: ['@adhar-ui/react', '@adhar-ui/utils'],
  },
})
