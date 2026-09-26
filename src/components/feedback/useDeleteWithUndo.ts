import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { nextFrame } from '../reorder/reorderDom'
import { useToast } from '../ToastProvider'
import { FOCUSABLE, focusablesIn } from './focusable'
import { flashElement, revealRow } from './reveal'
import './feedback.css'

export interface DeleteWithUndoOptions {
  /** "security VOO" → toast "Deleted security VOO" */
  name: string
  /** Takes data-leaving (fade/collapse) while the request runs. */
  row?: HTMLElement | null
  request: () => Promise<{ batchId: string | null }>
  /** Reload the list; awaited before focus moves and the toast shows. */
  onDeleted?: () => void | Promise<void>
  /** E.g. the next row's same control; evaluated after onDeleted. Without one (or when it answers
   *  null) a caret that fell to <body> goes to the row that stood beside the deleted one. */
  focusAfter?: () => HTMLElement | null
  /** Reload after a successful Undo. */
  onRestored?: () => void | Promise<void>
  /** Flashed + revealed + focused after onRestored. Always pass it. */
  restoredRow?: () => HTMLElement | null
}

/** Rows whose delete is in flight: a second press on a leaving row is not a second delete. */
const leaving = new WeakSet<HTMLElement>()

/** Frames to look for the row an Undo brought back when nothing could wait for its commit (below). */
const RESTORE_FRAMES = 10

/** Focus `root` where the delete was pressed: the root itself when it takes focus, else its control at
 *  the same place as the one that asked (its Delete), else its first. A root gone from the page (or
 *  never there) takes nothing. */
function focusIn(root: Element | null, asked: number): void {
  if (!(root instanceof HTMLElement) || !root.isConnected) return
  if (root.matches(FOCUSABLE)) {
    root.focus()
    return
  }
  const controls = focusablesIn(root)
  const target = controls[asked] ?? controls[0]
  target?.focus()
}

/** The caret fell out of the page: onto <body>, or out with the element that held it. */
function caretLost(): boolean {
  const active = document.activeElement
  return active === null || active === document.body || !active.isConnected
}

/** A reload the caller runs after a write. Its failure is the caller's to show (its load path's
 *  banner): the delete, or the undo, already happened — and its toast still has to say so. */
async function quietly(reload: (() => void | Promise<void>) | undefined): Promise<void> {
  try {
    await reload?.()
  } catch {
    // Reported by the caller's own load path (above).
  }
}

/** The row `find` names, looked for again over a few frames when the reload that brings it back could
 *  not be waited for (`committed` false: the hook's owner has gone — a row that owned it unmounted with
 *  the delete). With a commit behind it, one look is the answer: a row still missing is not coming. */
async function findRestored(
  find: (() => HTMLElement | null) | undefined,
  committed: boolean,
): Promise<HTMLElement | null> {
  if (find === undefined) return null
  let found = find()
  for (let frame = 0; found === null && !committed && frame < RESTORE_FRAMES; frame += 1) {
    await new Promise<void>((resolve) => {
      nextFrame(resolve)
    })
    found = find()
  }
  return found
}

/**
 * A promise for "React has committed everything scheduled so far" — the reload onDeleted or onRestored
 * set in motion included. A state tick scheduled after those updates lands in the same render (one
 * lane, one batch), and its layout effect runs once that render is in the DOM, so focusAfter and
 * restoredRow read the list as it now stands. The owner's own unmount is such a commit too (a row that
 * owns the hook goes in the very render it waits for), so it releases its waiters as well. Resolves
 * true once a commit is behind the caller, false at once when the owner had already gone (an Undo
 * pressed after its row or its page left): nothing will commit for it again.
 */
function useAfterCommit(): () => Promise<boolean> {
  const [tick, setTick] = useState(0)
  const waiting = useRef<((committed: boolean) => void)[]>([])
  const mounted = useRef(false)

  useLayoutEffect(() => {
    for (const release of waiting.current.splice(0)) release(true)
  }, [tick])

  useLayoutEffect(() => {
    mounted.current = true
    const queue = waiting.current
    return () => {
      mounted.current = false
      for (const release of queue.splice(0)) release(true)
    }
  }, [])

  return useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        if (!mounted.current) {
          resolve(false)
          return
        }
        waiting.current.push(resolve)
        setTick((n) => n + 1)
      }),
    [],
  )
}

/**
 * The delete grammar (2026-09-25 polish spec D2, §6.3; contract C3): instant, then Undo. The row fades
 * (data-leaving) while the request runs; the list reloads (onDeleted); focus moves on (focusAfter, or the
 * row that stood beside the deleted one when the caret fell to <body>); and "Deleted {name}" offers Undo
 * — the change batch's exact undo, which brings the row back with its id, its place and its dependants —
 * then reloads (onRestored) and reveals, flashes and focuses the row (restoredRow). A refused delete puts
 * the row back and toasts the server's sentence; so does a refused Undo, which then hands the caret back
 * to the list. A null batch (nothing recorded) offers no Undo. Resolves true when the row was deleted.
 *
 * Call it in the component that renders the LIST — not in a row, which unmounts with its own delete and
 * then cannot wait for the reload an Undo starts (it falls back to looking for the row over a few
 * frames) — and always pass restoredRow.
 *
 * Tests: drive it with a click and wait with findBy / waitFor. Awaiting the returned promise INSIDE
 * act(async …) deadlocks: it waits for a React commit that act holds back until its callback settles.
 */
export function useDeleteWithUndo(): (options: DeleteWithUndoOptions) => Promise<boolean> {
  const toast = useToast()
  const afterCommit = useAfterCommit()

  return useCallback(
    async (options: DeleteWithUndoOptions): Promise<boolean> => {
      const { name, request } = options
      const row = options.row ?? null
      if (row !== null && leaving.has(row)) return false
      // Which of the row's controls asked, so the caret can land on the same one — in the row an Undo
      // brings back, or in the row that stood beside it (the next, or the previous for the last row).
      const active = document.activeElement
      const asked =
        row !== null && active instanceof HTMLElement && row.contains(active)
          ? focusablesIn(row).indexOf(active)
          : -1
      const neighbour = row === null ? null : (row.nextElementSibling ?? row.previousElementSibling)
      // Where the caret goes after the delete, and again after a refused Undo: the caller's destination,
      // else that neighbour — never <body>.
      const handBack = (onlyIfLost: boolean) => {
        if (onlyIfLost && !caretLost()) return
        const named = options.focusAfter?.() ?? null
        if (named?.isConnected) named.focus()
        else focusIn(neighbour, asked)
      }
      if (row !== null) {
        leaving.add(row)
        row.setAttribute('data-leaving', '')
      }
      let batchId: string | null
      try {
        batchId = (await request()).batchId
      } catch (err) {
        if (row !== null) {
          leaving.delete(row)
          row.removeAttribute('data-leaving')
        }
        toast.error(errorDetail(err))
        return false
      }
      await quietly(options.onDeleted)
      await afterCommit()
      if (row !== null) {
        leaving.delete(row)
        // Still in the tree after the reload: an element the list reused, or a list that kept the row.
        // Either way it must not stay faded.
        if (row.isConnected) row.removeAttribute('data-leaving')
      }
      // Only a caret that fell with the row moves to the neighbour: one the user put elsewhere stays.
      handBack(true)
      if (batchId === null) {
        toast.success(`Deleted ${name}`)
        return true
      }
      const batch = batchId
      const undo = async () => {
        const anchor = document.activeElement
        const returnFocus = () => document.activeElement === anchor || caretLost()
        try {
          await undoBatch(batch)
        } catch (err) {
          toast.error(errorDetail(err))
          // The Undo button that held the caret is leaving with its toast: back to the list.
          if (returnFocus()) handBack(false)
          return
        }
        await quietly(options.onRestored)
        const restored = await findRestored(options.restoredRow, await afterCommit())
        if (restored !== null) {
          revealRow(restored)
          flashElement(restored)
          if (returnFocus()) focusIn(restored, asked)
        } else if (returnFocus()) handBack(false)
        toast.success(`Restored ${name}`)
      }
      toast.success(`Deleted ${name}`, { action: { label: 'Undo', onAction: undo } })
      return true
    },
    [toast, afterCommit],
  )
}
