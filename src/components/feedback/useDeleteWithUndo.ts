import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { useToast } from '../ToastProvider'
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
  /** E.g. the next row's same control; evaluated after onDeleted. */
  focusAfter?: () => HTMLElement | null
  /** Reload after a successful Undo. */
  onRestored?: () => void | Promise<void>
  /** Flashed + revealed + focused after onRestored. */
  restoredRow?: () => HTMLElement | null
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Rows whose delete is in flight: a second press on a leaving row is not a second delete. */
const leaving = new WeakSet<HTMLElement>()

const controlsOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))

/** Focus the row an Undo brought back where the delete was pressed: the row itself when it takes focus,
 *  else the control at the same place in it as the one that asked (its Delete), else its first. */
function focusRestored(row: HTMLElement, asked: number): void {
  if (row.matches(FOCUSABLE)) {
    row.focus()
    return
  }
  const controls = controlsOf(row)
  const target = controls[asked] ?? controls[0]
  target?.focus()
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

/**
 * A promise for "React has committed everything scheduled so far" — the reload onDeleted or onRestored
 * set in motion included. A state tick scheduled after those updates lands in the same render (one
 * lane, one batch), and its layout effect runs once that render is in the DOM, so focusAfter and
 * restoredRow read the list as it now stands. An owner that has unmounted (an Undo pressed after the
 * page was left) resolves at once: nothing will commit for it again.
 */
function useAfterCommit(): () => Promise<void> {
  const [tick, setTick] = useState(0)
  const waiting = useRef<(() => void)[]>([])
  const mounted = useRef(false)

  useLayoutEffect(() => {
    for (const release of waiting.current.splice(0)) release()
  }, [tick])

  useEffect(() => {
    mounted.current = true
    const queue = waiting.current
    return () => {
      mounted.current = false
      for (const release of queue.splice(0)) release()
    }
  }, [])

  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (!mounted.current) {
          resolve()
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
 * (data-leaving) while the request runs; the list reloads (onDeleted); focus moves on (focusAfter); and
 * "Deleted {name}" offers Undo — the change batch's exact undo, which brings the row back with its id,
 * its place and its dependants — then reloads (onRestored) and reveals, flashes and focuses the row
 * (restoredRow). A refused delete puts the row back and toasts the server's sentence; so does a refused
 * Undo. A null batch (nothing recorded) offers no Undo. Resolves true when the row was deleted.
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
      // Which of the row's controls asked, so an Undo can hand the focus back to the same one.
      const active = document.activeElement
      const asked =
        row !== null && active instanceof HTMLElement && row.contains(active)
          ? controlsOf(row).indexOf(active)
          : -1
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
      options.focusAfter?.()?.focus()
      if (batchId === null) {
        toast.success(`Deleted ${name}`)
        return true
      }
      const batch = batchId
      const undo = async () => {
        try {
          await undoBatch(batch)
        } catch (err) {
          toast.error(errorDetail(err))
          return
        }
        await quietly(options.onRestored)
        await afterCommit()
        const restored = options.restoredRow?.() ?? null
        if (restored !== null) {
          revealRow(restored)
          flashElement(restored)
          focusRestored(restored, asked)
        }
        toast.success(`Restored ${name}`)
      }
      toast.success(`Deleted ${name}`, { action: { label: 'Undo', onAction: () => void undo() } })
      return true
    },
    [toast, afterCommit],
  )
}
