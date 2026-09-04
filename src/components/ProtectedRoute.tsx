import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './ProtectedRoute.css'

// The branded splash (2026-09-03 shell spec §10): a wordmark at once, a spinner after 300 ms,
// and a real sentence with Retry when the identity check cannot reach the server — never
// the blank page the `null` return used to be.
export default function ProtectedRoute() {
  const { isAuthenticated, isLoading, authError, retry } = useAuth()
  const [showSpinner, setShowSpinner] = useState(false)
  useEffect(() => {
    if (!isLoading) return
    const timer = setTimeout(() => setShowSpinner(true), 300)
    // The reset belongs in the CLEANUP, not the body: a Retry re-enters loading and has to
    // earn the spinner's 300 ms of silence again, rather than flashing the one the previous
    // attempt left latched on. (setState in an effect body is what the lint rule forbids;
    // in a cleanup it is the only place this can go.)
    return () => {
      clearTimeout(timer)
      setShowSpinner(false)
    }
  }, [isLoading])

  if (isLoading || (!isAuthenticated && authError !== null)) {
    return (
      <div className="splash" role="status" aria-live="polite">
        <div className="splash-wordmark">Personal finance</div>
        {isLoading && showSpinner && (
          // role="img": an aria-label on a bare div is not exposed to a screen reader, so
          // without it the spinner announces nothing at all.
          <div className="splash-spinner" role="img" aria-label="Connecting…" />
        )}
        {!isLoading && authError !== null && (
          <p className="splash-error">
            {/* Verbatim: AuthContext decides whether this is an unreachable server or a
                server that answered badly, and hands over a finished sentence. */}
            {authError}{' '}
            <button type="button" className="splash-retry" onClick={retry}>
              Retry
            </button>
          </p>
        )}
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
