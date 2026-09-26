import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import { fetchSystemStatus } from '../../api/system'
import type { SystemStatus } from '../../types/api'
import { formatDateTime, localDateKey } from '../../utils/format'
import { todayIso } from '../../utils/months'
import InfoHint from '../InfoHint'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'
import { FeedBanner } from '../shell/Feed'
import { usePriceRefresh } from '../usePriceRefresh'
import '../panels.css'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

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

function RefreshRuns({ status }: { status: SystemStatus }) {
  const runs = (status.refresh_runs ?? []).slice(0, 5)
  if (runs.length === 0) return <>—</>
  return <ul className="system-fact-list">{runs.map((run, index) => (
    <li key={`${run.at}:${index}`} className={run.failed_count > 0 ? 'system-overdue' : undefined}>
      {localDateKey(run.at) === todayIso()
        ? `Today ${new Date(run.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
        : formatDateTime(run.at)} · {run.updated} updated{run.failed_count > 0 ? ` · ${run.failed_count} failed` : ''}
    </li>
  ))}</ul>
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
  const [savedCron, setSavedCron] = useState('')
  const saveState = useSaveState({ dirty: cronBox !== savedCron })
  const saving = saveState.status === 'saving'
  const seqRef = useRef(0)
  const { refreshing, note, error: refreshError, refresh } = usePriceRefresh()

  /** The FACTS alone, and it RETURNS its promise. Two things turn on that: the Refresh-now
   *  button must stay disabled until the fresh numbers are actually on screen (usePriceRefresh
   *  awaits `after`), and a re-read that also re-seeded the cron box would throw away an
   *  expression the reader is in the middle of typing. Shares `seqRef` with `load`, so
   *  whichever read started last is the one that gets to write. */
  const loadStatus = (): Promise<void> => {
    const seq = ++seqRef.current
    return fetchSystemStatus()
      .then((current) => {
        if (seq !== seqRef.current) return
        setStatus(current)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the refresh schedule.')
      })
  }

  // Mount and Retry only: the settings read is what seeds the cron box, and the box is the
  // one thing on this card the reader can be halfway through changing.
  const load = (initial = false) => {
    const seq = ++seqRef.current
    const source = warmSource(initial)
    Promise.all([source(WARM.systemStatus, fetchSystemStatus), source(WARM.appSettings, fetchAppSettings)])
      .then(([current, stored]) => {
        if (seq !== seqRef.current) return
        setStatus(current)
        setCronBox(stored.price_refresh_cron)
        setSavedCron(stored.price_refresh_cron)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the refresh schedule.')
      })
  }

  useEffect(() => {
    load(true)
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const save = () => void saveState.run(async () => {
    const saved = await putAppSettings({ price_refresh_cron: cronBox })
    setCronBox(saved.price_refresh_cron)
    setSavedCron(saved.price_refresh_cron)
    await loadStatus()
  })

  return (
    <section className="card span-12" id="price-refresh" role="region" aria-label="Price refresh">
      <h2 className="eyebrow">
        Price refresh
        <InfoHint text="5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applied to the live schedule on save. Must not fire more often than hourly. The Monday run also records the weekly performance point — keep Mondays covered." />
      </h2>
      <FeedBanner error={loadError} retry={() => load()} retryLabel="Retry loading the refresh schedule" />
      {status === null && loadError === null && <SettingsGhost height={420} />}
      {/* Gated on the first reading, like Plan assumptions: a cron box seeded with a
          blank would read as "your schedule is empty" and offer to save it. The banner
          above stays outside the gate — a failed load is exactly when it must show. */}
      {status !== null && (
        <form
          className="settings-card-form"
          onSubmit={(e) => {
            e.preventDefault()
            e.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus()
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
                saveState.clearError()
              }}
            />
          </label>
          <div className="settings-card-actions">
            <SaveButton type="submit" className="button button-primary" state={saveState}>Save schedule</SaveButton>
            <SaveStatus state={saveState} />
            <BusyButton
              type="button"
              className="button"
              busy={refreshing}
              onClick={() => refresh({ after: loadStatus })}
            >
              Refresh now
            </BusyButton>
          </div>
          <FeedBanner error={refreshError} />
          {note.text !== '' && (
            <p className="settings-note" role="status" title={note.detail || undefined}>
              {note.text}
            </p>
          )}
        </form>
      )}
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
            <dd><RefreshRuns status={status} /></dd>
          </div>
        </dl>
      )}
    </section>
  )
}
