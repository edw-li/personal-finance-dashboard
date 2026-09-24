import { describe, expect, it } from 'vitest'
import type { CoverageOut, TimeStatusOut } from '../../types/api'
import {
  OCT1_EARLY,
  SEP1,
  balancesPart,
  copyInOctober,
  copyOnSep23,
  flowsPart,
  snapshotStateOut,
  timeStatus,
} from '../../testing/timeFixtures'
import { setServerToday } from '../../utils/productToday'
import { freshnessClauses, spendingGaps } from './freshness'

// Production's own shape on 2026-09-04 (spec §0): balances through September, spending
// entered through July, August never entered, September saved as nineteen rows of $0.00.
function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
    spending: ['2026-06-01', '2026-07-01'],
    net_pay: ['2026-06-01', '2026-07-01'],
    spending_empty: ['2026-09-01'],
    spending_missing: ['2026-08-01'],
    net_pay_missing: ['2026-08-01', '2026-09-01'],
    latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    ...over,
  }
}

const texts = (coverage: CoverageOut): string[] =>
  freshnessClauses(coverage).map((clause) => clause.text)
const amber = (coverage: CoverageOut): string[] =>
  freshnessClauses(coverage)
    .filter((clause) => clause.lagging)
    .map((clause) => clause.key)

// The real-data copy's feeds (2026-09-23 spec §V4): balances Jul–Sep on their 1sts and Oct 1
// typed early on Sep 22; spending Jul–Sep (September's rent only); take-home Jul–Aug.
function copy(time: TimeStatusOut): CoverageOut {
  setServerToday(time.today)
  return {
    balances: ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'],
    spending: ['2026-07-01', '2026-08-01', '2026-09-01'],
    net_pay: ['2026-07-01', '2026-08-01'],
    spending_empty: [],
    spending_missing: [],
    net_pay_missing: [],
    latest: { balances: '2026-10-01', spending: '2026-09-01', net_pay: '2026-08-01' },
    time,
  }
}

describe('freshnessClauses — dated, and amber only when a part is overdue (2026-09-23 spec §T4)', () => {
  it('Sep 23: balances as of the day they were typed, September in progress, nothing amber', () => {
    const coverage = copy(copyOnSep23())
    expect(texts(coverage)).toEqual([
      'Balances as of Sep 22 — provisional, for Oct 1',
      'Spending through Aug 2026 · Sep in progress',
      'Net pay through Aug 2026',
    ])
    expect(amber(coverage)).toEqual([])
  })

  it('Oct 3: September partly entered and its take-home due — still nothing amber', () => {
    const coverage = copy(copyInOctober())
    expect(texts(coverage)).toEqual([
      'Balances as of Sep 22 — provisional, for Oct 1',
      'Spending through Aug 2026 · Sep partly entered — due',
      'Net pay through Aug 2026 · Sep due',
    ])
    expect(amber(coverage)).toEqual([])
  })

  it('Oct 16: every late part turns amber and says so in words', () => {
    const coverage = copy(copyInOctober('2026-10-16'))
    expect(texts(coverage)).toEqual([
      'Balances as of Sep 22 — provisional, for Oct 1 · overdue — confirm or update them',
      'Spending through Aug 2026 · Sep partly entered — overdue',
      'Net pay through Aug 2026 · Sep overdue',
    ])
    expect(amber(coverage)).toEqual(['balances', 'spending', 'net_pay'])
  })

  // Code review I2: from the 7th the provisional Oct 1 balances turned amber with no words — the
  // colour is never the only channel.
  it('Oct 7: provisional balances past their day say so, and only they are amber', () => {
    const coverage = copy(copyInOctober('2026-10-07'))
    expect(texts(coverage)[0]).toBe('Balances as of Sep 22 — provisional, for Oct 1 · overdue — confirm or update them')
    expect(amber(coverage)).toEqual(['balances'])
  })

  it('Oct 10 with Oct 1 confirmed: final balances, only the flows still due', () => {
    const time = copyInOctober('2026-10-10')
    const oct1 = snapshotStateOut('2026-10-01', { recorded_on: '2026-10-01' })
    const coverage = copy({ ...time, current_snapshot: oct1, balances: balancesPart('2026-10-01', oct1) })
    expect(texts(coverage)[0]).toBe('Balances as of Oct 1')
    expect(amber(coverage)).toEqual([])
  })

  it('says when the current balances are missing — due, then overdue', () => {
    const due = copy(timeStatus('2026-10-03', { current_snapshot: SEP1, balances: balancesPart('2026-10-01', null) }))
    expect(texts(due)[0]).toBe('Balances as of Sep 1 · Oct 1 due')
    expect(amber(due)).toEqual([])
    const late = copy(
      timeStatus('2026-10-08', { current_snapshot: SEP1, balances: balancesPart('2026-10-01', null, true) }),
    )
    expect(texts(late)[0]).toBe('Balances as of Sep 1 · Oct 1 overdue')
    expect(amber(late)).toEqual(['balances'])
  })

  it('names an earlier snapshot that stayed provisional, amber', () => {
    const nov1 = snapshotStateOut('2026-11-01')
    const coverage = copy(
      timeStatus('2026-11-05', { current_snapshot: nov1, balances: balancesPart('2026-11-01', nov1), provisional_past: [OCT1_EARLY] }),
    )
    expect(texts(coverage)[0]).toBe('Balances as of Nov 1 · Oct 1 still provisional')
    expect(amber(coverage)).toEqual(['balances'])
  })

  it('Jan 5 2027: the year boundary names years, the newest due month leads, older ones in brackets', () => {
    const coverage = copy(
      timeStatus('2027-01-05', {
        current_snapshot: OCT1_EARLY,
        previous_snapshot: SEP1,
        balances: balancesPart('2027-01-01', null),
        flows_due: [
          flowsPart('2026-12-01'),
          flowsPart('2026-11-01', { overdue: true }),
          flowsPart('2026-10-01', { overdue: true }),
          flowsPart('2026-09-01', { spending: 'partial', overdue: true }),
        ],
        provisional_past: [OCT1_EARLY],
      }),
    )
    expect(texts(coverage)).toEqual([
      'Balances as of Sep 22, 2026 — provisional, for Oct 1, 2026 · Jan 1 due',
      'Spending through Aug 2026 · Dec due (Sep partly entered, Oct missing, Nov missing)',
      'Net pay through Aug 2026 · Dec due (Sep missing, Oct missing, Nov missing)',
    ])
    expect(amber(coverage)).toEqual(['balances', 'spending', 'net_pay'])
  })

  it('an older hole before the latest entered month is not this line’s job', () => {
    const coverage = copy(
      timeStatus('2026-10-03', {
        flows_due: [flowsPart('2026-07-01', { spending: 'partial', overdue: true, take_home_entered: true })],
      }),
    )
    coverage.spending = ['2026-07-01', '2026-08-01', '2026-09-01']
    coverage.net_pay = ['2026-07-01', '2026-08-01', '2026-09-01']
    expect(texts(coverage).slice(1)).toEqual(['Spending through Sep 2026', 'Net pay through Sep 2026'])
    expect(amber(coverage)).toEqual([])
  })

  it('says a feed never started rather than calling a fresh database late', () => {
    const fresh = coverageOut({
      balances: [],
      spending: [],
      net_pay: [],
      spending_empty: [],
      spending_missing: [],
      net_pay_missing: [],
      latest: { balances: null, spending: null, net_pay: null },
      time: null,
    })
    expect(texts(fresh)).toEqual([
      'Balances — no months',
      'Spending — no months',
      'Net pay — no months',
    ])
    expect(amber(fresh)).toEqual([])
  })

  it('without a time status (an older backend) names the months and never ambers', () => {
    expect(texts(coverageOut())).toEqual([
      'Balances through Sep 2026',
      'Spending through Jul 2026 (Aug missing, Sep empty)',
      'Net pay through Jul 2026',
    ])
    expect(amber(coverageOut())).toEqual([])
    const older: CoverageOut = {
      balances: ['2026-08-01', '2026-09-01'],
      spending: ['2026-07-01'],
      net_pay: ['2026-07-01'],
    }
    expect(texts(older)).toEqual([
      'Balances through Sep 2026',
      'Spending through Jul 2026',
      'Net pay through Jul 2026',
    ])
    expect(amber(older)).toEqual([])
  })
})

describe('spendingGaps — only what comes AFTER the last entered month', () => {
  it('labels missing and empty months in calendar order', () => {
    expect(spendingGaps(coverageOut())).toBe('Aug missing, Sep empty')
  })

  it('ignores an older hole — that is the strip and the Health card job', () => {
    expect(spendingGaps(coverageOut({ spending_missing: ['2026-03-01', '2026-08-01'] }))).toBe(
      'Aug missing, Sep empty',
    )
  })

  it('carries the year on a gap outside the clause own year', () => {
    const turn = coverageOut({
      balances: ['2025-12-01', '2026-01-01'],
      spending: ['2025-12-01'],
      spending_empty: [],
      spending_missing: ['2026-01-01'],
      latest: { balances: '2026-01-01', spending: '2025-12-01', net_pay: '2025-12-01' },
    })
    expect(spendingGaps(turn)).toBe('Jan 2026 missing')
  })

  it('folds past three named months', () => {
    const many = coverageOut({
      spending: ['2026-01-01'],
      spending_missing: ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'],
      spending_empty: ['2026-09-01'],
      latest: { balances: '2026-09-01', spending: '2026-01-01', net_pay: '2026-07-01' },
    })
    expect(spendingGaps(many)).toBe('Feb missing, Mar missing, Apr missing, +2 more')
  })

  it('drops an empty month the balances window never reached', () => {
    // The server does NOT window `spending_empty` (services/coverage.py): a month saved as
    // all $0.00 after the last snapshot is still on file, but it was never part of the book,
    // so the footer must not report the window as waiting for it.
    const beyond = coverageOut({
      balances: ['2026-06-01', '2026-07-01', '2026-08-01'],
      spending_empty: ['2026-09-01', '2026-10-01'],
      spending_missing: ['2026-08-01'],
      latest: { balances: '2026-08-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    })
    expect(spendingGaps(beyond)).toBe('Aug missing')
  })

  it('is empty on a fully entered window', () => {
    expect(spendingGaps(coverageOut({ spending_empty: [], spending_missing: [] }))).toBe('')
  })
})

describe('freshnessClauses — dt/dd split for the Data status card (2026-09-13 polish §10)', () => {
  it('exposes a label and a detail whose concatenation is the sentence', () => {
    const [balances, spending, netPay] = freshnessClauses(copy(copyInOctober('2026-10-16')))
    expect(balances).toMatchObject({
      label: 'Balances as of',
      detail: 'Sep 22 — provisional, for Oct 1 · overdue — confirm or update them',
      text: 'Balances as of Sep 22 — provisional, for Oct 1 · overdue — confirm or update them',
      lagging: true,
    })
    expect(spending).toMatchObject({
      label: 'Spending through',
      detail: 'Aug 2026 · Sep partly entered — overdue',
      text: 'Spending through Aug 2026 · Sep partly entered — overdue',
      lagging: true,
    })
    expect(netPay).toMatchObject({ label: 'Net pay through', detail: 'Aug 2026 · Sep overdue', lagging: true })
    const [, , none] = freshnessClauses({ ...copy(copyInOctober()), net_pay: [] })
    expect(none).toMatchObject({ label: 'Net pay', detail: 'no months · Sep due', text: 'Net pay — no months · Sep due' })
  })
})
