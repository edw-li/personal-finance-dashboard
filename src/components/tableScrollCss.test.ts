import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (surfaceGrammar.test.ts's idiom): a pin survives a re-indent
// and a comment moving, and fails only when a declaration actually changes. jsdom computes none of
// these rules, so the text is what can be held to the spec (2026-09-24 table-scroll §2.2, §2.5).
const CSS = readFileSync(path.join(__dirname, 'tableScroll.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('the capped table box (tableScroll.css)', () => {
  it("caps at the vesting schedule's clamp and scrolls both ways", () => {
    expect(CSS).toMatch(/\.table-scroll \{[^}]*max-height: clamp\(420px, 60vh, 720px\);[^}]*overflow: auto;/)
  })

  it('keeps a Tab or a reveal clear of the pinned rows', () => {
    expect(CSS).toMatch(/\.table-scroll \{[^}]*scroll-padding-top: calc\(var\(--table-head-h, 0px\) \+ 4px\);/)
    expect(CSS).toMatch(/\.table-scroll \{[^}]*scroll-padding-bottom: calc\(var\(--table-foot-h, 0px\) \+ 4px\);/)
  })

  it('draws separate borders, so a stuck header cell carries its own hairline', () => {
    expect(CSS).toContain('.table-scroll > table { border-collapse: separate; border-spacing: 0; }')
  })

  it('pins the header cells at z 1 on the card surface, and the two-axis corners at z 2', () => {
    expect(CSS).toContain(
      '.table-scroll > table > thead th { position: sticky; top: 0; z-index: 1; background: var(--surface); }',
    )
    expect(CSS).toContain(
      '.table-scroll > table > thead th.col-identity, .table-scroll > table:has(td.row-actions) > thead th:last-child { z-index: 2; }',
    )
  })

  it('pins the totals row at the foot with a hairline above it', () => {
    expect(CSS).toContain(
      '.table-scroll > table > tfoot :is(td, th) { position: sticky; bottom: 0; z-index: 1; background: var(--surface); box-shadow: 0 -1px 0 var(--border); }',
    )
  })

  it('fades the foot only while rows hide below and no totals row marks the edge', () => {
    expect(CSS).toMatch(/\.table-scroll::after \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*opacity: 0;/)
    expect(CSS).toContain(
      '.table-scroll[data-scroll-more~="bottom"]:not(:has(> table > tfoot))::after { opacity: 1; }',
    )
    expect(CSS).toContain('@media (forced-colors: active) { .table-scroll::after { display: none; } }')
  })

  it('releases every capped box on paper, the older four included', () => {
    expect(CSS).toContain(
      '@media print { .table-scroll, .settings-scroll, .categories-scroll, .vest-scroll, .chart-table-scroll { max-height: none; overflow: visible; }',
    )
  })
})
