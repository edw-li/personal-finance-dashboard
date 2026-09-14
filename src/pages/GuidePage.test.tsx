import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  })

  it('resolves a bare hash to the owning chapter — a task id, not only a card id', async () => {
    renderAt('/guide#update-close')
    expect(screen.getByRole('tab', { name: 'Routines' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('update-close'))
  })

  it('renders the Pages chip row in card order, and a chip jumps to its card', async () => {
    renderAt('/guide?section=pages')
    const nav = screen.getByRole('navigation', { name: 'Pages in this guide' })
    const chips = Array.from(nav.querySelectorAll('a.chip'))
    expect(chips.map((a) => a.textContent)).toEqual(['Example', 'Taxes fixture'])
    expect(chips[1].getAttribute('href')).toBe('/guide?section=pages#page-taxes')
    fireEvent.click(chips[1])
    await waitFor(() => expect(document.activeElement?.id).toBe('page-taxes'))
  })

  it('switching tabs shows that chapter and hides the others', () => {
    renderAt('/guide')
    fireEvent.click(screen.getByRole('tab', { name: 'Reference' }))
    expect(screen.getByRole('tab', { name: 'Reference' }).getAttribute('aria-selected')).toBe('true')
    expect(panelFor('Reference').hasAttribute('hidden')).toBe(false)
    expect(panelFor('Start here').hasAttribute('hidden')).toBe(true)
    expect(document.getElementById('ref-glossary')).toBeTruthy()
  })

  it('a chapter with no cards renders its panel without cards and no chip row', () => {
    renderAt('/guide?section=routines')
    expect(screen.queryByRole('navigation', { name: 'Pages in this guide' })).toBeNull()
  })
})
