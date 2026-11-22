import type { ReactNode } from 'react'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  /** What will happen, in a sentence or two. */
  children: ReactNode
  confirmLabel: string
  pendingLabel: string
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
  /** A server error to show; the dialog stays open so the user can read it. */
  error: string | null
}

/** A modal asking to confirm a destructive action. Cancel is focused first. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  onConfirm,
  onCancel,
  pending,
  error,
}: ConfirmDialogProps) {
  // Closing while the request runs would hide its outcome.
  const close = () => {
    if (!pending) onCancel()
  }

  return (
    <Modal title={title} onClose={close}>
      <div className="modal__body">{children}</div>
      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="modal__actions">
        <button type="button" className="button" onClick={close} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="button button--danger" onClick={onConfirm} disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
