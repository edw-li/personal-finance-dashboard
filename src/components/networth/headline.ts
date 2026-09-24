import type { FlowsPartOut, NetWorthSummary } from '../../types/api'
import { changePhrase, formatAsOf, storyNote } from '../../utils/asOf'
import { formatCurrency, formatPct } from '../../utils/format'
import { dayName } from '../../utils/timeWords'
import { summaryState } from './snapshotStates'

// The net-worth headline's words (2026-09-23 spec §T1, §T7): the Overview's hero tile and the Net
// worth page's name the balances by the day they describe and the change by what it spans —
// "Net worth — as of Sep 22" · Provisional · "$126,583.02 (+15.7%) since Sep 1 · 21 days", or
// "· September: Sep 1 → Oct 1" between two final 1sts. No "MoM" and no month key: an early
// snapshot's 21 days are not a month, and the change into Oct 1 is September's story, not
// October's. Pure; the figures are the server's, verbatim.

export interface NetWorthHeadline {
  label: string
  /** "Provisional" while the balances were recorded before their date (or are still ahead). */
  badge: string | undefined
  /** Both halves (amount and rate) or neither, then what the change spans. */
  delta: string | undefined
}

type Summary = Pick<NetWorthSummary, 'month' | 'mom_delta' | 'mom_pct'> &
  Partial<Pick<NetWorthSummary, 'as_of' | 'recorded_on' | 'provisional' | 'previous' | 'period'>>

export function netWorthHeadline(summary: Summary, flowsDue?: readonly FlowsPartOut[]): NetWorthHeadline {
  const current = summaryState(summary)
  if (current === null) return { label: 'Net worth', badge: undefined, delta: undefined }
  const label =
    current.as_of === null
      ? `Net worth — ${dayName(current.month)} balances, date unknown`
      : `Net worth — as of ${formatAsOf(current)}`
  const previous = summary.previous ?? null
  const phrase = changePhrase(previous, current, { period: summary.period ?? 'month' })
  // "since …" reads on from the figures; a month's own span stands apart after a dot.
  const since = phrase !== null && phrase.startsWith('since')
  const span = phrase === null ? '' : since ? ` ${phrase}` : ` · ${phrase}`
  // The month the change covers is the previous snapshot's: Sep 1 → Oct 1 is September's story,
  // incomplete while September's spending is listed as due (§0.4(d) storyNote). Only a month's
  // story carries the note (§T1): a "since …" span — balances typed early, a gap of months, a
  // previous snapshot that stayed provisional — is not one month's story.
  const story =
    previous === null || phrase === null || since
      ? ''
      : storyNote(flowsDue?.find((flows) => flows.month === previous.month))
  const delta =
    summary.mom_delta != null && summary.mom_pct != null
      ? `${formatCurrency(summary.mom_delta)} (${formatPct(summary.mom_pct)})${span}${story}`
      : undefined
  return { label, badge: current.provisional ? 'Provisional' : undefined, delta }
}

/** The receipt's date: the day the balances describe, never the month key. */
export function receiptAsOf(summary: Pick<NetWorthSummary, 'month'> & Partial<Pick<NetWorthSummary, 'as_of'>>): string | null {
  if (summary.month === null) return null
  return summary.as_of === undefined ? summary.month : summary.as_of
}

/** What the receipt's definition adds (spec §T1): why a provisional snapshot is provisional, or
 *  the day a final one was typed when that was after its 1st; nothing for balances recorded on
 *  their 1st or with no recorded date. Leading space included. */
export function recordedSentence(
  summary: Pick<NetWorthSummary, 'month'> & Partial<Pick<NetWorthSummary, 'recorded_on' | 'provisional'>>,
): string {
  const recorded = summary.recorded_on ?? null
  if (summary.month === null || recorded === null) return ''
  if (summary.provisional) {
    return ` Recorded ${dayName(recorded)}. Balances recorded before their date stay provisional until saved again on or after it.`
  }
  return recorded > summary.month ? ` Recorded ${dayName(recorded)}.` : ''
}
