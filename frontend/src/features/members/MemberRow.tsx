import { useId, useRef, useState, type RefObject } from 'react'
import type { Member, Role, UUID, Workspace } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { RoleBadge } from '../../components/RoleBadge'
import { formatDate } from '../../lib/dates'
import { canLeaveWorkspace, canRemoveMember, ROLE_LABELS, roleOptionsFor, type MemberActor } from '../../lib/permissions'
import { useChangeMemberRole, useLeaveWorkspace, useRemoveMember } from './hooks'

interface MemberRowProps {
  member: Member
  workspace: Workspace
  /** The signed-in user. */
  actor: MemberActor
  ownerCount: number
  /** The members list's heading: focus goes there once this row is removed. */
  listHeadingRef: RefObject<HTMLElement | null>
}

/** One member: role (a dropdown when the actor may change it), joined date, remove or leave. */
export function MemberRow({ member, workspace, actor, ownerCount, listHeadingRef }: MemberRowProps) {
  const isMe = member.user_id === actor.userId
  const roleOptions = roleOptionsFor(actor, member)
  const changeRole = useChangeMemberRole(workspace.id)
  const roleErrorId = useId()
  // While the change is in flight, show the role that was picked.
  const shownRole = changeRole.isPending ? changeRole.variables.role : member.role

  let action = null
  if (isMe) {
    action = <LeaveWorkspace workspace={workspace} userId={actor.userId} canLeave={canLeaveWorkspace(member.role, ownerCount)} />
  } else if (canRemoveMember(actor, member)) {
    action = <RemoveMember workspace={workspace} member={member} listHeadingRef={listHeadingRef} />
  }

  return (
    <tr>
      <th scope="row">
        {member.name}
        {isMe ? <span className="members__you"> (you)</span> : null}
      </th>
      <td className="members__email">{member.email}</td>
      <td>
        {roleOptions.length > 0 ? (
          <select
            className="field__input members__role"
            aria-label={`Role for ${member.name}`}
            value={shownRole}
            disabled={changeRole.isPending}
            aria-invalid={changeRole.isError ? true : undefined}
            aria-describedby={changeRole.isError ? roleErrorId : undefined}
            onChange={(event) => changeRole.mutate({ userId: member.user_id, role: event.target.value as Role })}
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        ) : (
          <RoleBadge role={member.role} />
        )}
        {changeRole.isError ? (
          <p id={roleErrorId} className="field__error" role="alert">
            Could not change the role. {changeRole.error.message}
          </p>
        ) : null}
      </td>
      <td>
        <time dateTime={member.joined_at}>{formatDate(member.joined_at)}</time>
      </td>
      <td className="members__actions">{action}</td>
    </tr>
  )
}

interface RemoveMemberProps {
  workspace: Workspace
  member: Member
  listHeadingRef: RefObject<HTMLElement | null>
}

function RemoveMember({ workspace, member, listHeadingRef }: RemoveMemberProps) {
  const [confirming, setConfirming] = useState(false)
  const remove = useRemoveMember(workspace.id)
  // Empty while open (Cancel goes back to "Remove"); after a removal, the list's heading, since
  // the row and its button are going away.
  const returnFocus = useRef<HTMLElement | null>(null)

  function cancel() {
    setConfirming(false)
    remove.reset()
  }

  function removed() {
    returnFocus.current = listHeadingRef.current
    setConfirming(false)
  }

  return (
    <>
      <button type="button" className="button button--small" onClick={() => setConfirming(true)}>
        {/* "Remove Ben Okafor" for screen readers; the space must stay outside the hidden span. */}
        Remove <span className="visually-hidden">{member.name}</span>
      </button>
      {confirming ? (
        <ConfirmDialog
          title={`Remove ${member.name}?`}
          confirmLabel="Remove member"
          pendingLabel="Removing..."
          pending={remove.isPending}
          error={remove.isError ? remove.error.message : null}
          onConfirm={() => remove.mutate(member, { onSuccess: removed })}
          onCancel={cancel}
          returnFocusRef={returnFocus}
        >
          <p>
            {member.name} will lose access to {workspace.name}. You can add them again later.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}

interface LeaveWorkspaceProps {
  workspace: Workspace
  userId: UUID
  canLeave: boolean
}

function LeaveWorkspace({ workspace, userId, canLeave }: LeaveWorkspaceProps) {
  const [confirming, setConfirming] = useState(false)
  const leave = useLeaveWorkspace(workspace)
  const hintId = useId()

  function cancel() {
    setConfirming(false)
    leave.reset()
  }

  return (
    <>
      <button
        type="button"
        className="button button--small"
        disabled={!canLeave}
        aria-describedby={canLeave ? undefined : hintId}
        onClick={() => setConfirming(true)}
      >
        Leave workspace
      </button>
      {canLeave ? null : (
        <p id={hintId} className="field__hint">
          You are the only owner. Make someone else an owner first.
        </p>
      )}
      {confirming ? (
        <ConfirmDialog
          title={`Leave ${workspace.name}?`}
          confirmLabel="Leave workspace"
          pendingLabel="Leaving..."
          pending={leave.isPending}
          error={leave.isError ? leave.error.message : null}
          onConfirm={() => leave.mutate(userId)}
          onCancel={cancel}
        >
          <p>You will lose access to its projects and tasks until an admin or owner adds you again.</p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}
