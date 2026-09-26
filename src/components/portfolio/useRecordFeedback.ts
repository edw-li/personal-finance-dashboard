import { useEffect, useRef, useState } from 'react'
import { flashElement, revealEditor, revealRow } from '../feedback/reveal'
import { useSaveState } from '../feedback/useSaveState'
import { useLatest } from '../reorder/useLatest'

/** Feedback shared by the money-entry forms. The list stays its owner's: this only remembers
 *  the form's clean seed and the row a successful save will reveal after the list reloads. */
export function useRecordFeedback<T>(form: T, rows: readonly unknown[], attribute: string) {
  const formRef = useRef<HTMLFormElement>(null)
  const [baseline, setBaseline] = useState(form)
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  const state = useSaveState({ dirty })
  const pending = useRef<{ id: number; focus: boolean; rows: readonly unknown[]; at: number } | null>(null)
  const current = useLatest({ rows, attribute })
  const row = (id: number | null) => id === null ? null
    : document.querySelector<HTMLElement>(`[${attribute}="${id}"]`)

  useEffect(() => {
    const saved = pending.current
    if (saved === null || saved.rows === rows) return
    pending.current = null
    if (performance.now() - saved.at > 10_000) return
    const element = document.querySelector<HTMLElement>(`[${current.current.attribute}="${saved.id}"]`)
    if (element === null) return
    revealRow(element)
    flashElement(element)
    if (saved.focus) element.querySelector<HTMLButtonElement>('[data-edit]')?.focus({ preventScroll: true })
  }, [rows, current])

  const begin = (next: T) => {
    pending.current = null
    setBaseline(next)
    state.clearError()
  }
  const saved = (next: T, id: number | null, focus: boolean) => {
    setBaseline(next)
    if (id !== null) pending.current = { id, focus, rows: current.current.rows, at: performance.now() }
  }
  const reveal = (selector?: string) => queueMicrotask(() => {
    const formElement = formRef.current
    if (formElement === null) return
    // A tall profile cannot fit in one viewport. Reveal the first field's label so its
    // caret lands below the sticky scope row, rather than aligning the form's far end.
    const field = formElement.querySelector<HTMLElement>(selector ?? 'input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
    const target = formElement.getBoundingClientRect().height > window.innerHeight / 2
      ? field?.closest<HTMLElement>('label') ?? formElement : formElement
    revealEditor(target, selector)
  })
  const focusRow = (id: number | null) => {
    const element = row(id)
    if (element !== null) revealRow(element)
    const target = element?.querySelector<HTMLButtonElement>('[data-edit]')
      ?? formRef.current?.querySelector<HTMLButtonElement>('[type="submit"]')
    target?.focus({ preventScroll: true })
  }
  const focusAfterDelete = (id: number) => {
    const ids = current.current.rows as readonly { id: number }[]
    const index = ids.findIndex((item) => item.id === id)
    const neighbour = ids[index + 1] ?? ids[index - 1]
    return () => (neighbour ? row(neighbour.id)?.querySelector<HTMLButtonElement>('[data-delete]') : null)
      ?? formRef.current?.querySelector<HTMLButtonElement>('[type="submit"]') ?? null
  }
  return { state, dirty, formRef, row, begin, saved, reveal, focusRow, focusAfterDelete }
}
