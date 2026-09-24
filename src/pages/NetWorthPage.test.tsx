import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import type { CoverageOut, HouseholdOut, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import { copyOnSep23, earlySnapshot, flowsPart, snapshotStateOut, timeStatus } from '../testing/timeFixtures'
import { daysBetween } from '../utils/months'
import { setServerToday } from '../utils/productToday'
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
      ariaLabel,
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
        yAxis?: { data?: string[] }
      }
      ariaLabel?: string
      onLegendChange?: (selected: Record<string, boolean>) => void
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        // ChartCard hands every mount its house sentence (F11) — the page tests read it.
        'aria-label': ariaLabel,
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        'data-stacks': (option.series ?? []).map((s) => s.stack ?? '-').join('|'),
        'data-categories': (option.yAxis?.data ?? []).join('|'),
        'data-marriage': (option.series ?? [])
          .flatMap((s) => s.markLine?.data ?? [])
          .map((d) => d.xAxis ?? '')
          .join('|'),
        'data-legend-selected': JSON.stringify(option.legend?.selected ?? null),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        // The chart's FIRST legend entry toggled off. Keyed off this chart's own series
        // name rather than a literal, because the A2 case turns on what that name IS: an
        // account named "Cash" now reports under its claimed spelling.
        onMouseEnter: () => onLegendChange?.({ [(option.series ?? [])[0]?.name ?? '']: false }),
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
    // What a current backend names beside every summary (2026-09-23 spec §K2): the snapshot's
    // date and standing, and the snapshot its delta compares with.
    as_of: '2026-08-01',
    recorded_on: '2026-08-01',
    provisional: false,
    previous: snapshotStateOut('2026-07-01'),
    days_since_previous: 31,
    ...over,
  }
}

/** The summary of `month`'s snapshot — final, recorded on its 1st — compared with `previous`'s. */
function summaryAt(month: string, previous: string | null, over: Partial<NetWorthSummary> = {}): NetWorthSummary {
  return summaryOut({
    month,
    as_of: month,
    recorded_on: month,
    provisional: false,
    previous: previous === null ? null : snapshotStateOut(previous),
    days_since_previous: previous === null ? null : daysBetween(previous, month),
    ...over,
  })
}

function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME, SAM], marriage_date: null, ...over }
}

beforeEach(() => {
  clearSnapshots()
  // useScope remembers owner and range in localStorage for the keys a URL leaves empty —
  // a scope one test picks would otherwise be the next test's default.
  localStorage.clear()
  // The product day (2026-09-23 spec §K1): Aug 1's balances are the current snapshot and the
  // ribbon ends at August — whatever the machine's clock says (setup.ts resets it after each).
  setServerToday('2026-08-20')
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
  // Nothing to choose between: the chips would be one-option UI.
  expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
  // Stack by survives — By group vs Share % is still a real choice (F2) — but the
  // whose-is-it reading has nobody to split between, so By owner drops out.
  const stackBy = await screen.findByRole('group', { name: 'Stack by' })
  expect([...stackBy.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    'By group',
    'Share %',
  ])
})

it('renders All / each person / Joint once a partner exists', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Whose' })
  expect(
    [...chips.querySelectorAll('button')].map((b) => b.textContent),
  ).toEqual(['All', 'Me', 'Sam', 'Joint'])
})

it('renders the per-owner lede on the By-group card in chip order, skipping owners the payload lacks', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Whose' })
  // Me then Joint — the fixture's owner_totals has no SAM row, and a missing owner is
  // SKIPPED, never rendered as $0.00. Order comes from the chips, so the two agree.
  const lede = document.querySelector('.chart-lede .networth-owner-lede') as HTMLElement
  expect(lede).not.toBeNull()
  expect(lede.textContent).toBe('Me $150.00 · Joint $80.00')
  expect([...lede.querySelectorAll('b.num')].map((b) => b.textContent)).toEqual(['$150.00', '$80.00'])
  // It sits INSIDE the By-group card, not loose on the page (2026-09-13 polish §10, W4).
  expect(lede.closest('.chart-card')?.querySelector('.eyebrow')?.textContent).toContain('By group over time')
  expect(document.querySelector('.networth-owner-strip')).toBeNull()
})

it('hides the owner lede for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Net worth')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  expect(document.querySelector('.networth-owner-lede')).toBeNull()
})

it('scopes BOTH fetches to the picked owner, and back to the household on All', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Whose' })
  fireEvent.click(screen.getByRole('button', { name: 'Sam' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', SAM.id))
  expect(fetchSummary).toHaveBeenCalledWith(SAM.id, undefined, 'monthly')
  expect(screen.getByRole('button', { name: 'Sam' }).getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', 'joint'))
  expect(fetchSummary).toHaveBeenCalledWith('joint', undefined, 'monthly')

  fireEvent.click(chips.querySelectorAll('button')[0])
  // null, not omitted: the client turns null into no param at all (netWorth.test.ts).
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', null))
  expect(fetchSummary).toHaveBeenLastCalledWith(null, undefined, 'monthly')
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
// The drill card is the page's last chart: the What-moved movers sit between it and
// the stack whenever a prior month exists.
const drilled = () => screen.getAllByTestId('echart').at(-1) as HTMLElement

it('stacks by group by default and by owner on demand — no refetch either way', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Stack by' })
  expect(stacked().getAttribute('data-series')).toBe(
    'Cash|Pre-tax|Post-tax|Taxable|Equity|Other|Liabilities|Net worth',
  )
  const callsBefore = vi.mocked(fetchTimeseries).mock.calls.length

  fireEvent.click(await screen.findByRole('button', { name: 'By owner' }))
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
    renderPage('/net-worth?section=accounts')
    // My Checking (150) beats Joint Savings (80) at the latest month — slot 1.
    expect(drilled().getAttribute('data-series')).toBe('My Checking')
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
  renderPage('/net-worth?section=accounts')
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

// The drill seed runs AHEAD of the identical-payload skip: the render that adopts a new
// scope clears the drill (its account ids need not exist in the next scope), and a scope
// whose payload happens to equal what is on screen used to return before the seed could
// refill it — leaving the card reading "No accounts selected." until a manual pick.
it('re-seeds the drill for a new scope whose payload is IDENTICAL to the one on screen', async () => {
  // Every owner answers with the same fixture here (the beforeEach mocks) — which is the trap.
  renderPage('/net-worth?section=accounts')
  expect(
    (await screen.findAllByRole('button', { name: 'My Checking', pressed: true })).length,
  ).toBeGreaterThan(0)

  fireEvent.click(screen.getByRole('button', { name: 'Me' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', ME.id))
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'My Checking', pressed: true }).length,
    ).toBeGreaterThan(0),
  )
  expect(screen.queryByText('No accounts selected.')).toBeNull()
})

// ── Legend collision (2026-08-31 tier-1 A2) ───────────────────────────────────────────────
// One merged legend map let an account literally named "Cash" toggle the stacked chart's
// Cash GROUP off from the drill chart — silently hiding the group and shrinking the
// tooltip's Assets subtotal. The two charts now hold separate maps — AND the drill
// claims its names (netWorthChartOptions.stackSeriesNames), because both cards ride one
// `group="net-worth"` connect group and echarts 6 relays legendselectchanged across a
// group by series NAME, which no amount of page-side map splitting can intercept.
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
  fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }))
  // The drill seeds to the biggest account — the one wearing the colliding name, which
  // therefore draws under the CLAIMED spelling. The suffix is visible on purpose: the
  // legend has to admit that this entry is the account, not the group.
  await waitFor(() =>
    expect(drilled().getAttribute('data-series')).toBe('Cash (account)'),
  )

  fireEvent.mouseEnter(drilled()) // drill legend: { 'Cash (account)': false }

  expect(
    JSON.parse(drilled().getAttribute('data-legend-selected') ?? '{}'),
  ).toEqual({ 'Cash (account)': false })
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
    expect(vi.mocked(fetchSummary)).toHaveBeenCalledWith('joint', undefined, 'monthly')
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
    renderPage('/net-worth?section=accounts')
    await screen.findByRole('heading', { level: 1, name: 'Net worth' })

    fireEvent.click(await screen.findByRole('button', { name: /^Jul 2026/ }))
    await waitFor(() =>
      expect(vi.mocked(fetchSummary)).toHaveBeenLastCalledWith(null, '2026-07-01', 'monthly'),
    )
    expect(screen.getByTestId('location').textContent).toContain('month=2026-07')
    expect(await screen.findByRole('button', { name: 'Back to latest balances' })).toBeTruthy()
    // The other verb on a viewed month: the wizard, by link rather than by selection — at the
    // step this page is about (2026-09-23 spec §T8).
    expect(screen.getByRole('link', { name: 'Edit Jul 2026 in the wizard' }).getAttribute('href')).toBe(
      '/update?month=2026-07-01&step=balances',
    )
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
    renderPage('/net-worth?section=accounts')
    const group = await screen.findByRole('group', { name: 'Accounts to compare' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'My Checking',
      'Joint Savings',
    ])
    // Scoped to the group: every account is a chip AND a table row-toggle.
    // Seeded to the biggest account; the other chip joins it in the next palette slot.
    fireEvent.click(within(group).getByRole('button', { name: 'Joint Savings' }))
    await waitFor(() =>
      expect(drilled().getAttribute('data-series')).toBe(
        'My Checking|Joint Savings',
      ),
    )
  })
})

// ── The three cards on ChartCard (charts C2, F2/F8/F9/F11/F12) ──────────────────────────
describe('NetWorthPage — chart cards', () => {
  it('mounts the stack, the movers and the drill through ChartCard: labels, export rows, Share %, one group', async () => {
    renderPage()
    await screen.findByText('By group over time')
    expect(screen.getByLabelText(/Stacked area chart of asset groups over time/)).toBeTruthy()

    expect(screen.getByText('What moved — July: Jul 1 → Aug 1')).toBeTruthy()
    expect(screen.getByLabelText(/Horizontal bar chart of how each account group moved/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Share %' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }))
    expect(screen.getByLabelText(/Line chart of the selected accounts/)).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /Export/, hidden: true })).toHaveLength(3)
    expect(screen.getAllByText('ctrl+scroll to zoom · drag to pan')).toHaveLength(2)
      })

  it('breaks the movers down by group, then by account, with the lede and the table twin', async () => {
    renderPage()
    await screen.findByText('What moved — July: Jul 1 → Aug 1')
    const card = screen.getByRole('group', { name: 'Export net-worth-movers' }).closest('section') as HTMLElement
    // Both ends named by the day their balances describe (2026-09-23 spec §T7).
    expect(card.querySelector('.chart-lede')?.textContent).toBe('Jul 1 $170.00 → Aug 1 $230.00 · +$60.00 · +35.3%')
    expect(within(card).getByTestId('echart').getAttribute('data-categories')).toBe('Cash')
    fireEvent.click(within(card).getByRole('button', { name: 'Accounts' }))
    expect(within(card).getByTestId('echart').getAttribute('data-categories')).toBe('My Checking|Joint Savings')
    expect(within(card).getByLabelText(/Horizontal bar chart of how each account moved/)).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Table' }))
    const rows = [...card.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows).toEqual([['My Checking', 'Cash', '50.00', '83%', 'Inspect'], ['Joint Savings', 'Cash', '10.00', '17%', 'Inspect']])
  })

  it('Share % swaps the stack to composition and drops the net-worth line', async () => {
    renderPage()
    await screen.findByText('By group over time')
    fireEvent.click(screen.getByRole('button', { name: 'Share %' }))
    expect(stacked().getAttribute('data-series')).toBe('Cash|Pre-tax|Post-tax|Taxable|Equity|Other')
    expect(screen.getByLabelText(/share of assets per month/)).toBeTruthy()
  })
})

// ── Independent feeds (2026-09-09 audit item 10) ─────────────────────────────────────────
// The two requests used to ride one Promise.all whose catch stored the raw server detail,
// so a 500 on the summary blanked the whole page down to the word "boom".
describe('NetWorthPage — one failed feed never blanks the page', () => {
  it('keeps the charts and the table up when the summary fails, and banners it', async () => {
    vi.mocked(fetchSummary).mockRejectedValue(new ApiError('boom', 500))
    renderPage('/net-worth?section=accounts')
    // The timeseries answered, so everything IT draws is still on screen.
    expect((await screen.findAllByText('My Checking')).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('echart').length).toBeGreaterThan(0)

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain(
      "Couldn't load the month summary — the server had a problem (HTTP 500)",
    )
    expect(within(banner).getByRole('button', { name: 'Retry the month summary' })).toBeTruthy()
    // The parts that speak FOR the summary go quiet rather than stale …
    expect(screen.queryByText('Net worth — as of Aug 1')).toBeNull()
    expect(document.querySelector('.networth-owner-lede')).toBeNull()
    expect(document.querySelector('.chart-lede')).toBeNull()
    // … and the server's own words never reach the page.
    expect(screen.queryByText('boom')).toBeNull()
  })

  it('restores the tiles when Retry answers with the very same pair', async () => {
    vi.mocked(fetchSummary).mockRejectedValueOnce(new ApiError('boom', 500))
    renderPage()
    const banner = await screen.findByRole('alert')
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry the month summary' }))
    // The identical-payload skip must not strand the tiles hidden behind a payload that
    // equals the one the failed load never got to show.
    expect(await screen.findByText('Net worth — as of Aug 1')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    // …and the feed that never failed was left alone: re-fetching it would repaint charts
    // that are already right.
    expect(fetchTimeseries).toHaveBeenCalledTimes(1)
  })

  it('names the page in the frame alert when the timeseries fails', async () => {
    vi.mocked(fetchTimeseries).mockRejectedValue(new ApiError('boom', 500))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      "Couldn't load net worth — the server had a problem (HTTP 500)",
    )
    expect(screen.queryByText('boom')).toBeNull()
  })
})

// ── An owner with no accounts (2026-09-09 audit item 11) ─────────────────────────────────
// The summary answers zeros for a scope that owns nothing, so the page drew a wall of
// $0.00 tiles over charts whose all-zero series made ECharts pick a 0..1 axis.
describe('NetWorthPage — a scope with no accounts', () => {
  const noAccounts = () =>
    timeseriesOut({
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

  it('names the person and points at Settings instead of drawing zeros', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(noAccounts())
    vi.mocked(fetchSummary).mockResolvedValue(
      summaryOut({ net_worth: '0.00', mom_delta: '0.00', mom_pct: null, owner_totals: [] }),
    )
    renderPage('/net-worth?owner=2')

    expect(await screen.findByText(/No accounts for Sam yet/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Settings → Accounts' }).getAttribute('href'),
    ).toBe('/settings#accounts')
    // Nothing that would have to invent a number is on screen.
    expect(screen.queryAllByTestId('echart')).toHaveLength(0)
    expect(screen.queryByText('Net worth — as of Aug 1')).toBeNull()
    expect(screen.queryByText(/^Accounts — /)).toBeNull()
    expect(document.querySelector('.networth-owner-lede')).toBeNull()
  })

  it('falls back to "this person" while the household payload is missing', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(noAccounts())
    vi.mocked(fetchHousehold).mockRejectedValue(new Error('household down'))
    renderPage('/net-worth?owner=2')
    expect(await screen.findByText(/No accounts for this person yet/)).toBeTruthy()
  })

  it('says so of the household itself when the whole book is empty', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(noAccounts())
    renderPage('/net-worth')
    expect(await screen.findByText(/No accounts for this household yet/)).toBeTruthy()
  })
})

// ── Quarterly tiles (2026-09-09 audit item 23) ───────────────────────────────────────────
// The summary had no grain of its own, so tiles saying "vs prior month" sat beside a
// quarterly chart and a ribbon pick landed on a column the quarterly series does not carry.
describe('NetWorthPage — the tiles follow the grain on screen', () => {
  it('reads the last column at or before the pick when that quarter has no snapshot', async () => {
    // March and September only: the client snaps August to June by the calendar, and June is
    // not in the book — the table must land on March with the tiles rather than fall back to
    // the latest quarter.
    const gapped = timeseriesOut({ months: ['2026-03-01', '2026-09-01'] })
    vi.mocked(fetchTimeseries).mockImplementation((g) =>
      Promise.resolve(g === 'quarterly' ? gapped : timeseriesOut()),
    )
    vi.mocked(fetchSummary).mockResolvedValue(summaryAt('2026-03-01', null, { period: 'quarter' }))
    renderPage('/net-worth?month=2026-08&section=accounts')
    await screen.findByRole('group', { name: 'Accounts to compare' })

    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    expect(await screen.findByText('Accounts — as of Mar 1')).toBeTruthy()
    // The tiles live on Overview now (2026-09-13 polish §12) — same snapped column, one view over.
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByText('Net worth — as of Mar 1')).toBeTruthy()
  })

  it('says so when no quarter has closed by the picked month', async () => {
    vi.mocked(fetchSummary).mockResolvedValue(
      summaryOut({ month: null, net_worth: null, mom_delta: null, mom_pct: null, groups: [], owner_totals: [], period: 'quarter' }),
    )
    renderPage('/net-worth?month=2026-08')
    await screen.findByText('By group over time')

    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    // The tiles have nothing to say, so the page says why instead of dropping them silently.
    expect(await screen.findByText('No quarter has closed by Jun 2026 yet.')).toBeTruthy()
  })

  it('prints no figure on a ribbon chip for a scope that owns nothing', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseriesOut({ accounts: [], series: [], owner_series: [], net_worth: ['0.00', '0.00'] }),
    )
    renderPage('/net-worth?owner=2')
    // The chip carries coverage alone — never a fabricated "$0.00" in its label or its aria.
    expect(
      await screen.findByRole('button', { name: 'Aug 2026 — balances entered, spending missing' }),
    ).toBeTruthy()
  })

  it('names the grain in the movers card, not the month', async () => {
    const quarterly = timeseriesOut({ months: ['2026-03-01', '2026-06-01'] })
    vi.mocked(fetchTimeseries).mockImplementation((g) =>
      Promise.resolve(g === 'quarterly' ? quarterly : timeseriesOut()),
    )
    renderPage()
    await screen.findByText('By group over time')
    expect(screen.getByLabelText(/moved net worth from the prior month to this one/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    expect(
      await screen.findByLabelText(/moved net worth from the prior quarter to this one/),
    ).toBeTruthy()
  })

  it('asks for the summary at that grain and names the quarter end it compares with', async () => {
    renderPage()
    await screen.findByText('By group over time')
    vi.mocked(fetchSummary).mockResolvedValue(
      summaryAt('2026-06-01', '2026-03-01', {
        period: 'quarter',
        groups: [{ group: 'taxable', total: '40.00', mom_delta: '15.00' }],
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    await waitFor(() =>
      expect(fetchSummary).toHaveBeenLastCalledWith(null, undefined, 'quarterly'),
    )
    // A quarter is not a month's story: the tiles say only what the change is since (§T7).
    const hero = tileFor(await screen.findByText('Net worth — as of Jun 1'))
    expect(deltaOf(hero)).toBe('▲ $60.00 (+35.3%) since Mar 1')
    expect(deltaOf(tileFor(screen.getByText('Taxable')))).toBe('▲ $15.00 since Mar 1')
    expect(screen.queryByText(/vs prior/)).toBeNull()
  })

  it('snaps a ribbon pick back to the quarter end it closes into', async () => {
    const quarterly = timeseriesOut({ months: ['2026-03-01', '2026-06-01'] })
    vi.mocked(fetchTimeseries).mockImplementation((g) =>
      Promise.resolve(g === 'quarterly' ? quarterly : timeseriesOut()),
    )
    renderPage('/net-worth?month=2026-08&section=accounts')
    await screen.findByRole('group', { name: 'Accounts to compare' })

    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    // August is not a quarter end and the quarterly series has no column for it: the page
    // asks for — and reads — the quarter that had closed by then.
    await waitFor(() =>
      expect(fetchSummary).toHaveBeenLastCalledWith(null, '2026-06-01', 'quarterly'),
    )
    expect(await screen.findByText('Accounts — as of Jun 1')).toBeTruthy()
    // The ribbon follows the snap rather than highlighting a chip the page is not showing.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('month=2026-06'),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    // A quarter's change says what it is since, not whose story it is (2026-09-23 spec §T7).
    expect(screen.getByText('What moved — since Mar 1')).toBeTruthy()
    // …and the lede names the two quarter ends by date. Scoped to the movers card: the By-group
    // card above it carries the owner lede now (2026-09-13 polish §10).
    const movers = screen.getByText('What moved — since Mar 1').closest('.chart-card') as HTMLElement
    expect(movers.querySelector('.chart-lede')?.textContent).toContain('Mar 1 $170.00 → Jun 1 $230.00')
  })
})

// ── Tiles per view (2026-09-13 polish §12) ───────────────────────────────────────────────
describe('NetWorthPage — tiles per view', () => {
  it('keeps the tiles and the owner lede to Overview, and names the month on the Accounts card', async () => {
    renderPage()
    await screen.findByText('Net worth — as of Aug 1')
    expect(document.querySelector('.networth-owner-lede')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }))
    expect(screen.queryByText('Net worth — as of Aug 1')).toBeNull()
    expect(document.querySelector('.loading-dim > .kpi-row')).toBeNull()
    // The card names the day its balances describe (C2, 2026-09-23 spec §T7) — "latest" is
    // reserved for a book with no column.
    expect(screen.getByRole('heading', { name: /Accounts — as of Aug 1/ })).toBeTruthy()
    expect(screen.queryByText(/Accounts — latest month/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByText('Net worth — as of Aug 1')).toBeTruthy()
  })
})

// The tiles are addressed through their labels, like the Overview's (a tile is a label, a value
// and sometimes a delta).
function tileFor(label: HTMLElement): HTMLElement {
  const tile = label.closest('.stat-tile')
  expect(tile).not.toBeNull()
  return tile as HTMLElement
}
const deltaOf = (tile: HTMLElement) => tile.querySelector('.stat-delta')?.textContent ?? null

// ── The snapshot named by its date (2026-09-23 spec §T7, §T8) ────────────────────────────
// A net-worth snapshot is the balances on its 1st, so the page names it by that day — never by
// a month key, and never "vs prior month": the change into Aug 1 is July's story.
describe('NetWorthPage — the snapshot named by its date (2026-09-23 spec §T7)', () => {
  it('names the hero by the day its balances describe and the change by the month it covers', async () => {
    vi.mocked(fetchSummary).mockResolvedValue(
      summaryAt('2026-08-01', '2026-07-01', { groups: [{ group: 'liability', total: '-20.00', mom_delta: '-5.00' }] }),
    )
    renderPage()
    const hero = tileFor(await screen.findByText('Net worth — as of Aug 1'))
    expect(deltaOf(hero)).toBe('▲ $60.00 (+35.3%) · July: Jul 1 → Aug 1')
    expect(hero.textContent).not.toContain('Provisional')
    // The group tiles say what their change is since.
    expect(deltaOf(tileFor(screen.getByText('Liabilities')))).toBe('▼ -$5.00 since Jul 1')
    expect(screen.queryByText(/vs prior|MoM/)).toBeNull()
  })

  it('reads an older payload without dates as final, as of its 1st, with no span to name', async () => {
    const older: NetWorthSummary = {
      month: '2026-08-01', net_worth: '230.00', mom_delta: '60.00', mom_pct: '0.352941', groups: [], owner_totals: [],
    }
    vi.mocked(fetchSummary).mockResolvedValue(older)
    renderPage()
    const hero = tileFor(await screen.findByText('Net worth — as of Aug 1'))
    expect(deltaOf(hero)).toBe('▲ $60.00 (+35.3%)')
  })

  it('heads the accounts table with the snapshot’s date and the change column with the one before', async () => {
    renderPage('/net-worth?section=accounts')
    expect(await screen.findByRole('heading', { name: /Accounts — as of Aug 1/ })).toBeTruthy()
    const headers = [...document.querySelectorAll('.data-table thead th')].map((th) => th.textContent)
    // The % column keeps its values; only what it compares with is named.
    expect(headers).toEqual(['Account', 'Group', 'Balance', 'Change since Jul 1'])
  })

  it('opens on the current snapshot — balances filed further ahead are never the default', async () => {
    // Dec 1 typed in August by mistake: the server's summary answers Aug 1 (K2's rule), so the
    // table, What moved and the ribbon's Edit must too, rather than Dec's column.
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseriesOut({
        months: ['2026-07-01', '2026-08-01', '2026-12-01'],
        series: [
          { account_id: 1, values: ['100.00', '150.00', '999.00'] },
          { account_id: 2, values: ['70.00', '80.00', '1.00'] },
        ],
        group_totals: {
          cash: ['170.00', '230.00', '1000.00'], pre_tax: ['0.00', '0.00', '0.00'], post_tax: ['0.00', '0.00', '0.00'],
          taxable: ['0.00', '0.00', '0.00'], equity: ['0.00', '0.00', '0.00'], other: ['0.00', '0.00', '0.00'],
          liability: ['0.00', '0.00', '0.00'],
        },
        net_worth: ['170.00', '230.00', '1000.00'],
        mom_pct: [null, '0.352941', '3.347826'],
        notes: [null, null, null],
        owner_series: [],
        as_of: ['2026-07-01', '2026-08-01', '2026-08-18'],
        recorded_on: ['2026-07-01', '2026-08-01', '2026-08-18'],
        provisional: [false, false, true],
      }),
    )
    renderPage('/net-worth?section=accounts')
    expect(await screen.findByRole('heading', { name: /Accounts — as of Aug 1/ })).toBeTruthy()
    const table = document.querySelector('.data-table') as HTMLElement
    expect(within(table).getByRole('button', { name: 'My Checking' }).closest('tr')?.textContent).toContain('$150.00')
    expect(screen.queryByText('$999.00')).toBeNull()
    // Edit opens the month on screen, at the balances step; nothing to go back to.
    expect(screen.getByRole('link', { name: 'Edit Aug 2026 in the wizard' }).getAttribute('href')).toBe(
      '/update?month=2026-08-01&step=balances',
    )
    expect(screen.queryByRole('button', { name: 'Back to latest balances' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByText('What moved — July: Jul 1 → Aug 1')).toBeTruthy()
  })

  it('adds the month’s story while its spending is still due, like the Overview (§T1)', async () => {
    setServerToday('2026-10-03')
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-09-01', '2026-10-01'],
      spending: [],
      net_pay: [],
      time: timeStatus('2026-10-03', { flows_due: [flowsPart('2026-09-01', { spending: 'partial' })] }),
    })
    vi.mocked(fetchSummary).mockResolvedValue(
      summaryAt('2026-10-01', '2026-09-01', { net_worth: '933250.90', mom_delta: '126583.02', mom_pct: '0.156920' }),
    )
    renderPage()
    const hero = tileFor(await screen.findByText('Net worth — as of Oct 1'))
    await waitFor(() =>
      expect(deltaOf(hero)).toBe('▲ $126,583.02 (+15.7%) · September: Sep 1 → Oct 1 · spending not complete yet'),
    )
  })

  describe('with Oct 1 balances typed early, on Sep 22', () => {
    const early = earlySnapshot('2026-10-01', '2026-09-22')
    const threeMonths = () =>
      timeseriesOut({
        months: ['2026-08-01', '2026-09-01', '2026-10-01'],
        series: [
          { account_id: 1, values: ['700000.00', '720000.00', '830000.00'] },
          { account_id: 2, values: ['80000.00', '86667.88', '103250.90'] },
        ],
        group_totals: {
          cash: ['780000.00', '806667.88', '933250.90'], pre_tax: ['0.00', '0.00', '0.00'], post_tax: ['0.00', '0.00', '0.00'],
          taxable: ['0.00', '0.00', '0.00'], equity: ['0.00', '0.00', '0.00'], other: ['0.00', '0.00', '0.00'],
          liability: ['0.00', '0.00', '0.00'],
        },
        net_worth: ['780000.00', '806667.88', '933250.90'],
        mom_pct: [null, '0.034189', '0.156920'],
        notes: [null, null, null],
        owner_series: [],
        as_of: ['2026-08-01', '2026-09-01', '2026-09-22'],
        recorded_on: ['2026-08-01', '2026-09-01', '2026-09-22'],
        provisional: [false, false, true],
      })
    const coverage = (): CoverageOut => ({
      balances: ['2026-08-01', '2026-09-01', '2026-10-01'],
      spending: ['2026-08-01'],
      net_pay: ['2026-08-01'],
      time: copyOnSep23(),
    })
    const provisionalSummary = () =>
      summaryOut({
        month: '2026-10-01',
        net_worth: '933250.90',
        mom_delta: '126583.02',
        mom_pct: '0.156920',
        as_of: early.as_of,
        recorded_on: early.recorded_on,
        provisional: true,
        previous: snapshotStateOut('2026-09-01'),
        days_since_previous: 21,
      })

    beforeEach(() => {
      setServerToday('2026-09-23')
      vi.mocked(fetchTimeseries).mockResolvedValue(threeMonths())
      vi.mocked(fetchCoverage).mockResolvedValue(coverage())
      vi.mocked(fetchSummary).mockImplementation((_owner, month) =>
        Promise.resolve(
          month === '2026-09-01'
            ? summaryAt('2026-09-01', '2026-08-01', { net_worth: '806667.88', mom_delta: '26667.88', mom_pct: '0.034189' })
            : provisionalSummary(),
        ),
      )
    })

    it('reads the hero as provisional, as of the day they were typed, and the change since Sep 1', async () => {
      renderPage()
      const hero = tileFor(await screen.findByText('Net worth — as of Sep 22'))
      expect(hero.textContent).toContain('Provisional')
      expect(deltaOf(hero)).toBe('▲ $126,583.02 (+15.7%) since Sep 1 · 21 days')
      expect(screen.getByText('What moved — since Sep 1 · 21 days (provisional)')).toBeTruthy()
      const movers = screen.getByText('What moved — since Sep 1 · 21 days (provisional)').closest('.chart-card') as HTMLElement
      expect(movers.querySelector('.chart-lede')?.textContent).toContain('Sep 1 $806,667.88 → Sep 22 (provisional) $933,250.90')
    })

    it('carries the day they describe, the provisional completeness and the reason on the receipt', async () => {
      renderPage()
      await screen.findByText('Net worth — as of Sep 22')
      fireEvent.click(screen.getByRole('button', { name: /^About this number: Net worth/ }))
      expect(
        await screen.findByText(/at this recorded snapshot\. Recorded Sep 22\. Balances recorded before their date stay provisional until saved again on or after it\./),
      ).toBeTruthy()
      expect(screen.getAllByText('Provisional — recorded before its date').length).toBeGreaterThan(0)
      expect(screen.getAllByText('2026-09-22').length).toBeGreaterThan(0)
    })

    it('makes October a chip that is pressed when viewed, and the current snapshot needs no way back', async () => {
      renderPage('/net-worth?section=accounts')
      await screen.findByRole('heading', { name: /Accounts — as of Sep 22 · provisional/ })
      const october = await screen.findByRole('button', { name: /^Oct 2026/ })
      fireEvent.click(october)
      await waitFor(() => expect(fetchSummary).toHaveBeenLastCalledWith(null, '2026-10-01', 'monthly'))
      expect(screen.getByRole('button', { name: /^Oct 2026/ }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('location').textContent).toContain('month=2026-10')
      // October IS the page's default month: "Back to latest balances" would go nowhere.
      expect(screen.queryByRole('button', { name: 'Back to latest balances' })).toBeNull()
      expect(screen.getByRole('link', { name: 'Edit Oct 2026 in the wizard' }).getAttribute('href')).toBe(
        '/update?month=2026-10-01&step=balances',
      )
    })

    it('views September as the final month it is, and comes back to the provisional October', async () => {
      renderPage('/net-worth?section=accounts')
      fireEvent.click(await screen.findByRole('button', { name: /^Sep 2026/ }))
      expect(await screen.findByRole('heading', { name: /Accounts — as of Sep 1/ })).toBeTruthy()
      const headers = [...document.querySelectorAll('.data-table thead th')].map((th) => th.textContent)
      expect(headers.at(-1)).toBe('Change since Aug 1')
      fireEvent.click(await screen.findByRole('button', { name: 'Back to latest balances' }))
      expect(await screen.findByRole('heading', { name: /Accounts — as of Sep 22 · provisional/ })).toBeTruthy()
    })
  })
})
