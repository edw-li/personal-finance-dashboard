import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom). jsdom computes none of these
// rules; the equal bottoms they produce are measured in Edge (2026-09-25 polish spec §3.1).
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const CHART = flat('chartInteractions.css')

describe('chart cards fill their row (chartInteractions.css)', () => {
  // The grid stretched only the slot; the portal host and the card inside it kept their content
  // height, so paired cards ended 17–95px apart (OU-04, NWSP-08, TPC-01c, PE-11, PCC-28).
  it("chains slot → host → card as column flexboxes, the Expand dialog's own chain", () => {
    expect(CHART).toContain('.chart-card-slot { min-width: 0; display: flex; flex-direction: column; }')
    expect(CHART).toContain('.chart-card-slot > div { flex: 1; display: flex; flex-direction: column; min-height: 0; }')
    expect(CHART).toContain('.chart-card-slot .chart-card { flex: 1; display: flex; flex-direction: column; }')
  })

  it("grows a filling card's plot from its configured height, contained so the row never ratchets", () => {
    expect(CHART).toContain(
      '.chart-card-slot .chart-card-fill > :is(.loading-dim, .chart-card-skeleton) { flex: 1 0 auto; min-height: var(--chart-h); contain: size; }',
    )
    // The chart itself never collapses below the floor, even where its box cannot be resolved.
    expect(CHART).toContain(".chart-card-slot .chart-card-fill > .loading-dim > [role='img'] { min-height: var(--chart-h); }")
  })

  it('keeps every fill rule under the slot, so the Expand dialog sizes its own card', () => {
    expect(CHART).toContain('.chart-expanded-dialog .loading-dim { flex: 1; min-height: 0; }')
    expect(CHART).not.toMatch(/(^|\}) *\.chart-card-fill/)
  })
})

describe('a plot beside an aside (chartInteractions.css)', () => {
  // PE-20: the donut floated at the top of its column beside a list up to 624px long.
  it('centres the plot column in its row; the aside keeps the top', () => {
    expect(CHART).toContain('.chart-card-slot .chart-card-with-aside > .chart-card-plot { align-self: center; }')
    expect(CHART).toMatch(/\.chart-card-with-aside \{[^}]*align-items: start;/)
  })
})
