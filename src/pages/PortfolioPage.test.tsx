import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
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
import { fetchRefreshStatus, fetchSparklines, refreshPrices } from '../api/prices'

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

// A scope whose owner holds nothing: scope-consistent ZERO totals, no rows. What the page
// must do with it is render the panels' own empty notes (spec §5).
const EMPTY_HOLDINGS: HoldingsResponse = {
  as_of: null,
  latest_quote_at: null,
  totals: {
    market_value: '0.00',
    cost_basis: '0.00',
    unrealized_gl: '0.00',
    unrealized_gl_pct: null,
    day_change_amount: null,
    day_change_pct: null,
    realized_gl: '0.00',
    dividends_collected: '0.00',
    annual_income: '0.00',
    unpriced_count: 0,
  },
  holdings: [],
}

function allocationOut(by: AllocationDimension): AllocationResponse {
  return {
    by,
    total_market_value: '4500.00',
    slices: [{ key: 'Index', market_value: '4500.00', weight_pct: '1.0', holdings: 1 }],
  }
}

function emptyAllocation(by: AllocationDimension): AllocationResponse {
  return { by, total_market_value: '0.00', slices: [] }
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

it('scopes the five owner-filterable fetches to the picked chip, and back on All', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  const historyCallsBefore = vi.mocked(fetchHistory).mock.calls.length

  fireEvent.click(chip('Sam'))
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(SAM.id))
  expect(fetchTransactions).toHaveBeenCalledWith(SAM.id)
  expect(fetchDividends).toHaveBeenCalledWith(SAM.id)
  expect(fetchRealized).toHaveBeenCalledWith(SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('industry', SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('type', SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('account', SAM.id)
  expect(chip('Sam').getAttribute('aria-pressed')).toBe('true')
  expect(chip('All').getAttribute('aria-pressed')).toBe('false')
  // The household-wide four ride the SAME load() but never gain a scope: the weekly
  // series is one row per Monday by design (spec §2 decision log).
  expect(vi.mocked(fetchHistory).mock.calls.length).toBeGreaterThan(historyCallsBefore)
  expect(fetchHistory).toHaveBeenLastCalledWith()
  expect(fetchSecurities).toHaveBeenLastCalledWith()
  expect(fetchSparklines).toHaveBeenLastCalledWith()
  expect(fetchRefreshStatus).toHaveBeenLastCalledWith()

  fireEvent.click(chip('Joint'))
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith('joint'))
  expect(fetchAllocation).toHaveBeenCalledWith('type', 'joint')

  fireEvent.click(chip('All'))
  // null, not omitted: the client turns null into no param at all (portfolio.test.ts).
  await waitFor(() => expect(fetchHoldings).toHaveBeenLastCalledWith(null))
  expect(fetchRealized).toHaveBeenLastCalledWith(null)
  expect(fetchAllocation).toHaveBeenLastCalledWith('account', null)
})

it('re-clicking the active chip spends no request', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledTimes(1))
  fireEvent.click(chip('All'))
  expect(vi.mocked(fetchHoldings).mock.calls.length).toBe(1)
})

it('paints instantly from a seeded snapshot under the household key and revalidates', () => {
  // 'portfolio:all' — the key mount READS and mount's load() WRITES. A static 'portfolio'
  // key would make every scope share one slot.
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  // Never-resolving holdings: whatever is on screen came from the seed alone.
  vi.mocked(fetchHoldings).mockReturnValue(new Promise(() => {}))
  const { container } = renderPage()
  expect(screen.getByText('Portfolio value')).toBeTruthy()
  expect(container.querySelector('.page-skeleton')).toBeNull()
  // Revalidating under the house dim, and the request really went out.
  expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
  expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
  // A cached paint renders the performance chart still. [0] and not .every(): the
  // allocation panel's two charts take no animateEntrance prop at all (they redraw on
  // their own dimension toggle), so only this one carries the flag.
  expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('false')
})

it('leaves the charts still when the revalidation payload is identical', async () => {
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  const { container } = renderPage()
  // The dim lifting is the revalidation landing — .finally runs on every resolution.
  await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
  expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('false')
})

it('a single-person household issues the pre-ownership requests, scope-free', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalled())
  // Byte-identity pin (spec §7): null is what the client turns into NO param at all
  // (portfolio.test.ts), so a one-person household sends exactly the eleven pre-ownership
  // requests — and there are no chips to send anything else.
  expect(fetchHoldings).toHaveBeenCalledWith(null)
  expect(fetchTransactions).toHaveBeenCalledWith(null)
  expect(fetchDividends).toHaveBeenCalledWith(null)
  expect(fetchRealized).toHaveBeenCalledWith(null)
  expect(fetchAllocation).toHaveBeenCalledWith('industry', null)
  expect(fetchAllocation).toHaveBeenCalledWith('type', null)
  expect(fetchAllocation).toHaveBeenCalledWith('account', null)
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
})

it('keys the snapshot by owner — a chip flip is a cache MISS that re-arms the charts', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  renderPage()
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(null))
  fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(SAM.id))
  // Different key, so the household payload can never satisfy the equality skip.
  await waitFor(() =>
    expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('true'),
  )
})

// ── Owner-switch stranding regression (2026-08-28 bug class, fixed on NetWorthPage
// @9e20d15) ──────────────────────────────────────────────────────────────────────────────
// The identical-payload revalidation skip must be judged against the RENDERED snapshot,
// never against the snapshot cache: render and cache diverge across a scope switch (the
// previous scope is still on screen while the next scope's key is already warm), so a
// cache-compared skip left the empty owner view on screen forever.
it('restores the household view after visiting an owner with no positions', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  vi.mocked(fetchAllocation).mockImplementation((by, scope) =>
    Promise.resolve(scope === SAM.id ? emptyAllocation(by) : allocationOut(by)),
  )
  vi.mocked(fetchTransactions).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? [] : TRANSACTIONS),
  )
  vi.mocked(fetchDividends).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? [] : DIVIDENDS),
  )
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())

  fireEvent.click(chip('Sam'))
  expect(await screen.findByText(NO_HOLDINGS_NOTE)).toBeTruthy()

  fireEvent.click(chip('All'))
  // Peek-seed: the warm destination key paints BEFORE its revalidation lands.
  expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull()
  // And the revalidation — whose payload is identical to that warm snapshot — must not
  // undo it or skip its way back into the empty view.
  await waitFor(() => expect(fetchHoldings).toHaveBeenLastCalledWith(null))
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())
})

// The same 9e20d15 class from the other side, and the one the BEHAVIOURAL suite cannot
// reach: every chip roundtrip above leaves the cache and the screen agreeing by the time
// the revalidation lands (the peek-seed put the warm payload on screen itself), so a skip
// judged on the cache still passes them. This pins the divergence directly — the cache
// holds B while the screen still shows A — and only a skip judged on the RENDERED snapshot
// lets B through. Deliberately a unit-level pin: no user gesture can force the split.
it('applies a revalidation that matches the cache but not the screen', async () => {
  // The hero tile is the readout, so the page starts from a SEEDED paint: a cached first
  // paint passes no countUp, and the tile then renders its `value` string exactly. A cold
  // mount would animate, and jsdom's rAF stamps never let that settle (StatTile.test.tsx
  // stubs the clock to finish it) — the assertion would be about a frame, not the guard.
  const heroValue = () => document.querySelector('.stat-tile-hero .stat-value')?.textContent
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  const { container } = renderPage()
  // Settled: payload A is on screen AND under 'portfolio:all' — `shown` and the cache agree.
  await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
  expect(heroValue()).toBe('$4,500.00')

  // Out of band, the cache ALONE advances to B. Key order matches load()'s snapshot literal
  // exactly — a reordered object would not stringify-match, and the mutant this test exists
  // to kill would survive.
  const HOLDINGS_B: HoldingsResponse = {
    ...holdingsOut(),
    totals: { ...holdingsOut().totals, market_value: '7777.00' },
  }
  setSnapshot('portfolio:all', {
    holdings: HOLDINGS_B,
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  // The five owner-scoped fetches now serve B. Only holdings actually moved; the other four
  // are restated so the whole revalidated payload is B by construction.
  vi.mocked(fetchHoldings).mockResolvedValue(HOLDINGS_B)
  vi.mocked(fetchTransactions).mockResolvedValue(TRANSACTIONS)
  vi.mocked(fetchDividends).mockResolvedValue(DIVIDENDS)
  vi.mocked(fetchRealized).mockResolvedValue(REALIZED)
  vi.mocked(fetchAllocation).mockImplementation((by) => Promise.resolve(allocationOut(by)))
  vi.mocked(refreshPrices).mockResolvedValue({
    updated: ['VOO'],
    failed: {},
    skipped_manual: [],
    duration_ms: 1000,
    dividends_ingested: 0,
  })

  // The page's own reload affordance — onRefresh chains straight into load().
  fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))
  // shown = A ≠ B, so the guard must NOT fire and B's hero figure must reach the tile. A
  // cache-compared skip sees previous = B == B, early-returns, and strands the page on A.
  await waitFor(() => expect(heroValue()).toBe('$7,777.00'))
})

// Pinned verbatim: this sentence is the page's only defence against reading the weekly
// performance line as one person's (spec §5).
const HOUSEHOLD_HINT =
  'Performance, sparklines and price refresh always cover the whole household — the owner ' +
  'chips scope holdings, allocation, dividends, transactions and realized gains.'

it('says the performance card is household-wide only while a scope is active', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  // Nothing is scoped on All, so the caveat would be noise.
  expect(screen.queryByText(HOUSEHOLD_HINT)).toBeNull()

  fireEvent.click(chip('Sam'))
  expect(await screen.findByText(HOUSEHOLD_HINT)).toBeTruthy()

  fireEvent.click(chip('Joint'))
  expect(screen.getByText(HOUSEHOLD_HINT)).toBeTruthy()

  fireEvent.click(chip('All'))
  await waitFor(() => expect(screen.queryByText(HOUSEHOLD_HINT)).toBeNull())
})

it('renders the panels real empty notes for an owner who holds nothing', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  vi.mocked(fetchAllocation).mockImplementation((by, scope) =>
    Promise.resolve(scope === SAM.id ? emptyAllocation(by) : allocationOut(by)),
  )
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())

  fireEvent.click(chip('Sam'))
  // HoldingsTable's OWN note, not an empty table that reads as a rendering bug.
  expect(await screen.findByText(NO_HOLDINGS_NOTE)).toBeTruthy()
  // The treemap and the donut both fall back to their notes rather than empty canvases.
  expect(screen.getAllByText('No priced holdings yet.').length).toBe(2)
  // And the performance chart is still up: it is household-wide, and the hint says so.
  expect(screen.getByText(HOUSEHOLD_HINT)).toBeTruthy()
  expect(screen.getAllByTestId('echart').length).toBeGreaterThan(0)
})
