import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import type {
  CalendarEvent,
  CalendarEventType,
  CoverageOut,
  DividendOut,
  EsppLotOut,
  EsppLotsResponse,
  HoldingsResponse,
  MoneyFlowOut,
  NetWorthSummary,
  NetWorthTimeseries,
  PortfolioHistory,
  SpendingMatrix,
  SpendingYearly,
  SystemStatus,
  TaxSummariesOut,
  TaxSummaryOut,
  TaxYearOut,
} from '../types/api'
import { calendarEvent } from '../testing/calendarFixtures'
import { formatDate, formatMonth } from '../utils/format'
import { addDays, addMonths, currentMonthIso, todayIso } from '../utils/months'
import OverviewPage from './OverviewPage'

// Six modules, eleven clients, one snapshot: the page's whole contract is that these
// resolve TOGETHER (the strip's and the YTD card's feeds ride along like the rest).
vi.mock('../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/netWorth')>()),
  fetchSummary: vi.fn(),
  fetchTimeseries: vi.fn(),
}))
vi.mock('../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/portfolio')>()),
  fetchHoldings: vi.fn(),
  fetchHistory: vi.fn(),
  fetchDividends: vi.fn(),
}))
vi.mock('../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/spending')>()),
  fetchMatrix: vi.fn(),
  fetchYearly: vi.fn(),
}))
vi.mock('../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/taxes')>()),
  fetchAllTaxSummaries: vi.fn(),
  fetchTaxYears: vi.fn(),
}))
vi.mock('../api/espp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/espp')>()),
  fetchLots: vi.fn(),
}))
vi.mock('../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/system')>()),
  fetchSystemStatus: vi.fn(),
}))
// The seventh module is deliberately NOT one of those eleven: the Up-next strip fetches
// the calendar on its own, so a hiccup there dents the strip and nothing else.
vi.mock('../api/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/calendar')>()),
  fetchCalendar: vi.fn(),
}))
// The money-flow card is the page's second isolated fetch (spec §5): its failure must
// dent one card, never the snapshot — and vice versa.
vi.mock('../api/overview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/overview')>()),
  fetchMoneyFlow: vi.fn(),
}))
// The scope row's own two fetches (Plan 1b): the household behind the owner chips, and
// coverage — which this page's ScopeBar never asks for, but which must not reach the
// network if a later scope key does.
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
vi.mock('../api/coverage', () => ({ fetchCoverage: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law). What the three
// charts DRAW is pinned elsewhere — the net-worth trend and the bars in
// src/components/overview/overviewChartOptions.test.ts, the performance lines in
// src/components/portfolio/historyChartOptions.test.ts; this file asks only whether a chart
// is on screen and — via the categories the marker carries — WHICH feed drew it. The async
// factory keeps the JSX runtime out of the hoisted scope.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      onClick,
      animateEntrance = true,
    }: {
      option: { xAxis?: { data?: unknown[] } }
      ariaLabel?: string
      onClick?: (params: { dataIndex?: number }) => void
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        // ChartCard hands every mount its house sentence (F11) — the page test reads it.
        'aria-label': ariaLabel,
        'data-categories': (option.xAxis?.data ?? []).join(','),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        // A click stands in for a click on the chart's FIRST point (dataIndex 0) —
        // enough to walk the click-through door without a canvas (SpendingPage.test's
        // idiom). Charts given no handler stay inert, like the real thing.
        onClick: () => onClick?.({ dataIndex: 0 }),
      }),
  }
})
import { fetchCalendar } from '../api/calendar'
import { fetchCoverage } from '../api/coverage'
import { fetchLots } from '../api/espp'
import { fetchHousehold } from '../api/household'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchMoneyFlow } from '../api/overview'
import { fetchDividends, fetchHistory, fetchHoldings } from '../api/portfolio'
import { fetchMatrix, fetchYearly } from '../api/spending'
import { fetchSystemStatus } from '../api/system'
import { fetchAllTaxSummaries, fetchTaxYears } from '../api/taxes'

// --- fixtures ---------------------------------------------------------------------------
// Money and percents are decimal STRINGS on the wire (pydantic v2) — every fixture below
// carries the digits the server would actually send, so the assertions read the formatter's
// real output rather than a rounded stand-in.

// The tax tile and the staleness cue are both wall-clock relative (`new Date()` inside the
// page, `isStaleQuote` against today's DATE), so their fixtures are computed from the run's
// own today. A hard-coded 2026 quote date would quietly go stale the day after it was
// written and take this file down with it.
const CURRENT_YEAR = new Date().getFullYear()

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

function monthsFrom(start: string, count: number): string[] {
  const [year, month] = start.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const m = month + i
    const y = year + Math.floor((m - 1) / 12)
    return `${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}-01`
  })
}

const SPEND_MONTHS = monthsFrom('2025-08-01', 12) // …through Jul 2026

// The footer and the YTD windows read /coverage, and both are compared against the RUN's
// own year (the CURRENT_YEAR rule above) — a hard-coded 2026 fixture would start failing on
// the next New Year's Day, the stale-fixture class this file already guards against.
const YEAR_MONTHS = monthsFrom(`${CURRENT_YEAR}-01-01`, 7) // Jan … Jul
const AUG = `${CURRENT_YEAR}-08-01`
const SEP = `${CURRENT_YEAR}-09-01`

function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: [...YEAR_MONTHS],
    spending: [...YEAR_MONTHS],
    net_pay: [...YEAR_MONTHS],
    spending_empty: [],
    spending_missing: [],
    net_pay_missing: [],
    latest: { balances: YEAR_MONTHS[6], spending: YEAR_MONTHS[6], net_pay: YEAR_MONTHS[6] },
    ...over,
  }
}

// Production on 2026-09-04: balances through September, spending entered through July,
// August never entered, September saved as all $0.00.
const LAGGING = coverageOut({
  balances: [...YEAR_MONTHS, AUG, SEP],
  spending_empty: [SEP],
  spending_missing: [AUG],
  net_pay_missing: [AUG, SEP],
  latest: { balances: SEP, spending: YEAR_MONTHS[6], net_pay: YEAR_MONTHS[6] },
})

function summaryOut(over: Partial<NetWorthSummary> = {}): NetWorthSummary {
  return {
    month: '2026-08-01',
    net_worth: '1234567.00',
    mom_delta: '10000.00',
    mom_pct: '0.008',
    groups: [],
    owner_totals: [],
    ...over,
  }
}

// The last three months ENDING ON THE REAL CURRENT MONTH: the attention strip reads this
// list against the wall clock, and a hard-coded trio would start flagging "update not
// entered" in every test here the month after it was written (the stale-fixture class the
// tax-tile fixtures already guard against with CURRENT_YEAR).
const NW_MONTHS = [-2, -1, 0].map((delta) => addMonths(currentMonthIso(), delta))

function timeseriesOut(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: [...NW_MONTHS],
    accounts: [],
    series: [],
    group_totals: {
      cash: [], pre_tax: [], post_tax: [], taxable: [], equity: [], other: [], liability: [],
    },
    net_worth: ['1200000.00', '1224567.00', '1234567.00'],
    mom_pct: [null, '0.020466', '0.008163'],
    notes: [null, null, null],
    owner_series: [],
    ...over,
  }
}

function holdingsOut(over: Partial<HoldingsResponse> = {}): HoldingsResponse {
  const quoted = daysAgo(1) // captured once — two calls could straddle UTC midnight
  return {
    as_of: quoted,
    latest_quote_at: quoted,
    totals: {
      market_value: '812345.67',
      cost_basis: '600000.00',
      unrealized_gl: '212345.67',
      unrealized_gl_pct: '0.353909',
      // A down day: the tile has to wear the negative tone even though the position is up.
      day_change_amount: '-2500.00',
      day_change_pct: '-0.0030',
      realized_gl: '0.00',
      dividends_collected: '1200.00',
      annual_income: '3600.00',
      unpriced_count: 0,
    },
    holdings: [],
    ...over,
  }
}

function historyOut(over: Partial<PortfolioHistory> = {}): PortfolioHistory {
  return {
    dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
    market_value: ['700000.00', '710000.50', '718422.07'],
    cost_basis: ['395000.00', '399542.36', '400243.74'],
    sp500: ['96000.00', '97000.00', '98636.70'],
    benchmark: ['96000.00', '97250.00', '99001.13'],
    ...over,
  }
}

function matrixOut(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: [...SPEND_MONTHS],
    categories: [],
    series: [],
    // Eleven quiet months at 5,000 then a 6,000 July: the average to beat is exactly 5,000.
    totals: [...Array<string>(11).fill('5000.00'), '6000.00'],
    net_pay: [],
    savings_rate: [],
    four_pct_rule: [],
    total_budget: [],
    ...over,
  }
}

function moneyFlowOut(over: Partial<MoneyFlowOut> = {}): MoneyFlowOut {
  return {
    year: CURRENT_YEAR,
    available_years: [CURRENT_YEAR - 1, CURRENT_YEAR],
    renderable: true,
    reason: null,
    warnings: [],
    sources: {
      salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '4000.00',
      investment_income: '2500.00', other_income: '1000.00',
      salary_people: [],
    },
    gross_income: '307500.00',
    taxes: {
      total: '67016.05', federal: '26520.00', state: '14225.00', medicare: '4345.65',
      social_security: '18581.40', disability: '3344.00', capital_gains: '0.00',
    },
    pre_tax_savings: '27300.00',
    take_home_cash: '120000.00',
    retained_equity: '93183.95',
    categories: [
      { name: 'Rent', amount: '24000.00' },
      { name: 'Food', amount: '6000.00' },
    ],
    other_spend: null,
    total_spend: '30000.00',
    saved: '90000.00',
    ...over,
  }
}

function taxSummaryOut(year: number, effectiveRate: string | null = '0.246914'): TaxSummaryOut {
  const income = { agi: '0.00', taxable_income: '0.00', tax: '0.00', effective_rate: null }
  const wage = { w2_income: '0.00', taxable_wages: '0.00', tax: '0.00', effective_rate: null }
  return {
    year,
    federal: income,
    state: income,
    medicare: wage,
    social_security: wage,
    disability: wage,
    capital_gains: {
      taxable_income: '0.00', gains_amount: '0.00', tax: '0.00', effective_rate: null,
    },
    totals: {
      gross_income: '500000.00',
      total_income: '500000.00',
      total_tax: '123456.78',
      take_home: '376543.22',
      effective_rate: effectiveRate,
    },
    warnings: [],
  }
}

function lotOut(days: number | null, over: Partial<EsppLotOut> = {}): EsppLotOut {
  return {
    id: 1, purchase_date: '2026-02-27', qualifying_date: '2026-09-01', shares: '10.0000',
    subscription_price: '100.00000', purchase_fmv: '120.00000', purchase_price: '85.00000',
    sold_date: null, sold_price: null, notes: null, cost_basis: '850.00',
    market_value: null, gain_amount: null, gain_pct: null,
    qualified: false, days_until_qualified: days, is_sold: false,
    ...over,
  }
}

function lotsOut(lots: EsppLotOut[] = []): EsppLotsResponse {
  return { espp_ticker: null, current_price: null, quoted_at: null, lots }
}

// Strip-quiet system default: environment 'dev' suppresses the backup nag (its logic is
// pinned in attention.test.ts, where today is injectable) and no refresh is recorded —
// the same quiet the old { last: null, next_run_at: null } fixture bought.
function systemOut(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    prices: { last: null, next_run_at: null, scheduler_running: false },
    database: { size_bytes: 123_456_789, alembic_head: 'e7c5a9f4b2d8' },
    backup: null,
    environment: 'dev',
    ...over,
  }
}

// Two people, so the scope row really renders its owner chips (one person hides them).
// The primary is the LOWER id here, which is the order the chips must survive.
const HOUSEHOLD = {
  people: [
    { id: 1, name: 'Edward', is_primary: true },
    { id: 2, name: 'Grace', is_primary: false },
  ],
  marriage_date: null,
}

// DISTINCT types on purpose: Up next allows only ONE payday (2026-09-03 calendar spec
// §14), so six paydays would legitimately rank down to a single row. None of them is a
// deadline, so the strip's order stays plain date order.
const UP_NEXT_TYPES: CalendarEventType[] = [
  'payday',
  'rsu_vest',
  'ex_dividend',
  'espp_purchase',
  'espp_qualify',
  'offering_start',
]

function upNextEvents(count = 6): CalendarEvent[] {
  return Array.from({ length: count }, (_, i) =>
    calendarEvent({
      date: daysAgo(-(i + 1)),
      type: UP_NEXT_TYPES[i % UP_NEXT_TYPES.length],
      label: `Upcoming event ${i + 1}`,
      amount: '6812.44',
      direction: 'in',
    }),
  )
}

interface Payload {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  history: PortfolioHistory
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
  lots: EsppLotsResponse
  taxYears: TaxYearOut[]
  yearly: SpendingYearly
  dividends: DividendOut[]
  system: SystemStatus
  coverage: CoverageOut
  flow: MoneyFlowOut
}

// Arms all eleven clients at once — the page never renders a partial snapshot, so neither
// does the harness. The strip-quiet defaults (no lots, a filled current tax year, no
// recorded refresh) keep the attention strip out of the tests that are not about it; the
// wall-clock-relative cases (monthly-update nudges) live in attention.test.ts, where
// today is injectable.
function serve(over: Partial<Payload> = {}): Payload {
  const payload: Payload = {
    summary: summaryOut(),
    ts: timeseriesOut(),
    holdings: holdingsOut(),
    history: historyOut(),
    matrix: matrixOut(),
    taxes: { years: [taxSummaryOut(CURRENT_YEAR)] },
    lots: lotsOut(),
    taxYears: [
      { year: CURRENT_YEAR, notes: null, input_count: 21, bracket_count: 42, filing_status: 'single' },
    ],
    yearly: { years: [] },
    dividends: [],
    system: systemOut(),
    coverage: coverageOut(),
    flow: moneyFlowOut(),
    ...over,
  }
  vi.mocked(fetchSummary).mockResolvedValue(payload.summary)
  vi.mocked(fetchTimeseries).mockResolvedValue(payload.ts)
  vi.mocked(fetchHoldings).mockResolvedValue(payload.holdings)
  vi.mocked(fetchHistory).mockResolvedValue(payload.history)
  vi.mocked(fetchMatrix).mockResolvedValue(payload.matrix)
  vi.mocked(fetchAllTaxSummaries).mockResolvedValue(payload.taxes)
  vi.mocked(fetchLots).mockResolvedValue(payload.lots)
  vi.mocked(fetchTaxYears).mockResolvedValue(payload.taxYears)
  vi.mocked(fetchYearly).mockResolvedValue(payload.yearly)
  vi.mocked(fetchDividends).mockResolvedValue(payload.dividends)
  vi.mocked(fetchSystemStatus).mockResolvedValue(payload.system)
  vi.mocked(fetchCoverage).mockResolvedValue(payload.coverage)
  vi.mocked(fetchCalendar).mockResolvedValue({
    events: upNextEvents(),
    sources: [],
    quote_as_of: null,
  })
  vi.mocked(fetchMoneyFlow).mockResolvedValue(payload.flow)
  return payload
}

function failAll(message = 'overview unavailable'): void {
  const boom = () => Promise.reject(new ApiError(message, 500))
  vi.mocked(fetchSummary).mockImplementation(boom)
  vi.mocked(fetchTimeseries).mockImplementation(boom)
  vi.mocked(fetchHoldings).mockImplementation(boom)
  vi.mocked(fetchHistory).mockImplementation(boom)
  vi.mocked(fetchMatrix).mockImplementation(boom)
  vi.mocked(fetchAllTaxSummaries).mockImplementation(boom)
  vi.mocked(fetchLots).mockImplementation(boom)
  vi.mocked(fetchTaxYears).mockImplementation(boom)
  vi.mocked(fetchYearly).mockImplementation(boom)
  vi.mocked(fetchDividends).mockImplementation(boom)
  vi.mocked(fetchSystemStatus).mockImplementation(boom)
  vi.mocked(fetchCoverage).mockImplementation(boom)
  vi.mocked(fetchCalendar).mockImplementation(boom)
  vi.mocked(fetchMoneyFlow).mockImplementation(boom)
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

// Routed, not bare: a click-through has to really UNMOUNT this page the way the app's
// router does. Rendered unconditionally, the page's own scope normalization would re-stamp
// ?owner= onto whatever URL the click navigated to.
function renderPage(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

// A promise this file settles by hand — the only way to hold two loads in flight at once
// and choose which one answers first (TaxesPage.test's helper).
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// The tiles are addressed through their labels: a tile is a label, a value and (sometimes)
// a delta, and "sometimes" is the point of half these tests.
function tileFor(label: string | RegExp): HTMLElement {
  const tile = screen.getByText(label).closest('.stat-tile')
  expect(tile).not.toBeNull()
  return tile as HTMLElement
}

// A hint's SENTENCE lives in its bubble, not its accessible name (motion spec §8: the button
// is named by its first four words so a reader hears the sentence once). Open it, read it,
// then Escape — leaving one pinned would make the next `getByRole('tooltip')` ambiguous.
function hintText(name: RegExp): string {
  fireEvent.click(screen.getByRole('button', { name }))
  const text = screen.getByRole('tooltip').textContent ?? ''
  fireEvent.keyDown(window, { key: 'Escape' })
  return text
}

function valueOf(tile: HTMLElement): string {
  return tile.querySelector('.stat-value')?.textContent ?? ''
}

function deltaOf(tile: HTMLElement): HTMLElement | null {
  return tile.querySelector('.stat-delta')
}

function categoriesOf(chart: Element): string {
  return chart.getAttribute('data-categories') ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSnapshots()
  // useScope falls back to localStorage for keys the URL leaves empty — a scope one test
  // picks would otherwise be the next test's default.
  localStorage.clear()
  vi.mocked(fetchHousehold).mockResolvedValue(HOUSEHOLD)
  vi.mocked(fetchCoverage).mockResolvedValue({ balances: [], spending: [], net_pay: [] })
})

/** The eleven-client snapshot exactly as the page stores it (the `flow` leg is its own
 *  isolated track, so it never rides the 'overview' key). */
function snapshotOf(payload: Payload) {
  return {
    summary: payload.summary,
    ts: payload.ts,
    holdings: payload.holdings,
    history: payload.history,
    matrix: payload.matrix,
    taxes: payload.taxes,
    lots: payload.lots,
    taxYears: payload.taxYears,
    yearly: payload.yearly,
    dividends: payload.dividends,
    system: payload.system,
    coverage: payload.coverage,
  }
}

/** The three PAGE-level charts (net-worth trend, performance, recent spending) in render
 *  order. MoneyFlowCard's sankey trails them and is a documented scope cut for the
 *  entrance-stillness rule — its chart lives inside a child component. */
function pageCharts(): HTMLElement[] {
  return screen.getAllByTestId('echart').slice(0, 3)
}

/** Holds every one of the eleven snapshot clients pending, so anything on screen came
 *  from the seed alone. The two isolated tracks keep their own resolutions. */
function pendAllSnapshotFetches(): void {
  const pending = () => new Promise<never>(() => {})
  vi.mocked(fetchSummary).mockImplementation(pending)
  vi.mocked(fetchTimeseries).mockImplementation(pending)
  vi.mocked(fetchHoldings).mockImplementation(pending)
  vi.mocked(fetchHistory).mockImplementation(pending)
  vi.mocked(fetchMatrix).mockImplementation(pending)
  vi.mocked(fetchAllTaxSummaries).mockImplementation(pending)
  vi.mocked(fetchLots).mockImplementation(pending)
  vi.mocked(fetchTaxYears).mockImplementation(pending)
  vi.mocked(fetchYearly).mockImplementation(pending)
  vi.mocked(fetchDividends).mockImplementation(pending)
  vi.mocked(fetchSystemStatus).mockImplementation(pending)
  vi.mocked(fetchCoverage).mockImplementation(pending)
}

afterEach(() => {
  cleanup()
})

describe('OverviewPage tiles', () => {
  it('renders the four tiles from one snapshot', async () => {
    // Seeded so the paint is a CACHED one: the hero's count-up (spec §8) runs on fresh
    // paints only, and a settling number is not a string this test can pin. The revalidation
    // still goes out and lands the same payload, so every figure below is the snapshot's.
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    const hero = tileFor('Net worth — Aug 2026')
    expect(valueOf(hero)).toBe('$1,234,567.00')
    // formatCurrency does not sign a positive (Intl currency has no plus); the ▲ glyph and
    // the tone class carry direction, and formatPct signs the percent.
    expect(deltaOf(hero)?.textContent).toBe('▲ $10,000.00 (+0.8%) MoM')
    expect(deltaOf(hero)?.className).toContain('stat-delta-positive')
    expect(hero.className).toContain('stat-tile-hero')

    // Down day on an up position: the delta describes TODAY, so the tone is negative even
    // though unrealized gain is large. Both figures are the server's own totals fields.
    const portfolio = tileFor('Portfolio')
    expect(valueOf(portfolio)).toBe('$812,345.67')
    expect(deltaOf(portfolio)?.textContent).toBe('▼ -$2,500.00 (-0.3%) today')
    expect(deltaOf(portfolio)?.className).toContain('stat-delta-negative')

    // Spending up is BAD, and glyph and tone are DECOUPLED so that both can be true at once:
    // 6,000 against a 5,000 average went UP (▲, honest about the number) and that is BAD
    // (red, plus the word "over"). A tone-derived glyph would have printed ▼ on a month that
    // rose. Direction × whether-up-is-good is the caller's job — StatTile.
    const spending = tileFor('Spending — Jul 2026')
    expect(valueOf(spending)).toBe('$6,000.00')
    expect(deltaOf(spending)?.textContent).toBe('▲ over $5,000.00 12-mo avg')
    expect(deltaOf(spending)?.className).toContain('stat-delta-negative')

    const tax = tileFor(`Effective tax — ${CURRENT_YEAR} (est.)`)
    expect(valueOf(tax)).toBe('24.7%')
    // A rate is a level, not a movement: no delta, no arrow.
    expect(deltaOf(tax)).toBeNull()
  })

  // RATIFIED (spec review): both halves of a delta or neither. A bare amount with no rate
  // beside it reads as a total rather than as a change, so a half-served delta is dropped
  // whole rather than printed half-dressed. The two tiles that pair an amount with a
  // percent each get a pin, because "one field is null" is a shape the server really sends.
  it('drops the hero delta when the server sends an amount with no rate', async () => {
    // Cached paint (see above): the hero VALUE is pinned here too, so the count-up stays off.
    const payload = serve({ summary: summaryOut({ mom_delta: '100.00', mom_pct: null }) })
    setSnapshot('overview:all', snapshotOf(payload))
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    const hero = tileFor('Net worth — Aug 2026')
    expect(valueOf(hero)).toBe('$1,234,567.00')
    expect(deltaOf(hero)).toBeNull()
    // Not the amount alone, either — the whole delta node is gone.
    expect(screen.queryByText(/MoM/)).toBeNull()
  })

  it('drops the portfolio delta when the day change has an amount but no rate', async () => {
    const totals = { ...holdingsOut().totals, day_change_amount: '-5.00', day_change_pct: null }
    serve({ holdings: holdingsOut({ totals }) })
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    const portfolio = tileFor('Portfolio')
    expect(valueOf(portfolio)).toBe('$812,345.67')
    expect(deltaOf(portfolio)).toBeNull()
    expect(screen.queryByText(/today/)).toBeNull()
  })

  it('tones the spending tile positive when the month came in under the average', async () => {
    serve({ matrix: matrixOut({ totals: [...Array<string>(11).fill('5000.00'), '4000.00'] }) })
    renderPage()

    const spending = await screen.findByText('Spending — Jul 2026')
    const tile = spending.closest('.stat-tile') as HTMLElement
    expect(valueOf(tile)).toBe('$4,000.00')
    // The mirror of the case above: the number went DOWN (▼) and that is GOOD (green,
    // "under"). Same decoupling, opposite signs — here glyph and tone happen to agree.
    expect(deltaOf(tile)?.textContent).toBe('▼ under $5,000.00 12-mo avg')
    expect(deltaOf(tile)?.className).toContain('stat-delta-positive')
  })

  it('says nothing about a cashflow-only trailing month', async () => {
    // The matrix months are a UNION of spending rows and net-pay rows, so a month whose
    // paycheck is entered but whose spending is not comes back with an explicit "0.00".
    // A green "▼ under $5,000.00 avg" would congratulate the user for an unentered month.
    serve({ matrix: matrixOut({ totals: [...Array<string>(11).fill('5000.00'), '0.00'] }) })
    renderPage()
    await screen.findByText('Spending — Jul 2026')

    const tile = tileFor('Spending — Jul 2026')
    expect(valueOf(tile)).toBe('—')
    expect(deltaOf(tile)).toBeNull()
    expect(screen.queryByText(/12-mo avg/)).toBeNull()
  })

  // The two edges of that guard, pinned so a later widening of it cannot swallow a real
  // month. The guard fires only when there is an average ABOVE zero to be measured against
  // — that is what makes a $0.00 month suspicious rather than merely quiet.
  it('shows a first-ever month of zero rather than swallowing it', async () => {
    // Month one: nothing before it, so avg12 is null and there is nothing to compare to.
    // The tile is not suppressed — the user entered this month, it really was $0.00, and a
    // dash here would look like a load failure.
    serve({ matrix: matrixOut({ months: [SPEND_MONTHS[0]], totals: ['0.00'] }) })
    renderPage()
    await screen.findByText('Spending — Aug 2025')

    const tile = tileFor('Spending — Aug 2025')
    expect(valueOf(tile)).toBe('$0.00')
    expect(deltaOf(tile)).toBeNull()
  })

  it('states the degenerate zero-against-zero case rather than suppressing it', async () => {
    // A whole history of zeros: avg12 is 0, so the `avg12 > 0` guard does NOT fire and the
    // delta is spoken. 0 > 0 is false, so the month reads as "under" its average, ▼, green.
    // Degenerate but honest — an all-zero database is not the case the guard exists for,
    // and inventing a third phrasing for it would cost more than it explains. Pinned so the
    // reading is a decision rather than an accident.
    serve({ matrix: matrixOut({ totals: Array<string>(12).fill('0.00') }) })
    renderPage()
    await screen.findByText('Spending — Jul 2026')

    const tile = tileFor('Spending — Jul 2026')
    expect(valueOf(tile)).toBe('$0.00')
    expect(deltaOf(tile)?.textContent).toBe('▼ under $0.00 12-mo avg')
    expect(deltaOf(tile)?.className).toContain('stat-delta-positive')
  })

  it('marks a past tax year as the latest one on file', async () => {
    serve({ taxes: { years: [taxSummaryOut(CURRENT_YEAR - 1)] } })
    renderPage()
    await screen.findByText(`Effective tax — ${CURRENT_YEAR - 1} (latest)`)

    expect(valueOf(tileFor(`Effective tax — ${CURRENT_YEAR - 1} (latest)`))).toBe('24.7%')
  })

  it('marks a future-only tax year as planned', async () => {
    // A year row exists the moment anything is entered for it — a forward-planning year can
    // sit in the feed alone, and the tile must not call next year's projection an estimate
    // of this one.
    serve({ taxes: { years: [taxSummaryOut(CURRENT_YEAR + 1)] } })
    renderPage()

    expect(await screen.findByText(`Effective tax — ${CURRENT_YEAR + 1} (planned)`)).toBeTruthy()
  })

  it('leaves the tax tile blank when no year has been touched', async () => {
    serve({ taxes: { years: [] } })
    renderPage()
    await screen.findByText('Effective tax')

    const tile = tileFor('Effective tax')
    expect(valueOf(tile)).toBe('—')
    // No year in the label, no crash reaching into a summary that is not there.
    expect(screen.queryByText(/Effective tax — /)).toBeNull()
  })

  it('dashes the tax rate when the year exists but has no computed rate', async () => {
    // A year row exists the moment anything is entered against it, and the server sends a
    // null effective_rate until there is income to divide by. The label still names the
    // year (there IS a year on file) while the value admits it cannot state a rate — the
    // formatter's dash, not a 0.0% that would read as a tax-free year.
    serve({ taxes: { years: [taxSummaryOut(CURRENT_YEAR, null)] } })
    renderPage()
    await screen.findByText(`Effective tax — ${CURRENT_YEAR} (est.)`)

    const tile = tileFor(`Effective tax — ${CURRENT_YEAR} (est.)`)
    expect(valueOf(tile)).toBe('—')
    expect(deltaOf(tile)).toBeNull()
  })
})

describe('OverviewPage snapshot fan-out', () => {
  it('asks each client for the shape the page actually draws', async () => {
    // The mocked EChart cannot tell a monthly series from a quarterly one, so the one
    // request that carries an argument — the timeseries granularity — is pinned here: a
    // silent swap would still render three charts and pass every other test in this file.
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    expect(fetchTimeseries).toHaveBeenCalledWith('monthly', null)
  })

  it('refetches all eleven clients on Refresh', async () => {
    // One snapshot, one round trip per client: Refresh re-reads the WHOLE page rather than
    // topping up a tile, which is what keeps the tiles and the charts on the same instant.
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2))

    for (const client of [
      fetchSummary, fetchTimeseries, fetchHoldings, fetchHistory, fetchMatrix,
      fetchAllTaxSummaries, fetchLots, fetchTaxYears, fetchYearly, fetchDividends,
      fetchSystemStatus,
    ]) {
      expect(client).toHaveBeenCalledTimes(2)
    }
  })
})

describe('OverviewPage charts', () => {
  it('feeds the net-worth trend, the performance lines and the bars', async () => {
    // Captured once: daysAgo(1) called twice could straddle UTC midnight and disagree.
    const quoted = daysAgo(1)
    // Regression: as_of is the OLDEST quote — here a stale manual-priced straggler. The
    // live category must come from latest_quote_at, or the ping retires the moment the
    // weekly series' last row is newer than the stalest holding.
    serve({ holdings: holdingsOut({ as_of: daysAgo(30), latest_quote_at: quoted }) })
    renderPage()

    await screen.findByText('Net worth — Aug 2026')
    const charts = screen.getAllByTestId('echart')
    expect(charts).toHaveLength(4)
    // Spark first (net-worth months), performance second (weekly dates + the live
    // category derived from the quote bar date), bars last.
    expect(categoriesOf(charts[0])).toBe(NW_MONTHS.map(formatMonth).join(','))
    expect(categoriesOf(charts[1])).toBe(
      ['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026', formatDate(quoted)].join(','),
    )
    expect(categoriesOf(charts[2])).toBe(
      'Aug 2025,Sep 2025,Oct 2025,Nov 2025,Dec 2025,Jan 2026,Feb 2026,Mar 2026,Apr 2026,May 2026,Jun 2026,Jul 2026',
    )
    expect(categoriesOf(charts[3])).toBe('') // the money-flow sankey has no category axis
    // Each card drills into the page that owns the numbers.
    expect(screen.getByRole('link', { name: /Open net worth/ }).getAttribute('href')).toBe('/net-worth')
    expect(screen.getByRole('link', { name: /Open portfolio/ }).getAttribute('href')).toBe('/portfolio')
    expect(screen.getByRole('link', { name: /Open spending/ }).getAttribute('href')).toBe('/spending')
  })
})

describe('OverviewPage freshness', () => {
  it('dates the quotes and stands each hand-entered feed on its own month', async () => {
    const quoted = daysAgo(1)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    const prices = await screen.findByText(`Prices as of ${formatDate(quoted)}`)
    // Yesterday's bar is not stale — no amber.
    expect(prices.className).not.toContain('stale')
    expect(screen.getByText(`Balances through ${formatMonth(YEAR_MONTHS[6])}`)).toBeTruthy()
    expect(screen.getByText(`Spending through ${formatMonth(YEAR_MONTHS[6])}`)).toBeTruthy()
    expect(screen.getByText(`Net pay through ${formatMonth(YEAR_MONTHS[6])}`)).toBeTruthy()
    // Level feeds: nothing ambers.
    expect(document.querySelectorAll('.overview-freshness .stale')).toHaveLength(0)
  })

  it('names the months the window is still waiting for and ambers the feeds that lag', async () => {
    serve({ coverage: LAGGING })
    renderPage()

    const spending = await screen.findByText(
      `Spending through ${formatMonth(YEAR_MONTHS[6])} (Aug missing, Sep empty)`,
    )
    expect(spending.className).toContain('stale')
    const balances = screen.getByText(`Balances through ${formatMonth(SEP)}`)
    expect(balances.className).not.toContain('stale')
    expect(screen.getByText(`Net pay through ${formatMonth(YEAR_MONTHS[6])}`).className).toContain(
      'stale',
    )
  })

  it('ambers a quote date that has gone stale — and the strip says the same thing', async () => {
    const quoted = daysAgo(9)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    const prices = await screen.findByText(`Prices as of ${formatDate(quoted)}`)
    expect(prices.className).toContain('stale')
    // Two registers for one fact: the freshness row states it, the strip makes it a task.
    expect(
      screen.getByRole('link', { name: /Quotes are stale/ }).getAttribute('href'),
    ).toBe('/portfolio')
  })
})

describe('OverviewPage year to date', () => {
  it('leads with the total rate, names every window, and reads living spend', async () => {
    serve({
      yearly: {
        years: [
          {
            year: CURRENT_YEAR,
            by_category: [],
            total: '32000.00',
            net_pay_total: '90000.00',
            savings_rate: '0.644444',
            living_total: '27000.00',
            tax_total: '4000.00',
            transfer_total: '1000.00',
            cash_savings: '58000.00',
            payroll_savings: '12000.00',
            total_savings: '70000.00',
            total_savings_rate: '0.686274',
            months_matched: 7,
          },
        ],
      },
      dividends: [
        {
          id: 1, security_id: 1, account: null, pay_date: `${CURRENT_YEAR}-03-15`,
          amount: '120.50', source: 'manual', ex_date: null, per_share: null,
          shares_held: null, notes: null,
        },
        // Last year's payout must stay OUT of this year's sum.
        {
          id: 2, security_id: 1, account: null, pay_date: `${CURRENT_YEAR - 1}-12-15`,
          amount: '999.00', source: 'manual', ex_date: null, per_share: null,
          shares_held: null, notes: null,
        },
      ],
    })
    renderPage()

    await screen.findByText(`Year to date — ${CURRENT_YEAR}`)
    // Living spend, not the raw total that carries April's tax bill.
    expect(screen.getByText('$27,000.00')).toBeTruthy()
    expect(screen.queryByText('$32,000.00')).toBeNull()
    expect(screen.getByText('$90,000.00')).toBeTruthy()
    // The headline rate is the TOTAL one; cash rides beside it.
    expect(screen.getByText('68.6% total')).toBeTruthy()
    expect(screen.getByText(/\$70,000\.00 · cash 64\.4% \(\$58,000\.00\)/)).toBeTruthy()
    // Every figure names its window (spec §3).
    expect(screen.getAllByText('Jan–Jul')).toHaveLength(3)
    expect(screen.getByText(/since .* \(through Sep\)/)).toBeTruthy()
    // The dividend sum is this year's payments only.
    expect(screen.getByText('$120.50')).toBeTruthy()
    expect(screen.queryByText('$999.00')).toBeNull()
  })

  it('states the cash rate alone on a backend older than the savings service', async () => {
    serve({
      yearly: {
        years: [
          {
            year: CURRENT_YEAR, by_category: [], total: '32000.00',
            net_pay_total: '90000.00', savings_rate: '0.644444',
          },
        ],
      },
    })
    renderPage()

    await screen.findByText(`Year to date — ${CURRENT_YEAR}`)
    // The word "cash" is what keeps it from being read as the total rate; a dash here
    // would hide a figure the user's own data still supports.
    expect(screen.getByText('64.4% cash')).toBeTruthy()
    expect(screen.queryByText(/total/)).toBeNull()
    const saved = screen.getByText('Saved').closest('.ytd-fact')
    expect(saved?.querySelector('dd')?.textContent).not.toBe('—')
  })

  it('dashes the savings row in a year nothing matched, rather than printing a zero', async () => {
    serve({
      coverage: coverageOut({ net_pay: [], latest: { balances: YEAR_MONTHS[6], spending: YEAR_MONTHS[6], net_pay: null } }),
      yearly: {
        years: [
          {
            // With nothing matched the server's matched sums are ZERO and its rates null
            // (services/savings.py's `rollup`) — the shape this row must dash on.
            year: CURRENT_YEAR, by_category: [], total: '32000.00', net_pay_total: null,
            savings_rate: null, living_total: '0.00', total_savings: null,
            total_savings_rate: null, cash_savings: null, months_matched: 0,
          },
        ],
      },
    })
    renderPage()

    await screen.findByText(`Year to date — ${CURRENT_YEAR}`)
    const saved = screen.getByText('Saved').closest('.ytd-fact')
    expect(saved?.querySelector('dd')?.textContent).toBe('—')
  })

  it('stays off a fresh database — the empty states already carry the message', async () => {
    serve({
      ts: timeseriesOut({ months: [], net_worth: [], mom_pct: [], notes: [] }),
      yearly: { years: [] },
      dividends: [],
    })
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    expect(screen.queryByText(/Year to date/)).toBeNull()
  })
})

describe('OverviewPage attention strip', () => {
  it('stays absent when nothing needs doing', async () => {
    // Strip-quiet defaults: current month covered (NW_MONTHS), fresh quote, no lots, a
    // filled current tax year. No "all clear" badge either — silence IS the all-clear.
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    expect(screen.queryByRole('navigation', { name: 'Needs attention' })).toBeNull()
  })

  it('surfaces the overdue ritual, the ESPP countdown and the empty tax year, each linked home', async () => {
    const current = currentMonthIso()
    serve({
      // Coverage stops TWO months back: previous and current both missing, which is the
      // one monthly case that fires on any day of the month — pinnable on a real clock.
      // (The day-7 nudge and the rest of the calendar logic are pinned in
      // attention.test.ts, where today is injected.)
      ts: timeseriesOut({ months: [addMonths(current, -4), addMonths(current, -3)] }),
      lots: lotsOut([lotOut(5)]),
      taxYears: [
        { year: CURRENT_YEAR, notes: null, input_count: 0, bracket_count: 42, filing_status: 'single' },
      ],
      system: systemOut({ environment: 'prod' }),
    })
    renderPage()

    const strip = await screen.findByRole('navigation', { name: 'Needs attention' })
    const update = screen.getByRole('link', {
      name: /Monthly updates for .* haven't been entered/,
    })
    expect(update.getAttribute('href')).toBe('/update')
    expect(
      screen.getByRole('link', { name: /An ESPP lot qualifies in 5 days/ }).getAttribute('href'),
    ).toBe('/espp')
    expect(
      screen
        .getByRole('link', { name: new RegExp(`${CURRENT_YEAR}'s tax inputs are empty`) })
        .getAttribute('href'),
    ).toBe('/taxes')
    expect(
      screen
        .getByRole('link', { name: /Nightly backup hasn't run recently/ })
        .getAttribute('href'),
    ).toBe('/settings#backups')
    // Exactly the four conditions above — nothing else invented itself an item.
    expect(strip.querySelectorAll('a')).toHaveLength(4)
  })

  it('turns the coverage gaps into wizard links for those months', async () => {
    serve({ coverage: LAGGING })
    renderPage()

    await screen.findByRole('navigation', { name: 'Needs attention' })
    // The strip appends its own arrow glyph, so the accessible name is matched, not equalled.
    expect(
      screen
        .getByRole('link', { name: new RegExp(`^${formatMonth(AUG)} spending was never entered`) })
        .getAttribute('href'),
    ).toBe(`/update?month=${AUG}&step=spending`)
    expect(
      screen
        .getByRole('link', { name: new RegExp(`^${formatMonth(SEP)} was saved with no spending`) })
        .getAttribute('href'),
    ).toBe(`/update?month=${SEP}&step=spending`)
  })
})

describe('OverviewPage on an empty database', () => {
  it('renders dashes and per-slot empty notes rather than a page of zeros', async () => {
    serve({
      summary: summaryOut({ month: null, net_worth: null, mom_delta: null, mom_pct: null }),
      ts: timeseriesOut({ months: [], net_worth: [], mom_pct: [], notes: [] }),
      holdings: holdingsOut({
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
      }),
      history: historyOut({ dates: [], market_value: [], cost_basis: [], sp500: [], benchmark: [] }),
      matrix: matrixOut({ months: [], totals: [] }),
      taxes: { years: [] },
      coverage: coverageOut({
        balances: [], spending: [], net_pay: [],
        latest: { balances: null, spending: null, net_pay: null },
      }),
      flow: moneyFlowOut({
        renderable: false,
        reason:
          'No tax inputs are stored for 2031 — enter the year on the Taxes page to draw its money flow.',
        available_years: [],
        warnings: ['no tax inputs stored for 2031'],
      }),
    })
    renderPage()

    const hero = await screen.findByText('Net worth')
    expect(valueOf(hero.closest('.stat-tile') as HTMLElement)).toBe('—')
    expect(deltaOf(hero.closest('.stat-tile') as HTMLElement)).toBeNull()
    // Pre-first-refresh: a price has never been fetched, so there is no day change to show.
    expect(deltaOf(tileFor('Portfolio'))).toBeNull()
    expect(valueOf(tileFor('Spending'))).toBe('—')
    expect(valueOf(tileFor('Effective tax'))).toBe('—')

    expect(screen.queryAllByTestId('echart')).toHaveLength(0)
    expect(screen.getByText('No snapshots yet.')).toBeTruthy()
    expect(screen.getByText('No performance history yet.')).toBeTruthy()
    expect(screen.getByText('No spending months yet.')).toBeTruthy()
    // The money-flow card refuses with the SERVER's sentence — no fourth chart.
    expect(screen.getByText(/No tax inputs are stored for 2031/)).toBeTruthy()

    // Capitalized (unlike PortfolioPage's lowercase note): four peer clauses in one row,
    // and the other three start with a capital. A feed that never started says so — a
    // fresh database is not a late one, so none of these wears the amber.
    expect(screen.getByText('Prices never refreshed')).toBeTruthy()
    expect(screen.getByText('Balances — no months')).toBeTruthy()
    expect(screen.getByText('Spending — no months')).toBeTruthy()
    expect(screen.getByText('Net pay — no months')).toBeTruthy()
    expect(document.querySelectorAll('.overview-freshness .stale')).toHaveLength(0)
  })
})

describe('OverviewPage failures', () => {
  it('banners a failed first load and refetches all eleven on Retry', async () => {
    failAll()
    renderPage()

    const banner = await screen.findByRole('alert')
    // The message alone: no stale cue, because there is nothing on screen to be stale.
    expect(banner.textContent).toContain('overview unavailable')
    expect(banner.textContent).not.toContain('earlier data')
    // No tiles at all — a page of $0.00 would read as "you are broke", not as "load failed".
    expect(document.querySelectorAll('.stat-tile')).toHaveLength(0)

    serve()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('Net worth — Aug 2026')
    expect(screen.queryByRole('alert')).toBeNull()
    // One snapshot means one round trip per client, twice over: the failed mount and Retry.
    for (const client of [
      fetchSummary, fetchTimeseries, fetchHoldings, fetchHistory, fetchMatrix,
      fetchAllTaxSummaries, fetchLots, fetchTaxYears, fetchYearly, fetchDividends,
      fetchSystemStatus,
    ]) {
      expect(client).toHaveBeenCalledTimes(2)
    }
  })

  it('keeps the tiles up and cues the staleness when a reload fails', async () => {
    // Seeded so the first paint is cached and the hero settles nowhere (spec §8) — the
    // successful load this test needs before the failure still happens, as the revalidation.
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    failAll('overview unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await screen.findByText(/Showing earlier data — overview unavailable/)
    // The previous snapshot survives the failure — a dashboard that blanks itself on a
    // dropped connection is worse than one that admits the numbers are a minute old.
    expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$1,234,567.00')
    // failAll fails the money-flow fetch too, and that card dents ITSELF: on ChartCard's
    // grammar a failure with data already on screen keeps the sankey up and adds the
    // card-local advisory + Retry (the frame's "ready + error" rule), so all four charts
    // stay while only the money-flow card admits it is behind.
    expect(screen.getAllByTestId('echart')).toHaveLength(4)
    expect(screen.getByText(/Couldn't load the money flow/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry loading the money flow' })).toBeTruthy()
  })

  it('lets the newest snapshot win when two loads overlap', async () => {
    // Slow first refresh, fast second: the stale answer must not repaint the page.
    // Seeded so the hero is static from the first paint (spec §8) — the two refreshes whose
    // ordering this test is about are unchanged.
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    const slow = deferred<NetWorthSummary>()
    vi.mocked(fetchSummary).mockReturnValueOnce(slow.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    serve({ summary: summaryOut({ net_worth: '2000000.00' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$2,000,000.00'))

    slow.resolve(summaryOut({ net_worth: '999.00' }))
    await act(async () => {
      await slow.promise
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // The overtaken snapshot is dropped whole — seqRef, not per-field merging.
    expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$2,000,000.00')
  })
})

it('renders the next five calendar events as links, and only five', async () => {
  serve()
  renderPage()
  await screen.findByText('Upcoming event 1')
  screen.getByText('Upcoming event 5')
  expect(screen.queryByText('Upcoming event 6')).toBeNull()
  const link = screen.getByText(/Upcoming event 1/).closest('a')
  expect(link?.getAttribute('href')).toBe('/paycheck')
  // A SEPARATE fetch — exactly one calendar call, never a twelfth Promise.all member.
  expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(1)
})

it('renders a custom event as a plain row — no page to open (spec §9.2)', async () => {
  serve()
  vi.mocked(fetchCalendar).mockResolvedValue({
    sources: [],
    quote_as_of: null,
    events: [
      calendarEvent({ date: daysAgo(-1), type: 'custom', label: 'Car insurance', id: 41 }),
      ...upNextEvents(2),
    ],
  })
  renderPage()
  await screen.findByText(/Car insurance/)
  expect(screen.getByText(/Car insurance/).closest('a')).toBeNull()
  // Computed neighbors keep their links.
  expect(screen.getByText(/Upcoming event 1/).closest('a')?.getAttribute('href')).toBe('/paycheck')
})

// The ranking and the 45-day line (2026-09-03 calendar spec §14): a deadline that is close
// leads, a second payday is dropped from the LIST, and the line still sums the whole window.
it('ranks Up next with one payday and prints the 45-day line with amounts', async () => {
  serve()
  const today = todayIso()
  vi.mocked(fetchCalendar).mockResolvedValue({
    sources: [],
    quote_as_of: null,
    events: [
      calendarEvent({ date: addDays(today, 3), type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
      calendarEvent({ date: addDays(today, 18), type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
      calendarEvent({ date: addDays(today, 10), type: 'tax_deadline', label: 'Tax deadline — Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }),
    ],
  })
  renderPage()
  await screen.findByText(/Tax deadline — Q3/)
  const items = Array.from(document.querySelectorAll('.up-next-list li')).map((li) => li.textContent)
  expect(items).toHaveLength(2) // the second payday is dropped from the list
  expect(items[0]).toContain('Tax deadline — Q3') // a deadline within 14 days leads
  expect(items[0]).toContain('~−$1.2k')
  // Both paydays are in the window even though only one is listed.
  expect(screen.getByText('Next 45 days: +$13.6k in · ~−$1.2k out')).toBeTruthy()
})

it('a calendar failure dents only the strip, never the snapshot', async () => {
  serve()
  vi.mocked(fetchCalendar).mockRejectedValue(new ApiError('calendar down', 500))
  renderPage()
  await screen.findByText(/Couldn't load upcoming events/)
  screen.getByText(/Net worth —/) // the snapshot half rendered normally
  expect(screen.queryByRole('alert')).toBeNull() // and no page-level banner fired
})

describe('OverviewPage click-through (2026-08-25 spec §2d)', () => {
  it('spending bars carry the clicked month into the /spending drill deep link', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[2]) // bars: first of the 12-month slice
    expect(screen.getByTestId('location').textContent).toBe('/spending?month=2025-08-01')
  })

  it('maps the bar index through the trailing-12 slice offset', async () => {
    // 13 months on the wire, 12 drawn: dataIndex 0 is the SECOND month, not the first.
    serve({
      matrix: matrixOut({
        months: monthsFrom('2025-07-01', 13),
        totals: [...Array<string>(12).fill('5000.00'), '6000.00'],
      }),
    })
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[2])
    expect(screen.getByTestId('location').textContent).toBe('/spending?month=2025-08-01')
  })

  it('performance goes to /portfolio, the net-worth trend to /net-worth', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[1])
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
    cleanup()
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[0])
    expect(screen.getByTestId('location').textContent).toBe('/net-worth')
  })
})

it('a money-flow failure dents only its card, and its Retry refetches the flow alone', async () => {
  serve()
  vi.mocked(fetchMoneyFlow).mockRejectedValue(new ApiError('flow down', 500))
  renderPage()
  await screen.findByText(/Couldn't load the money flow/)
  screen.getByText(/Net worth —/) // the snapshot half rendered normally
  expect(screen.queryByRole('alert')).toBeNull() // no page-level banner fired

  vi.mocked(fetchMoneyFlow).mockResolvedValue(moneyFlowOut())
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the money flow' }))
  await screen.findByText(`Money flow — ${CURRENT_YEAR}`)
  expect(fetchSummary).toHaveBeenCalledTimes(1) // the snapshot was never refetched
})

it('money-flow year chips refetch the picked year and nothing else', async () => {
  serve()
  renderPage()
  await screen.findByText(`Money flow — ${CURRENT_YEAR}`)
  fireEvent.click(screen.getByRole('button', { name: String(CURRENT_YEAR - 1) }))
  await waitFor(() => expect(fetchMoneyFlow).toHaveBeenLastCalledWith(CURRENT_YEAR - 1))
  expect(fetchSummary).toHaveBeenCalledTimes(1)
})

it('Refresh refetches the money flow alongside the snapshot', async () => {
  serve()
  renderPage()
  await screen.findByText(`Money flow — ${CURRENT_YEAR}`)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(fetchMoneyFlow).toHaveBeenCalledTimes(2))
  // No year pinned by a chip yet, so the reload keeps the server-default call shape.
  expect(vi.mocked(fetchMoneyFlow).mock.calls[1]).toEqual([undefined])
})

describe('OverviewPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints instantly from a seeded snapshot and still revalidates', () => {
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    pendAllSnapshotFetches()
    const { container } = renderPage()
    // The hero tile's number is up on the very first paint, with no page skeleton. (The
    // money-flow card carries its OWN status line while its isolated fetch is in flight —
    // that track has no seed here, and it is a card-level state, not the page's.)
    expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$1,234,567.00')
    expect(container.querySelector('.page-skeleton')).toBeNull()
    // Revalidating under the house dim, and the requests really went out.
    expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
    expect(vi.mocked(fetchSummary)).toHaveBeenCalledTimes(1)
    // A cached paint renders its charts still.
    expect(
      pageCharts().every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })

  it('seeds the up-next strip from its own day-keyed track', () => {
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    pendAllSnapshotFetches()
    // todayIso() is LOCAL-date based (utils/months) — the UTC slice would miss by a day.
    setSnapshot(`overview:upnext:${todayIso()}`, upNextEvents())
    vi.mocked(fetchCalendar).mockImplementation(() => new Promise(() => {}))
    renderPage()
    // The strip is up before the calendar answers — its own key, its own fetch.
    expect(screen.getByText('Upcoming event 1')).toBeTruthy()
  })

  it('a changed revalidation payload updates the page and re-arms the charts', async () => {
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    serve({ summary: summaryOut({ net_worth: '2000000.00' }) })
    const { container } = renderPage()
    expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$1,234,567.00')
    await waitFor(() =>
      expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$2,000,000.00'),
    )
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
    expect(
      pageCharts().every((el) => el.getAttribute('data-animate') === 'true'),
    ).toBe(true)
  })

  it('leaves the charts still when the revalidation payload is identical', async () => {
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    const { container } = renderPage()
    // The dim lifting is the revalidation landing — .finally runs on every resolution.
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
    expect(
      pageCharts().every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })
})

describe('OverviewPage — skeleton first paint (2026-08-27 spec §3)', () => {
  it('ghosts the page chrome on a cache miss and announces it once', () => {
    serve()
    pendAllSnapshotFetches()
    const { container } = renderPage()

    // Nothing seeded, nothing answered: the first paint is the page's own shape in
    // ghost form — four tiles and four cards — not a centered line of text.
    const skeleton = container.querySelector('.page-skeleton')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.className).toContain('loading-fallback')
    expect(container.querySelectorAll('.page-skeleton .kpi-row .stat-tile').length).toBe(4)
    expect(container.querySelectorAll('.page-skeleton .card-grid .card').length).toBe(4)

    // The sentence the old `p.empty-note` carried is still announced, exactly once, and
    // the ghosts themselves are silent.
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading…')
    expect(status.className).toContain('visually-hidden')
    expect(
      container.querySelector('.page-skeleton .kpi-row')?.getAttribute('aria-hidden'),
    ).toBe('true')
    expect(
      container.querySelector('.page-skeleton .card-grid')?.getAttribute('aria-hidden'),
    ).toBe('true')
  })

  it('revalidates a seeded page under the dim, never behind a skeleton', () => {
    const payload = serve()
    setSnapshot('overview:all', snapshotOf(payload))
    pendAllSnapshotFetches()
    const { container } = renderPage()

    // A cache HIT never regresses to a ghost: the real numbers stay up and the reload
    // shows as the house dim (spec §3 — skeletons are cache-miss only).
    expect(container.querySelector('.page-skeleton')).toBeNull()
    expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$1,234,567.00')
    expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
  })
})

describe('OverviewPage — hero count-up (2026-08-27 spec §8)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands the hero a count-up on a fresh paint, so it starts at the formatted zero', async () => {
    // No frame ever fires, so what is on screen is the PAINT rather than a moment of the
    // animation — the easing itself is StatTile's test; this one pins the call-site gate,
    // which nothing else can see (the cached-paint half is pinned by the tests above, which
    // would read $0.00 if the gate were inverted).
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})

    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$0.00')
    // The non-hero tiles never settle — they are up whole on the same paint.
    expect(valueOf(tileFor('Portfolio'))).toBe('$812,345.67')
  })
})

describe('OverviewPage — shell frame and owner scope', () => {
  it('renders through PageFrame: one h1, actions on the right, no bespoke header', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    expect(document.querySelector('.page-frame-header h1')?.textContent).toBe('Overview')
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    // The hand-built header is gone, not merely restyled.
    expect(document.querySelector('.page-header')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Refresh' }).closest('.page-frame-actions'),
    ).toBeTruthy()
  })

  it('a reload failure keeps the page and shows the frame’s stale line with Retry', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    vi.mocked(fetchSummary).mockRejectedValueOnce(new ApiError('offline', 503))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(/Showing earlier data — offline/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(document.querySelector('.stat-tile')).toBeTruthy() // data stayed up
  })

  it('a first-load failure shows the frame’s alert alone', async () => {
    serve()
    vi.mocked(fetchSummary).mockRejectedValueOnce(new ApiError('boom', 500))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('boom')
    // Not even the skeleton's ghost tiles: an error with no data is the banner alone.
    expect(document.querySelector('.stat-tile')).toBeNull()
  })

  it('honors the owner scope from the URL for net worth and holdings, not spending', async () => {
    serve()
    renderPage('/?owner=2')
    await screen.findByText('Overview')

    await waitFor(() => expect(vi.mocked(fetchSummary)).toHaveBeenCalledWith(2))
    expect(vi.mocked(fetchTimeseries)).toHaveBeenCalledWith('monthly', 2)
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledWith(2)
    // Spending is household-wide — no owner param, and exactly one call.
    expect(vi.mocked(fetchMatrix)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchMatrix)).toHaveBeenCalledWith()
    expect(await screen.findByRole('group', { name: 'Whose' })).toBeTruthy()
  })

  // The owner-keyed snapshot brings NetWorthPage's 2026-08-28 stranding bug within reach:
  // an identical-payload skip judged against the CACHE leaves the previous scope's numbers
  // on screen forever, because returning to a warm scope always finds its own payload there.
  it('restores the household view after visiting an owner and coming back', async () => {
    const payload = serve()
    const scoped = holdingsOut({
      totals: { ...holdingsOut().totals, market_value: '99.00' },
    })
    // The Portfolio tile, not the hero: a fresh paint settles the hero with a count-up.
    vi.mocked(fetchHoldings).mockImplementation((owner) =>
      Promise.resolve(owner === 2 ? scoped : payload.holdings),
    )
    renderPage()
    await waitFor(() => expect(valueOf(tileFor('Portfolio'))).toBe('$812,345.67'))

    fireEvent.click(await screen.findByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(valueOf(tileFor('Portfolio'))).toBe('$99.00'))

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(valueOf(tileFor('Portfolio'))).toBe('$812,345.67'))
  })

  it('dims the body while the new scope is in flight', async () => {
    serve()
    const { container } = renderPage()
    await waitFor(() => expect(valueOf(tileFor('Portfolio'))).toBe('$812,345.67'))
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())

    pendAllSnapshotFetches()
    fireEvent.click(await screen.findByRole('button', { name: 'Grace' }))
    // Nothing warm for that scope yet: the previous payload stays up, under the dim, rather
    // than the refetch running silently behind unchanged numbers.
    expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
    expect(valueOf(tileFor('Portfolio'))).toBe('$812,345.67')
  })

  it('paints an already-seen scope from the cache the moment the chip flips', async () => {
    const payload = serve()
    const { container } = renderPage()
    await waitFor(() => expect(valueOf(tileFor('Portfolio'))).toBe('$812,345.67'))

    setSnapshot('overview:2', {
      ...snapshotOf(payload),
      holdings: holdingsOut({ totals: { ...holdingsOut().totals, market_value: '99.00' } }),
    })
    pendAllSnapshotFetches()
    fireEvent.click(await screen.findByRole('button', { name: 'Grace' }))
    // Instant, before any fetch resolves — and still revalidating underneath.
    expect(valueOf(tileFor('Portfolio'))).toBe('$99.00')
    expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
  })

  it('says so on the two cards an owner scope cannot reach, and nothing when it is All', async () => {
    serve()
    renderPage('/?owner=2')
    await screen.findByText('Net worth — Aug 2026')
    // The hint's button is named by its first four words now (motion spec §8), and this
    // caveat is APPENDED to a sentence — so the only place it can be read is the bubble.
    expect(hintText(/^About The latest entered month's/)).toContain(
      'Household total — spending has no owner.',
    )
    expect(hintText(/^About Portfolio value vs cost/)).toContain(
      'Household history; owner scope does not apply to the weekly checkpoints.',
    )

    cleanup()
    renderPage('/?owner=all')
    await screen.findByText('Net worth — Aug 2026')
    expect(hintText(/^About The latest entered month's/)).not.toContain('spending has no owner')
    expect(hintText(/^About Portfolio value vs cost/)).not.toContain('weekly checkpoints')
  })
})

describe('OverviewPage chart cards (charts C2)', () => {
  it('mounts the three snapshot charts through ChartCard with labels, export rows and the drill links', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth trend')
    expect(screen.getByLabelText('Line chart of net worth at every monthly snapshot')).toBeTruthy()
    expect(screen.getByLabelText(/Line chart of portfolio value against cost basis/)).toBeTruthy()
    expect(screen.getByLabelText(/Bar chart of total spending for each of the last 12 entered months/)).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /Export/ }).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByRole('link', { name: 'Open net worth →' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open spending →' })).toBeTruthy()
  })
})
