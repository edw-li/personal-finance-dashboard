import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchSnapshots, restoreStored, restoreUpload } from '../../api/lifecycle'
import type { RestoreReport, SnapshotEntry } from '../../types/api'
import { formatBytes, formatDate, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import { useArrivalValue } from '../useArrivalParam'
import RestoreReportView from './RestoreReportView'
import '../panels.css'
import './settings.css'

// What is being restored: a file the user picked, or a stored nightly by name. Exactly one.
type Source = { kind: 'file'; file: File } | { kind: 'stored'; name: string }

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Restore (2026-09-03 data-lifecycle spec §7): file picker or a stored snapshot, Dry run into
 * the shared report view, then Restore — armed ONLY by a clean dry run of the current
 * selection (compatible schema, no errors) plus the snapshot's date typed out (the month-
 * delete arm pattern). The server's sentences (400/409/422/500) render verbatim; success
 * toasts and the applied report names the restore point.
 */
export default function RestoreCard() {
  const [stored, setStored] = useState<SnapshotEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [report, setReport] = useState<RestoreReport | null>(null)
  const [busy, setBusy] = useState<'dry' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armText, setArmText] = useState('')
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchSnapshots()
      .then((list) => {
        if (seq !== seqRef.current) return
        setStored(list)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(message(err, 'Could not load stored snapshots.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  // A report describes exactly ONE source. Any change of selection drops it and the arm.
  const pick = (next: Source | null) => {
    setSource(next)
    setReport(null)
    setError(null)
    setArmText('')
  }

  // ?restore=<name> from the Backups card's Restore… link: pre-select once the list has
  // landed (returning false keeps the param until it has), then the hook strips the param.
  // The setters are spelled out rather than calling `pick`: a component-scope helper is a
  // fresh identity every render, so useCallback would owe it a dependency and re-run this
  // on every render — useState setters are stable and exhaustive-deps knows it.
  useArrivalValue(
    'restore',
    useCallback(
      (name: string) => {
        if (stored === null) return false
        if (stored.some((entry) => entry.name === name && entry.restorable)) {
          setSource({ kind: 'stored', name })
          setReport(null)
          setError(null)
          setArmText('')
        }
        return true
      },
      [stored],
    ),
  )

  const run = (dryRun: boolean) => {
    if (source === null) return
    setBusy(dryRun ? 'dry' : 'apply')
    setError(null)
    const request =
      source.kind === 'file' ? restoreUpload(source.file, dryRun) : restoreStored(source.name, dryRun)
    request
      .then((result) => {
        setReport(result)
        if (result.applied) {
          setArmText('')
          const when =
            result.exported_at === null ? 'snapshot' : `snapshot from ${formatDate(result.exported_at)}`
          // The /import mutation path already invalidated every page snapshot (client.ts).
          toast.success(`Restored ${when} — other pages reload on their next visit`)
        }
      })
      .catch((err: unknown) => {
        // Verbatim: the router's 400/409/422/500 sentences are the whole explanation.
        setError(message(err, 'Restore failed — is the server reachable?'))
        // A failed APPLY leaves a database nobody has dry-run; the standing report described
        // the one before. A failed dry run wrote nothing and the older report still holds.
        if (!dryRun) setReport(null)
      })
      .finally(() => setBusy(null))
  }

  const snapshotDate =
    report === null || report.exported_at === null ? null : report.exported_at.slice(0, 10)
  // The arm input appears after a dry run of the current selection that named a date — a
  // report whose schema is incompatible (or that carries errors) still gets the box, with
  // the button dead beside it: "this is what would arm it, and why it will not".
  const armable = report !== null && report.dry_run && snapshotDate !== null
  const canRestore =
    source !== null &&
    report !== null &&
    report.dry_run &&
    report.errors.length === 0 &&
    report.schema.compatible &&
    snapshotDate !== null &&
    armText.trim() === snapshotDate &&
    busy === null

  const restore = () => {
    if (!canRestore || report === null || report.exported_at === null) return
    const ok = window.confirm(
      `Restore the snapshot from ${formatDate(report.exported_at)}? A restore point of the current ` +
        'database is written first (kept with the last three), then every exported table is ' +
        'replaced. Other pages reload on their next visit.',
    )
    if (!ok) return
    run(false)
  }

  const restorable = (stored ?? []).filter((entry) => entry.restorable)

  return (
    <section className="card span-6" id="restore" role="region" aria-label="Restore">
      <h2 className="eyebrow">
        Restore
        <InfoHint text="Replaces every exported table from a snapshot ZIP — one this app wrote, at this server's schema. Dry run shows what would change and writes nothing. Restore first writes a pre-restore point, so the step back is one more restore. Your login, the operational trails and this server's backup markers are never touched." />
      </h2>
      <div className="restore-source">
        <label>
          Snapshot file (.zip)
          <input
            className="field-input"
            type="file"
            accept=".zip"
            aria-label="Snapshot file (.zip)"
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              pick(file === null ? null : { kind: 'file', file })
            }}
          />
        </label>
        <label>
          Stored snapshot
          <select
            className="field-input"
            aria-label="Stored snapshot"
            disabled={busy !== null}
            value={source?.kind === 'stored' ? source.name : ''}
            onChange={(e) => pick(e.target.value === '' ? null : { kind: 'stored', name: e.target.value })}
          >
            <option value="">Choose a stored snapshot…</option>
            {restorable.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {formatDateTime(entry.at)} · {formatBytes(entry.size_bytes)} · {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FeedBanner error={loadError} retry={load} retryLabel="Retry loading stored snapshots" />
      <div className="settings-card-actions">
        <button
          type="button"
          className="button"
          disabled={source === null || busy !== null}
          onClick={() => run(true)}
        >
          {busy === 'dry' ? 'Dry run…' : 'Dry run'}
        </button>
      </div>
      <FeedBanner error={error} />
      {report !== null && <RestoreReportView report={report} />}
      {armable ? (
        <div className="restore-arm">
          <label>
            Type the snapshot&apos;s date (YYYY-MM-DD) to confirm
            <input
              className="field-input"
              type="text"
              aria-label="Type the snapshot's date (YYYY-MM-DD) to confirm"
              value={armText}
              placeholder={snapshotDate ?? undefined}
              disabled={busy !== null}
              onChange={(e) => setArmText(e.target.value)}
            />
          </label>
          <button type="button" className="button danger-button" disabled={!canRestore} onClick={restore}>
            {busy === 'apply' ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      ) : (
        // Always present, so the state is legible: a disabled Restore says "dry-run first".
        <div className="restore-arm">
          <button type="button" className="button danger-button" disabled>
            Restore
          </button>
        </div>
      )}
    </section>
  )
}
