import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardGridSkeleton, ListSkeleton, LoadingSkeleton, Skeleton } from './Skeleton'

describe('skeletons', () => {
  it('announce what is loading and hide the placeholder shapes from screen readers', () => {
    render(
      <LoadingSkeleton label="Loading tasks...">
        <Skeleton width="50%" />
      </LoadingSkeleton>,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading tasks...')
    expect(status.querySelector('.skeleton')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('can stay silent inside a region that announces on its own', () => {
    render(<ListSkeleton label="Loading comments..." announce={false} avatar />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Loading comments...')).toHaveClass('visually-hidden')
    expect(document.querySelectorAll('.skeleton--round')).toHaveLength(3)
  })

  it('lays cards out like the grid they stand for', () => {
    render(<CardGridSkeleton label="Loading projects..." className="project-grid" count={4} />)

    expect(document.querySelector('ul.project-grid')?.children).toHaveLength(4)
  })
})
