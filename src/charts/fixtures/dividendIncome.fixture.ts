// Monthly dividend income (charts C4): one capped bar per month over the trailing window,
// quiet months zero-filled.
import type { ChartFixture } from './_types'
import { monthlyIncomeOption } from '../../components/portfolio/dividendChartOptions'

const fixture: ChartFixture = {
  name: 'dividendIncome',
  kind: 'cartesian',
  ariaLabel: 'Bar chart of dividend income per month over the trailing two years',
  build: () =>
    monthlyIncomeOption(
      [
        {
          id: 1,
          security_id: 1,
          account: 'RH Taxable',
          pay_date: '2026-06-05',
          amount: '8.20',
          source: 'auto',
          ex_date: '2026-06-05',
          per_share: '0.82',
          shares_held: '10',
          notes: null,
        },
      ],
      '2026-08-20',
    ),
}
export default fixture
