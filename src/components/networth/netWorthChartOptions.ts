// Pure tooltip/CSV helpers for the net-worth stacked chart — no React, no fetching, no
// theme decisions of their own (historyChartOptions.ts posture). The option itself stays
// in NetWorthPage (it reads page state); only the parts worth unit-testing live here.
import { GROUP_LABELS, GROUP_ORDER, MUTED } from '../../charts/theme'
import type { NetWorthTimeseries } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatMonth } from '../../utils/format'

/** The wizard's snapshot notes, drawn as markers riding the net-worth line. One name so
 * the legend, the tooltip branch and the series stay in lockstep (moved verbatim from
 * NetWorthPage). */
export const NOTES_SERIES = 'Notes'

interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
  data?: unknown
}

/**
 * The stacked chart's axis tooltip: asset-group rows, then their SUBTOTAL (2026-08-25
 * spec §2b — liabilities and the net-worth line already render as their own rows), then
 * the rest in series order. A full formatter, not valueFormatter: the Notes series
 * carries TEXT — and note text is USER TEXT, so escapeHtml is mandatory (SpendingPage's
 * rule). Money rows keep the currency treatment; a padded null still reads as a dash.
 */
export function netWorthStackedTooltipFormatter(
  assetNames: string[],
): (params: unknown) => string {
  const assets = new Set(assetNames)
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    if (list.length === 0) return ''
    const head = `<strong>${list[0].axisValueLabel ?? ''}</strong>`
    const assetLines: string[] = []
    const otherLines: string[] = []
    let assetTotal = 0
    for (const p of list) {
      if (p.seriesName === NOTES_SERIES) {
        const note = (p.data as { note?: string } | undefined)?.note ?? ''
        otherLines.push(`${p.marker ?? ''}${escapeHtml(note)}`)
        continue
      }
      const raw = Array.isArray(p.value) ? p.value[1] : p.value
      const finite = typeof raw === 'number' && Number.isFinite(raw)
      const line = `${p.marker ?? ''}${p.seriesName ?? ''}: ${finite ? formatCurrency(raw) : '—'}`
      if (assets.has(p.seriesName ?? '')) {
        assetLines.push(line)
        if (finite) assetTotal += raw
      } else {
        otherLines.push(line)
      }
    }
    return [
      head,
      ...assetLines,
      // Only when an asset row actually printed — a hover with the stack legend-hidden
      // has nothing to subtotal.
      ...(assetLines.length > 0
        ? [`<strong>Assets: ${formatCurrency(assetTotal)}</strong>`]
        : []),
      ...otherLines,
    ].join('<br/>')
  }
}

/** The stacked chart as a table (2026-08-25 spec §2a): month rows × the seven fixed
 * groups + net worth, verbatim server strings in the palette's own group order. */
export function netWorthCsv(
  ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>,
): ExportTable {
  return {
    headers: ['Month', ...GROUP_ORDER.map((g) => GROUP_LABELS[g]), 'Net worth'],
    rows: ts.months.map((month, i) => [
      month,
      ...GROUP_ORDER.map((g) => ts.group_totals[g][i] ?? ''),
      ts.net_worth[i],
    ]),
  }
}

/** The wedding annotation's shape — narrow on purpose, so the test can read it without
 *  echarts' `any`-ish option types. */
export interface MarriageMarkLine {
  silent: true
  symbol: 'none'
  lineStyle: { color: string; width: number; type: 'dashed' }
  label: { show: true; formatter: string; position: 'insideEndTop'; color: string; fontSize: number }
  data: { xAxis: string }[]
}

/**
 * A dashed vertical rule on the trend at the marriage month (household spec §6). The step
 * at that boundary is REAL — partner history starts fresh there, by decision — so it has to
 * read as intentional rather than as a data glitch.
 *
 * The x-axis is a CATEGORY axis of formatMonth labels, so the markLine's value must be a
 * label, not an ISO date. The wedding day is normalised to its month; if that exact month
 * has no snapshot (a gap, or quarterly granularity) the mark falls FORWARD to the first
 * month on record after it. A wedding later than every snapshot draws nothing — there is
 * no month to mark yet, and clamping it to the last one would date a line to the future.
 */
export function marriageMarkLine(
  months: string[],
  marriageDate: string | null | undefined,
): MarriageMarkLine | undefined {
  if (!marriageDate || months.length === 0) return undefined
  // ISO first-of-month strings compare lexicographically (utils/months.ts's contract).
  const bucket = `${marriageDate.slice(0, 7)}-01`
  const index = months.findIndex((month) => month >= bucket)
  if (index === -1) return undefined
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: MUTED, width: 1, type: 'dashed' },
    label: {
      show: true,
      formatter: 'Married',
      position: 'insideEndTop',
      color: MUTED,
      fontSize: 11,
    },
    data: [{ xAxis: formatMonth(months[index]) }],
  }
}
