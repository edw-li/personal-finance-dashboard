import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

/** Consume an arrival param: drop `key` from the query, replace-style, KEEPING the anchor.
 *
 *  `setSearchParams` navigates to a search string alone, which resolves against the current
 *  pathname and throws the hash away — so consuming the Backups card's
 *  `/settings?restore=<name>#restore` used to leave `/settings`, and the page's anchored
 *  scroll-and-ring effect (which hangs off `location.hash`) re-ran with nothing to aim at,
 *  cancelling the only timer that takes the ring back off. The command in the query is
 *  one-shot; the anchor in the hash is where the reader is. */
function useConsumeParam(): (searchParams: URLSearchParams, key: string) => void {
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  return useCallback(
    (searchParams: URLSearchParams, key: string) => {
      const next = new URLSearchParams(searchParams)
      next.delete(key)
      navigate({ pathname, search: next.toString(), hash }, { replace: true })
    },
    [navigate, pathname, hash],
  )
}

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
  const [searchParams] = useSearchParams()
  const consume = useConsumeParam()
  const raw = searchParams.get(key)
  useEffect(() => {
    if (raw === null) return
    if ((allowed as readonly string[]).includes(raw)) apply(raw as T)
    consume(searchParams, key)
    // The strip changes searchParams identity and nulls `raw`, so the re-run
    // early-returns; a double-apply between renders is idempotent by contract.
  }, [raw, key, allowed, apply, searchParams, consume])
}

/** Like useArrivalParam, for values that are DATA rather than an enum (a ticker, an
 *  account slug): there is no allow-list to check against, so any non-empty value is
 *  handed to `apply`, which decides.
 *
 *  `apply` returns `false` for "I cannot judge this yet" — the page's payload has not
 *  landed, so there is nothing to resolve the slug against. The param then STAYS in the
 *  URL and this effect runs again when `apply`'s identity changes with that payload
 *  (`useCallback([data])`). Anything else — applied, or judged and rejected — consumes
 *  the value and strips it replace-style, so refresh and Back never replay the command.
 *  Without the "not yet" answer a deep link would be silently dropped on every cold load,
 *  which is exactly the case the palette's entity entries produce.
 *
 *  `apply` must be identity-stable (useCallback), or the effect would loop. */
export function useArrivalValue(key: string, apply: (value: string) => boolean | void): void {
  const [searchParams] = useSearchParams()
  const consume = useConsumeParam()
  const raw = searchParams.get(key)
  useEffect(() => {
    if (raw === null) return
    if (raw.trim() !== '' && apply(raw.trim()) === false) return
    consume(searchParams, key)
  }, [raw, key, apply, searchParams, consume])
}
