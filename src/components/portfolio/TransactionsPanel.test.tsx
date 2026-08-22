import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecurityOut, TransactionOut } from '../../types/api'
import TransactionsPanel from './TransactionsPanel'

vi.mock('../../api/portfolio', () => ({
  createTransaction: vi.fn().mockResolvedValue({}),
  updateTransaction: vi.fn().mockResolvedValue({}),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
}))
import { createTransaction, updateTransaction } from '../../api/portfolio'

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

// A split row's stored shape: the Plan 1 dummy convention (shares/price 0, no fees) plus
// the factor that actually carries the event.
const splitTxn: TransactionOut = {
  ...importTxn, id: 9, type: 'split', shares: '0.000000', price: '0.0000',
  split_factor: '10.0000',
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

// Spec §5.1: entering a lot is a SESSION — several lots of the same security, in the same
// account, on the same day. The context therefore survives the save and only the
// per-lot numbers are cleared.
describe('TransactionsPanel entry session', () => {
  function addOneBuy(): void {
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/date/i), '2026-08-03')
    change(screen.getByLabelText(/shares/i), '2')
    change(screen.getByLabelText(/price/i), '150')
    change(screen.getByLabelText(/fees/i), '1')
    change(screen.getByLabelText(/notes/i), 'first lot')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
  }

  it('keeps security/account/type/date after an add, clears the numbers, focuses shares', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    addOneBuy()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // The context the next lot shares, still standing…
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).value).toBe('1')
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('Robinhood')
    expect((screen.getByLabelText(/type/i) as HTMLSelectElement).value).toBe('buy')
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('2026-08-03')
    // …and everything that describes the LOT, gone.
    const shares = screen.getByLabelText(/shares/i) as HTMLInputElement
    expect(shares.value).toBe('')
    expect((screen.getByLabelText(/price/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/fees/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).value).toBe('')
    // The DOM-protocol focus return (decision 6): the caret is already in the first cleared
    // cell, so the next lot is pure typing. Real .focus() moves activeElement in jsdom.
    expect(document.activeElement).toBe(shares)
    // The cue that the form is not blank by accident (decision 7).
    expect(screen.getByRole('button', { name: /add another/i })).toBeTruthy()
    expect(screen.getByText(/security, account and date kept/i)).toBeTruthy()
  })

  it('never resurrects the pre-reset text when the caret was still in a numeric box', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/shares/i), '2')
    // A REAL focus, not fireEvent.focus: only this moves jsdom's activeElement, and where
    // the caret sits when the save lands is the whole subject here. This form carries no
    // data-entry-scope, so Enter is the browser's implicit submit and leaves the caret
    // exactly here — and jsdom's click does not move focus either, so the click below
    // models that Enter faithfully.
    const price = screen.getByLabelText(/price/i) as HTMLInputElement
    act(() => price.focus())
    change(price, '$1,205.50')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/shares/i)))
    // The focus transfer BLURS the price box synchronously, and its onBlur commit closes
    // over the box's PRE-reset "$1,205.50" — canonicalizing it into an enqueued write.
    // Focusing AFTER the carry-forward reset lets that write land on top of the cleared
    // box and resurrect the lot just saved: the next Add another would ship a price the
    // user never typed for it, indistinguishable from carry-forward (998f05c's invariant,
    // proven on the paycheck/comp/ESPP panels).
    expect(price.value).toBe('')
  })

  it('carries a split session forward onto the factor box', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/type/i), 'split')
    change(screen.getByLabelText(/factor/i), '4')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // A split form renders no shares box at all, so the focus return has to name the field
    // this type actually starts on — decision 6 is "the FIRST entry field", not "shares".
    const factor = screen.getByLabelText(/factor/i) as HTMLInputElement
    expect(factor.value).toBe('')
    expect(document.activeElement).toBe(factor)
  })

  it('duplicates a row into a fresh POST — never a PATCH of the source', async () => {
    const onChanged = vi.fn()
    render(
      <TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={onChanged} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate this buy' }))
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('Schwab')
    // The focus is queued: React must render the seeded form (a duplicate can flip the
    // type, and with it which numeric boxes exist) before the id can be found — the
    // queueMicrotask idiom AmountInput's Escape-reselect already relies on.
    const shares = screen.getByLabelText(/shares/i) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(shares))
    // Focused, so the box shows the raw seed rather than the shares echo.
    expect(shares.value).toBe('10.000000')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // The whole point: editingId stayed null, so this is a NEW row, not an edit of id 7.
    expect(updateTransaction).not.toHaveBeenCalled()
    expect(vi.mocked(createTransaction).mock.calls[0][0]).toMatchObject({
      security_id: 1, account: 'Schwab', type: 'buy',
      shares: '10.000000', price: '100.0000', fees: null, split_factor: null,
    })
  })

  it('duplicates a split with its factor and no shares/price', async () => {
    const onChanged = vi.fn()
    render(
      <TransactionsPanel securities={securities} transactions={[splitTxn]} onChanged={onChanged} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate this split' }))
    const factor = screen.getByLabelText(/factor/i) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(factor))
    expect(factor.value).toBe('10.0000')
    // The stored 0/0 dummies are NOT seeded back into shares/price (startEdit's rule): the
    // payload builder re-emits them, and a split form has nowhere to put them anyway.
    expect(screen.queryByLabelText(/shares/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createTransaction).mock.calls[0][0]).toMatchObject({
      security_id: 1, type: 'split', split_factor: '10.0000', shares: '0', price: '0', fees: null,
    })
  })

  it('drops the kept cue when the security changes', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    addOneBuy()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.getByText(/security, account and date kept/i)).toBeTruthy()
    // The cue names the security as kept; the moment it is changed the sentence is a lie.
    change(screen.getByLabelText(/security/i), '')
    expect(screen.queryByText(/kept/i)).toBeNull()
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeTruthy()
  })

  it('keeps the cue and every typed value when the NEXT add fails', async () => {
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    addOneBuy()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    vi.mocked(createTransaction).mockRejectedValueOnce(new Error('network'))
    change(screen.getByLabelText(/shares/i), '3')
    change(screen.getByLabelText(/price/i), '151')
    fireEvent.click(screen.getByRole('button', { name: /add another/i }))
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy())
    // Nothing reached the ledger, so nothing is cleared and nothing is re-narrated: the cue
    // still describes the form truthfully (the kept context is the FIRST add's and is still
    // standing), and the numbers just typed survive for the retry. A cue that vanished on
    // failure would read as "your session ended" over a form that still holds it.
    expect(screen.getByText(/security, account and date kept/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /add another/i })).toBeTruthy()
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('Robinhood')
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('2026-08-03')
    expect((screen.getByLabelText(/shares/i) as HTMLInputElement).value).toBe('3')
  })

  it('gates the row actions while a save is in flight', () => {
    // A create that never settles: busy stays true for the rest of the test.
    vi.mocked(createTransaction).mockReturnValueOnce(new Promise<never>(() => {}))
    render(
      <TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={() => {}} />,
    )
    change(screen.getByLabelText(/security/i), '1')
    change(screen.getByLabelText(/account/i), 'Robinhood')
    change(screen.getByLabelText(/shares/i), '2')
    change(screen.getByLabelText(/price/i), '150')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    // The in-flight save's .then closes over editingId as it was at SUBMIT time, so a
    // mid-flight Edit would have its seed wiped by the reset that lands afterwards (and a
    // mid-flight Duplicate the same) — the row buttons are simply shut for the duration.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate this buy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    // Still the typed row, not the ledger row's 'Schwab' seed.
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('Robinhood')
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Duplicate this buy' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a successful edit still resets the whole form — carry-forward is create-only', async () => {
    const onChanged = vi.fn()
    render(
      <TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={onChanged} />,
    )
    addOneBuy()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /add another/i })).toBeTruthy()
    // Entering edit mode ends the create session: the form now describes ONE stored row.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText(/kept/i)).toBeNull()
    change(screen.getByLabelText(/shares/i), '11')
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(updateTransaction).toHaveBeenCalled())
    // An edit is a one-off correction, not a session — today's full reset stands.
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeTruthy()
    expect(screen.queryByText(/kept/i)).toBeNull()
  })
})
