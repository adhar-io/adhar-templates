import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
{%- if values.withLocalisation %}
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// src/i18n/<language>.json are the translations built into the image. This
// plugin copies them to dist/i18n/, where nginx serves them at /i18n/ whenever
// Tolgee is not configured or not answering (nginx-i18n.conf), and serves them
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

export default defineConfig({
  plugins: [react(), tailwindcss(){% if values.withLocalisation %}, bundledTranslations(){% endif %}],
  // @adhar-ui/react ships TypeScript source; let Vite transpile it.
  optimizeDeps: {
    include: ['@adhar-ui/react', '@adhar-ui/utils', '@adhar-ui/icons'],
  },
})
