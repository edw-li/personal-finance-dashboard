import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import ReviewChanges from './ReviewChanges'

afterEach(cleanup)
const accounts = [{ id: 1, name: 'Checking', is_component: false }] as AccountOut[]
const categories = [{ id: 2, name: 'Food' }] as CategoryOut[]
it('counts blank-to-zero as an entry change and does not show missing input as a measured drop', () => {
  const matrix = { months: ['2025-01-01'], series: [{ category_id: 2, values: ['100.00'], budgets: [null] }] } as SpendingMatrix
  const base = { accounts, categories, priorBalances: { 1: '500.00' }, month: '2025-02-01', monthExisted: true, matrix,
    baseline: JSON.stringify({ balances: { 1: '' }, amounts: { 2: '' }, netPay: '' }) }
  const view = render(<ReviewChanges {...base} balances={{ 1: '' }} amounts={{ 2: '' }} />)
  expect(screen.getByText('No changed balances with a prior-month reference.')).toBeTruthy()
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  view.rerender(<ReviewChanges {...base} balances={{ 1: '0.00' }} amounts={{ 2: '0.00' }} />)
  expect(screen.getByRole('status').textContent).toContain('1 account balances and 1 categories changed')
  expect(screen.getByText('Food')).toBeTruthy()
  expect(screen.getByText('Checking')).toBeTruthy()
})
