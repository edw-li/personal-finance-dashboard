import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../types/api'
import { EVENT_COLORS, EVENT_TYPE_LABELS, EVENT_TYPE_ORDER, groupByDate } from './calendarView'

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
    })
  })

  it('gives every type its own hue and the legend names them all', () => {
    expect(new Set(Object.values(EVENT_COLORS)).size).toBe(8)
    expect(EVENT_TYPE_ORDER).toHaveLength(8)
    for (const type of EVENT_TYPE_ORDER) {
      expect(EVENT_COLORS[type]).toBeDefined()
      expect(EVENT_TYPE_LABELS[type].length).toBeGreaterThan(0)
    }
  })
})

describe('groupByDate', () => {
  it('buckets same-day events together, preserving server order', () => {
    const events: CalendarEvent[] = [
      { date: '2026-09-15', type: 'payday', label: 'Payday', detail: null, href: '/paycheck' },
      {
        date: '2026-09-15',
        type: 'tax_deadline',
        label: 'Tax deadline — Q3 estimated payment',
        detail: 'Q3 estimated payment',
        href: '/taxes',
      },
      {
        date: '2026-09-16',
        type: 'rsu_vest',
        label: 'RSU vest — 2025 offer',
        detail: '25 sh — 2025 offer',
        href: '/comp',
      },
    ]
    const grouped = groupByDate(events)
    expect([...grouped.keys()]).toEqual(['2026-09-15', '2026-09-16'])
    expect(grouped.get('2026-09-15')?.map((e) => e.type)).toEqual(['payday', 'tax_deadline'])
  })
})
