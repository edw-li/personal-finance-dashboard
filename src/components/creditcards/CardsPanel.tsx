import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ApiError, errorDetail } from '../../api/client'
import {
  createCreditCard,
  deleteCreditCard,
  reorderCreditCards,
  updateCreditCard,
  updateCreditCardLogged,
} from '../../api/creditCards'
import { undoBatch } from '../../api/lifecycle'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'
import { useDeleteWithUndo } from '../feedback/useDeleteWithUndo'
import { flashElement, revealEditor, revealRow, useEscapeCancel } from '../feedback/reveal'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import {
  ORDER_RESTORED,
  movedToast,
  orderSaveFailed,
  staleListText,
  undoFailureText,
} from '../reorder/orderCopy'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useLatest } from '../reorder/useLatest'
import { useReorder } from '../reorder/useReorder'
import { useRequestCount } from '../reorder/useRequestCount'
import { useToast } from '../ToastProvider'
import type {
  AccountOut,
  CreditCardIn,
  CreditCardOut,
  PersonOut,
  RewardsCurrency,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate } from '../../utils/format'
import { FeedBanner } from '../shell/Feed'
import './roster.css'

const CURRENCIES: RewardsCurrency[] = ['cash', 'points', 'miles']

interface CardFormState {
  name: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  /** '' = Joint; OWNER_UNSET = untouched, so a fresh form FOLLOWS the primary person. */
  person_id: string
  point_value_cents: string
  authorized_users: string
  opened_on: string
  account_id: string // '' = none; select values are strings
  notes: string
}

// A fresh form's owner box has not been chosen yet and must default to the primary person
// once /household lands — but '' is a REAL value here (Joint), so "not chosen" needs its
// own token. Without it a slow roster fetch would silently make every new card joint.
const OWNER_UNSET = 'unset'

const EMPTY_CARD: CardFormState = {
  name: '', annual_fee: '', rewards_currency: 'cash', person_id: OWNER_UNSET,
  point_value_cents: '', authorized_users: '', opened_on: '', account_id: '', notes: '',
}

/**
 * Card roster: add/edit form + table. Archive = full-object PATCH flipping is_active
 * (history kept, optimizer ignores it). Batch Undo restores the card and every dependent row.
 */
export default function CardsPanel({
  cards,
  accounts,
  people,
  onChanged,
}: {
  cards: CreditCardOut[]
  accounts: AccountOut[]
  /** Primary first, then by id — the page's ordering, so the select reads like the chips. */
  people: PersonOut[]
  onChanged: () => void | Promise<void>
}) {
  const [form, setForm] = useState<CardFormState>(EMPTY_CARD)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState(EMPTY_CARD)
  const saveState = useSaveState({ dirty: JSON.stringify(form) !== JSON.stringify(baseline) })
  const formRef = useRef<HTMLFormElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const editingRef = useLatest(editingId)
  const deleteWithUndo = useDeleteWithUndo()
  const [rowBusy, setRowBusy] = useState<Set<number>>(new Set())
  const [activeOverrides, setActiveOverrides] = useState<Map<number, boolean>>(new Map())
  const rowFor = (id: number) => document.getElementById(`card-row-${id}`)
  const focusRow = (id: number, flash = false) => {
    const row = rowFor(id)
    if (!row) { formRef.current?.querySelector<HTMLInputElement>('input')?.focus(); return }
    revealRow(row)
    if (flash) flashElement(row)
    row.querySelector<HTMLElement>('[data-row-edit]')?.focus({ preventScroll: true })
  }
  const resetForm = () => {
    // Blur an AmountInput before resetting: its blur commit belongs to the old draft.
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    setEditingId(null)
    setForm(EMPTY_CARD)
    setBaseline(EMPTY_CARD)
    setError(null)
    saveState.clearError()
  }
  const cancelEdit = () => {
    const id = editingRef.current
    resetForm()
    if (id !== null) focusRow(id)
  }
  useEscapeCancel(formRef, cancelEdit, editingId !== null)

  // Requests in flight across the panel — counted, never flagged (lane R3 review): a toast's
  // Undo clicked while a later drop's PUT is out settles on its own, and whichever answers
  // first must not wake the grips while the other is still out. Every request runs through
  // `track`, its whole chain inside.
  const { busy, track } = useRequestCount()
  // The page's onChanged as of the LATEST render: a save or an Undo answers long after the
  // render that sent it — a toast stands for 6 s — and must reload through the page as it is
  // now, never as it was at the drop.
  const onChangedRef = useLatest(onChanged)
  const reload = () => onChangedRef.current()
  const toast = useToast()

  // Drag to reorder (2026-09-23 drag-to-reorder spec §7). Two layers sit over the page's
  // `cards`, and only a reorder sets either:
  //   pendingOrder — the dropped order, from the moment the grip lets go until the PUT
  //                  answers (optimistic), cleared either way when it does;
  //   savedOrder   — the server's answer, until the page's next fetch replaces `cards`
  //                  (retired during render — CategoriesPanel's adjust-during-render
  //                  pattern, no effect, so react-hooks/set-state-in-effect stays clean).
  // So a reload that lands mid-save never flashes a row back to where it came from, and the
  // rows on screen carry the server's renumbered sort_order the moment it answers.
  const [pendingOrder, setPendingOrder] = useState<CreditCardOut[] | null>(null)
  const [savedOrder, setSavedOrder] = useState<CreditCardOut[] | null>(null)
  const [lastCards, setLastCards] = useState(cards)
  if (lastCards !== cards) {
    setLastCards(cards)
    setSavedOrder(null)
  }
  const ordered = (pendingOrder ?? savedOrder ?? cards).map((row) =>
    activeOverrides.has(row.id) ? { ...row, is_active: activeOverrides.get(row.id)! } : row,
  )
  const orderedRef = useLatest(ordered)
  const cardById = new Map(ordered.map((card) => [card.id, card]))

  // A card is paid from a LIABILITY account and nothing else — offering the cash and
  // taxable accounts would only be a way to link the wrong row.
  const liabilityAccounts = accounts.filter((a) => a.group === 'liability')
  // Every account, not just the liability ones: an archived or regrouped account is still
  // the name the stored account_id points at, and the table must not blank it out.
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  // The migration backfilled every existing card to the primary person, so that is what a
  // new one means too until the user says otherwise.
  const defaultOwner = people.find((p) => p.is_primary)
  const ownerValue =
    form.person_id === OWNER_UNSET
      ? defaultOwner === undefined
        ? ''
        : String(defaultOwner.id)
      : form.person_id

  const set = (field: keyof CardFormState) => (value: string) => {
    setError(null)
    saveState.clearError()
    setForm((f) => ({ ...f, [field]: value }))
  }

  const startEdit = (card: CreditCardOut) => {
    const next = {
      name: card.name, annual_fee: card.annual_fee, rewards_currency: card.rewards_currency,
      person_id: card.person_id === null ? '' : String(card.person_id),
      point_value_cents: card.point_value_cents, authorized_users: card.authorized_users ?? '',
      opened_on: card.opened_on ?? '', account_id: card.account_id === null ? '' : String(card.account_id),
      notes: card.notes ?? '',
    }
    flushSync(() => {
      setEditingId(card.id)
      setForm(next)
      setBaseline(next)
      setError(null)
      saveState.clearError()
    })
    revealEditor(formRef.current, '#card-name')
  }

  /** The full-replace body, preserving fields the form doesn't show from the stored row when
   *  editing: is_active always, sort_order on an edit only (a new card names no position). */
  const buildBody = (stored: CreditCardOut | undefined): CreditCardIn | null => {
    const name = form.name.trim()
    if (!name) {
      // An empty string reaches the API as `""` and 422s as an opaque message about a
      // field the user never saw named.
      setError('Card name is required')
      revealEditor(formRef.current, '#card-name')
      return null
    }
    const fee = form.annual_fee.trim()
    if (fee !== '' && (!isAmount(fee, { expressions: false }) || Number(canonicalAmount(fee, { expressions: false })) < 0)) {
      // The server's own sentence. The CANONICAL value is what's compared: Number('$95')
      // is NaN, and NaN < 0 is false — a tolerant entry would slip past a raw comparison.
      setError('annual_fee must be non-negative')
      revealEditor(formRef.current, '#card-annual-fee')
      return null
    }
    const pointValue = form.point_value_cents.trim()
    if (
      pointValue !== '' &&
      (!isAmount(pointValue, { expressions: false }) ||
        Number(canonicalAmount(pointValue, { expressions: false })) <= 0)
    ) {
      // Zero would divide the whole optimizer's valuation by nothing — the router refuses
      // it, and so does this, in the router's words.
      setError('point_value_cents must be positive')
      revealEditor(formRef.current, '#card-point-value')
      return null
    }
    const body: CreditCardIn = {
      name,
      // The wire belt: blur usually canonicalized already, but a submit reached without one
      // (a mouse user who types and clicks Save) must not ship "$95" to a Decimal column.
      // Expressionless throughout, matching the boxes themselves.
      annual_fee: fee === '' ? '0' : canonicalAmount(fee, { expressions: false }),
      rewards_currency: form.rewards_currency,
      // A blank point value means "a point is a cent" — the cash-back identity, and the
      // only default that leaves a plain cashback card's math unchanged.
      point_value_cents:
        pointValue === '' ? '1' : canonicalAmount(pointValue, { expressions: false }),
      person_id: ownerValue === '' ? null : Number(ownerValue),
      // The embossed name is INFORMATIONAL and this form no longer edits it (person_id is
      // the ownership vocabulary now) — so it comes from the STORED row, exactly like
      // is_active and sort_order, and a new card simply has none yet.
      primary_holder: stored?.primary_holder ?? null,
      authorized_users: form.authorized_users.trim() || null,
      opened_on: form.opened_on || null,
      // One of the two columns this form has no box for. On a full-replace PATCH an omitted
      // or guessed is_active would silently unarchive a card on every unrelated edit — so it
      // comes from the STORED row and only Archive moves it.
      is_active: stored?.is_active ?? true,
      account_id: form.account_id === '' ? null : Number(form.account_id),
      notes: form.notes.trim() || null,
    }
    // The other is the position, which the roster's drag owns (2026-09-23 drag-to-reorder spec
    // §7). An edit sends the stored value back, as a full replace names every column; a new
    // card names none, and the server appends it after the last card (spec §3.3).
    return stored === undefined ? body : { ...body, sort_order: stored.sort_order }
  }

  const submit = () => {
    if (busy || saveState.status === 'clean' || saveState.status === 'saved' || saveState.status === 'saving') return
    // The row as the SERVER has it, as rendered: after a reorder the PUT's answer — its
    // renumbered sort_order included — stands here before the page's reload lands.
    const stored = ordered.find((card) => card.id === editingId)
    const body = buildBody(stored)
    if (body === null) return
    setError(null)
    // The FULL row on both verbs: the router validates the MERGED card, so a delta PATCH
    // would 422 on a stored field this form never touched. The nullable columns travel as
    // explicit nulls — which on PATCH is what CLEARS them.
    void saveState.run(() => track(async () => {
      const saved = await (editingId !== null ? updateCreditCard(editingId, body) : createCreditCard(body))
      resetForm()
      await reload()
      requestAnimationFrame(() => focusRow(saved.id, true))
    }))
  }

  const lockRow = (id: number, locked: boolean) => setRowBusy((current) => {
    const next = new Set(current)
    if (locked) next.add(id)
    else next.delete(id)
    return next
  })
  const clearOverride = (id: number) => setActiveOverrides((current) => {
    const next = new Map(current)
    next.delete(id)
    return next
  })

  const toggleArchive = (card: CreditCardOut) => {
    if (rowBusy.has(card.id)) return
    lockRow(card.id, true)
    setActiveOverrides((current) => new Map(current).set(card.id, !card.is_active))
    void updateCreditCardLogged(card.id, {
        name: card.name, annual_fee: card.annual_fee, rewards_currency: card.rewards_currency,
        point_value_cents: card.point_value_cents, person_id: card.person_id,
        primary_holder: card.primary_holder, authorized_users: card.authorized_users,
        opened_on: card.opened_on, is_active: !card.is_active, account_id: card.account_id,
        notes: card.notes, sort_order: card.sort_order,
      }).then(async ({ batchId }) => {
      await reload()
      toast.success(`${card.is_active ? 'Archived' : 'Unarchived'} ${card.name}`, batchId === null ? undefined : {
        action: { label: 'Undo', onAction: () => {
          lockRow(card.id, true)
          void undoBatch(batchId).then(async () => {
            await reload()
            requestAnimationFrame(() => focusRow(card.id, true))
            toast.success(`Restored ${card.name}`)
          }).catch((err: unknown) => { toast.error(errorDetail(err)); focusRow(card.id) })
            .finally(() => lockRow(card.id, false))
        } },
      })
    }).catch((err: unknown) => toast.error(errorDetail(err))).finally(() => {
      clearOverride(card.id)
      lockRow(card.id, false)
    })
  }

  const remove = (card: CreditCardOut) => {
    const rows = orderedRef.current
    const at = rows.findIndex((row) => row.id === card.id)
    const neighbour = rows[at + 1] ?? rows[at - 1]
    void track(() => deleteWithUndo({
      name: card.name,
      row: rowFor(card.id),
      request: () => deleteCreditCard(card.id),
      onDeleted: async () => {
        if (editingRef.current === card.id) resetForm()
        await reload()
      },
      focusAfter: () => (neighbour ? rowFor(neighbour.id)?.querySelector<HTMLElement>('[data-row-edit]') : null)
        ?? formRef.current?.querySelector<HTMLElement>('input') ?? null,
      onRestored: () => track(async () => { await reload() }),
      restoredRow: () => rowFor(card.id),
    }))
  }

  // A failed save puts the rows back (spec §7, as §4.1). Moving them can blur the grip a
  // keyboard drop left focus on — reverting an upward move moves that grip's own row — so
  // focus is handed back once the DOM has moved (flushSync: the move has happened by the next
  // line). Lane R3's dropPendingOrder.
  const dropPendingOrder = () => {
    const focused = document.activeElement
    flushSync(() => setPendingOrder(null))
    if (
      focused instanceof HTMLElement &&
      focused.isConnected &&
      document.activeElement !== focused
    ) {
      focused.focus()
    }
  }

  // Undo re-sends the order that stood before the drop (spec §7): the route is not
  // change-logged, so the client holds the previous order. The server's answer shows at once,
  // as the saved order — it replaces the drop's, so the rows on screen are the restored ones
  // even when the page's reload hands down nothing new (lane R3's browser find: an Undo's
  // reload can match what the page already holds). A roster that changed since answers 409,
  // and the page's reload shows what is there now; any refusal is the server's own sentence
  // (§8.1). Two-argument `then` (lane R3 review): only the request's own failure takes the
  // failure branch — a throw in the success branch is a bug for the console, never "Couldn't
  // undo the move".
  const restoreOrder = (ids: number[]) => {
    void track(() =>
      reorderCreditCards(ids).then(
        (restored) => {
          setSavedOrder(restored)
          reload()
          toast.info(ORDER_RESTORED)
        },
        (err: unknown) => {
          toast.error(undoFailureText(err))
          if (err instanceof ApiError && err.status === 409) reload()
        },
      ),
    )
  }

  // One drop, one PUT (spec §7): every card, active and archived, in its new order. The
  // matrix columns, the tiles and the credit-line legend read the page's list, so they follow
  // once the page reloads. `reorder` is read only when the PUT answers, long after the render
  // that declares it below has returned. Two-argument `then`, as restoreOrder's: a throw in
  // the success branch must never print "The list is back to how it was." over the saved order.
  const saveOrder = (next: number[], moved: number) => {
    const card = cardById.get(moved)
    if (card === undefined) return // the hook commits only ids it was handed
    const previous = ordered.map((row) => row.id)
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = cardById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    void track(() =>
      reorderCreditCards(next).then(
        (saved) => {
          setPendingOrder(null)
          setSavedOrder(saved)
          reload()
          reorder.markSaved(moved)
          toast.success(movedToast(card.name), {
            action: { label: 'Undo', onAction: () => restoreOrder(previous) },
          })
        },
        (err: unknown) => {
          dropPendingOrder()
          if (err instanceof ApiError && err.status === 409) {
            // The server's sentence says what happened; the reload shows the rows it means.
            toast.error(staleListText(err))
            reload()
            return
          }
          // The toast layer, never the form's banner: the table is not the form (spec §4.1).
          toast.error(orderSaveFailed(errorDetail(err)))
        },
      ),
    )
  }

  const reorder = useReorder({
    items: ordered.map((card) => ({ id: card.id })),
    labelOf: (id) => cardById.get(id)?.name ?? 'this card',
    // Any request of the roster in flight — a save, an archive, a delete, a reorder — leaves
    // the grips focusable but inert (lane R0 consumer rule 4), so a drop never races a save.
    disabled: busy || rowBusy.size > 0,
    onCommit: saveOrder,
  })

  // A card with no opened date has no anniversary, so the calendar can date neither its
  // fee nor an anniversary-cadence credit reset (2026-09-03 calendar spec §6) — the one
  // stored gap on this page that silently costs events elsewhere, so the roster says so.
  const undated = cards.filter((card) => card.is_active && card.opened_on === null)

  return (
    <section className="card span-12" ref={panelRef}>
      <h2 className="eyebrow">
        Card roster
        <InfoHint text="One row per real card account. Archived cards keep their history but leave the matrix and the math. Dashboard-only: workbook imports never touch cards." />
      </h2>
      <form
        ref={formRef}
        className="roster-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Card name
          <input
            // The form's first TYPED entry field, so the save-success path can hand the
            // caret back to it by id.
            id="card-name"
            className="field-input"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
          />
        </label>
        <label>
          Annual fee
          <AmountInput
            id="card-annual-fee"
            kind="money"
            value={form.annual_fee}
            onValueChange={set('annual_fee')}
            placeholder="$0"
          />
        </label>
        <label>
          Rewards currency
          {/* dedicated handler: the currency is a union, the string setter cannot write it */}
          <select
            className="field-input"
            value={form.rewards_currency}
            onChange={(e) =>
              { setError(null); saveState.clearError(); setForm((f) => ({ ...f, rewards_currency: e.target.value as RewardsCurrency })) }
            }
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Point value (¢)
          {/* kind="plain": Numeric(6,4) — a 2dp money echo over 1.7000 would lie. */}
          <AmountInput
            id="card-point-value"
            kind="plain"
            value={form.point_value_cents}
            onValueChange={set('point_value_cents')}
            placeholder="1 = 1¢ (cash)"
          />
        </label>
        <label>
          Owner
          <select
            className="field-input"
            value={ownerValue}
            onChange={(e) => set('person_id')(e.target.value)}
          >
            <option value="">Joint</option>
            {people.map((person) => (
              <option key={person.id} value={String(person.id)}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Authorized users
          <input
            className="field-input"
            value={form.authorized_users}
            placeholder="comma-separated"
            onChange={(e) => set('authorized_users')(e.target.value)}
          />
        </label>
        <label>
          Opened
          <input
            className="field-input"
            type="date"
            value={form.opened_on}
            onChange={(e) => set('opened_on')(e.target.value)}
          />
        </label>
        <label>
          Linked liability account
          <select
            className="field-input"
            value={form.account_id}
            onChange={(e) => set('account_id')(e.target.value)}
          >
            <option value="">— none —</option>
            {liabilityAccounts.map((account) => (
              <option key={account.id} value={String(account.id)}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Card notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="roster-form-actions">
          <FeedBanner error={error} />
          <SaveButton type="submit" className="button button-primary" state={saveState} aria-disabled={busy || undefined}>
            {editingId !== null ? 'Save card' : 'Add card'}
          </SaveButton>
          {error === null && <SaveStatus state={saveState} />}
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the card edit"
              onClick={cancelEdit}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {ordered.length === 0 ? (
        <p className="empty-note">No cards yet — add your first card above.</p>
      ) : (
        <>
          {/* Once per list and outside the table — a <span> is not a valid child of one (lane
              R0 consumer rule 6). Every grip points its aria-describedby at the instructions. */}
          <ReorderInstructions id={reorder.instructionsId} />
          <ReorderLiveRegion text={reorder.announcement} />
          <table className="data-table roster-table reorder-table">
            <thead>
              <tr>
                <th className="reorder-grip-cell" aria-hidden="true" />
                <th>Card</th>
                <th>Owner</th>
                <th>Holder</th>
                <th>Auth. users</th>
                <th>Opened</th>
                <th className="num">Limit</th>
                <th>Linked account</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ordered.map((card) => (
                <tr
                  key={card.id}
                  id={`card-row-${card.id}`}
                  aria-current={card.id === editingId ? true : undefined}
                  {...reorder.itemProps(card.id)}
                  className={card.id === editingId ? 'is-editing' : undefined}
                >
                  {/* Every card, archived ones included, keeps its place and moves (spec §9). */}
                  <td className="reorder-grip-cell">
                    <DragHandle name={card.name} {...reorder.handleProps(card.id)} />
                  </td>
                  <td>
                    {card.name}
                    {/* The card's economics ride the name cell rather than owning two more
                        columns. A 1¢ point value is the cash identity and says nothing. */}
                    <span className="sub">
                      {formatCurrency(card.annual_fee)} · {card.rewards_currency}
                      {Number(card.point_value_cents) !== 1 && ` ${Number(card.point_value_cents)}¢`}
                    </span>
                  </td>
                  {/* NULL is JOINT, never "unknown": the migration backfilled every
                      pre-existing card to the primary person. `Holder` beside it is the
                      embossed name — informational, and no longer editable here. */}
                  <td>
                    {card.person_id === null ? 'Joint' : (ownerName.get(card.person_id) ?? '—')}
                  </td>
                  <td>{card.primary_holder ?? '—'}</td>
                  <td>{card.authorized_users ?? '—'}</td>
                  <td>{card.opened_on ? formatDate(card.opened_on) : '—'}</td>
                  {/* The SERVER's latest limit event, never re-derived here (global rule 9). */}
                  <td className="num">
                    {card.current_limit === null ? '—' : formatCurrency(card.current_limit)}
                  </td>
                  <td>{card.account_id === null ? '—' : (accountName.get(card.account_id) ?? '—')}</td>
                  <td>
                    <span className="badge">{card.is_active ? 'Active' : 'Archived'}</span>
                  </td>
                  <td className="row-actions">
                    <BusyButton
                      type="button"
                      className="button"
                      data-row-edit
                      aria-label={`Edit ${card.name}`}
                      // Shut mid-flight like every other button here: this fills the form from
                      // the row, and a save landing a moment later resets it out from under
                      // the click. Shut while a row is lifted too (lane R0 consumer rule 5): a
                      // click mid-drag would act on a row that is about to move.
                      inert={busy || rowBusy.has(card.id) || reorder.active}
                      onClick={() => startEdit(card)}
                    >
                      Edit
                    </BusyButton>
                    <BusyButton
                      type="button"
                      className="button"
                      aria-label={card.is_active ? `Archive ${card.name}` : `Unarchive ${card.name}`}
                      busy={rowBusy.has(card.id)}
                      inert={busy || reorder.active}
                      onClick={() => toggleArchive(card)}
                    >
                      {card.is_active ? 'Archive' : 'Unarchive'}
                    </BusyButton>
                    <BusyButton
                      type="button"
                      className="button"
                      aria-label={`Delete ${card.name}`}
                      inert={busy || rowBusy.has(card.id) || reorder.active}
                      onClick={() => remove(card)}
                    >
                      Delete
                    </BusyButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {/* Sibling of the ternary, not inside it: `undated` derives from `cards`, so it is
          empty exactly when the empty-note above is showing. */}
      {undated.length > 0 && (
        <p className="drill-hint">
          {undated.length === 1 ? '1 active card has' : `${undated.length} active cards have`} no
          opened date — add one ({undated.map((c) => c.name).join(', ')}) so fees, anniversaries
          and credit resets reach the calendar.
        </p>
      )}
    </section>
  )
}
