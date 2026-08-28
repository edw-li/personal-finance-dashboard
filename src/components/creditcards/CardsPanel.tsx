import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createCardCredit,
  createCreditCard,
  createLimitEvent,
  deleteCreditCard,
  updateCreditCard,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
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

function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Card roster: add/edit form + table. Archive = full-object PATCH flipping is_active
 * (history kept, optimizer ignores it). Delete = instant + Undo; Undo re-POSTs the
 * card AND its credits and limit events (they cascade away server-side).
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
  onChanged: () => void
}) {
  const [form, setForm] = useState<CardFormState>(EMPTY_CARD)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)
  const toast = useToast()

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

  const set = (field: keyof CardFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (card: CreditCardOut) => {
    setEditingId(card.id)
    // The server's own quantized strings, verbatim: nothing is reformatted on the way into
    // a box whose contents are about to be sent straight back.
    setForm({
      name: card.name,
      annual_fee: card.annual_fee,
      rewards_currency: card.rewards_currency,
      person_id: card.person_id === null ? '' : String(card.person_id),
      point_value_cents: card.point_value_cents,
      authorized_users: card.authorized_users ?? '',
      opened_on: card.opened_on ?? '',
      account_id: card.account_id === null ? '' : String(card.account_id),
      notes: card.notes ?? '',
    })
  }

  /** The full-replace body, preserving fields the form doesn't show (is_active,
   *  sort_order) from the stored row when editing. */
  const buildBody = (stored: CreditCardOut | undefined): CreditCardIn | null => {
    const name = form.name.trim()
    if (!name) {
      // An empty string reaches the API as `""` and 422s as an opaque message about a
      // field the user never saw named.
      setError('Card name is required')
      return null
    }
    const fee = form.annual_fee.trim()
    if (fee !== '' && (!isAmount(fee, { expressions: false }) || Number(canonicalAmount(fee, { expressions: false })) < 0)) {
      // The server's own sentence. The CANONICAL value is what's compared: Number('$95')
      // is NaN, and NaN < 0 is false — a tolerant entry would slip past a raw comparison.
      setError('annual_fee must be non-negative')
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
      return null
    }
    return {
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
      // The two columns this form has no box for. On a full-replace PATCH an omitted or
      // guessed value would silently unarchive a card, or shuffle the roster's order, on
      // every unrelated edit — so they come from the STORED row and only Archive moves
      // is_active.
      is_active: stored?.is_active ?? true,
      account_id: form.account_id === '' ? null : Number(form.account_id),
      notes: form.notes.trim() || null,
      sort_order: stored?.sort_order ?? 0,
    }
  }

  const submit = () => {
    // The row as the SERVER has it, looked up in the current feed.
    const stored = cards.find((c) => c.id === editingId)
    const body = buildBody(stored)
    if (body === null) return
    setBusy(true)
    setError(null)
    // The FULL row on both verbs: the router validates the MERGED card, so a delta PATCH
    // would 422 on a stored field this form never touched. The nullable columns travel as
    // explicit nulls — which on PATCH is what CLEARS them.
    const request =
      editingId !== null ? updateCreditCard(editingId, body) : createCreditCard(body)
    request
      .then(() => {
        // The next entry starts here — the sheet's row-to-row rhythm.
        // BEFORE the reset, and that order is load-bearing: the caret can still be sitting
        // in an AmountInput when this lands, and moving focus BLURS that box synchronously.
        // The blur's commit closes over the box's PRE-reset text, so focusing first aims
        // that write at the state the reset below then replaces; the other order lets it
        // land on the emptied form and resurrect the fee of the card just saved.
        document.getElementById('card-name')?.focus()
        setForm(EMPTY_CARD)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const toggleArchive = (card: CreditCardOut) => {
    setBusy(true)
    setError(null)
    // The stored row with ONE bit flipped — not the form's, which may be mid-edit on some
    // other card. Archiving keeps every credit and limit event; it only takes the card out
    // of the matrix and the optimizer's math.
    updateCreditCard(card.id, {
      name: card.name,
      annual_fee: card.annual_fee,
      rewards_currency: card.rewards_currency,
      point_value_cents: card.point_value_cents,
      // VERBATIM REBUILD 1 of 2. Every nullable column must be listed: this is a
      // full-replace PATCH, so a column omitted here is CLEARED, and a cleared person_id
      // silently turns the card joint (2026-08-26 audit §3.6).
      person_id: card.person_id,
      primary_holder: card.primary_holder,
      authorized_users: card.authorized_users,
      opened_on: card.opened_on,
      is_active: !card.is_active,
      account_id: card.account_id,
      notes: card.notes,
      sort_order: card.sort_order,
    })
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Archive failed')))
      .finally(() => setBusy(false))
  }

  const remove = (card: CreditCardOut) => {
    setBusy(true)
    // Cleared on entry like submit's: a delete that succeeds must not leave the previous
    // save's 409 sitting over the panel as if it still described the table.
    setError(null)
    // Instant + Undo (2026-08-25 polish §8): the confirm interrupt is gone.
    deleteCreditCard(card.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save.
        // Reset on SUCCESS only.
        if (card.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_CARD)
        }
        onChanged()
        toast.success(`Deleted ${card.name}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              // Re-create the card, then its cascaded children. Matrix cells are NOT
              // restored (they reference the old card id) — the toast says so.
              createCreditCard({
                name: card.name,
                annual_fee: card.annual_fee,
                rewards_currency: card.rewards_currency,
                point_value_cents: card.point_value_cents,
                // VERBATIM REBUILD 2 of 2 — same hazard as toggleArchive's.
                person_id: card.person_id,
                primary_holder: card.primary_holder,
                authorized_users: card.authorized_users,
                opened_on: card.opened_on,
                is_active: card.is_active,
                account_id: card.account_id,
                notes: card.notes,
                sort_order: card.sort_order,
              })
                .then(async (restored) => {
                  // Sequential, not Promise.all: the limits endpoint returns the card's
                  // whole history and the server orders by effective date, so a burst of
                  // parallel POSTs would race for the "latest" that becomes current_limit.
                  for (const credit of card.credits)
                    await createCardCredit(restored.id, {
                      label: credit.label,
                      annual_value: credit.annual_value,
                      counts: credit.counts,
                    })
                  for (const event of card.limit_events)
                    await createLimitEvent(restored.id, {
                      effective_date: event.effective_date,
                      limit_amount: event.limit_amount,
                      note: event.note,
                    })
                  onChanged()
                  toast.info(`Restored ${card.name} — matrix multipliers were not restored`)
                })
                .catch(() => toast.error(`Could not restore ${card.name}`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Card roster
        <InfoHint text="One row per real card account. Archived cards keep their history but leave the matrix and the math. Dashboard-only: workbook imports never touch cards." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
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
              setForm((f) => ({ ...f, rewards_currency: e.target.value as RewardsCurrency }))
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
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save card' : 'Add card'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the card edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_CARD)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {cards.length === 0 ? (
        <p className="empty-note">No cards yet — add your first card above.</p>
      ) : (
        <table className="data-table roster-table">
          <thead>
            <tr>
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
            {cards.map((card) => (
              <tr key={card.id} className={card.id === editingId ? 'is-editing' : undefined}>
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
                  <button
                    type="button"
                    className="button"
                    aria-label={`Edit ${card.name}`}
                    // Shut mid-flight like every other button here: this fills the form from
                    // the row, and a save landing a moment later resets it out from under
                    // the click.
                    disabled={busy}
                    onClick={() => startEdit(card)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={card.is_active ? `Archive ${card.name}` : `Unarchive ${card.name}`}
                    disabled={busy}
                    onClick={() => toggleArchive(card)}
                  >
                    {card.is_active ? 'Archive' : 'Unarchive'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Delete ${card.name}`}
                    disabled={busy}
                    onClick={() => remove(card)}
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
