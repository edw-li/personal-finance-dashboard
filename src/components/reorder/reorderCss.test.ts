import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (settingsCss.test.ts's rule). */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated across blocks. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [
    ...stripComments(css).matchAll(new RegExp(`(^|[,{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g')),
  ]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((match) => match[2]).join(' ')
}

const css = readFileSync(path.resolve(__dirname, 'reorder.css'), 'utf8')

describe('reorder.css', () => {
  it('gives each cell of a reorderable table its own hairline (a collapsed border stays behind)', () => {
    const table = declarationsFor(css, '.reorder-table')
    expect(table).toContain('border-collapse: separate;')
    expect(table).toContain('border-spacing: 0;')
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
