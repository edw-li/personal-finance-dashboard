import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { STAGGER_CAP } from '../theme/motion'
import type { GuideCard, GuideTask } from './types'

// The left column of a master–detail card (2026-09-15 polish spec §2.2): a vertical tablist whose
// rows KEEP the task ids — palette hits, pointer links and the probe target `#<taskId>` land on
// a row, and LocalSections' arrival effect focuses it (which scrolls the rail too). One measured
// accent indicator, the LocalSectionNav idiom turned vertical. Folded tasks sit under a "More
// tasks (N)" row that expands in place. Arrow keys move the selection like the tab strip's do.
export default function TaskRail({
  card,
  selectedId,
  onSelect,
  foldOpen,
  onToggleFold,
  detailId,
}: {
  card: GuideCard
  selectedId: string
  onSelect: (id: string) => void
  foldOpen: boolean
  onToggleFold: () => void
  detailId: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  // The FIRST placement is where the bar lives, not a move: data-placed goes on from the second.
  const placedRef = useRef(false)
  const visible = card.tasks
  const folded = card.more ?? []
  const foldId = `${card.id}-fold`

  useLayoutEffect(() => {
    const place = () => {
      const list = listRef.current
      const bar = indicatorRef.current
      if (list === null || bar === null) return
      const row = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      // A selected row inside a closed fold has no height to mark.
      if (row === null || (!foldOpen && row.closest('.guide-rail-fold') !== null)) {
        bar.style.height = '0px'
        return
      }
      if (placedRef.current) bar.dataset.placed = ''
      bar.style.height = `${row.offsetHeight}px`
      bar.style.transform = `translateY(${row.offsetTop}px)`
      placedRef.current = true
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place())
    if (listRef.current !== null) observer?.observe(listRef.current)
    return () => observer?.disconnect()
  }, [selectedId, foldOpen, card])

  // Arrows walk the rows a reader can see: the visible ones, plus the folded ones once open.
  const reachable: GuideTask[] = foldOpen ? [...visible, ...folded] : visible
  // The rail always offers exactly one Tab landing. A selected row folded away cannot be it —
  // a shut fold is aria-hidden, and a focusable element inside aria-hidden is a trap — so the
  // first visible row holds the tab stop until the fold is opened again.
  const tabStopId = reachable.some((t) => t.id === selectedId) ? selectedId : visible[0]?.id
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, task: GuideTask) => {
    // -1 when the focused row has just been folded away: walk from the top rather than the end.
    const index = Math.max(0, reachable.findIndex((t) => t.id === task.id))
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const nextIndex =
      event.key === 'Home' ? 0
      : event.key === 'End' ? reachable.length - 1
      : step ? (index + step + reachable.length) % reachable.length
      : null
    if (nextIndex === null) return
    event.preventDefault()
    const next = reachable[nextIndex]
    onSelect(next.id)
    const el = document.getElementById(next.id)
    el?.focus({ preventScroll: true })
    // preventScroll keeps the PAGE still; the rail is its own scroller, so the row eighteen down
    // still has to be brought into it. Optional call: jsdom has no scrollIntoView.
    el?.scrollIntoView?.({ block: 'nearest' })
  }

  const row = (task: GuideTask, index: number) => (
    <button
      key={task.id}
      type="button"
      role="tab"
      id={task.id}
      className="guide-rail-row"
      aria-selected={task.id === selectedId}
      aria-controls={detailId}
      tabIndex={task.id === tabStopId ? 0 : -1}
      style={{ '--guide-i': Math.min(index, STAGGER_CAP) } as CSSProperties}
      onClick={() => onSelect(task.id)}
      onKeyDown={(event) => onKey(event, task)}
    >
      {card.numbered && <span className="guide-rail-num">{index + 1}</span>}
      <span className="guide-rail-text">
        <span className="guide-rail-title">{task.title}</span>
        <small className="guide-rail-where">{task.where}</small>
      </span>
    </button>
  )

  return (
    <div ref={listRef} className="guide-rail" role="tablist" aria-orientation="vertical" aria-label={`Tasks on ${card.title}`}>
      {/* Decorative: aria-selected already says which row is current. */}
      <span ref={indicatorRef} className="guide-rail-indicator" aria-hidden="true" />
      {visible.map((task, index) => row(task, index))}
      {folded.length > 0 && (
        <>
          <button type="button" className="guide-rail-more" aria-expanded={foldOpen} aria-controls={foldId} onClick={onToggleFold}>
            {foldOpen ? 'Fewer tasks' : `More tasks (${folded.length})`}
          </button>
          <div id={foldId} className="guide-rail-fold" data-open={foldOpen} aria-hidden={!foldOpen}>
            <div className="guide-rail-fold-inner">{folded.map((task, index) => row(task, visible.length + index))}</div>
          </div>
        </>
      )}
    </div>
  )
}
