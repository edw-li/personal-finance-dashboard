import { formatCurrency, formatPct } from '../../utils/format'
import type { monthPieLegend } from './spendingChartOptions'
import './breakdownLegend.css'

type Row = ReturnType<typeof monthPieLegend>[number]

/** The names the dock donut no longer draws as leader labels (W7): a list beside the chart —
 *  category · amount · share. Other wears the folded-stack grey; slots are 0-based, the CSS
 *  tokens 1-based (the trend chips' rule). */
export default function BreakdownLegend({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <ul className="breakdown-legend" aria-label={label}>
      {rows.map((row) => (
        <li key={row.name}>
          <span
            className="breakdown-swatch"
            aria-hidden="true"
            style={{ background: row.slot === null ? 'var(--other-series)' : `var(--chart-${row.slot + 1})` }}
          />
          <span className="breakdown-name">{row.name}</span>
          <span className="breakdown-amount">{formatCurrency(row.value)}</span>
          <span className="breakdown-share">{formatPct(row.share, { signed: false })}</span>
        </li>
      ))}
    </ul>
  )
}
