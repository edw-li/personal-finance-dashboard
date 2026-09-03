import type { ReactNode } from 'react'
import { SkeletonCard } from '../PageSkeleton'
import '../panels.css'

// A card-level feed's three states, in the grammar the multi-feed pages (Comp, ESPP,
// Paycheck, Taxes) each hand-rolled (2026-09-03 shell spec §5 — "no bespoke loading or
// error markup"): a banner whose stale cue appears only when there IS something stale, a
// ghost card while the first payload is in flight, and a dimmed body while a later one is.
// Pages keep their own state; this only decides what it looks like.
export interface FeedProps<T> {
  data: T | null
  error?: string | null
  busy: boolean
  /** Names what is stale in the banner: "the table", "the schedule", "this breakdown". */
  staleNoun: string
  retry?: () => void
  retryLabel?: string
  skeleton: { height: number; label: string }
  /** Rendered only when data is present — the render prop narrows the type for callers. */
  children: (data: T) => ReactNode
  /** Idle with no data and no error: an empty state instead of nothing. */
  empty?: ReactNode
}

export default function Feed<T>({
  data,
  error = null,
  busy,
  staleNoun,
  retry,
  retryLabel,
  skeleton,
  children,
  empty,
}: FeedProps<T>) {
  return (
    <>
      <FeedBanner
        error={error === null ? null : data === null ? error : `${error} — ${staleNoun} may be showing earlier data.`}
        retry={retry}
        retryLabel={retryLabel}
      />
      {data === null ? (
        busy ? <SkeletonCard height={skeleton.height} label={skeleton.label} /> : (empty ?? null)
      ) : (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>{children(data)}</div>
      )}
    </>
  )
}

/** A bare alert for errors that are not about a feed's freshness: form validation, a save
 *  that failed, a what-if that would not compute. Renders nothing for null. */
export function FeedBanner({
  error,
  retry,
  retryLabel,
}: {
  error: string | null
  retry?: () => void
  retryLabel?: string
}) {
  if (error === null) return null
  return (
    <div className="error-banner" role="alert">
      {error}
      {retry !== undefined && (
        <>
          {' '}
          <button type="button" className="button" aria-label={retryLabel} onClick={retry}>
            Retry
          </button>
        </>
      )}
    </div>
  )
}
