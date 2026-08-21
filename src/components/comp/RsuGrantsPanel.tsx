import { useState } from 'react'
import { ApiError } from '../../api/client'
import { createRsuGrant, deleteRsuGrant, updateRsuGrant } from '../../api/comp'
import InfoHint from '../InfoHint'
import type { RsuGrantCreate, RsuGrantOut, SeedCandidateOut } from '../../types/api'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { isPlainDecimal } from '../../utils/percent'

type GrantKind = RsuGrantOut['kind']

// The router's own fences (app/api/comp.py), quoted so a typo is refused here rather than
// spending a request on a 422 that says the same thing.
const YEAR_MIN = 1990
const YEAR_MAX = 2100
const SHARES_MAX = 100_000_000

/**
 * The cliff each kind vests on — spec §6, and the reason there is no cliff box.
 *
 * A new-hire grant holds 25% back for a year and then runs 6.25% quarterly; a refresh starts
 * at 6.25% on its first vest date. Both are properties of the KIND, not decisions the user
 * makes per grant, and the router only accepts a cliff that leaves a whole number of 6.25%
 * quarters — so a free-text box would be a way to fail, not a way to say anything new.
 */
const CLIFF_BY_KIND: Record<GrantKind, string> = {
  new_hire: '0.25',
  refresh: '0.0625',
}

const KIND_LABELS: Record<GrantKind, string> = {
  new_hire: 'New hire',
  refresh: 'Refresh',
}

const KINDS: GrantKind[] = ['new_hire', 'refresh']

function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

interface GrantFormState {
  kind: GrantKind
  label: string
  focal_year: string
  shares: string
  grant_price: string
  first_vest_date: string
  notes: string
}

// A grant has to be one kind or the other, and new-hire is the one a first grant usually is.
const EMPTY_GRANT: GrantFormState = {
  kind: 'new_hire', label: '', focal_year: '', shares: '',
  grant_price: '', first_vest_date: '', notes: '',
}

/**
 * The grants table and the one form that doubles as add-row and row editor (EventsPanel's
 * idiom). It owns its form state, and the page hands it a replaced `grants` array rather than
 * remounting it — so a failed reload cannot destroy a half-typed row.
 *
 * Every box's label names the ENTITY it belongs to wherever the focal-history form on the same
 * page uses the same word ("Grant focal year", "Grant notes", "Price at grant"). Two forms on
 * one page whose labels both read "Notes" are two boxes a screen reader cannot tell apart.
 */
export default function RsuGrantsPanel({
  grants,
  seedCandidates,
  onChanged,
}: {
  grants: RsuGrantOut[]
  seedCandidates: SeedCandidateOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<GrantFormState>(EMPTY_GRANT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)

  const set = (field: keyof GrantFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (grant: RsuGrantOut) => {
    setEditingId(grant.id)
    // The server's own quantized strings, verbatim: nothing is reformatted on the way into a
    // box whose contents are about to be sent back. `shares` is the one int on the wire.
    setForm({
      kind: grant.kind,
      label: grant.label,
      focal_year: grant.focal_year === null ? '' : String(grant.focal_year),
      shares: String(grant.shares),
      grant_price: grant.grant_price,
      first_vest_date: grant.first_vest_date,
      notes: grant.notes ?? '',
    })
  }

  /**
   * Prefill from a seed chip — never a POST. The chip is an offer built out of a focal year's
   * refresh RSUs, and the user still has to look at it: a grant counts WHOLE shares while
   * refresh_rsus is a 4dp Numeric, so a fractional count arrives in the box truncated, and
   * the grant it becomes is the vesting truth for years afterwards.
   */
  const prefill = (seed: SeedCandidateOut) => {
    // Any open edit is dropped first: seeding the boxes while a row is being edited would
    // PATCH that row with this offer the moment Save was pressed.
    setEditingId(null)
    setError(null)
    setForm({
      kind: 'refresh',
      label: seed.suggested_label,
      focal_year: String(seed.focal_year),
      // refresh_rsus is a 4dp Numeric ("480.0000"); the column behind the box is whole
      // shares, so the integer part is what the box takes. A fractional remainder is not
      // silently rounded up — the fence below catches a zero.
      shares: String(parseInt(seed.shares, 10)),
      grant_price: seed.grant_price,
      first_vest_date: seed.suggested_first_vest_date,
      notes: '',
    })
  }

  const submit = () => {
    const label = form.label.trim()
    const shares = form.shares.trim()
    const price = form.grant_price.trim()
    if (!label || !shares || !price || !form.first_vest_date) {
      // An empty string reaches the API as `""` and 422s as an opaque decimal-parse error
      // (TransactionsPanel's Task 14 review M2 lesson).
      setError('Label, shares, price and the first vest date are required')
      return
    }
    if (!/^\d+$/.test(shares)) {
      // The column is a whole-share int, and the box is not a decimal one: "480.6" would
      // reach the API as a float and 422 on a type the user never typed.
      setError('Shares must be a whole number')
      return
    }
    if (Number(shares) < 1 || Number(shares) > SHARES_MAX) {
      // The server's own sentence — a share count is a share count on both sides.
      setError(`shares must be between 1 and ${SHARES_MAX}`)
      return
    }
    if (!isPlainDecimal(price)) {
      // Exponent notation has NO 422 behind it: "1e-3" parses server-side as a perfectly
      // legal Decimal 0.001 and is stored (src/utils/percent.ts). This gate is the only
      // thing between that text and the column.
      setError('Price at grant must be a number')
      return
    }
    if (Number(price) <= 0) {
      setError('grant_price must be positive')
      return
    }
    const yearText = form.focal_year.trim()
    const year = yearText === '' ? null : Number(yearText)
    if (year !== null && (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX)) {
      // The server's own sentence: a year is a year on both sides, so quoting it keeps one
      // wording for one rule.
      setError(`focal_year must be between ${YEAR_MIN} and ${YEAR_MAX}`)
      return
    }
    // The row as the SERVER has it, looked up in the current feed. A stored cliff is kept
    // while the kind is unchanged — the column is Numeric(7,4) and an old grant may carry a
    // cliff this client would no longer derive — and re-derived the moment the kind flips,
    // because a new-hire cliff on a refresh grant is the wrong schedule.
    const stored = grants.find((g) => g.id === editingId)
    const cliff = stored && stored.kind === form.kind ? stored.cliff_pct : CLIFF_BY_KIND[form.kind]
    setBusy(true)
    setError(null)
    // The FULL row on both verbs (Task 4 review M6's binding): the router validates the
    // MERGED grant, so a delta PATCH would 422 on a stored field this form never touched.
    // focal_year and notes are the two nullable columns, so a blank box travels as an
    // explicit null — which on PATCH is what CLEARS them.
    const body: RsuGrantCreate = {
      kind: form.kind,
      label,
      focal_year: year,
      shares: Number(shares),
      grant_price: price,
      first_vest_date: form.first_vest_date,
      cliff_pct: cliff,
      notes: form.notes.trim() || null,
    }
    const request = editingId !== null ? updateRsuGrant(editingId, body) : createRsuGrant(body)
    request
      .then(() => {
        setForm(EMPTY_GRANT)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const remove = (grant: RsuGrantOut) => {
    if (!window.confirm(`Delete the ${grant.label} grant?`)) return
    setBusy(true)
    // Cleared on entry like submit's: a delete that succeeds must not leave the previous
    // save's 409 sitting over the panel as if it still described the table.
    setError(null)
    deleteRsuGrant(grant.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only.
        if (grant.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_GRANT)
        }
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        RSU grants
        <InfoHint text="Grant parameters only — the schedule is computed. Dashboard-only: workbook imports never touch grants." />
      </h2>
      <p className="drill-hint">
        Parameters, not tranches: the vest rows above are recomputed on every read from these
        seven fields. The cliff comes with the kind — a new hire holds 25% back for a year and
        then vests 6.25% a quarter, a refresh vests 6.25% a quarter from its first date — so
        there is no cliff box to get wrong. The focal year is only a tag that lines a grant up
        with its comp event.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {seedCandidates.length > 0 && (
        <>
          <p className="drill-hint">
            Focal years with refresh RSUs but no grant yet. A chip fills the form in and never
            saves it: a grant counts whole shares, so a fractional refresh count lands in the
            box truncated, and the grant it becomes is the vesting truth for the next four
            years. Check the boxes before saving.
          </p>
          <div className="chip-row">
            {seedCandidates.map((seed) => (
              <button
                key={seed.focal_year}
                type="button"
                className="button"
                onClick={() => prefill(seed)}
              >
                {`Add ${seed.suggested_label} — ${formatShares(seed.shares)} sh @ ${formatCurrency(
                  seed.grant_price,
                )}`}
              </button>
            ))}
          </div>
        </>
      )}
      <form
        className="comp-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Kind
          {/* dedicated handler: kind is a union, the string setter cannot write it */}
          <select
            className="field-input"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as GrantKind }))}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Label
          <input
            className="field-input"
            value={form.label}
            onChange={(e) => set('label')(e.target.value)}
          />
        </label>
        <label>
          Grant focal year
          <input
            className="field-input"
            inputMode="numeric"
            value={form.focal_year}
            onChange={(e) => set('focal_year')(e.target.value)}
          />
        </label>
        <label>
          Shares
          <input
            className="field-input"
            inputMode="numeric"
            value={form.shares}
            onChange={(e) => set('shares')(e.target.value)}
          />
        </label>
        <label>
          Price at grant
          <input
            className="field-input"
            inputMode="decimal"
            value={form.grant_price}
            onChange={(e) => set('grant_price')(e.target.value)}
          />
        </label>
        <label>
          First vest
          <input
            className="field-input"
            type="date"
            value={form.first_vest_date}
            onChange={(e) => set('first_vest_date')(e.target.value)}
          />
        </label>
        <label className="span-2">
          Grant notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="comp-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save grant' : 'Add grant'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the grant edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_GRANT)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {grants.length === 0 ? (
        <p className="empty-note">No grants yet.</p>
      ) : (
        <div className="comp-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Kind</th>
                <th className="num">Focal year</th>
                <th className="num">Shares</th>
                <th className="num">Price</th>
                <th>First vest</th>
                <th className="num">Vests</th>
                <th className="num">Vested</th>
                <th className="num">Unvested</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id} className={grant.id === editingId ? 'is-editing' : undefined}>
                  <td>{grant.label}</td>
                  <td>
                    <span className="badge">{KIND_LABELS[grant.kind]}</span>
                  </td>
                  <td className="num">{grant.focal_year ?? '—'}</td>
                  {/* The three counts on the right are the SERVER's, judged against its own
                      day — never re-derived here (global rule 9). */}
                  <td className="num">{formatShares(grant.shares)}</td>
                  <td className="num">{formatCurrency(grant.grant_price)}</td>
                  <td>{formatDate(grant.first_vest_date)}</td>
                  <td className="num">{grant.vest_count}</td>
                  <td className="num">{formatShares(grant.vested_shares)}</td>
                  <td className="num">{formatShares(grant.unvested_shares)}</td>
                  {/* The cell ellipsises a long note (CompPage.css), so the full text is the
                      hover title — `undefined`, never null, or React would render a literal
                      title="null" on every unnoted row. */}
                  <td className="comp-notes-cell" title={grant.notes ?? undefined}>
                    {grant.notes ?? '—'}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit the ${grant.label} grant`}
                      onClick={() => startEdit(grant)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete the ${grant.label} grant`}
                      disabled={busy}
                      onClick={() => remove(grant)}
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
