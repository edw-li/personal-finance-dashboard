import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSnapshots } from '../api/snapshotCache'
import type { NetWorthSummary, NetWorthTimeseries } from '../types/api'
import NetWorthPage from './NetWorthPage'

// Its own file, not NetWorthPage.test.tsx: that file is being rewritten by the concurrent
// correctness batch (lane T), and this pin has to merge beside it untouched (2026-09-24
// table-scroll spec §5.2). The harness is that file's, trimmed to what the accounts table needs.
vi.mock('../api/netWorth', () => ({ fetchTimeseries: vi.fn(), fetchSummary: vi.fn() }))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
vi.mock('../api/coverage', () => ({ fetchCoverage: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law).
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', { 'data-testid': 'echart' }) }
})

import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchCoverage } from '../api/coverage'
import { fetchHousehold } from '../api/household'

const TIMESERIES: NetWorthTimeseries = {
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
}

const SUMMARY: NetWorthSummary = {
  month: '2026-08-01',
  net_worth: '230.00',
  mom_delta: '60.00',
  mom_pct: '0.352941',
  groups: [],
  owner_totals: [
    { person_id: 1, name: 'Me', total: '150.00' },
    { person_id: null, name: null, total: '80.00' },
  ],
}

beforeEach(() => {
  clearSnapshots()
  localStorage.clear()
  vi.mocked(fetchTimeseries).mockResolvedValue(TIMESERIES)
  vi.mocked(fetchSummary).mockResolvedValue(SUMMARY)
  vi.mocked(fetchHousehold).mockResolvedValue({ people: [{ id: 1, name: 'Me', is_primary: true }], marriage_date: null })
  vi.mocked(fetchCoverage).mockResolvedValue({ balances: ['2026-07-01', '2026-08-01'], spending: [], net_pay: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('scrolls the accounts table inside a capped, named box, its Net worth row pinned inside it (2026-09-24 table-scroll spec §3.6)', async () => {
  render(
    <MemoryRouter initialEntries={['/net-worth?section=accounts']}>
      <Routes>
        <Route path="/net-worth" element={<NetWorthPage />} />
      </Routes>
    </MemoryRouter>,
  )
  const box = await screen.findByRole('region', { name: 'Accounts table' })
  expect(box.className).toBe('table-scroll')
  const table = box.querySelector<HTMLElement>(':scope > table.data-table')!
  expect(within(table).getByRole('button', { name: 'My Checking' })).toBeTruthy()
  expect(await within(table).findByText('Net worth')).toBeTruthy()
  expect(table.querySelector('tfoot')?.textContent).toContain('Net worth')
})
