import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV_ITEMS } from './navItems'

/**
 * "{nav label} · Personal finance" from whichever destination owns the pathname; the
 * fallback covers unknowns. Root matches exactly — every other item also claims its
 * sub-paths, so a future /portfolio/... drill-in keeps its section's title.
 *
 * ONE product name everywhere (audit item 60): the sidebar wordmark, the splash, the
 * login heading, index.html and these titles. The fallback is spelled as the 404's own
 * title — the hook cannot know a path is the 404, only that no destination claims it,
 * and NotFoundPage sets no title of its own — so it says "Not found" rather than naming
 * the product alone, which read as a page called after the app.
 */
export function usePageTitle(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const item = NAV_ITEMS.find((candidate) =>
      candidate.to === '/'
        ? pathname === '/'
        : pathname === candidate.to || pathname.startsWith(`${candidate.to}/`),
    )
    document.title =
      item === undefined ? 'Not found · Personal finance' : `${item.label} · Personal finance`
  }, [pathname])
}
