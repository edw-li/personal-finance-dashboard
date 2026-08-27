import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { AccountOut, PersonOut } from '../../types/api'
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

beforeEach(() => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA])
  vi.mocked(createAccount).mockResolvedValue(CHECKING)
  vi.mocked(updateAccount).mockResolvedValue(HSA)
  vi.mocked(deleteAccount).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Every roster assertion is scoped to the TABLE: account names are also options in the
// parent select, and owner names are also options in the owner select.
const roster = () => within(screen.getByRole('table'))

it('renders the roster with owner names, joint spelled out', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  const table = within(await screen.findByRole('table'))

  expect(table.getByText('Joint Checking')).toBeTruthy()
  // A NULL owner is JOINT, never a blank cell: the migration backfilled every
  // pre-existing account, so an unset owner is a deliberate statement.
  expect(table.getByText('Joint')).toBeTruthy()
  expect(table.getByText('Me')).toBeTruthy()
  expect(table.getByText('Pre-tax')).toBeTruthy()
})

it('creates an account with owner, parent and the component flag', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table')

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
  await screen.findByRole('table')

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
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Retire Fidelity HSA' }))

  // ONLY is_active on the wire: sending the whole row back would let a stale render
  // overwrite a concurrent edit.
  await waitFor(() =>
    expect(vi.mocked(updateAccount)).toHaveBeenCalledWith(11, { is_active: false }),
  )
})

it('deletes a balance-free account', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table')

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
  await screen.findByRole('table')

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
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Joint Checking' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  expect(await screen.findByText("account 'joint-checking' already exists")).toBeTruthy()
})
