import type { FlowsPartOut } from '../types/api'
import { formatAsOf } from './asOf'
import { addDays, currentYear } from './months'

// The day and month names every time surface speaks (2026-09-23 spec §T3, §T4, §T6, §T8, §T12):
// Needs attention, Data status, the ribbon's words, chart heads, the Budgets view. ONE year rule
// — a year only outside the SERVER's current year — and the day label is asOf.ts's own
// (formatAsOf), so an attention line, a chip and a tooltip can never name one date two ways.
// Pure; ISO strings are split, never parsed.

const LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 'Oct 1' — ', 2025' outside the server's year (formatAsOf's label for that day). */
export function dayName(iso: string): string {
  const day = iso.slice(0, 10)
  return formatAsOf({ month: day, as_of: day, provisional: false })
}

/** 'September' — ' 2025' outside the server's year. */
export function monthName(iso: string): string {
  const year = Number(iso.slice(0, 4))
  const name = LONG[Number(iso.slice(5, 7)) - 1]
  return year === currentYear() ? name : `${name} ${year}`
}

/** "Due by" = the day before the part turns overdue (spec §K3's copy note), ISO. */
export function dueByIso(flows: Pick<FlowsPartOut, 'overdue_from'>): string {
  return addDays(flows.overdue_from, -1)
}

/** "Oct 15" for a September whose flows turn overdue on Oct 16. */
export function dueByName(flows: Pick<FlowsPartOut, 'overdue_from'>): string {
  return dayName(dueByIso(flows))
}
