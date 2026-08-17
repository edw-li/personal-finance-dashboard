import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { CompEventOut } from '../types/api'
import CompPage from './CompPage'

vi.mock('../api/comp', () => ({
  fetchEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
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
import { createEvent, deleteEvent, fetchEvents, updateEvent } from '../api/comp'

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

const confirmSpy = vi.spyOn(window, 'confirm')

beforeEach(() => {
  vi.mocked(fetchEvents).mockResolvedValue(EVENTS)
  vi.mocked(createEvent).mockResolvedValue(event2027)
  vi.mocked(updateEvent).mockResolvedValue(event2026)
  vi.mocked(deleteEvent).mockResolvedValue(undefined)
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
