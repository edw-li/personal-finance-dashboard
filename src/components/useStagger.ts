import { useLayoutEffect, useRef, type RefObject } from 'react'
import { STAGGER_CAP } from '../theme/motion'

// The one piece of JS in the entrance (2026-09-05 spec §3): CSS cannot ask whether an
// element started inside the viewport, so this tags the ones that did with the index their
// delay is computed from, and everything else keeps --enter: 1 and never animates. A
// LAYOUT effect: the tag must be on the element before the browser paints it, or the
// cascade starts a frame late and the first card visibly jumps.

/** Tile rows are one group; a .card inside a .card rides its parent's index. */
const GROUPS = '.kpi-row, .card'

/** How long after a page mounts a Feed's first payload may still join the cascade (2026-09-13
 *  polish §2.5). A later landing — a revisit, a tab switch, a refetch — arrives on a page the
 *  reader is already reading, and a cascade there is a flicker, not an entrance. */
export const CASCADE_WINDOW_MS = 3000

/** Tags every top-level group under `root` that starts inside the viewport with its cascade
 *  index (from `startIndex`, clamped to STAGGER_CAP) and returns the next free index. Groups
 *  under a `[hidden]` ancestor — a lazily mounted view's panel, Paycheck's hidden view wrappers —
 *  are skipped: they measure 0×0 at the top of the viewport, and a tag there would replay the
 *  entrance the moment the view is shown (spec §2.4: no per-card cascade on a tab switch). */
export function tagStagger(root: HTMLElement, startIndex = 0): number {
  const groups = Array.from(root.querySelectorAll<HTMLElement>(GROUPS))
  let index = startIndex
  for (const el of groups) {
    if (groups.some((other) => other !== el && other.contains(el))) continue
    if (el.closest('[hidden]') !== null) continue
    // `>=`, so a card straddling the bottom edge still counts as visible: it rises in
    // with the cascade instead of snapping when the reveal picks it up.
    if (el.getBoundingClientRect().top >= window.innerHeight) continue
    el.dataset.stagger = String(Math.min(index, STAGGER_CAP))
    index += 1
  }
  return index
}

export function useStagger<T extends HTMLElement>(ready: boolean): RefObject<T | null> {
  const ref = useRef<T>(null)
  // One cascade per page mount: `ready` re-renders on every revalidation, and re-tagging
  // would restart the animation with the reader's eye already on the numbers.
  const taggedRef = useRef(false)
  useLayoutEffect(() => {
    const root = ref.current
    if (!ready || root === null || taggedRef.current) return
    taggedRef.current = true
    tagStagger(root)
  }, [ready])
  return ref
}
