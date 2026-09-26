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
  // 2026-09-23 spec §B2: the 45-day line grew a living-costs clause, and at 1600 the card broke
  // it inside a figure ("≈ −" / "$8.2k living costs") — U+2212 and "$" are both prefix
  // characters, which a non-breaking space cannot glue. Each clause is a nowrap span instead.
  it('keeps each Up next clause on one line', () => {
    expect(declarationsFor(overview, '.up-next-clause')).toContain('white-space: nowrap;')
  })

  // Batch 2 final verification D3: the monthly reminder's longer label ("Monthly update — Oct 1
  // balances · September spending & take-home") squeezed the date beside it onto two lines ("Oct 1,"
  // over "2026") at 1280 and 1600. The date is a flex item of the row: nowrap makes its one line its
  // minimum width and `flex: none` keeps it from shrinking, so the label after it wraps instead.
  it('keeps each Up next date on one line, so the label beside it wraps instead', () => {
    const date = declarationsFor(overview, '.up-next-date')
    expect(date).toContain('white-space: nowrap;')
    expect(date).toContain('flex: none;')
  })

  // Batch 2 final verification D4: on 2026-10-16 the overdue wording ("Sep 22 — provisional, for
  // Oct 1 · overdue — confirm or update them") squeezed its label to "Balances as" over "of" at 1600,
  // and "Spending through" as well at 1280. The label is a flex item of the row: nowrap and
  // `flex: none` keep it whole, so the value beside it wraps instead.
  it('keeps each Data status label on one line, so the value beside it wraps instead', () => {
    const label = declarationsFor(overview, '.data-status-row dt')
    expect(label).toContain('white-space: nowrap;')
    expect(label).toContain('flex: none;')
  })

  // Lane V measured the agenda column ending 66px below the wealth column (the limit is 24px); then
  // the stretch landed as a 66–134px blank band inside "Changes" (OU-04). The columns still share a
  // bottom, and the slack goes to something that can use it (2026-09-25 polish spec §3.2): on the left
  // the Net worth trend's row is the 1fr (the trend fills it), "Changes" keeps its own height; on the
  // right only the last card, Data status, takes slack — when the left column is the taller.
  it('gives the two primary columns a shared bottom — the slack to the trend, and to the agenda’s last card', () => {
    expect(declarationsFor(overview, '.overview-primary')).toContain('align-items: stretch;')
    expect(declarationsFor(overview, '.overview-wealth-column')).toContain('grid-template-rows: 1fr auto;')
    expect(declarationsFor(overview, '.overview-agenda-column')).toContain('grid-template-rows: auto auto 1fr;')
    // A stretched row must not reintroduce the margins the pair was built without.
    expect(declarationsFor(overview, '.overview-primary .card')).toContain('margin: 0;')
  })

  // With the trend's Table open the left column is the taller and Data status stretches (spec §3.2):
  // its note rides the card's foot instead of hanging over a 242–310px blank band.
  it("pins Data status's note to the card's foot, keeping its air when nothing stretches", () => {
    const card = declarationsFor(overview, '.overview-data-status')
    expect(card).toContain('display: flex;')
    expect(card).toContain('flex-direction: column;')
    const note = declarationsFor(overview, '.data-status-note')
    expect(note).toContain('margin: auto 0 0;')
    expect(note).toContain('padding-top: .6rem;')
  })
})
