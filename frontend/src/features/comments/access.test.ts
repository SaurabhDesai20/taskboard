import { describe, expect, it } from 'vitest'
import type { CommentRead, Role } from '../../api/types'
import { ARCHIVED_REASON, commentAccess, VIEWER_REASON } from './access'

const ME = 'me-id'
const mine: CommentRead = {
  id: 'c1',
  task_id: 't1',
  author: { id: ME, name: 'Me' },
  body: 'Mine',
  created_at: '2026-11-22T09:00:00Z',
  edited_at: null,
}
const theirs: CommentRead = { ...mine, id: 'c2', author: { id: 'someone-else', name: 'Someone' } }

describe('commentAccess', () => {
  it.each([
    // role, comment, edit mine, delete mine, edit theirs, delete theirs
    ['owner', true, true, true, false, true],
    ['admin', true, true, true, false, true],
    ['member', true, true, true, false, false],
    ['viewer', false, false, false, false, false],
  ] as const)('%s in an active project', (role, comment, editMine, deleteMine, editTheirs, deleteTheirs) => {
    const access = commentAccess({ role, userId: ME, archived: false })
    expect(access.canComment).toBe(comment)
    expect(access.composerDisabledReason).toBe(comment ? null : VIEWER_REASON)
    expect([access.canEdit(mine), access.canDelete(mine), access.canEdit(theirs), access.canDelete(theirs)]).toEqual([
      editMine,
      deleteMine,
      editTheirs,
      deleteTheirs,
    ])
  })

  it.each<[Role, boolean, boolean]>([
    ['owner', true, true],
    ['admin', true, true],
    ['member', true, false],
    ['viewer', false, false],
  ])('%s in an archived project: no commenting or editing, deleting as usual', (role, deleteMine, deleteTheirs) => {
    const access = commentAccess({ role, userId: ME, archived: true })
    expect(access.canComment).toBe(false)
    expect(access.composerDisabledReason).toBe(ARCHIVED_REASON)
    expect(access.canEdit(mine)).toBe(false)
    expect(access.canDelete(mine)).toBe(deleteMine)
    expect(access.canDelete(theirs)).toBe(deleteTheirs)
  })

  it('allows nothing while the user or role is unknown', () => {
    for (const access of [
      commentAccess({ role: 'owner', userId: null, archived: false }),
      commentAccess({ role: undefined, userId: ME, archived: false }),
    ]) {
      expect(access.canComment).toBe(false)
      expect(access.canEdit(mine)).toBe(false)
      expect(access.canDelete(theirs)).toBe(false)
    }
  })
})
