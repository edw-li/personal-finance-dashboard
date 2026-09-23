import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type {
  PositionChange,
  SecurityOut,
  TransactionOrderOut,
  TransactionOut,
} from '../../types/api'
import TransactionsPanel from './TransactionsPanel'
import ToastProvider from '../ToastProvider'

vi.mock('../../api/portfolio', () => ({
  createTransaction: vi.fn().mockResolvedValue({}),
  updateTransaction: vi.fn().mockResolvedValue({}),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
  // The replay-order PUT (lane R1). Every reorder test answers it or leaves it pending.
  reorderTransactions: vi.fn(),
}))
import { createTransaction, reorderTransactions, updateTransaction } from '../../api/portfolio'

afterEach(cleanup)
// Call counts are per-test: the "not called" assertion below would otherwise see the
// create from an earlier test. clearAllMocks keeps the factory's mockResolvedValue.
beforeEach(() => vi.clearAllMocks())

const NEW_ACCOUNT_NOTE =
  "New account 'Schwabb' will be created and assigned to Edward — re-tag it in Settings → Accounts"

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
  // 2026-09-09 audit item 27: `resolve_portfolio_account` GET-OR-CREATES on the exact string
  // typed here and tags the new row to the primary person. A typo used to mint a second
  // account under one owner in silence, visible only when the scope chips stopped adding up.
  it('offers the account roster and warns when a typed label would mint a new one', () => {
    render(
      <TransactionsPanel
        securities={securities}
        transactions={[]}
        accounts={['Schwab', 'Joint Taxable']}
        primaryName="Edward"
        onChanged={() => {}}
      />,
    )
    const options = Array.from(document.querySelectorAll('#txn-account-labels option'))
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['Schwab', 'Joint Taxable'])
    const box = screen.getByLabelText('Account')
    // The box announces itself, not the sentence under it.
    expect(box.getAttribute('aria-describedby')).toBeNull()
    fireEvent.change(box, { target: { value: 'Schwab' } })
    expect(screen.queryByText(/will be created/)).toBeNull()
    fireEvent.change(box, { target: { value: 'Schwabb' } })
    expect(screen.getByText(NEW_ACCOUNT_NOTE)).toBeTruthy()
    expect(box.getAttribute('aria-describedby')).toBe('txn-account-note')
    // Trimmed and exact, the way the server matches.
    fireEvent.change(box, { target: { value: '  Schwab  ' } })
    expect(screen.queryByText(/will be created/)).toBeNull()
  })

  it('names the primary member when the household has no name to give', () => {
    render(
      <TransactionsPanel securities={securities} transactions={[]} accounts={[]} onChanged={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'Schwab' } })
    expect(
      screen.getByText(
        "New account 'Schwab' will be created and assigned to the primary member — re-tag it in Settings → Accounts",
      ),
    ).toBeTruthy()
  })

  it('warns about nothing while the roster is unknown', () => {
    // No roster prop at all — the page's own fetch is still in flight, or it failed. An
    // empty list would raise the warning over every account the household already has.
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={() => {}} />)
    const box = screen.getByLabelText('Account')
    fireEvent.change(box, { target: { value: 'Schwab' } })
    expect(screen.queryByText(/will be created/)).toBeNull()
    // ...and no empty list either: a `list` pointing at an empty datalist is a dropdown
    // arrow that opens on nothing.
    expect(document.getElementById('txn-account-labels')).toBeNull()
    expect(box.getAttribute('list')).toBeNull()
  })

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
    const onChanged = vi.fn()
    render(
      <TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={onChanged} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete this buy' }))
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

  it('deletes instantly and Undo re-creates the captured row through the POST', async () => {
    const onChanged = vi.fn()
    render(
      <ToastProvider>
        <TransactionsPanel
          securities={securities}
          transactions={[importTxn]}
          onChanged={onChanged}
        />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete this buy' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // The captured row, re-POSTed field for field — a NEW id is acceptable by design
    // (spec §4 item 8); the split-row '0' dummies would round-trip verbatim the same way.
    await waitFor(() =>
      expect(vi.mocked(createTransaction)).toHaveBeenCalledWith({
        security_id: 1,
        account: 'Schwab',
        type: 'buy',
        txn_date: null,
        shares: '10.000000',
        price: '100.0000',
        fees: null,
        split_factor: null,
        notes: null,
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    // The undo toast is consumed by its own action — waitFor, not a bare assert, because
    // the consumed toast now spends ToastProvider's exit window on screen before it goes.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull())
  })

  it('keeps the ledger in a .holdings-scroll scroller so the sticky row actions can pin (2026-09-13 polish §7)', () => {
    const { container } = render(<TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={() => {}} />)
    const scroller = container.querySelector('.holdings-scroll') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.querySelector('table.port-table')).not.toBeNull()
    expect(scroller.querySelector('td.row-actions')).not.toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete this buy' }))
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    // Still the typed row, not the ledger row's 'Schwab' seed.
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('Robinhood')
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Duplicate this buy' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Delete this buy' }) as HTMLButtonElement).disabled,
    ).toBe(true)
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
    // An edit is a one-off correction, not a session — today's full reset stands. The reset lands
    // in the commit AFTER the PATCH resolves, so it is awaited rather than asserted on the same
    // tick the call was seen (the old shape passed or failed on scheduling luck).
    await waitFor(() =>
      expect((screen.getByLabelText(/security/i) as HTMLSelectElement).value).toBe(''),
    )
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeTruthy()
    expect(screen.queryByText(/kept/i)).toBeNull()
  })
})

// ── Drag to reorder (2026-09-23 drag-to-reorder spec §5) ──────────────────────────────────────
// The ledger's LIST ORDER is the cost-basis replay order, so a drag re-times a trade. Three rows
// over two holdings: NVDA · Schwab ESPP holds a buy and a sell, VOO · RH Joint Taxable one buy.

const LEDGER_SECURITIES: SecurityOut[] = [
  securities[0],
  {
    ...securities[0],
    id: 2,
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    industry: 'Index',
    holding_type: 'etf',
  },
]

const nvdaBuy: TransactionOut = {
  id: 21, security_id: 1, account: 'Schwab ESPP', type: 'buy', txn_date: null,
  shares: '10.000000', price: '100.0000', fees: null, split_factor: null,
  sort_index: 10, source: 'import', notes: null,
}
const vooBuy: TransactionOut = {
  ...nvdaBuy, id: 22, security_id: 2, account: 'RH Joint Taxable',
  shares: '5.000000', price: '400.0000', sort_index: 20,
}
const nvdaSell: TransactionOut = {
  ...nvdaBuy, id: 23, type: 'sell', shares: '4.000000', price: '150.0000', sort_index: 30,
  source: 'ui',
}
const LEDGER = [nvdaBuy, vooBuy, nvdaSell]

// The grips' names (spec §2.4 "Reorder {name}"): ticker, type, account.
const NVDA_BUY = 'NVDA buy, Schwab ESPP'
const VOO_BUY = 'VOO buy, RH Joint Taxable'
const NVDA_SELL = 'NVDA sell, Schwab ESPP'

type PanelProps = ComponentProps<typeof TransactionsPanel>

/** The ledger inside a ToastProvider; `rerender` hands down fresh props the way the page's
 *  reload does. */
function renderLedger(props: Partial<PanelProps> = {}) {
  const onChanged = vi.fn()
  const view = (next: Partial<PanelProps>) => (
    <ToastProvider>
      <TransactionsPanel
        securities={LEDGER_SECURITIES}
        transactions={LEDGER}
        onChanged={onChanged}
        {...props}
        {...next}
      />
    </ToastProvider>
  )
  const utils = render(view({}))
  return { onChanged, rerender: (next: Partial<PanelProps>) => utils.rerender(view(next)) }
}

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
/** The ledger's row ids, top to bottom, as rendered. */
const order = () =>
  [...document.querySelectorAll('tbody tr')].map((row) => row.getAttribute('data-reorder-id'))
/** The reorder live region — ToastProvider's assertive region is not visually hidden. */
const live = () =>
  document.querySelector('.visually-hidden[aria-live="assertive"]')?.textContent ?? ''

/** Every reorder test starts from a PUT that never answers (a test that needs an answer sets
 *  one) and from a jsdom that can "scroll": the keyboard path keeps the lifted row in view with
 *  window.scrollBy, which jsdom only logs as unimplemented. */
function reorderHooks(): void {
  beforeEach(() => {
    vi.mocked(reorderTransactions).mockReset()
    vi.mocked(reorderTransactions).mockReturnValue(new Promise<never>(() => {}))
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
}

describe('TransactionsPanel reorder — the grip column (spec §5)', () => {
  reorderHooks()

  it('puts a grip first in every row, named for the trade, on a reorderable table', () => {
    renderLedger()
    const table = screen.getByRole('table')
    expect(table.className).toBe('port-table reorder-table')
    const headGrip = table.querySelector('thead tr')?.firstElementChild
    expect(headGrip?.className).toBe('reorder-grip-cell')
    expect(headGrip?.getAttribute('aria-hidden')).toBe('true')
    for (const row of table.querySelectorAll('tbody tr')) {
      expect(row.firstElementChild?.className).toBe('reorder-grip-cell')
    }
    expect(
      [...table.querySelectorAll('tbody .reorder-grip')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([`Reorder ${NVDA_BUY}`, `Reorder ${VOO_BUY}`, `Reorder ${NVDA_SELL}`])
    // One description and one live region for the list, both OUTSIDE the table — a <span> is
    // not a valid child of one (lane R0 consumer rule 6).
    const instructions = document.getElementById(
      grip(NVDA_BUY).getAttribute('aria-describedby') ?? '',
    )
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(table.contains(instructions)).toBe(false)
    const regions = document.querySelectorAll('.visually-hidden[aria-live="assertive"]')
    expect(regions).toHaveLength(1)
    expect(table.contains(regions[0])).toBe(false)
  })

  it('says the list is the replay order, and how to change it (spec §8.1)', () => {
    renderLedger()
    expect(screen.getByText(/The list is the order trades are replayed/).textContent).toContain(
      "The list is the order trades are replayed to work out cost basis and gains — with no dates on the rows, it is the ledger's timeline. Drag a row to move a trade earlier or later.",
    )
  })

  it('offers no grip on an empty ledger and a disabled one on a single row (spec §9)', () => {
    const { rerender } = renderLedger({ transactions: [] })
    expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull()
    expect(document.querySelector('.visually-hidden[aria-live="assertive"]')).toBeNull()
    rerender({ transactions: [nvdaBuy] })
    expect((grip(NVDA_BUY) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a drop at once and speaks each step', () => {
    renderLedger()
    grip(NVDA_BUY).focus()
    fireEvent.keyDown(grip(NVDA_BUY), { key: ' ' })
    expect(live()).toBe(`Picked up ${NVDA_BUY}. Position 1 of 3.`)
    fireEvent.keyDown(grip(NVDA_BUY), { key: 'ArrowDown' })
    expect(live()).toBe(`${NVDA_BUY}, position 2 of 3.`)
    fireEvent.keyDown(grip(NVDA_BUY), { key: ' ' })
    expect(order()).toEqual(['22', '21', '23'])
    expect(live()).toBe(`Dropped ${NVDA_BUY} at position 2 of 3.`)
    expect(document.activeElement).toBe(grip(NVDA_BUY))
  })

  it('cancels a lift when the rows under it change — a scope switch — and saves nothing', () => {
    const { rerender } = renderLedger()
    grip(NVDA_BUY).focus()
    fireEvent.keyDown(grip(NVDA_BUY), { key: ' ' })
    fireEvent.keyDown(grip(NVDA_BUY), { key: 'ArrowDown' })
    // The page hands down another scope's rows under the live lift.
    rerender({ transactions: [nvdaBuy, nvdaSell] })
    expect(grip(NVDA_BUY).getAttribute('aria-pressed')).toBeNull()
    expect(order()).toEqual(['21', '23'])
    // Lane R0's data-change cancel: the rows already re-rendered, so there is nothing to ease
    // home, and "back at position …" would name a list that no longer exists.
    expect(live()).toBe('Cancelled — the list changed.')
    expect(reorderTransactions).not.toHaveBeenCalled()
  })

  it('shuts the row buttons while a row is lifted', () => {
    renderLedger()
    const rowButtons = () =>
      [
        ...screen.getAllByRole('button', { name: 'Edit' }),
        ...screen.getAllByRole('button', { name: /^(Duplicate|Delete) this / }),
      ] as HTMLButtonElement[]
    grip(VOO_BUY).focus()
    fireEvent.keyDown(grip(VOO_BUY), { key: ' ' })
    expect(rowButtons().every((button) => button.disabled)).toBe(true)
    fireEvent.keyDown(grip(VOO_BUY), { key: 'Escape' })
    expect(rowButtons().every((button) => !button.disabled)).toBe(true)
    expect(reorderTransactions).not.toHaveBeenCalled()
  })

  it('keeps the grips focusable but inert while any request of the panel is in flight', () => {
    // A create that never settles: busy stays up for the rest of the test.
    vi.mocked(createTransaction).mockReturnValueOnce(new Promise<never>(() => {}))
    renderLedger()
    change(screen.getByLabelText(/security/i), '2')
    change(screen.getByLabelText('Account'), 'RH Joint Taxable')
    change(screen.getByLabelText(/shares/i), '1')
    change(screen.getByLabelText(/price/i), '400')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    const handle = grip(VOO_BUY) as HTMLButtonElement
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    expect(handle.disabled).toBe(false)
    handle.focus()
    fireEvent.keyDown(handle, { key: ' ' })
    expect(live()).toBe('')
    expect(handle.getAttribute('aria-pressed')).toBeNull()
  })
})

/** The keyboard path (spec §2.4): focus the grip, Space lifts, `key` moves one place, Space
 *  drops. */
function keyboardMove(name: string, key: 'ArrowUp' | 'ArrowDown'): void {
  grip(name).focus()
  fireEvent.keyDown(grip(name), { key: ' ' })
  fireEvent.keyDown(grip(name), { key })
  fireEvent.keyDown(grip(name), { key: ' ' })
}

const tableRow = (id: number) =>
  document.querySelector(`tbody tr[data-reorder-id="${id}"]`) as HTMLElement

/** The server's answer to a reorder: the rows it was sent, in that order, and `changes`. */
function answerWith(changes: PositionChange[] = []): void {
  const byId = new Map(LEDGER.map((txn) => [txn.id, txn]))
  vi.mocked(reorderTransactions).mockImplementation(async (ids) => ({
    transactions: ids.flatMap((id) => {
      const txn = byId.get(id)
      return txn === undefined ? [] : [txn]
    }),
    changed_positions: changes,
  }))
}

// Spec §8.1: "Moved the {TICKER} {type}. No holding's figures changed."
const QUIET_VOO = "Moved the VOO buy. No holding's figures changed."
const QUIET_NVDA = "Moved the NVDA buy. No holding's figures changed."

describe('TransactionsPanel reorder — saving the replay order (spec §5)', () => {
  reorderHooks()

  it('saves one drop as one PUT of the visible ids, in the page scope', () => {
    renderLedger({ owner: 2 })
    keyboardMove(NVDA_BUY, 'ArrowDown')
    expect(reorderTransactions).toHaveBeenCalledTimes(1)
    expect(reorderTransactions).toHaveBeenCalledWith([22, 21, 23], 2)
    // Unanswered: the dropped order is on screen already, and every grip stays inert until the
    // server answers — so a second drop cannot race the first (spec §9).
    expect(order()).toEqual(['22', '21', '23'])
    expect(grip(VOO_BUY).getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(grip(NVDA_BUY))
  })

  it('reports a move that changed no figures, flashes the moved row and has the page reload', async () => {
    answerWith()
    const { onChanged } = renderLedger()
    keyboardMove(VOO_BUY, 'ArrowUp')
    expect(await screen.findByText(QUIET_VOO)).toBeTruthy()
    // The household view sends null: the client turns it into no owner param at all.
    expect(reorderTransactions).toHaveBeenCalledWith([22, 21, 23], null)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(tableRow(22).hasAttribute('data-reorder-saved')).toBe(true)
    await waitFor(() => expect(grip(VOO_BUY).getAttribute('aria-disabled')).toBeNull())
  })

  it("keeps the server's order up until the page's next fetch, then shows the page's rows", async () => {
    answerWith()
    const { rerender } = renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown')
    await screen.findByText(QUIET_NVDA)
    await waitFor(() => expect(grip(VOO_BUY).getAttribute('aria-disabled')).toBeNull())
    expect(order()).toEqual(['22', '21', '23'])
    // The page's reload lands — here carrying an order saved elsewhere meanwhile.
    rerender({ transactions: [nvdaSell, vooBuy, nvdaBuy] })
    expect(order()).toEqual(['23', '22', '21'])
  })

  it('never lets a fetch that lands mid-save show over the dropped order', async () => {
    let answer: (value: TransactionOrderOut) => void = () => {}
    vi.mocked(reorderTransactions).mockReturnValueOnce(
      new Promise<TransactionOrderOut>((resolve) => {
        answer = resolve
      }),
    )
    const { rerender } = renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown')
    // A reload that started before the save lands first: the old order, in a fresh array.
    rerender({ transactions: [nvdaBuy, vooBuy, nvdaSell] })
    expect(order()).toEqual(['22', '21', '23'])
    await act(async () => {
      answer({ transactions: [vooBuy, nvdaBuy, nvdaSell], changed_positions: [] })
    })
    expect(order()).toEqual(['22', '21', '23'])
    // The reload the save asked for.
    rerender({ transactions: [vooBuy, nvdaBuy, nvdaSell] })
    expect(order()).toEqual(['22', '21', '23'])
  })
})

/** A holding the server reports as changed — every figure equal unless a case says otherwise. */
function position(over: Partial<PositionChange> = {}): PositionChange {
  return {
    security_id: 1,
    ticker: 'NVDA',
    account: 'Schwab ESPP',
    shares_before: '6.000000',
    shares_after: '6.000000',
    cost_basis_before: '600.00',
    cost_basis_after: '600.00',
    realized_gl_before: '200.00',
    realized_gl_after: '200.00',
    warnings_added: [],
    ...over,
  }
}

const AAPL_JOINT = { security_id: 9, ticker: 'AAPL', account: 'RH Joint Taxable' }
const MSFT_JOINT = { security_id: 10, ticker: 'MSFT', account: 'RH Joint Taxable' }

interface ToastCase {
  what: string
  move: string
  key: 'ArrowUp' | 'ArrowDown'
  changes: PositionChange[]
  text: string
}

// Spec §8.1: "Moved the {TICKER} {type}. {TICKER} at {account}: {figure} {before} → {after}."
// plus " And N more holdings changed." — {figure} is the first of realized gain, cost basis and
// shares that changed; a position that only gained a warning says "{TICKER} at {account} now
// warns: {warning}." The figure named is the MOVED ROW'S OWN holding's (security AND account),
// or the first listed one when the moved row's holding did not change.
const TOAST_CASES: ToastCase[] = [
  {
    what: 'the realized gain first, when it moved',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [
      position({
        realized_gl_after: '600.00',
        cost_basis_after: '1000.00',
        warnings_added: ['txn 23: sell with no held shares'],
      }),
    ],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: realized gain $200.00 → $600.00.',
  },
  {
    what: 'the cost basis when the realized gain held',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [position({ cost_basis_after: '1000.00' })],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP: cost basis $600.00 → $1,000.00.',
  },
  {
    what: 'the shares when only they moved',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [position({ shares_after: '60.000000' })],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP: shares 6 → 60.',
  },
  {
    what: 'a new warning when no figure moved',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [position({ warnings_added: ['txn 23: sell exceeds held shares'] })],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP now warns: txn 23: sell exceeds held shares.',
  },
  {
    what: 'a warning that brings its own full stop, with one stop only',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [position({ warnings_added: ['txn 23: sell with no held shares.'] })],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP now warns: txn 23: sell with no held shares.',
  },
  {
    what: 'a loss as the house formats it',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [position({ realized_gl_before: '-50.00', realized_gl_after: '10.00' })],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: realized gain -$50.00 → $10.00.',
  },
  {
    what: "the moved row's own holding before an earlier-listed one, plus one more",
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [
      position({ ...AAPL_JOINT, realized_gl_after: '75.00' }),
      position({ cost_basis_after: '1000.00' }),
    ],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: cost basis $600.00 → $1,000.00. And 1 more holding changed.',
  },
  {
    what: 'the count of the others, in the plural',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [
      position({ ...AAPL_JOINT, realized_gl_after: '75.00' }),
      position({ ...MSFT_JOINT, shares_after: '7.000000' }),
      position({ realized_gl_after: '600.00' }),
    ],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: realized gain $200.00 → $600.00. And 2 more holdings changed.',
  },
  {
    what: "the first listed holding when the moved row's own did not change",
    move: VOO_BUY,
    key: 'ArrowDown',
    changes: [position({ realized_gl_after: '600.00' })],
    text: 'Moved the VOO buy. NVDA at Schwab ESPP: realized gain $200.00 → $600.00.',
  },
  {
    what: 'the own holding by security AND account, not by ticker alone',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [
      position({ account: 'Schwab RSU', realized_gl_after: '1.00' }),
      position({ cost_basis_after: '1000.00' }),
    ],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP: cost basis $600.00 → $1,000.00. And 1 more holding changed.',
  },
  {
    what: 'a listed holding with nothing to name, plainly',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [position()],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP changed.',
  },
]

describe('TransactionsPanel reorder — what the toast says (spec §8.1)', () => {
  reorderHooks()

  it.each(TOAST_CASES)('names $what', async ({ move, key, changes, text }) => {
    answerWith(changes)
    renderLedger()
    keyboardMove(move, key)
    expect(await screen.findByText(text)).toBeTruthy()
  })
})

// Spec §8.3 — the transactions route's stale sentence (lane R1's contract).
const STALE = 'The transactions changed since this list was loaded — nothing was moved.'

describe('TransactionsPanel reorder — Undo (spec §5)', () => {
  reorderHooks()

  it('re-sends the order that stood before the drop, in its scope, and the reload shows it', async () => {
    answerWith()
    const { onChanged, rerender } = renderLedger({ owner: 'joint' })
    keyboardMove(NVDA_BUY, 'ArrowDown')
    await screen.findByText(QUIET_NVDA)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Order restored')).toBeTruthy()
    expect(vi.mocked(reorderTransactions).mock.calls).toEqual([
      [[22, 21, 23], 'joint'],
      [[21, 22, 23], 'joint'],
    ])
    expect(onChanged).toHaveBeenCalledTimes(2)
    // The page's reload is what puts the rows back on screen.
    rerender({ transactions: [nvdaBuy, vooBuy, nvdaSell] })
    expect(order()).toEqual(['21', '22', '23'])
  })

  it.each([
    {
      status: 500,
      detail: 'Internal Server Error',
      text: "Couldn't restore the order — the server had a problem (HTTP 500).",
      reloads: 1,
    },
    { status: 409, detail: STALE, text: STALE, reloads: 2 },
  ])('says why an Undo was refused ($status), reloading a stale list', async ({ status, detail, text, reloads }) => {
    answerWith()
    const { onChanged } = renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown')
    await screen.findByText(QUIET_NVDA)
    vi.mocked(reorderTransactions).mockRejectedValueOnce(new ApiError(detail, status))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(onChanged).toHaveBeenCalledTimes(reloads)
  })
})
