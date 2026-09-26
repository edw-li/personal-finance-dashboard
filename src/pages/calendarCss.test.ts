import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (settingsCss.test.ts's rule): a `}` parked inside a
 *  multi-line comment would otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const css = stripComments(readFileSync(path.resolve(__dirname, 'CalendarPage.css'), 'utf8'))

/** Every rule as its selector LIST and its declarations — `[^{}]` on both sides, so an at-rule's
 *  header never swallows the rules inside it. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
  body,
}))

/** Every declaration of `selector`, including rules that name it inside a selector group. */
function declarationsFor(selector: string): string {
  const found = rules.filter((rule) => rule.selectors.includes(selector))
  if (found.length === 0) throw new Error(`no ${selector} rule`)
  return found.map((rule) => rule.body).join(' ')
}

describe('CalendarPage.css — the five-tile cash-flow strip (2026-09-23 spec §B2)', () => {
  // The shared .kpi-row-5 goes five-across only from 1000px of page container; a 1280 window
  // gives this page ~990px, which laid the strip out as four tiles and a lone Vesting. jsdom
  // resolves no container query, so the rule itself is what can be pinned.
  it('holds five columns from 880px of the PAGE container, asked for by name', () => {
    const block = /@container page \(min-width: 880px\) \{\s*\.cal-strip\.kpi-row\.kpi-row-5 \{([^}]*)\}/.exec(css)
    expect(block).not.toBeNull()
    expect(block?.[1]).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));')
  })
})

describe('CalendarPage.css — out-of-month days and the event popover (batch-2 polish D2)', () => {
  // The out-of-month cell wore `opacity: 0.45`, and opacity reaches every descendant: the popover
  // open inside it (September's Oct 1 reminder, August's Aug 31 ESPP purchase) painted at 45%, the
  // legend showing through it, and — the cell being its own stacking context — under the next rows'
  // chips. The day's own parts recede instead; the popover is a layer above the grid, not part of
  // the day. jsdom applies no stylesheet, so the rules are what can be pinned.
  it("dims the day's border, date, chips and overflow button — never the cell that holds the popover", () => {
    expect(declarationsFor('.cal-day-outside')).not.toMatch(/opacity|filter/)
    for (const part of ['.cal-day-outside > .cal-day-number', '.cal-day-outside .cal-chip', '.cal-day-outside > .cal-more']) {
      expect(declarationsFor(part)).toContain('opacity: 0.45;')
    }
    // Nothing dims what holds the popover: no dimming rule's subject is the cell, the chip's slot or
    // the popover itself (the date button, the chips and "+N more" are the day's own parts).
    const holders = ['.cal-day', '.cal-day-outside', '.cal-day-today', '.cal-day-active', '.cal-chip-slot', '.cal-popover', '.cal-popover-right', '.cal-popover-up']
    for (const rule of rules.filter((r) => /opacity|filter/.test(r.body))) {
      for (const selector of rule.selectors) {
        const subject = selector.split(/\s*[\s>+~]\s*/).pop() ?? ''
        expect((subject.match(/\.[\w-]+/g) ?? []).filter((name) => holders.includes(name))).toEqual([])
      }
    }
  })

  // The popover used to open downward from every row, so a bubble in the last rows ran off the
  // grid and over the legend and notes under it. The monthly reminder always sits in the last row
  // (the 1st of the next month) and is the tallest bubble; the grid's lower half opens upward
  // (CalendarGrid.tsx picks the rows).
  it('opens an upward bubble above its chip', () => {
    const up = declarationsFor('.cal-popover-up')
    expect(up).toContain('top: auto;')
    expect(up).toContain('bottom: calc(100% + 4px);')
  })
})
