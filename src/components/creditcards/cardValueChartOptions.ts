// Pure option builder for the card-value bars — no React, no fetching, no theme decisions
// of its own. Reduced motion and the dark theme are the EChart wrapper's job (it forces
// `animation: false` after the spread), so everything here is data.
//
// One horizontal bar per card, colored by the SIGN of its net annual value: keeping is a
// POSITIVE bar, and anything that does not clear its fee reads NEGATIVE (droppable). The
// zero line is drawn explicitly so a bar's side of it is readable without hunting the axis.
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, NEGATIVE, POSITIVE } from '../../charts/theme'
import { escapeHtml, formatCurrency } from '../../utils/format'

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
    grid: { left: 130, right: 40, top: 8, bottom: 28 },
    tooltip: {
      // HTML formatter — card names are user text: escapeHtml is mandatory.
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        const row = rows[p.dataIndex ?? 0]
        if (!row) return ''
        return (
          `<strong>${escapeHtml(row.name)}</strong><br/>` +
          `${formatCurrency(row.marginal)} marginal + ${formatCurrency(row.credits)} credits` +
          ` − ${formatCurrency(row.fee)} fee = <strong>${formatCurrency(row.net)}</strong>/yr`
        )
      },
    },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatCurrency(v) } },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      inverse: true, // first row (best) on top
      axisLabel: { width: 118, overflow: 'truncate' as const },
    },
    series: [
      {
        type: 'bar' as const,
        barMaxWidth: 22,
        data: rows.map((r) => ({
          value: r.net,
          itemStyle: { color: r.net > 0 ? POSITIVE : NEGATIVE },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: MUTED, width: 1, type: 'solid' as const },
          label: { show: false },
          data: [{ xAxis: 0 }],
        },
      },
    ],
  }
}
