import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (settingsCss.test.ts's rule): a `}` parked inside a
 *  multi-line comment would otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const css = stripComments(readFileSync(path.resolve(__dirname, 'CalendarPage.css'), 'utf8'))

describe('CalendarPage.css — the five-tile cash-flow strip (2026-09-23 spec §B2)', () => {
  // The shared .kpi-row-5 goes five-across only from 1000px of page container; a 1280 window
  // gives this page ~990px, which laid the strip out as four tiles and a lone Vesting. jsdom
  // resolves no container query, so the rule itself is what can be pinned.
  it('holds five columns from 880px of the PAGE container, asked for by name', () => {
    const block = /@container page \(min-width: 880px\) \{\s*\.cal-strip\.kpi-row-5 \{([^}]*)\}/.exec(css)
    expect(block).not.toBeNull()
    expect(block?.[1]).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));')
  })
})
