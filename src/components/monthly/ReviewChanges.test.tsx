import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import ReviewChanges from './ReviewChanges'

afterEach(cleanup)
const accounts = [
  { id: 1, name: 'Checking', is_component: false },
  { id: 3, name: 'Brokerage', is_component: false },
] as AccountOut[]
const categories = [{ id: 2, name: 'Food' }] as CategoryOut[]
const matrix = { months: ['2025-01-01'], series: [{ category_id: 2, values: ['100.00'], budgets: [null] }] } as SpendingMatrix
const story = (to: Record<number, string> | null, empty = 'No balance changed from Feb 1 to Mar 1.') => ({
  title: 'Largest balance changes · Feb 1 → Mar 1',
  columns: ['Feb 1', 'Mar 1'] as [string, string],
  from: { 1: '500.00', 3: '900.00' },
  to,
  empty,
})

it('counts blank-to-zero as an entry change and does not show missing input as a measured drop', () => {
  const base = {
    accounts,
    categories,
    month: '2025-02-01',
    monthExisted: true,
    matrix,
    balanceStory: story(null),
    saved: { balances: { 1: '' }, amounts: { 2: '' } },
  }
  const view = render(<ReviewChanges {...base} balances={{ 1: '' }} amounts={{ 2: '' }} recordedCategories={new Set()} />)
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  // A typed $0.00 for a category with a stored row IS a recorded figure — the save lists it.
  view.rerender(<ReviewChanges {...base} balances={{ 1: '0.00' }} amounts={{ 2: '0.00' }} recordedCategories={new Set([2])} />)
  expect(screen.getByRole('status').textContent).toBe('1 balance · 1 category')
  expect(screen.getByRole('heading', { name: 'Changes since last save' })).toBeTruthy()
  expect(screen.getByText('Food')).toBeTruthy()
})

// Bug F2 (2026-09-13 audit): the wizard seeds every category at "0.00", so a month mid-entry
// listed nineteen untouched seeds as nineteen −100% "differences".
it('leaves an untouched $0.00 seed out of the spending differences, but compares a recorded zero', () => {
  const base = { accounts, categories, balances: {}, month: '2025-02-01', monthExisted: false, matrix, saved: null, balanceStory: story(null) }
  const view = render(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set()} />)
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  expect(screen.queryByText('Food')).toBeNull()
  view.rerender(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set([2])} />)
  expect(screen.getByText('Food')).toBeTruthy()
  expect(screen.getByText('−$100.00')).toBeTruthy()
})

it("compares this 1st's SAVED balances with the next 1st's under a dated heading (2026-09-23 spec §M5)", () => {
  render(
    <ReviewChanges accounts={accounts} categories={categories} balances={{ 1: '999.00' }} amounts={{}} saved={null}
      month="2025-02-01" matrix={null} monthExisted recordedCategories={new Set()}
      balanceStory={story({ 1: '650.00', 3: '900.00' })} />,
  )
  expect(screen.getByRole('heading', { name: 'Largest balance changes · Feb 1 → Mar 1' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'Feb 1' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'Mar 1' })).toBeTruthy()
  // Checking moved 500 → 650 between the saved snapshots; the typed 999.00 is not the story, and
  // Brokerage did not move.
  expect(screen.getByText('+$150.00')).toBeTruthy()
  expect(screen.queryByText('Brokerage')).toBeNull()
})

it('says why when there is no next 1st to compare with', () => {
  render(
    <ReviewChanges accounts={accounts} categories={categories} balances={{}} amounts={{}} saved={null} month="2025-02-01"
      matrix={null} monthExisted recordedCategories={new Set()}
      balanceStory={story(null, "February's change appears once Mar 1 balances are recorded")} />,
  )
  expect(screen.getByText("February's change appears once Mar 1 balances are recorded")).toBeTruthy()
})

it('names a new month as a snapshot, not as zero changes', () => {
  render(
    <ReviewChanges accounts={accounts} categories={categories} balances={{}} amounts={{}} saved={null} month="2025-02-01"
      matrix={null} monthExisted={false} recordedCategories={new Set()} balanceStory={story(null)} />,
  )
  expect(screen.getByRole('status').textContent).toBe(
    'New balance snapshot — review the carried-forward balances before confirming.',
  )
  expect(screen.getByText(/Spending references use up to three prior entered months/).className).toContain(
    'review-changes-footer',
  )
})
