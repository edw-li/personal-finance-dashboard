import type { ChartFixture } from './_types'
import { creditLineChartOption } from '../../components/creditcards/creditLineChartOptions'

const fixture: ChartFixture = {
  name: 'creditLine',
  kind: 'cartesian',
  ariaLabel: 'Step chart of credit limits over time per card, with the total',
  build: () =>
    creditLineChartOption(
      [
        {
          name: 'Venture X',
          events: [
            { effective_date: '2023-05-12', limit_amount: '20000.00' },
            { effective_date: '2024-08-01', limit_amount: '25000.00' },
          ],
        },
        { name: 'BILT', events: [{ effective_date: '2024-02-20', limit_amount: '12500.00' }] },
      ],
      ['2024-01-01', '2024-02-01', '2024-09-01'],
      { includeTotal: true },
    ),
}
export default fixture
