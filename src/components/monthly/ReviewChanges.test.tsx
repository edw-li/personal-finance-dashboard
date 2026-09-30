import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import ReviewChanges from './ReviewChanges'

afterEach(cleanup)
const accounts = [{ id: 1, name: 'Checking', is_component: false }, { id: 3, name: 'Brokerage', is_component: false }] as AccountOut[]
const categories = [{ id: 2, name: 'Food' }] as CategoryOut[]
const matrix = { months: ['2025-01-01'], series: [{ category_id: 2, values: ['100.00'], budgets: [null] }] } as SpendingMatrix
const story = (to: Record<number, string> | null, empty = 'No balance changed from Feb 1 to Mar 1.') => ({
  title: 'Largest balance changes · Feb 1 → Mar 1', columns: ['Feb 1', 'Mar 1'] as [string, string],
  from: { 1: '500.00', 3: '900.00' }, to, empty,
})
const base = { accounts, categories, month: '2025-02-01', matrix, pending: null, balanceStory: story(null) }

it('leaves untouched zero seeds out of the insights, but compares a recorded zero', () => {
  const view = render(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set()} />)
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  expect(screen.queryByText('Food')).toBeNull()
  view.rerender(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set([2])} />)
  expect(screen.getByText('Food')).toBeTruthy()
  expect(screen.getByText('−$100.00')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Month-to-month insights' })).toBeTruthy()
})

it('uses saved snapshots in dated insights and omits unchanged balances', () => {
  render(<ReviewChanges {...base} amounts={{}} recordedCategories={new Set()}
    balanceStory={story({ 1: '650.00', 3: '900.00' })} />)
  expect(screen.getByRole('columnheader', { name: 'Feb 1' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'Mar 1' })).toBeTruthy()
  expect(screen.getByText('+$150.00')).toBeTruthy()
  expect(screen.queryByText('Brokerage')).toBeNull()
})

it('says why when there is no next snapshot and never treats missing input as a measured drop', () => {
  render(<ReviewChanges {...base} amounts={{ 2: '' }} recordedCategories={new Set([2])}
    balanceStory={story(null, "February's change appears once Mar 1 balances are recorded")} />)
  expect(screen.getByText("February's change appears once Mar 1 balances are recorded")).toBeTruthy()
  expect(screen.queryByText('−$100.00')).toBeNull()
  expect(screen.getByText(/Spending references use up to three prior entered months/)).toBeTruthy()
})
