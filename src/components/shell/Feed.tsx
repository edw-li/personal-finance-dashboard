import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { SkeletonCard } from '../PageSkeleton'
import { XFADE_MS } from '../skeletonMetrics'
import { useReducedMotion } from '../useReducedMotion'
import { CASCADE_WINDOW_MS, tagStagger } from '../useStagger'
import { usePageFrame } from './PageFrame'
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
  const reduced = useReducedMotion()
  const [seenNull, setSeenNull] = useState(data === null)
  const [fading, setFading] = useState(false)
  // Adopting the arrival during RENDER is the house pattern (NetWorthPage:186) and the only correct
  // moment: the first frame that paints the content must ALREADY carry the ghost over it, or the
  // skeleton blinks out a frame before the data draws — which is the flash this removes.
  if ((data === null) !== seenNull) {
    setSeenNull(data === null)
    setFading(data !== null && !reduced)
  }
  // The veil outlives the fade by nothing; the timer's CALLBACK sets the state, never the effect body.
  useEffect(() => {
    if (!fading) return
    const id = setTimeout(() => setFading(false), XFADE_MS)
    return () => clearTimeout(id)
  }, [fading])
  // The card cascade for a feed-driven page (2026-09-13 polish §2.5). PageFrame tags its body at
  // `ready`, which on Comp/ESPP/Paycheck/Taxes is the mount — before any feed has answered — so
  // the only thing it ever tagged here was the ghost. The first payload tags its own cards
  // instead, once per Feed mount, and only inside the page's arrival window: a payload landing
  // later (a revisit, a tab switch, a refetch) joins a page the reader is already reading. A
  // LAYOUT effect, like useStagger: the tag has to be on the card before its first paint. The
  // root is the .xfade wrapper below, which exists exactly when there is content to tag.
  const { mountedAt } = usePageFrame()
  const rootRef = useRef<HTMLDivElement>(null)
  const taggedRef = useRef(false)
  useLayoutEffect(() => {
    if (data === null || taggedRef.current) return
    taggedRef.current = true
    const root = rootRef.current
    if (root === null || performance.now() - mountedAt >= CASCADE_WINDOW_MS) return
    tagStagger(root)
  }, [data, mountedAt])
  // the stale cue only when there IS something stale: a reload failure leaves the previous
  // table up, a first-load failure leaves nothing to be behind
  const banner = !error ? null : data === null ? error : `${error} — ${staleNoun} may be showing earlier data.`
  return (
    <>
      <FeedBanner error={banner} retry={retry} retryLabel={retryLabel} />
      {data === null ? (
        busy ? <SkeletonCard height={skeleton.height} label={skeleton.label} /> : (empty ?? null)
      ) : (
        <div ref={rootRef} className={`xfade${fading ? ' is-fading' : ''}`}>
          <div className={`loading-dim${busy ? ' is-loading' : ''}`}>{children(data)}</div>
          {/* The outgoing ghost, absolutely over the content that already occupies its box: it fades
              out, the content fades in, the height never changes. No label — the status line
              belonged to the skeleton that just left. */}
          {fading && (
            <div className="xfade-veil" aria-hidden="true"><SkeletonCard height={skeleton.height} label="" /></div>
          )}
        </div>
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
