import type { ReactNode } from 'react'
import { SkeletonCard } from '../PageSkeleton'
import '../panels.css'

// A card-level feed's three states, in the grammar the multi-feed pages (Comp, ESPP,
// Paycheck, Taxes) each hand-rolled (2026-09-03 shell spec §5 — "no bespoke loading or
// error markup"): a banner whose stale cue appears only when there IS something stale, a
// ghost card while the first payload is in flight, and a dimmed body while a later one is.
// Pages keep their own state; this only decides what it looks like.
export interface FeedProps<T extends NonNullable<unknown>> {
  /** The last payload, or null before the first one — the bound rejects an `X | undefined`
   *  state at this prop, so "not loaded yet" can only arrive as null. */
  data: T | null
  error?: string | null
  busy: boolean
  /** Names what is stale in the banner: "the table", "the schedule", "this breakdown". */
  staleNoun: string
  /** Retries the fetch from the banner; omit it and no Retry button is offered. */
  retry?: () => void
  /** The Retry button's aria-label — names the feed when a page has several. */
  retryLabel?: string
  /** Ghost-card height and its screen-reader label — that label is the sentence page tests
   *  query for while the first payload is in flight. */
  skeleton: { height: number; label: string }
  /** Rendered only when data is present — the render prop narrows the type for callers. */
  children: (data: T) => ReactNode
  /** Idle with no data and no error: an empty state instead of nothing. */
  empty?: ReactNode
}

export default function Feed<T extends NonNullable<unknown>>({
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
  // the stale cue only when there IS something stale: a reload failure leaves the previous
  // table up, a first-load failure leaves nothing to be behind
  const banner = !error ? null : data === null ? error : `${error} — ${staleNoun} may be showing earlier data.`
  return (
    <>
      <FeedBanner error={banner} retry={retry} retryLabel={retryLabel} />
      {data === null ? (
        busy ? <SkeletonCard height={skeleton.height} label={skeleton.label} /> : (empty ?? null)
      ) : (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>{children(data)}</div>
      )}
    </>
  )
}

/** The alert Feed renders its banner through; exported bare for errors that are not about a
 *  feed's freshness: form validation, a save that failed, a what-if that would not compute.
 *  Renders nothing for any falsy error — the pages' `{error && …}` guard says the same thing,
 *  and an empty message is reachable (an ApiError built from an HTTP/2 empty statusText).
 *
 *  `retry` re-runs the fetch behind the banner; `action` is for a banner whose fix is
 *  something else entirely (the wizard's "Delete the empty month" — calling that Retry would
 *  be a lie). Both may appear; Retry comes first, because it is the cheaper answer. */
export function FeedBanner({
  error,
  retry,
  retryLabel,
  action,
}: {
  error?: string | null
  retry?: () => void
  retryLabel?: string
  action?: { label: string; onAction: () => void; disabled?: boolean }
}) {
  if (!error) return null
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
      {action !== undefined && (
        <>
          {' '}
          <button
            type="button"
            className="button"
            disabled={action.disabled}
            onClick={action.onAction}
          >
            {action.label}
          </button>
        </>
      )}
    </div>
  )
}
