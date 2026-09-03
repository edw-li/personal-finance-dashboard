import type { ChartFixture } from './_types'
import { vestingChartOption } from '../../components/comp/vestingChartOptions'

const grant = (id: number, label: string) => ({
  id,
  label,
  kind: 'refresh' as const,
  focal_year: null,
  shares: 100,
  grant_price: '129.5651',
  first_vest_date: '2024-11-20',
  cliff_pct: '0.0625',
  vest_quantum: 1,
  notes: null,
  vest_count: 16,
  vested_shares: 0,
  unvested_shares: 100,
})

const fixture: ChartFixture = {
  name: 'vestingCalendar',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of vest value per vest date by grant, future dates at today’s quote',
  build: () =>
    vestingChartOption(
      [
        { vest_date: '2024-11-20', grant_id: 1, label: 'FY24 new hire', shares: 100, fmv: '112.0750', value: '11207.50', is_past: true },
        { vest_date: '2026-11-18', grant_id: 1, label: 'FY24 new hire', shares: 25, fmv: null, value: null, is_past: false },
        { vest_date: '2026-11-18', grant_id: 2, label: 'FY26 refresh', shares: 38, fmv: null, value: null, is_past: false },
      ],
      [grant(1, 'FY24 new hire'), grant(2, 'FY26 refresh')],
      '183.2508',
      { todayIso: '2026-09-03' },
    ),
}
export default fixture
