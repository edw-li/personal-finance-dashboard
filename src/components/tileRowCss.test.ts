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
  it('makes every tile — or its labelled slot — a four-line subgrid of its row', () => {
    expect(CSS).toContain(
      '.kpi-row > .stat-tile, .kpi-row > .stat-tile-slot, .stat-tile-slot > .stat-tile { grid-row: span 4; grid-template-rows: subgrid; row-gap: 0; }',
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

  it('costs an empty badge or delta line nothing, and keeps each delta clause whole', () => {
    expect(CSS).toContain('.stat-badge-row { display: flex; align-items: center; }')
    expect(CSS).toContain('.stat-badge-row:not(:empty) { margin-bottom: 0.35rem; }')
    expect(CSS).toContain('.stat-delta:empty { margin-top: 0; }')
    expect(CSS).toContain('.stat-delta-clause { display: inline-block; }')
  })

  it('reserves the badge line and one delta line on a steady row, in their own boxes', () => {
    expect(CSS).toContain(
      '.stat-badge, .kpi-row-steady .stat-badge-row:empty::before { padding: 0.05rem 0.45rem; font-size: 0.7rem; font-weight: 500; }',
    )
    expect(CSS).toContain(
      ".kpi-row-steady .stat-badge-row:empty::before, .kpi-row-steady .stat-delta:empty::before { content: '\\a0'; visibility: hidden; }",
    )
    expect(CSS).toContain('.kpi-row-steady .stat-badge-row { margin-bottom: 0.35rem; }')
    expect(CSS).toContain('.kpi-row-steady .stat-delta:empty { margin-top: 0.35rem; }')
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
