import { describe, expect, it } from 'vitest'
import { tooltipRows } from '../testing/tooltipRows'
import { DIVERGING, INK, MUTED, OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE } from './theme'
import { axisTooltip, brandTooltip, isGrammarTooltip, itemTooltip, swatch } from './tooltip'

const P = (over: Record<string, unknown>) => ({ seriesType: 'bar', color: PALETTE[0], ...over })

describe('axisTooltip row order', () => {
  it('header, groups by value desc, Total, other data, references, annotations, footer', () => {
    const { formatter } = axisTooltip({
      unit: 'money',
      groups: ['Rent', 'Food', 'Other'],
      shareOf: true,
      references: ['Sustainable spend'],
      annotationSeries: ['Notes'],
      annotations: (p) => [`note: ${String((p.data as { note?: string }).note)}`],
      footer: (index) => [`index ${index}`],
    })
    const html = formatter([
      P({ seriesName: 'Food', axisValueLabel: 'Jun 2026', dataIndex: 3, value: 300 }),
      P({ seriesName: 'Rent', value: 1500 }),
      P({ seriesName: 'Other', value: 200, color: OTHER_SERIES_COLOR }),
      P({ seriesName: 'Net pay', seriesType: 'line', value: 6000, color: INK }),
      P({ seriesName: 'Sustainable spend', seriesType: 'line', value: 4100.5, color: MUTED }),
      P({ seriesName: 'Notes', seriesType: 'scatter', value: ['Jun 2026', 6000], data: { note: 'moved' } }),
    ])
    const parsed = tooltipRows(html)
    expect(parsed.head).toBe('Jun 2026')
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Rent', '$1,500.00 (75.0%)'],
      ['row', 'Food', '$300.00 (15.0%)'],
      ['row', 'Other', '$200.00 (10.0%)'],
      ['total', 'Total', '$2,000.00'],
      ['row', 'Net pay', '$6,000.00'],
      ['ref', 'Sustainable spend', '$4,100.50'],
    ])
    expect(parsed.notes).toEqual(['note: moved'])
    expect(parsed.foot).toEqual(['index 3'])
  })

  it('drops null/NaN rows (never dashes), prints absentText once when no group row is finite, and totals only real rows', () => {
    const { formatter } = axisTooltip({ groups: ['Rent'], absentText: 'no spending entered' })
    const parsed = tooltipRows(
      formatter([
        P({ seriesName: 'Rent', axisValueLabel: 'Aug 2026', value: null }),
        P({ seriesName: 'Net pay', seriesType: 'line', value: 6000 }),
      ]),
    )
    expect(parsed.rows.map((r) => r.label)).toEqual(['Net pay'])
    expect(parsed.notes).toEqual(['no spending entered'])
    expect(formatter([P({ seriesName: 'Rent', value: Number.NaN })])).toContain('no spending entered')
    // Nothing finite, no absent text → no tooltip at all.
    expect(axisTooltip().formatter([P({ seriesName: 'Rent', value: null })])).toBe('')
    expect(axisTooltip().formatter([])).toBe('')
  })

  it('escapes every series name, the header and suffixes unconditionally', () => {
    const { formatter } = axisTooltip({ rowSuffix: () => '<est.>' })
    const html = formatter([P({ seriesName: '<b>Fun</b>', axisValueLabel: '<i>Jun</i>', value: 1 })])
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;Fun&lt;/b&gt; &lt;est.&gt;')
    expect(tooltipRows(html).head).toBe('&lt;i&gt;Jun&lt;/i&gt;')
  })

  it('formats by unit and can drop the Total row', () => {
    expect(tooltipRows(axisTooltip({ unit: 'percent' }).formatter([P({ seriesName: 'Savings', value: 0.35 })])).rows[0].value).toBe('35.0%')
    expect(tooltipRows(axisTooltip({ unit: 'shares' }).formatter([P({ seriesName: 'Vest', value: 1822 })])).rows[0].value).toBe('1,822')
    const noTotal = axisTooltip({ groups: ['Base', 'Equity'], totalLabel: false }).formatter([
      P({ seriesName: 'Base', value: 100 }),
      P({ seriesName: 'Equity', value: 50 }),
    ])
    expect(tooltipRows(noTotal).rows.map((r) => r.kind)).toEqual(['row', 'row'])
  })

  it('paints swatches with CSS variables, a 10×2 stroke for lines and an 8×8 square for bars/stack members', () => {
    const html = axisTooltip({ groups: ['Cash'] }).formatter([
      P({ seriesName: 'Cash', seriesType: 'line', color: PALETTE[0], value: 1 }),
      P({ seriesName: 'Net worth', seriesType: 'line', color: INK, value: 2 }),
    ])
    expect(html).toContain('<i class="chart-tip-swatch" style="background:var(--chart-1)"></i>')
    expect(html).toContain('<i class="chart-tip-swatch is-line" style="background:var(--text)"></i>')
  })

  it('carries the shadow pointer only when asked, and the class always', () => {
    expect(axisTooltip({ pointer: 'shadow' })).toMatchObject({ trigger: 'axis', className: 'chart-tip', axisPointer: { type: 'shadow' } })
    expect('axisPointer' in axisTooltip()).toBe(false)
    expect(isGrammarTooltip(axisTooltip().formatter)).toBe(true)
    expect(isGrammarTooltip(() => '')).toBe(false)
    const own = brandTooltip(() => 'x')
    expect(isGrammarTooltip(own)).toBe(true)
  })
})

describe('swatch', () => {
  it('maps token hexes to variables, falls back to the hex, and washes on request', () => {
    expect(swatch(PALETTE[3])).toContain('var(--chart-4)')
    expect(swatch(OTHER_SERIES_COLOR)).toContain('var(--other-series)')
    expect(swatch(SEQUENTIAL_BLUE[9])).toContain(`background:${SEQUENTIAL_BLUE[9]}`)
    expect(swatch(PALETTE[0], { wash: true })).toContain('is-wash')
    expect(swatch(undefined)).toContain('var(--muted)') // an unknown color can never inject
    expect(swatch('javascript:alert(1)')).toContain('var(--muted)')
  })

  // The diverging ramp DOES get variables (--diverge-1…9, tokens.ts cssDeclarations), so a
  // "vs average" heatmap's swatch follows the theme instead of staying dark on light — the
  // documented §7 cost is the SEQUENTIAL ramp alone, which no palette emits.
  it('maps every diverging step to its --diverge-N variable', () => {
    expect(DIVERGING.map((hex) => swatch(hex))).toEqual(
      DIVERGING.map(
        (_, i) => `<i class="chart-tip-swatch" style="background:var(--diverge-${i + 1})"></i>`,
      ),
    )
  })
})

describe('itemTooltip', () => {
  it('lays the value first, then the escaped label and sub; null body → no tooltip', () => {
    const { formatter, trigger } = itemTooltip<{ name?: string; value?: number }>({
      body: (p) => (p.name ? { value: p.value ?? 0, label: p.name, sub: '75.0% of tax' } : null),
    })
    expect(trigger).toBe('item')
    const parsed = tooltipRows(formatter({ name: '<b>x</b>', value: 3000 }))
    expect(parsed.lead).toBe('$3,000.00')
    expect(parsed.label).toBe('&lt;b&gt;x&lt;/b&gt;')
    expect(parsed.sub).toBe('75.0% of tax')
    expect(formatter({ name: '' })).toBe('')
    expect(formatter([{ name: 'a', value: 1 }])).toContain('$1.00') // echarts may hand an array
    // A pre-formatted string value passes through (escaped), for "56.0% of tax"-style leads.
    const pct = itemTooltip<{ v: string }>({ body: (p) => ({ value: p.v, label: 'Federal' }) })
    expect(tooltipRows(pct.formatter({ v: '56.0%' })).lead).toBe('56.0%')
    expect(isGrammarTooltip(pct.formatter)).toBe(true)
  })
})
