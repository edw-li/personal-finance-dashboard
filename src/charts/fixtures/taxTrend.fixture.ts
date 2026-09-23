import type { ChartFixture } from './_types'
import { trendOption } from '../../components/taxes/taxChartOptions'
import { taxSummary2024 } from './taxWaterfall.fixture'

const fixture: ChartFixture = {
  name: 'taxTrend',
  kind: 'cartesian',
  ariaLabel:
    'Stacked bar chart of tax by jurisdiction per year, with the effective rate on each cap',
  // "Today" inside 2025, so the second year takes the estimate treatment (2026-09-23 spec §C7):
  // the per-segment fade and dashed ink outline must pass the colour rule like every other hex.
  build: () =>
    trendOption([taxSummary2024(), { ...taxSummary2024(), year: 2025 }], { today: '2025-06-01' }),
}
export default fixture
