import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { hintLabel } from '../components/InfoHint'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import type {
  AllocationDimension,
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  HouseholdOut,
  PortfolioAccountOut,
  PortfolioHistory,
  RealizedResponse,
  RefreshStatus,
  SecurityOut,
  TransactionOut,
} from '../types/api'
import PortfolioPage from './PortfolioPage'
import { expectInDocumentOrder } from '../testing/domOrder'

// importOriginal spread: the panels below import mutation helpers from the same module,
// and an unspread factory would blank them (AccountsCard.test.tsx's posture).
vi.mock('../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/portfolio')>()),
  fetchAllocation: vi.fn(),
  fetchDividendEvents: vi.fn(),
  fetchDividends: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHoldings: vi.fn(),
  fetchPortfolioAccounts: vi.fn(),
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
vi.mock('../api/allocation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/allocation')>()),
  fetchAllocationData: vi.fn(), fetchClassifications: vi.fn(), fetchEmployerExposure: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each chart
// DRAWS is pinned in historyChartOptions.test.ts and allocationChartOptions.test.ts; this
// marker exposes only what this page owns: the series names and the entrance flag.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      animateEntrance = true,
      onWidth,
    }: {
      option: { series?: { name?: string }[]; xAxis?: { axisLabel?: { customValues?: unknown[] } } }
      ariaLabel?: string
      animateEntrance?: boolean
      onWidth?: (width: number) => void
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        // The weekly axis's label set, counted; a right-click stands in for an 800px measurement.
        'data-xlabels': String(option.xAxis?.axisLabel?.customValues?.length ?? ''),
        onContextMenu: () => onWidth?.(800),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})

// The real builder, watched: a zoom or a range chip must not rebuild the chart's events.
vi.mock('../components/portfolio/performanceEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/portfolio/performanceEvents')>()
  return { ...actual, buildPerformanceEvents: vi.fn(actual.buildPerformanceEvents) }
})

import { fetchHousehold } from '../api/household'
import { buildPerformanceEvents } from '../components/portfolio/performanceEvents'
import { fetchAllocationData, fetchClassifications, fetchEmployerExposure } from '../api/allocation'
import {
  fetchAllocation,
  fetchDividendEvents,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchPortfolioAccounts,
  fetchRealized,
  fetchSecurities,
  fetchTransactions,
} from '../api/portfolio'
import { fetchPriceHistory, fetchRefreshStatus, fetchSparklines, refreshPrices } from '../api/prices'
import { formatDate, formatDateTime } from '../utils/format'
import { addDays } from '../utils/months'

// The roster behind the two ledgers' Account boxes (2026-09-09 audit item 27).
const ACCOUNTS: PortfolioAccountOut[] = [
  { id: 1, label: 'Fidelity Brokerage', person_id: 1 },
  { id: 2, label: 'Joint Taxable', person_id: null },
]

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

const NO_HOLDINGS_NOTE = 'No holdings yet — add transactions in Manage.'

beforeEach(() => {
  vi.mocked(fetchAllocationData).mockImplementation(async (by, owner) => ({
    by, scope_key: String(owner ?? 'household'), total_market_value: owner === SAM.id ? '0.00' : '4500.00',
    as_of: '2026-08-27T20:00:00Z', latest_quote_at: '2026-08-27T20:00:00Z',
    slices: owner === SAM.id ? [] : [{ key: 'equity', label: 'Equity', market_value: '4500.00', weight_pct: '1.0', holdings: 1, is_unknown: false, members: [] }],
    coverage: { holding_count: 1, priced_count: 1, unpriced_count: 0, classified_count: 1, classified_market_value: '4500.00', unknown_market_value: '0.00', classified_weight_pct: '1.0', unpriced_holdings: [], warnings: [] },
    target_set: null, draft_target_set: null, drift: [], source_href: '/portfolio?section=holdings',
  }))
  vi.mocked(fetchClassifications).mockResolvedValue([])
  vi.mocked(fetchEmployerExposure).mockResolvedValue({ ticker: null, scope_key: 'household', as_of: '2026-08-27', quoted_at: null, held_shares: '0', held_value: null, held_weight_pct: null, priced_portfolio_value: '4500.00', unvested_shares: 0, unvested_value: null, unvested_scope: 'primary', warnings: [] })
  clearSnapshots()
  // The shared scope remembers owner/range in localStorage, so one test's chip would
  // otherwise become the next test's default (useScope's memory fallback).
  localStorage.clear()
  vi.mocked(fetchHoldings).mockResolvedValue(holdingsOut())
  vi.mocked(fetchSecurities).mockResolvedValue(SECURITIES)
  vi.mocked(fetchTransactions).mockResolvedValue(TRANSACTIONS)
  vi.mocked(fetchDividends).mockResolvedValue(DIVIDENDS)
  vi.mocked(fetchDividendEvents).mockResolvedValue([])
  vi.mocked(fetchAllocation).mockImplementation((by) => Promise.resolve(allocationOut(by)))
  vi.mocked(fetchSparklines).mockResolvedValue({})
  vi.mocked(fetchHistory).mockResolvedValue(HISTORY)
  vi.mocked(fetchRealized).mockResolvedValue(REALIZED)
  vi.mocked(fetchRefreshStatus).mockResolvedValue(STATUS)
  // The drill-in detail panel's own fetch — reached whenever a holding is opened, which
  // the ?ticker= arrival now does straight from the URL.
  vi.mocked(fetchPriceHistory).mockResolvedValue({ ticker: 'VOO', points: [] })
  vi.mocked(fetchHousehold).mockResolvedValue(household())
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue(ACCOUNTS)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// The URL as the router holds it — the scope tests pin the chip → URL direction.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderPage(entry = '/portfolio') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PortfolioPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

// The palette's holding entries deep-link by TICKER (2026-09-03 shell spec §9).
it('opens the holding named by ?ticker= straight into its detail', async () => {
  renderPage('/portfolio?ticker=voo')
  // Uppercased on the way in: tickers are stored that way, and a deep link typed by hand
  // must not miss on case alone.
  expect(await screen.findByRole('heading', { name: /Holdings — VOO/ })).toBeTruthy()
})

it('leaves the table up for a ?ticker= nobody holds', async () => {
  renderPage('/portfolio?ticker=ZZZZ')
  // The detail resolves to no holding and folds away — the drill's existing posture.
  expect(await screen.findByRole('heading', { name: 'Holdings' })).toBeTruthy()
})

it('?tab= scrolls the records strip in and focuses its first field', async () => {
  // jsdom implements no scrollIntoView (HoldingDetailPanel carries the same note).
  const scrollIntoView = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: scrollIntoView,
    configurable: true,
    writable: true,
  })
  try {
    renderPage('/portfolio?tab=dividends')
    // The panel the tab selects mounts first; the scroll and focus ride a setTimeout 0
    // behind it, which is why this waits rather than asserting straight away.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    await waitFor(() =>
      expect(document.getElementById('portfolio-records')?.contains(document.activeElement)).toBe(
        true,
      ),
    )
  } finally {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }
})

// Scoped to the owner group on purpose: the scope row's time-range group carries an
// "All" of its own (NetWorthPage.test.tsx's lesson). The row labels it "Whose".
const ownerChips = () => screen.getByRole('group', { name: 'Whose' })
const chip = (label: string) =>
  [...ownerChips().querySelectorAll('button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement

it('focuses the visible record editor and preserves its draft through other views', async () => {
  render(<MemoryRouter initialEntries={['/portfolio?tab=securities']}><PortfolioPage /><Link to="/portfolio?tab=transactions">Open transaction editor</Link></MemoryRouter>)
  const ticker = await screen.findByRole('textbox', { name: 'Ticker' })
  await waitFor(() => expect(document.activeElement).toBe(ticker))
  fireEvent.change(ticker, { target: { value: 'DRAFT' } })
  fireEvent.click(screen.getByRole('link', { name: 'Open transaction editor' }))
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Transactions' }).getAttribute('aria-selected')).toBe('true'))
  expect(document.activeElement?.closest('[hidden]')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Securities' }))
  expect((screen.getByRole('textbox', { name: 'Ticker' }) as HTMLInputElement).value).toBe('DRAFT')
})

it('opens the transaction editor when Manage follows a dividend arrival', async () => {
  renderPage('/portfolio?tab=dividends')
  await screen.findByRole('tab', { name: 'Income', selected: true })
  fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
  expect(await screen.findByRole('tab', { name: 'Transactions', selected: true })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Account' }).closest('[hidden]')).toBeNull()
})

it('hides the owner chips for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Portfolio')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  // Nothing to choose between: one person makes the chips one-option UI.
  expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
  // The five household-wide fetches never take an argument, before or after this batch.
  expect(fetchSecurities).toHaveBeenCalledWith()
  expect(fetchHistory).toHaveBeenCalledWith()
  expect(fetchSparklines).toHaveBeenCalledWith()
  expect(fetchRefreshStatus).toHaveBeenCalledWith()
  expect(fetchDividendEvents).toHaveBeenCalledWith()
  // (The single-person BYTE-IDENTITY pin on the five scoped fetches lands in Task 3,
  // where the scope is actually wired into load().)
})

it('renders All / each person / Joint once a partner exists', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Whose' })
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
  expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())
})

it('scopes the five owner-filterable fetches to the picked chip, and back on All', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Whose' })
  const historyCallsBefore = vi.mocked(fetchHistory).mock.calls.length

  fireEvent.click(chip('Sam'))
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(SAM.id))
  expect(fetchTransactions).toHaveBeenCalledWith(SAM.id)
  expect(fetchDividends).toHaveBeenCalledWith(SAM.id)
  expect(fetchRealized).toHaveBeenCalledWith(SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('type', SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('account', SAM.id)
  expect(chip('Sam').getAttribute('aria-pressed')).toBe('true')
  expect(chip('All').getAttribute('aria-pressed')).toBe('false')
  // The household-wide five ride the SAME load() but never gain a scope: the weekly
  // series is one row per Monday by design (spec §2 decision log), and the ex-dividend
  // annotations ride that household-wide chart.
  expect(vi.mocked(fetchHistory).mock.calls.length).toBeGreaterThan(historyCallsBefore)
  expect(fetchHistory).toHaveBeenLastCalledWith()
  expect(fetchSecurities).toHaveBeenLastCalledWith()
  expect(fetchSparklines).toHaveBeenLastCalledWith()
  expect(fetchRefreshStatus).toHaveBeenLastCalledWith()
  expect(fetchDividendEvents).toHaveBeenLastCalledWith()

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
  await screen.findByRole('group', { name: 'Whose' })
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
    accounts: ACCOUNTS,
    primaryName: 'Me',
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    dividendEvents: [],
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
    accounts: ACCOUNTS,
    primaryName: 'Me',
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    dividendEvents: [],
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
  expect(fetchAllocation).toHaveBeenCalledWith('type', null)
  expect(fetchAllocation).toHaveBeenCalledWith('account', null)
  expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
})

it('keys the snapshot by owner — a chip flip is a cache MISS that re-arms the charts', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    accounts: ACCOUNTS,
    primaryName: 'Me',
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    dividendEvents: [],
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

// …and the other direction: coming BACK to a warm scope must leave them still. The peek
// paints the cached payload during render and the revalidation returns the very same bytes,
// so load()'s equality skip has to fire — which it only can while `shown` mirrors what was
// actually APPLIED to the page. A ref the render-time peek cannot write goes stale here,
// the skip misses, and the identical payload re-arms every chart.
it('leaves the charts still when a chip flip returns to a warm scope', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    accounts: ACCOUNTS,
    primaryName: 'Me',
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    dividendEvents: [],
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  const { container } = renderPage()
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(null))
  await screen.findByRole('group', { name: 'Whose' })

  // Sam is a cache miss, so his payload genuinely re-arms them (the pin above).
  fireEvent.click(chip('Sam'))
  await waitFor(() =>
    expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('true'),
  )

  fireEvent.click(chip('All'))
  await waitFor(() => expect(vi.mocked(fetchHoldings)).toHaveBeenLastCalledWith(null))
  // The dim lifting is that revalidation landing — .finally runs on every resolution.
  await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
  expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('false')
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
  renderPage('/portfolio?section=holdings')
  await screen.findByRole('group', { name: 'Whose' })
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
    accounts: ACCOUNTS,
    primaryName: 'Me',
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    dividendEvents: [],
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
    accounts: ACCOUNTS,
    primaryName: 'Me',
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    dividendEvents: [],
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

it('shows the alert alone on a failed first load and retries back into the skeleton', async () => {
  vi.mocked(fetchHoldings).mockRejectedValue(new ApiError('Portfolio service down', 503))
  const { container } = renderPage()
  // No data behind it, so the frame shows the alert instead of a page of empty tables.
  expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the portfolio — the server had a problem (HTTP 503)")
  expect(screen.queryByText('Portfolio value')).toBeNull()

  // A retry that leaves the error set would keep this alert on screen for its whole
  // flight; clearing it is what returns the frame to the ghost layout.
  vi.mocked(fetchHoldings).mockReturnValue(new Promise(() => {}))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(container.querySelector('.page-skeleton')).not.toBeNull()
  // Ghost parity (spec §9): five real tiles, five ghosts.
  expect(container.querySelectorAll('.page-skeleton .skeleton-tile')).toHaveLength(5)
})

// Pinned verbatim, both halves: together they are the page's only defence against reading
// the weekly performance line as one person's (spec §5) — and, since A3, against wondering
// where the live dot went on a person view. The half that answers "whose view is this?"
// lives in the scope row's ⓘ (ScopeBar's ownerHint), so it is on screen at every scope
// including All; the half that only means something beside the chart stays on the card.
const OWNER_HINT =
  "A person's view is their own portfolio accounts plus the joint ones — that is what a " +
  'joint account is. Joint shows only the shared accounts. Performance, sparklines and ' +
  'price refresh always cover the whole household.'
const HOUSEHOLD_HINT =
  'The owner chips scope holdings, allocation, dividends, transactions and realized gains ' +
  '— not this chart, the sparklines or price refresh, which always cover the whole ' +
  'household. Person views omit the live price dot because the history is household-wide.'

it('opens the allocation donut from its task view while retaining performance', async () => {
  renderPage()
  await screen.findByText('Performance')
  expect(screen.getByLabelText(/Line chart of portfolio value against cost basis/)).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Allocation' }))
  await screen.findByLabelText('Portfolio allocation by asset class')
  expect(screen.getByRole('group', { name: 'Export portfolio-performance', hidden: true })).toBeTruthy()
  // The industry heat treemap lives with the holdings now (2026-09-13 polish §11), not here.
  expect(screen.queryByLabelText(/Holdings grouped by known industry/)).toBeNull()
  expect(document.querySelector('details.allocation-heat')).toBeNull()
})

it('draws the industry heat treemap under the holdings table with its own metric toggle', async () => {
  renderPage('/portfolio?section=holdings')
  const table = (await screen.findByRole('heading', { name: 'Holdings' })).closest('.card') as HTMLElement
  const heat = (await screen.findByLabelText(/Holdings grouped by known industry/)).closest('.chart-card') as HTMLElement
  expectInDocumentOrder(table, heat)
  expect(screen.getByRole('group', { name: 'Heat metric' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Day change' }))
  expect(screen.getByRole('button', { name: 'Day change' }).getAttribute('aria-pressed')).toBe('true')
})

it("overrides the shell's default answer to Whose with the portfolio one", async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Whose' })
  // The button is named by its first four words now (motion spec §8) and the shell's default
  // answer opens with the very same four — so the OVERRIDE only shows in the bubble.
  fireEvent.click(screen.getByRole('button', { name: hintLabel(OWNER_HINT) }))
  expect(screen.getByRole('tooltip').textContent).toBe(OWNER_HINT)
})

it('says the performance card is household-wide only while a scope is active', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Whose' })
  // Nothing is scoped on All, so the caveat would be noise.
  expect(screen.queryByText(HOUSEHOLD_HINT)).toBeNull()
  // ...though the scope row's own answer is up the whole time.
  expect(screen.getByRole('button', { name: hintLabel(OWNER_HINT) })).toBeTruthy()

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
  renderPage('/portfolio?section=holdings')
  await screen.findByRole('group', { name: 'Whose' })
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())

  fireEvent.click(chip('Sam'))
  // HoldingsTable's OWN note, not an empty table that reads as a rendering bug.
  expect(await screen.findByText(NO_HOLDINGS_NOTE)).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Allocation' }))
  await waitFor(() => expect(fetchAllocationData).toHaveBeenCalledWith('asset_class', SAM.id))
  // The donut falls back to its note rather than an empty canvas. The heat treemap now lives in
  // the Holdings view (2026-09-13 polish §11) and shows its own note THERE, so the count here is one.
  const allocation = screen.getByRole('tabpanel', { name: 'Allocation' })
  await waitFor(() => expect(within(allocation).getAllByText('No priced holdings yet.').length).toBe(1))
  // …and the heat-treemap's colour legend goes with the cells it describes: "Orange =
  // loss, blue = gain; the deeper the tone…" under an empty note is a key to nothing.
  expect(screen.queryByText(/Orange = loss, blue = gain/)).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
  // And the performance chart is still up: it is household-wide, and the hint says so.
  expect(screen.getByText(HOUSEHOLD_HINT)).toBeTruthy()
  expect(screen.getAllByTestId('echart').length).toBeGreaterThan(0)
})

// ── Live ping owner scope (2026-08-31 tier-1 A3) ──────────────────────────────────────────
// /portfolio/history is household-wide by design (no owner param), but the ping is derived
// from the OWNER-FILTERED holdings — plotting a person's total at the end of the household
// series drew a fake cliff. The ping (and its dashed connector, which rides the Live
// series' markLine) renders only on the All view.
// ── The performance lede (2026-09-23 spec §C8, review round 1) ────────────────────────────
// The chart had the honest benchmark and hid its answer; the card now states it, over the
// window the chart is showing. Fifteen months whose legs start level at 4,000.00. From Sep 1,
// 2025 the starting-balance leg grows ×1.08 (4,100 → 4,428), so the portfolio's $100 lead
// that day would have become $108 in VOO; it ends $50 BEHIND the same deposits instead:
// −50 − 108 = $158 behind the same money over 1Y, $50 behind the same deposits over All.
const LONG_HISTORY: PortfolioHistory = {
  dates: ['2025-06-02', '2025-09-01', '2026-08-24'],
  market_value: ['4000.00', '4300.00', '4500.00'],
  cost_basis: ['4000.00', '4100.00', '4114.00'],
  sp500: ['4000.00', '4100.00', '4428.00'],
  benchmark: ['4000.00', '4200.00', '4550.00'],
}
it('states the gap to the same money in VOO above the chart, following the range chip', async () => {
  vi.mocked(fetchHistory).mockResolvedValue(LONG_HISTORY)
  renderPage()
  const card = () => screen.getByText('Performance').closest('section') as HTMLElement
  // The scope row opens on 1Y, so the sentence says which window it measured.
  await waitFor(() =>
    expect(card().querySelector('.chart-lede')?.textContent).toBe(
      'Over 1Y: behind the same money in VOO by $158',
    ),
  )
  // The figure wears the strip's bold ink; the words stay muted.
  expect(card().querySelector('.chart-lede b')?.textContent).toBe('$158')
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Time range' })).getByRole('button', { name: 'All' }),
  )
  await waitFor(() =>
    expect(card().querySelector('.chart-lede')?.textContent).toBe(
      'Behind the same deposits in VOO by $50',
    ),
  )
})

it('says since when the history is shorter than the range chip', async () => {
  // HISTORY is two weeks from Aug 17, 2026, legs level at the start: the 1Y chip cannot claim a year.
  vi.mocked(fetchHistory).mockResolvedValue({
    ...HISTORY,
    sp500: ['4400.00', '4550.00'],
    benchmark: ['4400.00', '4530.00'],
  })
  renderPage()
  const card = () => screen.getByText('Performance').closest('section') as HTMLElement
  await waitFor(() =>
    expect(card().querySelector('.chart-lede')?.textContent).toBe(
      'Since Aug 17, 2026: behind the same money in VOO by $30',
    ),
  )
})

// Code review 4: the events depend on the ledgers and the dates, never on the window — a range
// chip, a ctrl+wheel zoom or a pan used to rebuild every one of them.
it('keeps the chart events across range changes: they are built from the ledgers, not the window', async () => {
  renderPage()
  const card = () => screen.getByText('Performance').closest('section') as HTMLElement
  await waitFor(() => expect(card().querySelector('.chart-lede')?.textContent).toMatch(/^Since/))
  const built = vi.mocked(buildPerformanceEvents).mock.calls.length
  expect(built).toBeGreaterThan(0)
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Time range' })).getByRole('button', { name: 'All' }),
  )
  await waitFor(() => expect(card().querySelector('.chart-lede')?.textContent).toMatch(/^Behind|^Ahead|^Level/))
  expect(vi.mocked(buildPerformanceEvents).mock.calls.length).toBe(built)
})

// Code review 5: the weekly axis takes as many month labels as the chart is wide enough for.
it("labels the weekly axis for the chart's measured width", async () => {
  // Forty-four Mondays from Nov 3, 2025: ten month starts, Nov through Aug.
  const mondays = Array.from({ length: 44 }, (_, i) => addDays('2025-11-03', 7 * i))
  const flat = mondays.map(() => '1.00')
  vi.mocked(fetchHistory).mockResolvedValue({ dates: mondays, market_value: flat, cost_basis: flat, sp500: flat, benchmark: flat })
  renderPage()
  const chart = () => screen.getAllByTestId('echart')[0]
  // At no known width: every month start.
  await waitFor(() => expect(chart().getAttribute('data-xlabels')).toBe('10'))
  fireEvent.contextMenu(chart()) // the chart measures 800px: a plot for nine labels
  // Every other month now, Jan-aligned: Nov, Jan, Mar, May, Jul.
  await waitFor(() => expect(chart().getAttribute('data-xlabels')).toBe('5'))
})

// ── Performance events on a rug (2026-09-23 spec §C8) ─────────────────────────────────────
// The provider's ex-dividend notices cover every security the book ever named; the chart
// keeps only those for a security held then or now — "now" is this page's own holdings.
it('draws ex-dividend notices on the rug only for securities the page holds', async () => {
  vi.mocked(fetchDividendEvents).mockResolvedValue([
    { security_id: 1, ex_date: '2026-08-18', per_share: '1.000000' }, // VOO — held
    { security_id: 99, ex_date: '2026-08-19', per_share: '2.000000' }, // never held
  ])
  renderPage()
  const performance = () => screen.getAllByTestId('echart')[0]
  await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Ex-dividend dates'))
  cleanup()
  // The page paints a revisit from its snapshot cache and revalidates underneath: without the
  // clear, the first render's notices would paint first and race the assertion below.
  clearSnapshots()
  vi.mocked(fetchDividendEvents).mockResolvedValue([
    { security_id: 99, ex_date: '2026-08-19', per_share: '2.000000' },
  ])
  renderPage()
  await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Live'))
  expect(performance().getAttribute('data-series')).not.toContain('Ex-dividend dates')
})

// Review round 1: the performance chart is household-wide whatever the Whose chip says, so its
// events — and the "held then or now" filter on the provider's notices — read the HOUSEHOLD's
// ledgers, fetched alongside a person's own.
it("annotates the household chart from the household's ledgers in a person's view", async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  vi.mocked(fetchTransactions).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? [] : TRANSACTIONS),
  )
  vi.mocked(fetchDividends).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? [] : DIVIDENDS),
  )
  // VOO: the household holds it; Sam does not.
  vi.mocked(fetchDividendEvents).mockResolvedValue([
    { security_id: 1, ex_date: '2026-08-18', per_share: '1.000000' },
  ])
  renderPage('/portfolio?owner=2')
  const performance = () => screen.getAllByTestId('echart')[0]
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(SAM.id))
  // Asked for once the person's own data is on screen.
  await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Ex-dividend dates'))
  expect(fetchHoldings).toHaveBeenCalledWith(null)
  expect(fetchTransactions).toHaveBeenCalledWith(null)
  expect(fetchDividends).toHaveBeenCalledWith(null)
  // …while Sam's own panels stay Sam's.
  expect(fetchRealized).toHaveBeenCalledWith(SAM.id)
  expect(fetchRealized).not.toHaveBeenCalledWith(null)
})

// Review round 1 re-review: the household's ledgers decorate one chart, so they must never cost
// the person's view its page — not by failing, not by being slow — and they are fetched only while
// the chart's view is showing.
describe("the household's ledgers never hold a person's view", () => {
  const exdivOnVoo = () =>
    vi.mocked(fetchDividendEvents).mockResolvedValue([
      { security_id: 1, ex_date: '2026-08-18', per_share: '1.000000' },
    ])
  const performance = () => screen.getAllByTestId('echart')[0]

  it("renders the person's tiles and chart when the household's request fails, on the person's events", async () => {
    // Sam holds VOO himself; the household's holdings request fails.
    vi.mocked(fetchHoldings).mockImplementation((scope) =>
      scope === null ? Promise.reject(new ApiError('Portfolio service down', 500)) : Promise.resolve(holdingsOut()),
    )
    exdivOnVoo()
    renderPage('/portfolio?owner=2')
    await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(null))
    expect(await screen.findByText('Portfolio value')).toBeTruthy()
    await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Ex-dividend dates'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("paints the person's view without waiting for the household's ledgers", async () => {
    vi.mocked(fetchHoldings).mockImplementation((scope) =>
      scope === null ? new Promise(() => {}) : Promise.resolve(holdingsOut()),
    )
    renderPage('/portfolio?owner=2')
    expect(await screen.findByText('Portfolio value')).toBeTruthy()
    await waitFor(() => expect(performance().getAttribute('data-series')).toContain('Portfolio value'))
  })

  // Code review 3: fetched once per need — after the person's own data on a cold view, not again
  // on a switch between people (the household is the same household), again after a save.
  const householdCalls = () => vi.mocked(fetchHoldings).mock.calls.filter(([scope]) => scope === null)

  it("fetches them once on a cold person view, after the person's own data", async () => {
    exdivOnVoo()
    renderPage('/portfolio?owner=2')
    await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Ex-dividend dates'))
    expect(householdCalls()).toHaveLength(1)
    const order = (scope: unknown) =>
      vi.mocked(fetchHoldings).mock.invocationCallOrder[vi.mocked(fetchHoldings).mock.calls.findIndex(([s]) => s === scope)]
    expect(order(null)).toBeGreaterThan(order(SAM.id))
  })

  it('does not fetch them again on a switch between people', async () => {
    renderPage('/portfolio?owner=2')
    await waitFor(() => expect(householdCalls()).toHaveLength(1))
    fireEvent.click(chip('Joint'))
    await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith('joint'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('owner=joint'))
    expect(householdCalls()).toHaveLength(1)
  })

  it("drops them when the household view saves, so its fresher snapshot wins until they are fetched again", async () => {
    // Nobody holds VOO at first; the household view's refresh then finds it held.
    let household = EMPTY_HOLDINGS
    vi.mocked(fetchHoldings).mockImplementation((scope) => Promise.resolve(scope === null ? household : EMPTY_HOLDINGS))
    vi.mocked(fetchTransactions).mockResolvedValue([])
    vi.mocked(fetchDividends).mockResolvedValue([])
    exdivOnVoo()
    vi.mocked(refreshPrices).mockResolvedValue({ updated: ['VOO'], failed: {}, skipped_manual: [], duration_ms: 10, dividends_ingested: 0 })
    renderPage('/portfolio')
    await screen.findByRole('group', { name: 'Whose' })
    fireEvent.click(chip('Sam'))
    await waitFor(() => expect(householdCalls()).toHaveLength(2)) // the All view's own + Sam's chart
    expect(performance().getAttribute('data-series')).not.toContain('Ex-dividend dates')
    fireEvent.click(chip('All'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('owner=all'))
    household = holdingsOut()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))
    await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Ex-dividend dates'))
    // Back in Sam's view the refetch never lands: the fresher household snapshot has to show.
    vi.mocked(fetchHoldings).mockImplementation((scope) => (scope === null ? new Promise(() => {}) : Promise.resolve(EMPTY_HOLDINGS)))
    fireEvent.click(chip('Sam'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('owner=2'))
    await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Ex-dividend dates'))
  })

  it("reuses the household's cached snapshot at once, and fetches only while the chart's view shows", async () => {
    // The household view was visited: its ledgers are warm. Sam holds nothing; the household VOO.
    setSnapshot('portfolio:all', {
      holdings: holdingsOut(),
      securities: SECURITIES,
      accounts: ACCOUNTS,
      primaryName: 'Me',
      transactions: TRANSACTIONS,
      dividends: DIVIDENDS,
      dividendEvents: [],
      byType: allocationOut('type'),
      byAccount: allocationOut('account'),
      sparklines: {},
      history: HISTORY,
      realized: REALIZED,
      refreshStatus: STATUS,
    })
    vi.mocked(fetchHoldings).mockImplementation((scope) =>
      scope === null ? new Promise(() => {}) : Promise.resolve(EMPTY_HOLDINGS),
    )
    vi.mocked(fetchTransactions).mockImplementation((scope) =>
      Promise.resolve(scope === SAM.id ? [] : TRANSACTIONS),
    )
    exdivOnVoo()
    // Holdings is showing: the household chart is not, so its ledgers are not fetched.
    renderPage('/portfolio?owner=2&section=holdings')
    expect(await screen.findByText(NO_HOLDINGS_NOTE)).toBeTruthy()
    expect(fetchHoldings).not.toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(null))
    // The fetch never lands, yet the warm household ledgers already annotate the chart.
    await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Ex-dividend dates'))
  })
})

it('renders the live ping only on the All view', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Whose' })
  const performance = () => screen.getAllByTestId('echart')[0]
  // holdingsOut()'s latest_quote_at (2026-08-27) is past HISTORY's last bar (2026-08-24),
  // so the household view bridges the series to a live ping. (Both ledger fixtures date
  // before the history window, so no Events series muddies the name list.)
  await waitFor(() =>
    expect(performance().getAttribute('data-series')).toBe(
      'Portfolio value|Cost basis|Same deposits in VOO|S&P 500 — starting balance only|Live',
    ),
  )

  fireEvent.click(chip('Sam'))
  // The scoped holdings still carry a quote — the OWNER is what retires the ping.
  await waitFor(() =>
    expect(performance().getAttribute('data-series')).toBe(
      'Portfolio value|Cost basis|Same deposits in VOO|S&P 500 — starting balance only',
    ),
  )

  fireEvent.click(chip('All'))
  await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Live'))
})

// ── Header staleness (2026-08-31 tier-1 A4, frontend-only) ────────────────────────────────
// as_of is the OLDEST quote across holdings, so one manual-priced straggler pins the header
// to an ancient date. Display-only fix: the same stale treatment Overview uses (amber via
// isStaleQuote) + a tooltip naming the clock the header is NOT showing — which the payload
// already carries as latest_quote_at (no new field; orchestrator amendment 2026-08-31).
const isoDaysAgo = (daysAgo: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return `${d.toISOString().slice(0, 10)}T20:00:00Z`
}

it('tones the header amber when the oldest quote is stale and names both clocks', async () => {
  vi.mocked(fetchHoldings).mockResolvedValue({
    ...holdingsOut(),
    as_of: isoDaysAgo(9),
    latest_quote_at: isoDaysAgo(1),
  })
  renderPage()
  await screen.findByText('Portfolio value')
  const header = screen.getByText(/^Prices as of /)
  expect(header.className).toBe('as-of stale')
  expect(header.getAttribute('title')).toBe(
    `oldest quote across holdings — newest ${formatDate(isoDaysAgo(1))}`,
  )
})

it('leaves a fresh header untoned and still names the newest clock', async () => {
  vi.mocked(fetchHoldings).mockResolvedValue({
    ...holdingsOut(),
    as_of: isoDaysAgo(1),
    latest_quote_at: isoDaysAgo(0),
  })
  renderPage()
  await screen.findByText('Portfolio value')
  const header = screen.getByText(/^Prices as of /)
  expect(header.className).toBe('as-of')
  expect(header.getAttribute('title')).toBe(
    `oldest quote across holdings — newest ${formatDate(isoDaysAgo(0))}`,
  )
})

// ── Empty-scope header (audit item 12) ───────────────────────────────────────────────────
// as_of is the OLDEST quote among the SCOPED holdings, so it is null whenever the view
// holds nothing priced — which is not the same claim as "the app has never fetched a
// price". The old header said "prices never refreshed" directly above a line reporting a
// run that had just happened.
it('names an empty view instead of claiming prices were never refreshed', async () => {
  vi.mocked(fetchHoldings).mockResolvedValue({
    ...holdingsOut(),
    as_of: null,
    latest_quote_at: null,
    holdings: [],
  })
  vi.mocked(fetchRefreshStatus).mockResolvedValue({
    last: {
      at: '2026-08-27T20:00:00Z',
      trigger: 'scheduled',
      updated: 3,
      failed: {},
      skipped_manual: 0,
      history_appended: false,
    },
    next_run_at: null,
  })
  renderPage()
  expect(await screen.findByText('No priced holdings in this view')).toBeTruthy()
  expect(screen.queryByText('Prices never refreshed')).toBeNull()
  // The refresh line is still there — the two sentences no longer contradict each other.
  expect(screen.getByText(/last refresh /)).toBeTruthy()
})

it('keeps "prices never refreshed" for a book that really has never run one', async () => {
  // Holdings on file, no quotes on any of them, and no recorded run: the original claim
  // is true here, and it is the only place it is made.
  vi.mocked(fetchHoldings).mockResolvedValue({
    ...holdingsOut(),
    as_of: null,
    latest_quote_at: null,
  })
  renderPage()
  expect(await screen.findByText('Prices never refreshed')).toBeTruthy()
})

// ── Shell scope (2026-09-03 shell spec §5–§6) ─────────────────────────────────────────────
// The page no longer owns an owner row or its own range chips: both live in the frame's
// sticky scope row, and the URL — not component state — is what they mean.
describe('PortfolioPage — shell scope', () => {
  it('reads owner and range from the URL', async () => {
    renderPage('/portfolio?owner=joint&range=ytd')
    await screen.findByText('Portfolio')
    await waitFor(() => expect(vi.mocked(fetchHoldings)).toHaveBeenCalledWith('joint'))
    expect(screen.getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    expect(document.querySelector('.portfolio-owner-row')).toBeNull()
  })

  it('an owner chip in the scope row rewrites the URL and refetches', async () => {
    renderPage('/portfolio')
    fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))
    // Not "last": a person's view also fetches the household's holdings for the household-wide
    // performance chart (review round 1).
    await waitFor(() => expect(vi.mocked(fetchHoldings)).toHaveBeenCalledWith(SAM.id))
    expect(screen.getByTestId('location').textContent).toContain('owner=2')
  })

  it('closes an open drill-in when the scope changes under it', async () => {
    renderPage('/portfolio?ticker=voo')
    await screen.findByRole('heading', { name: /Holdings — VOO/ })
    fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))
    // The drill holds a TICKER the next scope may not own — it folds rather than
    // resolving to null under a stale heading.
    expect(await screen.findByRole('heading', { name: 'Holdings' })).toBeTruthy()
  })

  it('renders the price status under the title row, not inside it', async () => {
    renderPage('/portfolio')
    await screen.findByText(/Prices as of|Prices never refreshed/)
    expect(document.querySelector('.page-frame-subheader .as-of')).toBeTruthy()
    expect(document.querySelector('.page-header')).toBeNull()
    expect(
      screen.getByRole('button', { name: /Refresh prices/ }).closest('.page-frame-actions'),
    ).toBeTruthy()
  })

  // 2026-09-09 audit item 27: the ledger forms are the only free-text doors into the account
  // roster, and the server get-or-creates on the exact string, tagging a new account to the
  // primary. The page is what knows the roster and who the primary is.
  it('hands the ledger form the account roster and the primary’s name', async () => {
    renderPage('/portfolio?section=manage')
    await waitFor(() => expect(document.getElementById('txn-account-labels')).not.toBeNull())
    const options = Array.from(document.querySelectorAll('#txn-account-labels option'))
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      'Fidelity Brokerage',
      'Joint Taxable',
    ])
    const box = screen.getByLabelText('Account')
    fireEvent.change(box, { target: { value: 'Fidelity Brokerage' } })
    expect(screen.queryByText(/will be created/)).toBeNull()
    fireEvent.change(box, { target: { value: 'Fidelity Roth' } })
    expect(
      screen.getByText(
        "New account 'Fidelity Roth' will be created and assigned to Me — re-tag it in Settings → Accounts",
      ),
    ).toBeTruthy()
  })
})

// ── Shared card grammar (2026-09-13 polish §12, M3) ───────────────────────────────────────
// .panel/.panel-title/.tiles-row sat outside the motion, reveal and skeleton selectors, which
// all key on .card and .kpi-row. Same tokens, shared names.
describe('PortfolioPage — card vocabulary', () => {
  it('renders every block as .card/.eyebrow and the tiles as a dense .kpi-row', async () => {
    renderPage('/portfolio?section=holdings')
    await screen.findByText('Portfolio value')
    expect(document.querySelector('.panel, .panel-title, .tiles-row')).toBeNull()
    expect(document.querySelector('.loading-dim > .kpi-row.kpi-row-dense')).not.toBeNull()
    const holdings = screen.getByRole('heading', { name: 'Holdings' })
    expect(holdings.className).toBe('eyebrow')
    expect(holdings.closest('.card')).not.toBeNull()
    expect(holdings.closest('.card-title-row')).not.toBeNull()
  })

  it('joins the price clock and the last refresh into one status line (2026-09-13 polish §10)', async () => {
    vi.mocked(fetchRefreshStatus).mockResolvedValue({
      last: { at: '2026-09-11T20:10:00Z', trigger: 'scheduled', updated: 36, failed: {}, skipped_manual: 0, history_appended: false },
      next_run_at: null,
    })
    renderPage()
    await screen.findByText('Portfolio value')
    const line = document.querySelector('.page-frame-subheader .portfolio-status-line') as HTMLElement
    expect(line.textContent).toBe(`Prices as of ${formatDate('2026-08-27T20:00:00Z')} · last refresh ${formatDateTime('2026-09-11T20:10:00Z')} (scheduled) · 36 updated`)
    expect(document.querySelectorAll('.page-frame-subheader .refresh-status-line')).toHaveLength(1)
  })

  it('names the Manage records with shell tabs and clears a selection by its real verb', async () => {
    renderPage('/portfolio?ticker=voo')
    await screen.findByRole('heading', { name: /Holdings — VOO/ })
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(await screen.findByRole('heading', { name: 'Holdings' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    const tabs = screen.getByRole('tablist', { name: 'Portfolio records' })
    expect(tabs.className).toContain('segmented-tabs')
    expect([...tabs.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Transactions', 'Securities', 'Realized'])
    expect(document.querySelector('.tab-row')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Realized' }))
    const panel = document.getElementById('portfolio-records-realized') as HTMLElement
    expect(panel.hidden).toBe(false)
    expect(screen.getByRole('tab', { name: 'Realized' }).getAttribute('aria-controls')).toBe('portfolio-records-realized')
  })
})

// ── Tiles per view (2026-09-13 polish §12, S1/S7) ────────────────────────────────────────
describe('PortfolioPage — tiles per view', () => {
  it('shows the five tiles on Overview, Holdings and Allocation, and none on Income or Manage', async () => {
    renderPage()
    await screen.findByText('Portfolio value')
    const pageTiles = () => document.querySelector('.loading-dim > .kpi-row')
    expect(pageTiles()).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Holdings' }))
    expect(pageTiles()).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }))
    expect(pageTiles()).toBeNull()
    expect(screen.queryByText('Portfolio value')).toBeNull()
    // The Dividends card's own tiles are the Income row (Trailing 12-mo / YTD / Projected).
    const income = screen.getByRole('tabpanel', { name: 'Income' })
    expect(within(income).getByRole('heading', { name: /Dividends/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    expect(pageTiles()).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Allocation' }))
    expect(pageTiles()).not.toBeNull()
    expect(screen.getByText('Portfolio value')).toBeTruthy()
  })
})
