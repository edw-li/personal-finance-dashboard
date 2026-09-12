import { useState } from 'react'
import { Link } from 'react-router-dom'
import { batchCloseMonths, fetchMonthReviews, REVIEW_LABELS } from '../../api/monthReview'
import type { MonthReview } from '../../api/monthReview'
import { describeError } from '../../api/client'
import { formatMonth } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'

export default function HistoricalReview({ onChanged }: { onChanged: () => void }) {
  const [months, setMonths] = useState<MonthReview[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const load = async () => {
    setBusy(true)
    try { const data = await fetchMonthReviews(); setMonths(data.months.filter(m => m.month < currentMonthIso() && m.state !== 'closed')); setSelected(new Set()); setConfirmed(false); setMessage(null) }
    catch (err) { setMessage(describeError(err, 'historical reviews')) }
    finally { setBusy(false) }
  }
  const close = async () => {
    setBusy(true)
    try {
      const result = await batchCloseMonths((months ?? []).filter(m => selected.has(m.month)).map(m => ({ month: m.month, expected_revision: m.input_revision })))
      setMonths(current => current?.filter(m => !result.months.some(closed => closed.month === m.month)) ?? null)
      setSelected(new Set()); setConfirmed(false); setMessage(`Closed ${result.months.length} reviewed months.`); onChanged()
    } catch (err) { setMessage(describeError(err, 'closing historical months')) }
    finally { setBusy(false) }
  }
  return <details className="panel historical-review" onToggle={event => { if (event.currentTarget.open && months === null && !busy) void load() }}>
    <summary>Review historical months</summary>
    <p className="drill-hint">Existing history stays available with its review status. Close only the months whose balances, spending, and take-home you have checked.</p>
    {message && <p role="status">{message}</p>}
    {months === null ? <button className="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Load history'}</button> : <>
      <button type="button" className="button" disabled={busy} onClick={() => void load()}>Refresh history</button>
      {months.length === 0 ? <p>All historical months are closed.</p> : <div className="history-review-list">
        {months.map(m => <label key={m.month} className="history-review-row">
          <input type="checkbox" disabled={busy || !m.coverage.balances || !m.coverage.spending || !m.coverage.take_home}
            checked={selected.has(m.month)} onChange={e => { const next = new Set(selected); if (e.target.checked) next.add(m.month); else next.delete(m.month); setSelected(next); setConfirmed(false) }} />
          <span>{formatMonth(m.month)}</span><span>{REVIEW_LABELS[m.state]}</span>
          <Link to={`/update?month=${m.month}&step=review`}>Review entries</Link>
        </label>)}
      </div>}
      {selected.size > 0 && <label className="entry-zero-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked balances, spending, and take-home for these {selected.size} months.</label>}
      <button className="button" disabled={busy || !confirmed || selected.size === 0} onClick={() => void close()}>{busy ? 'Closing…' : `Close ${selected.size} reviewed months`}</button>
    </>}
  </details>
}
