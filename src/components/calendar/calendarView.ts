// Pure calendar-page vocabulary — no React, no fetching (the attention.ts posture).
import type { CalendarEvent, CalendarEventType } from '../../types/api'

// FIXED type -> palette-slot map (charts/theme's slot discipline: fixed order IS the
// CVD-safety mechanism — never reorder, never cycle). Spelled as CSS custom properties
// rather than hexes because every consumer is a DOM inline style — the grid chip's left
// border, the legend dot, the popover dot — and never an ECharts option (a var() string
// would be an invalid option value). That way the light theme repaints these the same way
// it repaints the charts. Color is never the only channel: every chip carries its label
// text, and the legend names the types.
export const EVENT_COLORS: Record<CalendarEventType, string> = {
  rsu_vest: 'var(--chart-1)',
  espp_purchase: 'var(--chart-2)',
  espp_qualify: 'var(--chart-3)',
  ex_dividend: 'var(--chart-4)',
  update_due: 'var(--chart-5)',
  payday: 'var(--chart-6)',
  offering_start: 'var(--chart-7)',
  tax_deadline: 'var(--chart-8)',
  // User-entered rows: the palette caps chart slots at 8 (fixed order IS the CVD
  // mechanism), so custom wears the theme's muted gray — "entered, not derived".
  custom: 'var(--muted)',
  // The three card types share the card family's slot until Lane C colors by SOURCE.
  card_fee: 'var(--chart-7)',
  card_credit: 'var(--chart-7)',
  card_anniversary: 'var(--chart-7)',
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
  card_fee: 'Card annual fee',
  card_credit: 'Card credit resets',
  card_anniversary: 'Card anniversary',
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
  'card_fee',
  'card_credit',
  'card_anniversary',
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
  '/credit-cards': 'Credit cards',
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

// The person-tag grammar, mirroring the server's services/calendar_events.person_suffix:
// a tagged event reads "<label> — <name>" on the grid chip, in the list row, and in the ICS
// SUMMARY (which is the label verbatim).
export function personSuffix(name: string): string {
  return ` — ${name}`
}

/** The label the user actually TYPED. GET /calendar stamps the owner's name onto a tagged
 *  event, so the edit form and the delete-Undo re-POST must peel it back off — otherwise the
 *  next save stores "Dentist — Sam" and the composer stamps it again. Nothing is stripped
 *  when the name is unknown (a roster that has not loaded, or a person renamed since the
 *  fetch): a visible stale suffix is recoverable, a wrongly-truncated title is not. */
export function stripPersonSuffix(label: string, name: string | undefined): string {
  if (name === undefined) return label
  const suffix = personSuffix(name)
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label
}
