// Pure tooltip/CSV helpers for the net-worth stacked chart — no React, no fetching, no
// theme decisions of their own (historyChartOptions.ts posture). The option itself stays
// in NetWorthPage (it reads page state); only the parts worth unit-testing live here.
import { escapeHtml, formatCurrency } from '../../utils/format'

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
