import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { port: ${{ values.port }} },
  // tanstackStart() must come before viteReact().
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
  // @adhar-ui/react ships TypeScript source; let Vite transpile it.
  optimizeDeps: {
    include: ['@adhar-ui/react', '@adhar-ui/utils'],
  },
})
