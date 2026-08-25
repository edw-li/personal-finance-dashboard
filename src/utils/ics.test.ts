import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '../types/api'
import { buildIcs, downloadIcs, escapeIcsText, eventUid } from './ics'

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    date: '2026-09-16',
    type: 'rsu_vest',
    label: 'RSU vest — 2025 offer',
    detail: '25 sh — 2025 offer',
    href: '/comp',
    id: null,
    ...over,
  }
}

describe('eventUid', () => {
  it('is the pinned stable shape — calendar apps dedupe on it across exports', () => {
    expect(eventUid(event())).toBe('rsu_vest-2026-09-16-rsu-vest-2025-offer@finance-dashboard')
    expect(eventUid(event())).toBe(eventUid(event()))
  })

  it('keys custom events by id so a rename UPDATES instead of duplicating', () => {
    const custom = event({ type: 'custom', label: 'Car insurance', href: null, id: 41 })
    expect(eventUid(custom)).toBe('custom-41@finance-dashboard')
    expect(eventUid({ ...custom, label: 'Renamed' })).toBe(eventUid(custom))
  })
})

describe('escapeIcsText', () => {
  it('escapes RFC 5545 TEXT characters, backslash first', () => {
    expect(escapeIcsText('a,b;c\nd\\e')).toBe('a\\,b\\;c\\nd\\\\e')
    expect(escapeIcsText('crlf\r\nline')).toBe('crlf\\nline')
  })

  it('escapes a lone carriage return', () => {
    expect(escapeIcsText('a\rb')).toBe('a\\nb')
  })
})

describe('buildIcs', () => {
  it('emits an all-day PUBLISH VEVENT per event with CRLF endings', () => {
    const text = buildIcs([event()])
    const lines = text.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('METHOD:PUBLISH')
    expect(lines).toContain('UID:rsu_vest-2026-09-16-rsu-vest-2025-offer@finance-dashboard')
    expect(lines).toContain('DTSTART;VALUE=DATE:20260916')
    // DTSTAMP is mandatory in a VEVENT (RFC 5545) and Outlook enforces it; deterministic
    // (the event's own date at midnight Z) so byte-stability survives.
    expect(lines).toContain('DTSTAMP:20260916T000000Z')
    expect(lines).toContain('SUMMARY:RSU vest — 2025 offer')
    expect(lines).toContain('DESCRIPTION:25 sh — 2025 offer — /comp')
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(/[^\r]\n/.test(text)).toBe(false) // every newline is CRLF
  })

  it('is byte-stable across exports of the same events', () => {
    const events = [
      event(),
      event({ date: '2026-09-30', type: 'payday', label: 'Payday', detail: null, href: '/paycheck' }),
    ]
    expect(buildIcs(events)).toBe(buildIcs(events))
  })

  it('escapes summaries and falls back to the href-only description', () => {
    const text = buildIcs([event({ label: 'Vest; big, day', detail: null })])
    expect(text).toContain('SUMMARY:Vest\\; big\\, day')
    expect(text).toContain('DESCRIPTION:/comp')
  })
})

describe('downloadIcs', () => {
  it('hands a text/calendar blob to an anchor click and revokes the URL', () => {
    const created: Blob[] = []
    const revoke = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob)
        return 'blob:calendar'
      },
      revokeObjectURL: revoke,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadIcs([event()])
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('text/calendar;charset=utf-8')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:calendar')
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
