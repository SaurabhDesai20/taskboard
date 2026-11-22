import { useRef } from 'react'
import type { Workspace } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ListSkeleton } from '../../components/Skeleton'
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
  const headingRef = useRef<HTMLHeadingElement>(null)

  let content
  if (members.isPending) {
    content = <ListSkeleton label="Loading members..." rows={4} avatar />
  } else if (members.isError) {
    content = <ErrorState message="Could not load the members." error={members.error} onRetry={() => void members.refetch()} />
  } else if (members.data.length === 0) {
    content = <EmptyState title="This workspace has no members." />
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
                listHeadingRef={headingRef}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section className="workspace-section" aria-labelledby="members-title">
      <h2 id="members-title" ref={headingRef} tabIndex={-1}>
        Members
      </h2>
      <Can action="member.manage">
        <AddMemberForm workspace={workspace} />
      </Can>
      {content}
    </section>
  )
}
