import { beforeEach, describe, expect, it } from 'vitest'
import { earlySnapshot, snapshotStateOut, timeStatus } from '../../testing/timeFixtures'
import type { CoverageOut, DividendOut, SnapshotStateOut, SpendingYearly } from '../../types/api'
import { setServerToday } from '../../utils/productToday'
import { windowWords, ytdStats } from './ytd'

const TODAY = '2026-08-18'

// The words carry the server's year rule ("Dec 28, 2026" outside it): pin the product day.
beforeEach(() => setServerToday(TODAY))

/** A timeseries: months with their net worth, final and dated by their 1st unless `dated`
 *  names the snapshots typed early — month → the day they were recorded. */
function ts(months: string[], netWorth: number[], dated: Record<string, string> = {}) {
  return {
    months,
    net_worth: netWorth.map((n) => n.toFixed(2)),
    as_of: months.map((month) => dated[month] ?? month),
    provisional: months.map((month) => month in dated),
  }
}

function yearly(years: SpendingYearly['years'] = []): SpendingYearly {
  return { years }
}

function rollup(year: number): SpendingYearly['years'][number] {
  return {
    year,
    by_category: [],
    total: '32000.00',
    net_pay_total: '90000.00',
    savings_rate: '0.644444',
    living_total: '27000.00',
    tax_total: '4000.00',
    transfer_total: '1000.00',
    cash_savings: '58000.00',
    payroll_savings: '12000.00',
    total_savings: '70000.00',
    total_savings_rate: '0.686274',
    months_matched: 7,
  }
}

// Production's 2026 shape: Jan–Jul entered on both feeds, August never entered, September
// saved empty — the windows the card has to name.
const JAN_TO_JUL = [
  '2026-01-01', '2026-02-01', '2026-03-01',
  '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01',
]

function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: [...JAN_TO_JUL, '2026-08-01', '2026-09-01'],
    spending: [...JAN_TO_JUL],
    net_pay: [...JAN_TO_JUL],
    spending_empty: ['2026-09-01'],
    spending_missing: ['2026-08-01'],
    net_pay_missing: ['2026-08-01', '2026-09-01'],
    latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    ...over,
  }
}

/** The coverage a current backend sends on `today`: its `time` names the current snapshot —
 *  the server's answer the YTD row measures to (spec review M5: no rule of its own here). */
function coverageOn(today: string, current: SnapshotStateOut | null): CoverageOut {
  return coverageOut({ time: timeStatus(today, { current_snapshot: current }) })
}

function dividend(payDate: string, amount: string, id = 1): DividendOut {
  return {
    id, security_id: 1, account: null, pay_date: payDate, amount,
    source: 'manual', ex_date: null, per_share: null, shares_held: null, notes: null,
  }
}

describe('ytdStats — net worth from the Jan 1 balances (2026-09-23 spec §T2)', () => {
  it('uses the eligible savings window when entered current-month rows are excluded', () => {
    const stats = ytdStats(ts([], []), yearly([{ ...rollup(2026), months_matched: 1 }]), [], coverageOut({
      spending: ['2026-06-01', '2026-07-01', '2026-08-01'], net_pay: ['2026-06-01', '2026-07-01', '2026-08-01'],
      eligible_savings: ['2026-07-01'],
    }), TODAY)
    expect(stats.savedWindow).toEqual({ from: '2026-07-01', to: '2026-07-01', months: 1 })
    expect(stats.spendWindow).toEqual(stats.savedWindow)
    expect(stats.netPayWindow?.to).toBe('2026-08-01')
  })

  it('runs from the Jan 1 balances to the current snapshot — the copy on Sep 23', () => {
    // finance_realdata_b2: Dec 1 $566,912.72 · Jan 1 $605,273.99 · Sep 1 $806,667.88 · Oct 1
    // $933,250.90, typed early on Sep 22. December no longer counts as the new year.
    setServerToday('2026-09-23')
    const stats = ytdStats(
      ts(
        ['2025-12-01', '2026-01-01', '2026-09-01', '2026-10-01'],
        [566912.72, 605273.99, 806667.88, 933250.9],
        { '2026-10-01': '2026-09-22' },
      ),
      yearly(),
      [],
      coverageOn('2026-09-23', earlySnapshot('2026-10-01', '2026-09-22')),
      '2026-09-23',
    )
    expect(stats.year).toBe(2026)
    expect(stats.netWorthState).toBe('delta')
    expect(stats.netWorthDelta).toBeCloseTo(327976.91, 2)
    expect(stats.netWorthPct).toBeCloseTo(0.541869, 5)
    expect(stats.netWorthWords).toBe('since Jan 1 (to Sep 22 · provisional)')
  })

  it('names a final current snapshot by its 1st', () => {
    const stats = ytdStats(
      ts(['2025-12-01', '2026-01-01', '2026-08-01'], [90, 100, 130]),
      yearly(),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.netWorthDelta).toBe(30)
    expect(stats.netWorthPct).toBe(0.3)
    expect(stats.netWorthWords).toBe('since Jan 1 (to Aug 1)')
  })

  it('without Jan 1 balances starts from the year’s first snapshot and says so', () => {
    const stats = ytdStats(ts(['2025-10-01', '2026-03-01', '2026-08-01'], [80, 100, 125]), yearly(), [], coverageOut(), TODAY)
    expect(stats.netWorthDelta).toBe(25)
    expect(stats.netWorthWords).toBe('since Mar 1 — no Jan 1 balances (to Aug 1)')
  })

  it('with no snapshot in the year says the Jan 1 balances are not recorded yet', () => {
    const stats = ytdStats(ts(['2025-11-01', '2025-12-01'], [90, 100]), yearly(), [], coverageOut(), TODAY)
    expect(stats.netWorthState).toBe('none')
    expect(stats.netWorthDelta).toBeNull()
    expect(stats.netWorthWords).toBe('Jan 1 balances not recorded yet')
    expect(ytdStats(ts([], []), yearly(), [], coverageOut(), TODAY).netWorthState).toBe('none')
  })

  it('counts an early Jan 1 snapshot typed in December toward the OLD year, to its day', () => {
    setServerToday('2026-12-29')
    const stats = ytdStats(
      ts(['2026-01-01', '2026-12-01', '2027-01-01'], [100, 140, 150], { '2027-01-01': '2026-12-28' }),
      yearly(),
      [],
      coverageOn('2026-12-29', earlySnapshot('2027-01-01', '2026-12-28')),
      '2026-12-29',
    )
    expect(stats.year).toBe(2026)
    expect(stats.netWorthDelta).toBe(50)
    expect(stats.netWorthWords).toBe('since Jan 1 (to Dec 28 · provisional)')
  })

  it('in January: nothing yet before the Jan 1 balances, "$0 so far" once they are the current ones', () => {
    setServerToday('2027-01-05')
    const before = ytdStats(ts(['2026-11-01', '2026-12-01'], [140, 150]), yearly(), [], coverageOut(), '2027-01-05')
    expect(before.netWorthState).toBe('none')
    expect(before.netWorthWords).toBe('Jan 1 balances not recorded yet')
    const after = ytdStats(
      ts(['2026-12-01', '2027-01-01'], [150, 160], { '2027-01-01': '2026-12-28' }),
      yearly(),
      [],
      coverageOn('2027-01-05', earlySnapshot('2027-01-01', '2026-12-28')),
      '2027-01-05',
    )
    expect(after.netWorthState).toBe('zero')
    expect(after.netWorthDelta).toBe(0)
    expect(after.netWorthPct).toBeNull()
    expect(after.netWorthWords).toBe('the change starts from your Jan 1 balances')
  })

  it('never measures to balances filed further ahead than next month', () => {
    const stats = ytdStats(
      ts(['2026-01-01', '2026-08-01', '2026-12-01'], [100, 130, 999]),
      yearly(),
      [],
      coverageOn(TODAY, snapshotStateOut('2026-08-01')),
      TODAY,
    )
    expect(stats.netWorthDelta).toBe(30)
    expect(stats.netWorthWords).toBe('since Jan 1 (to Aug 1)')
  })

  // Spec review M5: the current snapshot is the server's answer, never re-derived from the day.
  it('measures to wherever the server says the current snapshot is', () => {
    const stats = ytdStats(
      ts(['2026-01-01', '2026-07-01', '2026-08-01'], [100, 120, 130]),
      yearly(),
      [],
      coverageOn(TODAY, snapshotStateOut('2026-07-01')),
      TODAY,
    )
    expect(stats.netWorthDelta).toBe(20)
    expect(stats.netWorthWords).toBe('since Jan 1 (to Jul 1)')
    // The server says nothing is current: nothing to measure to.
    expect(
      ytdStats(ts(['2026-01-01', '2026-12-01'], [100, 999]), yearly(), [], coverageOn(TODAY, null), TODAY).netWorthState,
    ).toBe('none')
    // No answer at all (an older payload): the latest snapshot, as before the time model.
    expect(
      ytdStats(ts(['2026-01-01', '2026-08-01'], [100, 130]), yearly(), [], coverageOut(), TODAY).netWorthWords,
    ).toBe('since Jan 1 (to Aug 1)')
  })

  it('names a Jan 1 base that stayed provisional by its own day', () => {
    setServerToday('2027-03-05')
    const stats = ytdStats(
      ts(['2027-01-01', '2027-03-01'], [100, 110], { '2027-01-01': '2026-12-28' }),
      yearly(),
      [],
      coverageOut(),
      '2027-03-05',
    )
    expect(stats.netWorthWords).toBe('since Dec 28, 2026 (provisional) (to Mar 1)')
  })

  it('nulls the percent on a zero base rather than dividing by it', () => {
    const stats = ytdStats(ts(['2026-01-01', '2026-02-01'], [0, 50]), yearly(), [], coverageOut(), TODAY)
    expect(stats.netWorthDelta).toBe(50)
    expect(stats.netWorthPct).toBeNull()
  })
})

describe('ytdStats — the server rollup and the dividend log', () => {
  it('hands the current year rollup through verbatim — living spend, not the raw total', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2025), rollup(2026)]), [], coverageOut(), TODAY)
    expect(stats.spend).toBe('27000.00')
    expect(stats.netPay).toBe('90000.00')
    expect(stats.cashRate).toBe('0.644444')
  })

  it('answers nulls when the current year has no rollup row', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2025)]), [], coverageOut(), TODAY)
    expect(stats.spend).toBeNull()
    expect(stats.netPay).toBeNull()
    expect(stats.cashRate).toBeNull()
    expect(stats.totalRate).toBeNull()
  })

  it('sums only this year dividends, and tells an unused log from a quiet year', () => {
    const paid = [
      dividend('2026-03-15', '120.50', 1),
      dividend('2026-06-15', '80.25', 2),
      dividend('2025-12-15', '999.00', 3), // last year's — out
    ]
    expect(ytdStats(ts([], []), yearly(), paid, coverageOut(), TODAY).dividends).toBeCloseTo(200.75)
    // Rows exist but none this year: 0 is the honest answer…
    expect(ytdStats(ts([], []), yearly(), [dividend('2025-12-15', '999.00')], coverageOut(), TODAY).dividends).toBe(0)
    // …while an empty log has nothing to say at all.
    expect(ytdStats(ts([], []), yearly(), [], coverageOut(), TODAY).dividends).toBeNull()
  })
})

describe('ytdStats — every figure names its window (spec §3)', () => {
  it('names the spend, net-pay and saved windows from coverage, and the delta both ends', () => {
    const stats = ytdStats(
      ts(['2025-12-01', '2026-01-01', '2026-08-01'], [90, 100, 130]),
      yearly([rollup(2026)]),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.spendWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.netPayWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.savedWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    // The delta names BOTH its ends (2026-09-23 spec §T2): the Jan 1 balances and the day the
    // current ones describe.
    expect(stats.netWorthWords).toBe('since Jan 1 (to Aug 1)')
  })

  it('takes months_matched from the server, never from its own intersection', () => {
    // Six on the wire against seven overlapping months here: the server ran the arithmetic,
    // so its count is the one the card prints; coverage only names the edges.
    const stats = ytdStats(
      ts([], []),
      yearly([{ ...rollup(2026), months_matched: 6 }]),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.savedWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 6 })
  })

  it('reads living spend and both savings figures from the rollup', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2026)]), [], coverageOut(), TODAY)
    expect(stats.spend).toBe('27000.00') // living — NOT the 32000.00 that includes tax
    expect(stats.totalSaved).toBe('70000.00')
    expect(stats.cashSaved).toBe('58000.00')
    expect(stats.totalRate).toBe('0.686274')
    expect(stats.cashRate).toBe('0.644444')
  })

  it('falls back to the plain total on a backend older than the category kinds', () => {
    const bare = {
      year: 2026,
      by_category: [],
      total: '32000.00',
      net_pay_total: '90000.00',
      savings_rate: '0.644444',
    }
    const stats = ytdStats(ts([], []), yearly([bare]), [], coverageOut(), TODAY)
    expect(stats.spend).toBe('32000.00')
    expect(stats.cashRate).toBe('0.644444')
    expect(stats.totalRate).toBeNull()
    expect(stats.totalSaved).toBeNull()
    // The window still comes from coverage; the count falls back to the intersection.
    expect(stats.savedWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    // …and spend, being the pre-kinds `total`, is labelled with every ENTERED month.
    expect(stats.spendWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
  })

  it('has no savings figure at all in a year nothing matched', () => {
    const stats = ytdStats(
      ts([], []),
      yearly([
        // What the server actually sends with nothing matched (services/savings.py's
        // `rollup`): the matched sums are ZERO and the rates null — a non-zero
        // living_total beside months_matched: 0 is a payload that cannot exist.
        {
          ...rollup(2026),
          months_matched: 0,
          living_total: '0.00',
          tax_total: '0.00',
          transfer_total: '0.00',
          cash_savings: null,
          payroll_savings: '0.00',
          total_savings: null,
          savings_rate: null,
          total_savings_rate: null,
        },
      ]),
      [],
      coverageOut({ net_pay: [], latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: null } }),
      TODAY,
    )
    expect(stats.totalSaved).toBeNull()
    expect(stats.cashSaved).toBeNull()
    expect(stats.totalRate).toBeNull()
    expect(stats.cashRate).toBeNull()
    expect(stats.savedWindow).toBeNull()
    expect(stats.netPayWindow).toBeNull()
    // Nor does spend: the $0.00 the server sends is the sum over NO matched months, and a
    // window would tell the reader that figure covers Jan-Jul. It covers nothing.
    expect(stats.spend).toBeNull()
    expect(stats.spendWindow).toBeNull()
  })

  it('labels spend with the MATCHED window, not every month spending was entered for', () => {
    // August has spending but no paycheck, so the server left it out of `living_total`.
    // Naming Jan-Aug beside a Jan-Jul figure is the mislabel this pin exists to stop.
    const stats = ytdStats(
      ts([], []),
      yearly([rollup(2026)]),
      [],
      coverageOut({
        spending: [...JAN_TO_JUL, '2026-08-01'],
        spending_missing: [],
        latest: { balances: '2026-09-01', spending: '2026-08-01', net_pay: '2026-07-01' },
      }),
      TODAY,
    )
    expect(stats.spendWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    // Net pay keeps its OWN window: `net_pay_total` really is every month with a paycheck.
    expect(stats.netPayWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
  })
})

describe('windowWords', () => {
  it('shortens a same-year span and spells a crossing one', () => {
    expect(windowWords({ from: '2026-01-01', to: '2026-07-01', months: 7 })).toBe('Jan–Jul')
    expect(windowWords({ from: '2026-03-01', to: '2026-03-01', months: 1 })).toBe('Mar')
    expect(windowWords({ from: '2025-08-01', to: '2026-07-01', months: 12 })).toBe(
      'Aug 2025–Jul 2026',
    )
  })
})
