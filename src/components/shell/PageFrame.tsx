import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import PageSkeleton from '../PageSkeleton'
import { useStagger } from '../useStagger'
import '../panels.css'
import './shell.css'

// One component owns the top of every page and its lifecycle states (2026-09-03 shell
// spec §5). Pages keep their own state and hand a `resource` summary here; the frame
// decides what that means on screen, identically everywhere:
//   loading, no data   → header · scope row · skeleton
//   error, no data     → header · scope row · alert with Retry
//   ready              → children (dimmed while `busy`)
//   ready + error      → children + one stale line with Retry
// The scope row is sticky; the hairline appears only while it is actually stuck.
export interface PageResource {
  status: 'loading' | 'ready' | 'error'
  error?: string | null
  /** Revalidating while data is on screen. */
  busy?: boolean
  /** Painted from the snapshot cache — charts read it to skip the entrance animation. */
  fromCache?: boolean
  retry?: () => void
}

/** Derived from the skeleton itself, so the two can never drift apart. */
export type PageSkeletonSpec = ComponentProps<typeof PageSkeleton>

interface PageFrameContextValue {
  fromCache: boolean
}

const PageFrameContext = createContext<PageFrameContextValue>({ fromCache: false })

/** `fromCache` for charts rendered inside a frame; false outside one. */
export function usePageFrame(): PageFrameContextValue {
  return useContext(PageFrameContext)
}

const DEFAULT_SKELETON: PageSkeletonSpec = { tiles: 4, cards: [{ span: 12, height: 320 }] }

export default function PageFrame({
  title,
  actions,
  subheader,
  scopeRow,
  resource,
  skeleton = DEFAULT_SKELETON,
  children,
}: {
  title: string
  /** Right side of the title row — the page's primary action lives here, never in the scope row. */
  actions?: ReactNode
  /** Under the title row: page-local status lines (Portfolio's refresh result). */
  subheader?: ReactNode
  /** The sticky row's content — a ScopeBar (Plan 1b) or any page-specific controls. Absent → no row. */
  scopeRow?: ReactNode
  resource: PageResource
  /** Ghost layout while loading with no data. */
  skeleton?: PageSkeletonSpec
  children: ReactNode
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const scopeRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  // Inline `scopeRow` JSX is a new object on every parent render; keying the effect on its
  // mere presence avoids a disconnect/observe cycle per render.
  const hasScopeRow = scopeRow !== undefined

  // The sentinel sits one pixel above the sticky row; once it scrolls out, the row is
  // pinned. Guarded for jsdom and old browsers: without the observer the row simply never
  // shows its hairline.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasScopeRow || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      // A batched callback carries several entries; only the newest describes now.
      const last = entries[entries.length - 1]
      if (last) setStuck(!last.isIntersecting)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasScopeRow])

  const hasData = resource.status === 'ready'
  // The cascade is the PAYLOAD's, not the skeleton's: tagging waits for `ready`, so the
  // groups measured are the real cards at the positions they actually occupy.
  const bodyRef = useStagger<HTMLDivElement>(hasData)

  // How far down the viewport the content actually becomes visible (2026-09-05 spec §4). The
  // reveal's view() timelines measure against the scrollport, but this row is pinned over its
  // top edge, so a card scrolled back up was already fully bright by the time it emerged from
  // under the row and the top-edge mirror was never seen. panels.css insets both timelines by
  // this variable; the value is MEASURED, never assumed, because the row's height is the sum
  // of the density setting, the chips the page put in it and whether they wrapped.
  // A ref write in an effect, not state: nothing renders from it, and a setState here would
  // re-render every page on every reflow of a row that only CSS reads.
  useEffect(() => {
    const body = bodyRef.current
    const row = scopeRef.current
    // No row (or no ResizeObserver — jsdom, old browsers) leaves the property unset, and the
    // `var(--sticky-inset, 0px)` fallback in panels.css is exactly the right answer for both.
    if (body === null || row === null || typeof ResizeObserver === 'undefined') return
    const write = () => body.style.setProperty('--sticky-inset', `${row.offsetHeight}px`)
    write()
    const observer = new ResizeObserver(write)
    observer.observe(row)
    return () => {
      observer.disconnect()
      // The next page's row is a different height and its effect has not run yet; clearing on
      // the way out means a stale inset can never outlive the row it was measured from.
      body.style.removeProperty('--sticky-inset')
    }
  }, [hasScopeRow, bodyRef])
  const showSkeleton = resource.status === 'loading'
  const showErrorOnly = resource.status === 'error'
  const staleError = hasData && resource.error ? resource.error : null
  // A fresh object here would re-render every chart reading the context on each render.
  const context = useMemo(() => ({ fromCache: resource.fromCache === true }), [resource.fromCache])

  return (
    <PageFrameContext.Provider value={context}>
      <header className="page-frame-header">
        <h1>{title}</h1>
        {actions !== undefined && <div className="page-frame-actions">{actions}</div>}
      </header>
      {subheader !== undefined && <div className="page-frame-subheader">{subheader}</div>}
      {scopeRow !== undefined && (
        <>
          <div ref={sentinelRef} className="page-frame-sentinel" aria-hidden="true" />
          <div ref={scopeRef} className={`page-frame-scope${stuck ? ' is-stuck' : ''}`}>
            {scopeRow}
          </div>
        </>
      )}
      {/* The content region, and the only part of the page that animates in (2026-09-05
          spec §2): the title row and the scope row above are identical on every page and the
          eye is already on them, so they appear at once. ONE wrapper around all three
          lifecycle branches, not one per branch — the entrance then runs once per page mount
          instead of replaying when the skeleton gives way to the payload. */}
      <div className="page-frame-body" ref={bodyRef}>
        {/* The whole spec, spread: PageSkeleton owns the defaults, so a prop added there reaches
            every page without a second forwarding list to keep in step. */}
        {showSkeleton && <PageSkeleton {...skeleton} />}
        {showErrorOnly && (
          <div className="error-banner" role="alert">
            {resource.error ?? 'Something went wrong.'}{' '}
            {resource.retry !== undefined && (
              <button type="button" className="button" onClick={resource.retry}>
                Retry
              </button>
            )}
          </div>
        )}
        {hasData && (
          <>
            {staleError !== null && (
              <p className="page-frame-stale" role="status">
                Showing earlier data — {staleError}
                {resource.retry !== undefined && (
                  <button type="button" className="button" onClick={resource.retry}>
                    Retry
                  </button>
                )}
              </p>
            )}
            <div className={`loading-dim${resource.busy ? ' is-loading' : ''}`}>{children}</div>
          </>
        )}
      </div>
    </PageFrameContext.Provider>
  )
}
