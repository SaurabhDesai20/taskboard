import { Link } from 'react-router'
import type { ActivityRead } from '../../api/types'
import { Avatar } from '../../components/Avatar'
import { RelativeTime } from '../../components/RelativeTime'
import { projectPath } from '../projects/paths'
import { taskPath } from '../tasks/paths'
import { buildActivityMessage, type MessagePart } from './messages'

interface ActivityItemProps {
  entry: ActivityRead
  /** The feed's clock, for "5 minutes ago". */
  now: Date
  /** The workspace's slug, to link the task or project an entry is about; no links without it. */
  linkSlug?: string
}

/**
 * Where an entity of `entry` may link to: its task (opened in the board's drawer) or project, as
 * long as the entry still points at it. Entries of deleted tasks have no `task_id`.
 */
function entityHref(entry: ActivityRead, part: MessagePart, slug: string | undefined): string | null {
  if (!slug || part.kind !== 'entity' || !entry.project_id) return null
  if (part.ref === 'project') return projectPath(slug, entry.project_id)
  if (part.ref === 'task' && entry.task_id && entry.action !== 'task.deleted') {
    return taskPath(slug, entry.project_id, entry.task_id)
  }
  return null
}

/** One part of a message, always as text (React escapes it), the entity emphasised. */
function Part({ part, href }: { part: MessagePart; href: string | null }) {
  if (part.kind === 'text') return part.text
  if (part.kind === 'actor') return <span className="activity-item__actor">{part.text}</span>
  const content = (
    <strong className="activity-item__entity">
      {part.key ? <span className="activity-item__key">{part.key}</span> : null}
      {part.key ? ' ' : null}
      {part.text}
    </strong>
  )
  return href ? <Link to={href}>{content}</Link> : content
}

/**
 * One activity entry: the actor's avatar, the message built from `action` + `metadata` (with the
 * old and new values of changed fields below it) and when it happened.
 */
export function ActivityItem({ entry, now, linkSlug }: ActivityItemProps) {
  const message = buildActivityMessage(entry)
  return (
    <li className="activity-item">
      <Avatar name={entry.actor.name} size="small" />
      <div className="activity-item__main">
        <p className="activity-item__message">
          {message.parts.map((part, index) => (
            <Part key={index} part={part} href={entityHref(entry, part, linkSlug)} />
          ))}
        </p>
        {message.details.length > 0 ? (
          <ul className="activity-item__details">
            {message.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <p className="activity-item__time">
          <RelativeTime timestamp={entry.created_at} now={now} />
        </p>
      </div>
    </li>
  )
}
