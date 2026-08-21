import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { createEvent, deleteEvent, fetchEvents, updateEvent } from '../api/comp'
import EChart from '../components/EChart'
import InfoHint from '../components/InfoHint'
import {
  TC_CHART_LABEL,
  tcTrajectoryOption,
} from '../components/comp/compChartOptions'
import type { CompEventCreate, CompEventOut } from '../types/api'
import { formatCurrency, formatPct, formatShares } from '../utils/format'
import '../components/panels.css'
import './CompPage.css'

// The router's own fence (app/api/comp.py MIN_FOCAL_YEAR/MAX_FOCAL_YEAR) — refuse a typo
// here rather than spending a request on a 422 that says the same thing.
const YEAR_MIN = 1990
const YEAR_MAX = 2100

function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

interface EventFormState {
  focal_year: string
  current_base: string
  new_base: string
  unvested_rsus: string
  unvested_price: string
  refresh_rsus: string
  grant_price: string
  notes: string
}

const EMPTY_EVENT: EventFormState = {
  focal_year: '', current_base: '', new_base: '', unvested_rsus: '',
  unvested_price: '', refresh_rsus: '', grant_price: '', notes: '',
}

/** The four columns that travel in pairs — a subset of both the form and the wire row. */
type EquityField = 'unvested_rsus' | 'unvested_price' | 'refresh_rsus' | 'grant_price'

/**
 * The two products the server multiplies out of this form, and the operands behind them:
 * `unvested_equity = unvested_rsus x unvested_price` and
 * `equity_delta = refresh_rsus x grant_price` (comp_calc.metrics).
 *
 * Both are null the moment EITHER side is missing, which is the whole reason the warning
 * below exists: the server takes a half-filled pair without complaint and simply stops
 * computing the product, so a cleared price silently deletes a quarter of a million
 * dollars of charted equity and says nothing about it.
 */
const EQUITY_PAIRS: {
  fields: [EquityField, EquityField]
  names: [string, string]
  product: string
}[] = [
  {
    fields: ['unvested_rsus', 'unvested_price'],
    names: ['unvested RSUs', 'unvested price'],
    product: 'unvested equity',
  },
  {
    fields: ['refresh_rsus', 'grant_price'],
    names: ['refresh RSUs', 'grant price'],
    product: 'the equity delta',
  },
]

/**
 * One sentence per pair THIS EDIT left half-filled, naming the operand orphaned by it.
 *
 * Advisory, never a gate (Task 9 binding): half a pair is a legal row — a grant whose
 * price is not known yet is a real state of the world — so this is said, not enforced. It
 * is derived from the form on every render rather than raised on submit, because the
 * damage is done at the moment the box is cleared and the user is looking at the box.
 *
 * Which is also why it is compared against `stored`, the row as the server has it: a row
 * that arrived half-paired already reads that way in the table, and greeting every open of
 * it with a warning about a state the user did not just create is how a sentence stops
 * being read (review M9). `stored` is undefined for a new row, so the first half-filled
 * pair typed into one does differ — from nothing at all — and is named.
 */
function orphanWarnings(form: EventFormState, stored: CompEventOut | undefined): string[] {
  const warnings: string[] = []
  for (const { fields, names, product } of EQUITY_PAIRS) {
    const filled = fields.map((field) => form[field].trim() !== '')
    if (filled[0] === filled[1]) continue // whole, or gone entirely — nothing orphaned
    const was = fields.map((field) => (stored?.[field] ?? '') !== '')
    if (was[0] === filled[0] && was[1] === filled[1]) continue // not this edit's doing
    const kept = filled[0] ? 0 : 1
    const gone = 1 - kept
    const subject = `${names[kept].charAt(0).toUpperCase()}${names[kept].slice(1)}`
    warnings.push(
      `${subject} is set but ${names[gone]} is blank — ${product} will be cleared, not computed.`,
    )
  }
  return warnings
}

// ── Events ──────────────────────────────────────────────────────────────────────────────

/**
 * The focal-history table and the one form that doubles as add-row and row editor
 * (TransactionsPanel / EsppPage idiom). It owns its form state, and the page hands it a
 * replaced `events` array rather than remounting it — so a failed reload cannot destroy a
 * half-typed row.
 */
function EventsPanel({
  events,
  onChanged,
}: {
  events: CompEventOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<EventFormState>(EMPTY_EVENT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)

  const set = (field: keyof EventFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (event: CompEventOut) => {
    setEditingId(event.id)
    // The server's own quantized strings, verbatim: nothing is reformatted on the way into
    // a box whose contents are about to be sent back.
    setForm({
      focal_year: String(event.focal_year),
      current_base: event.current_base,
      new_base: event.new_base ?? '',
      unvested_rsus: event.unvested_rsus ?? '',
      unvested_price: event.unvested_price ?? '',
      refresh_rsus: event.refresh_rsus ?? '',
      grant_price: event.grant_price ?? '',
      notes: event.notes ?? '',
    })
  }

  const submit = () => {
    const yearText = form.focal_year.trim()
    const base = form.current_base.trim()
    if (!yearText || !base) {
      // An empty string reaches the API as `""` and 422s as an opaque decimal-parse error
      // (TransactionsPanel's Task 14 review M2 lesson).
      setError('Focal year and current base are required')
      return
    }
    const year = Number(yearText)
    if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
      // The server's own sentence: it is already in this box's vocabulary (a year is a
      // year on both sides), so quoting it keeps one wording for one rule.
      setError(`focal_year must be between ${YEAR_MIN} and ${YEAR_MAX}`)
      return
    }
    setBusy(true)
    setError(null)
    // The FULL row on both verbs (Task 4 review M6's binding): the router validates the
    // MERGED event, so a delta PATCH would 422 on a stored field this form never touched.
    // Every nullable column travels as an explicit null when its box is blank — on PATCH
    // that is comp's ratified CLEAR (the one router where null is not a no-op), and on
    // POST it is simply the column's own default said out loud.
    const blank = (field: keyof EventFormState) => form[field].trim() || null
    const body: CompEventCreate = {
      focal_year: year,
      current_base: base,
      new_base: blank('new_base'),
      unvested_rsus: blank('unvested_rsus'),
      unvested_price: blank('unvested_price'),
      refresh_rsus: blank('refresh_rsus'),
      grant_price: blank('grant_price'),
      notes: blank('notes'),
    }
    const request = editingId !== null ? updateEvent(editingId, body) : createEvent(body)
    request
      .then(() => {
        setForm(EMPTY_EVENT)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const remove = (event: CompEventOut) => {
    if (!window.confirm(`Delete the ${event.focal_year} comp event?`)) return
    setBusy(true)
    // Cleared on entry like submit's: a delete that succeeds must not leave the previous
    // save's 409 sitting over the panel as if it still described the table.
    setError(null)
    deleteEvent(event.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only.
        if (event.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_EVENT)
        }
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  // The row being edited, as the SERVER has it — looked up in the current feed, so a
  // reload that replaces the array keeps answering for the same id.
  const orphans = orphanWarnings(form, events.find((e) => e.id === editingId))

  return (
    <section className="card">
      <h2 className="eyebrow">
        Focal history
        <InfoHint text="One row per focal year: base moves, grants, and the computed equity and TC deltas. Everything right of the notes is computed by the server." />
      </h2>
      <p className="drill-hint">
        One row per focal year. The base is the salary the year started on and the new base
        is what it moved to — leave it blank for a year without a raise. RSU counts and
        their prices travel in pairs: the unvested pair values the equity already granted,
        the refresh pair values the new grant. Everything to the right of the notes is
        computed by the server at read time.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {orphans.length > 0 && (
        // Not an error banner: nothing failed and nothing is blocked. React text nodes, so
        // the sentences are escaped by construction — though every one of them is this
        // file's own constant.
        <div className="comp-warnings">
          {orphans.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      <form
        className="comp-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Focal year
          <input
            className="field-input"
            inputMode="numeric"
            value={form.focal_year}
            onChange={(e) => set('focal_year')(e.target.value)}
          />
        </label>
        <label>
          Current base
          <input
            className="field-input"
            inputMode="decimal"
            value={form.current_base}
            onChange={(e) => set('current_base')(e.target.value)}
          />
        </label>
        <label>
          New base
          <input
            className="field-input"
            inputMode="decimal"
            value={form.new_base}
            onChange={(e) => set('new_base')(e.target.value)}
          />
        </label>
        <label>
          Unvested RSUs
          <input
            className="field-input"
            inputMode="decimal"
            value={form.unvested_rsus}
            onChange={(e) => set('unvested_rsus')(e.target.value)}
          />
        </label>
        <label>
          Unvested price
          <input
            className="field-input"
            inputMode="decimal"
            value={form.unvested_price}
            onChange={(e) => set('unvested_price')(e.target.value)}
          />
        </label>
        <label>
          Refresh RSUs
          <input
            className="field-input"
            inputMode="decimal"
            value={form.refresh_rsus}
            onChange={(e) => set('refresh_rsus')(e.target.value)}
          />
        </label>
        <label>
          Grant price
          <input
            className="field-input"
            inputMode="decimal"
            value={form.grant_price}
            onChange={(e) => set('grant_price')(e.target.value)}
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
        <div className="comp-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save event' : 'Add event'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the comp event edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_EVENT)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {events.length > 0 && (
        <div className="comp-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Current base</th>
                <th className="num">New base</th>
                <th className="num">Base delta</th>
                <th className="num">Base delta %</th>
                <th className="num">Unvested RSUs</th>
                <th className="num">Unvested price</th>
                <th className="num">Unvested equity</th>
                <th className="num">Refresh RSUs</th>
                <th className="num">Grant price</th>
                <th className="num">Equity delta</th>
                <th className="num">Equity delta %</th>
                <th className="num">TC before</th>
                <th className="num">TC after</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className={event.id === editingId ? 'is-editing' : undefined}>
                  <td>{event.focal_year}</td>
                  {/* Every figure below is the server's, rendered as it arrived — the
                      computed half is comp_calc's and none of it is re-derived here
                      (global rule 9). */}
                  <td className="num">{formatCurrency(event.current_base)}</td>
                  <td className="num">{formatCurrency(event.new_base)}</td>
                  <td className="num">{formatCurrency(event.base_delta)}</td>
                  <td className="num">{formatPct(event.base_delta_pct)}</td>
                  <td className="num">{formatShares(event.unvested_rsus)}</td>
                  <td className="num">{formatCurrency(event.unvested_price)}</td>
                  <td className="num">{formatCurrency(event.unvested_equity)}</td>
                  <td className="num">{formatShares(event.refresh_rsus)}</td>
                  <td className="num">{formatCurrency(event.grant_price)}</td>
                  <td className="num">{formatCurrency(event.equity_delta)}</td>
                  <td className="num">{formatPct(event.equity_delta_pct)}</td>
                  <td className="num">{formatCurrency(event.tc_before)}</td>
                  <td className="num">{formatCurrency(event.tc_after)}</td>
                  {/* The cell ellipsises a long note (CompPage.css), so the full text is
                      the hover title — `undefined`, never null, or React would render a
                      literal title="null" on every unnoted row. */}
                  <td className="comp-notes-cell" title={event.notes ?? undefined}>
                    {event.notes ?? '—'}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit the ${event.focal_year} comp event`}
                      onClick={() => startEdit(event)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete the ${event.focal_year} comp event`}
                      disabled={busy}
                      onClick={() => remove(event)}
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

export default function CompPage() {
  const [events, setEvents] = useState<CompEventOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  // Two writes in a row are two feeds in flight; only the newest may land or complain
  // (the seqRef recipe — NetWorthPage/PortfolioPage).
  const seqRef = useRef(0)

  // Promise callbacks only — no setState in an effect's synchronous body (react-hooks 7).
  // The mount fetch is covered by the initial busy value; the handlers below flip it.
  const load = () => {
    const seq = ++seqRef.current
    fetchEvents()
      .then((data) => {
        if (seq !== seqRef.current) return
        setEvents(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // The previous payload is KEPT: a failed reload here describes the same events,
        // and dropping them would also destroy a half-typed row in the panel's form
        // (EsppPage's same-entity rule). The banner appends the stale cue only when a
        // table is actually still on screen.
        setError(message(err, 'Failed to load comp events'))
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  useEffect(() => {
    load()
  }, [])

  // "We are fetching" flips live in the handlers that cause a fetch, never in the effect.
  const reload = () => {
    setBusy(true)
    setError(null)
    load()
  }

  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object every
  // render would replay the chart on unrelated state flips (AllocationPanel's note).
  const trajectory = useMemo(() => (events === null ? null : tcTrajectoryOption(events)), [events])

  return (
    <div className="page comp-page">
      <div className="page-header">
        <h1>Comp</h1>
        <div className="spacer" />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {/* The stale cue only when there IS something stale: a reload failure leaves the
              previous table up, a first-load failure leaves nothing to be behind. */}
          {events === null ? error : `${error} — the table may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading comp events" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      {/* Dimmed by the SAME flag as the table below it: both are drawn from one payload,
          and a chart left bright while the table under it says "may be showing earlier
          data" would be the one thing the eye is on claiming to be current. */}
      <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
        <section className="card">
          <h2 className="eyebrow">
            {TC_CHART_LABEL}
            <InfoHint text="Base salary stacked under the value of unvested equity, including the year&apos;s refresh — this app&apos;s total-comp proxy; the line is the server&apos;s own total." />
          </h2>
          <p className="drill-hint">
            Total comp as this app defines it: the base the year landed on, stacked under
            the value of the unvested equity behind it (the sheet has no TC column — this is
            the proxy, and the line is the server&apos;s own total).
          </p>
          {trajectory ? (
            <EChart option={trajectory} height={320} />
          ) : (
            events !== null && <p className="empty-note">No comp events yet — add one below.</p>
          )}
        </section>
      </div>

      {events === null ? (
        busy && <p className="empty-note">Loading comp events…</p>
      ) : (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          {/* NOT keyed: a reload re-renders this panel with a replaced array, so its
              half-typed row survives. */}
          <EventsPanel events={events} onChanged={reload} />
        </div>
      )}
    </div>
  )
}
