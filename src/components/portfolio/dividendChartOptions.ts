// Pure option builder for the dividend income chart — no React, no fetching, no theme
// decisions of its own (historyChartOptions.ts posture). Number() is display-only.
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE, SURFACE } from '../../charts/theme'
import type { DividendOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'

export const INCOME_WINDOW_MONTHS = 24

/** Sums of `amount` by pay-date month over the trailing window, zero-filled so quiet
 * months read as quiet rather than absent. Returns null with no rows in the window —
 * the caller renders an empty note (house floor). `todayIso` injectable for tests. */
export function monthlyIncomeOption(
  dividends: DividendOut[],
  todayIso: string,
): EChartsOption | null {
  const end = `${todayIso.slice(0, 7)}-01`
  const start = addMonths(end, -(INCOME_WINDOW_MONTHS - 1))
  const sums = new Map<string, number>()
  for (const d of dividends) {
    const month = `${d.pay_date.slice(0, 7)}-01`
    if (month < start || month > end) continue
    sums.set(month, (sums.get(month) ?? 0) + Number(d.amount))
  }
  if (sums.size === 0) return null
  const months: string[] = []
  for (let m = start; m <= end; m = addMonths(m, 1)) months.push(m)
  return {
    grid: { left: 70, right: 16, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: months.map(formatMonth) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) },
    },
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatCurrency(v as number) },
    series: [
      {
        type: 'bar',
        name: 'Dividends',
        barMaxWidth: 22,
        color: PALETTE[0],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        data: months.map((m) => Math.round((sums.get(m) ?? 0) * 100) / 100),
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
