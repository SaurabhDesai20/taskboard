import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
// Inter, self-hosted: the CSP only allows fonts from the app itself (font-src 'self').
import '@fontsource-variable/inter'
import './index.css'
import { applyTheme, storedTheme } from './lib/theme'

// A saved theme choice applies before the first render (no flash of the other theme).
applyTheme(storedTheme())

async function enableMocking(): Promise<void> {
  // `import.meta.env.DEV` is false in a production build, so the MSW import below is dropped.
  if (!import.meta.env.DEV || import.meta.env.VITE_API_MOCKING !== 'true') {
    return
  }
  const { worker } = await import('./mocks/browser')
  // Requests without a mock handler go through to the real backend via the Vite proxy.
  await worker.start({ onUnhandledFrame: 'bypass' })
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

void enableMocking().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
