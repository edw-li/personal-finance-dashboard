import { describe, expect, it } from 'vitest'
import type { DividendOut, SpendingYearly } from '../../types/api'
import { ytdStats } from './ytd'

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
      TODAY,
    )
    expect(stats.netWorthDelta).toBe(20)
    expect(stats.anchorMonth).toBe('2025-10-01') // named, so "since Oct 2025" reads true
  })

  it('falls back to the year first month when the series starts mid-year', () => {
    const stats = ytdStats(ts(['2026-02-01', '2026-08-01'], [100, 125]), yearly(), [], TODAY)
    expect(stats.netWorthDelta).toBe(25)
    expect(stats.anchorMonth).toBe('2026-02-01')
  })

  it('answers null without two points to span', () => {
    // One in-year month and nothing before it: a delta would compare it to itself.
    expect(ytdStats(ts(['2026-08-01'], [100]), yearly(), [], TODAY).netWorthDelta).toBeNull()
    // Data that ended LAST year: nothing in-year to measure to.
    expect(
      ytdStats(ts(['2025-11-01', '2025-12-01'], [90, 100]), yearly(), [], TODAY).netWorthDelta,
    ).toBeNull()
    expect(ytdStats(ts([], []), yearly(), [], TODAY).netWorthDelta).toBeNull()
  })

  it('nulls the percent on a zero anchor rather than dividing by it', () => {
    const stats = ytdStats(ts(['2025-12-01', '2026-01-01'], [0, 50]), yearly(), [], TODAY)
    expect(stats.netWorthDelta).toBe(50)
    expect(stats.netWorthPct).toBeNull()
  })
})

describe('ytdStats — the server rollup and the dividend log', () => {
  it('hands the current year rollup through verbatim', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2025), rollup(2026)]), [], TODAY)
    expect(stats.spend).toBe('32000.00')
    expect(stats.netPay).toBe('90000.00')
    expect(stats.savingsRate).toBe('0.644444')
  })

  it('answers nulls when the current year has no rollup row', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2025)]), [], TODAY)
    expect(stats.spend).toBeNull()
    expect(stats.netPay).toBeNull()
    expect(stats.savingsRate).toBeNull()
  })

  it('sums only this year dividends, and tells an unused log from a quiet year', () => {
    const paid = [
      dividend('2026-03-15', '120.50', 1),
      dividend('2026-06-15', '80.25', 2),
      dividend('2025-12-15', '999.00', 3), // last year's — out
    ]
    expect(ytdStats(ts([], []), yearly(), paid, TODAY).dividends).toBeCloseTo(200.75)
    // Rows exist but none this year: 0 is the honest answer…
    expect(ytdStats(ts([], []), yearly(), [dividend('2025-12-15', '999.00')], TODAY).dividends).toBe(0)
    // …while an empty log has nothing to say at all.
    expect(ytdStats(ts([], []), yearly(), [], TODAY).dividends).toBeNull()
  })
})
