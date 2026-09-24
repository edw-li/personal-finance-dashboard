import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (settingsCss.test.ts's rule): a `}` parked inside a
 *  multi-line comment would otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const css = stripComments(readFileSync(path.resolve(__dirname, 'MonthlyUpdatePage.css'), 'utf8'))

/** Every declaration of `selector` — a rule split across two blocks (the footer's is) answers as one. */
function declarationsFor(selector: string): string {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) =>
    selectors.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(selector),
  )
  if (blocks.length === 0) throw new Error(`no ${selector} rule`)
  return blocks.map((m) => m[2]).join(' ')
}

describe('MonthlyUpdatePage.css — the Review footer (batch 2 final verification D6)', () => {
  // Beside the buttons, the gate sentence wrapped against "Save progress" once the primary read
  // "Save and close September" (1280 and 1600). It takes a line of its own now, right-aligned
  // above the button row, and the actions keep the right edge on whichever line they land. jsdom
  // computes no layout, so the rules are what can be pinned; the page test pins the order.
  it('gives the gate sentence a line of its own above right-aligned buttons', () => {
    expect(declarationsFor('.wizard-footer')).toContain('flex-wrap: wrap;')
    const note = declarationsFor('.wizard-footer-note')
    expect(note).toContain('flex: 1 0 100%;')
    expect(note).toContain('text-align: right;')
    expect(declarationsFor('.wizard-footer-actions')).toContain('margin-left: auto;')
  })
})
