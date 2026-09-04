import type { ChartFixture } from './_types'
import { savingsRateOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX } from './spendingBars.fixture'

// The degraded branch (a backend older than the savings service): one muted line, no legend,
// the noLegend grid — a shape the two-line fixture never reaches, so the grammar would
// otherwise never check it (sandbox J's `projectionPinned` precedent).
const fixture: ChartFixture = {
  name: 'spendingSavingsCash',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the monthly cash savings rate around a zero baseline',
  build: () =>
    savingsRateOption({
      matrix: { ...MATRIX, total_savings_rate: undefined },
      monthLabels: LABELS,
      range: { preset: 'all' },
    }),
}
export default fixture
