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
