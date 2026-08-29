import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @adhar-ui/react ships TypeScript source; let Vite transpile it.
  optimizeDeps: {
    include: ['@adhar-ui/react', '@adhar-ui/utils', '@adhar-ui/icons'],
  },
})
