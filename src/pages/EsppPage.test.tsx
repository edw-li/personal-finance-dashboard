import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type {
  EsppLotOut,
  EsppLotsResponse,
  EsppModelerOut,
  EsppModelerPeriod,
  EsppPeriodOut,
} from '../types/api'
import EsppPage from './EsppPage'

// Every request is stubbed; there is no chart on this page (the 25k gauge is a div), so
// no EChart mock is needed.
vi.mock('../api/espp', () => ({
  fetchLots: vi.fn(),
  createLot: vi.fn(),
  updateLot: vi.fn(),
  deleteLot: vi.fn(),
  fetchPeriods: vi.fn(),
  createPeriod: vi.fn(),
  updatePeriod: vi.fn(),
  deletePeriod: vi.fn(),
  fetchModeler: vi.fn(),
}))
import {
  createLot,
  createPeriod,
  deleteLot,
  deletePeriod,
  fetchLots,
  fetchModeler,
  fetchPeriods,
  updateLot,
  updatePeriod,
} from '../api/espp'

// --- fixtures -------------------------------------------------------------------------
// The two modeler periods and the priced lot are the sheet's own numbers (plan §Workbook
// reference, sanctioned for golden fixtures). The SOLD rows are invented: no real lot has
// ever been sold, and the badge branch still has to be pinned.

function lot(over: Partial<EsppLotOut> = {}): EsppLotOut {
  return {
    id: 1,
    purchase_date: '2024-02-29',
    qualifying_date: '2025-09-01',
    shares: '260.0000',
    subscription_price: '48.50900',
    purchase_fmv: '79.11200',
    purchase_price: '41.23265',
    sold_date: null,
    sold_price: null,
    notes: null,
    cost_basis: '10720.49',
    market_value: '44540.60',
    gain_amount: '33820.11',
    gain_pct: '3.154717',
    qualified: true,
    days_until_qualified: 0,
    is_sold: false,
    ...over,
  }
}

// Qualified (its qualifying date is behind us), a countdown row, and both sold branches.
const qualifiedLot = lot()
const countdownLot = lot({
  id: 4,
  purchase_date: '2025-08-29',
  qualifying_date: '2026-08-29',
  shares: '241.0000',
  purchase_fmv: '174.18000',
  cost_basis: '9937.07',
  market_value: '41285.71',
  gain_amount: '31348.64',
  qualified: false,
  days_until_qualified: 13,
})
const soldQualifiedLot = lot({
  id: 2,
  purchase_date: '2024-08-30',
  shares: '255.0000',
  sold_date: '2025-10-15',
  sold_price: '120.00000',
  cost_basis: '10514.33',
  market_value: '30600.00',
  gain_amount: '20085.67',
  gain_pct: '1.910315',
  qualified: true,
  days_until_qualified: null,
  is_sold: true,
})
const soldUnqualifiedLot = lot({
  id: 3,
  purchase_date: '2025-02-28',
  qualifying_date: '2026-02-28',
  shares: '274.0000',
  purchase_fmv: '124.80000',
  sold_date: '2025-11-03',
  sold_price: '110.00000',
  cost_basis: '11297.75',
  market_value: '30140.00',
  gain_amount: '18842.25',
  gain_pct: '1.667789',
  qualified: false,
  days_until_qualified: null,
  is_sold: true,
})

function lotsResponse(over: Partial<EsppLotsResponse> = {}): EsppLotsResponse {
  return {
    espp_ticker: 'NVDA',
    current_price: '171.3100',
    quoted_at: '2026-08-15T20:00:00Z',
    lots: [qualifiedLot, soldQualifiedLot, soldUnqualifiedLot, countdownLot],
    ...over,
  }
}

const febPeriod: EsppPeriodOut = {
  id: 1,
  label: 'Feb 2026',
  period_start: '2025-08-16',
  period_end: '2026-02-15',
  semi_annual_base: '81000.00',
  additional_payments: '0.00',
  contribution_pct: '0.140000000',
}
const augPeriod: EsppPeriodOut = {
  id: 2,
  label: 'Aug 2026',
  period_start: '2026-02-16',
  period_end: '2026-08-15',
  semi_annual_base: '94465.00',
  additional_payments: '0.00',
  contribution_pct: '0.110000000',
}

const febChain: EsppModelerPeriod = {
  ...febPeriod,
  eligible_earnings: '81000.00',
  contribution: '11340.00',
  available: '11340.00',
  purchase_price: '145.18',
  shares_before_limit: '78',
  unused_25k: '25000.00',
  max_shares_25k: '146',
  over_limit: false,
  shares: '78',
  cost: '11324.04',
  carry_forward_out: '15.96',
  refund: '0.00',
  value_25k: '13321.62',
}
const augChain: EsppModelerPeriod = {
  ...augPeriod,
  eligible_earnings: '94465.00',
  contribution: '10391.15',
  available: '10407.11',
  purchase_price: '145.18',
  shares_before_limit: '71',
  unused_25k: '11678.38',
  max_shares_25k: '68',
  over_limit: true,
  shares: '68',
  cost: '9872.24',
  carry_forward_out: '0.00',
  refund: '534.87',
  value_25k: '11613.72',
}

function modelerResponse(over: Partial<EsppModelerOut> = {}): EsppModelerOut {
  return {
    year: 2026,
    espp_ticker: 'NVDA',
    price_source: 'latest_price',
    quoted_at: '2026-08-15T20:00:00Z',
    // The echo is QUANTIZED, never the text that was sent: the prices come back at the
    // espp 5dp and the carry-forward at money's 2dp, exactly as the backend pins them
    // (backend/tests/test_espp_api.py, the golden chain — "170.79000" / "171.00000" /
    // "0.00"). The knobs seed from these strings, so the boxes show them verbatim.
    subscription_price: '170.79000',
    purchase_fmv: '171.00000',
    carry_forward: '0.00',
    periods: [febChain, augChain],
    totals: {
      total_25k_value: '24935.34',
      out_of_pocket_cost: '21196.28',
      fmv_of_shares: '24966.00',
      remaining_25k: '64.66',
    },
    ...over,
  }
}

// A totals block that is visibly not the fixture's, for the overlap tests below.
function totalsUsing(used: string): EsppModelerOut {
  return modelerResponse({
    totals: {
      total_25k_value: used,
      out_of_pocket_cost: '21196.28',
      fmv_of_shares: '24966.00',
      remaining_25k: '64.66',
    },
  })
}

// --- helpers --------------------------------------------------------------------------

// A promise this file settles by hand — the only way to hold two modeler runs in flight
// at once and choose which one answers first (TaxesPage.test.tsx's helper).
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } })

function fillNewLot() {
  type('Purchase date', '2026-02-27')
  type('Qualifying date', '2027-02-27')
  type('Shares', '100')
  type('Subscription', '150.00')
  type('FMV', '160.00')
}

function fillNewPeriod() {
  type('Label', 'Feb 2027')
  type('Period start', '2026-08-16')
  type('Period end', '2027-02-15')
  type('Semi-annual base', '99000')
  type('Contribution %', '11')
}

const confirmSpy = vi.spyOn(window, 'confirm')

// Every render goes through a router: each unsold lot row carries a "Model sale →" <Link>
// into the what-if card, and a Link has no meaning outside one.
const renderPage = () => render(<EsppPage />, { wrapper: MemoryRouter })

beforeEach(() => {
  vi.mocked(fetchLots).mockResolvedValue(lotsResponse())
  vi.mocked(fetchPeriods).mockResolvedValue([febPeriod, augPeriod])
  vi.mocked(fetchModeler).mockResolvedValue(modelerResponse())
  vi.mocked(createLot).mockResolvedValue(qualifiedLot)
  vi.mocked(updateLot).mockResolvedValue(qualifiedLot)
  vi.mocked(deleteLot).mockResolvedValue(undefined)
  vi.mocked(createPeriod).mockResolvedValue(febPeriod)
  vi.mocked(updatePeriod).mockResolvedValue(febPeriod)
  vi.mocked(deletePeriod).mockResolvedValue(undefined)
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EsppPage — lots', () => {
  it('renders server metrics, the quote header and every disposition badge', async () => {
    renderPage()

    // Server values, rendered — nothing is re-derived here.
    expect(await screen.findByText('$10,720.49')).toBeTruthy()
    expect(screen.getByText('$44,540.60')).toBeTruthy()
    expect(screen.getByText('$33,820.11')).toBeTruthy()
    // Both unsold lots were bought at the same 85% price, so they share a gain % — the
    // realized rows carry their own.
    expect(screen.getAllByText('+315.5%')).toHaveLength(2)
    expect(screen.getByText('+166.8%')).toBeTruthy()
    // Date-only rendering of the quote instant (Plan 4 note: the UI compares dates only,
    // and this line does not even do that — it just says when).
    expect(screen.getByText('NVDA · $171.31 · as of Aug 15, 2026')).toBeTruthy()

    expect(screen.getByText('Qualified')).toBeTruthy()
    expect(screen.getByText('Qualifying in 13 days')).toBeTruthy()
    expect(screen.getByText('Sold (qualified)')).toBeTruthy()
    expect(screen.getByText('Sold (unqualified)')).toBeTruthy()
  })

  it('links every UNSOLD lot into the what-if card, and never a sold one', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    // One per unsold row, each carrying its own lot id — the param TaxesPage reads to seed
    // an ESPP leg. The fixture holds two unsold lots (1 and 4) and two sold ones (2 and 3).
    const links = screen.getAllByRole('link', { name: 'Model sale →' })
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/taxes?whatif-lot=1',
      '/taxes?whatif-lot=4',
    ])

    // A sold lot 409s at the endpoint (a disposition cannot be modelled twice), so its row
    // is not offered the door at all — Edit and Delete are its whole action rank.
    const soldRow = screen.getByText('Sold (unqualified)').closest('tr') as HTMLTableRowElement
    expect(within(soldRow).queryByRole('link')).toBeNull()
    expect(within(soldRow).getByRole('button', { name: /^Edit lot/ })).toBeTruthy()
  })

  it('renders "—" for the market columns when the ticker link dangles', async () => {
    vi.mocked(fetchLots).mockResolvedValue(
      lotsResponse({
        current_price: null,
        quoted_at: null,
        lots: [
          lot({ market_value: null, gain_amount: null, gain_pct: null }),
        ],
      }),
    )
    renderPage()

    expect(await screen.findByText('$10,720.49')).toBeTruthy() // cost basis survives
    expect(screen.getByText('NVDA — no live quote; market values are unavailable.')).toBeTruthy()
    // price / market value / gain $ / gain %
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
  })

  it('omits purchase_price from the add-lot POST when the field is left blank', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))

    await waitFor(() => expect(vi.mocked(createLot)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(createLot).mock.calls[0][0]
    // The server derives 0.85 x min(sub, fmv) when the key is ABSENT — not when it is
    // present and empty (that 422s on Decimal('')).
    expect(Object.keys(body)).not.toContain('purchase_price')
    expect(body).toEqual({
      purchase_date: '2026-02-27',
      qualifying_date: '2027-02-27',
      shares: '100',
      subscription_price: '150.00',
      purchase_fmv: '160.00',
      notes: null,
    })
    // The table is reloaded so the derived price and the metrics arrive.
    await waitFor(() => expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(2))
  })

  it('sends a typed purchase price, and blanking it on an edit re-derives the default', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    type('Purchase price', '127.50')
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))
    await waitFor(() => expect(vi.mocked(createLot)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createLot).mock.calls[0][0].purchase_price).toBe('127.50')

    // Edit the qualified lot and clear its price: on PATCH an explicit null is the
    // documented re-derive (the one null the server does NOT treat as a no-op).
    fireEvent.click(screen.getByRole('button', { name: 'Edit lot from Feb 29, 2024' }))
    expect(field('Purchase price').value).toBe('41.23265')
    type('Purchase price', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save lot' }))

    await waitFor(() => expect(vi.mocked(updateLot)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateLot).mock.calls[0][0]).toBe(1)
    expect(vi.mocked(updateLot).mock.calls[0][1].purchase_price).toBeNull()
  })

  it('PATCHes the FULL lot row, and clears BOTH sold fields to un-sell one', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fireEvent.click(screen.getByRole('button', { name: 'Edit lot from Feb 29, 2024' }))
    type('Notes', 'ESPP Feb 2024')
    fireEvent.click(screen.getByRole('button', { name: 'Save lot' }))

    await waitFor(() => expect(vi.mocked(updateLot)).toHaveBeenCalledTimes(1))
    // Every column the form owns travels on every save (the periods panel's binding, and
    // the same reason: the row is validated MERGED, so a delta can 422 on a field this
    // form never touched).
    expect(vi.mocked(updateLot).mock.calls[0][1]).toEqual({
      purchase_date: '2024-02-29',
      qualifying_date: '2025-09-01',
      shares: '260.0000',
      subscription_price: '48.50900',
      purchase_fmv: '79.11200',
      purchase_price: '41.23265',
      sold_date: null,
      sold_price: null,
      notes: 'ESPP Feb 2024',
    })

    // Un-sell: blanking both boxes has to send an explicit null for EACH. An omitted key
    // is a no-op on PATCH, so a body that dropped them would leave the lot sold.
    fireEvent.click(screen.getByRole('button', { name: 'Edit lot from Aug 30, 2024' }))
    expect(field('Sold date').value).toBe('2025-10-15')
    expect(field('Sold price').value).toBe('120.00000')
    type('Sold date', '')
    type('Sold price', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save lot' }))

    await waitFor(() => expect(vi.mocked(updateLot)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(updateLot).mock.calls[1][0]).toBe(2)
    const body = vi.mocked(updateLot).mock.calls[1][1]
    expect(Object.keys(body)).toContain('sold_date')
    expect(Object.keys(body)).toContain('sold_price')
    expect(body).toEqual({
      purchase_date: '2024-08-30',
      qualifying_date: '2025-09-01',
      shares: '255.0000',
      subscription_price: '48.50900',
      purchase_fmv: '79.11200',
      purchase_price: '41.23265',
      sold_date: null,
      sold_price: null,
      notes: null,
    })
  })

  it('answers a qualifying date behind the purchase date before it reaches the server', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    type('Qualifying date', '2026-02-26') // one day BEFORE the purchase
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))

    // The server's own sentence: it is date-phrased, so it reads as written on screen.
    expect(
      await screen.findByText('qualifying_date must be on or after purchase_date'),
    ).toBeTruthy()
    expect(vi.mocked(createLot)).not.toHaveBeenCalled()
  })

  it('refuses a half-filled sold pair before it reaches the server', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    type('Sold date', '2026-06-01')
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))

    // The server's own sentence — one vocabulary (BracketsEditor's rule).
    expect(
      await screen.findByText('sold_date and sold_price must be set together'),
    ).toBeTruthy()
    expect(vi.mocked(createLot)).not.toHaveBeenCalled()
  })

  it('deletes a lot only after the confirm is accepted', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete lot from Feb 29, 2024' }))
    expect(vi.mocked(deleteLot)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete lot from Feb 29, 2024' }))
    await waitFor(() => expect(vi.mocked(deleteLot)).toHaveBeenCalledWith(1))
    await waitFor(() => expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(2))
  })

  it('renders a lot 409 verbatim and keeps the typed row', async () => {
    vi.mocked(createLot).mockRejectedValue(
      new ApiError('an espp lot for 2026-02-27 already exists', 409),
    )
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))

    expect(await screen.findByText('an espp lot for 2026-02-27 already exists')).toBeTruthy()
    expect(field('Shares').value).toBe('100')
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('offers a retry when the lots load fails', async () => {
    vi.mocked(fetchLots).mockRejectedValueOnce(new ApiError('lots unavailable', 503))
    renderPage()

    // No stale cue on a FIRST load: there is no table on screen to be behind.
    expect(await screen.findByText('lots unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading lots' }))
    expect(await screen.findByText('$10,720.49')).toBeTruthy()
    expect(screen.queryByText('lots unavailable')).toBeNull()
  })

  it('says the table may be behind when a RELOAD fails, and keeps the rows', async () => {
    vi.mocked(fetchLots)
      .mockResolvedValueOnce(lotsResponse())
      .mockRejectedValueOnce(new ApiError('lots unavailable', 503))
    renderPage()
    await screen.findByText('$10,720.49')

    type('Notes', 'half-typed lot')
    fireEvent.click(screen.getByRole('button', { name: 'Delete lot from Feb 29, 2024' }))
    await waitFor(() => expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(2))

    expect(
      await screen.findByText('lots unavailable — the table may be showing earlier data.'),
    ).toBeTruthy()
    // ...and it IS still showing them, half-typed row and all.
    expect(screen.getByText('$10,720.49')).toBeTruthy()
    expect(field('Notes').value).toBe('half-typed lot')
  })
})

describe('EsppPage — modeler', () => {
  it('renders the chain, the provenance line and the $25k gauge', async () => {
    renderPage()
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledWith({}))

    expect(await screen.findByText('using latest NVDA quote (as of Aug 15, 2026)')).toBeTruthy()

    // Per-period chain (server values).
    expect(screen.getByText('$11,324.04')).toBeTruthy()
    expect(screen.getByText('$534.87')).toBeTruthy()
    expect(screen.getByText('$13,321.62')).toBeTruthy()
    expect(screen.getByText('$11,613.72')).toBeTruthy()
    // Only the August period breaches the limit.
    expect(screen.getAllByText('Over limit')).toHaveLength(1)

    // The gauge: 24935.34 / 25000 = 99.74%, and "remaining" is the SERVER's number.
    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('24935.34')
    expect(meter.getAttribute('aria-valuemin')).toBe('0')
    expect(meter.getAttribute('aria-valuemax')).toBe('25000')
    const fill = meter.querySelector('.gauge-fill') as HTMLElement
    expect(fill.style.width).toBe('99.74%')
    expect(screen.getByText('$24,935.34 used')).toBeTruthy()
    expect(screen.getByText('$64.66 left')).toBeTruthy()
  })

  it('recalculates with the typed knobs', async () => {
    renderPage()
    await screen.findByText('using latest NVDA quote (as of Aug 15, 2026)')

    // The knobs seed from the response echo — the server's QUANTIZED strings, not the
    // "170.79" that was sent (5dp prices, 2dp carry-forward).
    expect(field('Subscription price').value).toBe('170.79000')
    expect(field('Purchase FMV').value).toBe('171.00000')
    expect(field('Carry-forward').value).toBe('0.00')

    type('Carry-forward', '25')
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))

    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    // The seeded boxes go back out exactly as they came in: a re-run with an untouched
    // knob is the same query, and the server re-quantizes its own output to itself.
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '170.79000',
      purchaseFmv: '171.00000',
      carryForward: '25',
    })
    // The lots table is a sibling component: a modeler refetch never touches it.
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('passes blank knobs through for the client to omit (falling back to the quote)', async () => {
    renderPage()
    await screen.findByText('using latest NVDA quote (as of Aug 15, 2026)')

    type('Subscription price', '')
    type('Purchase FMV', '')
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))

    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '',
      purchaseFmv: '',
      carryForward: '0.00',
    })
  })

  it('never lets the echo seed overwrite a knob typed while the first load is in flight', async () => {
    // A promise this test settles by hand: the knobs are on screen for the WHOLE of the
    // first load, so the seed has to lose to anything typed into them meanwhile.
    let resolve!: (value: EsppModelerOut) => void
    vi.mocked(fetchModeler).mockReturnValue(
      new Promise<EsppModelerOut>((res) => {
        resolve = res
      }),
    )
    renderPage()
    await screen.findByText('$10,720.49')

    type('Subscription price', '200')
    resolve(modelerResponse())

    await waitFor(() => expect(screen.getByRole('meter')).toBeTruthy())
    expect(field('Subscription price').value).toBe('200')
    // The untouched knobs still take the echo.
    expect(field('Purchase FMV').value).toBe('171.00000')
    expect(field('Carry-forward').value).toBe('0.00')
  })

  it('lets only the NEWEST of two overlapping runs land', async () => {
    const slow = deferred<EsppModelerOut>()
    const fast = deferred<EsppModelerOut>()
    vi.mocked(fetchModeler)
      .mockResolvedValueOnce(modelerResponse()) // the mount
      .mockReturnValueOnce(slow.promise) // the Recalculate
      .mockReturnValueOnce(fast.promise) // the period delete's re-run
    renderPage()
    await screen.findByText('$24,935.34 used')

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    // The Recalculate button is disabled while it is busy, so the SECOND run comes from
    // the other thing that re-runs the chain: a period changing under it.
    fireEvent.click(screen.getByRole('button', { name: 'Delete period Aug 2026' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(3))

    fast.resolve(totalsUsing('22222.22'))
    expect(await screen.findByText('$22,222.22 used')).toBeTruthy()

    await act(async () => {
      slow.resolve(totalsUsing('11111.11'))
    })
    // The older run answers LAST and must not roll the gauge back to the periods it was
    // asked about — the seq ref, not the network, decides which chain is on screen.
    expect(screen.queryByText('$11,111.11 used')).toBeNull()
    expect(screen.getByText('$22,222.22 used')).toBeTruthy()
  })

  it('drops a model failure that a newer run has already outlived', async () => {
    const stale = deferred<EsppModelerOut>()
    vi.mocked(fetchModeler)
      .mockResolvedValueOnce(modelerResponse()) // the mount
      .mockReturnValueOnce(stale.promise) // the Recalculate
      .mockResolvedValueOnce(totalsUsing('22222.22')) // the period delete's re-run
    renderPage()
    await screen.findByText('$24,935.34 used')

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Delete period Aug 2026' }))
    expect(await screen.findByText('$22,222.22 used')).toBeTruthy()

    await act(async () => {
      stale.reject(new ApiError('model unavailable', 500))
    })
    // A failure only drops the chain it was asked about. This one is a run behind, so the
    // fresh chain stays and no banner appears for a question nobody is still asking.
    expect(screen.queryByText('model unavailable')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('meter')).toBeTruthy()
    expect(screen.getByText('$22,222.22 used')).toBeTruthy()
  })

  it('says "custom prices" when both prices came from the query', async () => {
    vi.mocked(fetchModeler).mockResolvedValue(
      modelerResponse({ price_source: 'params', quoted_at: null }),
    )
    renderPage()

    expect(await screen.findByText('custom prices')).toBeTruthy()
    expect(screen.queryByText(/using latest/)).toBeNull()
  })

  it('shows an empty state pointing at the periods section when the modeler 404s', async () => {
    vi.mocked(fetchModeler).mockRejectedValue(new ApiError('no espp periods', 404))
    vi.mocked(fetchPeriods).mockResolvedValue([])
    renderPage()

    expect(
      await screen.findByText('no espp periods — add one below to run the $25,000 model.'),
    ).toBeTruthy()
    // No knobs to turn, and no half-drawn gauge.
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recalculate' })).toBeNull()
    // Error isolation: the lots table is a separate load and is untouched.
    expect(screen.getByText('$10,720.49')).toBeTruthy()
  })

  it('never renders the 404 sentence as "null" while the first period is being modeled', async () => {
    const pending = deferred<EsppModelerOut>()
    vi.mocked(fetchModeler)
      .mockRejectedValueOnce(new ApiError('no espp periods', 404))
      .mockReturnValueOnce(pending.promise)
    vi.mocked(fetchPeriods).mockResolvedValue([])
    renderPage()
    await screen.findByText('no espp periods — add one below to run the $25,000 model.')

    fillNewPeriod()
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))

    // The empty state renders `modelerError` as prose, so "missing" is cleared with it:
    // the re-run the new period just caused shows the card, never "null — add one below".
    expect(screen.queryByText(/null/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Modeling…' })).toBeTruthy()

    await act(async () => {
      pending.resolve(modelerResponse())
    })
    expect(screen.getByRole('meter')).toBeTruthy()
    // First success of the page, so this is also where the knobs finally seed.
    expect(field('Subscription price').value).toBe('170.79000')
  })

  it('keeps the lots table (and its typed row) when the modeler 422s', async () => {
    vi.mocked(fetchModeler).mockRejectedValue(
      new ApiError('no live price for NVDA; pass subscription_price and purchase_fmv', 422),
    )
    renderPage()

    expect(
      await screen.findByText(
        'no live price for NVDA; pass subscription_price and purchase_fmv',
      ),
    ).toBeTruthy()
    expect(screen.getByText('$10,720.49')).toBeTruthy()
    // The knobs stay on screen: typing prices into them IS the way out of this 422.
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeTruthy()
  })

  it('does not remount the lots panel when the modeler reloads', async () => {
    renderPage()
    await screen.findByText('using latest NVDA quote (as of Aug 15, 2026)')

    type('Notes', 'half-typed lot')
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))

    expect(field('Notes').value).toBe('half-typed lot')
  })
})

describe('EsppPage — periods', () => {
  it('lists the stored periods with the contribution shown as a percent', async () => {
    renderPage()

    // Via the row action, not the label cell: the modeler's mini-table names the same
    // periods, and only these buttons belong to this section alone.
    expect(await screen.findByRole('button', { name: 'Edit period Feb 2026' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit period Aug 2026' })).toBeTruthy()
    expect(screen.getByText('14.0%')).toBeTruthy()
    expect(screen.getByText('11.0%')).toBeTruthy()
    expect(screen.getByText('$81,000.00')).toBeTruthy()
  })

  it('posts a new period with the percent converted to a fraction, then refetches the model', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    fillNewPeriod()
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))

    await waitFor(() => expect(vi.mocked(createPeriod)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createPeriod).mock.calls[0][0]).toEqual({
      label: 'Feb 2027',
      period_start: '2026-08-16',
      period_end: '2027-02-15',
      semi_annual_base: '99000',
      additional_payments: '0',
      // Shifted, not divided: 11 / 100 is 0.11000000000000001 in binary.
      contribution_pct: '0.11',
    })
    // The chain is a function of the periods, so it is refetched with the current knobs.
    await waitFor(() => expect(vi.mocked(fetchPeriods)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '170.79000',
      purchaseFmv: '171.00000',
      carryForward: '0.00',
    })
  })

  it('edits a period with the full row shape and the pct shifted back', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit period Feb 2026' }))
    // 0.140000000 comes back as "14", not 14.000000000000002.
    expect(field('Contribution %').value).toBe('14')
    type('Contribution %', '12.5')
    fireEvent.click(screen.getByRole('button', { name: 'Save period' }))

    await waitFor(() => expect(vi.mocked(updatePeriod)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updatePeriod).mock.calls[0][0]).toBe(1)
    // A FULL row (Task 4 review M6's binding): whole-row validation 422s a delta PATCH
    // against any stored field the form never touched.
    expect(vi.mocked(updatePeriod).mock.calls[0][1]).toEqual({
      label: 'Feb 2026',
      period_start: '2025-08-16',
      period_end: '2026-02-15',
      semi_annual_base: '81000.00',
      additional_payments: '0.00',
      contribution_pct: '0.125',
    })
  })

  it('answers a period that does not end after it starts before it reaches the server', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    fillNewPeriod()
    type('Period end', '2026-08-16') // the same day as the start — "after", not "on"
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))

    expect(await screen.findByText('period_end must be after period_start')).toBeTruthy()
    expect(vi.mocked(createPeriod)).not.toHaveBeenCalled()
  })

  it('bounds the contribution in the box’s own vocabulary, not the fraction’s', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    fillNewPeriod()
    type('Contribution %', '140') // 14% typed as a fraction's worth of percent
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))

    // NOT the server's "contribution_pct must be between 0 and 1": this box is labelled
    // "Contribution %" and holds 14 for 14%, so the stored fraction's sentence would call
    // a perfectly good 14 out of range and let a 0.5 (half a percent) through unremarked.
    expect(await screen.findByText('contribution % must be between 0 and 100')).toBeTruthy()
    expect(vi.mocked(createPeriod)).not.toHaveBeenCalled()

    // The guard is a range, not a suspicion: the whole 100 is a legal contribution.
    type('Contribution %', '100')
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))
    await waitFor(() => expect(vi.mocked(createPeriod)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createPeriod).mock.calls[0][0].contribution_pct).toBe('1')
  })

  it('refuses exponent notation in the contribution box, client-side', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    fillNewPeriod()
    type('Contribution %', '1e-3')
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))

    // Not a case the server rescues: shiftPoint hands "1e-3" back untouched and
    // Decimal("1e-3") is a perfectly legal 0.001, so a box that said a thousandth of a
    // percent would be stored as a tenth of one, with no 422 on the round trip.
    expect(await screen.findByText('contribution % must be a number')).toBeTruthy()
    expect(vi.mocked(createPeriod)).not.toHaveBeenCalled()

    // The same digits as a plain decimal are converted, not refused.
    type('Contribution %', '0.001')
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))
    await waitFor(() => expect(vi.mocked(createPeriod)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createPeriod).mock.calls[0][0].contribution_pct).toBe('0.00001')
  })

  it('deletes a period after a confirm and refetches the model', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete period Aug 2026' }))
    await waitFor(() => expect(vi.mocked(deletePeriod)).toHaveBeenCalledWith(2))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('renders a period 409 verbatim', async () => {
    vi.mocked(createPeriod).mockRejectedValue(
      new ApiError("espp period 'Feb 2026' already exists", 409),
    )
    renderPage()
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    fillNewPeriod()
    type('Label', 'Feb 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))

    expect(await screen.findByText("espp period 'Feb 2026' already exists")).toBeTruthy()
    expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(1)
  })
})
