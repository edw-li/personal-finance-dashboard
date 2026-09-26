import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the packed columns are measured
// in Edge (2026-09-25 polish spec §3.5).
const CSS = readFileSync(path.join(__dirname, 'taxes.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('Tax tables in two independent columns (taxes.css)', () => {
  it('packs the tables in two stacks that end independently', () => {
    expect(CSS).toContain('.bracket-columns { display: flex; align-items: flex-start; gap: 1rem 2rem; }')
    expect(CSS).toContain('.bracket-column { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 1rem; }')
  })

  // Two columns down to 900px of PAGE — 1280 (≈990px) keeps two, the dock gets one.
  it('falls to one column below 900px of page, asked for by name', () => {
    expect(CSS).toContain('@container page (max-width: 899px) { .bracket-columns { flex-direction: column; align-items: stretch; } }')
  })

  it('retires the row grid', () => {
    expect(CSS).not.toContain('.bracket-grid')
  })
})
