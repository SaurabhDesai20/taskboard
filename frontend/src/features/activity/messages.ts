// Human-readable activity messages (contract 3.8), built from an entry's `action`, `metadata`
// and `actor` alone. Metadata holds snapshots (names, keys, titles at the time of the action), so
// nothing is looked up: the task or project may have been renamed or deleted since.
//
// The result is a list of parts, not markup: the UI renders each part as text (the entity
// emphasised), so nothing in the metadata can inject HTML. `metadata` is typed loosely by the
// API; every value is checked here before use, and a missing or malformed value gives a vaguer
// message rather than an error. An action this UI does not know yet gets a generic message.
import type { ActivityAction, ActivityRead } from '../../api/types'
import { formatDateOnly } from '../../lib/dates'
import { isRole, ROLE_LABELS } from '../../lib/permissions'
import { isTaskPriority, isTaskStatus, PRIORITY_LABELS, STATUS_LABELS } from '../tasks/labels'

/**
 * One piece of a message: plain text, the actor's name, or the entity the action was about
 * (shown emphasised). A task entity carries its key (`WEB-1`) apart from its title, and `ref`
 * says what an entity link may point to.
 */
export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'actor'; text: string }
  | { kind: 'entity'; text: string; key?: string; ref?: 'task' | 'project' }

export interface ActivityMessage {
  /** The sentence, starting with the actor: "Asha Rao moved WEB-1 Fix login redirect from ...". */
  parts: MessagePart[]
  /** Old and new values of changed fields, e.g. "Priority changed from Medium to High". */
  details: string[]
}

/** What the builder reads from an entry. `action` may be one this UI does not know yet. */
export interface ActivityMessageInput {
  action: string
  actor: ActivityRead['actor']
  metadata: ActivityRead['metadata']
}

/** The message as one plain string (a task entity reads "WEB-1 Fix login redirect"). */
export function messageText(message: Pick<ActivityMessage, 'parts'>): string {
  return message.parts.map(partText).join('')
}

export function partText(part: MessagePart): string {
  return part.kind === 'entity' && part.key ? `${part.key} ${part.text}` : part.text
}

/** Comment excerpts are the first 140 characters of the body (contract 3.8). */
export const EXCERPT_LENGTH = 140

// ---------------------------------------------------------------------------------------------
// Reading metadata safely
// ---------------------------------------------------------------------------------------------

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-blank string, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** A nested object (`before`, `after`, `task`, ...), or an empty one. */
function child(value: Json, name: string): Json {
  const nested = value[name]
  return isObject(nested) ? nested : {}
}

interface Person {
  id?: string
  name: string
}

/** A `UserRef` snapshot, or null when there is none (an unassigned task). */
function readPerson(value: unknown): Person | null {
  if (!isObject(value)) return null
  const name = text(value.name)
  const id = text(value.id)
  if (!name && !id) return null
  return { id, name: name ?? 'someone' }
}

/** A role's label ("Admin"); a value that is not a role is shown as sent. */
function roleLabel(value: unknown): string | undefined {
  if (isRole(value)) return ROLE_LABELS[value]
  return text(value)
}

function statusLabel(value: unknown): string | undefined {
  if (isTaskStatus(value)) return STATUS_LABELS[value]
  return text(value)
}

function dateLabel(value: unknown): string | undefined {
  const date = text(value)
  return date === undefined ? undefined : formatDateOnly(date)
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

type Piece = string | MessagePart

const entity = (value: string): MessagePart => ({ kind: 'entity', text: value })

/** `TaskRef` (`{ id, key, title }`) as "WEB-1 Fix login redirect", or "a task" without one. */
function taskEntity(metadata: Json): Piece {
  const task = child(metadata, 'task')
  const key = text(task.key)
  const title = text(task.title)
  if (title) return { kind: 'entity', text: title, key, ref: 'task' }
  if (key) return { kind: 'entity', text: key, ref: 'task' }
  return 'a task'
}

/** `ProjectRef` (`{ id, name, key }`) by name, or "a project" without one. */
function projectEntity(metadata: Json): Piece {
  const project = child(metadata, 'project')
  const name = text(project.name) ?? text(project.key)
  return name ? { kind: 'entity', text: name, ref: 'project' } : 'a project'
}

/** The member an action was about (`metadata.user`), or "a member". */
function memberEntity(metadata: Json): Piece {
  const user = readPerson(metadata.user)
  return user ? entity(user.name) : 'a member'
}

/** "title", "title and priority", "name, description and key". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

/** How a field's name reads in a sentence: `due_date` -> "due date". */
const fieldName = (field: string) => field.replace(/_/g, ' ')

/** Fields whose values are only named, never shown (contract 3.8: they can be long). */
const NAME_ONLY_FIELDS = new Set(['description'])

/** Fields whose values are quoted in the details (free text). */
const QUOTED_FIELDS = new Set(['title', 'name'])

/** A value from `before`/`after` as shown in a detail line, or undefined if it cannot be shown. */
function fieldValue(field: string, value: unknown): string | undefined {
  if (value === null) return 'none'
  if (field === 'priority' && isTaskPriority(value)) return PRIORITY_LABELS[value]
  if (field === 'status' && isTaskStatus(value)) return STATUS_LABELS[value]
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') return undefined
  return QUOTED_FIELDS.has(field) ? `"${value}"` : value
}

/**
 * `changed_fields` with `before`/`after` (`task.updated`, `project.updated`): the field names for
 * the sentence, and one detail line per field whose values are known, description excepted.
 */
function readChanges(metadata: Json): { fields: string[]; details: string[] } {
  const raw = metadata.changed_fields
  const fields = Array.isArray(raw) ? [...new Set(raw.filter((field): field is string => text(field) !== undefined))] : []
  const before = child(metadata, 'before')
  const after = child(metadata, 'after')
  const details: string[] = []
  for (const field of fields) {
    if (NAME_ONLY_FIELDS.has(field) || !(field in before) || !(field in after)) continue
    const from = fieldValue(field, before[field])
    const to = fieldValue(field, after[field])
    if (from !== undefined && to !== undefined) {
      details.push(`${capitalize(fieldName(field))} changed from ${from} to ${to}`)
    }
  }
  return { fields: fields.map(fieldName), details }
}

/** A comment excerpt on one line, marked as cut when it is as long as an excerpt gets. */
function excerptOf(metadata: Json): string | undefined {
  const excerpt = text(metadata.excerpt)?.replace(/\s+/g, ' ').trim()
  if (!excerpt) return undefined
  const cut = [...excerpt].length >= EXCERPT_LENGTH && !/(\.\.\.|…)$/.test(excerpt)
  return cut ? `${excerpt}…` : excerpt
}

const quoted = (excerpt: string | undefined): Piece[] => (excerpt ? [`: "${excerpt}"`] : [])

// ---------------------------------------------------------------------------------------------
// One builder per action
// ---------------------------------------------------------------------------------------------

interface Context {
  metadata: Json
  /** The actor's id, to say "themselves" when people act on their own account. */
  actorId: string | undefined
}

interface Built {
  /** Everything after the actor's name. */
  pieces: Piece[]
  details?: string[]
}

/** Someone a task is or was assigned to, by name ("themselves" for the actor). */
function assigneeName(person: Person, actorId: string | undefined): string {
  return person.id !== undefined && person.id === actorId ? 'themselves' : person.name
}

/** Exhaustive: adding an action to `ActivityAction` without a builder is a type error. */
const BUILDERS: Record<ActivityAction, (context: Context) => Built> = {
  'workspace.created': ({ metadata }) => {
    const name = text(metadata.name)
    return { pieces: name ? [' created the workspace ', entity(name)] : [' created the workspace'] }
  },

  'workspace.renamed': ({ metadata }) => {
    const from = text(child(metadata, 'before').name)
    const to = text(child(metadata, 'after').name)
    if (!to) return { pieces: [' renamed the workspace'] }
    return { pieces: from ? [' renamed the workspace from ', from, ' to ', entity(to)] : [' renamed the workspace to ', entity(to)] }
  },

  'member.added': ({ metadata }) => {
    const role = roleLabel(metadata.role)
    return { pieces: [' added ', memberEntity(metadata), ...(role ? [` as ${role}`] : [])] }
  },

  'member.removed': ({ metadata, actorId }) => {
    const user = readPerson(metadata.user)
    const selfRemoval =
      typeof metadata.self_removal === 'boolean' ? metadata.self_removal : user?.id !== undefined && user.id === actorId
    if (selfRemoval) return { pieces: [' left the workspace'] }
    return { pieces: [' removed ', memberEntity(metadata), ' from the workspace'] }
  },

  'member.role_changed': ({ metadata }) => {
    const from = roleLabel(child(metadata, 'before').role)
    const to = roleLabel(child(metadata, 'after').role)
    const member = memberEntity(metadata)
    // "changed Ben Okafor's role", but "changed the role of a member" without a name.
    const subject: Piece[] = typeof member === 'string' ? [' changed the role of ', member] : [' changed ', member, "'s role"]
    if (!to) return { pieces: subject }
    return { pieces: [...subject, ...(from ? [` from ${from}`] : []), ` to ${to}`] }
  },

  'project.created': ({ metadata }) => {
    const key = text(child(metadata, 'project').key)
    const project = projectEntity(metadata)
    const showKey = key && typeof project !== 'string' && project.text !== key
    return { pieces: [' created project ', project, ...(showKey ? [` (${key})`] : [])] }
  },

  'project.updated': ({ metadata }) => {
    const { fields, details } = readChanges(metadata)
    const project = projectEntity(metadata)
    if (fields.length === 0) return { pieces: [' updated project ', project] }
    return { pieces: [` updated the ${joinWords(fields)} of project `, project], details }
  },

  'project.archived': ({ metadata }) => ({ pieces: [' archived project ', projectEntity(metadata)] }),

  'task.created': ({ metadata }) => {
    const status = statusLabel(metadata.status)
    return { pieces: [' created ', taskEntity(metadata), ...(status ? [` in ${status}`] : [])] }
  },

  'task.updated': ({ metadata }) => {
    const { fields, details } = readChanges(metadata)
    const task = taskEntity(metadata)
    if (fields.length === 0) return { pieces: [' updated ', task] }
    return { pieces: [` updated the ${joinWords(fields)} of `, task], details }
  },

  'task.moved': ({ metadata }) => {
    const from = statusLabel(child(metadata, 'before').status)
    const to = statusLabel(child(metadata, 'after').status)
    const task = taskEntity(metadata)
    // Same column: a new place in the column, not a new status (contract 3.8).
    if (to && from === to) return { pieces: [' reordered ', task, ` in ${to}`] }
    if (!to) return { pieces: [' moved ', task] }
    return { pieces: [' moved ', task, ...(from ? [` from ${from}`] : []), ` to ${to}`] }
  },

  'task.assigned': ({ metadata, actorId }) => {
    const from = readPerson(child(metadata, 'before').assignee)
    const to = readPerson(child(metadata, 'after').assignee)
    const task = taskEntity(metadata)
    if (to && from && from.id !== to.id) {
      return {
        pieces: [' reassigned ', task, ` from ${assigneeName(from, actorId)} to ${assigneeName(to, actorId)}`],
      }
    }
    if (to) return { pieces: [' assigned ', task, ` to ${assigneeName(to, actorId)}`] }
    if (from) return { pieces: [` unassigned ${assigneeName(from, actorId)} from `, task] }
    return { pieces: [' unassigned ', task] }
  },

  'task.due_date_changed': ({ metadata }) => {
    const from = dateLabel(child(metadata, 'before').due_date)
    const to = dateLabel(child(metadata, 'after').due_date)
    const task = taskEntity(metadata)
    if (to && from) return { pieces: [' changed the due date of ', task, ` from ${from} to ${to}`] }
    if (to) return { pieces: [' set the due date of ', task, ` to ${to}`] }
    if (from) return { pieces: [' cleared the due date of ', task, ` (was ${from})`] }
    return { pieces: [' changed the due date of ', task] }
  },

  'task.deleted': ({ metadata }) => ({ pieces: [' deleted ', taskEntity(metadata)] }),

  'comment.created': ({ metadata }) => ({
    pieces: [' commented on ', taskEntity(metadata), ...quoted(excerptOf(metadata))],
  }),

  'comment.edited': ({ metadata }) => ({
    pieces: [' edited a comment on ', taskEntity(metadata), ...quoted(excerptOf(metadata))],
  }),

  'comment.deleted': ({ metadata }) => ({ pieces: [' deleted a comment on ', taskEntity(metadata)] }),
}

function isKnownAction(action: string): action is ActivityAction {
  return Object.prototype.hasOwnProperty.call(BUILDERS, action)
}

/** Turns strings into text parts and merges neighbouring text. */
function toParts(pieces: readonly Piece[]): MessagePart[] {
  const parts: MessagePart[] = []
  for (const piece of pieces) {
    const part: MessagePart = typeof piece === 'string' ? { kind: 'text', text: piece } : piece
    const last = parts[parts.length - 1]
    if (part.kind === 'text' && last?.kind === 'text') {
      parts[parts.length - 1] = { kind: 'text', text: last.text + part.text }
    } else if (part.text !== '') {
      parts.push(part)
    }
  }
  return parts
}

/**
 * The readable message for an activity entry, e.g. "Asha Rao moved WEB-1 Fix login redirect from
 * To Do to In Review" with the task as the emphasised entity. Never throws.
 */
export function buildActivityMessage({ action, actor, metadata }: ActivityMessageInput): ActivityMessage {
  const context: Context = { metadata: isObject(metadata) ? metadata : {}, actorId: text(actor?.id) }
  const built: Built = isKnownAction(action)
    ? BUILDERS[action](context)
    : // A newer backend may send actions this UI does not know yet.
      { pieces: [` made a change (${text(action) ?? 'unknown action'})`] }
  const actorPart: MessagePart = { kind: 'actor', text: text(actor?.name) ?? 'Someone' }
  return { parts: [actorPart, ...toParts(built.pieces)], details: built.details ?? [] }
}
