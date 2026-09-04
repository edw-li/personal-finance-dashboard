import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { AccountOut, PersonOut, PortfolioAccountOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import AccountsCard from './AccountsCard'

vi.mock('../../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/netWorth')>()),
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}))
import { createAccount, deleteAccount, fetchAccounts, updateAccount } from '../../api/netWorth'
vi.mock('../../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/portfolio')>()),
  fetchPortfolioAccounts: vi.fn(),
  patchPortfolioAccount: vi.fn(),
}))
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'

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

beforeEach(() => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA])
  vi.mocked(createAccount).mockResolvedValue(CHECKING)
  vi.mocked(updateAccount).mockResolvedValue(HSA)
  vi.mocked(deleteAccount).mockResolvedValue(undefined)
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([BROKERAGE, JOINT_ROTH])
  vi.mocked(patchPortfolioAccount).mockResolvedValue({ ...BROKERAGE, person_id: 2 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Every roster assertion is scoped to the NET-WORTH table: account names are also options
// in the parent select, owner names are also options in both owner selects, and the card
// now carries a second table (Portfolio accounts).
const roster = () => within(screen.getByRole('table', { name: 'Net-worth accounts' }))

it('renders the roster with owner names, joint spelled out', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  const table = within(await screen.findByRole('table', { name: 'Net-worth accounts' }))

  expect(table.getByText('Joint Checking')).toBeTruthy()
  // A NULL owner is JOINT, never a blank cell: the migration backfilled every
  // pre-existing account, so an unset owner is a deliberate statement.
  expect(table.getByText('Joint')).toBeTruthy()
  expect(table.getByText('Me')).toBeTruthy()
  expect(table.getByText('Pre-tax')).toBeTruthy()
})

it('creates an account with owner, parent and the component flag', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Partner 401(k)' } })
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'pre_tax' } })
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Sort order'), { target: { value: '12' } })
  fireEvent.change(screen.getByLabelText('Parent account'), { target: { value: '11' } })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  await waitFor(() => expect(vi.mocked(createAccount)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createAccount).mock.calls[0][0]).toEqual({
    name: 'Partner 401(k)',
    group: 'pre_tax',
    sort_order: 12,
    is_component: true,
    person_id: 2,
    parent_account_id: 11,
  })
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
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
