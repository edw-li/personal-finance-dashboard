import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type {
  DividendOut,
  EsppLotOut,
  EsppLotsResponse,
  HoldingsResponse,
  NetWorthSummary,
  NetWorthTimeseries,
  PortfolioHistory,
  SpendingMatrix,
  SpendingYearly,
  TaxSummariesOut,
  TaxSummaryOut,
  TaxYearOut,
} from '../types/api'
import { formatDate, formatMonth } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'
import OverviewPage from './OverviewPage'

// Five modules, ten clients, one snapshot: the page's whole contract is that these
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
// echarts needs a real canvas and is NEVER rendered in jsdom (house law). What the three
// charts DRAW is pinned elsewhere — the spark and the bars in
// src/components/overview/overviewChartOptions.test.ts, the performance lines in
// src/components/portfolio/historyChartOptions.test.ts; this file asks only whether a chart
// is on screen and — via the categories the marker carries — WHICH feed drew it. The async
// factory keeps the JSX runtime out of the hoisted scope.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option }: { option: { xAxis?: { data?: unknown[] } } }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
      }),
  }
})
import { fetchLots } from '../api/espp'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchDividends, fetchHistory, fetchHoldings } from '../api/portfolio'
import { fetchMatrix, fetchYearly } from '../api/spending'
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

function summaryOut(over: Partial<NetWorthSummary> = {}): NetWorthSummary {
  return {
    month: '2026-08-01',
    net_worth: '1234567.00',
    mom_delta: '10000.00',
    mom_pct: '0.008',
    groups: [],
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
    ...over,
  }
}

function holdingsOut(over: Partial<HoldingsResponse> = {}): HoldingsResponse {
  return {
    as_of: daysAgo(1),
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
}

// Arms all ten clients at once — the page never renders a partial snapshot, so neither
// does the harness. The strip-quiet defaults (no lots, a filled current tax year) keep the
// attention strip out of the tests that are not about it; the wall-clock-relative cases
// (monthly-update nudges) live in attention.test.ts, where today is injectable.
function serve(over: Partial<Payload> = {}): Payload {
  const payload: Payload = {
    summary: summaryOut(),
    ts: timeseriesOut(),
    holdings: holdingsOut(),
    history: historyOut(),
    matrix: matrixOut(),
    taxes: { years: [taxSummaryOut(CURRENT_YEAR)] },
    lots: lotsOut(),
    taxYears: [{ year: CURRENT_YEAR, notes: null, input_count: 21, bracket_count: 42 }],
    yearly: { years: [] },
    dividends: [],
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
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OverviewPage />
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
})

afterEach(() => {
  cleanup()
})

describe('OverviewPage tiles', () => {
  it('renders the four tiles from one snapshot', async () => {
    serve()
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
    serve({ summary: summaryOut({ mom_delta: '100.00', mom_pct: null }) })
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

    expect(fetchTimeseries).toHaveBeenCalledWith('monthly')
  })

  it('refetches all ten clients on Refresh', async () => {
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
    ]) {
      expect(client).toHaveBeenCalledTimes(2)
    }
  })
})

describe('OverviewPage charts', () => {
  it('feeds the spark, the performance lines and the bars', async () => {
    // Captured once: daysAgo(1) called twice could straddle UTC midnight and disagree.
    const quoted = daysAgo(1)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    await screen.findByText('Net worth — Aug 2026')
    const charts = screen.getAllByTestId('echart')
    expect(charts).toHaveLength(3)
    // Spark first (net-worth months), performance second (weekly dates + the live
    // category derived from the quote bar date), bars last.
    expect(categoriesOf(charts[0])).toBe(NW_MONTHS.map(formatMonth).join(','))
    expect(categoriesOf(charts[1])).toBe(
      ['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026', formatDate(quoted)].join(','),
    )
    expect(categoriesOf(charts[2])).toBe(
      'Aug 2025,Sep 2025,Oct 2025,Nov 2025,Dec 2025,Jan 2026,Feb 2026,Mar 2026,Apr 2026,May 2026,Jun 2026,Jul 2026',
    )
    // Each card drills into the page that owns the numbers.
    expect(screen.getByRole('link', { name: /Open net worth/ }).getAttribute('href')).toBe('/net-worth')
    expect(screen.getByRole('link', { name: /Open portfolio/ }).getAttribute('href')).toBe('/portfolio')
    expect(screen.getByRole('link', { name: /Open spending/ }).getAttribute('href')).toBe('/spending')
  })
})

describe('OverviewPage freshness', () => {
  it('dates the quotes, the last snapshot and the last spending month', async () => {
    const quoted = daysAgo(1)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    const prices = await screen.findByText(`Prices as of ${formatDate(quoted)}`)
    // Yesterday's bar is not stale — no amber.
    expect(prices.className).not.toContain('stale')
    expect(screen.getByText('Net worth through Aug 2026')).toBeTruthy()
    expect(screen.getByText('Spending through Jul 2026')).toBeTruthy()
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
  it('states the year facts from the yearly rollup and the dividend log', async () => {
    serve({
      yearly: {
        years: [
          {
            year: CURRENT_YEAR,
            by_category: [],
            total: '32000.00',
            net_pay_total: '90000.00',
            savings_rate: '0.644444',
          },
        ],
      },
      dividends: [
        { id: 1, security_id: 1, account: null, pay_date: `${CURRENT_YEAR}-03-15`, amount: '120.50', notes: null },
        // Last year's payout must stay OUT of this year's sum.
        { id: 2, security_id: 1, account: null, pay_date: `${CURRENT_YEAR - 1}-12-15`, amount: '999.00', notes: null },
      ],
    })
    renderPage()

    await screen.findByText(`Year to date — ${CURRENT_YEAR}`)
    // The spending figures are the SERVER's yearly rollup, verbatim.
    expect(screen.getByText('$32,000.00')).toBeTruthy()
    expect(screen.getByText('$90,000.00')).toBeTruthy()
    expect(screen.getByText('64.4%')).toBeTruthy()
    // The dividend sum is this year's payments only.
    expect(screen.getByText('$120.50')).toBeTruthy()
    expect(screen.queryByText('$999.00')).toBeNull()
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
      taxYears: [{ year: CURRENT_YEAR, notes: null, input_count: 0, bracket_count: 42 }],
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
    // Exactly the three conditions above — nothing else invented itself an item.
    expect(strip.querySelectorAll('a')).toHaveLength(3)
  })
})

describe('OverviewPage on an empty database', () => {
  it('renders dashes and per-slot empty notes rather than a page of zeros', async () => {
    serve({
      summary: summaryOut({ month: null, net_worth: null, mom_delta: null, mom_pct: null }),
      ts: timeseriesOut({ months: [], net_worth: [], mom_pct: [], notes: [] }),
      holdings: holdingsOut({
        as_of: null,
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
      history: historyOut({ dates: [], market_value: [], cost_basis: [], sp500: [] }),
      matrix: matrixOut({ months: [], totals: [] }),
      taxes: { years: [] },
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

    // Capitalized (unlike PortfolioPage's lowercase note): three peer clauses in one row,
    // and the other two start with a capital.
    expect(screen.getByText('Prices never refreshed')).toBeTruthy()
    expect(screen.getByText('Net worth — no snapshots')).toBeTruthy()
    expect(screen.getByText('Spending — no months')).toBeTruthy()
  })
})

describe('OverviewPage failures', () => {
  it('banners a failed first load and refetches all ten on Retry', async () => {
    failAll()
    renderPage()

    const banner = await screen.findByRole('alert')
    // The message alone: no stale cue, because there is nothing on screen to be stale.
    expect(banner.textContent).toContain('overview unavailable')
    expect(banner.textContent).not.toContain('earlier data')
    // No tiles at all — a page of $0.00 would read as "you are broke", not as "load failed".
    expect(document.querySelectorAll('.stat-tile')).toHaveLength(0)

    serve()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the overview' }))

    await screen.findByText('Net worth — Aug 2026')
    expect(screen.queryByRole('alert')).toBeNull()
    // One snapshot means one round trip per client, twice over: the failed mount and Retry.
    for (const client of [
      fetchSummary, fetchTimeseries, fetchHoldings, fetchHistory, fetchMatrix,
      fetchAllTaxSummaries, fetchLots, fetchTaxYears, fetchYearly, fetchDividends,
    ]) {
      expect(client).toHaveBeenCalledTimes(2)
    }
  })

  it('keeps the tiles up and cues the staleness when a reload fails', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')

    failAll('overview unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await screen.findByText('overview unavailable — the page may be showing earlier data.', {
      exact: false,
    })
    // The previous snapshot survives the failure — a dashboard that blanks itself on a
    // dropped connection is worse than one that admits the numbers are a minute old.
    expect(valueOf(tileFor('Net worth — Aug 2026'))).toBe('$1,234,567.00')
    expect(screen.getAllByTestId('echart')).toHaveLength(3)
  })

  it('lets the newest snapshot win when two loads overlap', async () => {
    // Slow first refresh, fast second: the stale answer must not repaint the page.
    serve()
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
