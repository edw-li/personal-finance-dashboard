import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import PageSkeleton, { GhostTile, SkeletonCard, SkeletonTileRow } from './PageSkeleton'

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

describe('ghost parity (motion spec §7; 2026-09-25 polish spec §4.6)', () => {
  const lines = (tile: Element) => [...tile.children].map((child) => child.className)

  it('draws each ghost as the real tile’s three lines, a block inside each', () => {
    const { rerender } = render(<PageSkeleton tiles={2} strip />)
    const tiles = document.querySelectorAll('.kpi-row .stat-tile.skeleton-tile')
    expect(tiles.length).toBe(2)
    expect(lines(tiles[0])).toEqual(['stat-header', 'stat-value', 'stat-delta'])
    expect(tiles[0].querySelectorAll('.skeleton').length).toBe(3) // label, value, delta
    expect(tiles[0].querySelector('.stat-value > .stat-value-figure > .skeleton-value')).not.toBeNull()
    expect(tiles[0].querySelector('.stat-badge-row')).toBeNull()
    expect(document.querySelector('.skeleton-strip')?.getAttribute('aria-hidden')).toBe('true')
    rerender(<PageSkeleton tiles={2} />)
    expect(document.querySelector('.skeleton-strip')).toBeNull()
  })

  it('takes the real row’s variant, steadiness, hero and page class', () => {
    render(<PageSkeleton tiles={{ count: 5, row: 'five', className: 'cal-strip' }} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-5 cal-strip')
    cleanup()
    render(<PageSkeleton tiles={{ count: 5, row: 'dense', hero: true }} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-dense')
    const ghosts = document.querySelectorAll('.stat-tile.skeleton-tile')
    expect(ghosts[0].classList.contains('stat-tile-hero')).toBe(true)
    expect(ghosts[1].classList.contains('stat-tile-hero')).toBe(false)
    cleanup()
    render(<PageSkeleton tiles={{ count: 4, steady: true }} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-steady')
  })

  it('reserves a five-tile or dense KPI row on its own, with the SAME tile the page skeleton draws', () => {
    // ESPP's strip ghosts its own row (no page-level skeleton above it): the row must be the strip's
    // five-tile row, or it wraps 4 + 1 and the strip lands 147px shorter (PE-09).
    render(<SkeletonTileRow tiles={5} row="five" label="Loading the ESPP headline…" />)
    const row = document.querySelector('.kpi-row')
    expect(row?.className).toBe('kpi-row kpi-row-5')
    expect(row?.getAttribute('aria-hidden')).toBe('true')
    expect(row?.querySelectorAll('.stat-tile.skeleton-tile .skeleton').length).toBe(15)
    expect(screen.getByRole('status').textContent).toBe('Loading the ESPP headline…')
    // …and it rides the same delay every other ghost does, so a fast answer shows nothing.
    expect(document.querySelector('.loading-fallback')).not.toBeNull()
    cleanup()
    render(<SkeletonTileRow row="dense" />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-dense')
    cleanup()
    render(<SkeletonTileRow tiles={3} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row')
  })

  it('leaves no hand-written ghost height at the call sites this lane owns', () => {
    // A literal here is a number nobody can check against the block it stands in for.
    const page = (name: string) => readFileSync(path.join(__dirname, '..', 'pages', `${name}.tsx`), 'utf8')
    expect(page('PaycheckPage')).toContain('height: FEED_SKELETON.paycheckBreakdown')
    expect(page('CompPage')).toContain('height: FEED_SKELETON.compVesting')
    expect(page('CompPage')).toContain('height: FEED_SKELETON.compEvents')
    expect(page('EsppPage')).toContain('height: FEED_SKELETON.esppLots')
    expect(page('EsppPage')).toContain('height: FEED_SKELETON.esppOfferings')
    // All three cards, at the boxes they really occupy — an unghosted third card let the page
    // grow under the reader when the summary landed.
    // + LEDE_ROW, not a bare literal: the By-group card carries the owner lede now (2026-09-13
    // polish §10), and chartCardBox — a lane-F2 file — has no lede option to ask for.
    expect(page('NetWorthPage')).toContain('ghostCardBody(chartCardBox(360, { controls: true, zoomable: true }) + LEDE_ROW)')
    expect(page('NetWorthPage')).toContain('ghostCardBody(chartCardBox(255, { controls: true }))')
    expect(page('NetWorthPage')).toContain('ghostCardBody(chartCardBox(280, { zoomable: true, footer: true }))')
  })

  it('exports the one ghost tile so a page can ghost a single slot of a mixed row', () => {
    render(<GhostTile />)
    const tile = document.querySelector('.stat-tile.skeleton-tile')
    expect(tile).not.toBeNull()
    expect(tile?.querySelectorAll('.skeleton').length).toBe(3) // label, value, delta
    // Its own attribute, not the row's: in the ESPP strip this tile stands BESIDE real tiles,
    // so no aria-hidden container is above it to silence it.
    expect(tile?.getAttribute('aria-hidden')).toBe('true')
  })

  // The fixed ghost heights (--m-stat-tile 115px, the bare 93px) were right at one width: OU-01 measured
  // a 76px ghost under a 145px tile, PE-09 115 against 103. A ghost set in the real lines needs none.
  it('stands the ghost blocks in the real lines, with no fixed tile height anywhere', () => {
    const css = readFileSync(path.join(__dirname, 'panels.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
    expect(css).not.toContain('--m-stat-tile')
    expect(css).toContain('.skeleton-tile .skeleton { display: inline-block; vertical-align: middle; }')
    expect(css).toContain('.skeleton-tile .skeleton-label { margin: 0; }')
    expect(css).toContain('.skeleton-value { width: 65%; height: 0.8em; }')
    expect(css).toContain('.skeleton-delta { width: 50%; height: 0.75em; }')
  })

  it('draws a delta-less ghost on request: two blocks and an empty delta line', () => {
    // Credit cards' tiles carry no delta line (2026-09-13 polish §9): an empty line costs 0px.
    render(<GhostTile delta={false} />)
    const tile = document.querySelector('.stat-tile.skeleton-tile') as HTMLElement
    expect(tile.querySelectorAll('.skeleton').length).toBe(2) // label, value
    expect(tile.className).toContain('skeleton-tile-bare')
    expect(tile.querySelector('.stat-delta')?.childNodes.length).toBe(0)
  })

  it('accepts a tiles object so a page can ghost a delta-less row, and a count still draws the full tile', () => {
    render(<PageSkeleton tiles={{ count: 4, delta: false }} />)
    expect(document.querySelectorAll('.kpi-row .skeleton-tile-bare').length).toBe(4)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(0)
    cleanup()
    render(<PageSkeleton tiles={{ count: 2 }} />)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(2)
    expect(document.querySelector('.skeleton-tile-bare')).toBeNull()
    cleanup()
    render(<PageSkeleton tiles={3} />)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(3)
  })
})
