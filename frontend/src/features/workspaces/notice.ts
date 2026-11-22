// A one-off message for the page we navigate to (e.g. "You left Acme."), carried in the router
// location state so it disappears on the next navigation.

export interface NoticeState {
  notice: string
}

export function noticeState(notice: string): NoticeState {
  return { notice }
}

export function noticeFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null
  return typeof state.notice === 'string' ? state.notice : null
}
