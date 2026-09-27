import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chapterOf, hashTarget } from './anchors'
import { rememberSetupTask } from './setupProgress'
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
// first task. A row pick replaces the hash and tells LocalSections to keep the viewport still.
// Reload and Back still perform normal deep-link arrival. Compare the
// hash last honoured with the current one instead of a setState-in-effect. Every task sits in
// the rail (the user retired the "More tasks" fold, 2026-09-15), so there is no fold state.
export function useTaskSelection(card: GuideCard): TaskSelection {
  const location = useLocation()
  const { hash } = location
  const navigate = useNavigate()
  const [state, setState] = useState(() => ({ selectedId: taskFromHash(card, hash) ?? card.tasks[0]?.id ?? '', hash }))
  if (state.hash !== hash) {
    setState({ selectedId: taskFromHash(card, hash) ?? state.selectedId, hash })
  }
  return {
    selectedId: state.selectedId,
    select: (id) => {
      setState((s) => ({ ...s, selectedId: id }))
      rememberSetupTask(id)
      const params = new URLSearchParams(location.search)
      const chapter = chapterOf(id)
      if (chapter) params.set('section', chapter)
      navigate({ pathname: location.pathname, search: params.toString(), hash: `#${id}` }, {
        replace: true, preventScrollReset: true, state: { ...location.state, guideTaskSelection: id },
      })
    },
  }
}
