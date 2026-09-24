import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { TimeStatusOut } from '../../types/api'
import { dueParts, nothingDueSentence, type DuePart, type WizardStep } from './dueParts'

/** A link to a due part: its month and step as a URL, so a modified click (a new tab) behaves like
 *  any link, while a plain click goes through the wizard's own month switch — the draft-safe path
 *  the ribbon uses. The strip's chips and the receipt's "Next due" share it. */
export function DuePartLink({
  part,
  onOpen,
  className,
  current = false,
  children,
}: {
  part: DuePart
  onOpen: (part: DuePart) => void
  className?: string
  /** The part is the one on screen — announced as the current page, like a nav's own link. */
  current?: boolean
  children: ReactNode
}) {
  return (
    <Link
      to={`/update?month=${part.month}&step=${part.step}`}
      className={className}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onOpen(part)
      }}
    >
      {children}
    </Link>
  )
}

// The strip at the top of the monthly update (2026-09-23 spec §M2): one chip per due part, each a
// link to its month and step (DuePartLink), amber once overdue — and saying so in words, never by
// colour alone.
export default function WhatsDue({
  time,
  onOpen,
  current,
}: {
  time: TimeStatusOut | null | undefined
  onOpen: (part: DuePart) => void
  /** The month and step on screen: its chip, when one is due, is marked as the current page. */
  current: { month: string; step: WizardStep }
}) {
  if (!time) return null
  const parts = dueParts(time)
  const label = (
    <span className="eyebrow whats-due-label" aria-hidden="true">
      What's due
    </span>
  )
  // With nothing due there is nothing to navigate to: a labelled region holding the one sentence,
  // not a navigation landmark with no links in it (review M18).
  if (parts.length === 0) {
    return (
      <section className="whats-due" aria-label="What's due">
        {label}
        <p className="whats-due-none">{nothingDueSentence(time)}</p>
      </section>
    )
  }
  return (
    <nav className="whats-due" aria-label="What's due">
      {label}
      <ul className="whats-due-chips">
        {parts.map((part) => (
          <li key={part.key}>
            <DuePartLink
              part={part}
              onOpen={onOpen}
              className={`due-chip${part.overdue ? ' is-overdue' : ''}`}
              current={part.month === current.month && part.step === current.step}
            >
              <span className="due-chip-name">{part.name}</span> · {part.detail}
              {part.overdue && <span className="due-chip-tag"> · overdue</span>}
            </DuePartLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
