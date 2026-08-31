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
  fetchMatrix: vi.fn(),
  fetchSpendingMonth: vi.fn(),
  putSpendingMonth: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))

import * as netWorthApi from '../api/netWorth'
import * as spendingApi from '../api/spending'
import * as householdApi from '../api/household'
import { formatMonth } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'

const account = {
  id: 1, name: 'Checking', slug: 'checking', group: 'cash' as const,
  sort_order: 1, is_active: true, is_component: false, parent_account_id: null,
  person_id: 1,
}
// The default fixture is one account, which cannot show ORDER — the paste tests that care
// about where a range lands opt into this second row.
const savings = {
  id: 2, name: 'Savings', slug: 'savings', group: 'cash' as const,
  sort_order: 2, is_active: true, is_component: false, parent_account_id: null,
  person_id: 1,
}
// Owner-grouping fixtures: one per ownership kind, in three different groups so the walk's
// owner → group → row nesting is unambiguous in the assertions.
const samBrokerage = {
  id: 3, name: 'Sam Brokerage', slug: 'sam-brokerage', group: 'taxable' as const,
  sort_order: 3, is_active: true, is_component: false, parent_account_id: null,
  person_id: 2,
}
const jointSavings = {
  id: 4, name: 'Joint Savings', slug: 'joint-savings', group: 'cash' as const,
  sort_order: 4, is_active: true, is_component: false, parent_account_id: null,
  person_id: null,
}
const creditCard = {
  id: 5, name: 'Visa', slug: 'visa', group: 'liability' as const,
  sort_order: 5, is_active: true, is_component: false, parent_account_id: null,
  person_id: 1,
}
const category = { id: 7, name: 'Food', slug: 'food', sort_order: 1, is_active: true }

beforeEach(() => {
  // One-person household by default: every pre-existing test in this file asserts the FLAT
  // group walk, and that is exactly what a single person must keep rendering.
  vi.mocked(householdApi.fetchHousehold).mockResolvedValue({
    people: [{ id: 1, name: 'Me', is_primary: true }],
    marriage_date: null,
  })
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
    owner_series: [],
  })
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category])
  // One prior month of history for Food — the spending step's "Typical" column reads it
  // (a single sample IS its own median).
  vi.mocked(spendingApi.fetchMatrix).mockResolvedValue({
    months: ['2026-07-01'],
    categories: [],
    series: [{ category_id: 7, values: ['300.00'], budgets: [null] }],
    totals: [],
    net_pay: [],
    savings_rate: [],
    four_pct_rule: [],
    total_budget: [null],
  })
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: false, net_pay: null, amounts: [], budgets: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 1, updated: 0, unchanged: 0,
    net_pay_set: true, net_pay_cleared: false,
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
  // The balance-suggestion chips were removed end to end (spec §5.2 amendment): the cell
  // is the box and nothing else — no computed "suggested $X · Apply" offer under it.
  expect(screen.queryByText(/suggested/)).toBeNull()
  fireEvent.change(balanceInput, { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))

  // Step 2: category input defaults to 0.00; net pay empty. Net pay autofocuses on this
  // step, so Food is BLURRED and shows AmountInput's formatted echo — "$0.00" here is the
  // display of the very same "0.00" state the balances step showed raw (that cell is the
  // autofocused one). State is unchanged either way; only the rendering differs.
  const foodInput = await screen.findByLabelText('Food')
  expect((foodInput as HTMLInputElement).value).toBe('$0.00')
  // The step's own autofocus, pinned rather than merely implied by the echo above.
  expect(document.activeElement).toBe(screen.getByLabelText('Household take-home'))
  fireEvent.change(foodInput, { target: { value: '250.00' } })
  // The exact label, not /take-home/i: the step's ⓘ hint carries "take-home" in its
  // aria-label, which getByLabelText reads as a label too — same box, tighter selector.
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9000.00' } })
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
    owner_series: [],
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
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9,000' } })
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
  const deltaCell = within(row).getByText('$100.00') // live Δ
  // Tone, not just the number: on BALANCES a rise is the good direction (the spending
  // table deliberately inverts this, and only a class pin can tell the two apart).
  expect(deltaCell.className).toContain('delta-positive')
})

it('excludes components from the group subtotal and the live net worth', async () => {
  const brokerage = {
    id: 2, name: 'Brokerage', slug: 'brokerage', group: 'taxable' as const,
    sort_order: 2, is_active: true, is_component: false, parent_account_id: null, person_id: null,
  }
  const brokerageCash = {
    id: 3, name: 'Brokerage cash', slug: 'brokerage-cash', group: 'taxable' as const,
    sort_order: 3, is_active: true, is_component: true, parent_account_id: 2, person_id: null,
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
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(within(footer).getByText('$2,500.00')).toBeDefined()
})

it('leaves the subtotal prior and Δ blank for a first-ever month', async () => {
  // No prior month exists at all. A $0.00 prior would be a fabrication that reads as
  // "you had nothing last month" and paints the whole first entry as pure growth.
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month, exists: false, recorded_on: null, notes: null, balances: [],
  }))
  renderWizard()
  const row = (await screen.findByLabelText('Checking')).closest('tr') as HTMLElement
  const cells = within(row.nextElementSibling as HTMLElement).getAllByRole('cell')
  expect(cells[0].textContent).toBe('Subtotal')
  expect(cells[1].textContent).toBe('—') // prior
  expect(cells[2].textContent).toBe('$0.00') // this month, seeded
  expect(cells[3].textContent).toBe('—') // Δ
})

it('reads a conserving transfer as a flat zero, not as signed dust', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-07-01'
        ? [
            { account_id: 1, balance: '1000.07' },
            { account_id: 2, balance: '200.03' },
          ]
        : [],
  }))
  renderWizard()
  // $100 moved between two accounts: the total is CONSERVED, but each side is a SUM of
  // doubles and these two sums land 2.3e-13 apart — a raw sign turns that into "▼ -$0.00"
  // on the very month whose whole point is that nothing changed. (The cents are chosen so
  // the residue actually reproduces; most pairs cancel exactly.)
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '900.07' } })
  fireEvent.change(screen.getByLabelText('Savings'), { target: { value: '300.03' } })

  const subtotal = (screen.getByLabelText('Savings').closest('tr') as HTMLElement)
    .nextElementSibling as HTMLElement
  const cells = within(subtotal).getAllByRole('cell')
  expect(cells[0].textContent).toBe('Subtotal')
  expect(cells[3].textContent).toBe('$0.00')
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(footer.textContent).not.toContain('-$0.00')
  // The glyph reads the same rounded number, so ▲/▼ and the text can never disagree.
  expect(within(footer).getByText('$0.00 vs prior month')).toBeDefined()
})

it('keeps the live net-worth footer in sync while entering balances', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '2000' } })
  // By NAME, not by bare role: the draft banner and (Task 5) the paste note are status
  // nodes too — the label is what keeps this selector pointed at the totals bar.
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(within(footer).getByText('$2,000.00')).toBeDefined()
  // The footer's own Δ against the prior month's 1,500 — the number AND its tone.
  const delta = within(footer).getByText('$500.00 vs prior month')
  expect(delta.className).toContain('delta-positive')
})

it('shows the typical column and a live delta against it', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')
  const row = food.closest('tr') as HTMLElement
  expect(within(row).getByText('$300.00')).toBeDefined() // 3-mo median (one sample)
  fireEvent.change(food, { target: { value: '250.00' } })
  const deltaCell = within(row).getByText('-$50.00') // under typical
  // The INVERSION: on spending, less than typical is the good direction, so a negative
  // Δ carries the positive tone (the balances table's Δ pins the opposite mapping).
  expect(deltaCell.className).toContain('delta-positive')
})

it('keeps the live spending footer in sync while entering amounts', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '1000' } })
  // Same lesson as the balances footer: select the totals bar by its label, not by role.
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(within(footer).getByText('$250.00')).toBeDefined()
  expect(within(footer).getByText(/savings rate: 75\.0%/i)).toBeDefined()
})

it('clears a previously saved net pay when the box is blanked', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00', amounts: [], budgets: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 0, updated: 0, unchanged: 1,
    net_pay_set: false, net_pay_cleared: true,
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const netPayBox = await screen.findByLabelText('Household take-home')
  fireEvent.change(netPayBox, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({ net_pay: null }),
    )
  })
  // A deletion the user asked for by BLANKING a box deserves saying out loud — the counts
  // sentence alone never mentions the cashflow row that just went away.
  await screen.findByText(/household take-home cleared/i)
})

it('keeps sending the clear on the retry after a failed save', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00', amounts: [], budgets: [],
  })
  // The balances PUT resolves normally both times; only the spending half fails first.
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByRole('alert')

  fireEvent.click(screen.getByRole('button', { name: /retry spending/i }))
  await waitFor(() => {
    expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls.length).toBe(2)
  })
  // hadNetPay describes the SERVER's state, so it may only be adopted where the server
  // confirmed it — the success path. Hoisting that adoption above the awaits would make
  // this retry omit net_pay entirely and leave the stale 9,000 in every savings-rate
  // denominator, with the user looking at a "saved" wizard.
  expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls[1][1]).toEqual(
    expect.objectContaining({ net_pay: null }),
  )
})

it('never sends net_pay for a month that had none and stays blank', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    const body = vi.mocked(spendingApi.putSpendingMonth).mock.calls[0][1]
    expect('net_pay' in body).toBe(false)
  })
})

it('a post-save blur never resurrects a phantom draft', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  // Tolerant text advanced past by CLICKS — no blur, so state keeps the raw '9,000'
  // while the wire (and the server) got the canonical '9000'.
  const netPay = await screen.findByLabelText('Household take-home')
  fireEvent.change(netPay, { target: { value: '9,000' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)

  // Back to the cell and through it once. A blur here canonicalizes state to '9000';
  // if the post-save baseline still held the RAW '9,000' the snapshot would differ from
  // it and file a draft for work that is fully saved — the next visit would then greet
  // the user with "Restored unsaved entries — they are not saved yet" about nothing.
  fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
  const again = await screen.findByLabelText('Household take-home')
  act(() => {
    // Bare .focus() outside act queues the focused re-render without flushing it
    // (React 19 emits no warning) — the blur would then run against stale render state.
    again.focus()
  })
  fireEvent.blur(again)
  expect(sessionStorage.getItem('finance-update-draft:2026-08-01')).toBeNull()
})

it('still enters the month when the typical-history fetch fails', async () => {
  vi.mocked(spendingApi.fetchMatrix).mockRejectedValue(new Error('matrix down'))
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')

  // '—' is the Typical column's DESIGNED degraded state (a month with no history shows the
  // same thing), so a failed matrix costs the entry aid and nothing else. Blocking the
  // whole wizard on a comparison figure would be the tail wagging the dog.
  const cells = within(food.closest('tr') as HTMLElement).getAllByRole('cell')
  expect(cells[1].textContent).toBe('—')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('leaves an exactly-typical month untoned instead of painting float residue', async () => {
  // Two samples → the median is their MEAN, and (0.10 + 0.20) / 2 is 0.15000000000000002 in
  // doubles. Typing the typical figure exactly lands the raw delta at -2.8e-17: formatted it
  // is "-$0.00", and toned by its raw sign (negative here) it paints the UNDER-typical
  // colour over a zero — a month that matched typical exactly, congratulated for saving.
  vi.mocked(spendingApi.fetchMatrix).mockResolvedValue({
    months: ['2026-06-01', '2026-07-01'],
    categories: [],
    series: [{ category_id: 7, values: ['0.10', '0.20'], budgets: [null, null] }],
    totals: [],
    net_pay: [],
    savings_rate: [],
    four_pct_rule: [],
    total_budget: [null, null],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')
  fireEvent.change(food, { target: { value: '0.15' } })
  const cells = within(food.closest('tr') as HTMLElement).getAllByRole('cell')
  expect(cells[3].textContent).toBe('$0.00') // never "-$0.00"
  expect(cells[3].className).not.toMatch(/delta-(positive|negative)/)
})

// --- range paste (spec §4.1) ---
// jsdom has no clipboard: fireEvent.paste's init object is what RTL defines onto the event,
// and React hands it through as e.clipboardData.

it('fills down from the pasted-into cell on a column paste', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  fireEvent.paste(checking, { clipboardData: { getData: () => '1,000\n2000' } })

  // Pasted text lands RAW, exactly as if typed — the focused cell shows what arrived, and
  // Savings (blurred) shows AmountInput's echo of the same state.
  expect(checking.value).toBe('1,000')
  const savingsBox = screen.getByLabelText('Savings') as HTMLInputElement
  expect(savingsBox.value).toBe('$2,000.00')
  // Which cells moved, shown as well as narrated — the class merges alongside the
  // validity one rather than replacing it.
  expect(savingsBox.className).toBe('field-input pasted-flash')
  // getByText, not getByRole('status'): the live-totals bar is a status node too, so the
  // note is deliberately located by its words.
  expect(screen.getByText(/pasted 2 of 2 values/i)).toBeDefined()
})

it('fills a transposed horizontal range the same way', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  // The source sheet stores months as ROWS, so a copied month arrives horizontal; it has to
  // fill the same column a vertical range does.
  fireEvent.paste(checking, { clipboardData: { getData: () => '1000\t2000' } })

  expect(checking.value).toBe('1000')
  expect((screen.getByLabelText('Savings') as HTMLInputElement).value).toBe('$2,000.00')
})

it('keyed paste matches names regardless of focus and reports misses', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  fireEvent.paste(checking, {
    clipboardData: { getData: () => 'savings\t2500\nChequing\t9\nChecking\t1750' },
  })

  // The label decides the target, not the focused cell — and case never matters.
  expect((screen.getByLabelText('Savings') as HTMLInputElement).value).toBe('$2,500.00')
  expect(checking.value).toBe('1750')
  // A miss is named, never guessed at: filling the wrong account with the right number is
  // worse than filling nothing.
  expect(screen.getByText(/pasted 2 of 2 values · 1 unmatched: Chequing/i)).toBeDefined()
})

it('reports pasted values that run off the end instead of dropping them', async () => {
  renderWizard() // the single-account fixture
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  fireEvent.paste(checking, { clipboardData: { getData: () => '1\n2\n3' } })

  expect(checking.value).toBe('1')
  expect(screen.getByText(/pasted 1 of 1 values · 2 values didn't fit/i)).toBeDefined()
})

it('skips an empty pasted value rather than blanking the cell', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  // A trailing-empty cell is what a sheet's blank month looks like. NOTE the two-row form:
  // a lone "label<TAB>" is a single row of one non-empty cell, which classifies as a native
  // single-cell paste — the skip only exists inside a real keyed block.
  fireEvent.paste(checking, { clipboardData: { getData: () => 'Checking\t\nSavings\t2500' } })

  // Paste must never BLANK a filled cell: the seeded prior-month figure survives untouched.
  expect(checking.value).toBe('1500.00')
  expect((screen.getByLabelText('Savings') as HTMLInputElement).value).toBe('$2,500.00')
  expect(screen.getByText(/pasted 1 of 2 values · 1 blank skipped/i)).toBeDefined()
})

it('leaves a single-value paste to the browser', async () => {
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  const notPrevented = fireEvent.paste(checking, {
    clipboardData: { getData: () => '1234.56' },
  })

  // Not default-prevented: native insertion plus the tolerant parse already handle one cell,
  // and intercepting would break pasting into the middle of a half-typed number.
  expect(notPrevented).toBe(true)
  expect(checking.value).toBe('1500.00')
  expect(screen.queryByText(/pasted/i)).toBeNull()
})

it('leaves a multi-line paste in the notes box to the browser', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  const notPrevented = fireEvent.paste(screen.getByLabelText(/notes/i), {
    clipboardData: { getData: () => 'line one\nline two' },
  })

  // The scope's handler owns the CELLS, not every field inside the card: a two-line note is
  // a legitimate single-field paste, and hijacking it would swallow the note AND scatter its
  // lines across the balance cells.
  expect(notPrevented).toBe(true)
  expect(screen.queryByText(/pasted/i)).toBeNull()
  expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('1500.00')
})

it('starts a column paste at the first row when the pasted-into cell is outside the table', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const netPayBox = (await screen.findByLabelText('Household take-home')) as HTMLInputElement
  fireEvent.paste(netPayBox, { clipboardData: { getData: () => '10\n20' } })

  // Net pay is an AmountInput like any other, but it sits OUTSIDE the table and carries no
  // row id, so it is never a fill target (spec §4.1) — the column lands from the first
  // category down and the box keeps whatever it held.
  expect((screen.getByLabelText('Food') as HTMLInputElement).value).toBe('$10.00')
  expect(netPayBox.value).toBe('')
  expect(screen.getByText(/pasted 1 of 1 values · 1 value didn't fit/i)).toBeDefined()
})

it('pastes into the spending step and drops the note on the way out', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = (await screen.findByLabelText('Food')) as HTMLInputElement
  fireEvent.paste(food, { clipboardData: { getData: () => 'Food\t250\nRent\t900' } })

  // Net pay autofocuses this step, so Food is blurred and shows its echo.
  expect(food.value).toBe('$250.00')
  expect(screen.getByText(/pasted 1 of 1 values · 1 unmatched: Rent/i)).toBeDefined()
  // One note state serves both steps, so it must not follow the user off this one.
  fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
  await screen.findByLabelText('Checking')
  expect(screen.queryByText(/pasted 1 of 1 values/i)).toBeNull()
})

it('shows the budget subtext, tones it when over, and never blocks the save', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01',
    exists: false,
    net_pay: null,
    amounts: [],
    budgets: [{ category_id: 7, amount: '200.00' }],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')
  const row = food.closest('tr') as HTMLElement
  // Within budget (seeded 0.00): muted subtext, no tone.
  expect(within(row).getByText('of $200.00').className).toBe('entry-budget')
  // Typing past the budget tones the subtext — and only the subtext.
  fireEvent.change(food, { target: { value: '250.00' } })
  expect(within(row).getByText('of $200.00').className).toBe('entry-budget delta-negative')
  // Advice, not validation (spec §4.1): the step advances and the PUT carries the amount.
  const next = screen.getByRole('button', { name: /next: review/i }) as HTMLButtonElement
  expect(next.disabled).toBe(false)
  fireEvent.click(next)
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({ amounts: [{ category_id: 7, amount: '250.00' }] }),
    )
  })
})

it('leaves unbudgeted rows without the subtext', async () => {
  renderWizard() // the default fetchSpendingMonth mock ships budgets: []
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')
  expect(within(food.closest('tr') as HTMLElement).queryByText(/^of \$/)).toBeNull()
})

// --- owner grouping (2026-08-26 household spec §6) ---------------------------------------

function twoPersonHousehold() {
  vi.mocked(householdApi.fetchHousehold).mockResolvedValue({
    people: [
      { id: 1, name: 'Me', is_primary: true },
      { id: 2, name: 'Sam', is_primary: false },
    ],
    marriage_date: '2026-09-12',
  })
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, samBrokerage, jointSavings])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-07-01'
        ? [
            { account_id: 1, balance: '100.00' },
            { account_id: 3, balance: '1000.00' },
            { account_id: 4, balance: '70.00' },
          ]
        : [],
  }))
}

it('walks owner -> group -> rows with a subtotal per owner, primary first and Joint last', async () => {
  twoPersonHousehold()
  renderWizard()
  await screen.findByLabelText('Checking')

  const ownerHeads = [...document.querySelectorAll('tr.entry-owner-row')] as HTMLElement[]
  expect(ownerHeads.map((r) => r.textContent)).toEqual(['Me', 'Sam', 'Joint'])

  const ownerTotals = [
    ...document.querySelectorAll('tr.entry-owner-subtotal-row'),
  ] as HTMLElement[]
  expect(ownerTotals.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
    'Me total', 'Sam total', 'Joint total',
  ])
  // Cells are [label, last month, this month, Δ]; the month seeds from the prior one, so
  // "this month" equals "last month" and every Δ is a clean $0.00.
  expect(ownerTotals.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
    '$100.00', '$1,000.00', '$70.00',
  ])

  // The group subtotals survive UNDERNEATH the owner ones — one level finer, not replaced.
  const groupSubtotals = [...document.querySelectorAll('tr.entry-subtotal-row')] as HTMLElement[]
  expect(groupSubtotals.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
    '$100.00', '$1,000.00', '$70.00',
  ])
})

it('makes the owner walk the DOM order a positional paste fills down', async () => {
  twoPersonHousehold()
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  // Three values down the rendered column: Me's row, then Sam's, then Joint's.
  fireEvent.paste(checking, { clipboardData: { getData: () => '1\n2\n3' } })

  expect(checking.value).toBe('1')
  expect((screen.getByLabelText('Sam Brokerage') as HTMLInputElement).value).toBe('$2.00')
  expect((screen.getByLabelText('Joint Savings') as HTMLInputElement).value).toBe('$3.00')
})

it('keeps the flat group walk for a one-person household', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  await screen.findByLabelText('Checking')
  // No owner layer at all — not an empty header, not a "Me" section of one.
  expect(document.querySelector('tr.entry-owner-row')).toBeNull()
  expect(document.querySelector('tr.entry-owner-subtotal-row')).toBeNull()
  expect(document.querySelectorAll('tr.entry-subtotal-row').length).toBe(1)
})

it('names the pay box as a HOUSEHOLD figure — one stream, two earners', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  // The field, the step heading and the ⓘ hint all say the same word; a box still called
  // "Net pay" on a married household reads as one person's paycheck.
  expect(await screen.findByLabelText('Household take-home')).toBeTruthy()
  expect(screen.queryByLabelText('Net pay (take-home)')).toBeNull()
  expect(screen.getByRole('heading', { name: /spending & take-home/i })).toBeTruthy()
})

// --- liability sign cue (2026-08-31 tier-1 A1) --------------------------------------------

it('cues a positive liability inline and Flip sign negates it in place', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, creditCard])
  renderWizard()
  const visa = (await screen.findByLabelText('Visa')) as HTMLInputElement
  // Seeded 0.00 (no prior row for Visa): no cue — zero is not a positive balance.
  expect(screen.queryByText(/liabilities are entered negative/i)).toBeNull()

  fireEvent.change(visa, { target: { value: '500' } })
  expect(screen.getByText(/liabilities are entered negative/i)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Flip sign on Visa' }))
  // The blurred cell echoes the negated committed value; the cue folds away.
  expect(visa.value).toBe('-$500.00')
  expect(screen.queryByText(/liabilities are entered negative/i)).toBeNull()
})

it('a positive liability is advisory only — Next and Save stay enabled and the value ships', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, creditCard])
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Visa'), { target: { value: '500' } })
  // Ratified: a card can legitimately go positive after a refund — never a gate.
  const next = screen.getByRole('button', { name: /next: spending/i }) as HTMLButtonElement
  expect(next.disabled).toBe(false)
  fireEvent.click(next)
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 5, balance: '500' },
        ],
      }),
    )
  })
})

it('renders the cue for a server-seeded positive liability and Flip marks the draft dirty', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, creditCard])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-07-01'
        ? [
            { account_id: 1, balance: '1500.00' },
            { account_id: 5, balance: '500.00' }, // mis-signed on the server already
          ]
        : [],
  }))
  renderWizard()
  await screen.findByLabelText('Visa')
  expect(screen.getByText(/liabilities are entered negative/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Flip sign on Visa' }))
  // Flip is an edit like any other: the draft machinery files it immediately.
  expect(sessionStorage.getItem('finance-update-draft:2026-08-01')).not.toBeNull()
  expect((screen.getByLabelText('Visa') as HTMLInputElement).value).toBe('-$500.00')
})

// --- split-save truth (2026-08-31 tier-1 A8) -----------------------------------------------

it('names the half-landed save and retries only the spending leg', async () => {
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))

  // The balances PUT COMMITTED before the failure — "nothing was lost" would be a lie in
  // both directions, so the banner names the split.
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Balances saved. Spending failed — Retry saves only spending.')
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(1)

  // The primary is now the honest retry: only the failed leg goes out again.
  fireEvent.click(screen.getByRole('button', { name: /retry spending/i }))
  await screen.findByText(/month saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(1) // never re-sent
  expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls.length).toBe(2)
})

it('keeps the accurate old message when the balances leg itself fails', async () => {
  vi.mocked(netWorthApi.putMonthBalances).mockRejectedValueOnce(new Error('db down'))
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Saving failed — nothing was lost, retry')
  // Nothing committed: the spending PUT was never attempted, the primary stays a full save.
  expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(2)
  expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls.length).toBe(1)
})

it('re-sends balances on retry when they were edited after the partial failure', async () => {
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByRole('alert')

  // Back to balances, change a figure: the remembered leg no longer describes the boxes,
  // so a "retry" that skipped balances would silently drop this edit under a green banner.
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1700.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /retry spending/i }))
  await screen.findByText(/month saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(2)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls[1][1]).toEqual(
    expect.objectContaining({ balances: [{ account_id: 1, balance: '1700.00' }] }),
  )
})
