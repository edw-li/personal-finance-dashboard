import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { HoldingOut, SparklinesResponse } from '../../types/api'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import Sparkline from './Sparkline'
import './portfolio.css'

type SortKey =
  | 'ticker' | 'shares' | 'price' | 'day_change_pct' | 'market_value' | 'weight_pct'
  | 'unrealized_gl' | 'yield_pct' | 'yoc_pct' | 'xirr_pct' | 'dividends_collected'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'ticker', label: 'Ticker', numeric: false },
  { key: 'shares', label: 'Shares', numeric: true },
  { key: 'price', label: 'Price', numeric: true },
  { key: 'day_change_pct', label: 'Day', numeric: true },
  { key: 'market_value', label: 'Market value', numeric: true },
  { key: 'weight_pct', label: 'Weight', numeric: true },
  { key: 'unrealized_gl', label: 'Unrealized', numeric: true },
  { key: 'yield_pct', label: 'Yield', numeric: true },
  { key: 'yoc_pct', label: 'YOC', numeric: true },
  { key: 'xirr_pct', label: 'XIRR', numeric: true },
  { key: 'dividends_collected', label: 'Dividends', numeric: true },
]

const STALE_AFTER_DAYS = 4

function sortValue(h: HoldingOut, key: SortKey): number | string {
  if (key === 'ticker') return h.ticker
  const raw = h[key]
  // nulls sort as -Infinity: bottom in the default descending order (ascending puts
  // them first — accepted; a null is "least" either way)
  return raw === null ? Number.NEGATIVE_INFINITY : Number(raw)
}

function isStale(quotedAt: string | null): boolean {
  if (!quotedAt) return false
  // Bar-date vs today's DATE (forward note: "UI compares dates only") — an instant
  // comparison flags a Friday bar early on Monday evening.
  const bar = Date.parse(`${quotedAt.slice(0, 10)}T00:00:00Z`)
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return today - bar > STALE_AFTER_DAYS * 86_400_000
}

function tone(value: string | null): string {
  if (value === null) return ''
  const n = Number(value)
  return n > 0 ? 'pos' : n < 0 ? 'neg' : ''
}

export default function HoldingsTable({
  holdings,
  sparklines,
}: {
  holdings: HoldingOut[]
  // Partial record (Task 12 review M1): a held security with no bars is ABSENT, so the
  // `?? []` at the call site below is type-required, not defensive.
  sparklines: SparklinesResponse
}) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value')
  const [descending, setDescending] = useState(true)

  const sorted = useMemo(() => {
    const rows = [...holdings]
    rows.sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
      return descending ? -cmp : cmp
    })
    return rows
  }, [holdings, sortKey, descending])

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((d) => !d)
    } else {
      setSortKey(key)
      setDescending(COLUMNS.find((c) => c.key === key)!.numeric)
    }
  }

  if (holdings.length === 0) {
    return <p className="empty-note">No holdings yet — add transactions below.</p>
  }
  return (
    <div className="holdings-scroll">
      <table className="port-table">
        <thead>
          <tr>
            {COLUMNS.map(({ key, label, numeric }) => (
              <th
                key={key}
                className={numeric ? 'num' : undefined}
                aria-sort={
                  key === sortKey ? (descending ? 'descending' : 'ascending') : undefined
                }
              >
                <button type="button" className="th-sort" onClick={() => onSort(key)}>
                  {label}
                  {key === sortKey && <span aria-hidden="true">{descending ? ' ↓' : ' ↑'}</span>}
                </button>
              </th>
            ))}
            <th className="chart-col">1Y</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.security_id}>
              <td>
                <div className="ticker-cell">
                  <span className="ticker">
                    {h.ticker}
                    {h.is_manual_priced && <span className="badge">manual</span>}
                    {h.warnings.length > 0 && (
                      <span
                        title={h.warnings.join('; ')}
                        role="img"
                        aria-label={h.warnings.join('; ')}
                        className="warn-icon"
                      >
                        <AlertTriangle size={13} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className="sub">{h.name}</span>
                </div>
              </td>
              <td className="num">{formatShares(h.shares)}</td>
              <td className="num">
                {formatCurrency(h.price)}
                {h.quoted_at && isStale(h.quoted_at) && (
                  <span className="sub stale"> as of {formatDate(h.quoted_at)}</span>
                )}
              </td>
              <td className={`num ${tone(h.day_change_pct)}`}>{formatPct(h.day_change_pct)}</td>
              <td className="num">{formatCurrency(h.market_value)}</td>
              <td className="num">{formatPct(h.weight_pct, { signed: false })}</td>
              <td className={`num ${tone(h.unrealized_gl)}`}>
                {formatCurrency(h.unrealized_gl)}
                {h.unrealized_gl_pct !== null && (
                  <span className="sub"> {formatPct(h.unrealized_gl_pct)}</span>
                )}
              </td>
              <td className="num">{formatPct(h.yield_pct, { signed: false, decimals: 2 })}</td>
              <td className="num">{formatPct(h.yoc_pct, { signed: false, decimals: 2 })}</td>
              <td className="num">{formatPct(h.xirr_pct)}</td>
              <td className="num">{formatCurrency(h.dividends_collected)}</td>
              <td className="chart-col">
                <Sparkline points={sparklines[h.ticker] ?? []} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
