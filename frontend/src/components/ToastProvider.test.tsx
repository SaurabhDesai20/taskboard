import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAIN_CONTENT_ID } from '../lib/focus'
import { liveRegionOf, toasts } from '../test/toasts'
import { MAX_TOASTS, TOAST_DURATIONS, useToast } from './toastContext'
import { ToastProvider } from './ToastProvider'

function Harness() {
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => toast.success('Archived Website.')}>
        Succeed
      </button>
      <button type="button" onClick={() => toast.error('Could not move WEB-2. Database hiccup')}>
        Fail
      </button>
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <h1>Page</h1>
      </main>
    </>
  )
}

function renderToasts() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  )
  return {
    succeed: () => fireEvent.click(screen.getByRole('button', { name: 'Succeed' })),
    fail: () => fireEvent.click(screen.getByRole('button', { name: 'Fail' })),
  }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const toastWith = (message: string) => toasts().getByText(message).closest('li') as HTMLElement

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces confirmations politely and errors assertively, from live regions that are always there', () => {
    const { succeed, fail } = renderToasts()
    // The live regions exist before anything is announced, so screen readers pick up additions.
    expect(screen.getByRole('list', { name: 'Notifications' })).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('list', { name: 'Error notifications' })).toHaveAttribute('aria-live', 'assertive')

    succeed()
    fail()

    expect(liveRegionOf(toasts().getByText('Archived Website.'))).toBe('polite')
    const error = toastWith('Could not move WEB-2. Database hiccup')
    expect(liveRegionOf(error)).toBe('assertive')
    expect(error).toHaveTextContent(/^Error: /)
  })

  it('closes by itself after a while; errors stay longer', () => {
    const { succeed, fail } = renderToasts()
    succeed()
    fail()

    advance(TOAST_DURATIONS.success - 1)
    expect(toasts().getByText('Archived Website.')).toBeInTheDocument()
    advance(1)
    expect(toasts().queryByText('Archived Website.')).not.toBeInTheDocument()
    expect(toasts().getByText('Could not move WEB-2. Database hiccup')).toBeInTheDocument()

    advance(TOAST_DURATIONS.error - TOAST_DURATIONS.success)
    expect(toasts().queryByText('Could not move WEB-2. Database hiccup')).not.toBeInTheDocument()
  })

  it('waits while the pointer is over it, then gives time to read again', () => {
    const { succeed } = renderToasts()
    succeed()

    advance(3000)
    fireEvent.mouseEnter(toastWith('Archived Website.'))
    advance(60_000)
    expect(toasts().getByText('Archived Website.')).toBeInTheDocument()

    fireEvent.mouseLeave(toastWith('Archived Website.'))
    advance(1000)
    expect(toasts().getByText('Archived Website.')).toBeInTheDocument()
    advance(1000)
    expect(toasts().queryByText('Archived Website.')).not.toBeInTheDocument()
  })

  it('waits while it has keyboard focus', () => {
    const { succeed } = renderToasts()
    succeed()
    const dismiss = within(toastWith('Archived Website.')).getByRole('button', { name: 'Dismiss notification' })

    act(() => dismiss.focus())
    advance(60_000)
    expect(toasts().getByText('Archived Website.')).toBeInTheDocument()

    act(() => screen.getByRole('button', { name: 'Succeed' }).focus())
    advance(TOAST_DURATIONS.success)
    expect(toasts().queryByText('Archived Website.')).not.toBeInTheDocument()
  })

  it('closes at once with its dismiss button or Escape; focus goes back where it came from', () => {
    const { succeed, fail } = renderToasts()
    succeed()
    fail()
    const trigger = screen.getByRole('button', { name: 'Succeed' })

    // Dismissing the focused toast moves focus to the next one.
    act(() => trigger.focus())
    const errorDismiss = within(toastWith('Could not move WEB-2. Database hiccup')).getByRole('button', {
      name: 'Dismiss notification',
    })
    act(() => errorDismiss.focus())
    fireEvent.click(errorDismiss)
    expect(toasts().queryByText('Could not move WEB-2. Database hiccup')).not.toBeInTheDocument()
    const successDismiss = within(toastWith('Archived Website.')).getByRole('button', { name: 'Dismiss notification' })
    expect(successDismiss).toHaveFocus()

    // Escape closes the last one; focus returns to the page, where it was before.
    fireEvent.keyDown(successDismiss, { key: 'Escape' })
    expect(toasts().queryByText('Archived Website.')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it(`shows at most ${MAX_TOASTS} at once, dropping the oldest`, () => {
    const { succeed, fail } = renderToasts()
    fail()
    for (let index = 0; index < MAX_TOASTS; index += 1) succeed()

    expect(toasts().getAllByRole('listitem')).toHaveLength(MAX_TOASTS)
    expect(toasts().queryByText('Could not move WEB-2. Database hiccup')).not.toBeInTheDocument()
  })

  it('is silent without a provider (hooks tested on their own)', () => {
    function Lonely() {
      const toast = useToast()
      return (
        <button type="button" onClick={() => toast.success('Nobody hears this')}>
          Try
        </button>
      )
    }
    render(<Lonely />)

    fireEvent.click(screen.getByRole('button', { name: 'Try' }))

    expect(document.querySelector('.toasts')).toBeNull()
    expect(screen.queryByText('Nobody hears this')).not.toBeInTheDocument()
  })
})
