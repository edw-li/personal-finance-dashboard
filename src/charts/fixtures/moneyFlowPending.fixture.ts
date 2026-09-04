import type { ChartFixture } from './_types'
import { moneyFlowOption } from '../../components/overview/moneyFlowOptions'

// The pending-take-home branch (honest-numbers spec §3) — production's own 2026 figures:
// seven months entered, five estimated at $6,373.09 each. The plain moneyFlow fixture is a
// fully entered year, so it never reaches the dashed node; this one is the only place the
// grammar checks that node's colours (the projectionPinned precedent).
const fixture: ChartFixture = {
  name: 'moneyFlowPending',
  kind: 'sankey',
  ariaLabel:
    'Sankey diagram of 2026 money flow from income sources through taxes, savings and take-home cash to spending categories, with the take-home of the months not yet entered drawn as an estimate',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    moneyFlowOption({
      year: 2026, available_years: [2026], renderable: true, reason: null, warnings: [],
      sources: { salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '4000.00', investment_income: '2500.00', other_income: '1000.00', salary_people: [] },
      gross_income: '307500.00',
      taxes: { total: '67016.05', federal: '26520.00', state: '14225.00', medicare: '4345.65', social_security: '18581.40', disability: '3344.00', capital_gains: '0.00', niit: '123.45' },
      pre_tax_savings: '27300.00', take_home_cash: '44611.60', retained_equity: '136706.92',
      take_home_pending: '31865.43', take_home_months_entered: 7,
      categories: [{ name: 'Rent', amount: '24000.00' }, { name: 'Food', amount: '6000.00' }],
      other_spend: '1400.00', total_spend: '31400.00', saved: '13211.60',
    }),
}
export default fixture
