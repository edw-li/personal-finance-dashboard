// Pure calendar-page vocabulary — no React, no fetching (the attention.ts posture).
import type { CalendarEvent, CalendarEventType, CalendarSource } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { signedCompact, toCents } from './cashflow'

// FIXED source → palette-slot map (2026-09-03 calendar spec §7; charts/theme's slot
// discipline: fixed order IS the CVD mechanism — never reorder, never cycle). Spelled as CSS
// custom properties because every consumer is a DOM inline style (chip border, legend dot,
// drawer bar), never an ECharts option. Color is never the only channel: every chip carries
// its short label, and the health footer names the sources.
export const SOURCE_COLORS: Record<CalendarSource, string> = {
  rsu: 'var(--chart-1)',
  espp: 'var(--chart-2)',
  dividend: 'var(--chart-3)',
  payroll: 'var(--chart-4)',
  tax: 'var(--chart-5)',
  card: 'var(--chart-6)',
  ritual: 'var(--chart-7)',
  custom: 'var(--muted)', // entered, not derived
}

export const SOURCE_LABELS: Record<CalendarSource, string> = {
  rsu: 'RSU vests',
  espp: 'ESPP',
  dividend: 'Ex-dividends',
  payroll: 'Paydays',
  tax: 'Tax deadlines',
  card: 'Cards',
  ritual: 'Monthly update',
  custom: 'Your events',
}

export const SOURCE_ORDER: CalendarSource[] = [
  'rsu',
  'espp',
  'dividend',
  'payroll',
  'tax',
  'card',
  'ritual',
  'custom',
]

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

// Which chips win a crowded cell (spec §7); ties by |amount| descending.
export const CHIP_PRIORITY: CalendarEventType[] = [
  'custom',
  'tax_deadline',
  'update_due',
  'card_fee',
  'rsu_vest',
  'espp_purchase',
  'payday',
  'card_credit',
  'card_anniversary',
  'ex_dividend',
  'espp_qualify',
  'offering_start',
]
/** The types that are something to DO, not something that happens — they can be marked
 *  done, and they lead the Up next strip when they are close. */
export const DEADLINE_TYPES: CalendarEventType[] = ['tax_deadline', 'update_due', 'card_fee']
export const CHIP_CAP = 3

// Details-footer vocabulary (spec §9.2): the page a generated event opens. A fixed map,
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

/** React-key identity — the server's stable key, folded events included. */
export function eventKey(event: CalendarEvent): string {
  return event.key
}

export function isDeadline(event: CalendarEvent): boolean {
  return DEADLINE_TYPES.includes(event.type)
}

/** The compact signed amount for a chip or row, or null when unknowable. */
export function chipAmount(event: CalendarEvent): string | null {
  if (event.amount === null) return null
  return signedCompact(toCents(event.amount), event.direction, event.basis === 'estimated')
}

export function chipText(event: CalendarEvent): string {
  const amount = chipAmount(event)
  return amount === null ? event.short_label : `${event.short_label} ${amount}`
}

export function chipTitle(event: CalendarEvent): string {
  const amount = event.amount === null ? 'amount unknown' : formatCurrency(event.amount)
  return `${event.label} · ${amount} · ${event.amount_overridden ? 'your figure' : event.basis}`
}

/** Hidden events are removed before anything counts them (the cap, the strip, the grid). */
export function visibleEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => !e.hidden)
}

// An unknowable amount sorts BELOW every known one — -1 is under any |cents|.
function absCents(event: CalendarEvent): number {
  return event.amount === null ? -1 : Math.abs(toCents(event.amount))
}

/** Cell order: open items first (a done deadline sorts last and renders struck through),
 *  then CHIP_PRIORITY, then |amount| descending, then the server order. */
export function sortForCell(events: CalendarEvent[]): CalendarEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const doneA = Number(a.event.done && isDeadline(a.event))
      const doneB = Number(b.event.done && isDeadline(b.event))
      if (doneA !== doneB) return doneA - doneB
      const pa = CHIP_PRIORITY.indexOf(a.event.type)
      const pb = CHIP_PRIORITY.indexOf(b.event.type)
      if (pa !== pb) return pa - pb
      const amount = absCents(b.event) - absCents(a.event)
      return amount !== 0 ? amount : a.index - b.index
    })
    .map((x) => x.event)
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

// The person-tag grammar, mirroring the server's generators/payroll.person_suffix: a tagged
// event reads "<label> — <name>" on the chip, in the drawer row, and in the ICS SUMMARY.
export function personSuffix(name: string): string {
  return ` — ${name}`
}

/** The label the user actually TYPED — peel the stamped suffix before a re-save. Nothing is
 *  stripped when the name is unknown: a stale suffix is recoverable, a truncated title is not. */
export function stripPersonSuffix(label: string, name: string | undefined): string {
  if (name === undefined) return label
  const suffix = personSuffix(name)
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label
}
