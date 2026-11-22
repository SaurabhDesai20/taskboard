import './comments.css'

/** "3 comments" for screen readers and as a tooltip. */
function commentCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'comment' : 'comments'}`
}

/** A speech bubble with the number of comments, for task cards; nothing when there are none. */
export function CommentCount({ count }: { count: number }) {
  if (count <= 0) return null
  const label = commentCountLabel(count)
  return (
    <span className="comment-count" title={label}>
      <svg className="comment-count__icon" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
        <path
          d="M3 2.5h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5L4.5 13.5V11H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
