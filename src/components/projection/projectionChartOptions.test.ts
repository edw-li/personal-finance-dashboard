import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import { PROJECTION_SERIES, projectionOption } from './projectionChartOptions'

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
