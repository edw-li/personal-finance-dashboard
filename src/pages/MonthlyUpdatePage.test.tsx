import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MonthlyUpdatePage from './MonthlyUpdatePage'
import ToastProvider from '../components/ToastProvider'
import { ApiError } from '../api/client'
import * as monthReviewApi from '../api/monthReview'
import type { MonthReview, MonthSaveResult } from '../api/monthReview'

vi.mock('../api/monthReview', async importOriginal => ({
  ...await importOriginal<typeof import('../api/monthReview')>(),
  fetchMonthReview: vi.fn(), fetchMonthReviews: vi.fn(), saveMonthReview: vi.fn(), batchCloseMonths: vi.fn(),
}))

const reviewFixture = (month: string): MonthReview => ({
  month, state: 'in_progress', input_revision: 'a'.repeat(64),
  reviewed: { balances: false, spending: false, take_home: false },
  coverage: { balances: true, spending: true, take_home: true, spending_nonzero: true, missing_account_ids: [], missing_category_ids: [] },
  can_close: true, blockers: [], eligible_spending: false, eligible_savings: false, legacy_eligible: false,
  closed_at: null, closed_by: null, source_link: `/update?month=${month}&step=review`,
})

vi.mock('../api/netWorth', () => ({
  deleteMonthBalances: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchMonthBalances: vi.fn(),
  fetchSummary: vi.fn(),
  fetchTimeseries: vi.fn(),
  putMonthBalances: vi.fn(),
}))
vi.mock('../api/spending', () => ({
  deleteSpendingMonth: vi.fn(),
  fetchCategories: vi.fn(),
  fetchMatrix: vi.fn(),
  fetchSpendingMonth: vi.fn(),
  putSpendingMonth: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// Undo rides the toast (2026-09-03 data-lifecycle spec §9): the page POSTs one batch at a time.
vi.mock('../api/lifecycle', () => ({ undoBatch: vi.fn() }))
// The scope row's ribbon reads /coverage for its two-tone chips (2026-09-03 spec §7).
vi.mock('../api/coverage', () => ({ fetchCoverage: vi.fn() }))

import * as netWorthApi from '../api/netWorth'
import * as spendingApi from '../api/spending'
import * as householdApi from '../api/household'
import * as lifecycleApi from '../api/lifecycle'
import { fetchCoverage } from '../api/coverage'
import { clearSnapshots } from '../api/snapshotCache'
import { formatMonth } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'
import { setServerToday } from '../utils/productToday'
import { SEP_1, TIME_OCT_3, TIME_SEP_23, septemberFlows } from '../testing/timeStatusFixtures'

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
const category = {
  id: 7,
  name: 'Food',
  slug: 'food',
  sort_order: 1,
  is_active: true,
  kind: 'living' as const,
}
// A second LIVING category — the default fixture is one row, which cannot show which
// categories a save body carries and which it leaves out.
const rentCategory = {
  id: 8,
  name: 'Rent',
  slug: 'rent',
  sort_order: 2,
  is_active: true,
  kind: 'living' as const,
}
// Money that STAYED yours (2026-09-04 honest-numbers spec §1): part of Total spend, and
// not part of the cash savings rate — a brokerage deposit is saving, not spending.
const transferCategory = {
  id: 9,
  name: 'Brokerage deposit',
  slug: 'brokerage-deposit',
  sort_order: 3,
  is_active: true,
  kind: 'transfer' as const,
}
// An income-tax payment made OUT of take-home (the April bill) — spend, like living.
const taxCategory = {
  id: 10,
  name: 'Tax payment',
  slug: 'tax-payment',
  sort_order: 4,
  is_active: true,
  kind: 'tax' as const,
}

beforeEach(() => {
  // ONE day for every rule the wizard reads (2026-09-23 spec §K1): the server's, pinned here so
  // a run on any calendar day sees the same "current month" (src/testing/setup.ts forgets it).
  setServerToday('2026-09-24')
  vi.mocked(monthReviewApi.fetchMonthReview).mockImplementation(async month => reviewFixture(month))
  vi.mocked(monthReviewApi.fetchMonthReviews).mockResolvedValue({ adopted_on: '2026-09-01', default_month: '2026-08-01', months: [] })
  // Existing entry-contract assertions inspect each section of the single coordinated body.
  // These two spies are a mock-server adapter; the page only calls saveMonthReview.
  vi.mocked(monthReviewApi.saveMonthReview).mockImplementation(async (month, body) => {
    const balances = body.balances ? await netWorthApi.putMonthBalances(month, body.balances) : null
    const spending = body.spending ? await spendingApi.putSpendingMonth(month, body.spending) : null
    return { month, balances, spending, batch_id: balances?.batch_id ?? spending?.batch_id ?? null,
      review: { ...reviewFixture(month), reviewed: body.reviewed, state: body.close ? 'closed' : 'in_progress' } }
  })
  // The ScopeBar caches /coverage under a shell:* snapshot key that outlives a test.
  clearSnapshots()
  vi.mocked(fetchCoverage).mockResolvedValue({
    balances: ['2026-07-01'],
    spending: ['2026-07-01'],
    net_pay: ['2026-07-01'],
  })
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
  // The next 1st's summary for a month's story (2026-09-23 spec §M5). By default it compares with
  // nothing — the month on screen has no snapshot of its own in these fixtures.
  vi.mocked(netWorthApi.fetchSummary).mockImplementation(async (_owner, month) => ({
    month: month ?? null, net_worth: '1500.00', mom_delta: null, mom_pct: null, groups: [], owner_totals: [],
    as_of: month ?? null, provisional: false, previous: null, days_since_previous: null,
  }))
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
    net_pay_set: true, skipped_blank: 0, net_pay_cleared: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // Drafts live in sessionStorage, which jsdom keeps alive across tests in this file —
  // without this, one test's typed work restores itself into the next test's wizard.
  sessionStorage.clear()
})

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderPage(entry = '/update?month=2026-08-01') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MonthlyUpdatePage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function renderWizard() {
  return renderPage()
}

// The step card stays MOUNTED through a month switch now (dimmed, aria-busy, inert; 2026-09-13
// polish §9), so a test that types into the month it has just moved to must wait for the new
// seed to land instead of for a re-mounted input.
async function landedBalanceCell(): Promise<HTMLInputElement> {
  await waitFor(() =>
    expect(screen.getByLabelText('Checking').closest('.card')?.getAttribute('aria-busy')).toBeNull(),
  )
  return screen.getByLabelText('Checking') as HTMLInputElement
}

// A promise settled by hand — the only way to hold one feed in flight while the page paints
// (OverviewPage.test's helper).
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
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
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))

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
  expect(screen.getAllByText('$1,600.00')[0]).toBeDefined() // net worth preview
  fireEvent.click(screen.getByRole('button', { name: /save progress/i }))

  await waitFor(() => {
    // Exactly these two keys: no recorded_on — the server stamps it (2026-09-23 spec §M4).
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith('2026-08-01', {
      balances: [{ account_id: 1, balance: '1600.00' }],
      notes: null, // blank notes field CLEARS server-side — load-bearing contract
    })
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      net_pay: '9000.00',
      amounts: [{ category_id: 7, amount: '250.00' }],
    })
  })
  await screen.findByText(/progress saved/i)
})

it('blocks the balances Save while a balance is not a number — moving on saves nothing, so Next stays open', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: 'abc' } })
  expect((screen.getByRole('button', { name: 'Save Aug 1 balances' }) as HTMLButtonElement).disabled).toBe(true)
  expect(
    (screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }) as HTMLButtonElement).disabled,
  ).toBe(false)
})

it('resets notes on month switch and survives same-month clicks', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: /^Aug 2026/ }))
  expect(screen.getByLabelText('Checking')).toBeDefined()

  // Switching months must reset notes — never leak them into the new month.
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  await waitFor(() => {
    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).value).toBe('')
  })
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
  expect(screen.getByText(/restored unsaved/i)).toBeTruthy()

  // Discard puts the server's seed back and forgets the draft.
  fireEvent.click(screen.getByRole('button', { name: /discard restored balances/i }))
  expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('1500.00')
  expect(screen.queryByText(/restored unsaved/i)).toBeNull()
})

it('forgets the draft once the month is saved', async () => {
  const first = renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  first.unmount()

  renderWizard()
  // The seed is the SERVER's again and no banner shows — the draft died with the save.
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
  expect(screen.queryByText(/restored unsaved/i)).toBeNull()
})

it('keeps a draft per month across ribbon switches', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })

  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  await waitFor(() =>
    expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('0.00'),
  )
  // June is untouched: no draft, no banner — August's work never leaks sideways.
  expect(screen.queryByText(/restored unsaved/i)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /^Aug 2026/ }))
  await screen.findByText(/restored unsaved/i)
  expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('1600.00')
})

it(`offers next month's balances early — never "Start" a month further on — pre-filled from this month (2026-09-23 spec §M3)`, async () => {
  // Months derive from the SAME (server) day the component reads, pinned in beforeEach.
  const current = currentMonthIso()
  const next = addMonths(current, 1)
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === current,
    recorded_on: null,
    notes: null,
    balances: month === current ? [{ account_id: 1, balance: '1500.00' }] : [],
  }))
  vi.mocked(fetchCoverage).mockResolvedValue({ balances: [current], spending: [current], net_pay: [current] })
  render(
    <MemoryRouter initialEntries={[`/update?month=${current}`]}>
      <MonthlyUpdatePage />
    </MemoryRouter>,
  )
  await screen.findByText(`Balances as of ${formatMonth(current).slice(0, 3)} 1 · recorded date unknown`)
  expect(screen.queryByRole('button', { name: /^Start / })).toBeNull()

  fireEvent.click(await screen.findByRole('button', { name: `Record ${formatMonth(next).slice(0, 3)} 1 balances early` }))
  // New month: not recorded yet, pre-filled from the just-covered current month.
  await screen.findByText(/not recorded yet — pre-filled from/)
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
  expect(netWorthApi.fetchMonthBalances).toHaveBeenCalledWith(next)
})

it('canonicalizes tolerant and =-expression entries into the PUT bodies', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: '$1,600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '=200+50' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9,000' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
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
  expect((screen.getByRole('button', { name: 'Save Aug 1 balances' }) as HTMLButtonElement).disabled).toBe(false)
})

it('Enter on the last cell of each step lands on that step primary — the part’s save', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: '1600.00' } })
  act(() => {
    balanceInput.focus()
  })
  fireEvent.keyDown(balanceInput, { key: 'Enter' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save Aug 1 balances' }))

  // The spending card is its own scope with its own primary — netPay precedes Food in DOM
  // order, so Food is that scope's last cell and Enter there lands on the spending save.
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  const food = await screen.findByLabelText('Food')
  fireEvent.change(food, { target: { value: '250.00' } })
  act(() => {
    food.focus()
  })
  fireEvent.keyDown(food, { key: 'Enter' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save August spending' }))
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
  // Brokerage HAS a component, so it is a DERIVED row now (spec §5): the figure is typed into
  // the component, and the parent shows the sum. The subtotal rule under test is unchanged —
  // a component is counted inside its parent, never beside it.
  fireEvent.change(component, { target: { value: '1000' } })

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
  expect(within(footer).getByText('$0.00 since Jul 1')).toBeDefined()
})

it('keeps the live net-worth footer in sync while entering balances', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '2000' } })
  // By NAME, not by bare role: the draft banner and (Task 5) the paste note are status
  // nodes too — the label is what keeps this selector pointed at the totals bar.
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(within(footer).getByText('$2,000.00')).toBeDefined()
  // The footer's own Δ against the prior month's 1,500 — the number AND its tone.
  const delta = within(footer).getByText('$500.00 since Jul 1')
  expect(delta.className).toContain('delta-positive')
})

it('shows the typical column and a live delta against it', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '1000' } })
  // Same lesson as the balances footer: select the totals bar by its label, not by role.
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(within(footer).getByText('$250.00')).toBeDefined()
  expect(within(footer).getByText(/savings rate — cash: 75\.0%/i)).toBeDefined()
})

it('clears a previously saved net pay when the box is blanked', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00', amounts: [], budgets: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 0, updated: 0, unchanged: 1,
    net_pay_set: false, skipped_blank: 0, net_pay_cleared: true,
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  const netPayBox = await screen.findByLabelText('Household take-home')
  fireEvent.change(netPayBox, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByRole('alert')

  fireEvent.click(screen.getByRole('button', { name: /save progress/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  // A month has to have something to record before the leg runs at all now (spec §4); the
  // CONTRACT under test is unchanged — a month that never had a take-home gets no net_pay
  // key, so the server is never asked to clear a row that does not exist.
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() => {
    const body = vi.mocked(spendingApi.putSpendingMonth).mock.calls[0][1]
    expect('net_pay' in body).toBe(false)
  })
})

it('a post-save blur never resurrects a phantom draft', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  // Tolerant text advanced past by CLICKS — no blur, so state keeps the raw '9,000'
  // while the wire (and the server) got the canonical '9000'.
  const netPay = await screen.findByLabelText('Household take-home')
  fireEvent.change(netPay, { target: { value: '9,000' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)

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
  expect(sessionStorage.getItem('finance-update-draft:flows:2026-08-01')).toBeNull()
})

it('offers a Retry instead of a dead form when the month fails to load', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockRejectedValueOnce(
    new ApiError('accounts unavailable', 503),
  )
  renderWizard()
  expect(
    await screen.findByText("Couldn't load this month — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  // The dead form is the bug: boxes seeded with nothing, offering to save them over a real
  // month. Nothing below the banner until the load answers — PageFrame renders children only
  // while the resource is ready, so the step bodies and the step buttons go with it.
  expect(screen.queryByLabelText('Checking')).toBeNull()
  expect(screen.queryByRole('button', { name: /^next: [a-z]+ spending$/i })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
})

// F1 (2026-09-13 audit): every visit showed an empty body for the slowest feed's duration.
it('ghosts the step card while the first month loads instead of leaving the body blank', async () => {
  const gate = deferred<(typeof account)[]>()
  vi.mocked(netWorthApi.fetchAccounts).mockImplementation(() => gate.promise)
  renderWizard()
  await screen.findByRole('heading', { level: 1, name: `Monthly update — ${formatMonth('2026-08-01')}` })
  expect(document.querySelector('.page-skeleton')).not.toBeNull()
  expect(screen.queryByLabelText('Checking')).toBeNull()
  await act(async () => { gate.resolve([account]) })
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
  expect(document.querySelector('.page-skeleton')).toBeNull()
})

it('keeps the step card mounted and busy through a month switch, swapping when the new month lands', async () => {
  type Balances = Awaited<ReturnType<typeof netWorthApi.fetchMonthBalances>>
  const june = deferred<Balances>()
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation((month: string) =>
    month === '2026-06-01'
      ? june.promise
      : Promise.resolve({ month, exists: month === '2026-07-01', recorded_on: null, notes: null,
          balances: month === '2026-07-01' ? [{ account_id: 1, balance: '1500.00' }] : [] }),
  )
  const { container } = renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  // Still on screen — dimmed, marked busy and inert — no skeleton, no blank, no height jump.
  const card = screen.getByLabelText('Checking').closest('.card') as HTMLElement
  expect(card.getAttribute('aria-busy')).toBe('true')
  expect(card.hasAttribute('inert')).toBe(true)
  expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
  expect(document.querySelector('.page-skeleton')).toBeNull()
  await act(async () => {
    june.resolve({ month: '2026-06-01', exists: true, recorded_on: null, notes: null, balances: [{ account_id: 1, balance: '900.00' }] })
  })
  await waitFor(() => expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('900.00'))
  const landed = screen.getByLabelText('Checking').closest('.card') as HTMLElement
  expect(landed.getAttribute('aria-busy')).toBeNull()
  expect(landed.hasAttribute('inert')).toBe(false)
  expect(container.querySelector('.loading-dim.is-loading')).toBeNull()
})

// P1 review round: a switch whose gating feed fails must not leave the PREVIOUS month's form
// standing under the new month's title — undimmed, interactive, and saving nothing.
it('shows the error view instead of the previous month’s form when a switch fails to load', async () => {
  renderWizard()
  await landedBalanceCell()
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => {
    if (month === '2026-06-01') throw new ApiError('balances unavailable', 503)
    return { month, exists: month === '2026-07-01', recorded_on: null, notes: null,
      balances: month === '2026-07-01' ? [{ account_id: 1, balance: '1500.00' }] : [] }
  })
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText("Couldn't load this month — the server had a problem (HTTP 503)")).toBeTruthy()
  // August's cells are GONE: a form for a month nobody is on is worse than no form at all.
  expect(screen.queryByLabelText('Checking')).toBeNull()
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month, exists: true, recorded_on: null, notes: null, balances: [{ account_id: 1, balance: '900.00' }],
  }))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  // The retry is a load like any other: the dimmed, inert card comes back while it is in flight
  // and carries June's figures the moment they land.
  expect((await landedBalanceCell()).value).toBe('900.00')
  expect(screen.queryByRole('alert')).toBeNull()
})

// P1 review round: the owner walk is part of the SEED, not an aid — a late household flips a
// one-section grid into per-owner sections, remounting every row (layout jump, stolen focus).
it('waits for the household before painting the grid, so the owner sections never re-form under the caret', async () => {
  type Household = Awaited<ReturnType<typeof householdApi.fetchHousehold>>
  const gate = deferred<Household>()
  vi.mocked(householdApi.fetchHousehold).mockImplementation(() => gate.promise)
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, samBrokerage, jointSavings])
  renderWizard()
  await screen.findByRole('heading', { level: 1, name: `Monthly update — ${formatMonth('2026-08-01')}` })
  expect(screen.queryByLabelText('Checking')).toBeNull()
  await act(async () => {
    gate.resolve({ people: [{ id: 1, name: 'Me', is_primary: true }, { id: 2, name: 'Sam', is_primary: false }], marriage_date: '2026-09-12' })
  })
  expect(await screen.findByLabelText('Checking')).toBeTruthy()
  // One paint, already grouped: the owner walk is there on the FIRST render of the grid.
  expect([...document.querySelectorAll('tr.entry-owner-row')].map((r) => r.textContent)).toEqual(['Me', 'Sam', 'Joint'])
})

it('reads which months exist from /coverage rather than the whole net-worth timeseries', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  await waitFor(() => expect(fetchCoverage).toHaveBeenCalled())
  expect(netWorthApi.fetchTimeseries).not.toHaveBeenCalled()
})

it('retires a load failure the moment the ribbon moves to another month', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockRejectedValueOnce(
    new ApiError('accounts unavailable', 503),
  )
  renderWizard()
  await screen.findByRole('alert')

  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  // Synchronously, before the new load answers: the sentence described the month being LEFT,
  // and leaving it standing over the new one would be a lie.
  expect(screen.queryByRole('alert')).toBeNull()
  expect(await screen.findByLabelText('Checking')).toBeTruthy()
})

it('still enters the month when the typical-history fetch fails', async () => {
  vi.mocked(spendingApi.fetchMatrix).mockRejectedValue(new Error('matrix down'))
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() => {
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({ amounts: [{ category_id: 7, amount: '250.00' }] }),
    )
  })
})

it('leaves unbudgeted rows without the subtext', async () => {
  renderWizard() // the default fetchSpendingMonth mock ships budgets: []
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
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
  const next = screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }) as HTMLButtonElement
  expect(next.disabled).toBe(false)
  fireEvent.click(next)
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
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
  expect(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')).not.toBeNull()
  expect((screen.getByLabelText('Visa') as HTMLInputElement).value).toBe('-$500.00')
})

// --- split-save truth (2026-08-31 tier-1 A8) -----------------------------------------------

it('retries a coordinated save with the same request id after an unconfirmed response', async () => {
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))

  // The balances PUT COMMITTED before the failure — "nothing was lost" would be a lie in
  // both directions, so the banner names the split.
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('The save could not be confirmed. Your entries are preserved; retry to check the same save.')
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(1)

  // The primary is now the honest retry: only the failed leg goes out again.
  fireEvent.click(screen.getByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(vi.mocked(monthReviewApi.saveMonthReview).mock.calls.length).toBe(2)
  expect(vi.mocked(monthReviewApi.saveMonthReview).mock.calls[1][1].request_id).toBe(vi.mocked(monthReviewApi.saveMonthReview).mock.calls[0][1].request_id)
  expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls.length).toBe(2)
})

it('preserves the draft and reports an unconfirmed save honestly', async () => {
  vi.mocked(netWorthApi.putMonthBalances).mockRejectedValueOnce(new Error('db down'))
  renderWizard()
  // Both parts changed, so the Review save sends both (an untouched part would stay home).
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('The save could not be confirmed. Your entries are preserved; retry to check the same save.')
  // Nothing committed: the spending PUT was never attempted, the primary stays a full save.
  expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(2)
  expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls.length).toBe(1)
})

it('sends updated entries with a new request id after an edit following failure', async () => {
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByRole('alert')

  // Back to balances, change a figure: the remembered leg no longer describes the boxes,
  // so a "retry" that skipped balances would silently drop this edit under a green banner.
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1700.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(2)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls[1][1]).toEqual(
    expect.objectContaining({ balances: [{ account_id: 1, balance: '1700.00' }] }),
  )
})

it('drops the stale saved card the moment a new save attempt begins', async () => {
  // Succeeds, then fails. The green card carries the FIRST attempt's counts, so leaving it
  // standing beside the red split-save alert would put two contradicting verdicts on screen
  // for one month — the exact lie A8 exists to stop.
  vi.mocked(spendingApi.putSpendingMonth)
    .mockResolvedValueOnce({
      month: '2026-08-01', created: 1, updated: 0, unchanged: 0,
      net_pay_set: true, skipped_blank: 0, net_pay_cleared: false,
    })
    .mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)

  // Back for one more edit to each part, then save again — this attempt's spending leg fails.
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending('275.00')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(screen.getByRole('button', { name: /save progress/i }))

  await screen.findByRole('alert')
  expect(screen.queryByText(/progress saved/i)).toBeNull()
})

// --- delete month (2026-08-31 spec §B2) ----------------------------------------------------
// A second render helper rather than a change to renderWizard(): the delete arm needs a
// CONTROLLABLE entry month (the existing one hardcodes 2026-08) and the toast provider that
// every pre-existing direct render deliberately does without.

function renderWizardAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <MonthlyUpdatePage />
      </ToastProvider>
      <LocationProbe />
    </MemoryRouter>,
  )
}

// A2 (2026-09-13 audit), per part since 2026-09-23 (spec §M6): each part step's head carries a
// kebab whose popover holds THAT part's arm-and-confirm delete.
async function openMonthActions() {
  fireEvent.click(await screen.findByRole('button', { name: 'Month actions' }))
  return screen.getByRole('dialog', { name: 'Month actions' })
}

// July: balances on file (the default fixture) and, here, a take-home too.
function savedJuly() {
  vi.mocked(spendingApi.fetchSpendingMonth).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    net_pay: month === '2026-07-01' ? '6000.00' : null,
    amounts: [],
    budgets: [],
  }))
}

const undone = {
  type: 'batch' as const, batch_id: 'u-1', at: '2026-09-04T09:00:00+00:00', source: 'undo' as const, actor: null,
  label: 'Undid: Deleted Jul 2026 balances', month: '2026-07-01', rows: 2, undoable: true, undone_by: null,
}

describe('deletes per part (2026-09-23 spec §M6)', () => {
  it('offers a delete only for a part that was saved, and none on Review', async () => {
    renderWizardAt('/update?month=2026-08-01&step=balances')
    await screen.findByLabelText('Checking')
    expect(screen.queryByRole('button', { name: 'Month actions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
    await screen.findByLabelText('Food')
    expect(screen.queryByRole('button', { name: 'Month actions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
    await screen.findByRole('button', { name: 'Save progress' })
    expect(screen.queryByRole('button', { name: 'Month actions' })).toBeNull()
  })

  it('Delete Jul 1 balances: typed guard, only the balances DELETE, its draft cleared, stays on the month', async () => {
    savedJuly()
    vi.mocked(netWorthApi.deleteMonthBalances).mockResolvedValue({ batchId: 'b-nw' })
    sessionStorage.setItem('finance-update-draft:balances:2026-07-01', '{"balances":{"1":"9.00"}}')
    sessionStorage.setItem('finance-update-draft:flows:2026-07-01', '{"netPay":"6100.00"}')
    renderWizardAt('/update?month=2026-07-01&step=balances')
    const dialog = await openMonthActions()
    expect(dialog.textContent).toContain('July spending & take-home stay as they are.')
    const button = screen.getByRole('button', { name: 'Delete Jul 1 balances' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
    expect(button.disabled).toBe(false)
    const before = vi.mocked(fetchCoverage).mock.calls.length
    fireEvent.click(button)
    await waitFor(() => expect(netWorthApi.deleteMonthBalances).toHaveBeenCalledWith('2026-07-01'))
    expect(spendingApi.deleteSpendingMonth).not.toHaveBeenCalled()
    await screen.findByText('Deleted Jul 1 balances — spending untouched.')
    expect(sessionStorage.getItem('finance-update-draft:balances:2026-07-01')).toBeNull()
    // The other part's draft is its own business.
    expect(sessionStorage.getItem('finance-update-draft:flows:2026-07-01')).not.toBeNull()
    // Coverage moved: the ribbon (and the strip) re-read it.
    await waitFor(() => expect(vi.mocked(fetchCoverage).mock.calls.length).toBeGreaterThan(before))
    expect(screen.getByRole('heading', { level: 1, name: 'Monthly update — Jul 2026' })).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-07-01&step=balances')
  })

  it('Delete July spending & take-home: only the spending DELETE — the balances stay', async () => {
    savedJuly()
    vi.mocked(spendingApi.deleteSpendingMonth).mockResolvedValue({ batchId: 'b-sp' })
    renderWizardAt('/update?month=2026-07-01&step=spending')
    const dialog = await openMonthActions()
    expect(dialog.textContent).toContain('Jul 1 balances stay as they are.')
    fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete July spending & take-home' }))
    await waitFor(() => expect(spendingApi.deleteSpendingMonth).toHaveBeenCalledWith('2026-07-01'))
    expect(netWorthApi.deleteMonthBalances).not.toHaveBeenCalled()
    await screen.findByText('Deleted July spending & take-home — balances untouched.')
  })

  it("the toast's Undo reverses that part's batch and returns to its month and step", async () => {
    savedJuly()
    vi.mocked(netWorthApi.deleteMonthBalances).mockResolvedValue({ batchId: 'b-nw' })
    vi.mocked(lifecycleApi.undoBatch).mockResolvedValue(undone)
    renderWizardAt('/update?month=2026-07-01&step=balances')
    await openMonthActions()
    fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Jul 1 balances' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledTimes(1))
    expect(lifecycleApi.undoBatch).toHaveBeenCalledWith('b-nw')
    await screen.findByText('Undone — Jul 1 balances are back.')
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-07-01&step=balances'),
    )
  })

  it('a part already gone (404) reads as deleted, with nothing to undo', async () => {
    savedJuly()
    vi.mocked(netWorthApi.deleteMonthBalances).mockRejectedValue(new ApiError('no snapshot exists for this month', 404))
    renderWizardAt('/update?month=2026-07-01&step=balances')
    await openMonthActions()
    fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Jul 1 balances' }))
    await screen.findByText('Deleted Jul 1 balances — spending untouched.')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('surfaces a failed delete and stays on the month', async () => {
    savedJuly()
    vi.mocked(netWorthApi.deleteMonthBalances).mockRejectedValue(new ApiError('db exploded', 500))
    renderWizardAt('/update?month=2026-07-01&step=balances')
    await openMonthActions()
    fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Jul 1 balances' }))
    // By TEXT, then by role: the toast provider mounts an always-present assertive region too.
    const alert = (await screen.findByText('Delete failed: db exploded — retry')).closest('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Monthly update — Jul 2026' })).toBeTruthy()
  })
})

// --- undo (2026-09-03 data-lifecycle spec §9) ---------------------------------------------

it('the save toast carries the coordinated batch Undo', async () => {
  vi.mocked(netWorthApi.putMonthBalances).mockResolvedValue({
    month: '2026-08-01', snapshot_created: true, created: 1, updated: 0, unchanged: 0, batch_id: 'b-nw2',
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 1, updated: 0, unchanged: 0, net_pay_set: true, skipped_blank: 0, net_pay_cleared: false, batch_id: 'b-sp2',
  })
  vi.mocked(lifecycleApi.undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-2', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Entered Aug 2026 balances — 1 accounts', month: '2026-08-01', rows: 2, undoable: true, undone_by: null,
  })
  renderWizardAt('/update?month=2026-08-01')
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(screen.getByText('Saved progress for Aug 2026 — balances and spending')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledTimes(1))
  expect(vi.mocked(lifecycleApi.undoBatch).mock.calls.map((c) => c[0])).toEqual(['b-nw2'])
  await screen.findByText('Undone — Aug 2026 is back to how it was.')
})

it('an all-unchanged save toasts nothing and offers no Undo', async () => {
  // Only the spending part changed, so only its leg goes out — and the server logged nothing.
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 0, updated: 0, unchanged: 1, net_pay_set: false, skipped_blank: 0, net_pay_cleared: false, batch_id: null,
  })
  renderWizardAt('/update?month=2026-08-01')
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  const reads = vi.mocked(fetchCoverage).mock.calls.length
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  // A toast is raised once the post-save /coverage read lands: wait for that, or this check would
  // pass before any toast could exist (review M23).
  await refreshLanded(reads)
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

/** The post-save refresh has answered: /coverage was read again and every step chained on it ran. */
async function refreshLanded(readsBefore: number) {
  await waitFor(() => expect(vi.mocked(fetchCoverage).mock.calls.length).toBeGreaterThan(readsBefore))
  await act(async () => {
    await Promise.resolve()
  })
}

// --- per-step saves (2026-09-04 honest-numbers spec §4) -----------------------------------

// Enter one category amount. The spending leg now writes only when the month has something
// to record, so a test that needs the spending PUT to go out has to say so out loud.
async function enterSpending(amount = '250.00') {
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: amount } })
}

it('writes balances only when nothing was entered on the spending step, and says so', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  // The pre-save note: the user learns the spending part stays home BEFORE clicking.
  await screen.findByText('This save writes Aug 1 balances — August spending is unchanged and is not sent.')
  fireEvent.click(screen.getByRole('button', { name: /save progress/i }))

  await screen.findByText(/progress saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(1)
  // The whole point: 19 rows of $0.00 are NOT a month of spending nothing.
  expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()
  expect(screen.getByText('Balances: 1 row (1 added, 0 changed, 0 unchanged).')).toBeTruthy()
  expect(screen.getByText('Spending: unchanged — not sent.')).toBeTruthy()
})

// Bug F2 (2026-09-13 audit): Food has a $300 median in the fixture matrix; its seeded "0.00"
// is not a −$300 difference until something is actually recorded for the month.
it('lists no spending difference for a seeded category nobody touched, then lists it once entered', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  await screen.findByText('No differences with an available recent reference.')
  expect(screen.queryByRole('rowheader', { name: 'Food' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
  await enterSpending('250.00')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  expect(await screen.findByRole('rowheader', { name: 'Food' })).toBeTruthy()
  expect(screen.getByText('−$50.00')).toBeTruthy()
})

it('net pay alone saves the cashflow row and not one blank category', async () => {
  // The audit's item 1: a blank box is not an entry. The leg runs (a take-home IS content)
  // and it carries nothing else — no category has a stored row or a figure in it.
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, rentCategory])
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), {
    target: { value: '9000.00' },
  })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      net_pay: '9000.00',
      amounts: [],
    }),
  )
})

it('carries the categories that already have a row, plus the ones with a figure', async () => {
  // Rent was entered last time and is being corrected to zero — a real edit, which only
  // survives if the body still lists it. Food is blank and has no row: it stays off the wire.
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, rentCategory])
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: null,
    amounts: [{ category_id: 8, amount: '2100.00' }], budgets: [],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Rent'), { target: { value: '0.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      amounts: [{ category_id: 8, amount: '0.00' }],
    }),
  )
})

it('adds a category the moment it carries a figure, stored row or not', async () => {
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, rentCategory])
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Rent'), { target: { value: '2100.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      amounts: [{ category_id: 8, amount: '2100.00' }],
    }),
  )
})

it('counts the blank categories in the receipt', async () => {
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, rentCategory])
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 1, updated: 0, unchanged: 0,
    net_pay_set: true, skipped_blank: 0, net_pay_cleared: false,
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Rent'), { target: { value: '2100.00' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9000.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(
    screen.getByText(
      'Spending: 1 row (1 added, 0 changed, 0 unchanged) · 1 category left blank. Household take-home saved.',
    ),
  ).toBeTruthy()
})

it('the receipt counts a blank the SERVER skipped too', async () => {
  // Belt and braces: the client omits a blank, the server refuses one it was sent anyway.
  // The two sets are disjoint, so the sentence adds them.
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, rentCategory])
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 1, updated: 0, unchanged: 0,
    net_pay_set: true, skipped_blank: 1, net_pay_cleared: false,
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Rent'), { target: { value: '2100.00' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9000.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(
    screen.getByText(
      'Spending: 1 row (1 added, 0 changed, 0 unchanged) · 2 categories left blank. Household take-home saved.',
    ),
  ).toBeTruthy()
})

it('an already-entered month always writes — zeroing a category is an edit, not a skip', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: null,
    amounts: [{ category_id: 7, amount: '300.00' }], budgets: [],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '0.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      amounts: [{ category_id: 7, amount: '0.00' }],
    }),
  )
})

it('leaves an empty month on the server alone when the visit enters nothing', async () => {
  // Production's Sep 2026: rows that are all $0.00 with no take-home. A balances-only visit
  // must not rewrite them (and must not count as "entered" either).
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: null,
    amounts: [{ category_id: 7, amount: '0.00' }], budgets: [],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText('Spending: unchanged — not sent.')
  expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()
})

it('prints one sentence per leg after a full save, with the cleared take-home appended', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00',
    amounts: [{ category_id: 7, amount: '300.00' }], budgets: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 0, updated: 1, unchanged: 0,
    net_pay_set: false, skipped_blank: 0, net_pay_cleared: true,
  })
  renderWizard()
  // Both parts changed, so the Review save sends — and the receipt counts — both.
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(screen.getByText('Balances: 1 row (1 added, 0 changed, 0 unchanged).')).toBeTruthy()
  expect(
    screen.getByText(
      'Spending: 1 row (0 added, 1 changed, 0 unchanged). Household take-home cleared.',
    ),
  ).toBeTruthy()
})

it('the receipt belongs to the visit — switching months clears it', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  await waitFor(() => expect(screen.queryByText(/progress saved/i)).toBeNull())
})

it('the $0 checkbox records an empty month on purpose, and is the only source of confirm_zero', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  const box = (await screen.findByLabelText('Confirm remaining categories as $0')) as HTMLInputElement
  expect(box.checked).toBe(false)
  expect(
    screen.getByText(
      'Records untouched categories as $0.00. Amounts you entered stay as entered.',
    ),
  ).toBeTruthy()
  fireEvent.click(box)
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  // The pre-save note is gone: this save WILL write the spending leg.
  expect(
    screen.queryByText('Spending: nothing entered — this save writes balances only.'),
  ).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      amounts: [{ category_id: 7, amount: '0.00' }],
      confirm_zero: true,
    }),
  )
})

it('the $0 box carries EVERY category, blank or not — that is what it consents to', async () => {
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, rentCategory])
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.click(await screen.findByLabelText('Confirm remaining categories as $0'))
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      amounts: [
        { category_id: 7, amount: '0.00' },
        { category_id: 8, amount: '0.00' },
      ],
      confirm_zero: true,
    }),
  )
})

it('forgets the $0 intent on a month switch — consent is about one save', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.click(await screen.findByLabelText('Confirm remaining categories as $0'))
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  // The step survives the switch (2026-09-23 spec §M1); read the box once June has LANDED —
  // until then the dimmed card on screen is still August's.
  await waitFor(() =>
    expect(screen.getByLabelText('Food').closest('.card')?.getAttribute('aria-busy')).toBeNull(),
  )
  expect(screen.getByRole('heading', { level: 1, name: 'Monthly update — Jun 2026' })).toBeTruthy()
  expect((screen.getByLabelText('Confirm remaining categories as $0') as HTMLInputElement).checked).toBe(false)
})

it('shows the server refusal verbatim when an emptying save skips the box', async () => {
  // Lane B's guard: all-zero amounts with the take-home cleared and no confirm_zero. The
  // wizard must not swallow the sentence that says how to proceed.
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00', amounts: [], budgets: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValue(
    new ApiError(
      'Nothing to record: every category is $0.00 and no take-home was entered — set confirm_zero to write an empty month on purpose',
      422,
    ),
  )
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(
    'Nothing to record: every category is $0.00 and no take-home was entered — set confirm_zero to write an empty month on purpose',
  )
  expect(screen.getByRole('button', { name: 'Save progress' })).toBeTruthy()
})

// --- the empty-month repair (2026-09-04 honest-numbers spec §4) ---------------------------

// Production's Sep 2026 shape: rows that exist and are all $0.00, and no take-home.
const EMPTY_MONTH = {
  month: '2026-08-01', exists: true, net_pay: null,
  amounts: [{ category_id: 7, amount: '0.00' }], budgets: [],
}

it('flags a month that was saved with no spending, and offers the delete', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  renderWizard()
  expect(
    await screen.findByText(
      'This month was saved with no spending. Enter it below, or delete the empty month.',
    ),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Delete the empty month' })).toBeTruthy()
})

it('says nothing about an empty month when the month has spending', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  expect(screen.queryByText(/saved with no spending/)).toBeNull()
})

it('treats a month with not a single row as missing, not empty', async () => {
  // No amount rows and no take-home is the MISSING shape (spec §3), not the empty one:
  // there is nothing for the repair delete to remove, so offering it would 404 on the
  // click and report "Delete failed" about a month that was already clean.
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: null, amounts: [], budgets: [],
  })
  renderWizard()
  await screen.findByLabelText('Checking')
  expect(screen.queryByText(/saved with no spending/)).toBeNull()
})

it('deletes only the spending rows, offers Undo, and leaves the balances snapshot alone', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  vi.mocked(spendingApi.deleteSpendingMonth).mockResolvedValue({ batchId: 'b-empty' })
  vi.mocked(lifecycleApi.undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-9', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Deleted Aug 2026 spending', month: '2026-08-01', rows: 1, undoable: true,
    undone_by: null,
  })
  renderWizardAt('/update?month=2026-08-01')
  fireEvent.click(await screen.findByRole('button', { name: 'Delete the empty month' }))
  await waitFor(() =>
    expect(spendingApi.deleteSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      source: 'repair',
    }),
  )
  // The month keeps its net worth: only the spending half was empty.
  expect(netWorthApi.deleteMonthBalances).not.toHaveBeenCalled()
  await screen.findByText("Deleted Aug 2026's empty spending rows — balances untouched.")
  // Coverage moved (the spending feed is gone), so the ribbon has to re-read it.
  await waitFor(() => expect(vi.mocked(fetchCoverage).mock.calls.length).toBeGreaterThan(1))
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledWith('b-empty'))
  await screen.findByText("Undone — Aug 2026's rows are back.")
})

it('surfaces a failed repair instead of pretending the month is clean', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  vi.mocked(spendingApi.deleteSpendingMonth).mockRejectedValue(new ApiError('db exploded', 500))
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: 'Delete the empty month' }))
  expect(await screen.findByText('Delete failed: db exploded — retry')).toBeTruthy()
  // The banner stays: the month is still empty.
  expect(screen.getByText(/saved with no spending/)).toBeTruthy()
})

it('drops the banner the moment the month is given real spending', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  renderWizard()
  await screen.findByText(/saved with no spending/)
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  expect(screen.queryByText(/saved with no spending/)).toBeNull()
})

// --- derived parents (2026-09-04 honest-numbers spec §5) ----------------------------------

const parent401k = {
  id: 8, name: 'Fidelity 401(k)', slug: 'fidelity-401k', group: 'pre_tax' as const,
  sort_order: 6, is_active: true, is_component: false, parent_account_id: null, person_id: 1,
}
const preTaxPart = {
  id: 9, name: '401(k) pre-tax', slug: 'k-pre-tax', group: 'pre_tax' as const,
  sort_order: 7, is_active: true, is_component: true, parent_account_id: 8, person_id: 1,
}
const afterTaxPart = {
  id: 10, name: '401(k) after-tax', slug: 'k-after-tax', group: 'pre_tax' as const,
  sort_order: 8, is_active: true, is_component: true, parent_account_id: 8, person_id: 1,
}

function withComponents(accounts = [account, parent401k, preTaxPart, afterTaxPart]) {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue(accounts)
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-07-01'
        ? [
            { account_id: 1, balance: '1500.00' },
            { account_id: 8, balance: '1000.00' },
            { account_id: 9, balance: '600.00' },
            { account_id: 10, balance: '400.00' },
          ]
        : [],
  }))
}

it('renders a parent with components as a read-only derived row that sums its cells live', async () => {
  withComponents()
  renderWizard()
  const row = (await screen.findByText('Fidelity 401(k)')).closest('tr') as HTMLElement
  expect(row.className).toContain('entry-derived')
  expect(within(row).getByText('derived')).toBeTruthy()
  // No box at all: an account with components has no balance of its own (spec §5).
  expect(within(row).queryByRole('textbox')).toBeNull()
  const cells = within(row).getAllByRole('cell')
  expect(cells[1].textContent).toBe('$1,000.00') // last month, as stored
  expect(cells[2].textContent).toBe('$1,000.00') // this month, derived from the seed
  expect(cells[3].textContent).toBe('$0.00') // Δ

  // A component cell moves the parent, its Δ and the live net worth in the same keystroke.
  fireEvent.change(screen.getByLabelText(/^401\(k\) pre-tax/), { target: { value: '700.00' } })
  expect(within(row).getAllByRole('cell')[2].textContent).toBe('$1,100.00')
  expect(within(row).getAllByRole('cell')[3].textContent).toBe('$100.00')
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(within(footer).getByText('$2,600.00')).toBeDefined() // 1,500 cash + 1,100 derived
})

it('never sends a derived parent — the server computes it from the components', async () => {
  withComponents()
  renderWizard()
  await screen.findByText('Fidelity 401(k)')
  // A month with no snapshot yet: its pre-fill is recorded as it stands by the part's own Save.
  fireEvent.click(screen.getByRole('button', { name: 'Save Aug 1 balances' }))
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 9, balance: '600.00' },
          { account_id: 10, balance: '400.00' },
        ],
      }),
    ),
  )
})

it('a column paste fills the component cells and skips the derived parent', async () => {
  withComponents()
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  fireEvent.paste(checking, { clipboardData: { getData: () => '1600\n700\n500' } })

  expect(checking.value).toBe('1600')
  expect((screen.getByLabelText(/^401\(k\) pre-tax/) as HTMLInputElement).value).toBe('$700.00')
  expect((screen.getByLabelText(/^401\(k\) after-tax/) as HTMLInputElement).value).toBe('$500.00')
  // Three targets, not four: the derived row is not a paste slot, so nothing shifts past it.
  expect(screen.getByText(/pasted 3 of 3 values/i)).toBeDefined()
  const row = screen.getByText('Fidelity 401(k)').closest('tr') as HTMLElement
  expect(within(row).getAllByRole('cell')[2].textContent).toBe('$1,200.00')
})

it('autofocuses the first TYPABLE cell when the table opens on a derived parent', async () => {
  withComponents([parent401k, preTaxPart, afterTaxPart])
  renderWizard()
  const first = await screen.findByLabelText(/^401\(k\) pre-tax/)
  expect(document.activeElement).toBe(first)
})

// --- the 2026-09-04 review: history without component rows, and the is_component key ------

// An EXISTING month, so the wizard is editing history: which component rows that month
// actually stores is exactly what decides derived-vs-typed.
function withStoredMonth(balances: { account_id: string | number; balance: string }[]) {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([
    account,
    parent401k,
    preTaxPart,
    afterTaxPart,
  ])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-08-01',
    recorded_on: null,
    notes: null,
    balances: month === '2026-08-01' ? (balances as { account_id: number; balance: string }[]) : [],
  }))
}

// Saves the balances part of an EXISTING month. A note makes the part differ from what the server
// holds (the Save is on only then, spec §M1) without touching the balances payload under test.
async function saveTheMonth() {
  fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: 'checked' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Aug 1 balances' }))
}

it('keeps a parent TYPED on an existing month that stores no component rows', async () => {
  withStoredMonth([
    { account_id: 1, balance: '1500.00' },
    { account_id: 8, balance: '1000.00' },
  ])
  renderWizard()
  // Deriving here would print $0.00 over a total someone typed by hand — and then SAVE it.
  // A real BOX holding the stored total — '$1,000.00' is AmountInput's blurred echo of the
  // same '1000.00' state (Checking is the autofocused cell, so this one shows formatted).
  const parent = (await screen.findByLabelText('Fidelity 401(k)')) as HTMLInputElement
  expect(parent.value).toBe('$1,000.00')
  expect(
    (screen.getByText('Fidelity 401(k)').closest('tr') as HTMLElement).className,
  ).not.toContain('entry-derived')

  await saveTheMonth()
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        // The never-typed components stay OUT: their seeded $0.00 rows are precisely what
        // would flip this row to a derived $0.00 on the next visit.
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 8, balance: '1000.00' },
        ],
      }),
    ),
  )
})

it('derives a parent on an existing month that stores even one component row', async () => {
  withStoredMonth([
    { account_id: 1, balance: '1500.00' },
    { account_id: 8, balance: '1000.00' },
    { account_id: 9, balance: '600.00' },
  ])
  renderWizard()
  const row = (await screen.findByText('Fidelity 401(k)')).closest('tr') as HTMLElement
  expect(row.className).toContain('entry-derived')
  // 600 stored, plus a sibling with no row of its own at 0.00 — the stored 1,000 total is
  // NOT what this month is worth once its components speak.
  expect(within(row).getAllByRole('cell')[2].textContent).toBe('$600.00')

  await saveTheMonth()
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 9, balance: '600.00' },
          { account_id: 10, balance: '0.00' },
        ],
      }),
    ),
  )
})

it('hands a hand-typed parent over to its components the moment one is entered', async () => {
  withStoredMonth([
    { account_id: 1, balance: '1500.00' },
    { account_id: 8, balance: '1000.00' },
  ])
  renderWizard()
  fireEvent.change(await screen.findByLabelText(/^401\(k\) pre-tax/), {
    target: { value: '700.00' },
  })
  // The row IS the sum from this keystroke on — shipping the typed total AND a component
  // is the server's 422 ("derived from its components").
  const row = screen.getByText('Fidelity 401(k)').closest('tr') as HTMLElement
  expect(row.className).toContain('entry-derived')
  expect(within(row).getAllByRole('cell')[2].textContent).toBe('$700.00')

  await saveTheMonth()
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 9, balance: '700.00' },
          { account_id: 10, balance: '0.00' },
        ],
      }),
    ),
  )
})

it('a restored draft keeps the handover, so the entered component still ships', async () => {
  withStoredMonth([
    { account_id: 1, balance: '1500.00' },
    { account_id: 8, balance: '1000.00' },
  ])
  const first = renderWizard()
  fireEvent.change(await screen.findByLabelText(/^401\(k\) pre-tax/), {
    target: { value: '700.00' },
  })
  first.unmount()

  renderWizard()
  await screen.findByText(/restored unsaved/i)
  // Still the sum: putting the parent back as a typed box while restoring the cells under it
  // would drop the very component the draft exists to preserve.
  const row = screen.getByText('Fidelity 401(k)').closest('tr') as HTMLElement
  expect(row.className).toContain('entry-derived')
  expect(within(row).getAllByRole('cell')[2].textContent).toBe('$700.00')

  await saveTheMonth()
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 9, balance: '700.00' },
          { account_id: 10, balance: '0.00' },
        ],
      }),
    ),
  )
})

it('discarding a restored draft puts the hand-typed parent back', async () => {
  withStoredMonth([
    { account_id: 1, balance: '1500.00' },
    { account_id: 8, balance: '1000.00' },
  ])
  const first = renderWizard()
  // Dirty something that is NOT a component, so visit two opens with the Discard affordance
  // and the parent still hand-typed.
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  first.unmount()

  renderWizard()
  await screen.findByText(/restored unsaved/i)
  // NOW hand the parent over, then change your mind.
  fireEvent.change(await screen.findByLabelText(/^401\(k\) pre-tax/), {
    target: { value: '700.00' },
  })
  fireEvent.click(screen.getByRole('button', { name: /discard restored balances/i }))

  // Back to the month as STORED. A discard that restored the figures but left the handover
  // standing would render a derived row printing $1,000.00 over cells that read $0.00 — and
  // then save the zeros, which is the clobber the typed row exists to stop.
  const parent = (await screen.findByLabelText('Fidelity 401(k)')) as HTMLInputElement
  expect(parent.value).toBe('$1,000.00')
  expect(
    (screen.getByText('Fidelity 401(k)').closest('tr') as HTMLElement).className,
  ).not.toContain('entry-derived')

  await saveTheMonth()
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 8, balance: '1000.00' },
        ],
      }),
    ),
  )
})

it('ignores a linked account that is not flagged as a component', async () => {
  // `is_component` is the rollup key on both sides of the wire (lane B's server, lane E's
  // Accounts card): a parent_account_id set WITHOUT it must not drive a derived preview
  // the server will never write.
  withComponents([account, parent401k, { ...preTaxPart, is_component: false }])
  renderWizard()
  // A real BOX holding the stored total — '$1,000.00' is AmountInput's blurred echo of the
  // same '1000.00' state (Checking is the autofocused cell, so this one shows formatted).
  const parent = (await screen.findByLabelText('Fidelity 401(k)')) as HTMLInputElement
  expect(parent.value).toBe('$1,000.00')
  expect(
    (screen.getByText('Fidelity 401(k)').closest('tr') as HTMLElement).className,
  ).not.toContain('entry-derived')
})

const retiredPart = {
  id: 11, name: '401(k) legacy', slug: 'k-legacy', group: 'pre_tax' as const,
  sort_order: 9, is_active: false, is_component: true, parent_account_id: 8, person_id: 1,
}

it('counts a retired component that still has a row, and never sends it back', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([
    account, parent401k, preTaxPart, retiredPart,
  ])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-08-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-08-01'
        ? [
            { account_id: 1, balance: '1500.00' },
            { account_id: 8, balance: '1000.00' },
            { account_id: 9, balance: '600.00' },
            { account_id: 11, balance: '400.00' },
          ]
        : [],
  }))
  renderWizard()
  // The server derives from every flagged component that HAS a value this month, active or
  // not (it falls back to a row it was not sent), so the retired one rides along read-only —
  // off screen its parent's total would be $400 of nowhere.
  const retired = (await screen.findByText('401(k) legacy')).closest('tr') as HTMLElement
  expect(within(retired).getByText('inactive')).toBeTruthy()
  expect(within(retired).queryByRole('textbox')).toBeNull()
  expect(within(retired).getAllByRole('cell')[2].textContent).toBe('$400.00')
  const parentRow = screen.getByText('Fidelity 401(k)').closest('tr') as HTMLElement
  expect(parentRow.className).toContain('entry-derived')
  expect(within(parentRow).getAllByRole('cell')[2].textContent).toBe('$1,000.00')

  await saveTheMonth()
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        // Neither the derived parent nor the retired row: the client may not re-assert a
        // figure it does not let anyone edit.
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 9, balance: '600.00' },
        ],
      }),
    ),
  )
})

it('does not flag the month it just recorded as $0 on purpose', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.click(await screen.findByLabelText('Confirm remaining categories as $0'))
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
  await screen.findByText(/progress saved/i)
  // The receipt is the answer to a deliberate empty month; repeating the repair prompt in
  // the same breath would argue with the choice just made. The next VISIT still flags it —
  // the month really is empty, and by then the receipt is gone.
  expect(screen.queryByText(/saved with no spending/)).toBeNull()
})

it('lands the caret on the first cell after the repair instead of on the body', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  vi.mocked(spendingApi.deleteSpendingMonth).mockResolvedValue({ batchId: null })
  renderWizardAt('/update?month=2026-08-01')
  fireEvent.click(await screen.findByRole('button', { name: 'Delete the empty month' }))
  await waitFor(() => expect(screen.queryByText(/saved with no spending/)).toBeNull())
  // The button the click landed on is gone with the rows it repaired; leaving the caret on
  // <body> restarts the next Tab at the top of the page.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Checking')))
})

it('ties the $0 checkbox to the sentence that explains it', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  const box = await screen.findByLabelText('Confirm remaining categories as $0')
  // The sentence is the control's whole explanation, so it has to reach a screen reader as
  // the control's description, not as a paragraph that happens to sit nearby.
  const hint = document.getElementById(box.getAttribute('aria-describedby') ?? '')
  expect(hint?.textContent).toBe(
    'Records untouched categories as $0.00. Amounts you entered stay as entered.',
  )
})

describe('MonthlyUpdatePage — shell frame (2026-09-03 spec §5–§7)', () => {
  it('renders the month title without an icon, the steps under it, and the ribbon in the scope row', async () => {
    renderPage('/update?month=2026-09-01')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Monthly update — Sep 2026' }),
    ).toBeTruthy()
    expect(document.querySelector('.page-frame-subheader .wizard-steps')).toBeTruthy()
    expect(document.querySelector('.page-frame-scope .ribbon')).toBeTruthy()
    expect(document.querySelector('.page-header')).toBeNull()
  })

  it('a ribbon click goes through the wizard’s own handler (draft-safe) and keeps the step', async () => {
    // August has no snapshot in the default fixture, and since the two parts became independent
    // (2026-09-23 spec §M1) that no longer sends the user back to Balances: its spending can be
    // entered without them.
    renderPage('/update?month=2026-09-01&step=spending')
    fireEvent.click(await screen.findByRole('button', { name: /^Aug 2026/ }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/update?month=2026-08-01&step=spending',
      ),
    )
  })

  it('keeps the step when the month it moves to already has balances', async () => {
    // Audit item 18: entering the same step across several months is the sheet ritual, and
    // being thrown back to Balances every time made a five-month catch-up five walks long.
    renderPage('/update?month=2026-08-01&step=spending')
    await screen.findByLabelText('Food')
    fireEvent.click(screen.getByRole('button', { name: /^Jul 2026/ }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/update?month=2026-07-01&step=spending',
      ),
    )
  })

  it('keeps the review step too, even for a month with no balances', async () => {
    renderPage('/update?month=2026-08-01&step=review')
    await screen.findByText(/review & save/i)
    fireEvent.click(screen.getByRole('button', { name: /^Jul 2026/ }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/update?month=2026-07-01&step=review',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/update?month=2026-06-01&step=review',
      ),
    )
  })

  it('re-reads coverage after a save, so the just-saved chip fills without leaving the month', async () => {
    renderWizard()
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
    fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
    await screen.findByLabelText('Food')
    fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
    const before = vi.mocked(fetchCoverage).mock.calls.length
    fireEvent.click(await screen.findByRole('button', { name: /save progress/i }))
    await screen.findByText(/progress saved/i)
    // Once for the ribbon (its revalidate nonce) and once for the wizard's own read of what is
    // due (2026-09-23 spec §M2) — in the app the api client joins the two overlapping GETs. Any
    // more would be a nonce that changed twice per save.
    await waitFor(() => expect(vi.mocked(fetchCoverage).mock.calls.length).toBe(before + 2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(vi.mocked(fetchCoverage).mock.calls.length).toBe(before + 2)
  })
})

// --- the live savings rate is the CASH rate (2026-09-09 audit item 20) --------------------

it('leaves transfers out of the live savings rate and names it the cash rate', async () => {
  // The wizard subtracted every category, so a month with a $1,000 brokerage deposit read
  // ten points below the same month on the Spending page, whose rate is
  // (net pay − living − tax) ÷ net pay. Same arithmetic here now.
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([
    category,
    transferCategory,
    taxCategory,
  ])
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '2000.00' } })
  fireEvent.change(screen.getByLabelText('Brokerage deposit'), { target: { value: '1000.00' } })
  fireEvent.change(screen.getByLabelText('Tax payment'), { target: { value: '500.00' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '10000.00' } })

  const footer = screen.getByRole('status', { name: 'Live totals' })
  // Total spend still means every category — it is the total the server's matrix prints.
  expect(footer.textContent).toContain('Living spending (live): $2,000.00')
  // (10000 − 2000 − 500) ÷ 10000 = 75.0%, not the 65.0% the old walk produced.
  expect(footer.textContent).toContain('Savings rate — cash: 75.0%')

  // The review step agrees, by construction — both read the same preview.
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  await screen.findByText(/review & save/i)
  expect(screen.getByText('75.0%')).toBeTruthy()
})

it('shows no rate at all without a take-home to divide by', async () => {
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, transferCategory])
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '2000.00' } })
  const footer = screen.getByRole('status', { name: 'Live totals' })
  expect(footer.textContent).toContain('Savings rate — cash: —')
})

it('saves progress without closing, then closes only after feed confirmations', async () => {
  // August has its balances (a month without them cannot close — spec §M1's own test below).
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month, exists: true, recorded_on: month, notes: null, balances: [{ account_id: 1, balance: '1500.00' }],
  }))
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9000' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  const close = await screen.findByRole('button', { name: 'Save and close August' }) as HTMLButtonElement
  expect(close.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
  await screen.findByRole('heading', { name: 'Progress saved' })
  expect(vi.mocked(monthReviewApi.saveMonthReview).mock.calls[0][1]).toMatchObject({ close: false, expected_revision: 'a'.repeat(64) })
  fireEvent.click(screen.getByLabelText('I checked every Aug 1 account balance.'))
  fireEvent.click(screen.getByLabelText('I checked August spending, tax and transfers.'))
  fireEvent.click(screen.getByLabelText('I checked August household take-home.'))
  expect(close.disabled).toBe(false)
  fireEvent.click(close)
  await screen.findByRole('heading', { name: 'Month closed' })
  expect(vi.mocked(monthReviewApi.saveMonthReview).mock.calls[1][1]).toMatchObject({ close: true, reviewed: { balances: true, spending: true, take_home: true } })
})

it('clears a spending confirmation when its entries change', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^next: [a-z]+ spending$/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByLabelText('I checked August spending, tax and transfers.'))
  fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '275' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  expect((await screen.findByLabelText('I checked August spending, tax and transfers.') as HTMLInputElement).checked).toBe(false)
})

it('keeps the draft and prevents silent overwrite when the server revision changes', async () => {
  vi.mocked(monthReviewApi.saveMonthReview).mockRejectedValueOnce(new ApiError('This month changed since it was loaded. Reload before saving.', 409))
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1900' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
  expect((await screen.findByRole('alert')).textContent).toContain('changed since it was loaded')
  expect(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')).toContain('1900')
  expect(screen.queryByRole('heading', { name: 'Progress saved' })).toBeNull()
})

function pendingMonthSave() {
  let resolve!: (result: MonthSaveResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<MonthSaveResult>((accept, refuse) => { resolve = accept; reject = refuse })
  return { promise, resolve, reject }
}

function savedMonthResult(month: string, revision = 'b'): MonthSaveResult {
  return {
    month, batch_id: null, spending: null,
    balances: { month, snapshot_created: true, created: 1, updated: 0, unchanged: 0 },
    review: { ...reviewFixture(month), input_revision: revision.repeat(64) },
  }
}

it('keeps the new month and its pending save intact when the prior month finishes saving', async () => {
  const august = pendingMonthSave()
  const june = pendingMonthSave()
  vi.mocked(monthReviewApi.saveMonthReview)
    .mockImplementationOnce(() => august.promise)
    .mockImplementationOnce(() => june.promise)
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
  await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))

  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  // The step survives the switch (2026-09-23 spec §M1): walk back to June's balances.
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await landedBalanceCell(), { target: { value: '2200' } })
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'June draft' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
  await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(2))

  await act(async () => { august.resolve(savedMonthResult('2026-08-01')) })
  expect(screen.getByRole('heading', { name: 'Monthly update — Jun 2026' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByRole('heading', { name: 'Progress saved' })).toBeNull()
  expect(JSON.parse(sessionStorage.getItem('finance-update-draft:balances:2026-06-01')!)).toMatchObject({
    balances: { 1: '2200' }, notes: 'June draft',
  })

  await act(async () => { june.resolve(savedMonthResult('2026-06-01', 'c')) })
  await screen.findByRole('heading', { name: 'Progress saved' })
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  expect((await screen.findByLabelText('Checking') as HTMLInputElement).value).toBe('2200')
  expect((screen.getByLabelText('Notes') as HTMLInputElement).value).toBe('June draft')
  expect(sessionStorage.getItem('finance-update-draft:balances:2026-06-01')).toBeNull()
})

it('preserves entries typed during a save and submits them against the returned revision', async () => {
  const pending = pendingMonthSave()
  vi.mocked(monthReviewApi.saveMonthReview).mockImplementationOnce(() => pending.promise)
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))

  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1900' } })
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Entered while saving' } })
  fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '275' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9100' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))

  await act(async () => { pending.resolve(savedMonthResult('2026-08-01')) })
  // Each part still unsaved is named, with the step that saves it (review M2).
  await screen.findByText('Aug 1 balances still have unsaved changes — save them on the Balances step.')
  expect(screen.getByText('August spending & take-home still have unsaved changes — save them on the Spending step.')).toBeTruthy()
  expect(JSON.parse(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')!)).toMatchObject({
    balances: { 1: '1900' }, notes: 'Entered while saving',
  })
  expect(JSON.parse(sessionStorage.getItem('finance-update-draft:flows:2026-08-01')!)).toMatchObject({
    amounts: { 7: '275' }, netPay: '9100',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
  await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(2))
  expect(vi.mocked(monthReviewApi.saveMonthReview).mock.calls[1]).toEqual([
    '2026-08-01', expect.objectContaining({
      expected_revision: 'b'.repeat(64),
      balances: expect.objectContaining({ balances: [{ account_id: 1, balance: '1900' }], notes: 'Entered while saving' }),
      spending: { amounts: [{ category_id: 7, amount: '275' }], net_pay: '9100' },
    }),
  ])
  await waitFor(() => expect(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')).toBeNull())
  expect(sessionStorage.getItem('finance-update-draft:flows:2026-08-01')).toBeNull()
  expect(screen.queryByText(/still have unsaved changes/)).toBeNull()
})

it("after one part saves, the receipt names the other part's unsaved changes (review M2)", async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^2\s*spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Aug 1 balances' }))
  await screen.findByRole('heading', { name: 'Aug 1 balances saved' })
  expect(
    screen.getByText('August spending & take-home still have unsaved changes — save them on the Spending step.'),
  ).toBeTruthy()
  expect(screen.queryByText(/^Aug 1 balances still have unsaved changes/)).toBeNull()
})

it('rejects a response from an earlier load even after returning to the same month', async () => {
  const pending = pendingMonthSave()
  let augustLoads = 0
  vi.mocked(monthReviewApi.fetchMonthReview).mockImplementation(async month => ({
    ...reviewFixture(month),
    input_revision: (month === '2026-08-01' && ++augustLoads > 1 ? 'c' : 'a').repeat(64),
  }))
  vi.mocked(monthReviewApi.saveMonthReview).mockImplementationOnce(() => pending.promise)
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  await landedBalanceCell()
  fireEvent.click(screen.getByRole('button', { name: /^Aug 2026/ }))
  fireEvent.change(await landedBalanceCell(), { target: { value: '1950' } })

  await act(async () => { pending.resolve(savedMonthResult('2026-08-01')) })
  expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('1950')
  expect(screen.queryByRole('heading', { name: 'Progress saved' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
  await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(2))
  expect(vi.mocked(monthReviewApi.saveMonthReview).mock.calls[1][1]).toMatchObject({
    expected_revision: 'c'.repeat(64), balances: { balances: [{ account_id: 1, balance: '1950' }] },
  })
})

it('keeps a late save conflict out of the newly loaded month', async () => {
  const pending = pendingMonthSave()
  vi.mocked(monthReviewApi.saveMonthReview).mockImplementationOnce(() => pending.promise)
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await landedBalanceCell(), { target: { value: '2300' } })

  await act(async () => { pending.reject(new ApiError('August changed during the save.', 409)) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reload latest and compare draft' })).toBeNull()
  expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('2300')
  expect(JSON.parse(sessionStorage.getItem('finance-update-draft:balances:2026-06-01')!)).toMatchObject({ balances: { 1: '2300' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  expect((await screen.findByRole('button', { name: 'Save progress' }) as HTMLButtonElement).disabled).toBe(false)
})

// W5/T4 (2026-09-13 audit): the receipt reads like the Overview it feeds — four tiles, and the
// close-gate sentence sits in the footer beside the button it explains.
it('lays the Review step out as four tiles with the cash split and the close gate in the footer', async () => {
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, transferCategory, taxCategory])
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /^next: [a-z]+ spending$/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
  fireEvent.change(screen.getByLabelText('Brokerage deposit'), { target: { value: '100.00' } })
  fireEvent.change(screen.getByLabelText('Tax payment'), { target: { value: '50.00' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '1000.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  await screen.findByRole('heading', { name: /^Review & save/ })
  const tile = (label: string) => screen.getByText(label).closest('.stat-tile') as HTMLElement
  // The first tile tells the month's story (2026-09-23 spec §M5): its 1st's balances, and the
  // change to the next 1st — which needs Sep 1 balances this fixture does not have.
  expect(tile('Aug 1 balances').querySelector('.stat-value')?.textContent).toBe('$1,500.00')
  expect(tile('Aug 1 balances').querySelector('.stat-delta')?.textContent).toBe(
    "August's change appears once Sep 1 balances are recorded",
  )
  expect(tile('Living spending').querySelector('.stat-value')?.textContent).toBe('$250.00')
  expect(tile('Cash outflow').querySelector('.stat-value')?.textContent).toBe('$300.00')
  expect(tile('Cash outflow').querySelector('.stat-delta')?.textContent).toBe('tax $50.00 · transfers $100.00')
  expect(tile('Cash saved').querySelector('.stat-value')?.textContent).toBe('70.0%')
  expect(tile('Cash saved').querySelector('.stat-delta')?.textContent).toBe('$700.00 of $1,000.00 take-home')
  // The gate sentence lives in the footer, next to the disabled primary — here the first thing to
  // fix: August has no balances of its own yet.
  const footer = screen.getByRole('button', { name: 'Save and close August' }).closest('.wizard-footer') as HTMLElement
  expect(footer.textContent).toContain('Record Aug 1 balances before closing August.')
  // The month is printed by the h1; the eyebrow does not repeat it.
  expect(screen.queryByRole('heading', { name: /Review & save — / })).toBeNull()
})

it('the kebab opens the month-actions popover and Escape closes it back onto the button', async () => {
  renderWizardAt('/update?month=2026-07-01&step=balances')
  const trigger = await screen.findByRole('button', { name: 'Month actions' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
  const dialog = await openMonthActions()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(dialog.className).toContain('popover-surface')
  expect(within(dialog).getByRole('button', { name: 'Delete Jul 1 balances' })).toBeTruthy()
  // A dialog takes the caret with it (P1 review round): the arm box is the first control.
  expect(document.activeElement).toBe(screen.getByLabelText('Type 2026-07 to confirm'))
  // A typed arm does not survive a close — reopening never shows a live Delete button.
  fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Month actions' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await openMonthActions()
  expect((screen.getByLabelText('Type 2026-07 to confirm') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete Jul 1 balances' }).disabled).toBe(true)
})

describe('zero accounts (2026-09-14 guide spec §7.2)', () => {
  it('points at Settings and the guide instead of an empty table', async () => {
    vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([])
    renderWizard()
    const note = await screen.findByText(/No accounts yet/)
    const links = Array.from(note.closest('p')!.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/settings?section=household#accounts', '/guide?section=start#start-setup'])
    expect(document.querySelector('table.entry-table')?.hasAttribute('hidden')).toBe(true)
    // Nothing to save without accounts; moving on to the month's spending still works.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save Aug 1 balances' }).disabled).toBe(true)
  })

  it('is absent with one account', async () => {
    renderWizard()
    await screen.findByRole('button', { name: 'Next: August spending' })
    expect(screen.queryByText(/No accounts yet/)).toBeNull()
    expect(document.querySelector('table.entry-table')?.hasAttribute('hidden')).toBe(false)
  })
})

// --- the two-part monthly update (2026-09-23 spec §M1–§M6) ---------------------------------

describe('drafts per part (2026-09-23 spec §M6)', () => {
  it('drafts each part under its own key and names the part it restores', async () => {
    const first = renderWizard()
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
    fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
    fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
    expect(JSON.parse(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')!)).toMatchObject({
      balances: { 1: '1600.00' },
    })
    expect(JSON.parse(sessionStorage.getItem('finance-update-draft:flows:2026-08-01')!)).toMatchObject({
      amounts: { 7: '250.00' },
    })
    first.unmount()

    renderWizard()
    expect(await screen.findByText('Restored unsaved Aug 1 balances — they are not saved yet.')).toBeTruthy()
    expect(screen.getByText('Restored unsaved August spending & take-home — they are not saved yet.')).toBeTruthy()
    // Discarding one part puts back that part's seed and leaves the other's draft — and banner — standing.
    fireEvent.click(screen.getByRole('button', { name: 'Discard restored balances' }))
    expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('1500.00')
    expect(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')).toBeNull()
    expect(sessionStorage.getItem('finance-update-draft:flows:2026-08-01')).not.toBeNull()
    expect(screen.queryByText('Restored unsaved Aug 1 balances — they are not saved yet.')).toBeNull()
    expect(screen.getByText('Restored unsaved August spending & take-home — they are not saved yet.')).toBeTruthy()
  })

  it('splits a legacy whole-month draft into the two parts on first read and drops its date', async () => {
    sessionStorage.setItem(
      'finance-update-draft:2026-08-01',
      JSON.stringify({ balances: { 1: '1700.00' }, amounts: { 7: '99.00' }, netPay: '', recordedOn: '2026-08-03', notes: '' }),
    )
    renderWizard()
    expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1700.00')
    expect(sessionStorage.getItem('finance-update-draft:2026-08-01')).toBeNull()
    expect(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')).not.toBeNull()
    expect(JSON.parse(sessionStorage.getItem('finance-update-draft:flows:2026-08-01')!)).toEqual({
      amounts: { 7: '99.00' },
      netPay: '',
    })
    expect(screen.getByText('Restored unsaved Aug 1 balances — they are not saved yet.')).toBeTruthy()
    expect(screen.getByText('Restored unsaved August spending & take-home — they are not saved yet.')).toBeTruthy()
  })

  it('a reformatted figure is not an edit: no draft is filed', async () => {
    renderWizard()
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1500' } })
    expect(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')).toBeNull()
    fireEvent.change(screen.getByLabelText('Checking'), { target: { value: '1500.5' } })
    expect(sessionStorage.getItem('finance-update-draft:balances:2026-08-01')).not.toBeNull()
  })
})

it('has no Recorded-on box and never sends recorded_on (2026-09-23 spec §M4)', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  expect(screen.queryByLabelText(/recorded on/i)).toBeNull()
  fireEvent.change(screen.getByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
  await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
  const sent = vi.mocked(monthReviewApi.saveMonthReview).mock.calls[0][1]
  expect(sent.balances).toBeDefined()
  expect('recorded_on' in sent.balances!).toBe(false)
})

// The body of the i-th month-review PUT the wizard sent.
const sentBody = (i = 0) => vi.mocked(monthReviewApi.saveMonthReview).mock.calls[i][1]

describe('two parts, each saving only itself (2026-09-23 spec §M1)', () => {
  it('a balances save sends balances only — never spending, never recorded_on', async () => {
    renderWizard()
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Aug 1 balances' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect(sentBody().balances).toEqual({ notes: null, balances: [{ account_id: 1, balance: '1600.00' }] })
    expect('spending' in sentBody()).toBe(false)
    expect(sentBody()).toMatchObject({ close: false, reviewed: { balances: false, spending: false, take_home: false } })
    expect(await screen.findByRole('heading', { name: 'Aug 1 balances saved' })).toBeTruthy()
    expect(screen.getByText('Balances: 1 row (1 added, 0 changed, 0 unchanged).')).toBeTruthy()
  })

  it('a spending save sends spending only — and a month with no snapshot gets none', async () => {
    renderPage('/update?month=2026-08-01&step=spending')
    fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
    fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '9000.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save August spending' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect('balances' in sentBody()).toBe(false)
    expect(sentBody().spending).toEqual({ amounts: [{ category_id: 7, amount: '250.00' }], net_pay: '9000.00' })
    expect(netWorthApi.putMonthBalances).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'August spending saved' })).toBeTruthy()
  })

  it('Save stays off until its part changes; a month with no snapshot may record its pre-fill as is', async () => {
    vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
      month, exists: true, recorded_on: month, notes: null, balances: [{ account_id: 1, balance: '1500.00' }],
    }))
    renderWizard()
    const save = (await screen.findByRole('button', { name: 'Save Aug 1 balances' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Checking'), { target: { value: '1600.00' } })
    expect(save.disabled).toBe(false)
    cleanup()
    vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
      month, exists: month === '2026-07-01', recorded_on: null, notes: null,
      balances: month === '2026-07-01' ? [{ account_id: 1, balance: '1500.00' }] : [],
    }))
    renderWizard()
    expect(((await screen.findByRole('button', { name: 'Save Aug 1 balances' })) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
    expect(((await screen.findByRole('button', { name: 'Save August spending' })) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a Review save sends only the dirty parts', async () => {
    vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
      month, exists: true, recorded_on: month, notes: null, balances: [{ account_id: 1, balance: '1500.00' }],
    }))
    renderPage('/update?month=2026-08-01&step=spending')
    fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next: review' }))
    expect(
      await screen.findByText('This save writes August spending — Aug 1 balances are unchanged and are not sent.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect('balances' in sentBody()).toBe(false)
    expect(sentBody().spending).toEqual({ amounts: [{ category_id: 7, amount: '250.00' }] })
    expect(await screen.findByText('Balances: unchanged — not sent.')).toBeTruthy()
  })

  it('a Review save of pre-filled balances nobody touched never records them', async () => {
    renderPage('/update?month=2026-08-01&step=spending')
    fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next: review' }))
    expect(
      await screen.findByText(
        'This save writes August spending — Aug 1 balances are not recorded yet; record them on the Balances step.',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect('balances' in sentBody()).toBe(false)
    // Not "unchanged": there is nothing recorded to be unchanged (review M6).
    expect(await screen.findByText('Balances: not recorded — not sent.')).toBeTruthy()
    expect(screen.queryByText('Balances: unchanged — not sent.')).toBeNull()
  })

  it('a take-home save says so in the receipt — and only when the take-home changed (review M5)', async () => {
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: /^2\s*spending$/i }))
    fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '6000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save August spending' }))
    expect(await screen.findByText(/^Spending: .* Household take-home saved\.$/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Food'), { target: { value: '250.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save August spending' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(2))
    await screen.findByRole('heading', { name: 'August spending saved' })
    expect(screen.queryByText(/Household take-home saved/)).toBeNull()
  })

  it('a Review save with nothing changed sends no part — the ticks only', async () => {
    renderPage('/update?month=2026-08-01&step=review')
    expect(await screen.findByText('Nothing has changed — saving records your confirmations only.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect(Object.keys(sentBody()).sort()).toEqual(['close', 'expected_revision', 'request_id', 'reviewed'])
  })

  it('refreshes the revision from each part save before the next', async () => {
    vi.mocked(monthReviewApi.saveMonthReview)
      .mockImplementationOnce(async (month) => savedMonthResult(month, 'b'))
      .mockImplementationOnce(async (month) => savedMonthResult(month, 'c'))
    renderWizard()
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Aug 1 balances' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
    fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save August spending' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(2))
    expect([sentBody(0).expected_revision, sentBody(1).expected_revision]).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })

  it('Ctrl+S saves the part on screen', async () => {
    renderWizard()
    const checking = await screen.findByLabelText('Checking')
    fireEvent.change(checking, { target: { value: '1600.00' } })
    fireEvent.keyDown(checking, { key: 's', ctrlKey: true })
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect('spending' in sentBody(0)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
    const food = await screen.findByLabelText('Food')
    fireEvent.change(food, { target: { value: '250.00' } })
    fireEvent.keyDown(food, { key: 's', ctrlKey: true })
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(2))
    expect('balances' in sentBody(1)).toBe(false)
  })

  it('keeps the step through a month switch, even to a month with no balances', async () => {
    renderPage('/update?month=2026-08-01&step=spending')
    await screen.findByLabelText('Food')
    fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-06-01&step=spending'),
    )
  })
})

// The real copy's Oct 3 (2026-09-23 spec §V4): Oct 1 recorded early on Sep 22, September's rent
// saved during September — partial, no take-home.
// K4's close blocker as the server words it for the fixtures' early Oct 1 (recorded Sep 22).
const OCT_EARLY = 'Oct 1 balances were recorded early, on Sep 22 — save them again on or after Oct 1 before closing October.'

function partialSeptember() {
  setServerToday('2026-10-03')
  // The server's review of October lists K4's blocker while its balances are early — the wizard
  // offers the Confirm, and shows the blocker, only on the server's word (review M3).
  vi.mocked(monthReviewApi.fetchMonthReview).mockImplementation(async (month) => ({
    ...reviewFixture(month),
    blockers: month === '2026-10-01' ? [OCT_EARLY] : [],
  }))
  vi.mocked(fetchCoverage).mockResolvedValue({
    balances: ['2026-08-01', '2026-09-01', '2026-10-01'],
    spending: ['2026-09-01'],
    net_pay: [],
    time: TIME_OCT_3,
  })
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: true,
    recorded_on: month === '2026-10-01' ? '2026-09-22' : month,
    notes: null,
    balances: [{ account_id: 1, balance: '1500.00' }],
    as_of: month === '2026-10-01' ? '2026-09-22' : month,
    provisional: month === '2026-10-01',
  }))
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, rentCategory])
  vi.mocked(spendingApi.fetchSpendingMonth).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-09-01',
    net_pay: null,
    amounts: month === '2026-09-01' ? [{ category_id: 8, amount: '2072.23' }] : [],
    budgets: [],
  }))
}

// /coverage once September's spending reads entered (only its take-home still due).
const enteredSeptember = {
  balances: ['2026-08-01', '2026-09-01', '2026-10-01'],
  spending: ['2026-09-01'],
  net_pay: [],
  time: { ...TIME_OCT_3, flows_due: [septemberFlows({ spending: 'entered', spending_entered: true })] },
}

const PARTIAL_BANNER =
  "September's spending was saved during September. Add anything that has posted since and save, or confirm it's complete."

describe('confirm a partly entered month (2026-09-23 spec §M1)', () => {
  it('shows the banner and the Confirm on an ended, partial, clean month; the Confirm sends no part and ticks spending', async () => {
    partialSeptember()
    renderWizardAt('/update?month=2026-09-01&step=spending')
    expect(await screen.findByText(PARTIAL_BANNER)).toBeTruthy()
    vi.mocked(fetchCoverage).mockResolvedValue(enteredSeptember)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm September spending is complete' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect(sentBody()).toMatchObject({ reviewed: { balances: false, spending: true, take_home: false }, close: false })
    expect(['balances', 'spending'].some((key) => key in sentBody())).toBe(false)
    await waitFor(() => expect(screen.queryByText(PARTIAL_BANNER)).toBeNull())
    expect(screen.queryByRole('button', { name: 'Confirm September spending is complete' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'September spending confirmed complete' })).toBeTruthy()
    // The Review's spending box is the same stored flag — it shows ticked now.
    fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
    expect(((await screen.findByLabelText(/^I checked September spending, tax and transfers\.$/)) as HTMLInputElement).checked).toBe(true)
  })

  it('offers no Confirm while the spending part is dirty — the save completes it instead', async () => {
    partialSeptember()
    renderWizardAt('/update?month=2026-09-01&step=spending')
    fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '40.00' } })
    expect(screen.queryByRole('button', { name: 'Confirm September spending is complete' })).toBeNull()
    expect(screen.getByText(PARTIAL_BANNER)).toBeTruthy()
  })

  it('offers no Confirm or banner once the month is entered', async () => {
    partialSeptember()
    vi.mocked(fetchCoverage).mockResolvedValue(enteredSeptember)
    renderWizardAt('/update?month=2026-09-01&step=spending')
    await screen.findByLabelText('Food')
    expect(screen.queryByText(PARTIAL_BANNER)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm September spending is complete' })).toBeNull()
  })

  it("the Confirm's Undo reverses its batch and the month reads partial again", async () => {
    partialSeptember()
    vi.mocked(monthReviewApi.saveMonthReview).mockImplementation(async (month) => ({
      ...savedMonthResult(month, 'b'),
      balances: null,
      batch_id: 'b-confirm',
    }))
    vi.mocked(lifecycleApi.undoBatch).mockResolvedValue({
      type: 'batch', batch_id: 'u', at: '2026-10-03T12:00:00+00:00', source: 'undo', actor: null,
      label: 'Undid', month: '2026-09-01', rows: 1, undoable: true, undone_by: null,
    })
    renderWizardAt('/update?month=2026-09-01&step=spending')
    await screen.findByText(PARTIAL_BANNER)
    vi.mocked(fetchCoverage).mockResolvedValue(enteredSeptember)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm September spending is complete' }))
    await waitFor(() => expect(screen.queryByText(PARTIAL_BANNER)).toBeNull())
    vi.mocked(fetchCoverage).mockResolvedValue({ ...enteredSeptember, time: TIME_OCT_3 })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledWith('b-confirm'))
    expect(await screen.findByText(PARTIAL_BANNER)).toBeTruthy()
  })

  it('a Review save with nothing changed and the spending box ticked is the same no-leg PUT as the Confirm (K3 clause (d), tightened)', async () => {
    partialSeptember()
    renderWizardAt('/update?month=2026-09-01&step=review')
    fireEvent.click(await screen.findByLabelText(/^I checked September spending, tax and transfers\.$/))
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect(sentBody().reviewed).toEqual({ balances: false, spending: true, take_home: false })
    expect(['balances', 'spending'].some((key) => key in sentBody())).toBe(false)
  })

  it('a take-home save carries no spending tick unless one was given', async () => {
    partialSeptember()
    renderWizardAt('/update?month=2026-09-01&step=spending')
    fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '6000.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save September spending' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect(sentBody().reviewed.spending).toBe(false)
    expect(sentBody().spending).toEqual({ amounts: [{ category_id: 8, amount: '2072.23' }], net_pay: '6000.00' })
  })
})

describe('Next leads to what is due (2026-09-23 spec §M1)', () => {
  it("on the current month's Balances step, Next opens the due month's spending", async () => {
    partialSeptember()
    renderPage('/update?month=2026-10-01&step=balances')
    fireEvent.click(await screen.findByRole('button', { name: 'Next: September spending & take-home' }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-09-01&step=spending'),
    )
  })

  it('with nothing earlier due it moves within the month', async () => {
    partialSeptember()
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-10-01'], spending: [], net_pay: [], time: { ...TIME_OCT_3, flows_due: [] },
    })
    renderPage('/update?month=2026-10-01&step=balances')
    fireEvent.click(await screen.findByRole('button', { name: 'Next: October spending' }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-10-01&step=spending'),
    )
  })

  it('elsewhere Next stays in the month', async () => {
    partialSeptember()
    renderPage('/update?month=2026-09-01&step=balances')
    expect(await screen.findByRole('button', { name: 'Next: September spending' })).toBeTruthy()
  })
})

describe('which months can be opened (2026-09-23 spec §M3)', () => {
  it('offers Record Nov 1 balances early only while next month has no snapshot, opening it with the early banner', async () => {
    setServerToday('2026-10-03')
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-09-01', '2026-10-01'], spending: [], net_pay: [], time: { ...TIME_OCT_3, flows_due: [] },
    })
    renderPage('/update?month=2026-10-01')
    fireEvent.click(await screen.findByRole('button', { name: 'Record Nov 1 balances early' }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-11-01&step=balances'),
    )
    expect(
      await screen.findByText(
        'These are Nov 1 balances recorded before Nov 1 — they stay provisional until you save them again on or after Nov 1.',
      ),
    ).toBeTruthy()
    // The early month is on the ribbon while it is on screen — and nothing past it ever is.
    expect(screen.getByRole('button', { name: /^Nov 2026/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Dec 2026/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /balances early/ })).toBeNull()
  })

  it('never offers two months ahead: the ribbon ends at the current snapshot', async () => {
    setServerToday('2026-09-23')
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-09-01', '2026-10-01'], spending: [], net_pay: [], time: TIME_SEP_23,
    })
    renderPage('/update?month=2026-09-01')
    await screen.findByLabelText('Checking')
    expect(screen.getByRole('button', { name: /^Oct 2026/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Nov 2026/ })).toBeNull()
    // Next month (October) already has its early snapshot: nothing to offer.
    expect(screen.queryByRole('button', { name: /balances early/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Start / })).toBeNull()
  })

  it('a month beyond next month says when it opens and saves nothing', async () => {
    setServerToday('2026-10-03')
    renderPage('/update?month=2026-12-01')
    expect(await screen.findByText('Dec 1 balances can be recorded from Nov 1 (early) or on Dec 1.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save Dec 1 balances' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Checking') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^2\s*spending$/i }))
    expect(await screen.findByText('December spending can be entered once December begins.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save December spending' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Food') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
    expect((await screen.findByRole('button', { name: 'Save progress' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("keeps next month's spending closed until it begins", async () => {
    setServerToday('2026-10-03')
    renderPage('/update?month=2026-11-01&step=spending')
    expect(await screen.findByText('November spending can be entered once November begins.')).toBeTruthy()
    expect((screen.getByLabelText('Household take-home') as HTMLInputElement).disabled).toBe(true)
  })

  // Spec review G1: next month's spending stays shut through every door — not only its disabled
  // boxes, but a draft left from before the parts were split, and a paste landing on the card.
  it("a restored draft never sends next month's spending from the Review", async () => {
    setServerToday('2026-10-03')
    // A whole-month draft typed through the old "Start Nov": both parts under one key.
    sessionStorage.setItem(
      'finance-update-draft:2026-11-01',
      JSON.stringify({ balances: { 1: '1600.00' }, amounts: { 7: '250.00' }, netPay: '6000.00', recordedOn: '2026-10-20', notes: '' }),
    )
    renderPage('/update?month=2026-11-01&step=review')
    fireEvent.click(await screen.findByRole('button', { name: 'Save progress' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect('spending' in sentBody()).toBe(false)
    expect(sentBody().balances).toEqual({ notes: null, balances: [{ account_id: 1, balance: '1600.00' }] })
    // The spending draft waits for November to begin rather than being thrown away.
    expect(sessionStorage.getItem('finance-update-draft:flows:2026-11-01')).not.toBeNull()
    expect(screen.queryByText(/Restored unsaved November spending/)).toBeNull()
  })

  it("a paste on next month's Spending card fills nothing", async () => {
    setServerToday('2026-10-03')
    renderPage('/update?month=2026-11-01&step=spending')
    await screen.findByText('November spending can be entered once November begins.')
    const food = screen.getByLabelText('Food') as HTMLInputElement
    const before = food.value
    // Focus on a card button: a paste with no cell under it fills from the first row.
    const back = screen.getByRole('button', { name: 'Back' })
    back.focus()
    fireEvent.paste(back, { clipboardData: { getData: () => '1\n2\n3' } })
    expect(food.value).toBe(before)
    expect(screen.queryByText(/^Pasted /)).toBeNull()
    expect(sessionStorage.getItem('finance-update-draft:flows:2026-11-01')).toBeNull()
  })

  it('a paste on a month beyond next month fills no balance', async () => {
    setServerToday('2026-10-03')
    renderPage('/update?month=2026-12-01')
    await screen.findByText('Dec 1 balances can be recorded from Nov 1 (early) or on Dec 1.')
    const checking = screen.getByLabelText('Checking') as HTMLInputElement
    const before = checking.value
    const next = screen.getByRole('button', { name: /^Next: / })
    next.focus()
    fireEvent.paste(next, { clipboardData: { getData: () => '1\n2' } })
    expect(checking.value).toBe(before)
    expect(screen.queryByText(/^Pasted /)).toBeNull()
  })

  it("allows the current month's spending with the in-progress note", async () => {
    setServerToday('2026-10-03')
    renderPage('/update?month=2026-10-01&step=spending')
    expect(
      await screen.findByText(
        'October is in progress — its spending and take-home are due once it ends. What you save now is kept as a partial month.',
      ),
    ).toBeTruthy()
    expect((screen.getByLabelText('Food') as HTMLInputElement).disabled).toBe(false)
  })
})

describe('dated balances (2026-09-23 spec §M4)', () => {
  it('reads the balances line under the heading and dates the columns', async () => {
    partialSeptember()
    renderPage('/update?month=2026-10-01')
    expect(await screen.findByText('Balances as of Sep 22 · provisional for Oct 1 — recorded early, on Sep 22')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Oct 1 balances/ })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Sep 1' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Oct 1' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Δ since Sep 1' })).toBeTruthy()
  })

  it('a month with no snapshot reads "not recorded yet" and says where its figures come from', async () => {
    renderWizard()
    expect(await screen.findByText('Balances as of Aug 1 · not recorded yet — pre-filled from Jul 1')).toBeTruthy()
  })

  it('Confirm Oct 1 balances: early, on/after its date, nothing dirty; it sends the unchanged balances and the line then reads recorded today', async () => {
    partialSeptember()
    let octRecorded = '2026-09-22'
    vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
      month,
      exists: true,
      notes: null,
      balances: [{ account_id: 1, balance: '1500.00' }],
      recorded_on: month === '2026-10-01' ? octRecorded : month,
      as_of: month === '2026-10-01' && octRecorded < month ? octRecorded : month,
      provisional: month === '2026-10-01' && octRecorded < month,
    }))
    renderWizardAt('/update?month=2026-10-01')
    expect(
      await screen.findByText(
        'These Oct 1 balances were recorded early, on Sep 22. Update any account that changed and save — saving on or after Oct 1 makes them final.',
      ),
    ).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Confirm Oct 1 balances' })
    octRecorded = '2026-10-03'
    fireEvent.click(confirm)
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect(sentBody().balances).toEqual({ notes: null, balances: [{ account_id: 1, balance: '1500.00' }] })
    expect(await screen.findByText('Balances as of Oct 1 · recorded Oct 3')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Oct 1 balances confirmed' })).toBeTruthy()
    expect(screen.queryByText(/were recorded early, on Sep 22/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save Oct 1 balances' })).toBeTruthy()
  })

  it('an edit turns the Confirm back into Save', async () => {
    partialSeptember()
    renderPage('/update?month=2026-10-01')
    await screen.findByRole('button', { name: 'Confirm Oct 1 balances' })
    fireEvent.change(screen.getByLabelText('Checking'), { target: { value: '1600.00' } })
    expect(screen.getByRole('button', { name: 'Save Oct 1 balances' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm Oct 1 balances' })).toBeNull()
  })

  it("offers no Confirm before the 1st — next month's early balances save again as provisional", async () => {
    setServerToday('2026-09-25')
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-09-01', '2026-10-01'], spending: [], net_pay: [], time: { ...TIME_SEP_23, today: '2026-09-25' },
    })
    let recorded = '2026-09-22'
    vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
      month,
      exists: true,
      notes: null,
      balances: [{ account_id: 1, balance: '1500.00' }],
      recorded_on: month === '2026-10-01' ? recorded : month,
      as_of: month === '2026-10-01' ? recorded : month,
      provisional: month === '2026-10-01',
    }))
    renderPage('/update?month=2026-10-01')
    await screen.findByText('Balances as of Sep 22 · provisional for Oct 1 — recorded early, on Sep 22')
    expect(screen.queryByRole('button', { name: 'Confirm Oct 1 balances' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Save Oct 1 balances' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Checking'), { target: { value: '1600.00' } })
    recorded = '2026-09-25'
    fireEvent.click(screen.getByRole('button', { name: 'Save Oct 1 balances' }))
    expect(await screen.findByText('Balances as of Sep 25 · provisional for Oct 1 — recorded early, on Sep 25')).toBeTruthy()
  })

  it("a month the server exempts (from before the review's adoption) shows neither K4's blocker nor the Confirm", async () => {
    partialSeptember()
    // needs_review: an adopted-history month edited since — restamped by a save, but never blocked.
    vi.mocked(monthReviewApi.fetchMonthReview).mockImplementation(async (month) => ({
      ...reviewFixture(month), state: 'needs_review', blockers: [],
    }))
    renderPage('/update?month=2026-10-01')
    await screen.findByText('Balances as of Sep 22 · provisional for Oct 1 — recorded early, on Sep 22')
    expect(screen.queryByRole('button', { name: 'Confirm Oct 1 balances' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
    await screen.findByText('Nothing has changed — saving records your confirmations only.')
    expect(screen.queryByText(/were recorded early/)).toBeNull()
  })

  it.each(['unreviewed_history', 'closed'] as const)(
    'a %s month recorded early is never offered the Confirm (K4 never restamps it)',
    async (state) => {
      partialSeptember()
      vi.mocked(monthReviewApi.fetchMonthReview).mockImplementation(async (month) => ({
        ...reviewFixture(month), state, blockers: state === 'closed' && month === '2026-10-01' ? [OCT_EARLY] : [],
      }))
      renderPage('/update?month=2026-10-01')
      await screen.findByText('Balances as of Sep 22 · provisional for Oct 1 — recorded early, on Sep 22')
      expect(screen.queryByRole('button', { name: 'Confirm Oct 1 balances' })).toBeNull()
      expect(screen.queryByText(/makes them final/)).toBeNull()
    },
  )
})

describe("what's due (2026-09-23 spec §M2)", () => {
  it('lands /update on the first due part — Oct 1 balances on Oct 3 — under the strip', async () => {
    partialSeptember()
    renderPage('/update')
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-10-01&step=balances'),
    )
    const strip = await screen.findByRole('navigation', { name: "What's due" })
    expect(
      within(strip).getByRole('link', {
        name: 'Oct 1 balances · recorded early, on Sep 22 — update or confirm',
      }),
    ).toBeTruthy()
    expect(
      within(strip).getByRole('link', {
        name: 'September spending & take-home · entered during September — add the rest or confirm',
      }),
    ).toBeTruthy()
    // Landed on the provisional balances, the Confirm banner in view (spec §M2 acceptance).
    expect(await screen.findByText(/were recorded early, on Sep 22/)).toBeTruthy()
  })

  it("lands on the current month's Balances step with nothing due, and says what is next", async () => {
    setServerToday('2026-09-23')
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-09-01', '2026-10-01'], spending: [], net_pay: [], time: TIME_SEP_23,
    })
    renderPage('/update')
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-09-01&step=balances'),
    )
    expect(
      await screen.findByText('Nothing due — Oct 1 balances recorded early (Sep 22); update or confirm them on Oct 1'),
    ).toBeTruthy()
  })

  it('lands a step link on the due part of its kind', async () => {
    partialSeptember()
    renderPage('/update?step=spending')
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-09-01&step=spending'),
    )
  })

  it('falls back to the current month when /coverage fails', async () => {
    setServerToday('2026-10-03')
    vi.mocked(fetchCoverage).mockRejectedValue(new ApiError('down', 503))
    renderPage('/update')
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-10-01&step=balances'),
    )
  })

  it('a chip opens its part through the wizard', async () => {
    partialSeptember()
    renderPage('/update?month=2026-10-01')
    const strip = await screen.findByRole('navigation', { name: "What's due" })
    fireEvent.click(within(strip).getByRole('link', { name: /^September spending/ }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-09-01&step=spending'),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Monthly update — Sep 2026' })).toBeTruthy()
  })

  it('after a part saves, the toast and the receipt name the next due part — and the strip drops the one saved', async () => {
    partialSeptember()
    vi.mocked(monthReviewApi.saveMonthReview).mockImplementation(async (month) => ({
      ...savedMonthResult(month, 'b'),
      batch_id: 'b-oct',
    }))
    renderWizardAt('/update?month=2026-10-01')
    const confirm = await screen.findByRole('button', { name: 'Confirm Oct 1 balances' })
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-09-01', '2026-10-01'],
      spending: ['2026-09-01'],
      net_pay: [],
      time: { ...TIME_OCT_3, balances: { ...TIME_OCT_3.balances, status: 'final' } },
    })
    fireEvent.click(confirm)
    expect(await screen.findByText('Confirmed Oct 1 balances · Next due: September spending & take-home')).toBeTruthy()
    const strip = screen.getByRole('navigation', { name: "What's due" })
    expect(within(strip).queryByRole('link', { name: /^Oct 1 balances/ })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Next due: September spending & take-home →' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Monthly update — Sep 2026' })).toBeTruthy(),
    )
  })
})

// September's review on Oct 3 with Oct 1 in one of four shapes (2026-09-23 spec §M5).
function septemberStory(next: 'final' | 'provisional' | 'missing' | 'older') {
  partialSeptember()
  vi.mocked(fetchCoverage).mockResolvedValue({
    balances: next === 'missing' ? ['2026-08-01', '2026-09-01'] : ['2026-08-01', '2026-09-01', '2026-10-01'],
    spending: ['2026-09-01'],
    net_pay: [],
    time: TIME_OCT_3,
  })
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: next === 'older' ? month !== '2026-09-01' : true,
    recorded_on: month,
    notes: null,
    as_of: month,
    provisional: false,
    balances:
      next === 'older' && month === '2026-09-01'
        ? []
        : [{ account_id: 1, balance: month === '2026-10-01' ? '1650.00' : '1500.00' }],
  }))
  vi.mocked(netWorthApi.fetchSummary).mockResolvedValue({
    month: '2026-10-01',
    net_worth: '933250.90',
    mom_delta: '126583.02',
    mom_pct: '0.157',
    groups: [],
    owner_totals: [],
    as_of: next === 'provisional' ? '2026-09-22' : '2026-10-01',
    provisional: next === 'provisional',
    previous:
      next === 'older'
        ? { month: '2026-08-01', as_of: '2026-08-01', recorded_on: '2026-08-01', provisional: false }
        : SEP_1,
    days_since_previous: 21,
  })
}

describe("the month's story (2026-09-23 spec §M5)", () => {
  it('names the tile by its 1st and tells the change to the next 1st — provisional', async () => {
    septemberStory('provisional')
    renderPage('/update?month=2026-09-01&step=review')
    expect(await screen.findByText("September's change: ▲ $126,583.02 (Sep 1 → Sep 22 · provisional)")).toBeTruthy()
    const tile = screen.getByText('Sep 1 balances').closest('.stat-tile') as HTMLElement
    expect(tile.querySelector('.stat-value')?.textContent).toBe('$1,500.00')
    expect(screen.getByRole('heading', { name: 'Largest balance changes · Sep 1 → Oct 1' })).toBeTruthy()
    // The saved Sep 1 → Oct 1 move, not the typed figures.
    expect(screen.getByText('+$150.00')).toBeTruthy()
    expect(netWorthApi.fetchSummary).toHaveBeenCalledWith(null, '2026-10-01')
  })

  it('a final next 1st', async () => {
    septemberStory('final')
    renderPage('/update?month=2026-09-01&step=review')
    expect(await screen.findByText("September's change: ▲ $126,583.02 (Sep 1 → Oct 1)")).toBeTruthy()
  })

  it('no next 1st yet — and nothing is asked of the server for it', async () => {
    septemberStory('missing')
    renderPage('/update?month=2026-09-01&step=review')
    expect((await screen.findAllByText("September's change appears once Oct 1 balances are recorded")).length).toBe(2)
    expect(netWorthApi.fetchSummary).not.toHaveBeenCalled()
  })

  it('a next 1st that compares with an older snapshot needs this 1st', async () => {
    septemberStory('older')
    renderPage('/update?month=2026-09-01&step=review')
    expect((await screen.findAllByText("September's change needs Sep 1 balances")).length).toBe(2)
  })

  it('names the three confirmations for the month', async () => {
    septemberStory('final')
    renderPage('/update?month=2026-09-01&step=review')
    expect(await screen.findByLabelText('I checked every Sep 1 account balance.')).toBeTruthy()
    expect(screen.getByLabelText('I checked September spending, tax and transfers.')).toBeTruthy()
    expect(screen.getByLabelText('I checked September household take-home.')).toBeTruthy()
  })

  it('re-reads the story after a balances save', async () => {
    septemberStory('final')
    renderPage('/update?month=2026-09-01&step=review')
    await screen.findByText("September's change: ▲ $126,583.02 (Sep 1 → Oct 1)")
    vi.mocked(netWorthApi.fetchSummary).mockResolvedValue({
      month: '2026-10-01', net_worth: '933250.90', mom_delta: '126000.00', mom_pct: '0.157', groups: [],
      owner_totals: [], as_of: '2026-10-01', provisional: false, previous: SEP_1, days_since_previous: 30,
    })
    fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '2083.02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Sep 1 balances' }))
    fireEvent.click(await screen.findByRole('button', { name: /^3\s*review$/i }))
    expect(await screen.findByText("September's change: ▲ $126,000.00 (Sep 1 → Oct 1)")).toBeTruthy()
  })

  // Review M1/M8: the toast names what is due next, which /coverage alone decides — so it waits for
  // that one read and never for the story's, and its words carry no arrow (they are not a link).
  it('raises the toast from /coverage alone — a story read that never answers holds nothing back', async () => {
    septemberStory('final')
    vi.mocked(netWorthApi.putMonthBalances).mockResolvedValue({
      month: '2026-09-01', snapshot_created: false, created: 0, updated: 1, unchanged: 0, batch_id: 'b-sep',
    })
    renderWizardAt('/update?month=2026-09-01&step=balances')
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1520.00' } })
    vi.mocked(netWorthApi.fetchSummary).mockImplementation(() => new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Save Sep 1 balances' }))
    const said = await screen.findByText('Saved Sep 1 balances · Next due: Oct 1 balances')
    expect(within(said.closest('.toast') as HTMLElement).getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  // Saving Sep 1 balances cannot create Oct 1's, so the refresh after the save skips the story's
  // next 1st exactly as the load did: a 404 there is a console error in the browser (§V4 walk).
  it('a balances save asks nothing of the server for a next 1st that is not recorded', async () => {
    septemberStory('missing')
    // A batch, so the toast — raised once the refresh has landed — marks the refresh as done.
    vi.mocked(netWorthApi.putMonthBalances).mockResolvedValue({
      month: '2026-09-01', snapshot_created: false, created: 0, updated: 1, unchanged: 0, batch_id: 'b-sep',
    })
    renderWizardAt('/update?month=2026-09-01&step=balances')
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1520.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Sep 1 balances' }))
    expect(await screen.findByText(/^Saved Sep 1 balances/)).toBeTruthy()
    expect(netWorthApi.fetchSummary).not.toHaveBeenCalled()
    expect(vi.mocked(netWorthApi.fetchMonthBalances).mock.calls.map(([m]) => m)).not.toContain('2026-10-01')
  })
})

describe('close gates (2026-09-23 spec §M1, §M5)', () => {
  it("Save and close waits for early balances to be saved again, with K4's sentence", async () => {
    septemberStory('final')
    vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
      month,
      exists: true,
      notes: null,
      balances: [{ account_id: 1, balance: '1500.00' }],
      recorded_on: month === '2026-09-01' ? '2026-08-28' : month,
      as_of: month === '2026-09-01' ? '2026-08-28' : month,
      provisional: month === '2026-09-01',
    }))
    vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
      month: '2026-09-01', exists: true, net_pay: '6000.00', amounts: [{ category_id: 8, amount: '2072.23' }], budgets: [],
    })
    vi.mocked(monthReviewApi.fetchMonthReview).mockImplementation(async (month) => ({
      ...reviewFixture(month),
      blockers: month === '2026-09-01'
        ? ['Sep 1 balances were recorded early, on Aug 28 — save them again on or after Sep 1 before closing September.']
        : [],
    }))
    renderPage('/update?month=2026-09-01&step=review')
    for (const label of [
      'I checked every Sep 1 account balance.',
      'I checked September spending, tax and transfers.',
      'I checked September household take-home.',
    ]) {
      fireEvent.click(await screen.findByLabelText(label))
    }
    expect(
      screen.getByText(
        'Sep 1 balances were recorded early, on Aug 28 — save them again on or after Sep 1 before closing September.',
      ),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save and close September' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a month without balances says to record them before closing', async () => {
    setServerToday('2026-10-03')
    vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
      month: '2026-08-01', exists: true, net_pay: '6000.00', amounts: [{ category_id: 7, amount: '300.00' }], budgets: [],
    })
    renderPage('/update?month=2026-08-01&step=review')
    expect(await screen.findByText('Record Aug 1 balances before closing August.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save and close August' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('touched balances may close in the same save — they are sent and recorded with it', async () => {
    setServerToday('2026-10-03')
    vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
      month: '2026-08-01', exists: true, net_pay: '6000.00', amounts: [{ category_id: 7, amount: '300.00' }], budgets: [],
    })
    renderPage('/update?month=2026-08-01')
    fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
    fireEvent.click(screen.getByRole('button', { name: /^3\s*review$/i }))
    for (const label of [
      'I checked every Aug 1 account balance.',
      'I checked August spending, tax and transfers.',
      'I checked August household take-home.',
    ]) {
      fireEvent.click(await screen.findByLabelText(label))
    }
    expect(screen.queryByText('Record Aug 1 balances before closing August.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save and close August' }))
    await waitFor(() => expect(monthReviewApi.saveMonthReview).toHaveBeenCalledTimes(1))
    expect(sentBody()).toMatchObject({ close: true, balances: { balances: [{ account_id: 1, balance: '1600.00' }] } })
  })
})
