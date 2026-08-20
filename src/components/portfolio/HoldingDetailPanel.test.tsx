import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type {
  DividendOut,
  HoldingOut,
  PriceHistoryResponse,
  TransactionOut,
} from '../../types/api'
import HoldingDetailPanel from './HoldingDetailPanel'

vi.mock('../../api/prices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/prices')>()),
  fetchPriceHistory: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what the chart
// draws is pinned in priceChartOptions.test.ts; this marker says whether one is up and,
// via the categories, which window fed it.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option }: { option: { xAxis?: { data?: unknown[] } } }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
      }),
  }
})
import { fetchPriceHistory } from '../../api/prices'

function holding(over: Partial<HoldingOut> = {}): HoldingOut {
  return {
    security_id: 1, ticker: 'AAA', name: 'AAA Inc', industry: 'Semiconductors',
    holding_type: 'stock', is_manual_priced: false, shares: '10', avg_cost: '100.0000',
    cost_basis: '1000.00', price: '110.0000', quoted_at: '2026-08-14T00:00:00Z',
    price_source: 'yfinance', day_change_pct: '0.010000', day_change_amount: '11.00',
    // 101.23, not 100.00: avg_cost already renders '$100.00', and a duplicate text node
    // would blow up every getByText in this file.
    market_value: '1100.00', weight_pct: '0.500000', unrealized_gl: '101.23',
    unrealized_gl_pct: '0.100000', realized_gl: '25.00', dividends_collected: '12.34',
    annual_dividend: '0.0400', annual_income: '0.40', yield_pct: '0.000364',
    yoc_pct: '0.000400', xirr_pct: null, accounts: ['RH Taxable', 'Fidelity'],
    warnings: [],
    ...over,
  }
}

function txn(over: Partial<TransactionOut> = {}): TransactionOut {
  return {
    id: 1, security_id: 1, account: 'RH Taxable', type: 'buy', txn_date: null,
    shares: '10.000000', price: '100.0000', fees: null, split_factor: null,
    sort_index: 10, source: 'import', notes: null,
    ...over,
  }
}

function dividend(over: Partial<DividendOut> = {}): DividendOut {
  return {
    id: 1, security_id: 1, account: 'RH Taxable', pay_date: '2026-06-30',
    amount: '3.21', source: 'manual', ex_date: null, per_share: null,
    shares_held: null, notes: null,
    ...over,
  }
}

const POINTS: PriceHistoryResponse = {
  ticker: 'AAA',
  points: [
    { d: '2026-08-12', c: '108.00' },
    { d: '2026-08-13', c: '109.50' },
    { d: '2026-08-14', c: '110.00' },
  ],
}

// The "All holdings" way back is the PAGE's (the panel is a body swapped into the
// Holdings card), so there is no close affordance to exercise here. Under a router because
// the what-if deep link is a <Link>, which has no meaning outside one.
function renderPanel(over: {
  holding?: HoldingOut
  transactions?: TransactionOut[]
  dividends?: DividendOut[]
} = {}) {
  return render(
    <MemoryRouter>
      <HoldingDetailPanel
        holding={over.holding ?? holding()}
        transactions={over.transactions ?? []}
        dividends={over.dividends ?? []}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchPriceHistory).mockResolvedValue(POINTS)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HoldingDetailPanel facts', () => {
  it("renders the row's overflow — avg cost, realized, accounts — verbatim", async () => {
    renderPanel()
    // The fields the table has no columns for, straight off the server's holding row.
    expect(screen.getByText('Avg cost')).toBeTruthy()
    expect(screen.getByText('$100.00')).toBeTruthy()
    expect(screen.getByText('Realized')).toBeTruthy()
    expect(screen.getByText('$25.00')).toBeTruthy()
    expect(screen.getByText(/Held in RH Taxable, Fidelity/)).toBeTruthy()
    await screen.findByTestId('echart') // let the mount fetch settle inside act
  })

  it('explains a blank XIRR by counting the undated rows beneath it', async () => {
    renderPanel({
      transactions: [txn(), txn({ id: 2, txn_date: '2026-01-05' })],
    })
    expect(
      screen.getByText(/XIRR needs dated transactions — 1 of 2 below has no date/),
    ).toBeTruthy()
    await screen.findByTestId('echart')
  })

  it('keeps the hint out of the way when XIRR is computed or nothing is undated', async () => {
    renderPanel({
      holding: holding({ xirr_pct: '0.123456' }),
      transactions: [txn()],
    })
    expect(screen.queryByText(/XIRR needs dated transactions/)).toBeNull()
    await screen.findByTestId('echart')
  })

  it("filters both ledgers to this security's rows", async () => {
    renderPanel({
      transactions: [
        txn({ notes: 'mine' }),
        txn({ id: 2, security_id: 9, notes: 'someone else' }),
      ],
      dividends: [
        dividend({ notes: 'my payout' }),
        dividend({ id: 2, security_id: 9, notes: 'other payout' }),
      ],
    })
    expect(screen.getByText('mine')).toBeTruthy()
    expect(screen.queryByText('someone else')).toBeNull()
    expect(screen.getByText('my payout')).toBeTruthy()
    expect(screen.queryByText('other payout')).toBeNull()
    await screen.findByTestId('echart')
  })

  it('rides the split factor on the type cell — the dummy zeros are not figures', async () => {
    renderPanel({
      transactions: [
        txn({ type: 'split', shares: '0', price: '0', split_factor: '2.000000' }),
      ],
    })
    expect(screen.getByText('split ×2')).toBeTruthy()
    await screen.findByTestId('echart')
  })

  it('leads the meta line with the full name the panel header no longer carries', async () => {
    renderPanel()
    expect(screen.getByText(/AAA Inc · Semiconductors · Stock/)).toBeTruthy()
    await screen.findByTestId('echart')
  })

  it('offers the what-if deep link into Taxes, carrying this ticker', async () => {
    renderPanel()
    const link = screen.getByRole('link', { name: 'Model selling AAA in Taxes →' })
    // The query param the what-if card reads to seed one sale leg (TaxesPage's
    // useSearchParams → WhatIfPanel's initialTicker).
    expect(link.getAttribute('href')).toBe('/taxes?whatif=AAA')
    await screen.findByTestId('echart')
  })

  it('encodes a ticker the URL would otherwise eat', async () => {
    renderPanel({ holding: holding({ ticker: 'BRK.B+X' }) })
    expect(
      (screen.getByRole('link', { name: 'Model selling BRK.B+X in Taxes →' }) as HTMLAnchorElement)
        .getAttribute('href'),
    ).toBe('/taxes?whatif=BRK.B%2BX')
    await screen.findByTestId('echart')
  })
})

describe('HoldingDetailPanel price history', () => {
  it('fetches a year by default and charts the formatted dates', async () => {
    renderPanel()
    const chart = await screen.findByTestId('echart')
    expect(fetchPriceHistory).toHaveBeenCalledWith('AAA', 365)
    expect(chart.getAttribute('data-categories')).toBe(
      'Aug 12, 2026,Aug 13, 2026,Aug 14, 2026',
    )
  })

  it('refetches on a span change and ignores a re-click of the active span', async () => {
    renderPanel()
    await screen.findByTestId('echart')

    fireEvent.click(screen.getByRole('button', { name: '3Y' }))
    await waitFor(() => expect(fetchPriceHistory).toHaveBeenCalledWith('AAA', 1095))
    expect(fetchPriceHistory).toHaveBeenCalledTimes(2)

    // Same-span re-click must not refetch (MonthlyUpdatePage's same-month lesson).
    fireEvent.click(screen.getByRole('button', { name: '3Y' }))
    await waitFor(() => expect(fetchPriceHistory).toHaveBeenCalledTimes(2))
  })

  it('banners a failed load and Retry re-asserts the same span', async () => {
    vi.mocked(fetchPriceHistory)
      .mockRejectedValueOnce(new ApiError('history unavailable', 503))
      .mockResolvedValueOnce(POINTS)
    renderPanel()

    expect(await screen.findByText('history unavailable')).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading price history' }))
    await screen.findByTestId('echart')
    expect(fetchPriceHistory).toHaveBeenLastCalledWith('AAA', 365)
    expect(screen.queryByText('history unavailable')).toBeNull()
  })

  it('says why one bar cannot be a line, in manual-pricing words when it applies', async () => {
    vi.mocked(fetchPriceHistory).mockResolvedValue({ ticker: 'AAA', points: [POINTS.points[0]] })
    renderPanel({ holding: holding({ is_manual_priced: true }) })

    expect(
      await screen.findByText(/Not enough price history to chart yet — manual pricing adds/),
    ).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })
})
