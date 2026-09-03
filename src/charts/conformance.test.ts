import { describe, expect, it } from 'vitest'
import { checkConformance } from './conformance'
import type { ChartFixture } from './fixtures/_types'
import { BAR_MARKS, LINE, compactMoney, grid, moneyAxis, monthAxis, stagger } from './grammar'
import { legendFor } from './legend'
import { PALETTE } from './theme'
import { axisTooltip } from './tooltip'

// Vite's glob keeps the walk declarative: dropping a fixture file removes its cases, adding
// one adds them — nothing to register.
const modules = import.meta.glob<{ default: ChartFixture }>('./fixtures/*.fixture.ts', { eager: true })
export const fixtures = Object.values(modules).map((m) => m.default)

describe('conformance over the fixtures', () => {
  it('finds the three grammar fixtures at least', () => {
    expect(fixtures.map((f) => f.name)).toEqual(expect.arrayContaining(['grammar-line', 'grammar-stack', 'grammar-heatmap']))
  })
  for (const fixture of fixtures) {
    it(`${fixture.name} conforms`, () => {
      const option = fixture.build()
      expect(option, `${fixture.name} built null`).not.toBeNull()
      expect(checkConformance(option, fixture)).toEqual([])
    })
  }
})

// The rules must be able to FAIL: each negative case is one deviation from a conforming
// option, and the message names the rule.
describe('conformance rules reject', () => {
  const base = (): Record<string, unknown> => ({
    grid: grid(),
    legend: legendFor(2),
    tooltip: axisTooltip({ pointer: 'shadow' }),
    xAxis: monthAxis(['Jun 2026'], { gap: true }),
    yAxis: moneyAxis(),
    series: [
      { type: 'bar', name: 'A', stack: 's', ...BAR_MARKS, ...stagger(0), color: PALETTE[0], data: [1] },
      { type: 'bar', name: 'B', stack: 's', ...BAR_MARKS, ...stagger(1), color: PALETTE[1], data: [1] },
    ],
  })
  const fixture: ChartFixture = { name: 'neg', kind: 'cartesian', ariaLabel: 'x', build: () => null }
  const only = (option: Record<string, unknown>) => checkConformance(option, fixture)

  it('accepts the conforming base', () => expect(only(base())).toEqual([]))
  it('a literal grid', () => expect(only({ ...base(), grid: { left: 70, right: 16, top: 12, bottom: 28 } })[0]).toMatch(/grid/))
  it('a non-token colour, wherever it hides', () => {
    const o = base()
    ;(o.series as { color: string }[])[0].color = '#123456'
    expect(only(o)[0]).toMatch(/color #123456/)
    const nested = base()
    ;(nested.series as { data: unknown[] }[])[0].data = [{ value: 1, itemStyle: { color: 'rgba(0,0,0,0.5)' } }]
    expect(only(nested)[0]).toMatch(/color rgba/)
  })
  it('an inline axis formatter', () => {
    const o = base()
    o.yAxis = { type: 'value', axisLabel: { formatter: (v: number) => compactMoney(v) } }
    expect(only(o)[0]).toMatch(/formatter/)
  })
  it('an unbranded tooltip', () => expect(only({ ...base(), tooltip: { trigger: 'axis', formatter: () => '' } })[0]).toMatch(/branded/))
  it('a 46px bar or a bar without the surface border', () => {
    const wide = base()
    ;(wide.series as { barMaxWidth: number }[])[0].barMaxWidth = 46
    expect(only(wide)[0]).toMatch(/barMaxWidth/)
    const bare = base()
    ;(bare.series as { itemStyle: unknown }[])[0].itemStyle = { borderWidth: 1 }
    expect(only(bare)[0]).toMatch(/SURFACE border/)
  })
  it('a nine-entry plain legend', () => {
    const o = base()
    o.legend = { top: 0, type: 'plain' }
    o.series = Array.from({ length: 9 }, (_, i) => ({ type: 'bar', name: `S${i}`, stack: 's', ...BAR_MARKS, ...stagger(i), color: PALETTE[i % 8], data: [1] }))
    expect(only(o)[0]).toMatch(/scroll/)
  })
  it('a dashed DATA line', () => {
    const o = base()
    ;(o.series as unknown[]).push({ ...LINE, name: 'Data', lineStyle: { width: 2, type: 'dashed' }, color: PALETTE[2], data: [1] })
    expect(only(o)[0]).toMatch(/dashed/)
  })
  it('a stacked bar without a stagger', () => {
    const o = base()
    delete (o.series as Record<string, unknown>[])[1].animationDelay
    expect(only(o)[0]).toMatch(/stagger/)
  })
})
