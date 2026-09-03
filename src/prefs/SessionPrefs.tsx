import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { endSession, syncFromServer } from './prefsStore'

/** Runs the once-per-session preferences sync when the session becomes authenticated
 *  (2026-09-03 data-lifecycle spec §10 step 2) — i.e. after /auth/me has answered — and ends
 *  it when the session goes away. Renders nothing; mounted inside AuthProvider in App.tsx. */
export default function SessionPrefs() {
  const { isAuthenticated } = useAuth()
  // Which side of the session we last saw. A ref, not state: nothing renders from it, and the
  // effect has to tell "signed out" (true → false) apart from "not signed in YET" — a fresh
  // load with a valid token starts false until /auth/me answers, and ending a session that
  // never started would wipe the dirty keys the store just re-read from storage.
  const wasAuthenticated = useRef(false)
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticated.current = true
      void syncFromServer()
    } else if (wasAuthenticated.current) {
      wasAuthenticated.current = false
      endSession()
    }
  }, [isAuthenticated])
  return null
}
