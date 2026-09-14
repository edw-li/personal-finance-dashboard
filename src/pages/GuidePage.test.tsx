import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GuidePage from './GuidePage'

// The page renders whatever GUIDE holds; the fixture keeps this suite independent of the
// content lanes (the real content is fenced in src/guide/guideContent.test.ts). The factory
// imports the fixture itself — vi.mock is hoisted above the imports, so a top-level binding
// would not exist yet when anchors.ts pulls GUIDE in (App.test.tsx mocks routeChunks the same way).
vi.mock('../guide/content', async () => {
  const { FIXTURE_GUIDE } = await import('../guide/testing/fixtures')
  return { GUIDE: FIXTURE_GUIDE }
})

afterEach(cleanup)

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function panelFor(tabName: string): HTMLElement {
  const tab = screen.getByRole('tab', { name: tabName })
  return document.getElementById(tab.getAttribute('aria-controls') ?? '') as HTMLElement
}

describe('GuidePage', () => {
  it('renders through the frame with four chapter tabs and opens Start here by default', () => {
    renderAt('/guide')
    expect(screen.getByRole('heading', { level: 1, name: 'Guide' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Start here', 'Routines', 'Pages', 'Reference'])
    expect(screen.getByRole('tab', { name: 'Start here' }).getAttribute('aria-selected')).toBe('true')
    expect(panelFor('Start here').hasAttribute('hidden')).toBe(false)
    expect(document.getElementById('start-what')).toBeTruthy()
  })

  it('opens the chapter named by ?section= and focuses the card named by the hash', async () => {
    renderAt('/guide?section=pages#page-taxes')
    expect(screen.getByRole('tab', { name: 'Pages' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('page-taxes'))
    expect(document.getElementById('page-taxes')?.getAttribute('tabindex')).toBe('-1')
    // A selector chapter shows the card the hash names and no other.
    expect(document.getElementById('page-example')).toBeNull()
  })

  it('resolves a bare hash to the owning chapter — a task id, not only a card id', async () => {
    renderAt('/guide#update-close')
    expect(screen.getByRole('tab', { name: 'Routines' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('update-close'))
    expect(document.getElementById('update-close')?.getAttribute('aria-selected')).toBe('true')
  })

  it('a selector chapter shows the chip tablist and exactly one card — the first by default', () => {
    renderAt('/guide?section=pages')
    const selector = screen.getByRole('navigation', { name: 'Pages in this guide' })
    expect(within(selector).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Example', 'Taxes fixture'])
    expect(document.querySelectorAll('.guide-card')).toHaveLength(1)
    expect(document.getElementById('page-example')).toBeTruthy()
    expect(document.getElementById('page-taxes')).toBeNull()
  })

  it('the hash picks the card: a card id, or a task id inside a card', async () => {
    renderAt('/guide?section=pages#taxes-fixture')
    expect(document.getElementById('page-taxes')).toBeTruthy()
    expect(document.getElementById('page-example')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Taxes fixture' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('taxes-fixture'))
    expect(document.getElementById('taxes-fixture')?.getAttribute('aria-selected')).toBe('true')
  })

  it('clicking a chip swaps the card and writes the hash', () => {
    renderAt('/guide?section=pages')
    fireEvent.click(screen.getByRole('tab', { name: 'Taxes fixture' }))
    expect(document.getElementById('page-taxes')).toBeTruthy()
    expect(document.getElementById('page-example')).toBeNull()
  })

  it('a stacked chapter renders every card; a task hash selects and focuses its rail row', async () => {
    renderAt('/guide#checklist-after')
    expect(screen.getByRole('tab', { name: 'Routines' }).getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById('routine-monthly')).toBeTruthy()
    expect(document.getElementById('routine-checklist')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Routines in this guide' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe('checklist-after'))
    expect(document.getElementById('checklist-after')?.getAttribute('aria-selected')).toBe('true')
  })

  it('switching tabs shows that chapter and hides the others', () => {
    renderAt('/guide')
    fireEvent.click(screen.getByRole('tab', { name: 'Reference' }))
    expect(screen.getByRole('tab', { name: 'Reference' }).getAttribute('aria-selected')).toBe('true')
    expect(panelFor('Reference').hasAttribute('hidden')).toBe(false)
    expect(panelFor('Start here').hasAttribute('hidden')).toBe(true)
    expect(document.getElementById('ref-glossary')).toBeTruthy()
  })

  // The state the app ships in until a chapter has cards, and the one the fixture above can
  // never reach: an empty selector chapter must render its panel with no selector at all, not a
  // <nav> with nothing in it. A second module registry is the only way to hold a second GUIDE.
  it('renders no selector when a selector chapter has no cards', async () => {
    vi.resetModules()
    vi.doMock('../guide/content', async () => {
      const { FIXTURE_GUIDE } = await import('../guide/testing/fixtures')
      return { GUIDE: FIXTURE_GUIDE.map((c) => (c.id === 'pages' ? { ...c, cards: [] } : c)) }
    })
    try {
      const { default: FreshGuidePage } = await import('./GuidePage')
      render(
        <MemoryRouter initialEntries={['/guide?section=pages']}>
          <Routes>
            <Route path="/guide" element={<FreshGuidePage />} />
          </Routes>
        </MemoryRouter>,
      )
      expect(screen.getByRole('tab', { name: 'Pages' }).getAttribute('aria-selected')).toBe('true')
      expect(screen.queryByRole('navigation', { name: 'Pages in this guide' })).toBeNull()
      expect(document.querySelector('.guide-card')).toBeNull()
    } finally {
      vi.doUnmock('../guide/content')
      vi.resetModules()
    }
  })
})
