import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BudgetPanel from './BudgetPanel'

vi.mock('../../api/spending', () => ({
  putCategoryBudget: vi.fn(),
  deleteCategoryBudget: vi.fn(),
}))

import { deleteCategoryBudget, putCategoryBudget } from '../../api/spending'
import type { SpendingMatrix } from '../../types/api'

const matrix: SpendingMatrix = {
  months: ['2026-01-01', '2026-02-01'],
  categories: [
    { id: 1, name: 'Food', slug: 'food', sort_order: 1, is_active: true, kind: 'living' },
    { id: 2, name: 'Rent', slug: 'rent', sort_order: 2, is_active: true, kind: 'living' },
    { id: 3, name: 'Old', slug: 'old', sort_order: 3, is_active: false, kind: 'living' },
  ],
  series: [
    { category_id: 1, values: ['300.00', '450.00'], budgets: ['400.00', '400.00'] },
    { category_id: 2, values: ['2000.00', '2000.00'], budgets: [null, null] },
    { category_id: 3, values: [null, null], budgets: [null, null] },
  ],
  totals: ['2300.00', '2450.00'],
  net_pay: [null, null],
  savings_rate: [null, null],
  four_pct_rule: [null, null],
  total_budget: ['400.00', '400.00'],
}

const onBudgetsChanged = vi.fn()

beforeEach(() => {
  vi.mocked(putCategoryBudget).mockResolvedValue([
    { effective_month: '2026-03-01', amount: '425.00' },
    { effective_month: '2026-09-01', amount: null },
  ])
  vi.mocked(deleteCategoryBudget).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel(monthIndex: number) {
  return render(
    <BudgetPanel matrix={matrix} monthIndex={monthIndex} onBudgetsChanged={onBudgetsChanged} />,
  )
}

function foodRow(): HTMLElement {
  return screen.getByText('Food').closest('.budget-row') as HTMLElement
}

it('meters a within-budget month: proportional fill, no tick, calm summary', () => {
  renderPanel(0)
  const meter = screen.getByRole('meter', { name: 'Food spend vs budget' })
  expect(meter.getAttribute('aria-valuenow')).toBe('75') // 300 / 400
  expect(meter.getAttribute('aria-valuetext')).toBe('$300.00 of $400.00')
  expect(meter.querySelector('.budget-overflow-tick')).toBeNull()
  expect(within(foodRow()).getByText('$300.00 / $400.00')).toBeDefined()
  expect(screen.getByText('0 of 1 budgeted categories over in Jan 2026')).toBeDefined()
})

it('meters an over month: clamped fill, overflow tick, toned figures, summary counts it', () => {
  renderPanel(1)
  const meter = screen.getByRole('meter', { name: 'Food spend vs budget' })
  expect(meter.getAttribute('aria-valuenow')).toBe('100') // clamp: 450 / 400
  expect(meter.querySelector('.budget-overflow-tick')).not.toBeNull()
  expect(within(foodRow()).getByText('$450.00 / $400.00').className).toContain('delta-negative')
  expect(screen.getByText('1 of 1 budgeted categories over in Feb 2026')).toBeDefined()
})

it('lists unbudgeted ACTIVE categories collapsed, without meters or inactive ones', () => {
  renderPanel(0)
  const collapsed = screen.getByText('No budget — set one (1)').closest('details') as HTMLElement
  expect(within(collapsed).getByText('Rent')).toBeDefined()
  expect(within(collapsed).queryByText('Old')).toBeNull()
  expect(screen.queryByRole('meter', { name: 'Rent spend vs budget' })).toBeNull()
})

it('saves through the PUT (editor defaults to the FOCUSED month) and renders the returned history', async () => {
  renderPanel(0)
  // A5: the default is the month the meters read — matrix.months[monthIndex] — so a first
  // budget saved with the default visibly lands on the meters. (Fixture-dated, so this
  // test no longer depends on the day the suite runs.)
  const monthBox = screen.getByLabelText('Food budget effective from') as HTMLInputElement
  expect(monthBox.value).toBe('2026-01')
  // The amount box prefills with the month's resolved budget.
  const amountBox = screen.getByLabelText('Food budget amount') as HTMLInputElement
  expect(amountBox.value).toBe('$400.00') // AmountInput's blurred echo of '400.00'
  fireEvent.change(amountBox, { target: { value: '425.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await waitFor(() =>
    expect(putCategoryBudget).toHaveBeenCalledWith(1, {
      amount: '425.00',
      effective_month: '2026-01-01',
    }),
  )
  // The response's history renders, null amount reading as the end marker.
  expect(await screen.findByText('Mar 2026 — $425.00')).toBeDefined()
  expect(screen.getByText('Sep 2026 — budget ends')).toBeDefined()
  expect(onBudgetsChanged).toHaveBeenCalled()
  // The re-dating hint is the editor's contract with history (spec §4.2) — since A5 it
  // rides IN the editor's control row, one line, naming the new default.
  expect(screen.getAllByText(/re-writes what that era/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Defaults to Jan 2026/).length).toBeGreaterThan(0)
})

it('follows the focused month when the page drills elsewhere', () => {
  renderPanel(1)
  const monthBox = screen.getByLabelText('Food budget effective from') as HTMLInputElement
  expect(monthBox.value).toBe('2026-02')
  expect(screen.getAllByText(/Defaults to Feb 2026/).length).toBeGreaterThan(0)
})

it('a blank amount saves the null end-marker', async () => {
  renderPanel(0)
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await waitFor(() =>
    expect(putCategoryBudget).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ amount: null }),
    ),
  )
})

it('deletes a history row through the DELETE and drops it from the list', async () => {
  renderPanel(0)
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '425.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await screen.findByText('Mar 2026 — $425.00')
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete the Mar 2026 budget row for Food' }),
  )
  await waitFor(() => expect(deleteCategoryBudget).toHaveBeenCalledWith(1, '2026-03-01'))
  await waitFor(() => expect(screen.queryByText('Mar 2026 — $425.00')).toBeNull())
})

it('rejects a negative amount client-side without calling the API', () => {
  renderPanel(0)
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '-5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  expect(putCategoryBudget).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toMatch(/non-negative/)
})
