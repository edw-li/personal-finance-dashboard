import { describe, expect, it } from 'vitest'
import { spendingBarsTooltipFormatter, spendingCsv } from './spendingChartOptions'

const format = spendingBarsTooltipFormatter(['Rent', '<b>Fun</b>', 'Other'])

describe('spendingBarsTooltipFormatter', () => {
  it('gives each category its share of the month and closes them with a Total row', () => {
    const html = format([
      { seriesName: 'Rent', marker: '[1]', axisValueLabel: 'Jun 2026', value: 1500 },
      { seriesName: '<b>Fun</b>', marker: '[2]', value: 300 },
      { seriesName: 'Other', marker: '[3]', value: 200 },
      { seriesName: 'Net pay', marker: '[n]', value: 6000 },
      { seriesName: '4% rule', marker: '[f]', value: 4100.5 },
    ])
    expect(html).toBe(
      '<strong>Jun 2026</strong><br/>' +
        '[1]Rent: $1,500.00 (75.0%)<br/>' +
        '[2]&lt;b&gt;Fun&lt;/b&gt;: $300.00 (15.0%)<br/>' +
        '[3]Other: $200.00 (10.0%)<br/>' +
        '<strong>Total: $2,000.00</strong><br/>' +
        '[n]Net pay: $6,000.00<br/>' +
        '[f]4% rule: $4,100.50',
    )
  })

  it('drops the shares when the month nets to zero or below (a refund month)', () => {
    const html = format([
      { seriesName: 'Rent', marker: '', axisValueLabel: 'Jun 2026', value: 100 },
      { seriesName: 'Other', marker: '', value: -100 },
    ])
    expect(html).toContain('Rent: $100.00<br/>')
    expect(html).toContain('<strong>Total: $0.00</strong>')
    expect(html).not.toContain('%')
  })

  it('says "no spending entered" on a cashflow-only month, reference lines after it', () => {
    // A6: a month whose category rows are all null is ABSENT — the tooltip must say so
    // instead of listing every category at $0.00; net pay still lists (it is real).
    const html = format([
      { seriesName: 'Rent', marker: '', axisValueLabel: 'Jun 2026', value: null },
      { seriesName: 'Net pay', marker: '[n]', value: 6000 },
    ])
    expect(html).toBe(
      '<strong>Jun 2026</strong><br/>no spending entered<br/>[n]Net pay: $6,000.00',
    )
    expect(html).not.toContain('Total:')
  })

  it('names a fully-absent month instead of going silent', () => {
    expect(format([{ seriesName: 'Rent', axisValueLabel: 'Aug 2026', value: null }])).toBe(
      '<strong>Aug 2026</strong><br/>no spending entered',
    )
    // No params at all: still nothing to say.
    expect(format([])).toBe('')
  })
})

describe('spendingCsv', () => {
  it('lays out month rows × top categories + Other + Total + Net pay, verbatim strings', () => {
    const matrix = {
      months: ['2026-06-01', '2026-07-01'],
      series: [
        { category_id: 1, values: ['2000.00', '2000.00'], budgets: [null, null] },
        { category_id: 2, values: ['150.00', null], budgets: [null, null] }, // folded
      ],
      totals: ['2150.00', '2000.00'],
      net_pay: ['6000.00', null],
    }
    expect(spendingCsv(matrix, [1], new Map([[1, 'Rent']]))).toEqual({
      headers: ['Month', 'Rent', 'Other', 'Total', 'Net pay'],
      rows: [
        ['2026-06-01', '2000.00', '150.00', '2150.00', '6000.00'],
        // null cells go EMPTY, never '0.00' — absent is not zero; Other re-sums the fold.
        ['2026-07-01', '2000.00', '0.00', '2000.00', ''],
      ],
    })
  })

  it('keeps an absent month byte-identical — CSV output is deliberately unchanged by A6', () => {
    const matrix = {
      months: ['2026-08-01'],
      series: [
        { category_id: 1, values: [null], budgets: [null] },
        { category_id: 2, values: [null], budgets: [null] },
      ],
      totals: ['0.00'],
      net_pay: ['6000.00'],
    }
    expect(spendingCsv(matrix, [1], new Map([[1, 'Rent']])).rows).toEqual([
      ['2026-08-01', '', '0.00', '0.00', '6000.00'],
    ])
  })
})
