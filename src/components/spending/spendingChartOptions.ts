// Pure tooltip + CSV helpers for the spending stacked-bars chart — no React, no
// fetching, no theme decisions of their own (budgetChartOptions.ts's posture). The
// option itself stays in SpendingPage (it reads page state); only the parts worth
// unit-testing live here. Number() is display-only (format.ts's rule).
import type { SpendingMatrix } from '../../types/api'
import type { ExportTable } from '../../utils/download'
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
    if (list.length === 0) return ''
    const finite = list.flatMap((p) =>
      typeof p.value === 'number' && Number.isFinite(p.value) ? [{ p, value: p.value }] : [],
    )
    const catRows = finite.filter(({ p }) => categories.has(p.seriesName ?? ''))
    const refRows = finite.filter(({ p }) => !categories.has(p.seriesName ?? ''))
    const total = catRows.reduce((sum, { value }) => sum + value, 0)
    const line = ({ p, value }: { p: AxisTooltipParam; value: number }, share: boolean) => {
      // A zero-or-below total cannot scale a share (a refund month) — rows go bare.
      const pct = share && total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : ''
      return `${p.marker ?? ''}${escapeHtml(p.seriesName ?? '')}: ${formatCurrency(value)}${pct}`
    }
    return [
      `<strong>${list.find((p) => p.axisValueLabel)?.axisValueLabel ?? ''}</strong>`,
      // A6: with the series passing nulls through, an absent month has NO finite category
      // rows — say so instead of fabricating $0.00 rows, and close real rows (only) with
      // the Total. (A month with every category legend-hidden reads the same line; that
      // is a deliberate user act, and the reference rows still print below.)
      ...(catRows.length > 0
        ? [
            ...catRows.map((row) => line(row, true)),
            `<strong>Total: ${formatCurrency(total)}</strong>`,
          ]
        : ['no spending entered']),
      ...refRows.map((row) => line(row, false)),
    ].join('<br/>')
  }
}

/**
 * The stacked chart as a table (2026-08-25 spec §2a): month rows × the SAME top-N fold
 * the bars draw, plus Other, the server's Total and Net pay — the export echoes the
 * displayed chart, verbatim server strings. Null cells go empty, never '0.00': absent
 * is not zero.
 */
export function spendingCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'series' | 'totals' | 'net_pay'>,
  topIds: number[],
  nameById: Map<number, string>,
): ExportTable {
  const topSet = new Set(topIds)
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return {
    headers: [
      'Month',
      ...topIds.map((id) => nameById.get(id) ?? String(id)),
      'Other',
      'Total',
      'Net pay',
    ],
    rows: matrix.months.map((month, i) => [
      month,
      ...topIds.map((id) => valuesById.get(id)?.[i] ?? ''),
      matrix.series
        .reduce(
          (acc, s) => (topSet.has(s.category_id) ? acc : acc + Number(s.values[i] ?? 0)),
          0,
        )
        .toFixed(2),
      matrix.totals[i],
      matrix.net_pay[i] ?? '',
    ]),
  }
}
