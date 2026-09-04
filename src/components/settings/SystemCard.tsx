import { Fragment, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchCoverage } from '../../api/coverage'
import { fetchSystemStatus } from '../../api/system'
import type { BackupRun, CoverageOut, RefreshRun, SystemStatus } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import { backupAge } from '../../utils/staleness'
import { freshnessClauses } from '../overview/freshness'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
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

// The marker's words (2026-09-03 data-lifecycle spec §8): stamp · size · encrypted · verified,
// or "· not verified — <reason>" in the overdue tone. size_bytes (the verify-phase script)
// wins over the older du -h string; both parse, because every new field is optional.
function backupLine(status: SystemStatus): { text: string; className: string } {
  if (status.backup === null) {
    // The permanent, unremarkable state on a dev box — said plainly. The prod-only
    // nagging lives on the Overview strip (attention.ts), never here.
    return { text: 'No backup recorded', className: '' }
  }
  const backup = status.backup
  const parts = [
    formatDateTime(backup.last_success_at),
    backup.size_bytes != null ? formatBytes(backup.size_bytes) : backup.size,
  ]
  if (backup.encrypted === true) parts.push('encrypted')
  let className = ''
  if (backup.verified === true) {
    parts.push('verified')
  } else if (backup.verified === false) {
    parts.push(`not verified — ${backup.verify_error ?? 'no reason recorded'}`)
    className = 'system-overdue'
  }
  let text = parts.join(' · ')
  const age = backupAge(backup.last_success_at)
  if (age === 'overdue') {
    // Past seven days the WORDING changes too (spec §3) — colour is never the only channel.
    text += ' — more than a week old'
    className = 'system-overdue'
  } else if (age === 'stale' && className === '') {
    className = 'system-stale'
  }
  return { text, className }
}

// Compact last-5 trails (spec §B3): one line each, newest first — the server stores 10,
// the card shows what fits on a line. '—' is the empty state, matching the alembic row.
function backupRunsLine(runs: BackupRun[]): string {
  if (runs.length === 0) return '—'
  return runs
    .slice(0, 5)
    .map((run) => `${formatDateTime(run.at)} ${run.ok ? 'ok' : 'failed'}`)
    .join(' · ')
}

function refreshRunsLine(runs: RefreshRun[]): string {
  if (runs.length === 0) return '—'
  return runs
    .slice(0, 5)
    .map(
      (run) =>
        `${formatDateTime(run.at)} ${run.updated} updated${
          run.failed_count > 0 ? `, ${run.failed_count} failed` : ''
        }`,
    )
    .join(' · ')
}

function SystemFacts({ status, coverage }: { status: SystemStatus; coverage: CoverageOut }) {
  const backup = backupLine(status)
  return (
    <dl className="system-facts">
      {/* The SAME sentence the Overview footer prints, from the same pure module
          (components/overview/freshness.ts, honest-numbers spec §3): one clause per
          hand-entered feed on the month it actually has, and the spending clause naming
          what the window is still waiting for. Two surfaces telling a reader different
          months is precisely the dishonesty this program removes — so they share the
          rule, not just the wording. A feed a month or more behind the balances wears
          this card's own amber, the one the backup row already uses. */}
      <div className="system-fact">
        <dt>Data through</dt>
        <dd>
          {freshnessClauses(coverage).map((clause, i) => (
            <Fragment key={clause.key}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <span className={clause.lagging ? 'system-stale' : ''}>{clause.text}</span>
            </Fragment>
          ))}
        </dd>
      </div>
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
        <dt>Recent refreshes</dt>
        <dd>{refreshRunsLine(status.refresh_runs ?? [])}</dd>
      </div>
      <div className="system-fact">
        <dt>Last backup</dt>
        <dd>
          <span className={backup.className}>{backup.text}</span>
        </dd>
      </div>
      <div className="system-fact">
        <dt>Recent backups</dt>
        <dd>{backupRunsLine(status.backup_runs ?? [])}</dd>
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
 * The Settings System card (2026-08-25 spec §3): read-only operational facts — which month
 * each hand-entered feed reaches (2026-09-04 honest-numbers spec §3), the last
 * refresh run and its schedule, the nightly-backup marker with its verify verdict,
 * database size and migration
 * head. Its own fetch and error state (the Up-next posture): a status hiccup must not
 * dent the settings forms, nor the reverse.
 */
export default function SystemCard() {
  const [snapshot, setSnapshot] = useState<{
    status: SystemStatus
    coverage: CoverageOut
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const load = () => {
    const seq = ++seqRef.current
    // All-or-nothing, the OverviewPage snapshot's contract: this card is ONE reading of
    // the system, and a freshness row standing on a coverage read that failed while the
    // rows beside it stand on a fresh status read would be a card of two instants.
    Promise.all([fetchSystemStatus(), fetchCoverage()])
      .then(([status, coverage]) => {
        if (seq !== seqRef.current) return
        setSnapshot({ status, coverage })
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
    <section className="card span-12" id="system">
      <h2 className="eyebrow">
        System
        <InfoHint text="Operational status: which month each hand-entered feed reaches, the last price refresh and its schedule, the nightly backup marker recorded by the backup script — with whether last night's dump restored — and the database's size and migration head. Snapshots and downloads live on the Backups card." />
      </h2>
      <FeedBanner
        error={error}
        retry={() => {
          setLoading(true)
          load()
        }}
      />
      {snapshot === null
        ? loading && <p className="empty-note">Loading…</p>
        : !error && <SystemFacts status={snapshot.status} coverage={snapshot.coverage} />}
    </section>
  )
}
