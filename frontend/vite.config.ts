import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In docker-compose.dev.yml this is http://backend:8000; locally it's the default.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
