import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { createSnapshot, fetchRestorePoints, fetchSnapshots } from '../../api/lifecycle'
import { downloadSnapshot, downloadStoredSnapshot } from '../../api/system'
import type { SnapshotEntry } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import '../panels.css'
import { restoreHref } from './restorePoints'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** One stored file: WHEN leads, on the reader's clock; the UTC file name is the secondary line
 *  (2026-09-23 spec §B3 — "finance-export-20260922…" beside "Sep 21, 11:30 PM" read as two
 *  different days). Download serves the file byte for byte; Restore… hands it to the Restore
 *  card through the URL, and only a file at this server's schema is offered that. */
function EntryRow({
  entry,
  noun,
  busy,
  onDownload,
}: {
  entry: SnapshotEntry
  noun: string
  busy: boolean
  onDownload: () => void
}) {
  const when = formatDateTime(entry.at)
  return (
    <li className="backups-row">
      <span className="backups-when">{when}</span>
      <span className="settings-note">
        <span className="system-mono">{entry.name}</span> · {formatBytes(entry.size_bytes)}
        {entry.restorable ? '' : ' · different schema — not restorable here'}
      </span>
      <span className="backups-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-label={`Download the ${noun} from ${when}`}
          onClick={onDownload}
        >
          {busy ? 'Preparing…' : 'Download'}
        </button>
        {entry.restorable && (
          <Link className="button" to={restoreHref(entry.name)}>
            Restore…
          </Link>
        )}
      </span>
    </li>
  )
}

/**
 * Backups & snapshots (2026-09-03 data-lifecycle spec §8): the nightly logical snapshots on
 * the data volume — the restorable backup pg_dump cannot give the app — with "Snapshot now"
 * (the on-demand backup), the export download (moved here from the System card), and a
 * Restore… link per file that pre-selects it in the Restore card through the URL. Since
 * 2026-09-23 (spec §B3) the restore points every restore and import saves first are listed
 * too, under their own heading, and every stored file can be downloaded. The host's encrypted
 * dump stays described on the System card; this card is about what the app itself can read back.
 * `revision` is the page's word that a restore or an import has just written a restore point:
 * each change reads the volume again, so the new point is listed without a reload.
 */
export default function BackupsCard({ revision = 0 }: { revision?: number } = {}) {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[] | null>(null)
  const [points, setPoints] = useState<SnapshotEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One busy flag for the two card-level writes: neither should start while the other is in flight.
  const [busy, setBusy] = useState<'snapshot' | 'download' | null>(null)
  // Which stored files' downloads are in flight — each row goes busy on its own, and a second
  // download neither frees nor is freed by the first (2026-09-23 lane B1 review, M7).
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(() => new Set())
  // Its OWN slot, never `error`: a failed action must not hide a list that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const toast = useToast()

  // A plain function over stable setters, called from the effect and Retry (house idiom). Both
  // lists in one reading: they describe one volume, and a card of two instants would be a lie.
  const load = (initial = false) => {
    const seq = ++seqRef.current
    const source = warmSource(initial)
    Promise.all([
      source(WARM.snapshots, fetchSnapshots),
      source(WARM.restorePoints, fetchRestorePoints),
    ])
      .then(([nextSnapshots, nextPoints]) => {
        if (seq !== seqRef.current) return
        setSnapshots(nextSnapshots)
        setPoints(nextPoints)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load stored snapshots.'))
      })
  }

  useEffect(() => {
    load(true)
    // mount-only (house idiom)
  }, [])

  // The mount load above is the first reading, so the revision it mounted with is not fetched
  // twice; every later one is a restore point written elsewhere on the page (spec §B3).
  const readRevision = useRef(revision)
  useEffect(() => {
    if (revision === readRevision.current) return
    readRevision.current = revision
    load()
    // `load` is a plain function over stable setters (house idiom): the revision is the trigger.
  }, [revision])

  const snapshotNow = () => {
    setBusy('snapshot')
    setActionError(null)
    createSnapshot()
      .then((entry) => {
        // The POST answers the entry, so the list updates without a second fetch.
        setSnapshots((current) => [entry, ...(current ?? []).filter((e) => e.name !== entry.name)])
        toast.success(`Snapshot written — ${entry.name}`)
      })
      .catch((err: unknown) => setActionError(message(err, 'Snapshot failed.')))
      .finally(() => setBusy(null))
  }

  const download = () => {
    setBusy('download')
    setActionError(null)
    downloadSnapshot()
      .catch((err: unknown) => setActionError(message(err, 'Export failed.')))
      .finally(() => setBusy(null))
  }

  const downloadFile = (name: string) => {
    setDownloading((current) => new Set(current).add(name))
    setActionError(null)
    downloadStoredSnapshot(name)
      .catch((err: unknown) => setActionError(message(err, 'Download failed.')))
      .finally(() =>
        setDownloading((current) => {
          const next = new Set(current)
          next.delete(name)
          return next
        }),
      )
  }

  const row = (entry: SnapshotEntry, noun: string) => (
    <EntryRow
      key={entry.name}
      entry={entry}
      noun={noun}
      busy={downloading.has(entry.name)}
      onDownload={() => downloadFile(entry.name)}
    />
  )

  return (
    <section className="card span-12" id="backups" role="region" aria-label="Backups & snapshots">
      <h2 className="eyebrow">
        Backups &amp; snapshots
        <InfoHint text="Nightly at 23:30 PT the app writes its own export ZIP to the data volume and keeps the newest fourteen; each can be restored from the Restore card. Snapshot now writes one immediately. Every restore and import first saves a restore point of the data it replaces — download it or restore it here. The host's database dump is separate and described on the System card." />
      </h2>
      <div className="settings-card-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy !== null}
          onClick={snapshotNow}
        >
          {busy === 'snapshot' ? 'Writing…' : 'Snapshot now'}
        </button>
        <button type="button" className="button" disabled={busy !== null} onClick={download}>
          {busy === 'download' ? 'Preparing…' : 'Download snapshot (.zip)'}
        </button>
      </div>
      <FeedBanner error={actionError} />
      <FeedBanner error={error} retry={() => load()} retryLabel="Retry loading snapshots" />
      {snapshots === null && error === null && <SettingsGhost height={313} />}
      {snapshots !== null && (
        <>
          <h3 className="eyebrow backups-heading">Snapshots</h3>
          {snapshots.length === 0 ? (
            <p className="empty-note">
              No stored snapshots yet — the nightly job writes the first one at 23:30 PT.
            </p>
          ) : (
            <ul className="backups-list">{snapshots.map((entry) => row(entry, 'snapshot'))}</ul>
          )}
        </>
      )}
      {points !== null && (
        <>
          <h3 className="eyebrow backups-heading">
            Restore points (saved before a restore or import)
          </h3>
          {points.length === 0 ? (
            <p className="empty-note">
              No restore points yet — one is saved automatically before every restore or import.
            </p>
          ) : (
            <ul className="backups-list">{points.map((entry) => row(entry, 'restore point'))}</ul>
          )}
        </>
      )}
      <p className="settings-note">
        Newest fourteen snapshots kept. Every restore and import first saves a restore point of
        the data it replaces (the newest three are kept) — restoring one is the way back.
      </p>
    </section>
  )
}
