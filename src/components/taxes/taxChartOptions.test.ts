import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import {
  OTHER_SERIES_COLOR,
  PALETTE,
  POSITIVE,
  SEQUENTIAL_BLUE,
  SURFACE,
} from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import type { TaxSummaryOut } from '../../types/api'
import {
  TAX_COLORS,
  TAX_LABELS,
  TAX_SERIES_IDS,
  WATERFALL_CATEGORIES,
  ladderCsv,
  marginalLadderOption,
  taxTrendCsv,
  trendOption,
  waterfallCsv,
  waterfallOption,
  yearPieCsv,
  yearPieOption,
} from './taxChartOptions'
import type { LadderRow } from './taxChartOptions'

// --- the golden summaries -------------------------------------------------------------
// Wire shape of GET /taxes/years/{y}/summary (pydantic v2 serialises Decimal as strings).
// The seven `.tax` fields and every `totals` figure are the canonical table, 2023-2026, at
// cents — those are what the two builders read and what the pins below assert. The
// agi/taxable_income/w2_income/taxable_wages fields are the same table's (and the sheet's
// cached wage rows); the per-jurisdiction `effective_rate`s are those cents values divided,
// so they can sit one unit off the API's full-precision 6dp quotient in the last place —
// nothing in this file reads them, and the two rates that ARE exact (capital gains = the
// bracket rate, and totals) carry the engine's pinned strings.
// mirrors backend tests/test_tax_service.py _CANONICAL_TABLE — derivations live there

interface YearFacts {
  fedTax: string
  fedAgi: string
  fedTi: string
  fedRate: string
  stateTax: string
  stateAgi: string
  stateTi: string
  stateRate: string
  w2Income: string
  medicareWages: string
  medicareTax: string
  medicareRate: string
  ssWages: string
  ssTax: string
  ssRate: string
  sdiWages: string
  sdiTax: string
  sdiRate: string
  cgAmount: string
  cgTax: string
  cgRate: string | null
  niitBase: string
  niitNii: string
  niitTax: string
  niitRate: string | null
  grossIncome: string
  totalIncome: string
  totalTax: string
  takeHome: string
  effectiveRate: string
}

const CANONICAL: Record<number, YearFacts> = {
  2023: {
    fedTax: '18330.39', fedAgi: '117726.64', fedTi: '103876.64', fedRate: '0.155703',
    stateTax: '7158.49', stateAgi: '119875.28', stateTi: '114512.28', stateRate: '0.059716',
    w2Income: '105065.08',
    medicareWages: '102822.40', medicareTax: '1490.92', medicareRate: '0.014190',
    ssWages: '102822.40', ssTax: '6374.99', ssRate: '0.060677',
    sdiWages: '104989.08', sdiTax: '944.90', sdiRate: '0.008993',
    cgAmount: '129.00', cgTax: '19.35', cgRate: '0.150000',
    // MAGI under the threshold: the NII is computed but never surcharged.
    niitBase: '0.00', niitNii: '21250.15', niitTax: '0.00', niitRate: '0.000000',
    grossIncome: '126321.23', totalIncome: '117726.64', totalTax: '34319.05',
    takeHome: '92002.18', effectiveRate: '0.271681',
  },
  2024: {
    fedTax: '40782.88', fedAgi: '211776.20', fedTi: '197176.20', fedRate: '0.192575',
    stateTax: '15901.12', stateAgi: '215301.15', stateTi: '209761.15', stateRate: '0.073855',
    w2Income: '235724.46',
    medicareWages: '231274.46', medicareTax: '3634.95', medicareRate: '0.015420',
    ssWages: '168600.00', ssTax: '10453.20', ssRate: '0.044345',
    sdiWages: '235424.46', sdiTax: '1950.00', sdiRate: '0.008272',
    cgAmount: '179.13', cgTax: '26.87', cgRate: '0.150000',
    niitBase: '1989.28', niitNii: '1989.28', niitTax: '75.59', niitRate: '0.038000',
    grossIncome: '237973.17', totalIncome: '211776.20', totalTax: '72824.61',
    takeHome: '165148.56', effectiveRate: '0.306020',
  },
  2025: {
    fedTax: '51355.09', fedAgi: '259376.05', fedTi: '232162.77', fedRate: '0.197995',
    stateTax: '20257.19', stateAgi: '263400.08', stateTi: '257694.08', stateRate: '0.076907',
    w2Income: '276176.78',
    medicareWages: '271576.78', medicareTax: '4582.05', medicareRate: '0.016591',
    ssWages: '176100.00', ssTax: '10918.20', ssRate: '0.039533',
    sdiWages: '275876.78', sdiTax: '2700.00', sdiRate: '0.009776',
    cgAmount: '1267.19', cgTax: '190.08', cgRate: '0.150000',
    niitBase: '11023.28', niitNii: '11023.28', niitTax: '418.88', niitRate: '0.038000',
    grossIncome: '287209.06', totalIncome: '259376.05', totalTax: '90421.49',
    takeHome: '196787.57', effectiveRate: '0.314828',
  },
  2026: {
    fedTax: '57160.35', fedAgi: '280128.21', fedTi: '250304.21', fedRate: '0.204051',
    stateTax: '22206.80', stateAgi: '284428.21', stateTi: '278722.21', stateRate: '0.078075',
    w2Income: '306694.03',
    medicareWages: '302094.03', medicareTax: '5299.21', medicareRate: '0.017278',
    ssWages: '176100.00', ssTax: '10918.20', ssRate: '0.035600',
    sdiWages: '306394.03', sdiTax: '3000.00', sdiRate: '0.009782',
    // No gains in 2026: the API's rate is null there (the sheet's #DIV/0!). No net
    // investment income either, so the NIIT rate is null for the same reason.
    cgAmount: '0.00', cgTax: '0.00', cgRate: null,
    niitBase: '0.00', niitNii: '0.00', niitTax: '0.00', niitRate: null,
    grossIncome: '306694.03', totalIncome: '280128.21', totalTax: '98584.56',
    takeHome: '208109.47', effectiveRate: '0.321443',
  },
}

function summaryFixture(year: number): TaxSummaryOut {
  const f = CANONICAL[year]
  return {
    year,
    federal: { agi: f.fedAgi, taxable_income: f.fedTi, tax: f.fedTax, effective_rate: f.fedRate },
    state: {
      agi: f.stateAgi, taxable_income: f.stateTi, tax: f.stateTax, effective_rate: f.stateRate,
    },
    medicare: {
      w2_income: f.w2Income, taxable_wages: f.medicareWages,
      tax: f.medicareTax, effective_rate: f.medicareRate,
    },
    social_security: {
      w2_income: f.w2Income, taxable_wages: f.ssWages, tax: f.ssTax, effective_rate: f.ssRate,
    },
    disability: {
      w2_income: f.w2Income, taxable_wages: f.sdiWages, tax: f.sdiTax, effective_rate: f.sdiRate,
    },
    capital_gains: {
      taxable_income: f.fedTi, gains_amount: f.cgAmount, tax: f.cgTax, effective_rate: f.cgRate,
    },
    niit: {
      taxable_income: f.niitBase, gains_amount: f.niitNii,
      tax: f.niitTax, effective_rate: f.niitRate,
    },
    totals: {
      gross_income: f.grossIncome,
      total_income: f.totalIncome,
      total_tax: f.totalTax,
      take_home: f.takeHome,
      effective_rate: f.effectiveRate,
    },
    warnings: [],
  }
}

// A year whose inputs were never filled in: every figure is 0 and the engine defaults the
// missing keys (the sparse-year shape the panel has to survive). `niit` is deliberately
// OMITTED here rather than zeroed: the section is optional on the wire (stored payloads
// predate it), and this fixture is what pins the absent-reads-as-zero path.
function emptySummary(year: number): TaxSummaryOut {
  const income = { agi: '0.00', taxable_income: '0.00', tax: '0.00', effective_rate: null }
  const wage = { w2_income: '0.00', taxable_wages: '0.00', tax: '0.00', effective_rate: null }
  return {
    year,
    federal: income,
    state: income,
    medicare: wage,
    social_security: wage,
    disability: wage,
    capital_gains: {
      taxable_income: '0.00', gains_amount: '0.00', tax: '0.00', effective_rate: null,
    },
    totals: {
      gross_income: '0.00', total_income: '0.00', total_tax: '0.00',
      take_home: '0.00', effective_rate: null,
    },
    warnings: ['missing inputs defaulted to 0: annual_salary, gross_paycheck'],
  }
}

// --- option readers -------------------------------------------------------------------
// EChartsOption is a wide union; these narrow it once so the assertions stay about the
// numbers (the same posture as SpendingPage's tooltip param narrowing).
interface SeriesLike {
  id?: string
  name?: string
  type?: string
  stack?: string
  stackStrategy?: string
  yAxisIndex?: number
  color?: string
  universalTransition?: boolean | { enabled?: boolean; seriesKey?: string[] }
  data?: unknown[]
}
interface BarPoint {
  name?: string
  value: number
  itemStyle?: { color?: string }
}
function seriesOf(option: EChartsOption | null): SeriesLike[] {
  expect(option).not.toBeNull()
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption | null): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

function points(series: SeriesLike): BarPoint[] {
  return (series.data ?? []) as BarPoint[]
}

describe('waterfallOption', () => {
  it('lays the nine categories out in the plan order on a NIIT year', () => {
    const option = waterfallOption(summaryFixture(2024))
    expect(categoriesOf(option)).toEqual([
      'Gross', 'Federal', 'State', 'Medicare', 'Soc. Sec.', 'SDI', 'Cap. gains', 'NIIT',
      'Take-home',
    ])
    expect(categoriesOf(option)).toEqual([...WATERFALL_CATEGORIES])
  })

  it('drops the NIIT step — and only that step — on a year the surcharge never touches', () => {
    // NIIT is the one ADDITIVE line: a year it does not reach keeps its eight familiar
    // bars instead of gaining a $0 step. The six sheet jurisdictions always draw, zero or
    // not (2026 has no capital gains and still gets its bar) — their absence would read
    // as missing data rather than as a tax that did not apply.
    expect(categoriesOf(waterfallOption(summaryFixture(2026)))).toEqual(
      WATERFALL_CATEGORIES.filter((c) => c !== 'NIIT'),
    )
  })

  it('pins the invisible placeholders to the 2024 running remainders', () => {
    const [placeholder, visible] = seriesOf(waterfallOption(summaryFixture(2024)))
    // Gross and Take-home stand on the floor; every tax floats on the remainder LEFT
    // after it is taken. 237973.17 - 40782.88 = 197190.29, - 15901.12 = 181289.17, …
    expect(placeholder.data).toEqual([
      0, 197190.29, 181289.17, 177654.22, 167201.02, 165251.02, 165224.15, 165148.56, 0,
    ])
    // Each visible segment is the server's own figure — never re-derived here.
    expect(points(visible).map((p) => p.value)).toEqual([
      237973.17, 40782.88, 15901.12, 3634.95, 10453.2, 1950, 26.87, 75.59, 165148.56,
    ])
    // Both bars are stacked on ONE stack: that is what makes the placeholder lift the
    // visible segment off the floor.
    expect(placeholder.stack).toBe(visible.stack)
  })

  it('lands the last remainder exactly on the server take-home', () => {
    const summary = summaryFixture(2024)
    const [placeholder] = seriesOf(waterfallOption(summary))
    const remainders = placeholder.data as number[]
    // NIIT is the last step on a year that carries it: what is left after it IS take-home,
    // to the cent, with no float dust (181289.17000000004 is what the raw chain produces).
    expect(remainders[7]).toBe(Number(summary.totals.take_home))
  })

  it('wears theme slots only — grey gross, ramped taxes, positive take-home', () => {
    const [, visible] = seriesOf(waterfallOption(summaryFixture(2024)))
    const colors = points(visible).map((p) => p.itemStyle?.color)
    expect(colors[0]).toBe(OTHER_SERIES_COLOR)
    expect(colors[8]).toBe(POSITIVE)
    expect(colors.slice(1, 8)).toEqual([...TAX_COLORS])
    // One hue family for the seven taxes (the ≤3-hue law's sequential-ramp escape).
    expect(TAX_COLORS.every((c) => (SEQUENTIAL_BLUE as readonly string[]).includes(c))).toBe(true)
    expect(TAX_COLORS).toHaveLength(TAX_LABELS.length)
  })

  it('draws a negative tax as a step back UP the remainder', () => {
    // State tax can go negative after exemption credits (the engine warns and keeps it).
    const summary = summaryFixture(2024)
    summary.state.tax = '-500.00'
    summary.totals.total_tax = '56423.49'
    summary.totals.take_home = '181549.68'
    const [placeholder, visible] = seriesOf(waterfallOption(summary))
    const remainders = placeholder.data as number[]
    // The segment spans [197190.29, 197690.29]: its foot is the LOWER of the two
    // remainders and its height is the size of the step, either way it points.
    expect(remainders[2]).toBe(197190.29)
    expect(points(visible)[2].value).toBe(500)
    expect(remainders[7]).toBe(Number(summary.totals.take_home))
  })

  it('keeps the walk stacked when the remainder crosses zero', () => {
    // Half-entered year: the wage figures are in but the income that pays them is not, so
    // total_tax (72824.61) is larger than gross and the remainder goes NEGATIVE partway
    // down. echarts' default stackStrategy 'samesign' refuses to stack a value on a base
    // of the other sign — every segment past the crossing would drop back to the axis and
    // the walk would read as a row of floor bars.
    const summary = summaryFixture(2024)
    summary.totals.gross_income = '50000.00'
    summary.totals.take_home = '-22824.61'
    const [placeholder, visible] = seriesOf(waterfallOption(summary))
    expect(placeholder.stackStrategy).toBe('all')
    expect(visible.stackStrategy).toBe('all')
    // The chain itself is unchanged, negatives and all: 50000 - 40782.88 = 9217.12,
    // - 15901.12 = -6684, - 3634.95 = -10318.95, …
    expect(placeholder.data).toEqual([
      0, 9217.12, -6684, -10318.95, -20772.15, -22722.15, -22749.02, -22824.61, 0,
    ])
    expect(points(visible).map((p) => p.value)).toEqual([
      50000, 40782.88, 15901.12, 3634.95, 10453.2, 1950, 26.87, 75.59, -22824.61,
    ])
    // And it still lands on the server's take-home — which is itself negative here.
    expect((placeholder.data as number[])[7]).toBe(Number(summary.totals.take_home))
  })

  it('rides the shared waterfall helper: 24px bars, money grid, item tooltip value-first with the remainder', () => {
    const option = waterfallOption(summaryFixture(2024))!
    const [placeholder, visible] = seriesOf(option) as (SeriesLike & {
      barMaxWidth?: number
      silent?: boolean
    })[]
    expect(placeholder.silent).toBe(true)
    expect(visible.barMaxWidth).toBe(24) // F13, was 46
    expect((option as { grid: unknown }).grid).toEqual(GRID_VARIANTS.default)
    const format = (option as { tooltip: { formatter: (p: unknown) => string } }).tooltip.formatter
    expect(isGrammarTooltip(format)).toBe(true)
    const federal = tooltipRows(format({ dataIndex: 1 }))
    expect(federal.lead).toBe('$40,782.88')
    expect(federal.label).toBe('Federal')
    expect(federal.sub).toBe('Left: $197,190.29')
    const gross = tooltipRows(format({ dataIndex: 0 }))
    expect(gross.lead).toBe('$237,973.17')
    expect(gross.sub).toBeUndefined()
    expect(format({ dataIndex: 99 })).toBe('')
  })

  it('exports the walk as a table', () => {
    expect(waterfallCsv(summaryFixture(2024)).headers).toEqual(['Step', 'Amount', 'Remaining'])
    expect(waterfallCsv(summaryFixture(2024)).rows[1]).toEqual(['Federal', '40782.88', '197190.29'])
    expect(waterfallCsv(summaryFixture(2024)).rows[0]).toEqual(['Gross', '237973.17', ''])
    expect(waterfallCsv(emptySummary(2026)).rows).toEqual([])
  })

  it('returns null for a year with nothing in it', () => {
    expect(waterfallOption(emptySummary(2026))).toBeNull()
  })
})

describe('TAX_COLORS', () => {
  it('walks UP one ramp from the first slot that clears the contrast floor', () => {
    const slots = TAX_COLORS.map((c) => (SEQUENTIAL_BLUE as readonly string[]).indexOf(c))
    // Index 4 is where the ramp starts clearing 3:1 on #171a21 (index 1 is 1.8:1), so the
    // seven taxes start there and never reach below it.
    expect(TAX_COLORS[0]).toBe(SEQUENTIAL_BLUE[4])
    expect(slots.every((slot) => slot >= 4)).toBe(true)
    // Strictly ascending: the ramp encodes POSITION in TAX_LABELS order, which is what
    // lets a waterfall step and a stack segment for the same tax wear one color — and it
    // puts the lightest slots on the smallest taxes, whose slivers need the contrast.
    expect(slots.slice(1).every((slot, i) => slot > slots[i])).toBe(true)
  })

  it('never uses the step that doubles as PALETTE[0] (the light recolor would pull it out of the ramp)', () => {
    expect(TAX_COLORS).not.toContain(PALETTE[0])
    expect(TAX_COLORS[2]).toBe(SEQUENTIAL_BLUE[7])
  })
})

describe('trendOption', () => {
  it('returns null when no year has a summary yet', () => {
    expect(trendOption([])).toBeNull()
  })

  it('stacks the seven taxes per year; the effective rate is a cap label, not an axis', () => {
    const option = trendOption([2023, 2024, 2025, 2026].map(summaryFixture))
    expect(categoriesOf(option)).toEqual(['2023', '2024', '2025', '2026'])

    const series = seriesOf(option)
    expect(series.slice(0, 7).map((s) => s.name)).toEqual([...TAX_LABELS])
    expect(series.slice(0, 7).map((s) => s.color)).toEqual([...TAX_COLORS])
    // One stack: the bars read as a composition of the year's total tax.
    expect(new Set(series.slice(0, 7).map((s) => s.stack)).size).toBe(1)
    expect(series[0].data).toEqual([18330.39, 40782.88, 51355.09, 57160.35])
    expect(series[1].data).toEqual([7158.49, 15901.12, 20257.19, 22206.8])
    expect(series[2].data).toEqual([1490.92, 3634.95, 4582.05, 5299.21])
    expect(series[3].data).toEqual([6374.99, 10453.2, 10918.2, 10918.2])
    expect(series[4].data).toEqual([944.9, 1950, 2700, 3000])
    expect(series[5].data).toEqual([19.35, 26.87, 190.08, 0])
    // 2023 and 2026 carry no surcharge, but the stack is here for EVERY year once one
    // year has it — a series that came and went across one chart would lie.
    expect(series[6].data).toEqual([0, 75.59, 418.88, 0])

    expect(series).toHaveLength(7) // no rate line (F15)
    expect(series.every((s) => s.type === 'bar')).toBe(true)
    const yAxis = (
      option as unknown as { yAxis: { type: string; axisLabel: { formatter: unknown } } }
    ).yAxis
    expect(Array.isArray(yAxis)).toBe(false) // one axis (F15)
    expect(yAxis.axisLabel.formatter).toBe(compactMoney)
    // The rate rides the TOP series' cap as a direct label — the 6dp fraction ×100, 1dp.
    const cap = (series[6] as { label?: { formatter: (p: { dataIndex: number }) => string } }).label!
    expect(cap.formatter({ dataIndex: 0 })).toBe('27.2%')
    expect(cap.formatter({ dataIndex: 1 })).toBe('30.6%')
    expect(series.slice(0, 6).every((s) => (s as { label?: unknown }).label === undefined)).toBe(
      true,
    )
    expect((series[0] as { barMaxWidth?: number }).barMaxWidth).toBe(24) // F13
    expect((option as unknown as { grid: unknown }).grid).toEqual(GRID_VARIANTS.default)
  })

  it('stacks NIIT only when some year in the feed carries it', () => {
    // 2024 has the surcharge, 2026 does not — one nonzero year brings the series for BOTH.
    const withNiit = seriesOf(trendOption([2024, 2026].map(summaryFixture)))
    expect(withNiit.map((s) => s.name)).toEqual([...TAX_LABELS])
    // A feed where NOBODY pays it drops the stack entirely: an all-zero series would add a
    // legend entry and a $0.00 tooltip row to every pre-NIIT year.
    const without = seriesOf(trendOption([summaryFixture(2026)]))
    expect(without.map((s) => s.name)).toEqual(TAX_LABELS.slice(0, -1))
    expect(without.map((s) => s.name)).not.toContain('NIIT')
  })

  it('orders the years ascending whatever order the feed arrived in', () => {
    const option = trendOption([2025, 2023, 2026, 2024].map(summaryFixture))
    expect(categoriesOf(option)).toEqual(['2023', '2024', '2025', '2026'])
    expect(seriesOf(option)[0].data).toEqual([18330.39, 40782.88, 51355.09, 57160.35])
  })

  it('sorts a COPY, leaving the array the caller handed it untouched', () => {
    const feed = [2025, 2023, 2026, 2024].map(summaryFixture)
    expect(categoriesOf(trendOption(feed))).toEqual(['2023', '2024', '2025', '2026'])
    // Array.prototype.sort mutates in place: without the [...years] copy this call would
    // reorder the panel's own useState array behind React's back.
    expect(feed.map((y) => y.year)).toEqual([2025, 2023, 2026, 2024])
  })

  it('F7/F15: jurisdictions by value, Total tax, then the rate as a footer line', () => {
    const option = trendOption([summaryFixture(2024)])!
    const format = (
      option as unknown as { tooltip: { formatter: (p: unknown) => string; axisPointer: unknown } }
    ).tooltip
    expect(format.axisPointer).toEqual({ type: 'shadow' })
    const parsed = tooltipRows(
      format.formatter([
        {
          seriesName: 'State',
          seriesType: 'bar',
          axisValueLabel: '2024',
          dataIndex: 0,
          value: 15901.12,
          color: TAX_COLORS[1],
        },
        { seriesName: 'Federal', seriesType: 'bar', value: 40782.88, color: TAX_COLORS[0] },
        { seriesName: 'SDI', seriesType: 'bar', value: null, color: TAX_COLORS[4] },
      ]),
    )
    // Jurisdictions by value desc, the total under them; the null row is dropped, never dashed.
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Federal', '$40,782.88'],
      ['row', 'State', '$15,901.12'],
      ['total', 'Total tax', '$56,684.00'],
    ])
    // The rate is a ratio, not another addend: it sits UNDER the sum as a footer line.
    expect(parsed.foot).toEqual(['Effective rate 30.6%'])
  })

  it('breaks the rate line where a year has no rate, and still stacks its zeros', () => {
    const sparse = emptySummary(2025)
    const option = trendOption([summaryFixture(2024), sparse])
    const series = seriesOf(option)
    expect(categoriesOf(option)).toEqual(['2024', '2025'])
    expect(series[0].data).toEqual([40782.88, 0])
    // The sparse fixture carries no `niit` section at all (a stored pre-NIIT payload):
    // absent reads as zero rather than throwing or blanking the stack.
    expect(series[6].data).toEqual([75.59, 0])
    // No rate to state for a year with no gross income: the cap label goes blank rather
    // than printing a 0.0% the engine never computed — and the tooltip drops its footer.
    expect(
      (series[6] as { label: { formatter: (p: { dataIndex: number }) => string } }).label.formatter({
        dataIndex: 1,
      }),
    ).toBe('')
    const format = (option as unknown as { tooltip: { formatter: (p: unknown) => string } }).tooltip
      .formatter
    expect(
      tooltipRows(
        format([
          {
            seriesName: 'Federal',
            seriesType: 'bar',
            axisValueLabel: '2025',
            dataIndex: 1,
            value: 0,
            color: TAX_COLORS[0],
          },
        ]),
      ).foot,
    ).toEqual([])
  })

  it('gives the seven stacks the stable ids the drill-in pie morphs from', () => {
    const series = seriesOf(trendOption([summaryFixture(2024)]))
    // universalTransition keys on id across notMerge setOption swaps — without both, a
    // drill-in is a hard cut instead of a morph (SpendingPage's cat-${id} idiom).
    expect(series.slice(0, 7).map((s) => s.id)).toEqual([...TAX_SERIES_IDS])
    expect(series.slice(0, 7).every((s) => s.universalTransition === true)).toBe(true)
    // §11: every stack member enters 12ms behind the one before it (a FUNCTION delay, so
    // the zoom fast path's JSON fingerprint never sees it).
    expect(
      series.every((s) => typeof (s as { animationDelay?: unknown }).animationDelay === 'function'),
    ).toBe(true)
  })

  it("feeds the panel's legend picks back in", () => {
    // F9: the card mirrors the user's legend picks back into the option, so a re-render
    // (a fresh year, a theme swap) does not un-hide what they hid.
    expect(
      trendOption([summaryFixture(2024)], { selected: { State: false } })!.legend,
    ).toMatchObject({ selected: { State: false } })
  })
})

describe('yearPieOption', () => {
  it('slices one year into the seven taxes, wearing the trend stack\'s own colors', () => {
    const option = yearPieOption(summaryFixture(2024))
    const series = seriesOf(option)[0]
    const data = points(series)
    // All seven are positive in 2024, NIIT included.
    expect(data.map((p) => p.name)).toEqual([...TAX_LABELS])
    expect(data.map((p) => p.value)).toEqual([
      40782.88, 15901.12, 3634.95, 10453.2, 1950, 26.87, 75.59,
    ])
    // Same color per jurisdiction as the stack segment it morphs from.
    expect(data.map((p) => p.itemStyle?.color)).toEqual([...TAX_COLORS])
    // The morph targets the trend's seven stacks and nothing else.
    expect(series.universalTransition).toEqual({ enabled: true, seriesKey: [...TAX_SERIES_IDS] })
  })

  it('draws only positive slices — zero and credit-negative taxes are not pie material', () => {
    // 2026 has neither capital gains nor a surcharge: five slices, not two zero-width
    // extras in the legend order.
    const noGains = points(seriesOf(yearPieOption(summaryFixture(2026)))[0])
    expect(noGains.map((p) => p.name)).toEqual([
      'Federal', 'State', 'Medicare', 'Soc. Sec.', 'SDI',
    ])
    expect(noGains.map((p) => p.name)).not.toContain('NIIT')
    // A credit-driven NEGATIVE state tax steps the waterfall back up, but a pie has no
    // way to draw it — the slice is excluded while the hint's totals stay the server's.
    const credit = summaryFixture(2024)
    credit.state.tax = '-500.00'
    const slices = points(seriesOf(yearPieOption(credit))[0])
    expect(slices.map((p) => p.name)).toEqual([
      'Federal', 'Medicare', 'Soc. Sec.', 'SDI', 'Cap. gains', 'NIIT',
    ])
  })

  it('returns null for a year with no drawable tax at all', () => {
    expect(yearPieOption(emptySummary(2026))).toBeNull()
  })

  it('F7: value first, the jurisdiction, "of tax" — a bare percent reads as a rate on income', () => {
    const format = (
      yearPieOption(summaryFixture(2024)) as unknown as {
        tooltip: { trigger: string; formatter: (p: unknown) => string }
      }
    ).tooltip
    expect(format.trigger).toBe('item')
    // 40782.88 of 72824.61 total tax is 56.0% — while the year's effective rate is 30.6%,
    // which is exactly the number a bare "56.0%" would be misread as.
    const parsed = tooltipRows(
      format.formatter({ name: 'Federal', value: 40782.88, percent: 56.0 }),
    )
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual([
      '$40,782.88',
      'Federal',
      '56.0% of tax',
    ])
  })

  it('exports the drawn slices', () => {
    expect(yearPieCsv(summaryFixture(2026))).toEqual({
      headers: ['Jurisdiction', 'Tax'],
      rows: [
        ['Federal', '57160.35'],
        ['State', '22206.80'],
        ['Medicare', '5299.21'],
        ['Soc. Sec.', '10918.20'],
        ['SDI', '3000.00'],
      ],
    })
  })
})

describe('taxTrendCsv', () => {
  it('lays out year × jurisdiction + total, ascending, verbatim server strings', () => {
    const y24 = summaryFixture(2024)
    const y26 = summaryFixture(2026)
    const csv = taxTrendCsv([y26, y24]) // deliberately unordered on the way in
    expect(csv.headers).toEqual([
      'Year', 'Federal', 'State', 'Medicare', 'Soc. Sec.', 'SDI', 'Cap. gains', 'NIIT',
      'Total tax',
    ])
    expect(csv.headers).toHaveLength(9)
    expect(csv.rows.map((r) => r[0])).toEqual([2024, 2026])
    expect(csv.rows[0]).toEqual([
      2024, y24.federal.tax, y24.state.tax, y24.medicare.tax, y24.social_security.tax,
      y24.disability.tax, y24.capital_gains.tax, y24.niit?.tax, y24.totals.total_tax,
    ])
    // Unlike the charts, the export keeps a FIXED shape: every row is as wide as the
    // header, so a pre-NIIT payload exports a zero rather than a hole.
    const legacy = summaryFixture(2025)
    delete legacy.niit
    expect(taxTrendCsv([legacy]).rows[0]).toEqual([
      2025, legacy.federal.tax, legacy.state.tax, legacy.medicare.tax,
      legacy.social_security.tax, legacy.disability.tax, legacy.capital_gains.tax, '0.00',
      legacy.totals.total_tax,
    ])
  })
})

describe('marginalLadderOption', () => {
  const fedRow: LadderRow = {
    label: 'Federal',
    taxableIncome: 50000,
    segments: [
      { rate: 0.1, floor: 0, ceiling: 11600, current: false },
      { rate: 0.12, floor: 11600, ceiling: 47150, current: false },
      { rate: 0.22, floor: 47150, ceiling: 100525, current: true },
      { rate: 0.24, floor: 100525, ceiling: null, current: false },
    ],
  }
  const stateRow: LadderRow = {
    label: 'State',
    taxableIncome: 60000,
    segments: [
      { rate: 0.01, floor: 0, ceiling: 10000, current: false },
      { rate: 0.093, floor: 10000, ceiling: null, current: true },
    ],
  }

  it('stacks one series per bracket slot plus the income marker', () => {
    const option = marginalLadderOption([fedRow, stateRow])!
    const series = option.series as {
      name: string
      type: string
      stack?: string
      data: ({ value: number; itemStyle: { color: string } } | null | (number | string)[])[]
    }[]
    // Four bracket slots (the deeper table's count) + the marker.
    expect(series).toHaveLength(5)
    expect(series.slice(0, 4).every((s) => s.stack === 'ladder')).toBe(true)
    // Spans are the bracket widths; the CURRENT bracket takes the bright slot, the rest
    // alternate the two mid tones so adjacent segments read apart.
    const fed0 = series[0].data[0] as { value: number; itemStyle: { color: string } }
    const fed2 = series[2].data[0] as { value: number; itemStyle: { color: string } }
    expect(fed0.value).toBe(11600)
    expect(fed0.itemStyle.color).toBe(SEQUENTIAL_BLUE[5])
    expect(fed2.value).toBe(53375) // 100525 − 47150
    expect(fed2.itemStyle.color).toBe(SEQUENTIAL_BLUE[10])
    // The state lane has two brackets: slots 3 and 4 hold nothing for it.
    expect(series[2].data[1]).toBeNull()
    expect(series[3].data[1]).toBeNull()
    // The marker rides last, one diamond per lane at that lane's own taxable income.
    expect(series[4].name).toBe('Taxable income')
    expect(series[4].type).toBe('scatter')
    expect(series[4].data).toEqual([
      [50000, 'Federal'],
      [60000, 'State'],
    ])
  })

  it('caps the open top bracket 15% past the larger of income and top floor', () => {
    const option = marginalLadderOption([fedRow, stateRow])!
    const series = option.series as { data: ({ value: number } | null)[] }[]
    // Federal: max(50000, 100525) × 1.15 = 115603.75 → span 15078.75.
    expect((series[3].data[0] as { value: number }).value).toBe(15078.75)
    // State: max(60000, 10000) × 1.15 = 69000 → span 59000.
    expect((series[1].data[1] as { value: number }).value).toBe(59000)
  })

  it('grammar: no-legend grid, compact money X axis, 24px bars with the surface hairline', () => {
    const option = marginalLadderOption([fedRow, stateRow])! as unknown as {
      grid: unknown
      xAxis: { type: string; axisLabel: { formatter: unknown } }
      series: { barMaxWidth?: number; itemStyle?: unknown }[]
    }
    expect(option.grid).toEqual(GRID_VARIANTS.noLegend)
    expect(option.xAxis.type).toBe('value')
    expect(option.xAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.series[0].barMaxWidth).toBe(24)
    expect(option.series[0].itemStyle).toEqual({ borderColor: SURFACE, borderWidth: 1 })
  })

  it('F7: a cell reads rate first, then the jurisdiction, then the range; the marker reads the income', () => {
    const option = marginalLadderOption([fedRow, stateRow])! as unknown as {
      tooltip: { formatter: (p: unknown) => string }
      series: { tooltip?: { formatter: (p: unknown) => string } }[]
    }
    const cell = tooltipRows(option.tooltip.formatter({ dataIndex: 0, seriesIndex: 2 }))
    expect([cell.lead, cell.label, cell.sub]).toEqual([
      '22.0%',
      'Federal bracket',
      '$47,150.00 – $100,525.00',
    ])
    const top = tooltipRows(option.tooltip.formatter({ dataIndex: 1, seriesIndex: 1 }))
    expect(top.sub).toBe('$10,000.00 and up')
    expect(option.tooltip.formatter({ dataIndex: 1, seriesIndex: 3 })).toBe('') // the state lane has two brackets
    const marker = tooltipRows(option.series[4].tooltip!.formatter({ dataIndex: 1 }))
    expect([marker.lead, marker.label]).toEqual(['$60,000.00', 'State taxable income'])
  })

  it('exports every bracket per lane', () => {
    const csv = ladderCsv([fedRow, stateRow])
    expect(csv.headers).toEqual(['Jurisdiction', 'Bracket', 'Rate', 'From', 'To'])
    expect(csv.rows[2]).toEqual(['Federal', 3, '0.22', '47150.00', '100525.00'])
    expect(csv.rows[5]).toEqual(['State', 2, '0.093', '10000.00', ''])
  })

  it('returns null with nothing drawable', () => {
    expect(marginalLadderOption([])).toBeNull()
    // A one-bracket table at $0 on a zero-income year caps at 0 — an empty lane, not a bar.
    expect(
      marginalLadderOption([
        {
          label: 'Federal',
          taxableIncome: 0,
          segments: [{ rate: 0.1, floor: 0, ceiling: null, current: false }],
        },
      ]),
    ).toBeNull()
  })
})
