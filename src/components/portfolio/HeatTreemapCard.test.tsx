import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchClassifications } from '../../api/allocation'
import type { HoldingOut } from '../../types/api'
import HeatTreemapCard from './HeatTreemapCard'

vi.mock('../../api/allocation', async (original) => ({
  ...await original<typeof import('../../api/allocation')>(),
  fetchClassifications: vi.fn(),
}))
// echarts is never rendered in jsdom (house law); the option is pinned in allocationChartOptions.test.ts.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return { default: ({ ariaLabel }: { ariaLabel?: string }) => createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel }) }
})

const VOO: HoldingOut = {
  security_id: 1, ticker: 'VOO', name: 'Vanguard S&P 500 ETF', industry: 'Index', holding_type: 'etf',
  is_manual_priced: false, shares: '10', avg_cost: '400.00', cost_basis: '4000.00', price: '450.00',
  quoted_at: '2026-08-27T20:00:00Z', price_source: 'yfinance', day_change_pct: '0.0022', day_change_amount: '10.00',
  market_value: '4500.00', weight_pct: '1.0', unrealized_gl: '500.00', unrealized_gl_pct: '0.125', realized_gl: '0.00',
  dividends_collected: '15.00', annual_dividend: '6.00', annual_income: '60.00', yield_pct: '0.0133', yoc_pct: '0.015',
  xirr_pct: '0.09', accounts: ['Fidelity Brokerage'], warnings: [],
}

// A BLOCK body, not an expression: vitest treats a function returned from a hook as that
// hook's teardown, and `mockResolvedValue` returns the mock itself — which would then be
// CALLED after each test, rejecting into nobody's hands in the failure case below.
beforeEach(() => { vi.mocked(fetchClassifications).mockResolvedValue([]) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('draws the treemap as a plain chart card with its colour key and metric toggle, no accordion', async () => {
  render(<MemoryRouter><HeatTreemapCard holdings={[VOO]} /></MemoryRouter>)
  expect(await screen.findByLabelText('Holdings grouped by known industry and unknown exposure')).toBeTruthy()
  expect(screen.getByText(/Orange = loss, blue = gain/)).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Heat metric' })).toBeTruthy()
  expect(document.querySelector('details')).toBeNull()
  expect(fetchClassifications).toHaveBeenCalledTimes(1)
})

// The classifications card sets the industry this treemap groups by, and it lives on another view
// (P2 review round 3): without a version to key on, an inline edit never reached these cells.
it('refetches the industry records when the page says a classification changed', async () => {
  const { rerender } = render(<MemoryRouter><HeatTreemapCard holdings={[VOO]} refreshKey={0} /></MemoryRouter>)
  await screen.findByLabelText('Holdings grouped by known industry and unknown exposure')
  expect(fetchClassifications).toHaveBeenCalledTimes(1)
  rerender(<MemoryRouter><HeatTreemapCard holdings={[VOO]} refreshKey={1} /></MemoryRouter>)
  await waitFor(() => expect(fetchClassifications).toHaveBeenCalledTimes(2))
})

it('says so on the card when the industry records cannot be fetched', async () => {
  vi.mocked(fetchClassifications).mockRejectedValue(new Error('records down'))
  render(<MemoryRouter><HeatTreemapCard holdings={[VOO]} /></MemoryRouter>)
  expect((await screen.findByRole('status')).textContent).toContain('Industry records unavailable')
})
