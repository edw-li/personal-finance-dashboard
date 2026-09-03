import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE, POSITIVE } from '../../charts/theme'
import type { PaycheckBreakdownOut, PaycheckProfileOut } from '../../types/api'
import { paycheckSankeyCsv, paycheckSankeyOption } from './paycheckSankeyOptions'

// The Workbook reference profile (PaycheckPage.test.tsx's golden fixture). Its display-
// rounded lines deliberately do NOT reconcile (post_tax 4486.26 vs 236.16 + 865.93 +
// 3384.16 = 4486.25) — exactly the drift the tooltip rule below exists for.
const profile: PaycheckProfileOut = {
  id: 1,
  person_id: 1,
  effective_date: '2026-01-01',
  annual_salary: '188930.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.130000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000',
  espp_pct: '0.110000000',
  withholding_pct: '0.334009167',
  dental_vision_per_check: '12.50',
  hsa_per_check: '100.00',
  hsa_coverage: 'self',
  notes: null,
}

function breakdown(over: Partial<PaycheckBreakdownOut> = {}): PaycheckBreakdownOut {
  return {
    profile,
    gross: '7872.08',
    trad_401k: '1023.37',
    dental_vision: '12.50',
    hsa: '100.00',
    taxable: '6736.21',
    withholding: '2249.96',
    post_tax: '4486.26',
    roth_401k: '0.00',
    after_tax_401k: '236.16',
    espp: '865.93',
    net_pay: '3384.16',
    monthly_net: '6768.33',
    warnings: [],
    // The sankey reads none of it — the pace strip is a sibling card, not a flow node.
    pace: [],
    ...over,
  }
}

// --- option readers (historyChartOptions.test.ts posture) -------------------------------
interface NodeLike {
  name?: string
  value?: number
  depth?: number
  itemStyle?: { color?: string }
}
interface LinkLike {
  source?: string
  target?: string
  value?: number
}
interface SankeyLike {
  type?: string
  data?: NodeLike[]
  links?: LinkLike[]
}
function sankeyOf(option: EChartsOption): SankeyLike {
  return (option as unknown as { series: SankeyLike[] }).series[0]
}
function tooltipOf(option: EChartsOption): (params: unknown) => string {
  return (option as unknown as { tooltip: { formatter: (params: unknown) => string } })
    .tooltip.formatter
}

describe('paycheckSankeyOption', () => {
  it('draws the waterfall as a 4-column flow, zero branches omitted', () => {
    const option = paycheckSankeyOption(breakdown())
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    expect(series.type).toBe('sankey')
    // roth_401k is 0.00: the branch is OMITTED, not drawn at zero width (spec §4).
    expect(series.data?.map((n) => n.name)).toEqual([
      'Gross',
      'Taxable',
      'Post-tax',
      'Traditional 401(k)',
      'Dental & vision',
      'HSA',
      'Withholding',
      'After-tax 401(k)',
      'ESPP',
      'Net pay',
    ])
    // Explicit columns: intermediates 0/1/2; every terminal sits at its NATURAL column —
    // the one right after the stage it leaves (pre-tax beside Taxable, Withholding beside
    // Post-tax) — so no link ever spans a column (2026-08-28 revision: the old right-
    // aligned depth-3 pin drew Gross→401(k) ribbons straight across the top-aligned
    // Taxable/Post-tax bars).
    expect(series.data?.map((n) => n.depth)).toEqual([0, 1, 2, 1, 1, 1, 2, 3, 3, 3])
    expect(series.links).toEqual([
      { source: 'Gross', target: 'Traditional 401(k)', value: 1023.37 },
      { source: 'Gross', target: 'Dental & vision', value: 12.5 },
      { source: 'Gross', target: 'HSA', value: 100 },
      { source: 'Gross', target: 'Taxable', value: 6736.21 },
      { source: 'Taxable', target: 'Withholding', value: 2249.96 },
      { source: 'Taxable', target: 'Post-tax', value: 4486.26 },
      { source: 'Post-tax', target: 'After-tax 401(k)', value: 236.16 },
      { source: 'Post-tax', target: 'ESPP', value: 865.93 },
      { source: 'Post-tax', target: 'Net pay', value: 3384.16 },
    ])
  })

  it('keeps intermediates gray, terminals on their FIXED waterfall slots, net pay green', () => {
    const colorOf = (option: EChartsOption, name: string) =>
      sankeyOf(option).data?.find((n) => n.name === name)?.itemStyle?.color
    const option = paycheckSankeyOption(breakdown())!
    expect(colorOf(option, 'Gross')).toBe(MUTED)
    expect(colorOf(option, 'Taxable')).toBe(MUTED)
    expect(colorOf(option, 'Post-tax')).toBe(MUTED)
    expect(colorOf(option, 'Traditional 401(k)')).toBe(PALETTE[0])
    expect(colorOf(option, 'Dental & vision')).toBe(PALETTE[1])
    expect(colorOf(option, 'HSA')).toBe(PALETTE[2])
    expect(colorOf(option, 'Withholding')).toBe(PALETTE[3])
    // Roth (slot 4) is omitted this check — After-tax keeps ITS slot 5: slots are fixed
    // per ENTITY, so an omitted zero branch never reshuffles its neighbours' hues.
    expect(colorOf(option, 'After-tax 401(k)')).toBe(PALETTE[5])
    expect(colorOf(option, 'ESPP')).toBe(PALETTE[6])
    expect(colorOf(option, 'Net pay')).toBe(POSITIVE)
    const withRoth = paycheckSankeyOption(breakdown({ roth_401k: '150.00' }))!
    expect(colorOf(withRoth, 'Roth 401(k)')).toBe(PALETTE[4])
  })

  it('tooltips echo the TABLE figures, never link sums (rounding honesty, spec §4)', () => {
    const format = tooltipOf(paycheckSankeyOption(breakdown())!)
    // Post-tax's outgoing links sum to 4486.25 — a cent off its own table line. The
    // tooltip must say what the table says.
    expect(format({ dataType: 'node', name: 'Post-tax' })).toContain('$4,486.26')
    expect(
      format({ dataType: 'edge', data: { source: 'Post-tax', target: 'Net pay' } }),
    ).toContain('$3,384.16')
  })

  it('skips the chart when any figure is negative — the table stays the correct surface', () => {
    expect(paycheckSankeyOption(breakdown({ net_pay: '-120.00' }))).toBeNull()
    expect(
      paycheckSankeyOption(
        breakdown({ taxable: '-1.00', post_tax: '-2251.00', net_pay: '-5000.00' }),
      ),
    ).toBeNull()
  })

  it('is null on an all-zero check (nothing to draw)', () => {
    const zeros: Partial<PaycheckBreakdownOut> = {
      gross: '0.00',
      trad_401k: '0.00',
      dental_vision: '0.00',
      hsa: '0.00',
      taxable: '0.00',
      withholding: '0.00',
      post_tax: '0.00',
      roth_401k: '0.00',
      after_tax_401k: '0.00',
      espp: '0.00',
      net_pay: '0.00',
    }
    expect(paycheckSankeyOption(breakdown(zeros))).toBeNull()
  })
})

it('exports nodes then links, the TABLE figures (never link sums)', () => {
  const csv = paycheckSankeyCsv(breakdown())
  expect(csv.headers).toEqual(['Kind', 'Source', 'Target', 'Value'])
  expect(csv.rows).toContainEqual(['node', 'Post-tax', '', '4486.26'])
  expect(csv.rows).toContainEqual(['link', 'Post-tax', 'Net pay', '3384.16'])
  expect(paycheckSankeyCsv(breakdown({ net_pay: '-1.00' })).rows).toEqual([])
})
