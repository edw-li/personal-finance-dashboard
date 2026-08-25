// Pure Up-next math for the overview strip (attention.ts's charter: no React, no
// fetching, todayIso injectable). The server already sorts by (date, type, label);
// this only guards a cached payload straddling midnight and trims to the strip size.
import type { CalendarEvent } from '../../types/api'

export const UP_NEXT_LIMIT = 5
export const UP_NEXT_WINDOW_DAYS = 45

export function upNextItems(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  return events.filter((event) => event.date >= todayIso).slice(0, UP_NEXT_LIMIT)
}
