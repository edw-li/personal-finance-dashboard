import { describe, expect, it } from 'vitest'
import { spendingBarsTooltipFormatter } from './spendingChartOptions'

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

  it('lists reference lines without a Total when no category row is under the pointer', () => {
    const html = format([
      { seriesName: 'Net pay', marker: '', axisValueLabel: 'Jun 2026', value: 6000 },
    ])
    expect(html).toContain('Net pay: $6,000.00')
    expect(html).not.toContain('Total:')
  })

  it('returns an empty string when nothing under the pointer is finite', () => {
    expect(format([{ seriesName: 'Net pay', value: null }])).toBe('')
    expect(format([])).toBe('')
  })
})
