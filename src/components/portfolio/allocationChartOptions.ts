// Lifted VERBATIM out of AllocationPanel.tsx (taxChartOptions.ts precedent): pure option
// builders belong in a module the tests can call directly, and the Overview page needs the
// donut too — a second copy would be two things to keep in step.
import type { EChartsOption } from '../../charts/echarts'
import { INK, OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE, SURFACE } from '../../charts/theme'
import type { AllocationResponse } from '../../types/api'
import { escapeHtml, formatCurrencyCompact, formatPct } from '../../utils/format'

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
  return {
    tooltip: {
      formatter: (params) => {
        // `TopLevelFormatterParams` is `CallbackDataParams | CallbackDataParams[]`;
        // item-trigger only ever passes the single form (SpendingPage's idiom).
        const p = Array.isArray(params) ? params[0] : params
        return `${escapeHtml(p.name ?? '')}: ${formatCurrencyCompact(p.value as number)}`
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: { show: true, formatter: '{b}', fontSize: 11 },
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
    tooltip: {
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        const value = p.value as number
        return `${escapeHtml(p.name ?? '')}: ${formatCurrencyCompact(value)} (${formatPct(
          total > 0 ? value / total : 0,
          { signed: false },
        )})`
      },
    },
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
