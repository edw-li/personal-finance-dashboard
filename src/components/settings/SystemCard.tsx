import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchSystemStatus } from '../../api/system'
import type { SystemStatus } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import { backupAge } from '../../utils/staleness'
import InfoHint from '../InfoHint'
import '../panels.css'
import './settings.css'

// Module scope like SettingsPage's boxesFor: pure derivations off the payload, so the
// component's load chain stays a plain function with no reactive dependencies.

function refreshLine(status: SystemStatus): string {
  const last = status.prices.last
  if (last === null) return 'No refresh recorded yet'
  const failedCount = Object.keys(last.failed).length
  // PortfolioPage's refresh-status-line vocabulary — same stored run, same sentence.
  return `${formatDateTime(last.at)} (${last.trigger}) · ${last.updated} updated${
    failedCount > 0 ? ` · ${failedCount} failed` : ''
  }`
}

function backupLine(status: SystemStatus): { text: string; className: string } {
  if (status.backup === null) {
    // The permanent, unremarkable state on a dev box — said plainly. The prod-only
    // nagging lives on the Overview strip (attention.ts), never here.
    return { text: 'No backup recorded', className: '' }
  }
  const stamp = `${formatDateTime(status.backup.last_success_at)} (${status.backup.size})`
  const age = backupAge(status.backup.last_success_at)
  if (age === 'overdue') {
    // Past seven days the WORDING changes too (spec §3) — colour is never the only channel.
    return { text: `${stamp} — more than a week old`, className: 'system-overdue' }
  }
  return { text: stamp, className: age === 'stale' ? 'system-stale' : '' }
}

function SystemFacts({ status }: { status: SystemStatus }) {
  const backup = backupLine(status)
  return (
    <dl className="system-facts">
      <div className="system-fact">
        <dt>Last price refresh</dt>
        <dd>{refreshLine(status)}</dd>
      </div>
      <div className="system-fact">
        <dt>Next scheduled run</dt>
        <dd>
          {status.prices.next_run_at ? formatDateTime(status.prices.next_run_at) : 'Not scheduled'}
        </dd>
      </div>
      <div className="system-fact">
        <dt>Scheduler</dt>
        <dd>{status.prices.scheduler_running ? 'Running' : 'Not running'}</dd>
      </div>
      <div className="system-fact">
        <dt>Last backup</dt>
        <dd className={backup.className}>{backup.text}</dd>
      </div>
      <div className="system-fact">
        <dt>Database size</dt>
        <dd>{formatBytes(status.database.size_bytes)}</dd>
      </div>
      <div className="system-fact">
        <dt>Alembic head</dt>
        <dd className="system-mono">{status.database.alembic_head ?? '—'}</dd>
      </div>
      <div className="system-fact">
        <dt>Environment</dt>
        <dd className="system-mono">{status.environment}</dd>
      </div>
    </dl>
  )
}

/**
 * The Settings System card (2026-08-25 spec §3): read-only operational facts — the last
 * refresh run and its schedule, the nightly-backup marker, database size and migration
 * head. Its own fetch and error state (the Up-next posture): a status hiccup must not
 * dent the settings forms, nor the reverse.
 */
export default function SystemCard() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const load = () => {
    const seq = ++seqRef.current
    fetchSystemStatus()
      .then((s) => {
        if (seq !== seqRef.current) return
        setStatus(s)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load system status.')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        System
        <InfoHint text="Operational status: the last price refresh and its schedule, the nightly backup marker recorded by the backup script, and the database's size and migration head." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="button"
            onClick={() => {
              setLoading(true)
              load()
            }}
          >
            Retry
          </button>
        </div>
      )}
      {status === null
        ? loading && <p className="empty-note">Loading…</p>
        : !error && <SystemFacts status={status} />}
    </section>
  )
}
