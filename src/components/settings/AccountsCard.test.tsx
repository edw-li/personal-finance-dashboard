import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { AccountOut, ActivityBatch, PersonOut, PortfolioAccountOut } from '../../types/api'
import { REORDER_INSTRUCTIONS } from '../reorder/reorderMath'
import ToastProvider from '../ToastProvider'
import AccountsCard from './AccountsCard'

vi.mock('../../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/netWorth')>()),
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  reorderAccounts: vi.fn(),
}))
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  reorderAccounts,
  updateAccount,
} from '../../api/netWorth'
vi.mock('../../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/portfolio')>()),
  fetchPortfolioAccounts: vi.fn(),
  patchPortfolioAccount: vi.fn(),
}))
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  undoBatch: vi.fn(),
}))
import { undoBatch } from '../../api/lifecycle'

const ME: PersonOut = { id: 1, name: 'Me', is_primary: true }
const PARTNER: PersonOut = { id: 2, name: 'Partner', is_primary: false }

const CHECKING: AccountOut = {
  id: 10,
  name: 'Joint Checking',
  slug: 'joint-checking',
  group: 'cash',
  sort_order: 1,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: null,
}
const HSA: AccountOut = {
  id: 11,
  name: 'Fidelity HSA',
  slug: 'fidelity-hsa',
  group: 'pre_tax',
  sort_order: 2,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}
// The 401(k) shape production actually has (spec §0): a parent whose balance is nothing but
// the sum of its components, typed by hand every month for 37 months.
const TRAD: AccountOut = {
  id: 20,
  name: 'Fidelity Traditional 401(k)',
  slug: 'fidelity-traditional-401k',
  group: 'pre_tax',
  sort_order: 3,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}
const TRAD_PRETAX: AccountOut = {
  id: 21,
  name: 'Traditional pre-tax',
  slug: 'traditional-pre-tax',
  group: 'pre_tax',
  sort_order: 4,
  is_active: true,
  is_component: true,
  parent_account_id: 20,
  person_id: 1,
}
const TRAD_MATCH: AccountOut = {
  id: 22,
  name: 'Traditional employer match',
  slug: 'traditional-employer-match',
  group: 'pre_tax',
  sort_order: 5,
  is_active: true,
  is_component: true,
  parent_account_id: 20,
  person_id: 1,
}
// Two ways to belong to nothing: no parent at all, and a parent that has been retired.
const ORPHAN: AccountOut = {
  id: 23,
  name: 'Old rollover slice',
  slug: 'old-rollover-slice',
  group: 'pre_tax',
  sort_order: 6,
  is_active: true,
  is_component: true,
  parent_account_id: null,
  person_id: 1,
}
const CLOSED_PARENT: AccountOut = {
  id: 24,
  name: 'Closed 401(k)',
  slug: 'closed-401k',
  group: 'pre_tax',
  sort_order: 7,
  is_active: false,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}
const CLOSED_SLICE: AccountOut = {
  id: 25,
  name: 'Closed 401(k) pre-tax',
  slug: 'closed-401k-pre-tax',
  group: 'pre_tax',
  sort_order: 8,
  is_active: true,
  is_component: true,
  parent_account_id: 24,
  person_id: 1,
}
const BROKERAGE: PortfolioAccountOut = { id: 30, label: 'Fidelity Brokerage', person_id: 1 }
const JOINT_ROTH: PortfolioAccountOut = { id: 31, label: 'Joint Roth', person_id: null }
// A component whose parent is itself a component: nestComponents nests one level and leaves
// this row out, so the roster has to keep it on its own (reorder spec §4.2).
const SLICE_OF_SLICE: AccountOut = {
  id: 26,
  name: 'Pre-tax slice of a slice',
  slug: 'pre-tax-slice-of-a-slice',
  group: 'pre_tax',
  sort_order: 9,
  is_active: true,
  is_component: true,
  parent_account_id: 21,
  person_id: 1,
}
// A component filed in ANOTHER group than its parent (Taxable vs the Pre-tax 401(k)): it is
// top-level in its own group (reorder spec §9).
const SWEEP: AccountOut = {
  id: 40,
  name: 'Brokerage sweep',
  slug: 'brokerage-sweep',
  group: 'taxable',
  sort_order: 10,
  is_active: true,
  is_component: true,
  parent_account_id: 20,
  person_id: 1,
}
const SCHWAB: AccountOut = {
  id: 41,
  name: 'Schwab Brokerage',
  slug: 'schwab-brokerage',
  group: 'taxable',
  sort_order: 11,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}
// The roster most reorder tests stand on: Cash holds one account; Pre-tax holds the HSA and
// the 401(k), which carries its two components.
const ROSTER = [CHECKING, HSA, TRAD, TRAD_PRETAX, TRAD_MATCH]
// The change log's answer to an Undo (POST /activity/batches/{id}/undo).
const UNDONE: ActivityBatch = {
  type: 'batch',
  batch_id: 'undo-2',
  at: '2026-09-23T12:00:00Z',
  source: 'undo',
  actor: 'admin@example.com',
  label: 'Undid: Moved account Fidelity Traditional 401(k)',
  month: null,
  rows: 5,
  undoable: true,
  undone_by: null,
}
// R1's stale-list sentence for this route (2026-09-23 reorder spec §8.3).
const STALE = 'The accounts changed since this list was loaded — nothing was moved.'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA])
  vi.mocked(createAccount).mockResolvedValue(CHECKING)
  vi.mocked(updateAccount).mockResolvedValue(HSA)
  vi.mocked(deleteAccount).mockResolvedValue(undefined)
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([BROKERAGE, JOINT_ROTH])
  vi.mocked(patchPortfolioAccount).mockResolvedValue({ ...BROKERAGE, person_id: 2 })
  vi.mocked(reorderAccounts).mockResolvedValue({
    data: [CHECKING, TRAD, TRAD_PRETAX, TRAD_MATCH, HSA],
    batchId: 'batch-9',
  })
  vi.mocked(undoBatch).mockResolvedValue(UNDONE)
  // jsdom has no layout: a keyboard lift measures every row at y=0 and asks the page to scroll it
  // clear of the top edge zone, and jsdom does not implement window.scrollBy.
  window.scrollBy = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Every roster assertion is scoped to the NET-WORTH table: account names are also options
// in the parent select, owner names are also options in both owner selects, and the card
// now carries a second table (Portfolio accounts).
const roster = () => within(screen.getByRole('table', { name: 'Net-worth accounts' }))

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
/** The keyboard reorder (spec §2.4): each key pressed on the row's grip, in order. */
function press(name: string, ...keys: string[]) {
  for (const key of keys) fireEvent.keyDown(grip(name), { key })
}
/** The roster's account rows by id, top to bottom — the group headings left out. */
const rowIds = () =>
  [...document.querySelectorAll('.accounts-table tbody tr[data-reorder-id]')].map((row) =>
    row.getAttribute('data-reorder-id'),
  )
const row = (id: number) =>
  document.querySelector(`.accounts-table tbody tr[data-reorder-id="${id}"]`)
const headings = () =>
  [...document.querySelectorAll('.accounts-table tr.accounts-group-row > th')].map(
    (th) => th.textContent,
  )
/** The card's reorder live region (the toast layer's alert region is a <div>). */
const live = () => document.querySelector('span[aria-live="assertive"]')?.textContent ?? ''

it('renders the roster with owner names, joint spelled out', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  const table = within(await screen.findByRole('table', { name: 'Net-worth accounts' }))

  expect(table.getByText('Joint Checking')).toBeTruthy()
  // A NULL owner is JOINT, never a blank cell: the migration backfilled every
  // pre-existing account, so an unset owner is a deliberate statement.
  expect(table.getByText('Joint')).toBeTruthy()
  expect(table.getByText('Me')).toBeTruthy()
  // The group is said ONCE, by the heading row over its accounts — no per-row Group column
  // (reorder spec §4.2).
  expect(table.getByText('Pre-tax').closest('tr')?.className).toBe('accounts-group-row')
})

it('creates an account with owner, parent and the component flag', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Partner 401(k)' } })
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'pre_tax' } })
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Parent account'), { target: { value: '11' } })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  await waitFor(() => expect(vi.mocked(createAccount)).toHaveBeenCalledTimes(1))
  // No sort_order key at all: a create that names no position lands at the end of its group
  // (2026-09-23 reorder spec §3.3).
  expect(vi.mocked(createAccount).mock.calls[0][0]).toStrictEqual({
    name: 'Partner 401(k)',
    group: 'pre_tax',
    is_component: true,
    person_id: 2,
    parent_account_id: 11,
  })
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
})

it('offers no Sort order box: the order is the table’s (reorder spec §4.2)', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(screen.queryByLabelText('Sort order')).toBeNull()
})

it('moves an account to another group through Edit without naming a position — the server appends it there (reorder spec §3.3)', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.click(screen.getByRole('button', { name: 'Edit Fidelity HSA' }))
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'post_tax' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))

  await waitFor(() => expect(vi.mocked(updateAccount)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(updateAccount).mock.calls[0]).toStrictEqual([
    11,
    {
      name: 'Fidelity HSA',
      group: 'post_tax',
      is_component: false,
      person_id: 1,
      parent_account_id: null,
    },
  ])
})

it('retags an account to joint with an EXPLICIT null', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.click(screen.getByRole('button', { name: 'Edit Fidelity HSA' }))
  expect((screen.getByLabelText('Account name') as HTMLInputElement).value).toBe('Fidelity HSA')
  expect((screen.getByLabelText('Owner') as HTMLSelectElement).value).toBe('1')

  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))

  await waitFor(() => expect(vi.mocked(updateAccount)).toHaveBeenCalledTimes(1))
  const [id, body] = vi.mocked(updateAccount).mock.calls[0]
  expect(id).toBe(11)
  // The key must SURVIVE: an omitted person_id means "leave the owner alone" server-side,
  // so clearing the select has to send null on purpose.
  expect(Object.keys(body)).toContain('person_id')
  expect(body.person_id).toBeNull()
  // …and the position must NOT ride along: the stored value may predate a drag.
  expect(Object.keys(body)).not.toContain('sort_order')
})

it('retires an account without touching its other columns', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.click(screen.getByRole('button', { name: 'Retire Fidelity HSA' }))

  // ONLY is_active on the wire: sending the whole row back would let a stale render
  // overwrite a concurrent edit.
  await waitFor(() =>
    expect(vi.mocked(updateAccount)).toHaveBeenCalledWith(11, { is_active: false }),
  )
})

it('deletes a balance-free account', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.click(screen.getByRole('button', { name: 'Delete Joint Checking' }))

  await waitFor(() => expect(vi.mocked(deleteAccount)).toHaveBeenCalledWith(10))
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
})

it('surfaces the delete 409 as a toast and keeps the row', async () => {
  vi.mocked(deleteAccount).mockRejectedValue(
    new ApiError('account has 14 balance rows — deactivate it instead', 409),
  )
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.click(screen.getByRole('button', { name: 'Delete Fidelity HSA' }))

  // The server's own sentence — it names the count, which no client paraphrase does — and
  // it rides the TOAST layer because it is about a row far down the table, not the form.
  const toast = await screen.findByText('account has 14 balance rows — deactivate it instead')
  expect(toast.className).toBe('toast-message')
  // A refused delete must not optimistically remove the row, and must not re-fetch.
  expect(roster().getByText('Fidelity HSA')).toBeTruthy()
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(1)
})

it('renders a rejected save verbatim in the card error slot', async () => {
  vi.mocked(createAccount).mockRejectedValue(
    new ApiError("account 'joint-checking' already exists", 409),
  )
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Joint Checking' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  expect(await screen.findByText("account 'joint-checking' already exists")).toBeTruthy()
})

const portfolioTable = () =>
  within(screen.getByRole('table', { name: 'Portfolio accounts' }))

it('lists the portfolio labels with their owner, joint spelled out', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  expect(portfolioTable().getByText('Fidelity Brokerage')).toBeTruthy()
  expect(portfolioTable().getByText('Joint Roth')).toBeTruthy()
  // The label is read-only TEXT this batch — it is the positions' identity, and the
  // server refuses to rename it.
  expect(portfolioTable().queryByRole('textbox')).toBeNull()
  // A NULL owner selects the Joint option, never a blank one.
  expect((screen.getByLabelText('Owner for Fidelity Brokerage') as HTMLSelectElement).value).toBe('1')
  expect((screen.getByLabelText('Owner for Joint Roth') as HTMLSelectElement).value).toBe('')
})

it('retags a portfolio account ON CHANGE with person_id alone', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  fireEvent.change(screen.getByLabelText('Owner for Fidelity Brokerage'), {
    target: { value: '2' },
  })

  await waitFor(() => expect(vi.mocked(patchPortfolioAccount)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(patchPortfolioAccount).mock.calls[0]).toEqual([30, { person_id: 2 }])
  // The round trip re-reads the roster rather than trusting the local select.
  await waitFor(() => expect(vi.mocked(fetchPortfolioAccounts)).toHaveBeenCalledTimes(2))
  // ONLY person_id on the wire: labels are immutable and sending them back would let a
  // stale render overwrite a concurrent edit (the card's toggleActive rule).
  expect(Object.keys(vi.mocked(patchPortfolioAccount).mock.calls[0][1])).toEqual(['person_id'])
})

it('retags a portfolio account to joint with an EXPLICIT null', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  fireEvent.change(screen.getByLabelText('Owner for Fidelity Brokerage'), {
    target: { value: '' },
  })

  await waitFor(() => expect(vi.mocked(patchPortfolioAccount)).toHaveBeenCalledTimes(1))
  const body = vi.mocked(patchPortfolioAccount).mock.calls[0][1]
  // The key must SURVIVE: an omitted person_id means "leave the owner alone" server-side.
  expect(Object.keys(body)).toContain('person_id')
  expect(body.person_id).toBeNull()
})

it('names the default owner for labels typed on a transaction', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  // The one honesty note the spec requires (§6): a new label is created silently, owned by
  // the primary person, and this table is where it is re-tagged.
  expect(
    screen.getByText(
      'A new account label typed on a transaction or dividend is created owned by Me — ' +
        're-tag it here. The labels themselves are fixed: they identify the positions.',
    ),
  ).toBeTruthy()
})

it('keeps the net-worth roster alive when the portfolio labels fail to load', async () => {
  vi.mocked(fetchPortfolioAccounts).mockRejectedValue(
    new ApiError('portfolio accounts unavailable', 503),
  )
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Two tables from two routers: one being down must not empty the other.
  expect(
    await screen.findByText(
      "Couldn't load the portfolio accounts — the server had a problem (HTTP 503)",
    ),
  ).toBeTruthy()
  expect(roster().getByText('Fidelity HSA')).toBeTruthy()
  expect(screen.queryByRole('table', { name: 'Portfolio accounts' })).toBeNull()
})

it('says which rows are typed and which are summed', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, TRAD, TRAD_PRETAX, TRAD_MATCH])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(roster().getByRole('columnheader', { name: 'Roll-up' })).toBeTruthy()
  // A parent with components has no balance of its own — it IS its components (spec §5).
  expect(roster().getByText('derived: 2 components')).toBeTruthy()
  expect(roster().getAllByText('component of Fidelity Traditional 401(k)')).toHaveLength(2)
  // A plain account is neither summed nor summed into: only Joint Checking reads '—'.
  expect(roster().getAllByText('—')).toHaveLength(1)
})

it('flags a component whose parent is missing or retired', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([ORPHAN, CLOSED_PARENT, CLOSED_SLICE])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Net worth sums the NON-component rows, so a component only reaches a total through a
  // present, active parent. Both of these reach none at all.
  const cues = roster().getAllByText('unlinked component — counts nowhere')
  expect(cues).toHaveLength(2)
  // Amber rides a class (--warn in the sheet); the SENTENCE is the channel that always
  // works — colour is never alone.
  expect(cues[0].className).toBe('accounts-link-note is-unlinked')
  // A retired parent still says how many rows roll into it, singular.
  expect(roster().getByText('derived: 1 component')).toBeTruthy()
  // …and it is still listed, so its component stays nested under it; the parentless one is
  // top-level (reorder spec §9).
  expect(rowIds()).toEqual(['23', '24', '25'])
  expect(row(25)?.classList.contains('component-row')).toBe(true)
  expect(row(23)?.classList.contains('component-row')).toBe(false)
})

it('still names a parent the component flag forgot', async () => {
  // A link without the flag: the half-set pair Task 4 and lane B refuse from now on. The
  // roster must not hide a link it can see, and must not claim a roll-up either.
  vi.mocked(fetchAccounts).mockResolvedValue([TRAD, { ...TRAD_PRETAX, is_component: false }])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(roster().getByText('parent: Fidelity Traditional 401(k)')).toBeTruthy()
  // And the parent is NOT derived: `derived_parent_balances` skips a child that is not
  // flagged `is_component`, so the server never sums this link and the wizard still asks for
  // the parent's balance by hand. "derived: 1 component" here would promise a roll-up that
  // nothing performs.
  expect(roster().getByText('—')).toBeTruthy()
  expect(roster().queryByText('derived: 1 component')).toBeNull()
})

it('refuses a component with no parent, in the server\'s own sentence', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), {
    target: { value: 'Traditional slice' },
  })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  expect(
    await screen.findByText(
      'is_component needs parent_account_id — name the account it folds into',
    ),
  ).toBeTruthy()
  // Refused BEFORE the round trip, and lane B's 422 says the same words — the reader never
  // meets two spellings of one rule.
  expect(vi.mocked(createAccount)).not.toHaveBeenCalled()
})

it('refuses a parent link with no component flag, in the server\'s own sentence', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), {
    target: { value: 'Traditional slice' },
  })
  fireEvent.change(screen.getByLabelText('Parent account'), { target: { value: '11' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  expect(
    await screen.findByText(
      'parent_account_id needs is_component — a linked account must be a component',
    ),
  ).toBeTruthy()
  expect(vi.mocked(createAccount)).not.toHaveBeenCalled()
})

it('clears the refusal as soon as the pair is fixed', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), {
    target: { value: 'Traditional slice' },
  })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
  expect(
    await screen.findByText(
      'is_component needs parent_account_id — name the account it folds into',
    ),
  ).toBeTruthy()

  // Unticking removes the half the banner is about, so the banner goes with it: setText's
  // rule for the text fields, extended to the card's one checkbox.
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  expect(
    screen.queryByText(
      'is_component needs parent_account_id — name the account it folds into',
    ),
  ).toBeNull()
})

it('renders a validation error inline with no Retry beside it (motion spec §9)', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Account name is required.')
  // Retry re-runs the FETCH: here it would invite a re-send of a form the client refused.
  expect(within(alert).queryByRole('button')).toBeNull()
})

it('names the card in the load banner and keeps Retry there', async () => {
  vi.mocked(fetchAccounts)
    .mockRejectedValueOnce(new ApiError('accounts unavailable', 503))
    .mockResolvedValue([CHECKING])
  render(<AccountsCard people={[ME]} />)
  expect(
    await screen.findByText("Couldn't load the accounts — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the accounts' }))
  expect(await screen.findByRole('table', { name: 'Net-worth accounts' })).toBeTruthy()
})

it('renders a refused retag inline under the labels, with no Retry (motion spec §9)', async () => {
  vi.mocked(patchPortfolioAccount).mockRejectedValue(
    new ApiError('owner must be a household member', 422),
  )
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  fireEvent.change(screen.getByLabelText('Owner for Fidelity Brokerage'), {
    target: { value: '2' },
  })

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('owner must be a household member')
  // Retry re-runs the labels FETCH; it cannot fix a PATCH the server refused.
  expect(within(alert).queryByRole('button')).toBeNull()
})

it('renders once, after BOTH feeds settle — no roster table before the portfolio labels are in (spec §9)', async () => {
  const accounts = deferred<AccountOut[]>()
  const labels = deferred<PortfolioAccountOut[]>()
  vi.mocked(fetchAccounts).mockReturnValue(accounts.promise)
  vi.mocked(fetchPortfolioAccounts).mockReturnValue(labels.promise)
  render(<AccountsCard people={[ME]} />)
  expect((document.querySelector('.settings-ghost') as HTMLElement).dataset.ghostHeight).toBe('1114')
  expect(screen.queryByText('Portfolio accounts')).toBeNull()
  await act(async () => {
    accounts.resolve([CHECKING])
  })
  // The roster is in, the labels are not: still the ghost — the card used to grow here and again
  // 76ms later, pushing the second table 1118px down the page (audit S-5).
  expect(screen.queryByRole('table', { name: 'Net-worth accounts' })).toBeNull()
  expect(document.querySelector('.settings-ghost')).not.toBeNull()
  await act(async () => {
    labels.resolve([BROKERAGE])
  })
  expect(await screen.findByRole('table', { name: 'Net-worth accounts' })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Portfolio accounts' })).toBeTruthy()
  expect(document.querySelector('.settings-ghost')).toBeNull()
})

// --- the grouped, reorderable roster (2026-09-23 reorder spec §4.2) ---

it('groups the roster: one row group per non-empty group, in GROUP_ORDER — not API order — each headed by its label', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([HSA, CHECKING])
  render(<AccountsCard people={[ME]} />)
  const table = await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Post-tax, Taxable, Equity, Other and Liabilities hold nothing here: no heading for them.
  expect(headings()).toEqual(['Cash', 'Pre-tax'])
  // One <tbody> per group with its heading as the first row: a ROW-group header. A colgroup scope
  // would claim every column below it, and the table has no <colgroup> to scope.
  const bodies = [...table.querySelectorAll('tbody')]
  expect(bodies).toHaveLength(2)
  for (const body of bodies) {
    const heading = body.querySelector('tr.accounts-group-row > th') as HTMLTableCellElement
    expect(body.firstElementChild).toBe(heading.parentElement)
    expect(heading.getAttribute('scope')).toBe('rowgroup')
    expect(heading.colSpan).toBe(6)
  }
  expect(rowIds()).toEqual(['10', '11'])
})

it('draws a grip column; the Group and Sort columns are gone; the portfolio labels are untouched', async () => {
  render(<AccountsCard people={[ME]} />)
  const table = await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(table.classList.contains('reorder-table')).toBe(true)
  const headers = [...table.querySelectorAll('thead th')]
  expect(headers.map((th) => th.textContent)).toEqual(['', 'Account', 'Owner', 'Roll-up', 'Status', ''])
  expect(headers[0].className).toBe('reorder-grip-cell')
  expect(headers[0].getAttribute('aria-hidden')).toBe('true')
  expect(grip('Fidelity HSA').closest('td')?.className).toBe('reorder-grip-cell')
  // The instructions every grip points at, and the live region, sit OUTSIDE the table.
  const instructions = document.getElementById(grip('Fidelity HSA').getAttribute('aria-describedby') ?? '')
  expect(instructions?.textContent).toBe(REORDER_INSTRUCTIONS)
  expect(table.contains(instructions)).toBe(false)
  const region = document.querySelector('span[aria-live="assertive"]')
  expect(region).not.toBeNull()
  expect(table.contains(region)).toBe(false)
  // The Portfolio accounts table is not a reorderable list.
  const labels = screen.getByRole('table', { name: 'Portfolio accounts' })
  expect(within(labels).queryAllByRole('button', { name: /^Reorder / })).toEqual([])
  expect(labels.classList.contains('reorder-table')).toBe(false)
})

it('nests each component under its parent, indented in the Account cell', async () => {
  // The sheet's order lists the components BEFORE their parent; the roster draws them under it.
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, TRAD_PRETAX, TRAD_MATCH, TRAD, HSA])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
  for (const id of [21, 22]) {
    expect(row(id)?.classList.contains('component-row')).toBe(true)
    // The grip stays first; the name cell is the one the indent moves to (settings.css).
    expect(row(id)?.querySelector('td')?.className).toBe('reorder-grip-cell')
    expect(row(id)?.querySelector('td:nth-child(2)')?.className).toBe('accounts-name-cell')
  }
  expect(row(20)?.classList.contains('component-row')).toBe(false)
  expect(row(11)?.classList.contains('component-row')).toBe(false)
})

it('keeps a component whose parent sits in another group top-level in its own group (spec §9)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([TRAD, TRAD_PRETAX, SWEEP, SCHWAB])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(headings()).toEqual(['Pre-tax', 'Taxable'])
  expect(rowIds()).toEqual(['20', '21', '40', '41'])
  expect(row(40)?.classList.contains('component-row')).toBe(false)
  // It moves among its own group's accounts.
  press('Brokerage sweep', ' ')
  expect(live()).toBe('Picked up Brokerage sweep. Position 1 of 2 in Taxable.')
  press('Brokerage sweep', 'Escape')
})

it('a group of one — or a lone component — has a disabled grip (spec §9)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA, TRAD, TRAD_PRETAX])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect((grip('Joint Checking') as HTMLButtonElement).disabled).toBe(true)
  expect((grip('Traditional pre-tax') as HTMLButtonElement).disabled).toBe(true)
  expect((grip('Fidelity HSA') as HTMLButtonElement).disabled).toBe(false)
  expect((grip('Fidelity Traditional 401(k)') as HTMLButtonElement).disabled).toBe(false)
})

it('a parent carries its components: the rows move at once and ONE PUT names every account in the new order', async () => {
  const save = deferred<{ data: AccountOut[]; batchId: string | null }>()
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(reorderAccounts).mockReturnValue(save.promise)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22'])

  press('Fidelity Traditional 401(k)', ' ')
  expect(live()).toBe('Picked up Fidelity Traditional 401(k). Position 2 of 2 in Pre-tax.')
  press('Fidelity Traditional 401(k)', 'ArrowUp', ' ')

  // Optimistic: the parent and both components stand above the HSA before the server answers.
  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledTimes(1)
  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([10, 20, 21, 22, 11])
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')

  // The response is the truth — here it also carries a rename made in another tab.
  await act(async () => {
    save.resolve({
      data: [CHECKING, TRAD, TRAD_PRETAX, TRAD_MATCH, { ...HSA, name: 'Fidelity HSA (spouse)' }],
      batchId: 'batch-9',
    })
  })
  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
  expect(roster().getByText('Fidelity HSA (spouse)')).toBeTruthy()
  expect(grip('Fidelity HSA (spouse)').getAttribute('aria-disabled')).toBeNull()
})

it('a component moves only among its siblings', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  press('Traditional employer match', ' ')
  expect(live()).toBe(
    "Picked up Traditional employer match. Position 2 of 2 in Fidelity Traditional 401(k)'s components.",
  )
  // Already the last component: down goes nowhere, past its parent's unit or otherwise.
  press('Traditional employer match', 'ArrowDown')
  expect(live()).toBe('Traditional employer match, position 2 of 2.')
  press('Traditional employer match', 'ArrowUp', 'ArrowUp', ' ')

  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([10, 11, 20, 22, 21])
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('a retired parent moves with its component, and Home jumps to the top of its group (spec §9)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([...ROSTER, CLOSED_PARENT, CLOSED_SLICE])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22', '24', '25'])

  press('Closed 401(k)', ' ', 'Home', ' ')

  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([10, 24, 25, 11, 20, 21, 22])
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('keeps an account the nesting cannot place listed, with nowhere to go — and still sends it', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([TRAD, TRAD_PRETAX, SLICE_OF_SLICE, HSA])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Last in its group, with the link it carries spelled out in the Roll-up column.
  expect(rowIds()).toEqual(['20', '21', '11', '26'])
  expect(roster().getByText('component of Traditional pre-tax')).toBeTruthy()
  expect((grip('Pre-tax slice of a slice') as HTMLButtonElement).disabled).toBe(true)

  press('Fidelity HSA', ' ', 'ArrowUp', ' ')

  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([11, 20, 21, 26])
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('saved: the whole unit flashes and a toast names the account, with Undo (spec §8.1)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText('Moved Fidelity Traditional 401(k)')
  expect(toast.className).toBe('toast-message')
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  for (const id of [20, 21, 22]) expect(row(id)?.hasAttribute('data-reorder-saved')).toBe(true)
  expect(row(11)?.hasAttribute('data-reorder-saved')).toBe(false)
})

it('Undo reverts through the change log, reloads and says so (spec §4.2)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Fidelity Traditional 401(k)')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  await waitFor(() => expect(vi.mocked(undoBatch)).toHaveBeenCalledWith('batch-9'))
  expect(await screen.findByText('Order restored')).toBeTruthy()
  await waitFor(() => expect(rowIds()).toEqual(['10', '11', '20', '21', '22']))
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2)
})

it("a refused Undo shows the server's own sentence (spec §9)", async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(undoBatch).mockRejectedValue(
    new ApiError('Later changes touched these rows — undo those first', 409),
  )
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Fidelity Traditional 401(k)')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  const refusal = await screen.findByText('Later changes touched these rows — undo those first')
  expect(refusal.className).toBe('toast-message')
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(1)
})

it('a failed save snaps back to the last server order, says why, and reads the roster again (spec §8.1)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(reorderAccounts).mockRejectedValue(new ApiError('database unavailable', 503))
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(
    "Couldn't save the new order — the server had a problem (HTTP 503). The list is back to how it was.",
  )
  expect(toast.className).toBe('toast-message')
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22'])
  // A 5xx can come AFTER the write committed, so the roster is read again: what the table shows
  // is the server's order, whichever it is — and the grips wait for it.
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22'])
})

it("a stale roster (409) shows the server's sentence and reloads the current rows (spec §8.3)", async () => {
  vi.mocked(fetchAccounts)
    .mockResolvedValueOnce(ROSTER)
    .mockResolvedValueOnce([...ROSTER, SCHWAB])
  vi.mocked(reorderAccounts).mockRejectedValue(new ApiError(STALE, 409))
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(STALE)
  expect(toast.className).toBe('toast-message')
  await waitFor(() => expect(rowIds()).toEqual(['10', '11', '20', '21', '22', '41']))
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2)
})

it('keeps the grips parked until the reload a write started has landed — no drop diffs against rows the write moved past', async () => {
  const reload = deferred<AccountOut[]>()
  vi.mocked(fetchAccounts).mockResolvedValueOnce(ROSTER).mockReturnValueOnce(reload.promise)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Saving an edit answers at once; the roster it changed is still on the wire.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Fidelity HSA' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  expect(vi.mocked(reorderAccounts)).not.toHaveBeenCalled()

  await act(async () => {
    reload.resolve([CHECKING, { ...HSA, name: 'Fidelity HSA (renamed)' }, TRAD, TRAD_PRETAX, TRAD_MATCH])
  })
  await waitFor(() => expect(grip('Fidelity HSA (renamed)').getAttribute('aria-disabled')).toBeNull())
})

it('an Undo holds the grips until the order it restored is on screen — a drop in that window sends no PUT', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Fidelity Traditional 401(k)')
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
  const reload = deferred<AccountOut[]>()
  vi.mocked(fetchAccounts).mockReturnValueOnce(reload.promise)

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await screen.findByText('Order restored')

  // The undo has answered; the order it restored is still on the wire. A drop now would diff
  // against the pre-Undo rows and PUT the undone move straight back.
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')
  press('Fidelity HSA', ' ', 'ArrowUp', ' ')
  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledTimes(1)

  await act(async () => {
    reload.resolve(ROSTER)
  })
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22'])
})

it('an older toast’s Undo overlapping a later save: the grips wait for BOTH, and the overtaken save is read back, not drawn', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  // A first move, saved, with its Undo on screen.
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Fidelity Traditional 401(k)')
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
  // A second move, its save held on the wire…
  const save = deferred<{ data: AccountOut[]; batchId: string | null }>()
  vi.mocked(reorderAccounts).mockReturnValueOnce(save.promise)
  press('Traditional employer match', ' ', 'ArrowUp', ' ')
  expect(rowIds()).toEqual(['10', '20', '22', '21', '11'])
  // …while the first move's Undo runs, and the reload after it lands.
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await screen.findByText('Order restored')
  await waitFor(() => expect(rowIds()).toEqual(['10', '11', '20', '21', '22']))
  // The Undo is done, the second save is not: the grips stay parked.
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')

  // The save answers last. Its answer is older than the reload's (asked for before it), so it is
  // not drawn — and since it may have committed after that reload read, the roster is read again.
  const reread = deferred<AccountOut[]>()
  vi.mocked(fetchAccounts).mockReturnValueOnce(reread.promise)
  await act(async () => {
    save.resolve({ data: [CHECKING, TRAD, TRAD_MATCH, TRAD_PRETAX, HSA], batchId: 'batch-10' })
  })
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22'])
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')
  await act(async () => {
    reread.resolve([CHECKING, TRAD, TRAD_MATCH, TRAD_PRETAX, HSA])
  })
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['10', '20', '22', '21', '11'])
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(3)
})

it('parks the grips while the roster on screen failed to reload, until a Retry brings it back', async () => {
  vi.mocked(fetchAccounts)
    .mockResolvedValueOnce(ROSTER)
    .mockRejectedValueOnce(new ApiError('accounts unavailable', 503))
    .mockResolvedValue(ROSTER)
  vi.mocked(reorderAccounts).mockRejectedValue(new ApiError('database unavailable', 503))
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')

  // The save failed and so did the read after it: the rows on screen may be behind the server,
  // and a drop diffed against them would PUT an order nobody chose.
  expect(
    await screen.findByText("Couldn't load the accounts — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the accounts' }))
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('parks every grip while another request of the roster is in flight (spec §4.1 Busy)', async () => {
  const patch = deferred<AccountOut>()
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(updateAccount).mockReturnValue(patch.promise)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retire Fidelity HSA' }))

  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')
  expect(grip('Traditional pre-tax').getAttribute('aria-disabled')).toBe('true')
  // Parked, not disabled: the grip keeps its focus and lifts nothing.
  expect((grip('Fidelity HSA') as HTMLButtonElement).disabled).toBe(false)
  press('Fidelity Traditional 401(k)', ' ')
  expect(live()).toBe('')

  await act(async () => {
    patch.resolve({ ...HSA, is_active: false })
  })
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('holds every roster button while a row is lifted — the portfolio labels stay live', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  const edit = () => screen.getByRole('button', { name: 'Edit Traditional pre-tax' }) as HTMLButtonElement

  press('Fidelity HSA', ' ')
  expect(edit().disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Delete Fidelity HSA' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Retire Joint Checking' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('Owner for Fidelity Brokerage') as HTMLSelectElement).disabled).toBe(false)

  press('Fidelity HSA', 'Escape')
  expect(live()).toBe('Cancelled. Fidelity HSA is back at position 1 of 2.')
  expect(edit().disabled).toBe(false)
})

it('says what the order is for and how to change it (spec §8.1)', async () => {
  render(<AccountsCard people={[ME]} />)
  const table = await screen.findByRole('table', { name: 'Net-worth accounts' })

  const note = screen.getByText(
    'The Monthly update lists accounts in this order within each person and group — a spreadsheet column pasted there fills them in this order too.',
  )
  // Under the roster, above the Portfolio accounts heading.
  expect(table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const labelsHeading = document.querySelector('.portfolio-accounts-heading') as HTMLElement
  expect(note.compareDocumentPosition(labelsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^About The net-worth roster/ }))
  expect(screen.getByRole('tooltip').textContent).toContain(
    'Drag a row by its grip to reorder accounts within their group; a parent brings its components with it.',
  )
})
