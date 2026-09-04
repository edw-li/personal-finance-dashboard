import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { CategoryOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import CategoriesCard from './CategoriesCard'

vi.mock('../../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/spending')>()),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from '../../api/spending'

const GROCERIES: CategoryOut = {
  id: 5,
  name: 'Groceries',
  slug: 'groceries',
  sort_order: 1,
  is_active: true,
  kind: 'living',
}
const PETS: CategoryOut = {
  id: 6,
  name: 'Pets',
  slug: 'pets',
  sort_order: 2,
  is_active: false,
  kind: 'living',
}
// The real category that started this program: $5,044.00 in April 2026, counted as living
// spend until the kind existed (spec §0).
const TAXES: CategoryOut = {
  id: 7,
  name: 'Taxes',
  slug: 'taxes',
  sort_order: 3,
  is_active: true,
  kind: 'tax',
}

beforeEach(() => {
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES, PETS, TAXES])
  vi.mocked(createCategory).mockResolvedValue(GROCERIES)
  vi.mocked(updateCategory).mockResolvedValue(GROCERIES)
  vi.mocked(deleteCategory).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('lists the categories with their retirement state', async () => {
  render(<CategoriesCard />)
  const table = within(await screen.findByRole('table'))

  expect(table.getByText('Groceries')).toBeTruthy()
  expect(table.getByText('Pets')).toBeTruthy()
  expect(table.getByText('Retired')).toBeTruthy()
})

it('creates a category', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '  Wedding  ' } })
  fireEvent.change(screen.getByLabelText('Sort order'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))

  await waitFor(() => expect(vi.mocked(createCategory)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createCategory).mock.calls[0][0]).toEqual({ name: 'Wedding', sort_order: 9 })
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})

it('renames through the inline editor', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Edit Groceries' }))
  expect((screen.getByLabelText('Category name') as HTMLInputElement).value).toBe('Groceries')
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Food' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }))

  await waitFor(() =>
    expect(vi.mocked(updateCategory)).toHaveBeenCalledWith(5, { name: 'Food', sort_order: 1 }),
  )
})

it('retires and restores without touching the other columns', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Retire Groceries' }))
  await waitFor(() =>
    expect(vi.mocked(updateCategory)).toHaveBeenCalledWith(5, { is_active: false }),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Restore Pets' }))
  await waitFor(() =>
    expect(vi.mocked(updateCategory)).toHaveBeenCalledWith(6, { is_active: true }),
  )
})

it('surfaces the delete 409 as a toast and keeps the row', async () => {
  vi.mocked(deleteCategory).mockRejectedValue(
    new ApiError('category has 31 monthly rows — deactivate it instead', 409),
  )
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Delete Groceries' }))

  const toast = await screen.findByText('category has 31 monthly rows — deactivate it instead')
  expect(toast.className).toBe('toast-message')
  expect(within(screen.getByRole('table')).getByText('Groceries')).toBeTruthy()
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)
})

it('banners a failed load and refetches on Retry', async () => {
  vi.mocked(fetchCategories)
    .mockRejectedValueOnce(new ApiError('categories unavailable', 503))
    .mockResolvedValue([GROCERIES])
  render(<CategoriesCard />)

  expect(await screen.findByText('categories unavailable')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('table')).toBeTruthy()
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2)
})

it('shows each category kind on a three-way picker', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  const groceries = within(screen.getByRole('group', { name: 'Kind for Groceries' }))
  expect(groceries.getByRole('button', { name: 'Living' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(groceries.getByRole('button', { name: 'Tax' }).getAttribute('aria-pressed')).toBe('false')
  expect(groceries.getByRole('button', { name: 'Transfer' }).getAttribute('aria-pressed')).toBe(
    'false',
  )
  // The picker READS the row, it does not hold its own copy: Taxes must land on Tax.
  const taxes = within(screen.getByRole('group', { name: 'Kind for Taxes' }))
  expect(taxes.getByRole('button', { name: 'Tax' }).getAttribute('aria-pressed')).toBe('true')
  expect(taxes.getByRole('button', { name: 'Living' }).getAttribute('aria-pressed')).toBe('false')
})

it('PATCHes the kind alone and re-reads the list', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(
    within(screen.getByRole('group', { name: 'Kind for Groceries' })).getByRole('button', {
      name: 'Transfer',
    }),
  )

  await waitFor(() => expect(vi.mocked(updateCategory)).toHaveBeenCalledTimes(1))
  // ONLY kind on the wire — toggleActive's rule: sending the name and position back would
  // let a stale render overwrite a concurrent edit.
  expect(vi.mocked(updateCategory).mock.calls[0]).toEqual([5, { kind: 'transfer' }])
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})

it('does not PATCH when the kind a row already has is clicked again', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(
    within(screen.getByRole('group', { name: 'Kind for Taxes' })).getByRole('button', {
      name: 'Tax',
    }),
  )

  // Segmented reports every click, including one on the active button. A PATCH that changes
  // nothing would still write a change-log batch offering to "undo" a no-op.
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(updateCategory)).not.toHaveBeenCalled()
})

it('spells out what each kind means and that a change moves ALL history', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  expect(screen.getByText(/Living: money that left the household/)).toBeTruthy()
  expect(screen.getByText(/Tax: an income-tax payment made from take-home/)).toBeTruthy()
  expect(screen.getByText(/Transfer: money that stayed yours/)).toBeTruthy()
  expect(screen.getByText(/Changing a kind recomputes ALL history/)).toBeTruthy()
})

it('banners a refused kind change and leaves the row on its old kind', async () => {
  vi.mocked(updateCategory).mockRejectedValue(
    new ApiError('kind must be one of: living, tax, transfer', 422),
  )
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(
    within(screen.getByRole('group', { name: 'Kind for Groceries' })).getByRole('button', {
      name: 'Tax',
    }),
  )

  expect(await screen.findByText('kind must be one of: living, tax, transfer')).toBeTruthy()
  // No optimistic local copy: a refused change must leave Groceries reading Living.
  expect(
    within(screen.getByRole('group', { name: 'Kind for Groceries' }))
      .getByRole('button', { name: 'Living' })
      .getAttribute('aria-pressed'),
  ).toBe('true')
})
