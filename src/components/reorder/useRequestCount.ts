import { useCallback, useState } from 'react'

/** How many of a list's requests are in flight — a count, never a flag: an Undo overlapping a later
 *  save must not re-enable the grips when the first of the two settles (R2/R3/R5 code reviews). The
 *  caller's `run` returns its WHOLE chain (`.then(onSaved, onFailed)` included), so the count drops
 *  only after the handlers ran. The promise handed back is that chain's, settling as it does. */
export function useRequestCount(): {
  busy: boolean
  track: <T>(run: () => Promise<T>) => Promise<T>
} {
  const [count, setCount] = useState(0)
  const track = useCallback(<T>(run: () => Promise<T>): Promise<T> => {
    setCount((n) => n + 1)
    let pending: Promise<T>
    try {
      pending = run()
    } catch (err) {
      // Thrown before a promise existed: nothing will settle, so the count comes straight back.
      setCount((n) => n - 1)
      throw err
    }
    return pending.finally(() => setCount((n) => n - 1))
  }, [])
  return { busy: count > 0, track }
}
