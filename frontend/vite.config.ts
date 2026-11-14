import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In docker-compose.dev.yml this is http://backend:8000; locally it's the default.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
