import type { NetWorthSummary } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { dayOf, monthNameOf } from './monthlyCopy'

// A month's story on its Review step (2026-09-23 spec §M5): its spending and take-home, and the
// net-worth change from ITS 1st to the NEXT 1st — "September: Sep 1 → Oct 1" — read from SAVED
// figures: GET /net-worth/summary?month=M+1, whose delta compares with M's snapshot. The month's own
// balances part is a different snapshot from M+1, so the typed total never feeds the change.

export type NextSnapshot =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed' }
  | { status: 'ready'; summary: NetWorthSummary; balances: Record<number, string> }

export interface MonthStory {
  /** The tile's delta line — null while M+1 is loading. */
  text: string | null
  tone: 'positive' | 'negative' | null
  /** ReviewChanges' balance section: "Largest balance changes · Sep 1 → Oct 1". */
  title: string
  /** Why there is no comparison — null when there is one (or while loading). */
  unavailable: string | null
  /** M+1's per-account balances, when the comparison stands. */
  to: Record<number, string> | null
}

export function monthStory(month: string, next: NextSnapshot): MonthStory {
  const nextMonth = addMonths(month, 1)
  const name = monthNameOf(month)
  const title = `Largest balance changes · ${dayOf(month)} → ${dayOf(nextMonth)}`
  const without = (sentence: string): MonthStory => ({ text: sentence, tone: null, title, unavailable: sentence, to: null })
  if (next.status === 'loading') return { text: null, tone: null, title, unavailable: null, to: null }
  if (next.status === 'failed') return without(`${name}'s change could not be loaded — reload to try again`)
  if (next.status === 'missing') return without(`${name}'s change appears once ${dayOf(nextMonth)} balances are recorded`)
  const { summary } = next
  // M+1 compares with an OLDER snapshot only when M has none of its own.
  if (summary.previous?.month !== month || summary.mom_delta === null) {
    return without(`${name}'s change needs ${dayOf(month)} balances`)
  }
  // Cents decide the glyph and the tone, and a zero prints as a clean $0.00 — the rule every delta
  // on this page follows (a -0 would format as "-$0.00" under a ▲).
  const cents = Math.round(Number(summary.mom_delta) * 100)
  const asOf = summary.as_of ?? null
  const to = summary.provisional ? `${asOf === null ? 'date unknown' : dayOf(asOf)} · provisional` : dayOf(nextMonth)
  return {
    text: `${name}'s change: ${cents < 0 ? '▼' : '▲'} ${formatCurrency(cents === 0 ? 0 : cents / 100)} (${dayOf(month)} → ${to})`,
    tone: cents > 0 ? 'positive' : cents < 0 ? 'negative' : null,
    title,
    unavailable: null,
    to: next.balances,
  }
}
