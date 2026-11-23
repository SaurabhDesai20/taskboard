import type { RefObject } from 'react'
import { useNavigate } from 'react-router'
import { Modal } from '../../components/Modal'
import { TextField } from '../../components/TextField'
import { formErrorsFromError } from '../../lib/formErrors'
import { deriveSlug } from '../../lib/slug'
import { useForm } from '../../lib/useForm'
import { useCreateWorkspace } from './hooks'
import {
  normalizeWorkspaceCreate,
  validateWorkspaceCreate,
  WORKSPACE_FIELDS,
  type WorkspaceField,
} from './validation'

interface CreateWorkspaceModalProps {
  onClose: () => void
  /** Where focus goes when the modal closes (default: the element that opened it). */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/** Creates a workspace (the user becomes its owner) and opens it. */
export function CreateWorkspaceModal({ onClose, returnFocusRef }: CreateWorkspaceModalProps) {
  const navigate = useNavigate()
  const create = useCreateWorkspace()
  const form = useForm<WorkspaceField>({
    initialValues: { name: '', slug: '' },
    fields: WORKSPACE_FIELDS,
    validate: validateWorkspaceCreate,
    onValidSubmit: (values) =>
      create.mutate(normalizeWorkspaceCreate(values), {
        onSuccess: (workspace) => {
          onClose()
          void navigate(`/w/${workspace.slug}`)
        },
      }),
  })

  const serverErrors = create.isError
    ? formErrorsFromError(create.error, { fields: WORKSPACE_FIELDS, reasonFields: { slug_taken: 'slug' } })
    : null
  const errorFor = (field: WorkspaceField) => form.errors[field] ?? serverErrors?.fields[field]
  const suggestedSlug = deriveSlug(form.values.name)

  return (
    <Modal title="Create workspace" onClose={onClose} returnFocusRef={returnFocusRef}>
      <form className="stack-form" noValidate onSubmit={form.handleSubmit}>
        {serverErrors?.form ? (
          <div className="alert alert--error" role="alert">
            {serverErrors.form}
          </div>
        ) : null}
        <TextField
          {...form.register('name')}
          id="create-workspace-name"
          label="Name"
          type="text"
          autoComplete="off"
          required
          error={errorFor('name')}
        />
        <TextField
          {...form.register('slug')}
          id="create-workspace-slug"
          label="URL slug (optional)"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={suggestedSlug}
          hint={`Lowercase letters, numbers and hyphens, used in the address (/w/...). Cannot be changed later. Leave empty to make one from the name ("${suggestedSlug}").`}
          error={errorFor('slug')}
        />
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={create.isPending}>
            {create.isPending ? 'Creating...' : 'Create workspace'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
