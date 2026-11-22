import type { KeyboardEvent } from 'react'

/** Ctrl+Enter (Windows, Linux) or Cmd+Enter (macOS): send the comment being written. */
export function isSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing
}
