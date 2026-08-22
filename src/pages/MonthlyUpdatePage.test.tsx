import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { formatMonth } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'

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
    notes: [null],
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
  // Drafts live in sessionStorage, which jsdom keeps alive across tests in this file —
  // without this, one test's typed work restores itself into the next test's wizard.
  sessionStorage.clear()
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

  // Step 2: category input defaults to 0.00; net pay empty. Net pay autofocuses on this
  // step, so Food is BLURRED and shows AmountInput's formatted echo — "$0.00" here is the
  // display of the very same "0.00" state the balances step showed raw (that cell is the
  // autofocused one). State is unchanged either way; only the rendering differs.
  const foodInput = await screen.findByLabelText('Food')
  expect((foodInput as HTMLInputElement).value).toBe('$0.00')
  // The step's own autofocus, pinned rather than merely implied by the echo above.
  expect(document.activeElement).toBe(screen.getByLabelText('Net pay (take-home)'))
  fireEvent.change(foodInput, { target: { value: '250.00' } })
  // The exact label, not /net pay/i: the step's ⓘ hint carries "net pay" in its aria-label,
  // which getByLabelText reads as a label too — same box, tighter selector.
  fireEvent.change(screen.getByLabelText('Net pay (take-home)'), { target: { value: '9000.00' } })
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

it('drafts typed work and restores it after leaving and coming back', async () => {
  const first = renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: '1600.00' } })
  // Leaving is just unmounting — under a plain <BrowserRouter> there is no route guard,
  // and the draft in sessionStorage is the whole safety net.
  first.unmount()

  renderWizard()
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1600.00')
  expect(screen.getByText(/restored unsaved entries/i)).toBeTruthy()

  // Discard puts the server's seed back and forgets the draft.
  fireEvent.click(screen.getByRole('button', { name: /discard restored entries/i }))
  expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('1500.00')
  expect(screen.queryByText(/restored unsaved entries/i)).toBeNull()
})

it('forgets the draft once the month is saved', async () => {
  const first = renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  first.unmount()

  renderWizard()
  // The seed is the SERVER's again and no banner shows — the draft died with the save.
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
  expect(screen.queryByText(/restored unsaved entries/i)).toBeNull()
})

it('keeps a draft per month across ribbon switches', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })

  fireEvent.click(screen.getByRole('button', { name: 'Jun 2026 — no data' }))
  await waitFor(() =>
    expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('0.00'),
  )
  // June is untouched: no draft, no banner — August's work never leaks sideways.
  expect(screen.queryByText(/restored unsaved entries/i)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Aug 2026 — no data' }))
  await screen.findByText(/restored unsaved entries/i)
  expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('1600.00')
})

it('offers starting the month after the latest covered month', async () => {
  // Date-independent: months derive from the SAME clock the component reads, so this
  // holds whenever the run happens. Coverage through the current month = the state
  // where the old current-month-anchored ribbon offered no way to add a new month.
  const current = currentMonthIso()
  const next = addMonths(current, 1)
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === current,
    recorded_on: null,
    notes: null,
    balances: month === current ? [{ account_id: 1, balance: '1500.00' }] : [],
  }))
  vi.mocked(netWorthApi.fetchTimeseries).mockResolvedValue({
    months: [current],
    accounts: [account],
    series: [{ account_id: 1, values: ['1500.00'] }],
    group_totals: {
      cash: ['1500.00'], pre_tax: ['0.00'], post_tax: ['0.00'], taxable: ['0.00'],
      equity: ['0.00'], other: ['0.00'], liability: ['0.00'],
    },
    net_worth: ['1500.00'],
    mom_pct: [null],
    notes: [null],
  })
  render(
    <MemoryRouter initialEntries={[`/update?month=${current}`]}>
      <MonthlyUpdatePage />
    </MemoryRouter>,
  )
  await screen.findByText(/edit balances/i) // current month exists -> edit mode

  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(`start ${formatMonth(next)}`, 'i') }),
  )
  // New month: create mode, pre-filled from the just-covered current month.
  await screen.findByText(/enter balances \(pre-filled from last month\)/i)
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
  expect(netWorthApi.fetchMonthBalances).toHaveBeenCalledWith(next)
})

it('canonicalizes tolerant and =-expression entries into the PUT bodies', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: '$1,600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '=200+50' } })
  fireEvent.change(screen.getByLabelText('Net pay (take-home)'), { target: { value: '9,000' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    // No blur ever fired (jsdom clicks do not blur): canonicalAmount at the wire
    // boundary is what keeps "$1,600.00" off a Decimal column.
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [{ account_id: 1, balance: '1600.00' }],
      }),
    )
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      net_pay: '9000',
      amounts: [{ category_id: 7, amount: '250.00' }],
    })
  })
})

it('accepts spreadsheet-formatted text as valid entry', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '$1,234.56' } })
  expect(
    (screen.getByRole('button', { name: /next: spending/i }) as HTMLButtonElement).disabled,
  ).toBe(false)
})

it('Enter on the last cell of each step lands on that step primary', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  act(() => {
    balanceInput.focus()
  })
  fireEvent.keyDown(balanceInput, { key: 'Enter' })
  const balancesPrimary = screen.getByRole('button', { name: /next: spending/i })
  expect(document.activeElement).toBe(balancesPrimary)

  // The spending card is its own scope with its own primary — netPay precedes Food in DOM
  // order, so Food is that scope's last cell and Enter there finishes the step.
  fireEvent.click(balancesPrimary)
  const food = await screen.findByLabelText('Food')
  act(() => {
    food.focus()
  })
  fireEvent.keyDown(food, { key: 'Enter' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /next: review/i }))
})

it('autofocuses the first balance cell on load', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  expect(document.activeElement).toBe(balanceInput)
})

it('shows last month beside the cell and a live delta as you type', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  const row = balanceInput.closest('tr') as HTMLElement
  expect(within(row).getByText('$1,500.00')).toBeDefined() // last-month reference
  fireEvent.change(balanceInput, { target: { value: '1600.00' } })
  expect(within(row).getByText('$100.00')).toBeDefined() // live Δ
})

it('excludes components from the group subtotal and the live net worth', async () => {
  const brokerage = {
    id: 2, name: 'Brokerage', slug: 'brokerage', group: 'taxable' as const,
    sort_order: 2, is_active: true, is_component: false, parent_account_id: null,
  }
  const brokerageCash = {
    id: 3, name: 'Brokerage cash', slug: 'brokerage-cash', group: 'taxable' as const,
    sort_order: 3, is_active: true, is_component: true, parent_account_id: 2,
  }
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, brokerage, brokerageCash])
  renderWizard()
  // The badge lives inside the label, so the component's accessible name carries it too.
  const component = await screen.findByLabelText(/^Brokerage cash/)
  fireEvent.change(screen.getByLabelText('Brokerage'), { target: { value: '1000' } })
  fireEvent.change(component, { target: { value: '250' } })

  // nestComponents puts the child right after its parent, so the subtotal row follows it.
  const subtotal = (component.closest('tr') as HTMLElement).nextElementSibling as HTMLElement
  const cells = within(subtotal).getAllByRole('cell')
  expect(cells[0].textContent).toBe('Subtotal')
  expect(cells[2].textContent).toBe('$1,000.00') // the component's 250 is tracked INSIDE it
  // Same rule at the bottom line: 1,500 checking + 1,000 brokerage, component excluded.
  expect(within(screen.getByRole('status')).getByText('$2,500.00')).toBeDefined()
})

it('keeps the live net-worth footer in sync while entering balances', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '2000' } })
  const footer = screen.getByRole('status')
  expect(within(footer).getByText('$2,000.00')).toBeDefined()
})

it('a post-save blur never resurrects a phantom draft', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  // Tolerant text advanced past by CLICKS — no blur, so state keeps the raw '9,000'
  // while the wire (and the server) got the canonical '9000'.
  const netPay = await screen.findByLabelText('Net pay (take-home)')
  fireEvent.change(netPay, { target: { value: '9,000' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)

  // Back to the cell and through it once. A blur here canonicalizes state to '9000';
  // if the post-save baseline still held the RAW '9,000' the snapshot would differ from
  // it and file a draft for work that is fully saved — the next visit would then greet
  // the user with "Restored unsaved entries — they are not saved yet" about nothing.
  fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
  const again = await screen.findByLabelText('Net pay (take-home)')
  act(() => {
    // Bare .focus() outside act queues the focused re-render without flushing it
    // (React 19 emits no warning) — the blur would then run against stale render state.
    again.focus()
  })
  fireEvent.blur(again)
  expect(sessionStorage.getItem('finance-update-draft:2026-08-01')).toBeNull()
})
