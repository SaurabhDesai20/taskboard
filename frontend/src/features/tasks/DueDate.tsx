import type { DateOnly } from '../../api/types'
import { formatDateOnly } from '../../lib/dates'

interface DueDateProps {
  date: DateOnly
  /** Due before today and not done: shown in red with an "Overdue" label (not by color alone). */
  overdue: boolean
}

/** "Due Dec 1, 2026", or "Overdue Due Nov 20, 2026" in red. */
export function DueDate({ date, overdue }: DueDateProps) {
  return (
    <span className={`due-date${overdue ? ' due-date--overdue' : ''}`}>
      {overdue ? <span className="due-date__flag">Overdue</span> : null}
      <span>
        Due <time dateTime={date}>{formatDateOnly(date)}</time>
      </span>
    </span>
  )
}
