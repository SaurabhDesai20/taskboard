import type { Project } from '../../api/types'
import { Modal } from '../../components/Modal'
import { TextAreaField } from '../../components/TextAreaField'
import { TextField } from '../../components/TextField'
import { formErrorsFromError } from '../../lib/formErrors'
import { useForm } from '../../lib/useForm'
import { useUpdateProject } from './hooks'
import {
  PROJECT_EDIT_FIELDS,
  projectChanges,
  validateProjectEdit,
  type ProjectEditField,
} from './validation'

interface EditProjectModalProps {
  project: Project
  onClose: () => void
}

/** Renames a project or changes its description. The key is immutable. */
export function EditProjectModal({ project, onClose }: EditProjectModalProps) {
  const update = useUpdateProject(project)
  const form = useForm<ProjectEditField>({
    initialValues: { name: project.name, description: project.description ?? '' },
    fields: PROJECT_EDIT_FIELDS,
    validate: validateProjectEdit,
    onValidSubmit: (values) => {
      const changes = projectChanges(project, values)
      // Nothing changed: no request (and no activity entry later on).
      if (Object.keys(changes).length === 0) {
        onClose()
        return
      }
      update.mutate(changes, { onSuccess: onClose })
    },
  })

  const serverErrors = update.isError ? formErrorsFromError(update.error, { fields: PROJECT_EDIT_FIELDS }) : null
  const errorFor = (field: ProjectEditField) => form.errors[field] ?? serverErrors?.fields[field]

  return (
    <Modal title="Edit project" onClose={onClose}>
      <form className="stack-form" noValidate onSubmit={form.handleSubmit}>
        {serverErrors?.form ? (
          <div className="alert alert--error" role="alert">
            {serverErrors.form}
          </div>
        ) : null}
        <TextField
          {...form.register('name')}
          id="edit-project-name"
          label="Name"
          type="text"
          autoComplete="off"
          required
          error={errorFor('name')}
        />
        <p className="field__hint">
          Key: <strong>{project.key}</strong> (cannot be changed)
        </p>
        <TextAreaField
          {...form.register('description')}
          id="edit-project-description"
          label="Description (optional)"
          hint="Leave empty to remove the description."
          error={errorFor('description')}
        />
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={update.isPending}>
            {update.isPending ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
