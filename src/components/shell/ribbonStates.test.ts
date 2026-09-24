import { beforeEach, describe, expect, it } from 'vitest'
import { OCT1_EARLY, copyInOctober, copyOnSep23, flowsPart, timeStatus } from '../../testing/timeFixtures'
import type { TimeStatusOut } from '../../types/api'
import { setServerToday } from '../../utils/productToday'
import { chipState, type RibbonFeeds } from './ribbonStates'

// The real-data copy's feeds (2026-09-23 spec §V4): balances Jul–Sep on their 1sts and Oct 1 typed
// early on Sep 22; spending Jul–Sep (September's rent only); take-home Jul–Aug.
function feeds(time: TimeStatusOut | null, over: Partial<RibbonFeeds> = {}): RibbonFeeds {
  if (time !== null) setServerToday(time.today)
  return {
    balances: new Set(['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']),
    spending: new Set(['2026-07-01', '2026-08-01', '2026-09-01']),
    netPay: new Set(['2026-07-01', '2026-08-01']),
    time,
    ...over,
  }
}

beforeEach(() => setServerToday('2026-09-23'))

describe('chipState — what a month holds, in two halves and in words (2026-09-23 spec §T8)', () => {
  it('Sep 23: October is recorded early and has not begun; September is running', () => {
    const f = feeds(copyOnSep23())
    expect(chipState('2026-10-01', f)).toEqual({
      balances: 'partial',
      flows: 'empty',
      due: null,
      words: 'Oct 1 balances recorded early (provisional) · spending not due yet (October has not begun)',
    })
    expect(chipState('2026-09-01', f)).toEqual({
      balances: 'full',
      flows: 'partial',
      due: null,
      words: 'Sep 1 balances · spending not due yet (September in progress)',
    })
    expect(chipState('2026-08-01', f)).toEqual({
      balances: 'full',
      flows: 'full',
      due: null,
      words: 'Aug 1 balances · spending and take-home entered',
    })
  })

  it('Oct 3: September partly entered, its take-home missing, due by Oct 15', () => {
    const f = feeds(copyInOctober())
    expect(chipState('2026-09-01', f)).toEqual({
      balances: 'full',
      flows: 'partial',
      due: 'due',
      words: 'Sep 1 balances · spending entered during September (partial) · take-home missing · due by Oct 15',
    })
    expect(chipState('2026-10-01', f).words).toBe(
      'Oct 1 balances recorded early (provisional) · spending not due yet (October in progress)',
    )
  })

  it('Oct 16: the same month overdue', () => {
    const state = chipState('2026-09-01', feeds(copyInOctober('2026-10-16')))
    expect(state.due).toBe('overdue')
    expect(state.words).toBe(
      'Sep 1 balances · spending entered during September (partial) · take-home missing · overdue (was due by Oct 15)',
    )
  })

  it('names a missing month, and a month with only its take-home', () => {
    const missing = feeds(timeStatus('2026-10-03', { flows_due: [flowsPart('2026-09-01')] }), {
      spending: new Set(['2026-07-01', '2026-08-01']),
    })
    expect(chipState('2026-09-01', missing)).toMatchObject({
      flows: 'empty',
      words: 'Sep 1 balances · spending not entered · take-home missing · due by Oct 15',
    })
    const takeHomeOnly = feeds(
      timeStatus('2026-10-03', { flows_due: [flowsPart('2026-09-01', { take_home_entered: true })] }),
      { netPay: new Set(['2026-07-01', '2026-08-01', '2026-09-01']) },
    )
    expect(chipState('2026-09-01', takeHomeOnly)).toMatchObject({
      flows: 'partial',
      words: 'Sep 1 balances · spending not entered · take-home entered · due by Oct 15',
    })
  })

  it('names an earlier snapshot that stayed provisional, and balances not recorded at all', () => {
    const nov = feeds(timeStatus('2026-11-05', { provisional_past: [OCT1_EARLY] }))
    expect(chipState('2026-10-01', nov)).toMatchObject({
      balances: 'partial',
      words: expect.stringMatching(/^Oct 1 balances recorded early \(provisional\) · /),
    })
    expect(chipState('2026-06-01', nov)).toMatchObject({
      balances: 'empty',
      words: expect.stringMatching(/^Jun 1 balances not recorded · /),
    })
  })

  it('reads months before the book began from presence alone', () => {
    const f = feeds(copyInOctober(), {
      spending: new Set(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']),
    })
    expect(chipState('2026-06-01', f)).toMatchObject({
      balances: 'empty',
      flows: 'partial',
      words: 'Jun 1 balances not recorded · spending entered · take-home missing',
    })
  })

  it('keeps the old presence words without a time status (an older backend)', () => {
    const legacy = feeds(null)
    expect(chipState('2026-08-01', legacy)).toEqual({
      balances: 'full',
      flows: 'full',
      due: null,
      words: 'balances and spending entered',
    })
    expect(chipState('2026-10-01', legacy).words).toBe('balances entered, spending missing')
    expect(chipState('2026-05-01', legacy).words).toBe('nothing entered')
  })
})

// Spec review M9: a legacy month recorded early is provisional by snapshot_state's rule, but
// provisional_past leaves legacy months out (Needs attention does not nag about history). The chip
// reads the server's full list, so it hatches that month the way the Net worth chart draws it.
describe('the balances half follows the server’s provisional list (spec review M9)', () => {
  const history = (time: TimeStatusOut): RibbonFeeds => ({
    balances: new Set(['2024-03-01', '2024-04-01']),
    spending: new Set(['2024-03-01', '2024-04-01']),
    netPay: new Set(['2024-03-01', '2024-04-01']),
    time,
  })

  it('hatches a legacy month recorded early, which provisional_past leaves out', () => {
    const time = timeStatus('2026-09-23', { provisional_months: ['2024-03-01'] })
    expect(time.provisional_past).toEqual([])
    expect(chipState('2024-03-01', history(time))).toMatchObject({
      balances: 'partial',
      words: 'Mar 1, 2024 balances recorded early (provisional) · spending and take-home entered',
    })
    expect(chipState('2024-04-01', history(time)).balances).toBe('full')
  })

  it('reads a month the list does not name as final — even one the day would call ahead', () => {
    const time = timeStatus('2026-09-23', { provisional_months: [] })
    const ahead = { ...history(time), balances: new Set(['2026-12-01']) }
    expect(chipState('2026-12-01', ahead).balances).toBe('full')
  })
})

// Review minor 4: the chip judges the month in progress by the SERVER's time status — the same
// payload its words come from — never by the browser's store; and the book's first month is
// handed over once, not recomputed per chip.
describe('one source for the month, one computation of the book’s start (review minor 4)', () => {
  it('reads the month in progress off coverage.time, whatever the store says', () => {
    const f = feeds(copyOnSep23())
    setServerToday('2026-10-20')
    expect(chipState('2026-09-01', f).words).toBe('Sep 1 balances · spending not due yet (September in progress)')
  })

  it('takes the book’s first balances month from the feeds when handed it', () => {
    const base: RibbonFeeds = {
      balances: new Set(['2026-07-01', '2026-08-01', '2026-09-01']),
      spending: new Set(['2026-07-01', '2026-08-01']),
      netPay: new Set(['2026-08-01']),
      time: timeStatus('2026-10-03'),
    }
    expect(chipState('2026-07-01', base).flows).toBe('full')
    expect(chipState('2026-07-01', { ...base, firstBalances: '2026-08-01' })).toMatchObject({
      flows: 'partial',
      words: 'Jul 1 balances · spending entered · take-home missing',
    })
  })
})
