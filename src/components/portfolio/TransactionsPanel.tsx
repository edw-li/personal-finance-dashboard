import { useState } from 'react'
import { ApiError, errorDetail } from '../../api/client'
import {
  createTransaction,
  deleteTransaction,
  reorderTransactions,
  updateTransaction,
} from '../../api/portfolio'
import type { OwnerScope } from '../../api/portfolio'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import { ORDER_RESTORED, clause, orderSaveFailed, undoFailureText } from '../reorder/orderCopy'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useLatest } from '../reorder/useLatest'
import { useReorder } from '../reorder/useReorder'
import { useRequestCount } from '../reorder/useRequestCount'
import { useToast } from '../ToastProvider'
import type { PositionChange, SecurityOut, TransactionOut, TransactionType } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { FeedBanner } from '../shell/Feed'
import HoldingsScroll from './HoldingsScroll'
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

/** The note under an Account box (2026-09-09 audit item 27).
 *
 * `resolve_portfolio_account` GET-OR-CREATES on the exact string typed here and tags a new
 * account to the PRIMARY person — an ownership decision made by a typo, invisible until the
 * scope chips disagree with the holdings. The roster is the same list Settings edits: a
 * label that is not on it is about to become a new account, and the form says so before the
 * save rather than after. Trimmed and exact, because that is how the server matches.
 *
 * Null while the roster is unknown (still loading, or its fetch failed): this is a warning
 * about creating something new, and an empty roster would raise it over every account the
 * household already has. */
function newAccountNote(
  typed: string,
  accounts: string[] | null,
  primaryName: string | null,
): string | null {
  const label = typed.trim()
  if (accounts === null || label === '' || accounts.includes(label)) return null
  return `New account '${label}' will be created and assigned to ${primaryName ?? 'the primary member'} — re-tag it in Settings → Accounts`
}

/** A ledger row's name for its grip and the live region (2026-09-23 drag-to-reorder spec §2.4):
 *  ticker, type and account — "NVDA buy, Schwab ESPP". Two lots of one holding share a name; the
 *  position the live region speaks after it tells them apart. */
function rowName(txn: TransactionOut, ticker: string): string {
  return `${ticker} ${txn.type}, ${txn.account}`
}

/** A replay order the panel shows ahead of the page's rows, and the owner scope it belongs to —
 *  it shows only while the page shows that scope. */
interface OrderLayer {
  scope: OwnerScope
  rows: TransactionOut[]
}

/** One changed holding, in words (2026-09-23 drag-to-reorder spec §8.1): the FIRST of realized
 *  gain, cost basis and shares that moved — the server's figures, formatted the house way — or,
 *  when only a warning was added, that warning. The server quantizes both sides and never sends
 *  a negative zero, so comparing its strings is comparing its figures; nothing is recomputed. */
function changeSentence(change: PositionChange): string {
  const where = `${change.ticker} at ${change.account}`
  const figures = [
    {
      name: 'realized gain',
      before: change.realized_gl_before,
      after: change.realized_gl_after,
      format: formatCurrency,
    },
    {
      name: 'cost basis',
      before: change.cost_basis_before,
      after: change.cost_basis_after,
      format: formatCurrency,
    },
    { name: 'shares', before: change.shares_before, after: change.shares_after, format: formatShares },
  ]
  const figure = figures.find((candidate) => candidate.before !== candidate.after)
  if (figure !== undefined) {
    return `${where}: ${figure.name} ${figure.format(figure.before)} → ${figure.format(figure.after)}.`
  }
  if (change.warnings_added.length > 0) {
    return `${where} now warns: ${clause(change.warnings_added[0])}.`
  }
  // The contract lists a holding only when one of the above moved; said plainly if it ever
  // does not.
  return `${where} changed.`
}

/** The success toast (spec §8.1). The list order IS the replay order, so the toast says what
 *  the move did to the book: nothing, or the moved row's OWN holding (security and account —
 *  the fold's position key; the first listed holding when its own did not change), plus a count
 *  of the rest. */
function movedMessage(
  txn: TransactionOut,
  ticker: string,
  changes: readonly PositionChange[],
): string {
  const head = `Moved the ${ticker} ${txn.type}.`
  if (changes.length === 0) return `${head} No holding's figures changed.`
  const own =
    changes.find(
      (change) => change.security_id === txn.security_id && change.account === txn.account,
    ) ?? changes[0]
  const others = changes.length - 1
  const tail =
    others === 0 ? '' : ` And ${others} more ${others === 1 ? 'holding' : 'holdings'} changed.`
  return `${head} ${changeSentence(own)}${tail}`
}

export default function TransactionsPanel({
  securities,
  transactions,
  accounts = null,
  primaryName = null,
  owner = null,
  reloading = false,
  onChanged,
}: {
  securities: SecurityOut[]
  transactions: TransactionOut[]
  /** The household's existing portfolio account labels, for the Account box's datalist and
   *  its "this one is new" note (2026-09-09 audit item 27). Null — the default — is "the
   *  roster is unknown", which offers no completions and warns about nothing; the page
   *  passes it while its own fetch is in flight or after that fetch failed. */
  accounts?: string[] | null
  /** Who a NEW account would be assigned to, for that note; null falls back to a
   *  description rather than inventing a name. */
  primaryName?: string | null
  /** The page's owner scope — the value `fetchTransactions` was given for `transactions`
   *  (2026-09-23 drag-to-reorder spec §5). A reorder is saved in it: the server checks the ids
   *  against exactly the rows this scope lists and moves them among their own slots. Null is
   *  the whole household. */
  owner?: OwnerScope
  /** True while the page revalidates what it shows — a scope painted from cache, the reload
   *  after a change (PortfolioPage's `reloading`, the frame's dim). The grips go inert: a drop
   *  in that window could save an order the landing rows replace. */
  reloading?: boolean
  onChanged: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  // True while the form holds a just-saved row's context rather than a blank slate — the
  // one piece of state the carry-forward cue and the submit label read.
  const [kept, setKept] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Requests in flight — counted, not flagged: they overlap (a later drop's save and an earlier
  // toast's Undo), and the first to settle must not reopen the grips and the row buttons while
  // another is still running. `busy` is what every control reads.
  const { busy, track } = useRequestCount()
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))
  const toast = useToast()
  // The page's reload AS IT STANDS NOW, for every request's answer: `onChanged` closes over the
  // page's scope, so a save, delete or Undo that answers after a scope switch must not call the
  // one from the render that sent it — that refetches the OLD scope, supersedes the new scope's
  // load and paints the whole page with the old scope under the new chips.
  const onChangedRef = useLatest(onChanged)
  const accountNote = newAccountNote(form.account, accounts, primaryName)
  const tickerOf = (txn: TransactionOut) => tickers.get(txn.security_id) ?? '?'

  // Drag to reorder (2026-09-23 drag-to-reorder spec §5). The LIST ORDER is the cost-basis
  // replay order — the rows carry no dates, so their order is the ledger's timeline and a drag
  // re-times a trade. Two layers sit over the page's rows, and only this panel's own reorder
  // requests set either:
  //   pendingOrder — the dropped order, from the moment the grip lets go until the PUT answers
  //                  (optimistic), cleared either way when it does;
  //   savedOrder   — the server's answer to the last drop or Undo, until the page's next fetch
  //                  replaces `transactions` (retired during render — CategoriesPanel's
  //                  adjust-during-render pattern, no effect, so react-hooks/set-state-in-effect
  //                  stays clean).
  // So a fetch that lands mid-save never flashes the row back to where it came from, and a
  // failed save falls back to the newest order the server confirmed. The server's answer, not
  // the page's reload, is what the panel trusts after a request: PortfolioPage hands down no new
  // `transactions` when a reload matches what it already shows, and an Undo's reload that
  // supersedes the drop's brings back exactly the rows from before the drop. Each layer keeps
  // the scope it was made in and shows only while the page shows that scope, so an answer that
  // lands after a scope switch never paints one scope's rows over another's.
  const [pendingOrder, setPendingOrder] = useState<OrderLayer | null>(null)
  const [savedOrder, setSavedOrder] = useState<OrderLayer | null>(null)
  const [lastTransactions, setLastTransactions] = useState(transactions)
  if (lastTransactions !== transactions) {
    setLastTransactions(transactions)
    setSavedOrder(null)
  }
  const inScope = (layer: OrderLayer | null) =>
    layer !== null && layer.scope === owner ? layer.rows : null
  const rows = inScope(pendingOrder) ?? inScope(savedOrder) ?? transactions
  const rowById = new Map(rows.map((txn) => [txn.id, txn]))

  // Undo re-sends the order that stood before the drop (spec §5): the endpoint is not
  // change-logged, so the client holds the previous order — and the scope it was made in. Not
  // optimistic: the restored order shows once the server confirms it, as the saved layer, and
  // the page's reload follows. A list that changed since answers 409 and the reload shows what
  // is there now. A refusal is the server's own sentence (§8.1).
  const restoreOrder = (ids: number[], scope: OwnerScope) => {
    // Two-argument then, as in saveOrder: only the request's own failure is a failed restore.
    void track(() =>
      reorderTransactions(ids, scope).then(
        (result) => {
          // The page reloads BEFORE the answer is read: the order is restored whatever the answer
          // holds, so a malformed one still brings the holdings back up to date (saveOrder's rule).
          onChangedRef.current()
          setSavedOrder({ scope, rows: result.transactions })
          toast.info(ORDER_RESTORED)
        },
        (err: unknown) => {
          toast.error(undoFailureText(err))
          if (err instanceof ApiError && err.status === 409) onChangedRef.current()
        },
      ),
    )
  }

  // One drop, one PUT (spec §5): the visible ids in their new order, in the page's scope. The
  // server re-times the whole ledger, folds it before and after, and answers with the rows and
  // every holding whose figures moved. `reorder` is read only when the PUT answers, long after
  // the render that declares it below has returned.
  const saveOrder = (next: number[], moved: number) => {
    const txn = rowById.get(moved)
    if (txn === undefined) return // the hook commits only ids it was handed
    const previous = rows.map((row) => row.id)
    const scope = owner
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder({
      scope,
      rows: next.flatMap((id) => {
        const row = rowById.get(id)
        return row === undefined ? [] : [row]
      }),
    })
    // Two-argument then: only the request's own failure reaches the failure branch. A throw
    // while wording the success (a malformed answer) escapes as an error instead of printing
    // "back to how it was" over the order the server just saved.
    void track(() =>
      reorderTransactions(next, scope).then(
        (result) => {
          setPendingOrder(null)
          // Holdings, realized gains and the tiles stand on this order: the page reloads them —
          // BEFORE the answer is read, since the order is saved whatever the answer holds, so a
          // malformed one (no rows, no figures) still reloads (lane R3's review).
          onChangedRef.current()
          setSavedOrder({ scope, rows: result.transactions })
          reorder.markSaved(moved)
          toast.success(movedMessage(txn, tickerOf(txn), result.changed_positions), {
            action: { label: 'Undo', onAction: () => restoreOrder(previous, scope) },
          })
        },
        (err: unknown) => {
          // A failed save puts the rows back (spec §5, as §4.1) — to the newest order the server
          // confirmed. Reverting an upward move re-inserts the dropped row, and a moved node loses
          // focus; React DOM's commit re-focuses whatever held focus before its DOM moves, so the
          // keyboard reader's grip keeps it without a hand-back here.
          setPendingOrder(null)
          if (err instanceof ApiError && err.status === 409) {
            // The server's sentence says what happened; the reload shows the rows it means.
            toast.error(errorDetail(err))
            onChangedRef.current()
            return
          }
          toast.error(orderSaveFailed(errorDetail(err)))
        },
      ),
    )
  }

  const reorder = useReorder({
    items: rows.map((txn) => ({ id: txn.id })),
    labelOf: (id) => {
      const txn = rowById.get(id)
      return txn === undefined ? 'this transaction' : rowName(txn, tickerOf(txn))
    },
    // Any request of the panel in flight — a save, a delete, a reorder — leaves the grips
    // focusable but inert (lane R0 consumer rule 4), so a second drop cannot race the first; so
    // does the page revalidating the rows, so a drop never saves an order about to be replaced.
    disabled: busy || reloading,
    onCommit: saveOrder,
  })

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
    setError(null)
    const payload = toPayload(form)
    const request =
      editingId !== null
        ? updateTransaction(editingId, payload)
        : createTransaction({ ...payload, security_id: Number(form.security_id) })
    void track(() =>
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
          onChangedRef.current()
        })
        .catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Save failed')
        }),
    )
  }

  const remove = (txn: TransactionOut) => {
    const ticker = tickerOf(txn)
    // Instant + Undo (2026-08-25 polish §8): the confirm interrupt is gone and the
    // recovery affordance replaces it — Undo re-POSTs the captured row (new id, by
    // design). Only this low-risk flow converts; cascade deletes elsewhere keep confirm.
    // busy for the duration (RsuGrantsPanel's posture): without the confirm dialog to
    // absorb it, a double-click would fire a second DELETE on the same id and drop a 404
    // into the error banner beside the success toast.
    void track(() =>
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
          onChangedRef.current()
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
                  .then(() => onChangedRef.current())
                  .catch(() => toast.error(`Could not restore the ${ticker} ${txn.type}`))
              },
            },
          })
        })
        .catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Delete failed')
        }),
    )
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Transactions
        <InfoHint text="The buy/sell/split ledger every computed figure stands on. Sheet-imported rows are rewritten by re-imports; rows added here are never touched." />
      </h2>
      <p className="hint">
        Rows marked <span className="badge">sheet</span> are owned by the spreadsheet
        importer: a re-import reverts edits to them and resurrects deletions. Rows added
        here are never touched by imports. The list is the order trades are replayed to work
        out cost basis and gains — with no dates on the rows, it is the ledger's timeline.
        Drag a row to move a trade earlier or later.
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
            list={accounts === null ? undefined : 'txn-account-labels'}
            // The box announces "Account" whatever the note below says: a describedby, never
            // part of the name — a wrapping label would have read the whole sentence out.
            aria-label="Account"
            aria-describedby={accountNote === null ? undefined : 'txn-account-note'}
            value={form.account}
            onChange={(e) => set('account')(e.target.value)}
          />
          {/* Completions, not a fence: a genuinely new account is a legal thing to type, so
              the box stays free text and the note below owns the consequence. No roster, no
              list at all — an empty one is a dropdown arrow that opens on nothing. */}
          {accounts !== null && (
            <datalist id="txn-account-labels">
              {accounts.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          )}
          {accountNote !== null && (
            <p className="hint" id="txn-account-note">
              {accountNote}
            </p>
          )}
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
      {rows.length === 0 ? (
        <p className="empty-note">No transactions yet.</p>
      ) : (
        <>
          {/* Once per list and outside the table — a <span> is not a valid child of one (lane R0
              consumer rule 6). Every grip points its aria-describedby at the instructions. */}
          <ReorderInstructions id={reorder.instructionsId} />
          <ReorderLiveRegion text={reorder.announcement} />
          <HoldingsScroll><table className="port-table reorder-table">
            <thead>
              <tr>
                <th className="reorder-grip-cell" aria-hidden="true" />
                <th>Ticker</th><th>Account</th><th>Type</th><th>Date</th>
                <th className="num">Shares</th><th className="num">Price</th>
                <th className="num">Fees</th><th>Source</th><th>Notes</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} {...reorder.itemProps(t.id)}>
                  <td className="reorder-grip-cell">
                    <DragHandle name={rowName(t, tickerOf(t))} {...reorder.handleProps(t.id)} />
                  </td>
                  <td>{tickerOf(t)}</td>
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
                      Shutting the row for the duration of a save is the cheap fix. Shut while a
                      row is lifted too (lane R0 consumer rule 5): a click mid-drag would act on
                      a row that is about to move. */}
                  <td className="row-actions">
                    <button type="button" disabled={busy || reorder.active} onClick={() => startEdit(t)}>Edit</button>
                    {/* aria-label: "Duplicate"/"Delete" alone never say WHAT they act on, and
                        the type is the row's shortest distinguishing word. Delete needs the
                        naming MORE since the delete went instant (2026-08-25 polish §8): the
                        confirm() sentence that used to name the row before anything happened
                        is gone, so the button is the last chance to say it. Edit keeps its
                        bare name — it opens a form showing the row, and changes nothing. */}
                    <button
                      type="button"
                      disabled={busy || reorder.active}
                      aria-label={`Duplicate this ${t.type}`}
                      onClick={() => duplicate(t)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      disabled={busy || reorder.active}
                      aria-label={`Delete this ${t.type}`}
                      onClick={() => remove(t)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></HoldingsScroll>
        </>
      )}
    </section>
  )
}
