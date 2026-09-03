// Pure option builders for the taxes summary panel — no React, no fetching, no theme
// decisions of their own. Reduced motion and the dark theme are the EChart wrapper's job
// (it forces `animation: false` after the spread), so everything here is data.
//
// Number() at this boundary is deliberate and display-only: the engine is pure-Decimal and
// the server already quantized every figure to cents, so the charts parse the strings ONCE
// here and never hand a float back to the API (src/utils/format.ts's rule, and the same
// posture as src/utils/spending.ts).
import type { EChartsOption } from '../../charts/echarts'
import {
  BAR_MARKS,
  capLabel,
  grid,
  moneyAxis,
  monthAxis,
  roundTo,
  stagger,
} from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import {
  INK,
  OTHER_SERIES_COLOR,
  POSITIVE,
  SEQUENTIAL_BLUE,
  SURFACE,
} from '../../charts/theme'
import { axisTooltip, itemTooltip } from '../../charts/tooltip'
import {
  waterfallCsv as stepsCsv,
  waterfallSeries,
  waterfallSteps,
  waterfallTooltip,
} from '../../charts/waterfall'
import type { TaxSummaryOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatCurrency, formatPct } from '../../utils/format'
import type { LadderSegment } from './marginal'

// The seven tax lines in the order the engine reports them — one order shared by the
// waterfall's steps, the trend's stack and both legends. NIIT is LAST on purpose: it is
// the one additive line, so the builders can include it conditionally by slicing.
export const TAX_LABELS = [
  'Federal',
  'State',
  'Medicare',
  'Soc. Sec.',
  'SDI',
  'Cap. gains',
  'NIIT',
] as const

// Seven ordered slots of ONE hue family: seven identity hues would break the ≤3-hue law, so
// the sequential ramp is the compliant form (AllocationPanel's convention). The ramp
// encodes POSITION in the fixed order above — not magnitude — which is why the two charts
// can share it: a waterfall step and a stack segment for the same tax wear one color.
// Slots start at index 4 (below it the ramp drops under 3:1 on the surface, and the lightest
// slots go to the smallest taxes, whose slivers need the contrast) and SKIP index 6: that
// step is also PALETTE[0], and charts/recolor.ts elects the categorical blue for a lone hex
// — so under the light theme the middle tax would have jumped out of the ramp.
export const TAX_COLORS = [
  SEQUENTIAL_BLUE[4],
  SEQUENTIAL_BLUE[5],
  SEQUENTIAL_BLUE[7],
  SEQUENTIAL_BLUE[8],
  SEQUENTIAL_BLUE[9],
  SEQUENTIAL_BLUE[10],
  SEQUENTIAL_BLUE[11],
] as const

// full vocabulary — the builder skips the NIIT step when the year has none
export const WATERFALL_CATEGORIES = ['Gross', ...TAX_LABELS, 'Take-home'] as const

// Stable ids shared by the trend's seven stacks and the drill-in pie: universalTransition
// keys on id across notMerge setOption calls, so the year's segments morph into slices
// and back out (SpendingPage's `cat-${id}` idiom). Index in TAX_LABELS is the identity.
export const TAX_SERIES_IDS = TAX_LABELS.map((_, i) => `tax-${i}`)

// The seven tax figures of one year, in TAX_LABELS order.
function taxAmounts(summary: TaxSummaryOut): number[] {
  return [
    Number(summary.federal.tax),
    Number(summary.state.tax),
    Number(summary.medicare.tax),
    Number(summary.social_security.tax),
    Number(summary.disability.tax),
    Number(summary.capital_gains.tax),
    // Optional on the wire (fixtures and stored payloads predate the line): absent is 0.
    Number(summary.niit?.tax ?? 0),
  ]
}

/** The year's walk as steps — shared by the option and its CSV so the two cannot disagree. */
function taxWaterfallSteps(summary: TaxSummaryOut) {
  const gross = Number(summary.totals.gross_income)
  const takeHome = Number(summary.totals.take_home)
  const taxes = taxAmounts(summary)
  if (gross === 0 && takeHome === 0 && taxes.every((tax) => tax === 0)) return null
  return waterfallSteps(
    { label: 'Gross', amount: gross, color: OTHER_SERIES_COLOR },
    taxes
      .map((tax, i) => ({ label: TAX_LABELS[i], amount: tax, delta: -tax, color: TAX_COLORS[i] }))
      // NIIT is the one ADDITIVE line (2026-08-31): a year it does not touch keeps its eight
      // familiar bars instead of gaining a $0 step. The six sheet jurisdictions always draw,
      // zero or not — their absence would read as missing data.
      .filter((step) => step.label !== 'NIIT' || step.amount !== 0),
    // The closing bar is the SERVER's take-home, not the chain's last remainder: the engine
    // owns that number (global rule 9), and the chain landing on it is the invariant.
    { label: 'Take-home', amount: takeHome, color: POSITIVE },
  )
}

/**
 * Classic invisible-placeholder waterfall (charts/waterfall.ts): Gross and Take-home stand on
 * the floor, each tax floats on the remainder LEFT after it, so the eye walks the money down
 * from gross income to what actually arrives. Null for a year with nothing in it (a freshly
 * created year whose inputs are all missing computes to zeros) — the card renders its empty
 * sentence.
 */
export function waterfallOption(summary: TaxSummaryOut): EChartsOption | null {
  const steps = taxWaterfallSteps(summary)
  if (steps === null) return null
  return {
    grid: grid(),
    tooltip: waterfallTooltip(steps),
    // Eight or nine steps: every one labelled or the walk cannot be read (≤ 12 → interval 0).
    xAxis: monthAxis(
      steps.map((s) => s.label),
      { gap: true },
    ),
    yAxis: moneyAxis(),
    series: waterfallSeries(steps),
  }
}

/** The walk as a table (F12): step, the signed figure it reports, what is left after it. */
export function waterfallCsv(summary: TaxSummaryOut): ExportTable {
  const steps = taxWaterfallSteps(summary)
  return steps === null ? { headers: ['Step', 'Amount', 'Remaining'], rows: [] } : stepsCsv(steps)
}

/**
 * Multi-year composition: one stacked bar per year of the tax figures with the year's
 * effective rate as a direct label on the stack's cap (F15 — one axis; a ratio does not
 * share a money axis and does not deserve a second one). Returns null when the feed carries
 * no years at all — the card renders its empty sentence.
 */
export function trendOption(
  years: TaxSummaryOut[],
  { selected }: { selected?: Record<string, boolean> } = {},
): EChartsOption | null {
  if (years.length === 0) return null
  // The feed is already ordered, but the chart owns its own x-axis order rather than
  // trusting it (TaxesPage's `latestOf` reasoning).
  const ordered = [...years].sort((a, b) => a.year - b.year)
  const amounts = ordered.map(taxAmounts)
  // Percent units at 4dp (0.306020 × 100 is 30.602000000000004 unrounded).
  const rates = ordered.map((y) =>
    y.totals.effective_rate === null ? null : roundTo(Number(y.totals.effective_rate) * 100, 4),
  )
  const rateText = (index: number): string => {
    const rate = rates[index]
    return rate === null || rate === undefined ? '' : formatPct(rate / 100, { signed: false })
  }
  const niitIndex = TAX_LABELS.indexOf('NIIT')
  // NIIT stacks only when some year carries it: an all-zero series would add a legend
  // entry and a $0.00 tooltip row to every pre-NIIT year. One nonzero year brings the
  // series for EVERY year — a stack that comes and goes across one chart would lie.
  const stacked = amounts.some((a) => a[niitIndex] !== 0)
    ? [...TAX_LABELS]
    : TAX_LABELS.slice(0, niitIndex)

  return {
    grid: grid(),
    // `data` pinned to the jurisdictions: the rate's carrier series below is not a
    // jurisdiction and must never appear as an entry the user can switch off.
    legend: { ...legendFor(stacked.length, selected), data: stacked },
    tooltip: axisTooltip({
      unit: 'money',
      groups: stacked,
      totalLabel: 'Total tax',
      pointer: 'shadow',
      // The rate is a ratio, not another addend: it stays out of the sum and under it.
      footer: (index) => (rateText(index) === '' ? [] : [`Effective rate ${rateText(index)}`]),
    }),
    xAxis: monthAxis(
      ordered.map((y) => String(y.year)),
      { gap: true },
    ),
    yAxis: moneyAxis(),
    series: [
      ...stacked.map((label, i) => ({
        id: TAX_SERIES_IDS[i],
        name: label,
        type: 'bar' as const,
        stack: 'tax',
        ...BAR_MARKS,
        barMaxWidth: 24,
        ...stagger(i),
        color: TAX_COLORS[i],
        universalTransition: true,
        data: amounts.map((a) => a[i]),
      })),
      // The rate's carrier: a zero-height, transparent, silent member of the SAME stack, so
      // its cap label sits on the year's total without belonging to any jurisdiction.
      // Riding the top jurisdiction instead would have taken every year's rate off the
      // chart the moment that one was hidden from the legend — and the pick persists (F9).
      {
        name: 'Effective rate',
        type: 'bar' as const,
        stack: 'tax',
        silent: true,
        tooltip: { show: false },
        itemStyle: { color: 'transparent' },
        barMaxWidth: 24,
        data: amounts.map(() => 0),
        label: capLabel((p) => rateText(p.dataIndex)),
      },
    ],
  }
}

/**
 * One year's tax burden as a donut of the tax lines — the trend chart's drill-in
 * (SpendingPage's month pie, jurisdiction-flavoured). A pie can only draw positive slices,
 * so zero and negative figures (a credit-driven negative state tax) are EXCLUDED here
 * while the stacked bar nets them into the year's column; the totals line beside the
 * chart stays the server's, which includes them (buildMonthSlices' documented
 * divergence). Returns null when nothing is drawable — the card renders its empty sentence.
 */
export function yearPieOption(summary: TaxSummaryOut): EChartsOption | null {
  const slices = taxAmounts(summary)
    .map((value, i) => ({ name: TAX_LABELS[i], value, color: TAX_COLORS[i] }))
    .filter((s) => s.value > 0)
  if (slices.length === 0) return null
  return {
    // "of tax": the percent shares the YEAR'S TOTAL TAX — bare, a Federal "56.1%" reads as
    // a rate on income, which the cap label above the trend says is ~30%.
    tooltip: itemTooltip<{ name?: string; value?: unknown; percent?: number }>({
      body: (p) => ({
        value: Number(p.value),
        label: p.name ?? '',
        sub: `${(p.percent ?? 0).toFixed(1)}% of tax`,
      }),
    }),
    series: [
      {
        id: 'tax-year-pie',
        type: 'pie' as const,
        radius: ['42%', '70%'],
        itemStyle: { borderColor: SURFACE, borderWidth: 2 },
        label: { color: INK, formatter: '{b}  {d}%' },
        emphasis: { itemStyle: { borderColor: INK } },
        // Morph the year's stack segments into slices and back out on exit; falls back
        // to a plain swap under reduced motion (EChart forces animation off).
        universalTransition: { enabled: true, seriesKey: [...TAX_SERIES_IDS] },
        data: slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })),
      },
    ],
  }
}

/** The drilled year as a table (F12): the positive slices the pie draws. */
export function yearPieCsv(summary: TaxSummaryOut): ExportTable {
  return {
    headers: ['Jurisdiction', 'Tax'],
    rows: taxAmounts(summary)
      .map((value, i) => ({ name: TAX_LABELS[i], value }))
      .filter((s) => s.value > 0)
      .map((s) => [s.name, s.value.toFixed(2)]),
  }
}

/** The trend chart as a table (2026-08-25 spec §2a): year rows × TAX_LABELS order plus
 * the server's own total_tax, ascending like the chart's axis, verbatim strings. */
export function taxTrendCsv(years: TaxSummaryOut[]): ExportTable {
  const ordered = [...years].sort((a, b) => a.year - b.year)
  return {
    headers: ['Year', ...TAX_LABELS, 'Total tax'],
    rows: ordered.map((y) => [
      y.year, y.federal.tax, y.state.tax, y.medicare.tax, y.social_security.tax,
      y.disability.tax, y.capital_gains.tax,
      // absent (pre-NIIT payload) exports as zero — a blank would misalign the fixed
      // header row
      y.niit?.tax ?? '0.00',
      y.totals.total_tax,
    ]),
  }
}

// --- D3: the marginal-rate ladder (design 2026-08-31 §D3) ------------------------------

export interface LadderRow {
  label: string
  segments: LadderSegment[]
  /** Number(summary.<jurisdiction>.taxable_income) — the ◆ marker's x position. */
  taxableIncome: number
}

// Three slots of the ONE hue family (the ≤3-hue law): adjacent segments alternate the two
// mid tones so their seam reads at a glance, and the bracket the income sits in takes the
// bright slot. All three sit at/above SEQUENTIAL_BLUE[4], the ramp's documented 3:1 floor.
const LADDER_BASE_A = SEQUENTIAL_BLUE[5]
const LADDER_BASE_B = SEQUENTIAL_BLUE[7]
const LADDER_CURRENT = SEQUENTIAL_BLUE[10]

/** Drawn ceiling of a lane's unbounded top bracket: 15% past the larger of the income and
 *  the top floor — headroom enough to read "and up" without dwarfing the lower spans. */
function ladderCap(row: LadderRow): number {
  const top = row.segments[row.segments.length - 1]
  return roundTo(Math.max(row.taxableIncome, top.floor) * 1.15, 2)
}

/**
 * Horizontal bracket ladder: one category lane per jurisdiction, one stacked-bar series
 * per bracket slot (a lane with fewer brackets holds null in the extra slots), and a
 * scatter diamond marking each lane's own taxable income — the two lanes have DIFFERENT
 * taxable incomes (state deductions differ), which is why a single markLine cannot do it.
 * Returns null when no lane is drawable — the card renders its empty sentence.
 */
export function marginalLadderOption(rows: LadderRow[]): EChartsOption | null {
  const drawable = rows.filter((row) => row.segments.length > 0 && ladderCap(row) > 0)
  if (drawable.length === 0) return null

  interface Cell {
    span: number
    color: string
    rate: number
    floor: number
    ceiling: number | null
  }
  // cells[laneIndex][slotIndex] — the tooltip reads the same table the series are built of.
  const cells: Cell[][] = drawable.map((row) => {
    const cap = ladderCap(row)
    return row.segments.map((segment, i) => ({
      span: roundTo((segment.ceiling ?? cap) - segment.floor, 2),
      color: segment.current ? LADDER_CURRENT : i % 2 === 0 ? LADDER_BASE_A : LADDER_BASE_B,
      rate: segment.rate,
      floor: segment.floor,
      ceiling: segment.ceiling,
    }))
  })
  const maxSegments = Math.max(...cells.map((lane) => lane.length))
  const range = (cell: Cell) =>
    cell.ceiling === null
      ? `${formatCurrency(cell.floor)} and up`
      : `${formatCurrency(cell.floor)} – ${formatCurrency(cell.ceiling)}`

  return {
    grid: grid('noLegend'),
    // Item trigger: an axis tooltip would announce every segment of the lane at once. Rate
    // first — it is the answer the ladder exists to give.
    tooltip: itemTooltip<{ dataIndex?: number; seriesIndex?: number }>({
      body: (p) => {
        const cell = cells[p.dataIndex ?? -1]?.[p.seriesIndex ?? -1]
        const lane = drawable[p.dataIndex ?? -1]
        if (cell === undefined || lane === undefined) return null
        return {
          value: formatPct(cell.rate, { signed: false }),
          label: `${lane.label} bracket`,
          sub: range(cell),
        }
      },
    }),
    xAxis: moneyAxis(),
    // inverse, so the first lane (Federal) reads on TOP the way the sentence orders them.
    yAxis: { type: 'category', data: drawable.map((row) => row.label), inverse: true },
    series: [
      ...Array.from({ length: maxSegments }, (_, i) => ({
        name: `Bracket ${i + 1}`,
        type: 'bar' as const,
        stack: 'ladder',
        ...BAR_MARKS,
        barMaxWidth: 24,
        ...stagger(i),
        data: cells.map((lane) =>
          lane[i] === undefined
            ? null
            : { value: lane[i].span, itemStyle: { color: lane[i].color } },
        ),
      })),
      {
        name: 'Taxable income',
        type: 'scatter' as const,
        symbol: 'diamond',
        symbolSize: 11,
        itemStyle: { color: INK },
        z: 10,
        data: drawable.map((row) => [row.taxableIncome, row.label]),
        tooltip: itemTooltip<{ dataIndex?: number }>({
          body: (p) => {
            const lane = drawable[p.dataIndex ?? -1]
            return lane === undefined
              ? null
              : { value: lane.taxableIncome, label: `${lane.label} taxable income` }
          },
        }),
      },
    ],
  }
}

/** The ladder as a table (F12): every bracket of every lane, rate as the stored fraction. */
export function ladderCsv(rows: LadderRow[]): ExportTable {
  return {
    headers: ['Jurisdiction', 'Bracket', 'Rate', 'From', 'To'],
    rows: rows.flatMap((row) =>
      row.segments.map((segment, i) => [
        row.label,
        i + 1,
        String(segment.rate),
        segment.floor.toFixed(2),
        segment.ceiling === null ? '' : segment.ceiling.toFixed(2),
      ]),
    ),
  }
}
