import type { ReactNode } from 'react'

// The one piece of markup guide steps may carry: **Label** for an on-screen label, rendered
// bold so a reader can match it to the button in front of them. Nothing else is parsed — a
// step is a sentence, not a document (2026-09-14 guide spec §3.2). React escapes the text
// itself, so '<Month>' is a placeholder, not an element.
const LABEL = /\*\*(.+?)\*\*/g

export function renderSteps(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(LABEL)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    nodes.push(
      <b className="guide-label" key={`${start}-${match[1]}`}>
        {match[1]}
      </b>,
    )
    last = start + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
