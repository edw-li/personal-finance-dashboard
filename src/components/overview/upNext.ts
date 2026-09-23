// Pure Up-next math for the overview strip (2026-09-03 calendar spec §14; attention.ts's
// charter: no React, no fetching, todayIso injectable). Fed from the same GET /calendar the
// page uses (today → +45 days) — its events AND its living-cost estimates.
import type { CalendarEvent, CalendarLiving } from '../../types/api'
import { addDays } from '../../utils/months'
import { DEADLINE_TYPES } from '../calendar/calendarView'
import {
  formatCompactCents,
  proratedLivingCents,
  signedCompact,
  windowSummary,
} from '../calendar/cashflow'

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

/** "Next 45 days: +$12.4k scheduled in · −$50 scheduled out · ≈ −$8.2k living costs"
 *  (2026-09-23 spec §B2). The dated legs are the calendar strip's own cents arithmetic, named
 *  "scheduled" because that is all they are; the living leg spreads each month's server estimate
 *  over its days inside the window (today's month counts only what is left of it) and appears
 *  only when every month the window touches has an estimate — a partial sum would understate the
 *  very spending it is there to show. It sums the whole WINDOW, not the five listed rows: the
 *  list is about attention, the line is about money, and a second payday the list dropped still
 *  lands in the account. Vesting is not cash; the calendar's own strip reports that leg. */
export function upNextLine(
  events: CalendarEvent[],
  living: readonly CalendarLiving[],
  todayIso: string,
): string {
  const end = addDays(todayIso, UP_NEXT_WINDOW_DAYS)
  const s = windowSummary(events, todayIso, end)
  const parts: string[] = []
  if (s.cashIn !== 0) parts.push(`${signedCompact(s.cashIn, 'in', s.estimated.cashIn)} scheduled in`)
  if (s.cashOut !== 0) {
    parts.push(`${signedCompact(s.cashOut, 'out', s.estimated.cashOut)} scheduled out`)
  }
  const livingCents = proratedLivingCents(living, todayIso, end)
  if (livingCents !== null && livingCents !== 0) {
    // Spending leaves the account: a minus, like the scheduled-out leg's.
    parts.push(`≈ ${livingCents > 0 ? '−' : '+'}${formatCompactCents(livingCents)} living costs`)
  }
  if (parts.length === 0) {
    return `Next ${UP_NEXT_WINDOW_DAYS} days: ${s.unknown > 0 ? 'amounts unknown' : 'nothing due'}`
  }
  return `Next ${UP_NEXT_WINDOW_DAYS} days: ${parts.join(' · ')}`
}

/** Kept for callers that only trim (the assistant's context builder mirrors it server-side). */
export function upNextItems(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  return rankUpNext(events, todayIso)
}
