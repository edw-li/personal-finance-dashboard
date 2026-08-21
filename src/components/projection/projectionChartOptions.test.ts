import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import type { PolyTrendFit } from './polyTrend'
import {
  BAND_SERIES,
  NET_WORTH_PROJECTION_SERIES,
  netWorthProjectionOption,
  PROJECTION_SERIES,
  projectionOption,
  projectionTooltipFormatter,
} from './projectionChartOptions'

const DATA = {
  months: ['2026-08-01', '2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104000.00', '108000.00'],
  coast: ['100000.00', '100000.00', '100000.00'],
  fi_target: '1500000.00' as string | null,
  bands: null as Record<string, string[]> | null,
}

// Three months of hand-made percentiles — every diff below is checkable by eye.
const BANDS: Record<string, string[]> = {
  p10: ['100000.00', '90000.00', '80000.00'],
  p25: ['100000.00', '95000.00', '92000.00'],
  p50: ['100000.00', '104000.00', '108000.00'],
  p75: ['100000.00', '112000.00', '125000.00'],
  p90: ['100000.00', '120000.00', '150000.00'],
}

// EChartsOption is a wide union; narrow once so the assertions stay about the numbers
// (the option-builder tests' shared posture).
function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    legend: { data: string[] }
    xAxis: { data: string[] }
    series: {
      name: string
      color: string
      stack?: string
      silent?: boolean
      tooltip?: { show: boolean }
      emphasis?: { disabled: boolean }
      lineStyle: { type?: string; width?: number }
      areaStyle?: { opacity: number }
      data: number[]
    }[]
  }
}

describe('projectionOption', () => {
  it('returns null under two points', () => {
    expect(projectionOption({ ...DATA, months: ['2026-08-01'], projected: ['1'], coast: ['1'] })).toBeNull()
  })

  it('draws projected (washed blue), coast (orange) and the dashed threshold', () => {
    const option = read(projectionOption(DATA))
    expect(option.series.map((s) => s.name)).toEqual([...PROJECTION_SERIES])
    expect(option.series[0].color).toBe(PALETTE[0])
    expect(option.series[0].areaStyle).toBeTruthy() // the ONE wash (history chart's rule)
    expect(option.series[0].data).toEqual([100000, 104000, 108000])
    expect(option.series[1].color).toBe(PALETTE[1])
    expect(option.series[1].areaStyle).toBeUndefined()
    // Dashed is reserved for thresholds — this IS the threshold, at the target on every month.
    expect(option.series[2].color).toBe(MUTED)
    expect(option.series[2].lineStyle.type).toBe('dashed')
    expect(option.series[2].data).toEqual([1500000, 1500000, 1500000])
  })

  it('drops the threshold when there is no target to draw', () => {
    const option = read(projectionOption({ ...DATA, fi_target: null }))
    expect(option.series.map((s) => s.name)).toEqual([PROJECTION_SERIES[0], PROJECTION_SERIES[1]])
  })

  it('formats the month axis and opens the inside zoom on everything', () => {
    const option = read(projectionOption(DATA))
    expect(option.xAxis.data).toEqual(['Aug 2026', 'Sep 2026', 'Oct 2026'])
    expect(option.dataZoom[0].type).toBe('inside')
    expect(option.dataZoom[0].startValue).toBe(0)
  })

  it('draws the pre-Monte-Carlo chart exactly when the payload carries no bands', () => {
    // Back-compat is a test, not a hope: a deterministic run is three series, no more.
    // The second case is the older payload with no `bands` key at all (a stale tab).
    const stale = { ...DATA, bands: undefined } as unknown as typeof DATA
    for (const data of [DATA, stale]) {
      const option = read(projectionOption(data))
      expect(option.series).toHaveLength(3)
      expect(option.series.map((s) => s.name)).toEqual([...PROJECTION_SERIES])
      expect(option.series.every((s) => s.stack === undefined)).toBe(true)
      expect(option.legend.data).toEqual([...PROJECTION_SERIES])
    }
  })

  it('prepends four stacked band series so the lines draw on top', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    expect(option.series).toHaveLength(7)
    expect(option.series.map((s) => s.name)).toEqual([
      'mc-base',
      BAND_SERIES[0],
      BAND_SERIES[1],
      `${BAND_SERIES[0]}-upper`,
      ...PROJECTION_SERIES,
    ])
    // One stack, so echarts sums base + the three diffs back into p25 / p75 / p90.
    expect(option.series.slice(0, 4).every((s) => s.stack === 'mc-band')).toBe(true)
    expect(option.series.slice(4).every((s) => s.stack === undefined)).toBe(true)
  })

  it('stacks an absolute p10 base under exact percentile diffs, all in the projection blue', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    const [base, outerLow, inner, outerHigh] = option.series
    expect(base.data).toEqual([100000, 90000, 80000]) // ABSOLUTE — the stack's floor
    expect(base.color).toBe('transparent')
    expect(base.areaStyle).toBeUndefined() // an invisible line, not a wash
    expect(outerLow.data).toEqual([0, 5000, 12000]) // p25 − p10
    expect(inner.data).toEqual([0, 17000, 33000]) // p75 − p25
    expect(outerHigh.data).toEqual([0, 8000, 25000]) // p90 − p75
    // Uncertainty about one entity wears that entity's hue — never a new one.
    expect([outerLow.color, inner.color, outerHigh.color]).toEqual([
      PALETTE[0],
      PALETTE[0],
      PALETTE[0],
    ])
    // The inner half reads denser than the outer eighty percent.
    expect(outerLow.areaStyle?.opacity).toBe(0.1)
    expect(inner.areaStyle?.opacity).toBe(0.18)
    expect(outerHigh.areaStyle?.opacity).toBe(0.1)
    expect(option.series.slice(0, 4).every((s) => s.lineStyle.width === 0)).toBe(true)
  })

  it('keeps the bands out of the tooltip and the hover — they are geometry', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    for (const series of option.series.slice(0, 4)) {
      expect(series.silent).toBe(true)
      expect(series.tooltip).toEqual({ show: false })
      expect(series.emphasis).toEqual({ disabled: true })
    }
    // The three real lines still carry the numbers.
    for (const series of option.series.slice(4)) {
      expect(series.silent).toBeUndefined()
      expect(series.tooltip).toBeUndefined()
    }
  })

  it('names only the two washes that differ in the legend', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    // 'mc-base' is invisible and the '-upper' wash is the same band as its lower half —
    // an automatic legend would offer both, and one of them twice.
    expect(option.legend.data).toEqual([...PROJECTION_SERIES, ...BAND_SERIES])
    expect(option.legend.data).not.toContain('mc-base')
    expect(option.legend.data).not.toContain(`${BAND_SERIES[0]}-upper`)
  })

  it('bands survive a missing target — the threshold leaves, the fan stays', () => {
    const option = read(projectionOption({ ...DATA, fi_target: null, bands: BANDS }))
    expect(option.series).toHaveLength(6)
    expect(option.legend.data).toEqual([
      PROJECTION_SERIES[0],
      PROJECTION_SERIES[1],
      ...BAND_SERIES,
    ])
  })

  it('tooltip reconstructs the band RANGES the silent washes cannot say (2026-08-20 revision)', () => {
    const option = projectionOption({ ...DATA, bands: BANDS }) as unknown as {
      tooltip: { formatter?: (params: unknown) => string; valueFormatter?: unknown }
    }
    expect(option.tooltip.valueFormatter).toBeUndefined()
    expect(typeof option.tooltip.formatter).toBe('function')
    const html = option.tooltip.formatter!([
      { seriesName: 'Projected', marker: 'M1', axisValueLabel: 'Sep 2026', dataIndex: 1, value: 104000 },
      { seriesName: 'Growth only', marker: 'M2', dataIndex: 1, value: 100000 },
      { seriesName: 'FI target', marker: 'M3', dataIndex: 1, value: 1500000 },
    ])
    expect(html).toContain('<strong>Sep 2026</strong>')
    expect(html).toContain('M1Projected: $104,000.00')
    expect(html).toContain('M3FI target: $1,500,000.00')
    // Real percentile ABSOLUTES from the bands arrays — never the stack's diff values.
    expect(html).toContain(`${BAND_SERIES[0]}: $90,000.00 – $120,000.00`)
    expect(html).toContain(`${BAND_SERIES[1]}: $95,000.00 – $112,000.00`)
    // The legend's own order: the wide band above the tight one.
    expect(html.indexOf(BAND_SERIES[0])).toBeLessThan(html.indexOf(BAND_SERIES[1]))
  })

  it('keeps the plain per-value tooltip without bands — back-compat', () => {
    const option = projectionOption(DATA) as unknown as {
      tooltip: { formatter?: unknown; valueFormatter?: unknown }
    }
    expect(option.tooltip.formatter).toBeUndefined()
    expect(typeof option.tooltip.valueFormatter).toBe('function')
  })

  it('tooltip formatter drops non-finite rows and answers nothing with none', () => {
    const formatter = projectionTooltipFormatter(BANDS)
    expect(formatter([{ seriesName: 'Projected', value: null }])).toBe('')
    const html = formatter([
      { seriesName: 'Projected', axisValueLabel: 'Oct 2026', dataIndex: 2, value: 108000 },
      { seriesName: 'FI target', value: Number.NaN },
    ])
    expect(html).toContain('Projected: $108,000.00')
    expect(html).not.toContain('FI target')
    expect(html).toContain(`${BAND_SERIES[0]}: $80,000.00 – $150,000.00`)
    expect(html).toContain(`${BAND_SERIES[1]}: $92,000.00 – $125,000.00`)
  })
})

const HISTORY = {
  months: ['2026-06-01', '2026-07-01', '2026-08-01'],
  net_worth: ['100000.00', '101000.00', '102010.00'],
}

// A hand-made fit — the builder only ever calls valueAt (the real math is pinned in
// polyTrend.test.ts; this keeps the builder test a unit test).
const FIT: PolyTrendFit = {
  valueAt: (iso) => (iso === '2026-06-01' ? 100000 : 123456),
}

function readNw(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    legend: { data: { name: string; icon?: string }[] }
    xAxis: { data: string[] }
    yAxis: { type: string }
    series: {
      name: string
      type: string
      color: string
      z: number
      symbolSize?: number
      areaStyle?: unknown
      data: number[]
    }[]
  }
}

describe('netWorthProjectionOption', () => {
  it('returns null under two history points', () => {
    expect(
      netWorthProjectionOption(
        { months: ['2026-08-01'], net_worth: ['1'] },
        FIT,
        '2026-08-01',
        30,
      ),
    ).toBeNull()
  })

  it('extends the axis from the last snapshot to the horizon end', () => {
    // start 2026-08 + 1y horizon ends 2027-08; history ends 2026-08 → 12 future months.
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    expect(option.xAxis.data).toHaveLength(15)
    expect(option.xAxis.data[0]).toBe('Jun 2026')
    expect(option.xAxis.data[2]).toBe('Aug 2026')
    expect(option.xAxis.data[14]).toBe('Aug 2027')
  })

  it('draws blue dots over the history months only', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    const dots = option.series[0]
    expect(dots.name).toBe(NET_WORTH_PROJECTION_SERIES[0])
    expect(dots.type).toBe('scatter')
    expect(dots.color).toBe(PALETTE[0])
    expect(dots.symbolSize).toBe(6)
    // Unpadded: on a category axis the shorter series simply ends where history does.
    expect(dots.data).toEqual([100000, 101000, 102010])
  })

  it('draws the trend across the whole axis, orange, washless, under the dots', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    const [dots, trend] = option.series
    expect(trend.name).toBe(NET_WORTH_PROJECTION_SERIES[1])
    expect(trend.type).toBe('line')
    expect(trend.color).toBe(PALETTE[1])
    expect(trend.areaStyle).toBeUndefined()
    expect(trend.data).toHaveLength(15)
    expect(trend.data[0]).toBe(100000) // FIT.valueAt('2026-06-01')
    expect(trend.data[14]).toBe(123456)
    expect(dots.z).toBeGreaterThan(trend.z)
  })

  it('omits the trend when the fit was refused, keeping the dots', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, null, '2026-08-01', 1))
    expect(option.series.map((s) => s.name)).toEqual([NET_WORTH_PROJECTION_SERIES[0]])
  })

  it('yields no continuation when a snapshot already sits at the horizon end', () => {
    // A future-dated snapshot at/past startMonth+years·12 — the axis is history verbatim.
    const history = { months: ['2026-08-01', '2027-08-01'], net_worth: ['1000.00', '2000.00'] }
    const option = readNw(netWorthProjectionOption(history, FIT, '2026-08-01', 1))
    expect(option.xAxis.data).toEqual(['Aug 2026', 'Aug 2027'])
  })

  it('tells the legend swatches apart and opens the inside zoom on everything', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    expect(option.legend.data[0]).toEqual({ name: NET_WORTH_PROJECTION_SERIES[0], icon: 'circle' })
    expect(option.legend.data[1]).toEqual({ name: NET_WORTH_PROJECTION_SERIES[1] })
    expect(option.dataZoom[0].type).toBe('inside')
    expect(option.dataZoom[0].startValue).toBe(0)
  })

  it('rides a log y-axis, turning nonpositive values into gaps', () => {
    // A log axis cannot place zero or below — such points become NaN gaps, never lies.
    const history = {
      months: ['2026-06-01', '2026-07-01', '2026-08-01'],
      net_worth: ['-5.00', '101000.00', '102010.00'],
    }
    const dipping: PolyTrendFit = { valueAt: (iso) => (iso === '2026-06-01' ? -1 : 123456) }
    const option = readNw(netWorthProjectionOption(history, dipping, '2026-08-01', 1))
    expect(option.yAxis.type).toBe('log')
    expect(option.series[0].data).toEqual([NaN, 101000, 102010])
    expect(option.series[1].data[0]).toBeNaN()
    expect(option.series[1].data[1]).toBe(123456)
  })
})
