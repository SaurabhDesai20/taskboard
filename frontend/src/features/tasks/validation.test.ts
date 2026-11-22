import { describe, expect, it } from 'vitest'
import type { Task } from '../../api/types'
import { taskChanges, taskFormValues, validateTask, validateTaskTitle } from './validation'

const TASK: Task = {
  id: '40000000-0000-4000-8000-000000000001',
  project_id: '30000000-0000-4000-8000-000000000001',
  workspace_id: '20000000-0000-4000-8000-000000000001',
  number: 1,
  key: 'WEB-1',
  title: 'Fix login redirect',
  description: 'After login users land on /404.',
  status: 'in_progress',
  priority: 'high',
  position: 1024,
  assignee: { id: '10000000-0000-4000-8000-000000000002', name: 'Ben Okafor' },
  due_date: '2026-12-01',
  comment_count: 0,
  created_by: '10000000-0000-4000-8000-000000000001',
  created_at: '2026-11-22T09:20:00Z',
  updated_at: '2026-11-22T09:20:00Z',
}

describe('task validation', () => {
  it('requires a title of at most 200 characters (trimmed)', () => {
    expect(validateTaskTitle('  ')).toBe('Enter a task title')
    expect(validateTaskTitle('x'.repeat(201))).toBe('Title must be at most 200 characters')
    expect(validateTaskTitle(` ${'x'.repeat(200)} `)).toBeUndefined()
  })

  it('checks the description length and the due date', () => {
    const values = taskFormValues(TASK)
    expect(validateTask(values)).toEqual({})
    expect(validateTask({ ...values, description: 'x'.repeat(10001), due_date: '2026-02-30' })).toEqual({
      description: 'Description must be at most 10000 characters',
      due_date: 'Enter a valid date',
    })
  })
})

describe('taskChanges: the PATCH body of the drawer', () => {
  it('is empty when nothing changed', () => {
    expect(taskChanges(TASK, taskFormValues(TASK))).toEqual({})
    expect(taskChanges(TASK, { ...taskFormValues(TASK), title: '  Fix login redirect ' })).toEqual({})
  })

  it('sends only the changed fields, trimmed', () => {
    expect(
      taskChanges(TASK, {
        ...taskFormValues(TASK),
        title: ' Fix the login redirect ',
        status: 'done',
        priority: 'urgent',
        assignee_id: '10000000-0000-4000-8000-000000000001',
        due_date: '2026-12-03',
      }),
    ).toEqual({
      title: 'Fix the login redirect',
      status: 'done',
      priority: 'urgent',
      assignee_id: '10000000-0000-4000-8000-000000000001',
      due_date: '2026-12-03',
    })
  })

  it('clears nullable fields with null', () => {
    expect(
      taskChanges(TASK, { ...taskFormValues(TASK), description: '   ', assignee_id: '', due_date: '' }),
    ).toEqual({ description: null, assignee_id: null, due_date: null })
  })
})
