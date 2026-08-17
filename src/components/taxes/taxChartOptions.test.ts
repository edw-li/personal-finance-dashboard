import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { OTHER_SERIES_COLOR, POSITIVE, SEQUENTIAL_BLUE } from '../../charts/theme'
import type { TaxSummaryOut } from '../../types/api'
import {
  TAX_COLORS,
  TAX_LABELS,
  WATERFALL_CATEGORIES,
  trendOption,
  waterfallOption,
} from './taxChartOptions'

// --- the golden summaries -------------------------------------------------------------
// Wire shape of GET /taxes/years/{y}/summary (pydantic v2 serialises Decimal as strings).
// The six `.tax` fields and every `totals` figure are the plan's canonical table (Plan 5
// §"Canonical engine expected values"), 2023-2026, at cents — those are what the two
// builders read and what the pins below assert. The agi/taxable_income/w2_income/
// taxable_wages fields are the same table's (and the sheet's cached wage rows); the
// per-jurisdiction `effective_rate`s are those cents values divided, so they can sit one
// unit off the API's full-precision 6dp quotient in the last place — nothing in this file
// reads them, and the two rates that ARE exact (capital gains = the bracket rate, and
// totals) carry the plan's pinned strings.

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
  grossIncome: string
  totalIncome: string
  totalTax: string
  takeHome: string
  effectiveRate: string
}

const CANONICAL: Record<number, YearFacts> = {
  2023: {
    fedTax: '18330.39', fedAgi: '117726.64', fedTi: '103876.64', fedRate: '0.155703',
    stateTax: '7146.50', stateAgi: '119746.28', stateTi: '114383.28', stateRate: '0.059680',
    w2Income: '105065.08',
    medicareWages: '102822.40', medicareTax: '1490.92', medicareRate: '0.014190',
    ssWages: '102822.40', ssTax: '6374.99', ssRate: '0.060677',
    sdiWages: '104989.08', sdiTax: '944.90', sdiRate: '0.008993',
    cgAmount: '129.00', cgTax: '19.35', cgRate: '0.150000',
    grossIncome: '126321.23', totalIncome: '117726.64', totalTax: '34307.05',
    takeHome: '92014.18', effectiveRate: '0.271586',
  },
  2024: {
    fedTax: '40782.88', fedAgi: '211776.20', fedTi: '197176.20', fedRate: '0.192575',
    stateTax: '15884.46', stateAgi: '215122.02', stateTi: '209582.02', stateRate: '0.073839',
    w2Income: '235724.46',
    medicareWages: '231274.46', medicareTax: '3634.95', medicareRate: '0.015420',
    ssWages: '168600.00', ssTax: '10453.20', ssRate: '0.044345',
    sdiWages: '235424.46', sdiTax: '1950.00', sdiRate: '0.008272',
    cgAmount: '179.13', cgTax: '33.68', cgRate: '0.188000',
    grossIncome: '237973.17', totalIncome: '211776.20', totalTax: '72739.17',
    takeHome: '165234.00', effectiveRate: '0.305661',
  },
  2025: {
    fedTax: '51355.09', fedAgi: '259376.05', fedTi: '232162.77', fedRate: '0.197995',
    stateTax: '20139.34', stateAgi: '262132.89', stateTi: '256426.89', stateRate: '0.076829',
    w2Income: '276176.78',
    medicareWages: '271576.78', medicareTax: '4582.05', medicareRate: '0.016591',
    ssWages: '176100.00', ssTax: '10918.20', ssRate: '0.039533',
    sdiWages: '275876.78', sdiTax: '2700.00', sdiRate: '0.009776',
    cgAmount: '1267.19', cgTax: '238.23', cgRate: '0.188000',
    grossIncome: '287209.06', totalIncome: '259376.05', totalTax: '89932.91',
    takeHome: '197276.15', effectiveRate: '0.313127',
  },
  2026: {
    fedTax: '57160.35', fedAgi: '280128.21', fedTi: '250304.21', fedRate: '0.204051',
    stateTax: '22206.80', stateAgi: '284428.21', stateTi: '278722.21', stateRate: '0.078075',
    w2Income: '306694.03',
    medicareWages: '302094.03', medicareTax: '5299.21', medicareRate: '0.017278',
    ssWages: '176100.00', ssTax: '10918.20', ssRate: '0.035600',
    sdiWages: '306394.03', sdiTax: '3000.00', sdiRate: '0.009782',
    // No gains in 2026: the API's rate is null there (the sheet's #DIV/0!).
    cgAmount: '0.00', cgTax: '0.00', cgRate: null,
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
// missing keys (the sparse-year shape the panel has to survive).
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
  name?: string
  type?: string
  stack?: string
  stackStrategy?: string
  yAxisIndex?: number
  color?: string
  data?: unknown[]
}
interface BarPoint {
  value: number
  itemStyle?: { color?: string }
}
// The two formatters carry logic of their own (a ÷100 each), so the tests call them
// directly rather than trusting that a chart nobody renders in jsdom would show it.
interface TooltipParam {
  name?: string
  seriesName?: string
  value?: number | null
  marker?: string
}

function seriesOf(option: EChartsOption | null): SeriesLike[] {
  expect(option).not.toBeNull()
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption | null): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

function yAxesOf(option: EChartsOption | null): { min?: number }[] {
  return (option as unknown as { yAxis: { min?: number }[] }).yAxis
}

function points(series: SeriesLike): BarPoint[] {
  return (series.data ?? []) as BarPoint[]
}

function tooltipFormatterOf(option: EChartsOption | null): (params: TooltipParam[]) => string {
  return (option as unknown as { tooltip: { formatter: (p: TooltipParam[]) => string } }).tooltip
    .formatter
}

function rateAxisLabelOf(option: EChartsOption | null): (value: number) => string {
  return (option as unknown as { yAxis: { axisLabel: { formatter: (v: number) => string } }[] })
    .yAxis[1].axisLabel.formatter
}

describe('waterfallOption', () => {
  it('lays the eight categories out in the plan order', () => {
    const option = waterfallOption(summaryFixture(2024))
    expect(categoriesOf(option)).toEqual([
      'Gross', 'Federal', 'State', 'Medicare', 'Soc. Sec.', 'SDI', 'Cap. gains', 'Take-home',
    ])
    expect(WATERFALL_CATEGORIES).toEqual(categoriesOf(option))
  })

  it('pins the invisible placeholders to the 2024 running remainders', () => {
    const [placeholder, visible] = seriesOf(waterfallOption(summaryFixture(2024)))
    // Gross and Take-home stand on the floor; every tax floats on the remainder LEFT
    // after it is taken. 237973.17 - 40782.88 = 197190.29, - 15884.46 = 181305.83, …
    expect(placeholder.data).toEqual([
      0, 197190.29, 181305.83, 177670.88, 167217.68, 165267.68, 165234, 0,
    ])
    // Each visible segment is the server's own figure — never re-derived here.
    expect(points(visible).map((p) => p.value)).toEqual([
      237973.17, 40782.88, 15884.46, 3634.95, 10453.2, 1950, 33.68, 165234,
    ])
    // Both bars are stacked on ONE stack: that is what makes the placeholder lift the
    // visible segment off the floor.
    expect(placeholder.stack).toBe(visible.stack)
  })

  it('lands the last remainder exactly on the server take-home', () => {
    const summary = summaryFixture(2024)
    const [placeholder] = seriesOf(waterfallOption(summary))
    const remainders = placeholder.data as number[]
    // Cap. gains is the last step: what is left after it IS take-home, to the cent, with
    // no float dust (181305.83000000002 is what the raw subtraction chain produces).
    expect(remainders[6]).toBe(Number(summary.totals.take_home))
  })

  it('wears theme slots only — grey gross, ramped taxes, positive take-home', () => {
    const [, visible] = seriesOf(waterfallOption(summaryFixture(2024)))
    const colors = points(visible).map((p) => p.itemStyle?.color)
    expect(colors[0]).toBe(OTHER_SERIES_COLOR)
    expect(colors[7]).toBe(POSITIVE)
    expect(colors.slice(1, 7)).toEqual([...TAX_COLORS])
    // One hue family for the six taxes (the ≤3-hue law's sequential-ramp escape).
    expect(TAX_COLORS.every((c) => (SEQUENTIAL_BLUE as readonly string[]).includes(c))).toBe(true)
    expect(TAX_COLORS).toHaveLength(TAX_LABELS.length)
  })

  it('draws a negative tax as a step back UP the remainder', () => {
    // State tax can go negative after exemption credits (the engine warns and keeps it).
    const summary = summaryFixture(2024)
    summary.state.tax = '-500.00'
    summary.totals.total_tax = '56354.71'
    summary.totals.take_home = '181618.46'
    const [placeholder, visible] = seriesOf(waterfallOption(summary))
    const remainders = placeholder.data as number[]
    // The segment spans [197190.29, 197690.29]: its foot is the LOWER of the two
    // remainders and its height is the size of the step, either way it points.
    expect(remainders[2]).toBe(197190.29)
    expect(points(visible)[2].value).toBe(500)
    expect(remainders[6]).toBe(Number(summary.totals.take_home))
  })

  it('keeps the walk stacked when the remainder crosses zero', () => {
    // Half-entered year: the wage figures are in but the income that pays them is not, so
    // total_tax (72739.17) is larger than gross and the remainder goes NEGATIVE partway
    // down. echarts' default stackStrategy 'samesign' refuses to stack a value on a base
    // of the other sign — every segment past the crossing would drop back to the axis and
    // the walk would read as a row of floor bars.
    const summary = summaryFixture(2024)
    summary.totals.gross_income = '50000.00'
    summary.totals.take_home = '-22739.17'
    const [placeholder, visible] = seriesOf(waterfallOption(summary))
    expect(placeholder.stackStrategy).toBe('all')
    expect(visible.stackStrategy).toBe('all')
    // The chain itself is unchanged, negatives and all: 50000 - 40782.88 = 9217.12,
    // - 15884.46 = -6667.34, - 3634.95 = -10302.29, …
    expect(placeholder.data).toEqual([
      0, 9217.12, -6667.34, -10302.29, -20755.49, -22705.49, -22739.17, 0,
    ])
    expect(points(visible).map((p) => p.value)).toEqual([
      50000, 40782.88, 15884.46, 3634.95, 10453.2, 1950, 33.68, -22739.17,
    ])
    // And it still lands on the server's take-home — which is itself negative here.
    expect((placeholder.data as number[])[6]).toBe(Number(summary.totals.take_home))
  })

  it('returns null for a year with nothing in it', () => {
    expect(waterfallOption(emptySummary(2026))).toBeNull()
  })
})

describe('TAX_COLORS', () => {
  it('walks UP one ramp from the first slot that clears the contrast floor', () => {
    const slots = TAX_COLORS.map((c) => (SEQUENTIAL_BLUE as readonly string[]).indexOf(c))
    // Index 4 is where the ramp starts clearing 3:1 on #171a21 (index 1 is 1.8:1), so the
    // six taxes start there and never reach below it.
    expect(TAX_COLORS[0]).toBe(SEQUENTIAL_BLUE[4])
    expect(slots.every((slot) => slot >= 4)).toBe(true)
    // Strictly ascending: the ramp encodes POSITION in TAX_LABELS order, which is what
    // lets a waterfall step and a stack segment for the same tax wear one color — and it
    // puts the lightest slots on the smallest taxes, whose slivers need the contrast.
    expect(slots.slice(1).every((slot, i) => slot > slots[i])).toBe(true)
  })
})

describe('trendOption', () => {
  it('returns null when no year has a summary yet', () => {
    expect(trendOption([])).toBeNull()
  })

  it('stacks the six taxes per year and lines the effective rate on a % axis', () => {
    const option = trendOption([2023, 2024, 2025, 2026].map(summaryFixture))
    expect(categoriesOf(option)).toEqual(['2023', '2024', '2025', '2026'])

    const series = seriesOf(option)
    expect(series.slice(0, 6).map((s) => s.name)).toEqual([...TAX_LABELS])
    expect(series.slice(0, 6).map((s) => s.color)).toEqual([...TAX_COLORS])
    // One stack: the bars read as a composition of the year's total tax.
    expect(new Set(series.slice(0, 6).map((s) => s.stack)).size).toBe(1)
    expect(series[0].data).toEqual([18330.39, 40782.88, 51355.09, 57160.35])
    expect(series[1].data).toEqual([7146.5, 15884.46, 20139.34, 22206.8])
    expect(series[2].data).toEqual([1490.92, 3634.95, 4582.05, 5299.21])
    expect(series[3].data).toEqual([6374.99, 10453.2, 10918.2, 10918.2])
    expect(series[4].data).toEqual([944.9, 1950, 2700, 3000])
    expect(series[5].data).toEqual([19.35, 33.68, 238.23, 0])

    const rate = series[6]
    expect(rate.name).toBe('Effective rate')
    expect(rate.type).toBe('line')
    // Secondary axis, in PERCENT units: the 6dp fraction ×100, landing on 4dp with no
    // float dust (0.305661 × 100 is 30.566100000000002 unrounded).
    expect(rate.yAxisIndex).toBe(1)
    expect(rate.data).toEqual([27.1586, 30.5661, 31.3127, 32.1443])
    // Zero-anchored: a 27%→32% run auto-scaled to fill the frame would read as a cliff
    // beside bars that are honest about their baseline.
    expect(yAxesOf(option)[1].min).toBe(0)
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

  it('divides the rate back out in BOTH places that render it', () => {
    const option = trendOption([summaryFixture(2024)])
    // Two units in one tooltip: money for the stacked bars, percent for the rate line.
    // The line's value rides the axis in PERCENT units, so it divides by 100 before
    // formatPct multiplies by 100 again — without the divisor this reads "3056.6%".
    expect(
      tooltipFormatterOf(option)([
        { name: '2024', seriesName: 'Federal', value: 40782.88, marker: '[m]' },
        { name: '2024', seriesName: 'Effective rate', value: 30.5661, marker: '[r]' },
      ]),
    ).toBe('<strong>2024</strong><br/>[m]Federal: $40,782.88<br/>[r]Effective rate: 30.6%')
    // The percent AXIS is handed the same ×100 units and divides them back out too, at
    // whole percents; without the divisor this tick would read "3057%".
    const label = rateAxisLabelOf(option)
    expect(label(30.5661)).toBe('31%')
    expect(label(30)).toBe('30%')
    expect(label(0)).toBe('0%')
  })

  it('breaks the rate line where a year has no rate, and still stacks its zeros', () => {
    const sparse = emptySummary(2025)
    const option = trendOption([summaryFixture(2024), sparse])
    const series = seriesOf(option)
    expect(categoriesOf(option)).toEqual(['2024', '2025'])
    expect(series[0].data).toEqual([40782.88, 0])
    // null, not 0: a year with no gross income has no effective rate to draw, and
    // connectNulls is off so the line simply stops.
    expect(series[6].data).toEqual([30.5661, null])
  })
})
