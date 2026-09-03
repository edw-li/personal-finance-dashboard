import type { ChartFixture } from './_types'
import { tcTrajectoryOption } from '../../components/comp/compChartOptions'

const event = (
  id: number,
  focal_year: number,
  current_base: string,
  new_base: string | null,
  tc_after: string,
) => ({
  id,
  focal_year,
  current_base,
  new_base,
  unvested_rsus: null,
  unvested_price: null,
  refresh_rsus: null,
  grant_price: null,
  notes: null,
  base_delta: null,
  base_delta_pct: null,
  unvested_equity: null,
  equity_delta: null,
  equity_delta_pct: null,
  tc_before: current_base,
  tc_after,
})

const fixture: ChartFixture = {
  name: 'tcTrajectory',
  kind: 'cartesian',
  ariaLabel:
    'Stacked bar chart of base salary and unvested equity value per focal year, with total comp as a line',
  build: () =>
    tcTrajectoryOption([
      event(1, 2025, '151000.00', '162000.00', '505878.28'),
      event(2, 2026, '162000.00', '188930.00', '601854.46'),
    ]),
}
export default fixture
