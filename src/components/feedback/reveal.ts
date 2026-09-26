import { useEffect } from 'react'
import type { RefObject } from 'react'
import { MOTION_MS } from '../../theme/motion'
import { ensureVisible, scrollParentOf, stickyHeaderOf, unitExtent } from '../reorder/reorderDom'
import { useLatest } from '../reorder/useLatest'
import { revealInBox } from '../tableScrollDom'
import { prefersReducedMotion } from '../useReducedMotion'
import './feedback.css'

// Edits come to the user (2026-09-25 polish spec §5.1, D5; contract C3): the helpers that put the
// thing a save, a create, a delete or an Undo touched where the user is looking, and let Escape leave
// an editor.

/** An editor's fields — never a hidden input or a disabled one. */
const FIELDS = 'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'

/** The band a form that states no scroll margin of its own borrows for its reveal: clear of the sticky
 *  scope row (PageFrame measures it into --sticky-inset), as LocalSections and the Settings cards
 *  already keep theirs. */
const FALLBACK_MARGIN_TOP = 'calc(var(--sticky-inset, 0px) + 0.75rem)'
const FALLBACK_MARGIN_BOTTOM = '0.75rem'

/** A row revealed inside its own scroll box stands this far clear of the box's edge (tableScroll.css's
 *  4px row margins). */
const ROW_MARGIN_PX = 4

const unset = (margin: string | undefined) => margin === undefined || margin === '' || margin === '0px'

/**
 * Bring an editor to the user: scroll `form` into view by the least travel (`block: 'nearest'`;
 * smooth, or instant under reduced motion), then focus its first field — or the `focusSelector`
 * match — with `preventScroll`, so the focus never fights the scroll, and select its text. A form that
 * states no scroll margin borrows the sticky-row band for the one call, so its top never lands under
 * the scope row.
 */
export function revealEditor(form: HTMLElement | null, focusSelector?: string): void {
  if (form === null) return
  const computed = getComputedStyle(form)
  const own = { top: form.style.scrollMarginTop, bottom: form.style.scrollMarginBottom }
  if (unset(computed.scrollMarginTop)) form.style.scrollMarginTop = FALLBACK_MARGIN_TOP
  if (unset(computed.scrollMarginBottom)) form.style.scrollMarginBottom = FALLBACK_MARGIN_BOTTOM
  // Optional call, the house idiom: jsdom has no scrollIntoView. The target is fixed at the call, so
  // the borrowed margin can go straight back.
  form.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
  form.style.scrollMarginTop = own.top
  form.style.scrollMarginBottom = own.bottom
  const field = form.querySelector<HTMLElement>(focusSelector ?? FIELDS)
  if (field === null) return
  field.focus({ preventScroll: true })
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select()
}

/**
 * Show `row` within its own list, scrolling only what has to move: a capped TableScroll box scrolls
 * itself (revealInBox — clear of its pinned header and footer); the older caps (`.settings-scroll`,
 * `.categories-scroll`) and any other scrolling ancestor scroll just clear of their edge and sticky
 * header (ensureVisible); only a row with no scrolling ancestor moves the page. So a repeat-entry
 * form above a capped list keeps its caret on screen (spec §5.3).
 */
export function revealRow(row: HTMLElement | null): void {
  if (row === null || !row.isConnected) return
  const scroller = scrollParentOf(row)
  if (scroller === null) {
    row.scrollIntoView?.({ block: 'nearest' })
    return
  }
  if (scroller.classList.contains('table-scroll')) {
    revealInBox(scroller, row)
    return
  }
  const { top, height } = unitExtent([row], scroller)
  ensureVisible(scroller, top, height, stickyHeaderOf(row, scroller), ROW_MARGIN_PX)
}

/** The live flash timers: a second flash of one element restarts it. */
const flashes = new WeakMap<HTMLElement, number>()

/** The one "this changed" cue (spec §5.1): `data-flash` for MOTION_MS.flash — feedback.css's wash
 *  runs on --t-flash, the same number, so the attribute leaves as the wash ends. */
export function flashElement(el: HTMLElement | null): void {
  if (el === null) return
  const running = flashes.get(el)
  if (running !== undefined) {
    window.clearTimeout(running)
    el.removeAttribute('data-flash')
    // A style flush between the two writes, or the browser would see no change and not restart it.
    el.getBoundingClientRect()
  }
  el.setAttribute('data-flash', '')
  flashes.set(
    el,
    window.setTimeout(() => {
      el.removeAttribute('data-flash')
      flashes.delete(el)
    }, MOTION_MS.flash),
  )
}

/**
 * Escape inside `ref` leaves the editor (spec D5): `onCancel` runs and the key is claimed, so the
 * detail panel's own Escape (a document listener that yields to a claimed key) stays shut. An Escape
 * an inner popover already claimed — usePopoverDismiss listens in the capture phase, ahead of this —
 * or one that ends an IME composition is left alone. Keyed on `enabled`: pass the editing flag, so the
 * listener binds when the editor mounts.
 */
export function useEscapeCancel(
  ref: RefObject<HTMLElement | null>,
  onCancel: () => void,
  enabled = true,
): void {
  const cancel = useLatest(onCancel)
  useEffect(() => {
    const el = ref.current
    if (!enabled || el === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      cancel.current()
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [ref, enabled, cancel])
}
