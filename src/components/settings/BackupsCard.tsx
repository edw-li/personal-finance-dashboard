import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { createSnapshot, fetchSnapshots } from '../../api/lifecycle'
import { downloadSnapshot } from '../../api/system'
import type { SnapshotEntry } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Backups & snapshots (2026-09-03 data-lifecycle spec §8): the nightly logical snapshots on
 * the data volume — the restorable backup pg_dump cannot give the app — with "Snapshot now"
 * (the on-demand backup), the export download (moved here from the System card), and a
 * Restore… link per file that pre-selects it in the Restore card through the URL. The host's
 * encrypted dump stays described on the System card; this card is about what the app itself
 * can read back.
 */
export default function BackupsCard() {
  const [entries, setEntries] = useState<SnapshotEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One busy flag for the two writes: neither should start while the other is in flight.
  const [busy, setBusy] = useState<'snapshot' | 'download' | null>(null)
  // Its OWN slot, never `error`: a failed action must not hide a list that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const toast = useToast()

  // A plain function over stable setters, called from the effect and Retry (house idiom).
  const load = () => {
    const seq = ++seqRef.current
    fetchSnapshots()
      .then((list) => {
        if (seq !== seqRef.current) return
        setEntries(list)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load stored snapshots.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  const snapshotNow = () => {
    setBusy('snapshot')
    setActionError(null)
    createSnapshot()
      .then((entry) => {
        // The POST answers the entry, so the list updates without a second fetch.
        setEntries((current) => [entry, ...(current ?? []).filter((e) => e.name !== entry.name)])
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

  return (
    <section className="card span-6" id="backups" role="region" aria-label="Backups & snapshots">
      <h2 className="eyebrow">
        Backups &amp; snapshots
        <InfoHint text="Nightly at 23:30 PT the app writes its own export ZIP to the data volume and keeps the newest fourteen; each can be restored from the Restore card. Snapshot now writes one immediately. The host's encrypted database dump is separate and described on the System card." />
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
      <FeedBanner error={error} retry={load} retryLabel="Retry loading snapshots" />
      {entries === null && error === null && <p className="empty-note">Loading…</p>}
      {entries !== null && entries.length === 0 && (
        <p className="empty-note">
          No stored snapshots yet — the nightly job writes the first one at 23:30 PT.
        </p>
      )}
      {entries !== null && entries.length > 0 && (
        <ul className="backups-list">
          {entries.map((entry) => (
            <li key={entry.name} className="backups-row">
              <span className="system-mono">{entry.name}</span>
              <span className="settings-note">
                {formatDateTime(entry.at)} · {formatBytes(entry.size_bytes)}
                {entry.restorable ? '' : ' · different schema — not restorable here'}
              </span>
              {entry.restorable && (
                <Link className="button" to={`/settings?restore=${encodeURIComponent(entry.name)}#restore`}>
                  Restore…
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="settings-note">
        Newest fourteen kept. A restore writes a pre-restore point first, so the way back is
        always one more restore away.
      </p>
    </section>
  )
}
