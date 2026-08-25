// Pure option builders + tile stats for the overview page — no React, no fetching, no theme
// decisions of their own (taxChartOptions.ts's posture).
//
// Number() at this boundary is deliberate and display-only: the server is pure-Decimal and
// already quantized every figure to cents, so the charts parse the strings ONCE here and
// never hand a float back to the API (src/utils/format.ts's rule). spendStats deliberately
// does NOT: its `total` stays the server's own string so the tile renders it verbatim, and
// only the comparison average — a presentation figure that never leaves the page — is a
// number.
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE, SURFACE } from '../../charts/theme'
import type { NetWorthTimeseries, SpendingMatrix, TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'

// Axis-free trend (Sparkline.tsx's sanctioned form, but echarts — the page already ships
// the runtime for the performance lines/bars): tooltip stays, axes hide.
export function netWorthSparkOption(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
): EChartsOption | null {
  if (ts.months.length < 2) return null
  return {
    grid: { left: 8, right: 8, top: 10, bottom: 8 },
    xAxis: { type: 'category', data: ts.months.map(formatMonth), show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: {
      trigger: 'axis',
      // No axis pointer: with both axes hidden there is nothing for a vertical rule to
      // anchor to, so it reads as noise crossing a bare line (the axis-free form's price).
      axisPointer: { type: 'none' },
      valueFormatter: (v) => formatCurrency(v as number),
    },
    series: [
      {
        type: 'line',
        name: 'Net worth',
        symbol: 'none',
        lineStyle: { width: 1.5 },
        // Axis-free shape emphasis, not an area encoding: with no labeled baseline on screen
        // there is no zero for the fill to misrepresent, and a faint wash under the line is
        // the common finance-sparkline idiom. Deliberate departure from Sparkline.tsx's
        // `fill: none` (that SVG spark sits inline in a table row; this one owns a card).
        areaStyle: { opacity: 0.22 },
        color: PALETTE[0],
        data: ts.net_worth.map(Number),
      },
    ],
  }
}

/** The bars' trailing-window length — named so OverviewPage's click handler can map a
 * dataIndex back through the same slice (2026-08-25 spec §2d). */
export const RECENT_SPEND_MONTHS = 12

export function recentSpendOption(
  matrix: Pick<SpendingMatrix, 'months' | 'totals'>,
  months = RECENT_SPEND_MONTHS,
): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const start = Math.max(0, matrix.months.length - months)
  return {
    grid: { left: 70, right: 16, top: 24, bottom: 28 },
    xAxis: { type: 'category', data: matrix.months.slice(start).map(formatMonth) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) } },
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatCurrency(v as number) },
    series: [
      {
        type: 'bar',
        name: 'Spend',
        barMaxWidth: 22,
        color: PALETTE[1],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        data: matrix.totals.slice(start).map(Number),
      },
    ],
  }
}

export interface SpendStats {
  month: string | null // ISO first-of-month of the tile month (latest month with data)
  total: string | null // that month's server-computed total, verbatim
  avg12: number | null // mean of up to 12 totals STRICTLY BEFORE the tile month
  aboveAvg: boolean | null
}

// Presentation stats over server totals (SpendingPage's categoryTotals class) — the tile
// month is the LATEST month present (hand-entered app: the current calendar month is
// absent until the wizard runs; the tile label carries the month so it reads honestly).
export function spendStats(matrix: Pick<SpendingMatrix, 'months' | 'totals'>): SpendStats {
  if (matrix.months.length === 0) return { month: null, total: null, avg12: null, aboveAvg: null }
  const idx = matrix.months.length - 1
  // RATIFIED (Task 8 review): a cashflow-only month — net pay entered, spending not — comes
  // back as an explicit "0.00" and counts here at FULL WEIGHT. The server cannot distinguish
  // absent from genuinely zero, and filtering zeros would bias the average UP for households
  // that really do have zero-spend months; the wizard also enters spending and net pay
  // together, so persistent gaps are unlikely. The cashflowOnly guard on OverviewPage
  // handles the DISPLAY case only (it suppresses the tile's delta, not this mean). A
  // server-side absent/zero distinction is the real fix if it ever matters.
  const prior = matrix.totals.slice(Math.max(0, idx - 12), idx).map(Number)
  const avg12 = prior.length > 0 ? prior.reduce((a, b) => a + b, 0) / prior.length : null
  const total = matrix.totals[idx]
  return {
    month: matrix.months[idx],
    total,
    avg12,
    aboveAvg: avg12 === null ? null : Number(total) > avg12,
  }
}

// Current calendar year if it has a summary, else the latest PAST year (label carries
// the year either way); server orders years ascending (taxes.py).
export function pickTaxSummary(years: TaxSummaryOut[], currentYear: number): TaxSummaryOut | null {
  if (years.length === 0) return null
  const current = years.find((y) => y.year === currentYear)
  if (current) return current
  const past = years.filter((y) => y.year < currentYear)
  return past.length > 0 ? past[past.length - 1] : years[years.length - 1]
}
