// Pure Up-next math for the overview strip (2026-09-03 calendar spec §14; attention.ts's
// charter: no React, no fetching, todayIso injectable). Fed from the same GET /calendar the
// page uses (today → +45 days).
import type { CalendarEvent } from '../../types/api'
import { addDays } from '../../utils/months'
import { DEADLINE_TYPES } from '../calendar/calendarView'
import { cashLine, windowSummary } from '../calendar/cashflow'

export const UP_NEXT_LIMIT = 5
export const UP_NEXT_WINDOW_DAYS = 45
export const SOON_DAYS = 14

/** Not hidden, not done, not past; deadlines due within 14 days first, then by date; at most
 *  ONE payday (two a month would crowd out everything else); the strip's five. */
export function rankUpNext(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  const soonEdge = addDays(todayIso, SOON_DAYS)
  const live = events.filter((e) => !e.hidden && !e.done && e.date >= todayIso)
  const soonDeadline = (e: CalendarEvent) => DEADLINE_TYPES.includes(e.type) && e.date <= soonEdge
  const ordered = [...live].sort(
    (a, b) => Number(soonDeadline(b)) - Number(soonDeadline(a)) || a.date.localeCompare(b.date),
  )
  const picked: CalendarEvent[] = []
  let paydays = 0
  for (const event of ordered) {
    if (event.type === 'payday') {
      if (paydays === 1) continue
      paydays += 1
    }
    picked.push(event)
    if (picked.length === UP_NEXT_LIMIT) break
  }
  return picked
}

/** "Next 45 days: +$X in · −$Y out" from the same cents arithmetic as the calendar strip.
 *  It sums the whole WINDOW, not the five listed rows: the list is about attention, the line
 *  is about money, and a second payday the list dropped still lands in the account. */
export function upNextLine(events: CalendarEvent[], todayIso: string): string {
  const summary = windowSummary(events, todayIso, addDays(todayIso, UP_NEXT_WINDOW_DAYS))
  // Vesting is not cash; the calendar's own strip is where that leg is reported.
  const line = cashLine({ ...summary, vesting: 0 })
  return `Next ${UP_NEXT_WINDOW_DAYS} days: ${line}`
}

/** Kept for callers that only trim (the assistant's context builder mirrors it server-side). */
export function upNextItems(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  return rankUpNext(events, todayIso)
}
