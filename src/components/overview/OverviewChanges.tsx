import { Link } from 'react-router-dom'
import type { NetWorthTimeseries } from '../../types/api'
import { formatCurrency, formatMonth } from '../../utils/format'

export function recordedBalanceMovers(data: NetWorthTimeseries | undefined) {
  if (!data || data.months.length < 2) return []
  const index = data.months.length - 1
  return data.accounts.filter(account => !account.is_component).flatMap(account => {
    const values = data.series.find(series => series.account_id === account.id)?.values
    const current = values?.[index], prior = values?.[index - 1]
    if (current == null || prior == null) return []
    const cents = Math.round((Number(current) - Number(prior)) * 100)
    return cents === 0 ? [] : [{ id: account.id, label: account.name, change: cents / 100 }]
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.id - b.id).slice(0, 3)
}
export default function OverviewChanges({ data }: { data?: NetWorthTimeseries }) {
  const movers = recordedBalanceMovers(data)
  return <section className="card overview-changes">
    <h2 className="eyebrow">Changes worth understanding</h2>
    {data === undefined ? <p className="drill-hint">Balance changes are waiting for the wealth feed.</p> : movers.length === 0 ? <p className="drill-hint">No recorded balance changes to compare yet.</p> : <>
      <p className="drill-hint">Largest account movements since {formatMonth(data.months.at(-2)!)}</p>
      <ul className="overview-movers">{movers.map(item => <li key={item.id}><Link to={`/net-worth?section=accounts&month=${data.months.at(-1)}`}>{item.label}</Link><span>{item.change > 0 ? '+' : '−'}{formatCurrency(Math.abs(item.change))}</span></li>)}</ul>
      <p className="drill-hint">Recorded balance movements include deposits, withdrawals, and valuation changes.</p>
    </>}
  </section>
}
