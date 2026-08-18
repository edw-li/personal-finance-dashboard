import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE } from '../../charts/theme'
import type { PricePoint } from '../../types/api'
import { priceHistoryOption } from './priceChartOptions'

const POINTS: PricePoint[] = [
  { d: '2026-08-10', c: '171.2500' },
  { d: '2026-08-11', c: '173.0000' },
  { d: '2026-08-12', c: '169.8000' },
]

// EChartsOption is a wide union; narrow once so the assertions stay about the numbers
// (the option-builder tests' shared posture).
function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    xAxis: { data: string[] }
    yAxis: { scale?: boolean }
    tooltip: { valueFormatter: (v: unknown) => string }
    series: { type: string; color: string; data: number[] }[]
  }
}

describe('priceHistoryOption', () => {
  it('returns null under two points — one manual bar is not a line', () => {
    expect(priceHistoryOption([])).toBeNull()
    expect(priceHistoryOption([POINTS[0]])).toBeNull()
  })

  it('draws the closes as numbers under formatted date categories', () => {
    const option = read(priceHistoryOption(POINTS))
    expect(option.xAxis.data).toEqual(['Aug 10, 2026', 'Aug 11, 2026', 'Aug 12, 2026'])
    expect(option.series[0].type).toBe('line')
    expect(option.series[0].color).toBe(PALETTE[0])
    expect(option.series[0].data).toEqual([171.25, 173, 169.8])
  })

  it('scales the value axis instead of anchoring at zero', () => {
    // A price line has no area wash and no additive reading: a $0 floor would flatten a
    // $160–$175 year to a ribbon. The visible tick labels keep the scaled frame honest.
    expect(read(priceHistoryOption(POINTS)).yAxis.scale).toBe(true)
  })

  it('opens the inside zoom on the whole fetched window', () => {
    const zoom = read(priceHistoryOption(POINTS)).dataZoom
    expect(zoom).toHaveLength(1)
    expect(zoom[0].type).toBe('inside')
    expect(zoom[0].startValue).toBe(0)
  })

  it('dashes a null in the tooltip and formats real closes as currency', () => {
    const formatter = read(priceHistoryOption(POINTS)).tooltip.valueFormatter
    expect(formatter(null)).toBe('—')
    expect(formatter(171.25)).toBe('$171.25')
  })
})
