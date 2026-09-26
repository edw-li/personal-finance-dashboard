import { useState } from 'react'
import { Link } from 'react-router-dom'
import { batchCloseMonths, fetchMonthReviews, REVIEW_LABELS } from '../../api/monthReview'
import type { MonthReview, ReviewState } from '../../api/monthReview'
import { describeError } from '../../api/client'
import type { CoverageOut } from '../../types/api'
import { formatMonth } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'
import BusyButton from '../feedback/BusyButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'

type OpenMonth = Pick<MonthReview, 'month' | 'state'>

/** The rows this tool works on: past months that are not closed. */
function openMonths<T extends OpenMonth>(months: T[]): T[] {
  const current = currentMonthIso()
  return months.filter((m) => m.month < current && m.state !== 'closed')
}

/** The feeds a month is missing, in the user's words — the reason a row is disabled. */
function missingFeeds(m: MonthReview): string[] {
  const missing: string[] = []
  if (!m.coverage.balances) missing.push('balances')
  if (!m.coverage.spending) missing.push('spending')
  if (!m.coverage.take_home) missing.push('take-home')
  return missing
}

const eligible = (m: MonthReview) => missingFeeds(m).length === 0

/** One sentence about the backlog: how many months pre-date month review, how many other
 *  open months there are. Drawn from /coverage before the list is loaded, from the list after. */
function summaryOf(known: OpenMonth[] | null): string {
  if (known === null) return 'Existing history keeps its review status. Load it to close the months whose balances, spending and take-home you have checked.'
  if (known.length === 0) return 'All historical months are closed.'
  const legacy = known.filter((m) => m.state === 'unreviewed_history').length
  const other = known.length - legacy
  const parts = [
    legacy > 0 ? `${legacy} ${legacy === 1 ? 'month' : 'months'} entered before month review existed` : '',
    other > 0 ? `${other} ${other === 1 ? 'month' : 'months'} not yet closed` : '',
  ].filter((part) => part !== '')
  return `${parts.join(' · ')}.`
}

// A .card, not portfolio.css's .panel (F4, 2026-09-13 audit): this page must not depend on another
// page's stylesheet being in the bundle. Rows group by year so 37 months read as three lists
// rather than one 320px scroller, and a disabled row says WHY (A3).
export default function HistoricalReview({ onChanged, coverage }: { onChanged: () => void; coverage?: CoverageOut | null }) {
  const [months, setMonths] = useState<MonthReview[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const closeState = useSaveState({ dirty: selected.size > 0 })
  const closing = closeState.status === 'saving'
  const busy = loading || closing
  const load = async () => {
    if (busy) return
    setLoading(true)
    closeState.clearError()
    try { const data = await fetchMonthReviews(); setMonths(openMonths(data.months)); setSelected(new Set()); setConfirmed(false); setMessage(null) }
    catch (err) { setMessage(describeError(err, 'historical reviews')) }
    finally { setLoading(false) }
  }
  const close = async () => {
    if (busy || !confirmed || selected.size === 0) return
    await closeState.run(async () => {
      const result = await batchCloseMonths((months ?? []).filter(m => selected.has(m.month)).map(m => ({ month: m.month, expected_revision: m.input_revision })))
      setMonths(current => current?.filter(m => !result.months.some(closed => closed.month === m.month)) ?? null)
      setSelected(new Set()); setConfirmed(false); setMessage(null); onChanged()
    })
  }
  const toggle = (month: string, checked: boolean) => {
    closeState.clearError()
    const next = new Set(selected)
    if (checked) next.add(month); else next.delete(month)
    setSelected(next); setConfirmed(false)
  }
  const selectYear = (rows: MonthReview[]) => {
    closeState.clearError()
    const next = new Set(selected)
    rows.filter(eligible).forEach((m) => next.add(m.month))
    setSelected(next); setConfirmed(false)
  }
  // Newest year first — the months still in living memory lead — and calendar order inside it, so
  // a year reads Jan→Dec the way the sheet it came from does (the plan's own test pins this).
  const years = months === null ? [] : [...new Set(months.map((m) => m.month.slice(0, 4)))].sort((a, b) => b.localeCompare(a))
    .map((year) => ({ year, rows: months.filter((m) => m.month.startsWith(year)).sort((a, b) => a.month.localeCompare(b.month)) }))
  const known: OpenMonth[] | null = months ?? (coverage?.review_months ? openMonths(coverage.review_months) : null)
  const stateWord = (state: ReviewState) => REVIEW_LABELS[state]
  return <section className="card historical-review">
    <div className="historical-review-head">
      <h2 className="eyebrow">Review historical months</h2>
      <BusyButton type="button" className="button" busy={loading} inert={closing} onClick={() => void load()}>
        {months === null ? 'Load history' : 'Refresh history'}
      </BusyButton>
    </div>
    <p className="drill-hint">{summaryOf(known)}</p>
    {message && <p role="alert">{message}</p>}
    {months !== null && months.length > 0 && <div className="history-review-list">
      {years.map(({ year, rows }) => <section className="history-review-year" key={year}>
        <div className="history-review-year-head">
          <h3 className="eyebrow">{year}</h3>
          <button type="button" className="button" disabled={busy || !rows.some(eligible)} onClick={() => selectYear(rows)}>Select all eligible</button>
        </div>
        {rows.map(m => {
          const missing = missingFeeds(m)
          return <label key={m.month} className="history-review-row">
            <input type="checkbox" disabled={busy || missing.length > 0} checked={selected.has(m.month)} onChange={e => toggle(m.month, e.target.checked)} />
            <span>{formatMonth(m.month)}</span>
            <span>{stateWord(m.state)}{missing.length > 0 && <span className="history-review-missing"> · missing {missing.join(', ')}</span>}</span>
            <Link to={`/update?month=${m.month}&step=review`}>Review entries</Link>
          </label>
        })}
      </section>)}
    </div>}
    {selected.size > 0 && <label className="entry-zero-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked balances, spending, and take-home for these {selected.size} months.</label>}
    <div className="historical-review-footer">
      <BusyButton type="button" className="button" busy={closing} inert={loading || !confirmed || selected.size === 0} onClick={() => void close()}>
        {selected.size > 0 ? `Close selected months (${selected.size})` : 'Close selected months'}
      </BusyButton>
      {closeState.status !== 'dirty' && <SaveStatus state={closeState} />}
    </div>
  </section>
}
