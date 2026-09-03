import { LogOut, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import { fetchSystemStatus } from '../../api/system'
import { useAuth } from '../../contexts/AuthContext'
import type { SystemStatus } from '../../types/api'
import { useTheme } from './ThemeProvider'
import './shell.css'

// The footer is the only fetcher of /system/status in the shell, so it publishes what it
// learned twice, for two different lifetimes:
//
//   SYSTEM_SNAPSHOT — the page-snapshot cache, which api() wipes after ANY non-GET and
//   logout wipes entirely. Right for seeding the pill on a remount inside one session.
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

// Identity and environment at the bottom of the sidebar (2026-09-03 shell spec §12): who is
// signed in, which deployment this is, which build — so two tabs (dev vs prod) can never be
// confused — plus a one-click theme toggle and Log out.
export default function SidebarFooter({ buildHash }: { buildHash: string }) {
  const { email, logout } = useAuth()
  const { resolved, setTheme } = useTheme()
  // Seeded from the cache so a remount WITHIN a session (a StrictMode double-mount, a shell
  // re-render) shows the pill immediately instead of blinking it back in. Not after a
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
      // A status the server would not answer leaves the pill hidden — an unlabeled footer
      // is honest, a stale or guessed environment label is not. Nothing to do, but the
      // handler must exist: an unhandled rejection in the shell is noise in every console.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    <div className="sidebar-footer">
      {/* The row, not just the address, is conditional: an email-less footer (the context
          still loading) would otherwise keep an empty row's gap above the pill. */}
      {email && (
        <div className="sidebar-footer-row">
          <span className="sidebar-footer-email" title={email}>{email}</span>
        </div>
      )}
      <div className="sidebar-footer-row">
        {status !== null && (
          <span className={`sidebar-footer-pill${status.environment === 'dev' ? ' is-dev' : ''}`}>
            {status.environment}
          </span>
        )}
        {/* alembic_head is nullable (a create_all-built schema has none) — no tooltip at
            all beats a tooltip that reads "alembic null". */}
        <span
          className="sidebar-footer-hash"
          title={status?.database.alembic_head ? `alembic ${status.database.alembic_head}` : undefined}
        >
          {buildHash}
        </span>
      </div>
      <button type="button" className="sidebar-footer-icon" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`}>
        {resolved === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        <span>{resolved === 'dark' ? 'Light theme' : 'Dark theme'}</span>
      </button>
      <button type="button" className="sidebar-footer-icon" onClick={logout}>
        <LogOut size={16} aria-hidden="true" />
        <span>Log out</span>
      </button>
    </div>
  )
}
