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
import { formatCurrency, formatCurrencyCompact, formatPct } from '../../utils/format'

// The six jurisdictions in the order the engine reports them — one order shared by the
// waterfall's steps, the trend's stack and both legends.
export const TAX_LABELS = [
  'Federal',
  'State',
  'Medicare',
  'Soc. Sec.',
  'SDI',
  'Cap. gains',
] as const

// Six ordered slots of ONE hue family: six identity hues would break the ≤3-hue law, so
// the sequential ramp is the compliant form (AllocationPanel's convention). The ramp
// encodes POSITION in the fixed order above — not magnitude — which is why the two charts
// can share it: a waterfall step and a stack segment for the same tax wear one color.
// Slots start at index 4: below it the ramp drops under the theme's 3:1-on-#171a21 promise
// (index 1 is 1.8:1), and the lightest slots go to the smallest taxes, whose slivers are
// the ones that need the contrast.
export const TAX_COLORS = [
  SEQUENTIAL_BLUE[4],
  SEQUENTIAL_BLUE[5],
  SEQUENTIAL_BLUE[7],
  SEQUENTIAL_BLUE[8],
  SEQUENTIAL_BLUE[10],
  SEQUENTIAL_BLUE[11],
] as const

export const WATERFALL_CATEGORIES = ['Gross', ...TAX_LABELS, 'Take-home'] as const

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

// The six tax figures of one year, in TAX_LABELS order.
function taxAmounts(summary: TaxSummaryOut): number[] {
  return [
    Number(summary.federal.tax),
    Number(summary.state.tax),
    Number(summary.medicare.tax),
    Number(summary.social_security.tax),
    Number(summary.disability.tax),
    Number(summary.capital_gains.tax),
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
  let remainder = gross
  taxes.forEach((tax, i) => {
    const after = roundTo(remainder - tax, 2)
    steps.push({
      label: TAX_LABELS[i],
      amount: tax,
      // State tax can come out NEGATIVE (exemption credits exceed the walk), which steps
      // the remainder back UP: the segment then spans [before, after] instead. Taking the
      // lower end as the floor and |amount| as the height draws it correctly either way,
      // and reduces to "floor = the remainder after" for every non-negative tax.
      base: Math.min(remainder, after),
      height: Math.abs(roundTo(tax, 2)),
      color: TAX_COLORS[i],
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
      // Eight steps: every one of them is labelled or the walk cannot be read.
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
 * Multi-year composition: one stacked bar per year of the six tax figures, with the
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
        const lines = list.map((p) => {
          const value = p.value as number | null
          const text =
            value === null || value === undefined
              ? '—'
              : p.seriesName === RATE_SERIES_NAME
                ? formatPct(value / 100, { signed: false })
                : formatCurrency(value)
          return `${p.marker ?? ''}${p.seriesName ?? ''}: ${text}`
        })
        return [head, ...lines].join('<br/>')
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
      ...TAX_LABELS.map((label, i) => ({
        name: label,
        type: 'bar' as const,
        stack: 'tax',
        barMaxWidth: 46,
        color: TAX_COLORS[i],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK } },
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
