import { describe, expect, it } from 'vitest'
import { MUTED } from '../../charts/theme'
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
  it('is the FIXED literal slot map — a palette reshuffle or remap must fail here', () => {
    expect(EVENT_COLORS).toEqual({
      rsu_vest: '#3987e5',
      espp_purchase: '#d95926',
      espp_qualify: '#199e70',
      ex_dividend: '#c98500',
      update_due: '#d55181',
      payday: '#008300',
      offering_start: '#9085e9',
      tax_deadline: '#e66767',
      custom: '#8b93a3',
    })
  })

  it('gives every type its own hue and the legend names them all', () => {
    expect(new Set(Object.values(EVENT_COLORS)).size).toBe(9)
    expect(EVENT_TYPE_ORDER).toHaveLength(9)
    for (const type of EVENT_TYPE_ORDER) {
      expect(EVENT_COLORS[type]).toBeDefined()
      expect(EVENT_TYPE_LABELS[type].length).toBeGreaterThan(0)
    }
  })

  it('colors custom with the muted theme token, labels and orders it last', () => {
    expect(EVENT_COLORS.custom).toBe(MUTED)
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
    expect(hrefLabel('/nowhere')).toBe('page')
  })
})

describe('eventKey', () => {
  it('keys custom rows by id and computed rows by their identity triple', () => {
    expect(
      eventKey({
        date: '2026-09-12',
        type: 'custom',
        label: 'Car',
        detail: null,
        href: null,
        id: 41,
      }),
    ).toBe('custom-41')
    expect(
      eventKey({
        date: '2026-09-16',
        type: 'payday',
        label: 'Payday',
        detail: null,
        href: '/paycheck',
        id: null,
      }),
    ).toBe('payday-2026-09-16-Payday')
  })
})

describe('groupByDate', () => {
  it('buckets same-day events together, preserving server order', () => {
    const events: CalendarEvent[] = [
      {
        date: '2026-09-15',
        type: 'payday',
        label: 'Payday',
        detail: null,
        href: '/paycheck',
        id: null,
      },
      {
        date: '2026-09-15',
        type: 'tax_deadline',
        label: 'Tax deadline — Q3 estimated payment',
        detail: 'Q3 estimated payment',
        href: '/taxes',
        id: null,
      },
      {
        date: '2026-09-16',
        type: 'rsu_vest',
        label: 'RSU vest — 2025 offer',
        detail: '25 sh — 2025 offer',
        href: '/comp',
        id: null,
      },
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
