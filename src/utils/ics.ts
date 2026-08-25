// Client-side ICS export (2026-08-24 spec §6): a VCALENDAR/PUBLISH text with one
// all-day VEVENT per fetched event. Pure text builder + a blob-download shim, so the
// text is a function of the events alone — that is what makes UIDs (and the whole
// export) stable across exports, letting calendar apps UPDATE instead of duplicating.
// DTSTAMP is mandatory in a VEVENT (RFC 5545 §3.6.1) and Outlook is the client that
// enforces it — but a real clock would break byte-stability, so it is DETERMINISTIC:
// the event's own date at 00:00:00Z. Deliberate omission, accepted: no 75-octet line
// folding (labels/details are short human lines).
import type { CalendarEvent } from '../types/api'

// RFC 5545 §3.3.11 TEXT escaping: backslash FIRST, then semicolon, comma, newlines.
export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// UID stability contract (pinned by test): the same event yields the same UID on every
// export. Labels carry identity (the server's rule), so same-day same-type events from
// different sources never collide.
export function eventUid(event: CalendarEvent): string {
  return `${event.type}-${event.date}-${slugify(event.label)}@finance-dashboard`
}

export function buildIcs(events: CalendarEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//finance-dashboard//calendar//EN',
    'METHOD:PUBLISH',
  ]
  for (const event of events) {
    // DESCRIPTION = detail + href (spec §6); href is always present, so a detail-less
    // event still describes where it lives in the app.
    const description = [event.detail, event.href].filter(Boolean).join(' — ')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(event)}`,
      `DTSTAMP:${event.date.replaceAll('-', '')}T000000Z`,
      `DTSTART;VALUE=DATE:${event.date.replaceAll('-', '')}`,
      `SUMMARY:${escapeIcsText(event.label)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export function downloadIcs(
  events: CalendarEvent[],
  filename = 'financial-calendar.ics',
): void {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
