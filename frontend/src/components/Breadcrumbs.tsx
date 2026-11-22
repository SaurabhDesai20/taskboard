import { Link } from 'react-router'

export interface Crumb {
  label: string
  /** Omitted for the current page (the last crumb). */
  to?: string
}

/** "Workspaces / Acme / Website": links up the hierarchy, the current page last. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs__list">
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`} className="breadcrumbs__item">
            {item.to ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
