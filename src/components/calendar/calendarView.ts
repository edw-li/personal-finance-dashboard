// Pure calendar-page vocabulary — no React, no fetching (the attention.ts posture).
import { MUTED, PALETTE } from '../../charts/theme'
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
  // User-entered rows: the palette caps chart slots at 8 (fixed order IS the CVD
  // mechanism), so custom wears the theme's MUTED gray — "entered, not derived".
  custom: MUTED,
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
  custom: 'Custom',
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
  'custom',
]

// Popover footer vocabulary (spec §9.2): the page a computed event opens. A fixed map,
// not string munging — hrefs are wire values.
export const HREF_LABELS: Record<string, string> = {
  '/comp': 'Comp',
  '/espp': 'ESPP',
  '/portfolio': 'Portfolio',
  '/paycheck': 'Paycheck',
  '/taxes': 'Taxes',
  '/update': 'Monthly update',
}

export function hrefLabel(href: string): string {
  return HREF_LABELS[href] ?? 'page'
}

// React-key identity (spec §9.4): custom labels may repeat, so the id keys them;
// computed events key on the ICS-UID triple.
export function eventKey(event: CalendarEvent): string {
  return event.id !== null ? `custom-${event.id}` : `${event.type}-${event.date}-${event.label}`
}

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
