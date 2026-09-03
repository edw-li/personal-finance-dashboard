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
    return () => clearTimeout(timer)
  }, [isLoading])

  if (isLoading || (!isAuthenticated && authError !== null)) {
    return (
      <div className="splash" role="status" aria-live="polite">
        <div className="splash-wordmark">Finance</div>
        {isLoading && showSpinner && <div className="splash-spinner" aria-label="Connecting…" />}
        {!isLoading && authError !== null && (
          <p className="splash-error">
            Can&apos;t reach the server — {authError}{' '}
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
