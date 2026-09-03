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
import { BAR_MARKS, LINE, WASH, cents, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { referenceLine } from '../../charts/reference'
import { PALETTE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { NetWorthTimeseries, SpendingMatrix, TaxSummaryOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatMonth } from '../../utils/format'

// A full trend chart, dressed exactly like its two card siblings below it. It began life
// as an axis-free "spark" (Sparkline.tsx's license), but at 220px in a full-width card
// between two fully-dressed charts the hidden axes and disabled pointer read as BREAKAGE
// (2026-08-25 user report; audit I-9): the sparkline license is for a 30px table-row
// strip, not a card that owns the page's first fold.
export function netWorthTrendOption(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
): EChartsOption | null {
  if (ts.months.length < 2) return null
  return {
    grid: grid('noLegend'),
    xAxis: monthAxis(ts.months.map(formatMonth)),
    // A washed area over a VISIBLE axis needs the honest zero baseline — no scale:true.
    yAxis: moneyAxis(),
    // Default axis pointer kept: a line chart ships its crosshair by default (dataviz law).
    tooltip: axisTooltip({ unit: 'money' }),
    series: [{ ...LINE, name: 'Net worth', ...WASH, color: PALETTE[0], data: ts.net_worth.map(Number) }],
  }
}

/** The trend as a table (F12): the server's own month strings and figures, verbatim. */
export function netWorthTrendCsv(ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>): ExportTable {
  return { headers: ['Month', 'Net worth'], rows: ts.months.map((m, i) => [m, ts.net_worth[i]]) }
}

/** The bars' trailing-window length — named so OverviewPage's click handler can map a
 * dataIndex back through the same slice (2026-08-25 spec §2d). */
export const RECENT_SPEND_MONTHS = 12

const AVERAGE_SERIES = '12-mo average'

export function recentSpendOption(
  matrix: Pick<SpendingMatrix, 'months' | 'totals'>,
  months = RECENT_SPEND_MONTHS,
): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const start = Math.max(0, matrix.months.length - months)
  const totals = matrix.totals.slice(start).map(Number)
  // F14: the window's own mean as a reference — the same window the bars show, so the line
  // and the bars answer one question ("is this month over my recent average?").
  const mean = cents(totals.reduce((sum, t) => sum + t, 0) / totals.length)
  return {
    grid: grid(),
    legend: legendFor(2),
    xAxis: monthAxis(matrix.months.slice(start).map(formatMonth), { gap: true }),
    yAxis: moneyAxis(),
    tooltip: axisTooltip({ unit: 'money', references: [AVERAGE_SERIES], pointer: 'shadow' }),
    series: [
      { type: 'bar', name: 'Spend', ...BAR_MARKS, color: PALETTE[1], data: totals },
      referenceLine(AVERAGE_SERIES, totals.map(() => mean)),
    ],
  }
}

/** The shown months as a table (F12) — the same trailing window the bars draw. */
export function recentSpendCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'totals'>,
  months = RECENT_SPEND_MONTHS,
): ExportTable {
  const start = Math.max(0, matrix.months.length - months)
  return { headers: ['Month', 'Spend'], rows: matrix.months.slice(start).map((m, i) => [m, matrix.totals[start + i]]) }
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
