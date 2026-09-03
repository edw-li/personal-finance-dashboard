import type { ChartFixture } from './_types'
import { whatIfDeltaBarOption } from '../../components/taxes/taxChartOptions'

const fixture: ChartFixture = {
  name: 'whatIfDeltaBar',
  kind: 'cartesian',
  ariaLabel: 'Change in tax by jurisdiction, scenario minus baseline',
  build: () =>
    whatIfDeltaBarOption({
      total_tax: '-5488.69',
      take_home: '5488.69',
      federal_tax: '-3000.00',
      state_tax: '-2413.10',
      medicare_tax: '0.00',
      social_security_tax: '0.00',
      disability_tax: '0.00',
      capital_gains_tax: '0.00',
      niit_tax: '-75.59',
      effective_rate: '-0.0141',
    }),
}
export default fixture
