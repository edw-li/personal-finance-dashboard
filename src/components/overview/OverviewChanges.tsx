import { Link } from 'react-router-dom'
import type { NetWorthTimeseries } from '../../types/api'
import { formatAsOf } from '../../utils/asOf'
import { formatCurrency } from '../../utils/format'
import { todayIso } from '../../utils/months'
import { currentSnapshotIndex, snapshotAt } from '../networth/snapshotStates'

/** The three largest recorded moves between the snapshot at `index` and the one before it. */
export function recordedBalanceMovers(data: NetWorthTimeseries | undefined, index: number) {
  if (!data || index < 1 || index >= data.months.length) return []
  return data.accounts.filter(account => !account.is_component).flatMap(account => {
    const values = data.series.find(series => series.account_id === account.id)?.values
    const current = values?.[index], prior = values?.[index - 1]
    if (current == null || prior == null) return []
    const cents = Math.round((Number(current) - Number(prior)) * 100)
    return cents === 0 ? [] : [{ id: account.id, label: account.name, change: cents / 100 }]
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.id - b.id).slice(0, 3)
}

/** What the movements span, by date (2026-09-23 spec §T1): "since Sep 1", plus " · to Sep 22
 *  (provisional)" while the latest balances were typed before their 1st. */
function movementsSince(data: NetWorthTimeseries, index: number): string {
  const current = snapshotAt(data, index)
  const to = current.provisional ? ` · to ${formatAsOf(current)} (provisional)` : ''
  return `since ${formatAsOf(snapshotAt(data, index - 1))}${to}`
}

export default function OverviewChanges({ data }: { data?: NetWorthTimeseries }) {
  // The CURRENT snapshot — the one the net-worth tile shows (K2's rule: the latest up to next
  // month) — never balances filed further ahead, which only an API client or an import can store.
  const index = data === undefined ? -1 : currentSnapshotIndex(data.months, todayIso())
  const movers = recordedBalanceMovers(data, index)
  return <section className="card overview-changes">
    <h2 className="eyebrow">Changes worth understanding</h2>
    {data === undefined ? <p className="drill-hint">Balance changes are waiting for the wealth feed.</p> : movers.length === 0 ? <p className="drill-hint">No recorded balance changes to compare yet.</p> : <>
      <p className="drill-hint">Largest account movements {movementsSince(data, index)}</p>
      <ul className="overview-movers">{movers.map(item => <li key={item.id}><Link to={`/net-worth?section=accounts&month=${data.months[index]}`}>{item.label}</Link><span>{item.change > 0 ? '+' : '−'}{formatCurrency(Math.abs(item.change))}</span></li>)}</ul>
      <p className="drill-hint">Recorded balance movements include deposits, withdrawals, and valuation changes.</p>
    </>}
  </section>
}
