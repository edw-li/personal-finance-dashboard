import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DROP_LINE_PX, LIFTED_LAYER } from './reorderDom'

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

  it('lifts the unit above its neighbours — on the layer the drop line is drawn one above', () => {
    const lifted = declarationsFor(css, "[data-reorder='lifted']")
    expect(lifted).toContain('position: relative;')
    expect(lifted).toContain(`z-index: ${LIFTED_LAYER};`)
  })

  it('scopes the table row states to .reorder-table; a list of boxes keeps its own rules', () => {
    expect(declarationsFor(css, ".reorder-table tr[data-reorder='lifted'] > td")).toContain(
      'background: var(--surface-2);',
    )
    expect(declarationsFor(css, ".reorder-table tr[data-reorder-saved] > td")).toContain(
      'animation: reorder-saved var(--t-flash) var(--ease-out);',
    )
    expect(declarationsFor(css, ":not(tr)[data-reorder='lifted']")).toContain('border-radius: 6px;')
    expect(declarationsFor(css, ':not(tr)[data-reorder-saved]')).toContain(
      'animation: reorder-saved var(--t-flash) var(--ease-out);',
    )
    // An unscoped `tr[data-reorder…] > td` (0,1,2) loses to panels.css's pinned cells (0,2,1).
    expect(stripComments(css)).not.toMatch(/(^|[,{}])\s*tr\[data-reorder/)
  })

  it('draws the reduced-motion drop line as ONE fixed overlay — never inside a cell, where the row in hand covered it', () => {
    const line = declarationsFor(css, '.reorder-drop-line')
    expect(line).toContain('position: fixed;')
    expect(line).toContain(`height: ${DROP_LINE_PX}px;`) // the thickness the hook centres on the edge
    expect(line).toContain('background: var(--accent);')
    expect(line).toContain('pointer-events: none;')
    // The hook hides it with the `hidden` attribute, which any `display` here would override; and
    // it sets the z-index from the list's own layer (dropLineLayer), so none is fixed here.
    expect(line).not.toContain('display')
    expect(line).not.toContain('z-index')
    // The row keeps `data-reorder-drop` (the tested contract), but nothing styles it any more: the
    // inset box-shadow line — in the target's cells, pinned ones too — is gone.
    expect(stripComments(css)).not.toContain('data-reorder-drop')
    expect(stripComments(css)).not.toMatch(/inset 0 -?2px 0 var\(--accent\)/)
  })

  it('draws a lifted multi-row unit as one block: its rows meet on one hairline, never two', () => {
    const lifted = declarationsFor(css, ".reorder-table tr[data-reorder='lifted']")
    expect(lifted).toContain('--reorder-edge-top: inset 0 1px 0 var(--border);')
    expect(lifted).toContain('--reorder-edge-bottom: inset 0 -1px 0 var(--border);')
    // Right after another lifted row: no top edge. Right before one: no bottom edge. A middle row
    // (a parent's second of three components) matches both and draws neither.
    expect(
      declarationsFor(css, ".reorder-table tr[data-reorder='lifted'] + tr[data-reorder='lifted']"),
    ).toContain('--reorder-edge-top: 0 0 transparent;')
    expect(
      declarationsFor(css, ".reorder-table tr[data-reorder='lifted']:has(+ tr[data-reorder='lifted'])"),
    ).toContain('--reorder-edge-bottom: 0 0 transparent;')
    expect(declarationsFor(css, ".reorder-table tr[data-reorder='lifted'] > td")).toContain(
      'box-shadow: var(--reorder-edge-top), var(--reorder-edge-bottom);',
    )
  })

  it.each([
    ['row-actions', '-1px 0 0 var(--border)'],
    ['col-identity', '1px 0 0 var(--border)'],
  ])('a pinned td.%s keeps its own hairline while its row is lifted', (cell, hairline) => {
    const lifted = declarationsFor(css, `.reorder-table tr[data-reorder='lifted'] > td.${cell}`)
    expect(lifted).toContain('background: var(--surface-2);')
    expect(lifted).toContain(
      `box-shadow: ${hairline}, var(--reorder-edge-top), var(--reorder-edge-bottom);`,
    )
  })

  it('flashes a pinned cell on its own opaque background — nothing scrolled beneath it shows through', () => {
    for (const cell of ['row-actions', 'col-identity']) {
      expect(declarationsFor(css, `.reorder-table tr[data-reorder-saved] > td.${cell}`)).toContain(
        'animation: reorder-saved-pinned var(--t-flash) var(--ease-out);',
      )
    }
    const pinned = /@keyframes reorder-saved-pinned\s*\{([\s\S]*?)\n\}/.exec(stripComments(css))?.[1] ?? ''
    expect(pinned).toContain('color-mix(in srgb, var(--accent) 22%, var(--surface))')
    expect(pinned).toMatch(/to\s*\{\s*background-color: var\(--surface\);\s*\}/)
    expect(pinned).not.toContain('transparent')
  })

  it('keeps the drop line in Windows High Contrast: forced colors paint the accent as the canvas, so it takes Highlight', () => {
    // Measured in Edge's forced-colors emulation (lane R7 review 8): the accent line computed and
    // painted as the canvas colour — gone — while an author `Highlight` is kept.
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(stripComments(css))?.[1] ?? ''
    expect(declarationsFor(forced, '.reorder-drop-line')).toContain('background: Highlight;')
  })

  it('flashes a saved row for --t-flash', () => {
    expect(stripComments(css)).toMatch(/animation:\s*reorder-saved var\(--t-flash\)/)
  })

  it("lifts a list of boxes on the theme's shadow token, never a raw colour", () => {
    // --shadow is bare `r g b / a` components (index.css): read as rgb(var(--shadow)).
    expect(declarationsFor(css, ":not(tr)[data-reorder='lifted']")).toContain(
      'box-shadow: 0 4px 14px rgb(var(--shadow));',
    )
    expect(stripComments(css)).not.toMatch(/rgb\(\s*\d/)
  })

  it('a pressed grip keeps its accent under the pointer — hover never outranks it', () => {
    expect(
      declarationsFor(
        css,
        ".reorder-grip:hover:not(:disabled):not([aria-disabled='true']):not([aria-pressed='true'])",
      ),
    ).toContain('color: var(--text);')
    expect(declarationsFor(css, ".reorder-grip[aria-pressed='true']")).toContain('color: var(--accent);')
  })

  it('never styles .is-dragging — the detail-panel resizer owns that name', () => {
    expect(stripComments(css)).not.toContain('.is-dragging')
  })

  it('keeps a touch drag on the grip from scrolling the page, and the cursor honest mid-drag', () => {
    expect(declarationsFor(css, '.reorder-grip')).toContain('touch-action: none;')
    expect(stripComments(css)).toMatch(/html\.reorder-active \*[^{]*\{[^}]*cursor: grabbing !important;/)
  })
})
