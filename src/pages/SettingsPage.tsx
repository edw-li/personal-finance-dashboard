import { useEffect, useRef, useState } from 'react'
import { changePassword } from '../api/auth'
import { ApiError } from '../api/client'
import { fetchAppSettings, putAppSettings } from '../api/settings'
import type { AppSettingsOut } from '../types/api'
import { isPlainDecimal, shiftPoint } from '../utils/percent'
import '../components/panels.css'
import './SettingsPage.css'

// The boxes a payload seeds, as pure string math at MODULE scope: the load chain and the
// PUT echo both apply it, and a component-scope helper would make `load` reactive — the
// mount effect would then owe it a dependency (react-hooks/exhaustive-deps), and the only
// ways to pay that are the useCallback this component is too setter-heavy for (Plan 3's
// memoization wall) or a dependency that re-runs the fetch on every render.
function boxesFor(s: AppSettingsOut) {
  return {
    // Display percent: "0.045000" -> "4.5". Number() only trims the stored quantizer's
    // trailing zeros; the box round-trips through shiftPoint on save, so no float ever
    // reaches the wire.
    swr: String(Number(shiftPoint(s.swr_pct, 2))),
    ticker: s.espp_ticker ?? '',
    cron: s.price_refresh_cron,
  }
}

export default function SettingsPage() {
  // Load state (the house recipe: plain function, inline chain, seqRef).
  const [loading, setLoading] = useState(true)
  // A FIRST load that failed must not also offer a form seeded with blanks — it would
  // read as "these are your settings" and offer to save them (PortfolioPage's rule).
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // App-settings form state (strings as displayed).
  const [swrPctBox, setSwrPctBox] = useState('') // PERCENT text, e.g. "4.5"
  const [tickerBox, setTickerBox] = useState('')
  const [cronBox, setCronBox] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  // Password form state — three boxes that never survive a successful submit.
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwChanged, setPwChanged] = useState(false)
  const seqRef = useRef(0)

  // ~15 setters: the load chain stays a PLAIN function called from the mount effect and
  // Retry — a useCallback here trips preserve-manual-memoization (Plan 3 wall).
  const load = () => {
    const seq = ++seqRef.current
    fetchAppSettings()
      .then((s) => {
        if (seq !== seqRef.current) return
        const boxes = boxesFor(s)
        setSwrPctBox(boxes.swr)
        setTickerBox(boxes.ticker)
        setCronBox(boxes.cron)
        setError(null)
        setLoadedOnce(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load settings.')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    load()
    // mount-only: load is a plain function over stable setters (house idiom)
  }, [])

  // Every settings keystroke retires both sentences under the form: they describe the
  // values that WERE in the boxes.
  const editSetting = (setBox: (value: string) => void) => (value: string) => {
    setBox(value)
    setSavedNote(false)
    setFormError(null)
  }

  const save = () => {
    if (!isPlainDecimal(swrPctBox)) {
      // BEFORE Number(): shiftPoint hands "1e-3" back untouched and Decimal("1e-3") is a
      // perfectly legal 0.001 server-side, so the box would silently store a rate 100x
      // off with no 422 anywhere on the round trip (src/utils/percent.ts).
      setFormError('Enter a plain decimal (no exponents).')
      return
    }
    const n = Number(swrPctBox)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      // Worded in the BOX's vocabulary. The server says "must be a fraction between 0 and
      // 1", which is the stored value's — quoted here it would call a 4.5 too big.
      setFormError('Must be between 0 and 100.')
      return
    }
    // Explicitly null, never undefined: JSON.stringify drops an undefined value, and
    // espp_ticker defaults to None server-side — so "clear the ticker" and "I forgot to
    // send it" would arrive as the same request. The non-empty value travels AS TYPED
    // (the server strips and uppercases; a client that pre-empted it would be a second
    // opinion about the same string).
    const ticker = tickerBox.trim() === '' ? null : tickerBox
    setSaving(true)
    setFormError(null)
    setSavedNote(false)
    // No seq guard on this chain, unlike the load: the button is the form's only submit
    // door and it is disabled while `saving`, so a second PUT cannot start behind the
    // first one (TaxesPage's `creating`).
    putAppSettings({
      swr_pct: shiftPoint(swrPctBox, -2),
      espp_ticker: ticker,
      price_refresh_cron: cronBox,
    })
      .then((saved) => {
        // Re-seeded from the RESPONSE, not from what was typed: the server answers with
        // what it stored (quantized rate, uppercased ticker, stripped cron), and boxes
        // left holding the typed text would read as unsaved work against values that are
        // already in the database.
        const boxes = boxesFor(saved)
        setSwrPctBox(boxes.swr)
        setTickerBox(boxes.ticker)
        setCronBox(boxes.cron)
        setFormError(null)
        setSavedNote(true)
      })
      .catch((err: unknown) => {
        // Verbatim: the 422s here are the router's own sentences, and the ticker one is
        // NOT field-prefixed — there is nothing to map it onto a single box with, so the
        // slot is form-level.
        setFormError(err instanceof ApiError ? err.message : 'Could not save settings.')
      })
      .finally(() => setSaving(false))
  }

  const editPassword = (setBox: (value: string) => void) => (value: string) => {
    setBox(value)
    setPwError(null)
    setPwChanged(false)
  }

  const submitPassword = () => {
    if (newPw !== confirmPw) {
      // Nothing the server can answer: it never sees the confirmation box.
      setPwError('New passwords do not match.')
      return
    }
    setPwBusy(true)
    setPwError(null)
    setPwChanged(false)
    changePassword(currentPw, newPw)
      .then(() => {
        // Only a SUCCESS clears the boxes — a wrong current password would otherwise cost
        // the user the new one they had already typed twice.
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
        setPwChanged(true)
      })
      .catch((err: unknown) => {
        // "Current password is incorrect" / the min-length 422 speak for themselves.
        setPwError(err instanceof ApiError ? err.message : 'Could not change the password.')
      })
      .finally(() => setPwBusy(false))
  }

  return (
    <div className="page settings-page">
      <div className="page-header">
        <h1>Settings</h1>
        <div className="spacer" />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="button"
            onClick={() => {
              setLoading(true)
              load()
            }}
          >
            Retry
          </button>
        </div>
      )}

      {loading && !loadedOnce && <p className="empty-note">Loading…</p>}

      {loadedOnce && (
        <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
          <section className="card span-6">
            <h2 className="eyebrow">App settings</h2>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <label>
                Withdrawal rate (% / year)
                <input
                  className="field-input"
                  inputMode="decimal"
                  value={swrPctBox}
                  onChange={(e) => editSetting(setSwrPctBox)(e.target.value)}
                />
              </label>
              <label>
                ESPP ticker
                <input
                  className="field-input"
                  value={tickerBox}
                  onChange={(e) => editSetting(setTickerBox)(e.target.value)}
                />
              </label>
              <p className="settings-note">
                Blank = ESPP page shows &apos;no ticker configured&apos;.
              </p>
              <label>
                Price refresh cron
                {/* .field-input is already monospaced (the page sheet only un-right-aligns
                    it), which is what a cron expression wants. */}
                <input
                  className="field-input"
                  value={cronBox}
                  onChange={(e) => editSetting(setCronBox)(e.target.value)}
                />
              </label>
              <p className="settings-note">
                5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applies
                after a backend restart. Must not fire more often than hourly.
              </p>
              <div className="settings-actions">
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save settings'}
                </button>
              </div>
              {formError && (
                <div className="error-banner" role="alert">
                  {formError}
                </div>
              )}
              {savedNote && (
                <p className="settings-note" role="status">
                  Saved — cron changes apply after a backend restart.
                </p>
              )}
            </form>
          </section>

          <section className="card span-6">
            <h2 className="eyebrow">Password</h2>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault()
                submitPassword()
              }}
            >
              <label>
                Current password
                <input
                  className="field-input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => editPassword(setCurrentPw)(e.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  className="field-input"
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => editPassword(setNewPw)(e.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  className="field-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => editPassword(setConfirmPw)(e.target.value)}
                />
              </label>
              <div className="settings-actions">
                <button type="submit" className="button button-primary" disabled={pwBusy}>
                  {pwBusy ? 'Changing…' : 'Change password'}
                </button>
              </div>
              {pwError && (
                <div className="error-banner" role="alert">
                  {pwError}
                </div>
              )}
              {pwChanged && (
                <p className="settings-note" role="status">
                  Password changed.
                </p>
              )}
              {/* Honest about what this app does NOT do: tokens are not rotated on a
                  password change (single-user app, 24 h expiry — declared deferral). */}
              <p className="settings-note">
                Existing sessions stay signed in until their token expires (~24 h).
              </p>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
