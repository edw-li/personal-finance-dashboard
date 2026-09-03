import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import PageSkeleton from '../PageSkeleton'
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

export interface PageSkeletonSpec {
  tiles?: number
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
}

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
  const [stuck, setStuck] = useState(false)

  // The sentinel sits one pixel above the sticky row; once it scrolls out, the row is
  // pinned. Guarded for jsdom and old browsers: without the observer the row simply never
  // shows its hairline.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || scopeRow === undefined || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setStuck(!entry.isIntersecting)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [scopeRow])

  const hasData = resource.status === 'ready'
  const showSkeleton = resource.status === 'loading'
  const showErrorOnly = resource.status === 'error'
  const staleError = hasData && resource.error ? resource.error : null

  return (
    <PageFrameContext.Provider value={{ fromCache: resource.fromCache === true }}>
      <header className="page-frame-header">
        <h1>{title}</h1>
        {actions !== undefined && <div className="page-frame-actions">{actions}</div>}
      </header>
      {subheader !== undefined && <div className="page-frame-subheader">{subheader}</div>}
      {scopeRow !== undefined && (
        <>
          <div ref={sentinelRef} className="page-frame-sentinel" aria-hidden="true" />
          <div className={`page-frame-scope${stuck ? ' is-stuck' : ''}`}>{scopeRow}</div>
        </>
      )}
      {showSkeleton && <PageSkeleton tiles={skeleton.tiles ?? 0} cards={skeleton.cards ?? []} />}
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
    </PageFrameContext.Provider>
  )
}
