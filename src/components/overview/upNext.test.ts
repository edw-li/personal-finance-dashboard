import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../types/api'
import { UP_NEXT_LIMIT, UP_NEXT_WINDOW_DAYS, upNextItems } from './upNext'

function ev(date: string): CalendarEvent {
  return { date, type: 'payday', label: `Event ${date}`, detail: null, href: '/paycheck' }
}

describe('upNextItems', () => {
  it('keeps server order and trims to the limit', () => {
    const events = [
      '2026-08-25',
      '2026-08-31',
      '2026-09-01',
      '2026-09-03',
      '2026-09-15',
      '2026-09-16',
    ].map(ev)
    const picked = upNextItems(events, '2026-08-24')
    expect(picked).toHaveLength(UP_NEXT_LIMIT)
    expect(picked.map((e) => e.date)).toEqual([
      '2026-08-25',
      '2026-08-31',
      '2026-09-01',
      '2026-09-03',
      '2026-09-15',
    ])
  })

  it('drops events already past the injected today, keeps today itself', () => {
    const picked = upNextItems([ev('2026-08-20'), ev('2026-08-24'), ev('2026-08-30')], '2026-08-24')
    expect(picked.map((e) => e.date)).toEqual(['2026-08-24', '2026-08-30'])
  })

  it('pins the strip window the page fetches', () => {
    expect(UP_NEXT_WINDOW_DAYS).toBe(45)
    expect(UP_NEXT_LIMIT).toBe(5)
  })
})
