import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { CompEventOut, RsuGrantOut, VestOut, VestingScheduleOut } from '../types/api'
import CompPage from './CompPage'

vi.mock('../api/comp', () => ({
  fetchEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  fetchVestingSchedule: vi.fn(),
  createRsuGrant: vi.fn(),
  updateRsuGrant: vi.fn(),
  deleteRsuGrant: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law). What the
// trajectory actually draws is pinned against the same golden events in
// src/components/comp/compChartOptions.test.ts; this file only asks whether a chart is on
// screen and which years drew it. The async factory + dynamic import keeps the JSX runtime
// out of vi.mock's hoisted scope (TaxesPage.test.tsx's marker).
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
import {
  createEvent,
  createRsuGrant,
  deleteEvent,
  deleteRsuGrant,
  fetchEvents,
  fetchVestingSchedule,
  updateEvent,
  updateRsuGrant,
} from '../api/comp'

// --- fixtures -------------------------------------------------------------------------
// The plan's pinned Focal History table (2024-2027) on the wire. 2026 is the real row
// (1822 x 183.2508, 610.0524 x 129.5651); 2024's and 2025's share counts are INVENTED to
// reproduce the plan's pinned products to the cent — the plan pins the products, not the
// operands behind them.

function event(over: Partial<CompEventOut> & Pick<CompEventOut, 'id' | 'focal_year'>): CompEventOut {
  return {
    current_base: '0.00',
    new_base: null,
    unvested_rsus: null,
    unvested_price: null,
    refresh_rsus: null,
    grant_price: null,
    notes: null,
    base_delta: null,
    base_delta_pct: null,
    unvested_equity: null,
    equity_delta: null,
    equity_delta_pct: null,
    tc_before: '0.00',
    tc_after: '0.00',
    ...over,
  }
}

const event2024 = event({
  id: 1,
  focal_year: 2024,
  current_base: '145000.00',
  new_base: '151000.00',
  unvested_rsus: '2000.0000',
  unvested_price: '112.0750',
  refresh_rsus: '300.0000',
  grant_price: '119.7600',
  base_delta: '6000.00',
  base_delta_pct: '0.041379',
  unvested_equity: '224150.00',
  equity_delta: '35928.00',
  equity_delta_pct: '0.160286',
  tc_before: '369150.00',
  tc_after: '411078.00',
})

const event2026 = event({
  id: 3,
  focal_year: 2026,
  current_base: '162000.00',
  new_base: '188930.00',
  unvested_rsus: '1822.0000',
  unvested_price: '183.2508',
  refresh_rsus: '610.0524',
  grant_price: '129.5651',
  notes: 'FY26 refresh',
  base_delta: '26930.00',
  base_delta_pct: '0.166235',
  unvested_equity: '333882.96',
  equity_delta: '79041.50',
  equity_delta_pct: '0.236734',
  tc_before: '495882.96',
  tc_after: '601854.46',
})

// No raise and no grant on the books yet: every computed column is null and TC is the
// base alone.
const event2027 = event({
  id: 4,
  focal_year: 2027,
  current_base: '188930.00',
  tc_before: '188930.00',
  tc_after: '188930.00',
})

const EVENTS = [event2024, event2026, event2027]

// The vesting feed is INDEPENDENT of the events feed, and its default here is the empty
// payload: with no grants the schedule card is one sentence and no chart, so every test above
// that counts em dashes or asks for "the" chart still describes the events half alone. The
// vesting tests below install a populated one.
const EMPTY_SCHEDULE: VestingScheduleOut = {
  ticker: null,
  latest_price: null,
  quoted_at: null,
  grants: [],
  vests: [],
  tiles: {
    next_vest: null,
    unvested_shares: 0,
    unvested_value: null,
    vested_this_year_shares: 0,
    vested_this_year_income: null,
  },
  seed_candidates: [],
  drift_warnings: [],
  warnings: [],
}

const GRANT_NEW_HIRE: RsuGrantOut = {
  id: 11,
  kind: 'new_hire',
  label: 'FY24 new hire',
  focal_year: 2024,
  shares: 1200,
  grant_price: '112.0750',
  first_vest_date: '2024-11-20',
  // The STORED string, at the column's 4dp — deliberately not the '0.25' the client derives,
  // so an unchanged kind can be shown to send the stored one back.
  cliff_pct: '0.2500',
  notes: null,
  vest_count: 13,
  vested_shares: 450,
  unvested_shares: 750,
}

const GRANT_REFRESH: RsuGrantOut = {
  id: 12,
  kind: 'refresh',
  label: 'FY26 refresh',
  focal_year: 2026,
  shares: 480,
  grant_price: '129.5651',
  first_vest_date: '2026-09-16',
  cliff_pct: '0.0625',
  notes: 'seeded from focal history',
  vest_count: 16,
  vested_shares: 0,
  unvested_shares: 480,
}

const VESTS: VestOut[] = [
  { vest_date: '2024-11-20', grant_id: 11, label: 'FY24 new hire', shares: 300,
    fmv: '112.0750', value: '33622.50', is_past: true },
  // The vest with no bar behind it — the payload's warning below names it.
  { vest_date: '2025-02-19', grant_id: 11, label: 'FY24 new hire', shares: 75,
    fmv: null, value: null, is_past: true },
  { vest_date: '2026-02-18', grant_id: 11, label: 'FY24 new hire', shares: 75,
    fmv: '176.0000', value: '13200.00', is_past: true },
  { vest_date: '2026-11-18', grant_id: 11, label: 'FY24 new hire', shares: 75,
    fmv: null, value: null, is_past: false },
  { vest_date: '2026-11-18', grant_id: 12, label: 'FY26 refresh', shares: 30,
    fmv: null, value: null, is_past: false },
]

const SCHEDULE: VestingScheduleOut = {
  ticker: 'NVDA',
  latest_price: '191.4400',
  quoted_at: '2026-08-20',
  grants: [GRANT_NEW_HIRE, GRANT_REFRESH],
  vests: VESTS,
  tiles: {
    // 105 shares on the shared day, at 191.44.
    next_vest: { vest_date: '2026-11-18', shares: 105, est_value: '20101.20' },
    unvested_shares: 1230,
    unvested_value: '235471.20',
    vested_this_year_shares: 75,
    vested_this_year_income: '13200.00',
  },
  seed_candidates: [
    {
      focal_year: 2026,
      // refresh_rsus at its 4dp scale: the chip has to land 480 in a whole-share box.
      shares: '480.0000',
      grant_price: '129.5651',
      suggested_first_vest_date: '2026-09-16',
      suggested_label: '2026 focal',
    },
  ],
  drift_warnings: [
    '2026: focal history says 610.0524 refresh RSUs but the FY26 refresh grant is 480 shares.',
  ],
  warnings: ['no stored close on or before 2025-02-19 — that vest is unpriced.'],
}

// --- helpers --------------------------------------------------------------------------

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

function fillNewEvent() {
  type('Focal year', '2028')
  type('Current base', '188930')
}

/**
 * The stat tile a label names — the figures inside it are read scoped to it. Scoped to the
 * kpi-row first: "Unvested" is also a COLUMN of the grants table on the same page.
 */
const tile = (label: string) =>
  within(document.querySelector('.kpi-row') as HTMLElement)
    .getByText(label)
    .closest('.stat-tile') as HTMLElement

/** The grants table alone — the form's own <option>s carry the same kind words. */
const grantsTable = () =>
  screen.getByText('RSU grants').closest('.card')?.querySelector('table') as HTMLElement

function fillNewGrant() {
  type('Label', 'FY27 new hire')
  type('Shares', '1200')
  type('Price at grant', '150.0000')
  type('First vest', '2027-02-17')
}

const confirmSpy = vi.spyOn(window, 'confirm')

beforeEach(() => {
  vi.mocked(fetchEvents).mockResolvedValue(EVENTS)
  vi.mocked(createEvent).mockResolvedValue(event2027)
  vi.mocked(updateEvent).mockResolvedValue(event2026)
  vi.mocked(deleteEvent).mockResolvedValue(undefined)
  vi.mocked(fetchVestingSchedule).mockResolvedValue(EMPTY_SCHEDULE)
  vi.mocked(createRsuGrant).mockResolvedValue(GRANT_NEW_HIRE)
  vi.mocked(updateRsuGrant).mockResolvedValue(GRANT_NEW_HIRE)
  vi.mocked(deleteRsuGrant).mockResolvedValue(undefined)
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CompPage — events table', () => {
  it('renders the stored and computed columns from the server, nothing re-derived', async () => {
    render(<CompPage />)

    expect(await screen.findByText('$601,854.46')).toBeTruthy() // 2026 tc_after
    expect(screen.getByText('$495,882.96')).toBeTruthy() // 2026 tc_before
    expect(screen.getByText('$333,882.96')).toBeTruthy() // unvested equity
    expect(screen.getByText('$79,041.50')).toBeTruthy() // equity delta
    expect(screen.getByText('$26,930.00')).toBeTruthy() // base delta
    expect(screen.getByText('+16.6%')).toBeTruthy() // base delta pct
    expect(screen.getByText('+23.7%')).toBeTruthy() // equity delta pct
    expect(screen.getByText('1,822')).toBeTruthy() // unvested RSUs
    expect(screen.getByText('$183.25')).toBeTruthy() // unvested price
    expect(screen.getByText('FY26 refresh')).toBeTruthy()

    // ...and 2024's own row, so the table is not showing one event twice.
    expect(screen.getByText('$411,078.00')).toBeTruthy()
    expect(screen.getByText('$224,150.00')).toBeTruthy()
  })

  it('renders "—" for every null computed column of a bare year', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([event2027])
    render(<CompPage />)

    // tc_before / tc_after are never null, so they still carry figures.
    expect(await screen.findAllByText('$188,930.00')).toHaveLength(3) // base + both TCs
    // new_base, base_delta, base_delta_pct, unvested_rsus, unvested_price,
    // unvested_equity, refresh_rsus, grant_price, equity_delta, equity_delta_pct, notes.
    expect(screen.getAllByText('—')).toHaveLength(11)
  })

  it('draws the trajectory from the years the server sent, under its own label', async () => {
    render(<CompPage />)

    const chart = await screen.findByTestId('echart')
    expect(chart.getAttribute('data-categories')).toBe('2024,2026,2027')
    // TC here is a proxy (the sheet has no TC column), and the heading is where that is
    // said — Plan 5 §Task 9 names this exact sentence.
    expect(screen.getByText('Base + unvested equity value')).toBeTruthy()
  })

  it('offers an empty state instead of a chart when there are no events', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([])
    render(<CompPage />)

    expect(await screen.findByText('No comp events yet — add one below.')).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })
})

describe('CompPage — writes', () => {
  it('posts a new event with every nullable column present', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    fillNewEvent()
    type('Unvested RSUs', '1900')
    type('Unvested price', '190.0000')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))

    await waitFor(() => expect(vi.mocked(createEvent)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createEvent).mock.calls[0][0]).toEqual({
      focal_year: 2028,
      current_base: '188930',
      new_base: null,
      unvested_rsus: '1900',
      unvested_price: '190.0000',
      refresh_rsus: null,
      grant_price: null,
      notes: null,
    })
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(2))
  })

  it('PATCHes the FULL row, and a blanked column travels as an explicit null', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    fireEvent.click(screen.getByRole('button', { name: 'Edit the 2026 comp event' }))
    // The boxes seed from the row, verbatim — these are the server's own quantized strings.
    expect(field('Current base').value).toBe('162000.00')
    expect(field('New base').value).toBe('188930.00')
    expect(field('Unvested price').value).toBe('183.2508')
    expect(field('Notes').value).toBe('FY26 refresh')

    // The raise that never happened: clearing new_base has to CLEAR the column, which on
    // this router (and only this one) is what an explicit null does.
    type('New base', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(vi.mocked(updateEvent)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateEvent).mock.calls[0][0]).toBe(3)
    const body = vi.mocked(updateEvent).mock.calls[0][1]
    // Present-and-null, never omitted: an omitted key is a no-op on PATCH, so a delta body
    // would leave the raise standing.
    expect(Object.keys(body)).toContain('new_base')
    expect(body).toEqual({
      focal_year: 2026,
      current_base: '162000.00',
      new_base: null,
      unvested_rsus: '1822.0000',
      unvested_price: '183.2508',
      refresh_rsus: '610.0524',
      grant_price: '129.5651',
      notes: 'FY26 refresh',
    })
  })

  it('clears the notes with an explicit null too', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    fireEvent.click(screen.getByRole('button', { name: 'Edit the 2026 comp event' }))
    type('Notes', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(vi.mocked(updateEvent)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateEvent).mock.calls[0][1].notes).toBeNull()
  })

  it('deletes an event only after the confirm is accepted', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete the 2026 comp event' }))
    expect(vi.mocked(deleteEvent)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete the 2026 comp event' }))
    await waitFor(() => expect(vi.mocked(deleteEvent)).toHaveBeenCalledWith(3))
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(2))
  })

  it('requires the two NOT NULL columns before spending a request', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    type('Focal year', '2028')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))

    expect(await screen.findByText('Focal year and current base are required')).toBeTruthy()
    expect(vi.mocked(createEvent)).not.toHaveBeenCalled()
  })

  it('answers a mistyped focal year in the server’s own sentence', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    type('Focal year', '20268')
    type('Current base', '188930')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))

    expect(await screen.findByText('focal_year must be between 1990 and 2100')).toBeTruthy()
    expect(vi.mocked(createEvent)).not.toHaveBeenCalled()
  })

  it('renders a 409 verbatim and keeps the typed row', async () => {
    vi.mocked(createEvent).mockRejectedValue(
      new ApiError('a comp event for 2028 already exists', 409),
    )
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    fillNewEvent()
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))

    expect(await screen.findByText('a comp event for 2028 already exists')).toBeTruthy()
    expect(field('Current base').value).toBe('188930')
    expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(1)
  })
})

describe('CompPage — orphaned equity operands', () => {
  it('names the operand left without its partner, without blocking the save', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    // The stored row has BOTH sides, so clearing one is this edit's own doing.
    fireEvent.click(screen.getByRole('button', { name: 'Edit the 2026 comp event' }))
    type('Unvested price', '')

    // Surfaced as the box is cleared, BEFORE any save: the server accepts the row and
    // silently stops computing the product, so this is the only place it can be said.
    expect(
      screen.getByText(
        'Unvested RSUs is set but unvested price is blank — unvested equity will be cleared, not computed.',
      ),
    ).toBeTruthy()

    // Advisory, not a gate: half a pair is a legal row.
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    await waitFor(() => expect(vi.mocked(updateEvent)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateEvent).mock.calls[0][1].unvested_rsus).toBe('1822.0000')
    expect(vi.mocked(updateEvent).mock.calls[0][1].unvested_price).toBeNull()
  })

  it('names the other side of each pair too', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    // Both pairs are whole on the stored 2026 row, so either box cleared is a change.
    fireEvent.click(screen.getByRole('button', { name: 'Edit the 2026 comp event' }))
    type('Unvested RSUs', '')
    expect(
      screen.getByText(
        'Unvested price is set but unvested RSUs is blank — unvested equity will be cleared, not computed.',
      ),
    ).toBeTruthy()

    type('Grant price', '')
    expect(
      screen.getByText(
        'Refresh RSUs is set but grant price is blank — the equity delta will be cleared, not computed.',
      ),
    ).toBeTruthy()
  })

  it('says nothing when a pair is whole, or gone entirely', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    // Both filled (the row as stored).
    fireEvent.click(screen.getByRole('button', { name: 'Edit the 2026 comp event' }))
    expect(screen.queryByText(/will be cleared, not computed/)).toBeNull()

    // Both blank: the equity is being removed on purpose, and there is no orphan to name.
    type('Unvested RSUs', '')
    type('Unvested price', '')
    expect(screen.queryByText(/unvested equity will be cleared/)).toBeNull()

    // And the untouched second pair never spoke at all.
    expect(screen.queryByText(/equity delta will be cleared/)).toBeNull()
  })

  it('says nothing when the row was ALREADY half-paired before it was opened', async () => {
    // A grant whose price is not known yet is a legal, ordinary row: the table already
    // shows the empty column, and greeting every open of it with a warning about a state
    // this edit did not create is how a sentence stops being read.
    const halfPaired = event({
      id: 7, focal_year: 2025, current_base: '162000.00',
      unvested_rsus: '2152.0000', tc_before: '162000.00', tc_after: '162000.00',
    })
    vi.mocked(fetchEvents).mockResolvedValue([halfPaired])
    render(<CompPage />)
    await screen.findByRole('button', { name: 'Edit the 2025 comp event' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit the 2025 comp event' }))
    expect(screen.queryByText(/will be cleared, not computed/)).toBeNull()

    // ...and the moment THIS edit moves the pair to a different half, it speaks.
    type('Unvested RSUs', '')
    type('Unvested price', '190.0000')
    expect(
      screen.getByText(
        'Unvested price is set but unvested RSUs is blank — unvested equity will be cleared, not computed.',
      ),
    ).toBeTruthy()
  })

  it('names a half-filled pair typed into a NEW row, where there is nothing stored', async () => {
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    // Nothing is being edited, so the pair's stored state is "neither" — one side filled
    // is a change, and the product the user is expecting will not be computed.
    fillNewEvent()
    type('Refresh RSUs', '610.0524')
    expect(
      screen.getByText(
        'Refresh RSUs is set but grant price is blank — the equity delta will be cleared, not computed.',
      ),
    ).toBeTruthy()
  })
})

describe('CompPage — loading', () => {
  it('offers a retry when the first load fails, with no stale cue behind it', async () => {
    vi.mocked(fetchEvents).mockRejectedValueOnce(new ApiError('comp unavailable', 503))
    render(<CompPage />)

    expect(await screen.findByText('comp unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading comp events' }))
    expect(await screen.findByText('$601,854.46')).toBeTruthy()
    expect(screen.queryByText('comp unavailable')).toBeNull()
  })

  it('keeps the table (and the typed row) when a RELOAD fails, and says so', async () => {
    vi.mocked(fetchEvents)
      .mockResolvedValueOnce(EVENTS)
      .mockRejectedValueOnce(new ApiError('comp unavailable', 503))
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    type('Notes', 'half-typed event')
    fireEvent.click(screen.getByRole('button', { name: 'Delete the 2027 comp event' }))
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(2))

    expect(
      await screen.findByText('comp unavailable — the table may be showing earlier data.'),
    ).toBeTruthy()
    expect(screen.getByText('$601,854.46')).toBeTruthy()
    expect(field('Notes').value).toBe('half-typed event')
  })

  it('dims the chart card as well as the table while a reload is in flight', async () => {
    const slow = deferred<CompEventOut[]>()
    vi.mocked(fetchEvents).mockResolvedValueOnce(EVENTS).mockReturnValueOnce(slow.promise)
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    fireEvent.click(screen.getByRole('button', { name: 'Delete the 2027 comp event' }))
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(2))

    // The chart is drawn from the same payload the table is, so it goes dim with it: a
    // bright chart over a table that says it may be stale is the one figure the eye is on
    // claiming to be current.
    await waitFor(() =>
      expect(screen.getByTestId('echart').closest('.loading-dim')?.className).toContain(
        'is-loading',
      ),
    )

    await act(async () => {
      slow.resolve(EVENTS)
    })
    expect(screen.getByTestId('echart').closest('.loading-dim')?.className).not.toContain(
      'is-loading',
    )
  })

  it('lets only the NEWEST of two overlapping loads land', async () => {
    const slow = deferred<CompEventOut[]>()
    const fast = deferred<CompEventOut[]>()
    vi.mocked(fetchEvents)
      .mockResolvedValueOnce(EVENTS)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    fireEvent.click(screen.getByRole('button', { name: 'Delete the 2024 comp event' }))
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Delete the 2027 comp event' }))
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(3))

    fast.resolve([event2026])
    await waitFor(() =>
      expect(screen.getByTestId('echart').getAttribute('data-categories')).toBe('2026'),
    )

    await act(async () => {
      slow.resolve([event2024, event2027])
    })
    // The older load answers LAST and must not roll the table back — the seq ref, not the
    // network, decides which feed is on screen.
    expect(screen.getByTestId('echart').getAttribute('data-categories')).toBe('2026')
  })
})

describe('CompPage — vesting schedule', () => {
  beforeEach(() => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue(SCHEDULE)
  })

  it('renders the three tiles from the server’s own strings, nothing re-derived', async () => {
    render(<CompPage />)
    await screen.findByText('Vesting schedule')

    // The tile's value is the next vest DATE and its delta the shares and the estimate the
    // server priced them at — none of the three is multiplied out here.
    expect(within(tile('Next vest')).getByText('Nov 18, 2026')).toBeTruthy()
    expect(within(tile('Next vest')).getByText('105 sh · $20,101.20')).toBeTruthy()
    expect(within(tile('Unvested')).getByText('1,230 sh')).toBeTruthy()
    expect(within(tile('Unvested')).getByText('$235,471.20')).toBeTruthy()
    expect(within(tile('Vested this year')).getByText('75 sh')).toBeTruthy()
    expect(within(tile('Vested this year')).getByText('$13,200.00')).toBeTruthy()
    // The quote the future half of the card was priced against, said once.
    expect(screen.getByText('NVDA · $191.44 · as of Aug 20, 2026')).toBeTruthy()
  })

  it('leaves a tile’s delta off entirely when the server could not price it', async () => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue({
      ...SCHEDULE,
      tiles: { ...SCHEDULE.tiles, vested_this_year_income: null },
    })
    render(<CompPage />)
    await screen.findByText('Vesting schedule')

    // The shares still vested; only their value is unknown. An em dash under the count would
    // read as "worth nothing", which is the one thing the null does NOT say.
    expect(within(tile('Vested this year')).getByText('75 sh')).toBeTruthy()
    expect(within(tile('Vested this year')).queryByText('—')).toBeNull()
  })

  it('draws the vesting calendar beside the trajectory, on the vest dates', async () => {
    render(<CompPage />)
    await screen.findByText('Vesting schedule')

    const charts = await screen.findAllByTestId('echart')
    expect(charts).toHaveLength(2)
    // The trajectory is unchanged and still first — the vesting calendar is the second card.
    expect(charts[0].getAttribute('data-categories')).toBe('2024,2026,2027')
    const dates = charts[1].getAttribute('data-categories') ?? ''
    expect(dates).toContain('Nov 20, 2024')
    // Five tranches, four distinct days: the last two share one bar.
    expect(dates).toContain('Nov 18, 2026')
    expect(dates.split(/,(?=[A-Z])/)).toHaveLength(4)
  })

  it('marks the first future row and keeps the vest table server-verbatim', async () => {
    render(<CompPage />)
    await screen.findByText('Vesting schedule')

    // One badge, on the first row that has not happened yet.
    expect(screen.getAllByText('next')).toHaveLength(1)
    // Three past rows recede; both future rows carry the live quote marked as an estimate.
    expect(document.querySelectorAll('tr.vest-past')).toHaveLength(3)
    expect(screen.getAllByText('est.')).toHaveLength(2)
    // The two future price cells (the quote line above them is one text node, so it is not
    // one of these) — the live quote never reaches a PAST row, which was priced at its own.
    expect(screen.getAllByText('$191.44')).toHaveLength(2)
    // Past values are the server's own; a future one is left blank rather than multiplied
    // out beside them.
    expect(screen.getByText('$33,622.50')).toBeTruthy()
  })

  it('renders the drift warnings and the payload’s own warnings', async () => {
    render(<CompPage />)
    await screen.findByText('Vesting schedule')

    expect(
      screen.getByText(
        '2026: focal history says 610.0524 refresh RSUs but the FY26 refresh grant is 480 shares.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('no stored close on or before 2025-02-19 — that vest is unpriced.'),
    ).toBeTruthy()
  })

  it('offers the empty state, and its warnings, when there are no grants', async () => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue({
      ...EMPTY_SCHEDULE,
      // A grant too broken to schedule is dropped from `grants` with a warning naming it —
      // the empty state is exactly where that sentence is the only evidence it exists.
      warnings: ['FY24 new hire: stored grant cannot be scheduled — cliff_pct out of range'],
    })
    render(<CompPage />)

    expect(
      await screen.findByText('No grants yet — add one below to see the schedule.'),
    ).toBeTruthy()
    expect(
      screen.getByText('FY24 new hire: stored grant cannot be scheduled — cliff_pct out of range'),
    ).toBeTruthy()
    // No tiles and no calendar with nothing to put in them — the trajectory alone is left.
    expect(screen.getAllByTestId('echart')).toHaveLength(1)
  })

  it('renders the grants table with the server’s computed split', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    const table = within(grantsTable())
    expect(table.getByText('New hire')).toBeTruthy() // the kind badge
    expect(table.getByText('Refresh')).toBeTruthy()
    expect(table.getByText('$112.08')).toBeTruthy() // grant price, 4dp rendered as money
    expect(table.getByText('450')).toBeTruthy() // vested_shares — the server's, on its day
    expect(table.getByText('750')).toBeTruthy() // unvested_shares
    expect(table.getByText('seeded from focal history')).toBeTruthy()
  })
})

describe('CompPage — RSU grant writes', () => {
  beforeEach(() => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue(SCHEDULE)
  })

  it('prefills the form from a seed chip and saves nothing', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fireEvent.click(screen.getByRole('button', { name: 'Add 2026 focal — 480 sh @ $129.57' }))

    expect(field('Label').value).toBe('2026 focal')
    // refresh_rsus arrives as "480.0000" and the column behind the box is whole shares.
    expect(field('Shares').value).toBe('480')
    expect(field('Grant focal year').value).toBe('2026')
    expect(field('Price at grant').value).toBe('129.5651')
    expect(field('First vest').value).toBe('2026-09-16')
    // An offer, not a write: the grant it becomes is the vesting truth for years afterwards.
    expect(vi.mocked(createRsuGrant)).not.toHaveBeenCalled()
  })

  it('derives the cliff from the kind on a new grant', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fillNewGrant()
    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))

    await waitFor(() => expect(vi.mocked(createRsuGrant)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createRsuGrant).mock.calls[0][0]).toEqual({
      kind: 'new_hire',
      label: 'FY27 new hire',
      focal_year: null,
      shares: 1200,
      grant_price: '150.0000',
      first_vest_date: '2027-02-17',
      // A quarter held back for a year, then 6.25% a quarter — never a box the user fills.
      cliff_pct: '0.25',
      notes: null,
    })
    // A grant write moves the schedule and nothing else: the focal history is untouched.
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(1)
  })

  it('derives the refresh cliff when the kind says refresh', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fillNewGrant()
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'refresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))

    await waitFor(() => expect(vi.mocked(createRsuGrant)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createRsuGrant).mock.calls[0][0].cliff_pct).toBe('0.0625')
  })

  it('keeps the STORED cliff on an edit, and re-derives only when the kind flips', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fireEvent.click(screen.getByRole('button', { name: 'Edit the FY24 new hire grant' }))
    // The boxes seed from the row, verbatim.
    expect(field('Label').value).toBe('FY24 new hire')
    expect(field('Shares').value).toBe('1200')
    expect(field('Price at grant').value).toBe('112.0750')
    expect(field('First vest').value).toBe('2024-11-20')

    fireEvent.click(screen.getByRole('button', { name: 'Save grant' }))
    await waitFor(() => expect(vi.mocked(updateRsuGrant)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateRsuGrant).mock.calls[0][0]).toBe(11)
    // The column's own 4dp string, NOT the '0.25' this client would derive: an old grant may
    // carry a cliff the current rule would no longer produce, and an untouched kind is not a
    // licence to rewrite its schedule.
    expect(vi.mocked(updateRsuGrant).mock.calls[0][1].cliff_pct).toBe('0.2500')
    // The FULL row on PATCH — the router validates the merged grant.
    expect(vi.mocked(updateRsuGrant).mock.calls[0][1]).toEqual({
      kind: 'new_hire',
      label: 'FY24 new hire',
      focal_year: 2024,
      shares: 1200,
      grant_price: '112.0750',
      first_vest_date: '2024-11-20',
      cliff_pct: '0.2500',
      notes: null,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit the FY24 new hire grant' }))
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'refresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save grant' }))
    await waitFor(() => expect(vi.mocked(updateRsuGrant)).toHaveBeenCalledTimes(2))
    // A new-hire cliff on a refresh grant is the wrong schedule outright.
    expect(vi.mocked(updateRsuGrant).mock.calls[1][1].cliff_pct).toBe('0.0625')
  })

  it('clears the two nullable columns with an explicit null', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fireEvent.click(screen.getByRole('button', { name: 'Edit the FY26 refresh grant' }))
    expect(field('Grant notes').value).toBe('seeded from focal history')
    type('Grant notes', '')
    type('Grant focal year', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save grant' }))

    await waitFor(() => expect(vi.mocked(updateRsuGrant)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(updateRsuGrant).mock.calls[0][1]
    // Present-and-null, never omitted: focal_year and notes are the two nullable columns
    // here, and an omitted key is a no-op on PATCH.
    expect(Object.keys(body)).toContain('focal_year')
    expect(body.focal_year).toBeNull()
    expect(body.notes).toBeNull()
  })

  it('fences a fractional share count before spending a request', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fillNewGrant()
    type('Shares', '480.6')
    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))

    expect(await screen.findByText('Shares must be a whole number')).toBeTruthy()
    expect(vi.mocked(createRsuGrant)).not.toHaveBeenCalled()
  })

  it('fences a price that is not a plain decimal, where no 422 is behind it', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fillNewGrant()
    // "1e-3" is a legal Decimal server-side: it would be STORED as 0.001 with no complaint.
    type('Price at grant', '1e-3')
    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))

    expect(await screen.findByText('Price at grant must be a number')).toBeTruthy()
    expect(vi.mocked(createRsuGrant)).not.toHaveBeenCalled()
  })

  it('answers a mistyped focal year in the server’s own sentence', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fillNewGrant()
    type('Grant focal year', '20268')
    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))

    expect(await screen.findByText('focal_year must be between 1990 and 2100')).toBeTruthy()
    expect(vi.mocked(createRsuGrant)).not.toHaveBeenCalled()
  })

  it('renders a 409 verbatim and keeps the typed row', async () => {
    vi.mocked(createRsuGrant).mockRejectedValue(
      new ApiError("a grant labeled 'FY27 new hire' already exists", 409),
    )
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fillNewGrant()
    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))

    expect(
      await screen.findByText("a grant labeled 'FY27 new hire' already exists"),
    ).toBeTruthy()
    expect(field('Label').value).toBe('FY27 new hire')
    expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(1)
  })

  it('deletes a grant only after the confirm names it', async () => {
    render(<CompPage />)
    await screen.findByText('RSU grants')

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete the FY26 refresh grant' }))
    expect(confirmSpy).toHaveBeenCalledWith('Delete the FY26 refresh grant?')
    expect(vi.mocked(deleteRsuGrant)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete the FY26 refresh grant' }))
    await waitFor(() => expect(vi.mocked(deleteRsuGrant)).toHaveBeenCalledWith(12))
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(2))
  })
})

describe('CompPage — the two feeds are independent', () => {
  it('banners a schedule failure with a Retry while the events card still renders', async () => {
    vi.mocked(fetchVestingSchedule).mockRejectedValueOnce(
      new ApiError('vesting unavailable', 503),
    )
    vi.mocked(fetchVestingSchedule).mockResolvedValue(SCHEDULE)
    render(<CompPage />)

    expect(await screen.findByText('vesting unavailable')).toBeTruthy()
    // The other feed answered: a 503 on one entity must not blank the other.
    expect(await screen.findByText('$601,854.46')).toBeTruthy()
    // Nothing stale behind a FIRST-load failure, so no stale cue.
    expect(screen.queryByText(/the schedule may be showing earlier data/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the vesting schedule' }))
    expect(await screen.findByText('Vesting schedule')).toBeTruthy()
    expect(screen.queryByText('vesting unavailable')).toBeNull()
  })

  it('keeps the schedule up when a RELOAD of it fails, and says so', async () => {
    vi.mocked(fetchVestingSchedule)
      .mockResolvedValueOnce(SCHEDULE)
      .mockRejectedValueOnce(new ApiError('vesting unavailable', 503))
    render(<CompPage />)
    await screen.findByText('RSU grants')

    type('Label', 'half-typed grant')
    fireEvent.click(screen.getByRole('button', { name: 'Delete the FY26 refresh grant' }))
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(2))

    expect(
      await screen.findByText('vesting unavailable — the schedule may be showing earlier data.'),
    ).toBeTruthy()
    expect(within(tile('Unvested')).getByText('1,230 sh')).toBeTruthy()
    expect(field('Label').value).toBe('half-typed grant')
  })

  it('reloads BOTH feeds after a comp event write', async () => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue(SCHEDULE)
    render(<CompPage />)
    await screen.findByText('$601,854.46')

    // A focal year is what the seed chips and the drift sentences are built from, so an
    // event write moves the schedule card even though it touches no grant.
    fireEvent.click(screen.getByRole('button', { name: 'Delete the 2027 comp event' }))
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(2))
  })

  it('lets only the NEWEST of two overlapping schedule loads land', async () => {
    const slow = deferred<VestingScheduleOut>()
    const fast = deferred<VestingScheduleOut>()
    vi.mocked(fetchVestingSchedule)
      .mockResolvedValueOnce(SCHEDULE)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    render(<CompPage />)
    await screen.findByText('RSU grants')

    fireEvent.click(screen.getByRole('button', { name: 'Delete the FY26 refresh grant' }))
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Delete the FY24 new hire grant' }))
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(3))

    // The grant AND its tranches: a deleted grant takes its vest rows with it.
    fast.resolve({
      ...SCHEDULE,
      grants: [GRANT_NEW_HIRE],
      vests: VESTS.filter((vest) => vest.grant_id === GRANT_NEW_HIRE.id),
    })
    // Asked for by its row action, not by its label: "FY26 refresh" is also the 2026 comp
    // event's NOTE, three cards down.
    const refreshRow = () =>
      screen.queryByRole('button', { name: 'Edit the FY26 refresh grant' })
    await waitFor(() => expect(refreshRow()).toBeNull())

    await act(async () => {
      slow.resolve(SCHEDULE)
    })
    // The older load answers LAST and must not put the deleted grant back.
    expect(refreshRow()).toBeNull()
  })
})
