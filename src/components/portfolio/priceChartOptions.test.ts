import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { INK, MUTED, NEGATIVE, PALETTE, POSITIVE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import type { PricePoint } from '../../types/api'
import { EVENTS_SERIES } from './historyChartOptions'
import {
  PRICE_SPANS,
  extentKnown,
  priceHistoryCsv,
  priceHistoryOption,
  priceWindowSummary,
  reachableSpans,
} from './priceChartOptions'

const POINTS: PricePoint[] = [
  { d: '2026-08-10', c: '171.2500' },
  { d: '2026-08-11', c: '173.0000' },
  { d: '2026-08-12', c: '169.8000' },
]
const EVENT = {
  value: ['Aug 11, 2026', 173] as [string, number],
  symbol: 'triangle' as const,
  symbolRotate: 0,
  events: [{ text: 'Buy NVDA — 10 sh · Aug 11, 2026' }],
}

// EChartsOption is a wide union; narrow once so the assertions stay about the numbers
// (the option-builder tests' shared posture).
function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    grid: unknown
    legend: { type: string; data?: string[] }
    xAxis: { data: string[]; boundaryGap?: boolean }
    yAxis: { scale?: boolean; axisLabel: { formatter: unknown } }
    visualMap?: {
      type: string
      show: boolean
      seriesIndex: number
      dimension: number
      pieces: { gte?: number; lt?: number; color: string }[]
    }
    tooltip: { formatter: (p: unknown) => string }
    series: {
      name: string
      type: string
      color?: string
      stack?: string
      silent?: boolean
      tooltip?: { show?: boolean }
      z?: number
      itemStyle?: { borderColor?: string; borderWidth?: number }
      lineStyle?: { color?: string; type?: string; width?: number }
      areaStyle?: { opacity: number; origin: number }
      data: unknown[]
    }[]
  }
}

describe('priceHistoryOption', () => {
  it('returns null under two points — one manual bar is not a line', () => {
    expect(priceHistoryOption({ points: [], avgCost: null })).toBeNull()
    expect(priceHistoryOption({ points: [POINTS[0]], avgCost: '100' })).toBeNull()
  })

  it('draws the closes as a blue line under date categories, scaled axis, whole-window zoom', () => {
    const option = read(priceHistoryOption({ points: POINTS, avgCost: null }))
    expect(option.xAxis.data).toEqual(['Aug 10, 2026', 'Aug 11, 2026', 'Aug 12, 2026'])
    expect(option.xAxis.boundaryGap).toBe(false)
    expect(option.series.map((s) => s.name)).toEqual(['Close'])
    expect(option.series[0]).toMatchObject({
      type: 'line',
      color: PALETTE[0],
      lineStyle: { width: 2 },
    })
    expect(option.series[0].data).toEqual([171.25, 173, 169.8])
    expect(option.series[0].areaStyle).toBeUndefined() // no cost → no wash
    expect(option.visualMap).toBeUndefined()
    expect(option.yAxis.scale).toBe(true)
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.dataZoom[0]).toMatchObject({ type: 'inside', startValue: 0 })
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.legend.type).toBe('plain')
  })

  it('F4: an Avg cost reference, stacked above/below-cost washes, and event markers', () => {
    // The 2026-09-04 probe rejected the piecewise-visualMap form (open-ended pieces leave
    // visualMeta.stops empty and echarts 6 throws inside getVisualGradient), so the wash is
    // the projection fan's technique: an invisible absolute base per side + the signed gap.
    const option = read(priceHistoryOption({ points: POINTS, avgCost: '172.0000', events: [EVENT] }))
    expect(option.series.map((s) => s.name)).toEqual([
      'wash-above-base',
      'Above cost',
      'wash-below-base',
      'Below cost',
      'Close',
      'Avg cost',
      EVENTS_SERIES,
    ])
    expect(option.visualMap).toBeUndefined()
    // Only the three real entries are legend-toggleable.
    expect(option.legend.data).toEqual(['Close', 'Avg cost', EVENTS_SERIES])
    expect(option.series[0]).toMatchObject({ stack: 'above-cost', color: 'transparent' })
    expect(option.series[0].areaStyle).toBeUndefined() // an invisible floor, not a fill
    expect(option.series[0].data).toEqual([172, 172, 172])
    expect(option.series[1]).toMatchObject({
      stack: 'above-cost',
      color: POSITIVE,
      silent: true,
      tooltip: { show: false },
      areaStyle: { opacity: 0.12 },
    })
    expect(option.series[1].data).toEqual([0, 1, 0])
    expect(option.series[2]).toMatchObject({ stack: 'below-cost', color: 'transparent' })
    expect(option.series[2].data).toEqual([171.25, 172, 169.8])
    expect(option.series[3]).toMatchObject({ stack: 'below-cost', color: NEGATIVE })
    // cents(): 172 − 169.8 is 2.1999999999999886 in float, and dust must not reach a chart.
    expect(option.series[3].data).toEqual([0.75, 0, 2.2])
    expect(option.series[4]).toMatchObject({ name: 'Close', color: PALETTE[0] })
    expect(option.series[4].areaStyle).toBeUndefined()
    expect(option.series[5]).toMatchObject({ color: MUTED, z: 9, lineStyle: { type: 'dashed' } })
    expect(option.series[5].data).toEqual([172, 172, 172])
    expect(option.series[6]).toMatchObject({
      type: 'scatter',
      color: MUTED,
      z: 11,
      itemStyle: { borderColor: INK, borderWidth: 1 },
    })
    expect(option.series[6].data).toEqual([EVENT])
  })

  it('F7: Close first, Avg cost as a muted reference, events as lines; null closes dropped', () => {
    const option = read(priceHistoryOption({ points: POINTS, avgCost: '172.0000', events: [EVENT] }))
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const parsed = tooltipRows(
      option.tooltip.formatter([
        {
          seriesName: 'Close',
          seriesType: 'line',
          axisValueLabel: 'Aug 11, 2026',
          value: 173,
          color: PALETTE[0],
        },
        { seriesName: 'Avg cost', seriesType: 'line', value: 172, color: MUTED },
        {
          seriesName: EVENTS_SERIES,
          seriesType: 'scatter',
          value: ['Aug 11, 2026', 173],
          color: MUTED,
          data: EVENT,
        },
      ]),
    )
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Close', '$173.00'],
      ['ref', 'Avg cost', '$172.00'],
    ])
    expect(parsed.notes).toEqual(['Buy NVDA — 10 sh · Aug 11, 2026'])
    expect(
      option.tooltip.formatter([{ seriesName: 'Close', seriesType: 'line', value: null }]),
    ).toBe('')
  })
})

describe('priceWindowSummary / reachableSpans / priceHistoryCsv', () => {
  it('summarises the window: signed change first-to-last and the first date', () => {
    // Three bars back when a year was asked for: the response is short, so the first bar
    // IS the start of the history and the footer may say so.
    expect(priceWindowSummary(POINTS, 365, '2026-09-03')).toEqual({
      changePct: (169.8 - 171.25) / 171.25,
      since: 'Aug 10, 2026',
      extentKnown: true,
    })
    expect(priceWindowSummary([], 365, '2026-09-03')).toBeNull()
  })

  it('claims the extent only when the response is SHORT of the window it asked for', () => {
    // A full-length response says nothing about what sits behind it — the first bar is
    // where this WINDOW starts, not where the history does (the reachableSpans test).
    const full = [
      { d: '2025-09-03', c: '100' },
      { d: '2026-09-03', c: '110' },
    ]
    expect(priceWindowSummary(full, 365, '2026-09-03')).toEqual({
      changePct: 0.1,
      since: 'Sep 3, 2025',
      extentKnown: false,
    })
    // The same one-week slack reachableSpans uses: 360 days back of a 365-day ask is full.
    expect(extentKnown(full, 365, '2026-09-03')).toBe(false)
    expect(extentKnown([{ d: '2026-02-15', c: '1' }], 365, '2026-09-03')).toBe(true)
    expect(extentKnown([], 365, '2026-09-03')).toBe(false)
  })

  it('spans: All replaces Max; a full response leaves every span reachable', () => {
    expect(PRICE_SPANS.map((s) => s.label)).toEqual(['1Y', '3Y', 'All'])
    // Asked for 365 days and got them all: the extent is unknown → nothing is disabled.
    const full = [
      { d: '2025-09-03', c: '1' },
      { d: '2026-09-03', c: '2' },
    ]
    expect(reachableSpans(full, 365, '2026-09-03')).toEqual({ 365: true, 1095: true, 3650: true })
  })

  it('a truncated response reveals the extent: the first span that covers everything stays, longer ones are unreachable', () => {
    // 200 days of history when 365 were asked: 1Y already shows everything.
    const short = [
      { d: '2026-02-15', c: '1' },
      { d: '2026-09-03', c: '2' },
    ]
    expect(reachableSpans(short, 365, '2026-09-03')).toEqual({ 365: true, 1095: false, 3650: false })
    // 400 days when 1095 were asked: 1Y is a real window, 3Y covers everything, All is moot.
    const mid = [
      { d: '2025-07-30', c: '1' },
      { d: '2026-09-03', c: '2' },
    ]
    expect(reachableSpans(mid, 1095, '2026-09-03')).toEqual({ 365: true, 1095: true, 3650: false })
    expect(reachableSpans([], 365, '2026-09-03')).toEqual({ 365: true, 1095: true, 3650: true })
  })

  it('exports date and close', () => {
    expect(priceHistoryCsv(POINTS)).toEqual({
      headers: ['Date', 'Close'],
      rows: [
        ['2026-08-10', '171.2500'],
        ['2026-08-11', '173.0000'],
        ['2026-08-12', '169.8000'],
      ],
    })
  })
})
