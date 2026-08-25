// Client-side ICS export (2026-08-24 spec §6): a VCALENDAR/PUBLISH text with one
// all-day VEVENT per fetched event. Pure text builder + a blob-download shim, so the
// text is a function of the events alone — that is what makes UIDs (and the whole
// export) stable across exports, letting calendar apps UPDATE instead of duplicating.
// DTSTAMP is mandatory in a VEVENT (RFC 5545 §3.6.1) and Outlook is the client that
// enforces it — but a real clock would break byte-stability, so it is DETERMINISTIC:
// the event's own date at 00:00:00Z. Deliberate omission, accepted: no 75-octet line
// folding (labels/details are short human lines).
import type { CalendarEvent } from '../types/api'
import { downloadText } from './download'

// RFC 5545 §3.3.11 TEXT escaping: backslash FIRST, then semicolon, comma, newlines.
export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\n') // lone CR — pasted user text can carry one (spec §9.4)
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
// different sources never collide. Custom events key on the id instead (spec §9.3): a
// rename must UPDATE the event in a subscribed calendar, not duplicate it.
export function eventUid(event: CalendarEvent): string {
  if (event.id !== null) return `custom-${event.id}@finance-dashboard`
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
    // DESCRIPTION = detail + href (spec §6). Custom events have no href (§9.3), so the
    // filter leaves a detail-only — possibly empty — description; empty TEXT is valid.
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
  // One blob-download helper for the whole app (download.ts owns the Safari-safe
  // deferred revoke); this file stays a pure text builder plus this thin shim.
  downloadText(buildIcs(events), filename, 'text/calendar;charset=utf-8')
}
