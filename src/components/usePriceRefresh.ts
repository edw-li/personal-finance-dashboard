import { useState } from 'react'
import { ApiError } from '../api/client'
import { refreshPrices } from '../api/prices'
import type { RefreshResult } from '../types/api'

// Two surfaces run the same manual refresh (2026-09-06 spec §3.3): Portfolio's toolbar button
// and the Settings Price-refresh card. The CHAIN is the shared part — the sentence a run
// earns, the in-flight flag, and the caller's own follow-up work.
const MAX_FAILED_SHOWN = 5

export interface RefreshNote {
  text: string
  detail: string
  failed: number
}

export const NO_NOTE: RefreshNote = { text: '', detail: '', failed: 0 }

export function describeRefresh(result: RefreshResult): RefreshNote {
  const failed = Object.entries(result.failed)
  // `listed`, not `shown`: PortfolioPage's `shown` ref is the rendered snapshot, and two
  // different meanings under one name is how a future edit picks the wrong one.
  const listed = failed.slice(0, MAX_FAILED_SHOWN).map(([ticker]) => ticker)
  const more = failed.length - listed.length
  return {
    text:
      `${result.updated.length} updated` +
      (failed.length > 0
        ? `, ${failed.length} failed (${listed.join(', ')}${more > 0 ? `, +${more} more` : ''})`
        : '') +
      (result.skipped_manual.length > 0
        ? `, ${result.skipped_manual.length} manual skipped`
        : '') +
      // Only when the run actually wrote some: a steady-state refresh between ex-dates ingests
      // nothing, and ", 0 dividends logged" would read as a failure.
      (result.dividends_ingested > 0 ? `, ${result.dividends_ingested} dividends logged` : '') +
      ` in ${Math.round(result.duration_ms / 1000)}s`,
    // Per-ticker reasons ride in the title attribute — React escapes attribute values, so
    // provider error text cannot inject markup.
    detail: failed.map(([ticker, reason]) => `${ticker}: ${reason}`).join('\n'),
    failed: failed.length,
  }
}

export interface RefreshOptions {
  /** Work that must land before the button re-enables — Portfolio's own reload. */
  after?: () => Promise<unknown> | void
  /** Where a failure goes. Absent, it stays in the hook's own `error`. */
  onError?: (message: string) => void
}

export function usePriceRefresh() {
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<RefreshNote>(NO_NOTE)
  const [error, setError] = useState<string | null>(null)

  const refresh = ({ after, onError }: RefreshOptions = {}): Promise<void> => {
    setRefreshing(true)
    setNote(NO_NOTE)
    setError(null)
    return refreshPrices()
      .then((result) => {
        setNote(describeRefresh(result))
        // Returned, not fired-and-forgotten: the button re-enables only once the fresh prices
        // are actually on screen.
        return after?.()
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : 'Price refresh failed'
        if (onError === undefined) setError(message)
        else onError(message)
      })
      .finally(() => setRefreshing(false))
  }

  return { refreshing, note, error, refresh }
}
