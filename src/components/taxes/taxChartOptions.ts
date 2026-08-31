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
  INK,
  MUTED,
  OTHER_SERIES_COLOR,
  POSITIVE,
  SEQUENTIAL_BLUE,
  SURFACE,
} from '../../charts/theme'
import type { TaxSummaryOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatCurrency, formatCurrencyCompact, formatPct } from '../../utils/format'
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
// Slots start at index 4: below it the ramp drops under the theme's 3:1-on-#171a21 promise
// (index 1 is 1.8:1), and the lightest slots go to the smallest taxes, whose slivers are
// the ones that need the contrast.
export const TAX_COLORS = [
  SEQUENTIAL_BLUE[4],
  SEQUENTIAL_BLUE[5],
  SEQUENTIAL_BLUE[6],
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

const RATE_SERIES_NAME = 'Effective rate'

// Display-only rounding. The subtraction chain a waterfall needs is float arithmetic
// (237973.17 − 40782.88 − 15884.46 = 181305.83000000002), and a running remainder is
// chart GEOMETRY rather than a reported figure — money lands back on cents here so no
// dust can reach an axis label or a tooltip. A 6dp rate ×100 lands on 4dp for the
// same reason.
function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

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

interface WaterfallStep {
  label: string
  /** The signed figure this step reports — what the tooltip and the bar label say. */
  amount: number
  /** Floor of the floating segment (the invisible placeholder bar). */
  base: number
  /** Height of the visible segment: |amount|, so a negative tax still draws. */
  height: number
  color: string
  /** What is left after this step; null on the two full-height totals bars. */
  remaining: number | null
}

/**
 * Classic invisible-placeholder waterfall: Gross and Take-home stand on the floor, and
 * each tax floats on the remainder LEFT after it is taken, so the eye walks the money
 * down from gross income to what actually arrives.
 *
 * Returns null for a year with nothing in it (a freshly created year whose inputs are all
 * missing computes to zeros) — the caller renders an empty note, the house pattern for a
 * builder with nothing to draw (SpendingPage's `barsOption` guard).
 */
export function waterfallOption(summary: TaxSummaryOut): EChartsOption | null {
  const gross = Number(summary.totals.gross_income)
  const takeHome = Number(summary.totals.take_home)
  const taxes = taxAmounts(summary)
  if (gross === 0 && takeHome === 0 && taxes.every((tax) => tax === 0)) return null

  const steps: WaterfallStep[] = [
    { label: 'Gross', amount: gross, base: 0, height: gross, color: OTHER_SERIES_COLOR, remaining: null },
  ]
  const taxSteps = taxes
    .map((tax, i) => ({ label: TAX_LABELS[i], tax, color: TAX_COLORS[i] }))
    // NIIT is the one ADDITIVE line (2026-08-31): a year it does not touch keeps its
    // eight familiar bars instead of gaining a $0 step. The six sheet jurisdictions
    // always draw, zero or not — their absence would read as missing data.
    .filter((step) => step.label !== 'NIIT' || step.tax !== 0)
  let remainder = gross
  taxSteps.forEach(({ label, tax, color }) => {
    const after = roundTo(remainder - tax, 2)
    steps.push({
      label,
      amount: tax,
      // State tax can come out NEGATIVE (exemption credits exceed the walk), which steps
      // the remainder back UP: the segment then spans [before, after] instead. Taking the
      // lower end as the floor and |amount| as the height draws it correctly either way,
      // and reduces to "floor = the remainder after" for every non-negative tax.
      base: Math.min(remainder, after),
      height: Math.abs(roundTo(tax, 2)),
      color,
      remaining: after,
    })
    remainder = after
  })
  // The closing bar is the SERVER's take-home, not the chain's last remainder: the engine
  // owns that number (global rule 9), and the chain landing on it is the invariant.
  steps.push({
    label: 'Take-home', amount: takeHome, base: 0, height: takeHome, color: POSITIVE,
    remaining: null,
  })

  return {
    grid: { left: 72, right: 24, top: 36, bottom: 28 },
    tooltip: {
      // Item trigger, not axis: an axis tooltip would announce the invisible placeholder
      // beside the real bar. Every string below is this file's own constant or a formatted
      // server number — no user text reaches the HTML (SpendingPage's escapeHtml rule has
      // nothing to escape here).
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        const step = steps[p.dataIndex ?? 0]
        if (!step) return ''
        const head = `${step.label}<br/><strong>${formatCurrency(step.amount)}</strong>`
        return step.remaining === null
          ? head
          : `${head}<br/>Left: ${formatCurrency(step.remaining)}`
      },
    },
    xAxis: {
      type: 'category',
      data: steps.map((s) => s.label),
      // Eight or nine steps: every one of them is labelled or the walk cannot be read.
      axisLabel: { interval: 0 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
      {
        name: 'placeholder',
        type: 'bar',
        stack: 'waterfall',
        // 'all', not echarts' default 'samesign': samesign un-floats a segment whose base has
        // gone negative (total_tax > gross, a mid-data-entry year), flattening the walk.
        stackStrategy: 'all',
        // Silent + transparent: it exists only to lift the visible segment off the floor.
        silent: true,
        itemStyle: { color: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent' } },
        tooltip: { show: false },
        data: steps.map((s) => s.base),
      },
      {
        name: 'Amount',
        type: 'bar',
        stack: 'waterfall',
        stackStrategy: 'all', // both halves of one stack must agree — see the placeholder's note.
        barMaxWidth: 46,
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK } },
        // Direct labels: a waterfall is read step by step, and hover-only numbers make
        // that a hunt (and say nothing on a touch screen).
        label: {
          show: true,
          position: 'top',
          color: MUTED,
          fontSize: 11,
          formatter: (p: { dataIndex: number }) =>
            formatCurrencyCompact(steps[p.dataIndex]?.amount ?? 0),
        },
        data: steps.map((s) => ({ value: s.height, itemStyle: { color: s.color } })),
      },
    ],
  }
}

/**
 * Multi-year composition: one stacked bar per year of the tax figures, with the
 * overall effective rate as a line on a secondary percent axis (the rate is a ratio, so it
 * cannot share the money axis). Returns null when the feed carries no years at all — the
 * caller renders an empty note.
 */
export function trendOption(years: TaxSummaryOut[]): EChartsOption | null {
  if (years.length === 0) return null
  // The feed is already ordered, but the chart owns its own x-axis order rather than
  // trusting it (TaxesPage's `latestOf` reasoning).
  const ordered = [...years].sort((a, b) => a.year - b.year)
  const amounts = ordered.map(taxAmounts)
  const rates = ordered.map((y) =>
    y.totals.effective_rate === null ? null : roundTo(Number(y.totals.effective_rate) * 100, 4),
  )
  const niitIndex = TAX_LABELS.indexOf('NIIT')
  // NIIT stacks only when some year carries it: an all-zero series would add a legend
  // entry and a $0.00 tooltip row to every pre-NIIT year. One nonzero year brings the
  // series for EVERY year — a stack that comes and goes across one chart would lie.
  const stacked = amounts.some((a) => a[niitIndex] !== 0)
    ? [...TAX_LABELS]
    : TAX_LABELS.slice(0, niitIndex)

  return {
    grid: { left: 70, right: 56, top: 40, bottom: 28 },
    legend: { top: 0 },
    tooltip: {
      trigger: 'axis',
      // Two units in one tooltip, so `valueFormatter` (one formatter for every series)
      // cannot do it: money for the stacks, percent for the rate line. All own constants
      // and server numbers — nothing user-typed reaches this HTML.
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params]
        const head = `<strong>${list[0]?.name ?? ''}</strong>`
        const line = (p: (typeof list)[number]) => {
          const value = p.value as number | null
          const text =
            value === null || value === undefined
              ? '—'
              : p.seriesName === RATE_SERIES_NAME
                ? formatPct(value / 100, { signed: false })
                : formatCurrency(value)
          return `${p.marker ?? ''}${p.seriesName ?? ''}: ${text}`
        }
        // The stacks, then the year's total (vestingChartOptions' Total row,
        // jurisdiction-flavoured — 2026-08-25 spec §2b), then the rate line: the rate is
        // a ratio, not another addend, so it stays out of the sum and under it.
        const taxRows = list.filter((p) => p.seriesName !== RATE_SERIES_NAME)
        const rateRows = list.filter((p) => p.seriesName === RATE_SERIES_NAME)
        const total = taxRows.reduce(
          (sum, p) => sum + (typeof p.value === 'number' ? p.value : 0),
          0,
        )
        return [
          head,
          ...taxRows.map(line),
          ...(taxRows.length > 0
            ? [`<strong>Total tax: ${formatCurrency(total)}</strong>`]
            : []),
          ...rateRows.map(line),
        ].join('<br/>')
      },
    },
    xAxis: { type: 'category', data: ordered.map((y) => String(y.year)) },
    yAxis: [
      {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      {
        type: 'value',
        // Anchored at zero like the money axis beside it: auto-scaling a 27%→32% run to
        // fill the frame would draw a cliff next to bars that are honest about their
        // baseline, and the two axes' zeros would sit at different heights.
        min: 0,
        // The rate axis rides in PERCENT units (a 6dp fraction ×100), so its own labels
        // divide back out before handing the value to formatPct.
        axisLabel: {
          formatter: (value: number) => formatPct(value / 100, { signed: false, decimals: 0 }),
        },
        splitLine: { show: false },
      },
    ],
    series: [
      ...stacked.map((label, i) => ({
        id: TAX_SERIES_IDS[i],
        name: label,
        type: 'bar' as const,
        stack: 'tax',
        barMaxWidth: 46,
        color: TAX_COLORS[i],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK } },
        universalTransition: true,
        data: amounts.map((a) => a[i]),
      })),
      {
        name: RATE_SERIES_NAME,
        type: 'line' as const,
        yAxisIndex: 1,
        color: INK,
        symbolSize: 6,
        lineStyle: { width: 2 },
        z: 10,
        // A year with no gross income has no rate: the line stops rather than diving to 0.
        connectNulls: false,
        data: rates,
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
 * divergence). Returns null when nothing is drawable — the caller renders an empty note.
 */
export function yearPieOption(summary: TaxSummaryOut): EChartsOption | null {
  const slices = taxAmounts(summary)
    .map((value, i) => ({ name: TAX_LABELS[i], value, color: TAX_COLORS[i] }))
    .filter((s) => s.value > 0)
  if (slices.length === 0) return null
  return {
    tooltip: {
      // Item trigger (pies have no axis). "of tax" because this percent shares the YEAR'S
      // TOTAL TAX — bare, a Federal slice's "56.1%" reads as a rate on income, which the
      // trend's own rate line says is ~30%. Every string is this file's constant or a
      // formatted server number — no user text reaches the HTML.
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        return (
          `<strong>${formatCurrency(p.value as number)}</strong> · ` +
          `${(p.percent ?? 0).toFixed(1)}% of tax<br/>${p.name ?? ''}`
        )
      },
    },
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
        data: slices.map((s) => ({
          name: s.name,
          value: s.value,
          itemStyle: { color: s.color },
        })),
      },
    ],
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
 * Returns null when no lane is drawable — the caller renders its empty note.
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

  return {
    grid: { left: 70, right: 24, top: 12, bottom: 28 },
    tooltip: {
      // Item trigger: an axis tooltip would announce every segment of the lane at once.
      // Own constants and formatted numbers only — no user text reaches this HTML.
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        const cell = cells[p.dataIndex ?? 0]?.[p.seriesIndex ?? 0]
        if (!cell) return ''
        const lane = drawable[p.dataIndex ?? 0]
        const range =
          cell.ceiling === null
            ? `${formatCurrency(cell.floor)} and up`
            : `${formatCurrency(cell.floor)} – ${formatCurrency(cell.ceiling)}`
        return `${lane.label} — <strong>${formatPct(cell.rate, { signed: false })}</strong> bracket<br/>${range}`
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    // inverse, so the first lane (Federal) reads on TOP the way the sentence orders them.
    yAxis: { type: 'category', data: drawable.map((row) => row.label), inverse: true },
    series: [
      ...Array.from({ length: maxSegments }, (_, i) => ({
        name: `Bracket ${i + 1}`,
        type: 'bar' as const,
        stack: 'ladder',
        barMaxWidth: 26,
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK } },
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
        tooltip: {
          formatter: (params) => {
            const p = Array.isArray(params) ? params[0] : params
            const lane = drawable[p.dataIndex ?? 0]
            return lane === undefined
              ? ''
              : `${lane.label} taxable income<br/><strong>${formatCurrency(lane.taxableIncome)}</strong>`
          },
        },
      },
    ],
  }
}
