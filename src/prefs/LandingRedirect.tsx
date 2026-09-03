import { useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { getToken } from '../api/client'
import { getLocal } from './prefsStore'

// The landing_page preference (2026-09-03 data-lifecycle spec §10): a tab's FIRST arrival —
// which is only a redirect candidate when it lands on `/` — goes to the chosen page; every
// later visit to `/` is the Overview the user asked for by clicking it. Per tab
// (sessionStorage) so a reload never re-redirects, a new tab does, and the login clears the
// flag so a fresh sign-in lands there again.
//
// "Arrived" means arrived ANYWHERE, and Layout's mount effect is what says so: keyed on `/`
// alone, a bookmark at /net-worth (or a returnTo after an expiry) left the flag unset, so the
// next click on Overview — an explicit, deliberate click — bounced to the landing page.
export const LANDED_KEY = 'finance.landed'

export function clearLanded(): void {
  try {
    sessionStorage.removeItem(LANDED_KEY)
  } catch {
    // Storage blocked: the redirect simply never fires.
  }
}

/** This tab has arrived; from here on `/` means Overview. Called from Layout's mount effect,
 *  which runs AFTER the `/` route element's render — so a true `/` arrival still redirects. */
export function markLanded(): void {
  try {
    sessionStorage.setItem(LANDED_KEY, '1')
  } catch {
    // Storage blocked: landingTarget() below refuses to redirect anyway.
  }
}

/** The path to redirect to, or null. READ-ONLY: React may call a useState initializer more
 *  than once for one mount (StrictMode does, and a suspended initial mount re-runs it), and a
 *  flag set in here only survived that by luck — the first of the two calls being kept. */
export function landingTarget(): string | null {
  if (getToken() === null) return null // no session: ProtectedRoute is about to redirect anyway
  try {
    if (sessionStorage.getItem(LANDED_KEY) !== null) return null
  } catch {
    return null
  }
  const landing = getLocal('landing_page')
  return landing !== undefined && landing !== '/' ? landing : null
}

export default function LandingRedirect({ children }: { children: ReactNode }) {
  const [target] = useState(landingTarget) // once per mount, never re-evaluated on re-render
  return target === null ? <>{children}</> : <Navigate to={target} replace />
}
