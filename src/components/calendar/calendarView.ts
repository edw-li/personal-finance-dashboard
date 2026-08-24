// Pure calendar-page vocabulary — no React, no fetching (the attention.ts posture).
import { PALETTE } from '../../charts/theme'
import type { CalendarEvent, CalendarEventType } from '../../types/api'

// FIXED type -> PALETTE-slot map (charts/theme's slot discipline: fixed order IS the
// CVD-safety mechanism — never reorder, never cycle). Color is never the only channel:
// every chip carries its label text, and the legend names the types.
export const EVENT_COLORS: Record<CalendarEventType, string> = {
  rsu_vest: PALETTE[0],
  espp_purchase: PALETTE[1],
  espp_qualify: PALETTE[2],
  ex_dividend: PALETTE[3],
  update_due: PALETTE[4],
  payday: PALETTE[5],
  offering_start: PALETTE[6],
  tax_deadline: PALETTE[7],
}

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  rsu_vest: 'RSU vest',
  espp_purchase: 'ESPP purchase',
  espp_qualify: 'ESPP qualifying date',
  ex_dividend: 'Ex-dividend',
  payday: 'Payday',
  offering_start: 'ESPP offering start',
  tax_deadline: 'Tax deadline',
  update_due: 'Monthly update due',
}

// Legend order — one place, so the legend and any future filter row agree.
export const EVENT_TYPE_ORDER: CalendarEventType[] = [
  'rsu_vest',
  'espp_purchase',
  'espp_qualify',
  'ex_dividend',
  'payday',
  'offering_start',
  'tax_deadline',
  'update_due',
]

// Events keyed by their ISO date, server order preserved within a day (a Map keeps
// insertion order, so iterating it renders days chronologically for a sorted payload).
export function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const bucket = grouped.get(event.date)
    if (bucket) bucket.push(event)
    else grouped.set(event.date, [event])
  }
  return grouped
}
