// Pure tooltip + CSV helpers for the spending stacked-bars chart — no React, no
// fetching, no theme decisions of their own (budgetChartOptions.ts's posture). The
// option itself stays in SpendingPage (it reads page state); only the parts worth
// unit-testing live here. Number() is display-only (format.ts's rule).
import { escapeHtml, formatCurrency } from '../../utils/format'

// Axis-tooltip params subset the formatter reads (historyChartOptions' posture).
interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
}

/**
 * The stacked bars' axis tooltip (2026-08-25 spec §2b, the vestingChartOptions Total-row
 * pattern): each CATEGORY row carries its (xx%) share of the month's category total, a
 * bold Total row closes the categories, and the reference lines — net pay, the 4% rule,
 * budget steps — list AFTER it, excluded from the sum: they are comparisons, not spend.
 * Shares are computed over the rows actually under the pointer, so legend-hidden
 * categories leave percentages that still add to 100. Padded nulls (net pay's gaps) are
 * dropped, historyTooltipFormatter's rule. Category names are USER TEXT — escapeHtml on
 * every series name (the page's own rule); budget-step names carry them too, so
 * reference rows are escaped alike.
 */
export function spendingBarsTooltipFormatter(
  categoryNames: string[],
): (params: unknown) => string {
  const categories = new Set(categoryNames)
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    const finite = list.flatMap((p) =>
      typeof p.value === 'number' && Number.isFinite(p.value) ? [{ p, value: p.value }] : [],
    )
    if (finite.length === 0) return ''
    const catRows = finite.filter(({ p }) => categories.has(p.seriesName ?? ''))
    const refRows = finite.filter(({ p }) => !categories.has(p.seriesName ?? ''))
    const total = catRows.reduce((sum, { value }) => sum + value, 0)
    const line = ({ p, value }: { p: AxisTooltipParam; value: number }, share: boolean) => {
      // A zero-or-below total cannot scale a share (a refund month) — rows go bare.
      const pct = share && total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : ''
      return `${p.marker ?? ''}${escapeHtml(p.seriesName ?? '')}: ${formatCurrency(value)}${pct}`
    }
    return [
      `<strong>${finite[0].p.axisValueLabel ?? ''}</strong>`,
      ...catRows.map((row) => line(row, true)),
      ...(catRows.length > 0 ? [`<strong>Total: ${formatCurrency(total)}</strong>`] : []),
      ...refRows.map((row) => line(row, false)),
    ].join('<br/>')
  }
}
