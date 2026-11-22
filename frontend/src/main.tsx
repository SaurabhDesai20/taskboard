import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './index.css'

async function enableMocking(): Promise<void> {
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
