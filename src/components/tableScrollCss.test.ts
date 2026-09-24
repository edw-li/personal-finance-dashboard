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

  // localSections.css's `.local-section-panel [id]` (0,2,0) hands an id'd control the page's
  // scope-row margin (69–83px): the rewards matrix's card-col-<id> buttons moved a scrolled box ~62px
  // on focus (Task 3 re-review). At (0,2,2) these win whatever order the sheets load in.
  it("keeps the local-section panel's page margin off an id'd control: none pinned, the insets in the body", () => {
    expect(CSS).toContain('.table-scroll > table > :is(thead, tfoot) [id] { scroll-margin: 0; }')
    expect(CSS).toContain(
      '.table-scroll > table > tbody [id] { scroll-margin-top: calc(var(--table-head-h, 0px) + 4px); scroll-margin-bottom: calc(var(--table-foot-h, 0px) + 4px); }',
    )
  })

  // Where no totals row pins the foot, the fade does: a control Tabbed to the foot landed 4px above the
  // bottom with up to 24px of it under the fade — 4 of 60 Transactions and 6 of 40 Securities stops on
  // the production copy in Edge (Task 4 review). (0,1,4) and (0,2,4) outrank the two body rules above.
  it("keeps a Tab clear of the 'more below' fade wherever no totals row marks the foot", () => {
    expect(CSS).toContain(
      '.table-scroll:not(:has(> table > tfoot)) > table > tbody *, .table-scroll:not(:has(> table > tfoot)) > table > tbody [id] { scroll-margin-bottom: calc(var(--table-foot-h, 0px) + var(--table-fade-h) + 4px); }',
    )
  })

  it('drops the edge mask while the box has keyboard focus, so its own ring shows', () => {
    expect(CSS).toContain('.table-scroll:focus-visible { mask-image: none !important; }')
  })

  // A classic scrollbar (15px in the user's headed Edge) sits inside the box's right edge, under
  // panels.css's 28px right-edge fade, which faded its track and thumb away (Task 5 review). The box
  // restates both right-edge masks to turn opaque again over the measured strip; (0,3,0) and (0,5,0)
  // outrank panels.css's (0,2,0) and (0,4,0) whatever order the sheets load in.
  it("stops the right-edge fade short of the box's own vertical scrollbar", () => {
    expect(CSS).toContain(
      '.table-scroll[data-scroll-more~="right"]:not(:has(.row-actions)) { mask-image: linear-gradient(to right, #000 calc(100% - 28px - var(--table-scrollbar-w, 0px)), transparent calc(100% - var(--table-scrollbar-w, 0px)), #000 calc(100% - var(--table-scrollbar-w, 0px))); }',
    )
    expect(CSS).toContain(
      '.table-scroll[data-scroll-more~="left"][data-scroll-more~="right"]:not(:has(.row-actions)):not(:has(.col-identity)) { mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px - var(--table-scrollbar-w, 0px)), transparent calc(100% - var(--table-scrollbar-w, 0px)), #000 calc(100% - var(--table-scrollbar-w, 0px))); }',
    )
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
    // One height for the fade, declared on the box — the scroll margin above and revealInBox read it.
    expect(CSS).toMatch(/\.table-scroll \{[^}]*--table-fade-h: 28px;/)
    expect(CSS).toMatch(
      /\.table-scroll::after \{[^}]*height: var\(--table-fade-h\);[^}]*margin-top: calc\(-1 \* var\(--table-fade-h\)\);/,
    )
    expect(CSS).not.toMatch(/\.table-scroll::after \{[^}]*28px/)
    expect(CSS).toContain(
      '.table-scroll[data-scroll-more~="bottom"]:not(:has(> table > tfoot))::after { opacity: 1; }',
    )
    // Forced colours hide the fade, so nothing reserves its height there (the rows' margin, revealInBox).
    expect(CSS).toContain(
      '@media (forced-colors: active) { .table-scroll { --table-fade-h: 0px; } .table-scroll::after { display: none; } }',
    )
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
