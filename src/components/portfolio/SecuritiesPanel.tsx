import { useState } from 'react'
import { ApiError } from '../../api/client'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { flashElement, revealEditor, useEscapeCancel } from '../feedback/reveal'
import { useDeleteWithUndo } from '../feedback/useDeleteWithUndo'
import { useLatest } from '../reorder/useLatest'
import { useRecordFeedback } from './useRecordFeedback'
import { createSecurity, deleteSecurity, updateSecurity } from '../../api/portfolio'
import { putManualPrice } from '../../api/prices'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import type { HoldingType, SecurityOut } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { formatCurrency, formatDate } from '../../utils/format'
import { FeedBanner } from '../shell/Feed'
import TableScroll from '../TableScroll'
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
  onChanged: () => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  // Which row's manual-price mini-form is open (only manual-priced rows offer one).
  const [pricingId, setPricingId] = useState<number | null>(null)
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [pricing, setPricing] = useState(false)
  const { formRef: editorRef, state: saveState, ...feedback } = useRecordFeedback(form, securities, 'data-security-id')
  const latest = useLatest({ onChanged, editingId, pricingId })
  const deleteWithUndo = useDeleteWithUndo()
  const cancelEdit = () => {
    if (busy) return
    feedback.focusRow(editingId)
    setEditingId(null)
    setForm(EMPTY)
    feedback.begin(EMPTY)
    setError(null)
  }
  const closePrice = () => {
    feedback.row(pricingId)?.querySelector<HTMLButtonElement>('[data-price]')?.focus()
    setPricingId(null)
    setPriceError(null)
  }
  useEscapeCancel(editorRef, cancelEdit, editingId !== null && !busy)

  // The union and the two booleans are excluded: they have dedicated handlers below
  // (same split as TransactionsPanel's `type`).
  const set =
    (field: Exclude<keyof FormState, 'holding_type' | 'is_manual_priced' | 'is_active'>) =>
    (value: string) =>
      setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (security: SecurityOut) => {
    setEditingId(security.id)
    const next: FormState = {
      ticker: security.ticker,
      name: security.name,
      industry: security.industry ?? '',
      holding_type: security.holding_type,
      annual_dividend: security.annual_dividend ?? '',
      is_manual_priced: security.is_manual_priced,
      is_active: security.is_active,
    }
    setForm(next)
    feedback.begin(next)
    setError(null)
    feedback.reveal()
  }

  const submit = () => {
    if (busy) return
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
            // The wire belt (blank still means null, never "0"). Canonicalizing a server
            // seed is a no-op, so a hidden field's stored "0.0400" rides back untouched.
            // { expressions: false }: annual_dividend is a 4dp column and the evaluator
            // quantizes to 2dp, so "=" must never be evaluated into it (the shares
            // rationale, one decimal place further out). The input is kind="plain" to
            // match — a belt that refuses what the cell already evaluated would be no
            // guard at all.
            annual_dividend: form.annual_dividend.trim()
              ? canonicalAmount(form.annual_dividend, { expressions: false })
              : null,
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
    void saveState.run(() => request.then((saved) => {
      if (editingId !== null) feedback.focusRow(editingId)
      else editorRef.current?.querySelector<HTMLInputElement>('input')?.focus()
      setForm(EMPTY)
      feedback.saved(EMPTY, saved?.id ?? editingId, editingId !== null)
      setEditingId(null)
      return latest.current.onChanged()
    })).finally(() => setBusy(false))
  }

  const remove = (security: SecurityOut) => {
    if (busy) return
    setBusy(true)
    void deleteWithUndo({
      name: `security ${security.ticker}`,
      row: feedback.row(security.id),
      request: () => deleteSecurity(security.id),
      onDeleted: () => {
        if (latest.current.editingId === security.id) {
          setEditingId(null)
          setForm(EMPTY)
          feedback.begin(EMPTY)
        }
        if (latest.current.pricingId === security.id) setPricingId(null)
        return latest.current.onChanged()
      },
      onRestored: () => latest.current.onChanged(),
      restoredRow: () => feedback.row(security.id),
      focusAfter: feedback.focusAfterDelete(security.id),
    }).finally(() => setBusy(false))
  }

  const savePrice = (security: SecurityOut) => {
    if (busy) return
    if (!price.trim()) {
      setPriceError('Price is required')
      return
    }
    setBusy(true)
    setPriceError(null)
    setPricing(true)
    // The wire belt: this mini-form is typed and clicked, often without a blur.
    // { expressions: false } for the same reason as annual_dividend above — price is a 4dp
    // column and the 2dp evaluator would coarsen it.
    putManualPrice(security.ticker, { price: canonicalAmount(price, { expressions: false }) })
      .then(() => {
        closePrice()
        setPrice('')
        flashElement(feedback.row(security.id))
        return latest.current.onChanged()
      })
      .catch((err: unknown) => {
        setPriceError(err instanceof ApiError ? err.message : 'Price update failed')
      })
      .finally(() => { setBusy(false); setPricing(false) })
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
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
      <form
        ref={editorRef}
        onChangeCapture={() => { setError(null); saveState.clearError() }}
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Ticker
          {/* .field-input by hand: the shared chrome used to arrive from `.entry-form input`,
              which is now select-only — every plain text control in this form states it.
              The two checkboxes below deliberately keep their own `.entry-form
              input[type='checkbox']` sizing rule instead. */}
          <input
            className="field-input"
            value={form.ticker}
            onChange={(e) => set('ticker')(e.target.value)}
            disabled={editingId !== null}
          />
        </label>
        <label>
          Name
          <input className="field-input" value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </label>
        <label>
          Industry
          <input className="field-input" value={form.industry} onChange={(e) => set('industry')(e.target.value)} />
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
            {/* kind="plain", not money: a 4dp column's $-echo would render "$1.23" over a
                stored 1.2345 and hide two digits. Verbatim display is the honest one here,
                and plain also refuses the 2dp "=" evaluator the belt refuses. */}
            <AmountInput
              kind="plain"
              value={form.annual_dividend}
              onValueChange={set('annual_dividend')}
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
          <SaveButton className="button" type="submit" state={saveState} inert={busy && saveState.status !== 'saving'}>
            {editingId !== null ? 'Save changes' : 'Add security'}
          </SaveButton>
          <SaveStatus state={saveState} />
          <FeedBanner error={error} />
          {editingId !== null && (
            <BusyButton className="button" type="button" inert={busy} onClick={cancelEdit}>Cancel</BusyButton>
          )}
        </div>
      </form>
      {securities.length === 0 ? (
        <p className="empty-note">No securities yet.</p>
      ) : (
        <TableScroll className="holdings-scroll" label="Securities table"><table className="port-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Name</th><th>Industry</th><th>Type</th>
              <th className="num">Annual div</th><th>Ex-div</th>
              <th>Manual</th><th>Active</th><th />
            </tr>
          </thead>
          <tbody>
            {securities.map((s) => (
              <tr key={s.id} data-security-id={s.id} className={editingId === s.id ? 'is-editing' : undefined} aria-current={editingId === s.id ? true : undefined}>
                <td>{s.ticker}</td>
                <td>{s.name}</td>
                <td>{s.industry ?? '—'}</td>
                <td>{TYPE_LABELS[s.holding_type]}</td>
                <td className="num">{formatCurrency(s.annual_dividend)}</td>
                <td>{formatDate(s.ex_div_date)}</td>
                <td>{s.is_manual_priced ? '✓' : '—'}</td>
                <td>{s.is_active ? '✓' : '—'}</td>
                <td className="row-actions">
                  <BusyButton className="button" data-edit type="button" inert={busy} onClick={() => startEdit(s)}>Edit</BusyButton>
                  {s.is_manual_priced && (
                    <BusyButton className="button" data-price type="button" inert={busy}
                      onClick={() => {
                        setPricingId(s.id)
                        setPrice('')
                        setPriceError(null)
                        queueMicrotask(() => revealEditor(feedback.row(s.id)?.querySelector('form') ?? null))
                      }}>
                      Set price
                    </BusyButton>
                  )}
                  <BusyButton className="button" data-delete type="button" inert={busy} onClick={() => remove(s)}>Delete</BusyButton>
                  {pricingId === s.id && (
                    <form
                      onChangeCapture={() => setPriceError(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && !event.defaultPrevented && !busy) { event.preventDefault(); closePrice() }
                      }}
                      onSubmit={(e) => {
                        e.preventDefault()
                        savePrice(s)
                      }}
                    >
                      <label>
                        Price
                        {/* kind="plain" for the 4dp reason above. price-mini bounds the
                            width: this is the one AmountInput NOT inside a column-flex
                            label, so .field-input's width:100% would stretch it across
                            this nowrap actions cell and push the buttons past the panel. */}
                        <AmountInput
                          kind="plain"
                          className="price-mini"
                          value={price}
                          onValueChange={setPrice}
                        />
                      </label>
                      <BusyButton className="button" type="submit" busy={pricing} inert={busy && !pricing}>Save price</BusyButton>
                      <BusyButton className="button" type="button" inert={busy} onClick={closePrice}>Cancel</BusyButton>
                      <FeedBanner error={priceError} />
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></TableScroll>
      )}
    </section>
  )
}
