import { Link } from 'react-router-dom'
import Disclosure from '../components/Disclosure'
import GuideTaskList from './GuideTaskList'
import { renderSteps } from './renderSteps'
import type { GuideCard as GuideCardData } from './types'

// The four-part card grammar (2026-09-14 guide spec §3.2): Purpose · Do this · Watch out ·
// More. A .card so the shell's entrance, stagger and scroll reveal apply with no opt-in; the
// eyebrow h2 carries the card's id as its anchor target's label.
export default function GuideCard({ card }: { card: GuideCardData }) {
  const hasTasks = card.tasks.length > 0
  const watch = card.watch ?? []
  const more = card.more ?? []
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
      {hasTasks && (
        <>
          <h3 className="guide-h3">Do this</h3>
          <GuideTaskList tasks={card.tasks} />
        </>
      )}
      {watch.length > 0 && (
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
      )}
      {more.length > 0 && (
        <Disclosure summary={`More tasks (${more.length})`} className="guide-more">
          <GuideTaskList tasks={more} />
        </Disclosure>
      )}
    </section>
  )
}
