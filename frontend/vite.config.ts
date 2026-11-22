import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Dev server on :5173 proxies /api (HTTP) and /api/ws (WebSocket) to FastAPI on :8000,
// so the browser always talks to one origin and the auth cookie just works.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
