import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { INK, OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE, SURFACE } from '../../charts/theme'
import type { AllocationResponse } from '../../types/api'
import { TYPE_LABELS, donutOption, positiveSlices, treemapOption } from './allocationChartOptions'

// Wire shape of GET /portfolio/allocation?by=… — pydantic v2 serializes Decimal as strings,
// and the server sends the slices already sorted by market value descending (which is what
// makes "the first three" the top three).
function allocation(slices: [key: string, marketValue: string][]): AllocationResponse {
  const total = slices.reduce((sum, [, mv]) => sum + Number(mv), 0)
  return {
    by: 'type',
    total_market_value: total.toFixed(2),
    slices: slices.map(([key, market_value]) => ({
      key,
      market_value,
      weight_pct: total > 0 ? (Number(market_value) / total).toFixed(6) : '0.000000',
      holdings: 1,
    })),
  }
}

// --- option readers -------------------------------------------------------------------
// EChartsOption is a wide union; these narrow it once so the assertions stay about the
// colors and the numbers (taxChartOptions.test.ts's posture).
interface SliceLike {
  name?: string
  value?: number
  itemStyle?: { color?: string }
  label?: { color?: string }
}

function slicesOf(option: EChartsOption): SliceLike[] {
  return (option as unknown as { series: { data: SliceLike[] }[] }).series[0].data
}

function tooltipFormatterOf(
  option: EChartsOption,
): (params: { name: string; value: number }) => string {
  return (
    option as unknown as {
      tooltip: { formatter: (p: { name: string; value: number }) => string }
    }
  ).tooltip.formatter
}

describe('donutOption', () => {
  it('dresses the top three slices in palette slots 1-3, in feed order', () => {
    const option = donutOption(
      allocation([
        ['etf', '5000.00'],
        ['stock', '3000.00'],
        ['private', '2000.00'],
      ]),
      false,
    )
    const data = slicesOf(option)
    expect(data.map((s) => s.name)).toEqual(['etf', 'stock', 'private'])
    expect(data.map((s) => s.itemStyle?.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]])
    expect(data.map((s) => s.value)).toEqual([5000, 3000, 2000])
  })

  it('folds the fourth slice and everything under it into one gray Other', () => {
    const data = slicesOf(
      donutOption(
        allocation([
          ['etf', '5000.00'],
          ['stock', '3000.00'],
          ['private', '2000.00'],
          ['mutual_fund', '400.00'],
          ['cash', '100.50'],
        ]),
        false,
      ),
    )
    // Four arcs from five slices: ≤3 identity hues is the frozen all-pairs rule, so a
    // fourth hue is not the palette's to hand out — the tail becomes one neutral wedge
    // carrying the SUM, which keeps the ring a true whole.
    expect(data).toHaveLength(4)
    expect(data[3]).toEqual({
      name: 'Other',
      value: 500.5,
      itemStyle: { color: OTHER_SERIES_COLOR },
    })
    expect(data.map((s) => s.itemStyle?.color)).toEqual([
      PALETTE[0], PALETTE[1], PALETTE[2], OTHER_SERIES_COLOR,
    ])
  })

  it('drops oversold and empty slices from both area-encoded forms', () => {
    // A short position has a NEGATIVE market value and cannot be drawn as an area; the
    // holdings table still shows the row with its warning (Task 4 review M5).
    const data = allocation([
      ['etf', '5000.00'],
      ['short', '-200.00'],
      ['closed', '0.00'],
    ])
    expect(positiveSlices(data).map((s) => s.key)).toEqual(['etf'])
    expect(slicesOf(donutOption(data, false)).map((s) => s.name)).toEqual(['etf'])
    expect(slicesOf(treemapOption(data)).map((s) => s.name)).toEqual(['etf'])
  })

  it('reads the type keys as English only when the dimension is type', () => {
    const data = allocation([
      ['etf', '5000.00'],
      ['mutual_fund', '3000.00'],
      ['reit', '2000.00'],
    ])
    // labels=true is the TYPE dimension: the keys are the enum, so they get their labels —
    // and an unknown key falls through as itself rather than vanishing.
    expect(slicesOf(donutOption(data, true)).map((s) => s.name)).toEqual([
      'ETF', 'Mutual fund', 'reit',
    ])
    // labels=false is the ACCOUNT dimension, whose keys are already the user's own names.
    expect(slicesOf(donutOption(data, false)).map((s) => s.name)).toEqual([
      'etf', 'mutual_fund', 'reit',
    ])
    expect(TYPE_LABELS.stock).toBe('Stock')
  })

  it('escapes the slice name and shares it against the drawn total', () => {
    const option = donutOption(
      allocation([
        ['<b>ETF</b>', '3000.00'],
        ['stock', '1000.00'],
      ]),
      false,
    )
    // Account names are user text and the formatter builds HTML: unescaped, a name is
    // markup in the tooltip.
    expect(tooltipFormatterOf(option)({ name: '<b>ETF</b>', value: 3000 })).toBe(
      '&lt;b&gt;ETF&lt;/b&gt;: $3.0K (75.0%)',
    )
    expect(tooltipFormatterOf(treemapOption(allocation([['<b>x</b>', '3000.00']])))({
      name: '<b>x</b>',
      value: 3000,
    })).toBe('&lt;b&gt;x&lt;/b&gt;: $3.0K')
  })
})

describe('treemapOption', () => {
  it('flips the label ink at ramp index 6, where the blue gets light', () => {
    // idx = 3 + round(8 × value/max): 1000 → 11 (the ramp top), 313 → 6, 312 → 5. The
    // boundary is the contrast promise — #fff on SEQUENTIAL_BLUE[11] is 1.32:1, so the
    // light half of the ramp takes the dark SURFACE label and the dark half takes INK.
    const data = slicesOf(
      treemapOption(
        allocation([
          ['big', '1000.00'],
          ['edge', '313.00'],
          ['under', '312.00'],
        ]),
      ),
    )
    expect(data.map((s) => s.itemStyle?.color)).toEqual([
      SEQUENTIAL_BLUE[11], SEQUENTIAL_BLUE[6], SEQUENTIAL_BLUE[5],
    ])
    expect(data.map((s) => s.label?.color)).toEqual([SURFACE, SURFACE, INK])
    expect(data.map((s) => s.value)).toEqual([1000, 313, 312])
  })
})
