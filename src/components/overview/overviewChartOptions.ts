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
import {
  BAR_MARKS,
  LINE,
  WASH,
  grid,
  moneyAxis,
  monthAxis,
  partialItemStyle,
} from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { drawnPartial, partlyEnteredMonths, periodColumnFor, periodNote } from '../../charts/partlyEntered'
import { referenceLine } from '../../charts/reference'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { CoverageOut, FlowsPartOut, NetWorthTimeseries, SpendingMatrix, TaxSummaryOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatMonth } from '../../utils/format'
import { provisionalNote } from '../../utils/asOf'

// A full trend chart, dressed exactly like its two card siblings below it. It began life
// as an axis-free "spark" (Sparkline.tsx's license), but at 220px in a full-width card
// between two fully-dressed charts the hidden axes and disabled pointer read as BREAKAGE
// (2026-08-25 user report; audit I-9): the sparkline license is for a 30px table-row
// strip, not a card that owns the page's first fold.
export function netWorthTrendOption(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'> &
    Partial<Pick<NetWorthTimeseries, 'recorded_on' | 'provisional'>>,
): EChartsOption | null {
  if (ts.months.length < 2) return null
  // A provisional snapshot — balances typed before their 1st (2026-09-23 spec §T1) — is a point
  // that will move once they are saved again: the partial look (always the faded form: a hatch
  // says nothing on an 8px dot) and a tooltip head that says why. Absent lists: all final.
  const provisional = ts.provisional ?? []
  return {
    grid: grid('noLegend'),
    xAxis: monthAxis(ts.months.map(formatMonth)),
    // A washed area over a VISIBLE axis needs the honest zero baseline — no scale:true.
    yAxis: moneyAxis(),
    // Default axis pointer kept: a line chart ships its crosshair by default (dataviz law).
    tooltip: axisTooltip({
      unit: 'money',
      headNote: (i) => (provisional[i] ? provisionalNote(ts.months[i], ts.recorded_on?.[i]) : null),
    }),
    series: [
      {
        ...LINE,
        name: 'Net worth',
        ...WASH,
        color: PALETTE[0],
        // The provisional point is this line's one symbol: echarts' default ('auto') culls per-point
        // symbols once the month axis thins its labels (about 51 points on the 1280 card) — never
        // this one (code review I1).
        ...(provisional.some(Boolean) ? { showAllSymbol: true } : {}),
        data: ts.net_worth.map((value, i) =>
          provisional[i]
            ? { value: Number(value), symbol: 'circle', symbolSize: 8, itemStyle: partialItemStyle(PALETTE[0], false) }
            : Number(value),
        ),
      },
    ],
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

// Total spending is an aggregate, not an entity (2026-09-23 spec §C2): it wears the structural
// neutral that no category and no income entity uses. PALETTE[1], which it wore before, is Food
// & Dining's and RSU's colour on this same page.
const TOTAL_SPEND = MUTED

// Border only, no fill: the ESPP anatomy's "hollow means this is not what it looks like"
// idiom (esppChartOptions.ts), here for a month nobody has entered.
const HOLLOW_BAR = { color: 'transparent', borderColor: TOTAL_SPEND, borderWidth: 1.5 } as const

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
 *  figure: a household that really spent nothing is not corrected here.
 *
 *  An ended month whose spending `time.flows_due` lists as MISSING is one too (2026-09-23 spec
 *  §T12), whether or not its window has turned overdue yet: until it is entered it stays hollow,
 *  never a real $0 month. */
export function notEnteredMonths(
  matrix: Pick<SpendingMatrix, 'months' | 'totals' | 'net_pay' | 'review_state' | 'eligible_spending'>,
  coverage: Pick<CoverageOut, 'spending_empty' | 'spending_missing' | 'time'>,
): Set<string> {
  const months = new Set<string>([
    ...(coverage.spending_empty ?? []),
    ...(coverage.spending_missing ?? []),
    ...(coverage.time?.flows_due ?? []).filter((flows) => flows.spending === 'missing').map((flows) => flows.month),
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

export interface RecentSpendOptions {
  /** The product's today (utils/months todayIso): a month whose last day is after it is in
   *  progress and drawn as such (2026-09-23 spec §C5). Absent, no month is. */
  todayIso?: string | null
  /** Appearance › Chart patterns (useChartDecals): the month in progress is hatched, not faded. */
  patterns?: boolean
  /** `GET /coverage` `time.flows_due` (2026-09-23 spec §T12): a month listed with spending
   *  PARTIAL — saved while it was running — keeps the partial look after it has ended. */
  flowsDue?: readonly FlowsPartOut[] | null
}

export function recentSpendOption(
  matrix: SpendingDisplay,
  months = RECENT_SPEND_MONTHS,
  notEntered: ReadonlySet<string> = NO_MONTHS,
  { todayIso = null, patterns = false, flowsDue = null }: RecentSpendOptions = {},
): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const start = Math.max(0, matrix.months.length - months)
  const shown = matrix.months.slice(start)
  const totals = (matrix.living_total ?? matrix.totals).slice(start).map(Number)
  // Drawn hollow and labelled in the tooltip rather than dropped: the month happened, and
  // an axis that skipped it would hide the gap this is meant to make visible.
  const blank = new Set(shown.flatMap((month, i) => (notEntered.has(month) ? [i] : [])))
  // 2026-09-23 spec §C5: the month still under way (the grammar's objective rule — its last
  // day is after today) is a figure that will grow, so its bar says so: faded or hatched, a
  // dashed outline, a marked label and a tooltip head that names it — and so is a month whose
  // spending is only partly entered, after it has ended (§T12: September's rent alone on Oct
  // 3 is not a $2K month). A month that is also not entered stays hollow (its bar is a baseline
  // tick either way); the label and the head still carry the mark.
  const partly = partlyEnteredMonths(flowsDue)
  const drawn = drawnPartial(shown, todayIso, partly)
  const partial = new Set(shown.flatMap((_, i) => (drawn[i] ? [i] : [])))
  // A not-entered month's total IS 0.00, so its hollow bar is a baseline tick and the only
  // place a CUE can live is the label. The month's name recedes to the "Other" neutral —
  // dimmer than the axis's own muted in both palettes, and a token, so recolor.ts maps it.
  // Per-datum objects rather than an `axisLabel.color` CALLBACK: recolor.ts walks plain
  // objects but passes functions through by identity (its header rule), so a callback
  // would bake dark-theme hexes into the light theme.
  const axis = monthAxis(shown.map(formatMonth), {
    gap: true,
    marked: new Set([...partial].map((i) => formatMonth(shown[i]))),
  })
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
  // The reference grammar's dashes, drawn in INK rather than its muted grey: the bars wear the
  // neutral grey (TOTAL_SPEND), and a grey line would share their legend key and vanish where
  // it crosses a bar (the 2026-09-23 review's decision). The fixtures declare the dash.
  const average = mean === null ? [] : [{ ...referenceLine(AVERAGE_SERIES, totals.map(() => mean)), color: INK }]
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
      headNote: (i) => (partial.has(i) ? periodNote(shown[i], todayIso, partly) : null),
    }),
    series: [
      {
        type: 'bar',
        name: SPEND_SERIES,
        ...BAR_MARKS,
        color: TOTAL_SPEND,
        data: totals.map((value, i) =>
          blank.has(i)
            ? { value, itemStyle: HOLLOW_BAR }
            : partial.has(i)
              ? { value, itemStyle: partialItemStyle(TOTAL_SPEND, patterns) }
              : value,
        ),
      },
      ...average,
    ],
  }
}

/** The shown months as a table (F12) — the same trailing window the bars draw. With a today,
 *  a month in progress among them adds a trailing Period column that names it (the 2026-09-23
 *  code review, 13: the bars' '*' in words, for the table twin and the CSV) — and so does a
 *  partly entered one (§T12). */
export function recentSpendCsv(
  matrix: SpendingDisplay,
  months = RECENT_SPEND_MONTHS,
  { todayIso = null, flowsDue = null }: Pick<RecentSpendOptions, 'todayIso' | 'flowsDue'> = {},
): ExportTable {
  const start = Math.max(0, matrix.months.length - months)
  const shown = matrix.months.slice(start)
  const period = periodColumnFor(shown, todayIso, partlyEnteredMonths(flowsDue))
  return {
    headers: ['Month', matrix.living_total ? 'Living spending (USD)' : 'Spend', ...(matrix.review_state ? ['Review status'] : []), ...(period ? ['Period'] : [])],
    rows: shown.map((m, i) => [m, (matrix.living_total ?? matrix.totals)[start + i], ...(matrix.review_state ? [matrix.review_state[start + i]] : []), ...(period ? [period[i]] : [])]),
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
