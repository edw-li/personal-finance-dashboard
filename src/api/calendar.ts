import { api } from './client'
import type { CalendarResponse } from '../types/api'

// Events for the INCLUSIVE [start, end] ISO-date range, sorted by (date, type, label).
// The server 422s a reversed pair or a span past 400 days — callers pass ~3-month
// windows (the page) or a 45-day one (the Overview strip).
export function fetchCalendar(start: string, end: string): Promise<CalendarResponse> {
  return api<CalendarResponse>(`/calendar?start=${start}&end=${end}`)
}
