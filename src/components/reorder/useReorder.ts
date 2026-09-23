// Drag to reorder — the React half (2026-09-23 spec §2). A pointer + keyboard state machine for ONE
// list. Per-frame work — transforms, data-reorder* attributes — is written straight onto the rows the
// list registered through `itemProps` (and, under reduced motion, onto one drop-line overlay on
// <body>): React never renders a transform, so a 60fps drag costs no renders. The only React state
// is who is lifted and what the live region says.
//
// Phases (Drag.phase) and what moves a drag between them:
//   pressing → lifted              the pointer travels 4px (a keyboard lift passes straight through)
//   pressing → released            up (a click), Escape, a lost pointer, blur, resize
//   lifted   → commit              a moved drop from the keyboard, or under reduced motion
//   lifted   → settling → commit   a moved pointer drop: the unit eases into its gap first (if the
//                                  list unmounts mid-settle, onCommit runs from the teardown)
//   lifted   → settling → finish   an unmoved drop, Escape, a lost pointer, blur, resize: rows ease home
//   any      → released            data changed or the list turned busy: cleared at once, no easing
// Released = releaseDrag (listeners, frame, timer) and machine.drag = null; rows cleared.
//
// Consumer rules (lanes R2–R5):
//   1. Render EVERY item once, `{...itemProps(id)}` on its row, in `items` order (carried rows
//      right after their carrier).
//   2. Never set style.transform / style.transition on those rows.
//   3. `onCommit(next, moved)` must set the optimistic order SYNCHRONOUSLY — it runs inside
//      flushSync, so the DOM reorder and the cleared transforms land in one frame — then save, then
//      `markSaved(moved)` on success (restore the server order on failure).
//   4. Pass `disabled: busy`; disable the row's own buttons while `active`.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { useReducedMotion } from '../useReducedMotion'
import {
  announce,
  autoScrollSpeed,
  autoScrollWithin,
  clampOffset,
  contractProblems,
  keyboardTarget,
  moveUnit,
  peersOf,
  rangeSizes,
  shiftsFor,
  signatureOf,
  slotFor,
  unitOf,
} from './reorderMath'
import type { AnnounceContext, Extent, ReorderItem, ReorderKey } from './reorderMath'
import {
  cancelFrame,
  createDropLine,
  ensureVisible,
  keepOnScreen,
  listY,
  nextFrame,
  placeDropLine,
  scrollByY,
  scrollParentOf,
  unitExtent,
  visibleBounds,
} from './reorderDom'
import type { Scroller } from './reorderDom'
import type { ReorderHandleProps, ReorderItemProps } from './reorderTypes'

export type { ReorderHandleProps, ReorderItemProps } from './reorderTypes'

/** A pointer must travel this far before a press becomes a drag: a click on a grip never lifts. */
export const LIFT_THRESHOLD = 4

export interface UseReorderOptions<K extends ReorderKey> {
  /** DISPLAY order — carried rows right after their carrier. */
  items: readonly ReorderItem<K>[]
  /** The row's name for the live region ("Housing"). */
  labelOf: (id: K) => string
  /** A range's name for the lift sentence ("…in Cash"); undefined says nothing. */
  rangeLabelOf?: (range: string) => string | undefined
  /** True while ANY request of the list is in flight: grips go inert (still focusable). */
  disabled?: boolean
  /** Once per drop that moved something: the new flat display order and the unit's id. */
  onCommit: (next: K[], moved: K) => void
}

export interface UseReorder<K extends ReorderKey> {
  itemProps: (id: K) => ReorderItemProps
  handleProps: (id: K) => ReorderHandleProps
  /** Call after the save succeeds: the unit's rows flash for MOTION_MS.flash. */
  markSaved: (id: K) => void
  instructionsId: string
  announcement: string
  liftedId: K | null
  /** A unit is lifted — the list disables its rows' own buttons. */
  active: boolean
}

interface Drag<K extends ReorderKey> {
  id: K
  mode: 'pointer' | 'keyboard'
  phase: 'pressing' | 'lifted' | 'settling'
  pointerId: number | null
  startClientY: number
  startListY: number
  lastClientY: number
  scroller: Scroller
  peers: K[]
  units: K[][]
  extents: Extent[]
  from: number
  to: number
  offset: number
  signature: string
  frame: number | null
  timer: number | null
  detach: (() => void) | null
  /** A moved pointer drop easing into its gap: the order it still owes onCommit. Null otherwise. */
  pendingNext: K[] | null
  /** Reduced motion's drop line (spec §2.5): made at the first landing slot, gone when the drag lets
   *  go. Null until then — and always, with motion allowed. */
  line: HTMLElement | null
}

/** The row a reduced-motion drop line marks, and which of its edges. */
interface DropEdge {
  element: HTMLElement
  side: 'before' | 'after'
}

interface Machine<K extends ReorderKey> {
  drag: Drag<K> | null
}

interface Snapshot<K extends ReorderKey> {
  liftedId: K | null
  announcement: string
  /** The list's signature while a drag holds it; null when none does. */
  signature: string | null
}

const REORDER_ATTRIBUTES = ['data-reorder', 'data-reorder-mode', 'data-reorder-drop'] as const

function fullSignature(rowsSignature: string, disabled: boolean): string {
  // `disabled` rides the signature: a list that turns busy under a live drag cancels it.
  return `${rowsSignature}#${disabled ? 'busy' : 'idle'}`
}

function clearRow(element: HTMLElement): void {
  element.style.transform = ''
  element.style.transition = ''
  for (const attribute of REORDER_ATTRIBUTES) element.removeAttribute(attribute)
}

function clearRows<K extends ReorderKey>(rows: Map<K, HTMLElement>): void {
  rows.forEach(clearRow)
  document.documentElement.classList.remove('reorder-active')
}

/** Let go of everything a drag holds outside React: its window listeners, its frame, its timer and
 *  its drop line. Every way out of a drag passes here — a drop, a cancel, a hard reset, an unmount. */
function releaseDrag<K extends ReorderKey>(drag: Drag<K>): void {
  drag.detach?.()
  drag.detach = null
  if (drag.frame !== null) cancelFrame(drag.frame)
  drag.frame = null
  if (drag.timer !== null) window.clearTimeout(drag.timer)
  drag.timer = null
  drag.line?.remove()
  drag.line = null
}

export function useReorder<K extends ReorderKey>(options: UseReorderOptions<K>): UseReorder<K> {
  const reduced = useReducedMotion()
  const instructionsId = useId()
  const rowsSignature = signatureOf(options.items)
  const signature = fullSignature(rowsSignature, options.disabled === true)
  const sizes = rangeSizes(options.items)
  const [snap, setSnap] = useState<Snapshot<K>>({ liftedId: null, announcement: '', signature: null })

  // Data landed (or the list turned busy) under a live drag (spec §2.3.7): the lift is void. React
  // state resets here, during render — the house's adjust-during-render pattern (CategoriesPanel's
  // pendingOrder), so set-state-in-effect stays clean. The DOM half resets AT ONCE in the layout
  // effect below: the rows have re-rendered, so there is nothing to ease home. A unit still lifted —
  // a pointer drop settling into its gap included — says why it let go; once nothing is lifted (a
  // settle-back under way) the sentence that stands stays.
  if (snap.signature !== null && snap.signature !== signature) {
    setSnap({
      liftedId: null,
      announcement: snap.liftedId !== null ? announce.cancelChanged() : snap.announcement,
      signature: null,
    })
  }

  const rows = useRef(new Map<K, HTMLElement>())
  const grips = useRef(new Map<K, HTMLButtonElement>())
  const savedTimers = useRef(new Map<K, number>())
  const machine = useRef<Machine<K>>({ drag: null })
  const latest = useRef({ options, reduced })
  const reported = useRef<string | null>(null)

  useLayoutEffect(() => {
    latest.current = { options, reduced }
  })

  // Development only: a list that breaks the items contract (spec §2.2, contractProblems) previews
  // one order and commits another. Say so on the console — once per change of its rows, StrictMode's
  // second effect run included — and never throw.
  useEffect(() => {
    if (!import.meta.env.DEV || reported.current === rowsSignature) return
    reported.current = rowsSignature
    for (const problem of contractProblems(latest.current.options.items)) {
      console.error(`useReorder: ${problem}`)
    }
  }, [rowsSignature])

  useLayoutEffect(() => {
    const state = machine.current
    const drag = state.drag
    if (drag === null || drag.signature === signature) return
    releaseDrag(drag)
    state.drag = null
    clearRows(rows.current)
  }, [signature])

  // Unmount: a drag in flight is torn down INSIDE the unmounting commit — its timers, listeners and
  // the page's grabbing cursor — not a passive tick later. A moved pointer drop still easing into its
  // gap (a popover closed right after the drop) is committed, never lost: straight to onCommit — no
  // flushSync, which a lifecycle cleanup may not call, and these rows are leaving anyway. A
  // settle-back (a cancel, an unmoved drop) owes nothing.
  useLayoutEffect(() => {
    const state = machine.current
    const rowMap = rows.current
    const timers = savedTimers.current
    return () => {
      const drag = state.drag
      state.drag = null
      if (drag !== null) {
        releaseDrag(drag)
        if (drag.pendingNext !== null) {
          const next = drag.pendingNext
          drag.pendingNext = null
          try {
            latest.current.options.onCommit(next, drag.id)
          } catch (error) {
            // One consumer's error must not break the teardown; it still reaches the console.
            console.error('useReorder: onCommit threw while its list unmounted', error)
          }
        }
      }
      clearRows(rowMap)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const context = (drag: Drag<K>, index: number): AnnounceContext => {
    const { options: current } = latest.current
    const range = current.items.find((item) => item.id === drag.id)?.range
    return {
      name: current.labelOf(drag.id),
      position: index + 1,
      count: drag.peers.length,
      range: range === undefined ? undefined : current.rangeLabelOf?.(range),
    }
  }

  const measure = (drag: Drag<K>) => {
    const { items } = latest.current.options
    drag.units = drag.peers.map((peer) => unitOf(items, peer))
    drag.extents = drag.units.map((unit) =>
      unitExtent(
        unit.flatMap((rowId) => {
          const element = rows.current.get(rowId)
          return element === undefined ? [] : [element]
        }),
        drag.scroller,
      ),
    )
  }

  const markRows = (drag: Drag<K>) => {
    const still = latest.current.reduced
    drag.units.forEach((unit, index) => {
      for (const rowId of unit) {
        const element = rows.current.get(rowId)
        if (element === undefined) continue
        if (index === drag.from) {
          element.setAttribute('data-reorder', 'lifted')
          if (drag.mode === 'keyboard') element.setAttribute('data-reorder-mode', 'keyboard')
        } else if (!still) {
          element.setAttribute('data-reorder', 'shifting')
        }
      }
    })
  }

  // Under reduced motion, the edge slot `to` lands on: the target unit's first row's top for a move
  // up, its last row's bottom for a move down. Null with motion allowed, or back home.
  const dropEdge = (drag: Drag<K>, to: number): DropEdge | null => {
    if (!latest.current.reduced || to === drag.from) return null
    const target = drag.units[to]
    const side = to < drag.from ? 'before' : 'after'
    const element = rows.current.get(side === 'before' ? target[0] : target[target.length - 1])
    return element === undefined ? null : { element, side }
  }

  // The drop line on that edge, as the row stands NOW (lane V's finding 1): an overlay one layer
  // above its list, so the row in hand never covers it. Made at the first edge; hidden with none.
  const drawLine = (drag: Drag<K>, edge: DropEdge | null) => {
    if (edge === null) {
      if (drag.line !== null) drag.line.hidden = true
      return
    }
    drag.line ??= createDropLine(edge.element)
    placeDropLine(drag.line, edge.element, edge.side, drag.scroller)
  }

  // Draw the drag at slot `to`: the lifted unit under the pointer (or, from the keyboard, at its
  // landing slot); peers shifted to make room — or, under reduced motion, left alone with an accent
  // drop line on the landing edge instead (spec §2.5). The row keeps `data-reorder-drop` — the
  // contract the tests and the probe read — while the line itself is drawn by drawLine.
  const paint = (drag: Drag<K>, to: number) => {
    const still = latest.current.reduced
    const shifts = shiftsFor(drag.extents, drag.from, to)
    drag.units.forEach((unit, index) => {
      let y = 0
      if (index === drag.from) y = drag.mode === 'pointer' ? drag.offset : still ? 0 : shifts[index]
      else if (!still) y = shifts[index]
      for (const rowId of unit) {
        const element = rows.current.get(rowId)
        if (element === undefined) continue
        element.style.transform = y === 0 ? '' : `translateY(${y}px)`
        element.removeAttribute('data-reorder-drop')
      }
    })
    const edge = dropEdge(drag, to)
    edge?.element.setAttribute('data-reorder-drop', edge.side)
    drawLine(drag, edge)
  }

  const track = (drag: Drag<K>) => {
    const delta = listY(drag.scroller, drag.lastClientY) - drag.startListY
    drag.offset = clampOffset(drag.extents, drag.from, delta)
    const self = drag.extents[drag.from]
    const top = self.top + drag.offset
    const to = slotFor(drag.extents, drag.from, top, top + self.height)
    paint(drag, to)
    if (to !== drag.to) {
      drag.to = to
      const message = announce.move(context(drag, to))
      setSnap((current) => ({ ...current, announcement: message }))
    }
  }

  const finish = (drag: Drag<K>) => {
    releaseDrag(drag)
    if (machine.current.drag === drag) machine.current.drag = null
    clearRows(rows.current)
    setSnap((current) => ({ ...current, liftedId: null, signature: null }))
  }

  // Back where it started (Escape, an unmoved drop, a lost pointer): every row eases home.
  const settleBack = (drag: Drag<K>, message: string) => {
    releaseDrag(drag)
    drag.phase = 'settling'
    setSnap({ liftedId: null, announcement: message, signature: drag.signature })
    if (latest.current.reduced) {
      finish(drag)
      return
    }
    for (const rowId of drag.units.flat()) {
      const element = rows.current.get(rowId)
      if (element === undefined) continue
      element.style.transition = `transform ${MOTION_MS.fast}ms ${EASE_OUT}`
      element.style.transform = ''
    }
    drag.timer = window.setTimeout(() => finish(drag), MOTION_MS.fast)
  }

  const cancel = (drag: Drag<K>) => {
    if (drag.phase === 'pressing') {
      releaseDrag(drag)
      machine.current.drag = null
      return
    }
    if (drag.phase === 'lifted') settleBack(drag, announce.cancel(context(drag, drag.from)))
  }

  const commit = (drag: Drag<K>, next: K[]) => {
    releaseDrag(drag)
    drag.pendingNext = null
    machine.current.drag = null
    const message = announce.drop(context(drag, drag.to))
    // The DOM move blurs whatever the moved rows hold: a grip that had focus — a keyboard reader's,
    // or a pointer user's who had tabbed there — gets it back below. Focus elsewhere stays put.
    const heldFocus = document.activeElement === grips.current.get(drag.id)
    try {
      // One frame: the list's optimistic order renders AND the transforms clear before paint.
      flushSync(() => {
        setSnap({ liftedId: null, announcement: message, signature: null })
        latest.current.options.onCommit(next, drag.id)
      })
    } finally {
      // Even when onCommit throws (its error rethrows from here): no row is left stranded mid-drag.
      clearRows(rows.current)
    }
    if (heldFocus) grips.current.get(drag.id)?.focus()
  }

  const drop = (drag: Drag<K>) => {
    if (drag.to === drag.from) {
      settleBack(drag, announce.dropUnmoved(context(drag, drag.from)))
      return
    }
    const next = moveUnit(latest.current.options.items, drag.id, drag.to)
    if (drag.mode === 'keyboard' || latest.current.reduced) {
      commit(drag, next)
      return
    }
    // Pointer: the unit eases from under the pointer into its gap, THEN the order commits — the DOM
    // reorder lands on rows that already stand where it puts them.
    releaseDrag(drag)
    drag.phase = 'settling'
    const slot = shiftsFor(drag.extents, drag.from, drag.to)[drag.from]
    for (const rowId of drag.units[drag.from]) {
      const element = rows.current.get(rowId)
      if (element === undefined) continue
      element.style.transition = `transform ${MOTION_MS.fast}ms ${EASE_OUT}`
      element.style.transform = slot === 0 ? '' : `translateY(${slot}px)`
    }
    drag.pendingNext = next
    drag.timer = window.setTimeout(() => commit(drag, next), MOTION_MS.fast)
  }

  // Window listeners for a pending or live drag — a pointer press attaches them at pointerdown, a
  // keyboard lift at lift. Escape is caught on WINDOW in the CAPTURE phase, before any document
  // listener: usePopoverDismiss and the detail panel never see it (spec §2.3.7).
  const listen = (drag: Drag<K>) => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancel(drag)
    }
    const onAbandon = () => cancel(drag)
    // Every scroll in the document reaches here — scroll events do not bubble, but they cross
    // window's capture phase. Any of them can move the list under a still pointer: its own
    // scroller's, and the PAGE's under a Settings box (the row in hand used to drift off the pointer
    // there). track re-reads the pointer against the scroller's rect, so a pointer drag re-tracks on
    // every scroll. A keyboard lift stays on its slot: only the drop line, fixed, follows its edge.
    const onScroll = () => {
      // Only the live drag: a direct commit (a keyboard or reduced-motion drop) leaves its phase
      // 'lifted', so a listener that ever outlived its drag would re-paint rows and re-make a line.
      if (machine.current.drag !== drag || drag.phase !== 'lifted') return
      if (drag.mode === 'pointer') track(drag)
      else drawLine(drag, dropEdge(drag, drag.to))
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onAbandon)
    window.addEventListener('resize', onAbandon)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    drag.detach = () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onAbandon)
      window.removeEventListener('resize', onAbandon)
      window.removeEventListener('scroll', onScroll, true)
    }
  }

  const autoScroll = (drag: Drag<K>) => {
    const first = drag.extents[0]
    const last = drag.extents[drag.extents.length - 1]
    // The range the unit is clamped to: once its far end shows, scrolling on would only carry the
    // held unit out of view.
    const range = { top: first.top, bottom: last.top + last.height }
    const step = () => {
      if (machine.current.drag !== drag || drag.phase !== 'lifted') return
      // One band for both questions: the part of the scroller the reader can SEE, clipped to the
      // window. A 420px Settings box can hang past the window's bottom; judged in the whole box, the
      // stop would come while the range's end still sat below the window, out of the pointer's reach.
      const bounds = visibleBounds(drag.scroller)
      const seen = { top: listY(drag.scroller, bounds.top), height: bounds.bottom - bounds.top }
      const speed = autoScrollWithin(
        autoScrollSpeed(drag.lastClientY, bounds.top, bounds.bottom),
        range,
        seen,
      )
      if (speed !== 0) scrollByY(drag.scroller, speed)
      drag.frame = nextFrame(step)
    }
    drag.frame = nextFrame(step)
  }

  const lift = (drag: Drag<K>) => {
    measure(drag)
    drag.phase = 'lifted'
    markRows(drag)
    if (drag.mode === 'pointer') {
      document.documentElement.classList.add('reorder-active')
      autoScroll(drag)
    }
    // A pointer press is already listening (since pointerdown); a keyboard lift starts here.
    if (drag.detach === null) listen(drag)
    const message = announce.lift(context(drag, drag.from))
    setSnap({ liftedId: drag.id, announcement: message, signature: drag.signature })
  }

  const begin = (id: K, mode: 'pointer' | 'keyboard', pointer: { id: number; clientY: number } | null) => {
    const { options: current } = latest.current
    if (current.disabled === true || machine.current.drag !== null) return null
    const peers = peersOf(current.items, id)
    if (peers.length < 2) return null
    const scroller = scrollParentOf(rows.current.get(id) ?? grips.current.get(id) ?? null)
    const from = peers.indexOf(id)
    const drag: Drag<K> = {
      id,
      mode,
      phase: 'pressing',
      pointerId: pointer?.id ?? null,
      startClientY: pointer?.clientY ?? 0,
      startListY: pointer === null ? 0 : listY(scroller, pointer.clientY),
      lastClientY: pointer?.clientY ?? 0,
      scroller,
      peers,
      units: [],
      extents: [],
      from,
      to: from,
      offset: 0,
      signature: fullSignature(signatureOf(current.items), false),
      frame: null,
      timer: null,
      detach: null,
      pendingNext: null,
      line: null,
    }
    machine.current.drag = drag
    return drag
  }

  const onPointerDown = (id: K, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const drag = begin(id, 'pointer', { id: event.pointerId, clientY: event.clientY })
    if (drag === null) return
    // No text selection, no focus theft: the press belongs to the drag.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // Pending already counts (spec §2.3.7): an Escape in the first 4px abandons the press and
    // never reaches a popover around the list.
    listen(drag)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = machine.current.drag
    if (drag === null || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId) return
    drag.lastClientY = event.clientY
    if (drag.phase === 'pressing') {
      if (Math.abs(event.clientY - drag.startClientY) < LIFT_THRESHOLD) return
      lift(drag)
    }
    if (drag.phase === 'lifted') track(drag)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = machine.current.drag
    if (drag === null || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId) return
    if (drag.phase === 'pressing') {
      // A click: nothing was lifted. Detach the press's window listeners too.
      releaseDrag(drag)
      machine.current.drag = null
      return
    }
    if (drag.phase === 'lifted') drop(drag)
  }

  // pointercancel, or capture lost with no up (the OS took the pointer): the drag is abandoned.
  const onPointerLost = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = machine.current.drag
    if (drag === null || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId) return
    cancel(drag)
  }

  const onKeyDown = (id: K, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Only a fresh press picks up or drops: a held Space/Enter repeats, and must not lift, drop and
    // lift again — nor click the <button> it sits on (a click per repeated Enter, one on Space's
    // keyup), so a repeat is swallowed whole. (Held arrows repeat on purpose.)
    if (event.repeat && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault()
      return
    }
    const pick = event.key === ' ' || event.key === 'Enter'
    const drag = machine.current.drag
    if (drag === null) {
      if (!pick) return
      event.preventDefault()
      const started = begin(id, 'keyboard', null)
      if (started !== null) lift(started)
      return
    }
    if (drag.id !== id || drag.mode !== 'keyboard' || drag.phase !== 'lifted') return
    if (pick) {
      event.preventDefault()
      drop(drag)
      return
    }
    const to = keyboardTarget(event.key, drag.to, drag.peers.length)
    if (to === null) return
    event.preventDefault()
    drag.to = to
    // Keep the landing slot in view — in the scroller's own view, then on screen, for a scroller
    // hanging past the window edge — and only then paint: both scrolls are computed from list
    // coordinates, while the drop line is measured, so it must see the rows where they now stand.
    const self = drag.extents[drag.from]
    const landing = self.top + shiftsFor(drag.extents, drag.from, to)[drag.from]
    ensureVisible(drag.scroller, landing, self.height)
    keepOnScreen(drag.scroller, landing, self.height)
    paint(drag, to)
    const message = announce.move(context(drag, to))
    setSnap((current) => ({ ...current, announcement: message }))
  }

  const onBlur = (id: K) => {
    const drag = machine.current.drag
    if (drag !== null && drag.id === id && drag.mode === 'keyboard' && drag.phase === 'lifted') cancel(drag)
  }

  const markSaved = (id: K) => {
    const unit = unitOf(latest.current.options.items, id)
    const timers = savedTimers.current
    const previous = timers.get(id)
    if (previous !== undefined) window.clearTimeout(previous)
    for (const rowId of unit) rows.current.get(rowId)?.setAttribute('data-reorder-saved', '')
    timers.set(
      id,
      window.setTimeout(() => {
        for (const rowId of unit) rows.current.get(rowId)?.removeAttribute('data-reorder-saved')
        timers.delete(id)
      }, MOTION_MS.flash),
    )
  }

  const itemProps = (id: K): ReorderItemProps => ({
    ref: (element: HTMLElement | null) => {
      if (element === null) return
      rows.current.set(id, element)
      return () => {
        if (rows.current.get(id) === element) rows.current.delete(id)
      }
    },
    'data-reorder-id': String(id),
  })

  const handleProps = (id: K): ReorderHandleProps => {
    const range = options.items.find((item) => item.id === id)?.range ?? ''
    return {
      ref: (element: HTMLButtonElement | null) => {
        if (element === null) return
        grips.current.set(id, element)
        return () => {
          if (grips.current.get(id) === element) grips.current.delete(id)
        }
      },
      disabled: (sizes.get(range) ?? 0) < 2,
      'aria-disabled': options.disabled === true ? true : undefined,
      'aria-describedby': instructionsId,
      'aria-pressed': snap.liftedId === id ? true : undefined,
      onPointerDown: (event) => onPointerDown(id, event),
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerLost,
      onLostPointerCapture: onPointerLost,
      onKeyDown: (event) => onKeyDown(id, event),
      onBlur: () => onBlur(id),
    }
  }

  return {
    itemProps,
    handleProps,
    markSaved,
    instructionsId,
    announcement: snap.announcement,
    liftedId: snap.liftedId,
    active: snap.liftedId !== null,
  }
}
