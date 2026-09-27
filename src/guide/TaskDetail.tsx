import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { NAV_ITEMS } from '../components/navItems'
import { prefersReducedMotion } from '../components/useReducedMotion'
import { EASE_OUT, MOTION_MS } from '../theme/motion'
import { chapterOf } from './anchors'
import { guidedDestination } from './guideSession'
import { renderSteps } from './renderSteps'
import { SetupTaskProgress } from './SetupChecklist'
import { rememberSetupTask } from './setupProgress'
import type { GuideTask } from './types'

export interface TaskStep {
  index: number
  count: number
  numbered: boolean
  previous: GuideTask | null
  next: GuideTask | null
  onGo: (task: GuideTask) => void
}

/** Shared by the Guide and companion: one source for the instructions and navigation. */
export default function TaskDetail({ task, id, step, watch = [], companion = false }: {
  task: GuideTask; id: string; step?: TaskStep; watch?: string[]; companion?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const firstRef = useRef(true)
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null)
  useLayoutEffect(() => {
    const first = firstRef.current
    firstRef.current = false
    if (first) return
    const el = ref.current
    if (el === null || prefersReducedMotion() || typeof el.animate !== 'function') return
    el.animate([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }],
      { duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' })
  }, [task.id])
  const copyLink = async () => {
    const chapter = chapterOf(task.id)
    const link = new URL(`/guide${chapter ? `?section=${chapter}` : ''}#${task.id}`, window.location.origin).href
    try {
      await navigator.clipboard.writeText(link)
      setCopied({ id: task.id, message: 'Task link copied' })
    } catch {
      setCopied({ id: task.id, message: `Copy this task link: ${link}` })
    }
  }
  const cautions = [...(task.watch ?? []), ...watch]
  const destination = NAV_ITEMS.find((item) => item.to === task.to?.split(/[?#]/)[0])?.label ?? task.where.split(' → ')[0]
  return (
    <div ref={ref} className="guide-detail" role={companion ? 'region' : 'tabpanel'} id={id}
      aria-labelledby={companion ? `${id}-title` : task.id} tabIndex={0}>
      <div className="guide-detail-heading">
        <h4 className="guide-task-title" id={`${id}-title`}>{task.title}</h4>
        <button type="button" className="guide-copy" onClick={() => void copyLink()} aria-label={`Copy link to ${task.title}`}>Copy link</button>
      </div>
      {copied?.id === task.id && <p className="guide-status-note" role="status">{copied.message}</p>}
      <p className="guide-where"><span className="guide-where-label">Where:</span> {task.where}</p>
      <ol className="guide-steps">
        {task.steps.map((line, index) => <li key={index}>{renderSteps(line)}</li>)}
      </ol>
      {task.example && <figure className="guide-example"><figcaption>{task.example.label}</figcaption><pre><code>{task.example.value}</code></pre>{task.example.note && <p>{task.example.note}</p>}</figure>}
      {task.to && <div className="guide-action-row">
        <Link className="button button-primary guide-go" to={guidedDestination(task.to, task.id)} onClick={() => rememberSetupTask(task.id)}>
          Open {destination} →
        </Link>
        {!companion && <span>Keep these instructions beside the page.</span>}
      </div>}
      <SetupTaskProgress taskId={task.id} />
      {(cautions.length > 0 || step) && <div className="guide-detail-footer">
        {cautions.length > 0 ? <div className="guide-caution">
          <h3 className="guide-h3">Watch out</h3>
          <ul className="guide-watch">{cautions.map((line) => <li key={line}>{renderSteps(line)}</li>)}</ul>
        </div> : <span />}
        {step && <div className="guide-detail-nav">
          <span className="guide-step-count">{step.numbered ? 'Step' : 'Task'} {step.index + 1} of {step.count}</span>
          <div className="guide-nav-buttons">
            {step.previous && <button type="button" className="button" aria-label={`Previous: ${step.previous.title}`} onClick={() => step.onGo(step.previous!)}>← Previous</button>}
            {step.next && <button type="button" className="button" aria-label={`Next: ${step.next.title}`} onClick={() => step.onGo(step.next!)}>Next →</button>}
          </div>
        </div>}
      </div>}
    </div>
  )
}
