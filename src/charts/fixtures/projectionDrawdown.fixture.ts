import type { ChartFixture } from './_types'
import { PROJECTION_SERIES, projectionOption } from '../../components/projection/projectionChartOptions'

// The fan with a drawdown modelled (2026-09-23 correctness spec §R7): the Retired wash, the
// "Withdrawals start" / "Plan until" / "9 in 10 paths last to here" rules, the reach marks with
// their tooltips — and paths running out, so the lower band edges reach $0. Five months from
// Aug 2026, withdrawals from Oct 2026.
export const DRAWDOWN = {
  months: ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'],
  projected: ['100000.00', '104000.00', '80000.00', '55000.00', '30000.00'],
  coast: ['100000.00', '100400.00', '100800.00', '101200.00', '101600.00'],
  fi_target: '103000.00',
  fi_month: '2026-09-01',
  coast_fi_month: null,
  fi_month_p10: '2026-09-01',
  fi_month_p50: '2026-09-01',
  fi_month_p90: null,
  bands: {
    p10: ['100000.00', '90000.00', '40000.00', '0.00', '0.00'],
    p25: ['100000.00', '95000.00', '60000.00', '20000.00', '0.00'],
    p50: ['100000.00', '104000.00', '80000.00', '55000.00', '30000.00'],
    p75: ['100000.00', '112000.00', '100000.00', '90000.00', '80000.00'],
    p90: ['100000.00', '120000.00', '125000.00', '130000.00', '135000.00'],
  },
  retirements: [{ person_id: 2, name: 'Alex', month: '2026-10-01', monthly_drop: '1.00' }],
  drawdown: { start_month: '2026-10-01', annual_withdrawal: '300000.00' },
  plan_until: 2026,
  money_lasts: {
    plan_until: 2026,
    probability: '0.620000',
    verdict: 'at_risk' as const,
    lasts_until_p10: '2026-11-01',
    horizon_end: '2026-12-01',
    deterministic_depleted_month: null,
    reason: null,
  },
}

const fixture: ChartFixture = {
  name: 'projectionDrawdown',
  kind: 'cartesian',
  ariaLabel: 'Projected investable balance with withdrawals after the last retirement',
  dashed: [PROJECTION_SERIES[2]],
  build: () => projectionOption(DRAWDOWN),
}
export default fixture
