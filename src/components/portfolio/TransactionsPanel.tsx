import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from '../../api/portfolio'
import type { SecurityOut, TransactionOut, TransactionType } from '../../types/api'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
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
    return { ...base, split_factor: form.split_factor.trim(), shares: '0', price: '0', fees: null }
  }
  return {
    ...base,
    shares: form.shares,
    price: form.price,
    fees: form.fees.trim() ? form.fees : null,
    split_factor: null,
  }
}

export default function TransactionsPanel({
  securities,
  transactions,
  onChanged,
}: {
  securities: SecurityOut[]
  transactions: TransactionOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))

  // 'type' is excluded: it is a union field with its own dedicated handler below.
  const set = (field: Exclude<keyof FormState, 'type'>) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (txn: TransactionOut) => {
    setEditingId(txn.id)
    setForm({
      security_id: String(txn.security_id),
      account: txn.account,
      type: txn.type,
      txn_date: txn.txn_date ?? '',
      shares: txn.type === 'split' ? '' : txn.shares,
      price: txn.type === 'split' ? '' : txn.price,
      fees: txn.fees ?? '',
      split_factor: txn.split_factor ?? '',
      notes: txn.notes ?? '',
    })
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
    setBusy(true)
    setError(null)
    const payload = toPayload(form)
    const request =
      editingId !== null
        ? updateTransaction(editingId, payload)
        : createTransaction({ ...payload, security_id: Number(form.security_id) })
    request
      .then(() => {
        setForm(EMPTY)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Save failed')
      })
      .finally(() => setBusy(false))
  }

  const remove = (txn: TransactionOut) => {
    if (!window.confirm(`Delete this ${txn.type} of ${tickers.get(txn.security_id) ?? '?'}?`)) return
    deleteTransaction(txn.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only: a failed delete leaves the row.
        if (txn.id === editingId) {
          setEditingId(null)
          setForm(EMPTY)
        }
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      })
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Transactions</h2>
      <p className="hint">
        Rows marked <span className="badge">sheet</span> are owned by the spreadsheet
        importer: a re-import reverts edits to them and resurrects deletions. Rows added
        here are never touched by imports.
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
          <select
            value={form.security_id}
            onChange={(e) => set('security_id')(e.target.value)}
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
          <input value={form.account} onChange={(e) => set('account')(e.target.value)} />
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
            type="date"
            value={form.txn_date}
            onChange={(e) => set('txn_date')(e.target.value)}
          />
        </label>
        {form.type === 'split' ? (
          <label>
            Factor
            <input
              value={form.split_factor}
              onChange={(e) => set('split_factor')(e.target.value)}
              inputMode="decimal"
            />
          </label>
        ) : (
          <>
            <label>
              Shares
              <input
                value={form.shares}
                onChange={(e) => set('shares')(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Price
              <input
                value={form.price}
                onChange={(e) => set('price')(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Fees
              <input
                value={form.fees}
                onChange={(e) => set('fees')(e.target.value)}
                inputMode="decimal"
              />
            </label>
          </>
        )}
        <label className="notes-field">
          Notes
          <input value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {editingId !== null ? 'Save changes' : 'Add transaction'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {transactions.length === 0 ? (
        <p className="empty-note">No transactions yet.</p>
      ) : (
        <table className="port-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Account</th><th>Type</th><th>Date</th>
              <th className="num">Shares</th><th className="num">Price</th>
              <th className="num">Fees</th><th>Source</th><th>Notes</th><th />
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{tickers.get(t.security_id) ?? '?'}</td>
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
                <td className="row-actions">
                  <button type="button" onClick={() => startEdit(t)}>Edit</button>
                  <button type="button" onClick={() => remove(t)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
