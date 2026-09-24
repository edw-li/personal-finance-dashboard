import { useImperativeHandle, useRef } from 'react'
import type { ReactNode, Ref } from 'react'
import { useStickyInsets } from './tableScrollDom'
import { useScrollEdges } from './useScrollEdges'
import './tableScroll.css'

// THE capped table box (2026-09-24 table-scroll spec §2). A long table scrolls inside its card at
// the vesting schedule's cap — clamp(420px, 60vh, 720px) — with its header row pinned, a totals row
// pinned where it has one and a fade on the edge that still hides rows, instead of making the page
// thousands of pixels tall (the dividend ledger measured 16,733px on production). A table shorter
// than the cap renders exactly as it did. A COMPONENT rather than hook calls in each panel
// (HoldingsScroll's reasoning, which this replaces): most ledgers render their table only once rows
// exist, and a hook keyed on a stable ref in the panel body would run against a null element at mount
// and never re-arm — mounting the box mounts the hooks with it. Contract: exactly one <table> as the
// direct child, living as long as the box.
export default function TableScroll({
  label,
  className,
  children,
  ref,
}: {
  /** Names the box for screen readers — "Holdings table, region". */
  label: string
  /** The old wrapper's class (holdings-scroll, matrix-scroll…): its sideways rules, and the tests
   *  that find a table by it, keep working. */
  className?: string
  children: ReactNode
  /** React 19 ref-as-prop (ClassificationEditor's idiom), for a caller that scrolls the box itself. */
  ref?: Ref<HTMLDivElement>
}) {
  const own = useRef<HTMLDivElement>(null)
  useScrollEdges(own, true, 'xy')
  useStickyInsets(own)
  // The box always renders, so the handle is simply the element.
  useImperativeHandle(ref, () => own.current as HTMLDivElement, [])
  return (
    // tabIndex 0: the box is a named stop the arrow keys and PageDown scroll (the classification
    // selects capture the arrow keys; Tab through a row's buttons scrolls a row at a time), and a
    // read-only table would otherwise be unreachable. index.css's [tabindex] ring draws its focus.
    <div
      ref={own}
      className={className ? `table-scroll ${className}` : 'table-scroll'}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  )
}
