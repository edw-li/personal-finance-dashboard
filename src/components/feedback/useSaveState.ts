import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorDetail } from '../../api/client'

export type SaveStatusKind = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

export interface SaveState {
  status: SaveStatusKind
  error: string | null
  /** Runs the save: 'saving', then 'saved' for 2.5 s (then clean/dirty per `dirty`), or 'error' with the message. */
  run: <T>(save: () => Promise<T>) => Promise<T | undefined>
  clearError: () => void
}

/** How long "Saved ✓" stays (spec D3: ~2.5 s). */
export const SAVED_MS = 2500

type Phase = 'idle' | 'saving' | 'saved' | 'error'

/**
 * One form's save, told where the user acted (2026-09-25 polish spec D3; contract C3). `dirty` is the
 * form's own comparison with what is stored — update what it compares against INSIDE `save`, so the
 * status goes straight from saving to saved. "Saved ✓" shows only while the form still matches what
 * was saved: an edit inside its 2.5 s reads "Unsaved changes" at once. One save at a time — a run
 * while one is in flight saves nothing and answers undefined — and an aborted save is no save, not an
 * error. A failure keeps its message (errorDetail: the server's own sentence) until clearError or the
 * next run.
 */
export function useSaveState({ dirty }: { dirty: boolean }): SaveState {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  // One stable record for what the async path needs after the render that started it.
  const life = useRef({
    alive: true,
    saving: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  })

  useEffect(() => {
    const own = life.current
    own.alive = true
    return () => {
      own.alive = false
      clearTimeout(own.timer)
    }
  }, [])

  const run = useCallback(async <T>(save: () => Promise<T>): Promise<T | undefined> => {
    const own = life.current
    if (own.saving) return undefined
    own.saving = true
    clearTimeout(own.timer)
    setError(null)
    setPhase('saving')
    try {
      const result = await save()
      if (own.alive) {
        setPhase('saved')
        own.timer = setTimeout(() => setPhase('idle'), SAVED_MS)
      }
      return result
    } catch (err) {
      // A form that has gone takes no news, good or bad.
      if (!own.alive) return undefined
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('idle')
      } else {
        setError(errorDetail(err))
        setPhase('error')
      }
      return undefined
    } finally {
      own.saving = false
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setPhase((current) => (current === 'error' ? 'idle' : current))
  }, [])

  const status: SaveStatusKind =
    phase === 'saving' || phase === 'error'
      ? phase
      : phase === 'saved' && !dirty
        ? 'saved'
        : dirty
          ? 'dirty'
          : 'clean'

  return useMemo(() => ({ status, error, run, clearError }), [status, error, run, clearError])
}
