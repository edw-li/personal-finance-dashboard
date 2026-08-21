import { useState } from 'react'
import { ApiError } from '../../api/client'
import { createSecurity, deleteSecurity, updateSecurity } from '../../api/portfolio'
import { putManualPrice } from '../../api/prices'
import InfoHint from '../InfoHint'
import type { HoldingType, SecurityOut } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'
import './portfolio.css'

const HOLDING_TYPES: HoldingType[] = ['etf', 'mutual_fund', 'stock', 'private']

const TYPE_LABELS: Record<HoldingType, string> = {
  etf: 'ETF', mutual_fund: 'Mutual fund', stock: 'Stock', private: 'Private',
}

interface FormState {
  ticker: string
  name: string
  industry: string
  holding_type: HoldingType
  annual_dividend: string
  is_manual_priced: boolean
  is_active: boolean
}

const EMPTY: FormState = {
  ticker: '', name: '', industry: '', holding_type: 'stock',
  annual_dividend: '', is_manual_priced: false, is_active: true,
}

export default function SecuritiesPanel({
  securities,
  onChanged,
}: {
  securities: SecurityOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  // Which row's manual-price mini-form is open (only manual-priced rows offer one).
  const [pricingId, setPricingId] = useState<number | null>(null)
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The union and the two booleans are excluded: they have dedicated handlers below
  // (same split as TransactionsPanel's `type`).
  const set =
    (field: Exclude<keyof FormState, 'holding_type' | 'is_manual_priced' | 'is_active'>) =>
    (value: string) =>
      setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (security: SecurityOut) => {
    setEditingId(security.id)
    setForm({
      ticker: security.ticker,
      name: security.name,
      industry: security.industry ?? '',
      holding_type: security.holding_type,
      annual_dividend: security.annual_dividend ?? '',
      is_manual_priced: security.is_manual_priced,
      is_active: security.is_active,
    })
  }

  const submit = () => {
    if (!form.ticker.trim() || !form.name.trim()) {
      setError('Ticker and name are required')
      return
    }
    setBusy(true)
    setError(null)
    // Blank optional text goes over as an explicit null: a whitespace-only industry
    // would otherwise become its own blank allocation slice (Task 8 review note).
    const request =
      editingId !== null
        ? updateSecurity(editingId, {
            name: form.name.trim(),
            industry: form.industry.trim() || null,
            holding_type: form.holding_type,
            annual_dividend: form.annual_dividend.trim() || null,
            is_manual_priced: form.is_manual_priced,
            is_active: form.is_active,
          })
        : // ticker is the natural key — the server normalizes case and PATCH never
          // rewrites it, so it is create-only.
          createSecurity({
            ticker: form.ticker.trim(),
            name: form.name.trim(),
            industry: form.industry.trim() || null,
            holding_type: form.holding_type,
            is_manual_priced: form.is_manual_priced,
          })
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

  const remove = (security: SecurityOut) => {
    if (!window.confirm(`Delete ${security.ticker}?`)) return
    deleteSecurity(security.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only: a 409 leaves the row in place.
        if (security.id === editingId) {
          setEditingId(null)
          setForm(EMPTY)
        }
        onChanged()
      })
      .catch((err: unknown) => {
        // A referenced security answers 409 "…— deactivate it instead": show it verbatim.
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      })
  }

  const savePrice = (security: SecurityOut) => {
    if (!price.trim()) {
      setError('Price is required')
      return
    }
    setBusy(true)
    setError(null)
    putManualPrice(security.ticker, { price })
      .then(() => {
        setPricingId(null)
        setPrice('')
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Price update failed')
      })
      .finally(() => setBusy(false))
  }

  return (
    <section className="panel">
      <h2 className="panel-title">
        Securities
        <InfoHint text="The instruments themselves — metadata, pricing mode, active flag. Deactivate a dead ticker to stop refreshing it; deleting is refused while records reference it." />
      </h2>
      <p className="hint">
        Deactivating a security stops its price refresh and leaves every transaction,
        dividend and price bar in place — that is the way to retire a delisted ticker.
        Deleting is refused while transactions or dividends reference it. Manual-priced
        securities are never touched by a refresh; set their price by hand below. Annual
        dividend and ex-div date are rewritten by every price refresh for auto-priced
        securities — edit the dividend only on manual-priced ones.
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
          Ticker
          <input
            value={form.ticker}
            onChange={(e) => set('ticker')(e.target.value)}
            disabled={editingId !== null}
          />
        </label>
        <label>
          Name
          <input value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </label>
        <label>
          Industry
          <input value={form.industry} onChange={(e) => set('industry')(e.target.value)} />
        </label>
        <label>
          Holding type
          {/* dedicated handler: holding_type is a union, the string setter can't write it */}
          <select
            value={form.holding_type}
            onChange={(e) =>
              setForm((f) => ({ ...f, holding_type: e.target.value as HoldingType }))
            }
          >
            {HOLDING_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {/* Refresh owns annual_dividend/ex_div_date for auto-priced securities (it
            rewrites both from Yahoo TTM events), so the field is offered only where the
            edit survives — the same reasoning that keeps ex_div_date out entirely
            (Task 14 review I2). */}
        {editingId !== null && form.is_manual_priced && (
          <label>
            Annual dividend
            <input
              value={form.annual_dividend}
              onChange={(e) => set('annual_dividend')(e.target.value)}
              inputMode="decimal"
            />
          </label>
        )}
        <label>
          Manual price
          <input
            type="checkbox"
            checked={form.is_manual_priced}
            onChange={(e) => setForm((f) => ({ ...f, is_manual_priced: e.target.checked }))}
          />
        </label>
        {editingId !== null && (
          <label>
            Active
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
          </label>
        )}
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {editingId !== null ? 'Save changes' : 'Add security'}
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
      {securities.length === 0 ? (
        <p className="empty-note">No securities yet.</p>
      ) : (
        <table className="port-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Name</th><th>Industry</th><th>Type</th>
              <th className="num">Annual div</th><th>Ex-div</th>
              <th>Manual</th><th>Active</th><th />
            </tr>
          </thead>
          <tbody>
            {securities.map((s) => (
              <tr key={s.id}>
                <td>{s.ticker}</td>
                <td>{s.name}</td>
                <td>{s.industry ?? '—'}</td>
                <td>{TYPE_LABELS[s.holding_type]}</td>
                <td className="num">{formatCurrency(s.annual_dividend)}</td>
                <td>{formatDate(s.ex_div_date)}</td>
                <td>{s.is_manual_priced ? '✓' : '—'}</td>
                <td>{s.is_active ? '✓' : '—'}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => startEdit(s)}>Edit</button>
                  {s.is_manual_priced && (
                    <button
                      type="button"
                      onClick={() => {
                        setPricingId(s.id)
                        setPrice('')
                      }}
                    >
                      Set price
                    </button>
                  )}
                  <button type="button" onClick={() => remove(s)}>Delete</button>
                  {pricingId === s.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        savePrice(s)
                      }}
                    >
                      <label>
                        Price
                        <input
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          inputMode="decimal"
                        />
                      </label>
                      <button type="submit" disabled={busy}>Save price</button>
                      <button type="button" onClick={() => setPricingId(null)}>Cancel</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
