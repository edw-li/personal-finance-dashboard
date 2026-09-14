import type { KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cardOf } from './anchors'
import type { GuideChapter } from './types'

/** The card a chapter shows for a hash: the card it names, the card of the task it names, else
 *  the chapter's first card (2026-09-15 polish spec §3). */
export function selectedCardId(chapter: GuideChapter, hash: string): string {
  let target = hash.replace(/^#/, '')
  try {
    target = decodeURIComponent(target)
  } catch {
    target = ''
  }
  const card = target ? cardOf(target) : undefined
  return card !== undefined && chapter.cards.some((c) => c.id === card) ? card : chapter.cards[0]?.id ?? ''
}

// One card at a time for the Pages and Reference chapters: a sticky chip tablist whose selection
// IS the URL hash, so a deep link, a palette hit and a chip click all land the same way, and Back
// restores the card. Writes replace, not push (the strip's keyboard rule), and LocalSections'
// arrival effect then scrolls the card under the sticky block and focuses it.
export default function CardSelector({ chapter, selectedId }: { chapter: GuideChapter; selectedId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const go = (id: string) =>
    navigate({ pathname: location.pathname, search: location.search, hash: `#${id}` }, { replace: true, preventScrollReset: true })
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = chapter.cards.length
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : step ? (index + step + count) % count : null
    if (nextIndex === null) return
    event.preventDefault()
    const next = chapter.cards[nextIndex].id
    go(next)
    document.getElementById(`${chapter.id}-chip-${next}`)?.focus({ preventScroll: true })
  }
  const label = `${chapter.label} in this guide`
  return (
    <nav className="guide-selector span-12" aria-label={label}>
      <div role="tablist" aria-label={label}>
        {chapter.cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            role="tab"
            id={`${chapter.id}-chip-${card.id}`}
            className="chip"
            aria-selected={card.id === selectedId}
            aria-controls={card.id}
            tabIndex={card.id === selectedId ? 0 : -1}
            onClick={() => go(card.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {card.title}
          </button>
        ))}
      </div>
    </nav>
  )
}
