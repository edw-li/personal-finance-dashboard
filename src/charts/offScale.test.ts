import { describe, expect, it } from 'vitest'
import { percentLabel } from './formatters'
import { offScaleMarkPoint, offScaleMarks } from './offScale'

// Moved from grammar.test.ts with the code (charts/offScale.ts).
describe('off-scale markers', () => {
  it('offScaleMarkPoint pins clipped values to the edge with their true value and an arrow', () => {
    const up = offScaleMarkPoint([{ x: 'Aug 2023', value: 25937.48 }], { edge: 12000, direction: 'up', color: '#e6e9ef', unit: 'money' })
    expect(up).toEqual({
      silent: true,
      symbol: 'triangle',
      symbolSize: 8,
      symbolRotate: 0,
      itemStyle: { color: '#e6e9ef' },
      label: { show: true, color: '#8b93a3', fontSize: 11, position: 'bottom' },
      data: [{ name: 'Aug 2023', coord: ['Aug 2023', 12000], value: 25937.48, label: { formatter: '$25.9K ↑' } }],
    })
    const down = offScaleMarkPoint([{ x: 'Sep 2023', value: -10.7312, lift: 13 }], { edge: -1, direction: 'down', color: '#3987e5', unit: 'percent' })
    expect(down?.symbolRotate).toBe(180)
    expect(down?.label.position).toBe('top')
    expect(down?.data).toEqual([{ name: 'Sep 2023', coord: ['Sep 2023', -1], value: -10.7312, label: { formatter: '-1073% ↓', offset: [0, -13] } }])
    expect(offScaleMarkPoint([], { edge: 1, direction: 'up', color: '#3987e5', unit: 'money' })).toBeUndefined()
  })

  it('offScaleMarkPoint keeps the triangle and drops the text of a mark whose label is off', () => {
    const marks = offScaleMarkPoint([{ x: 'Oct 2023', value: -1.98, label: false }], { edge: -1, direction: 'down', color: '#3987e5', unit: 'percent' })
    expect(marks?.data).toEqual([{ name: 'Oct 2023', coord: ['Oct 2023', -1], value: -1.98, label: { show: false } }])
  })

  // The browser found it: production's Sep–Dec 2023 are four savings rates under −100% side by
  // side, and in the "All" view their four labels printed over each other ("-1071598%76%5% ↓").
  describe('offScaleMarks', () => {
    const text = (value: number) => percentLabel(value)
    it('labels one mark per run of neighbouring clipped months, the most extreme, and keeps every triangle', () => {
      const run = [
        { index: 1, x: 'Sep 2023', value: -10.73 },
        { index: 2, x: 'Oct 2023', value: -1.98 },
        { index: 3, x: 'Nov 2023', value: -1.76 },
        { index: 4, x: 'Dec 2023', value: -1.55 },
      ]
      expect(offScaleMarks([run], { direction: 'down', minGap: 6, lift: 13, text })).toEqual([[
        { x: 'Sep 2023', value: -10.73 },
        { x: 'Oct 2023', value: -1.98, label: false },
        { x: 'Nov 2023', value: -1.76, label: false },
        { x: 'Dec 2023', value: -1.55, label: false },
      ]])
    })
    it('labels clipped months far enough apart on their own; above the ceiling the highest is the extreme', () => {
      const apart = [{ index: 0, x: 'Jan', value: -2 }, { index: 10, x: 'Nov', value: -3 }]
      expect(offScaleMarks([apart], { direction: 'down', minGap: 6, lift: 13, text })).toEqual([[{ x: 'Jan', value: -2 }, { x: 'Nov', value: -3 }]])
      const up = [{ index: 0, x: 'A', value: 5 }, { index: 1, x: 'B', value: 9 }]
      expect(offScaleMarks([up], { direction: 'up', minGap: 2, lift: 13, text })).toEqual([[{ x: 'A', value: 5, label: false }, { x: 'B', value: 9 }]])
    })
    it('lifts a later series whose cluster an earlier one already labels, unless the two print as one', () => {
      const total = [{ index: 5, x: 'Jun', value: -1.5 }]
      // A neighbouring month is the same place for a 60px label: lifted.
      expect(offScaleMarks([total, [{ index: 6, x: 'Jul', value: -2.5 }]], { direction: 'down', minGap: 3, lift: 13, text })).toEqual([
        [{ x: 'Jun', value: -1.5 }],
        [{ x: 'Jul', value: -2.5, lift: 13 }],
      ])
      // The same text at the same month reads as one label: left where it is.
      expect(offScaleMarks([total, [{ index: 5, x: 'Jun', value: -1.5 }]], { direction: 'down', minGap: 3, lift: 13, text })[1]).toEqual([
        { x: 'Jun', value: -1.5 },
      ])
      // Apart: nothing to dodge.
      expect(offScaleMarks([total, [{ index: 9, x: 'Oct', value: -2.5 }]], { direction: 'down', minGap: 3, lift: 13, text })[1]).toEqual([
        { x: 'Oct', value: -2.5 },
      ])
    })
  })
})
