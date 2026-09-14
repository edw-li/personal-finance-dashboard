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

const overview = readFileSync(path.resolve(__dirname, 'OverviewPage.css'), 'utf8')

describe('OverviewPage.css', () => {
  // Lane V measured the agenda column ending 66px below the wealth column at 1440 and 1920
  // (the limit is 24px). jsdom computes no layout, so the rules that close that gap — stretch
  // the columns to the taller one, then let each column's LAST row absorb the slack — can only
  // be pinned here. The row counts are the cards themselves: trend + changes, and up next +
  // needs attention + data status.
  it('gives the two primary columns a shared bottom by stretching their last card', () => {
    expect(declarationsFor(overview, '.overview-primary')).toContain('align-items: stretch;')
    expect(declarationsFor(overview, '.overview-wealth-column')).toContain('grid-template-rows: auto 1fr;')
    expect(declarationsFor(overview, '.overview-agenda-column')).toContain('grid-template-rows: auto auto 1fr;')
    // A stretched row must not reintroduce the margins the pair was built without.
    expect(declarationsFor(overview, '.overview-primary .card')).toContain('margin: 0;')
  })
})
