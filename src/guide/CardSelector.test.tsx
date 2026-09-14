import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CardSelector, { selectedCardId } from './CardSelector'
import { FIXTURE_GUIDE } from './testing/fixtures'

// cardOf reads the anchor index, which is built from GUIDE at import time: the fixture is the
// guide for this suite, exactly as GuidePage.test.tsx does it.
vi.mock('./content', async () => {
  const { FIXTURE_GUIDE } = await import('./testing/fixtures')
  return { GUIDE: FIXTURE_GUIDE }
})

afterEach(cleanup)

const pages = FIXTURE_GUIDE[2]

function Probe() {
  const { hash } = useLocation()
  return <output data-testid="hash">{hash}</output>
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CardSelector chapter={pages} selectedId={selectedCardId(pages, new URL(entry, 'http://x').hash)} />
      <Probe />
    </MemoryRouter>,
  )
}

describe('CardSelector', () => {
  it('renders one chip per card as a tablist, the first selected by default', () => {
    renderAt('/guide?section=pages')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Example', 'Taxes fixture'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-controls')).toBe('page-example')
    expect(tabs[1].getAttribute('tabindex')).toBe('-1')
  })

  it('a hash naming a card selects it; a hash naming a task selects the task’s card', () => {
    expect(selectedCardId(pages, '#page-taxes')).toBe('page-taxes')
    expect(selectedCardId(pages, '#taxes-fixture')).toBe('page-taxes')
    expect(selectedCardId(pages, '#example-export')).toBe('page-example')
    expect(selectedCardId(pages, '#update-close')).toBe('page-example') // another chapter's task → default
    expect(selectedCardId(pages, '')).toBe('page-example')
  })

  it('clicking a chip writes the card into the hash', () => {
    renderAt('/guide?section=pages')
    fireEvent.click(screen.getByRole('tab', { name: 'Taxes fixture' }))
    expect(screen.getByTestId('hash').textContent).toBe('#page-taxes')
  })

  it('ArrowRight and End move the selection through the hash', () => {
    renderAt('/guide?section=pages#page-example')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Example' }), { key: 'ArrowRight' })
    expect(screen.getByTestId('hash').textContent).toBe('#page-taxes')
  })
})
