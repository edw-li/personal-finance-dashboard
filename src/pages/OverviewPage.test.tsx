import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type {
  AllocationResponse,
  HoldingsResponse,
  NetWorthSummary,
  NetWorthTimeseries,
  SpendingMatrix,
  TaxSummariesOut,
  TaxSummaryOut,
} from '../types/api'
import { formatDate } from '../utils/format'
import OverviewPage from './OverviewPage'

// Six modules, one snapshot: the page's whole contract is that these resolve TOGETHER.
vi.mock('../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/netWorth')>()),
  fetchSummary: vi.fn(),
  fetchTimeseries: vi.fn(),
}))
vi.mock('../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/portfolio')>()),
  fetchHoldings: vi.fn(),
  fetchAllocation: vi.fn(),
}))
vi.mock('../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/spending')>()),
  fetchMatrix: vi.fn(),
}))
vi.mock('../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/taxes')>()),
  fetchAllTaxSummaries: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law). What the three
// charts DRAW is pinned in src/components/overview/overviewChartOptions.test.ts; this file
// asks only whether a chart is on screen and — via the categories the marker carries —
// WHICH feed drew it. The async factory keeps the JSX runtime out of the hoisted scope.
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
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchAllocation, fetchHoldings } from '../api/portfolio'
import { fetchMatrix } from '../api/spending'
import { fetchAllTaxSummaries } from '../api/taxes'

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

function timeseriesOut(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    accounts: [],
    series: [],
    group_totals: {
      cash: [], pre_tax: [], post_tax: [], taxable: [], equity: [], other: [], liability: [],
    },
    net_worth: ['1200000.00', '1224567.00', '1234567.00'],
    mom_pct: [null, '0.020466', '0.008163'],
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

function allocationOut(over: Partial<AllocationResponse> = {}): AllocationResponse {
  return {
    by: 'type',
    total_market_value: '812345.67',
    slices: [
      { key: 'etf', market_value: '500000.00', weight_pct: '0.6155', holdings: 4 },
      { key: 'stock', market_value: '312345.67', weight_pct: '0.3845', holdings: 3 },
    ],
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

interface Payload {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  allocation: AllocationResponse
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
}

// Arms all six clients at once — the page never renders a partial snapshot, so neither
// does the harness.
function serve(over: Partial<Payload> = {}): Payload {
  const payload: Payload = {
    summary: summaryOut(),
    ts: timeseriesOut(),
    holdings: holdingsOut(),
    allocation: allocationOut(),
    matrix: matrixOut(),
    taxes: { years: [taxSummaryOut(CURRENT_YEAR)] },
    ...over,
  }
  vi.mocked(fetchSummary).mockResolvedValue(payload.summary)
  vi.mocked(fetchTimeseries).mockResolvedValue(payload.ts)
  vi.mocked(fetchHoldings).mockResolvedValue(payload.holdings)
  vi.mocked(fetchAllocation).mockResolvedValue(payload.allocation)
  vi.mocked(fetchMatrix).mockResolvedValue(payload.matrix)
  vi.mocked(fetchAllTaxSummaries).mockResolvedValue(payload.taxes)
  return payload
}

function failAll(message = 'overview unavailable'): void {
  const boom = () => Promise.reject(new ApiError(message, 500))
  vi.mocked(fetchSummary).mockImplementation(boom)
  vi.mocked(fetchTimeseries).mockImplementation(boom)
  vi.mocked(fetchHoldings).mockImplementation(boom)
  vi.mocked(fetchAllocation).mockImplementation(boom)
  vi.mocked(fetchMatrix).mockImplementation(boom)
  vi.mocked(fetchAllTaxSummaries).mockImplementation(boom)
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

    // Spending up is BAD: 6,000 against a 5,000 average is a negative-tone tile even though
    // the number went up. (Direction × whether-up-is-good is the caller's job — StatTile.)
    const spending = tileFor('Spending — Jul 2026')
    expect(valueOf(spending)).toBe('$6,000.00')
    expect(deltaOf(spending)?.textContent).toBe('▼ vs $5,000.00 12-mo avg')
    expect(deltaOf(spending)?.className).toContain('stat-delta-negative')

    const tax = tileFor(`Effective tax — ${CURRENT_YEAR} (est.)`)
    expect(valueOf(tax)).toBe('24.7%')
    // A rate is a level, not a movement: no delta, no arrow.
    expect(deltaOf(tax)).toBeNull()
  })

  it('tones the spending tile positive when the month came in under the average', async () => {
    serve({ matrix: matrixOut({ totals: [...Array<string>(11).fill('5000.00'), '4000.00'] }) })
    renderPage()

    const spending = await screen.findByText('Spending — Jul 2026')
    const tile = spending.closest('.stat-tile') as HTMLElement
    expect(valueOf(tile)).toBe('$4,000.00')
    expect(deltaOf(tile)?.textContent).toBe('▲ vs $5,000.00 12-mo avg')
    expect(deltaOf(tile)?.className).toContain('stat-delta-positive')
  })

  it('says nothing about a cashflow-only trailing month', async () => {
    // The matrix months are a UNION of spending rows and net-pay rows, so a month whose
    // paycheck is entered but whose spending is not comes back with an explicit "0.00".
    // A green "$0.00 vs $5,000.00 avg" would congratulate the user for an unentered month.
    serve({ matrix: matrixOut({ totals: [...Array<string>(11).fill('5000.00'), '0.00'] }) })
    renderPage()
    await screen.findByText('Spending — Jul 2026')

    const tile = tileFor('Spending — Jul 2026')
    expect(valueOf(tile)).toBe('—')
    expect(deltaOf(tile)).toBeNull()
    expect(screen.queryByText(/12-mo avg/)).toBeNull()
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
})

describe('OverviewPage charts', () => {
  it('feeds the spark, the donut and the bars', async () => {
    serve()
    renderPage()

    await screen.findByText('Net worth — Aug 2026')
    const charts = screen.getAllByTestId('echart')
    expect(charts).toHaveLength(3)
    // Spark first (net-worth months), donut second (a pie has no x-axis), bars last.
    expect(categoriesOf(charts[0])).toBe('Jun 2026,Jul 2026,Aug 2026')
    expect(categoriesOf(charts[1])).toBe('')
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

  it('ambers a quote date that has gone stale', async () => {
    const quoted = daysAgo(9)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    const prices = await screen.findByText(`Prices as of ${formatDate(quoted)}`)
    expect(prices.className).toContain('stale')
  })
})

describe('OverviewPage on an empty database', () => {
  it('renders dashes and per-slot empty notes rather than a page of zeros', async () => {
    serve({
      summary: summaryOut({ month: null, net_worth: null, mom_delta: null, mom_pct: null }),
      ts: timeseriesOut({ months: [], net_worth: [], mom_pct: [] }),
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
      allocation: allocationOut({ total_market_value: '0.00', slices: [] }),
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
    expect(screen.getByText('No priced holdings yet.')).toBeTruthy()
    expect(screen.getByText('No spending months yet.')).toBeTruthy()

    expect(screen.getByText('prices never refreshed')).toBeTruthy()
    expect(screen.getByText('Net worth — no snapshots')).toBeTruthy()
    expect(screen.getByText('Spending — no months')).toBeTruthy()
  })
})

describe('OverviewPage failures', () => {
  it('banners a failed first load and refetches all six on Retry', async () => {
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
      fetchSummary, fetchTimeseries, fetchHoldings, fetchAllocation, fetchMatrix,
      fetchAllTaxSummaries,
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
