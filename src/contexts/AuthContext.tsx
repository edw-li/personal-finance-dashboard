import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { beginAssistantSession, clearAssistantSession } from '../api/assistantSession'
import * as authApi from '../api/auth'
import { ApiError, getToken, setAfterResponseHook } from '../api/client'
import { clearSnapshots } from '../api/snapshotCache'
import { maybeRenew } from '../components/shell/session'

interface AuthState {
  email: string | null
  isAuthenticated: boolean
  isLoading: boolean
  /** Why the identity check could not be answered, as a FINISHED sentence — a 401 is never
   *  here (client.ts redirects those), but a 500 is, and it must not be mislabelled as an
   *  unreachable server. ProtectedRoute prints it verbatim beside `retry`. */
  authError: string | null
  retry: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)
  // Seeded from the token so the tokenless path never needs a synchronous setState in the
  // effect below (eslint-plugin-react-hooks v7 errors on that: react-hooks/set-state-in-effect).
  const [isLoading, setIsLoading] = useState(() => getToken() !== null)
  const [authError, setAuthError] = useState<string | null>(null)
  // Trigger only: each Retry bumps it and re-runs the identity check below.
  const [attempt, setAttempt] = useState(0)

  // Sliding renewal (2026-09-03 shell spec §10). Registered rather than imported by
  // client.ts: session.ts uses that module's token helpers, so a direct import would cycle.
  useEffect(() => {
    setAfterResponseHook(() => {
      void maybeRenew()
    })
    return () => setAfterResponseHook(null)
  }, [])

  useEffect(() => {
    // LOAD-BEARING guard — do not drop: without it, a tokenless mount calls /auth/me,
    // gets 401, and client.ts clears+redirects to /login, remounting this provider in an
    // infinite full-page reload loop (verified during Task 11 review).
    if (!getToken()) return
    authApi
      .fetchMe()
      .then((me) => {
        setEmail(me.email)
        setAuthError(null)
      })
      .catch((err: unknown) => {
        setEmail(null)
        // A 401 has already been redirected by client.ts, so it needs no sentence here.
        if (err instanceof ApiError && err.status === 401) return
        // Everything else does. Only a genuinely unreachable server (status 0, or a throw
        // that never became an ApiError at all) gets the "can't reach" preamble: a 500
        // means the server answered, and telling the user their network is down would send
        // them to reboot a router over a bug in the API.
        const unreachable = !(err instanceof ApiError) || err.status === 0
        const detail = err instanceof Error && err.message !== '' ? err.message : 'unknown error'
        setAuthError(unreachable ? `Can't reach the server — ${detail}` : detail)
      })
      .finally(() => setIsLoading(false))
  }, [attempt])

  const retry = useCallback(() => {
    // No token means there is nothing to re-check: the effect above would bail on its own
    // guard and leave a spinner running forever. Dropping the error hands the visitor to
    // ProtectedRoute, which sends them to the login.
    if (getToken() === null) {
      setAuthError(null)
      return
    }
    setIsLoading(true)
    setAuthError(null)
    setAttempt((n) => n + 1)
  }, [])

  const login = useCallback(async (loginEmail: string, password: string) => {
    await authApi.login(loginEmail, password)
    const me = await authApi.fetchMe()
    // Lifts logout's session-ended latch. Logging out and back in never reloads the
    // document (both are client-side route changes), so the module-level latch would
    // otherwise outlive the session it ended and leave the assistant unable to persist.
    beginAssistantSession()
    setEmail(me.email)
    setAuthError(null) // a fresh session answers whatever the last attempt could not
  }, [])

  const logout = useCallback(() => {
    authApi.logout()
    clearSnapshots() // snapshots are session data — they must not outlive the session
    clearAssistantSession() // and neither may a financial chat transcript
    setEmail(null)
    setAuthError(null) // a deliberate sign-out is not a failure to report
  }, [])

  return (
    <AuthContext.Provider
      value={{ email, isAuthenticated: email !== null, isLoading, authError, retry, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
