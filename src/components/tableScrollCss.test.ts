import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (surfaceGrammar.test.ts's idiom): a pin survives a re-indent
// and a comment moving, and fails only when a declaration actually changes. jsdom computes none of
// these rules, so the text is what can be held to the spec (2026-09-24 table-scroll §2.2, §2.5).
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const CSS = flat('tableScroll.css')
const INDEX = flat('../index.css')

describe('the capped table box (tableScroll.css)', () => {
  it("caps at the vesting schedule's clamp and scrolls both ways", () => {
    expect(CSS).toMatch(/\.table-scroll \{[^}]*max-height: clamp\(420px, 60vh, 720px\);[^}]*overflow: auto;/)
  })

  // A scroll margin on what scrolls UNDER the pinned rows, never a scroll padding on the box: padding
  // counts the pinned rows' own controls as out of view, so focusing a header sort button scrolled
  // the box half its height — 240px per Tab in headless Edge (Task 3 review).
  it('keeps a Tab or a reveal clear of the pinned rows from the rows beneath them, not the box', () => {
    expect(CSS).toContain(
      '.table-scroll > table > tbody * { scroll-margin-top: calc(var(--table-head-h, 0px) + 4px); scroll-margin-bottom: calc(var(--table-foot-h, 0px) + 4px); }',
    )
    expect(CSS).not.toContain('scroll-padding')
  })

  it('drops the edge mask while the box has keyboard focus, so its own ring shows', () => {
    expect(CSS).toContain('.table-scroll:focus-visible { mask-image: none !important; }')
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

  // The release lives in the always-loaded index.css (spec §2.5): route chunks load their sheets
  // lazily, so in this sheet it never reached Settings or Comp, and a cap sheet loaded after this one
  // at the same specificity won. Released, a box's sticky cells pin to the PAGE (a totals row printed
  // over the next table's rows), so they go static; an edge mask would fade the paper copy. The fade
  // is TableScroll's own, so its print hide stays here. One string: both rules inside the one block.
  it('releases every capped box on paper from index.css — cells unpinned, edge mask off — and hides the fade', () => {
    expect(CSS).toContain('@media print { .table-scroll::after { display: none; } }')
    expect(INDEX).toContain(
      '@media print { :root :is(.table-scroll, .settings-scroll, .categories-scroll, .vest-scroll, .chart-table-scroll) { max-height: none; overflow: visible; mask-image: none !important; } :root :is(.table-scroll, .settings-scroll, .categories-scroll, .vest-scroll, .chart-table-scroll) :is(th, td) { position: static !important; } }',
    )
  })
})
