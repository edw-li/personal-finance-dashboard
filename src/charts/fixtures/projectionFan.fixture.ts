import type { ChartFixture } from './_types'
import {
  BAND_SERIES,
  PROJECTION_SERIES,
  projectionOption,
} from '../../components/projection/projectionChartOptions'

export const FAN = {
  months: ['2026-08-01', '2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104000.00', '108000.00'],
  coast: ['100000.00', '100000.00', '100000.00'],
  fi_target: '105000.00',
  fi_month: '2026-10-01',
  coast_fi_month: null,
  fi_month_p10: '2026-09-01',
  fi_month_p50: '2026-10-01',
  fi_month_p90: null,
  bands: {
    p10: ['100000.00', '90000.00', '80000.00'],
    p25: ['100000.00', '95000.00', '92000.00'],
    p50: ['100000.00', '104000.00', '108000.00'],
    p75: ['100000.00', '112000.00', '125000.00'],
    p90: ['100000.00', '120000.00', '150000.00'],
  },
  retirements: [{ person_id: 2, name: 'Alex', month: '2026-09-01', monthly_drop: '1.00' }],
}

const fixture: ChartFixture = {
  name: 'projectionFan',
  kind: 'cartesian',
  ariaLabel: 'Projected investable balance over the horizon with the Monte Carlo band',
  dashed: [PROJECTION_SERIES[2]],
  build: () => projectionOption(FAN),
}
export default fixture
export { BAND_SERIES }
