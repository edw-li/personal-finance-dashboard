import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { hashTarget } from './anchors'
import type { GuideCard } from './types'

export interface TaskSelection {
  selectedId: string
  select: (id: string) => void
}

/** The task a `#hash` names on this card — core or tail — or null. */
export function taskFromHash(card: GuideCard, hash: string): string | null {
  const target = hashTarget(hash)
  if (!target) return null
  return [...card.tasks, ...(card.more ?? [])].some((task) => task.id === target) ? target : null
}

// Which task the detail column shows (2026-09-15 polish spec §2.4). The hash wins on arrival and
// whenever it changes while the card is mounted (a palette hit, a pointer link); otherwise the
// first task. Clicking a row changes state only — a hash write would re-run the arrival
// scroll-and-focus on every click. Derived during render, the LocalSections idiom: compare the
// hash last honoured with the current one instead of a setState-in-effect. Every task sits in
// the rail (the user retired the "More tasks" fold, 2026-09-15), so there is no fold state.
export function useTaskSelection(card: GuideCard): TaskSelection {
  const { hash } = useLocation()
  const [state, setState] = useState(() => ({ selectedId: taskFromHash(card, hash) ?? card.tasks[0]?.id ?? '', hash }))
  if (state.hash !== hash) {
    setState({ selectedId: taskFromHash(card, hash) ?? state.selectedId, hash })
  }
  return {
    selectedId: state.selectedId,
    select: (id) => setState((s) => ({ ...s, selectedId: id })),
  }
}
