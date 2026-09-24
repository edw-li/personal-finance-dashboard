import { useEffect, useState } from 'react'
import { fetchWithholding } from '../../api/taxes'
import type { WithholdingOut } from '../../types/api'
import type { AttentionItem } from './attention'

// The Overview's tax to-do (2026-09-23 spec §W4, §0.6 decision 11): one Needs-attention line when
// the current year's typed tax inputs differ from the app's own records by more than the flag
// line — never a caveat on the Estimated-tax tile. It reads only the reconciliation's
// `flagged_count` (contract §0.4(f)), through the withholding GET the server memoises per data
// version and day (§W12), so a second Overview visit costs nothing.

/** The line, or null when nothing is flagged (or there is nothing to compare against). */
export function taxDriftItem(withholding: WithholdingOut | null, year: number): AttentionItem | null {
  const count = withholding?.reconciliation?.flagged_count ?? 0
  if (count === 0) return null
  return {
    key: 'tax-drift',
    text: `${count} of ${year}’s tax inputs ${count === 1 ? 'differs' : 'differ'} from your records`,
    to: '/taxes?section=summary',
  }
}

/**
 * The current year's line, fetched after first paint (an effect) and only once that tax year is
 * known to exist — the GET 404s a year with no row and 422s any other year. A failed read is
 * silence: a to-do line is not an error surface, and the Taxes card owns that feed's banner.
 */
export function useTaxDrift(year: number, yearExists: boolean): AttentionItem | null {
  const [answer, setAnswer] = useState<{ year: number; item: AttentionItem | null } | null>(null)
  useEffect(() => {
    if (!yearExists) return
    let cancelled = false
    // Promise callbacks only: no setState in the effect's synchronous body (react-hooks 7).
    fetchWithholding(year)
      .then((withholding) => {
        if (!cancelled) setAnswer({ year, item: taxDriftItem(withholding, year) })
      })
      .catch(() => {
        if (!cancelled) setAnswer({ year, item: null })
      })
    return () => {
      cancelled = true
    }
  }, [year, yearExists])
  // An answer for another year (a New Year's Eve rollover) is not this year's.
  return yearExists && answer?.year === year ? answer.item : null
}
