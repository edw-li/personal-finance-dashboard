import { describe, expect, it } from 'vitest'
import { SANKEY_MARKS, claimNodeName, makeSankeyTooltipFormatter } from './sankey'
import type { SankeyLink, SankeyNode } from './sankey'
import { INK } from './theme'

describe('claimNodeName', () => {
  it('passes a free name through and registers it as taken', () => {
    const taken = new Set(['Net pay'])
    expect(claimNodeName('Rent', taken)).toBe('Rent')
    expect(taken.has('Rent')).toBe(true)
  })

  it('suffixes a collision visibly and keeps every claim unique', () => {
    const taken = new Set(['Taxes'])
    expect(claimNodeName('Taxes', taken)).toBe('Taxes (spending)')
    // A pathological second collision still resolves — uniqueness is the contract that
    // keeps echarts alive (duplicate names crash sankey setOption, 2026-08-25 incident).
    expect(claimNodeName('Taxes', taken)).toBe('Taxes (spending 2)')
    expect(taken.size).toBe(3)
  })
})

const NODES: SankeyNode[] = [
  { name: 'Net pay', value: 5000, itemStyle: { color: '#8b93a3' } },
  { name: '<b>Rent</b>', value: 2000, itemStyle: { color: '#3987e5' } },
]
const LINKS: SankeyLink[] = [{ source: 'Net pay', target: '<b>Rent</b>', value: 2000 }]

describe('SANKEY_MARKS', () => {
  it('pins the shared mark spec both flow charts wear (spec §2)', () => {
    expect(SANKEY_MARKS.type).toBe('sankey')
    expect(SANKEY_MARKS.orient).toBe('horizontal')
    expect(SANKEY_MARKS.nodeWidth).toBe(12)
    expect(SANKEY_MARKS.nodeGap).toBe(8)
    expect(SANKEY_MARKS.draggable).toBe(false)
    // 0 = vertical node order is DATA order — both builders emit a meaningful order.
    expect(SANKEY_MARKS.layoutIterations).toBe(0)
    expect(SANKEY_MARKS.itemStyle).toEqual({ borderWidth: 0, borderRadius: 2 })
    expect(SANKEY_MARKS.lineStyle).toEqual({ color: 'source', opacity: 0.3 })
    expect(SANKEY_MARKS.emphasis).toEqual({ focus: 'adjacency' })
    expect(SANKEY_MARKS.label).toEqual({ color: INK })
  })
})

describe('makeSankeyTooltipFormatter', () => {
  const format = makeSankeyTooltipFormatter(NODES, LINKS)

  it('formats a node from the closed-over map, name escaped', () => {
    const html = format({ dataType: 'node', name: '<b>Rent</b>' })
    expect(html).toContain('$2,000.00')
    expect(html).toContain('&lt;b&gt;Rent&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('formats an edge from the closed-over map, both endpoints escaped', () => {
    const html = format({ dataType: 'edge', data: { source: 'Net pay', target: '<b>Rent</b>' } })
    expect(html).toContain('$2,000.00')
    expect(html).toContain('Net pay')
    expect(html).toContain('&lt;b&gt;Rent&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('never invents a value: unknown identities and junk params answer empty', () => {
    expect(format({ dataType: 'node', name: 'nope' })).toBe('')
    expect(format({ dataType: 'edge', data: { source: 'a', target: 'b' } })).toBe('')
    expect(format({ dataType: 'edge' })).toBe('')
    expect(format(null)).toBe('')
    // echarts hands item-trigger formatters a lone object, but tolerate the array form.
    expect(format([{ dataType: 'node', name: 'Net pay' }])).toContain('$5,000.00')
  })
})
