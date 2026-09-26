import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { prefersReducedMotion } from '../components/useReducedMotion'
import { EASE_OUT, MOTION_MS } from '../theme/motion'
import { renderSteps } from './renderSteps'
import type { GuideTask } from './types'

// The right column of a master–detail card (2026-09-15 polish spec §2.3): the selected task's
// title, path, steps, traps and Go link — the markup the old task list rendered, one task at a
// time. A tabpanel labelled by the rail row that selected it. On a task change it crossfades
// (the LocalSectionPanel idiom: WAAPI so a re-render restarts it; skipped on first mount, under
// reduced motion, and where animate() is missing — jsdom).
/** Where the selected task sits in its rail, and the way to its neighbours (2026-09-25 polish spec
 *  §3.8). A numbered rail — a checklist read in order — says "Step N of M" and offers both ways; an
 *  un-numbered one only Next. */
export interface TaskStep {
  /** 0-based position in the rail. */
  index: number
  count: number
  numbered: boolean
  previous: GuideTask | null
  next: GuideTask | null
  onGo: (task: GuideTask) => void
}

export default function TaskDetail({ task, id, step }: { task: GuideTask; id: string; step?: TaskStep }) {
  // Only a numbered rail walks backwards; any rail walks forward while there is a next task.
  const previous = step?.numbered ? step.previous : null
  const next = step?.next ?? null
  const ref = useRef<HTMLDivElement>(null)
  const firstRef = useRef(true)
  useLayoutEffect(() => {
    const first = firstRef.current
    firstRef.current = false
    if (first) return
    const el = ref.current
    if (el === null || prefersReducedMotion() || typeof el.animate !== 'function') return
    el.animate(
      [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }],
      { duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' },
    )
  }, [task.id])
  return (
    <div ref={ref} className="guide-detail" role="tabpanel" id={id} aria-labelledby={task.id}>
      <h4 className="guide-task-title">{task.title}</h4>
      <p className="guide-where">
        <span className="guide-where-label">Where:</span> {task.where}
      </p>
      <ol className="guide-steps">
        {task.steps.map((step, index) => (
          <li key={index}>{renderSteps(step)}</li>
        ))}
      </ol>
      {task.watch && task.watch.length > 0 && (
        <ul className="guide-task-watch">
          {task.watch.map((line) => (
            <li key={line}>{renderSteps(line)}</li>
          ))}
        </ul>
      )}
      {task.to && (
        <Link className="guide-go" to={task.to}>
          Go →
        </Link>
      )}
      {/* The foot (spec §3.8, SGS-20): the setup checklist had no Next and no sign of progress, so the
          reader bounced between rail and detail. The buttons select the neighbouring rail row; the
          card moves focus there with the selection. Named by the task they lead to. */}
      {step !== undefined && (step.numbered || next !== null) && (
        <div className="guide-detail-foot">
          {step.numbered && (
            <span className="guide-step-count">
              Step {step.index + 1} of {step.count}
            </span>
          )}
          {previous !== null && (
            <button type="button" className="button" aria-label={`Previous: ${previous.title}`} onClick={() => step.onGo(previous)}>
              ← Previous
            </button>
          )}
          {next !== null && (
            <button type="button" className="button" aria-label={`Next: ${next.title}`} onClick={() => step.onGo(next)}>
              Next →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
