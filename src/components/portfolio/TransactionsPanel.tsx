import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from '../../api/portfolio'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import type { SecurityOut, TransactionOut, TransactionType } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { FeedBanner } from '../shell/Feed'
import './portfolio.css'

interface FormState {
  security_id: string
  account: string
  type: TransactionType
  txn_date: string
  shares: string
  price: string
  fees: string
  split_factor: string
  notes: string
}

const EMPTY: FormState = {
  security_id: '', account: '', type: 'buy', txn_date: '',
  shares: '', price: '', fees: '', split_factor: '', notes: '',
}

// PATCH validates the MERGED row, so a type flip must carry the COMPLETE type-appropriate
// shape or the stored other-type fields 422 it (buy→split trips "split rows carry no
// shares/price"; split→buy trips "buy rows carry no split_factor"). Partial flips are
// rejected BY DESIGN — silently zeroing user shares would destroy data (Task 9 review M2
// forward note). The full shape is therefore emitted unconditionally: POST accepts the
// same explicit dummies/nulls, so one builder serves both verbs and no pre-edit type has
// to be tracked.
function toPayload(form: FormState) {
  const base = {
    account: form.account.trim(),
    type: form.type,
    txn_date: form.txn_date || null,
    notes: form.notes.trim() || null,
  }
  if (form.type === 'split') {
    // Plan 1 dummy convention: split rows store shares/price 0 and carry no fees.
    return {
      ...base,
      split_factor: canonicalAmount(form.split_factor, { expressions: false }),
      shares: '0',
      price: '0',
      fees: null,
    }
  }
  return {
    ...base,
    // Every sub-cent column opts out of "=": the evaluator quantizes to 2dp, so a no-blur
    // "=1/8" would be committed as 0.13 where 0.125 was meant. shares is Numeric(16, 6),
    // price Numeric(14, 4) and split_factor Numeric(10, 4) — all finer than the evaluator,
    // all expressionless, each paired with a non-money input kind so the cell cannot
    // evaluate what the belt refuses. fees alone is Numeric(10, 2) and stays money.
    // The text stays verbatim and the server's 422 remains the backstop, exactly as it is
    // for any other garbage.
    shares: canonicalAmount(form.shares, { expressions: false }),
    price: canonicalAmount(form.price, { expressions: false }),
    fees: form.fees.trim() ? canonicalAmount(form.fees) : null,
    split_factor: null,
  }
}

// The row → form seed, shared by Edit and Duplicate: the two differ only in what becomes
// of editingId (an edit PATCHes that row, a duplicate POSTs a new one), never in the seed.
// Split rows deliberately leave shares/price blank — the stored 0/0 are Plan 1's dummy
// convention rather than user data, and toPayload re-emits them on the way out.
function seedFrom(txn: TransactionOut): FormState {
  return {
    security_id: String(txn.security_id),
    account: txn.account,
    type: txn.type,
    txn_date: txn.txn_date ?? '',
    shares: txn.type === 'split' ? '' : txn.shares,
    price: txn.type === 'split' ? '' : txn.price,
    fees: txn.fees ?? '',
    split_factor: txn.split_factor ?? '',
    notes: txn.notes ?? '',
  }
}

// The focus-return DOM protocol (spec §5.1, plan decision 6): AmountInput exposes no ref
// API by design, so the panel addresses its first entry cell through a stable id — the
// same arrangement `data-entry-scope`/`data-entry-cell` use for the keyboard protocol.
// Which id depends on the TYPE: a split form renders a factor where the others render
// shares, so hard-coding one would leave split entry with no focus return at all.
function focusFirstAmount(type: TransactionType): void {
  document.getElementById(type === 'split' ? 'txn-split-factor' : 'txn-shares')?.focus()
}

export default function TransactionsPanel({
  securities,
  transactions,
  onChanged,
}: {
  securities: SecurityOut[]
  transactions: TransactionOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  // True while the form holds a just-saved row's context rather than a blank slate — the
  // one piece of state the carry-forward cue and the submit label read.
  const [kept, setKept] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))
  const toast = useToast()

  // 'type' is excluded: it is a union field with its own dedicated handler below.
  const set = (field: Exclude<keyof FormState, 'type'>) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (txn: TransactionOut) => {
    setEditingId(txn.id)
    // The form now describes ONE stored row, not a run of new ones — the create session,
    // and the cue that narrates it, are over.
    setKept(false)
    setForm(seedFrom(txn))
  }

  const duplicate = (txn: TransactionOut) => {
    // editingId stays null, so the next submit POSTs a NEW row (plan decision 8) — the one
    // difference from Edit. Adding another lot of something already in the ledger is the
    // common case, and re-picking security/account/type/date by hand was its whole cost.
    setEditingId(null)
    setKept(false)
    setForm(seedFrom(txn))
    // Queued, unlike the save path's direct call below: a duplicate can flip the form's
    // TYPE, and the cell the new type renders does not exist until React re-renders.
    // Microtasks run after React's synchronous discrete-event flush — the ordering
    // AmountInput's Escape-reselect already leans on. The save path's focus-before-reset
    // rule has nothing to say here: the click on this button already blurred whatever cell
    // held the caret (and committed it), so this transfer blurs nothing and the microtask
    // runs after the seed has flushed — there is no pre-reset text left to resurrect.
    queueMicrotask(() => focusFirstAmount(txn.type))
  }

  const submit = () => {
    if (!form.security_id || !form.account.trim()) {
      setError('Security and account are required')
      return
    }
    // Type-appropriate numeric guard: an empty string reaches the API as `""`, which
    // 422s as an opaque pydantic decimal-parse error (Task 14 review M2).
    if (form.type === 'split' ? !form.split_factor.trim() : !(form.shares.trim() && form.price.trim())) {
      setError(form.type === 'split' ? 'Split factor is required' : 'Shares and price are required')
      return
    }
    setBusy(true)
    setError(null)
    const payload = toPayload(form)
    const request =
      editingId !== null
        ? updateTransaction(editingId, payload)
        : createTransaction({ ...payload, security_id: Number(form.security_id) })
    request
      .then(() => {
        if (editingId === null) {
          // The next lot starts here — BEFORE the reset, and that order is load-bearing
          // (998f05c's invariant, proven on the paycheck/comp/ESPP panels). This form
          // carries no data-entry-scope, so Enter is the browser's implicit submit and the
          // caret is still sitting in an AmountInput when this lands. Moving it BLURS that
          // box synchronously, and the blur's commit closes over the box's PRE-reset text —
          // canonicalizing a "$1,205.50" into an enqueued write. Focusing first aims that
          // write at the state the clearing update below then replaces; the other order
          // lets it land on the cleared form, where a resurrected price reads exactly like
          // carry-forward and is indistinguishable from it.
          // Direct, no queue: the type is kept, so the cell being focused is already in the
          // DOM and React re-renders it (cleared) around the focus without remounting it.
          focusFirstAmount(form.type)
          // Carry-forward (spec §5.1): a lot is rarely entered alone — the security, the
          // account, the type and the day are the SESSION; only the numbers describing
          // THIS lot are cleared. Functional, so it composes over the blur's write above
          // rather than racing it. `kept` then says so out loud, because a form that keeps
          // its values after a save otherwise reads as a save that never happened.
          setForm((f) => ({ ...f, shares: '', price: '', fees: '', split_factor: '', notes: '' }))
          setKept(true)
        } else {
          // An edit is a one-off correction rather than a session: full reset, create mode
          // back, cue down.
          setForm(EMPTY)
          setEditingId(null)
          setKept(false)
        }
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Save failed')
      })
      .finally(() => setBusy(false))
  }

  const remove = (txn: TransactionOut) => {
    const ticker = tickers.get(txn.security_id) ?? '?'
    // Instant + Undo (2026-08-25 polish §8): the confirm interrupt is gone and the
    // recovery affordance replaces it — Undo re-POSTs the captured row (new id, by
    // design). Only this low-risk flow converts; cascade deletes elsewhere keep confirm.
    // busy for the duration (RsuGrantsPanel's posture): without the confirm dialog to
    // absorb it, a double-click would fire a second DELETE on the same id and drop a 404
    // into the error banner beside the success toast.
    setBusy(true)
    deleteTransaction(txn.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only: a failed delete leaves the row.
        if (txn.id === editingId) {
          setEditingId(null)
          setForm(EMPTY)
        }
        // The ledger just changed under the cue — whatever entry session it narrated is over.
        setKept(false)
        onChanged()
        toast.success(`Deleted the ${ticker} ${txn.type}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              // TransactionOut carries every TransactionCreate field verbatim, split
              // dummies included (toPayload's convention) — POST accepts them as-is.
              createTransaction({
                security_id: txn.security_id,
                account: txn.account,
                type: txn.type,
                txn_date: txn.txn_date,
                shares: txn.shares,
                price: txn.price,
                fees: txn.fees,
                split_factor: txn.split_factor,
                notes: txn.notes,
              })
                .then(() => onChanged())
                .catch(() => toast.error(`Could not restore the ${ticker} ${txn.type}`))
            },
          },
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      })
      .finally(() => setBusy(false))
  }

  return (
    <section className="panel">
      <h2 className="panel-title">
        Transactions
        <InfoHint text="The buy/sell/split ledger every computed figure stands on. Sheet-imported rows are rewritten by re-imports; rows added here are never touched." />
      </h2>
      <p className="hint">
        Rows marked <span className="badge">sheet</span> are owned by the spreadsheet
        importer: a re-import reverts edits to them and resurrects deletions. Rows added
        here are never touched by imports.
      </p>
      <FeedBanner error={error} />
      {kept && (
        // role=status: the cue appears in the same beat the focus jumps into the shares
        // box, so a screen-reader user would otherwise never learn why the form is still
        // full (InputsForm's live-region idiom). No new colors or motion — plain
        // .drill-hint, per decision 7.
        <p className="drill-hint" role="status" aria-live="polite">
          Security, account and date kept — enter the next lot.
        </p>
      )}
      <form
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Security
          <select
            value={form.security_id}
            onChange={(e) => {
              // The cue claims the security was kept; the moment it is changed the
              // sentence stops being true, so it comes down with the change.
              setKept(false)
              set('security_id')(e.target.value)
            }}
            disabled={editingId !== null}
          >
            <option value="">Select…</option>
            {securities.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ticker}
              </option>
            ))}
          </select>
        </label>
        <label>
          Account
          {/* .field-input by hand: the shared chrome used to arrive from `.entry-form input`,
              which is now select-only — every plain text control in this form states it. */}
          <input
            className="field-input"
            value={form.account}
            onChange={(e) => set('account')(e.target.value)}
          />
        </label>
        <label>
          Type
          {/* dedicated handler: `type` is a union, the generic string setter can't write it */}
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TransactionType }))}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="split">Split</option>
          </select>
        </label>
        <label>
          Date
          <input
            className="field-input"
            type="date"
            value={form.txn_date}
            onChange={(e) => set('txn_date')(e.target.value)}
          />
        </label>
        {form.type === 'split' ? (
          <label>
            Factor
            {/* kind="plain": a split factor is a bare ratio — no $ echo, and no
                2dp-quantizing "=" arithmetic on a Numeric(10, 4) column. */}
            <AmountInput
              id="txn-split-factor"
              kind="plain"
              value={form.split_factor}
              onValueChange={set('split_factor')}
            />
          </label>
        ) : (
          <>
            <label>
              Shares
              <AmountInput
                id="txn-shares"
                kind="shares"
                value={form.shares}
                onValueChange={set('shares')}
              />
            </label>
            <label>
              Price
              {/* kind="plain", not money: price is Numeric(14, 4), so the $-echo would
                  render "$123.46" over a stored 123.4567 and hide two digits — and plain
                  also refuses the 2dp "=" evaluator the belt refuses. */}
              <AmountInput kind="plain" value={form.price} onValueChange={set('price')} />
            </label>
            <label>
              Fees
              {/* The one money box here: fees is Numeric(10, 2), so the $-echo is lossless
                  and "=" arithmetic (a sum of commissions) costs no precision. */}
              <AmountInput value={form.fees} onValueChange={set('fees')} />
            </label>
          </>
        )}
        <label className="notes-field">
          Notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {/* The label is the second half of the carry-forward cue: "Add another" is what
                a form still holding the last row's context is actually about to do. */}
            {editingId !== null ? 'Save changes' : kept ? 'Add another' : 'Add transaction'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY)
                setKept(false)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {transactions.length === 0 ? (
        <p className="empty-note">No transactions yet.</p>
      ) : (
        <table className="port-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Account</th><th>Type</th><th>Date</th>
              <th className="num">Shares</th><th className="num">Price</th>
              <th className="num">Fees</th><th>Source</th><th>Notes</th><th />
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{tickers.get(t.security_id) ?? '?'}</td>
                <td>{t.account}</td>
                <td>{t.type === 'split' ? `split ×${t.split_factor ?? '?'}` : t.type}</td>
                <td>{t.txn_date ? formatDate(t.txn_date) : '—'}</td>
                <td className="num">{t.type === 'split' ? '—' : formatShares(t.shares)}</td>
                <td className="num">{t.type === 'split' ? '—' : formatCurrency(t.price)}</td>
                <td className="num">{formatCurrency(t.fees)}</td>
                <td>
                  <span className="badge">{t.source === 'import' ? 'sheet' : 'manual'}</span>
                </td>
                <td className="notes-cell">{t.notes ?? ''}</td>
                {/* disabled={busy} on all three: submit()'s .then closes over editingId and
                    the form as they were when it fired, so a row action taken mid-flight is
                    undone by the reset that lands after it — a seeded edit silently wiped,
                    or worse, a PATCH aimed at whatever editingId the closure still holds.
                    Shutting the row for the duration of a save is the cheap fix. */}
                <td className="row-actions">
                  <button type="button" disabled={busy} onClick={() => startEdit(t)}>Edit</button>
                  {/* aria-label: "Duplicate"/"Delete" alone never say WHAT they act on, and
                      the type is the row's shortest distinguishing word. Delete needs the
                      naming MORE since the delete went instant (2026-08-25 polish §8): the
                      confirm() sentence that used to name the row before anything happened
                      is gone, so the button is the last chance to say it. Edit keeps its
                      bare name — it opens a form showing the row, and changes nothing. */}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Duplicate this ${t.type}`}
                    onClick={() => duplicate(t)}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Delete this ${t.type}`}
                    onClick={() => remove(t)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
