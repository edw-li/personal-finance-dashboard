import { apiReadOnly, getToken, setToken } from '../../api/client'

// A session that respects the user (2026-09-03 shell spec §10): renew the bearer token before
// it dies, and after a forced sign-out put the user back where they were.
export const RENEW_WITHIN_MS = 6 * 60 * 60 * 1000
export const RETURN_TO_KEY = 'finance.returnTo'
export const LAST_EMAIL_KEY = 'finance.lastEmail'

/** The token's expiry as epoch milliseconds, or null when it cannot be read. The payload is
 *  decoded, never verified — the server verifies; this only schedules a renewal. */
export function expiryOf(token: string): number | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = atob(
      parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    )
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

/** Inside the last six hours of a still-live token. A dead token is the 401 path's business. */
export function shouldRenew(token: string, nowMs: number): boolean {
  const exp = expiryOf(token)
  if (exp === null) return false
  const remaining = exp - nowMs
  return remaining > 0 && remaining < RENEW_WITHIN_MS
}

let inFlight: Promise<void> | null = null

/** Renew once when due; concurrent callers share one request; failures are swallowed (the
 *  next successful response tries again). apiReadOnly, not api: a renew writes nothing and
 *  must not wipe the page snapshots. */
export function maybeRenew(nowMs: number = Date.now()): Promise<void> {
  const token = getToken()
  if (token === null || !shouldRenew(token, nowMs)) return Promise.resolve()
  if (inFlight === null) {
    inFlight = apiReadOnly<{ access_token: string }>('/auth/renew', {})
      .then((res) => setToken(res.access_token))
      .catch(() => undefined)
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

/** Same-origin in-app paths only, never the login page itself. */
function safeReturnTo(value: string | null): string | null {
  if (value === null) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return null
  return value
}

export function rememberReturnTo(pathAndSearch: string): void {
  try {
    if (safeReturnTo(pathAndSearch) !== null) sessionStorage.setItem(RETURN_TO_KEY, pathAndSearch)
    else sessionStorage.removeItem(RETURN_TO_KEY)
  } catch {
    // Storage blocked: the user simply lands on the overview after signing in.
  }
}

/** Reads AND clears the remembered path. */
export function consumeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY)
    sessionStorage.removeItem(RETURN_TO_KEY)
    return safeReturnTo(value)
  } catch {
    return null
  }
}
