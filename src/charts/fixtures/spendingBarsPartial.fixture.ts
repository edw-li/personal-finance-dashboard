import type { ChartFixture } from './_types'
import { spendingBarsOption } from '../../components/spending/spendingChartOptions'
import { FOLD, LABELS, MATRIX, NAMES } from './spendingBars.fixture'

// The month in progress (2026-09-23 spec §C5) under Appearance › Chart patterns: every August
// segment hatched in its own colour, and the month-to-date net pay detached from the line into
// its lone marker series under the same name.
const fixture: ChartFixture = {
  name: 'spendingBarsPartial',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of monthly spending by category under the net-pay line',
  build: () =>
    spendingBarsOption({
      matrix: MATRIX, fold: FOLD, nameById: NAMES, monthLabels: LABELS,
      range: { preset: 'all' }, selected: {}, todayIso: '2026-08-12', patterns: true,
    }),
}
export default fixture
