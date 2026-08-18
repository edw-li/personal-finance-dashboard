import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HoldingOut } from '../../types/api'
import HoldingsTable from './HoldingsTable'

afterEach(cleanup)
afterEach(() => vi.useRealTimers())

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
    const marker = screen.getByTitle(/sell with no held shares/)
    expect(marker.className).toContain('warn-icon')
    // Hover-free access: the marker names itself to assistive tech.
    expect(marker.getAttribute('role')).toBe('img')
    expect(marker.getAttribute('aria-label')).toBe('sell with no held shares')
  })

  it('nulls sort to the bottom when descending and first when ascending', () => {
    render(
      <HoldingsTable
        holdings={[
          holding({ security_id: 1, ticker: 'AAA', name: 'AAA Inc', xirr_pct: '0.2' }),
          holding({ security_id: 2, ticker: 'BBB', name: 'BBB Inc', xirr_pct: null }),
          holding({ security_id: 3, ticker: 'CCC', name: 'CCC Inc', xirr_pct: '0.1' }),
        ]}
        sparklines={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /xirr/i })) // numeric -> starts DESC
    const desc = tickerColumn()
    expect(desc[0]).toContain('AAA')
    expect(desc[1]).toContain('CCC')
    expect(desc[2]).toContain('BBB') // null last
    fireEvent.click(screen.getByRole('button', { name: /xirr/i })) // toggle -> ASC
    expect(tickerColumn()[0]).toContain('BBB') // null first
  })

  it('the string column starts ascending', () => {
    // Distinct names on purpose: the shared `rows` fixture gives every row the name
    // "AAA Inc", so a toContain('AAA') assert would pass on the BBB row too.
    render(
      <HoldingsTable
        holdings={[
          holding({ security_id: 1, ticker: 'AAA', name: 'AAA Inc' }),
          holding({ security_id: 2, ticker: 'BBB', name: 'BBB Inc' }),
        ]}
        sparklines={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ticker/i }))
    expect(tickerColumn()[0]).toContain('AAA')
    expect(tickerColumn()[1]).toContain('BBB')
  })

  it('toggles the drill-in through the row, and through its button exactly once', () => {
    const onSelect = vi.fn()
    render(
      <HoldingsTable
        holdings={rows}
        sparklines={{}}
        selectedTicker="BBB"
        onSelect={onSelect}
      />,
    )
    // The open row announces itself pressed; its sibling does not.
    const bbb = screen.getByRole('button', { name: 'Toggle BBB details' })
    expect(bbb.getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Toggle AAA details' }).getAttribute('aria-pressed'),
    ).toBe('false')

    // The keyboard button stops propagation — without it the row's own handler would fire
    // the same toggle twice and the panel would open-and-shut in one click.
    fireEvent.click(bbb)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('BBB')

    // Whole-row click for the mouse: a cell far from the ticker still selects.
    const firstDataRow = screen.getAllByRole('row')[1] // BBB — market-value descending
    fireEvent.click(firstDataRow.querySelectorAll('td')[4]!)
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenLastCalledWith('BBB')
  })

  it('keeps the rows inert when no drill-in is wired', () => {
    render(<HoldingsTable holdings={rows} sparklines={{}} />)
    expect(screen.queryByRole('button', { name: /Toggle .* details/ })).toBeNull()
  })

  it('flags stale quotes by bar DATE, not instant', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    render(
      <HoldingsTable
        holdings={[
          holding({ security_id: 1, ticker: 'AAA', name: 'AAA Inc', quoted_at: '2026-08-14T00:00:00Z' }),
          holding({ security_id: 2, ticker: 'BBB', name: 'BBB Inc', quoted_at: '2026-08-17T00:00:00Z' }),
          holding({ security_id: 3, ticker: 'CCC', name: 'CCC Inc', quoted_at: '2026-08-16T00:00:00Z' }),
        ]}
        sparklines={{}}
      />,
    )
    expect(screen.getByText(/as of Aug 14, 2026/)).toBeTruthy() // 6 days by date -> stale
    expect(screen.queryByText(/as of Aug 17, 2026/)).toBeNull() // 3 days by date -> fresh
    // THE discriminating row: exactly 4 days back by DATE but 4.5 days by instant, so an
    // instant comparison (the bug) flags it and a date comparison does not.
    expect(screen.queryByText(/as of Aug 16, 2026/)).toBeNull()
  })
})
