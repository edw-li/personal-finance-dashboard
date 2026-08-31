import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import type { HouseholdOut, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import NetWorthPage from './NetWorthPage'

vi.mock('../api/netWorth', () => ({ fetchTimeseries: vi.fn(), fetchSummary: vi.fn() }))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each chart
// DRAWS is pinned in netWorthChartOptions.test.ts; this marker exposes only the option
// slices this page owns: series names, their stack ids, any markLine anchor, and (A2) the
// legend.selected map THIS chart was fed. mouseEnter stands in for a legendselectchanged
// on this chart, since jsdom cannot raise echarts events.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      onLegendChange,
      animateEntrance = true,
    }: {
      option: {
        legend?: { selected?: Record<string, boolean> }
        series?: {
          name?: string
          stack?: string
          markLine?: { data?: { xAxis?: string }[] }
        }[]
      }
      onLegendChange?: (selected: Record<string, boolean>) => void
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        'data-stacks': (option.series ?? []).map((s) => s.stack ?? '-').join('|'),
        'data-marriage': (option.series ?? [])
          .flatMap((s) => s.markLine?.data ?? [])
          .map((d) => d.xAxis ?? '')
          .join('|'),
        'data-legend-selected': JSON.stringify(option.legend?.selected ?? null),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        // An account literally named "Cash" toggled off — the A2 collision case.
        onMouseEnter: () => onLegendChange?.({ Cash: false }),
      }),
  }
})

import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchHousehold } from '../api/household'

const ME = { id: 1, name: 'Me', is_primary: true }
const SAM = { id: 2, name: 'Sam', is_primary: false }

function timeseriesOut(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-07-01', '2026-08-01'],
    accounts: [
      {
        id: 1, name: 'My Checking', slug: 'my-checking', group: 'cash', sort_order: 1,
        is_active: true, is_component: false, parent_account_id: null, person_id: 1,
      },
      {
        id: 2, name: 'Joint Savings', slug: 'joint-savings', group: 'cash', sort_order: 2,
        is_active: true, is_component: false, parent_account_id: null, person_id: null,
      },
    ],
    series: [
      { account_id: 1, values: ['100.00', '150.00'] },
      { account_id: 2, values: ['70.00', '80.00'] },
    ],
    group_totals: {
      cash: ['170.00', '230.00'], pre_tax: ['0.00', '0.00'], post_tax: ['0.00', '0.00'],
      taxable: ['0.00', '0.00'], equity: ['0.00', '0.00'], other: ['0.00', '0.00'],
      liability: ['0.00', '0.00'],
    },
    net_worth: ['170.00', '230.00'],
    mom_pct: [null, '0.352941'],
    notes: [null, null],
    owner_series: [
      { person_id: 1, name: 'Me', values: ['100.00', '150.00'] },
      { person_id: null, name: null, values: ['70.00', '80.00'] },
    ],
    ...over,
  }
}

function summaryOut(over: Partial<NetWorthSummary> = {}): NetWorthSummary {
  return {
    month: '2026-08-01',
    net_worth: '230.00',
    mom_delta: '60.00',
    mom_pct: '0.352941',
    groups: [],
    owner_totals: [
      { person_id: 1, name: 'Me', total: '150.00' },
      { person_id: null, name: null, total: '80.00' },
    ],
    ...over,
  }
}

function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME, SAM], marriage_date: null, ...over }
}

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchTimeseries).mockResolvedValue(timeseriesOut())
  vi.mocked(fetchSummary).mockResolvedValue(summaryOut())
  vi.mocked(fetchHousehold).mockResolvedValue(household())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <NetWorthPage />
    </MemoryRouter>,
  )
}

it('hides the owner controls entirely for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Net worth')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  // Nothing to choose between: chips and the stack toggle would both be one-option UI.
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  expect(screen.queryByRole('group', { name: 'Stack by' })).toBeNull()
})

it('renders All / each person / Joint once a partner exists', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Owner' })
  expect(
    [...chips.querySelectorAll('button')].map((b) => b.textContent),
  ).toEqual(['All', 'Me', 'Sam', 'Joint'])
})

it('renders the per-owner strip in chip order, skipping owners the payload lacks', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  const strip = document.querySelector('.networth-owner-strip')
  expect(strip).not.toBeNull()
  // Me then Joint — the fixture's owner_totals has no SAM row, and a missing owner is
  // SKIPPED, never rendered as $0.00. Order comes from the chips, so the two agree.
  expect([...strip!.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
    'Me',
    'Joint',
  ])
  expect([...strip!.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
    '$150.00',
    '$80.00',
  ])
})

it('hides the strip for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Net worth')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  expect(document.querySelector('.networth-owner-strip')).toBeNull()
})

it('scopes BOTH fetches to the picked owner, and back to the household on All', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Owner' })
  fireEvent.click(screen.getByRole('button', { name: 'Sam' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', SAM.id))
  expect(fetchSummary).toHaveBeenCalledWith(SAM.id)
  expect(screen.getByRole('button', { name: 'Sam' }).getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', 'joint'))
  expect(fetchSummary).toHaveBeenCalledWith('joint')

  fireEvent.click(chips.querySelectorAll('button')[0])
  // null, not omitted: the client turns null into no param at all (netWorth.test.ts).
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', null))
  expect(fetchSummary).toHaveBeenLastCalledWith(null)
})

it('keeps the page alive when the household endpoint fails', async () => {
  vi.mocked(fetchHousehold).mockRejectedValue(new Error('household down'))
  renderPage()
  // The scope control is an affordance; losing it must cost the chips and nothing else.
  expect(await screen.findByText('Net worth')).toBeTruthy()
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalled())
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

const stacked = () => screen.getAllByTestId('echart')[0]

it('stacks by group by default and by owner on demand — no refetch either way', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Stack by' })
  expect(stacked().getAttribute('data-series')).toBe(
    'Cash|Pre-tax|Post-tax|Taxable|Equity|Other|Liabilities|Net worth',
  )
  const callsBefore = vi.mocked(fetchTimeseries).mock.calls.length

  fireEvent.click(screen.getByRole('button', { name: 'By owner' }))
  // owner_series ships on the SAME payload, so the toggle is a re-render, not a request.
  expect(vi.mocked(fetchTimeseries).mock.calls.length).toBe(callsBefore)
  expect(stacked().getAttribute('data-series')).toBe('Me|Joint|Net worth')
  // One stack id across the owner columns, so they land on the net-worth line; the line
  // itself is never stacked.
  expect(stacked().getAttribute('data-stacks')).toBe('owner|owner|-')

  fireEvent.click(screen.getByRole('button', { name: 'By group' }))
  expect(stacked().getAttribute('data-series')).toContain('Cash|')
})

it('marks the wedding month on the trend once a marriage date is set', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ marriage_date: '2026-08-14' }))
  renderPage()
  await waitFor(() => expect(stacked().getAttribute('data-marriage')).toBe('Aug 2026'))
})

it('draws no marriage rule when the household has no date yet', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  expect(stacked().getAttribute('data-marriage')).toBe('')
})

describe('NetWorthPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints instantly from a seeded snapshot and still revalidates', () => {
    setSnapshot('net-worth:monthly:all', { ts: timeseriesOut(), summary: summaryOut() })
    // Never-resolving fetches: whatever is on screen came from the seed alone.
    vi.mocked(fetchTimeseries).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchSummary).mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(stacked().getAttribute('data-series')).toBe(
      'Cash|Pre-tax|Post-tax|Taxable|Equity|Other|Liabilities|Net worth',
    )
    expect(screen.queryByText(/Loading/)).toBeNull()
    // Revalidating under the house dim, and the request really went out.
    expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
    expect(vi.mocked(fetchTimeseries)).toHaveBeenCalledTimes(1)
    // A cached paint renders its charts still.
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })

  it('derives the drill default from the seed — the drill chart is up before any fetch', () => {
    setSnapshot('net-worth:monthly:all', { ts: timeseriesOut(), summary: summaryOut() })
    vi.mocked(fetchTimeseries).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchSummary).mockReturnValue(new Promise(() => {}))
    renderPage()
    // My Checking (150) beats Joint Savings (80) at the latest month — slot 1.
    expect(screen.getAllByTestId('echart')[1].getAttribute('data-series')).toBe('My Checking')
    expect(screen.queryByText('No accounts selected.')).toBeNull()
  })

  it('a changed revalidation payload updates the page and re-arms the charts', async () => {
    setSnapshot('net-worth:monthly:all', { ts: timeseriesOut(), summary: summaryOut() })
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseriesOut({
        owner_series: [{ person_id: 1, name: 'Renamed', values: ['100.00', '150.00'] }],
      }),
    )
    const { container } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'By owner' }))
    await waitFor(() => expect(stacked().getAttribute('data-series')).toBe('Renamed|Net worth'))
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
    expect(stacked().getAttribute('data-animate')).toBe('true')
  })

  it('leaves the charts still when the revalidation payload is identical', async () => {
    setSnapshot('net-worth:monthly:all', { ts: timeseriesOut(), summary: summaryOut() })
    const { container } = renderPage()
    // The dim lifting is the revalidation landing — .finally runs on every resolution.
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })

  it('keys the snapshot by granularity — a quarterly flip is a cache MISS', async () => {
    setSnapshot('net-worth:monthly:all', { ts: timeseriesOut(), summary: summaryOut() })
    renderPage()
    await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', null))
    vi.mocked(fetchTimeseries).mockResolvedValue(timeseriesOut({ months: ['2026-07-01'] }))
    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('quarterly', null))
    // Different key, so the monthly payload can never satisfy the quarterly equality skip.
    await waitFor(() => expect(stacked().getAttribute('data-animate')).toBe('true'))
  })
})

// ── Owner-switch stranding regression (2026-08-28 bug report) ────────────────────────────
// The identical-payload revalidation skip compared the response against the SNAPSHOT CACHE
// instead of the rendered charts, so returning to a warm scope after an empty owner view
// left the empty payload on screen forever.
it('restores the household view after visiting an owner with no data', async () => {
  const emptyTs = timeseriesOut({
    accounts: [],
    series: [],
    group_totals: {
      cash: ['0.00', '0.00'], pre_tax: ['0.00', '0.00'], post_tax: ['0.00', '0.00'],
      taxable: ['0.00', '0.00'], equity: ['0.00', '0.00'], other: ['0.00', '0.00'],
      liability: ['0.00', '0.00'],
    },
    net_worth: ['0.00', '0.00'],
    mom_pct: [null, null],
    owner_series: [],
  })
  const emptySummary = summaryOut({
    net_worth: '0.00',
    mom_delta: '0.00',
    mom_pct: null,
    owner_totals: [],
  })
  vi.mocked(fetchTimeseries).mockImplementation((_g, owner) =>
    Promise.resolve(owner === SAM.id ? emptyTs : timeseriesOut()),
  )
  vi.mocked(fetchSummary).mockImplementation((owner) =>
    Promise.resolve(owner === SAM.id ? emptySummary : summaryOut()),
  )
  renderPage()
  // findAll: the account renders in the table AND as a drill chip once seeded.
  await screen.findAllByText('My Checking')

  fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))
  // Sam owns nothing yet: the table genuinely empties.
  await waitFor(() => expect(screen.queryByText('My Checking')).toBeNull())

  // Scoped to the Owner group: the range chips carry an "All" too.
  const ownerChips = screen.getByRole('group', { name: 'Owner' })
  const allChip = [...ownerChips.querySelectorAll('button')].find(
    (b) => b.textContent === 'All',
  )
  expect(allChip).toBeTruthy()
  fireEvent.click(allChip as HTMLButtonElement)
  // The revalidation answers with a payload identical to the warm household snapshot —
  // the page must still swap the empty view back out.
  expect((await screen.findAllByText('My Checking')).length).toBeGreaterThan(0)
})

// ── Legend collision (2026-08-31 tier-1 A2) ───────────────────────────────────────────────
// One merged legend map let an account literally named "Cash" toggle the stacked chart's
// Cash GROUP off from the drill chart — silently hiding the group and shrinking the
// tooltip's Assets subtotal. The two charts now hold separate maps.
it('keeps a drill toggle on an account named "Cash" out of the stacked chart', async () => {
  vi.mocked(fetchTimeseries).mockResolvedValue(
    timeseriesOut({
      accounts: [
        {
          id: 1, name: 'Cash', slug: 'cash-account', group: 'cash', sort_order: 1,
          is_active: true, is_component: false, parent_account_id: null, person_id: 1,
        },
      ],
      series: [{ account_id: 1, values: ['100.00', '150.00'] }],
    }),
  )
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  // The drill seeds to the biggest account — the one wearing the colliding name.
  await waitFor(() =>
    expect(screen.getAllByTestId('echart')[1].getAttribute('data-series')).toBe('Cash'),
  )

  fireEvent.mouseEnter(screen.getAllByTestId('echart')[1]) // drill legend: { Cash: false }

  expect(
    JSON.parse(screen.getAllByTestId('echart')[1].getAttribute('data-legend-selected') ?? '{}'),
  ).toEqual({ Cash: false })
  // The stacked chart's own map never saw the toggle — its Cash GROUP series (and the
  // Assets subtotal the tooltip builds over it) stay untouched.
  expect(
    JSON.parse(screen.getAllByTestId('echart')[0].getAttribute('data-legend-selected') ?? '{}'),
  ).toEqual({})
})
