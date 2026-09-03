import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarEvent } from '../../types/api'
import {
  EVENT_COLORS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  eventKey,
  groupByDate,
  hrefLabel,
  personSuffix,
  stripPersonSuffix,
} from './calendarView'

describe('EVENT_COLORS', () => {
  it('is the FIXED literal slot map — a remap must fail here (index.css owns the hues)', () => {
    expect(EVENT_COLORS).toEqual({
      rsu_vest: 'var(--chart-1)',
      espp_purchase: 'var(--chart-2)',
      espp_qualify: 'var(--chart-3)',
      ex_dividend: 'var(--chart-4)',
      update_due: 'var(--chart-5)',
      payday: 'var(--chart-6)',
      offering_start: 'var(--chart-7)',
      tax_deadline: 'var(--chart-8)',
      custom: 'var(--muted)',
      card_fee: 'var(--chart-7)',
      card_credit: 'var(--chart-7)',
      card_anniversary: 'var(--chart-7)',
    })
  })

  // Twelve types cannot each own one of nine slots — the three card types share the
  // card family's until Lane C replaces this map with SOURCE_COLORS (eight for eight).
  it('names every type in the legend order', () => {
    expect(EVENT_TYPE_ORDER).toHaveLength(12)
    for (const type of EVENT_TYPE_ORDER) {
      expect(EVENT_COLORS[type]).toBeDefined()
      expect(EVENT_TYPE_LABELS[type].length).toBeGreaterThan(0)
    }
  })

  it('colors custom with the muted theme token, labels and orders it last', () => {
    expect(EVENT_COLORS.custom).toBe('var(--muted)')
    expect(EVENT_TYPE_LABELS.custom).toBe('Custom')
    expect(EVENT_TYPE_ORDER.at(-1)).toBe('custom')
  })
})

describe('hrefLabel', () => {
  it('names the app pages and falls back to "page"', () => {
    expect(hrefLabel('/comp')).toBe('Comp')
    expect(hrefLabel('/espp')).toBe('ESPP')
    expect(hrefLabel('/portfolio')).toBe('Portfolio')
    expect(hrefLabel('/paycheck')).toBe('Paycheck')
    expect(hrefLabel('/taxes')).toBe('Taxes')
    expect(hrefLabel('/update')).toBe('Monthly update')
    expect(hrefLabel('/credit-cards')).toBe('Credit cards')
    expect(hrefLabel('/nowhere')).toBe('page')
  })
})

describe('eventKey', () => {
  it('keys custom rows by id and computed rows by their identity triple', () => {
    expect(eventKey(calendarEvent({ date: '2026-09-12', type: 'custom', label: 'Car', id: 41 }))).toBe(
      'custom-41',
    )
    expect(
      eventKey(calendarEvent({ date: '2026-09-16', type: 'payday', label: 'Payday' })),
    ).toBe('payday-2026-09-16-Payday')
  })
})

describe('groupByDate', () => {
  it('buckets same-day events together, preserving server order', () => {
    const events: CalendarEvent[] = [
      calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday' }),
      calendarEvent({
        date: '2026-09-15',
        type: 'tax_deadline',
        label: 'Tax deadline — Q3 estimated payment',
        detail: 'Q3 estimated payment',
      }),
      calendarEvent({
        date: '2026-09-16',
        type: 'rsu_vest',
        label: 'RSU vest — 2025 offer',
        detail: '25 sh — 2025 offer',
      }),
    ]
    const grouped = groupByDate(events)
    expect([...grouped.keys()]).toEqual(['2026-09-15', '2026-09-16'])
    expect(grouped.get('2026-09-15')?.map((e) => e.type)).toEqual(['payday', 'tax_deadline'])
  })
})

describe('person suffix', () => {
  it('is the server grammar verbatim — one shape to build and one to peel', () => {
    expect(personSuffix('Sam')).toBe(' — Sam')
    expect(stripPersonSuffix('Dentist — Sam', 'Sam')).toBe('Dentist')
  })

  it('leaves the label alone when the name is unknown or absent', () => {
    // A roster that has not loaded, or a person renamed since the fetch: a visible stale
    // suffix is recoverable, a wrongly-truncated title is not.
    expect(stripPersonSuffix('Dentist — Sam', undefined)).toBe('Dentist — Sam')
    expect(stripPersonSuffix('Dentist', 'Sam')).toBe('Dentist')
  })

  it('peels only the TRAILING occurrence', () => {
    expect(stripPersonSuffix('Sam — Sam', 'Sam')).toBe('Sam')
    expect(stripPersonSuffix('Call — Sam about it', 'Sam')).toBe('Call — Sam about it')
  })
})
