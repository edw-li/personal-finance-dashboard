import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { hashTarget } from './anchors'
import type { GuideCard } from './types'

export interface TaskSelection {
  selectedId: string
  foldOpen: boolean
  select: (id: string) => void
  toggleFold: () => void
}

/** The task a `#hash` names on this card, and whether it is folded — or null. */
export function taskFromHash(card: GuideCard, hash: string): { id: string; folded: boolean } | null {
  const target = hashTarget(hash)
  if (!target) return null
  if (card.tasks.some((task) => task.id === target)) return { id: target, folded: false }
  if ((card.more ?? []).some((task) => task.id === target)) return { id: target, folded: true }
  return null
}

// Which task the detail column shows (2026-09-15 polish spec §2.4). The hash wins on arrival and
// whenever it changes while the card is mounted (a palette hit, a pointer link); otherwise the
// first visible task. Clicking a row changes state only — a hash write would re-run the arrival
// scroll-and-focus on every click. Derived during render, the LocalSections idiom: compare the
// hash last honoured with the current one instead of a setState-in-effect.
export function useTaskSelection(card: GuideCard): TaskSelection {
  const { hash } = useLocation()
  const [state, setState] = useState(() => {
    const hit = taskFromHash(card, hash)
    return { selectedId: hit?.id ?? card.tasks[0]?.id ?? '', foldOpen: hit?.folded ?? false, hash }
  })
  if (state.hash !== hash) {
    const hit = taskFromHash(card, hash)
    setState({ selectedId: hit?.id ?? state.selectedId, foldOpen: hit?.folded ? true : state.foldOpen, hash })
  }
  return {
    selectedId: state.selectedId,
    foldOpen: state.foldOpen,
    select: (id) => setState((s) => ({ ...s, selectedId: id })),
    toggleFold: () => setState((s) => ({ ...s, foldOpen: !s.foldOpen })),
  }
}
