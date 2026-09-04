import { describe, expect, it } from 'vitest'
import type { EChartsOption } from './echarts'
import { MOTION, defaultCursor, pinSeriesMotion, quiesceRipples } from './motion'

// No component is RENDERED here (echarts does not draw in jsdom — house law); this pins
// the pure transform EChart.tsx applies under prefers-reduced-motion.
interface SeriesLike {
  type?: string
  name?: string
  rippleEffect?: { number?: number; brushType?: string; scale?: number }
  data?: unknown[]
}

function seriesOf(option: EChartsOption): SeriesLike[] {
  const series = (option as unknown as { series?: SeriesLike | SeriesLike[] }).series
  if (series === undefined) return []
  return Array.isArray(series) ? series : [series]
}

function optionWith(series: unknown): EChartsOption {
  return { series } as unknown as EChartsOption
}

describe('quiesceRipples', () => {
  it('zeroes the ripple count while preserving the rest of rippleEffect', () => {
    const out = quiesceRipples(
      optionWith([
        { type: 'line', name: 'Portfolio value', data: [1, 2] },
        {
          type: 'effectScatter',
          name: 'Live',
          rippleEffect: { brushType: 'stroke', scale: 3 },
          data: [['Aug 14, 2026', 723456.78]],
        },
      ]),
    )
    // number: 0 makes EffectSymbol's `for (i = 0; i < rippleNumber; i++)` loop body never
    // run, so no looping animator is ever created — the blue dot stays, the pulse dies.
    expect(seriesOf(out)[1].rippleEffect).toEqual({ brushType: 'stroke', scale: 3, number: 0 })
  })

  it('leaves every non-effectScatter series exactly as it was', () => {
    const out = quiesceRipples(
      optionWith([
        { type: 'line', name: 'Portfolio value', data: [1, 2] },
        { type: 'effectScatter', name: 'Live', rippleEffect: { scale: 3 } },
      ]),
    )
    expect(seriesOf(out)[0]).toEqual({ type: 'line', name: 'Portfolio value', data: [1, 2] })
  })

  it('quiets an effectScatter that declares no rippleEffect of its own', () => {
    // echarts' own default is number: 3, so a bare effectScatter pulses unless told not to.
    const out = quiesceRipples(optionWith([{ type: 'effectScatter', name: 'Live' }]))
    expect(seriesOf(out)[0].rippleEffect).toEqual({ number: 0 })
  })

  it('handles a single series object without turning it into an array', () => {
    const out = quiesceRipples(
      optionWith({ type: 'effectScatter', name: 'Live', rippleEffect: { scale: 3 } }),
    )
    expect(Array.isArray((out as unknown as { series: unknown }).series)).toBe(false)
    expect(seriesOf(out)[0].rippleEffect).toEqual({ scale: 3, number: 0 })
  })

  it('passes an option with no series through untouched', () => {
    const bare = { xAxis: { type: 'category', data: ['a'] } } as unknown as EChartsOption
    expect(quiesceRipples(bare)).toEqual({ xAxis: { type: 'category', data: ['a'] } })
  })

  it("does not mutate the caller's option (pages memoize and reuse it)", () => {
    const input = optionWith([
      { type: 'effectScatter', name: 'Live', rippleEffect: { brushType: 'stroke', scale: 3 } },
    ])
    quiesceRipples(input)
    expect(seriesOf(input)[0].rippleEffect).toEqual({ brushType: 'stroke', scale: 3 })
  })
})

describe('MOTION', () => {
  it('is the house clock: 450ms cubicOut entrance, 300ms cubicInOut update', () => {
    expect(MOTION).toEqual({
      animationDuration: 450,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 300,
      animationEasingUpdate: 'cubicInOut',
    })
  })
})

describe('defaultCursor', () => {
  it('blunts every series that has not asked for a cursor and leaves the ones that have', () => {
    const out = defaultCursor(optionWith([{ type: 'line' }, { type: 'bar', cursor: 'pointer' }]))
    expect(seriesOf(out).map((s) => (s as { cursor?: string }).cursor)).toEqual(['default', 'pointer'])
    expect(defaultCursor(optionWith({ type: 'pie' }))).toEqual({ series: { type: 'pie', cursor: 'default' } })
    expect(defaultCursor({} as EChartsOption)).toEqual({})
  })
})

describe('pinSeriesMotion', () => {
  it('overwrites the series’ own clock, keeps the rest, and leaves a series-less option alone', () => {
    const input = optionWith([
      // SANKEY_MARKS spreads MOTION onto the series, so 450 has to LOSE here.
      { type: 'sankey', name: 'Flow', animationDuration: 450 },
      { type: 'line', name: 'Portfolio value' },
    ])
    const out = pinSeriesMotion(input, { animationDuration: 0 })
    expect(seriesOf(out).map((s) => (s as { animationDuration?: number }).animationDuration))
      .toEqual([0, 0])
    expect(seriesOf(out)[0].name).toBe('Flow')
    // The caller's option is memoized and reused — the transform never writes through it.
    expect((seriesOf(input)[0] as { animationDuration?: number }).animationDuration).toBe(450)
    expect(pinSeriesMotion(optionWith({ type: 'pie' }), { animation: false }))
      .toEqual({ series: { type: 'pie', animation: false } })
    expect(pinSeriesMotion({} as EChartsOption, { animationDuration: 0 })).toEqual({})
  })
})
