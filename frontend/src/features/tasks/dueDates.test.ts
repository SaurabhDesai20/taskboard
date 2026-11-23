import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../../api/types'
import { groupMyTasks, isOverdue, myTaskGroupOf } from './dueDates'

const TODAY = '2026-11-22'
const task = (id: string, due_date: string | null, status: TaskStatus = 'todo') => ({ id, due_date, status })

describe('isOverdue', () => {
  it('is due before today and not done', () => {
    expect(isOverdue(task('a', '2026-11-21'), TODAY)).toBe(true)
    expect(isOverdue(task('a', '2025-12-31', 'in_review'), TODAY)).toBe(true)
  })

  it('is not overdue on the due date itself, later, without a date, or when done', () => {
    expect(isOverdue(task('a', TODAY), TODAY)).toBe(false)
    expect(isOverdue(task('a', '2026-11-23'), TODAY)).toBe(false)
    expect(isOverdue(task('a', null), TODAY)).toBe(false)
    expect(isOverdue(task('a', '2026-11-01', 'done'), TODAY)).toBe(false)
  })
})

describe('My Tasks groups', () => {
  it.each([
    ['2026-11-21', 'overdue'],
    ['2026-11-22', 'this_week'],
    ['2026-11-28', 'this_week'],
    ['2026-11-29', 'later'],
    ['2027-01-15', 'later'],
    [null, 'no_due_date'],
  ] as const)('due %s -> %s', (due, group) => {
    expect(myTaskGroupOf(task('a', due), TODAY)).toBe(group)
  })

  it('groups open tasks, keeps the server order inside each group, and skips done ones', () => {
    const tasks = [
      task('late-1', '2026-11-01'),
      task('late-2', '2026-11-20', 'in_progress'),
      task('today', TODAY),
      task('done', '2026-11-10', 'done'),
      task('next-month', '2026-12-30'),
      task('someday', null),
    ]
    const groups = groupMyTasks(tasks, TODAY)
    const ids = (group: keyof typeof groups) => groups[group].map((item) => item.id)
    expect(ids('overdue')).toEqual(['late-1', 'late-2'])
    expect(ids('this_week')).toEqual(['today'])
    expect(ids('later')).toEqual(['next-month'])
    expect(ids('no_due_date')).toEqual(['someday'])
  })
})
