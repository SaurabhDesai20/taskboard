import type { Workspace } from '../../api/types'
import { StatusMessage } from '../../components/StatusMessage'
import { countOwners } from '../../lib/permissions'
import { useMe } from '../auth/hooks'
import { Can } from '../workspaces/Can'
import { AddMemberForm } from './AddMemberForm'
import { useMembers } from './hooks'
import { MemberRow } from './MemberRow'
import './members.css'

/** The members part of the settings page: add form (admins and owners) and the members table. */
export function MembersSection({ workspace }: { workspace: Workspace }) {
  const me = useMe()
  const members = useMembers(workspace.id)

  let content
  if (members.isPending) {
    content = <StatusMessage>Loading members...</StatusMessage>
  } else if (members.isError) {
    content = (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void members.refetch()}>
            Try again
          </button>
        }
      >
        Could not load the members. {members.error.message}
      </StatusMessage>
    )
  } else if (members.data.length === 0) {
    content = <p className="empty-state">This workspace has no members.</p>
  } else {
    const actor = { userId: me.data?.id ?? '', role: workspace.my_role }
    const ownerCount = countOwners(members.data)
    content = (
      <div className="table-scroll">
        <table className="members">
          <caption className="visually-hidden">Members of {workspace.name}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Joined</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.data.map((member) => (
              <MemberRow
                key={member.user_id}
                member={member}
                workspace={workspace}
                actor={actor}
                ownerCount={ownerCount}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section className="workspace-section" aria-labelledby="members-title">
      <h2 id="members-title">Members</h2>
      <Can action="member.manage">
        <AddMemberForm workspace={workspace} />
      </Can>
      {content}
    </section>
  )
}
