import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSnapshots } from '../api/snapshotCache'
import type {
  AllocationDimension,
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  HouseholdOut,
  PortfolioHistory,
  RealizedResponse,
  RefreshStatus,
  SecurityOut,
  TransactionOut,
} from '../types/api'
import PortfolioPage from './PortfolioPage'

// importOriginal spread: the panels below import mutation helpers from the same module,
// and an unspread factory would blank them (AccountsCard.test.tsx's posture).
vi.mock('../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/portfolio')>()),
  fetchAllocation: vi.fn(),
  fetchDividends: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHoldings: vi.fn(),
  fetchRealized: vi.fn(),
  fetchSecurities: vi.fn(),
  fetchTransactions: vi.fn(),
  updateSecurity: vi.fn(),
}))
vi.mock('../api/prices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/prices')>()),
  fetchPriceHistory: vi.fn(),
  fetchRefreshStatus: vi.fn(),
  fetchSparklines: vi.fn(),
  refreshPrices: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each chart
// DRAWS is pinned in historyChartOptions.test.ts and allocationChartOptions.test.ts; this
// marker exposes only what this page owns: the series names and the entrance flag.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      animateEntrance = true,
    }: {
      option: { series?: { name?: string }[] }
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})

import { fetchHousehold } from '../api/household'
import {
  fetchAllocation,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchRealized,
  fetchSecurities,
  fetchTransactions,
} from '../api/portfolio'
import { fetchRefreshStatus, fetchSparklines } from '../api/prices'

const ME = { id: 1, name: 'Me', is_primary: true }
const SAM = { id: 2, name: 'Sam', is_primary: false }

function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME, SAM], marriage_date: null, ...over }
}

const SECURITIES: SecurityOut[] = [
  {
    id: 1,
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    industry: 'Index',
    holding_type: 'etf',
    is_manual_priced: false,
    is_active: true,
    annual_dividend: '6.00',
    ex_div_date: '2026-06-20',
  },
]

const TRANSACTIONS: TransactionOut[] = [
  {
    id: 11,
    security_id: 1,
    account: 'Fidelity Brokerage',
    type: 'buy',
    txn_date: '2026-01-05',
    shares: '10',
    price: '400.00',
    fees: null,
    split_factor: null,
    sort_index: 0,
    source: 'ui',
    notes: null,
  },
]

const DIVIDENDS: DividendOut[] = [
  {
    id: 21,
    security_id: 1,
    account: 'Fidelity Brokerage',
    pay_date: '2026-06-25',
    amount: '15.00',
    source: 'manual',
    ex_date: null,
    per_share: null,
    shares_held: null,
    notes: null,
  },
]

function holdingsOut(): HoldingsResponse {
  return {
    as_of: '2026-08-27T20:00:00Z',
    latest_quote_at: '2026-08-27T20:00:00Z',
    totals: {
      market_value: '4500.00',
      cost_basis: '4000.00',
      unrealized_gl: '500.00',
      unrealized_gl_pct: '0.125',
      day_change_amount: '10.00',
      day_change_pct: '0.0022',
      realized_gl: '0.00',
      dividends_collected: '15.00',
      annual_income: '60.00',
      unpriced_count: 0,
    },
    holdings: [
      {
        security_id: 1,
        ticker: 'VOO',
        name: 'Vanguard S&P 500 ETF',
        industry: 'Index',
        holding_type: 'etf',
        is_manual_priced: false,
        shares: '10',
        avg_cost: '400.00',
        cost_basis: '4000.00',
        price: '450.00',
        quoted_at: '2026-08-27T20:00:00Z',
        price_source: 'yfinance',
        day_change_pct: '0.0022',
        day_change_amount: '10.00',
        market_value: '4500.00',
        weight_pct: '1.0',
        unrealized_gl: '500.00',
        unrealized_gl_pct: '0.125',
        realized_gl: '0.00',
        dividends_collected: '15.00',
        annual_dividend: '6.00',
        annual_income: '60.00',
        yield_pct: '0.0133',
        yoc_pct: '0.015',
        xirr_pct: '0.09',
        accounts: ['Fidelity Brokerage'],
        warnings: [],
      },
    ],
  }
}

function allocationOut(by: AllocationDimension): AllocationResponse {
  return {
    by,
    total_market_value: '4500.00',
    slices: [{ key: 'Index', market_value: '4500.00', weight_pct: '1.0', holdings: 1 }],
  }
}

// Two dates minimum — portfolioHistoryOption returns null below that.
const HISTORY: PortfolioHistory = {
  dates: ['2026-08-17', '2026-08-24'],
  market_value: ['4400.00', '4500.00'],
  cost_basis: ['4000.00', '4000.00'],
  sp500: ['4300.00', '4450.00'],
  benchmark: ['4350.00', '4480.00'],
}

const REALIZED: RealizedResponse = { total: '0.00', rows: [] }
const STATUS: RefreshStatus = { last: null, next_run_at: null }

const NO_HOLDINGS_NOTE = 'No holdings yet — add transactions below.'

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchHoldings).mockResolvedValue(holdingsOut())
  vi.mocked(fetchSecurities).mockResolvedValue(SECURITIES)
  vi.mocked(fetchTransactions).mockResolvedValue(TRANSACTIONS)
  vi.mocked(fetchDividends).mockResolvedValue(DIVIDENDS)
  vi.mocked(fetchAllocation).mockImplementation((by) => Promise.resolve(allocationOut(by)))
  vi.mocked(fetchSparklines).mockResolvedValue({})
  vi.mocked(fetchHistory).mockResolvedValue(HISTORY)
  vi.mocked(fetchRealized).mockResolvedValue(REALIZED)
  vi.mocked(fetchRefreshStatus).mockResolvedValue(STATUS)
  vi.mocked(fetchHousehold).mockResolvedValue(household())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <PortfolioPage />
    </MemoryRouter>,
  )
}

// Scoped to the Owner group on purpose: the performance card carries RangeChips with an
// "All" of its own (NetWorthPage.test.tsx's lesson).
const ownerChips = () => screen.getByRole('group', { name: 'Owner' })
const chip = (label: string) =>
  [...ownerChips().querySelectorAll('button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement

it('hides the owner chips for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Portfolio')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  // Nothing to choose between: one person makes the chips one-option UI.
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  // The four household-wide fetches never take an argument, before or after this batch.
  expect(fetchSecurities).toHaveBeenCalledWith()
  expect(fetchHistory).toHaveBeenCalledWith()
  expect(fetchSparklines).toHaveBeenCalledWith()
  expect(fetchRefreshStatus).toHaveBeenCalledWith()
  // (The single-person BYTE-IDENTITY pin on the five scoped fetches lands in Task 3,
  // where the scope is actually wired into load().)
})

it('renders All / each person / Joint once a partner exists', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Owner' })
  expect([...chips.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    'All',
    'Me',
    'Sam',
    'Joint',
  ])
  // Primary first, then everyone else by id, joint last — the same order the server uses.
  expect(chip('All').getAttribute('aria-pressed')).toBe('true')
})

it('keeps the page alive when the household endpoint fails', async () => {
  vi.mocked(fetchHousehold).mockRejectedValue(new Error('household down'))
  renderPage()
  // The scope control is an affordance; losing it must cost the chips and nothing else.
  expect(await screen.findByText('Portfolio')).toBeTruthy()
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalled())
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())
})
