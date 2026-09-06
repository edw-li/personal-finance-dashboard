import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { changePassword } from '../api/auth'
import { ApiError } from '../api/client'
import { importXlsx } from '../api/importer'
import { fetchAppSettings } from '../api/settings'
import InfoHint from '../components/InfoHint'
import AccountsCard from '../components/settings/AccountsCard'
import ActivityCard from '../components/settings/ActivityCard'
import AppearanceCard from '../components/settings/AppearanceCard'
import AssistantCard from '../components/settings/AssistantCard'
import BackupsCard from '../components/settings/BackupsCard'
import CalendarFeedCard from '../components/settings/CalendarFeedCard'
import CategoriesCard from '../components/settings/CategoriesCard'
import HealthCard from '../components/settings/HealthCard'
import HouseholdCard from '../components/settings/HouseholdCard'
import ImportReportView from '../components/settings/ImportReportView'
import LimitsCard from '../components/settings/LimitsCard'
import PlanAssumptionsCard from '../components/settings/PlanAssumptionsCard'
import PriceRefreshCard from '../components/settings/PriceRefreshCard'
import RestoreCard from '../components/settings/RestoreCard'
import SettingsRail from '../components/settings/SettingsRail'
import SystemCard from '../components/settings/SystemCard'
import { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import type { ImportReport, PersonOut } from '../types/api'
import '../components/panels.css'
// The settings family sheet, not only the component's: this page renders .settings-note
// itself, under half its controls.
import '../components/settings/settings.css'
import './SettingsPage.css'

export default function SettingsPage() {
  // Load state (the house recipe: plain function, inline chain, seqRef).
  const [loading, setLoading] = useState(true)
  // A FIRST load that failed must not also offer a form seeded with blanks — it would
  // read as "these are your settings" and offer to save them (PortfolioPage's rule).
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  // Lifted out of HouseholdCard so the Accounts card's owner select is never a render
  // behind it: a partner added above must be selectable below without a reload. The page
  // does no household fetching of its own — this is a relay, not a second source of truth.
  const [people, setPeople] = useState<PersonOut[]>([])
  const seqRef = useRef(0)

  // ~15 setters: the load chain stays a PLAIN function called from the mount effect and
  // Retry — a useCallback here trips preserve-manual-memoization (Plan 3 wall).
  const load = () => {
    const seq = ++seqRef.current
    fetchAppSettings()
      .then(() => {
        if (seq !== seqRef.current) return
        // The page reads /settings for ONE reason now: it is the gate. A GET that failed means
        // the API is unreachable, and cards that could only fail are not worth offering. The
        // three boxes moved to PlanAssumptionsCard, which reads it for itself.
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
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  // The one reload door, shared by the two surfaces that can offer it: the plain banner
  // when the first load failed, and the frame's stale line if cards are already up.
  const retryLoad = () => {
    setLoading(true)
    // Cleared WITH the request, the house recipe: left standing, the banner would sit there
    // through the whole retry with nothing to say the page is trying again. Dropping it
    // returns the frame to its skeleton, which is the in-flight cue.
    setError(null)
    load()
  }

  // Anchored arrival from the palette (/settings#limits, 2026-09-03 spec §9): scroll the
  // card into view and light it for a moment, because a page of ten cards gives no other
  // sign that the jump landed. Gated on `loading` because the cards only exist once the
  // first load has resolved — the browser's own hash handling ran long before that and
  // found nothing. The class is applied imperatively rather than through state: it is
  // pure decoration on a card this page does not otherwise re-render.
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash || loading) return
    const el = document.getElementById(hash.slice(1))
    if (!el) return
    // Optional-call, like HoldingDetailPanel: jsdom has no scrollIntoView.
    const land = () => el.scrollIntoView?.({ block: 'start' })
    land()
    // Section bands take the scroll and NOT the ring (spec §3.2): they are not cards, and an
    // outline round a heading rings nothing the reader asked for. The two `classList.remove`
    // calls below stay unconditional — taking off a class that was never added is a no-op.
    if (!hash.startsWith('#sec-')) el.classList.add('is-highlighted')
    // Landing once is not enough. Every card on this page owns its own fetch and GROWS as it
    // arrives, so the cards ABOVE the anchor push it down after the jump has happened: the
    // browser smoke measured #calendar going from 585px to 1898px — a full viewport below the
    // fold — 400 ms after arriving, leaving the user staring at some other card. Re-assert
    // the scroll on every layout change, and let go with the ring: the arrival is live for
    // exactly as long as it is being shown, and a shift after that is the user's own.
    // Guarded like the scrollIntoView call above, and for the same reason: jsdom ships no
    // ResizeObserver, so an unguarded `new` turns any test that renders this page under a
    // hash into a crash unless it remembers the stub. Without the API the arrival still
    // lands and still rings — it just does not chase the cards growing above it.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(land)
    observer?.observe(document.body)
    const timer = setTimeout(() => {
      observer?.disconnect()
      el.classList.remove('is-highlighted')
    }, 1200)
    // The class is ours to take back, not only the timer: a re-run (or an unmount) before
    // the timeout fires would otherwise cancel the one thing that removes it and leave the
    // card ringed for good — which is what stripping an arrival param used to cause, since
    // the strip re-rendered this page with a hash-less location.
    return () => {
      observer?.disconnect()
      clearTimeout(timer)
      el.classList.remove('is-highlighted')
    }
  }, [hash, loading])

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

  return (
    <div className="page settings-page">
      <PageFrame
        title="Settings"
        scopeRow={
          // "The frame is showing children", the same condition as `resource.status` below —
          // NOT `loadedOnce`. A first load that failed still renders the ungated Account band,
          // and the rail has to find it: keyed on loadedOnce alone its effect would never
          // re-run, and the chip would stay lit on a Household section that is not coming.
          <SettingsRail sectionsReady={loadedOnce || error !== null} />
        }
        resource={{
          // Ready as soon as the first load SETTLES, either way: the Appearance card below
          // owns no request, so a settings GET that failed must not blank the page.
          status: loadedOnce || error !== null ? 'ready' : 'loading',
          // The frame's line reads "Showing earlier data" — true only when there IS data
          // behind it. A first failure has none, and is bannered below instead.
          error: loadedOnce ? error : null,
          busy: loading && loadedOnce,
          retry: retryLoad,
        }}
        // The page's own shape: the Household section's three cards over the Planning
        // section's pair (spec §3.6).
        skeleton={{
          tiles: 0,
          cards: [
            { span: 6, height: 220 },
            { span: 6, height: 220 },
            { span: 12, height: 260 },
            { span: 6, height: 240 },
            { span: 6, height: 240 },
          ],
        }}
      >
        {/* The first-load failure, in the seat the page header's banner used to hold: the
            frame is ready (the Appearance card needs no network), so the message and its
            retry ride a plain alert above the grid rather than a staleness line. */}
        <FeedBanner
          error={loadedOnce ? null : error}
          retry={retryLoad}
          retryLabel="Retry loading settings"
        />
        <div className="card-grid">
          {loadedOnce && (
            <>
              <h2 className="settings-section" id="sec-household">Household</h2>
              {/* people is lifted out of HouseholdCard so the Accounts owner select is never a
                  render behind the roster: a partner added above is selectable below without
                  a reload. Unchanged relay, new seat. */}
              <HouseholdCard onPeopleChange={setPeople} />
              <CategoriesCard />
              <AccountsCard people={people} />

              <h2 className="settings-section" id="sec-planning">Planning</h2>
              <LimitsCard />
              <PlanAssumptionsCard />
            </>
          )}

          {/* Account: the pair about this browser and this login. The BAND is ungated with the
              card under it — Appearance owns no fetch, so theme, density and the palette's
              #appearance jump still work when the API is unreachable, which is one of the
              moments a reader most wants the light theme back. */}
          <h2 className="settings-section" id="sec-account">Account</h2>
          <AppearanceCard />

          {loadedOnce && (
            <>
              <section className="card span-6" id="password">
                <h2 className="eyebrow">
                  Password
                  <InfoHint text="Changes your login password and signs out every other device; this one stays signed in." />
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
                  <FeedBanner error={pwError} />
                  {pwChanged && (
                    <p className="settings-note" role="status">
                      Password changed.
                    </p>
                  )}
                  {/* What the change costs and what it does not: the server bumps token_version,
                      which kills every token issued before it — including this tab's, which is
                      why the response hands back a fresh one for changePassword to store. */}
                  <p className="settings-note">
                    Other devices are signed out; this one stays signed in.
                  </p>
                </form>
              </section>

              <h2 className="settings-section" id="sec-integrations">Integrations</h2>
              <PriceRefreshCard />
              <AssistantCard />
              <CalendarFeedCard />

              <h2 className="settings-section" id="sec-data">Data</h2>
              <section className="card span-12" id="import">
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
                    Dry run parses the workbook and shows what would change — nothing is
                    written. Applying overwrites imported rows: taxes inputs and brackets
                    edited here for sheet-covered years are reset to the sheet.
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
                    <FeedBanner error={importError} />
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
                  <p className="settings-note">
                    Other pages load the new data on their next visit.
                  </p>
                )}
              </section>
              <BackupsCard />
              <RestoreCard />
              <HealthCard />
              <SystemCard />
              <ActivityCard />
            </>
          )}
        </div>
      </PageFrame>
    </div>
  )
}
