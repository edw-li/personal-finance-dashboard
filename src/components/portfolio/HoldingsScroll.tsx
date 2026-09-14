import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useScrollEdges } from '../useScrollEdges'
import './portfolio.css'

// The horizontal scroller a ledger table lives in (2026-09-13 polish §7): the edge fade and the
// pinned actions column (panels.css's .row-actions rule) both read it. A COMPONENT rather than a
// hook call in the panel body, because both ledgers render their table only once rows exist —
// `useScrollEdges` keyed on a stable ref would have run against a null element at mount and never
// re-armed when the first row landed (lane F2 review, relayed 2026-09-13). Mounting the scroller
// mounts the hook with it.
export default function HoldingsScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollEdges(ref)
  return <div className="holdings-scroll" ref={ref}>{children}</div>
}
