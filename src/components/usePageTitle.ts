import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV_ITEMS } from './navItems'

/**
 * "{nav label} · Finance" from whichever destination owns the pathname; the fallback
 * covers unknowns (the 404). Root matches exactly — every other item also claims its
 * sub-paths, so a future /portfolio/... drill-in keeps its section's title.
 */
export function usePageTitle(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const item = NAV_ITEMS.find((candidate) =>
      candidate.to === '/'
        ? pathname === '/'
        : pathname === candidate.to || pathname.startsWith(`${candidate.to}/`),
    )
    document.title = item === undefined ? 'Finance Dashboard' : `${item.label} · Finance`
  }, [pathname])
}
