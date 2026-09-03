import { describe, expect, it } from 'vitest'
import { divergingVisualMap, rowNormalize, sequentialVisualMap, vsAverage } from './scales'
import { DIVERGING, MUTED, SEQUENTIAL_BLUE } from './theme'
import { formatCurrencyCompact } from '../utils/format'

describe('sequentialVisualMap', () => {
  it('is the heatmap literal: horizontal bar under the grid, the blue ramp, muted text', () => {
    const vm = sequentialVisualMap({ min: 0, max: 900, formatter: formatCurrencyCompact })
    expect(vm).toMatchObject({
      min: 0, max: 900, calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: [...SEQUENTIAL_BLUE] }, textStyle: { color: MUTED },
    })
    expect(vm.formatter(1500)).toBe('$1.5K')
    expect('text' in vm).toBe(false)
    expect(sequentialVisualMap({ min: 0, max: 1, formatter: String, labels: ['row max', '0'] }).text).toEqual(['row max', '0'])
  })
})

describe('divergingVisualMap', () => {
  it('spans symmetrically around the centre; blue carries the high end by default, orange on request', () => {
    const blueHigh = divergingVisualMap({ span: 0.5, formatter: String })
    expect(blueHigh).toMatchObject({ type: 'continuous', min: -0.5, max: 0.5, inRange: { color: [...DIVERGING] } })
    const orangeHigh = divergingVisualMap({ span: 1, center: 0, formatter: String, highArm: 'orange', labels: ['above', 'below'] })
    expect(orangeHigh.inRange.color).toEqual([...DIVERGING].reverse())
    expect(orangeHigh.text).toEqual(['above', 'below'])
    expect(divergingVisualMap({ span: 2, center: 10, formatter: String })).toMatchObject({ min: 8, max: 12 })
  })
})

describe('rowNormalize', () => {
  it('scales each row to its own 0 → max, keeps nulls, and zeroes an all-zero row', () => {
    expect(rowNormalize([[100, 50, null, 0], [0, 0, 0, 0], [null, 8]])).toEqual([
      [1, 0.5, null, 0],
      [0, 0, 0, 0],
      [null, 1],
    ])
  })
})

describe('vsAverage', () => {
  it('is the ratio to the trailing mean of prior non-null months, blank until six prior months exist', () => {
    const row = [100, 100, 100, 100, 100, 100, 150, null, 50]
    const out = vsAverage([row])[0]
    expect(out.slice(0, 6)).toEqual([null, null, null, null, null, null]) // fewer than six priors
    expect(out[6]).toBeCloseTo(0.5, 6) // 150 vs mean 100
    expect(out[7]).toBeNull() // the month itself is absent
    // Index 8: priors are the 12 before it minus the null = seven values, mean (600+150)/7.
    expect(out[8]).toBeCloseTo(50 / (750 / 7) - 1, 6)
  })
  it('honours the window and the minimum, and blanks a zero mean', () => {
    expect(vsAverage([[5, 5, 10]], { window: 2, minPrior: 2 })[0]).toEqual([null, null, 1])
    expect(vsAverage([[0, 0, 5]], { window: 2, minPrior: 2 })[0]).toEqual([null, null, null])
  })
})
