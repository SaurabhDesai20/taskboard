import { useState } from 'react'
import type { Workspace } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TextField } from '../../components/TextField'
import { formErrorsFromError } from '../../lib/formErrors'
import { useForm } from '../../lib/useForm'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { MembersSection } from '../members/MembersSection'
import { Can } from './Can'
import { useCurrentWorkspace, useDeleteWorkspace, useRenameWorkspace } from './hooks'
import { validateWorkspaceName } from './validation'

/** `/w/:slug/settings`: workspace details (rename for owners), members, and delete for owners. */
export function WorkspaceSettingsPage() {
  const { workspace } = useCurrentWorkspace()
  useDocumentTitle('Settings', workspace?.name)
  if (!workspace) return null

  return (
    <div className="settings">
      <section className="workspace-section" aria-labelledby="general-title">
        <h2 id="general-title">General</h2>
        <Can action="workspace.manage" fallback={<WorkspaceDetails workspace={workspace} />}>
          <RenameWorkspaceForm workspace={workspace} />
        </Can>
      </section>
      <MembersSection workspace={workspace} />
      <Can action="workspace.manage">
        <DeleteWorkspaceSection workspace={workspace} />
      </Can>
    </div>
  )
}

function WorkspaceDetails({ workspace }: { workspace: Workspace }) {
  return (
    <dl className="details">
      <div>
        <dt>Name</dt>
        <dd>{workspace.name}</dd>
      </div>
      <div>
        <dt>URL slug</dt>
        <dd>{workspace.slug}</dd>
      </div>
    </dl>
  )
}

const NAME_FIELD = ['name'] as const

function RenameWorkspaceForm({ workspace }: { workspace: Workspace }) {
  const rename = useRenameWorkspace(workspace.id)
  const form = useForm<'name'>({
    initialValues: { name: workspace.name },
    fields: NAME_FIELD,
    validate: (values) => {
      const error = validateWorkspaceName(values.name)
      return error ? { name: error } : {}
    },
    onValidSubmit: (values) => rename.mutate(values.name.trim()),
  })

  const serverErrors = rename.isError ? formErrorsFromError(rename.error, { fields: NAME_FIELD }) : null

  return (
    <form className="inline-form" noValidate onSubmit={form.handleSubmit} aria-label="Rename workspace">
      {serverErrors?.form ? (
        <div className="alert alert--error" role="alert">
          {serverErrors.form}
        </div>
      ) : null}
      <div className="inline-form__row">
        <TextField
          {...form.register('name')}
          id="workspace-name"
          label="Workspace name"
          type="text"
          autoComplete="off"
          required
          error={form.errors.name ?? serverErrors?.fields.name}
        />
        <button type="submit" className="button button--primary" disabled={rename.isPending}>
          {rename.isPending ? 'Saving...' : 'Save name'}
        </button>
      </div>
      <p className="field__hint">
        URL slug: <strong>{workspace.slug}</strong> (cannot be changed)
      </p>
      {rename.isSuccess ? (
        <p className="notice" role="status">
          Renamed to {rename.data.name}.
        </p>
      ) : null}
    </form>
  )
}

function DeleteWorkspaceSection({ workspace }: { workspace: Workspace }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteWorkspace(workspace)

  function cancel() {
    setConfirming(false)
    remove.reset()
  }

  return (
    <section className="workspace-section danger-zone" aria-labelledby="delete-title">
      <h2 id="delete-title">Delete workspace</h2>
      <p>Deletes the workspace and everything in it for every member. This cannot be undone.</p>
      <button type="button" className="button button--danger" onClick={() => setConfirming(true)}>
        Delete workspace
      </button>
      {confirming ? (
        <ConfirmDialog
          title={`Delete ${workspace.name}?`}
          confirmLabel="Delete workspace"
          pendingLabel="Deleting..."
          pending={remove.isPending}
          error={remove.isError ? remove.error.message : null}
          onConfirm={() => remove.mutate()}
          onCancel={cancel}
        >
          <p>
            This permanently deletes <strong>{workspace.name}</strong> with its members, projects,
            tasks, comments and activity.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  )
}
