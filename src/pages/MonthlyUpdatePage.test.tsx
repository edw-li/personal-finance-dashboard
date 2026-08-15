import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MonthlyUpdatePage from './MonthlyUpdatePage'

vi.mock('../api/netWorth', () => ({
  fetchAccounts: vi.fn(),
  fetchMonthBalances: vi.fn(),
  fetchTimeseries: vi.fn(),
  putMonthBalances: vi.fn(),
}))
vi.mock('../api/spending', () => ({
  fetchCategories: vi.fn(),
  fetchSpendingMonth: vi.fn(),
  putSpendingMonth: vi.fn(),
}))

import * as netWorthApi from '../api/netWorth'
import * as spendingApi from '../api/spending'

const account = {
  id: 1, name: 'Checking', slug: 'checking', group: 'cash' as const,
  sort_order: 1, is_active: true, is_component: false, parent_account_id: null,
}
const category = { id: 7, name: 'Food', slug: 'food', sort_order: 1, is_active: true }

beforeEach(() => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances: month === '2026-07-01' ? [{ account_id: 1, balance: '1500.00' }] : [],
  }))
  vi.mocked(netWorthApi.putMonthBalances).mockResolvedValue({
    month: '2026-08-01', snapshot_created: true, created: 1, updated: 0, unchanged: 0,
  })
  vi.mocked(netWorthApi.fetchTimeseries).mockResolvedValue({
    months: ['2026-07-01'],
    accounts: [account],
    series: [{ account_id: 1, values: ['1500.00'] }],
    group_totals: {
      cash: ['1500.00'], pre_tax: ['0.00'], post_tax: ['0.00'], taxable: ['0.00'],
      equity: ['0.00'], other: ['0.00'], liability: ['0.00'],
    },
    net_worth: ['1500.00'],
    mom_pct: [null],
  })
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category])
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: false, net_pay: null, amounts: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 1, updated: 0, unchanged: 0, net_pay_set: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/update?month=2026-08-01']}>
      <MonthlyUpdatePage />
    </MemoryRouter>,
  )
}

it('walks balances -> spending -> review and submits both PUTs', async () => {
  renderWizard()
  // Step 1: balance input pre-filled from the prior month (2026-07 snapshot).
  const balanceInput = await screen.findByLabelText('Checking')
  expect((balanceInput as HTMLInputElement).value).toBe('1500.00')
  fireEvent.change(balanceInput, { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))

  // Step 2: category input defaults to 0.00; net pay empty.
  const foodInput = await screen.findByLabelText('Food')
  expect((foodInput as HTMLInputElement).value).toBe('0.00')
  fireEvent.change(foodInput, { target: { value: '250.00' } })
  fireEvent.change(screen.getByLabelText(/net pay/i), { target: { value: '9000.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))

  // Step 3: preview totals, then save.
  await screen.findByText(/review & save/i)
  expect(screen.getByText('$1,600.00')).toBeDefined() // net worth preview
  fireEvent.click(screen.getByRole('button', { name: /save month/i }))

  await waitFor(() => {
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [{ account_id: 1, balance: '1600.00' }],
        notes: null, // blank notes field CLEARS server-side — load-bearing contract
        recorded_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      net_pay: '9000.00',
      amounts: [{ category_id: 7, amount: '250.00' }],
    })
  })
  await screen.findByText(/month saved/i)
})

it('blocks Next while a balance is not a number', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: 'abc' } })
  expect(
    (screen.getByRole('button', { name: /next: spending/i }) as HTMLButtonElement).disabled,
  ).toBe(true)
})

it('resets notes/date on month switch and survives same-month clicks', async () => {
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-08-01',
    recorded_on: month === '2026-08-01' ? '2026-08-05' : null,
    notes: month === '2026-08-01' ? 'august note' : null,
    balances: month === '2026-08-01' ? [{ account_id: 1, balance: '1500.00' }] : [],
  }))
  renderWizard()
  const notesInput = (await screen.findByLabelText(/notes/i)) as HTMLInputElement
  expect(notesInput.value).toBe('august note')

  // Clicking the already-selected month must NOT blank the wizard (the [month]
  // effect never re-runs, so nothing would ever clear an unconditional loading flip).
  fireEvent.click(screen.getByRole('button', { name: 'Aug 2026 — no data' }))
  expect(screen.getByLabelText('Checking')).toBeDefined()

  // Switching months must reset notes/date — never leak them into the new month.
  fireEvent.click(screen.getByRole('button', { name: 'Jun 2026 — no data' }))
  await waitFor(() => {
    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).value).toBe('')
  })
  expect(
    (screen.getByLabelText(/recorded on/i) as HTMLInputElement).value,
  ).not.toBe('2026-08-05')
})
