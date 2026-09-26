import { api, apiDeleteLogged, apiLogged } from './client'
import type { Logged } from './client'
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

// Logged (2026-09-25 polish spec §6.1): the answer names the batch an Undo reverts.
export function deleteCustomEvent(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/calendar/events/${id}`)
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

/** putCalendarOverride's twin for the one-click Hide / Mark done / Your figure (spec §6.2): the same
 *  PUT, answered with the change batch the toggle's Undo toast reverts. */
export function putCalendarOverrideLogged(
  key: string,
  body: CalendarOverrideBody,
): Promise<Logged<CalendarOverrideOut>> {
  return apiLogged<CalendarOverrideOut>(`/calendar/overrides/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
