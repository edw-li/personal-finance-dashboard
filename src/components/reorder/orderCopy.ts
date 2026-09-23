import { ApiError, errorDetail } from '../../api/client'

// The sentences every reorderable list speaks (2026-09-23 drag-to-reorder spec §8.1), written
// once. Before this module the five panels carried their own copies, and two lanes had drifted
// into two Undo-failure wordings.

export const ORDER_RESTORED = 'Order restored'

export function movedToast(name: string): string {
  return `Moved ${name}`
}

/** A sentence placed inside ours loses its trailing stop, so ours ends with exactly one. */
export function clause(text: string): string {
  return text.replace(/[.\s]+$/, '')
}

/** A drop the server did not take, said once the rows have snapped back. `reason` is the house's
 *  `errorDetail`; a stale-list 409 never reaches this — each list shows that sentence alone. */
export function orderSaveFailed(reason: string): string {
  return `Couldn't save the new order — ${clause(reason)}. The list is back to how it was.`
}

export function undoFailed(reason: string): string {
  return `Couldn't undo the move — ${clause(reason)}.`
}

/** An Undo the server refused (any 4xx — the stale-list 409, the change log's overlap sentence)
 *  says the server's own sentence; anything else is ours around the reason. `errorDetail` is the
 *  reason either way: for a 4xx it IS the server's sentence, verbatim (or the status, when the
 *  server sent none). */
export function undoFailureText(err: unknown): string {
  const reason = errorDetail(err)
  return err instanceof ApiError && err.status >= 400 && err.status < 500
    ? reason
    : undoFailed(reason)
}
