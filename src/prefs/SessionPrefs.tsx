import { useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { syncFromServer } from './prefsStore'

/** Runs the once-per-session preferences sync when the session becomes authenticated
 *  (2026-09-03 data-lifecycle spec §10 step 2) — i.e. after /auth/me has answered. Renders
 *  nothing; mounted inside AuthProvider in App.tsx. */
export default function SessionPrefs() {
  const { isAuthenticated } = useAuth()
  useEffect(() => {
    if (isAuthenticated) void syncFromServer()
  }, [isAuthenticated])
  return null
}
