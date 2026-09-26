import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the track ends are measured in
// Edge (2026-09-25 polish spec §3.7).
const CSS = readFileSync(path.join(__dirname, 'pace.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('contribution pace meters (pace.css)', () => {
  // TPC-22: each row was its own grid, and ESPP's wider figures ended its track 27px short.
  it('shares the figure and verdict columns across the rows through a subgrid', () => {
    expect(CSS).toContain(
      '.pace-rows { display: grid; grid-template-columns: minmax(150px, 240px) minmax(0, 1fr) minmax(160px, max-content) minmax(90px, max-content); gap: 0.55rem 0.75rem; }',
    )
    expect(CSS).toContain('.pace-row { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; gap: 0.75rem; }')
  })
})
