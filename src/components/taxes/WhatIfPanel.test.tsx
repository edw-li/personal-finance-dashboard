import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type {
  EsppLotOut,
  EsppLotsResponse,
  HoldingOut,
  HoldingsResponse,
  TaxSummaryOut,
  WhatIfOut,
} from '../../types/api'
import WhatIfPanel from './WhatIfPanel'

// Every request this panel makes is stubbed — the three modules it owns end to end.
vi.mock('../../api/whatif', () => ({ runWhatIf: vi.fn() }))
vi.mock('../../api/portfolio', () => ({ fetchHoldings: vi.fn() }))
vi.mock('../../api/espp', () => ({ fetchLots: vi.fn() }))
import { fetchLots } from '../../api/espp'
import { fetchHoldings } from '../../api/portfolio'
import { runWhatIf } from '../../api/whatif'

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

// Anchored: "Run what-if" is a button too.
const openButton = () =>
  screen.getByRole('button', { name: /^(Open|Close) what-if$/ }) as HTMLButtonElement
const runButton = () => screen.getByRole('button', { name: /Run what-if|Running/ }) as HTMLButtonElement
const addSale = () => screen.getByRole('button', { name: 'Add sale' }) as HTMLButtonElement
const addEsppSale = () => screen.getByRole('button', { name: 'Add ESPP sale' }) as HTMLButtonElement
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

// A tile is found by its LABEL, then read for the two things the contract is about: the
// figure and the delta line's tone/glyph.
function tile(label: string): HTMLElement {
  const node = screen.getByText(label).closest('.stat-tile')
  if (node === null) throw new Error(`no stat tile labelled ${label}`)
  return node as HTMLElement
}

// Opens the card and waits for both feeds to land.
async function openPanel() {
  fireEvent.click(openButton())
  await waitFor(() => expect(addSale()).toBeTruthy())
}

beforeEach(() => {
  vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
  vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
  vi.mocked(runWhatIf).mockResolvedValue(resultFixture())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WhatIfPanel', () => {
  it('mounts CLOSED and spends no request until it is opened', () => {
    render(<WhatIfPanel year={2024} />)
    const toggle = openButton()
    expect(toggle.textContent).toBe('Open what-if')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // The whole point of the lazy feeds: the page is long and this card may never be used.
    expect(vi.mocked(fetchHoldings)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchLots)).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Add sale' })).toBeNull()
  })

  it('loads BOTH feeds on first open, and only once across a close/reopen', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()

    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
    expect(openButton().getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(openButton())
    expect(screen.queryByRole('button', { name: 'Add sale' })).toBeNull()
    fireEvent.click(openButton())
    await waitFor(() => expect(addSale()).toBeTruthy())
    // Reopening re-reads nothing: the ref, not the state, is what says "already fetched".
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('prefills Add sale from the first held security, then moves to the next one', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()

    fireEvent.click(addSale())
    // The whole position at the latest quote, verbatim from the holdings feed.
    expect((screen.getByLabelText('Sell') as HTMLSelectElement).value).toBe('7')
    expect(field('Sale 1 shares').value).toBe('100.0000')
    expect(field('Sale 1 price').value).toBe('62.50')
    const term = screen.getByRole('group', { name: 'Sale 1 term' })
    expect(within(term).getByRole('button', { name: 'Long' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    fireEvent.click(addSale())
    // The second row is the next security NOT already in a leg — two rows for one ticker
    // would sell the same shares twice without ever tripping the oversell fence. QQQ is
    // unpriced, so its price prefills blank (the omit case).
    expect(field('Sale 2 shares').value).toBe('10.0000')
    expect(field('Sale 2 price').value).toBe('')
    // Both held securities are now in legs, so there is nothing left to add.
    expect(addSale().disabled).toBe(true)
  })

  it('posts exactly what was typed, with a blank price OMITTED from the body', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.change(field('Sale 1 shares'), { target: { value: '40' } })
    fireEvent.change(field('Sale 1 price'), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Sale 1 term' })).getByRole('button', {
      name: 'Short',
    }))
    fireEvent.click(runButton())

    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({
      year: 2024,
      sales: [{ security_id: 7, shares: '40', term: 'short' }],
      espp_sales: [],
    })
    // Not `price: ''` and not `price: undefined`: the KEY's absence is what asks the server
    // for the security's latest quote (the blank-omit convention).
    const body = vi.mocked(runWhatIf).mock.calls[0][0]
    expect('price' in body.sales[0]).toBe(false)
  })

  it('prefills an ESPP leg from the first unsold lot and ships its sale price', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addEsppSale())

    // Labelled by purchase date + shares; the SOLD lot is not offered at all.
    const select = screen.getByLabelText('ESPP lot') as HTMLSelectElement
    expect(select.value).toBe('3')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Feb 28, 2026 — 30 sh',
    ])
    // Prefilled from the quote the lots table itself was priced at.
    expect(field('ESPP sale 1 price').value).toBe('150.00000')

    fireEvent.click(runButton())
    await waitFor(() =>
      expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({
        year: 2024,
        sales: [],
        espp_sales: [{ lot_id: 3, sale_price: '150.00000' }],
      }),
    )
  })

  it('refuses an oversell in the box’s own vocabulary, before spending a request', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.change(field('Sale 1 shares'), { target: { value: '200' } })
    fireEvent.click(runButton())

    // The server's own oversell sentence — one vocabulary, no round trip.
    expect(screen.getByRole('alert').textContent).toContain('selling 200 VTI — only 100.0000 held')
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()

    fireEvent.change(field('Sale 1 shares'), { target: { value: '0' } })
    fireEvent.click(runButton())
    expect(screen.getByRole('alert').textContent).toContain(
      'VTI: shares must be a number greater than 0',
    )
    fireEvent.change(field('Sale 1 shares'), { target: { value: '10' } })
    fireEvent.change(field('Sale 1 price'), { target: { value: '-5' } })
    fireEvent.click(runButton())
    expect(screen.getByRole('alert').textContent).toContain(
      'VTI: price must be a number greater than 0, or blank',
    )
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()
  })

  it('keeps Run shut until there is a leg to run', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    expect(runButton().disabled).toBe(true)
    fireEvent.click(addSale())
    expect(runButton().disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove sale 1' }))
    expect(runButton().disabled).toBe(true)
  })

  it('renders the delta tiles and the changed inputs exactly as they arrived', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.click(runButton())
    await waitFor(() => expect(screen.getByText('Δ total tax')).toBeTruthy())

    // The endpoint's own subtraction of two quantized summaries, formatted and nothing else.
    const tax = tile('Δ total tax')
    expect(tax.querySelector('.stat-value')?.textContent).toBe('$4,321.00')
    // MORE tax is a WORSE outcome: the glyph follows the NUMBER (up) while the colour
    // follows good/bad (negative) — the inversion StatTile's contract asks for explicitly.
    const taxDelta = tax.querySelector('.stat-delta')
    expect(taxDelta?.className).toContain('stat-delta-negative')
    expect(taxDelta?.textContent).toContain('▲')
    expect(taxDelta?.textContent).toContain('more tax than 2024 as stored')

    const takeHome = tile('Δ take-home')
    expect(takeHome.querySelector('.stat-value')?.textContent).toBe('-$4,321.00')
    expect(takeHome.querySelector('.stat-delta')?.className).toContain('stat-delta-negative')
    expect(takeHome.querySelector('.stat-delta')?.textContent).toContain(
      '$376,543.22 → $372,222.22',
    )

    // A rate is a level, not a movement: both sides of it, from the two summaries.
    expect(tile('Effective rate').querySelector('.stat-value')?.textContent).toBe('24.7% → 28.1%')

    // "{label} — {before} → {after}": the label is the definition table's own text and
    // carries a colon of its own, so the separator is an em dash — a second colon here
    // would double-punctuate every capital-gains row.
    expect(
      screen.getByText('LTCG: Brokerage Gain/Loss — $12,000.00 → $30,500.00'),
    ).toBeTruthy()
    // The per-leg table, server figures verbatim.
    expect(screen.getByText('$1,250.00')).toBeTruthy()
  })

  it('puts the server sentence in a role=alert and drops the stale scenario with it', async () => {
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.click(runButton())
    await waitFor(() => expect(screen.getByText('Δ total tax')).toBeTruthy())

    vi.mocked(runWhatIf).mockRejectedValueOnce(new ApiError('unknown input key: nope', 422))
    fireEvent.click(runButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('unknown input key: nope')
    // The answer is a function of the legs; leaving the last one up would read as the
    // answer for the ones now in the form.
    expect(screen.queryByText('Δ total tax')).toBeNull()
  })

  it('renders scenario warnings in the advisory register, never as an error', async () => {
    vi.mocked(runWhatIf).mockResolvedValue(
      resultFixture({
        warnings: ['VTI: acquisition dates unknown — treated as long-term'],
      }),
    )
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.click(runButton())

    const warning = await screen.findByText('VTI: acquisition dates unknown — treated as long-term')
    // The scenario RAN: an amber advisory, not a banner (the engine's own register).
    expect(warning.closest('.tax-warnings')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets only the NEWEST of two overlapping runs land', async () => {
    const slow = deferred<WhatIfOut>()
    const fast = deferred<WhatIfOut>()
    vi.mocked(runWhatIf).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addSale())

    fireEvent.click(runButton())
    fireEvent.click(runButton())
    expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(2)

    await act(async () => {
      fast.resolve(resultFixture({ delta: { ...resultFixture().delta, total_tax: '2222.22' } }))
    })
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$2,222.22')

    await act(async () => {
      slow.resolve(resultFixture({ delta: { ...resultFixture().delta, total_tax: '1111.11' } }))
    })
    // The older run answers LAST and must not replace the newer scenario on screen — the
    // seq ref, not the network, decides which answer belongs to the legs in the form.
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$2,222.22')
  })

  it('drops a failure that a newer run has already outlived', async () => {
    const stale = deferred<WhatIfOut>()
    vi.mocked(runWhatIf)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(resultFixture())
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    fireEvent.click(addSale())

    fireEvent.click(runButton())
    fireEvent.click(runButton())
    await waitFor(() => expect(screen.getByText('Δ total tax')).toBeTruthy())

    await act(async () => {
      stale.reject(new ApiError('scenario unavailable', 500))
    })
    // A failure only drops the run it was asked about; this one is a run behind.
    expect(screen.queryByText('scenario unavailable')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Δ total tax')).toBeTruthy()
  })

  it('surfaces a feed failure without pretending the book is empty, and retries it', async () => {
    vi.mocked(fetchHoldings).mockRejectedValueOnce(new ApiError('Network error', 0))
    render(<WhatIfPanel year={2024} />)
    fireEvent.click(openButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Network error')
    // No form of empty selects under the banner: with no feed there is nothing to sell.
    expect(screen.queryByRole('button', { name: 'Add sale' })).toBeNull()

    // The feeds are fetched once per MOUNT, so the banner owns the only second chance.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(addSale()).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(2)
  })

  it('starts over when the page remounts it under a new year', async () => {
    const { rerender } = render(<WhatIfPanel key="whatif-2024" year={2024} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.click(runButton())
    await waitFor(() => expect(screen.getByText('Δ total tax')).toBeTruthy())

    // The page keys this panel by year: a switch is a REMOUNT, so the legs and the scenario
    // go with the year they were run against (a stale scenario under a new year's heading
    // would lie), and the card is closed again with its feeds unspent.
    rerender(<WhatIfPanel key="whatif-2025" year={2025} />)
    expect(screen.queryByText('Δ total tax')).toBeNull()
    expect(screen.getByRole('heading', { name: 'What if — 2025' })).toBeTruthy()
    expect(openButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('auto-opens and seeds one leg when a deep link named a ticker', async () => {
    render(<WhatIfPanel year={2024} initialTicker="qqq" />)

    // Open on arrival, feeds loaded, and the NAMED holding (case-insensitively) prefilled.
    await waitFor(() => expect(field('Sale 1 shares').value).toBe('10.0000'))
    expect(openButton().getAttribute('aria-expanded')).toBe('true')
    expect((screen.getByLabelText('Sell') as HTMLSelectElement).value).toBe('9')
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
  })

  it('auto-opens and seeds the named UNSOLD lot, and ignores one that is sold', async () => {
    const { unmount } = render(<WhatIfPanel year={2024} initialLotId={3} />)
    await waitFor(() => expect(field('ESPP sale 1 price').value).toBe('150.00000'))
    expect((screen.getByLabelText('ESPP lot') as HTMLSelectElement).value).toBe('3')
    unmount()

    // Lot 4 is sold: the card still opens, but seeds nothing — the honest answer for a link
    // whose lot has been disposed of since it was made.
    render(<WhatIfPanel year={2024} initialLotId={4} />)
    await waitFor(() => expect(addEsppSale()).toBeTruthy())
    expect(screen.queryByLabelText('ESPP lot')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // --- input overrides (D1, design 2026-08-31) -------------------------------------------

  const DEFS = [
    { key: 'annual_salary', label: 'Annual Salary' },
    { key: 'itemized_deduction', label: 'Itemized Deduction' },
  ]
  const addOverride = () =>
    screen.getByRole('button', { name: 'Add override' }) as HTMLButtonElement

  it('adds an override row on the first unused key and posts canonical values', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())

    // Label + key, from the definitions the page handed down.
    const select = screen.getByLabelText('Override') as HTMLSelectElement
    expect(select.value).toBe('annual_salary')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Annual Salary (annual_salary)',
      'Itemized Deduction (itemized_deduction)',
    ])

    // Run is open with ONLY an override leg — a scenario needs no sale to mean something.
    expect(runButton().disabled).toBe(false)
    fireEvent.change(field('Override 1 value'), { target: { value: '$210,000' } })
    fireEvent.click(runButton())

    // Canonical at the wire (the InputsForm boundary), and the two sale lists stay [].
    await waitFor(() =>
      expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({
        year: 2024,
        sales: [],
        espp_sales: [],
        overrides: { annual_salary: '210000' },
      }),
    )
  })

  it('sends null for a blank value — the clear-this-input case', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.click(runButton())

    await waitFor(() =>
      expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({
        year: 2024,
        sales: [],
        espp_sales: [],
        overrides: { annual_salary: null },
      }),
    )
  })

  it('omits the overrides key entirely when no override rows exist', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.click(runButton())

    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    // The pre-override wire, byte-identical — the exact-body pins above depend on it.
    expect('overrides' in vi.mocked(runWhatIf).mock.calls[0][0]).toBe(false)
  })

  it('refuses a duplicated key in the box’s own vocabulary, before spending a request', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride()) // annual_salary
    fireEvent.click(addOverride()) // itemized_deduction
    // Point the second row at the first row's key.
    fireEvent.change(screen.getAllByLabelText('Override')[1], {
      target: { value: 'annual_salary' },
    })
    fireEvent.click(runButton())

    expect(screen.getByRole('alert').textContent).toContain(
      'Annual Salary is overridden twice — one row per key',
    )
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()
  })

  it('refuses a garbled value and names the row by its label', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.change(field('Override 1 value'), { target: { value: '12..3' } })
    fireEvent.click(runButton())

    expect(screen.getByRole('alert').textContent).toContain(
      'Annual Salary: enter a number, or leave the value blank to clear it',
    )
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()
  })

  it('keeps Add override shut once every key is taken, and with no definitions at all', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.click(addOverride())
    expect(addOverride().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove override 2' }))
    expect(addOverride().disabled).toBe(false)
    cleanup()

    vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
    vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    expect(addOverride().disabled).toBe(true)
  })
})
