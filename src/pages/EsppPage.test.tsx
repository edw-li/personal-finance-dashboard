import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    subscription_price: '170.79',
    purchase_fmv: '171',
    carry_forward: '0',
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

// --- helpers --------------------------------------------------------------------------

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

const confirmSpy = vi.spyOn(window, 'confirm')

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
    render(<EsppPage />)

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
    render(<EsppPage />)

    expect(await screen.findByText('$10,720.49')).toBeTruthy() // cost basis survives
    expect(screen.getByText('NVDA — no live quote; market values are unavailable.')).toBeTruthy()
    // price / market value / gain $ / gain %
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
  })

  it('omits purchase_price from the add-lot POST when the field is left blank', async () => {
    render(<EsppPage />)
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
    render(<EsppPage />)
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

  it('refuses a half-filled sold pair before it reaches the server', async () => {
    render(<EsppPage />)
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
    render(<EsppPage />)
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
    render(<EsppPage />)
    await screen.findByText('$10,720.49')

    fillNewLot()
    fireEvent.click(screen.getByRole('button', { name: 'Add lot' }))

    expect(await screen.findByText('an espp lot for 2026-02-27 already exists')).toBeTruthy()
    expect(field('Shares').value).toBe('100')
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('offers a retry when the lots load fails', async () => {
    vi.mocked(fetchLots).mockRejectedValueOnce(new ApiError('lots unavailable', 503))
    render(<EsppPage />)

    expect(await screen.findByText('lots unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading lots' }))
    expect(await screen.findByText('$10,720.49')).toBeTruthy()
    expect(screen.queryByText('lots unavailable')).toBeNull()
  })
})

describe('EsppPage — modeler', () => {
  it('renders the chain, the provenance line and the $25k gauge', async () => {
    render(<EsppPage />)
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
    render(<EsppPage />)
    await screen.findByText('using latest NVDA quote (as of Aug 15, 2026)')

    // The knobs seed from the response echo.
    expect(field('Subscription price').value).toBe('170.79')
    expect(field('Purchase FMV').value).toBe('171')
    expect(field('Carry-forward').value).toBe('0')

    type('Carry-forward', '25')
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))

    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '170.79',
      purchaseFmv: '171',
      carryForward: '25',
    })
    // The lots table is a sibling component: a modeler refetch never touches it.
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
  })

  it('passes blank knobs through for the client to omit (falling back to the quote)', async () => {
    render(<EsppPage />)
    await screen.findByText('using latest NVDA quote (as of Aug 15, 2026)')

    type('Subscription price', '')
    type('Purchase FMV', '')
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))

    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchModeler).mock.calls[1][0]).toEqual({
      subscriptionPrice: '',
      purchaseFmv: '',
      carryForward: '0',
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
    render(<EsppPage />)
    await screen.findByText('$10,720.49')

    type('Subscription price', '200')
    resolve(modelerResponse())

    await waitFor(() => expect(screen.getByRole('meter')).toBeTruthy())
    expect(field('Subscription price').value).toBe('200')
    // The untouched knobs still take the echo.
    expect(field('Purchase FMV').value).toBe('171')
  })

  it('says "custom prices" when both prices came from the query', async () => {
    vi.mocked(fetchModeler).mockResolvedValue(
      modelerResponse({ price_source: 'params', quoted_at: null }),
    )
    render(<EsppPage />)

    expect(await screen.findByText('custom prices')).toBeTruthy()
    expect(screen.queryByText(/using latest/)).toBeNull()
  })

  it('shows an empty state pointing at the periods section when the modeler 404s', async () => {
    vi.mocked(fetchModeler).mockRejectedValue(new ApiError('no espp periods', 404))
    vi.mocked(fetchPeriods).mockResolvedValue([])
    render(<EsppPage />)

    expect(
      await screen.findByText('no espp periods — add one below to run the $25,000 model.'),
    ).toBeTruthy()
    // No knobs to turn, and no half-drawn gauge.
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recalculate' })).toBeNull()
    // Error isolation: the lots table is a separate load and is untouched.
    expect(screen.getByText('$10,720.49')).toBeTruthy()
  })

  it('keeps the lots table (and its typed row) when the modeler 422s', async () => {
    vi.mocked(fetchModeler).mockRejectedValue(
      new ApiError('no live price for NVDA; pass subscription_price and purchase_fmv', 422),
    )
    render(<EsppPage />)

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
    render(<EsppPage />)
    await screen.findByText('using latest NVDA quote (as of Aug 15, 2026)')

    type('Notes', 'half-typed lot')
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))
    await waitFor(() => expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(2))

    expect(field('Notes').value).toBe('half-typed lot')
  })
})

describe('EsppPage — periods', () => {
  it('lists the stored periods with the contribution shown as a percent', async () => {
    render(<EsppPage />)

    // Via the row action, not the label cell: the modeler's mini-table names the same
    // periods, and only these buttons belong to this section alone.
    expect(await screen.findByRole('button', { name: 'Edit period Feb 2026' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit period Aug 2026' })).toBeTruthy()
    expect(screen.getByText('14.0%')).toBeTruthy()
    expect(screen.getByText('11.0%')).toBeTruthy()
    expect(screen.getByText('$81,000.00')).toBeTruthy()
  })

  it('posts a new period with the percent converted to a fraction, then refetches the model', async () => {
    render(<EsppPage />)
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    type('Label', 'Feb 2027')
    type('Period start', '2026-08-16')
    type('Period end', '2027-02-15')
    type('Semi-annual base', '99000')
    type('Contribution %', '11')
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
      subscriptionPrice: '170.79',
      purchaseFmv: '171',
      carryForward: '0',
    })
  })

  it('edits a period with the full row shape and the pct shifted back', async () => {
    render(<EsppPage />)
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

  it('deletes a period after a confirm and refetches the model', async () => {
    render(<EsppPage />)
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
    render(<EsppPage />)
    await screen.findByRole('button', { name: 'Edit period Feb 2026' })

    type('Label', 'Feb 2026')
    type('Period start', '2026-08-16')
    type('Period end', '2027-02-15')
    type('Semi-annual base', '99000')
    type('Contribution %', '11')
    fireEvent.click(screen.getByRole('button', { name: 'Add period' }))

    expect(await screen.findByText("espp period 'Feb 2026' already exists")).toBeTruthy()
    expect(vi.mocked(fetchModeler)).toHaveBeenCalledTimes(1)
  })
})
