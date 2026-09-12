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
import { BAR_MARKS, LINE, WASH, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { referenceLine } from '../../charts/reference'
import { OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { CoverageOut, NetWorthTimeseries, SpendingMatrix, TaxSummaryOut } from '../../types/api'
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
const SPEND_SERIES = 'Spend'
type SpendingDisplay = Pick<SpendingMatrix, 'months' | 'totals'> & Partial<Pick<SpendingMatrix, 'living_total' | 'comparison_average' | 'default_month' | 'review_state' | 'eligible_spending'>>

/** Nothing to exclude — one shared empty set, so the default costs no allocation. */
const NO_MONTHS: ReadonlySet<string> = new Set<string>()

// Border only, no fill: the ESPP anatomy's "hollow means this is not what it looks like"
// idiom (esppChartOptions.ts), here for a month nobody has entered.
const HOLLOW_BAR = { color: 'transparent', borderColor: PALETTE[1], borderWidth: 1.5 } as const

/** The months whose total is an ABSENCE rather than a figure (audit item 14).
 *
 *  The matrix months are a UNION of spending rows and net-pay rows, so a month with a
 *  paycheck and no spending — or with rows that are all $0.00 — arrives as an explicit
 *  "0.00" that the bars and the average would otherwise read as a real zero-spend month.
 *  Two sources, because neither alone sees every case:
 *
 *    /coverage's `spending_empty` (rows saved, all zero, no take-home) and
 *    `spending_missing` (nothing at all inside the balances window) — the server's own
 *    classification (services/coverage.py), authoritative and already on this page.
 *
 *    The matrix's own net-pay column, for the month whose take-home IS on file: the
 *    service calls that `net_pay_without_spending` but `GET /coverage` does not publish
 *    it, and coverage counts such a month as ENTERED on its take-home row alone. A
 *    take-home row plus a zero total is exactly that month, from data already in hand.
 *
 *  A $0.00 month with neither a take-home row nor a coverage list naming it stays a
 *  figure: a household that really spent nothing is not corrected here. */
export function notEnteredMonths(
  matrix: Pick<SpendingMatrix, 'months' | 'totals' | 'net_pay' | 'review_state' | 'eligible_spending'>,
  coverage: Pick<CoverageOut, 'spending_empty' | 'spending_missing'>,
): Set<string> {
  const months = new Set<string>([
    ...(coverage.spending_empty ?? []),
    ...(coverage.spending_missing ?? []),
  ])
  matrix.months.forEach((month, i) => {
    if (matrix.eligible_spending?.[i] === true || matrix.review_state?.[i] === 'closed') {
      months.delete(month)
      return
    }
    if (matrix.review_state !== undefined) return
    if (matrix.net_pay[i] != null && Number(matrix.totals[i]) === 0) months.add(month)
  })
  return months
}

export function recentSpendOption(
  matrix: SpendingDisplay,
  months = RECENT_SPEND_MONTHS,
  notEntered: ReadonlySet<string> = NO_MONTHS,
): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const start = Math.max(0, matrix.months.length - months)
  const shown = matrix.months.slice(start)
  const totals = (matrix.living_total ?? matrix.totals).slice(start).map(Number)
  // Drawn hollow and labelled in the tooltip rather than dropped: the month happened, and
  // an axis that skipped it would hide the gap this is meant to make visible.
  const blank = new Set(shown.flatMap((month, i) => (notEntered.has(month) ? [i] : [])))
  // A not-entered month's total IS 0.00, so its hollow bar is a baseline tick and the only
  // place a CUE can live is the label. The month's name recedes to the "Other" neutral —
  // dimmer than the axis's own muted in both palettes, and a token, so recolor.ts maps it.
  // Per-datum objects rather than an `axisLabel.color` CALLBACK: recolor.ts walks plain
  // objects but passes functions through by identity (its header rule), so a callback
  // would bake dark-theme hexes into the light theme.
  const axis = monthAxis(shown.map(formatMonth), { gap: true })
  const labels = axis.data.map((label, i) =>
    blank.has(i) ? { value: label, textStyle: { color: OTHER_SERIES_COLOR } } : label,
  )
  // F14: the reference is spendStats' OWN avg12 — the mean of the twelve months STRICTLY
  // BEFORE the latest one — not the mean of the drawn window. The spend tile prints that
  // number under the same words ("over/under $X 12-mo avg"), and the label on this line
  // says the same thing; a window mean (which includes the latest month, so the bar being
  // judged drags its own baseline) would put two different numbers behind one name.
  // Taken from spendStats rather than recomputed so they cannot drift apart, and NOT
  // re-rounded through cents(): the tile formats this exact float.
  const mean = spendStats(matrix, notEntered).avg12
  // A single-month book has nothing before the latest to average: no line, no legend entry
  // for a comparison that does not exist yet (the tile suppresses its delta for the same
  // reason).
  const average = mean === null ? [] : [referenceLine(AVERAGE_SERIES, totals.map(() => mean))]
  return {
    grid: grid(),
    legend: legendFor(1 + average.length),
    xAxis: { ...axis, data: labels },
    yAxis: moneyAxis(),
    tooltip: axisTooltip({
      unit: 'money',
      references: [AVERAGE_SERIES],
      pointer: 'shadow',
      // The figure stays (it is what the server sent); the suffix is what makes it honest.
      rowSuffix: (param) =>
        param.seriesName === SPEND_SERIES &&
        typeof param.dataIndex === 'number' &&
        blank.has(param.dataIndex)
          ? '(not entered)'
          : null,
    }),
    series: [
      {
        type: 'bar',
        name: SPEND_SERIES,
        ...BAR_MARKS,
        color: PALETTE[1],
        data: totals.map((value, i) => (blank.has(i) ? { value, itemStyle: HOLLOW_BAR } : value)),
      },
      ...average,
    ],
  }
}

/** The shown months as a table (F12) — the same trailing window the bars draw. */
export function recentSpendCsv(
  matrix: SpendingDisplay,
  months = RECENT_SPEND_MONTHS,
): ExportTable {
  const start = Math.max(0, matrix.months.length - months)
  return { headers: ['Month', matrix.living_total ? 'Living spending (USD)' : 'Spend', ...(matrix.review_state ? ['Review status'] : [])], rows: matrix.months.slice(start).map((m, i) => [m, (matrix.living_total ?? matrix.totals)[start + i], ...(matrix.review_state ? [matrix.review_state[start + i]] : [])]) }
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
export function spendStats(
  matrix: SpendingDisplay,
  notEntered: ReadonlySet<string> = NO_MONTHS,
): SpendStats {
  if (matrix.months.length === 0) return { month: null, total: null, avg12: null, aboveAvg: null }
  if (matrix.default_month !== undefined || matrix.comparison_average !== undefined) {
    const index = matrix.default_month !== undefined ? matrix.months.indexOf(matrix.default_month ?? '') : matrix.months.length - 1
    if (index < 0) return { month: null, total: null, avg12: null, aboveAvg: null }
    const total = matrix.living_total?.[index] ?? null
    const rawAverage = matrix.comparison_average?.[index]
    const avg12 = rawAverage == null ? null : Number(rawAverage)
    return { month: matrix.months[index], total, avg12, aboveAvg: total === null || avg12 === null ? null : Number(total) > avg12 }
  }
  const idx = matrix.months.length - 1
  // The twelve months before the tile month, MINUS the ones nobody entered (audit item
  // 14). The window is still twelve CALENDAR months — the not-entered ones drop out of
  // the mean rather than pulling an older month in, so the label keeps meaning what it
  // says. The earlier ratified rule counted them at full weight because the server could
  // not tell an absence from a real zero; /coverage can (notEnteredMonths above), and a
  // month the household never typed must not congratulate it for spending nothing.
  const from = Math.max(0, idx - 12)
  const prior = matrix.totals
    .slice(from, idx)
    .filter((_, i) => !notEntered.has(matrix.months[from + i]))
    .map(Number)
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
