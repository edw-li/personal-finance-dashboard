import { useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { createDividend, deleteDividend, updateDividend } from '../../api/portfolio'
import AmountInput from '../AmountInput'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type { DividendOut, SecurityOut } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { todayIso } from '../../utils/months'
import { incomeStats, monthlyIncomeCsv, monthlyIncomeOption } from './dividendChartOptions'
import './portfolio.css'

interface FormState {
  security_id: string
  account: string
  pay_date: string
  amount: string
  notes: string
}

const EMPTY: FormState = { security_id: '', account: '', pay_date: '', amount: '', notes: '' }

// The row → form seed, TransactionsPanel's startEdit rule: the SERVER's strings verbatim,
// so a focus+blur of an untouched box is a no-op (canonicalAmount's idempotence guarantee).
function seedFrom(dividend: DividendOut): FormState {
  return {
    security_id: String(dividend.security_id),
    account: dividend.account ?? '',
    pay_date: dividend.pay_date,
    amount: dividend.amount,
    notes: dividend.notes ?? '',
  }
}

// The body both verbs share. It carries no security_id: DividendUpdate has no such field,
// so an edit cannot move a payment between tickers (delete and re-add is the honest way to
// do that) — the POST path adds it back. One builder, so the two can never drift.
function toBody(form: FormState) {
  return {
    account: form.account.trim() || null,
    pay_date: form.pay_date,
    // The wire belt: a submit reached without a blur (a click straight off the keyboard)
    // must not ship "$1,050" to a Decimal column.
    amount: canonicalAmount(form.amount),
    notes: form.notes.trim() || null,
  }
}

export default function DividendsPanel({
  securities,
  dividends,
  annualIncome,
  onChanged,
}: {
  securities: SecurityOut[]
  dividends: DividendOut[]
  /** `totals.annual_income` — a SERVER figure, rendered verbatim. */
  annualIncome: string | null
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
  // Only the CHART option is memoized (EChart keys its notMerge setOption on [option], so
  // a fresh object per keystroke in the form below would redraw it); the tiles are plain
  // numbers and memoizing them would buy nothing.
  const chart = useMemo(() => monthlyIncomeOption(dividends, todayIso()), [dividends])
  const stats = incomeStats(dividends, todayIso())

  const startEdit = (dividend: DividendOut) => {
    setEditingId(dividend.id)
    // The form now describes ONE stored row, not a run of new ones — the create session,
    // and the cue that narrates it, are over.
    setKept(false)
    setForm(seedFrom(dividend))
  }

  const submit = () => {
    // .trim() on the amount, matching TransactionsPanel's guard: whitespace is not a
    // number, and untrimmed it reaches the API as "" — an opaque pydantic decimal error.
    if (!form.security_id || !form.pay_date || !form.amount.trim()) {
      setError('Security, pay date and amount are required')
      return
    }
    setBusy(true)
    setError(null)
    const body = toBody(form)
    const request =
      editingId !== null
        ? updateDividend(editingId, body)
        : createDividend({ ...body, security_id: Number(form.security_id) })
    request
      .then(() => {
        if (editingId === null) {
          // The next payment starts here — BEFORE the reset, and that order is load-bearing
          // (998f05c's invariant, proven on the paycheck/comp/ESPP panels). This form
          // carries no data-entry-scope, so Enter is the browser's implicit submit and the
          // caret is still sitting in an AmountInput when this lands. Moving it BLURS that
          // box synchronously, and the blur's commit closes over the box's PRE-reset text —
          // canonicalizing a "$1,050" into an enqueued write that would land on top of the
          // cleared box and resurrect the payment just saved. Today's target IS the only
          // committing box on this form, so the transfer is a no-op that fires no blur at
          // all; the order is still stated, because the day this form grows a second money
          // cell the bug would otherwise arrive silently.
          // The focus-return DOM protocol (spec §5.1, plan decision 6): AmountInput exposes
          // no ref API by design, so the panel addresses its first entry cell through a
          // stable id — the arrangement `data-entry-cell` uses for the keyboard protocol.
          document.getElementById('div-amount')?.focus()
          // Carry-forward (spec §5.1): a quarter's dividends arrive as a run of rows that
          // share a security, an account and a pay date — only the payment changes.
          // Functional, so it composes over any blur write above rather than racing it.
          // `kept` says so out loud, because a form that keeps its values after a save
          // otherwise reads as a save that never happened.
          setForm((f) => ({ ...f, amount: '', notes: '' }))
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

  const remove = (dividend: DividendOut) => {
    if (!window.confirm('Delete this dividend?')) return
    deleteDividend(dividend.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3, TransactionsPanel's rule). Reset on SUCCESS only: a failed
        // delete leaves the row standing, and the edit session with it.
        if (dividend.id === editingId) {
          setEditingId(null)
          setForm(EMPTY)
        }
        // The ledger just changed under the cue — whatever entry session it narrated is over.
        setKept(false)
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      })
  }

  return (
    <section className="panel">
      <h2 className="panel-title">
        Dividends
        <InfoHint text="The dividend log. Refreshes write auto rows from real events — shares held on the ex-date × the per-share amount; manual entry covers manual-priced holdings and older history." />
      </h2>
      <p className="hint">
        Refreshes log dividends automatically for auto-priced tickers — rows marked{' '}
        <span className="badge">auto</span> are rewritten by refreshes, and deleting one
        brings it back next run. Manual entry remains for manual-priced holdings and
        history older than the refresh window. Auto amounts are recorded on the ex-date.
      </p>
      {(chart || stats.trailing12 !== null) && (
        <>
          <div className="kpi-row">
            <StatTile
              label="Trailing 12-mo income"
              value={stats.trailing12 === null ? '—' : formatCurrency(stats.trailing12)}
              hint="Dividends received in the last 12 months, including the current one."
            />
            <StatTile
              label="YTD income"
              value={stats.ytd === null ? '—' : formatCurrency(stats.ytd)}
              hint="Dividends received this calendar year."
            />
            <StatTile
              label="Projected annual income"
              value={annualIncome === null ? '—' : formatCurrency(annualIncome)}
              hint="Each holding's trailing-12-month dividend rate × shares held, summed."
            />
          </div>
          {chart && (
            <EChart
              option={chart}
              height={220}
              exportConfig={{ name: 'dividends', csv: () => monthlyIncomeCsv(dividends, todayIso()) }}
            />
          )}
        </>
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {kept && (
        // role=status: the cue appears in the same beat the focus jumps into the amount
        // box, so a screen-reader user would otherwise never learn why the form is still
        // full (InputsForm's live-region idiom). No new colors or motion — plain
        // .drill-hint, per decision 7.
        <p className="drill-hint" role="status" aria-live="polite">
          Security, account and date kept — enter the next payment.
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
          {/* disabled while editing: DividendUpdate carries no security_id, so the ticker a
              stored payment belongs to is not editable — TransactionsPanel's rule. */}
          <select
            value={form.security_id}
            disabled={editingId !== null}
            onChange={(e) => {
              // The cue claims the security was kept; the moment it is changed the
              // sentence stops being true, so it comes down with the change.
              setKept(false)
              setForm((f) => ({ ...f, security_id: e.target.value }))
            }}
          >
            <option value="">Select…</option>
            {securities.map((s) => (
              <option key={s.id} value={s.id}>{s.ticker}</option>
            ))}
          </select>
        </label>
        <label>
          Account
          {/* .field-input by hand: the shared chrome used to arrive from `.entry-form input`,
              which is now select-only — every plain text control in this form states it. */}
          <input className="field-input" value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
        </label>
        <label>
          Pay date
          <input className="field-input" type="date" value={form.pay_date} onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))} />
        </label>
        <label>
          Amount
          <AmountInput id="div-amount" value={form.amount} onValueChange={(next) => setForm((f) => ({ ...f, amount: next }))} />
        </label>
        <label className="notes-field">
          Notes
          <input className="field-input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {/* The label is the second half of the carry-forward cue: "Add another" is what
                a form still holding the last row's context is actually about to do. */}
            {editingId !== null ? 'Save changes' : kept ? 'Add another' : 'Add dividend'}
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
      {dividends.length === 0 ? (
        <p className="empty-note">No dividends recorded.</p>
      ) : (
        <table className="port-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Account</th><th>Pay date</th>
              <th className="num">Amount</th><th>Source</th>
              <th className="num">Per share</th><th>Notes</th><th />
            </tr>
          </thead>
          <tbody>
            {dividends.map((d) => (
              <tr key={d.id}>
                <td>{tickers.get(d.security_id) ?? '?'}</td>
                <td>{d.account ?? '—'}</td>
                <td>{formatDate(d.pay_date)}</td>
                <td className="num">{formatCurrency(d.amount)}</td>
                <td><span className="badge">{d.source === 'auto' ? 'auto' : 'manual'}</span></td>
                <td className="num">
                  {d.per_share === null ? '—' : formatCurrency(d.per_share)}
                  {d.shares_held !== null && (
                    <span className="sub"> × {formatShares(d.shares_held)}</span>
                  )}
                </td>
                <td className="notes-cell">{d.notes ?? ''}</td>
                {/* disabled={busy} on both: submit()'s .then closes over editingId and the
                    form as they were when it fired, so a row action taken mid-flight is
                    undone by the reset that lands after it — a seeded edit silently wiped,
                    or worse, a PATCH aimed at whatever editingId the closure still holds.
                    Shutting the row for the duration of a save is the cheap fix. */}
                <td className="row-actions">
                  {/* aria-label: a row button named just "Edit" tells a screen-reader user
                      nothing about what it edits. Delete keeps its bare name — its
                      confirm() sentence names the row before anything happens. */}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Edit this dividend"
                    onClick={() => startEdit(d)}
                  >
                    Edit
                  </button>
                  <button type="button" disabled={busy} onClick={() => remove(d)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
