import { describe, expect, it } from 'vitest'
import { NOTES_SERIES, netWorthCsv, netWorthStackedTooltipFormatter } from './netWorthChartOptions'

const ASSETS = ['Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other']
const format = netWorthStackedTooltipFormatter(ASSETS)

describe('netWorthStackedTooltipFormatter', () => {
  it('subtotals the asset rows before liabilities and net worth', () => {
    const html = format([
      { seriesName: 'Cash', marker: '[c]', axisValueLabel: 'Aug 2026', value: 1000 },
      { seriesName: 'Taxable', marker: '[t]', value: 4000.5 },
      { seriesName: 'Liabilities', marker: '[l]', value: -250 },
      { seriesName: 'Net worth', marker: '[n]', value: 4750.5 },
    ])
    expect(html).toBe(
      '<strong>Aug 2026</strong><br/>' +
        '[c]Cash: $1,000.00<br/>' +
        '[t]Taxable: $4,000.50<br/>' +
        '<strong>Assets: $5,000.50</strong><br/>' +
        '[l]Liabilities: -$250.00<br/>' +
        '[n]Net worth: $4,750.50',
    )
  })

  it('keeps the Notes branch: user text escaped, never a money row', () => {
    const html = format([
      { seriesName: 'Cash', marker: '', axisValueLabel: 'Aug 2026', value: 10 },
      { seriesName: NOTES_SERIES, marker: '[d]', data: { note: 'sold <em>car</em>' } },
    ])
    expect(html).toContain('[d]sold &lt;em&gt;car&lt;/em&gt;')
    expect(html).not.toContain('<em>car</em>')
    expect(html).toContain('<strong>Assets: $10.00</strong>')
  })

  it('dashes a non-finite row without letting it dent the subtotal', () => {
    const html = format([
      { seriesName: 'Cash', marker: '', axisValueLabel: 'Aug 2026', value: 10 },
      { seriesName: 'Equity', marker: '', value: null },
    ])
    expect(html).toContain('Equity: —')
    expect(html).toContain('<strong>Assets: $10.00</strong>')
  })

  it('skips the subtotal when nothing under the pointer is an asset row', () => {
    const html = format([
      { seriesName: 'Net worth', marker: '', axisValueLabel: 'Aug 2026', value: 4750.5 },
    ])
    expect(html).not.toContain('Assets:')
    expect(format([])).toBe('')
  })
})

describe('netWorthCsv', () => {
  it('lays out month rows × the seven group columns + net worth, verbatim strings', () => {
    const csv = netWorthCsv({
      months: ['2026-07-01', '2026-08-01'],
      group_totals: {
        cash: ['100.00', '110.00'], pre_tax: ['200.00', '210.00'],
        post_tax: ['300.00', '310.00'], taxable: ['400.00', '410.00'],
        equity: ['500.00', '510.00'], other: ['0.00', '0.00'],
        liability: ['-50.00', '-40.00'],
      },
      net_worth: ['1450.00', '1500.00'],
    })
    expect(csv.headers).toEqual([
      'Month', 'Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other',
      'Liabilities', 'Net worth',
    ])
    expect(csv.rows).toEqual([
      ['2026-07-01', '100.00', '200.00', '300.00', '400.00', '500.00', '0.00', '-50.00', '1450.00'],
      ['2026-08-01', '110.00', '210.00', '310.00', '410.00', '510.00', '0.00', '-40.00', '1500.00'],
    ])
  })
})
