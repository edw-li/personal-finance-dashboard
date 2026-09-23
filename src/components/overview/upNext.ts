// Pure Up-next math for the overview strip (2026-09-03 calendar spec §14; attention.ts's
// charter: no React, no fetching, todayIso injectable). Fed from one GET /calendar over
// upNextWindow — its events AND its living-cost estimates.
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

/** "Next 45 days" is exactly 45 days: today and the 44 after it, inclusive. ONE window for the
 *  fetch, the dated legs and the living pro-ration (2026-09-23 lane B1 review, M5 — it used to
 *  run to today + 45, a 46th day in every leg). */
export function upNextWindow(todayIso: string): { start: string; end: string } {
  return { start: todayIso, end: addDays(todayIso, UP_NEXT_WINDOW_DAYS - 1) }
}

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

/** The 45-day line, in the pieces the card keeps whole. */
export interface UpNextMoney {
  /** "Next 45 days:" */
  lead: string
  /** One clause per leg — or the one "nothing due" / "amounts unknown" when no leg has money. */
  clauses: string[]
  /** The living-costs clause is among them: an empty agenda still shows the line then
   *  (2026-09-23 lane B1 review, M5 — the days cost money whether or not anything is dated). */
  living: boolean
}

/** The 45-day line (2026-09-23 spec §B2): "+$12.4k scheduled in", "−$50 scheduled out",
 *  "≈ −$8.0k living costs". The dated legs are the calendar strip's own cents arithmetic, named
 *  "scheduled" because that is all they are; the living leg spreads each month's server
 *  estimate over its days inside the window (today's month counts only what is left of it) and
 *  appears only when every month the window touches has an estimate — a partial sum would
 *  understate the very spending it is there to show. It sums the whole WINDOW, not the five
 *  listed rows: the list is about attention, the line is about money, and a second payday the
 *  list dropped still lands in the account. Vesting is not cash; the calendar's own strip
 *  reports that leg. */
export function upNextMoney(
  events: CalendarEvent[],
  living: readonly CalendarLiving[],
  todayIso: string,
): UpNextMoney {
  const { start, end } = upNextWindow(todayIso)
  const s = windowSummary(events, start, end)
  const clauses: string[] = []
  if (s.cashIn !== 0) {
    clauses.push(`${signedCompact(s.cashIn, 'in', s.estimated.cashIn)} scheduled in`)
  }
  if (s.cashOut !== 0) {
    clauses.push(`${signedCompact(s.cashOut, 'out', s.estimated.cashOut)} scheduled out`)
  }
  const livingCents = proratedLivingCents(living, start, end)
  const withLiving = livingCents !== null && livingCents !== 0
  if (withLiving) {
    // Spending leaves the account: a minus, like the scheduled-out leg's.
    clauses.push(`≈ ${livingCents > 0 ? '−' : '+'}${formatCompactCents(livingCents)} living costs`)
  }
  if (clauses.length === 0) clauses.push(s.unknown > 0 ? 'amounts unknown' : 'nothing due')
  return { lead: `Next ${UP_NEXT_WINDOW_DAYS} days:`, clauses, living: withLiving }
}

/** Kept for callers that only trim (the assistant's context builder mirrors it server-side). */
export function upNextItems(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  return rankUpNext(events, todayIso)
}
