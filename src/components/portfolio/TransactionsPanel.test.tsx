import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecurityOut, TransactionOut } from '../../types/api'
import TransactionsPanel from './TransactionsPanel'

vi.mock('../../api/portfolio', () => ({
  createTransaction: vi.fn().mockResolvedValue({}),
  updateTransaction: vi.fn().mockResolvedValue({}),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
}))
import { createTransaction } from '../../api/portfolio'

afterEach(cleanup)
// Call counts are per-test: the "not called" assertion below would otherwise see the
// create from an earlier test. clearAllMocks keeps the factory's mockResolvedValue.
beforeEach(() => vi.clearAllMocks())

const securities: SecurityOut[] = [{
  id: 1, ticker: 'NVDA', name: 'NVIDIA', industry: 'Semis', holding_type: 'stock',
  is_manual_priced: false, is_active: true, annual_dividend: null, ex_div_date: null,
}]

const importTxn: TransactionOut = {
  id: 7, security_id: 1, account: 'Schwab', type: 'buy', txn_date: null,
  shares: '10.000000', price: '100.0000', fees: null, split_factor: null,
  sort_index: 20, source: 'import', notes: null,
}

// fireEvent, not user-event: @testing-library/user-event is not a devDependency here
// (plan Task 13 sanctions this substitution; zero lockfile churn). Same reason there are
// no jest-dom matchers — getBy* throws when absent, so it carries the presence assertion.
function change(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } })
}

describe('TransactionsPanel', () => {
  it('marks import-owned rows and shows the re-import caveat', () => {
    render(
      <TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={() => {}} />,
    )
    // Scoped to the table: the hint's legend badge carries the same word, so an
    // unscoped getByText('sheet') matches two nodes and throws.
    expect(within(screen.getByRole('table')).getByText('sheet')).toBeTruthy()
    expect(screen.getByText(/re-import/i)).toBeTruthy()
  })

  it('split type swaps shares/price inputs for a factor input', () => {
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={() => {}} />)
    expect(screen.getByLabelText(/shares/i)).toBeTruthy()
    change(screen.getByLabelText(/type/i), 'split')
    expect(screen.queryByLabelText(/shares/i)).toBeNull()
    expect(screen.getByLabelText(/factor/i)).toBeTruthy()
  })

  it('submits a buy with the typed values and calls onChanged', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    // The plan's snippet skipped the security select; submit() refuses without it, so
    // the security_id assertion below needs the selection to happen.
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/shares/i), '2')
    change(screen.getByLabelText(/price/i), '150')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createTransaction).mock.calls[0][0]).toMatchObject({
      security_id: 1, account: 'Robinhood', type: 'buy', shares: '2', price: '150',
    })
  })

  it('deleting the row being edited resets the form', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onChanged = vi.fn()
    render(
      <TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={onChanged} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Back to create mode: a stale editingId would PATCH the deleted id on the next save.
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
  })

  it('split without a factor is refused client-side', () => {
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={() => {}} />)
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/type/i), 'split')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    expect(screen.getByText(/split factor is required/i)).toBeTruthy()
    expect(createTransaction).not.toHaveBeenCalled()
  })
})
