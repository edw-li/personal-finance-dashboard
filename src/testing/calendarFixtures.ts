import type { CalendarEvent, CalendarEventType, CalendarSource } from '../types/api'

// The ONE way tests build a calendar event (2026-09-03 calendar spec §6): every v2 field
// has a sensible default, so a fixture states only what it is about. Source, key and href
// follow the type the way the server derives them.
export const TYPE_SOURCE: Record<CalendarEventType, CalendarSource> = {
  rsu_vest: 'rsu',
  espp_purchase: 'espp',
  espp_qualify: 'espp',
  offering_start: 'espp',
  ex_dividend: 'dividend',
  payday: 'payroll',
  tax_deadline: 'tax',
  update_due: 'ritual',
  custom: 'custom',
  card_fee: 'card',
  card_credit: 'card',
  card_anniversary: 'card',
}

const DEFAULT_REF: Record<CalendarEventType, string> = {
  rsu_vest: 'vest',
  espp_purchase: 'purchase',
  espp_qualify: 'qualify',
  offering_start: 'offering',
  ex_dividend: 'NVDA',
  payday: 'payday',
  tax_deadline: 'q3',
  update_due: '2026-08',
  custom: '1',
  card_fee: '1-fee',
  card_credit: 'credit-1',
  card_anniversary: '1',
}

const DEFAULT_HREF: Record<CalendarEventType, string | null> = {
  rsu_vest: '/comp',
  espp_purchase: '/espp',
  espp_qualify: '/espp',
  offering_start: '/espp',
  ex_dividend: '/portfolio',
  payday: '/paycheck',
  tax_deadline: '/taxes',
  update_due: '/update',
  custom: null,
  card_fee: '/credit-cards',
  card_credit: '/credit-cards',
  card_anniversary: '/credit-cards',
}

export function calendarEvent(
  over: Partial<CalendarEvent> & Pick<CalendarEvent, 'date' | 'type' | 'label'>,
): CalendarEvent {
  const source = over.source ?? TYPE_SOURCE[over.type]
  const id = over.id ?? null
  const entity_ref =
    over.entity_ref ?? (over.type === 'custom' && id !== null ? String(id) : DEFAULT_REF[over.type])
  return {
    source,
    entity_ref,
    key: `${source}:${entity_ref}:${over.date}`,
    short_label: over.label.slice(0, 24),
    detail: null,
    amount: null,
    direction: 'neutral',
    basis: 'scheduled',
    items: [],
    href: DEFAULT_HREF[over.type],
    id,
    person_id: null,
    recurrence: null,
    until: null,
    series_start: null,
    done: false,
    hidden: false,
    note: null,
    amount_overridden: false,
    ...over,
  }
}
