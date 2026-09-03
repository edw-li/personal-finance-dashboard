import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { DIVERGING, INK, OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE, SURFACE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import type { AllocationResponse, HoldingOut } from '../../types/api'
import {
  HEAT_CLAMP,
  HEAT_METRICS,
  TYPE_LABELS,
  donutCsv,
  donutOption,
  heatTreemapCsv,
  heatTreemapOption,
  positiveSlices,
  treemapOption,
} from './allocationChartOptions'

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
    expect(tooltipRows(tooltipFormatterOf(option)({ name: '<b>ETF</b>', value: 3000 })).label).toBe(
      '&lt;b&gt;ETF&lt;/b&gt;',
    )
    expect(tooltipFormatterOf(treemapOption(allocation([
      ['<b>x</b>', '3000.00'],
      ['plain', '1000.00'],
    ])))({
      name: '<b>x</b>',
      value: 3000,
    })).toBe('<strong>$3,000.00</strong> · 75.0%<br/>&lt;b&gt;x&lt;/b&gt;')
  })
})

function labelFormatterOf(
  option: EChartsOption,
): (params: { name: string; value: number }) => string {
  return (
    option as unknown as {
      series: { label: { formatter: (p: { name: string; value: number }) => string } }[]
    }
  ).series[0].label.formatter
}

describe('treemapOption', () => {
  it('suppresses the implicit root node — the gaps between cells are not data', () => {
    // Hovering the 2px gapWidth strips hits the flat data's virtual parent, whose params
    // carry an empty name and the whole book's value: ": $773.2K" answered every hover
    // near a border until this guard.
    const option = treemapOption(allocation([['a', '600.00'], ['b', '200.00']]))
    expect(tooltipFormatterOf(option)({ name: '', value: 800 })).toBe('')
  })

  it('labels every cell with its name, compact value and share of the drawn total', () => {
    const option = treemapOption(allocation([['Software', '600.00'], ['Retail', '200.00']]))
    const label = labelFormatterOf(option)
    expect(label({ name: 'Software', value: 600 })).toBe('Software\n$600 · 75.0%')
    expect(label({ name: 'Retail', value: 200 })).toBe('Retail\n$200 · 25.0%')
  })

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

// --- the heat-treemap (F5) ------------------------------------------------------------
function holding(
  over: Partial<HoldingOut> & Pick<HoldingOut, 'ticker' | 'market_value'>,
): HoldingOut {
  return {
    security_id: 1, name: over.ticker, industry: 'Semis', holding_type: 'stock',
    is_manual_priced: false, shares: '1', avg_cost: '1', cost_basis: '1', price: '1',
    quoted_at: null, price_source: 'yfinance', day_change_pct: '0.01', day_change_amount: '1',
    weight_pct: null, unrealized_gl: '1', unrealized_gl_pct: '0.10', realized_gl: '0',
    dividends_collected: '0', annual_dividend: null, annual_income: null, yield_pct: null,
    yoc_pct: null, xirr_pct: null, accounts: [], warnings: [],
    ...over,
  }
}

const BOOK = [
  holding({ ticker: 'NVDA', market_value: '600000.00', unrealized_gl_pct: '0.80', day_change_pct: '-0.02' }),
  holding({ ticker: 'AMD', market_value: '200000.00', unrealized_gl_pct: '-0.10' }),
  holding({ ticker: 'VOO', market_value: '195000.00', industry: null, holding_type: 'etf', unrealized_gl_pct: '0.25' }),
  holding({ ticker: 'TINY', market_value: '3000.00', unrealized_gl_pct: '0.05' }), // 0.3% → folded
  holding({ ticker: 'TINIER', market_value: '2000.00', unrealized_gl_pct: '-0.05' }),
  holding({ ticker: 'UNPRICED', market_value: null }),
]

interface Leaf {
  name: string
  value: [number, number]
  ticker: string | null
  pct: number
  label: { color: string }
  children?: Leaf[]
}

const readHeat = (option: unknown) =>
  option as {
    tooltip: { trigger: string; formatter: (p: unknown) => string }
    series: {
      type: string
      visualDimension: number
      visualMin: number
      visualMax: number
      levels: { colorMappingBy?: string; color?: string[] }[]
      label: { formatter: (p: { data: Leaf }) => string }
      data: Leaf[]
    }[]
  }

describe('heatTreemapOption', () => {
  it('groups tickers under their industry (type label when none), area = market value, fill = the clamped metric', () => {
    const option = readHeat(heatTreemapOption(BOOK, 'unrealized'))
    const series = option.series[0]
    expect(series).toMatchObject({
      type: 'treemap', visualDimension: 1, visualMin: -HEAT_CLAMP, visualMax: HEAT_CLAMP,
    })
    expect(series.levels[2]).toMatchObject({ colorMappingBy: 'value', color: [...DIVERGING] })
    expect(series.data.map((g) => g.name)).toEqual(['Semis', 'ETF']) // biggest industry first
    const semis = series.data[0]
    expect(semis.children!.map((l) => l.name)).toEqual(['NVDA', 'AMD', 'Other'])
    expect(semis.children![0].value).toEqual([600000, HEAT_CLAMP]) // +80% clamps to +50%
    expect(semis.children![0].pct).toBe(0.8) // the tooltip keeps the true figure
    expect(semis.children![1].value).toEqual([200000, -0.1])
    // Two slivers (0.3% + 0.2% of a $1M book) fold into one Other cell with a value-weighted %.
    expect(semis.children![2]).toMatchObject({ name: 'Other', ticker: null, value: [5000, 0.01] })
    expect(series.data[1].children![0]).toMatchObject({ name: 'VOO', value: [195000, 0.25] })
    // Saturated arms take the surface ink, the neutral middle takes text ink.
    expect(semis.children![0].label.color).toBe(SURFACE)
    expect(semis.children![1].label.color).toBe(INK)
    expect(series.label.formatter({ data: semis.children![0] })).toBe('NVDA\n$600.0K · +80.0%')
  })

  it('Day change reads day_change_pct; unpriced holdings are excluded; empty book → null', () => {
    const series = readHeat(heatTreemapOption(BOOK, 'day')).series[0]
    expect(series.data[0].children![0].value).toEqual([600000, -0.02])
    expect(heatTreemapOption([holding({ ticker: 'X', market_value: null })], 'day')).toBeNull()
    expect(HEAT_METRICS.map((m) => m.label)).toEqual(['Unrealized', 'Day change'])
  })

  it('F7: value first, ticker, the metric and share; industry nodes summarise; the root is silent', () => {
    const option = readHeat(heatTreemapOption(BOOK, 'unrealized'))
    const leaf = option.series[0].data[0].children![0]
    const parsed = tooltipRows(option.tooltip.formatter({ name: 'NVDA', value: leaf.value, data: leaf }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual([
      '$600,000.00', 'NVDA', '+80.0% unrealized · 60.0% of holdings · Semis',
    ])
    const group = tooltipRows(
      option.tooltip.formatter({ name: 'Semis', value: [805000, 0], data: option.series[0].data[0] }),
    )
    expect([group.lead, group.label, group.sub]).toEqual(['$805,000.00', 'Semis', '80.5% of holdings'])
    expect(option.tooltip.formatter({ name: '', value: [1000000, 0] })).toBe('')
  })

  it('exports every priced holding with both metrics', () => {
    const csv = heatTreemapCsv(BOOK)
    expect(csv.headers).toEqual(['Industry', 'Ticker', 'Market value', 'Unrealized %', 'Day change %'])
    expect(csv.rows[0]).toEqual(['Semis', 'NVDA', '600000.00', '0.80', '-0.02'])
    expect(csv.rows).toHaveLength(5)
  })
})

describe('donutOption — grammar', () => {
  it('F7: value first, the escaped name, the share of holdings; CSV lists the drawn arcs', () => {
    const data = allocation([['<b>ETF</b>', '3000.00'], ['stock', '1000.00']])
    const format = (
      donutOption(data, false) as unknown as {
        tooltip: { trigger: string; formatter: (p: unknown) => string }
      }
    ).tooltip
    expect(format.trigger).toBe('item')
    const parsed = tooltipRows(format.formatter({ name: '<b>ETF</b>', value: 3000 }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual([
      '$3,000.00', '&lt;b&gt;ETF&lt;/b&gt;', '75.0% of holdings',
    ])
    expect(
      donutCsv(
        allocation([
          ['etf', '5000.00'], ['stock', '3000.00'], ['private', '2000.00'], ['mutual_fund', '400.00'],
        ]),
        true,
      ),
    ).toEqual({
      headers: ['Slice', 'Market value'],
      rows: [['ETF', '5000.00'], ['Stock', '3000.00'], ['Private', '2000.00'], ['Other', '400.00']],
    })
  })
})
