import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../../api/types'
import {
  applyMove,
  columnIdsOf,
  columnOf,
  dropRequest,
  groupByStatus,
  moveOptions,
  neighboursAt,
  neighboursOf,
  placeTask,
  positionBetween,
  sortTasks,
  type ColumnIds,
} from './ordering'

interface T {
  id: string
  status: TaskStatus
  position: number
}

const t = (id: string, status: TaskStatus, position: number): T => ({ id, status, position })

/** a, b, c in To Do; d, e in In Progress; In Review and Done empty. */
const TASKS: T[] = [
  t('e', 'in_progress', 2048),
  t('a', 'todo', 1024),
  t('d', 'in_progress', 1024),
  t('c', 'todo', 3072),
  t('b', 'todo', 2048),
]

const COLUMNS: ColumnIds = { todo: ['a', 'b', 'c'], in_progress: ['d', 'e'], in_review: [], done: [] }

describe('positionBetween (contract 3.6 move table)', () => {
  it.each([
    ['no neighbours, empty column', null, null, null, 1024],
    ['no neighbours: end of the column', null, null, 3072, 4096],
    ['before X only: top of the column', null, 1024, 3072, 0],
    ['after Y only: bottom of the column', 3072, null, 3072, 4096],
    ['between Y and X', 1024, 2048, 3072, 1536],
  ])('%s', (_case, after, before, last, expected) => {
    expect(positionBetween(after, before, last)).toBe(expected)
  })
})

describe('sorting and grouping', () => {
  it('orders by status, then position', () => {
    expect(sortTasks(TASKS).map((task) => task.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('groups into the four columns in position order', () => {
    expect(columnIdsOf(groupByStatus(TASKS))).toEqual(COLUMNS)
  })

  it('finds the column of a task', () => {
    expect(columnOf(COLUMNS, 'e')).toBe('in_progress')
    expect(columnOf(COLUMNS, 'zz')).toBeUndefined()
  })
})

describe('neighboursOf: the move request from the column after the drop', () => {
  it.each([
    ['in the middle', ['a', 'x', 'b'], { after_task_id: 'a', before_task_id: 'b' }],
    ['at the top', ['x', 'a', 'b'], { after_task_id: null, before_task_id: 'a' }],
    ['at the bottom', ['a', 'b', 'x'], { after_task_id: 'b', before_task_id: null }],
    ['alone in the column', ['x'], { after_task_id: null, before_task_id: null }],
  ])('%s', (_case, column, expected) => {
    expect(neighboursOf(column, 'x')).toEqual(expected)
  })

  it('throws when the task is not in the column', () => {
    expect(() => neighboursOf(['a'], 'x')).toThrow()
  })
})

describe('neighboursAt: placing at an index among the other tasks', () => {
  it('ignores the task itself and clamps the index', () => {
    expect(neighboursAt(['a', 'x', 'b'], 'x', 0)).toEqual({ after_task_id: null, before_task_id: 'a' })
    expect(neighboursAt(['a', 'x', 'b'], 'x', 1)).toEqual({ after_task_id: 'a', before_task_id: 'b' })
    expect(neighboursAt(['a', 'x', 'b'], 'x', 2)).toEqual({ after_task_id: 'b', before_task_id: null })
    expect(neighboursAt(['a', 'b'], 'x', 99)).toEqual({ after_task_id: 'b', before_task_id: null })
    expect(neighboursAt(['a', 'b'], 'x', -5)).toEqual({ after_task_id: null, before_task_id: 'a' })
    expect(neighboursAt([], 'x', 0)).toEqual({ after_task_id: null, before_task_id: null })
  })
})

describe('applyMove: the optimistic update', () => {
  const ids = (tasks: T[]) => tasks.map((task) => `${task.id}:${task.status}:${task.position}`)

  it('moves between neighbours of another column with the server math, others untouched', () => {
    const result = applyMove(TASKS, 'a', { status: 'in_progress', after_task_id: 'd', before_task_id: 'e' })
    expect(ids(result)).toEqual(['b:todo:2048', 'c:todo:3072', 'd:in_progress:1024', 'a:in_progress:1536', 'e:in_progress:2048'])
  })

  it('moves to the top and the bottom of a column', () => {
    expect(ids(applyMove(TASKS, 'c', { status: 'todo', after_task_id: null, before_task_id: 'a' })).slice(0, 3)).toEqual([
      'c:todo:0',
      'a:todo:1024',
      'b:todo:2048',
    ])
    expect(ids(applyMove(TASKS, 'a', { status: 'in_progress', after_task_id: 'e', before_task_id: null }))).toContain(
      'a:in_progress:3072',
    )
  })

  it('without neighbours: the end of the column, or 1024 in an empty one', () => {
    expect(ids(applyMove(TASKS, 'a', { status: 'done', after_task_id: null, before_task_id: null }))).toContain(
      'a:done:1024',
    )
    expect(ids(applyMove(TASKS, 'a', { status: 'in_progress' }))).toContain('a:in_progress:3072')
  })

  it('returns a copy and leaves the input alone; an unknown task changes nothing', () => {
    const before = ids(TASKS)
    applyMove(TASKS, 'a', { status: 'done' })
    expect(ids(TASKS)).toEqual(before)
    expect(ids(applyMove(TASKS, 'zz', { status: 'done' }))).toEqual(before)
  })
})

describe('drag and drop', () => {
  it('placeTask takes the task out of its column and puts it at the index', () => {
    expect(placeTask(COLUMNS, 'a', 'in_progress', 1)).toEqual({
      todo: ['b', 'c'],
      in_progress: ['d', 'a', 'e'],
      in_review: [],
      done: [],
    })
    // Within a column, like arrayMove(column, from, to).
    expect(placeTask(COLUMNS, 'a', 'todo', 2).todo).toEqual(['b', 'c', 'a'])
    expect(placeTask(COLUMNS, 'c', 'todo', 0).todo).toEqual(['c', 'a', 'b'])
    expect(placeTask(COLUMNS, 'a', 'done', 10).done).toEqual(['a'])
  })

  it('dropRequest: nothing to send when the card ends where it started', () => {
    expect(dropRequest(COLUMNS, COLUMNS, 'b')).toBeNull()
    expect(dropRequest(COLUMNS, placeTask(COLUMNS, 'b', 'todo', 1), 'b')).toBeNull()
  })

  it('dropRequest: the neighbours at the drop, within a column', () => {
    expect(dropRequest(COLUMNS, placeTask(COLUMNS, 'a', 'todo', 2), 'a')).toEqual({
      status: 'todo',
      after_task_id: 'c',
      before_task_id: null,
    })
    expect(dropRequest(COLUMNS, placeTask(COLUMNS, 'c', 'todo', 1), 'c')).toEqual({
      status: 'todo',
      after_task_id: 'a',
      before_task_id: 'b',
    })
  })

  it('dropRequest: the neighbours at the drop, in another column (empty or not)', () => {
    expect(dropRequest(COLUMNS, placeTask(COLUMNS, 'b', 'in_progress', 0), 'b')).toEqual({
      status: 'in_progress',
      after_task_id: null,
      before_task_id: 'd',
    })
    expect(dropRequest(COLUMNS, placeTask(COLUMNS, 'b', 'in_progress', 1), 'b')).toEqual({
      status: 'in_progress',
      after_task_id: 'd',
      before_task_id: 'e',
    })
    expect(dropRequest(COLUMNS, placeTask(COLUMNS, 'b', 'in_review', 0), 'b')).toEqual({
      status: 'in_review',
      after_task_id: null,
      before_task_id: null,
    })
  })
})

describe('moveOptions: the keyboard move menu', () => {
  const labels = (taskId: string) => moveOptions(COLUMNS, taskId).map((option) => option.label)

  it('offers up/down within the column, then the top and bottom of the other columns', () => {
    expect(labels('b')).toEqual([
      'Move up',
      'Move down',
      'Move to top of In Progress',
      'Move to bottom of In Progress',
      'Move to In Review',
      'Move to Done',
    ])
  })

  it('has no "Move up" for the first card and no "Move down" for the last', () => {
    expect(labels('a')).not.toContain('Move up')
    expect(labels('a')).toContain('Move down')
    expect(labels('c')).toContain('Move up')
    expect(labels('c')).not.toContain('Move down')
  })

  it('builds the same requests as a drop would', () => {
    const byLabel = (taskId: string, label: string) =>
      moveOptions(COLUMNS, taskId).find((option) => option.label === label)?.request
    expect(byLabel('b', 'Move up')).toEqual({ status: 'todo', after_task_id: null, before_task_id: 'a' })
    expect(byLabel('b', 'Move down')).toEqual({ status: 'todo', after_task_id: 'c', before_task_id: null })
    expect(byLabel('a', 'Move down')).toEqual({ status: 'todo', after_task_id: 'b', before_task_id: 'c' })
    expect(byLabel('b', 'Move to top of In Progress')).toEqual({
      status: 'in_progress',
      after_task_id: null,
      before_task_id: 'd',
    })
    expect(byLabel('b', 'Move to bottom of In Progress')).toEqual({
      status: 'in_progress',
      after_task_id: 'e',
      before_task_id: null,
    })
    expect(byLabel('b', 'Move to Done')).toEqual({ status: 'done', after_task_id: null, before_task_id: null })
  })

  it('offers nothing for a task that is not on the board', () => {
    expect(moveOptions(COLUMNS, 'zz')).toEqual([])
  })
})
