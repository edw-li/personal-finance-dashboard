import { useEffect, useRef, useState } from 'react'
import { createFeedToken, feedUrl, fetchFeedTokens, revokeFeedToken } from '../../api/calendarFeed'
import { ApiError } from '../../api/client'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import type { AppSettingsOut, FeedTokenOut } from '../../types/api'
import { formatDate, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

const MIN_DAY = 1
const MAX_DAY = 28

/**
 * The Settings Calendar-feed card (2026-09-03 calendar spec §11–§12): subscription links
 * (create → the URL shown ONCE with Copy; list with created / last used / Revoke) and the
 * monthly-update reminder day. The token plaintext lives in component state only while the
 * "shown once" panel is open; nothing here ever asks the server for it again.
 */
export default function CalendarFeedCard() {
  const [tokens, setTokens] = useState<FeedTokenOut[] | null>(null)
  const [settings, setSettings] = useState<AppSettingsOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [labelBox, setLabelBox] = useState('')
  const [fresh, setFresh] = useState<{ label: string; url: string } | null>(null)
  const [dayBox, setDayBox] = useState('')
  const [dayError, setDayError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const seqRef = useRef(0)
  const toast = useToast()

  // A plain function over stable setters, called from the effect and from Retry (the
  // LimitsCard idiom — a useCallback here trips preserve-manual-memoization).
  const load = () => {
    const seq = ++seqRef.current
    Promise.all([fetchFeedTokens(), fetchAppSettings()])
      .then(([list, appSettings]) => {
        if (seq !== seqRef.current) return
        setTokens(list)
        setSettings(appSettings)
        setDayBox(String(appSettings.calendar_update_due_day))
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load the calendar feed settings.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const create = () => {
    const label = labelBox.trim()
    if (label === '') return
    setBusy(true)
    setError(null)
    createFeedToken(label)
      .then((created) => {
        setFresh({ label: created.label, url: feedUrl(created.token) })
        setLabelBox('')
      })
      .catch((err: unknown) => setError(message(err, 'Could not create the feed link.')))
      .finally(() => setBusy(false))
  }

  const copy = () => {
    if (fresh === null) return
    navigator.clipboard
      .writeText(fresh.url)
      .then(() => toast.success('Feed URL copied'))
      .catch(() => toast.error('Could not copy — select the URL and copy it by hand'))
  }

  const dismissFresh = () => {
    setFresh(null)
    load()
  }

  const revoke = (token: FeedTokenOut) => {
    setBusy(true)
    setError(null)
    // No Undo: the plaintext is gone for good, which is the point of revoking.
    revokeFeedToken(token.id)
      .then(() => {
        toast.success(`Revoked the ${token.label} link — calendars using it will stop updating`)
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Could not revoke the link.')))
      .finally(() => setBusy(false))
  }

  const saveDay = () => {
    if (settings === null) return
    const day = Number(dayBox)
    if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY) {
      setDayError(`Pick a day between ${MIN_DAY} and ${MAX_DAY} — every month has one.`)
      return
    }
    setBusy(true)
    setDayError(null)
    setSavedNote(false)
    // The three other settings travel back VERBATIM (full-form PUT); only the day changes.
    putAppSettings({
      swr_pct: settings.swr_pct,
      espp_ticker: settings.espp_ticker,
      price_refresh_cron: settings.price_refresh_cron,
      calendar_update_due_day: day,
    })
      .then((saved) => {
        // Re-seeded from the RESPONSE, like every other settings form here: the server
        // answers with what it stored, and a box holding the typed text would read as
        // unsaved work against a value that is already in the database.
        setSettings(saved)
        setDayBox(String(saved.calendar_update_due_day))
        setSavedNote(true)
      })
      .catch((err: unknown) => setDayError(message(err, 'Could not save the reminder day.')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6" id="calendar" role="region" aria-label="Calendar feed">
      <h2 className="eyebrow">
        Calendar feed
        <InfoHint text="Subscribe your phone or desktop calendar to the dashboard's events — vests, paydays, deadlines, your own reminders — with amounts. The link is the credential: anyone holding it can read the feed." />
      </h2>
      <FeedBanner error={error} retry={load} retryLabel="Retry loading the calendar feed" />
      {tokens === null && error === null && <p className="empty-note">Loading…</p>}
      {tokens !== null && (
        <>
          {fresh !== null ? (
            <div className="settings-card-form feed-fresh" role="status">
              <label>
                Feed URL
                {/* Selectable on focus, never editable: the value is a credential the user
                    has to get out of the page in one piece, and this is its only showing. */}
                <input
                  className="field-input feed-url"
                  aria-label="Feed URL"
                  readOnly
                  value={fresh.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <p className="settings-note">
                Copy it now — this link for <strong>{fresh.label}</strong> is shown once. Paste it
                into your calendar app as a subscription (Google: Other calendars → From URL;
                Apple: File → New Calendar Subscription).
              </p>
              <div className="settings-card-actions">
                <button type="button" className="button button-primary" onClick={copy}>
                  Copy
                </button>
                <button type="button" className="button" onClick={dismissFresh}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form
              className="settings-card-form"
              onSubmit={(e) => {
                e.preventDefault()
                create()
              }}
            >
              <label>
                Label for the new link
                <input
                  className="field-input"
                  aria-label="Label for the new link"
                  placeholder="phone, laptop…"
                  maxLength={60}
                  value={labelBox}
                  disabled={busy}
                  onChange={(e) => setLabelBox(e.target.value)}
                />
              </label>
              <div className="settings-card-actions">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy || labelBox.trim() === ''}
                >
                  New feed link
                </button>
              </div>
            </form>
          )}
          {tokens.length === 0 ? (
            <p className="empty-note">No feed links yet.</p>
          ) : (
            <div className="settings-scroll">
              <table className="data-table feed-table">
                <thead>
                  <tr>
                    <th>Link</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <td>{token.label}</td>
                      <td>{formatDate(token.created_at)}</td>
                      <td>
                        {token.last_used_at === null ? 'never' : formatDateTime(token.last_used_at)}
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="button"
                          aria-label={`Revoke the ${token.label} link`}
                          disabled={busy}
                          onClick={() => revoke(token)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="settings-note">
            Anyone holding a feed link can read your calendar, amounts included. Revoke a link
            here if it leaks; the calendar app using it stops updating.
          </p>
          {settings !== null && (
            <form
              className="settings-card-form"
              onSubmit={(e) => {
                e.preventDefault()
                saveDay()
              }}
            >
              <label>
                Monthly update reminder day
                {/* A plain box, not type=number with min/max (SettingsPage's three boxes):
                    native constraint validation REFUSES to fire submit at all when the
                    value is out of range, which would make the sentence below unreachable
                    and leave the browser's own bubble as the only feedback. */}
                <input
                  className="field-input"
                  aria-label="Monthly update reminder day"
                  inputMode="numeric"
                  value={dayBox}
                  disabled={busy}
                  onChange={(e) => {
                    setDayBox(e.target.value)
                    // Every keystroke retires both sentences under the form: they describe
                    // the value that WAS in the box (SettingsPage's rule).
                    setDayError(null)
                    setSavedNote(false)
                  }}
                />
              </label>
              <p className="settings-note">
                The &quot;Monthly update — enter last month&quot; reminder lands on this day of
                each month, on the calendar and in the feed (with an alarm three days before).
                Any day from {MIN_DAY} to {MAX_DAY} — every month has one.
              </p>
              <div className="settings-card-actions">
                <button type="submit" className="button button-primary" disabled={busy}>
                  Save reminder day
                </button>
              </div>
              <FeedBanner error={dayError} />
              {savedNote && (
                <p className="settings-note" role="status">
                  Saved.
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  )
}
