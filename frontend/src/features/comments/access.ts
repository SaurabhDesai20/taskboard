// Who may do what with the comments of one task: the role matrix (lib/permissions.ts) plus the
// archived-project rule (contract 1.10: comments of an archived project cannot be created or
// edited, but can still be deleted). The backend stays the authority.
import type { CommentRead, Role, UUID } from '../../api/types'
import { can, canDeleteComment, canEditComment } from '../../lib/permissions'

export interface CommentAccess {
  canComment: boolean
  /** Why the composer is disabled, shown with it; null when commenting is allowed. */
  composerDisabledReason: string | null
  canEdit: (comment: CommentRead) => boolean
  canDelete: (comment: CommentRead) => boolean
}

interface CommentAccessInput {
  role: Role | null | undefined
  /** The signed-in user; null while unknown. */
  userId: UUID | null
  archived: boolean
}

export const ARCHIVED_REASON = 'This project is archived, so its comments are read-only.'
export const VIEWER_REASON = 'You have view-only access to this workspace, so you cannot comment.'

export function commentAccess({ role, userId, archived }: CommentAccessInput): CommentAccess {
  const actor = role && userId ? { role, userId } : null
  let composerDisabledReason: string | null = null
  if (archived) composerDisabledReason = ARCHIVED_REASON
  else if (!can(role, 'comment.create')) composerDisabledReason = VIEWER_REASON
  return {
    canComment: composerDisabledReason === null && actor !== null,
    composerDisabledReason,
    canEdit: (comment) => !archived && actor !== null && canEditComment(actor, comment.author.id),
    canDelete: (comment) => actor !== null && canDeleteComment(actor, comment.author.id),
  }
}
