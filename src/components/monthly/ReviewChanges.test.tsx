import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import ReviewChanges from './ReviewChanges'

afterEach(cleanup)
const accounts = [{ id: 1, name: 'Checking', is_component: false }] as AccountOut[]
const categories = [{ id: 2, name: 'Food' }] as CategoryOut[]
const matrix = { months: ['2025-01-01'], series: [{ category_id: 2, values: ['100.00'], budgets: [null] }] } as SpendingMatrix

it('counts blank-to-zero as an entry change and does not show missing input as a measured drop', () => {
  const base = { accounts, categories, priorBalances: { 1: '500.00' }, month: '2025-02-01', monthExisted: true, matrix,
    baseline: JSON.stringify({ balances: { 1: '' }, amounts: { 2: '' }, netPay: '' }) }
  const view = render(<ReviewChanges {...base} balances={{ 1: '' }} amounts={{ 2: '' }} recordedCategories={new Set()} />)
  expect(screen.getByText('No changed balances with a prior-month reference.')).toBeTruthy()
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  // A typed $0.00 for a category with a stored row IS a recorded figure — the save lists it.
  view.rerender(<ReviewChanges {...base} balances={{ 1: '0.00' }} amounts={{ 2: '0.00' }} recordedCategories={new Set([2])} />)
  expect(screen.getByRole('status').textContent).toBe('1 balance · 1 category')
  expect(screen.getByRole('heading', { name: 'Changes since last save' })).toBeTruthy()
  expect(screen.getByText('Food')).toBeTruthy()
  expect(screen.getByText('Checking')).toBeTruthy()
})

// Bug F2 (2026-09-13 audit): the wizard seeds every category at "0.00", so a month mid-entry
// listed nineteen untouched seeds as nineteen −100% "differences".
it('leaves an untouched $0.00 seed out of the spending differences, but compares a recorded zero', () => {
  const base = { accounts, categories, priorBalances: {}, balances: {}, month: '2025-02-01', monthExisted: false, matrix, baseline: null }
  const view = render(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set()} />)
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  expect(screen.queryByText('Food')).toBeNull()
  view.rerender(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set([2])} />)
  expect(screen.getByText('Food')).toBeTruthy()
  expect(screen.getByText('−$100.00')).toBeTruthy()
})

it('names a new month as a snapshot, not as zero changes', () => {
  render(<ReviewChanges accounts={accounts} categories={categories} balances={{}} amounts={{}} priorBalances={{}} baseline={null} month="2025-02-01" matrix={null} monthExisted={false} recordedCategories={new Set()} />)
  expect(screen.getByRole('status').textContent).toBe('New balance snapshot — review the carried-forward balances before confirming.')
  expect(screen.getByText(/Spending references use up to three prior entered months/).className).toContain('review-changes-footer')
})
