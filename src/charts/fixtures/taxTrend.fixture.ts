import type { ChartFixture } from './_types'
import { trendOption } from '../../components/taxes/taxChartOptions'
import { taxSummary2024 } from './taxWaterfall.fixture'

const fixture: ChartFixture = {
  name: 'taxTrend',
  kind: 'cartesian',
  ariaLabel:
    'Stacked bar chart of tax by jurisdiction per year, with the effective rate on each cap',
  build: () => trendOption([taxSummary2024(), { ...taxSummary2024(), year: 2025 }]),
}
export default fixture
