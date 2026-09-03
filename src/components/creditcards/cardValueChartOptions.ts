// Pure option builder for the card-value bars — no React, no fetching, no theme decisions
// of its own. Reduced motion and the dark theme are the EChart wrapper's job (it forces
// `animation: false` after the spread), so everything here is data.
//
// One horizontal bar per card, colored by the SIGN of its net annual value: keeping is a
// POSITIVE bar, and anything that does not clear its fee reads NEGATIVE (droppable). The
// zero line is drawn explicitly so a bar's side of it is readable without hunting the axis.
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, grid, moneyAxis } from '../../charts/grammar'
import { zeroLine } from '../../charts/markLine'
import { NEGATIVE, POSITIVE } from '../../charts/theme'
import { itemTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'
import { formatCurrency } from '../../utils/format'

export interface CardValueDatum {
  name: string
  marginal: number
  credits: number
  fee: number
  net: number
}

/** Horizontal net-value bars, one per card, POSITIVE/NEGATIVE per datum. Callers
 *  pass rows sorted net-descending; height = max(140, rows×34 + 70). */
export function cardValueChartOption(rows: CardValueDatum[]): EChartsOption {
  return {
    grid: grid('horizontal'),
    tooltip: itemTooltip<{ dataIndex?: number }>({
      // Card names are user text — itemTooltip escapes every label and sub-line it renders.
      body: (p) => {
        const row = rows[p.dataIndex ?? -1]
        if (row === undefined) return null
        return {
          value: row.net,
          label: row.name,
          sub:
            `${formatCurrency(row.marginal)} marginal + ${formatCurrency(row.credits)} credits` +
            ` − ${formatCurrency(row.fee)} fee, per year`,
        }
      },
    }),
    // Compact ticks (F13): the axis is a scale, the tooltip carries the exact figure.
    xAxis: moneyAxis(),
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      inverse: true, // first row (best) on top
      axisLabel: { width: 118, overflow: 'truncate' as const },
    },
    series: [
      {
        type: 'bar' as const,
        ...BAR_MARKS,
        // Sign colours per item: keeping is POSITIVE, anything that does not clear its fee
        // reads NEGATIVE (droppable) — the reserved status use spec §12 allows.
        data: rows.map((r) => ({
          value: r.net,
          itemStyle: { color: r.net > 0 ? POSITIVE : NEGATIVE },
        })),
        markLine: zeroLine('x'),
      },
    ],
  }
}

/** The lineup as a table (F12): the three inputs and the net each bar draws. */
export function cardValueCsv(rows: CardValueDatum[]): ExportTable {
  return {
    headers: ['Card', 'Marginal', 'Credits', 'Fee', 'Net'],
    rows: rows.map((r) => [
      r.name,
      r.marginal.toFixed(2),
      r.credits.toFixed(2),
      r.fee.toFixed(2),
      r.net.toFixed(2),
    ]),
  }
}
