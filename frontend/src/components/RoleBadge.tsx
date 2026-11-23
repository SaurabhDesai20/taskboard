import type { Role } from '../api/types'
import { ROLE_LABELS } from '../lib/permissions'

/** A workspace role as a small colored label (Owner, Admin, Member, Viewer). */
export function RoleBadge({ role }: { role: Role }) {
  return <span className={`role-badge role-badge--${role}`}>{ROLE_LABELS[role]}</span>
}
