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
  /** Why the identity check could not be answered — NOT a 401 (client.ts redirects those),
   *  so always "the server is unreachable". ProtectedRoute shows it with `retry`. */
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
        // A 401 has already been redirected by client.ts; anything else is "can't reach
        // the server", which ProtectedRoute shows with a Retry instead of a blank page.
        if (err instanceof ApiError && err.status !== 401) setAuthError(err.message)
      })
      .finally(() => setIsLoading(false))
  }, [attempt])

  const retry = useCallback(() => {
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
  }, [])

  const logout = useCallback(() => {
    authApi.logout()
    clearSnapshots() // snapshots are session data — they must not outlive the session
    clearAssistantSession() // and neither may a financial chat transcript
    setEmail(null)
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
