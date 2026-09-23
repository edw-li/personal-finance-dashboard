import type { ChartFixture } from './_types'
import { moneyFlowOption } from '../../components/overview/moneyFlowOptions'
import { CATEGORY_HUES, ENTITY } from '../entities'

// The one-window branches (2026-09-23 spec §C1) the complete-year fixture never reaches: the
// month-named estimate, a pay-without-spending terminal, a net-refund category's inflow and a
// tax-kind category on the tax hue — every new node's colour goes through the grammar's check.
const fixture: ChartFixture = {
  name: 'moneyFlowWindows',
  kind: 'sankey',
  ariaLabel: 'Sankey diagram of 2026 money flow from income sources through taxes, savings and take-home cash to spending categories',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    moneyFlowOption(
      {
        year: 2026, available_years: [2026], renderable: true, reason: null, warnings: [],
        sources: { salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '4000.00', investment_income: '2500.00', other_income: '1000.00', salary_people: [] },
        gross_income: '307500.00',
        taxes: { total: '67016.05', federal: '26520.00', state: '14225.00', medicare: '4345.65', social_security: '18581.40', disability: '3344.00', capital_gains: '0.00', niit: '123.45' },
        pre_tax_savings: '27300.00', take_home_cash: '15100.00', retained_equity: '131083.95',
        take_home_pending: '67000.00', take_home_months_entered: 3,
        categories: [{ name: 'Rent', amount: '2000.00' }, { name: 'Taxes', amount: '500.00' }],
        other_spend: null, total_spend: '2500.00', saved: '2800.00',
        take_home_matched: '5000.00', refunds: '300.00',
        matched_months: ['2026-01-01'],
        take_home_pending_months: ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'],
        take_home_unmatched: '10100.00', take_home_unmatched_months: ['2026-02-01', '2026-03-01'],
        spending_unmatched_months: [], spending_unmatched_total: '0.00',
        category_totals: [
          { category_id: 1, name: 'Rent', kind: 'living', amount: '2000.00' },
          { category_id: 2, name: 'Taxes', kind: 'tax', amount: '500.00' },
          { category_id: 3, name: 'Returns', kind: 'living', amount: '-300.00' },
        ],
        tracking_start: '2026-01-01',
      },
      { fold: { ids: [2, 1], colors: new Map([[2, ENTITY.tax], [1, CATEGORY_HUES[0]]]) }, todayIso: '2026-09-23' },
    ),
}
export default fixture
