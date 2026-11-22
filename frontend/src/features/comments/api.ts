// Raw calls for contract section 3.7 (Comments). Components use the hooks in hooks.ts instead.
import { api } from '../../api/client'
import type { CommentCreate, CommentPage, CommentRead, CommentUpdate, UUID } from '../../api/types'

export interface CommentPageQuery {
  /** `next_cursor` of the previous page, passed back unchanged; null for the first page. */
  cursor?: string | null
  /** 1 to 100; the server's default is 20. */
  limit?: number
}

export const commentsApi = {
  /** One page of a task's comments, oldest first. The next page holds newer comments. */
  list: (taskId: UUID, { cursor, limit }: CommentPageQuery = {}, signal?: AbortSignal) =>
    api.get<CommentPage>(`/tasks/${taskId}/comments`, { query: { limit, cursor }, signal }),
  create: (taskId: UUID, body: CommentCreate) => api.post<CommentRead>(`/tasks/${taskId}/comments`, body),
  /** Author only; answers with `edited_at` set. */
  update: (commentId: UUID, body: CommentUpdate) => api.patch<CommentRead>(`/comments/${commentId}`, body),
  remove: (commentId: UUID) => api.delete(`/comments/${commentId}`),
}
