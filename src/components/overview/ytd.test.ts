import { describe, expect, it } from 'vitest'
import type { CoverageOut, DividendOut, SpendingYearly } from '../../types/api'
import { windowWords, ytdStats } from './ytd'

const TODAY = '2026-08-18'

function ts(months: string[], netWorth: number[]) {
  return { months, net_worth: netWorth.map((n) => n.toFixed(2)) }
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

function dividend(payDate: string, amount: string, id = 1): DividendOut {
  return {
    id, security_id: 1, account: null, pay_date: payDate, amount,
    source: 'manual', ex_date: null, per_share: null, shares_held: null, notes: null,
  }
}

describe('ytdStats — net worth delta', () => {
  it('anchors on the last snapshot before January and spans to the latest in-year one', () => {
    const stats = ytdStats(
      ts(['2025-11-01', '2025-12-01', '2026-01-01', '2026-08-01'], [90, 100, 110, 130]),
      yearly(),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.year).toBe(2026)
    expect(stats.netWorthDelta).toBe(30)
    expect(stats.netWorthPct).toBe(0.3)
    expect(stats.anchorMonth).toBe('2025-12-01')
  })

  it('spans a December gap honestly — the anchor is whatever came last before the year', () => {
    const stats = ytdStats(
      ts(['2025-10-01', '2026-03-01'], [100, 120]),
      yearly(),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.netWorthDelta).toBe(20)
    expect(stats.anchorMonth).toBe('2025-10-01') // named, so "since Oct 2025" reads true
  })

  it('falls back to the year first month when the series starts mid-year', () => {
    const stats = ytdStats(ts(['2026-02-01', '2026-08-01'], [100, 125]), yearly(), [], coverageOut(), TODAY)
    expect(stats.netWorthDelta).toBe(25)
    expect(stats.anchorMonth).toBe('2026-02-01')
  })

  it('answers null without two points to span', () => {
    // One in-year month and nothing before it: a delta would compare it to itself.
    expect(ytdStats(ts(['2026-08-01'], [100]), yearly(), [], coverageOut(), TODAY).netWorthDelta).toBeNull()
    // Data that ended LAST year: nothing in-year to measure to.
    expect(
      ytdStats(ts(['2025-11-01', '2025-12-01'], [90, 100]), yearly(), [], coverageOut(), TODAY).netWorthDelta,
    ).toBeNull()
    expect(ytdStats(ts([], []), yearly(), [], coverageOut(), TODAY).netWorthDelta).toBeNull()
  })

  it('nulls the percent on a zero anchor rather than dividing by it', () => {
    const stats = ytdStats(ts(['2025-12-01', '2026-01-01'], [0, 50]), yearly(), [], coverageOut(), TODAY)
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
      ts(['2025-12-01', '2026-09-01'], [100, 130]),
      yearly([rollup(2026)]),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.spendWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.netPayWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.savedWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.anchorMonth).toBe('2025-12-01')
    expect(stats.throughMonth).toBe('2026-09-01')
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
    expect(stats.spend).toBe('0.00')
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
