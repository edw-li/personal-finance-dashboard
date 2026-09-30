import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AccountOut, CategoryOut, PersonOut } from '../../types/api'
import PendingChanges, { type PendingChangesProps } from './PendingChanges'

afterEach(cleanup)
const accounts = [
  { id: 1, name: 'Checking', person_id: 1, parent_account_id: null },
  { id: 3, name: 'Retirement', person_id: 1, parent_account_id: null },
  { id: 4, name: 'Pre-tax component', person_id: 1, parent_account_id: 3 },
  { id: 5, name: 'Roth component', person_id: 1, parent_account_id: 3 },
] as AccountOut[]
const categories = [{ id: 2, name: 'Food' }, { id: 6, name: 'Rent' }] as CategoryOut[]
const people = [{ id: 1, name: 'Edward' }] as PersonOut[]
const fixture = (): PendingChangesProps => {
  const part = { balances: { 1: '500', 3: '900', 4: '400', 5: '500' }, amounts: { 2: '100', 6: '0' }, notes: '', netPay: '2000', typedParents: [], recordZero: false }
  return { accounts, people, balanceRows: [accounts[0], accounts[2], accounts[3]], categoryRows: [categories[0]],
    saved: part, current: part, storedBalances: part.balances, storedCategories: new Set([2]), send: { balances: true, spending: true } }
}
const table = () => screen.getByRole('table', { name: 'Entries that will be saved' })

it('shows both offsetting component edits with parent and owner context, without double-counting the total', () => {
  const props = fixture()
  render(<PendingChanges {...props} current={{ ...props.current, balances: { 1: '500', 3: '900', 4: '450', 5: '450' } }} />)
  expect(screen.getByRole('status').textContent).toBe('2 changes to save')
  expect(within(table()).getAllByText('Edward · Retirement · Balance')).toHaveLength(2)
  expect(within(table()).getByText('+$50.00')).toBeTruthy()
  expect(within(table()).getByText('−$50.00')).toBeTruthy()
  fireEvent.click(screen.getByText('Will be saved'))
  expect(screen.getByText('Will be saved').closest('details')?.open).toBe(false)
})

it('lists category, take-home removal and notes changes with their saved values', () => {
  const props = fixture()
  render(<PendingChanges {...props} current={{ ...props.current, amounts: { 2: '250' }, netPay: '', notes: 'Year-end adjustment' }} />)
  expect(screen.getByRole('status').textContent).toBe('3 changes to save')
  const takeHome = screen.getByText('Household take-home').closest('tr')!
  expect(takeHome.textContent).toContain('$2,000.00')
  expect(takeHome.textContent).toContain('Removed')
  expect(takeHome.textContent).not.toContain('−$2,000.00')
  expect(screen.getByText('Year-end adjustment')).toBeTruthy()
  expect(screen.getByText('+$150.00')).toBeTruthy()
})

it('keeps carried balances and untouched zero categories out of a spending-only save', () => {
  const props = fixture()
  render(<PendingChanges {...props} storedBalances={{}} storedCategories={new Set()}
    send={{ balances: false, spending: true }} current={{ ...props.current, amounts: { 2: '250', 6: '0' } }} />)
  expect(screen.getByRole('status').textContent).toBe('1 change to save')
  expect(screen.queryByText('Checking')).toBeNull()
  expect(screen.queryByText('Rent')).toBeNull()
  expect(screen.getByText('Not recorded')).toBeTruthy()
  expect(screen.queryByText('+$250.00')).toBeNull()
})

it('shows every newly recorded editable balance when a first snapshot will be sent', () => {
  const props = fixture()
  render(<PendingChanges {...props} storedBalances={{}} send={{ balances: true, spending: false }} />)
  expect(screen.getByRole('status').textContent).toBe('3 changes to save')
  expect(screen.getAllByText('Not recorded')).toHaveLength(3)
})

it('honors excluded save parts and equivalent formatting, while distinguishing new zeros from missing entries', () => {
  const props = fixture()
  const view = render(<PendingChanges {...props} send={{ balances: true, spending: false }}
    current={{ ...props.current, balances: { ...props.current.balances, 1: '$500.00' }, netPay: '9999', amounts: { 2: '9999' } }} />)
  expect(screen.getByRole('status').textContent).toBe('No entry changes to save')
  view.rerender(<PendingChanges {...props} storedCategories={new Set()} categoryRows={categories}
    current={{ ...props.current, amounts: { 2: '100', 6: '0' }, recordZero: true }} />)
  const rent = screen.getByText('Rent').closest('tr')!
  expect(rent.textContent).toContain('Not recorded')
  expect(rent.textContent).toContain('$0.00')
  expect(rent.textContent).not.toContain('+$0.00')
  expect(screen.getByText('Confirmed for this month')).toBeTruthy()
})

it('explains a switch from a hand-entered total to components even when the total is unchanged', () => {
  const props = fixture()
  render(<PendingChanges {...props} saved={{ ...props.saved, typedParents: [3] }} />)
  expect(screen.getByRole('status').textContent).toBe('1 change to save')
  expect(screen.getByText('Hand-entered total')).toBeTruthy()
  expect(screen.getByText('Sum of components')).toBeTruthy()
})
