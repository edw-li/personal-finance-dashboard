import type { ChartFixture } from './_types'
import { waterfallOption } from '../../components/taxes/taxChartOptions'
import type { TaxSummaryOut } from '../../types/api'

/** The canonical 2024 year (taxChartOptions.test.ts' golden table) — shared by this lane's
 *  three tax fixtures so they draw the same numbers the builder tests pin. */
export function taxSummary2024(): TaxSummaryOut {
  const income = (agi: string, ti: string, tax: string) => ({
    agi,
    taxable_income: ti,
    tax,
    effective_rate: null,
  })
  const wage = (wages: string, tax: string) => ({
    w2_income: '235724.46',
    taxable_wages: wages,
    tax,
    effective_rate: null,
  })
  return {
    year: 2024,
    federal: income('211776.20', '197176.20', '40782.88'),
    state: income('215301.15', '209761.15', '15901.12'),
    medicare: wage('231274.46', '3634.95'),
    social_security: wage('168600.00', '10453.20'),
    disability: wage('235424.46', '1950.00'),
    capital_gains: {
      taxable_income: '197176.20',
      gains_amount: '179.13',
      tax: '26.87',
      effective_rate: null,
    },
    niit: {
      taxable_income: '1989.28',
      gains_amount: '1989.28',
      tax: '75.59',
      effective_rate: null,
    },
    totals: {
      gross_income: '237973.17',
      total_income: '211776.20',
      total_tax: '72824.61',
      take_home: '165148.56',
      effective_rate: '0.306020',
    },
    warnings: [],
  }
}

const fixture: ChartFixture = {
  name: 'taxWaterfall',
  kind: 'cartesian',
  ariaLabel: 'Waterfall chart walking gross income down through each tax to take-home pay',
  build: () => waterfallOption(taxSummary2024()),
}
export default fixture
