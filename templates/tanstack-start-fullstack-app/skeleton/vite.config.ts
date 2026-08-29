import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart()],
  // @adhar-ui/react ships TypeScript source; let Vite transpile it.
  optimizeDeps: {
    include: ['@adhar-ui/react', '@adhar-ui/utils'],
  },
})
