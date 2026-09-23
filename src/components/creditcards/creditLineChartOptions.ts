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
import { slotColor } from '../../charts/entities'
import { LINE, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { INK } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'
import { formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'

export interface LimitHistoryCard {
  /** The card's id — its colour key, so a card keeps its hue wherever the user drags it
   *  (2026-09-23 drag-to-reorder spec §7). Optional for a caller that draws one card's own
   *  history (CardDetail) or a fixture: without ids, a card's slot is its array position. */
  id?: number
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

/** The total line across the cards that exist in each month; null before the first one
 *  does (a total of nothing is not zero). Shared by the option and its CSV. */
function totalLine(perCard: (number | null)[][], months: string[]): (number | null)[] {
  return months.map((_, i) => {
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
}

/** Each card's PALETTE slot: its rank BY ID (2026-09-23 drag-to-reorder spec §7). The list
 *  order is the user's — it sets the series, legend and tooltip order — and a reorder must never
 *  repaint a card. `rankIds` is the household's active cards, every person's included, so a scope
 *  that draws fewer cards repaints none, and a card's drill-in wears its page colour (spec §7 as
 *  amended); without it the cards drawn rank among themselves. A drawn id the source leaves out
 *  (an archived card's own drill-in) still ranks, among the rest. When any card comes without an
 *  id (a fixture), every card keeps its array position. */
export function colourSlots(
  cards: readonly LimitHistoryCard[],
  rankIds?: readonly number[],
): number[] {
  const ids: number[] = []
  for (const card of cards) {
    if (card.id === undefined) return cards.map((_, index) => index)
    ids.push(card.id)
  }
  const ranked = [...new Set([...(rankIds ?? []), ...ids])].sort((a, b) => a - b)
  return ids.map((id) => ranked.indexOf(id))
}

/** Per-card step lines + optional INK Total, in the list's order. A card's colour is its
 *  colourSlots rank, so it survives a reorder and a person scope; a 9th+ rank wears
 *  OTHER_SERIES_COLOR (never cycle past 8 — theme law). */
export function creditLineChartOption(
  cards: LimitHistoryCard[],
  months: string[],
  {
    includeTotal,
    selected,
    rankIds,
  }: {
    includeTotal: boolean
    selected?: Record<string, boolean>
    /** The ids to rank colours against — the page passes the household's active cards. */
    rankIds?: readonly number[]
  },
): EChartsOption {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const slots = colourSlots(cards, rankIds)
  const series = [
    ...cards.map((card, i) => ({
      ...LINE,
      name: card.name,
      step: 'end' as const, // limits change discretely — steps, not slopes
      color: slotColor(slots[i]),
      connectNulls: false,
      data: perCard[i],
    })),
    ...(includeTotal
      ? [
          {
            ...LINE,
            name: 'Total line',
            step: 'end' as const,
            color: INK,
            z: 10,
            connectNulls: false,
            data: totalLine(perCard, months),
          },
        ]
      : []),
  ]
  return {
    grid: grid(),
    legend: legendFor(series.length, selected),
    // One unit for every series, and card names reach the rows as SERIES NAMES — the
    // grammar escapes each of them (charts/tooltip.ts).
    tooltip: axisTooltip({ unit: 'money' }),
    xAxis: monthAxis(months.map(formatMonth), { gap: true }),
    yAxis: moneyAxis(),
    series,
  }
}

/** The history as a table (F12): month × card + the total, blank before a card exists. */
export function creditLineCsv(cards: LimitHistoryCard[], months: string[]): ExportTable {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const total = totalLine(perCard, months)
  const cell = (v: number | null) => (v === null ? '' : v.toFixed(2))
  return {
    headers: ['Month', ...cards.map((c) => c.name), 'Total'],
    rows: months.map((m, i) => [m, ...perCard.map((values) => cell(values[i])), cell(total[i])]),
  }
}
