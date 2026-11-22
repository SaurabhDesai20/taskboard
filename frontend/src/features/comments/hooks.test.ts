import { describe, expect, it } from 'vitest'
import type { CommentPage, CommentRead } from '../../api/types'
import { flattenComments, isPendingComment } from './hooks'

const comment = (id: string): CommentRead => ({
  id,
  task_id: 't1',
  author: { id: 'u1', name: 'Asha Rao' },
  body: `Comment ${id}`,
  created_at: '2026-11-22T09:00:00Z',
  edited_at: null,
})

const page = (ids: string[], nextCursor: string | null = null): CommentPage => ({
  items: ids.map(comment),
  next_cursor: nextCursor,
})

describe('flattenComments', () => {
  it('joins the pages in order', () => {
    expect(flattenComments([page(['a', 'b'], 'cursor'), page(['c'])]).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(flattenComments([])).toEqual([])
  })

  it("shows a comment posted before its page loaded once, in the later page's place", () => {
    // "n" was posted here and appended to the first page; the second page then brought it too.
    const pages = [page(['a', 'b', 'n'], 'cursor'), page(['c', 'n'])]
    expect(flattenComments(pages).map((item) => item.id)).toEqual(['a', 'b', 'c', 'n'])
  })
})

describe('isPendingComment', () => {
  it('recognises the temporary ids of optimistic comments', () => {
    expect(isPendingComment(comment('pending-3'))).toBe(true)
    expect(isPendingComment(comment('50000000-0000-4000-8000-000000000001'))).toBe(false)
  })
})
