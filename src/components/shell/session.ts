import { apiReadOnly, getToken, setToken } from '../../api/client'

// A session that respects the user (2026-09-03 shell spec §10): renew the bearer token before
// it dies, and after a forced sign-out put the user back where they were.
export const RENEW_WITHIN_MS = 6 * 60 * 60 * 1000

// Privacy: this key deliberately OUTLIVES a logout so the next sign-in starts in the
// password box. It holds the identifier only — never a password or a token — but anyone
// with the machine can read it, which is the trade the pre-filled email is buying.
export const LAST_EMAIL_KEY = 'finance.lastEmail'

// Return-to-page lives in its own import-free leaf so api/client.ts can use it too (this
// module imports client.ts, so client.ts cannot import this one). Re-exported because the
// session reads as one thing from a caller's side.
export {
  RETURN_TO_KEY,
  clearReturnTo,
  consumeReturnTo,
  peekReturnTo,
  rememberReturnTo,
} from './returnTo'

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
      .then((res) => {
        // Only replace the token this flight was renewing: a logout or a different sign-in
        // that landed mid-flight must not be undone by a stale renewal.
        if (getToken() === token) setToken(res.access_token)
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}
