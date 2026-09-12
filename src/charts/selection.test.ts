import { describe, expect, it } from 'vitest'
import { initialZoomWindow, selectionFromOption, selectionFromRow } from './selection'
import { isApplicationSource } from '../types/metrics'

describe('source-based chart selection', () => {
  it('pins all series at a category period without parsing tooltip text', () => {
    const selection = selectionFromOption({ xAxis: { type: 'category', data: ['2026-07', '2026-08'] }, series: [
      { name: 'Assets', type: 'line', data: [100, 130] },
      { name: 'Debt', type: 'bar', data: [-10, -20] },
    ] }, { seriesIndex: 0, dataIndex: 1, name: '2026-08', value: 'THIS IS NOT A SOURCE VALUE' }, 'wealth')
    expect(selection).toMatchObject({ label: '2026-08', values: [{ label: 'Assets', value: 130 }, { label: 'Debt', value: -20 }] })
    expect(selection?.source).toBeUndefined()
  })
  it('resolves nested treemap records and Sankey links from the correct source data', () => {
    expect(selectionFromOption({ series: [{ type: 'treemap', data: [{ name: 'Stocks', children: [{ name: 'ABC', value: 42 }] }] }] }, { name: 'ABC', dataIndex: 4 }, 'allocation')?.values[0].value).toBe(42)
    expect(selectionFromOption({ series: [{ type: 'sankey', data: [{ name: 'Pay' }, { name: 'Cash' }], links: [{ source: 'Pay', target: 'Cash', value: 90 }] }] }, { dataType: 'edge', dataIndex: 0 }, 'cashflow')).toMatchObject({ kind: 'flow', sourceId: 'Pay', targetId: 'Cash', values: [{ label: 'Flow', value: 90 }] })
  })
  it('retains missing cells as unavailable and explicit zero as zero in keyboard readouts', () => {
    const table = { headers: ['Month', 'Income', 'Saved'], rows: [['2026-08', '', 0]] }
    expect(selectionFromRow(table, table.rows[0], 0, 'spending').values).toEqual([{ label: 'Month', value: '2026-08' }, { label: 'Income', value: null }, { label: 'Saved', value: 0 }])
  })
  it('uses the actual initial category end for Reset zoom', () => {
    expect(initialZoomWindow({ xAxis: { data: ['a', 'b', 'c'] }, dataZoom: [{ type: 'inside', startValue: 1 }] })).toEqual({ startValue: 1, endValue: 2 })
  })
  it('only links to known app routes', () => {
    expect(isApplicationSource('/portfolio?section=holdings&owner=2')).toBe(true)
    for (const bad of ['//evil.example', 'javascript:alert(1)', '/api/auth', '/settings\\evil', '/settings\n']) expect(isApplicationSource(bad)).toBe(false)
  })
})
