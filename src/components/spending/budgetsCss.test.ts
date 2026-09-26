import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the track ends are measured in
// Edge (2026-09-25 polish spec §3.7).
const CSS = readFileSync(path.join(__dirname, 'budgets.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('budget meters (budgets.css)', () => {
  // NWSP-14: each row sized its own figures column, so Housing's track ended at 1112 and the rest at 1119.
  it('gives every row one column template, the figures column as wide as the widest figure', () => {
    expect(CSS).toContain(
      '.budget-rows { display: grid; grid-template-columns: minmax(110px, 160px) minmax(0, 1fr) minmax(150px, max-content) auto; gap: 0.55rem 0.75rem; }',
    )
    expect(CSS).toContain('.budget-entry { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; row-gap: 0.35rem; }')
    expect(CSS).toContain('.budget-entry > * { grid-column: 1 / -1; }')
    expect(CSS).toMatch(/\.budget-row \{[^}]*display: grid;[^}]*grid-template-columns: subgrid;/)
  })

  // An empty track in --surface-2 was #1e222c on #171a21 — twelve of thirteen rows read as blank space.
  it('draws the empty track in --fill, so an empty meter reads as a meter', () => {
    expect(CSS).toMatch(/\.budget-meter \{[^}]*background: var\(--fill\);/)
  })
})
