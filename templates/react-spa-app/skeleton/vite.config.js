import { defineConfig{% if values.withCms %}, loadEnv{% endif %} } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
{%- if values.withLocalisation %}
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// src/i18n/<language>.json are the translations built into the image. This
// plugin copies them to dist/i18n/, where nginx serves them at /i18n/ whenever
// Tolgee is not configured or not answering (nginx-app.conf), and serves them
// at the same path under `npm run dev` / `vite preview`.
function bundledTranslations() {
  const dir = fileURLToPath(new URL('./src/i18n/', import.meta.url))
  const files = () => readdirSync(dir).filter((file) => /^[A-Za-z0-9-]+\.json$/.test(file))
  return {
    name: 'bundled-translations',
    configureServer(server) {
      server.middlewares.use('/i18n', (req, res, next) => {
        const file = (req.url ?? '').replace(/^\//, '').split('?')[0]
        if (!files().includes(file)) return next()
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(readFileSync(dir + file))
      })
    },
    generateBundle() {
      for (const file of files()) {
        // Parsed and re-serialised, so a malformed file fails the build here
        // rather than the page in production.
        const source = JSON.stringify(JSON.parse(readFileSync(dir + file, 'utf8')))
        this.emitFile({ type: 'asset', fileName: `i18n/${file}`, source })
      }
    },
  }
}
{%- endif %}

{%- if values.withCms %}

// /cms/ and /uploads/ under `npm run dev` and `vite preview`, behaving as nginx
// does in the cluster (nginx-app.conf): Strapi's /api/ with the token added
// here, GET only, its user and auth endpoints refused. STRAPI_URL and
// STRAPI_API_TOKEN come from .env.development.local (git-ignored) or the shell;
// no VITE_ prefix, so neither ever reaches the bundle. Without a token /cms/
// answers an empty 200 with X-Cms: off, as an unconfigured environment does.
const CMS_REFUSED = /^\/cms\/(users|users-permissions|auth|connect|upload)(\/|\?|$)/

function strapiProxy() {
  let token = ''
  const guard = (req, res, next) => {
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
          rewrite: (path) => path.replace(/^\/cms\//, '/api/'),
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

// The version telemetry reports (src/telemetry.js): package.json's.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss(){% if values.withLocalisation %}, bundledTranslations(){% endif %}{% if values.withCms %}, strapiProxy(){% endif %}],
  // @adhar-ui/react ships TypeScript source; let Vite transpile it.
  optimizeDeps: {
    include: ['@adhar-ui/react', '@adhar-ui/utils', '@adhar-ui/icons'],
  },
})
