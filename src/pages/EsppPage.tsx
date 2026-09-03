import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  createLot,
  createOffering,
  createPeriod,
  deleteLot,
  deleteOffering,
  deletePeriod,
  fetchLots,
  fetchModeler,
  fetchOfferings,
  updateLot,
  updateOffering,
  updatePeriod,
} from '../api/espp'
import type { ModelerParams } from '../api/espp'
import { fetchPriceHistory } from '../api/prices'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import AmountInput from '../components/AmountInput'
import InfoHint from '../components/InfoHint'
import StatTile from '../components/StatTile'
import Feed, { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import type {
  EsppLotCreate,
  EsppLotOut,
  EsppLotsResponse,
  EsppLotUpdate,
  EsppModelerOut,
  EsppModelerPeriod,
  EsppOfferingCreate,
  EsppOfferingOut,
  EsppPeriodCreate,
  PricePoint,
} from '../types/api'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency, formatDate, formatPct, formatShares } from '../utils/format'
import { shiftPoint } from '../utils/percent'
import '../components/panels.css'
import './EsppPage.css'

// The IRS §423 ceiling the chain is modeled against (backend espp_calc: unused_25k starts
// here). Nothing on the page is DERIVED from it: it feeds the gauge's denominator (the
// fill width) and the meter's aria-valuemax/aria-label/aria-valuetext, and that is all —
// "remaining" is the server's own number.
const LIMIT_25K = 25000

function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

// ── Lots ────────────────────────────────────────────────────────────────────────────────

interface LotFormState {
  purchase_date: string
  qualifying_date: string
  shares: string
  subscription_price: string
  purchase_fmv: string
  purchase_price: string
  sold_date: string
  sold_price: string
  notes: string
}

const EMPTY_LOT: LotFormState = {
  purchase_date: '', qualifying_date: '', shares: '', subscription_price: '',
  purchase_fmv: '', purchase_price: '', sold_date: '', sold_price: '', notes: '',
}

function disposition(lot: EsppLotOut): string {
  if (lot.is_sold) return lot.qualified ? 'Sold (qualified)' : 'Sold (unqualified)'
  if (lot.qualified) return 'Qualified'
  // days_until_qualified is null only for sold rows, but the type allows it here too.
  const days = lot.days_until_qualified
  if (days === null) return 'Qualifying'
  return `Qualifying in ${days} ${days === 1 ? 'day' : 'days'}`
}

// ISO date-string year math for prefills (display/entry only — the server re-validates).
// Feb 29 + n years can land on a non-leap year; clamp to the 28th.
function addYearsIso(iso: string, years: number): string {
  const [y, m, d] = iso.split('-')
  const year = Number(y) + years
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const day = m === '02' && d === '29' && !leap ? '28' : d
  return `${year}-${m}-${day}`
}

// The covering offering: greatest offering_start <= the date (ISO strings compare as
// dates). Mirrors espp_calc._resolve_subscription so the prefill and the model agree.
function coveringOffering(offerings: EsppOfferingOut[], isoDate: string): EsppOfferingOut | null {
  let covering: EsppOfferingOut | null = null
  for (const offering of offerings) {
    if (offering.offering_start <= isoDate) covering = offering
  }
  return covering
}

/**
 * The lots table and the one form that doubles as add-row and row editor (TransactionsPanel
 * idiom). It owns its form state, and the page hands it a replaced `lots` payload rather
 * than remounting it — so a modeler or offerings refetch cannot destroy a half-typed row.
 */
function LotsPanel({
  data,
  offerings,
  onChanged,
}: {
  data: EsppLotsResponse
  // The prefill source for a new lot's subscription price and qualifying date; empty
  // until the offerings feed answers (a prefill nobody has data for simply does not run).
  offerings: EsppOfferingOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<LotFormState>(EMPTY_LOT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)

  const set = (field: keyof LotFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (lot: EsppLotOut) => {
    setEditingId(lot.id)
    setForm({
      purchase_date: lot.purchase_date,
      qualifying_date: lot.qualifying_date,
      shares: lot.shares,
      subscription_price: lot.subscription_price,
      purchase_fmv: lot.purchase_fmv,
      purchase_price: lot.purchase_price,
      sold_date: lot.sold_date ?? '',
      sold_price: lot.sold_price ?? '',
      notes: lot.notes ?? '',
    })
  }

  // Prefill-only, untouched-box guard (spec §6.4): typing a purchase date fills the
  // subscription price from the covering offering and the qualifying date from the §423
  // rule — max(offering start + 2y, purchase + 1y). Both editable; edits never clobbered.
  const onPurchaseDateChange = (value: string) => {
    setForm((f) => {
      const next = { ...f, purchase_date: value }
      if (editingId === null && value !== '') {
        const covering = coveringOffering(offerings, value)
        // No covering offering → NO prefill at all, neither box (spec §6.4). purchase + 1y
        // on its own is only the §423 LOWER bound: without the offering's start + 2y to
        // measure it against, seeding it would put an optimistically early qualifying date
        // in a box the user has every reason to accept as computed for them.
        if (covering !== null) {
          if (f.subscription_price === '') {
            next.subscription_price = covering.subscription_price
          }
          if (f.qualifying_date === '') {
            const byPurchase = addYearsIso(value, 1)
            const byOffering = addYearsIso(covering.offering_start, 2)
            next.qualifying_date = byOffering > byPurchase ? byOffering : byPurchase
          }
        }
      }
      return next
    })
  }

  const submit = () => {
    // Canonicalized at the READ site, so the presence checks, the blank-vs-null branches
    // and both bodies below all see the one text the column will store — a submit reached
    // without a blur (type, then click Save) must not ship "$85.50" to a Decimal column.
    // Blank canonicalizes to blank, so every '' test downstream keeps its meaning exactly.
    //
    // EVERY figure on this form is { expressions: false }, by the app-wide kind rule: not
    // one of these columns is 2dp. shares is a Numeric(12,4) and all four prices are
    // Numeric(14,5), while the evaluator quantizes to 2dp — an evaluated "=1/8" would
    // commit 0.13 where 0.125 was meant. The boxes are kind="shares"/"plain" and refuse
    // "=" themselves; the belts agree, and the text travels verbatim for the server's 422
    // (TransactionsPanel's rule, one decimal place further out).
    const shares = canonicalAmount(form.shares.trim(), { expressions: false })
    const subscription = canonicalAmount(form.subscription_price.trim(), { expressions: false })
    const fmv = canonicalAmount(form.purchase_fmv.trim(), { expressions: false })
    if (!form.purchase_date || !form.qualifying_date || !shares || !subscription || !fmv) {
      // An empty string reaches the API as `""` and 422s as an opaque decimal-parse error
      // (TransactionsPanel's Task 14 review M2 lesson).
      setError('Purchase date, qualifying date, shares, subscription and FMV are required')
      return
    }
    if (form.qualifying_date < form.purchase_date) {
      // The server's own sentence, and it is already date-phrased — it reads fine on
      // screen. Both boxes are <input type="date">, so these are ISO strings and a string
      // compare IS the date compare (no Date parsing, no timezone to get wrong).
      setError('qualifying_date must be on or after purchase_date')
      return
    }
    const soldDate = form.sold_date.trim()
    const soldPrice = canonicalAmount(form.sold_price.trim(), { expressions: false })
    if ((soldDate === '') !== (soldPrice === '')) {
      // The server's own sentence, one vocabulary — its 422 is the backstop, this is the
      // round trip saved (BracketsEditor's rule).
      setError('sold_date and sold_price must be set together')
      return
    }
    const price = canonicalAmount(form.purchase_price.trim(), { expressions: false })
    const notes = form.notes.trim() || null
    setBusy(true)
    setError(null)
    let request: Promise<EsppLotOut>
    if (editingId !== null) {
      const body: EsppLotUpdate = {
        purchase_date: form.purchase_date,
        qualifying_date: form.qualifying_date,
        shares,
        subscription_price: subscription,
        purchase_fmv: fmv,
        // Blank means "derive it". On PATCH that is an explicit null: the one null the
        // server does NOT treat as a no-op — it re-derives 0.85 x min(sub, fmv) from the
        // merged row (Task 3 ratification).
        purchase_price: price === '' ? null : price,
        // Both or neither; both null CLEARS a disposition (nullable columns).
        sold_date: soldDate === '' ? null : soldDate,
        sold_price: soldPrice === '' ? null : soldPrice,
        notes,
      }
      request = updateLot(editingId, body)
    } else {
      const body: EsppLotCreate = {
        purchase_date: form.purchase_date,
        qualifying_date: form.qualifying_date,
        shares,
        subscription_price: subscription,
        purchase_fmv: fmv,
        notes,
      }
      // OMITTED, not null: `purchase_price: null` would also derive the default, but the
      // create body simply never mentions a column the server owns.
      if (price !== '') body.purchase_price = price
      if (soldDate !== '') {
        body.sold_date = soldDate
        body.sold_price = soldPrice
      }
      request = createLot(body)
    }
    request
      .then(() => {
        // The next entry starts here — the sheet's row-to-row rhythm (spec §5.1).
        // BEFORE the reset, and that order is load-bearing: this form carries no
        // data-entry-scope, so Enter is the browser's implicit submit and the caret is
        // still sitting in an AmountInput when this lands. Moving it BLURS that box
        // synchronously, and the blur's commit closes over the box's PRE-reset text —
        // canonicalizing a "$150.00" into an enqueued write. Focusing first aims that write
        // at the state the full-object reset below then replaces; the other order lets it
        // land on the emptied form and resurrect one figure of the lot just saved.
        // getElementById is the house DOM protocol (like data-entry-scope), so AmountInput
        // keeps its no-ref API; the target is a plain <input type="date">, so focusing it
        // runs no React handler of its own.
        document.getElementById('lot-purchase-date')?.focus()
        setForm(EMPTY_LOT)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const remove = (lot: EsppLotOut) => {
    if (!window.confirm(`Delete the lot purchased ${formatDate(lot.purchase_date)}?`)) return
    setBusy(true)
    // Cleared on entry like submit's: a delete that succeeds must not leave the previous
    // save's 409 sitting over the panel as if it still described the table.
    setError(null)
    deleteLot(lot.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only.
        if (lot.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_LOT)
        }
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Lots
        <InfoHint text="Each semi-annual purchase: cost, value at the current quote (or its sale price), gain, and the qualifying-date countdown." />
      </h2>
      {/* The quote the whole table was priced against. The date is rendered, not judged:
          freshness math on an instant flags a Friday bar early on Monday (Plan 4's
          "the UI compares dates only" note), and the lots table has no staleness rule of
          its own to enforce. */}
      {data.espp_ticker === null ? (
        <p className="drill-hint">
          No ESPP ticker configured — set the espp_ticker setting to price these lots.
        </p>
      ) : data.current_price === null ? (
        <p className="drill-hint">
          {`${data.espp_ticker} — no live quote; market values are unavailable.`}
        </p>
      ) : (
        <p className="drill-hint">
          {`${data.espp_ticker} · ${formatCurrency(data.current_price)} · as of ${formatDate(
            data.quoted_at,
          )}`}
        </p>
      )}
      <p className="drill-hint">
        Leave the purchase price blank and the server derives it — 85% of the lower of
        subscription price and purchase FMV. Sold date and sold price travel together:
        set both to realize a lot, clear both to un-sell it. A sold lot is measured
        against its sale price; every other row against the quote above.
      </p>
      <FeedBanner error={error} />
      <form
        className="espp-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Purchase date
          <input
            // The form's first entry field, so the save-success path can hand the caret
            // back to it by id (spec §5.1's focus-return).
            id="lot-purchase-date"
            className="field-input"
            type="date"
            value={form.purchase_date}
            onChange={(e) => onPurchaseDateChange(e.target.value)}
          />
        </label>
        <label>
          Qualifying date
          <input
            className="field-input"
            type="date"
            value={form.qualifying_date}
            onChange={(e) => set('qualifying_date')(e.target.value)}
          />
        </label>
        {/* The figure boxes are AmountInputs: select-all on focus, canonical on blur. No
            data-entry-scope on this form — it is one lot row, so Enter stays the browser's
            own implicit submit.
            NOT ONE of them is kind="money", by the app-wide scale rule: the four prices are
            Numeric(14,5), so a "$41.23" echo over a stored 41.23265 would be a lie and the
            2dp "=" evaluator would coarsen the column. kind="plain" shows the text verbatim
            and refuses "=" (submit's belts agree). Shares is the 4dp count. */}
        <label>
          Shares
          <AmountInput kind="shares" value={form.shares} onValueChange={set('shares')} />
        </label>
        <label>
          Subscription
          <AmountInput
            kind="plain"
            value={form.subscription_price}
            onValueChange={set('subscription_price')}
          />
        </label>
        <label>
          FMV
          <AmountInput
            kind="plain"
            value={form.purchase_fmv}
            onValueChange={set('purchase_fmv')}
          />
        </label>
        <label>
          Purchase price
          <AmountInput
            kind="plain"
            value={form.purchase_price}
            onValueChange={set('purchase_price')}
          />
        </label>
        <label>
          Sold date
          <input
            className="field-input"
            type="date"
            value={form.sold_date}
            onChange={(e) => set('sold_date')(e.target.value)}
          />
        </label>
        <label>
          Sold price
          <AmountInput kind="plain" value={form.sold_price} onValueChange={set('sold_price')} />
        </label>
        <label className="span-2">
          Notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="espp-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save lot' : 'Add lot'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the lot edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_LOT)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {data.lots.length === 0 ? (
        <p className="empty-note">No lots yet.</p>
      ) : (
        <div className="espp-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Purchased</th>
                <th className="num">Shares</th>
                <th className="num">Subscription</th>
                <th className="num">FMV</th>
                <th className="num">Paid</th>
                <th className="num">Cost basis</th>
                <th className="num">Price</th>
                <th className="num">Market value</th>
                <th className="num">Gain</th>
                <th className="num">Gain %</th>
                <th>Disposition</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.lots.map((lot) => (
                <tr key={lot.id} className={lot.id === editingId ? 'is-editing' : undefined}>
                  <td>{formatDate(lot.purchase_date)}</td>
                  <td className="num">{formatShares(lot.shares)}</td>
                  <td className="num">{formatCurrency(lot.subscription_price)}</td>
                  <td className="num">{formatCurrency(lot.purchase_fmv)}</td>
                  <td className="num">{formatCurrency(lot.purchase_price)}</td>
                  <td className="num">{formatCurrency(lot.cost_basis)}</td>
                  {/* A sold row was measured against its SOLD price — showing the live
                      quote next to a realized gain would describe a different trade. */}
                  <td className="num">
                    {formatCurrency(lot.is_sold ? lot.sold_price : data.current_price)}
                  </td>
                  <td className="num">{formatCurrency(lot.market_value)}</td>
                  <td className="num">{formatCurrency(lot.gain_amount)}</td>
                  <td className="num">{formatPct(lot.gain_pct)}</td>
                  <td className="disposition">
                    <span className="badge">{disposition(lot)}</span>
                    {lot.sold_date && (
                      <span className="drill-hint"> {formatDate(lot.sold_date)}</span>
                    )}
                  </td>
                  {/* The cell ellipsises a long note (EsppPage.css), so the full text is
                      the hover title — `undefined`, never null, or React would render a
                      literal title="null" on every unnoted row. */}
                  <td className="espp-notes-cell" title={lot.notes ?? undefined}>
                    {lot.notes ?? ''}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit lot from ${formatDate(lot.purchase_date)}`}
                      onClick={() => startEdit(lot)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete lot from ${formatDate(lot.purchase_date)}`}
                      disabled={busy}
                      onClick={() => remove(lot)}
                    >
                      Delete
                    </button>
                    {/* UNSOLD rows only: the what-if card models a PROSPECTIVE sale, and a
                        lot that already has a sold date 409s there (api/taxes.py). The link
                        wears .button so it sits in the row-actions rank with its two
                        neighbours rather than reading as body text. */}
                    {!lot.is_sold && (
                      <Link className="button" to={`/taxes?whatif-lot=${lot.id}`}>
                        Model sale →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Offerings ───────────────────────────────────────────────────────────────────────────

interface OfferingFormState {
  offering_start: string
  subscription_price: string
  notes: string
}

const EMPTY_OFFERING: OfferingFormState = { offering_start: '', subscription_price: '', notes: '' }

/**
 * The enrollment windows: one row per subscription-price reset. Coverage is display-only
 * client math — "→ the next offering" or "through start + 24 mo" (approximate for an
 * off-cycle hire-month enrollment, which ends at its 4th purchase; spec "Plan mechanics").
 */
function OfferingsPanel({
  offerings,
  bars,
  onChanged,
}: {
  offerings: EsppOfferingOut[]
  // Employer daily closes for the "use close" chip; empty when the ticker/bars are absent.
  bars: PricePoint[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<OfferingFormState>(EMPTY_OFFERING)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (field: keyof OfferingFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  // The last bar on/before the typed start date — the chip's suggestion. Never
  // auto-applied (house suggestion posture).
  const closeBar = (() => {
    if (!form.offering_start) return null
    let found: PricePoint | null = null
    for (const bar of bars) {
      if (bar.d <= form.offering_start) found = bar
    }
    return found
  })()

  const startEdit = (offering: EsppOfferingOut) => {
    setEditingId(offering.id)
    setForm({
      offering_start: offering.offering_start,
      subscription_price: offering.subscription_price,
      notes: offering.notes ?? '',
    })
  }

  const submit = () => {
    // Canonical at the READ site (LotsPanel's rule). kind="plain": the column is 5dp, so
    // no "=" and no 2dp echo may touch it.
    const price = canonicalAmount(form.subscription_price.trim(), { expressions: false })
    if (!form.offering_start || !price) {
      setError('Offering start and subscription price are required')
      return
    }
    setBusy(true)
    setError(null)
    const body: EsppOfferingCreate = {
      offering_start: form.offering_start,
      subscription_price: price,
      notes: form.notes.trim() || null,
    }
    const request = editingId !== null ? updateOffering(editingId, body) : createOffering(body)
    request
      .then(() => {
        // Focus BEFORE the reset (the blur-commit invariant, LotsPanel's note).
        document.getElementById('offering-start')?.focus()
        setForm(EMPTY_OFFERING)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const remove = (offering: EsppOfferingOut) => {
    if (!window.confirm(`Delete the offering starting ${formatDate(offering.offering_start)}?`))
      return
    setBusy(true)
    setError(null)
    deleteOffering(offering.id)
      .then(() => {
        if (offering.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_OFFERING)
        }
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  const coverage = (offering: EsppOfferingOut, index: number): string => {
    const next = offerings[index + 1]
    if (next) return `→ ${formatDate(next.offering_start)}`
    return `through ${formatDate(addYearsIso(offering.offering_start, 2))}`
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Subscription offerings
        <InfoHint text="Each enrollment window fixes your subscription price at its start-date close for up to two years (four purchases). The modeler prices each period from the offering covering it; a reset is just a new row." />
      </h2>
      <p className="drill-hint">
        One row per enrollment: the offering start date and the closing price that became
        your subscription price. Periods resolve to the latest offering starting on or
        before them — adding a reset re-prices everything after it automatically.
      </p>
      <FeedBanner error={error} />
      <form
        className="espp-form espp-knobs"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Offering start
          <input
            // The form's first entry field, so the save-success path can hand the caret
            // back to it by id (spec §5.1's focus-return).
            id="offering-start"
            className="field-input"
            type="date"
            value={form.offering_start}
            onChange={(e) => set('offering_start')(e.target.value)}
          />
        </label>
        <label>
          Subscription price
          {/* Numeric(14,5) like every other price on this page: kind="plain", so the stored
              5dp text stands verbatim and no 2dp "=" evaluator can coarsen it. */}
          <AmountInput
            kind="plain"
            value={form.subscription_price}
            onValueChange={set('subscription_price')}
          />
        </label>
        {/* "Offering notes", not the column's bare "Notes": the lots form one section up
            the page has a Notes box of its own, and two fields sharing one accessible name
            leave a screen reader's field list ambiguous. */}
        <label className="span-2">
          Offering notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="espp-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save offering' : 'Add offering'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the offering edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_OFFERING)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {closeBar !== null && (
        <p className="drill-hint" role="status">
          {`close on ${formatDate(closeBar.d)}: ${closeBar.c} `}
          <button
            type="button"
            className="button"
            aria-label={`Use the ${formatDate(closeBar.d)} close as the subscription price`}
            onClick={() => set('subscription_price')(closeBar.c)}
          >
            Use
          </button>
        </p>
      )}
      {offerings.length === 0 ? (
        <p className="empty-note">
          No offerings yet — add your enrollment date and its closing price to drive the
          modeler below.
        </p>
      ) : (
        <div className="espp-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Start</th>
                <th className="num">Subscription price</th>
                <th>Coverage</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offerings.map((offering, index) => (
                <tr
                  key={offering.id}
                  className={offering.id === editingId ? 'is-editing' : undefined}
                >
                  <td>{formatDate(offering.offering_start)}</td>
                  {/* 5dp column — verbatim, never a 2dp currency echo. */}
                  <td className="num">{offering.subscription_price}</td>
                  <td>{coverage(offering, index)}</td>
                  <td className="espp-notes-cell" title={offering.notes ?? undefined}>
                    {offering.notes ?? ''}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit offering from ${formatDate(offering.offering_start)}`}
                      onClick={() => startEdit(offering)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete offering from ${formatDate(offering.offering_start)}`}
                      disabled={busy}
                      onClick={() => remove(offering)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Modeler ─────────────────────────────────────────────────────────────────────────────

interface Knobs {
  subscription: string
  fmv: string
  carry: string
}

// Sparse per-row edits keyed by row identity; only touched cells live here, so a refetch
// updates every untouched cell while typed text survives.
type RowEdits = Record<string, { base?: string; additional?: string; pct?: string }>

// A stored row is its id; a derived one has no id yet, and its label is what the POST that
// materializes it will carry — so the label is the only identity it can have.
function rowKey(row: EsppModelerPeriod): string {
  return row.id !== null ? `p${row.id}` : `d${row.label}`
}

// What the blank knobs resolved to — the provenance line under the form. Blank is the
// smart default here, so the user needs telling which default answered.
function sourceLine(data: EsppModelerOut): string {
  const sub =
    data.subscription_source === 'override'
      ? 'custom subscription price'
      : data.subscription_source === 'offering'
        ? 'subscription from your offerings'
        : data.subscription_source === 'mixed'
          ? 'subscription mixed — offerings where they cover, latest quote elsewhere'
          : `subscription from the latest ${data.espp_ticker ?? 'ESPP ticker'} quote`
  const fmv =
    data.fmv_source === 'override'
      ? 'custom FMV'
      : `FMV from the latest quote${data.quoted_at ? ` (as of ${formatDate(data.quoted_at)})` : ''}`
  return `${sub} · ${fmv}`
}

/**
 * The modeler as the periods EDITOR: every row the server modeled — stored ones and the
 * derived slot-fillers that fill the year out — with its base, additional payments and
 * contribution % editable in place. One primary saves the dirty rows (PATCH the stored,
 * POST the derived, which materializes them) and re-runs the chain.
 */
function ModelerCard({
  data,
  knobs,
  onKnobChange,
  onRun,
  onYearSelect,
  onRowsSaved,
  onDirtyChange,
  busy,
}: {
  data: EsppModelerOut | null
  knobs: Knobs
  onKnobChange: (update: (current: Knobs) => Knobs) => void
  onRun: () => void
  onYearSelect: (year: number) => void
  onRowsSaved: () => void
  /** The page-top $25k tile must not assert a figure this card is disclaiming. */
  onDirtyChange?: (dirty: boolean) => void
  busy: boolean
}) {
  const [edits, setEdits] = useState<RowEdits>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // An UPDATER, never `{ ...knobs, field: value }`: React batches, and a keystroke built
  // from a stale props snapshot would resurrect the siblings it spread.
  const setKnob = (field: keyof Knobs) => (value: string) =>
    onKnobChange((current) => ({ ...current, [field]: value }))

  const editCell = (key: string, field: 'base' | 'additional' | 'pct') => (value: string) =>
    setEdits((cur) => ({ ...cur, [key]: { ...cur[key], [field]: value } }))

  // The DISPLAYED text per cell: the edit if one exists, else the payload value (pct at
  // human scale — "14", never "0.140000000").
  const cellValue = (row: EsppModelerPeriod, field: 'base' | 'additional' | 'pct'): string => {
    const edit = edits[rowKey(row)]?.[field]
    if (edit !== undefined) return edit
    if (field === 'base') return row.semi_annual_base
    if (field === 'additional') return row.additional_payments
    return shiftPoint(row.contribution_pct, 2)
  }

  const rowIsDirty = (row: EsppModelerPeriod): boolean => {
    const edit = edits[rowKey(row)]
    if (!edit) return false
    return (
      (edit.base !== undefined && canonicalAmount(edit.base.trim()) !== row.semi_annual_base) ||
      (edit.additional !== undefined &&
        canonicalAmount(edit.additional.trim()) !== row.additional_payments) ||
      (edit.pct !== undefined &&
        canonicalAmount(edit.pct.trim(), { expressions: false }) !==
          shiftPoint(row.contribution_pct, 2))
    )
  }

  const dirtyRows = (data?.periods ?? []).filter(rowIsDirty)

  // Reported from an effect rather than from every handler: an edit, a save's cleared
  // edits and a year switch's replaced periods all land on the same derived list
  // (InputsForm's onDirtyChange idiom; 2026-08-31 review round).
  const dirty = dirtyRows.length > 0
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const saveAndRecalculate = () => {
    if (data === null || dirtyRows.length === 0) {
      // Nothing to write — the primary is still the way to re-run the chain with the knobs.
      onRun()
      return
    }
    // Validate every dirty row before ANY write (the wizard's validate-then-save order).
    for (const row of dirtyRows) {
      const base = canonicalAmount(cellValue(row, 'base').trim())
      const additional = canonicalAmount(cellValue(row, 'additional').trim() || '0')
      const pct = canonicalAmount(cellValue(row, 'pct').trim(), { expressions: false })
      if (
        !base ||
        !isAmount(base) ||
        !isAmount(additional) ||
        !pct ||
        !isAmount(pct, { expressions: false })
      ) {
        setError(`${row.label}: base, additional and contribution % must be numbers`)
        return
      }
      const pctNumber = Number(pct)
      if (pctNumber < 0 || pctNumber > 100) {
        // NOT the server's "contribution_pct must be between 0 and 1": that sentence is in
        // the STORED fraction's vocabulary, and this cell holds 14 for 14%. Quoting it
        // would call a perfectly good 14 out of range and wave a 0.5 through.
        setError(`${row.label}: contribution % must be between 0 and 100`)
        return
      }
    }
    setSaving(true)
    setError(null)
    const requests = dirtyRows.map((row) => {
      // The FULL row on both verbs: the router validates the MERGED period. A
      // materialized derived row posts exactly what its cells display (spec §6.3).
      const body: EsppPeriodCreate = {
        label: row.label,
        period_start: row.period_start,
        period_end: row.period_end,
        semi_annual_base: canonicalAmount(cellValue(row, 'base').trim()),
        additional_payments: canonicalAmount(cellValue(row, 'additional').trim() || '0'),
        contribution_pct: shiftPoint(
          canonicalAmount(cellValue(row, 'pct').trim(), { expressions: false }),
          -2,
        ),
      }
      return row.id !== null ? updatePeriod(row.id, body) : createPeriod(body)
    })
    Promise.all(requests)
      .then(() => {
        setEdits({})
        onRowsSaved()
      })
      .catch((err: unknown) => {
        setError(message(err, 'Save failed'))
        // RECONCILE, even though the save failed: Promise.all rejects on the FIRST failure
        // while its siblings keep going, so a derived row's POST may have materialized a
        // period the table still renders with `id: null` — and the next save would POST it
        // again into a 409 loop. The refetch brings every row that did land back `stored`,
        // with its real id.
        // `edits` is deliberately NOT cleared here: the failed rows keep their typed text
        // under `p{id}` so the retry writes what the user is still looking at, and the
        // orphaned `d{label}` key a succeeded derived row leaves behind is dead weight only
        // — that row now keys as `p{id}`, so `rowIsDirty` never reads it again.
        onRowsSaved()
      })
      .finally(() => setSaving(false))
  }

  // Un-store a row: deleting the stored period hands the slot back to the derived planner,
  // which is exactly what "reset to the derived values" means here.
  const resetRow = (row: EsppModelerPeriod) => {
    if (row.id === null) return
    if (!window.confirm(`Reset ${row.label} to its derived values?`)) return
    setSaving(true)
    setError(null)
    deletePeriod(row.id)
      .then(() => {
        setEdits((cur) => {
          const next = { ...cur }
          delete next[rowKey(row)]
          return next
        })
        onRowsSaved()
      })
      .catch((err: unknown) => setError(message(err, 'Reset failed')))
      .finally(() => setSaving(false))
  }

  const working = busy || saving

  return (
    <section className="card" data-entry-scope="">
      <h2 className="eyebrow">
        Purchase modeler{data === null ? '' : ` — ${data.year}`}
        <InfoHint text="What each period buys: your entered base and contribution % chained against the $25k IRS limit, priced at each period's offering subscription price and a 15% discount on the lower of it and the FMV." />
      </h2>
      {data !== null && data.available_years.length > 1 && (
        // The app's segmented control (panels.css .segmented / button.active).
        <div className="segmented" role="group" aria-label="Modeled year">
          {data.available_years.map((value) => (
            <button
              key={value}
              type="button"
              className={value === data.year ? 'active' : ''}
              aria-pressed={value === data.year}
              onClick={() => onYearSelect(value)}
            >
              {value}
            </button>
          ))}
        </div>
      )}
      <p className="drill-hint">
        Leave the knobs blank and the model uses your offerings for each period&apos;s
        subscription price and the latest quote for the FMV — type a value to override the
        whole year. Base, additional and contribution % are saved per period.
      </p>
      <form
        className="espp-form espp-knobs"
        onSubmit={(e) => {
          e.preventDefault()
          saveAndRecalculate()
        }}
      >
        {/* The two prices are kind="plain" by the app-wide scale rule — they stand against
            5dp columns, where a "$170.79" echo would round the override the chain is run
            at — while the carry-forward is genuinely 2dp money and keeps the default, "="
            arithmetic included. The placeholders name what BLANK resolves to; nothing here
            is ever seeded from the payload (spec §6.2). */}
        <label>
          Subscription price
          <AmountInput
            kind="plain"
            value={knobs.subscription}
            onValueChange={setKnob('subscription')}
            placeholder="from offerings"
          />
        </label>
        <label>
          Purchase FMV
          <AmountInput
            kind="plain"
            value={knobs.fmv}
            onValueChange={setKnob('fmv')}
            placeholder="latest quote"
          />
        </label>
        <label>
          Carry-forward
          <AmountInput value={knobs.carry} onValueChange={setKnob('carry')} placeholder="0" />
        </label>
        <div className="espp-form-actions">
          <button
            type="submit"
            className="button button-primary"
            data-entry-primary=""
            disabled={working}
          >
            {working ? 'Working…' : 'Save & recalculate'}
          </button>
        </div>
      </form>
      <FeedBanner error={error} />
      {dirtyRows.length > 0 && (
        <p className="drill-hint" role="status">
          {`${dirtyRows.length} ${
            dirtyRows.length === 1 ? 'period has' : 'periods have'
          } unsaved edits — the chain below is stale until you save & recalculate.`}
        </p>
      )}
      {data !== null && (
        <>
          <p className="drill-hint">{sourceLine(data)}</p>
          {/* Advisory, not an error: the chain still ran (net-worth-projection precedent). */}
          {data.warnings.map((warning) => (
            <p key={warning} className="drill-hint espp-warning">
              {warning}
            </p>
          ))}
          <div className="gauge">
            {/* A meter, not a progressbar: this is a filled quantity within a known range,
                not the progress of a task. The value is the server's total; only the WIDTH
                divides, and it is clamped so an over-limit total cannot overflow the bar. */}
            <div
              className="gauge-track"
              role="meter"
              aria-label={`${formatCurrency(LIMIT_25K)} limit used in ${data.year}`}
              aria-valuenow={Number(data.totals.total_25k_value)}
              aria-valuemin={0}
              aria-valuemax={LIMIT_25K}
              aria-valuetext={`${formatCurrency(data.totals.total_25k_value)} of ${formatCurrency(
                LIMIT_25K,
              )}`}
            >
              <div
                className="gauge-fill"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (Number(data.totals.total_25k_value) / LIMIT_25K) * 100),
                  ).toFixed(2)}%`,
                }}
              />
            </div>
            <div className="gauge-labels">
              <span>{`${formatCurrency(data.totals.total_25k_value)} used`}</span>
              {/* The SERVER's remainder — never 25000 minus the total re-derived here. */}
              <span>{`${formatCurrency(data.totals.remaining_25k)} left`}</span>
            </div>
          </div>
          <div className="kpi-row">
            <div className="stat-tile">
              <div className="stat-label">
                Out of pocket
                <InfoHint text="Your contributions after the carry-forward — what the purchase actually costs you." />
              </div>
              <div className="stat-value">{formatCurrency(data.totals.out_of_pocket_cost)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">
                FMV of shares
                <InfoHint text="The purchased shares valued at the period&apos;s fair market value." />
              </div>
              <div className="stat-value">{formatCurrency(data.totals.fmv_of_shares)}</div>
            </div>
          </div>
          <div className="espp-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="num">Subscription</th>
                  <th className="num">Base</th>
                  <th className="num">Additional</th>
                  <th className="num">Contrib %</th>
                  <th className="num">Contribution</th>
                  <th className="num">Available</th>
                  <th className="num">Price</th>
                  <th className="num">Shares</th>
                  <th className="num">Cost</th>
                  <th className="num">Refund</th>
                  <th className="num">Carry out</th>
                  <th className="num">25k value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.periods.map((row) => (
                  <tr key={rowKey(row)}>
                    <td>
                      {row.label}
                      {!row.stored && <span className="badge">derived</span>}
                      {row.over_limit && <span className="badge">Over limit</span>}
                      <span className="drill-hint espp-period-dates">
                        {`${formatDate(row.period_start)} – ${formatDate(row.period_end)}`}
                      </span>
                    </td>
                    <td className="num">
                      {/* 5dp column — verbatim. Provenance under it. */}
                      {row.subscription_price}
                      <span className="drill-hint espp-period-dates">
                        {row.offering_start !== null
                          ? `${formatDate(row.offering_start)} offering`
                          : data.subscription_source === 'override'
                            ? 'override'
                            : 'latest quote'}
                      </span>
                    </td>
                    <td className="num espp-cell">
                      <AmountInput
                        value={cellValue(row, 'base')}
                        onValueChange={editCell(rowKey(row), 'base')}
                        aria-label={`${row.label} semi-annual base`}
                      />
                    </td>
                    <td className="num espp-cell">
                      <AmountInput
                        value={cellValue(row, 'additional')}
                        onValueChange={editCell(rowKey(row), 'additional')}
                        aria-label={`${row.label} additional payments`}
                      />
                    </td>
                    <td className="num espp-cell">
                      {/* Human scale in the box ("14" = 14%, echoed "14%"); the shift to the
                          stored 9dp fraction happens at the wire, in saveAndRecalculate. */}
                      <AmountInput
                        kind="percent"
                        value={cellValue(row, 'pct')}
                        onValueChange={editCell(rowKey(row), 'pct')}
                        aria-label={`${row.label} contribution percent`}
                      />
                    </td>
                    <td className="num">{formatCurrency(row.contribution)}</td>
                    <td className="num">{formatCurrency(row.available)}</td>
                    <td className="num">{formatCurrency(row.purchase_price)}</td>
                    <td className="num">{formatShares(row.shares)}</td>
                    <td className="num">{formatCurrency(row.cost)}</td>
                    <td className="num">{formatCurrency(row.refund)}</td>
                    <td className="num">{formatCurrency(row.carry_forward_out)}</td>
                    <td className="num">{formatCurrency(row.value_25k)}</td>
                    <td className="row-actions">
                      {row.stored && (
                        <button
                          type="button"
                          className="button"
                          aria-label={`Reset ${row.label} to derived values`}
                          disabled={working}
                          onClick={() => resetRow(row)}
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────────────

export default function EsppPage() {
  const [lots, setLots] = useState<EsppLotsResponse | null>(
    () => getSnapshot<EsppLotsResponse>('espp:lots') ?? null,
  )
  const [lotsError, setLotsError] = useState<string | null>(null)
  const [lotsBusy, setLotsBusy] = useState(true)

  const [offerings, setOfferings] = useState<EsppOfferingOut[] | null>(
    () => getSnapshot<EsppOfferingOut[]>('espp:offerings') ?? null,
  )
  const [offeringsError, setOfferingsError] = useState<string | null>(null)
  const [offeringsBusy, setOfferingsBusy] = useState(true)
  // Employer closes for the "use close" chip — best-effort: a miss just hides the chip.
  const [bars, setBars] = useState<PricePoint[]>([])

  const [modeler, setModeler] = useState<EsppModelerOut | null>(
    () => getSnapshot<EsppModelerOut>('espp:modeler:default') ?? null,
  )
  const [modelerError, setModelerError] = useState<string | null>(null)
  const [modelerBusy, setModelerBusy] = useState(true)
  // Mirrors the modeler card's derived dirty-rows flag (its onDirtyChange): the page-top
  // $25k tile wears the SAME stale cue the card raises, or the headline would keep
  // asserting a figure the card below disclaims (2026-08-31 review round).
  const [modelerDirty, setModelerDirty] = useState(false)
  // Knobs are NEVER seeded from the echo (spec §6.2): blank means the smart default —
  // subscription from offerings, FMV from the latest quote — and the provenance line
  // says what blank resolved to. They live here so a failed recalculate keeps them.
  const [knobs, setKnobs] = useState<Knobs>({ subscription: '', fmv: '', carry: '' })
  // null = the server's default (the current calendar year).
  const [year, setYear] = useState<number | null>(null)

  // Three INDEPENDENT loads: a modeler 422 must not blank the lots table, so each carries
  // its own sequence guard, its own banner and its own busy flag.
  const lotsSeq = useRef(0)
  const offeringsSeq = useRef(0)
  const modelerSeq = useRef(0)
  const barsFetched = useRef(false)

  // Promise callbacks only — no setState in an effect's synchronous body (react-hooks 7).
  const loadLots = () => {
    const seq = ++lotsSeq.current
    fetchLots()
      .then((data) => {
        if (seq !== lotsSeq.current) return
        // Lazy, once: the chip's bars need the employer ticker, which this payload names.
        // BEFORE the equality skip — the bars are uncached and must arm on any resolution.
        if (!barsFetched.current && data.espp_ticker !== null) {
          barsFetched.current = true
          fetchPriceHistory(data.espp_ticker, 3650)
            .then((history) => setBars(history.points))
            .catch(() => setBars([]))
        }
        const previous = getSnapshot<EsppLotsResponse>('espp:lots')
        setSnapshot('espp:lots', data)
        setLotsError(null)
        // Identical payload: nothing re-renders (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setLots(data)
      })
      .catch((err: unknown) => {
        if (seq !== lotsSeq.current) return
        // The previous payload is KEPT: a failed reload here describes the same lots, and
        // dropping them would also destroy a half-typed row in the panel's form.
        setLotsError(message(err, 'Failed to load ESPP lots'))
      })
      .finally(() => {
        if (seq === lotsSeq.current) setLotsBusy(false)
      })
  }

  const loadOfferings = () => {
    const seq = ++offeringsSeq.current
    fetchOfferings()
      .then((data) => {
        if (seq !== offeringsSeq.current) return
        const previous = getSnapshot<EsppOfferingOut[]>('espp:offerings')
        setSnapshot('espp:offerings', data)
        setOfferingsError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setOfferings(data)
      })
      .catch((err: unknown) => {
        if (seq !== offeringsSeq.current) return
        setOfferingsError(message(err, 'Failed to load offerings'))
      })
      .finally(() => {
        if (seq === offeringsSeq.current) setOfferingsBusy(false)
      })
  }

  // `cacheKey` is passed for the MOUNT's default run only: knob-driven runs are
  // user-parameterized and must not collide with the default in the snapshot cache.
  const loadModeler = (params: ModelerParams = {}, cacheKey?: string) => {
    const seq = ++modelerSeq.current
    fetchModeler(params)
      .then((data) => {
        if (seq !== modelerSeq.current) return
        if (cacheKey !== undefined) {
          const previous = getSnapshot<EsppModelerOut>(cacheKey)
          setSnapshot(cacheKey, data)
          setModelerError(null)
          if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data))
            return
        } else {
          setModelerError(null)
        }
        setModeler(data)
      })
      .catch((err: unknown) => {
        if (seq !== modelerSeq.current) return
        // Dropped, unlike the lots: a chain shown under knobs that did not produce it is
        // a lie. The knobs and the year survive in page state.
        setModeler(null)
        setModelerError(message(err, 'Failed to run the model'))
      })
      .finally(() => {
        if (seq === modelerSeq.current) setModelerBusy(false)
      })
  }

  useEffect(() => {
    loadLots()
    loadOfferings()
    loadModeler({}, 'espp:modeler:default')
  }, [])

  // "We are fetching" flips live in the handlers that cause a fetch, never in the effect.
  const reloadLots = () => {
    setLotsBusy(true)
    setLotsError(null)
    loadLots()
  }

  // Blank knobs are OMITTED from the query (src/api/espp.ts) — blank means the server's
  // smart default, which is the whole point of the offerings feature. The canonical belt
  // is here, at the read site: a knob typed and saved without a blur must not put
  // "$170.79" in the URL for Decimal() to choke on.
  const runModeler = (yearOverride?: number | null) => {
    const target = yearOverride !== undefined ? yearOverride : year
    setModelerBusy(true)
    setModelerError(null)
    loadModeler({
      subscriptionPrice: canonicalAmount(knobs.subscription.trim(), { expressions: false }),
      purchaseFmv: canonicalAmount(knobs.fmv.trim(), { expressions: false }),
      carryForward: canonicalAmount(knobs.carry.trim()),
      year: target ?? undefined,
    })
  }

  // The chip's year has to travel with THIS run: setYear only lands on the next render.
  const selectYear = (value: number) => {
    setYear(value)
    runModeler(value)
  }

  // An offering write re-prices the chain; a modeler-row save moves it. Both re-run with
  // the CURRENT knobs and year.
  const onOfferingsChanged = () => {
    setOfferingsBusy(true)
    setOfferingsError(null)
    loadOfferings()
    runModeler()
  }

  return (
    <div className="page espp-page">
      <PageFrame title="ESPP" resource={{ status: 'ready' }}>
        {/* The modeler's $25k figure at the page top (2026-08-31 audit: the gauge sat below
            the fold). The MODELER's chain — its year and knobs — so it can never disagree
            with the card below; absent until that feed answers, exactly like the card. */}
        {modeler !== null && (
          <div className={`loading-dim${modelerBusy ? ' is-loading' : ''}`}>
            {/* kpi-row-lone: the lone tile must not stretch the full grid width; the modeler
                card's own two-tile kpi-row below keeps its natural width. */}
            <div className="kpi-row kpi-row-lone">
              <StatTile
                label={`$25k limit used — ${modeler.year}`}
                value={formatCurrency(modeler.totals.total_25k_value)}
                delta={`${formatCurrency(modeler.totals.remaining_25k)} left`}
                tone="neutral"
                hint="The Purchase modeler's chained total against the IRS §423 ceiling, at its current year and knobs — the gauge in that card draws the same figure long."
              />
            </div>
            {/* The card's own dirty note, echoed beside the headline it disclaims — the tile
                and the gauge must never disagree silently (2026-08-31 review round). */}
            {modelerDirty && (
              <p className="hint">
                Unsaved period edits below — this figure is stale until you save &amp;
                recalculate.
              </p>
            )}
          </div>
        )}

        {/* NOT keyed, and a sibling of the two cards below: a modeler or offerings refetch
            re-renders this panel with the same payload, so a half-typed row survives. */}
        <Feed
          data={lots}
          error={lotsError}
          busy={lotsBusy}
          staleNoun="the table"
          retry={reloadLots}
          retryLabel="Retry loading lots"
          skeleton={{ height: 260, label: 'Loading lots…' }}
        >
          {(data) => <LotsPanel data={data} offerings={offerings ?? []} onChanged={reloadLots} />}
        </Feed>

        <Feed
          data={offerings}
          error={offeringsError}
          busy={offeringsBusy}
          staleNoun="the table"
          retry={onOfferingsChanged}
          retryLabel="Retry loading offerings"
          skeleton={{ height: 220, label: 'Loading offerings…' }}
        >
          {(rows) => <OfferingsPanel offerings={rows} bars={bars} onChanged={onOfferingsChanged} />}
        </Feed>

        {/* No stale cue: the card renders its own empty state from a null payload, so there
            is never an earlier model left behind the banner. */}
        <FeedBanner error={modelerError} retry={() => runModeler()} retryLabel="Retry the model" />
        <div className={`loading-dim${modelerBusy ? ' is-loading' : ''}`}>
          <ModelerCard
            data={modeler}
            knobs={knobs}
            // The setter itself: the card hands back an updater, so a keystroke cannot
            // spread a stale sibling over its neighbour.
            onKnobChange={setKnobs}
            onRun={runModeler}
            onYearSelect={selectYear}
            onRowsSaved={() => runModeler()}
            onDirtyChange={setModelerDirty}
            busy={modelerBusy}
          />
        </div>
      </PageFrame>
    </div>
  )
}
