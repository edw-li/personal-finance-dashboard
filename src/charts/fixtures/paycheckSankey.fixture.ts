import type { ChartFixture } from './_types'
import { paycheckSankeyOption } from '../../components/paycheck/paycheckSankeyOptions'

const fixture: ChartFixture = {
  name: 'paycheckSankey',
  kind: 'sankey',
  ariaLabel: 'Sankey flow of one paycheck from gross to net',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    paycheckSankeyOption({
      profile: {
        id: 1,
        person_id: 1,
        effective_date: '2026-01-01',
        annual_salary: '188930.00',
        pay_periods_per_year: 24,
        trad_401k_pct: '0.13',
        roth_401k_pct: '0',
        after_tax_401k_pct: '0.03',
        espp_pct: '0.11',
        withholding_pct: '0.334',
        dental_vision_per_check: '12.50',
        hsa_per_check: '100.00',
        hsa_coverage: 'self',
        notes: null,
      },
      gross: '7872.08',
      trad_401k: '1023.37',
      dental_vision: '12.50',
      hsa: '100.00',
      taxable: '6736.21',
      withholding: '2249.96',
      post_tax: '4486.26',
      roth_401k: '0.00',
      after_tax_401k: '236.16',
      espp: '865.93',
      net_pay: '3384.16',
      monthly_net: '6768.33',
      warnings: [],
      pace: [],
    }),
}
export default fixture
