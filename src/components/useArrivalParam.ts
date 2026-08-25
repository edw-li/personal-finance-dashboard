import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// A one-shot arrival COMMAND in the URL (?tab=dividends): read it whenever it appears —
// on mount AND on an in-page navigate (the palette fires one while /portfolio is already
// mounted, where a useState initializer would silently no-op) — hand a VALID value to
// `apply`, then strip the param replace-style so refresh/back never replay the command.
// Invalid values are stripped without applying: garbage in the URL is nobody's state.
export function useArrivalParam<T extends string>(
  key: string,
  allowed: readonly T[],
  apply: (value: T) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(key)
  useEffect(() => {
    if (raw === null) return
    if ((allowed as readonly string[]).includes(raw)) apply(raw as T)
    const next = new URLSearchParams(searchParams)
    next.delete(key)
    setSearchParams(next, { replace: true })
    // The strip changes searchParams identity and nulls `raw`, so the re-run
    // early-returns; a double-apply between renders is idempotent by contract.
  }, [raw, key, allowed, apply, searchParams, setSearchParams])
}
