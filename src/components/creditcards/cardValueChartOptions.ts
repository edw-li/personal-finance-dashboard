// Pure option builder for the card-value bars — no React, no fetching, no theme decisions
// of its own. Reduced motion and the dark theme are the EChart wrapper's job (it forces
// `animation: false` after the spread), so everything here is data.
//
// One horizontal bar per card, coloured by its VERDICT (2026-09-23 spec §B6): earns its keep
// is POSITIVE, costs you money (a fee the card does not earn back) is NEGATIVE, and free to
// keep — no fee, nothing extra on these weights — is the neutral grey. The old sign rule painted
// every $0 no-fee card red ("droppable"), and a $0 bar drew nothing at all, so the chart's
// loudest colour and its empty rows both said "close it" about cards that cost nothing. The
// zero line is drawn explicitly so a bar's side of it is readable without hunting the axis.
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, grid, moneyAxis } from '../../charts/grammar'
import { zeroLine } from '../../charts/markLine'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, POSITIVE } from '../../charts/theme'
import { itemTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'
import { formatCurrency } from '../../utils/format'
import { VERDICT_LABEL, roundsToZero, verdictKind, type CardVerdictKind } from './rewardsMath'
import { verdictNote } from './verdictCopy'

export interface CardValueDatum {
  name: string
  marginal: number
  credits: number
  fee: number
  net: number
  /** `tieReason`'s answer — the tie behind a $0 marginal — for the tooltip's why. */
  ties?: string | null
}

const VERDICT_COLOR: Record<CardVerdictKind, string> = {
  earns: POSITIVE,
  costs: NEGATIVE,
  free: OTHER_SERIES_COLOR,
}

// The stub's length: long enough to see and to hover, short enough to read as "nothing".
const STUB_PX = 3

const kindOf = (row: CardValueDatum) => verdictKind({ annualFee: row.fee, net: row.net })

// The verdict's own rule: a row that prints "$0.00" is a $0 row.
const isZero = (row: CardValueDatum) => roundsToZero(row.net)

/** Horizontal net-value bars, one per card, coloured by verdict. Callers pass rows sorted
 *  net-descending; height = max(140, rows×34 + 70). */
export function cardValueChartOption(rows: CardValueDatum[]): EChartsOption {
  return {
    grid: grid('horizontal'),
    tooltip: {
      ...itemTooltip<{ dataIndex?: number }>({
        // Card names are user text — itemTooltip escapes every label and sub-line it renders.
        body: (p) => {
          const row = rows[p.dataIndex ?? -1]
          if (row === undefined) return null
          // The footer's own why (verdictNote): a costly pin, else the tie behind a $0 marginal.
          const note = verdictNote(row, row.ties ?? null)
          return {
            value: row.net,
            label: row.name,
            sub:
              `${formatCurrency(row.marginal)} marginal + ${formatCurrency(row.credits)} credits` +
              ` − ${formatCurrency(row.fee)} fee, per year · ${VERDICT_LABEL[kindOf(row)]}` +
              (note === null ? '' : ` (${note})`),
          }
        },
      }),
      // A tie note runs the sub-line to ~850px, and echarts flips a box that will not fit right
      // of the cursor to its LEFT — past the window's edge for a $0 stub mid-chart (real data,
      // 1600px: "…ograph Visa"). Confined, the box stays inside the chart, which is wide enough.
      confine: true,
    },
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
        // A $0 net is a real answer ("free to keep"), not an absent one: every bar is at least a
        // stub, so the row can be seen and hovered like the others.
        barMinHeight: STUB_PX,
        data: rows.map((r) => {
          const color = VERDICT_COLOR[kindOf(r)]
          if (!isZero(r)) return { value: r.net, itemStyle: { color } }
          return {
            value: r.net,
            // No SURFACE hairline on the stub: a 1px border each side would leave 1px of bar.
            itemStyle: { color, borderWidth: 0 },
            label: { show: true, position: 'right', color: MUTED, formatter: '$0 · free to keep' },
          }
        }),
        markLine: zeroLine('x'),
      },
    ],
  }
}

/** The lineup as a table (F12): the three inputs, the net each bar draws, and its verdict. */
export function cardValueCsv(rows: CardValueDatum[]): ExportTable {
  return {
    headers: ['Card', 'Marginal', 'Credits', 'Fee', 'Net', 'Verdict'],
    rows: rows.map((r) => [
      r.name,
      r.marginal.toFixed(2),
      r.credits.toFixed(2),
      r.fee.toFixed(2),
      r.net.toFixed(2),
      VERDICT_LABEL[kindOf(r)],
    ]),
  }
}
