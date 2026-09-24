import type { FlowsPartOut } from '../types/api'
import { LONG_MONTHS, dayLabel } from './asOf'
import { addDays, currentYear } from './months'

// The day and month names every time surface speaks (2026-09-23 spec §T3, §T4, §T6, §T8, §T12):
// Needs attention, Data status, the ribbon's words, chart heads, the Budgets view. ONE year rule
// — a year only outside the SERVER's current year — and ONE spelling: asOf.ts's day label and
// month list, so an attention line, a chip and a tooltip can never name one date two ways.
// Pure; ISO strings are split, never parsed.

/** 'Oct 1' — ', 2025' outside the server's year (asOf.ts's day label). */
export function dayName(iso: string): string {
  return dayLabel(iso)
}

/** 'September' — ' 2025' outside the server's year. */
export function monthName(iso: string): string {
  const year = Number(iso.slice(0, 4))
  const name = LONG_MONTHS[Number(iso.slice(5, 7)) - 1]
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
