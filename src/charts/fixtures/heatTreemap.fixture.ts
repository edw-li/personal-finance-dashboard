// The allocation heat-treemap (charts C4 / F5): industry → ticker, area = market value,
// fill = the clamped metric on the diverging ramp.
import type { ChartFixture } from './_types'
import { heatTreemapOption } from '../../components/portfolio/allocationChartOptions'
import type { HoldingOut } from '../../types/api'

const base = {
  security_id: 1,
  name: '',
  is_manual_priced: false,
  shares: '1',
  avg_cost: '1',
  cost_basis: '1',
  price: '1',
  quoted_at: null,
  price_source: 'yfinance' as const,
  day_change_amount: '1',
  weight_pct: null,
  unrealized_gl: '1',
  realized_gl: '0',
  dividends_collected: '0',
  annual_dividend: null,
  annual_income: null,
  yield_pct: null,
  yoc_pct: null,
  xirr_pct: null,
  accounts: [],
  warnings: [],
}

export const HOLDINGS: HoldingOut[] = [
  { ...base, ticker: 'NVDA', industry: 'Semis', holding_type: 'stock', market_value: '600000.00', unrealized_gl_pct: '0.80', day_change_pct: '-0.02' },
  { ...base, ticker: 'AMD', industry: 'Semis', holding_type: 'stock', market_value: '200000.00', unrealized_gl_pct: '-0.10', day_change_pct: '0.01' },
  { ...base, ticker: 'VOO', industry: null, holding_type: 'etf', market_value: '195000.00', unrealized_gl_pct: '0.25', day_change_pct: '0.00' },
  { ...base, ticker: 'TINY', industry: 'Semis', holding_type: 'stock', market_value: '3000.00', unrealized_gl_pct: '0.05', day_change_pct: '0.01' },
]

const fixture: ChartFixture = {
  name: 'heatTreemap',
  kind: 'treemap',
  ariaLabel:
    'Treemap of holdings by industry and ticker, sized by market value and shaded by unrealized gain',
  exempt: ['grid', 'axis', 'legend'],
  build: () => heatTreemapOption(HOLDINGS, 'unrealized'),
}
export default fixture
