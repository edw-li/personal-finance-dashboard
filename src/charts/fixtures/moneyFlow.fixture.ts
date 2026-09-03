import type { ChartFixture } from './_types'
import { moneyFlowOption } from '../../components/overview/moneyFlowOptions'

const fixture: ChartFixture = {
  name: 'moneyFlow',
  kind: 'sankey',
  ariaLabel: 'Sankey diagram of 2026 money flow from income sources through taxes, savings and take-home cash to spending categories',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    moneyFlowOption({
      year: 2026, available_years: [2026], renderable: true, reason: null, warnings: [],
      sources: { salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '4000.00', investment_income: '2500.00', other_income: '1000.00', salary_people: [] },
      gross_income: '307500.00',
      taxes: { total: '67016.05', federal: '26520.00', state: '14225.00', medicare: '4345.65', social_security: '18581.40', disability: '3344.00', capital_gains: '0.00', niit: '123.45' },
      pre_tax_savings: '27300.00', take_home_cash: '120000.00', retained_equity: '93183.95',
      categories: [{ name: 'Rent', amount: '24000.00' }, { name: 'Food', amount: '6000.00' }],
      other_spend: '1400.00', total_spend: '31400.00', saved: '88600.00',
    }),
}
export default fixture
