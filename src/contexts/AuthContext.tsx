import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as authApi from '../api/auth'
import { clearAssistantSession } from '../api/assistantSession'
import { getToken } from '../api/client'
import { clearSnapshots } from '../api/snapshotCache'

interface AuthState {
  email: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)
  // Seeded from the token so the tokenless path never needs a synchronous setState in the
  // effect below (eslint-plugin-react-hooks v7 errors on that: react-hooks/set-state-in-effect).
  const [isLoading, setIsLoading] = useState(() => getToken() !== null)

  useEffect(() => {
    // LOAD-BEARING guard — do not drop: without it, a tokenless mount calls /auth/me,
    // gets 401, and client.ts clears+redirects to /login, remounting this provider in an
    // infinite full-page reload loop (verified during Task 11 review).
    if (!getToken()) return
    authApi
      .fetchMe()
      .then((me) => setEmail(me.email))
      .catch(() => setEmail(null))
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (loginEmail: string, password: string) => {
    await authApi.login(loginEmail, password)
    const me = await authApi.fetchMe()
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
      value={{ email, isAuthenticated: email !== null, isLoading, login, logout }}
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
