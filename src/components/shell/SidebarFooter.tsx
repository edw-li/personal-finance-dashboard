import { LogOut, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import { fetchSystemStatus } from '../../api/system'
import { useAuth } from '../../contexts/AuthContext'
import type { SystemStatus } from '../../types/api'
import { useToast } from '../ToastProvider'
import { useTheme } from './ThemeProvider'
import './shell.css'

// The footer is the only fetcher of /system/status in the shell, so it publishes what it
// learned twice, for two different lifetimes:
//
//   SYSTEM_SNAPSHOT — the page-snapshot cache, which api() wipes after ANY non-GET and
//   logout wipes entirely. Right for seeding the email's tooltip on a remount inside one session.
//
//   `last` — module state, wiped by nothing but a reload. Right for the error boundary's
//   Copy details: a snapshot read would go blank the first time the user saved anything,
//   and the session where they save things is exactly the session where they hit a bug.
export const SYSTEM_SNAPSHOT = 'shell:system'
let last: SystemStatus | null = null

/** The last /system/status this tab saw, for Layout's ShellErrorBoundary diagnostics. */
export function getLastSystemStatus(): SystemStatus | null {
  return last
}

// Identity at the bottom of the sidebar (2026-09-03 shell spec §12) — who is signed in, which
// deployment and which build, so two tabs (dev vs prod) can never be confused — plus a one-click
// theme toggle and Log out. ONE row since 2026-09-25 (polish spec §2): the four stacked rows cost
// ~90px, which on a 768–864px laptop pushed both buttons below the sidebar's fold. The environment
// and the build now ride the email's tooltip (Settings › Data › System states them too).
export default function SidebarFooter({ buildHash }: { buildHash: string }) {
  const { email, logout } = useAuth()
  const { theme, resolved, setTheme } = useTheme()
  const toast = useToast()
  // Seeded from the cache so a remount WITHIN a session (a StrictMode double-mount, a shell
  // re-render) names the environment at once instead of dropping it for a beat. Not after a
  // logout/login — logout clears the snapshots by design, since they are session data — and
  // the fetch below revalidates either way.
  const [status, setStatus] = useState<SystemStatus | null>(
    () => getSnapshot<SystemStatus>(SYSTEM_SNAPSHOT) ?? null,
  )
  useEffect(() => {
    // A response that lands after this footer unmounted must not be written into it. React 18
    // stopped warning about that, which makes the flag a correctness note rather than a
    // console fix: the publishes above it are tab-wide and stay unconditional.
    let live = true
    fetchSystemStatus()
      .then((data) => {
        last = data
        setSnapshot(SYSTEM_SNAPSHOT, data)
        if (live) setStatus(data)
      })
      // A status the server would not answer leaves the environment out of the tooltip — an
      // unlabeled footer is honest, a stale or guessed environment label is not. Nothing to do,
      // but the handler must exist: an unhandled rejection in the shell is noise in every console.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const next = resolved === 'dark' ? 'light' : 'dark'
  // Audit item 39: this button writes an EXPLICIT choice, so a click while the stored
  // choice is System quietly ends "follow my system" — a preference the user set on
  // purpose, replaced by whatever the OS happened to be answering at that moment. The
  // toggle stays two-state (a three-state cycle through System is worse to operate under
  // the thumb): the abandonment is announced instead, and Undo puts System back. Only
  // when something was actually abandoned — every toggle toasting would be noise.
  const onToggleTheme = () => {
    const leavingSystem = theme === 'system'
    setTheme(next)
    if (leavingSystem) {
      toast.info(`Theme set to ${next} — no longer following your system`, {
        action: { label: 'Undo', onAction: () => setTheme('system') },
      })
    }
  }

  // `{email} · {environment} · build {hash}`; the environment only once the status answered — an
  // unlabeled footer is honest, a stale or guessed environment is not. Off production the address
  // wears the warn tint, and the tooltip says why: dev vs prod at a glance, with no pill to spend
  // height on (review, 2026-09-25).
  const nonProd = status !== null && status.environment !== 'prod'
  const environment = status === null ? null : nonProd ? `${status.environment} (not production)` : status.environment
  const identity = [email, environment, `build ${buildHash}`].filter(Boolean).join(' · ')
  const themeLabel = `Switch to ${next} theme`
  return (
    <div className="sidebar-footer">
      {email && (
        <span className={`sidebar-footer-email${nonProd ? ' is-nonprod' : ''}`} title={identity}>
          {email}
        </span>
      )}
      {/* Icons, each named for a screen reader and titled for a pointer. */}
      <button type="button" className="sidebar-footer-icon" onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
        {resolved === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      </button>
      <button type="button" className="sidebar-footer-icon" onClick={logout} aria-label="Log out" title="Log out">
        <LogOut size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
