import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '../../lib/dates'
import {
  activityOf,
  db,
  MOCK_PROJECTS,
  MOCK_TASK_IDS,
  MOCK_USERS,
  MOCK_WORKSPACES,
  recordActivity,
  startMockSession,
} from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { projectPath } from '../projects/paths'
import { taskPath } from '../tasks/paths'

const { acme } = MOCK_WORKSPACES
const { website, legacy } = MOCK_PROJECTS
const { asha, dana, eve } = MOCK_USERS
const FEED = '/w/acme/activity'
const ACTIVITY_API = '/api/workspaces/:wid/activity'

/**
 * Stands in for the browser's IntersectionObserver (jsdom has none): records what is observed,
 * and `reveal()` reports an element as scrolled into view to the observers watching it.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly targets = new Set<Element>()
  readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
  takeRecords() {
    return []
  }
}

function reveal(target: Element) {
  act(() => {
    for (const observer of FakeIntersectionObserver.instances) {
      if (!observer.targets.has(target)) continue
      const entry = { isIntersecting: true, target } as IntersectionObserverEntry
      observer.callback([entry], observer as unknown as IntersectionObserver)
    }
  })
}

const watched = (target: Element) => FakeIntersectionObserver.instances.some((observer) => observer.targets.has(target))

beforeEach(() => {
  FakeIntersectionObserver.instances = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderFeed(who: keyof typeof MOCK_USERS = 'asha', query = '') {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: `${FEED}${query}` })
}

const feedList = () => screen.findByRole('list', { name: 'Activity in Acme' })

/** The entries of the list (not their detail lines), in order. */
const items = (list: HTMLElement) => Array.from(list.querySelectorAll<HTMLElement>(':scope > li'))
const messages = (list: HTMLElement) =>
  items(list).map((item) => item.querySelector('.activity-item__message')?.textContent)
const itemWith = (list: HTMLElement, text: string) =>
  items(list).find((item) => item.querySelector('.activity-item__message')?.textContent === text) as HTMLElement

/** Records the URLs of the feed requests, then lets the mock answer. */
function spyOnFeedRequests(): URL[] {
  const urls: URL[] = []
  server.use(
    http.get(ACTIVITY_API, ({ request }) => {
      urls.push(new URL(request.url))
    }),
  )
  return urls
}

const NEWEST = 'Asha Rao updated the description of WEB-7 Accessibility audit'
const OLDEST = 'Asha Rao created the workspace Acme'

describe('the feed', () => {
  it('is a tab of the workspace pages', async () => {
    const user = userEvent.setup()
    startMockSession(asha.id)
    const { router } = renderRoute({ route: '/w/acme' })

    const nav = await screen.findByRole('navigation', { name: 'Workspace' })
    await user.click(within(nav).getByRole('link', { name: 'Activity' }))

    expect(router.state.location.pathname).toBe(FEED)
    expect(within(nav).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toBeInTheDocument()
    expect(messages(await feedList())[0]).toBe(NEWEST)
  })

  it('shows the newest 20 entries first, each with avatar, message and relative time', async () => {
    renderFeed()
    const list = await feedList()

    expect(items(list)).toHaveLength(20)
    expect(messages(list).slice(0, 6)).toEqual([
      NEWEST,
      'Asha Rao commented on WEB-5 Review signup form: "Looks good to me once the hint moves."',
      'Asha Rao reordered WEB-7 Accessibility audit in In Progress',
      'Asha Rao edited a comment on WEB-1 Fix login redirect: "Thanks! Can you check Safari too? It may be the same cookie issue."',
      'Asha Rao commented on WEB-1 Fix login redirect: "Thanks! Can you check Safari too?"',
      'Ben Okafor commented on WEB-1 Fix login redirect: "Reproduced on Chrome and Firefox."',
    ])

    const first = items(list)[0]
    const newest = activityOf(acme.id)[0]
    expect(first.querySelector('.avatar')).toHaveTextContent('AR')
    expect(first.querySelector('.avatar')).toHaveAttribute('aria-hidden', 'true')
    const time = first.querySelector('time')
    expect(time).toHaveAttribute('datetime', newest.created_at)
    expect(time).toHaveAttribute('title', formatDateTime(newest.created_at))
    expect(time).toHaveTextContent('10 minutes ago')
  })

  it('lists the old and new values of changed fields under the message', async () => {
    renderFeed()
    const item = itemWith(await feedList(), 'Asha Rao updated the priority of WEB-5 Review signup form')
    expect(within(item).getByRole('listitem')).toHaveTextContent('Priority changed from High to Urgent')
  })

  it('emphasises the entity and links it to its task or project', async () => {
    renderFeed()
    const list = await feedList()

    const moved = itemWith(list, 'Asha Rao reordered WEB-7 Accessibility audit in In Progress')
    expect(moved.querySelector('strong')).toHaveTextContent('WEB-7 Accessibility audit')
    expect(within(moved).getByRole('link', { name: 'WEB-7 Accessibility audit' })).toHaveAttribute(
      'href',
      taskPath('acme', website.id, MOCK_TASK_IDS.web7),
    )
    const archived = itemWith(list, 'Asha Rao archived project Legacy CRM')
    expect(within(archived).getByRole('link', { name: 'Legacy CRM' })).toHaveAttribute('href', projectPath('acme', legacy.id))
  })

  it('does not link a deleted task', async () => {
    recordActivity({
      workspace_id: acme.id,
      project_id: website.id,
      task_id: null,
      actor_id: asha.id,
      action: 'task.deleted',
      entity_type: 'task',
      entity_id: MOCK_TASK_IDS.web2,
      metadata: { task: { id: MOCK_TASK_IDS.web2, key: 'WEB-2', title: 'Write onboarding copy' } },
    })
    renderFeed()
    const deleted = itemWith(await feedList(), 'Asha Rao deleted WEB-2 Write onboarding copy')
    expect(deleted.querySelector('strong')).toHaveTextContent('WEB-2 Write onboarding copy')
    expect(within(deleted).queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows metadata as plain text, never as HTML', async () => {
    const title = '<img src=x onerror="alert(1)"><b>bold</b>'
    recordActivity({
      workspace_id: acme.id,
      project_id: website.id,
      task_id: MOCK_TASK_IDS.web2,
      actor_id: asha.id,
      action: 'task.created',
      entity_type: 'task',
      entity_id: MOCK_TASK_IDS.web2,
      metadata: { task: { id: MOCK_TASK_IDS.web2, key: 'WEB-2', title }, status: 'todo' },
    })
    renderFeed()
    const list = await feedList()
    expect(messages(list)[0]).toBe(`Asha Rao created WEB-2 ${title} in To Do`)
    expect(list.querySelector('img, b')).toBeNull()
  })

  it('shows an unknown action with a generic message', async () => {
    recordActivity({
      workspace_id: acme.id,
      project_id: null,
      task_id: null,
      actor_id: dana.id,
      action: 'invoice.paid' as never,
      entity_type: 'workspace',
      entity_id: acme.id,
      metadata: {},
    })
    renderFeed()
    expect(messages(await feedList())[0]).toBe('Dana Kim made a change (invoice.paid)')
  })

  it('is open to every role', async () => {
    renderFeed('chen')
    expect(messages(await feedList())[0]).toBe(NEWEST)
  })
})

describe('loading older entries', () => {
  it('"Load more activity" loads the next page with next_cursor, then says there is nothing older', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const user = userEvent.setup()
    const requests = spyOnFeedRequests()
    renderFeed()
    const list = await feedList()

    await user.click(screen.getByRole('button', { name: 'Load more activity' }))

    await waitFor(() => expect(items(list)).toHaveLength(25))
    expect(messages(list).at(-1)).toBe(OLDEST)
    expect(screen.getByText('No older activity.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more activity' })).not.toBeInTheDocument()
    expect(requests).toHaveLength(2)
    expect(requests[0].searchParams.get('limit')).toBe('20')
    expect(requests[0].searchParams.has('cursor')).toBe(false)
    expect(requests[1].searchParams.get('cursor')).toEqual(expect.any(String))
  })

  it('loads the next page when the end of the list scrolls into view (infinite scroll)', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const requests = spyOnFeedRequests()
    renderFeed()
    const list = await feedList()
    const sentinel = document.querySelector('.activity-feed__sentinel') as HTMLElement
    await waitFor(() => expect(watched(sentinel)).toBe(true))
    // Nothing more loads until the end of the list is reached.
    expect(requests).toHaveLength(1)

    reveal(sentinel)

    await waitFor(() => expect(items(list)).toHaveLength(25))
    expect(requests).toHaveLength(2)
    expect(screen.getByText('No older activity.')).toBeInTheDocument()
    // The last page is in: nothing is watched any more, so nothing else loads.
    expect(watched(sentinel)).toBe(false)
  })

  it('keeps going while the end of a short page stays in view, and stops on the last page', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    for (let n = 1; n <= 30; n += 1) {
      recordActivity({
        workspace_id: acme.id,
        project_id: null,
        task_id: null,
        actor_id: asha.id,
        action: 'workspace.renamed',
        entity_type: 'workspace',
        entity_id: acme.id,
        metadata: { before: { name: `Acme ${n - 1}` }, after: { name: `Acme ${n}` } },
      })
    }
    const requests = spyOnFeedRequests()
    renderFeed()
    const list = await feedList()

    // Each time a page arrives the sentinel is watched again; it is still in view.
    for (const expected of [40, 55]) {
      const sentinel = document.querySelector('.activity-feed__sentinel') as HTMLElement
      await waitFor(() => expect(watched(sentinel)).toBe(true))
      reveal(sentinel)
      await waitFor(() => expect(items(list)).toHaveLength(expected))
    }
    expect(requests).toHaveLength(3)
    expect(document.querySelector('.activity-feed__sentinel')).toBeNull()
  })

  it('shows a failed page with the button to try again, and does not retry on its own', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const user = userEvent.setup()
    let failures = 1
    server.use(
      http.get(ACTIVITY_API, ({ request }) => {
        if (new URL(request.url).searchParams.has('cursor') && failures > 0) {
          failures -= 1
          return HttpResponse.json(
            { error: { code: 'internal_error', message: 'Server exploded', details: {} } },
            { status: 500 },
          )
        }
        return undefined
      }),
    )
    renderFeed()
    const list = await feedList()
    const sentinel = document.querySelector('.activity-feed__sentinel') as HTMLElement
    await waitFor(() => expect(watched(sentinel)).toBe(true))

    reveal(sentinel)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load older activity. Server exploded')
    expect(items(list)).toHaveLength(20)
    expect(watched(sentinel)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Load more activity' }))
    await waitFor(() => expect(items(list)).toHaveLength(25))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('filters', () => {
  it('filters by project (archived ones included), in the URL and the request', async () => {
    const user = userEvent.setup()
    const requests = spyOnFeedRequests()
    const { router } = renderFeed()
    await feedList()
    const project = screen.getByRole('combobox', { name: 'Project' })
    expect(within(project).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All projects',
      'Legacy CRM (archived)',
      'Mobile App',
      'Website',
    ])

    await user.selectOptions(project, 'Legacy CRM (archived)')

    await waitFor(() =>
      expect(messages(screen.getByRole('list', { name: 'Activity in Acme' }))).toEqual([
        'Asha Rao archived project Legacy CRM',
        'Asha Rao created project Legacy CRM (CRM)',
      ]),
    )
    expect(router.state.location.search).toBe(`?project=${legacy.id}`)
    expect(requests.at(-1)?.searchParams.get('project_id')).toBe(legacy.id)
    expect(screen.getByText('No older activity.')).toBeInTheDocument()
  })

  it('filters by person', async () => {
    const user = userEvent.setup()
    const requests = spyOnFeedRequests()
    const { router } = renderFeed()
    await feedList()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Person' }), 'Dana Kim')

    await waitFor(() =>
      expect(messages(screen.getByRole('list', { name: 'Activity in Acme' }))).toEqual([
        'Dana Kim commented on WEB-5 Review signup form: "The password rules only show up after the first error."',
        'Dana Kim created APP-1 Push notifications in To Do',
        'Dana Kim created project Mobile App (APP)',
      ]),
    )
    expect(router.state.location.search).toBe(`?actor=${dana.id}`)
    expect(requests.at(-1)?.searchParams.get('actor_id')).toBe(dana.id)
  })

  it('starts from the URL, combines both filters, and "Clear filters" goes back to everything', async () => {
    const user = userEvent.setup()
    const { router } = renderFeed('asha', `?project=${website.id}&actor=${MOCK_USERS.ben.id}`)
    const list = await feedList()

    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue(website.id)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Person' })).toHaveValue(MOCK_USERS.ben.id))
    expect(messages(list)).toEqual([
      'Ben Okafor commented on WEB-1 Fix login redirect: "Reproduced on Chrome and Firefox."',
      'Ben Okafor commented on WEB-5 Review signup form: "Agreed. I will move the hint above the field."',
      'Ben Okafor moved WEB-1 Fix login redirect from To Do to In Progress',
    ])

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(router.state.location.search).toBe('')
    await waitFor(() => expect(items(screen.getByRole('list', { name: 'Activity in Acme' }))).toHaveLength(20))
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('keeps an id from the URL that is not in the lists, and says when nothing matches', async () => {
    renderFeed('asha', `?actor=${eve.id}`)

    expect(await screen.findByText('No activity matches the filters')).toBeInTheDocument()
    const person = screen.getByRole('combobox', { name: 'Person' })
    await waitFor(() => expect(within(person).getByRole('option', { selected: true })).toHaveTextContent('Someone else'))
  })

  it('ignores filter values that are not ids', async () => {
    const requests = spyOnFeedRequests()
    renderFeed('asha', '?project=nope&actor=1')

    expect(items(await feedList())).toHaveLength(20)
    expect(requests[0].searchParams.has('project_id')).toBe(false)
    expect(requests[0].searchParams.has('actor_id')).toBe(false)
  })
})

describe('states', () => {
  it('says it is loading until the first page arrives', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(ACTIVITY_API, async () => {
        await gate
      }),
    )
    renderFeed()

    expect(await screen.findByText('Loading activity...')).toBeInTheDocument()
    release()
    expect(messages(await feedList())[0]).toBe(NEWEST)
    expect(screen.queryByText('Loading activity...')).not.toBeInTheDocument()
  })

  it('says when there is no activity yet', async () => {
    db.activity = db.activity.filter((entry) => entry.workspace_id !== acme.id)
    renderFeed()

    expect(await screen.findByText('No activity yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('shows a load error with Try again', async () => {
    const user = userEvent.setup()
    let failing = true
    server.use(
      http.get(ACTIVITY_API, () =>
        failing
          ? HttpResponse.json({ error: { code: 'internal_error', message: 'Server exploded', details: {} } }, { status: 500 })
          : undefined,
      ),
    )
    renderFeed()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the activity. Server exploded')
    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(messages(await feedList())[0]).toBe(NEWEST)
  })
})
