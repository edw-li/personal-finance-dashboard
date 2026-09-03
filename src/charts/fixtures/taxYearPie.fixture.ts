import type { ChartFixture } from './_types'
import { yearPieOption } from '../../components/taxes/taxChartOptions'
import { taxSummary2024 } from './taxWaterfall.fixture'

const fixture: ChartFixture = {
  name: 'taxYearPie',
  kind: 'pie',
  ariaLabel: 'Donut chart of one year’s tax by jurisdiction',
  exempt: ['grid', 'axis'],
  build: () => yearPieOption(taxSummary2024()),
}
export default fixture
