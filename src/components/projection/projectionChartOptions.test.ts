import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import type { PolyTrendFit } from './polyTrend'
import {
  NET_WORTH_PROJECTION_SERIES,
  netWorthProjectionOption,
  PROJECTION_SERIES,
  projectionOption,
} from './projectionChartOptions'

const DATA = {
  months: ['2026-08-01', '2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104000.00', '108000.00'],
  coast: ['100000.00', '100000.00', '100000.00'],
  fi_target: '1500000.00' as string | null,
}

// EChartsOption is a wide union; narrow once so the assertions stay about the numbers
// (the option-builder tests' shared posture).
function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    xAxis: { data: string[] }
    series: {
      name: string
      color: string
      lineStyle: { type?: string }
      areaStyle?: unknown
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
})
