import { useEffect, useRef, useState } from 'react'
import { changePassword } from '../api/auth'
import { ApiError } from '../api/client'
import { importXlsx } from '../api/importer'
import { fetchAccounts, updateAccount } from '../api/netWorth'
import { fetchAllocation } from '../api/portfolio'
import { fetchAppSettings, putAppSettings } from '../api/settings'
import InfoHint from '../components/InfoHint'
import ImportReportView from '../components/settings/ImportReportView'
import type { AccountOut, AppSettingsOut, ImportReport } from '../types/api'
import { isPlainDecimal, shiftPoint } from '../utils/percent'
import '../components/panels.css'
// The settings family sheet, not only the component's: this page renders .settings-note
// itself, under half its controls.
import '../components/settings/settings.css'
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

// The two shipped suggestion kinds (spec §5.2): `vesting:unvested` is static, the portfolio
// ones are one per allocation BUCKET — the labels the ledger's transactions actually hold
// under, which is what the endpoint resolves a mapping against.
const VESTING_SOURCE = 'vesting:unvested'
const PORTFOLIO_PREFIX = 'portfolio:'

// What a stored mapping reads as when today's buckets do not contain it — the label was
// renamed in the ledger, or its last holding was sold. Written out rather than dropped: a
// controlled <select> whose value has no option silently coerces to None, and the next
// change event anywhere on the page would then look like the user clearing a mapping they
// never touched. The raw column value stands in for anything else — a guess about a kind
// this build does not know would be worse than what is stored.
function unresolvedText(value: string) {
  return value.startsWith(PORTFOLIO_PREFIX)
    ? `Portfolio: ${value.slice(PORTFOLIO_PREFIX.length)} (unresolved)`
    : `${value} (unresolved)`
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
  // Import card — the chosen File, the last report ABOUT that file, one busy flag for both
  // requests (dry run and apply are the same upload with the flag flipped).
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [importBusy, setImportBusy] = useState<'dry' | 'apply' | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // Balance-suggestions card — the account rows it maps, the allocation labels its options
  // come from, one busy flag for the single in-flight PATCH, one error slot for both of the
  // card's requests (the load and the PATCH, as the import card does for its two).
  const [suggestAccounts, setSuggestAccounts] = useState<AccountOut[] | null>(null)
  const [suggestBuckets, setSuggestBuckets] = useState<string[]>([])
  const [suggestLoading, setSuggestLoading] = useState(true)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const seqRef = useRef(0)
  // Its OWN sequence guard, banner and flags: this card's two GETs are a different pair of
  // endpoints, and a portfolio that is down must not cost the user the settings form, the
  // password form or the importer (EsppPage's three independent loads).
  const suggestSeqRef = useRef(0)

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

  // Same recipe, second card. The two GETs travel together because a row without its option
  // list is not a control anyone can use — but they are ONE chain, separate from the
  // settings load above, and they run on mount whatever that load does: the card is behind
  // the same `loadedOnce` gate as the import one, so a settings Retry that finally opens the
  // grid finds these rows already there.
  const loadSuggestSources = () => {
    const seq = ++suggestSeqRef.current
    Promise.all([fetchAccounts(), fetchAllocation('account')])
      .then(([accountList, allocation]) => {
        if (seq !== suggestSeqRef.current) return
        // The wizard's own filter: a closed account has no balance to enter, and a component
        // is entered under its parent — rows the chips would never reach.
        setSuggestAccounts(accountList.filter((a) => a.is_active && !a.is_component))
        setSuggestBuckets(allocation.slices.map((s) => s.key))
        setSuggestError(null)
      })
      .catch((err: unknown) => {
        if (seq !== suggestSeqRef.current) return
        setSuggestError(
          err instanceof ApiError ? err.message : 'Could not load the suggestion sources.',
        )
      })
      .finally(() => {
        if (seq === suggestSeqRef.current) setSuggestLoading(false)
      })
  }

  useEffect(() => {
    load()
    loadSuggestSources()
    // mount-only: both are plain functions over stable setters (house idiom)
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

  const pickFile = (chosen: File | null) => {
    setFile(chosen)
    // A report describes exactly ONE workbook. Left on screen it would be the previous
    // file's diff, arming Apply for a file nobody has parsed.
    setReport(null)
    setImportError(null)
  }

  const reportHasErrors =
    report !== null && Object.values(report.sheets).some((s) => s.errors.length > 0)
  // Apply is armed only by a clean DRY-RUN of the currently chosen file (a fresh pick
  // clears `report`; an applied report re-arms nothing — dry-run again to re-apply).
  const canApply =
    file !== null && report !== null && report.dry_run && !reportHasErrors && importBusy === null

  const runImport = (dryRun: boolean) => {
    if (file === null) return
    setImportBusy(dryRun ? 'dry' : 'apply')
    setImportError(null)
    // No seq guard on this chain, unlike the load: the file input and BOTH buttons are the
    // card's only doors and all three are disabled while `importBusy` is set, so a second
    // upload cannot start behind the first one (TaxesPage's `creating` posture).
    importXlsx(file, dryRun)
      .then((r) => {
        setReport(r)
        setImportError(null)
      })
      .catch((err: unknown) => {
        // Verbatim: the router's 413 names the 15 MB limit and its 400 names the file type,
        // and the client's own timeout/network messages are already user-worthy.
        setImportError(
          err instanceof ApiError ? err.message : 'Import failed — is the server reachable?',
        )
        // A failed APPLY may still have WRITTEN — the import is not one transaction, and a
        // request that died mid-flight (or timed out) leaves a database nobody has parsed.
        // The standing dry-run diff describes the database as it was BEFORE that, so it
        // must not be left arming Apply; dry-run again to see where things actually stand.
        // A failed dry run wrote nothing, so the report before it is still true and stays.
        if (!dryRun) setReport(null)
      })
      .finally(() => setImportBusy(null))
  }

  const applyImport = () => {
    // The one thing a dry run cannot show, said before the write: within a year the SHEET
    // wins, so taxes work done in the UI for sheet-covered years is about to be replaced.
    const ok = window.confirm(
      'Apply this workbook to the live database? Sheet values overwrite imported rows — ' +
        'taxes inputs and brackets you edited in the UI for sheet-covered years WILL be ' +
        'reset to the sheet. This cannot be undone.',
    )
    if (!ok) return
    runImport(false)
  }

  // A pick IS the save (there is no button to press): the row goes to the new value at once
  // so the select shows what is in flight, and a refusal puts the old one back.
  const changeSuggestSource = (account: AccountOut, value: string) => {
    const previous = account.suggest_source
    // '' is the None option. Explicitly null, never undefined: JSON.stringify drops an
    // undefined value, and the server tells "clear this mapping" from "I did not send the
    // field" by model_fields_set alone — so an omitted key would leave the old source
    // running while the box said None.
    const next = value === '' ? null : value
    const write = (id: number, source: string | null) =>
      setSuggestAccounts(
        (cur) => cur && cur.map((a) => (a.id === id ? { ...a, suggest_source: source } : a)),
      )
    write(account.id, next)
    setSuggestBusy(true)
    setSuggestError(null)
    // No seq guard on this chain, unlike the load: every select is disabled while
    // `suggestBusy` is set, so a second PATCH cannot start behind the first one (the import
    // card's posture).
    updateAccount(account.id, { suggest_source: next })
      .then((saved) => {
        // The stored row, not the optimistic guess — the server owns what a mapping ends up
        // as, exactly as the settings PUT re-seeds its boxes from the response.
        setSuggestAccounts((cur) => cur && cur.map((a) => (a.id === saved.id ? saved : a)))
        setSuggestError(null)
      })
      .catch((err: unknown) => {
        // A selection left showing a mapping the server refused would be a lie about which
        // source the wizard is going to suggest from.
        write(account.id, previous)
        // Verbatim: the 422 here names the two legal shapes, which no paraphrase does.
        setSuggestError(
          err instanceof ApiError ? err.message : 'Could not save the suggestion source.',
        )
      })
      .finally(() => setSuggestBusy(false))
  }

  // None, one option per allocation bucket, then the static vesting kind. Rebuilt per render
  // from the loaded buckets — the list is the portfolio's, and an account mapped to a label
  // that has left it is handled per row below.
  const suggestOptions = [
    { value: '', text: 'None' },
    ...suggestBuckets.map((label) => ({
      value: `${PORTFOLIO_PREFIX}${label}`,
      text: `Portfolio: ${label}`,
    })),
    { value: VESTING_SOURCE, text: 'Unvested RSUs' },
  ]

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
            <h2 className="eyebrow">
              App settings
              <InfoHint text="The withdrawal rate feeds the 4% line and FI target; the ESPP ticker prices lots; the cron schedules price refreshes (applied on save)." />
            </h2>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              {/* All three boxes go read-only for the in-flight window, because the PUT
                  response RE-SEEDS them: text typed while saving would be overwritten by the
                  echo of the older values, next to a fresh "Saved" — which is exactly the
                  claim this page's every-keystroke-retires-the-note rule exists to prevent. */}
              <label>
                Withdrawal rate (% / year)
                <input
                  className="field-input"
                  inputMode="decimal"
                  value={swrPctBox}
                  disabled={saving}
                  onChange={(e) => editSetting(setSwrPctBox)(e.target.value)}
                />
              </label>
              <label>
                ESPP ticker
                <input
                  className="field-input"
                  value={tickerBox}
                  disabled={saving}
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
                  disabled={saving}
                  onChange={(e) => editSetting(setCronBox)(e.target.value)}
                />
              </label>
              <p className="settings-note">
                5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applied
                to the live schedule on save. Must not fire more often than hourly. The Monday
                run also records the weekly performance point — keep Mondays covered.
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
                  Saved — the schedule is applied immediately.
                </p>
              )}
            </form>
          </section>

          <section className="card span-6">
            <h2 className="eyebrow">
              Password
              <InfoHint text="Changes your login password; existing sessions stay signed in until their token expires." />
            </h2>
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

          <section className="card span-6">
            <h2 className="eyebrow">
              Balance suggestions
              <InfoHint text="Maps an account to a computed value — a portfolio label's market value, or the unvested RSU total. The wizard offers it as an Apply chip; nothing is ever filled in for you." />
            </h2>
            {suggestError && (
              <div className="error-banner" role="alert">
                {suggestError}{' '}
                {/* Only when the LOAD is what failed: with rows on screen the recovery for a
                    refused PATCH is picking an option again, and a Retry button beside that
                    sentence would offer to re-run a request that is not the one that broke. */}
                {suggestAccounts === null && (
                  <button
                    className="button"
                    aria-label="Retry loading balance suggestions"
                    onClick={() => {
                      setSuggestLoading(true)
                      loadSuggestSources()
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            {suggestAccounts === null ? (
              suggestLoading && <p className="empty-note">Loading…</p>
            ) : (
              // Dimmed while a PATCH is in flight, like every other in-flight body on the
              // page — the selects are disabled underneath it.
              <div className={`loading-dim${suggestBusy ? ' is-loading' : ''}`}>
                <div className="settings-form">
                  {suggestAccounts.length === 0 ? (
                    <p className="empty-note">No active accounts to map yet.</p>
                  ) : (
                    suggestAccounts.map((account) => {
                      const current = account.suggest_source ?? ''
                      const known = suggestOptions.some((o) => o.value === current)
                      return (
                        <label key={account.id}>
                          {account.name}
                          <select
                            className="field-input"
                            // The name carries the ACCOUNT: a column of selects all reading
                            // "Suggestion source" would be identical controls to a screen
                            // reader. It overrides the visible label, which is why that
                            // label's text is inside it verbatim (label-in-name: saying
                            // "Checking" still reaches this control by voice).
                            aria-label={`Suggestion source for ${account.name}`}
                            value={current}
                            disabled={suggestBusy}
                            onChange={(e) => changeSuggestSource(account, e.target.value)}
                          >
                            {suggestOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.text}
                              </option>
                            ))}
                            {!known && <option value={current}>{unresolvedText(current)}</option>}
                          </select>
                        </label>
                      )
                    })
                  )}
                  {/* The one thing the controls cannot say for themselves: a suggestion is
                      today's figure, so the wizard only offers it where today's figure is the
                      right answer. */}
                  <p className="settings-note">
                    Suggestions appear in the Monthly update wizard on the newest month only —
                    a backfilled month never sees them.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Full width: a diff of nine sheets is a table, not a form field. It shares the
              two forms' `loadedOnce` gate on purpose — a settings GET that failed means the
              API is unreachable, and an upload card that could only fail is not worth
              offering. */}
          <section className="card span-12">
            <h2 className="eyebrow">
              Import workbook
              <InfoHint text="Dry run shows the diff without writing. Apply overwrites sheet-owned rows — dividends are never touched; taxes inside sheet-covered years reset to the sheet." />
            </h2>
            <div className="settings-form">
              <label>
                Workbook (.xlsx)
                {/* Uncontrolled by design — a file input's value belongs to the browser;
                    `file` state is what the change event handed us. */}
                <input
                  className="field-input"
                  type="file"
                  accept=".xlsx"
                  disabled={importBusy !== null}
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="settings-note">
                Dry run parses the workbook and shows what would change — nothing is written.
                Applying overwrites imported rows: taxes inputs and brackets edited here for
                sheet-covered years are reset to the sheet.
              </p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button"
                  disabled={file === null || importBusy !== null}
                  onClick={() => runImport(true)}
                >
                  {importBusy === 'dry' ? 'Dry run…' : 'Dry run'}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!canApply}
                  onClick={applyImport}
                >
                  {importBusy === 'apply' ? 'Applying…' : 'Apply import'}
                </button>
              </div>
            </div>
            {importError && (
              <>
                <div className="error-banner" role="alert">
                  {importError}
                </div>
                {/* Said under EVERY import failure, because the likeliest cause does not
                    look like itself: a File is a lazy handle on a disk offset, and saving
                    the workbook again from Excel invalidates it — the browser then fails to
                    read the bytes at upload time and the message that surfaces is a
                    network-looking one. Re-picking the file is the whole fix. */}
                <p className="settings-note">
                  If you changed the workbook after choosing it, pick the file again.
                </p>
              </>
            )}
            {report && <ImportReportView report={report} />}
            {report?.applied && (
              // Not a live region of its own: the report's own header announces (role=status)
              // at the same moment, and two regions would read the news twice.
              <p className="settings-note">Other pages load the new data on their next visit.</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
