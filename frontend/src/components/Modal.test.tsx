import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Modal } from './Modal'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Behind</button>
      {open ? (
        <Modal title="Example dialog" onClose={() => setOpen(false)}>
          <label htmlFor="first">First</label>
          <input id="first" />
          <button type="button" disabled>
            Disabled
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button">Save</button>
        </Modal>
      ) : null}
    </>
  )
}

async function openModal() {
  const user = userEvent.setup()
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Open' })
  await user.click(opener)
  return { user, opener, dialog: screen.getByRole('dialog', { name: 'Example dialog' }) }
}

describe('Modal', () => {
  it('is a labelled modal dialog and moves focus to its first control', async () => {
    const { dialog } = await openModal()

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('First')).toHaveFocus()
  })

  it('keeps Tab and Shift+Tab inside the dialog, skipping disabled controls', async () => {
    const { user } = await openModal()
    const first = screen.getByLabelText('First')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  it('closes on Escape and returns focus to the opener', async () => {
    const { user, opener } = await openModal()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes on a backdrop click, but not on a click inside', async () => {
    const { user, dialog } = await openModal()

    await user.click(dialog)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pulls focus back in when it lands outside', async () => {
    await openModal()

    screen.getByRole('button', { name: 'Behind', hidden: true }).focus()

    expect(screen.getByLabelText('First')).toHaveFocus()
  })
})
