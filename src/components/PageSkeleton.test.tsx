import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import PageSkeleton, { SkeletonCard } from './PageSkeleton'

afterEach(cleanup)

describe('PageSkeleton', () => {
  it('announces loading and hides the ghosts from AT', () => {
    render(<PageSkeleton tiles={3} cards={[{ span: 12 }]} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading…')
    expect(status.className).toContain('visually-hidden')
    // Every ghost container is aria-hidden; nothing but the status line is exposed.
    expect(document.querySelector('.kpi-row')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.card-grid')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders the requested shape with the house chrome', () => {
    render(
      <PageSkeleton
        tiles={4}
        cards={[
          { span: 6, height: 220 },
          { span: 12, height: 340 },
        ]}
      />,
    )
    expect(document.querySelectorAll('.kpi-row .stat-tile').length).toBe(4)
    const cards = document.querySelectorAll('.card-grid .card')
    expect(cards.length).toBe(2)
    expect(cards[0].className).toContain('span-6')
    expect(cards[1].className).toContain('span-12')
    expect(
      (cards[1].querySelector('.skeleton-body') as HTMLElement).style.height,
    ).toBe('340px')
    expect(document.querySelector('.page-skeleton')?.className).toContain('loading-fallback')
  })

  it('omits empty sections', () => {
    render(<PageSkeleton cards={[{ span: 12 }]} />)
    expect(document.querySelector('.kpi-row')).toBeNull()
  })
})

describe('SkeletonCard', () => {
  it('announces its label and ghosts a single card', () => {
    render(<SkeletonCard height={260} label="Loading lots…" />)
    expect(screen.getByText('Loading lots…').className).toContain('visually-hidden')
    const card = document.querySelector('section.card') as HTMLElement
    expect(card.className).toContain('loading-fallback')
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect((card.querySelector('.skeleton-body') as HTMLElement).style.height).toBe('260px')
  })
})
