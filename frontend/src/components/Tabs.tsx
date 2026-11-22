import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem {
  /** Unique within the tab list. */
  id: string
  label: string
  /** Rendered the first time the tab is shown, then kept (hidden) while another tab is open. */
  panel: ReactNode
}

interface TabsProps {
  /** Accessible name of the tab list. */
  label: string
  tabs: readonly TabItem[]
  className?: string
}

/**
 * Accessible tabs (WAI-ARIA tabs pattern, automatic activation): one Tab stop for the whole list,
 * Left/Right arrows move between tabs (wrapping), Home and End jump to the first and last. The
 * first tab is open at first. A panel mounts when its tab is first opened and stays mounted, so
 * drafts in it survive switching tabs.
 */
export function Tabs({ label, tabs, className }: TabsProps) {
  const baseId = useId()
  const [selected, setSelected] = useState(tabs[0]?.id)
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(tabs[0] ? [tabs[0].id] : []))
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  const tabId = (id: string) => `${baseId}-tab-${id}`
  const panelId = (id: string) => `${baseId}-panel-${id}`

  function open(id: string) {
    setSelected(id)
    setOpened((current) => (current.has(id) ? current : new Set([...current, id])))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    const target = tabs[next]
    open(target.id)
    tabRefs.current.get(target.id)?.focus()
  }

  return (
    <div className={['tabs', className].filter(Boolean).join(' ')}>
      <div role="tablist" aria-label={label} className="tabs__list">
        {tabs.map((tab, index) => {
          const active = tab.id === selected
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element)
                else tabRefs.current.delete(tab.id)
              }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              className="tabs__tab"
              aria-selected={active}
              aria-controls={panelId(tab.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => open(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={panelId(tab.id)}
          role="tabpanel"
          className="tabs__panel"
          aria-labelledby={tabId(tab.id)}
          hidden={tab.id !== selected}
          // Reachable with Tab even when the panel has nothing focusable (yet).
          tabIndex={0}
        >
          {opened.has(tab.id) ? tab.panel : null}
        </div>
      ))}
    </div>
  )
}
