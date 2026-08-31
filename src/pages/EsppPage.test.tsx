import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type {
  EsppLotOut,
  EsppLotsResponse,
  EsppModelerOut,
  EsppModelerPeriod,
  EsppOfferingOut,
  EsppPeriodOut,
} from '../types/api'
import { clearSnapshots, getSnapshot, setSnapshot } from '../api/snapshotCache'
import EsppPage from './EsppPage'

// Every request is stubbed; there is no chart on this page (the 25k gauge is a div), so
// no EChart mock is needed.
vi.mock('../api/espp', () => ({
  fetchLots: vi.fn(),
  createLot: vi.fn(),
  updateLot: vi.fn(),
  deleteLot: vi.fn(),
  fetchOfferings: vi.fn(),
  createOffering: vi.fn(),
  updateOffering: vi.fn(),
  deleteOffering: vi.fn(),
  createPeriod: vi.fn(),
  updatePeriod: vi.fn(),
  deletePeriod: vi.fn(),
  fetchModeler: vi.fn(),
}))
// The offerings panel's "use close" chip reads the employer's daily bars — one lazy call
// off the lots payload's ticker.
vi.mock('../api/prices', () => ({
  fetchPriceHistory: vi.fn(),
}))
import {
  createLot,
  createOffering,
  createPeriod,
  deleteLot,
  deleteOffering,
  deletePeriod,
  fetchLots,
  fetchModeler,
  fetchOfferings,
  updateLot,
  updateOffering,
  updatePeriod,
} from '../api/espp'
import { fetchPriceHistory } from '../api/prices'

// --- fixtures -------------------------------------------------------------------------
// The priced lot is the sheet's own numbers (plan §Workbook reference, sanctioned for
// golden fixtures). The SOLD rows are invented: no real lot has ever been sold, and the
// badge branch still has to be pinned.

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

// The 2023 enrollment: one offering covering both 2024 periods, at the 5dp price the
// lots carry.
const septOffering: EsppOfferingOut = {
  id: 1,
  offering_start: '2023-09-01',
  subscription_price: '48.50900',
  notes: null,
}

// The STORED half of the 2024 plan — what the modeler's PATCH path writes back.
const storedPeriod: EsppPeriodOut = {
  id: 1,
  label: '1H24',
  period_start: '2023-09-01',
  period_end: '2024-02-29',
  semi_annual_base: '60000.00',
  additional_payments: '0.00',
  contribution_pct: '0.140000000',
}

// Two rows, one of each kind: a stored period and the derived slot-filler that finishes
// the year (id null, stored false — it materializes only when its cells are saved).
const storedRow: EsppModelerPeriod = {
  ...storedPeriod,
  stored: true,
  subscription_price: '48.50900',
  offering_start: '2023-09-01',
  eligible_earnings: '60000.00',
  contribution: '8400.00',
  available: '8400.00',
  purchase_price: '41.23265',
  shares_before_limit: '203',
  unused_25k: '25000.00',
  max_shares_25k: '515',
  over_limit: false,
  shares: '203',
  cost: '8370.22',
  carry_forward_out: '29.78',
  refund: '0.00',
  value_25k: '9847.00',
}
const derivedRow: EsppModelerPeriod = {
  id: null,
  stored: false,
  label: 'Mar–Aug 2024',
  period_start: '2024-03-01',
  period_end: '2024-08-30',
  semi_annual_base: '60000.00',
  additional_payments: '0.00',
  contribution_pct: '0.140000000',
  subscription_price: '48.50900',
  offering_start: '2023-09-01',
  eligible_earnings: '60000.00',
  contribution: '8412.00',
  available: '8441.78',
  purchase_price: '41.50000',
  shares_before_limit: '203',
  unused_25k: '15153.00',
  max_shares_25k: '187',
  over_limit: true,
  shares: '187',
  cost: '7760.50',
  carry_forward_out: '0.00',
  refund: '681.28',
  value_25k: '9070.13',
}

function modelerResponse(over: Partial<EsppModelerOut> = {}): EsppModelerOut {
  return {
    year: 2024,
    espp_ticker: 'NVDA',
    // Legacy field, stale-tab armor only — the UI reads the two source fields below.
    price_source: 'latest_price',
    subscription_source: 'offering',
    fmv_source: 'latest_price',
    quoted_at: '2026-08-15T20:00:00Z',
    // null: nothing was overridden, so there is no echo — and the knob boxes are never
    // seeded from it anyway (spec §6.2).
    subscription_price: null,
    purchase_fmv: '171.00000',
    carry_forward: '0.00',
    available_years: [2024, 2025],
    warnings: [],
    periods: [storedRow, derivedRow],
    totals: {
      total_25k_value: '18917.13',
      out_of_pocket_cost: '16130.72',
      fmv_of_shares: '19200.00',
      remaining_25k: '6082.87',
    },
    ...over,
  }
}

// A totals block that is visibly not the fixture's, for the overlap tests below.
function totalsUsing(used: string): EsppModelerOut {
  return modelerResponse({
    totals: {
      total_25k_value: used,
      out_of_pocket_cost: '16130.72',
      fmv_of_shares: '19200.00',
      remaining_25k: '6082.87',
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

// "Subscription price" labels BOTH the offerings form and the modeler knob, so the two
// cards are addressed by their own headings and everything inside is scoped with `within`.
const cardFor = (heading: RegExp) =>
  screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement
const offeringsCard = () => cardFor(/Subscription offerings/)
const modelerCard = () => cardFor(/Purchase modeler/)
// A modeler row, found through the one label only it carries.
const rowFor = (label: string) =>
  screen.getByLabelText(`${label} semi-annual base`).closest('tr') as HTMLTableRowElement

function fillNewLot() {
  type('Purchase date', '2026-02-27')
  type('Qualifying date', '2027-02-27')
  type('Shares', '100')
  type('Subscription', '150.00')
  type('FMV', '160.00')
}

const confirmSpy = vi.spyOn(window, 'confirm')

// Every render goes through a router: each unsold lot row carries a "Model sale →" <Link>
// into the what-if card, and a Link has no meaning outside one.
const renderPage = () => render(<EsppPage />, { wrapper: MemoryRouter })

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchLots).mockResolvedValue(lotsResponse())
  vi.mocked(fetchOfferings).mockResolvedValue([septOffering])
  vi.mocked(fetchModeler).mockResolvedValue(modelerResponse())
  vi.mocked(fetchPriceHistory).mockResolvedValue({
    ticker: 'NVDA',
    points: [{ d: '2023-09-01', c: '48.509' }],
  })
  vi.mocked(createLot).mockResolvedValue(qualifiedLot)
  vi.mocked(updateLot).mockResolvedValue(qualifiedLot)
  vi.mocked(deleteLot).mockResolvedValue(undefined)
  vi.mocked(createOffering).mockResolvedValue(septOffering)
  vi.mocked(updateOffering).mockResolvedValue(septOffering)
  vi.mocked(deleteOffering).mockResolvedValue(undefined)
  vi.mocked(createPeriod).mockResolvedValue(storedPeriod)
  vi.mocked(updatePeriod).mockResolvedValue(storedPeriod)
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

  it('puts the caret back on the purchase date after a save', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))

    await waitFor(() => expect(vi.mocked(createLot)).toHaveBeenCalledTimes(1))
    // Spec §5.1: the emptied form's FIRST box takes the caret, so the next lot off the
    // statement is typed rather than clicked into — without it focus strands on Add lot.
    await waitFor(() => expect(document.activeElement).toBe(field('Purchase date')))
    expect(field('Purchase date').value).toBe('')
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
    // kind="plain" over a Numeric(14,5): the stored 5dp string stands as it arrived, where
    // a money echo would have rounded it on screen to "$41.23".
    expect(field('Purchase price').value).toBe('41.23265')
    type('Purchase price', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save lot' }))

    await waitFor(() => expect(vi.mocked(updateLot)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateLot).mock.calls[0][0]).toBe(1)
    expect(vi.mocked(updateLot).mock.calls[0][1].purchase_price).toBeNull()
  })

  it('canonicalizes a lot price at the wire boundary, with no blur', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    type('Subscription', '$85.50')
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))

    await waitFor(() => expect(vi.mocked(createLot)).toHaveBeenCalledTimes(1))
    // Typed and clicked, never blurred: the belt at submit()'s trim site, not AmountInput's
    // blur commit, is what keeps a "$" out of a Decimal column.
    expect(vi.mocked(createLot).mock.calls[0][0].subscription_price).toBe('85.50')
  })

  it('leaves an =-expression in a lot price verbatim, flagged, for the server to refuse', async () => {
    renderPage()
    await screen.findByText('$10,720.49')

    fillNewLot()
    const box = field('Subscription')
    fireEvent.change(box, { target: { value: '=1/8' } })
    fireEvent.blur(box)
    // THE kind-scale rule: subscription_price is Numeric(14,5) and the evaluator quantizes
    // to 2dp, so an eighth would commit as 0.13. The box is therefore kind="plain" — it
    // neither evaluates the entry nor rewrites it on blur, shows it verbatim (no money echo
    // to round a 5dp column into a lie), and marks it invalid for the user to see.
    expect(box.value).toBe('=1/8')
    expect(box.getAttribute('aria-invalid')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))
    await waitFor(() => expect(vi.mocked(createLot)).toHaveBeenCalledTimes(1))
    // LotsPanel gates presence only, so the text still travels — and 422s server-side
    // exactly as 'abc' typed into the same box does today. What the belt's
    // { expressions: false } guarantees is that no number nobody typed is invented on the
    // way out (TransactionsPanel's pin, one decimal place further out).
    expect(vi.mocked(createLot).mock.calls[0][0].subscription_price).toBe('=1/8')
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

  it('prefills subscription and qualifying date on purchase-date entry', async () => {
    renderPage()
    await screen.findByText('$10,720.49')
    // The offerings feed is what the prefill reads — wait for it to have landed.
    await waitFor(() => expect(vi.mocked(fetchOfferings)).toHaveBeenCalledTimes(1))

    type('Purchase date', '2024-02-29')

    // The covering offering's price, verbatim at 5dp (kind="plain", no money echo).
    expect(field('Subscription').value).toBe('48.50900')
    // §423: the later of offering start + 2y (2025-09-01) and purchase + 1y (2025-02-28).
    expect(field('Qualifying date').value).toBe('2025-09-01')

    // Prefill, not authority: an edited box is never re-written by a second date change.
    type('Subscription', '50')
    type('Purchase date', '2024-03-01')
    expect(field('Subscription').value).toBe('50')
    expect(field('Qualifying date').value).toBe('2025-09-01')
  })

  it('prefills NEITHER box when no offering covers the purchase date', async () => {
    renderPage()
    await screen.findByText('$10,720.49')
    await waitFor(() => expect(vi.mocked(fetchOfferings)).toHaveBeenCalledTimes(1))

    // Before the earliest enrollment (2023-09-01), so nothing covers it — and spec §6.4 is
    // "no covering offering → no prefill", for the qualifying date too. purchase + 1y alone
    // is only the §423 LOWER bound, so filling it here would hand the user an optimistically
    // early date computed as if it were the answer.
    type('Purchase date', '2023-01-15')

    expect(field('Subscription').value).toBe('')
    expect(field('Qualifying date').value).toBe('')
  })
})

describe('EsppPage — offerings', () => {
  it('renders the three sections in order: lots, offerings, modeler', async () => {
    renderPage()
    const lots = await screen.findByRole('heading', { name: /^Lots/ })
    const offerings = screen.getByRole('heading', { name: /Subscription offerings/ })
    const modeler = screen.getByRole('heading', { name: /Purchase modeler/ })

    // Offerings sit BETWEEN the lots and the modeler they price (spec §5).
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(lots.compareDocumentPosition(offerings) & following).toBeTruthy()
    expect(offerings.compareDocumentPosition(modeler) & following).toBeTruthy()
  })

  it('lists each offering with its coverage window', async () => {
    vi.mocked(fetchOfferings).mockResolvedValue([
      septOffering,
      { id: 2, offering_start: '2025-09-02', subscription_price: '167.02000', notes: 'reset' },
    ])
    renderPage()
    await screen.findByRole('button', { name: 'Edit offering from Sep 1, 2023' })
    const card = offeringsCard()

    // 5dp prices, verbatim — never a 2dp currency echo over a Numeric(14,5) column.
    expect(within(card).getByText('48.50900')).toBeTruthy()
    expect(within(card).getByText('167.02000')).toBeTruthy()
    // The first offering is closed by the next one; the last runs its two years out.
    expect(within(card).getByText('→ Sep 2, 2025')).toBeTruthy()
    expect(within(card).getByText('through Sep 2, 2027')).toBeTruthy()
  })

  it('offers the close-on-date chip and applies it only on click', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { name: /Subscription offerings/ })
    const card = heading.closest('section') as HTMLElement
    fireEvent.change(within(card).getByLabelText('Offering start'), {
      target: { value: '2023-09-01' },
    })
    const chip = await within(card).findByText(/close on/)
    expect(chip.textContent).toContain('48.509')
    const priceBox = within(card).getByLabelText('Subscription price') as HTMLInputElement
    expect(priceBox.value).toBe('') // never auto-applied
    fireEvent.click(within(card).getByRole('button', { name: /Use the/ }))
    expect(priceBox.value).toBe('48.509')
  })

  it('never asks for bars without an employer ticker, and offers no chip', async () => {
    vi.mocked(fetchLots).mockResolvedValue(lotsResponse({ espp_ticker: null }))
    renderPage()
    // The bars are a LAZY call off the lots payload's ticker, so wait for that payload.
    await screen.findByText(
      'No ESPP ticker configured — set the espp_ticker setting to price these lots.',
    )
    const card = offeringsCard()

    // No ticker named, nothing to ask for: the chip's whole source is that one call.
    expect(vi.mocked(fetchPriceHistory)).not.toHaveBeenCalled()
    fireEvent.change(within(card).getByLabelText('Offering start'), {
      target: { value: '2023-09-01' },
    })
    expect(within(card).queryByText(/close on/)).toBeNull()
  })

  it('offers no chip when every bar is AFTER the typed start date', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /Subscription offerings/ })
    await waitFor(() => expect(vi.mocked(fetchPriceHistory)).toHaveBeenCalledTimes(1))
    const card = offeringsCard()

    // The suggestion is the last close ON OR BEFORE the date, and the fixture's only bar is
    // the day AFTER — so there is nothing to suggest, and no later bar is offered in its
    // place (a close from after the enrollment is not the price that enrollment fixed).
    fireEvent.change(within(card).getByLabelText('Offering start'), {
      target: { value: '2023-08-31' },
    })
    expect(within(card).queryByText(/close on/)).toBeNull()
  })

  it('posts a canonical price, returns the caret to the start date and re-runs the model', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /Subscription offerings/ })
    const section = offeringsCard()

    fireEvent.change(within(section).getByLabelText('Offering start'), {
      target: { value: '2025-09-02' },
    })
    fireEvent.change(within(section).getByLabelText('Subscription price'), {
      target: { value: '$167.02' },
    })
    fireEvent.change(within(section).getByLabelText('Offering notes'), {
      target: { value: 'reset' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add offering' }))

    await waitFor(() => expect(vi.mocked(createOffering)).toHaveBeenCalledTimes(1))
    // Typed and clicked, never blurred: the belt at submit()'s read site is what keeps a
    // "$" out of a Decimal column.
    expect(vi.mocked(createOffering).mock.calls[0][0]).toEqual({
      offering_start: '2025-09-02',
      subscription_price: '167.02',
      notes: 'reset',
    })
    // Spec §5.1: focus lands on the emptied form's first box, and it is emptied AFTER.
    await waitFor(() =>
      expect(document.activeElement).toBe(within(section).getByLabelText('Offering start')),
    )
    expect((within(section).getByLabelText('Offering start') as HTMLInputElement).value).toBe('')
    // An offering re-prices every period after it, so the chain is re-run.
    await waitFor(() => expect(vi.mocked(fetchOfferings)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
  })

  it('edits an offering through PATCH and deletes one after a confirm', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Edit offering from Sep 1, 2023' })
    const section = offeringsCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit offering from Sep 1, 2023' }))
    const priceBox = within(section).getByLabelText('Subscription price') as HTMLInputElement
    expect(priceBox.value).toBe('48.50900')
    fireEvent.change(priceBox, { target: { value: '48.51' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save offering' }))

    await waitFor(() => expect(vi.mocked(updateOffering)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateOffering).mock.calls[0][0]).toBe(1)
    expect(vi.mocked(updateOffering).mock.calls[0][1]).toEqual({
      offering_start: '2023-09-01',
      subscription_price: '48.51',
      notes: null,
    })

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete offering from Sep 1, 2023' }))
    expect(vi.mocked(deleteOffering)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete offering from Sep 1, 2023' }))
    await waitFor(() => expect(vi.mocked(deleteOffering)).toHaveBeenCalledWith(1))
  })

  it('renders an offering 409 verbatim', async () => {
    vi.mocked(createOffering).mockRejectedValue(
      new ApiError('an espp offering starting 2023-09-01 already exists', 409),
    )
    renderPage()
    await screen.findByRole('heading', { name: /Subscription offerings/ })
    const section = offeringsCard()

    fireEvent.change(within(section).getByLabelText('Offering start'), {
      target: { value: '2023-09-01' },
    })
    fireEvent.change(within(section).getByLabelText('Subscription price'), {
      target: { value: '48.50900' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add offering' }))

    expect(
      await screen.findByText('an espp offering starting 2023-09-01 already exists'),
    ).toBeTruthy()
    // The typed row survives its own rejection.
    expect(
      (within(section).getByLabelText('Subscription price') as HTMLInputElement).value,
    ).toBe('48.50900')
  })
})

describe('EsppPage — modeler', () => {
  it('surfaces the $25k figure at the page top, above the lots (2026-08-31 audit)', async () => {
    renderPage()
    const tile = await screen.findByText(/\$25k limit used — 2024/)
    const lots = screen.getByRole('heading', { name: /Lots/ })
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(tile.compareDocumentPosition(lots) & following).toBeTruthy()

    // The modeler payload's own figures, verbatim — used and remaining. Scoped to the
    // strip's own tile: the gauge in the card below says "$6,082.87 left" too, and the
    // whole point is that the two never disagree.
    const strip = within(tile.closest('.stat-tile') as HTMLElement)
    expect(strip.getByText('$18,917.13')).toBeTruthy()
    expect(strip.getByText('$6,082.87 left')).toBeTruthy()
  })

  it('renders the chain, the provenance line and the $25k gauge', async () => {
    renderPage()
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledWith({}))

    // Blank knobs resolved to the offerings + the latest quote, and the line says so.
    expect(
      await screen.findByText(
        'subscription from your offerings · FMV from the latest quote (as of Aug 15, 2026)',
      ),
    ).toBeTruthy()

    // Per-period chain (server values), and the derived row's own badge.
    expect(screen.getByText('$8,370.22')).toBeTruthy()
    expect(screen.getByText('$9,847.00')).toBeTruthy()
    expect(screen.getByText('$681.28')).toBeTruthy()
    expect(screen.getByText('$9,070.13')).toBeTruthy()
    expect(screen.getByText('derived')).toBeTruthy()
    // Only the second period breaches the limit.
    expect(screen.getAllByText('Over limit')).toHaveLength(1)

    // The gauge: 18917.13 / 25000 = 75.67%, and "remaining" is the SERVER's number.
    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('18917.13')
    expect(meter.getAttribute('aria-valuemin')).toBe('0')
    expect(meter.getAttribute('aria-valuemax')).toBe('25000')
    const fill = meter.querySelector('.gauge-fill') as HTMLElement
    expect(fill.style.width).toBe('75.67%')
    expect(screen.getByText('$18,917.13 used')).toBeTruthy()
    // Scoped to the card: the page-top strip's delta is the same "$6,082.87 left" string
    // (2026-08-31 audit) — deliberately, since both draw the one payload.
    expect(within(modelerCard()).getByText('$6,082.87 left')).toBeTruthy()
  })

  it('does not seed the knob boxes from the modeler echo', async () => {
    vi.mocked(fetchModeler).mockResolvedValue(
      // Even with an echo to seed FROM, the boxes stay empty: blank IS the smart default,
      // and a seeded box would pin next year's run to this year's prices (spec §6.2).
      modelerResponse({ subscription_price: '48.50900', carry_forward: '125.00' }),
    )
    renderPage()
    await screen.findByRole('meter')
    const card = modelerCard()

    expect((within(card).getByLabelText('Subscription price') as HTMLInputElement).value).toBe('')
    expect((within(card).getByLabelText('Purchase FMV') as HTMLInputElement).value).toBe('')
    expect((within(card).getByLabelText('Carry-forward') as HTMLInputElement).value).toBe('')
  })

  it('shows per-row subscription provenance', async () => {
    renderPage()
    await screen.findByRole('meter')
    const row = rowFor('1H24')

    // The 5dp price the row was chained at, verbatim, and which offering set it.
    expect(within(row).getByText('48.50900')).toBeTruthy()
    expect(within(row).getByText('Sep 1, 2023 offering')).toBeTruthy()
    expect(within(row).getByText('Sep 1, 2023 – Feb 29, 2024')).toBeTruthy()
  })

  it('saves a dirty stored row through updatePeriod and re-runs the model', async () => {
    renderPage()
    const base = await screen.findByLabelText('1H24 semi-annual base')
    fireEvent.change(base, { target: { value: '65000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
    await waitFor(() =>
      expect(updatePeriod).toHaveBeenCalledWith(1, {
        label: '1H24',
        period_start: '2023-09-01',
        period_end: '2024-02-29',
        semi_annual_base: '65000',
        additional_payments: '0.00',
        contribution_pct: '0.14', // "14" at human scale, shifted back to the stored fraction
      }),
    )
    // Save success re-runs the model; blank knobs stay omitted from the params.
    await waitFor(() => expect(vi.mocked(fetchModeler).mock.calls.length).toBeGreaterThan(1))
    expect(vi.mocked(createPeriod)).not.toHaveBeenCalled()
  })

  it('materializes a derived row through createPeriod with its derived label and dates', async () => {
    renderPage()
    const pct = await screen.findByLabelText('Mar–Aug 2024 contribution percent')
    fireEvent.change(pct, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
    await waitFor(() =>
      expect(createPeriod).toHaveBeenCalledWith({
        label: 'Mar–Aug 2024',
        period_start: '2024-03-01',
        period_end: '2024-08-30',
        semi_annual_base: '60000.00',
        additional_payments: '0.00',
        contribution_pct: '0.15',
      }),
    )
    // Only the touched row is written — the stored one was never dirty.
    expect(vi.mocked(updatePeriod)).not.toHaveBeenCalled()
  })

  it('says the chain is stale while a cell is dirty, and stops once it is saved', async () => {
    renderPage()
    const base = await screen.findByLabelText('1H24 semi-annual base')
    // Nothing is dirty on arrival, so nothing claims to be stale.
    expect(screen.queryByText(/unsaved edits/)).toBeNull()

    fireEvent.change(base, { target: { value: '65000' } })
    expect(
      screen.getByText(
        '1 period has unsaved edits — the chain below is stale until you save & recalculate.',
      ),
    ).toBeTruthy()
    // The chain columns are NOT recomputed behind the note — they stay the server's.
    expect(screen.getByText('$8,370.22')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
    await waitFor(() => expect(vi.mocked(updatePeriod)).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(/unsaved edits/)).toBeNull())
  })

  it('leaves an untouched table alone and just re-runs the chain', async () => {
    renderPage()
    await screen.findByRole('meter')

    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(updatePeriod)).not.toHaveBeenCalled()
    expect(vi.mocked(createPeriod)).not.toHaveBeenCalled()
  })

  it('recalculates with the typed knobs, omitting the blank ones', async () => {
    renderPage()
    await screen.findByRole('meter')

    fireEvent.change(within(modelerCard()).getByLabelText('Carry-forward'), {
      target: { value: '25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))

    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    // The blanks travel as '' and the client drops them (src/api/espp.ts) — that IS the
    // offerings-drive-the-price path.
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '',
      purchaseFmv: '',
      carryForward: '25',
    })
    // The lots table is a sibling component: a modeler refetch never touches it.
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('year chips call the modeler with the picked year', async () => {
    renderPage()
    await screen.findByRole('meter')

    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '',
      purchaseFmv: '',
      carryForward: '',
      year: 2025,
    })
  })

  it('reset deletes a stored row after confirm and re-runs', async () => {
    renderPage()
    await screen.findByRole('meter')

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reset 1H24 to derived values' }))
    expect(vi.mocked(deletePeriod)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset 1H24 to derived values' }))
    await waitFor(() => expect(vi.mocked(deletePeriod)).toHaveBeenCalledWith(1))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    // A derived row has nothing stored to delete, so it is offered no Reset at all.
    expect(
      screen.queryByRole('button', { name: 'Reset Mar–Aug 2024 to derived values' }),
    ).toBeNull()
  })

  it('bounds the contribution in the box’s own vocabulary, not the fraction’s', async () => {
    renderPage()
    const pct = await screen.findByLabelText('1H24 contribution percent')

    fireEvent.change(pct, { target: { value: '140' } }) // 14% typed as a fraction's worth
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))

    // NOT the server's "contribution_pct must be between 0 and 1": this box holds 14 for
    // 14%, so the stored fraction's sentence would call a good 14 out of range.
    expect(
      await screen.findByText('1H24: contribution % must be between 0 and 100'),
    ).toBeTruthy()
    expect(vi.mocked(updatePeriod)).not.toHaveBeenCalled()

    // The guard is a range, not a suspicion: the whole 100 is a legal contribution.
    fireEvent.change(pct, { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
    await waitFor(() => expect(vi.mocked(updatePeriod)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updatePeriod).mock.calls[0][1].contribution_pct).toBe('1')
  })

  it('renders a period save 409 verbatim, and keeps the edit', async () => {
    vi.mocked(updatePeriod).mockRejectedValue(
      new ApiError("espp period '1H24' already exists", 409),
    )
    renderPage()
    const base = await screen.findByLabelText('1H24 semi-annual base')
    fireEvent.change(base, { target: { value: '65000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))

    expect(await screen.findByText("espp period '1H24' already exists")).toBeTruthy()
    // The typed cell stands — the edits are NOT cleared on a failure, so the retry writes
    // what the user is still looking at, and the row still reads as dirty.
    expect((screen.getByLabelText('1H24 semi-annual base') as HTMLInputElement).value).toBe(
      '$65,000.00',
    )
    expect(screen.getByText(/1 period has unsaved edits/)).toBeTruthy()
    // ONE reconcile refetch, and no more: a failure re-reads the server rather than trusting
    // the table, because a sibling write in the same batch may have landed (see the partial
    // save test below). The chain that comes back is the server's, not the typed one.
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(screen.getByText('$8,370.22')).toBeTruthy()
  })

  it('refetches to reconcile the ids when only PART of a multi-row save lands', async () => {
    // The stored row's PATCH fails; the derived row's POST (the default mock) succeeds.
    vi.mocked(updatePeriod).mockRejectedValueOnce(
      new ApiError('espp period 1H24 could not be saved', 500),
    )
    renderPage()
    const storedBase = await screen.findByLabelText('1H24 semi-annual base')
    fireEvent.change(storedBase, { target: { value: '65000' } })
    fireEvent.change(screen.getByLabelText('Mar–Aug 2024 semi-annual base'), {
      target: { value: '61000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))

    // The failure is the server's own sentence, verbatim...
    expect(await screen.findByText('espp period 1H24 could not be saved')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(createPeriod)).toHaveBeenCalledTimes(1))
    // ...but Promise.all only rejects on the FIRST failure: that POST still materialized a
    // period, and the row on screen still says `id: null`. Without this refetch the next
    // save POSTs the same label again and 409s forever.
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    // The failed row keeps its typed text for the retry (keyed by the id it already has).
    expect((screen.getByLabelText('1H24 semi-annual base') as HTMLInputElement).value).toBe(
      '$65,000.00',
    )
  })

  it('names an overridden subscription price in the provenance, year and row', async () => {
    renderPage()
    await screen.findByRole('meter')
    // The NEXT run is the overridden one: a knob price wins for every period, so the server
    // answers with no covering offering on any row.
    vi.mocked(fetchModeler).mockResolvedValueOnce(
      modelerResponse({
        subscription_source: 'override',
        subscription_price: '55',
        periods: [
          { ...storedRow, subscription_price: '55.00000', offering_start: null },
          { ...derivedRow, subscription_price: '55.00000', offering_start: null },
        ],
      }),
    )

    fireEvent.change(within(modelerCard()).getByLabelText('Subscription price'), {
      target: { value: '55' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))

    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '55',
      purchaseFmv: '',
      carryForward: '',
    })
    // The year's line names the override; the FMV half still resolved to the quote.
    expect(
      await screen.findByText(
        'custom subscription price · FMV from the latest quote (as of Aug 15, 2026)',
      ),
    ).toBeTruthy()
    // And per row: offering_start is null, so the sub-line has to say WHICH null this is —
    // the knob, not the "latest quote" fallback a row without an offering otherwise gets.
    expect(within(rowFor('1H24')).getByText('override')).toBeTruthy()
    expect(within(rowFor('1H24')).getByText('55.00000')).toBeTruthy()
  })

  it('renders server warnings in the advisory register, not as an error', async () => {
    vi.mocked(fetchModeler).mockResolvedValue(
      modelerResponse({
        subscription_source: 'mixed',
        warnings: ['no offering covers Mar–Aug 2024; used the latest NVDA quote'],
      }),
    )
    renderPage()

    const warning = await screen.findByText(
      'no offering covers Mar–Aug 2024; used the latest NVDA quote',
    )
    expect(warning.className).toContain('espp-warning')
    // Advisory, not a failure: no banner, and the chain is on screen.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('meter')).toBeTruthy()
    expect(
      screen.getByText(
        'subscription mixed — offerings where they cover, latest quote elsewhere · FMV from the latest quote (as of Aug 15, 2026)',
      ),
    ).toBeTruthy()
  })

  it('lets only the NEWEST of two overlapping runs land', async () => {
    const slow = deferred<EsppModelerOut>()
    const fast = deferred<EsppModelerOut>()
    vi.mocked(fetchModeler)
      .mockResolvedValueOnce(modelerResponse()) // the mount
      .mockReturnValueOnce(slow.promise) // the 2025 chip
      .mockReturnValueOnce(fast.promise) // the 2024 chip
    renderPage()
    await screen.findByText('$18,917.13 used')

    // The primary is disabled while a run is in flight; the year chips are not, so they
    // are what puts two runs on the wire at once.
    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '2024' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(3))

    fast.resolve(totalsUsing('22222.22'))
    expect(await screen.findByText('$22,222.22 used')).toBeTruthy()

    await act(async () => {
      slow.resolve(totalsUsing('11111.11'))
    })
    // The older run answers LAST and must not roll the gauge back to the year it was asked
    // about — the seq ref, not the network, decides which chain is on screen.
    expect(screen.queryByText('$11,111.11 used')).toBeNull()
    expect(screen.getByText('$22,222.22 used')).toBeTruthy()
  })

  it('drops a model failure that a newer run has already outlived', async () => {
    const stale = deferred<EsppModelerOut>()
    vi.mocked(fetchModeler)
      .mockResolvedValueOnce(modelerResponse()) // the mount
      .mockReturnValueOnce(stale.promise) // the 2025 chip
      .mockResolvedValueOnce(totalsUsing('22222.22')) // the 2024 chip
    renderPage()
    await screen.findByText('$18,917.13 used')

    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '2024' }))
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

  it('keeps the lots table (and the knobs) when the modeler 422s', async () => {
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
    expect(screen.getByRole('button', { name: 'Save & recalculate' })).toBeTruthy()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('does not remount the lots panel when the modeler reloads', async () => {
    renderPage()
    await screen.findByRole('meter')

    type('Notes', 'half-typed lot')
    fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))

    expect(field('Notes').value).toBe('half-typed lot')
  })
})

describe('EsppPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints the lots table instantly from a seeded snapshot and still revalidates', () => {
    setSnapshot('espp:lots', lotsResponse())
    // Never-resolving fetch: whatever is on screen came from the seed alone.
    vi.mocked(fetchLots).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('NVDA · $171.31 · as of Aug 15, 2026')).toBeTruthy()
    expect(screen.getByText('$10,720.49')).toBeTruthy()
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('seeds offerings and the DEFAULT modeler run from their own keys', () => {
    setSnapshot('espp:offerings', [septOffering])
    setSnapshot('espp:modeler:default', modelerResponse())
    vi.mocked(fetchOfferings).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchModeler).mockReturnValue(new Promise(() => {}))
    renderPage()
    // The offering row and the modeler's chain are both up before either request answers.
    expect(screen.getByText('Sep 1, 2023')).toBeTruthy()
    expect(screen.getByText('$18,917.13 used')).toBeTruthy()
    // The mount run asks for the default (no params) and caches under the default key.
    expect(vi.mocked(fetchModeler)).toHaveBeenCalledWith({})
  })

  it('arms the employer bars on a resolution even when the payload is unchanged', async () => {
    setSnapshot('espp:lots', lotsResponse())
    renderPage()
    // The bars trigger sits BEFORE the equality skip, so the ticker's history is still
    // fetched on a byte-identical revalidation.
    await waitFor(() => expect(fetchPriceHistory).toHaveBeenCalledWith('NVDA', 3650))
  })

  it('a changed revalidation payload updates the lots table', async () => {
    setSnapshot('espp:lots', lotsResponse())
    vi.mocked(fetchLots).mockResolvedValue(lotsResponse({ current_price: '200.0000' }))
    renderPage()
    expect(screen.getByText('NVDA · $171.31 · as of Aug 15, 2026')).toBeTruthy()
    expect(await screen.findByText('NVDA · $200.00 · as of Aug 15, 2026')).toBeTruthy()
  })

  it('never caches a parameterized modeler run under the default key', async () => {
    renderPage()
    await screen.findByText('$18,917.13 used')
    const cachedDefault = getSnapshot<EsppModelerOut>('espp:modeler:default')
    expect(cachedDefault).toEqual(modelerResponse())
    // A year chip is a parameterized run: it lands on screen but never in the cache.
    vi.mocked(fetchModeler).mockResolvedValue(totalsUsing('22222.22'))
    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    expect(await screen.findByText('$22,222.22 used')).toBeTruthy()
    expect(getSnapshot<EsppModelerOut>('espp:modeler:default')).toEqual(cachedDefault)
  })
})
