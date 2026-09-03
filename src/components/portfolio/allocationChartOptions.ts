// Lifted VERBATIM out of AllocationPanel.tsx (taxChartOptions.ts precedent): pure option
// builders belong in a module the tests can call directly, and the Overview page needs the
// donut too — a second copy would be two things to keep in step.
import type { EChartsOption } from '../../charts/echarts'
import { DIVERGING, INK, MUTED, OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE, SURFACE } from '../../charts/theme'
import { itemTooltip } from '../../charts/tooltip'
import type { AllocationResponse, HoldingOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatCurrencyCompact, formatPct } from '../../utils/format'

export const TYPE_LABELS: Record<string, string> = {
  etf: 'ETF', mutual_fund: 'Mutual fund', stock: 'Stock', private: 'Private',
}

// Treemap encodes MAGNITUDE on the shared sequential ramp — an all-pairs form must not
// hand out identity hues at this cardinality (frozen dataviz rule, Plan 3 note).
// Oversold (negative-MV) slices cannot render in area-encoded forms — filter them out;
// the holdings table still shows the row with its warning (Task 4 review M5).
export function positiveSlices(data: AllocationResponse) {
  return data.slices.filter((s) => Number(s.market_value) > 0)
}

export function treemapOption(data: AllocationResponse): EChartsOption {
  const slices = positiveSlices(data)
  const max = Math.max(...slices.map((s) => Number(s.market_value)), 1)
  // Share base = the DRAWN total (donutOption's posture): oversold slices are filtered
  // out above, and a percentage must describe the areas actually on screen.
  const total = slices.reduce((sum, s) => sum + Number(s.market_value), 0)
  const share = (value: number) => formatPct(total > 0 ? value / total : 0, { signed: false })
  return {
    tooltip: {
      formatter: (params) => {
        // `TopLevelFormatterParams` is `CallbackDataParams | CallbackDataParams[]`;
        // item-trigger only ever passes the single form (SpendingPage's idiom).
        const p = Array.isArray(params) ? params[0] : params
        // The treemap's implicit ROOT node answers hovers on the gaps between cells,
        // carrying an EMPTY name and the whole book's value — ": $773.2K" is not a
        // slice, so it gets no tooltip at all.
        if (!p.name) return ''
        const value = Number(p.value)
        return `<strong>${formatCurrency(value)}</strong> · ${share(value)}<br/>${escapeHtml(p.name)}`
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        // Direct labels — name, compact value, share — truncated to the cell: hover-only
        // numbers make the map a hunt (the waterfall's rule). Canvas TEXT, not tooltip
        // HTML, so industry names need no escaping here.
        label: {
          show: true,
          fontSize: 11,
          overflow: 'truncate' as const,
          formatter: (p: { name?: string; value?: unknown }) =>
            `${p.name ?? ''}\n${formatCurrencyCompact(p.value as number)} · ${share(Number(p.value))}`,
        },
        itemStyle: { borderColor: SURFACE, borderWidth: 2, gapWidth: 2 },
        data: slices.map((s) => {
          const idx = 3 + Math.round((Number(s.market_value) / max) * 8)
          return {
            name: s.key,
            value: Number(s.market_value),
            // Light ramp end needs a dark label: #fff on SEQUENTIAL_BLUE[11] is 1.32:1,
            // violating the theme's >=3:1 promise. SURFACE clears 3:1 from idx 6 up;
            // INK covers the dark half (Task 14 review I1).
            label: { color: idx >= 6 ? SURFACE : INK },
            itemStyle: { color: SEQUENTIAL_BLUE[idx] },
          }
        }),
      },
    ],
  }
}

// Donut: top-3 slices wear palette slots 1-3, the rest fold into a gray Other
// (all-pairs ≤3 hued selections — frozen rule).
export function donutOption(data: AllocationResponse, labels: boolean): EChartsOption {
  const named = positiveSlices(data).map((s) => ({
    name: labels ? (TYPE_LABELS[s.key] ?? s.key) : s.key,
    value: Number(s.market_value),
  }))
  const top = named.slice(0, 3)
  const rest = named.slice(3)
  const seriesData = [
    ...top.map((s, i) => ({ ...s, itemStyle: { color: PALETTE[i] } })),
    ...(rest.length > 0
      ? [
          {
            name: 'Other',
            value: rest.reduce((sum, s) => sum + s.value, 0),
            itemStyle: { color: OTHER_SERIES_COLOR },
          },
        ]
      : []),
  ]
  const total = named.reduce((sum, s) => sum + s.value, 0)
  return {
    // F7: value first, then the (escaped) slice name, then its share of the drawn ring.
    tooltip: itemTooltip<{ name?: string; value?: unknown }>({
      body: (p) => ({
        value: Number(p.value),
        label: p.name ?? '',
        sub: `${formatPct(total > 0 ? Number(p.value) / total : 0, { signed: false })} of holdings`,
      }),
    }),
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['55%', '78%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { show: false },
        data: seriesData,
      },
    ],
  }
}

// --- the heat-treemap (chart spec F5) --------------------------------------------------
// Industry → ticker: AREA is market value (the one thing a treemap encodes honestly) and
// FILL is a signed performance figure on the diverging ramp — two channels, two questions,
// one map. The old flat `treemapOption` above stays exported until C7 retires it.

export type HeatMetric = 'unrealized' | 'day'
export const HEAT_METRICS: { value: HeatMetric; label: string }[] = [
  { value: 'unrealized', label: 'Unrealized' },
  { value: 'day', label: 'Day change' },
]
/** Fills saturate at ±50%: a 300% winner and a 60% one read the same, the tooltip tells them apart. */
export const HEAT_CLAMP = 0.5
/** Under half a percent of the book a cell has no room for a label — it folds into Other. */
export const SLIVER_SHARE = 0.005

interface HeatLeaf {
  name: string
  /** [market value, clamped metric] — levels[1]'s visualDimension 1 drives the fill. */
  value: [number, number]
  /** null on a folded Other cell (nothing to drill into). */
  ticker: string | null
  /** The TRUE metric, unclamped, for the tooltip. */
  pct: number
  industry: string
  label: { color: string }
}
interface HeatGroup {
  name: string
  value: [number, number]
  children: HeatLeaf[]
}

const clamp = (v: number) => Math.max(-HEAT_CLAMP, Math.min(HEAT_CLAMP, v))
const metricOf = (h: HoldingOut, metric: HeatMetric) =>
  Number((metric === 'unrealized' ? h.unrealized_gl_pct : h.day_change_pct) ?? 0)
const industryOf = (h: HoldingOut) => h.industry ?? TYPE_LABELS[h.holding_type] ?? h.holding_type
// Saturated arms are light on dark (and dark on light), so they take the SURFACE ink; the
// neutral middle takes INK. recolor.ts swaps both tokens under the light theme.
const inkFor = (pct: number) => (Math.abs(pct) >= 0.3 ? SURFACE : INK)

function heatGroups(
  holdings: HoldingOut[],
  metric: HeatMetric,
): { groups: HeatGroup[]; total: number } {
  const priced = holdings.filter((h) => h.market_value !== null && Number(h.market_value) > 0)
  const total = priced.reduce((sum, h) => sum + Number(h.market_value), 0)
  const byIndustry = new Map<string, HoldingOut[]>()
  for (const h of priced) {
    const key = industryOf(h)
    byIndustry.set(key, [...(byIndustry.get(key) ?? []), h])
  }
  const groups: HeatGroup[] = [...byIndustry.entries()].map(([industry, rows]) => {
    const sorted = [...rows].sort((a, b) => Number(b.market_value) - Number(a.market_value))
    const big = sorted.filter((h) => Number(h.market_value) / total >= SLIVER_SHARE)
    const slivers = sorted.filter((h) => Number(h.market_value) / total < SLIVER_SHARE)
    const leaf = (name: string, ticker: string | null, mv: number, pct: number): HeatLeaf => ({
      name,
      ticker,
      pct,
      industry,
      value: [mv, clamp(pct)],
      label: { color: inkFor(clamp(pct)) },
    })
    const children = big.map((h) =>
      leaf(h.ticker, h.ticker, Number(h.market_value), metricOf(h, metric)),
    )
    if (slivers.length > 0) {
      const mv = slivers.reduce((s, h) => s + Number(h.market_value), 0)
      // Value-weighted, not a mean: a $4k sliver and a $1k one do not move the fold equally.
      const pct =
        slivers.reduce((s, h) => s + metricOf(h, metric) * Number(h.market_value), 0) / mv
      children.push(leaf('Other', null, mv, pct))
    }
    const groupMv = children.reduce((s, c) => s + c.value[0], 0)
    return { name: industry, value: [groupMv, 0], children }
  })
  groups.sort((a, b) => b.value[0] - a.value[0])
  return { groups, total }
}

/** F5: the heat-treemap. Null with no priced holding. */
export function heatTreemapOption(
  holdings: HoldingOut[],
  metric: HeatMetric,
): EChartsOption | null {
  const { groups, total } = heatGroups(holdings, metric)
  if (groups.length === 0) return null
  const share = (mv: number) => formatPct(total > 0 ? mv / total : 0, { signed: false })
  const word = metric === 'unrealized' ? 'unrealized' : 'today'
  return {
    tooltip: itemTooltip<{ name?: string; value?: unknown; data?: HeatLeaf | HeatGroup }>({
      body: (p) => {
        // The implicit root answers hovers on the gaps between cells with an empty name.
        if (!p.name || p.data === undefined) return null
        const mv = (p.value as [number, number])[0]
        if ('children' in p.data) {
          return { value: mv, label: p.data.name, sub: `${share(mv)} of holdings` }
        }
        return {
          value: mv,
          label: p.data.name,
          sub: `${formatPct(p.data.pct)} ${word} · ${share(mv)} of holdings · ${p.data.industry}`,
        }
      },
    }),
    series: [
      {
        type: 'treemap',
        roam: false,
        // Leaf clicks are the panel's drill-in (onClick → ticker); no zoom-to-node.
        nodeClick: false,
        breadcrumb: { show: false },
        // Canvas TEXT, not tooltip HTML: no escaping needed. Truncated to the cell.
        label: {
          show: true,
          fontSize: 11,
          overflow: 'truncate' as const,
          // `data?: unknown` so the callback stays assignable to echarts' CallbackDataParams
          // (whose data is OptionDataItem); the leaf shape is this builder's own.
          formatter: (p: { data?: unknown }) => {
            const leaf = p.data as HeatLeaf | undefined
            return leaf === undefined
              ? ''
              : `${leaf.name}\n${formatCurrencyCompact(leaf.value[0])} · ${formatPct(leaf.pct)}`
          },
        },
        levels: [
          {},
          // Industry tier: a muted upper label names the group; thick surface borders separate
          // groups — AND the diverging fill for its ticker CHILDREN (min → orange, max → blue).
          // The mapping belongs to the PARENT: echarts' treemapVisual builds a node's children's
          // colour mapping out of that node's own model (buildVisualMapping(nodeModel), plus
          // statistic()'s nodeModel.get('visualDimension')), so a range declared on the series
          // or on the leaf level never reaches the leaves. The 2026-09-04 real-echarts probe
          // drew all three placements side by side: series-scoped and levels[2]-scoped both
          // came out one flat mid-ramp tone, this one ramped (tools/probes/charts-c4).
          {
            upperLabel: { show: true, height: 18, color: MUTED, fontSize: 11 },
            itemStyle: { borderColor: SURFACE, borderWidth: 2, gapWidth: 2 },
            colorMappingBy: 'value' as const,
            color: [...DIVERGING],
            visualDimension: 1,
            visualMin: -HEAT_CLAMP,
            visualMax: HEAT_CLAMP,
          },
          // Ticker tier: borders only — its fill arrives from the level above.
          { itemStyle: { borderColor: SURFACE, borderWidth: 1, gapWidth: 1 } },
        ],
        data: groups,
      },
    ],
  }
}

/** Every priced holding with both metrics (F12), grouped the way the map draws them. */
export function heatTreemapCsv(holdings: HoldingOut[]): ExportTable {
  const priced = holdings.filter((h) => h.market_value !== null && Number(h.market_value) > 0)
  return {
    headers: ['Industry', 'Ticker', 'Market value', 'Unrealized %', 'Day change %'],
    rows: priced.map((h) => [
      industryOf(h),
      h.ticker,
      h.market_value ?? '',
      h.unrealized_gl_pct ?? '',
      h.day_change_pct ?? '',
    ]),
  }
}

/** The drawn arcs (F12): top three named, the fold as Other. */
export function donutCsv(data: AllocationResponse, labels: boolean): ExportTable {
  const named = positiveSlices(data).map((s) => ({
    name: labels ? (TYPE_LABELS[s.key] ?? s.key) : s.key,
    value: Number(s.market_value),
  }))
  const top = named.slice(0, 3)
  const rest = named.slice(3)
  return {
    headers: ['Slice', 'Market value'],
    rows: [
      ...top.map((s) => [s.name, s.value.toFixed(2)]),
      ...(rest.length > 0
        ? [['Other', rest.reduce((sum, s) => sum + s.value, 0).toFixed(2)]]
        : []),
    ],
  }
}
