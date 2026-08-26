// Pure option builder for the credit-line history chart — no React, no fetching, no theme
// decisions of its own. Reduced motion and the dark theme are the EChart wrapper's job
// (it forces `animation: false` after the spread), so everything here is data.
//
// A monthly CATEGORY axis, the house grammar (taxChartOptions' trend, compChartOptions'
// trajectory): no time axis, so no new echarts registrations are needed.
//
// Number() at this boundary is deliberate and display-only: limit amounts arrive as decimal
// STRINGS (pydantic v2) and the chart parses each one ONCE here, never handing a float back
// to the API (src/utils/format.ts's rule, and the same posture as taxChartOptions.ts).
import type { EChartsOption } from '../../charts/echarts'
import { INK, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'

export interface LimitHistoryCard {
  name: string
  events: { effective_date: string; limit_amount: string }[]
}

/** First-of-month ISO for an event date: '2024-08-15' → '2024-08-01'. */
export function monthOf(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`
}

/** Ascending month axis from the earliest event month through `endMonthIso`
 *  (callers pass currentMonthIso()). Empty when no card has events. */
export function limitMonths(cards: LimitHistoryCard[], endMonthIso: string): string[] {
  let first: string | null = null
  for (const card of cards)
    for (const event of card.events) {
      const month = monthOf(event.effective_date)
      if (first === null || month < first) first = month
    }
  if (first === null) return []
  const months: string[] = []
  let cursor = first
  while (cursor <= endMonthIso) {
    months.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return months
}

/** Step-resolved limit per month: the amount of the latest event in-or-before each
 *  month; months before the first event are null (the card didn't exist yet). */
export function resolvedLimits(card: LimitHistoryCard, months: string[]): (number | null)[] {
  const events = [...card.events].sort((a, b) =>
    a.effective_date < b.effective_date ? -1 : a.effective_date > b.effective_date ? 1 : 0,
  )
  const values: (number | null)[] = []
  let pointer = 0
  let current: number | null = null
  for (const month of months) {
    while (pointer < events.length && monthOf(events[pointer].effective_date) <= month) {
      current = Number(events[pointer].limit_amount)
      pointer += 1
    }
    values.push(current)
  }
  return values
}

/** Per-card step lines + optional INK Total. PALETTE slots are fixed by array
 *  position; a 9th+ card wears OTHER_SERIES_COLOR (never cycle past 8 — theme law). */
export function creditLineChartOption(
  cards: LimitHistoryCard[],
  months: string[],
  { includeTotal }: { includeTotal: boolean },
): EChartsOption {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const total = months.map((_, i) => {
    let sum = 0
    let any = false
    for (const values of perCard) {
      const v = values[i]
      if (v === null) continue
      any = true
      sum += v
    }
    return any ? sum : null
  })
  return {
    grid: { left: 70, right: 24, top: 40, bottom: 28 },
    legend: { top: 0 },
    tooltip: {
      trigger: 'axis',
      // One unit for every series, so the single valueFormatter covers them all
      // (compChartOptions' trajectory). Card names reach the tooltip as SERIES NAMES,
      // which echarts renders as text — no HTML formatter here, nothing to escape.
      valueFormatter: (value) =>
        value === null || value === undefined ? '—' : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: months.map(formatMonth) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
      ...cards.map((card, i) => ({
        name: card.name,
        type: 'line' as const,
        step: 'end' as const, // limits change discretely — steps, not slopes
        symbol: 'none' as const,
        lineStyle: { width: 2 },
        color: i < PALETTE.length ? PALETTE[i] : OTHER_SERIES_COLOR,
        connectNulls: false,
        data: perCard[i],
      })),
      ...(includeTotal
        ? [
            {
              name: 'Total line',
              type: 'line' as const,
              step: 'end' as const,
              symbol: 'none' as const,
              lineStyle: { width: 2 },
              color: INK,
              z: 10,
              connectNulls: false,
              data: total,
            },
          ]
        : []),
    ],
  }
}
