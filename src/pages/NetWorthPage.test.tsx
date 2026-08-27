import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HouseholdOut, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import NetWorthPage from './NetWorthPage'

vi.mock('../api/netWorth', () => ({ fetchTimeseries: vi.fn(), fetchSummary: vi.fn() }))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each chart
// DRAWS is pinned in netWorthChartOptions.test.ts; this marker exposes only the option
// slices this page owns: series names, their stack ids, and any markLine anchor.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
    }: {
      option: {
        series?: {
          name?: string
          stack?: string
          markLine?: { data?: { xAxis?: string }[] }
        }[]
      }
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        'data-stacks': (option.series ?? []).map((s) => s.stack ?? '-').join('|'),
        'data-marriage': (option.series ?? [])
          .flatMap((s) => s.markLine?.data ?? [])
          .map((d) => d.xAxis ?? '')
          .join('|'),
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
