import { useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import type { Workspace } from '../../api/types'
import { Modal } from '../../components/Modal'
import { TextAreaField } from '../../components/TextAreaField'
import { TextField } from '../../components/TextField'
import { formErrorsFromError } from '../../lib/formErrors'
import { suggestProjectKey } from '../../lib/projectKey'
import { useForm } from '../../lib/useForm'
import { useCreateProject } from './hooks'
import { projectPath } from './paths'
import {
  normalizeProjectCreate,
  PROJECT_CREATE_FIELDS,
  validateProjectCreate,
  type ProjectField,
} from './validation'

interface CreateProjectModalProps {
  workspace: Workspace
  onClose: () => void
}

/** Creates a project in `workspace` and opens it. The key is suggested from the name. */
export function CreateProjectModal({ workspace, onClose }: CreateProjectModalProps) {
  const navigate = useNavigate()
  const create = useCreateProject(workspace.id)
  // The key follows the name until the user types a key of their own (emptying it resumes).
  const [keyEdited, setKeyEdited] = useState(false)
  const form = useForm<ProjectField>({
    initialValues: { name: '', key: '', description: '' },
    fields: PROJECT_CREATE_FIELDS,
    validate: validateProjectCreate,
    onValidSubmit: (values) =>
      create.mutate(normalizeProjectCreate(values), {
        onSuccess: (project) => {
          onClose()
          void navigate(projectPath(workspace.slug, project.id))
        },
      }),
  })

  const serverErrors = create.isError
    ? formErrorsFromError(create.error, {
        fields: PROJECT_CREATE_FIELDS,
        reasonFields: { project_key_taken: 'key' },
      })
    : null
  const errorFor = (field: ProjectField) => form.errors[field] ?? serverErrors?.fields[field]

  const nameField = form.register('name')
  const keyField = form.register('key')

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    nameField.onChange(event)
    if (!keyEdited) form.setValue('key', suggestProjectKey(event.target.value))
  }

  function handleKeyChange(event: ChangeEvent<HTMLInputElement>) {
    // Keys are uppercase only, so typing "web" gives "WEB".
    const key = event.target.value.toUpperCase()
    setKeyEdited(key !== '')
    form.setValue('key', key)
  }

  const exampleKey = form.values.key.trim() || 'WEB'

  return (
    <Modal title="Create project" onClose={onClose}>
      <form className="stack-form" noValidate onSubmit={form.handleSubmit}>
        {serverErrors?.form ? (
          <div className="alert alert--error" role="alert">
            {serverErrors.form}
          </div>
        ) : null}
        <TextField
          {...nameField}
          onChange={handleNameChange}
          id="create-project-name"
          label="Name"
          type="text"
          autoComplete="off"
          required
          error={errorFor('name')}
        />
        <TextField
          {...keyField}
          onChange={handleKeyChange}
          id="create-project-key"
          label="Key"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          hint={`2 to 10 uppercase letters or digits, starting with a letter. Task IDs start with it (${exampleKey}-1). Cannot be changed later.`}
          error={errorFor('key')}
        />
        <TextAreaField
          {...form.register('description')}
          id="create-project-description"
          label="Description (optional)"
          error={errorFor('description')}
        />
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={create.isPending}>
            {create.isPending ? 'Creating...' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
