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
})

// The dark set spends four hexes on two token names each (#1e222c, #262b36, #3987e5,
// #c98500) while the light set splits every one of them, so the map has to elect a winner
// per hex — and the ramp's shared step has to survive inside a visualMap array. Pinned
// here because the election lives in one easily-reordered list in recolor.ts.
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
})
