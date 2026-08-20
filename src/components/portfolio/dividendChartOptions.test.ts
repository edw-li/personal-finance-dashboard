import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE } from '../../charts/theme'
import type { DividendOut } from '../../types/api'
import {
  INCOME_WINDOW_MONTHS,
  incomeStats,
  monthlyIncomeOption,
} from './dividendChartOptions'

// Fixed "today" — never new Date() in a test (the injectable-todayIso house law).
const TODAY = '2026-08-20'

let nextId = 1

function dividend(payDate: string, amount: string, over: Partial<DividendOut> = {}): DividendOut {
  return {
    id: nextId++,
    security_id: 1,
    account: 'RH Taxable',
    pay_date: payDate,
    amount,
    source: 'auto',
    ex_date: payDate,
    per_share: '0.820000',
    shares_held: '10.000000',
    notes: null,
    ...over,
  }
}

// --- option readers (historyChartOptions.test.ts posture) ------------------------------
interface SeriesLike {
  type?: string
  name?: string
  color?: string
  data?: unknown[]
}

function seriesOf(option: EChartsOption): SeriesLike[] {
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

// The bar value on a given formatted month label.
function valueAt(option: EChartsOption, label: string): unknown {
  return seriesOf(option)[0].data?.[categoriesOf(option).indexOf(label)]
}

describe('monthlyIncomeOption', () => {
  it('sums same-month payments into one bar', () => {
    const option = monthlyIncomeOption(
      [dividend('2026-06-05', '8.20'), dividend('2026-06-19', '4.10')],
      TODAY,
    )
    expect(option).not.toBeNull()
    expect(valueAt(option!, 'Jun 2026')).toBe(12.3)
    const series = seriesOf(option!)
    expect(series).toHaveLength(1)
    expect(series[0].type).toBe('bar')
    expect(series[0].color).toBe(PALETTE[0]) // no new hue — slot 1 blue
  })

  it('zero-fills the quiet months between payments', () => {
    const option = monthlyIncomeOption(
      [dividend('2026-05-20', '10.00'), dividend('2026-07-20', '10.00')],
      TODAY,
    )
    // A quiet month reads as quiet (0), not as a gap in the axis.
    expect(valueAt(option!, 'Jun 2026')).toBe(0)
    expect(valueAt(option!, 'May 2026')).toBe(10)
    expect(valueAt(option!, 'Jul 2026')).toBe(10)
  })

  it('spans exactly the trailing window, ending on the current month', () => {
    const option = monthlyIncomeOption([dividend('2026-08-03', '5.00')], TODAY)
    const categories = categoriesOf(option!)
    expect(categories).toHaveLength(INCOME_WINDOW_MONTHS)
    expect(categories[0]).toBe('Sep 2024')
    expect(categories[categories.length - 1]).toBe('Aug 2026')
  })

  it('drops rows older than the window and rows past the current month', () => {
    // 25 months back (Jul 2024) is one month outside a 24-month window; the future row
    // is a manual entry dated ahead of today.
    const option = monthlyIncomeOption(
      [dividend('2024-07-15', '99.00'), dividend('2026-09-15', '77.00'), dividend('2026-08-03', '5.00')],
      TODAY,
    )
    expect(seriesOf(option!)[0].data).toEqual([...Array(23).fill(0), 5])
    expect(categoriesOf(option!)).not.toContain('Jul 2024')
    expect(categoriesOf(option!)).not.toContain('Sep 2026')
  })

  it('is null with no rows at all, and null when every row falls outside the window', () => {
    expect(monthlyIncomeOption([], TODAY)).toBeNull()
    expect(monthlyIncomeOption([dividend('2023-01-15', '99.00')], TODAY)).toBeNull()
  })
})

describe('incomeStats', () => {
  it('counts the 12 months through the current one and excludes the month before them', () => {
    const stats = incomeStats(
      [
        dividend('2026-08-03', '1.00'), // the current month is in
        dividend('2025-09-30', '2.00'), // oldest month of the 12 (11 back) — in
        dividend('2025-08-31', '4.00'), // one month older — out
      ],
      TODAY,
    )
    expect(stats.trailing12).toBe(3)
  })

  it('sums the calendar year for YTD, ignoring last year', () => {
    const stats = incomeStats(
      [dividend('2026-01-02', '10.50'), dividend('2026-08-03', '1.25'), dividend('2025-12-31', '99.00')],
      TODAY,
    )
    expect(stats.ytd).toBe(11.75)
  })

  it('distinguishes an empty log (null) from a log with nothing in the windows (0)', () => {
    expect(incomeStats([], TODAY)).toEqual({ trailing12: null, ytd: null })
    // Rows exist, just none recent: 0 is a fact, a dash would be a shrug.
    expect(incomeStats([dividend('2019-03-15', '42.00')], TODAY)).toEqual({
      trailing12: 0,
      ytd: 0,
    })
  })
})
