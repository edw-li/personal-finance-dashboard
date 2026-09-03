import { LogOut, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import { fetchSystemStatus } from '../../api/system'
import { useAuth } from '../../contexts/AuthContext'
import type { SystemStatus } from '../../types/api'
import { useTheme } from './ThemeProvider'
import './shell.css'

// Shared with Layout's ShellErrorBoundary, which reads the last answer back out of the
// snapshot cache for Copy details — the footer is the only fetcher, so the boundary can
// name the environment and the alembic head without a request of its own.
export const SYSTEM_SNAPSHOT = 'shell:system'

// Identity and environment at the bottom of the sidebar (2026-09-03 shell spec §12): who is
// signed in, which deployment this is, which build — so two tabs (dev vs prod) can never be
// confused — plus a one-click theme toggle and Log out.
export default function SidebarFooter({ buildHash }: { buildHash: string }) {
  const { email, logout } = useAuth()
  const { resolved, setTheme } = useTheme()
  // Seeded from the cache so a remount (logout/login, a StrictMode double-mount) shows the
  // pill immediately instead of blinking it back in; the fetch below revalidates anyway.
  const [status, setStatus] = useState<SystemStatus | null>(
    () => getSnapshot<SystemStatus>(SYSTEM_SNAPSHOT) ?? null,
  )
  useEffect(() => {
    fetchSystemStatus()
      .then((data) => {
        setSnapshot(SYSTEM_SNAPSHOT, data)
        setStatus(data)
      })
      // A status the server would not answer leaves the pill hidden — an unlabeled footer
      // is honest, a stale or guessed environment label is not.
      .catch(() => setStatus((current) => current))
  }, [])

  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    <div className="sidebar-footer">
      <div className="sidebar-footer-row">
        {email && <span className="sidebar-footer-email" title={email}>{email}</span>}
      </div>
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
