import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom): a pin survives a re-indent and
// a comment moving, and fails only when a declaration changes. jsdom lays nothing out and resolves no
// subgrid or container query, so the stylesheet's text is what can be held to spec 2026-09-25 §4; the
// lane's browser checks measure the result (baselines, delta lines, row heights, layouts).
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const CSS = flat('panels.css')
// The rule whose selector is exactly `selector` — "} .stat-tile {", never the tail of
// ".stat-tile-slot > .stat-tile {".
const rule = (selector: string) => {
  const at = CSS.indexOf(`} ${selector} {`)
  if (at < 0) throw new Error(`panels.css has no rule for ${selector}`)
  return CSS.slice(at + 2, CSS.indexOf('}', at + 2) + 1)
}

describe('tile rows share one grid (spec §4.1)', () => {
  it('makes every tile — or its labelled slot — a three-line subgrid of its row', () => {
    expect(CSS).toContain(
      '.kpi-row > .stat-tile, .kpi-row > .stat-tile-slot, .stat-tile-slot > .stat-tile { grid-row: span 3; grid-template-rows: subgrid; row-gap: 0; }',
    )
    expect(CSS).toContain('.stat-tile-slot { display: grid; grid-template-columns: minmax(0, 1fr); }')
  })

  // A parent gutter is absorbed INTO subgrid tracks: with a 16px row gap an empty badge line measured
  // 16px in Edge. So the row has none, lines are spaced by each tile's bottom margin, and the row's
  // own margin gives that back — the space under a row is --kpi-row-after either way.
  it('spaces lines of tiles with the tiles, not with a row gap', () => {
    expect(rule('.kpi-row')).toContain('row-gap: 0;')
    expect(rule('.kpi-row')).toContain('column-gap: var(--density-grid-gap);')
    expect(rule('.kpi-row')).toContain('--kpi-row-after: 1rem;')
    expect(rule('.kpi-row')).toContain('margin-bottom: calc(var(--kpi-row-after) - var(--density-grid-gap));')
    expect(CSS).toContain('.kpi-row > * { margin-bottom: var(--density-grid-gap); }')
  })

  // A size container establishes an independent formatting context, and that turns subgrid off:
  // four tiles' lines drifted apart in Edge. .stat-value is the container now — the same width.
  it('keeps the tile out of container-type and sizes the figure from .stat-value', () => {
    expect(rule('.stat-tile')).not.toContain('container-type')
    expect(rule('.stat-tile')).toContain('display: grid;')
    expect(rule('.stat-tile')).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(rule('.stat-value')).toContain('container-type: inline-size;')
    expect(rule('.stat-value')).toContain('align-self: baseline;')
    expect(CSS).toContain('.stat-value-figure { font-size: min(clamp(1.1rem, 0.9rem + 0.5vw, 1.45rem), 10.5cqi); }')
    expect(CSS).toContain('.stat-tile-hero .stat-value-figure { font-size: min(clamp(1.5rem, 1rem + 1.1vw, 2.4rem), 12cqi); }')
  })

  it('keeps badges in the header, empty deltas free and each delta clause whole', () => {
    expect(rule('.stat-header')).toContain('justify-content: space-between;')
    expect(rule('.stat-badge')).toContain('flex: none;')
    expect(CSS).not.toContain('.stat-badge-row')
    expect(CSS).toContain('.stat-delta:empty { margin-top: 0; }')
    expect(CSS).toContain('.stat-delta-clause { display: inline-block; }')
  })

  it('lets a ghost tile take its row’s subgrid like any tile', () => {
    // GhostTile renders .stat-tile.skeleton-tile, so the subgrid selectors above reach it unchanged.
    expect(CSS).not.toMatch(/\.skeleton-tile \{[^}]*min-height/)
  })

  it('reserves only the delta line on a steady row', () => {
    expect(CSS).toContain(
      ".kpi-row-steady .stat-delta:empty::before { content: '\\a0'; visibility: hidden; }",
    )
    expect(CSS).toContain('.kpi-row-steady .stat-delta:empty { margin-top: 0.35rem; }')
  })

  // The hero's longest words across every month ("▲ $126,583 (+15.7%) since Sep 1 · 21 days", 237.9px in
  // Edge) need a row of 1148px in the four-across band; narrower, a month with long words wrapped them to
  // a second line and the row went 142 ↔ 159px as the month changed at 1280 (2026-09-25 polish review).
  // There the row reserves two lines — its ghost too, which wears the same classes.
  it('reserves two delta lines on a steady hero row where its words can wrap', () => {
    expect(CSS).toContain(
      '@container page (980px < width < 1150px) { .kpi-row-steady:has(> .stat-tile-hero) .stat-delta { min-height: 2lh; } }',
    )
  })
})

describe('five-tile rows (spec §4.2)', () => {
  const FIVE = '.kpi-row:is(.kpi-row-5, .kpi-row-dense)'
  const block = (query: string) => {
    const at = CSS.indexOf(`@container page ${query} {`)
    if (at < 0) throw new Error(`panels.css has no ${query} block`)
    return CSS.slice(at, CSS.indexOf('} }', at) + 3)
  }

  it('lays five tiles five across from 1000px of page', () => {
    expect(CSS).toContain('.kpi-row-5, .kpi-row-dense { grid-template-columns: repeat(5, minmax(0, 1fr)); }')
  })

  // Projection's local rule, generalised (batch 2 final verification D5): six tracks, each tile spans
  // two, the fourth and fifth span three — both lines filled (PE-02: 2 + 2 + 1 with the dock).
  it('goes a balanced 3 + 2 on six tracks from 660 to 999px', () => {
    const body = block('(660px <= width < 1000px)')
    expect(body).toContain(`${FIVE} { grid-template-columns: repeat(6, minmax(0, 1fr)); }`)
    expect(body).toContain(`${FIVE} > * { grid-column: span 2; }`)
    expect(body).toContain(`${FIVE} > :nth-child(n + 4) { grid-column: span 3; }`)
  })

  it('goes two columns under 660px, the odd last tile spanning both', () => {
    const body = block('(width < 660px)')
    expect(body).toContain(`${FIVE} { grid-template-columns: repeat(2, minmax(0, 1fr)); }`)
    expect(body).toContain(`${FIVE} > :last-child:nth-child(odd) { grid-column: 1 / -1; }`)
  })

  it('keeps every other row auto-fit, then two columns under 980px', () => {
    const body = block('(max-width: 980px)')
    expect(body).toContain('.kpi-row:not(.kpi-row-5, .kpi-row-dense) { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
    expect(body).toContain('.kpi-row:not(.kpi-row-5, .kpi-row-dense) > :last-child:nth-child(odd) { grid-column: 1 / -1; }')
  })
})

describe("the calendar strip's own five-across (CalendarPage.css)", () => {
  const CAL = flat('../pages/CalendarPage.css')

  // Five across from 880px (2026-09-23 spec §B2), so the shared 3 + 2 spans must stand down there or
  // the fifth tile wraps; (0,4,0) and (0,3,0) outrank panels.css's (0,3,0)/(0,2,0) in any load order.
  it('holds five columns from 880px with every tile on one track', () => {
    expect(CAL).toContain(
      '@container page (min-width: 880px) { .cal-strip.kpi-row.kpi-row-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); } .cal-strip.kpi-row.kpi-row-5 > :nth-child(n) { grid-column: auto; } }',
    )
  })

  it('leaves the space under the strip to the row (no second margin)', () => {
    expect(CAL).not.toMatch(/\.cal-strip \{[^}]*margin-bottom/)
  })
})

// The tiles' bottom margins sit inside the grid, so a follower's own top margin no longer collapses into
// the row's space — it stacks on it (2026-09-25 review: 17.6 → 33.6px under the Taxes totals, 20 → 36px
// under the Review tiles). The two followers that carry one keep only what exceeds the grid gap.
describe('the space under a row with a margined follower', () => {
  it('lets the Taxes jurisdiction detail add only the rest of its 1.1rem', () => {
    const TAX = flat('taxes/taxes.css')
    expect(TAX).toContain('.kpi-row + .tax-jurisdiction-detail { margin-top: calc(1.1rem - var(--density-grid-gap)); }')
  })

  it('leaves the space under the Review tiles to the row alone', () => {
    const REVIEW = flat('../pages/MonthlyUpdatePage.css')
    expect(REVIEW).toContain('.kpi-row.review-kpis { --kpi-row-after: 1.25rem; }')
    expect(REVIEW).toContain('.kpi-row.review-kpis + .review-changes > .review-changes-head:first-child { margin-top: 0; }')
  })
})

// The hero's "▲ $126,583 (+15.7%) since Sep 1 · 21 days" measured 239.14px against a 238.56px delta box
// at 1440 (Edge): the glyph's own space closes by 0.1em so the arrow binds to its figure and the
// spec's example fits its one line (§4.3). The words are unchanged.
describe('the delta glyph (spec §4.3)', () => {
  it('tightens only the space after the ▲/▼', () => {
    expect(CSS).toContain('.stat-delta-glyph { word-spacing: -0.1em; }')
  })
})

// The evidence (i)'s 24px box, pulled back only 4px each side, grew the label line from 15 to 17.1px
// in Edge — so a ghost's label line stood 2px short of a real one. Pulled back like the eyebrow's
// InfoHint (to its 13px glyph), every label line is its text's height, ghost or real.
describe('the label line (spec §4.1, §4.6)', () => {
  it('keeps the metric (i) from growing its label line', () => {
    expect(CSS).toContain('.stat-label .metric-info-button { margin-top: -5.5px; margin-bottom: -5.5px; }')
  })
})
