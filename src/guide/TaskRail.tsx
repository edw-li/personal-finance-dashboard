import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { STAGGER_CAP } from '../theme/motion'
import type { GuideCard, GuideTask } from './types'

// The left column of a master–detail card (2026-09-15 polish spec §2.2): a vertical tablist whose
// rows KEEP the task ids — palette hits, pointer links and the probe target `#<taskId>` land on
// a row, and LocalSections' arrival effect focuses it (which scrolls the rail too). One measured
// accent indicator, the LocalSectionNav idiom turned vertical. Every task is a row — the core
// tasks first, a hairline, then the tail — and the rail scrolls, exactly like the setup
// checklist's (the user retired the "More tasks" fold, 2026-09-15). Arrow keys move the
// selection like the tab strip's do.
export default function TaskRail({
  card,
  selectedId,
  onSelect,
  detailId,
}: {
  card: GuideCard
  selectedId: string
  onSelect: (id: string) => void
  detailId: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  // The FIRST placement is where the bar lives, not a move: data-placed goes on from the second.
  const placedRef = useRef(false)
  const core = card.tasks
  const tail = card.more ?? []
  const all: GuideTask[] = [...core, ...tail]

  useLayoutEffect(() => {
    const place = () => {
      const list = listRef.current
      const bar = indicatorRef.current
      if (list === null || bar === null) return
      const row = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (row === null) {
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
  }, [selectedId, card])

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, task: GuideTask) => {
    const index = Math.max(0, all.findIndex((t) => t.id === task.id))
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const nextIndex =
      event.key === 'Home' ? 0
      : event.key === 'End' ? all.length - 1
      : step ? (index + step + all.length) % all.length
      : null
    if (nextIndex === null) return
    event.preventDefault()
    const next = all[nextIndex]
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
      tabIndex={task.id === selectedId ? 0 : -1}
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
      {core.map((task, index) => row(task, index))}
      {tail.length > 0 && (
        <>
          {/* A hairline between the core tasks and the tail: the authors' order, not a hidden set. */}
          <span className="guide-rail-divider" aria-hidden="true" />
          {tail.map((task, index) => row(task, core.length + index))}
        </>
      )}
    </div>
  )
}
