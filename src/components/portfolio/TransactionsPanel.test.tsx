import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// price is Numeric(14, 4): a stored price really can carry four decimals, which is the
// precision the box must not round away.
const fourDpTxn: TransactionOut = { ...importTxn, id: 8, price: '123.4567' }

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

  it('canonicalizes the wire body with no blur, and leaves blank fees null', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/shares/i), '10')
    change(screen.getByLabelText(/price/i), '$1,205.50')
    // No blur is ever fired here — a mouse user who types and clicks Save produces exactly
    // this sequence, so the payload BELT (canonicalAmount in toPayload), not AmountInput's
    // blur commit, is what keeps "$1,205.50" out of a Decimal column.
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createTransaction).mock.calls[0][0]).toMatchObject({
      shares: '10', price: '1205.50', fees: null, split_factor: null,
    })
  })

  it('ships an =-expression typed into shares verbatim — the belt never evaluates it', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/shares/i), '=5*2')
    change(screen.getByLabelText(/price/i), '150')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // What is pinned is the { expressions: false } contract: shares is a 6dp column and the
    // evaluator quantizes to 2dp, so "=1/8" would silently commit 0.13 where 0.125 was meant.
    // The text therefore travels VERBATIM — it is deliberately NOT '10.00' (the evaluator
    // quantizes, which is the whole reason a 6dp column opts out). The panel still
    // submits it because presence validation only checks non-empty, so this garbage 422s
    // server-side exactly as 'abc' typed into the same field does today; the server error is
    // the backstop, and no client-side evaluation is allowed to invent a number.
    expect(vi.mocked(createTransaction).mock.calls[0][0]).toMatchObject({ shares: '=5*2' })
  })

  it('shows a stored 4dp price verbatim — no lossy 2dp $ echo', () => {
    render(
      <TransactionsPanel securities={securities} transactions={[fourDpTxn]} onChanged={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // price is Numeric(14, 4), so the money echo would render "$123.46" over a stored
    // 123.4567 and hide two digits. kind="plain" keeps the seed readable as stored — the
    // same rule SecuritiesPanel's manual price and annual dividend already follow.
    expect((screen.getByLabelText(/price/i) as HTMLInputElement).value).toBe('123.4567')
  })

  it('never evaluates an =-expression in price — cell AND belt refuse', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/shares/i), '3')
    const price = screen.getByLabelText(/price/i) as HTMLInputElement
    // A REAL focus/blur cycle, which a payload-only pin cannot reach: on a money kind the
    // CELL commits the evaluator's 2dp '400.00' into state on blur and the belt then ships
    // that verbatim — the evaluation happening anyway through the input side. kind="plain"
    // is what closes it, so both halves are asserted (SecuritiesPanel's =-pin, mirrored).
    act(() => price.focus())
    change(price, '=1200/3')
    act(() => price.blur())
    expect(price.value).toBe('=1200/3') // the cell did not evaluate
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // …and neither did the belt. 1200/3 is exactly 400 here, but the evaluator quantizes
    // every result to 2dp, so letting it near a 4dp column is the bug regardless of this
    // one expression's arithmetic. Verbatim text, server 422 as the backstop.
    expect(vi.mocked(createTransaction).mock.calls[0][0]).toMatchObject({ price: '=1200/3' })
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
