import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NetWorthTimeseries } from '../../types/api'
import { setServerToday } from '../../utils/productToday'
import OverviewChanges from './OverviewChanges'

afterEach(cleanup)
beforeEach(() => setServerToday('2026-09-23'))

const ACCOUNT = (id: number, name: string) => ({
  id, name, slug: name.toLowerCase(), group: 'taxable' as const, sort_order: id,
  is_active: true, is_component: false, parent_account_id: null, person_id: null,
})

// Sep 1 on its 1st, Oct 1 typed early on Sep 22 (the real-data copy's shape), and — in one case —
// balances filed for Dec, which are never the current snapshot (2026-09-23 spec §K2).
function ts(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-09-01', '2026-10-01'],
    accounts: [ACCOUNT(1, 'Brokerage'), ACCOUNT(2, 'Savings')],
    series: [
      { account_id: 1, values: ['1000.00', '1500.00'] },
      { account_id: 2, values: ['800.00', '700.00'] },
    ],
    group_totals: { cash: [], pre_tax: [], post_tax: [], taxable: [], equity: [], other: [], liability: [] },
    net_worth: ['1800.00', '2200.00'],
    mom_pct: [null, '0.222222'],
    notes: [null, null],
    owner_series: [],
    as_of: ['2026-09-01', '2026-09-22'],
    recorded_on: ['2026-09-01', '2026-09-22'],
    provisional: [false, true],
    ...over,
  }
}

const mount = (data: NetWorthTimeseries) =>
  render(
    <MemoryRouter>
      <OverviewChanges data={data} />
    </MemoryRouter>,
  )

describe('OverviewChanges — movements named by date (2026-09-23 spec §T1)', () => {
  it('names the balances the change runs from, and that the latest are provisional', () => {
    mount(ts())
    expect(screen.getByText('Largest account movements since Sep 1 · to Sep 22 (provisional)')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Brokerage' }).getAttribute('href')).toBe(
      '/net-worth?section=accounts&month=2026-10-01',
    )
  })

  it('reads plainly between two final 1sts', () => {
    setServerToday('2026-10-02')
    mount(ts({ as_of: ['2026-09-01', '2026-10-01'], recorded_on: ['2026-09-01', '2026-10-01'], provisional: [false, false] }))
    expect(screen.getByText('Largest account movements since Sep 1')).toBeTruthy()
  })

  it('compares the CURRENT snapshot with the one before it — never balances filed further ahead', () => {
    const ahead = ts({
      months: ['2026-09-01', '2026-10-01', '2026-12-01'],
      series: [
        { account_id: 1, values: ['1000.00', '1500.00', '9000.00'] },
        { account_id: 2, values: ['800.00', '700.00', '700.00'] },
      ],
      net_worth: ['1800.00', '2200.00', '9700.00'],
      as_of: ['2026-09-01', '2026-09-22', null],
      recorded_on: ['2026-09-01', '2026-09-22', null],
      provisional: [false, true, true],
    })
    mount(ahead)
    expect(screen.getByText('Largest account movements since Sep 1 · to Sep 22 (provisional)')).toBeTruthy()
    expect(screen.getByText('+$500.00')).toBeTruthy()
    expect(screen.queryByText('+$7,500.00')).toBeNull()
  })
})
