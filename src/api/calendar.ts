import { api } from './client'
import type {
  CalendarOverrideBody,
  CalendarOverrideOut,
  CalendarResponse,
  CustomEventBody,
  CustomEventOut,
} from '../types/api'

// Events for the INCLUSIVE [start, end] ISO-date range, sorted by (date, type, label).
// The server 422s a reversed pair or a span past 400 days — callers pass ~3-month
// windows (the page) or a 45-day one (the Overview strip).
export function fetchCalendar(start: string, end: string): Promise<CalendarResponse> {
  return api<CalendarResponse>(`/calendar?start=${start}&end=${end}`)
}

export function createCustomEvent(body: CustomEventBody): Promise<CustomEventOut> {
  return api<CustomEventOut>('/calendar/events', { method: 'POST', body: JSON.stringify(body) })
}

export function updateCustomEvent(id: number, body: CustomEventBody): Promise<CustomEventOut> {
  return api<CustomEventOut>(`/calendar/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCustomEvent(id: number): Promise<void> {
  return api<void>(`/calendar/events/${id}`, { method: 'DELETE' })
}

// The user's edits on GENERATED events (2026-09-03 calendar spec §13) — keyed by the
// event's stable key, full replace. encodeURIComponent keeps the colons path-safe.
export function putCalendarOverride(
  key: string,
  body: CalendarOverrideBody,
): Promise<CalendarOverrideOut> {
  return api<CalendarOverrideOut>(`/calendar/overrides/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
