import { Link } from 'react-router-dom'
import type { TimeStatusOut } from '../../types/api'
import { dueParts, nothingDueSentence, type DuePart } from './dueParts'

// The strip at the top of the monthly update (2026-09-23 spec §M2): one chip per due part, each a
// link to its month and step, amber once overdue — and saying so in words, never by colour alone.
// A plain click goes through the wizard's own month switch (the draft-safe path the ribbon uses);
// a modified click keeps the link's own behaviour, so a part still opens in a new tab.
export default function WhatsDue({
  time,
  onOpen,
}: {
  time: TimeStatusOut | null | undefined
  onOpen: (part: DuePart) => void
}) {
  if (!time) return null
  const parts = dueParts(time)
  return (
    <nav className="whats-due" aria-label="What's due">
      <span className="eyebrow whats-due-label" aria-hidden="true">
        What's due
      </span>
      {parts.length === 0 ? (
        <p className="whats-due-none">{nothingDueSentence(time)}</p>
      ) : (
        <ul className="whats-due-chips">
          {parts.map((part) => (
            <li key={part.key}>
              <Link
                to={`/update?month=${part.month}&step=${part.step}`}
                className={`due-chip${part.overdue ? ' is-overdue' : ''}`}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  onOpen(part)
                }}
              >
                <span className="due-chip-name">{part.name}</span> · {part.detail}
                {part.overdue && <span className="due-chip-tag"> · overdue</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
