// Contract section 3.7 (Comments) with the access rules of 1.10 and the cursor pagination of 1.6
// (../pagination.ts).
import { http, HttpResponse } from 'msw'
import type { CommentPage, CommentRead, FieldError } from '../../api/types'
import { can } from '../../lib/permissions'
import {
  commentsOf,
  createComment,
  deleteComment,
  findComment,
  findMembership,
  findProject,
  findTask,
  nextCommentTimestamp,
  toComment,
  type MockCommentRecord,
  type MockMembershipRecord,
  type MockProjectRecord,
} from '../db'
import {
  API,
  errorResponse,
  invalidUuidParams,
  readJsonObject,
  reasonError,
  requireUser,
  validateStrings,
  validationErrorResponse,
} from '../http'
import { isAfter, paginate, readCursor, readLimit } from '../pagination'
import { commentExcerpt, logCommentActivity } from './activity'
import { requireTaskMember } from './tasks'

// Wording from contract 3.7 (the 403 table) and 1.6.
const MESSAGES = {
  notFound: 'Comment not found',
  createRole: 'Only owners, admins and members can comment',
  editRole: 'Only owners, admins and members can edit or delete their comments',
  notAuthorEdit: 'Only the author can edit this comment',
  notAuthorDelete: "Only owners and admins can delete other people's comments",
  archived: 'This project is archived, so its comments are read-only',
}

const BODY_RULE = { min: 1, max: 5000 }

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

interface CommentAccess {
  comment: MockCommentRecord
  project: MockProjectRecord
  membership: MockMembershipRecord
}

/** Resolve comment -> task -> project -> workspace; 404 when missing or I am not a member. */
function requireCommentMember(cid: string | readonly string[] | undefined): CommentAccess | Response {
  const invalid = invalidUuidParams({ cid })
  if (invalid) return invalid
  const user = requireUser()
  if (user instanceof Response) return user
  const comment = findComment(cid as string)
  const task = comment ? findTask(comment.task_id) : undefined
  const project = task ? findProject(task.project_id) : undefined
  const membership = project ? findMembership(project.workspace_id, user.id) : undefined
  if (!comment || !project || !membership) return errorResponse('not_found', MESSAGES.notFound)
  return { comment, project, membership }
}

const archivedConflict = () => reasonError('conflict', 'project_archived', MESSAGES.archived)

/** `body`: trimmed, then 1 to 5000 characters (contract 1.8). */
function readBody(raw: Record<string, unknown>): string | Response {
  const checked = validateStrings({ body: raw.body }, { body: BODY_RULE })
  return checked.errors.length > 0 ? validationErrorResponse(checked.errors) : checked.values.body
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

export const commentHandlers = [
  http.get(`${API}/tasks/:tid/comments`, ({ params, request }) => {
    const access = requireTaskMember(params.tid)
    if (access instanceof Response) return access
    const errors: FieldError[] = []
    const searchParams = new URL(request.url).searchParams
    const limit = readLimit(searchParams, errors)
    const cursor = readCursor(searchParams, errors)
    if (errors.length > 0) return validationErrorResponse(errors)

    // Oldest first (contract 3.7).
    const page = paginate(commentsOf(access.task.id), cursor, limit, isAfter)
    return HttpResponse.json<CommentPage>({ items: page.items.map(toComment), next_cursor: page.next_cursor })
  }),

  http.post(`${API}/tasks/:tid/comments`, async ({ params, request }) => {
    const access = requireTaskMember(params.tid)
    if (access instanceof Response) return access
    const { task, project, membership } = access
    if (!can(membership.role, 'comment.create')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.createRole)
    }
    const json = await readJsonObject(request)
    if (json instanceof Response) return json
    const body = readBody(json)
    if (body instanceof Response) return body
    if (project.archived_at !== null) return archivedConflict()

    const comment = createComment({ taskId: task.id, authorId: membership.user_id, body })
    logCommentActivity(comment, membership.user_id, 'comment.created', { excerpt: commentExcerpt(body) })
    return HttpResponse.json<CommentRead>(toComment(comment), { status: 201 })
  }),

  // Author only, who must still be a member or above. Admins cannot edit other people's comments.
  // Checked in the contract's order: 404, 403 insufficient_role, 422, 403 not_author, 409.
  http.patch(`${API}/comments/:cid`, async ({ params, request }) => {
    const access = requireCommentMember(params.cid)
    if (access instanceof Response) return access
    const { comment, project, membership } = access
    // Viewers, also for a comment they wrote before being demoted.
    if (!can(membership.role, 'comment.edit_own')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.editRole)
    }
    const json = await readJsonObject(request)
    if (json instanceof Response) return json
    // Partial (contract 1.7): an omitted body stays; null is a 422.
    const body = json.body === undefined ? undefined : readBody(json)
    if (body instanceof Response) return body
    if (comment.author_id !== membership.user_id) {
      return reasonError('forbidden', 'not_author', MESSAGES.notAuthorEdit)
    }
    // For any body, even `{}`.
    if (project.archived_at !== null) return archivedConflict()

    // `{}` or the current body (after trimming) changes nothing, `edited_at` included.
    if (body !== undefined && body !== comment.body) {
      comment.body = body
      comment.edited_at = nextCommentTimestamp()
      logCommentActivity(comment, membership.user_id, 'comment.edited', { excerpt: commentExcerpt(body) })
    }
    return HttpResponse.json<CommentRead>(toComment(comment))
  }),

  // The author (member or above), or any admin or owner; also in archived projects.
  // Checked in the contract's order: 404, 403 insufficient_role, 403 not_author.
  http.delete(`${API}/comments/:cid`, ({ params }) => {
    const access = requireCommentMember(params.cid)
    if (access instanceof Response) return access
    const { comment, membership } = access
    // Viewers, also for a comment they wrote before being demoted.
    if (!can(membership.role, 'comment.edit_own')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.editRole)
    }
    if (!can(membership.role, 'comment.delete_any') && comment.author_id !== membership.user_id) {
      return reasonError('forbidden', 'not_author', MESSAGES.notAuthorDelete)
    }
    logCommentActivity(comment, membership.user_id, 'comment.deleted')
    deleteComment(comment.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
