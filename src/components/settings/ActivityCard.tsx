import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchActivity, fetchActivityRun, undoBatch } from '../../api/lifecycle'
import type { ActivityEntry, ActivityRun, ActivityRunDetail, ImportReport, RestoreReport } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import ImportReportView from './ImportReportView'
import RestoreReportView from './RestoreReportView'
import '../panels.css'
import './settings.css'

const RUN_LABELS: Record<ActivityRun['kind'], string> = {
  import_xlsx: 'Import',
  restore: 'Restore',
  snapshot: 'Snapshot',
  restore_point: 'Restore point',
  undo: 'Undo',
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function runLine(run: ActivityRun): string {
  const parts = [RUN_LABELS[run.kind] ?? run.kind]
  if (run.dry_run) parts.push('dry run')
  if (!run.ok) parts.push('failed')
  if (run.filename) parts.push(run.filename)
  if (run.size_bytes != null) parts.push(formatBytes(run.size_bytes))
  return parts.join(' · ')
}

function ReportBody({ detail }: { detail: ActivityRunDetail }) {
  if (detail.report === null) return <p className="settings-note">No report was stored for this run.</p>
  if (detail.run.kind === 'import_xlsx') return <ImportReportView report={detail.report as unknown as ImportReport} />
  if (detail.run.kind === 'restore') return <RestoreReportView report={detail.report as unknown as RestoreReport} />
  return <pre className="activity-raw">{JSON.stringify(detail.report, null, 2)}</pre>
}

/**
 * Activity (2026-09-03 data-lifecycle spec §9): the change log and the run trail as one
 * feed, newest first — every money-bearing write with its label, source and Undo where the
 * server says it is cheap (arm on click, not typed: an undo is itself reversible), plus the
 * stored import and restore reports that used to evaporate with React state.
 */
export default function ActivityCard() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null) // the batch id whose Undo is armed
  const [detail, setDetail] = useState<ActivityRunDetail | null>(null)
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchActivity()
      .then((pageOut) => {
        if (seq !== seqRef.current) return
        setEntries(pageOut.entries)
        setNextBefore(pageOut.next_before)
        setError(null)
        setArmed(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load activity.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  const loadMore = () => {
    if (nextBefore === null) return
    setBusy(true)
    fetchActivity(nextBefore)
      .then((pageOut) => {
        setEntries((current) => [...(current ?? []), ...pageOut.entries])
        setNextBefore(pageOut.next_before)
      })
      .catch((err: unknown) => setError(message(err, 'Could not load more activity.')))
      .finally(() => setBusy(false))
  }

  const undo = (batchId: string, label: string) => {
    if (armed !== batchId) {
      setArmed(batchId) // first click arms; a click elsewhere disarms via load()
      return
    }
    setBusy(true)
    setError(null)
    undoBatch(batchId)
      .then(() => {
        toast.success(`Undone — ${label}`)
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Undo failed.')))
      .finally(() => setBusy(false))
  }

  const viewReport = (runId: number) => {
    setBusy(true)
    fetchActivityRun(runId)
      .then(setDetail)
      .catch((err: unknown) => setError(message(err, 'Could not load the report.')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6" id="activity" role="region" aria-label="Activity">
      <h2 className="eyebrow">
        Activity
        <InfoHint text="Every money-bearing change — month saves and deletes, account, category and budget edits, imports, restores, snapshots — newest first. Undo replays one change in reverse while nothing later touched the same rows; imports and restores are summaries and are undone by restoring a snapshot instead." />
      </h2>
      <FeedBanner error={error} retry={load} retryLabel="Retry loading activity" />
      {entries === null && error === null && <p className="empty-note">Loading…</p>}
      {entries !== null && entries.length === 0 && <p className="empty-note">Nothing recorded yet.</p>}
      {entries !== null && entries.length > 0 && (
        <ul className="activity-list">
          {entries.map((entry) =>
            entry.type === 'batch' ? (
              <li key={`b:${entry.batch_id}`} className="activity-row">
                <span className="settings-note">{formatDateTime(entry.at)}</span>
                <span className={`badge activity-source activity-source-${entry.source}`}>{entry.source}</span>
                <span className="activity-label">{entry.label}</span>
                {entry.undone_by !== null && <span className="settings-note">undone</span>}
                {entry.undoable && (
                  <button
                    type="button"
                    className={`button${armed === entry.batch_id ? ' danger-button' : ''}`}
                    disabled={busy}
                    onClick={() => undo(entry.batch_id, entry.label)}
                  >
                    {armed === entry.batch_id ? 'Undo?' : 'Undo'}
                  </button>
                )}
              </li>
            ) : (
              <li key={`r:${entry.run_id}`} className="activity-row">
                <span className="settings-note">{formatDateTime(entry.at)}</span>
                <span className={`badge activity-source activity-source-run${entry.ok ? '' : ' is-failed'}`}>run</span>
                <span className="activity-label">{runLine(entry)}</span>
                {entry.has_report && (
                  <button type="button" className="button" disabled={busy} onClick={() => viewReport(entry.run_id)}>
                    View report
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {nextBefore !== null && (
        <button type="button" className="button" disabled={busy} onClick={loadMore}>
          Load more
        </button>
      )}
      {detail !== null && (
        <div className="activity-report">
          <div className="settings-card-actions">
            <span className="eyebrow">{runLine(detail.run)}</span>
            <button type="button" className="button" onClick={() => setDetail(null)}>
              Close report
            </button>
          </div>
          <ReportBody detail={detail} />
        </div>
      )}
    </section>
  )
}
