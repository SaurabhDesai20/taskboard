import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * `public/mockServiceWorker.js` is MSW's browser worker, needed only by the dev server with
 * VITE_API_MOCKING=true. Vite copies everything in `public/` into the build, so this removes it
 * again: the production bundle ships without MSW.
 */
function dropMockServiceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'taskboard:drop-mock-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      rmSync(resolve(outDir, 'mockServiceWorker.js'), { force: true })
    },
  }
}

// Dev server on :5173 proxies /api (HTTP) and /api/ws (WebSocket) to FastAPI on :8000,
// so the browser always talks to one origin and the auth cookie just works. In production
// FastAPI serves the built files itself, from the same origin, at any deep link: assets are
// referenced from the site root (`base: '/'`) and the API from the relative `/api`.
export default defineConfig({
  base: '/',
  plugins: [react(), dropMockServiceWorker()],
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
