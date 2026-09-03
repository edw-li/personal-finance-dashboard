import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchSnapshots, restoreStored, restoreUpload } from '../../api/lifecycle'
import type { RestoreReport, SnapshotEntry } from '../../types/api'
import { formatBytes, formatDateTime, formatInstantDate, localDateKey } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import { useArrivalValue } from '../useArrivalParam'
import RestoreReportView from './RestoreReportView'
import '../panels.css'
import './settings.css'

// What is being restored: a file the user picked, or a stored nightly by name. Exactly one.
type Source = { kind: 'file'; file: File } | { kind: 'stored'; name: string }

// A report describes exactly ONE source, so it is held WITH the source it was run for. The
// arm reads a date off the report and the apply sends the SELECTION: if those two could
// ever disagree — a slow dry run of A landing after the selection moved to B — the confirm
// would name A's date and the request would replace the database from B, never dry-run.
type Reported = { source: Source; report: RestoreReport }

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Restore (2026-09-03 data-lifecycle spec §7): file picker or a stored snapshot, Dry run into
 * the shared report view, then Restore — armed ONLY by a clean dry run of the current
 * selection (compatible schema, no errors) plus the snapshot's date typed out (the month-
 * delete arm pattern). The server's sentences (400/409/413/422/500) render verbatim; success
 * toasts and the applied report names the restore point.
 */
export default function RestoreCard() {
  const [stored, setStored] = useState<SnapshotEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [reported, setReported] = useState<Reported | null>(null)
  const [busy, setBusy] = useState<'dry' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armText, setArmText] = useState('')
  const seqRef = useRef(0)
  // The runs have a sequence of their own: `load`'s guards the LIST, and a result must be
  // dropped when it is no longer the newest run of the card, not the newest fetch.
  const runSeqRef = useRef(0)
  // The one arrival name this card has already looked the list up for (below).
  const lookedUpRef = useRef<string | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const focusReportRef = useRef(false)
  const toast = useToast()

  // The house's load recipe (inline chain, seqRef), but memoized: the arrival callback
  // below calls it too, and a fresh identity every render would make that callback fresh
  // as well — which useArrivalValue's contract forbids. Nothing but module imports, a ref
  // and setters is captured, so the empty dependency list is the honest one.
  const load = useCallback(() => {
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
  }, [])

  useEffect(() => {
    load()
    // once: `load` is stable (house idiom, memoized above)
  }, [load])

  // A report describes exactly ONE source. Any change of selection drops it and the arm.
  const pick = (next: Source | null) => {
    setSource(next)
    setReported(null)
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
        // A run in flight OWNS the card: its report is about the current selection, and
        // the Backups card's links stay live throughout. Moving the selection now would
        // hand the landing report to the wrong file, so the command is refused — consumed
        // rather than held, or it would fire the moment the run ended, which is exactly
        // when the reader is reading the report it would silently discard.
        if (busy !== null) return true
        if (stored === null) return false
        if (!stored.some((entry) => entry.name === name && entry.restorable)) {
          // The Backups card fetches its own copy of this list and "Snapshot now" only
          // updates THAT one, so the newest file is unknown here until we look again.
          // One re-look per name, then the answer stands: unknown against a FRESH list is
          // not a snapshot this card can offer, and the param must not loop forever.
          if (lookedUpRef.current === name) return true
          lookedUpRef.current = name
          load()
          return false
        }
        setSource({ kind: 'stored', name })
        setReported(null)
        setError(null)
        setArmText('')
        return true
      },
      [stored, busy, load],
    ),
  )

  const run = (dryRun: boolean) => {
    // Captured, not read back later: this request is about THIS source whatever happens
    // to the selection while it is in flight.
    const target = source
    if (target === null) return
    const seq = ++runSeqRef.current
    setBusy(dryRun ? 'dry' : 'apply')
    setError(null)
    const request =
      target.kind === 'file' ? restoreUpload(target.file, dryRun) : restoreStored(target.name, dryRun)
    request
      .then((result) => {
        if (seq !== runSeqRef.current) return
        setReported({ source: target, report: result })
        if (result.applied) {
          setArmText('')
          // Focus is moved in the effect below, once the applied report is on the page.
          focusReportRef.current = true
          const when =
            result.exported_at === null
              ? 'snapshot'
              : `snapshot from ${formatInstantDate(result.exported_at)}`
          // The /import mutation path already invalidated every page snapshot (client.ts).
          toast.success(`Restored ${when} — other pages reload on their next visit`)
        }
      })
      .catch((err: unknown) => {
        if (seq !== runSeqRef.current) return
        // Verbatim: the router's 400/409/413/422/500 sentences are the whole explanation.
        setError(message(err, 'Restore failed — is the server reachable?'))
        // A failed APPLY leaves a database nobody has dry-run; the standing report described
        // the one before. A failed dry run wrote nothing and the older report still holds.
        if (!dryRun) setReported(null)
      })
      .finally(() => {
        // The newest run owns the busy flag; a superseded one must not free the card.
        if (seq === runSeqRef.current) setBusy(null)
      })
  }

  useEffect(() => {
    // After an apply the arm input leaves the tree and its button goes dead, so focus
    // would fall to <body> — the keyboard reader's place in the page lost at the one
    // moment there is something new to read. Here rather than in the continuation because
    // the applied report has to be on the page before it can be read out.
    if (!focusReportRef.current) return
    focusReportRef.current = false
    reportRef.current?.focus()
  }, [reported])

  // The report this card may act on: never one about a source that is no longer selected.
  const report = reported !== null && reported.source === source ? reported.report : null
  // The snapshot's day on the LOCAL clock — the one the select's own rows are written on
  // (formatDateTime). The stamp's text is UTC, so the 23:30 PT nightly listed as "Sep 3,
  // 11:30 PM" would otherwise demand "2026-09-04" here.
  const snapshotDate = report === null ? null : localDateKey(report.exported_at)
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
      `Restore the snapshot from ${formatInstantDate(report.exported_at)}? A restore point of ` +
        'the current database is written first (kept with the last three), then every exported ' +
        'table is replaced. Other pages reload on their next visit.',
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
            // Keyed on the STORED selection, so choosing one remounts an empty picker: an
            // uncontrolled file input keeps its filename otherwise, and the box would go
            // on naming a file the card is no longer holding. NOT keyed on "is a file
            // selected" — that flips the instant a file is picked, wiping the box the
            // reader just filled.
            key={source?.kind === 'stored' ? source.name : 'no-stored'}
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
      {report !== null && (
        // Focusable, not a tab stop: the wrapper is where focus lands when an apply
        // finishes (the effect above). Bare, so it changes no layout of its own.
        <div ref={reportRef} tabIndex={-1}>
          <RestoreReportView report={report} />
        </div>
      )}
      {/* One row, always present, so the state is legible: a disabled Restore says "dry-run
          first" as plainly as the armed one says "type the date". The BUTTON is the same
          element on both sides of that toggle — two branches would remount it and drop
          focus mid-flow. */}
      <div className="restore-arm">
        {armable && (
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
        )}
        <button
          type="button"
          className="button danger-button"
          disabled={!canRestore}
          onClick={restore}
        >
          {busy === 'apply' ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </section>
  )
}
