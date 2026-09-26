import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the equal bottoms are measured
// in Edge (2026-09-25 polish spec §3.1).
const CSS = readFileSync(path.join(__dirname, 'carddetail.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('card detail — the credits card beside the credit-line chart (carddetail.css)', () => {
  // PCC-28: the two cards ended 20–44px apart. The chart card now fills its row (ChartCard `fill`);
  // its non-chart partner is stretched by the grid, and pins its add row to its foot.
  it('lays the credits card out as a column with the add-credit row pinned to its foot', () => {
    expect(CSS).toContain('.card-detail .card-grid > .card { display: flex; flex-direction: column; }')
    expect(CSS).toContain('.card-detail .card-grid > .card > .credit-add { margin-top: auto; padding-top: 0.6rem; }')
  })
})
