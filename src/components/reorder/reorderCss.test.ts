import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (settingsCss.test.ts's rule). */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated across blocks, whitespace collapsed (a multi-line
 *  box-shadow reads as one line). Unlike settingsCss.test.ts's helper, the selector may stand
 *  anywhere in a selector list, not only last, and a block's closing brace is only looked at, never
 *  consumed — it is the next block's opening delimiter, so two adjacent blocks for one selector are
 *  both found. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [
    ...stripComments(css).matchAll(
      new RegExp(`(^|[,{}])\\s*${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)(?=\\})`, 'g'),
    ),
  ]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((match) => match[2].replace(/\s+/g, ' ')).join(' ')
}

const css = readFileSync(path.resolve(__dirname, 'reorder.css'), 'utf8')

describe('reorder.css', () => {
  it('gives each cell of a reorderable table its own hairline (a collapsed border stays behind)', () => {
    // table.reorder-table (0,1,1) outranks .data-table / .port-table `border-collapse: collapse`
    // (0,1,0) whichever stylesheet loads last.
    const table = declarationsFor(css, 'table.reorder-table')
    expect(table).toContain('border-collapse: separate;')
    expect(table).toContain('border-spacing: 0;')
  })

  it('keeps the grip column as narrow as the icon against the house cell padding', () => {
    // (0,2,0) outranks .data-table td / .port-table td padding (0,1,1).
    const cell = declarationsFor(css, '.reorder-table .reorder-grip-cell')
    expect(cell).toContain('width: 2rem;')
    expect(cell).toContain('padding-right: 0;')
  })

  it('moves peers — and a keyboard-lifted unit — on the motion tokens only', () => {
    expect(declarationsFor(css, "[data-reorder='shifting']")).toContain(
      'transition: transform var(--t-fast) var(--ease-out);',
    )
    expect(declarationsFor(css, "[data-reorder='lifted'][data-reorder-mode='keyboard']")).toContain(
      'transition: transform var(--t-fast) var(--ease-out);',
    )
  })

  it('lifts the unit above its neighbours', () => {
    const lifted = declarationsFor(css, "[data-reorder='lifted']")
    expect(lifted).toContain('position: relative;')
    expect(lifted).toContain('z-index: 2;')
  })

  it('scopes the table row states to .reorder-table; a list of boxes keeps its own rules', () => {
    expect(declarationsFor(css, ".reorder-table tr[data-reorder='lifted'] > td")).toContain(
      'background: var(--surface-2);',
    )
    expect(declarationsFor(css, ".reorder-table tr[data-reorder-drop='before'] > td")).toContain(
      'box-shadow: inset 0 2px 0 var(--accent);',
    )
    expect(declarationsFor(css, ".reorder-table tr[data-reorder-drop='after'] > td")).toContain(
      'box-shadow: inset 0 -2px 0 var(--accent);',
    )
    expect(declarationsFor(css, ".reorder-table tr[data-reorder-saved] > td")).toContain(
      'animation: reorder-saved var(--t-flash) var(--ease-out);',
    )
    expect(declarationsFor(css, ":not(tr)[data-reorder='lifted']")).toContain('border-radius: 6px;')
    expect(declarationsFor(css, ":not(tr)[data-reorder-drop='before']")).toContain(
      'box-shadow: inset 0 2px 0 var(--accent);',
    )
    expect(declarationsFor(css, ":not(tr)[data-reorder-drop='after']")).toContain(
      'box-shadow: inset 0 -2px 0 var(--accent);',
    )
    // An unscoped `tr[data-reorder…] > td` (0,1,2) loses to panels.css's pinned cells (0,2,1).
    expect(stripComments(css)).not.toMatch(/(^|[,{}])\s*tr\[data-reorder/)
  })

  it.each([
    ['row-actions', '-1px 0 0 var(--border)'],
    ['col-identity', '1px 0 0 var(--border)'],
  ])('a pinned td.%s keeps its own hairline under every row state', (cell, hairline) => {
    const lifted = declarationsFor(css, `.reorder-table tr[data-reorder='lifted'] > td.${cell}`)
    expect(lifted).toContain('background: var(--surface-2);')
    expect(lifted).toContain(
      `box-shadow: ${hairline}, inset 0 1px 0 var(--border), inset 0 -1px 0 var(--border);`,
    )
    expect(declarationsFor(css, `.reorder-table tr[data-reorder-drop='before'] > td.${cell}`)).toContain(
      `box-shadow: ${hairline}, inset 0 2px 0 var(--accent);`,
    )
    expect(declarationsFor(css, `.reorder-table tr[data-reorder-drop='after'] > td.${cell}`)).toContain(
      `box-shadow: ${hairline}, inset 0 -2px 0 var(--accent);`,
    )
  })

  it('flashes a saved row for --t-flash and draws the reduced-motion drop line in the accent', () => {
    const plain = stripComments(css)
    expect(plain).toMatch(/animation:\s*reorder-saved var\(--t-flash\)/)
    expect(plain).toContain("[data-reorder-drop='before']")
    expect(plain).toContain('inset 0 2px 0 var(--accent)')
    expect(plain).toContain('inset 0 -2px 0 var(--accent)')
  })

  it('never styles .is-dragging — the detail-panel resizer owns that name', () => {
    expect(stripComments(css)).not.toContain('.is-dragging')
  })

  it('keeps a touch drag on the grip from scrolling the page, and the cursor honest mid-drag', () => {
    expect(declarationsFor(css, '.reorder-grip')).toContain('touch-action: none;')
    expect(stripComments(css)).toMatch(/html\.reorder-active \*[^{]*\{[^}]*cursor: grabbing !important;/)
  })
})
