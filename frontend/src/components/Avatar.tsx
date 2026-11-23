import { initialsOf } from '../lib/initials'

interface AvatarProps {
  name: string
  size?: 'small' | 'medium'
}

/**
 * A round badge with a person's initials. Decorative: the caller puts the name in text next to
 * it, or in visually hidden text, because the initials alone are not a good accessible name.
 */
export function Avatar({ name, size = 'medium' }: AvatarProps) {
  return (
    <span className={`avatar${size === 'small' ? ' avatar--small' : ''}`} aria-hidden="true" title={name}>
      {initialsOf(name)}
    </span>
  )
}
