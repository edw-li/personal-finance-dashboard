import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { ActivityBatch, CategoryOut } from '../../types/api'
import { REORDER_INSTRUCTIONS } from '../reorder/reorderMath'
import ToastProvider from '../ToastProvider'
import CategoriesCard from './CategoriesCard'

vi.mock('../../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/spending')>()),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  updateCategoryLogged: vi.fn(),
  deleteCategory: vi.fn(),
  reorderCategories: vi.fn(),
}))
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  reorderCategories,
  updateCategory,
  updateCategoryLogged,
} from '../../api/spending'
vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  undoBatch: vi.fn(),
}))
import { undoBatch } from '../../api/lifecycle'

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
// Added in another tab while this one still showed three rows (the 409 case, spec §9).
const WEDDING: CategoryOut = {
  id: 8,
  name: 'Wedding',
  slug: 'wedding',
  sort_order: 4,
  is_active: true,
  kind: 'living',
}
// The change log's answer to an Undo (POST /activity/batches/{id}/undo).
const UNDONE: ActivityBatch = {
  type: 'batch',
  batch_id: 'undo-1',
  at: '2026-09-23T12:00:00Z',
  source: 'undo',
  actor: 'admin@example.com',
  label: 'Undid: Moved category Pets',
  month: null,
  rows: 3,
  undoable: true,
  undone_by: null,
}
// R1's stale-list sentence for this route (2026-09-23 reorder spec §8.3).
const STALE = 'The spending categories changed since this list was loaded — nothing was moved.'

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
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES, PETS, TAXES])
  vi.mocked(createCategory).mockResolvedValue(GROCERIES)
  vi.mocked(updateCategory).mockResolvedValue(GROCERIES)
  vi.mocked(updateCategoryLogged).mockResolvedValue({ data: GROCERIES, batchId: 'kind-batch' })
  vi.mocked(deleteCategory).mockResolvedValue({ batchId: null })
  vi.mocked(reorderCategories).mockResolvedValue({ data: [PETS, GROCERIES, TAXES], batchId: 'batch-7' })
  vi.mocked(undoBatch).mockResolvedValue(UNDONE)
  // jsdom has no layout: a keyboard lift measures every row at y=0 and asks the page to scroll it
  // clear of the top edge zone, and jsdom does not implement window.scrollBy.
  window.scrollBy = vi.fn()
})

afterEach(() => {
  cleanup()
  // Reset, not clear: a test that fails before consuming its mockReturnValueOnce answers would
  // leave them queued for the next test. beforeEach re-seeds every mock in this file.
  vi.resetAllMocks()
})

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
/** The keyboard reorder (spec §2.4): each key pressed on the row's grip, in order. */
function press(name: string, ...keys: string[]) {
  for (const key of keys) fireEvent.keyDown(grip(name), { key })
}
/** The table's rows by id, top to bottom — the order on screen. */
const rowIds = () =>
  [...document.querySelectorAll('.category-table tbody tr')].map((row) =>
    row.getAttribute('data-reorder-id'),
  )
const row = (id: number) =>
  document.querySelector(`.category-table tbody tr[data-reorder-id="${id}"]`)
/** The card's reorder live region (the toast layer's alert region is a <div>). */
const live = () => document.querySelector('span[aria-live="assertive"]')?.textContent ?? ''

it('reveals the editor and returns Escape to its row', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')
  const edit = screen.getByRole('button', { name: 'Edit Groceries' })
  fireEvent.click(edit)
  const input = screen.getByLabelText('Category name') as HTMLInputElement
  expect(document.activeElement).toBe(input)
  expect(input.selectionEnd).toBe(input.value.length)
  expect(row(5)?.getAttribute('aria-current')).toBe('true')
  edit.focus()
  fireEvent.click(edit)
  expect(document.activeElement).toBe(input)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(document.activeElement).toBe(edit)
  expect(row(5)?.hasAttribute('aria-current')).toBe(false)
})

it('changes kind optimistically and locks only the row, then undoes the logged batch', async () => {
  const patch = deferred<{ data: CategoryOut; batchId: string }>()
  vi.mocked(updateCategoryLogged).mockReturnValue(patch.promise)
  render(<ToastProvider><CategoriesCard /></ToastProvider>)
  await screen.findByRole('table')
  const kinds = within(screen.getByRole('group', { name: 'Kind for Groceries' }))
  fireEvent.click(kinds.getByRole('button', { name: 'Transfer' }))
  expect(kinds.getByRole('button', { name: 'Transfer' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Edit Pets' }).getAttribute('aria-disabled')).not.toBe('true')
  await act(async () => patch.resolve({ data: { ...GROCERIES, kind: 'transfer' }, batchId: 'kind-batch' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('kind-batch'))
  await waitFor(() => expect(kinds.getByRole('button', { name: 'Living' }).getAttribute('aria-pressed')).toBe('true'))
})

it('deletes before offering Undo and restores the identical category with focus', async () => {
  vi.mocked(deleteCategory).mockResolvedValue({ batchId: 'delete-batch' })
  render(<ToastProvider><CategoriesCard /></ToastProvider>)
  await screen.findByRole('table')
  vi.mocked(fetchCategories).mockResolvedValue([PETS, TAXES])
  const remove = screen.getByRole('button', { name: 'Delete Groceries' })
  remove.focus()
  fireEvent.click(remove)
  const undo = await screen.findByRole('button', { name: 'Undo' })
  expect(row(5)).toBeNull()
  expect(document.activeElement).not.toBe(document.body)
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES, PETS, TAXES])
  fireEvent.click(undo)
  await waitFor(() => expect(row(5)?.hasAttribute('data-flash')).toBe(true))
  expect(row(5)?.contains(document.activeElement)).toBe(true)
})

it('lists the categories with their retirement state', async () => {
  render(<CategoriesCard />)
  const table = within(await screen.findByRole('table'))

  expect(table.getByText('Groceries')).toBeTruthy()
  expect(table.getByText('Pets')).toBeTruthy()
  expect(table.getByText('Retired')).toBeTruthy()
})

it('creates a category from its name alone — it lands at the end of the list (reorder spec §3.3)', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '  Wedding  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))

  await waitFor(() => expect(vi.mocked(createCategory)).toHaveBeenCalledTimes(1))
  // No sort_order key at all: the server appends a create that names no position.
  expect(vi.mocked(createCategory).mock.calls[0][0]).toStrictEqual({ name: 'Wedding' })
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})

it('offers no Sort order box: the order is the table’s (reorder spec §4.1)', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  expect(screen.queryByLabelText('Sort order')).toBeNull()
})

it('renames through the inline editor', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Edit Groceries' }))
  expect((screen.getByLabelText('Category name') as HTMLInputElement).value).toBe('Groceries')
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Food' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }))

  await waitFor(() => expect(vi.mocked(updateCategory)).toHaveBeenCalledTimes(1))
  // The name alone: sending the stored position back would undo a drag made since this render.
  expect(vi.mocked(updateCategory).mock.calls[0]).toStrictEqual([5, { name: 'Food' }])
})

it('retires and restores without touching the other columns', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Retire Groceries' }))
  await waitFor(() =>
    expect(vi.mocked(updateCategoryLogged)).toHaveBeenCalledWith(5, { is_active: false }),
  )

  // The card stays busy until the Retire's reload has landed (a write holds the row buttons with
  // the grips): the second click waits for it rather than racing it.
  const restore = () => screen.getByRole('button', { name: 'Restore Pets' }) as HTMLButtonElement
  await waitFor(() => expect(restore().disabled).toBe(false))
  fireEvent.click(restore())
  await waitFor(() =>
    expect(vi.mocked(updateCategoryLogged)).toHaveBeenCalledWith(6, { is_active: true }),
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

  expect(
    await screen.findByText("Couldn't load the categories — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the categories' }))
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

  await waitFor(() => expect(vi.mocked(updateCategoryLogged)).toHaveBeenCalledTimes(1))
  // ONLY kind on the wire — toggleActive's rule: sending the name and position back would
  // let a stale render overwrite a concurrent edit.
  expect(vi.mocked(updateCategoryLogged).mock.calls[0]).toEqual([5, { kind: 'transfer' }])
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
  expect(vi.mocked(updateCategoryLogged)).not.toHaveBeenCalled()
})

it('spells out what each kind means and that a change moves ALL history', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  expect(screen.getByText(/Living: money that left the household/)).toBeTruthy()
  expect(screen.getByText(/Tax: an income-tax payment made from take-home/)).toBeTruthy()
  expect(screen.getByText(/Transfer: money that stayed yours/)).toBeTruthy()
  expect(screen.getByText(/Changing a kind recomputes ALL history/)).toBeTruthy()
})

it('toasts a refused kind change and leaves the row on its old kind', async () => {
  vi.mocked(updateCategoryLogged).mockRejectedValue(
    new ApiError('kind must be one of: living, tax, transfer', 422),
  )
  render(<ToastProvider><CategoriesCard /></ToastProvider>)
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

it('renders a validation error inline with no Retry beside it (motion spec §9)', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')
  fireEvent.submit(screen.getByRole('button', { name: 'Add category' }).closest('form')!)

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Category name is required.')
  // Retry re-runs the FETCH: here it would invite a re-send of a form the client refused.
  expect(within(alert).queryByRole('button')).toBeNull()
})

it('is a span-12 card whose table scroller carries the row-actions column (2026-09-13 spec §7)', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')
  const card = document.getElementById('categories') as HTMLElement
  expect(card.classList.contains('span-12')).toBe(true)
  expect(card.querySelector('.settings-scroll')).not.toBeNull()
  expect(card.querySelectorAll('td.row-actions').length).toBeGreaterThan(0)
})

// --- drag to reorder (2026-09-23 reorder spec §4.1) ---

it('draws a grip column where the Sort column was, on a table whose cells carry their own hairlines', async () => {
  render(<CategoriesCard />)
  const table = await screen.findByRole('table')

  expect(table.classList.contains('reorder-table')).toBe(true)
  const headers = [...table.querySelectorAll('thead th')]
  expect(headers.map((th) => th.textContent)).toEqual(['', 'Category', 'Kind', 'Status', ''])
  expect(headers[0].className).toBe('reorder-grip-cell')
  expect(headers[0].getAttribute('aria-hidden')).toBe('true')
  // One grip per row, in the first cell, named for its row.
  for (const name of ['Groceries', 'Pets', 'Taxes']) {
    expect(grip(name).closest('td')?.className).toBe('reorder-grip-cell')
  }
  // The instructions every grip points at, and the live region, sit OUTSIDE the table.
  const instructions = document.getElementById(grip('Groceries').getAttribute('aria-describedby') ?? '')
  expect(instructions?.textContent).toBe(REORDER_INSTRUCTIONS)
  expect(table.contains(instructions)).toBe(false)
  const region = document.querySelector('span[aria-live="assertive"]')
  expect(region).not.toBeNull()
  expect(table.contains(region)).toBe(false)
})

it('a list with nothing to move has a disabled grip; an empty list has none (spec §9)', async () => {
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES])
  const { unmount } = render(<CategoriesCard />)
  await screen.findByRole('table')
  expect((grip('Groceries') as HTMLButtonElement).disabled).toBe(true)
  unmount()

  vi.mocked(fetchCategories).mockResolvedValue([])
  render(<CategoriesCard />)
  expect(await screen.findByText('No categories yet — add the first one above.')).toBeTruthy()
  expect(screen.queryAllByRole('button', { name: /^Reorder / })).toEqual([])
})

it('a keyboard drop draws the new order at once and saves the WHOLE order in one PUT — a retired row moves like any other', async () => {
  const save = deferred<{ data: CategoryOut[]; batchId: string | null }>()
  vi.mocked(reorderCategories).mockReturnValue(save.promise)
  render(<CategoriesCard />)
  await screen.findByRole('table')
  expect(rowIds()).toEqual(['5', '6', '7'])

  // Pets is retired: it keeps its place in the list and moves like any other row.
  press('Pets', ' ')
  expect(live()).toBe('Picked up Pets. Position 2 of 3.')
  press('Pets', 'ArrowUp', ' ')

  // Optimistic: the rows stand in the dropped order before the server answers…
  expect(rowIds()).toEqual(['6', '5', '7'])
  expect(vi.mocked(reorderCategories)).toHaveBeenCalledTimes(1)
  expect(vi.mocked(reorderCategories)).toHaveBeenCalledWith([6, 5, 7])
  // …and every grip is parked while the save is in flight: no second drop can race it.
  expect(grip('Groceries').getAttribute('aria-disabled')).toBe('true')
  expect(grip('Pets').getAttribute('aria-disabled')).toBe('true')

  // The response is the truth: whatever order it carries is the order drawn (it differs from
  // the drop here only to prove the rows were replaced, not kept).
  await act(async () => {
    save.resolve({ data: [PETS, TAXES, GROCERIES], batchId: 'batch-7' })
  })
  expect(rowIds()).toEqual(['6', '7', '5'])
  expect(grip('Groceries').getAttribute('aria-disabled')).toBeNull()
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)
})

it('saved: the moved row flashes and a toast names it, with Undo (spec §8.1)', async () => {
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText('Moved Pets')
  expect(toast.className).toBe('toast-message')
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  expect(row(6)?.hasAttribute('data-reorder-saved')).toBe(true)
})

it('a save that logged nothing offers no Undo', async () => {
  vi.mocked(reorderCategories).mockResolvedValue({ data: [PETS, GROCERIES, TAXES], batchId: null })
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  expect(await screen.findByText('Moved Pets')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it('Undo reverts through the change log, reloads and says so (spec §4.1)', async () => {
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Pets')
  expect(rowIds()).toEqual(['6', '5', '7'])

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  await waitFor(() => expect(vi.mocked(undoBatch)).toHaveBeenCalledWith('batch-7'))
  expect(await screen.findByText('Order restored')).toBeTruthy()
  await waitFor(() => expect(rowIds()).toEqual(['5', '6', '7']))
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2)
})

it("a refused Undo shows the server's own sentence (spec §9)", async () => {
  vi.mocked(undoBatch).mockRejectedValue(
    new ApiError('Later changes touched these rows — undo those first', 409),
  )
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Pets')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  const refusal = await screen.findByText('Later changes touched these rows — undo those first')
  expect(refusal.className).toBe('toast-message')
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)
})

// …and an Undo that fails for any other reason speaks the one §8.1 sentence every reorderable
// list shares.
it('an Undo the server could not run says why, in the shared sentence (spec §8.1)', async () => {
  vi.mocked(undoBatch).mockRejectedValue(new ApiError('Service Unavailable', 503))
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Pets')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  const failure = await screen.findByText(
    "Couldn't undo the move — the server had a problem (HTTP 503).",
  )
  expect(failure.className).toBe('toast-message')
})

it('a failed save snaps back to the last server order, says why, and reads the list again (spec §8.1)', async () => {
  vi.mocked(reorderCategories).mockRejectedValue(new ApiError('database unavailable', 503))
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(
    "Couldn't save the new order — the server had a problem (HTTP 503). The list is back to how it was.",
  )
  expect(toast.className).toBe('toast-message')
  expect(rowIds()).toEqual(['5', '6', '7'])
  // A 5xx can come AFTER the write committed, so the rows are read again: what the table shows
  // is the server's order, whichever it is — and the grips wait for it.
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(grip('Pets').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['5', '6', '7'])
})

it("a stale list (409) shows the server's sentence and reloads the current rows (spec §8.3)", async () => {
  vi.mocked(reorderCategories).mockRejectedValue(new ApiError(STALE, 409))
  vi.mocked(fetchCategories)
    .mockResolvedValueOnce([GROCERIES, PETS, TAXES])
    .mockResolvedValueOnce([GROCERIES, PETS, TAXES, WEDDING])
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(STALE)
  expect(toast.className).toBe('toast-message')
  await waitFor(() => expect(rowIds()).toEqual(['5', '6', '7', '8']))
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2)
})

it('a stale-list 409 that brought no sentence names its status — never an empty toast', async () => {
  vi.mocked(reorderCategories).mockRejectedValue(new ApiError('', 409))
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText('HTTP 409')
  expect(toast.className).toBe('toast-message')
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})

it('keeps the grips parked until the reload a write started has landed — no drop diffs against rows the write moved past', async () => {
  const reload = deferred<CategoryOut[]>()
  vi.mocked(fetchCategories)
    .mockResolvedValueOnce([GROCERIES, PETS, TAXES])
    .mockReturnValueOnce(reload.promise)
  render(<CategoriesCard />)
  await screen.findByRole('table')

  // Retire answers at once; the list it changed is still on the wire.
  fireEvent.click(screen.getByRole('button', { name: 'Retire Groceries' }))
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
  expect(grip('Pets').getAttribute('aria-disabled')).toBe('true')
  press('Pets', ' ', 'ArrowUp', ' ')
  expect(vi.mocked(reorderCategories)).not.toHaveBeenCalled()

  await act(async () => {
    reload.resolve([{ ...GROCERIES, is_active: false }, PETS, TAXES])
  })
  await waitFor(() => expect(grip('Pets').getAttribute('aria-disabled')).toBeNull())
  expect(within(screen.getByRole('table')).getAllByText('Retired')).toHaveLength(2)
})

it('an Undo holds the grips until the order it restored is on screen — a drop in that window sends no PUT', async () => {
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Pets')
  await waitFor(() => expect(grip('Groceries').getAttribute('aria-disabled')).toBeNull())
  const reload = deferred<CategoryOut[]>()
  vi.mocked(fetchCategories).mockReturnValueOnce(reload.promise)

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await screen.findByText('Order restored')

  // The undo has answered; the order it restored is still on the wire. A drop now would diff
  // against the pre-Undo rows and PUT the undone move straight back.
  expect(grip('Groceries').getAttribute('aria-disabled')).toBe('true')
  press('Groceries', ' ', 'ArrowDown', ' ')
  expect(vi.mocked(reorderCategories)).toHaveBeenCalledTimes(1)

  await act(async () => {
    reload.resolve([GROCERIES, PETS, TAXES])
  })
  await waitFor(() => expect(grip('Groceries').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['5', '6', '7'])
})

it('an older toast’s Undo overlapping a later save: the grips wait for BOTH, and the overtaken save is read back, not drawn', async () => {
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  // A first move, saved, with its Undo on screen.
  press('Pets', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Pets')
  await waitFor(() => expect(grip('Taxes').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['6', '5', '7'])
  // A second move, its save held on the wire…
  const save = deferred<{ data: CategoryOut[]; batchId: string | null }>()
  vi.mocked(reorderCategories).mockReturnValueOnce(save.promise)
  press('Taxes', ' ', 'ArrowUp', ' ')
  expect(rowIds()).toEqual(['6', '7', '5'])
  // …while the first move's Undo runs, and the reload after it lands.
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await screen.findByText('Order restored')
  await waitFor(() => expect(rowIds()).toEqual(['5', '6', '7']))
  // The Undo is done, the second save is not: the grips stay parked.
  expect(grip('Groceries').getAttribute('aria-disabled')).toBe('true')

  // The save answers last. Its answer is older than the reload's (asked for before it), so it is
  // not drawn — and since it may have committed after that reload read, the list is read again.
  const reread = deferred<CategoryOut[]>()
  vi.mocked(fetchCategories).mockReturnValueOnce(reread.promise)
  await act(async () => {
    save.resolve({ data: [PETS, TAXES, GROCERIES], batchId: 'batch-8' })
  })
  expect(rowIds()).toEqual(['5', '6', '7'])
  expect(grip('Groceries').getAttribute('aria-disabled')).toBe('true')
  await act(async () => {
    reread.resolve([PETS, TAXES, GROCERIES])
  })
  await waitFor(() => expect(grip('Groceries').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['6', '7', '5'])
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(3)
})

it('parks the grips while the list on screen failed to reload, until a Retry brings it back', async () => {
  vi.mocked(fetchCategories)
    .mockResolvedValueOnce([GROCERIES, PETS, TAXES])
    .mockRejectedValueOnce(new ApiError('categories unavailable', 503))
    .mockResolvedValue([GROCERIES, PETS, TAXES])
  vi.mocked(reorderCategories).mockRejectedValue(new ApiError('database unavailable', 503))
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  // The save failed and so did the read after it: the rows on screen may be behind the server,
  // and a drop diffed against them would PUT an order nobody chose.
  expect(
    await screen.findByText("Couldn't load the categories — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
  expect(grip('Pets').getAttribute('aria-disabled')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the categories' }))
  await waitFor(() => expect(grip('Pets').getAttribute('aria-disabled')).toBeNull())
})

it('parks every grip while another request of the card is in flight (spec §4.1 Busy)', async () => {
  const patch = deferred<{ data: CategoryOut; batchId: string | null }>()
  vi.mocked(updateCategoryLogged).mockReturnValue(patch.promise)
  render(<CategoriesCard />)
  await screen.findByRole('table')
  expect(grip('Taxes').getAttribute('aria-disabled')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retire Groceries' }))

  expect(grip('Groceries').getAttribute('aria-disabled')).toBe('true')
  expect(grip('Taxes').getAttribute('aria-disabled')).toBe('true')
  // Parked, not disabled: the grip keeps its focus and lifts nothing.
  expect((grip('Taxes') as HTMLButtonElement).disabled).toBe(false)
  press('Taxes', ' ')
  expect(live()).toBe('')

  await act(async () => {
    patch.resolve({ data: { ...GROCERIES, is_active: false }, batchId: null })
  })
  await waitFor(() => expect(grip('Taxes').getAttribute('aria-disabled')).toBeNull())
})

it('holds every row button while a row is lifted, and gives them back when the lift is cancelled', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')
  const edit = () => screen.getByRole('button', { name: 'Edit Taxes' }) as HTMLButtonElement
  const kindTax = () =>
    within(screen.getByRole('group', { name: 'Kind for Pets' })).getByRole('button', {
      name: 'Tax',
    }) as HTMLButtonElement

  press('Groceries', ' ')
  expect(edit().getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByRole('button', { name: 'Delete Pets' }).getAttribute('aria-disabled')).toBe('true')
  expect(kindTax().disabled).toBe(true)

  press('Groceries', 'Escape')
  expect(live()).toBe('Cancelled. Groceries is back at position 1 of 3.')
  expect(edit().getAttribute('aria-disabled')).toBeNull()
  expect(kindTax().disabled).toBe(false)
})

it('says what the order is for and how to change it (spec §8.1)', async () => {
  render(<CategoriesCard />)
  const table = await screen.findByRole('table')

  const note = screen.getByText(
    'The Monthly update lists categories in this order — a spreadsheet column pasted there fills them in this order too.',
  )
  // Under the table.
  expect(table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^About The spending matrix's/ }))
  expect(screen.getByRole('tooltip').textContent).toContain(
    'Drag a row by its grip to change the order the app lists categories in.',
  )
})

it('reserves its loaded height while the list is on the wire (2026-09-13 spec §9)', () => {
  vi.mocked(fetchCategories).mockReturnValue(new Promise<CategoryOut[]>(() => {}))
  render(<CategoriesCard />)
  expect((document.querySelector('.settings-ghost') as HTMLElement).dataset.ghostHeight).toBe('695')
})
