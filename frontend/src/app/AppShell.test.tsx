import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { renderRoute } from '../test/render'

describe('app shell', () => {
  it('renders the header and the API status from /api/health', async () => {
    renderRoute({ route: '/' })

    expect(screen.getByRole('link', { name: 'TaskBoard' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Welcome to TaskBoard' })).toBeInTheDocument()
    expect(await screen.findByText('API ok, database ok')).toBeInTheDocument()
  })

  it('reports the API as unavailable when the health check fails', async () => {
    server.use(
      http.get('/api/health', () =>
        HttpResponse.json(
          {
            error: {
              code: 'service_unavailable',
              message: 'Database is unavailable',
              details: {},
            },
          },
          { status: 503 },
        ),
      ),
    )

    renderRoute({ route: '/' })

    expect(await screen.findByText('API unavailable')).toBeInTheDocument()
  })

  it('shows a not-found page for unknown routes', () => {
    renderRoute({ route: '/does-not-exist' })

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeInTheDocument()
  })
})
