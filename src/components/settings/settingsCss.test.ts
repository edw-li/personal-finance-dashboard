import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (tokens.test.ts's rule): a `}` parked inside a
 *  multi-line comment would otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated — a rule split across two blocks (or
 *  repeated under a media query) still answers as one. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...stripComments(css).matchAll(new RegExp(`(^|[,{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((m) => m[2]).join(' ')
}

const settings = readFileSync(path.resolve(__dirname, 'settings.css'), 'utf8')
// Lane R0's stylesheet owns the reorderable tables' border model and the sticky Actions cell's
// row states; the two Settings tables lean on both, so they are pinned here as a dependency guard.
const reorderCss = readFileSync(path.resolve(__dirname, '../reorder/reorder.css'), 'utf8')

describe('settings.css', () => {
  // The rail rides PageFrame's sticky scope row, which paints over the top of the scrollport.
  // The bands carry scroll-margin-top so a chip lands its section below the row — and every
  // anchored CARD needs the same, or /settings#backups, #restore (the ?restore= hand-off) and
  // #limits all land UNDER the rail instead of below it. jsdom computes no layout, so this is
  // the only place the rule can be pinned.
  it('insets every anchored settings card by the sticky row, exactly like the bands', () => {
    const inset = 'scroll-margin-top: calc(var(--sticky-inset, 0px) + 0.75rem);'
    expect(declarationsFor(settings, '.settings-page .card')).toContain(inset)
    expect(declarationsFor(settings, '.card-grid > .settings-section')).toContain(inset)
  })

  // The once-shown feed URL is a credential the reader has to get out of the page in one
  // piece; the form sheet's 320px field cap would clip it to a third of its length.
  it('exempts the once-shown feed URL from the field cap', () => {
    expect(declarationsFor(settings, '.feed-fresh label')).toContain('max-width: none;')
  })

  // Drag to reorder (2026-09-23 reorder spec §4). jsdom computes no cascade, so the rules that
  // must OUTRANK panels.css are pinned here, selector and all.
  it('the reorderable tables get the separate border model from reorder.css — `table.` outranks .data-table', () => {
    expectBorderModel(reorderCss)
  })

  it('draws an Accounts group heading as a heading, not as a sticky row-actions cell', () => {
    // Keyed on the row's class; `tbody >` lifts it to (0,3,3), past panels.css's sticky
    // `th:last-child` (0,3,2) whichever sheet loads last.
    const heading = declarationsFor(
      settings,
      '.data-table.accounts-table tbody > tr.accounts-group-row > th',
    )
    expect(heading).toContain('position: static;')
    expect(heading).toContain('box-shadow: none;')
    expect(heading).toContain('padding-top: 0.9rem;')
  })

  it('moves the component indent off the grip cell and onto the Account cell', () => {
    // The grip cell gets the plain cell padding back, with reorder.css's narrow right edge kept.
    const grip = declarationsFor(
      settings,
      '.data-table.accounts-table tr.component-row > td.reorder-grip-cell',
    )
    expect(grip).toContain('padding: var(--density-cell-pad);')
    expect(grip).toContain('padding-right: 0;')
    const name = declarationsFor(
      settings,
      '.data-table.accounts-table tr.component-row > td.accounts-name-cell',
    )
    expect(name).toContain('padding-left: 1.6rem;')
    expect(name).toContain('color: var(--muted);')
  })

  it("reorder.css lifts the sticky Actions cell with its row, keeping the cell's own hairline — and draws the drop line over it, never inside it", () => {
    expectActionsCell(reorderCss)
  })

  it('the reorder.css pins survive a reformat of that sheet — another lane owns it', () => {
    // Other quotes, one-line multi-value box-shadows, tight combinators, no space after colons:
    // the same rules, so the same pins must hold.
    const reformatted = reorderCss
      .replace(/'/g, '"')
      .replace(/,\s*\n\s*/g, ', ')
      .replace(/\s*>\s*/g, '>')
      .replace(/:\s+/g, ':')
    expectBorderModel(reformatted)
    expectActionsCell(reformatted)
  })
})

/** CSS in a formatting-proof form: comments gone, one quote style, whitespace collapsed, and no
 *  space around the punctuation a reformat moves — `,` `>` `{` `}` `;`, and after a `:`. A selector
 *  and a declaration go through the same function, so they compare like for like. */
function normalize(css: string): string {
  return stripComments(css)
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s*([,>{};])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .trim()
}

/** `declarationsFor` over normalized CSS: for pins on a sheet another lane owns and may reformat. */
function pinned(css: string, selector: string): string {
  return declarationsFor(normalize(css), normalize(selector))
}

// The two dependency pins on reorder.css (lane R0's sheet): the separate border model, and the
// lifted state of the sticky Actions cell keeping the cell's own -1px hairline. The reduced-motion
// drop line is one fixed overlay over every cell since lane R7, so no row state restyles the cell
// for it — and none may, or the cell would lose its hairline under the line.
function expectBorderModel(css: string) {
  const table = pinned(css, 'table.reorder-table')
  expect(table).toContain(normalize('border-collapse: separate;'))
  expect(table).toContain(normalize('border-spacing: 0;'))
}

function expectActionsCell(css: string) {
  const lifted = pinned(css, ".reorder-table tr[data-reorder='lifted'] > td.row-actions")
  expect(lifted).toContain(normalize('background: var(--surface-2);'))
  expect(lifted).toContain(normalize('-1px 0 0 var(--border),'))
  expect(pinned(css, '.reorder-drop-line')).toContain(normalize('position: fixed;'))
  expect(normalize(css)).not.toContain('data-reorder-drop')
}
