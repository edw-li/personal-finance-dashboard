import { useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { createDividend, deleteDividend } from '../../api/portfolio'
import AmountInput from '../AmountInput'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type { DividendOut, SecurityOut } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { todayIso } from '../../utils/months'
import { incomeStats, monthlyIncomeOption } from './dividendChartOptions'
import './portfolio.css'

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
  const [form, setForm] = useState({ security_id: '', account: '', pay_date: '', amount: '', notes: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))
  // Only the CHART option is memoized (EChart keys its notMerge setOption on [option], so
  // a fresh object per keystroke in the form below would redraw it); the tiles are plain
  // numbers and memoizing them would buy nothing.
  const chart = useMemo(() => monthlyIncomeOption(dividends, todayIso()), [dividends])
  const stats = incomeStats(dividends, todayIso())

  const submit = () => {
    if (!form.security_id || !form.pay_date || !form.amount) {
      setError('Security, pay date and amount are required')
      return
    }
    setBusy(true)
    setError(null)
    createDividend({
      security_id: Number(form.security_id),
      account: form.account.trim() || null,
      pay_date: form.pay_date,
      // The wire belt: a submit reached without a blur (a click straight off the keyboard)
      // must not ship "$1,050" to a Decimal column.
      amount: canonicalAmount(form.amount),
      notes: form.notes.trim() || null,
    })
      .then(() => {
        setForm({ security_id: '', account: '', pay_date: '', amount: '', notes: '' })
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Save failed')
      })
      .finally(() => setBusy(false))
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
          {chart && <EChart option={chart} height={220} />}
        </>
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Security
          <select value={form.security_id} onChange={(e) => setForm((f) => ({ ...f, security_id: e.target.value }))}>
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
          <AmountInput value={form.amount} onValueChange={(next) => setForm((f) => ({ ...f, amount: next }))} />
        </label>
        <label className="notes-field">
          Notes
          <input className="field-input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>Add dividend</button>
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
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm('Delete this dividend?')) return
                      deleteDividend(d.id)
                        .then(onChanged)
                        .catch((err: unknown) => {
                          setError(err instanceof ApiError ? err.message : 'Delete failed')
                        })
                    }}
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
