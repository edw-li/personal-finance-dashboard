import { describe, expect, it } from 'vitest'
import { DARK, LIGHT } from '../theme/tokens'
import { lightFromDark, recolorOption } from './recolor'

describe('recolorOption', () => {
  it('maps every dark token hex to its light counterpart, wherever it sits', () => {
    const option = {
      color: [...DARK.palette],
      series: [
        {
          type: 'bar',
          itemStyle: { color: DARK.positive },
          data: [{ value: 1, itemStyle: { color: DARK.negative } }],
        },
        { type: 'line', lineStyle: { color: DARK.text }, areaStyle: { color: DARK.otherSeries } },
      ],
      visualMap: { inRange: { color: [...DARK.sequential] } },
      tooltip: { backgroundColor: DARK.surface2, borderColor: DARK.axisLine },
    }
    // Read shape, not `typeof option`: an array literal of two DIFFERENT object shapes
    // infers a union whose members carry the other's keys as possibly-undefined.
    const out = recolorOption(option, lightFromDark) as {
      color: string[]
      series: [
        { itemStyle: { color: string }; data: [{ itemStyle: { color: string } }] },
        { lineStyle: { color: string }; areaStyle: { color: string } },
      ]
      visualMap: { inRange: { color: string[] } }
      tooltip: { backgroundColor: string }
    }
    expect(out.color).toEqual([...LIGHT.palette])
    expect(out.series[0].itemStyle.color).toBe(LIGHT.positive)
    expect(out.series[0].data[0].itemStyle.color).toBe(LIGHT.negative)
    expect(out.series[1].lineStyle.color).toBe(LIGHT.text)
    expect(out.series[1].areaStyle.color).toBe(LIGHT.otherSeries)
    expect(out.visualMap.inRange.color).toEqual([...LIGHT.sequential])
    expect(out.tooltip.backgroundColor).toBe(LIGHT.surface2)
  })

  it('is case-insensitive on input and leaves unknown strings, numbers and functions alone', () => {
    const fmt = (v: number) => `$${v}`
    const option = { a: DARK.accent.toUpperCase(), b: '#123456', c: 3, d: fmt, e: null }
    const out = recolorOption(option, lightFromDark) as typeof option
    expect(out.a).toBe(LIGHT.accent)
    expect(out.b).toBe('#123456')
    expect(out.c).toBe(3)
    expect(out.d).toBe(fmt)
    expect(out.e).toBeNull()
  })

  it('does not mutate its input', () => {
    const option = { color: [DARK.palette[0]] }
    recolorOption(option, lightFromDark)
    expect(option.color[0]).toBe(DARK.palette[0])
  })

  // A rebuilt copy would be a plain lookalike with the prototype — and echarts' own
  // instanceof checks — gone, so anything that is not a `{}` literal is passed through
  // by identity. Plain-object gradients are NOT in that group: they are literals, so
  // they are walked and their token stops swapped like any other nested color.
  it('passes non-plain objects through by identity but walks plain gradient literals', () => {
    const when = new Date('2026-09-03T00:00:00Z')
    const bytes = new Float64Array([1, 2])
    const option = {
      markLine: { data: [{ xAxis: when }] },
      series: [
        { type: 'line', data: bytes },
        {
          type: 'bar',
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: DARK.positive },
                { offset: 1, color: 'rgba(63, 185, 104, 0.05)' },
              ],
            },
          },
        },
      ],
    }
    const out = recolorOption(option, lightFromDark) as {
      markLine: { data: [{ xAxis: Date }] }
      series: [
        { data: Float64Array },
        { itemStyle: { color: { colorStops: { offset: number; color: string }[] } } },
      ]
    }
    // Same objects, not equal-looking copies: `toBe`, and the Date still a real Date.
    expect(out.markLine.data[0].xAxis).toBe(when)
    expect(out.markLine.data[0].xAxis.getTime()).toBe(when.getTime())
    expect(out.series[0].data).toBe(bytes)
    const stops = out.series[1].itemStyle.color.colorStops
    expect(stops[0].color).toBe(LIGHT.positive)
    expect(stops[1].color).toBe('rgba(63, 185, 104, 0.05)') // rgba() is not a token hex
  })
})

// The dark set spends four hexes on two token names each (#1e222c, #262b36, #3987e5,
// #c98500) while the light set splits three of them — warn/palette[3] is NOT split, since
// tokens.ts keeps one amber per theme, so both names write #996500 — so the map has to
// elect a winner per hex, and the ramp's shared step has to survive inside a visualMap
// array. Pinned here because the election lives in one easily-reordered list in recolor.ts.
describe('shared dark hexes', () => {
  it('elects the meaning that reaches an option, and keeps ramp position inside arrays', () => {
    const out = recolorOption(
      {
        lone: DARK.palette[0], // === DARK.sequential[6]
        ramp: [DARK.sequential[5], DARK.sequential[6], DARK.sequential[7]],
        pairOnly: [DARK.palette[0]], // a one-color array is a color, not a scale
        bar: DARK.palette[3], // === DARK.warn
        panel: DARK.surface2, // === DARK.gridLine
        edge: DARK.border, // === DARK.axisLine
      },
      lightFromDark,
    ) as Record<string, string | string[]>
    expect(out.lone).toBe(LIGHT.palette[0])
    expect(out.ramp).toEqual([LIGHT.sequential[5], LIGHT.sequential[6], LIGHT.sequential[7]])
    expect(out.pairOnly).toEqual([LIGHT.palette[0]])
    expect(out.bar).toBe(LIGHT.palette[3])
    expect(out.panel).toBe(LIGHT.surface2)
    expect(out.edge).toBe(LIGHT.border)
  })

  // The exact edges of "is this array a ramp?", because both answers are visible: ramp =
  // mapped by SCALE POSITION, elementwise = #3987e5 resolves to the categorical palette[0].
  it('ramp mode: two steps suffice; one foreign leaf drops the array to elementwise', () => {
    expect(recolorOption([DARK.sequential[6], DARK.sequential[7]], lightFromDark)).toEqual([
      LIGHT.sequential[6],
      LIGHT.sequential[7],
    ])
    // PALETTE[0] IS step 6: an all-ramp-hex array is a ramp by construction, however the
    // builder spelled its entries.
    expect(recolorOption([DARK.palette[0], DARK.sequential[9]], lightFromDark)).toEqual([
      LIGHT.sequential[6],
      LIGHT.sequential[9],
    ])
    // One non-token hex disqualifies the WHOLE array — the shared step falls back to
    // palette[0], the lone-color winner.
    expect(recolorOption([DARK.sequential[6], '#123456'], lightFromDark)).toEqual([
      LIGHT.palette[0],
      '#123456',
    ])
    // Same for a non-string leaf (echarts accepts numeric data in color-ish arrays).
    expect(recolorOption([DARK.sequential[6], 7], lightFromDark)).toEqual([LIGHT.palette[0], 7])
  })

  // Position mapping is only safe while the two scales are the same length and every dark
  // hex has a light twin. tokens.ts makes `sequential` a 12-tuple to force the first half
  // at compile time; this is the runtime half (a duplicated hex inside one palette would
  // silently shrink the map without changing any length).
  it('every dark chart hex has a light twin in the map', () => {
    for (const hex of DARK.sequential) {
      expect(lightFromDark.get('ramp:' + hex.toLowerCase())).toBeDefined()
      expect(lightFromDark.get(hex.toLowerCase())).toBeDefined()
    }
    for (const hex of DARK.palette) expect(lightFromDark.get(hex.toLowerCase())).toBeDefined()
    expect(DARK.sequential).toHaveLength(LIGHT.sequential.length)
    expect(DARK.palette).toHaveLength(LIGHT.palette.length)
  })
})
