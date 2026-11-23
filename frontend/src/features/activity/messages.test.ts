import { describe, expect, it } from 'vitest'
import type { ActivityAction } from '../../api/types'
import { formatDateOnly } from '../../lib/dates'
import { buildActivityMessage, EXCERPT_LENGTH, messageText, type ActivityMessage } from './messages'

const ASHA = { id: 'u-asha', name: 'Asha Rao' }
const BEN = { id: 'u-ben', name: 'Ben Okafor' }
const DANA = { id: 'u-dana', name: 'Dana Kim' }

const TASK = { id: 't-1', key: 'WEB-1', title: 'Fix login redirect' }
const PROJECT = { id: 'p-1', name: 'Website', key: 'WEB' }

function build(action: string, metadata: Record<string, unknown>, actor = ASHA): ActivityMessage {
  return buildActivityMessage({ action, actor, metadata })
}

const say = (action: string, metadata: Record<string, unknown>, actor = ASHA) =>
  messageText(build(action, metadata, actor))

/** The emphasised parts of a message, as read ("WEB-1 Fix login redirect"). */
const entities = (message: ActivityMessage) =>
  message.parts.filter((part) => part.kind === 'entity').map((part) => messageText({ parts: [part] }))

// Every action of contract 3.8 with its example metadata, for the checks that apply to all.
const EXAMPLES: Record<ActivityAction, Record<string, unknown>> = {
  'workspace.created': { name: 'Acme' },
  'workspace.renamed': { before: { name: 'Acme' }, after: { name: 'Acme Inc' } },
  'member.added': { user: BEN, role: 'member' },
  'member.removed': { user: BEN, role: 'member', self_removal: false },
  'member.role_changed': { user: BEN, before: { role: 'member' }, after: { role: 'admin' } },
  'project.created': { project: PROJECT },
  'project.updated': {
    project: { ...PROJECT, name: 'Website v2' },
    changed_fields: ['name', 'description'],
    before: { name: 'Website' },
    after: { name: 'Website v2' },
  },
  'project.archived': { project: PROJECT },
  'task.created': { task: TASK, status: 'todo' },
  'task.updated': {
    task: TASK,
    changed_fields: ['title', 'priority'],
    before: { title: 'Fix login', priority: 'medium' },
    after: { title: 'Fix login redirect', priority: 'high' },
  },
  'task.moved': { task: TASK, before: { status: 'todo' }, after: { status: 'in_review' } },
  'task.assigned': { task: TASK, before: { assignee: null }, after: { assignee: BEN } },
  'task.due_date_changed': { task: TASK, before: { due_date: null }, after: { due_date: '2026-12-01' } },
  'task.deleted': { task: TASK },
  'comment.created': { task: TASK, excerpt: 'Reproduced on Chrome and Firefox.' },
  'comment.edited': { task: TASK, excerpt: 'Reproduced on Chrome, Firefox and Safari.' },
  'comment.deleted': { task: TASK },
}

describe('every action', () => {
  it.each(Object.entries(EXAMPLES))('%s starts with the actor and names an entity', (action, metadata) => {
    const message = build(action, metadata)
    expect(message.parts[0]).toEqual({ kind: 'actor', text: 'Asha Rao' })
    expect(entities(message).length).toBeGreaterThan(0)
    expect(messageText(message)).not.toMatch(/undefined|null|\[object/)
  })

  it.each(Object.keys(EXAMPLES))('%s survives missing or malformed metadata', (action) => {
    for (const metadata of [{}, { task: 'WEB-1', project: 7, user: [], before: null, after: 'x', changed_fields: 'name' }]) {
      const text = say(action, metadata)
      expect(text.startsWith('Asha Rao ')).toBe(true)
      expect(text).not.toMatch(/undefined|null|\[object|NaN/)
    }
  })
})

describe('workspace', () => {
  it('created', () => {
    const message = build('workspace.created', { name: 'Acme' })
    expect(messageText(message)).toBe('Asha Rao created the workspace Acme')
    expect(entities(message)).toEqual(['Acme'])
  })

  it('renamed, emphasising the new name', () => {
    const message = build('workspace.renamed', EXAMPLES['workspace.renamed'])
    expect(messageText(message)).toBe('Asha Rao renamed the workspace from Acme to Acme Inc')
    expect(entities(message)).toEqual(['Acme Inc'])
  })

  it('renamed without the old name', () => {
    expect(say('workspace.renamed', { after: { name: 'Acme Inc' } })).toBe('Asha Rao renamed the workspace to Acme Inc')
  })
})

describe('members', () => {
  it('added, with the role', () => {
    const message = build('member.added', { user: BEN, role: 'member' })
    expect(messageText(message)).toBe('Asha Rao added Ben Okafor as Member')
    expect(entities(message)).toEqual(['Ben Okafor'])
    expect(say('member.added', { user: DANA, role: 'admin' })).toBe('Asha Rao added Dana Kim as Admin')
  })

  it('removed by someone else', () => {
    const message = build('member.removed', { user: BEN, role: 'member', self_removal: false })
    expect(messageText(message)).toBe('Asha Rao removed Ben Okafor from the workspace')
    expect(entities(message)).toEqual(['Ben Okafor'])
  })

  it('left the workspace (self removal)', () => {
    expect(say('member.removed', { user: BEN, role: 'member', self_removal: true }, BEN)).toBe(
      'Ben Okafor left the workspace',
    )
  })

  it('trusts self_removal over the ids, and falls back to the ids without it', () => {
    expect(say('member.removed', { user: BEN, self_removal: false }, BEN)).toBe(
      'Ben Okafor removed Ben Okafor from the workspace',
    )
    expect(say('member.removed', { user: BEN }, BEN)).toBe('Ben Okafor left the workspace')
    expect(say('member.removed', { user: BEN })).toBe('Asha Rao removed Ben Okafor from the workspace')
  })

  it('role changed', () => {
    const message = build('member.role_changed', EXAMPLES['member.role_changed'])
    expect(messageText(message)).toBe("Asha Rao changed Ben Okafor's role from Member to Admin")
    expect(entities(message)).toEqual(['Ben Okafor'])
    expect(say('member.role_changed', { user: DANA, before: { role: 'admin' }, after: { role: 'owner' } })).toBe(
      "Asha Rao changed Dana Kim's role from Admin to Owner",
    )
  })

  it('role changed with partial metadata', () => {
    expect(say('member.role_changed', { user: BEN, after: { role: 'viewer' } })).toBe(
      "Asha Rao changed Ben Okafor's role to Viewer",
    )
    expect(say('member.role_changed', { after: { role: 'viewer' } })).toBe(
      'Asha Rao changed the role of a member to Viewer',
    )
    // A role this UI does not know is shown as sent.
    expect(say('member.role_changed', { user: BEN, before: { role: 'member' }, after: { role: 'guest' } })).toBe(
      "Asha Rao changed Ben Okafor's role from Member to guest",
    )
  })
})

describe('projects', () => {
  it('created, with the key', () => {
    const message = build('project.created', { project: PROJECT })
    expect(messageText(message)).toBe('Asha Rao created project Website (WEB)')
    expect(entities(message)).toEqual(['Website'])
    expect(message.parts.find((part) => part.kind === 'entity')).toMatchObject({ ref: 'project' })
  })

  it('updated: names the changed fields, details the name but not the description', () => {
    const message = build('project.updated', EXAMPLES['project.updated'])
    expect(messageText(message)).toBe('Asha Rao updated the name and description of project Website v2')
    expect(message.details).toEqual(['Name changed from "Website" to "Website v2"'])
  })

  it('updated: description only', () => {
    const message = build('project.updated', { project: PROJECT, changed_fields: ['description'], before: {}, after: {} })
    expect(messageText(message)).toBe('Asha Rao updated the description of project Website')
    expect(message.details).toEqual([])
  })

  it('updated: without changed_fields', () => {
    expect(say('project.updated', { project: PROJECT })).toBe('Asha Rao updated project Website')
  })

  it('archived', () => {
    expect(say('project.archived', { project: PROJECT })).toBe('Asha Rao archived project Website')
  })
})

describe('tasks', () => {
  it('created, with the key and title as the entity and the column', () => {
    const message = build('task.created', { task: TASK, status: 'todo' })
    expect(messageText(message)).toBe('Asha Rao created WEB-1 Fix login redirect in To Do')
    expect(message.parts.find((part) => part.kind === 'entity')).toEqual({
      kind: 'entity',
      text: 'Fix login redirect',
      key: 'WEB-1',
      ref: 'task',
    })
  })

  it('updated: the changed fields in the sentence, before and after as details', () => {
    const message = build('task.updated', EXAMPLES['task.updated'])
    expect(messageText(message)).toBe('Asha Rao updated the title and priority of WEB-1 Fix login redirect')
    expect(message.details).toEqual([
      'Title changed from "Fix login" to "Fix login redirect"',
      'Priority changed from Medium to High',
    ])
  })

  it('updated: description is only named, three fields read as a list', () => {
    const message = build('task.updated', {
      task: TASK,
      changed_fields: ['title', 'description', 'priority'],
      before: { title: 'Fix login', priority: 'urgent' },
      after: { title: 'Fix login redirect', priority: 'low' },
    })
    expect(messageText(message)).toBe('Asha Rao updated the title, description and priority of WEB-1 Fix login redirect')
    expect(message.details).toEqual([
      'Title changed from "Fix login" to "Fix login redirect"',
      'Priority changed from Urgent to Low',
    ])
  })

  it('updated: description alone has no details', () => {
    const message = build('task.updated', { task: TASK, changed_fields: ['description'], before: {}, after: {} })
    expect(messageText(message)).toBe('Asha Rao updated the description of WEB-1 Fix login redirect')
    expect(message.details).toEqual([])
  })

  it('updated: an unknown field is named readably and detailed when its values are simple', () => {
    const message = build('task.updated', {
      task: TASK,
      changed_fields: ['story_points', 'tags'],
      before: { story_points: 3, tags: ['a'] },
      after: { story_points: null, tags: ['b'] },
    })
    expect(messageText(message)).toBe('Asha Rao updated the story points and tags of WEB-1 Fix login redirect')
    expect(message.details).toEqual(['Story points changed from 3 to none'])
  })

  it('moved between columns', () => {
    const message = build('task.moved', EXAMPLES['task.moved'])
    expect(messageText(message)).toBe('Asha Rao moved WEB-1 Fix login redirect from To Do to In Review')
    expect(entities(message)).toEqual(['WEB-1 Fix login redirect'])
  })

  it('reordered within a column', () => {
    expect(say('task.moved', { task: TASK, before: { status: 'todo' }, after: { status: 'todo' } })).toBe(
      'Asha Rao reordered WEB-1 Fix login redirect in To Do',
    )
  })

  it('moved with partial metadata', () => {
    expect(say('task.moved', { task: TASK, after: { status: 'done' } })).toBe('Asha Rao moved WEB-1 Fix login redirect to Done')
    expect(say('task.moved', { task: TASK })).toBe('Asha Rao moved WEB-1 Fix login redirect')
  })

  it('assigned', () => {
    expect(say('task.assigned', EXAMPLES['task.assigned'])).toBe('Asha Rao assigned WEB-1 Fix login redirect to Ben Okafor')
  })

  it('assigned to themselves', () => {
    expect(say('task.assigned', { task: TASK, before: { assignee: null }, after: { assignee: ASHA } })).toBe(
      'Asha Rao assigned WEB-1 Fix login redirect to themselves',
    )
  })

  it('unassigned', () => {
    expect(say('task.assigned', { task: TASK, before: { assignee: BEN }, after: { assignee: null } })).toBe(
      'Asha Rao unassigned Ben Okafor from WEB-1 Fix login redirect',
    )
    expect(say('task.assigned', { task: TASK, before: { assignee: ASHA }, after: { assignee: null } })).toBe(
      'Asha Rao unassigned themselves from WEB-1 Fix login redirect',
    )
  })

  it('reassigned', () => {
    expect(say('task.assigned', { task: TASK, before: { assignee: BEN }, after: { assignee: DANA } })).toBe(
      'Asha Rao reassigned WEB-1 Fix login redirect from Ben Okafor to Dana Kim',
    )
  })

  it('assigned without before and after', () => {
    expect(say('task.assigned', { task: TASK })).toBe('Asha Rao unassigned WEB-1 Fix login redirect')
  })

  it('due date set', () => {
    expect(say('task.due_date_changed', EXAMPLES['task.due_date_changed'])).toBe(
      `Asha Rao set the due date of WEB-1 Fix login redirect to ${formatDateOnly('2026-12-01')}`,
    )
  })

  it('due date changed', () => {
    expect(
      say('task.due_date_changed', { task: TASK, before: { due_date: '2026-12-01' }, after: { due_date: '2026-12-03' } }),
    ).toBe(
      `Asha Rao changed the due date of WEB-1 Fix login redirect from ${formatDateOnly('2026-12-01')} to ${formatDateOnly('2026-12-03')}`,
    )
  })

  it('due date cleared', () => {
    expect(say('task.due_date_changed', { task: TASK, before: { due_date: '2026-12-01' }, after: { due_date: null } })).toBe(
      `Asha Rao cleared the due date of WEB-1 Fix login redirect (was ${formatDateOnly('2026-12-01')})`,
    )
  })

  it('deleted', () => {
    expect(say('task.deleted', { task: TASK })).toBe('Asha Rao deleted WEB-1 Fix login redirect')
  })

  it('names a task by key or title alone, or as "a task"', () => {
    expect(say('task.deleted', { task: { id: 't', key: 'WEB-9' } })).toBe('Asha Rao deleted WEB-9')
    expect(say('task.deleted', { task: { id: 't', title: 'Untitled work' } })).toBe('Asha Rao deleted Untitled work')
    const message = build('task.deleted', {})
    expect(messageText(message)).toBe('Asha Rao deleted a task')
    expect(entities(message)).toEqual([])
  })
})

describe('comments', () => {
  it('created, with the excerpt', () => {
    const message = build('comment.created', EXAMPLES['comment.created'], BEN)
    expect(messageText(message)).toBe('Ben Okafor commented on WEB-1 Fix login redirect: "Reproduced on Chrome and Firefox."')
    expect(entities(message)).toEqual(['WEB-1 Fix login redirect'])
  })

  it('edited, with the new excerpt', () => {
    expect(say('comment.edited', EXAMPLES['comment.edited'], BEN)).toBe(
      'Ben Okafor edited a comment on WEB-1 Fix login redirect: "Reproduced on Chrome, Firefox and Safari."',
    )
  })

  it('deleted', () => {
    expect(say('comment.deleted', { task: TASK })).toBe('Asha Rao deleted a comment on WEB-1 Fix login redirect')
  })

  it('puts a multi-line excerpt on one line', () => {
    expect(say('comment.created', { task: TASK, excerpt: 'First line\n\nsecond   line ' })).toBe(
      'Asha Rao commented on WEB-1 Fix login redirect: "First line second line"',
    )
  })

  it('marks a full-length excerpt as cut, unless it already is', () => {
    const long = 'x'.repeat(EXCERPT_LENGTH)
    expect(say('comment.created', { task: TASK, excerpt: long })).toBe(
      `Asha Rao commented on WEB-1 Fix login redirect: "${long}…"`,
    )
    expect(say('comment.created', { task: TASK, excerpt: 'Reproduced on Chrome...' })).toBe(
      'Asha Rao commented on WEB-1 Fix login redirect: "Reproduced on Chrome..."',
    )
  })

  it('leaves out a missing excerpt', () => {
    expect(say('comment.created', { task: TASK })).toBe('Asha Rao commented on WEB-1 Fix login redirect')
  })
})

describe('safety and fallbacks', () => {
  it('gives unknown actions a generic message', () => {
    const message = build('invoice.paid', { amount: 5 })
    expect(messageText(message)).toBe('Asha Rao made a change (invoice.paid)')
    expect(message.details).toEqual([])
  })

  it('does not treat inherited object keys as actions', () => {
    expect(say('toString', {})).toBe('Asha Rao made a change (toString)')
    expect(say('constructor', {})).toBe('Asha Rao made a change (constructor)')
  })

  it('names a missing actor "Someone"', () => {
    expect(say('task.deleted', { task: TASK }, { id: 'u', name: '' })).toBe('Someone deleted WEB-1 Fix login redirect')
  })

  it('keeps markup in metadata as plain text', () => {
    const title = '<img src=x onerror="alert(1)">'
    const message = build('task.created', { task: { id: 't', key: 'WEB-1', title }, status: 'todo' })
    expect(message.parts).toContainEqual({ kind: 'entity', text: title, key: 'WEB-1', ref: 'task' })
    expect(messageText(message)).toBe(`Asha Rao created WEB-1 ${title} in To Do`)
  })

  it('accepts metadata that is not an object', () => {
    expect(
      messageText(buildActivityMessage({ action: 'task.deleted', actor: ASHA, metadata: null as unknown as Record<string, unknown> })),
    ).toBe('Asha Rao deleted a task')
  })
})
