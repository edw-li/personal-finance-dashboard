import { describe, expect, it } from 'vitest'
import { INK, MUTED, SURFACE } from './theme'
import {
  BAR_MARKS, GRID_VARIANTS, LINE, MONEY_GRID, STACK_WASH, WASH, capLabel, cents, compactMoney,
  dateAxis, grid, isGridVariant, moneyAxis, monthAxis, niceStep, pctAxis, percentLabel, robustMax, roundTo, stagger,
} from './grammar'

describe('grids', () => {
  it('MONEY_GRID is the eight-builder literal and every variant differs from it in one named way', () => {
    expect(MONEY_GRID).toEqual({ left: 70, right: 24, top: 40, bottom: 28 })
    expect(GRID_VARIANTS.noLegend).toEqual({ left: 70, right: 24, top: 16, bottom: 28 })
    expect(GRID_VARIANTS.endLabel).toEqual({ left: 70, right: 84, top: 40, bottom: 28 })
    expect(GRID_VARIANTS.horizontal).toEqual({ left: 130, right: 40, top: 8, bottom: 28 })
    expect(GRID_VARIANTS.heatmap).toEqual({ left: 130, right: 24, top: 8, bottom: 96 })
    expect(GRID_VARIANTS.fan).toEqual({ left: 76, right: 24, top: 40, bottom: 28 })
    // The fan's left inset with the endLabel variant's right one: room for pin names.
    expect(GRID_VARIANTS.fanEndLabel).toEqual({ left: 76, right: 84, top: 40, bottom: 28 })
  })
  it('grid() returns a COPY of a variant and defaults to the money grid', () => {
    const g = grid()
    expect(g).toEqual(MONEY_GRID)
    expect(g).not.toBe(MONEY_GRID)
    expect(grid('heatmap')).toEqual(GRID_VARIANTS.heatmap)
  })
  it('isGridVariant recognises exactly the named shapes', () => {
    expect(isGridVariant({ left: 70, right: 24, top: 40, bottom: 28 })).toBe(true)
    expect(isGridVariant({ left: 70, right: 16, top: 12, bottom: 28 })).toBe(false) // the old trend literal
    expect(isGridVariant(GRID_VARIANTS.fanEndLabel)).toBe(true)
    expect(isGridVariant({ left: 70, right: 24, top: 40, bottom: 28, containLabel: true })).toBe(false)
    expect(isGridVariant(undefined)).toBe(false)
  })
})

describe('axes', () => {
  it('moneyAxis: zero-anchored by default, scale:true only when asked, log when asked', () => {
    // hideOverlap on every value axis (2026-09-23 spec §C3): a label that would print over its
    // neighbour is dropped rather than drawn as a smear.
    expect(moneyAxis()).toEqual({ type: 'value', axisLabel: { formatter: compactMoney, hideOverlap: true } })
    expect(moneyAxis({ zero: false })).toEqual({ type: 'value', scale: true, axisLabel: { formatter: compactMoney, hideOverlap: true } })
    expect(moneyAxis({ log: true })).toEqual({ type: 'log', axisLabel: { formatter: compactMoney, hideOverlap: true } })
    // The formatter is the grammar's function BY IDENTITY — what conformance checks.
    expect(moneyAxis().axisLabel.formatter).toBe(compactMoney)
    expect(compactMoney(1500)).toBe('$1.5K')
    expect(compactMoney(1_450_000)).toBe('$1.45M')
  })
  it('pctAxis reproduces the savings-rate extents and labels whole percents', () => {
    const axis = pctAxis()
    expect(axis.min({ min: -1.8 })).toBe(-2) // floors to a whole −100% step
    expect(axis.min({ min: 0.4 })).toBe(-1) // never above the −100% floor
    expect(axis.max({ max: 0.6 })).toBe(0.6)
    expect(axis.max({ max: 1.7 })).toBe(1) // rates above 100% are impossible
    expect(axis.max({ max: -0.5 })).toBe(0.1)
    expect(axis.axisLabel.formatter).toBe(percentLabel)
    expect(percentLabel(0.35)).toBe('35%')
    expect(pctAxis({ floor: 0, ceiling: 2 }).min({ min: 0.5 })).toBe(0)
  })
  it('monthAxis: no boundary gap for lines, gap for bars, interval 0 at 12 categories or fewer', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `M${i}`)
    const thirteen = [...twelve, 'M12']
    expect(monthAxis(twelve)).toEqual({ type: 'category', data: twelve, boundaryGap: false, axisLabel: { interval: 0 } })
    expect(monthAxis(thirteen)).toEqual({ type: 'category', data: thirteen, boundaryGap: false })
    expect(monthAxis(thirteen, { gap: true })).toEqual({ type: 'category', data: thirteen })
    expect(monthAxis(thirteen, { gap: true, rotate: 45 })).toEqual({ type: 'category', data: thirteen, axisLabel: { rotate: 45 } })
    expect(dateAxis(['Aug 10, 2026', 'Aug 11, 2026'])).toEqual({
      type: 'category', data: ['Aug 10, 2026', 'Aug 11, 2026'], boundaryGap: false, axisLabel: { interval: 0 },
    })
  })
})

describe('marks', () => {
  it('BAR_MARKS carries the surface hairline, the 22px cap and series focus', () => {
    expect(BAR_MARKS).toEqual({
      barMaxWidth: 22,
      itemStyle: { borderColor: SURFACE, borderWidth: 1 },
      emphasis: { focus: 'series', itemStyle: { borderColor: INK } },
    })
  })
  it('LINE, WASH and STACK_WASH are the line-chart literals', () => {
    expect(LINE).toEqual({ type: 'line', symbol: 'none', lineStyle: { width: 2 }, emphasis: { focus: 'series' } })
    expect(WASH).toEqual({ areaStyle: { opacity: 0.12 } })
    expect(STACK_WASH).toEqual({ lineStyle: { width: 1 }, areaStyle: { opacity: 0.5 } })
  })
  it('capLabel is the waterfall/cap direct-label block with the caller formatter', () => {
    const f = (p: { dataIndex: number }) => `#${p.dataIndex}`
    expect(capLabel(f)).toEqual({ show: true, position: 'top', color: MUTED, fontSize: 11, formatter: f })
  })
})

describe('rounding and stagger', () => {
  it('roundTo/cents land float dust back on the requested places', () => {
    expect(roundTo(601854.46 - 188930, 2)).toBe(412924.46)
    expect(cents(38 * 183.2508)).toBe(6963.53)
    expect(roundTo(0.30602 * 100, 4)).toBe(30.602)
  })
  it('stagger is a FUNCTION delay (invisible to the JSON fingerprint) of 12ms per series', () => {
    const s = stagger(3)
    expect(typeof s.animationDelay).toBe('function')
    expect(s.animationDelay()).toBe(36)
    expect(JSON.stringify({ a: 1, ...stagger(2) })).toBe('{"a":1}')
  })
})

// 2026-09-23 spec §C3: one early month no longer sets the scale.
describe('robust axes', () => {
  it('niceStep is echarts’ own round-nice step: 1, 2, 3, 5 or 10 × 10^k', () => {
    expect(niceStep(2027)).toBe(2000)
    expect(niceStep(2800)).toBe(3000)
    expect(niceStep(1400)).toBe(1000)
    expect(niceStep(5200)).toBe(5000)
    expect(niceStep(7500)).toBe(10000)
    expect(niceStep(0.362)).toBe(0.3)
    expect(niceStep(0)).toBe(1)
  })

  it('never clips normal data', () => {
    const months = Array.from({ length: 36 }, (_, i) => 3000 + ((i * 677) % 6000))
    expect(robustMax(months)).toBeNull()
    // A handful of points cannot call one of them an outlier.
    expect(robustMax([100, 100, 100, 5000])).toBeNull()
    expect(robustMax([])).toBeNull()
    expect(robustMax([null, undefined, -5, 0])).toBeNull()
  })

  it('clips the audit’s Aug-2023 net pay: nice(p95 × 1.15), on a step echarts would draw', () => {
    // 37 ordinary months of $2–9.9K stacks and pay, plus the one $25,937.48 import artefact.
    const ordinary = Array.from({ length: 74 }, (_, i) => 2000 + ((i * 1013) % 7900))
    const robust = robustMax([...ordinary, 25937.48])
    expect(robust).not.toBeNull()
    const sorted = [...ordinary, 25937.48].sort((a, b) => a - b)
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
    expect(robust!.max).toBeGreaterThanOrEqual(p95 * 1.15)
    expect(robust!.max).toBeLessThan(25937.48)
    // The max sits ON the interval grid, so echarts prints no odd extra top label.
    expect(Number.isInteger(Math.round((robust!.max / robust!.interval) * 1e9) / 1e9)).toBe(true)
    expect(robust).toEqual({ max: 12000, interval: 2000 })
  })

  it('moneyAxis carries a robust extent when one is handed over, and nothing otherwise', () => {
    expect(moneyAxis({ robust: { max: 12000, interval: 2000 } })).toEqual({
      type: 'value', max: 12000, interval: 2000, axisLabel: { formatter: compactMoney, hideOverlap: true },
    })
    expect(moneyAxis({ robust: null })).toEqual(moneyAxis())
  })

  it('pctAxis with values clamps the floor at −100% and puts the max one nice step above the data', () => {
    // The audit's savings rates: −1,073% (Sep 2023) and an 81% best month.
    const clamped = pctAxis({ values: [-10.73, 0.81, 0.35, null] })
    expect(clamped).toEqual({ type: 'value', min: -1, max: 1, interval: 0.5, axisLabel: { formatter: percentLabel, hideOverlap: true } })
    // A modest best month: a finer step, still landing on the floor's grid.
    expect(pctAxis({ values: [0.35, -0.2] })).toMatchObject({ min: -1, max: 0.5, interval: 0.25 })
    // Every month negative: one step above zero keeps the baseline on screen (−100%…+20% in
    // six steps of 20).
    expect(pctAxis({ values: [-0.5, -0.3] })).toMatchObject({ min: -1, max: 0.2, interval: 0.2 })
    // Rates above the ceiling are clipped, never stretch it.
    expect(pctAxis({ values: [1.3, 0.2] })).toMatchObject({ max: 1 })
    // No data at all: the same plain −100%…+20% frame.
    expect(pctAxis({ values: [] })).toMatchObject({ min: -1, max: 0.2, interval: 0.2 })
  })

  it('pctAxis without values keeps the function extents (the share charts) and gains hideOverlap', () => {
    const axis = pctAxis({ floor: 0, ceiling: 1 }) as { min: (e: { min: number }) => number; axisLabel: unknown }
    expect(axis.min({ min: 0.5 })).toBe(0)
    expect(axis.axisLabel).toEqual({ formatter: percentLabel, hideOverlap: true })
  })

})
