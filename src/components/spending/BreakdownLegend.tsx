import { entityCssVar } from '../../charts/entities'
import { formatCurrency, formatPct } from '../../utils/format'
import type { monthPieLegend } from './spendingChartOptions'
import './breakdownLegend.css'

type Row = ReturnType<typeof monthPieLegend>[number]

/** The names the dock donut no longer draws as leader labels (W7): a list beside the chart —
 *  category · amount · share. Each swatch wears the slice's registry colour as the theme-
 *  following CSS variable (charts/entities.ts), so it tracks a light/dark switch. */
export default function BreakdownLegend({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <ul className="breakdown-legend" aria-label={label}>
      {rows.map((row) => (
        <li key={row.name}>
          <span
            className="breakdown-swatch"
            aria-hidden="true"
            style={{ background: entityCssVar(row.color) }}
          />
          <span className="breakdown-name">{row.name}</span>
          <span className="breakdown-amount">{formatCurrency(row.value)}</span>
          <span className="breakdown-share">{formatPct(row.share, { signed: false })}</span>
        </li>
      ))}
    </ul>
  )
}
