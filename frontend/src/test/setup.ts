import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { resetMockState } from '../mocks/handlers'
import { server } from '../mocks/server'

// findBy*/waitFor give up after 1 s by default. The first render of a test file (cold imports,
// all workers busy) can take longer than that on a loaded machine, so allow 3 s.
configure({ asyncUtilTimeout: 3000 })

// A request without a handler fails the test, which keeps mocks in step with the contract.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetMockState()
})
afterAll(() => server.close())
