import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  createLot,
  createPeriod,
  deleteLot,
  deletePeriod,
  fetchLots,
  fetchModeler,
  fetchPeriods,
  updateLot,
  updatePeriod,
} from '../api/espp'
import type { ModelerParams } from '../api/espp'
import type {
  EsppLotCreate,
  EsppLotOut,
  EsppLotsResponse,
  EsppLotUpdate,
  EsppModelerOut,
  EsppPeriodCreate,
  EsppPeriodOut,
} from '../types/api'
import { formatCurrency, formatDate, formatPct, formatShares } from '../utils/format'
import '../components/panels.css'
import './EsppPage.css'

// The IRS §423 ceiling the chain is modeled against (backend espp_calc: unused_25k starts
// here). Nothing on the page is DERIVED from it: it feeds the gauge's denominator (the
// fill width) and the meter's aria-valuemax/aria-label/aria-valuetext, and that is all —
// "remaining" is the server's own number.
const LIMIT_25K = 25000

/**
 * Move a decimal string's point by `places`, keeping every digit exact.
 *
 * The same helper as BracketsEditor's (src/components/taxes/BracketsEditor.tsx), copied
 * rather than shared: it lives in a component file, and exporting a non-component from one
 * costs a react-refresh warning. The reason is identical — the form shows percents while
 * contribution_pct stores a fraction, and float division makes that round trip lossy
 * (11 / 100 is 0.11000000000000001 in binary, and that string would be saved as the
 * period's real contribution rate). Shifting the point pins "11" -> "0.11" (and back).
 *
 * Anything that is not a plain decimal is handed back untouched — the server's 422 is the
 * backstop for text no conversion should guess at.
 */
function shiftPoint(raw: string, places: number): string {
  const text = raw.trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match) return text
  const [, sign, whole, frac = ''] = match
  const digits = `${whole}${frac}`
  if (digits === '') return text
  let point = whole.length + places
  let shifted = digits
  if (point <= 0) {
    shifted = `${'0'.repeat(1 - point)}${digits}` // one leading zero survives: "0.11"
    point = 1
  } else if (point > shifted.length) {
    shifted = shifted.padEnd(point, '0')
  }
  const head = shifted.slice(0, point).replace(/^0+(?=\d)/, '')
  const tail = shifted.slice(point).replace(/0+$/, '')
  return `${sign}${tail === '' ? head : `${head}.${tail}`}`
}

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

/**
 * The lots table and the one form that doubles as add-row and row editor (TransactionsPanel
 * idiom). It owns its form state, and the page hands it a replaced `lots` payload rather
 * than remounting it — so a modeler or periods refetch cannot destroy a half-typed row.
 */
function LotsPanel({ data, onChanged }: { data: EsppLotsResponse; onChanged: () => void }) {
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

  const submit = () => {
    const shares = form.shares.trim()
    const subscription = form.subscription_price.trim()
    const fmv = form.purchase_fmv.trim()
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
    const soldPrice = form.sold_price.trim()
    if ((soldDate === '') !== (soldPrice === '')) {
      // The server's own sentence, one vocabulary — its 422 is the backstop, this is the
      // round trip saved (BracketsEditor's rule).
      setError('sold_date and sold_price must be set together')
      return
    }
    const price = form.purchase_price.trim()
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
      <h2 className="eyebrow">Lots</h2>
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
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
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
            className="field-input"
            type="date"
            value={form.purchase_date}
            onChange={(e) => set('purchase_date')(e.target.value)}
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
        <label>
          Shares
          <input
            className="field-input"
            inputMode="decimal"
            value={form.shares}
            onChange={(e) => set('shares')(e.target.value)}
          />
        </label>
        <label>
          Subscription
          <input
            className="field-input"
            inputMode="decimal"
            value={form.subscription_price}
            onChange={(e) => set('subscription_price')(e.target.value)}
          />
        </label>
        <label>
          FMV
          <input
            className="field-input"
            inputMode="decimal"
            value={form.purchase_fmv}
            onChange={(e) => set('purchase_fmv')(e.target.value)}
          />
        </label>
        <label>
          Purchase price
          <input
            className="field-input"
            inputMode="decimal"
            value={form.purchase_price}
            onChange={(e) => set('purchase_price')(e.target.value)}
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
          <input
            className="field-input"
            inputMode="decimal"
            value={form.sold_price}
            onChange={(e) => set('sold_price')(e.target.value)}
          />
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

function ModelerCard({
  data,
  knobs,
  onKnobChange,
  onRecalculate,
  busy,
}: {
  data: EsppModelerOut | null
  knobs: Knobs
  onKnobChange: (update: (current: Knobs) => Knobs) => void
  onRecalculate: () => void
  busy: boolean
}) {
  // An UPDATER, never `{ ...knobs, field: value }`: the seed below lands through the same
  // setter, and React batches. A keystroke built from the props' `knobs` snapshot would
  // resurrect the pre-seed siblings it spread — the panels' `set` helper, one field at a
  // time, is the same shape for the same reason.
  const setKnob = (field: keyof Knobs) => (value: string) =>
    onKnobChange((current) => ({ ...current, [field]: value }))

  return (
    <section className="card">
      <h2 className="eyebrow">Purchase modeler{data === null ? '' : ` — ${data.year}`}</h2>
      <p className="drill-hint">
        Nothing here is stored: the two prices and the opening carry-forward are what-if
        knobs over the periods below. Clear a price and the model falls back to the ESPP
        ticker&apos;s latest quote — custom prices need BOTH of them.
      </p>
      <form
        className="espp-form espp-knobs"
        onSubmit={(e) => {
          e.preventDefault()
          onRecalculate()
        }}
      >
        <label>
          Subscription price
          <input
            className="field-input"
            inputMode="decimal"
            value={knobs.subscription}
            onChange={(e) => setKnob('subscription')(e.target.value)}
          />
        </label>
        <label>
          Purchase FMV
          <input
            className="field-input"
            inputMode="decimal"
            value={knobs.fmv}
            onChange={(e) => setKnob('fmv')(e.target.value)}
          />
        </label>
        <label>
          Carry-forward
          <input
            className="field-input"
            inputMode="decimal"
            value={knobs.carry}
            onChange={(e) => setKnob('carry')(e.target.value)}
          />
        </label>
        <div className="espp-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Modeling…' : 'Recalculate'}
          </button>
        </div>
      </form>
      {data !== null && (
        <>
          <p className="drill-hint">
            {data.price_source === 'latest_price'
              ? `using latest ${data.espp_ticker ?? 'ESPP ticker'} quote (as of ${formatDate(
                  data.quoted_at,
                )})`
              : 'custom prices'}
          </p>
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
              <div className="stat-label">Out of pocket</div>
              <div className="stat-value">{formatCurrency(data.totals.out_of_pocket_cost)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">FMV of shares</div>
              <div className="stat-value">{formatCurrency(data.totals.fmv_of_shares)}</div>
            </div>
          </div>
          <div className="espp-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="num">Shares</th>
                  <th className="num">Cost</th>
                  <th className="num">Refund</th>
                  <th className="num">Carry out</th>
                  <th className="num">25k value</th>
                </tr>
              </thead>
              <tbody>
                {data.periods.map((period) => (
                  <tr key={period.id}>
                    <td>
                      {period.label}
                      {period.over_limit && <span className="badge">Over limit</span>}
                    </td>
                    <td className="num">{formatShares(period.shares)}</td>
                    <td className="num">{formatCurrency(period.cost)}</td>
                    <td className="num">{formatCurrency(period.refund)}</td>
                    <td className="num">{formatCurrency(period.carry_forward_out)}</td>
                    <td className="num">{formatCurrency(period.value_25k)}</td>
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

// ── Periods ─────────────────────────────────────────────────────────────────────────────

interface PeriodFormState {
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments: string
  contribution_pct: string // percent form — "14", never "0.140000000"
}

const EMPTY_PERIOD: PeriodFormState = {
  label: '', period_start: '', period_end: '', semi_annual_base: '',
  additional_payments: '', contribution_pct: '',
}

function PeriodsPanel({
  periods,
  onChanged,
}: {
  periods: EsppPeriodOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<PeriodFormState>(EMPTY_PERIOD)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (field: keyof PeriodFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (period: EsppPeriodOut) => {
    setEditingId(period.id)
    setForm({
      label: period.label,
      period_start: period.period_start,
      period_end: period.period_end,
      semi_annual_base: period.semi_annual_base,
      additional_payments: period.additional_payments,
      contribution_pct: shiftPoint(period.contribution_pct, 2),
    })
  }

  const submit = () => {
    const label = form.label.trim()
    const base = form.semi_annual_base.trim()
    const pct = form.contribution_pct.trim()
    if (!label || !form.period_start || !form.period_end || !base || !pct) {
      setError('Label, both dates, the base and the contribution % are required')
      return
    }
    if (form.period_end <= form.period_start) {
      // The server's own sentence — already date-phrased, so it reads on screen. ISO
      // strings from two <input type="date">, so the string compare IS the date compare.
      setError('period_end must be after period_start')
      return
    }
    const pctNumber = Number(pct)
    if (Number.isFinite(pctNumber) && (pctNumber < 0 || pctNumber > 100)) {
      // NOT the server's "contribution_pct must be between 0 and 1": that sentence is in
      // the STORED fraction's vocabulary, and this box is labelled "Contribution %" and
      // holds 14 for 14%. Quoting it verbatim would tell the user their 14 was too big
      // and their 0.5 was fine — the opposite of what this form means.
      // Text that is not a number at all falls through on purpose: shiftPoint hands it
      // back untouched and the server's 422 is the backstop (no conversion guesses here).
      setError('contribution % must be between 0 and 100')
      return
    }
    setBusy(true)
    setError(null)
    // The FULL row on both verbs (Task 4 review M6's binding): the router validates the
    // MERGED period, so a delta PATCH would 422 on a stored field this form never touched.
    const body: EsppPeriodCreate = {
      label,
      period_start: form.period_start,
      period_end: form.period_end,
      semi_annual_base: base,
      // Blank is a real zero here, not "leave it alone": the box was prefilled from the row.
      additional_payments: form.additional_payments.trim() || '0',
      contribution_pct: shiftPoint(pct, -2),
    }
    const request = editingId !== null ? updatePeriod(editingId, body) : createPeriod(body)
    request
      .then(() => {
        setForm(EMPTY_PERIOD)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const remove = (period: EsppPeriodOut) => {
    if (!window.confirm(`Delete the ${period.label} period?`)) return
    setBusy(true)
    // Cleared on entry like submit's (LotsPanel.remove's note).
    setError(null)
    deletePeriod(period.id)
      .then(() => {
        if (period.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_PERIOD)
        }
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">Offering periods</h2>
      <p className="drill-hint">
        The stored half of the model — the modeler chains these in period-end order, within
        one calendar year. Contribution is entered as a percent (14 = 14%) and stored as a
        fraction with 9 decimal places. Editing a period re-runs the model.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
        className="espp-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Label
          <input
            className="field-input"
            value={form.label}
            onChange={(e) => set('label')(e.target.value)}
          />
        </label>
        <label>
          Period start
          <input
            className="field-input"
            type="date"
            value={form.period_start}
            onChange={(e) => set('period_start')(e.target.value)}
          />
        </label>
        <label>
          Period end
          <input
            className="field-input"
            type="date"
            value={form.period_end}
            onChange={(e) => set('period_end')(e.target.value)}
          />
        </label>
        <label>
          Semi-annual base
          <input
            className="field-input"
            inputMode="decimal"
            value={form.semi_annual_base}
            onChange={(e) => set('semi_annual_base')(e.target.value)}
          />
        </label>
        <label>
          Additional payments
          <input
            className="field-input"
            inputMode="decimal"
            value={form.additional_payments}
            onChange={(e) => set('additional_payments')(e.target.value)}
          />
        </label>
        <label>
          Contribution %
          <input
            className="field-input"
            inputMode="decimal"
            value={form.contribution_pct}
            onChange={(e) => set('contribution_pct')(e.target.value)}
          />
        </label>
        <div className="espp-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save period' : 'Add period'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the period edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_PERIOD)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {periods.length === 0 ? (
        <p className="empty-note">No offering periods yet.</p>
      ) : (
        <div className="espp-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Start</th>
                <th>End</th>
                <th className="num">Base</th>
                <th className="num">Additional</th>
                <th className="num">Contribution</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr
                  key={period.id}
                  className={period.id === editingId ? 'is-editing' : undefined}
                >
                  <td>{period.label}</td>
                  <td>{formatDate(period.period_start)}</td>
                  <td>{formatDate(period.period_end)}</td>
                  <td className="num">{formatCurrency(period.semi_annual_base)}</td>
                  <td className="num">{formatCurrency(period.additional_payments)}</td>
                  <td className="num">{formatPct(period.contribution_pct, { signed: false })}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit period ${period.label}`}
                      onClick={() => startEdit(period)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete period ${period.label}`}
                      disabled={busy}
                      onClick={() => remove(period)}
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

// ── Page ────────────────────────────────────────────────────────────────────────────────

export default function EsppPage() {
  const [lots, setLots] = useState<EsppLotsResponse | null>(null)
  const [lotsError, setLotsError] = useState<string | null>(null)
  const [lotsBusy, setLotsBusy] = useState(true)

  const [modeler, setModeler] = useState<EsppModelerOut | null>(null)
  const [modelerError, setModelerError] = useState<string | null>(null)
  // The 404 branch is not an error to recover from — it is "there is nothing to model yet",
  // and its answer is the periods section below.
  const [modelerMissing, setModelerMissing] = useState(false)
  const [modelerBusy, setModelerBusy] = useState(true)
  // The knobs live HERE, not in the card: a failed recalculate drops the chain (a model
  // shown under knobs that did not produce it is a lie), and the values the user typed to
  // get out of that failure must survive it.
  const [knobs, setKnobs] = useState<Knobs>({ subscription: '', fmv: '', carry: '' })

  const [periods, setPeriods] = useState<EsppPeriodOut[] | null>(null)
  const [periodsError, setPeriodsError] = useState<string | null>(null)
  const [periodsBusy, setPeriodsBusy] = useState(true)

  // Three INDEPENDENT loads: a modeler 404/422 must not blank the lots table, so each
  // carries its own sequence guard, its own banner and its own busy flag.
  const lotsSeq = useRef(0)
  const modelerSeq = useRef(0)
  const periodsSeq = useRef(0)
  // Seeded once, ever: every later echo would otherwise overwrite knobs mid-typing.
  const knobsSeeded = useRef(false)

  // Promise callbacks only — no setState in an effect's synchronous body (react-hooks 7).
  // The mount fetches are covered by the initial busy values; the handlers below flip them.
  const loadLots = () => {
    const seq = ++lotsSeq.current
    fetchLots()
      .then((data) => {
        if (seq !== lotsSeq.current) return
        setLots(data)
        setLotsError(null)
      })
      .catch((err: unknown) => {
        if (seq !== lotsSeq.current) return
        // The previous payload is KEPT: unlike TaxesPage's year switch, a failed reload
        // here describes the same lots, and dropping them would also destroy a half-typed
        // row in the panel's form. The banner below appends the stale cue whenever a
        // table is still on screen — on a FIRST load there is none, so it says only the
        // server's sentence.
        setLotsError(message(err, 'Failed to load ESPP lots'))
      })
      .finally(() => {
        if (seq === lotsSeq.current) setLotsBusy(false)
      })
  }

  const loadModeler = (params: ModelerParams = {}) => {
    const seq = ++modelerSeq.current
    fetchModeler(params)
      .then((data) => {
        if (seq !== modelerSeq.current) return
        setModeler(data)
        setModelerError(null)
        setModelerMissing(false)
        if (!knobsSeeded.current) {
          knobsSeeded.current = true
          // The echo IS the seed: the server answers with the prices it actually used.
          // Guarded twice — once ever (a later echo must not overwrite typed knobs), and
          // per field, because the knob inputs are on screen THROUGHOUT this first load:
          // anything typed into one while it was in flight is the newer intent, while its
          // untouched neighbours still want the seed.
          setKnobs((current) => ({
            subscription:
              current.subscription === '' ? data.subscription_price : current.subscription,
            fmv: current.fmv === '' ? data.purchase_fmv : current.fmv,
            carry: current.carry === '' ? data.carry_forward : current.carry,
          }))
        }
      })
      .catch((err: unknown) => {
        if (seq !== modelerSeq.current) return
        // Dropped, unlike the lots: the chain is a function of the knobs and the periods,
        // and leaving the last one on screen would read as the answer for the current ones.
        setModeler(null)
        setModelerMissing(err instanceof ApiError && err.status === 404)
        setModelerError(message(err, 'Failed to run the model'))
      })
      .finally(() => {
        if (seq === modelerSeq.current) setModelerBusy(false)
      })
  }

  const loadPeriods = () => {
    const seq = ++periodsSeq.current
    fetchPeriods()
      .then((data) => {
        if (seq !== periodsSeq.current) return
        setPeriods(data)
        setPeriodsError(null)
      })
      .catch((err: unknown) => {
        if (seq !== periodsSeq.current) return
        setPeriodsError(message(err, 'Failed to load offering periods'))
      })
      .finally(() => {
        if (seq === periodsSeq.current) setPeriodsBusy(false)
      })
  }

  useEffect(() => {
    loadLots()
    loadModeler()
    loadPeriods()
  }, [])

  // "We are fetching" flips live in the handlers that cause a fetch, never in the effect.
  const reloadLots = () => {
    setLotsBusy(true)
    setLotsError(null)
    loadLots()
  }

  // Blank knobs go over as '' and the client OMITS them (src/api/espp.ts: a blanked
  // controlled input would otherwise 422 as Decimal('')), which is exactly the
  // fall-back-to-the-latest-quote path the hint above describes.
  const runModeler = () => {
    setModelerBusy(true)
    setModelerError(null)
    // Cleared TOGETHER with the error it is a flavour of: the 404 empty state renders
    // `modelerError` as prose, so leaving `missing` up with the error gone would print a
    // literal "null — add one below…" for the whole of the re-run that adding the first
    // period just caused. Both are re-derived when this load answers.
    setModelerMissing(false)
    loadModeler({
      subscriptionPrice: knobs.subscription.trim(),
      purchaseFmv: knobs.fmv.trim(),
      carryForward: knobs.carry.trim(),
    })
  }

  const reloadPeriods = () => {
    setPeriodsBusy(true)
    setPeriodsError(null)
    loadPeriods()
  }

  // A period save or delete moves the chain, so the model is re-run with the CURRENT
  // knobs — refetching it bare would silently jump the prices back to the latest quote.
  const onPeriodsChanged = () => {
    reloadPeriods()
    runModeler()
  }

  return (
    <div className="page espp-page">
      <div className="page-header">
        <h1>ESPP</h1>
        <div className="spacer" />
      </div>

      {lotsError && (
        <div className="error-banner" role="alert">
          {/* The stale cue only when there IS something stale: a reload failure leaves the
              previous table up, a first-load failure leaves nothing to be behind. */}
          {lots === null ? lotsError : `${lotsError} — the table may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading lots" onClick={reloadLots}>
            Retry
          </button>
        </div>
      )}
      {lots === null ? (
        lotsBusy && <p className="empty-note">Loading lots…</p>
      ) : (
        <div className={`loading-dim${lotsBusy ? ' is-loading' : ''}`}>
          {/* NOT keyed, and a sibling of the two cards below: a modeler or periods refetch
              re-renders this panel with the same payload, so its half-typed row survives. */}
          <LotsPanel data={lots} onChanged={reloadLots} />
        </div>
      )}

      {modelerError !== null && !modelerMissing && (
        <div className="error-banner" role="alert">
          {modelerError}{' '}
          <button className="button" aria-label="Retry the model" onClick={runModeler}>
            Retry
          </button>
        </div>
      )}
      {modelerMissing ? (
        <section className="card">
          <h2 className="eyebrow">Purchase modeler</h2>
          {/* The server's sentence, plus where to go next. No knobs: with no periods there
              is nothing for them to model. */}
          {/* "$25,000" is written out rather than formatCurrency(LIMIT_25K): the ceiling is
              a client constant in a sentence, not a figure the server sent, and the
              "$25,000.00" the formatter would give reads as a number to go check. */}
          <p className="empty-note">
            {`${modelerError} — add one below to run the $25,000 model.`}
          </p>
        </section>
      ) : (
        <div className={`loading-dim${modelerBusy ? ' is-loading' : ''}`}>
          <ModelerCard
            data={modeler}
            knobs={knobs}
            // The setter itself: the card hands back an updater, so a keystroke that
            // batches with the echo seed cannot spread a stale sibling over it.
            onKnobChange={setKnobs}
            onRecalculate={runModeler}
            busy={modelerBusy}
          />
        </div>
      )}

      {periodsError && (
        <div className="error-banner" role="alert">
          {periods === null
            ? periodsError
            : `${periodsError} — the table may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading periods" onClick={reloadPeriods}>
            Retry
          </button>
        </div>
      )}
      {periods === null ? (
        periodsBusy && <p className="empty-note">Loading periods…</p>
      ) : (
        <div className={`loading-dim${periodsBusy ? ' is-loading' : ''}`}>
          <PeriodsPanel periods={periods} onChanged={onPeriodsChanged} />
        </div>
      )}
    </div>
  )
}
