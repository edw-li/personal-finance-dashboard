import { useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { getToken } from '../api/client'
import { getLocal } from './prefsStore'

// The landing_page preference (2026-09-03 data-lifecycle spec §10): the FIRST arrival at `/`
// in a tab's session goes to the chosen page; every later visit to `/` is the Overview the
// user asked for by clicking it. Per tab (sessionStorage) so a reload never re-redirects, a
// new tab does, and the login clears the flag so a fresh sign-in lands there again.
export const LANDED_KEY = 'finance.landed'

export function clearLanded(): void {
  try {
    sessionStorage.removeItem(LANDED_KEY)
  } catch {
    // Storage blocked: the redirect simply never fires.
  }
}

/** The path to redirect to, or null — decided (and the flag set) exactly once per call. */
export function landingTarget(): string | null {
  if (getToken() === null) return null // no session: ProtectedRoute is about to redirect anyway
  let landed: string | null = null
  try {
    landed = sessionStorage.getItem(LANDED_KEY)
    sessionStorage.setItem(LANDED_KEY, '1')
  } catch {
    return null
  }
  if (landed !== null) return null
  const landing = getLocal('landing_page')
  return landing !== undefined && landing !== '/' ? landing : null
}

export default function LandingRedirect({ children }: { children: ReactNode }) {
  const [target] = useState(landingTarget) // once per mount, never re-evaluated on re-render
  return target === null ? <>{children}</> : <Navigate to={target} replace />
}
