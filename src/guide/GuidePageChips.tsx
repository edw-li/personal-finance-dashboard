import { Link } from 'react-router-dom'
import type { GuideChapter } from './types'

// One chip per page card, sidebar order, at the top of the Pages chapter. A <Link> to
// ?section=pages#<cardId>: the navigation pushes a location key, and useLocalSections'
// arrival effect scrolls the card in and focuses it (2026-09-14 guide spec §3.1). Not a
// Segmented: nothing is "selected" — these are jumps, not a state.
export default function GuidePageChips({ chapter }: { chapter: GuideChapter }) {
  return (
    <nav className="guide-chips span-12" aria-label="Pages in this guide">
      {chapter.cards.map((card) => (
        <Link key={card.id} className="chip" to={{ search: '?section=pages', hash: `#${card.id}` }}>
          {card.title}
        </Link>
      ))}
    </nav>
  )
}
