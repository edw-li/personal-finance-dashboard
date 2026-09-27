import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useDetailPanel } from '../components/details/DetailPanelProvider'
import { chapterOf } from './anchors'
import { GUIDE } from './content'
import { useGuideSession } from './guideSession'
import SetupProgressProvider from './SetupProgressProvider'
import TaskDetail from './TaskDetail'
import '../pages/GuidePage.css'
import './guideCompanion.css'

export default function GuideCompanion() {
  const session = useGuideSession()
  const inspector = useDetailPanel()
  const bodyRef = useRef<HTMLDivElement>(null)
  const taskId = session?.taskId
  const previousTask = useRef(taskId)
  useLayoutEffect(() => {
    if (previousTask.current === taskId) return
    previousTask.current = taskId
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    if (document.activeElement?.closest('.guide-companion')) {
      document.getElementById('guide-companion-task')?.focus({ preventScroll: true })
    }
  }, [taskId])
  if (!session?.taskId) return null
  const card = GUIDE.flatMap((chapter) => chapter.cards).find((card) => [...card.tasks, ...(card.more ?? [])].some((task) => task.id === session.taskId))
  const tasks = card ? [...card.tasks, ...(card.more ?? [])] : []
  const index = tasks.findIndex((task) => task.id === session.taskId)
  const task = tasks[index]
  const suspended = inspector?.activeId != null
  return (
    <aside className={`guide-companion${suspended ? ' guide-companion-paused' : ''}`} aria-label="Guide instructions" onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); session.close() }
    }}>
      <div className="guide-companion-head">
        <div><span className="eyebrow">Follow along</span><p>{card?.title ?? 'Guide'}</p></div>
        <button type="button" className="button" aria-label="Close guide instructions" onClick={session.close}>Close ×</button>
      </div>
      {suspended ? <div className="guide-companion-body"><p>Your instructions are kept while details are open.</p><button type="button" className="button" onClick={() => inspector?.close()}>Return to instructions</button></div> : (
        <div className="guide-companion-body" ref={bodyRef}>
          {task ? <SetupProgressProvider key={task.id.startsWith('setup-') ? 'setup' : 'reference'} enabled={task.id.startsWith('setup-')}>
            <TaskDetail task={task} id="guide-companion-task" companion watch={card?.watch}
              step={{ index, count: tasks.length, numbered: card?.numbered === true, previous: tasks[index - 1] ?? null, next: tasks[index + 1] ?? null, onGo: (next) => session.select(next.id) }} />
            <Link className="guide-return" to={`/guide?section=${chapterOf(task.id)}#${task.id}`}>Back to this task in the Guide →</Link>
          </SetupProgressProvider> : <p>This instruction link is no longer available. <Link to="/guide">Open the Guide</Link> to find a task.</p>}
        </div>
      )}
    </aside>
  )
}
