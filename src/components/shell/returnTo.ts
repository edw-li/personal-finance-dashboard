// Return-to-page (2026-09-03 shell spec §10), alone in a module that imports NOTHING.
// Two very different places need it — api/client.ts on the 401 path and session.ts beside
// the renewer — and session.ts already imports client.ts, so anything shared between them
// has to sit below both or it closes a cycle. session.ts re-exports these for callers that
// think of the session as one thing.
export const RETURN_TO_KEY = 'finance.returnTo'

/** Same-origin in-app paths only, never the login page itself: `/`, or `/` followed by a
 *  character that is neither `/` nor `\`. Those two exclusions are the whole point:
 *  `//evil.example` is a protocol-relative URL and `/\evil.example` normalizes into one, so
 *  a browser resolves both OFF-SITE and "starts with a slash" alone is an open redirect. */
function safeReturnTo(value: string | null): string | null {
  if (value === null) return null
  if (!/^\/($|[^/\\])/.test(value)) return null
  if (value.startsWith('/login')) return null
  return value
}

/** Remembers where the session died. An unsafe current path (the login itself, most often)
 *  leaves an already-remembered path STANDING: the second 401 of a redirect chain must not
 *  erase the page the first one was trying to save. */
export function rememberReturnTo(pathAndSearch: string): void {
  if (safeReturnTo(pathAndSearch) === null) return
  try {
    sessionStorage.setItem(RETURN_TO_KEY, pathAndSearch)
  } catch {
    // Storage blocked: the user simply lands on the overview after signing in.
  }
}

/** Reads WITHOUT clearing: the login page needs its destination at mount but must still
 *  have one after an F5, so the key is spent only once a sign-in has actually succeeded. */
export function peekReturnTo(): string | null {
  try {
    return safeReturnTo(sessionStorage.getItem(RETURN_TO_KEY))
  } catch {
    return null
  }
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(RETURN_TO_KEY)
  } catch {
    // Storage blocked: there was nothing to clear either.
  }
}

/** Reads AND clears — peek plus clear, for callers that spend the path in one go. */
export function consumeReturnTo(): string | null {
  const value = peekReturnTo()
  clearReturnTo()
  return value
}
