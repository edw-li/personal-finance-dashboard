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
export default function TaskDetail({ task, id }: { task: GuideTask; id: string }) {
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
    </div>
  )
}
