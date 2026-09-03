// Pure option builder for the dividend income chart — no React, no fetching, no theme
// decisions of its own (historyChartOptions.ts posture). Number() is display-only.
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { PALETTE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { DividendOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'

export const INCOME_WINDOW_MONTHS = 24

/** Sums of `amount` by pay-date month over the trailing window, zero-filled and rounded
 * to cents; null with no rows in the window. ONE computation shared by the chart and its
 * CSV export (2026-08-25 spec §2a) so the two can never disagree. `todayIso` injectable
 * for tests. */
export function monthlyIncomeSums(
  dividends: DividendOut[],
  todayIso: string,
): { month: string; amount: number }[] | null {
  const end = `${todayIso.slice(0, 7)}-01`
  const start = addMonths(end, -(INCOME_WINDOW_MONTHS - 1))
  const sums = new Map<string, number>()
  for (const d of dividends) {
    const month = `${d.pay_date.slice(0, 7)}-01`
    if (month < start || month > end) continue
    sums.set(month, (sums.get(month) ?? 0) + Number(d.amount))
  }
  if (sums.size === 0) return null
  const rows: { month: string; amount: number }[] = []
  for (let m = start; m <= end; m = addMonths(m, 1)) {
    rows.push({ month: m, amount: Math.round((sums.get(m) ?? 0) * 100) / 100 })
  }
  return rows
}

/** Month/amount rows for the ⤓ menu — empty when the chart itself would be absent. */
export function monthlyIncomeCsv(dividends: DividendOut[], todayIso: string): ExportTable {
  const rows = monthlyIncomeSums(dividends, todayIso) ?? []
  return { headers: ['Month', 'Dividends'], rows: rows.map((r) => [r.month, r.amount.toFixed(2)]) }
}

/** Sums of `amount` by pay-date month over the trailing window, zero-filled so quiet
 * months read as quiet rather than absent — the computation shared with
 * monthlyIncomeCsv. Returns null with no rows in the window — the caller simply omits
 * the chart (the tiles still render whenever the log has rows at all). `todayIso`
 * injectable for tests. */
export function monthlyIncomeOption(
  dividends: DividendOut[],
  todayIso: string,
): EChartsOption | null {
  const rows = monthlyIncomeSums(dividends, todayIso)
  if (rows === null) return null
  return {
    grid: grid('noLegend'),
    xAxis: monthAxis(rows.map((r) => formatMonth(r.month)), { gap: true }),
    yAxis: moneyAxis(),
    tooltip: axisTooltip({ unit: 'money', pointer: 'shadow' }),
    series: [
      {
        type: 'bar',
        name: 'Dividends',
        ...BAR_MARKS,
        color: PALETTE[0],
        data: rows.map((r) => r.amount),
      },
    ],
  }
}

export interface IncomeStats {
  trailing12: number | null // sum of the last 12 months incl. the current one
  ytd: number | null // sum of the current calendar year
}

/** null = the log has no rows at all (dashes); 0 = rows exist but none in the window
 * (ytdStats' dividends convention). */
export function incomeStats(dividends: DividendOut[], todayIso: string): IncomeStats {
  if (dividends.length === 0) return { trailing12: null, ytd: null }
  const currentMonth = `${todayIso.slice(0, 7)}-01`
  const from12 = addMonths(currentMonth, -11)
  const yearPrefix = `${todayIso.slice(0, 4)}-`
  let trailing12 = 0
  let ytd = 0
  for (const d of dividends) {
    const month = `${d.pay_date.slice(0, 7)}-01`
    if (month >= from12 && month <= currentMonth) trailing12 += Number(d.amount)
    if (d.pay_date.startsWith(yearPrefix)) ytd += Number(d.amount)
  }
  return { trailing12, ytd }
}
