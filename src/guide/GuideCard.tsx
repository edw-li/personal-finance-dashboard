import { Link } from 'react-router-dom'
import { renderSteps } from './renderSteps'
import TaskDetail from './TaskDetail'
import TaskRail from './TaskRail'
import type { GuideCard as GuideCardData } from './types'
import { useTaskSelection } from './useTaskSelection'

// The card grammar after the 2026-09-15 polish: Purpose · views · body, then a rail of tasks on
// the left and the selected task's detail on the right (spec §2.1). Still a .card so the shell's
// entrance, stagger and scroll reveal apply with no opt-in; the eyebrow h2 labels the section.
export default function GuideCard({ card }: { card: GuideCardData }) {
  const hasTasks = card.tasks.length > 0
  const watch = card.watch ?? []
  const selection = useTaskSelection(card)
  const all = [...card.tasks, ...(card.more ?? [])]
  const selected = all.find((task) => task.id === selection.selectedId) ?? card.tasks[0]
  const detailId = `${card.id}-detail`
  const watchBlock = watch.length > 0 && (
    <>
      <h3 className="guide-h3">Watch out</h3>
      <ul className="guide-watch">
        {watch.map((line) => (
          // A trap names controls as often as a step does, so it gets the same one
          // piece of markup — **Label** in bold (lane V, from G3's hand-off).
          <li key={line}>{renderSteps(line)}</li>
        ))}
      </ul>
    </>
  )
  return (
    <section className="card span-12 guide-card" id={card.id} aria-labelledby={`${card.id}-title`}>
      <div className="guide-card-head">
        <h2 className="eyebrow" id={`${card.id}-title`}>
          {card.title}
        </h2>
        {card.to && (
          <Link className="guide-open" to={card.to}>
            Open {card.title} →
          </Link>
        )}
      </div>
      <p className="guide-purpose">{card.purpose}</p>
      {card.views && card.views.length > 0 && <p className="drill-hint">Views: {card.views.join(' · ')}</p>}
      {card.body}
      {hasTasks && selected ? (
        <div className="guide-md">
          <div className="guide-rail-col">
            <h3 className="guide-h3" id={`${card.id}-tasks`}>
              Do this
            </h3>
            <TaskRail card={card} selectedId={selected.id} onSelect={selection.select} detailId={detailId} />
          </div>
          <div className="guide-detail-col">
            <TaskDetail task={selected} id={detailId} />
            {watchBlock}
          </div>
        </div>
      ) : (
        watchBlock
      )}
    </section>
  )
}
