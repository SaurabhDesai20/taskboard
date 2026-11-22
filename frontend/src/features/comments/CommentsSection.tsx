import { useCallback, useId, useRef } from 'react'
import type { Project, Role, Task } from '../../api/types'
import { StatusMessage } from '../../components/StatusMessage'
import { useNow } from '../../lib/useNow'
import { useMe } from '../auth/hooks'
import { commentAccess } from './access'
import { CommentComposer } from './CommentComposer'
import { CommentItem } from './CommentItem'
import { useComments } from './hooks'
import './comments.css'

interface CommentsSectionProps {
  task: Task
  project: Project
  /** The signed-in user's role in the task's workspace. */
  role: Role
}

/**
 * The comment thread of the task drawer: comments oldest first ("Load more comments" fetches
 * newer pages), each editable or deletable per the role matrix, then the composer.
 */
export function CommentsSection({ task, project, role }: CommentsSectionProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const me = useMe().data ?? undefined
  const comments = useComments(task)
  const now = useNow()
  const access = commentAccess({ role, userId: me?.id ?? null, archived: project.archived_at !== null })
  // A deleted comment took focus with it; the heading keeps the user in the thread.
  const focusHeading = useCallback(() => headingRef.current?.focus(), [])

  let thread
  if (comments.isPending) {
    thread = <p className="comments__note">Loading comments...</p>
  } else if (comments.isError && !comments.data) {
    thread = (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void comments.refetch()}>
            Try again
          </button>
        }
      >
        Could not load the comments. {comments.error.message}
      </StatusMessage>
    )
  } else if (comments.data.length === 0) {
    thread = <p className="comments__note">No comments yet.</p>
  } else {
    thread = (
      <ol className="comments__list">
        {comments.data.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            task={task}
            now={now}
            canEdit={access.canEdit(comment)}
            canDelete={access.canDelete(comment)}
            onDeleted={focusHeading}
          />
        ))}
      </ol>
    )
  }

  return (
    <section className="comments" aria-labelledby={headingId} aria-busy={comments.isFetching || undefined}>
      <h3 id={headingId} ref={headingRef} className="task-drawer__subtitle comments__title" tabIndex={-1}>
        Comments <span className="comments__count">({task.comment_count})</span>
      </h3>
      {thread}
      {comments.hasNextPage ? (
        <div className="comments__more">
          {comments.isFetchNextPageError ? (
            <p className="field__error" role="alert">
              Could not load more comments. {comments.error?.message}
            </p>
          ) : null}
          <button
            type="button"
            className="button button--small"
            disabled={comments.isFetchingNextPage}
            onClick={() => void comments.fetchNextPage()}
          >
            {comments.isFetchingNextPage ? 'Loading more...' : 'Load more comments'}
          </button>
        </div>
      ) : null}
      <CommentComposer task={task} author={me ? { id: me.id, name: me.name } : undefined} access={access} />
    </section>
  )
}
