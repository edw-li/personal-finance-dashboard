import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import type { HouseholdOut, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import NetWorthPage from './NetWorthPage'

vi.mock('../api/netWorth', () => ({ fetchTimeseries: vi.fn(), fetchSummary: vi.fn() }))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// The scope row's ribbon feed (Plan 1b): two-tone chips need to know which months carry
// balances, and the page's own timeseries is no longer that source.
vi.mock('../api/coverage', () => ({ fetchCoverage: vi.fn() }))
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
import { fetchCoverage } from '../api/coverage'
import { fetchHousehold } from '../api/household'

const ME = { id: 1, name: 'Me', is_primary: true }
// My Checking's JULY column in the timeseries fixture — the balance the accounts table
// must swap to once the ribbon views that month.
const JULY_CHECKING_BALANCE = '$100.00'
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
  // useScope remembers owner and range in localStorage for the keys a URL leaves empty —
  // a scope one test picks would otherwise be the next test's default.
  localStorage.clear()
  vi.mocked(fetchTimeseries).mockResolvedValue(timeseriesOut())
  vi.mocked(fetchSummary).mockResolvedValue(summaryOut())
  vi.mocked(fetchHousehold).mockResolvedValue(household())
  vi.mocked(fetchCoverage).mockResolvedValue({
    balances: ['2026-07-01', '2026-08-01'],
    spending: [],
    net_pay: [],
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

// Routed, not bare: navigating away has to really UNMOUNT the page the way the app's router
// does, or the page's own scope normalization would re-stamp ?owner= onto the destination.
function renderPage(entry = '/net-worth') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/net-worth" element={<NetWorthPage />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

// The palette's account entries deep-link by SLUG (2026-09-03 shell spec §9). findAll:
// each account is a drill chip AND a table row, and both mirror the same selection.
it('drills the account named by ?drill=<slug>, waiting for the payload to arrive', async () => {
  renderPage('/net-worth?drill=joint-savings')
  // Joint Savings (80) loses the biggest-account seed to My Checking (150), so a pressed
  // chip can only come from the arrival — which had to survive until the fetch resolved.
  expect(
    (await screen.findAllByRole('button', { name: 'Joint Savings', pressed: true })).length,
  ).toBeGreaterThan(0)
  expect(screen.queryAllByRole('button', { name: 'My Checking', pressed: true })).toHaveLength(0)
})

it('ignores a ?drill= slug no account answers to', async () => {
  renderPage('/net-worth?drill=not-an-account')
  // The seed stands rather than an empty drill card: an unresolvable slug is not a command.
  expect(
    (await screen.findAllByRole('button', { name: 'My Checking', pressed: true })).length,
  ).toBeGreaterThan(0)
})

it('hides the owner controls entirely for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Net worth')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  // Nothing to choose between: chips and the stack toggle would both be one-option UI.
  expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
  expect(screen.queryByRole('group', { name: 'Stack by' })).toBeNull()
})

it('renders All / each person / Joint once a partner exists', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Whose' })
  expect(
    [...chips.querySelectorAll('button')].map((b) => b.textContent),
  ).toEqual(['All', 'Me', 'Sam', 'Joint'])
})

it('renders the per-owner strip in chip order, skipping owners the payload lacks', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Whose' })
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
  const chips = await screen.findByRole('group', { name: 'Whose' })
  fireEvent.click(screen.getByRole('button', { name: 'Sam' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', SAM.id))
  expect(fetchSummary).toHaveBeenCalledWith(SAM.id, undefined)
  expect(screen.getByRole('button', { name: 'Sam' }).getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', 'joint'))
  expect(fetchSummary).toHaveBeenCalledWith('joint', undefined)

  fireEvent.click(chips.querySelectorAll('button')[0])
  // null, not omitted: the client turns null into no param at all (netWorth.test.ts).
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', null))
  expect(fetchSummary).toHaveBeenLastCalledWith(null, undefined)
})

it('keeps the page alive when the household endpoint fails', async () => {
  vi.mocked(fetchHousehold).mockRejectedValue(new Error('household down'))
  renderPage()
  // The scope control is an affordance; losing it must cost the chips and nothing else.
  expect(await screen.findByText('Net worth')).toBeTruthy()
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalled())
  expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
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
  await screen.findByRole('group', { name: 'Whose' })
  expect(stacked().getAttribute('data-marriage')).toBe('')
})

describe('NetWorthPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints instantly from a seeded snapshot and still revalidates', () => {
    setSnapshot('networth:monthly:all:latest', { ts: timeseriesOut(), summary: summaryOut() })
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
    setSnapshot('networth:monthly:all:latest', { ts: timeseriesOut(), summary: summaryOut() })
    vi.mocked(fetchTimeseries).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchSummary).mockReturnValue(new Promise(() => {}))
    renderPage()
    // My Checking (150) beats Joint Savings (80) at the latest month — slot 1.
    expect(screen.getAllByTestId('echart')[1].getAttribute('data-series')).toBe('My Checking')
    expect(screen.queryByText('No accounts selected.')).toBeNull()
  })

  it('a changed revalidation payload updates the page and re-arms the charts', async () => {
    setSnapshot('networth:monthly:all:latest', { ts: timeseriesOut(), summary: summaryOut() })
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
    setSnapshot('networth:monthly:all:latest', { ts: timeseriesOut(), summary: summaryOut() })
    const { container } = renderPage()
    // The dim lifting is the revalidation landing — .finally runs on every resolution.
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })

  it('keys the snapshot by granularity — a quarterly flip is a cache MISS', async () => {
    setSnapshot('networth:monthly:all:latest', { ts: timeseriesOut(), summary: summaryOut() })
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

  // Scoped to the owner group: the range chips carry an "All" too.
  const ownerChips = screen.getByRole('group', { name: 'Whose' })
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
  await screen.findByRole('group', { name: 'Whose' })
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

describe('NetWorthPage — shell scope', () => {
  it('reads owner and range from the URL and fetches accordingly', async () => {
    renderPage('/net-worth?owner=joint&range=ytd')
    await screen.findByRole('heading', { level: 1, name: 'Net worth' })

    await waitFor(() =>
      expect(vi.mocked(fetchTimeseries)).toHaveBeenCalledWith('monthly', 'joint'),
    )
    expect(vi.mocked(fetchSummary)).toHaveBeenCalledWith('joint', undefined)
    expect(screen.getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('picking an owner in the scope row rewrites the URL and refetches that scope', async () => {
    renderPage('/net-worth')
    fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))

    await waitFor(() =>
      expect(vi.mocked(fetchTimeseries)).toHaveBeenLastCalledWith('monthly', SAM.id),
    )
    expect(screen.getByTestId('location').textContent).toContain('owner=2')
  })

  it('viewing a month through the ribbon fetches that month\u2019s summary and shows its balances', async () => {
    renderPage('/net-worth')
    await screen.findByRole('heading', { level: 1, name: 'Net worth' })

    fireEvent.click(await screen.findByRole('button', { name: /^Jul 2026/ }))
    await waitFor(() =>
      expect(vi.mocked(fetchSummary)).toHaveBeenLastCalledWith(null, '2026-07-01'),
    )
    expect(screen.getByTestId('location').textContent).toContain('month=2026-07')
    expect(await screen.findByRole('button', { name: 'Back to latest' })).toBeTruthy()
    // The other verb on a viewed month: the wizard, by link rather than by selection.
    expect(screen.getByRole('link', { name: 'Edit Jul 2026 in the wizard' })).toBeTruthy()
    // The accounts table's Balance column now reads July's figures from the timeseries.
    expect(screen.getByText(JULY_CHECKING_BALANCE)).toBeTruthy()
  })

  it('prints each month\u2019s net worth on its ribbon chip', async () => {
    renderPage('/net-worth')
    // The figure rides the timeseries, so a chip only carries it once the payload lands.
    expect(
      await screen.findByRole('button', {
        name: 'Aug 2026 — $230.00 — balances entered, spending missing',
      }),
    ).toBeTruthy()
  })

  it('dims the body while the viewed month\u2019s summary is in flight', async () => {
    const { container } = renderPage('/net-worth')
    await screen.findByRole('heading', { level: 1, name: 'Net worth' })
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())

    vi.mocked(fetchTimeseries).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchSummary).mockReturnValue(new Promise(() => {}))
    fireEvent.click(await screen.findByRole('button', { name: /^Jul 2026/ }))
    // The table swaps to July's column at once; the tiles still belong to the old month, so
    // the dim is what says so.
    expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
  })

  it('defaults the page-level range to 1Y', async () => {
    renderPage('/net-worth')
    expect(
      (await screen.findByRole('button', { name: '1Y' })).getAttribute('aria-pressed'),
    ).toBe('true')
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('range=1y'),
    )
  })

  it('renders no bespoke header, owner row, or range chips of its own', async () => {
    renderPage('/net-worth')
    await screen.findByRole('heading', { level: 1, name: 'Net worth' })

    expect(document.querySelector('.page-header')).toBeNull()
    expect(document.querySelector('.networth-owner-row')).toBeNull()
    // Exactly one time-range control on the page: the scope row's.
    expect(document.querySelectorAll('[aria-label="Time range"]')).toHaveLength(1)
  })

  it('keeps the drill chips in one labelled group that adds rather than replaces', async () => {
    renderPage('/net-worth')
    const group = await screen.findByRole('group', { name: 'Accounts to compare' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'My Checking',
      'Joint Savings',
    ])
    // Scoped to the group: every account is a chip AND a table row-toggle.
    // Seeded to the biggest account; the other chip joins it in the next palette slot.
    fireEvent.click(within(group).getByRole('button', { name: 'Joint Savings' }))
    await waitFor(() =>
      expect(screen.getAllByTestId('echart')[1].getAttribute('data-series')).toBe(
        'My Checking|Joint Savings',
      ),
    )
  })
})
