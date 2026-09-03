import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type {
  EsppLotOut,
  EsppLotsResponse,
  HoldingOut,
  HoldingsResponse,
  LimitsOut,
  TaxSummaryOut,
  WhatIfOut,
} from '../../types/api'
import WhatIfPanel from './WhatIfPanel'

// Every request this panel makes is stubbed — the four modules it owns end to end.
vi.mock('../../api/whatif', () => ({ runWhatIf: vi.fn() }))
vi.mock('../../api/portfolio', () => ({ fetchHoldings: vi.fn() }))
vi.mock('../../api/espp', () => ({ fetchLots: vi.fn() }))
vi.mock('../../api/limits', () => ({ fetchLimits: vi.fn() }))
import { fetchLots } from '../../api/espp'
import { fetchLimits } from '../../api/limits'
import { fetchHoldings } from '../../api/portfolio'
import { runWhatIf } from '../../api/whatif'

// The Δ bar rides a real ChartCard; only the canvas underneath is stood in for, so the
// card's own chrome — the aria sentence it forwards (F11), the empty state — is exercised.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel }: { ariaLabel?: string }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel }),
  }
})

// The sandbox grammar's pin row and the hook both toast; nothing here asserts on them, but
// a real provider would have to be mounted around every render.
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))

// A promise this file settles by hand — the only way to hold two runs in flight at once and
// choose which one answers first (TaxesPage.test.tsx's).
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function holding(id: number, ticker: string, shares: string, price: string | null): HoldingOut {
  return {
    security_id: id,
    ticker,
    name: `${ticker} fund`,
    industry: null,
    holding_type: 'etf',
    is_manual_priced: false,
    shares,
    avg_cost: '50.0000',
    cost_basis: '5000.00',
    price,
    quoted_at: price === null ? null : '2026-08-20T00:00:00Z',
    price_source: price === null ? null : 'yfinance',
    day_change_pct: null,
    day_change_amount: null,
    market_value: price === null ? null : '6250.00',
    weight_pct: null,
    unrealized_gl: null,
    unrealized_gl_pct: null,
    realized_gl: '0.00',
    dividends_collected: '0.00',
    annual_dividend: null,
    annual_income: null,
    yield_pct: null,
    yoc_pct: null,
    xirr_pct: null,
    accounts: ['Taxable'],
    warnings: [],
  }
}

function holdingsFixture(): HoldingsResponse {
  return {
    as_of: '2026-08-20',
    latest_quote_at: '2026-08-20',
    totals: {
      market_value: '6250.00',
      cost_basis: '5000.00',
      unrealized_gl: '1250.00',
      unrealized_gl_pct: '0.250000',
      day_change_amount: null,
      day_change_pct: null,
      realized_gl: '0.00',
      dividends_collected: '0.00',
      annual_income: '0.00',
      unpriced_count: 1,
    },
    // VTI first: the "first held security not already in a leg" prefill is what Add sale
    // reaches for, and the second click must move on to QQQ.
    holdings: [holding(7, 'VTI', '100.0000', '62.50'), holding(9, 'QQQ', '10.0000', null)],
  }
}

function lot(id: number, purchaseDate: string, sold: boolean): EsppLotOut {
  return {
    id,
    purchase_date: purchaseDate,
    qualifying_date: '2028-02-28',
    shares: '30.0000',
    subscription_price: '100.00000',
    purchase_fmv: '120.00000',
    purchase_price: '85.00000',
    sold_date: sold ? '2026-06-01' : null,
    sold_price: sold ? '140.00000' : null,
    notes: null,
    cost_basis: '2550.00',
    market_value: '4500.00',
    gain_amount: '1950.00',
    gain_pct: '0.764706',
    qualified: false,
    days_until_qualified: sold ? null : 557,
    is_sold: sold,
  }
}

function lotsFixture(): EsppLotsResponse {
  return {
    espp_ticker: 'NVDA',
    current_price: '150.00000',
    quoted_at: '2026-08-20T00:00:00Z',
    lots: [lot(3, '2026-02-28', false), lot(4, '2025-02-28', true)],
  }
}

function summaryFixture(year: number, takeHome: string, rate: string | null): TaxSummaryOut {
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
      taxable_income: '0.00',
      gains_amount: '0.00',
      tax: '0.00',
      effective_rate: null,
    },
    totals: {
      gross_income: '500000.00',
      total_income: '500000.00',
      total_tax: '123456.78',
      take_home: takeHome,
      effective_rate: rate,
    },
    warnings: [],
  }
}

function resultFixture(overrides: Partial<WhatIfOut> = {}): WhatIfOut {
  return {
    year: 2024,
    baseline: summaryFixture(2024, '376543.22', '0.246914'),
    scenario: summaryFixture(2024, '372222.22', '0.281234'),
    delta: {
      total_tax: '4321.00',
      take_home: '-4321.00',
      federal_tax: '3000.00',
      state_tax: '1000.00',
      medicare_tax: '221.00',
      social_security_tax: '100.00',
      disability_tax: '0.00',
      capital_gains_tax: '0.00',
      effective_rate: '0.034320',
    },
    changed_inputs: [
      {
        key: 'ltcg_brokerage',
        label: 'LTCG: Brokerage Gain/Loss',
        before: '12000.00',
        after: '30500.00',
      },
    ],
    sale_details: [
      {
        security_id: 7,
        ticker: 'VTI',
        shares: '100.0000',
        price: '62.50000',
        proceeds: '6250.00',
        cost_basis: '5000.00',
        gain: '1250.00',
        term: 'long',
        warnings: [],
      },
    ],
    espp_sale_details: [],
    warnings: [],
    ...overrides,
  }
}

// Anchored: "Open what-if" / "Close what-if" — the Run button is gone (spec §10: live).
const openButton = () => screen.getByRole('button', { name: /^(Open|Close) what-if$/ }) as HTMLButtonElement
const addSale = () => screen.getByRole('button', { name: 'Add sale' }) as HTMLButtonElement
const addEsppSale = () => screen.getByRole('button', { name: 'Add ESPP sale' }) as HTMLButtonElement
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

// A tile is found by its LABEL, then read for the two things the contract is about: the
// figure and the delta line's tone/glyph. The label is searched with getAllByText because
// the compare table below carries row labels of its own ("Effective rate" is both a tile
// and a row) — the tile is the match that sits inside one.
function tile(label: string): HTMLElement {
  const node = screen
    .getAllByText(label)
    .map((match) => match.closest('.stat-tile'))
    .find((found) => found !== null)
  if (node === undefined) throw new Error(`no stat tile labelled ${label}`)
  return node as HTMLElement
}

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}
const url = () => screen.getByTestId('url').textContent

function limitsFixture(): LimitsOut {
  return {
    year: 2024,
    items: [
      { key: 'limit_401k_elective', label: '401(k) elective deferral', value: '23500.00' },
      { key: 'limit_415c_total', label: '415(c) total additions', value: null },
      { key: 'limit_hsa_self', label: 'HSA — self-only', value: '4300.00' },
      { key: 'limit_hsa_family', label: 'HSA — family', value: null },
      { key: 'limit_espp_423', label: 'ESPP §423 annual', value: '25000.00' },
    ],
  }
}

function mount(entry = '/taxes', props: Partial<Parameters<typeof WhatIfPanel>[0]> = {}) {
  const onApplyOverrides = vi.fn()
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <WhatIfPanel year={2024} onApplyOverrides={onApplyOverrides} {...props} />
      <Url />
    </MemoryRouter>,
  )
  return { ...view, onApplyOverrides }
}

async function openPanel() {
  fireEvent.click(openButton())
  await waitFor(() => expect(addSale()).toBeTruthy())
}

// The last body runWhatIf was asked for.
const lastBody = () => vi.mocked(runWhatIf).mock.calls.at(-1)?.[0]

beforeEach(() => {
  localStorage.clear()
  vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
  vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
  vi.mocked(fetchLimits).mockResolvedValue(limitsFixture())
  vi.mocked(runWhatIf).mockResolvedValue(resultFixture())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WhatIfPanel', () => {
  it('mounts CLOSED and spends no request until it is opened', () => {
    mount()
    expect(openButton().textContent).toBe('Open what-if')
    expect(openButton().getAttribute('aria-expanded')).toBe('false')
    expect(vi.mocked(fetchHoldings)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchLots)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchLimits)).not.toHaveBeenCalled()
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()
  })

  it('loads the three feeds on first open (once across a close/reopen) and runs the empty scenario for the baseline', async () => {
    mount()
    await openPanel()
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLimits)).toHaveBeenCalledWith(2024)
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({ year: 2024, sales: [], espp_sales: [] }))
    fireEvent.click(openButton())
    fireEvent.click(openButton())
    await waitFor(() => expect(addSale()).toBeTruthy())
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
  })

  it('Add sale prefills the first held security at its quote, writes the URL and runs at once; the second row moves on', async () => {
    mount()
    await openPanel()
    fireEvent.click(addSale())
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await waitFor(() =>
      expect(lastBody()).toEqual({ year: 2024, sales: [{ security_id: 7, shares: '100.0000', price: '62.50', term: 'long' }], espp_sales: [] }),
    )
    expect((screen.getByLabelText('Sell') as HTMLSelectElement).value).toBe('7')
    expect(field('Sale 1 shares').value).toBe('100.0000')
    fireEvent.click(addSale())
    // QQQ is unpriced: no price field, the omit case.
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000%3A62.50&whatif=sale%3A9%3A10.0000')
    expect(addSale().disabled).toBe(true)
  })

  it('typing shares debounces (400 ms) and a blank price is OMITTED; blur commits immediately', async () => {
    vi.useFakeTimers()
    try {
      mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
      await act(async () => {})
      fireEvent.change(field('Sale 1 shares'), { target: { value: '40' } })
      expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(url()).toBe('/taxes?whatif=sale%3A7%3A40%3A62.50')
      fireEvent.change(field('Sale 1 price'), { target: { value: '' } })
      fireEvent.blur(field('Sale 1 price'))
      expect(url()).toBe('/taxes?whatif=sale%3A7%3A40')
      await act(async () => {})
      const body = lastBody()!
      expect(body.sales).toEqual([{ security_id: 7, shares: '40', term: 'long' }])
      expect('price' in body.sales[0]).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a term click is immediate and spells S in the URL', async () => {
    mount('/taxes?whatif=sale%3A7%3A40')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Sale 1 term' })).toBeTruthy())
    fireEvent.click(within(screen.getByRole('group', { name: 'Sale 1 term' })).getByRole('button', { name: 'Short' }))
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A40%3A%3AS')
    await waitFor(() => expect(lastBody()?.sales[0].term).toBe('short'))
  })

  it('refuses an oversell / zero / bad price in the box’s words, spending no request and leaving the URL alone', async () => {
    mount('/taxes?whatif=sale%3A7%3A40')
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    fireEvent.change(field('Sale 1 shares'), { target: { value: '200' } })
    fireEvent.blur(field('Sale 1 shares'))
    expect(screen.getByRole('alert').textContent).toContain('selling 200 VTI — only 100.0000 held')
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A40')
    fireEvent.change(field('Sale 1 shares'), { target: { value: '0' } })
    fireEvent.blur(field('Sale 1 shares'))
    expect(screen.getByRole('alert').textContent).toContain('VTI: shares must be a number greater than 0')
    fireEvent.change(field('Sale 1 price'), { target: { value: '-5' } })
    fireEvent.blur(field('Sale 1 price'))
    expect(screen.getByRole('alert').textContent).toContain('VTI: price must be a number greater than 0, or blank')
    expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1)
  })

  it('prefills an ESPP leg from the first unsold lot at the lots quote and runs', async () => {
    mount()
    await openPanel()
    fireEvent.click(addEsppSale())
    expect(url()).toBe('/taxes?whatif=espp%3A3%3A150.00000')
    const select = screen.getByLabelText('ESPP lot') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Feb 28, 2026 — 30 sh'])
    await waitFor(() => expect(lastBody()).toEqual({ year: 2024, sales: [], espp_sales: [{ lot_id: 3, sale_price: '150.00000' }] }))
  })

  it('renders the two Δ tiles, the ten compare rows (NIIT from niit_tax) and the changed inputs as they arrived', async () => {
    vi.mocked(runWhatIf).mockResolvedValue(
      resultFixture({
        baseline: { ...summaryFixture(2024, '376543.22', '0.246914'), niit: { taxable_income: '0.00', gains_amount: '1989.28', tax: '75.59', effective_rate: null } },
        scenario: { ...summaryFixture(2024, '372222.22', '0.281234'), niit: { taxable_income: '0.00', gains_amount: '1989.28', tax: '0.00', effective_rate: null } },
        delta: { ...resultFixture().delta, niit_tax: '-75.59' },
      }),
    )
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await screen.findByText('Δ total tax')
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$4,321.00')
    expect(tile('Δ total tax').querySelector('.stat-delta')?.className).toContain('stat-delta-negative')
    expect(tile('Effective rate').querySelector('.stat-value')?.textContent).toBe('24.7% → 28.1%')
    const niit = screen.getByText('NIIT').closest('tr') as HTMLElement
    expect(within(niit).getAllByRole('cell').map((c) => c.textContent)).toEqual(['NIIT', '$75.59', '$0.00', '-$75.59'])
    expect(within(niit).getByText('-$75.59').className).toContain('delta-chip-positive') // less NIIT reads green
    const takeHome = screen.getByText('Take-home').closest('tr') as HTMLElement
    expect(within(takeHome).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Take-home', '$376,543.22', '$372,222.22', '-$4,321.00'])
    expect(screen.getByText('LTCG: Brokerage Gain/Loss — $12,000.00 → $30,500.00')).toBeTruthy()
    expect(screen.getByText('$1,250.00')).toBeTruthy()
    // WHERE it moved, beside how much: the per-jurisdiction Δ bar, through the one chart
    // mount the chart spec allows.
    expect(
      screen.getByLabelText('Change in tax by jurisdiction, scenario minus baseline'),
    ).toBeTruthy()
  })

  it('says nothing moved rather than drawing seven bars of zero', async () => {
    vi.mocked(runWhatIf).mockResolvedValue(
      resultFixture({
        delta: {
          total_tax: '0.00',
          take_home: '0.00',
          federal_tax: '0.00',
          state_tax: '0.00',
          medicare_tax: '0.00',
          social_security_tax: '0.00',
          disability_tax: '0.00',
          capital_gains_tax: '0.00',
          effective_rate: null,
        },
      }),
    )
    mount('/taxes?whatif=sale%3A7%3A40')
    expect(
      await screen.findByText('Nothing moved — every jurisdiction computes to the stored year.'),
    ).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('an absent NIIT block prints the em dash', async () => {
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    const niit = (await screen.findByText('NIIT')).closest('tr') as HTMLElement
    expect(within(niit).getAllByRole('cell').map((c) => c.textContent)).toEqual(['NIIT', '—', '—', '—'])
  })

  it('keeps the last result under the stale line when a run fails, in the server’s words', async () => {
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await screen.findByText('Δ total tax')
    vi.mocked(runWhatIf).mockRejectedValueOnce(new ApiError('unknown input key: nope', 422))
    fireEvent.click(within(screen.getByRole('group', { name: 'Sale 1 term' })).getByRole('button', { name: 'Short' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('unknown input key: nope — this scenario may be showing earlier data.')
    expect(screen.getByText('Δ total tax')).toBeTruthy()
  })

  it('renders scenario warnings in the advisory register, never as an error', async () => {
    vi.mocked(runWhatIf).mockResolvedValue(resultFixture({ warnings: ['VTI: acquisition dates unknown — treated as long-term'] }))
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    const warning = await screen.findByText('VTI: acquisition dates unknown — treated as long-term')
    expect(warning.closest('.tax-warnings')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets only the NEWEST of two overlapping runs land', async () => {
    const slow = deferred<WhatIfOut>()
    const fast = deferred<WhatIfOut>()
    mount()
    await openPanel()
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    vi.mocked(runWhatIf).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    fireEvent.click(addSale())
    fireEvent.click(addEsppSale())
    await act(async () => {
      fast.resolve(resultFixture({ delta: { ...resultFixture().delta, total_tax: '2222.22' } }))
    })
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$2,222.22')
    await act(async () => {
      slow.resolve(resultFixture({ delta: { ...resultFixture().delta, total_tax: '1111.11' } }))
    })
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$2,222.22')
  })

  it('surfaces a feed failure without pretending the book is empty, and retries it', async () => {
    vi.mocked(fetchHoldings).mockRejectedValueOnce(new ApiError('Network error', 0))
    mount()
    fireEvent.click(openButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Network error')
    expect(screen.queryByRole('button', { name: 'Add sale' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(addSale()).toBeTruthy())
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(2)
  })

  it('re-runs the URL’s scenario against the new year when the page remounts it', async () => {
    const { rerender } = mount('/taxes?whatif=sale%3A7%3A40')
    await waitFor(() => expect(lastBody()?.year).toBe(2024))
    rerender(
      <MemoryRouter initialEntries={['/taxes?whatif=sale%3A7%3A40']}>
        <WhatIfPanel key="whatif-2025" year={2025} />
        <Url />
      </MemoryRouter>,
    )
    await waitFor(() => expect(lastBody()).toEqual({ year: 2025, sales: [{ security_id: 7, shares: '40', term: 'long' }], espp_sales: [] }))
    expect(screen.getByRole('heading', { name: /What if — 2025/ })).toBeTruthy()
  })

  // --- legacy aliases (spec §6) -----------------------------------------------------------

  it('normalizes ?whatif=TICKER into a sale entry once the holdings land, in one replace', async () => {
    mount('/taxes?whatif=qqq&year=2024')
    expect(openButton().getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(url()).toBe('/taxes?year=2024&whatif=sale%3A9%3A10.0000'))
    await waitFor(() => expect(lastBody()?.sales).toEqual([{ security_id: 9, shares: '10.0000', term: 'long' }]))
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
  })

  it('normalizes ?whatif-lot=<id> into an espp entry at the lots quote, and drops a sold lot silently', async () => {
    mount('/taxes?whatif-lot=3')
    await waitFor(() => expect(url()).toBe('/taxes?whatif=espp%3A3%3A150.00000'))
    cleanup()
    vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
    vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
    mount('/taxes?whatif-lot=4')
    await waitFor(() => expect(addEsppSale()).toBeTruthy())
    // The alias rewrite rides the feeds' promise, and the hook coalesces the write into the
    // next commit, so the drop lands a tick after the form does.
    await waitFor(() => expect(url()).toBe('/taxes'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // --- input overrides (D1, design 2026-08-31) ---------------------------------------------

  const DEFS = [
    { key: 'annual_salary', label: 'Annual Salary' },
    { key: 'itemized_deduction', label: 'Itemized Deduction' },
  ]
  const addOverride = () => screen.getByRole('button', { name: 'Add override' }) as HTMLButtonElement

  it('adds an override row on the first unused key as a null entry, and posts canonical values on commit', async () => {
    mount('/taxes', { definitions: DEFS })
    await openPanel()
    fireEvent.click(addOverride())
    expect(url()).toBe('/taxes?whatif=annual_salary%3Anull')
    await waitFor(() => expect(lastBody()).toEqual({ year: 2024, sales: [], espp_sales: [], overrides: { annual_salary: null } }))
    const select = screen.getByLabelText('Override') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Annual Salary (annual_salary)',
      'Itemized Deduction (itemized_deduction)',
    ])
    fireEvent.focus(field('Override 1 value'))
    fireEvent.change(field('Override 1 value'), { target: { value: '$210,000' } })
    fireEvent.blur(field('Override 1 value'))
    expect(url()).toBe('/taxes?whatif=annual_salary%3A210000')
    await waitFor(() => expect(lastBody()?.overrides).toEqual({ annual_salary: '210000' }))
  })

  it('refuses a duplicated key and a garbled value in the box’s words, spending no request', async () => {
    mount('/taxes?whatif=annual_salary%3Anull&whatif=itemized_deduction%3Anull', { definitions: DEFS })
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getAllByLabelText('Override')[1], { target: { value: 'annual_salary' } })
    expect(screen.getByRole('alert').textContent).toContain('Annual Salary is overridden twice — one row per key')
    fireEvent.focus(field('Override 1 value'))
    fireEvent.change(field('Override 1 value'), { target: { value: '12..3' } })
    fireEvent.blur(field('Override 1 value'))
    expect(screen.getByRole('alert').textContent).toContain('Annual Salary: enter a number, or leave the value blank to clear it')
    expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1)
  })

  it('keeps Add override shut once every key is taken, and with no definitions at all', async () => {
    mount('/taxes', { definitions: DEFS })
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.click(addOverride())
    expect(addOverride().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove override 2' }))
    expect(addOverride().disabled).toBe(false)
    cleanup()
    vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
    vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
    mount()
    await openPanel()
    expect(addOverride().disabled).toBe(true)
  })

  // --- presets, pins, Apply ----------------------------------------------------------------

  it('presets write knobs immediately; missing data disables a chip with its sentence', async () => {
    mount('/taxes', { definitions: DEFS })
    await openPanel()
    await waitFor(() => expect(vi.mocked(fetchLimits)).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Max 401(k)' }))
    expect(url()).toBe('/taxes?whatif=trad_401k_contributions%3A23500.00')
    fireEvent.click(screen.getByRole('button', { name: 'Sell all VTI' }))
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000&whatif=trad_401k_contributions%3A23500.00')
    const qqq = screen.getByRole('button', { name: 'Sell all QQQ' }) as HTMLButtonElement
    expect(qqq.disabled).toBe(true)
    expect(qqq.title).toBe('No quote for QQQ — enter a price in Portfolio')
    const family = screen.getByRole('button', { name: 'Max HSA — family' }) as HTMLButtonElement
    expect(family.disabled).toBe(true)
    expect(family.title).toBe("Enter 2024's HSA family limit in Settings › Limits")
    expect((screen.getByRole('button', { name: 'Realize gains to the 15% ceiling' }) as HTMLButtonElement).title).toBe(
      "Enter 2024's capital-gains brackets first",
    )
  })

  it('pins the live scenario and shows it as a compare column; Reset empties the URL', async () => {
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await screen.findByText('Δ total tax')
    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))
    // Two doors offer it: the pin row's chip and the compare column's own header.
    expect(screen.getAllByRole('button', { name: 'Unpin Sell 100.0000 VTI' })).toHaveLength(2)
    await waitFor(() => expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Sell 100.0000 VTIUnpin'))
    expect(JSON.parse(localStorage.getItem('finance.sandbox.taxes') ?? '{}').pins[0].entries).toEqual(['sale:7:100.0000:62.50'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset to actual' }))
    expect(url()).toBe('/taxes')
    await waitFor(() => expect(lastBody()).toEqual({ year: 2024, sales: [], espp_sales: [] }))
  })

  it('Apply hands the overrides and the changed inputs up, and renders only with overrides present', async () => {
    const { onApplyOverrides } = mount('/taxes?whatif=sale%3A7%3A40', { definitions: DEFS })
    await screen.findByText('Δ total tax')
    expect(screen.queryByRole('button', { name: /^Apply \d+ override/ })).toBeNull()
    fireEvent.click(addOverride())
    fireEvent.focus(field('Override 1 value'))
    fireEvent.change(field('Override 1 value'), { target: { value: '210000' } })
    fireEvent.blur(field('Override 1 value'))
    await waitFor(() => expect(lastBody()?.overrides).toEqual({ annual_salary: '210000' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 override to 2024' }))
    expect(onApplyOverrides).toHaveBeenCalledWith({ annual_salary: '210000' }, resultFixture().changed_inputs)
  })
})
