import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import { fetchSystemStatus } from '../../api/system'
import type { SystemStatus } from '../../types/api'
import { formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { usePriceRefresh } from '../usePriceRefresh'
import '../panels.css'
import './settings.css'

// The four scheduler facts, moved off the System card (spec §3.3) — the same sentences,
// printed beside the schedule that produces them.
function refreshLine(status: SystemStatus): string {
  const last = status.prices.last
  if (last === null) return 'No refresh recorded yet'
  const failedCount = Object.keys(last.failed).length
  return `${formatDateTime(last.at)} (${last.trigger}) · ${last.updated} updated${
    failedCount > 0 ? ` · ${failedCount} failed` : ''
  }`
}

function refreshRunsLine(status: SystemStatus): string {
  const runs = status.refresh_runs ?? []
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

/**
 * Price refresh (2026-09-06 spec §3.3): the cron the scheduler runs on, the four facts about
 * what it has been doing, and the manual door. ONE read answers all of it — `/system/status`'s
 * `prices` block IS `/prices/refresh-status` plus `scheduler_running` (SystemPricesStatus
 * extends RefreshStatus), so a second endpoint would only be a second clock to disagree with.
 */
export default function PriceRefreshCard() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [cronBox, setCronBox] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)
  const { refreshing, note, error: refreshError, refresh } = usePriceRefresh()

  const load = () => {
    const seq = ++seqRef.current
    Promise.all([fetchSystemStatus(), fetchAppSettings()])
      .then(([current, stored]) => {
        if (seq !== seqRef.current) return
        setStatus(current)
        setCronBox(stored.price_refresh_cron)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the refresh schedule.')
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const save = () => {
    setSaving(true)
    setFormError(null)
    setSavedNote(false)
    // The cron ALONE (spec §3.5): this card shows no other field, and a full form would revert
    // whatever Plan assumptions or Calendar feed saved a minute ago.
    putAppSettings({ price_refresh_cron: cronBox })
      .then((saved) => {
        // Re-seeded from the RESPONSE (the server strips it), and the facts are re-read because
        // the save hot-applies the schedule — "Next scheduled run" has just moved.
        setCronBox(saved.price_refresh_cron)
        setSavedNote(true)
        load()
      })
      .catch((err: unknown) => {
        setFormError(err instanceof ApiError ? err.message : 'Could not save the schedule.')
      })
      .finally(() => setSaving(false))
  }

  return (
    <section className="card span-6" id="price-refresh" role="region" aria-label="Price refresh">
      <h2 className="eyebrow">
        Price refresh
        <InfoHint text="5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applied to the live schedule on save. Must not fire more often than hourly. The Monday run also records the weekly performance point — keep Mondays covered." />
      </h2>
      <FeedBanner error={loadError} retry={load} retryLabel="Retry loading the refresh schedule" />
      <form
        className="settings-card-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label>
          Price refresh cron
          {/* .field-input is already monospaced, which is what a cron expression wants. */}
          <input
            className="field-input"
            value={cronBox}
            disabled={saving}
            onChange={(e) => {
              setCronBox(e.target.value)
              // Every keystroke retires both sentences: they describe the value that WAS in
              // the box (the settings family's rule).
              setSavedNote(false)
              setFormError(null)
            }}
          />
        </label>
        <div className="settings-card-actions">
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
          <button
            type="button"
            className="button"
            disabled={refreshing}
            onClick={() => refresh({ after: load })}
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
        <FeedBanner error={formError} />
        <FeedBanner error={refreshError} />
        {savedNote && (
          <p className="settings-note" role="status">
            Saved — the schedule is applied immediately.
          </p>
        )}
        {note.text !== '' && (
          <p className="settings-note" role="status" title={note.detail || undefined}>
            {note.text}
          </p>
        )}
      </form>
      {status !== null && (
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
            <dt>Recent refreshes</dt>
            <dd>{refreshRunsLine(status)}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}
