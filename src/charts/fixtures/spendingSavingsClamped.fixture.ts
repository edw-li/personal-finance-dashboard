import type { ChartFixture } from './_types'
import { savingsRateOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX } from './spendingBars.fixture'

// The clamped-floor branch (2026-09-23 spec §C3): production's Sep 2023, a −1,073% cash rate,
// on both lines — the fixed −100% floor and the off-scale markers go through the checks.
const fixture: ChartFixture = {
  name: 'spendingSavingsClamped',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the monthly total and cash savings rates around a zero baseline',
  build: () =>
    savingsRateOption({
      matrix: {
        ...MATRIX,
        savings_rate: ['-10.73', '0.57', '0.557377'],
        total_savings_rate: ['-10.73', '0.631428571', '0.619718310'],
      },
      monthLabels: LABELS,
      range: { preset: 'all' },
    }),
}
export default fixture
