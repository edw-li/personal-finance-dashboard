import { useState } from 'react'
import { ApiError } from '../../api/client'
import { createDividend, deleteDividend } from '../../api/portfolio'
import type { DividendOut, SecurityOut } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'
import './portfolio.css'

export default function DividendsPanel({
  securities,
  dividends,
  onChanged,
}: {
  securities: SecurityOut[]
  dividends: DividendOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState({ security_id: '', account: '', pay_date: '', amount: '', notes: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))

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
      amount: form.amount,
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
      <h2 className="panel-title">Dividends</h2>
      <p className="hint">
        The sheet never recorded dividend payments — this log is the only entry path
        (dividend totals, yield-on-cost XIRR flows all read from it).
      </p>
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
          <input value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
        </label>
        <label>
          Pay date
          <input type="date" value={form.pay_date} onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))} />
        </label>
        <label>
          Amount
          <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} inputMode="decimal" />
        </label>
        <label className="notes-field">
          Notes
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
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
              <th className="num">Amount</th><th>Notes</th><th />
            </tr>
          </thead>
          <tbody>
            {dividends.map((d) => (
              <tr key={d.id}>
                <td>{tickers.get(d.security_id) ?? '?'}</td>
                <td>{d.account ?? '—'}</td>
                <td>{formatDate(d.pay_date)}</td>
                <td className="num">{formatCurrency(d.amount)}</td>
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
