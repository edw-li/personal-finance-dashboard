import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchCoverage } from '../../api/coverage'
import { fetchSystemStatus } from '../../api/system'
import type { BackupRun, CoverageOut, SystemStatus } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import { backupAge } from '../../utils/staleness'
import { freshnessClauses } from '../overview/freshness'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

// Module scope like SettingsPage's boxesFor: pure derivations off the payload, so the
// component's load chain stays a plain function with no reactive dependencies.

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

// Compact trail (spec §B3, reshaped 2026-09-13 spec §14 / audit S-8): the server stores 10 runs;
// the card lists the newest three, one per line, and counts the rest. Joined into one dd they
// wrapped to ten ragged lines in the half-width column.
const TRAIL_SHOWN = 3
function backupRunLines(runs: BackupRun[]): { lines: string[]; more: number } {
  return {
    lines: runs.slice(0, TRAIL_SHOWN).map((run) => `${formatDateTime(run.at)} ${run.ok ? 'ok' : 'failed'}`),
    more: Math.max(0, runs.length - TRAIL_SHOWN),
  }
}

function SystemFacts({ status, coverage }: { status: SystemStatus; coverage: CoverageOut }) {
  const backup = backupLine(status)
  const trail = backupRunLines(status.backup_runs ?? [])
  return (
    <dl className="system-facts">
      {/* The SAME sentences the Overview's Data status card prints, from the same pure module
          (components/overview/freshness.ts, honest-numbers spec §3, 2026-09-23 spec §T4): the
          balances by the day they describe, spending and take-home by the newest complete
          month and what is still to come. Two surfaces telling a reader different dates is
          precisely the dishonesty this program removes — so they share the rule, not just
          the wording. A feed with an overdue part wears this card's own amber, the one the
          backup row already uses. */}
      {/* List-valued facts are lists (audit S-8) and take BOTH columns of the facts grid. */}
      <div className="system-fact system-fact-wide">
        <dt>Data through</dt>
        <dd>
          <ul className="system-fact-list">
            {freshnessClauses(coverage).map((clause) => (
              <li key={clause.key} className={clause.lagging ? 'system-stale' : ''}>
                {clause.text}
              </li>
            ))}
          </ul>
        </dd>
      </div>
      <div className="system-fact">
        <dt>Last backup</dt>
        <dd>
          <span className={backup.className}>{backup.text}</span>
        </dd>
      </div>
      {/* 2026-09-23 spec §B4: the whole household database leaves the box every night — say
          it when it leaves in plain text. Only an explicit false: a marker an older script
          wrote carries no `encrypted` at all and says nothing either way. */}
      {status.backup?.encrypted === false && (
        <div className="system-fact system-fact-wide">
          <dt>Encryption</dt>
          <dd>
            <span className="system-warning">
              Off-box backups are not encrypted — set BACKUP_PASSPHRASE (README 5.3).
            </span>
          </dd>
        </div>
      )}
      <div className="system-fact system-fact-wide">
        <dt>Recent backups</dt>
        <dd>
          {trail.lines.length === 0 ? (
            '—'
          ) : (
            <ul className="system-fact-list">
              {trail.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {trail.more > 0 && <li className="system-fact-more">+{trail.more} more</li>}
            </ul>
          )}
        </dd>
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
        <dt>Build</dt>
        <dd className="system-mono">{__BUILD_HASH__}</dd>
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
 * each hand-entered feed reaches (2026-09-04 honest-numbers spec §3), the nightly-backup
 * marker with its verify verdict, database size and migration head. The four scheduler facts
 * moved to the Price refresh card (2026-09-06 spec §3.3), beside the cron that makes them.
 * Its own fetch and error state (the Up-next posture): a status hiccup must not dent the
 * settings forms, nor the reverse.
 */
export default function SystemCard() {
  const [snapshot, setSnapshot] = useState<{
    status: SystemStatus
    coverage: CoverageOut
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const load = (initial = false) => {
    const seq = ++seqRef.current
    const source = warmSource(initial)
    // All-or-nothing, the OverviewPage snapshot's contract: this card is ONE reading of
    // the system, and a freshness row standing on a coverage read that failed while the
    // rows beside it stand on a fresh status read would be a card of two instants.
    Promise.all([source(WARM.systemStatus, fetchSystemStatus), source(WARM.coverage, fetchCoverage)])
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
    load(true)
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  return (
    <section className="card span-12" id="system">
      <h2 className="eyebrow">
        System
        <InfoHint text="Operational status: the date each hand-entered feed reaches and what is due or overdue, the nightly backup marker recorded by the backup script — with whether last night's dump restored — and the database's size and migration head. The refresh schedule lives on the Price refresh card; snapshots and downloads on Backups." />
      </h2>
      <FeedBanner
        error={error}
        retry={() => {
          setLoading(true)
          load()
        }}
      />
      {snapshot === null
        ? loading && <SettingsGhost height={313} />
        : !error && <SystemFacts status={snapshot.status} coverage={snapshot.coverage} />}
    </section>
  )
}
