// TanStack Query hooks for comments (contract 3.7). A task's thread is one infinite query under
// the workspace's key prefix, so refreshAfterConflict and forgetWorkspace cover it too. Posting
// and deleting also move the task's `comment_count` in the cached task and its project's lists.
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import type { CommentCreate, CommentPage, CommentRead, Task, UserRef, UUID } from '../../api/types'
import { useErrorToastWhenUnmounted, useToast } from '../../components/toastContext'
import { taskKeys } from '../tasks/hooks'
import { refreshActivity, refreshAfterConflict, workspaceKeys } from '../workspaces/hooks'
import { commentsApi } from './api'

/** Comments per page (the contract's default, sent explicitly). */
export const COMMENT_PAGE_SIZE = 20

export const commentKeys = {
  /** Every comment thread of one workspace. */
  all: (workspaceId: UUID) => [...workspaceKeys.detail(workspaceId), 'comments'] as const,
  thread: (workspaceId: UUID, taskId: UUID) => [...commentKeys.all(workspaceId), taskId] as const,
}

type CommentPages = InfiniteData<CommentPage, string | null>
type TaskIds = Pick<Task, 'id' | 'workspace_id' | 'project_id'>

// ---------------------------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------------------------

/** Ids of comments shown before the server has answered (optimistic adds). */
const PENDING_PREFIX = 'pending-'
let pendingCount = 0

export function isPendingComment(comment: CommentRead): boolean {
  return comment.id.startsWith(PENDING_PREFIX)
}

/**
 * Every loaded comment, oldest first. A comment posted here is appended to the last loaded page
 * at once; when a later page arrives with it, its place in that page wins (no duplicates).
 */
export function flattenComments(pages: readonly CommentPage[]): CommentRead[] {
  const byId = new Map<UUID, CommentRead>()
  for (const page of pages) {
    for (const comment of page.items) {
      byId.delete(comment.id)
      byId.set(comment.id, comment)
    }
  }
  return [...byId.values()]
}

const selectComments = (data: CommentPages) => flattenComments(data.pages)

/** A task's comments, oldest first, one page at a time: `fetchNextPage` loads newer ones. */
export function useComments(task: TaskIds) {
  return useInfiniteQuery({
    queryKey: commentKeys.thread(task.workspace_id, task.id),
    queryFn: ({ pageParam, signal }) =>
      commentsApi.list(task.id, { cursor: pageParam, limit: COMMENT_PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    select: selectComments,
  })
}

/** Changes the cached pages of a thread; does nothing while the thread has not loaded. */
function updateThread(queryClient: QueryClient, task: TaskIds, change: (pages: CommentPage[]) => CommentPage[]) {
  queryClient.setQueryData<CommentPages>(commentKeys.thread(task.workspace_id, task.id), (data) =>
    data ? { ...data, pages: change(data.pages) } : data,
  )
}

const hasThread = (queryClient: QueryClient, task: TaskIds) =>
  queryClient.getQueryData<CommentPages>(commentKeys.thread(task.workspace_id, task.id)) !== undefined

/** Adds a comment at the end of the last loaded page (newest last). */
function appendComment(pages: CommentPage[], comment: CommentRead): CommentPage[] {
  if (pages.length === 0) return [{ items: [comment], next_cursor: null }]
  const last = pages[pages.length - 1]
  return [...pages.slice(0, -1), { ...last, items: [...last.items, comment] }]
}

function mapComments(pages: CommentPage[], change: (items: CommentRead[]) => CommentRead[]): CommentPage[] {
  return pages.map((page) => ({ ...page, items: change(page.items) }))
}

const containsComment = (pages: CommentPage[], id: UUID) => pages.some((page) => page.items.some((item) => item.id === id))

/** Swaps the comment with id `id` for `comment`. */
function replaceComment(pages: CommentPage[], id: UUID, comment: CommentRead): CommentPage[] {
  return mapComments(pages, (items) => items.map((item) => (item.id === id ? comment : item)))
}

function removeComment(pages: CommentPage[], id: UUID): CommentPage[] {
  return mapComments(pages, (items) => items.filter((item) => item.id !== id))
}

/**
 * Moves the task's `comment_count` by `delta` in the cached task and in its project's lists (the
 * card shows it at once), then refetches the lists and My Tasks to be sure.
 */
function adjustCommentCount(queryClient: QueryClient, task: TaskIds, delta: number): void {
  const adjust = (item: Task): Task =>
    item.id === task.id ? { ...item, comment_count: Math.max(0, item.comment_count + delta) } : item
  queryClient.setQueryData<Task>(taskKeys.detail(task.workspace_id, task.id), (current) =>
    current ? adjust(current) : current,
  )
  const listsKey = taskKeys.lists(task.workspace_id, task.project_id)
  queryClient.setQueriesData<Task[]>({ queryKey: listsKey }, (list) => list?.map(adjust))
  void queryClient.invalidateQueries({ queryKey: listsKey })
  void queryClient.invalidateQueries({ queryKey: taskKeys.mine })
}

// ---------------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------------

interface CreateContext {
  /** Id of the temporary comment, or null when the thread had not loaded (nothing was shown). */
  pendingId: string | null
}

/**
 * Posts a comment with an optimistic add: a temporary comment by `author` appears at the end of
 * the thread at once, is replaced by the server's copy on success, and removed on failure (the
 * caller shows the error).
 */
export function useCreateComment(task: TaskIds, author: UserRef | undefined) {
  const queryClient = useQueryClient()
  const reportIfClosed = useErrorToastWhenUnmounted()
  const threadKey = commentKeys.thread(task.workspace_id, task.id)
  return useMutation<CommentRead, Error, CommentCreate, CreateContext>({
    mutationFn: (body) => commentsApi.create(task.id, body),
    onMutate: async ({ body }) => {
      if (!author || !hasThread(queryClient, task)) return { pendingId: null }
      // A thread fetch that lands after the optimistic write would undo it.
      await queryClient.cancelQueries({ queryKey: threadKey })
      pendingCount += 1
      const pending: CommentRead = {
        id: `${PENDING_PREFIX}${pendingCount}`,
        task_id: task.id,
        author,
        body,
        created_at: new Date().toISOString(),
        edited_at: null,
      }
      updateThread(queryClient, task, (pages) => appendComment(pages, pending))
      return { pendingId: pending.id }
    },
    onSuccess: (comment, _body, context) => {
      if (!hasThread(queryClient, task)) {
        void queryClient.invalidateQueries({ queryKey: threadKey })
      } else {
        updateThread(queryClient, task, (pages) => {
          const pendingId = context?.pendingId
          if (pendingId && containsComment(pages, pendingId) && !containsComment(pages, comment.id)) {
            return replaceComment(pages, pendingId, comment)
          }
          // A refetch in the meantime dropped the temporary comment, or already brought the real one.
          const rest = pendingId ? removeComment(pages, pendingId) : pages
          return containsComment(rest, comment.id) ? rest : appendComment(rest, comment)
        })
      }
      adjustCommentCount(queryClient, task, 1)
      refreshActivity(queryClient, task.workspace_id)
    },
    onError: (error, _body, context) => {
      const pendingId = context?.pendingId
      if (pendingId) updateThread(queryClient, task, (pages) => removeComment(pages, pendingId))
      // 409 project_archived refetches the project too, so the composer turns read-only.
      refreshAfterConflict(queryClient, task.workspace_id, error)
      // The composer shows the error and gives the text back; if the drawer was closed, a toast says it.
      reportIfClosed('Your comment was not posted.', error)
    },
  })
}

export interface UpdateCommentVariables {
  commentId: UUID
  body: string
}

/** Edits a comment (author only); the thread shows the server's copy with `edited_at`. */
export function useUpdateComment(task: TaskIds) {
  const queryClient = useQueryClient()
  const reportIfClosed = useErrorToastWhenUnmounted()
  return useMutation({
    mutationFn: ({ commentId, body }: UpdateCommentVariables) => commentsApi.update(commentId, { body }),
    onSuccess: (comment) => {
      updateThread(queryClient, task, (pages) => replaceComment(pages, comment.id, comment))
      refreshActivity(queryClient, task.workspace_id)
    },
    onError: (error) => {
      refreshAfterConflict(queryClient, task.workspace_id, error)
      reportIfClosed('Your comment was not saved.', error)
    },
  })
}

/**
 * Deletes a comment. `onDeleted` runs with the hook's own success handler, so it still fires
 * after the comment's row (which started the delete) has gone.
 */
export function useDeleteComment(task: TaskIds, { onDeleted }: { onDeleted?: () => void } = {}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const reportIfClosed = useErrorToastWhenUnmounted()
  return useMutation({
    mutationFn: (commentId: UUID) => commentsApi.remove(commentId),
    onSuccess: (_result, commentId) => {
      updateThread(queryClient, task, (pages) => removeComment(pages, commentId))
      adjustCommentCount(queryClient, task, -1)
      refreshActivity(queryClient, task.workspace_id)
      toast.success('Deleted the comment.')
      onDeleted?.()
    },
    onError: (error) => {
      refreshAfterConflict(queryClient, task.workspace_id, error)
      reportIfClosed('The comment was not deleted.', error)
    },
  })
}
