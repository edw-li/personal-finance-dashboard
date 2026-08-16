import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HoldingOut } from '../../types/api'
import HoldingsTable from './HoldingsTable'

afterEach(cleanup)

function holding(overrides: Partial<HoldingOut>): HoldingOut {
  return {
    security_id: 1, ticker: 'AAA', name: 'AAA Inc', industry: 'Tech',
    holding_type: 'stock', is_manual_priced: false, shares: '10', avg_cost: '100.0000',
    cost_basis: '1000.00', price: '110.0000', quoted_at: '2026-08-14T00:00:00Z',
    price_source: 'yfinance', day_change_pct: '0.010000', day_change_amount: '11.00',
    market_value: '1100.00', weight_pct: '0.500000', unrealized_gl: '100.00',
    unrealized_gl_pct: '0.100000', realized_gl: '0.00', dividends_collected: '0.00',
    annual_dividend: null, annual_income: null, yield_pct: null, yoc_pct: null,
    xirr_pct: null, accounts: ['Acct'], warnings: [],
    ...overrides,
  }
}

const rows = [
  holding({ security_id: 1, ticker: 'AAA', market_value: '1100.00', weight_pct: '0.4' }),
  holding({ security_id: 2, ticker: 'BBB', market_value: '2200.00', weight_pct: '0.6' }),
]

function tickerColumn(): string[] {
  return screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')!.textContent!)
}

describe('HoldingsTable', () => {
  it('defaults to market-value descending', () => {
    render(<HoldingsTable holdings={rows} sparklines={{}} />)
    expect(tickerColumn()[0]).toContain('BBB')
  })

  it('clicking a header toggles sort direction', () => {
    // fireEvent, not user-event: @testing-library/user-event is not a devDependency here
    // (plan Task 13 sanctions this substitution; zero lockfile churn).
    render(<HoldingsTable holdings={rows} sparklines={{}} />)
    fireEvent.click(screen.getByRole('button', { name: /market value/i }))
    expect(tickerColumn()[0]).toContain('AAA') // now ascending
  })

  it('renders em-dashes for null money fields and a warning marker', () => {
    render(
      <HoldingsTable
        holdings={[holding({ price: null, market_value: null, weight_pct: null, day_change_pct: null, warnings: ['sell with no held shares'] })]}
        sparklines={{}}
      />,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    // Plain attribute assert — this project doesn't install jest-dom matchers, so
    // getByTitle (which throws when absent) carries the presence assertion.
    expect(screen.getByTitle(/sell with no held shares/).className).toContain('warn-icon')
  })
})
