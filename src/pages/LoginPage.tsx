import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { LAST_EMAIL_KEY, consumeReturnTo } from '../components/shell/session'
import { useAuth } from '../contexts/AuthContext'
import '../components/panels.css'
import './LoginPage.css'

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const expired = searchParams.get('reason') === 'expired'
  // Where a successful sign-in lands. Spent ONCE, at mount rather than at submit, because
  // the redirect has two exits — handleSubmit's navigate() and the isAuthenticated early
  // return below — and react-router routes its location updates through startTransition,
  // so React renders the plain setState exit first and <Navigate> wins the race. Settling
  // the destination up front makes both exits agree; it also survives a failed first
  // attempt, which a submit-time consume would not.
  const [destination] = useState(() => consumeReturnTo() ?? '/')
  const [email, setEmail] = useState(readLastEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = 'Sign in · Finance'
  }, [])

  if (!isLoading && isAuthenticated) return <Navigate to={destination} replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email)
      } catch {
        // remembering the email is a nicety
      }
      // Return-to-page (2026-09-03 shell spec §10): the 401 remembered where the session
      // died; this is where the user gets it back.
      navigate(destination, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  // Both edges: keydown catches the press that turned it on, keyup the one that turned it off.
  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState('CapsLock'))
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Finance Dashboard</h1>
        {expired && (
          <p className="login-notice" role="status">
            Your session expired — sign in to continue where you left off.
          </p>
        )}
        <label>
          Email
          <input
            autoFocus={email === ''}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <div className="login-password">
            {/* A remembered email makes THIS the empty box, so it takes the cursor. */}
            <input
              autoFocus={email !== ''}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={onPasswordKey}
              onKeyDown={onPasswordKey}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="login-toggle"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        {capsLock && (
          <p className="login-hint" role="status">
            Caps Lock is on.
          </p>
        )}
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="button button-primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
