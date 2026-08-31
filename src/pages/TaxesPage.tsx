import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  cloneBrackets,
  deleteTaxYear,
  fetchTaxBrackets,
  fetchTaxInputs,
  fetchTaxSummary,
  fetchTaxYears,
  FILING_STATUS_LABELS,
  FILING_STATUSES,
  patchTaxYear,
  putTaxInputs,
} from '../api/taxes'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import InfoHint from '../components/InfoHint'
import PageSkeleton from '../components/PageSkeleton'
import BracketsEditor from '../components/taxes/BracketsEditor'
import InputsForm from '../components/taxes/InputsForm'
import MarginalPanel from '../components/taxes/MarginalPanel'
import SummaryPanel from '../components/taxes/SummaryPanel'
import WhatIfPanel from '../components/taxes/WhatIfPanel'
import WithholdingPanel from '../components/taxes/WithholdingPanel'
import type {
  FilingStatus,
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummaryOut,
  TaxYearOut,
} from '../types/api'
import '../components/panels.css'
import './TaxesPage.css'

// The router's own century guard (app/api/taxes.py YEAR_MIN/YEAR_MAX) — refuse a typo
// here rather than spending a request on a 422.
const YEAR_MIN = 1900
const YEAR_MAX = 2100

// The three payloads of ONE year, replaced together: a half-updated page would show one
// year's brackets under another year's totals.
interface YearDetail {
  inputs: TaxInputsOut
  brackets: TaxBracketsOut
  summary: TaxSummaryOut
}

/**
 * The identity that must REMOUNT the two editors, taken from the PAYLOADS rather than from
 * the page's idea of the year's status.
 *
 * Their state is keyed by cell id — (key, person) in the inputs form, (jurisdiction, status)
 * in the brackets editor — and seeds from a useState INITIALIZER, so a namespace change that
 * does not remount them leaves every new box reading blank. The page's own `filingStatus`
 * cannot be that key: a status flip replaces the year ROW (and the selector) one render
 * BEFORE the new payloads land, so keying on it would remount the editors against the OLD
 * payloads and then leave them mounted when the real ones arrive. The payload's own status
 * and column list move exactly when its cell ids do.
 */
function inputsKey(inputs: TaxInputsOut): string {
  const columns = inputs.people.map((person) => person.id).join('.')
  return `inputs-${inputs.year}-${inputs.filing_status}-${columns}`
}

function bracketsKey(brackets: TaxBracketsOut): string {
  return `brackets-${brackets.year}-${brackets.filing_status}`
}

function latestOf(years: TaxYearOut[]): TaxYearOut | undefined {
  // The router already orders by year; reducing makes the page independent of that.
  return years.length === 0 ? undefined : years.reduce((a, b) => (b.year > a.year ? b : a))
}

// One snapshot per (year, filing status): the brackets GET names a status, so the same
// year under a different status is a DIFFERENT payload.
function detailKey(year: number, filingStatus: FilingStatus): string {
  return `taxes:detail:${year}:${filingStatus}`
}

export default function TaxesPage() {
  // The deep links' seeds — /taxes?whatif=TICKER from the holdings drill-in, ?whatif-lot={id}
  // from the ESPP lots table. A plain read per render (it is a hook, not a fetch), and the
  // params are deliberately NOT cleared: this page itself owns no history writes (the
  // ?year drill param is SummaryPanel's, written replace-style beside these), and a
  // reload re-seeding the same leg is the honest reading of the URL the user is sitting on.
  const [searchParams] = useSearchParams()
  const whatIfTicker = searchParams.get('whatif')
  // A garbled or hand-edited ?whatif-lot= is nobody's lot: null seeds nothing and the card
  // mounts closed as usual, rather than banner-ing about a URL nobody typed. Number(null)
  // and Number('') are both 0, which the > 0 fence sends the same way as NaN.
  const lotParam = Number(searchParams.get('whatif-lot'))
  const whatIfLotId = Number.isInteger(lotParam) && lotParam > 0 ? lotParam : null

  // The seeded selection replicates loadYears' pick (the latest year), and the seeded
  // detail reads that year's key using ITS OWN filing status from the cached row.
  const cachedYears = getSnapshot<TaxYearOut[]>('taxes:years')
  const cachedLatest = cachedYears !== undefined ? latestOf(cachedYears) : undefined
  const [years, setYears] = useState<TaxYearOut[]>(cachedYears ?? [])
  // An OBJECT, not a bare number: a fresh identity re-runs the load effect, so selecting
  // the year that is already selected (right after cloning into it) still refetches.
  const [selection, setSelection] = useState<{ year: number } | null>(
    cachedLatest ? { year: cachedLatest.year } : null,
  )
  const [detail, setDetail] = useState<YearDetail | null>(() =>
    cachedLatest
      ? (getSnapshot<YearDetail>(detailKey(cachedLatest.year, cachedLatest.filing_status)) ??
        null)
      : null,
  )
  const [loading, setLoading] = useState(cachedYears === undefined) // the year list
  // A FIRST list load that failed must not also claim the database is empty: the empty
  // state belongs to a load that actually came back (PortfolioPage's null-holdings rule).
  const [loadedOnce, setLoadedOnce] = useState(cachedYears !== undefined)
  const [busy, setBusy] = useState(true) // the selected year's three payloads
  const [error, setError] = useState<string | null>(null)
  const [newYear, setNewYear] = useState(() =>
    cachedYears !== undefined
      ? String(cachedLatest ? cachedLatest.year + 1 : new Date().getFullYear())
      : '',
  )
  const [creating, setCreating] = useState(false)
  // The status PATCH is single-flight of its own: it is not a "load", so it must not ride the
  // detail `busy` flag, and a second press mid-flight would race two reloads of one year.
  const [statusSaving, setStatusSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // What the two editors report about their own unsaved work — a reload destroys it, so
  // every path that reloads asks first.
  const [inputsDirty, setInputsDirty] = useState(false)
  const [bracketsDirty, setBracketsDirty] = useState(false)
  // A save moves the engine's answer for one year, which moves that year's column in the
  // panel's ALL-years trend too. The panel owns that feed, so the page just counts the
  // saves whose totals actually landed and lets the panel refetch on the new value —
  // cheaper than hoisting a second load chain into this component's eleven setters.
  const [trendRefresh, setTrendRefresh] = useState(0)
  // Year chips can be clicked faster than three requests come back — a slow earlier year
  // must never overwrite a later one (PortfolioPage's guard).
  const seqRef = useRef(0)
  // The totals refetch runs its own race: two saves in a row are two summaries in flight,
  // and only the newest may land (or raise a banner). loadYear bumps it too, so a refresh
  // started under the previous year cannot report anything at all.
  const summarySeqRef = useRef(0)
  // The year the page belongs to RIGHT NOW, readable from a callback that a since-unmounted
  // editor is still holding (its closure remembers the year it was rendered for).
  const currentYearRef = useRef<number | null>(null)

  const selectedYear = selection?.year ?? null
  // The selected year's ROW, so the selector reads the same list the chips do — one source
  // for "how is this year filed". A year the list has not caught up with (the optimistic
  // chip a create just pushed) reads as 'single', which is the column's own default.
  const filingStatus: FilingStatus =
    years.find((y) => y.year === selectedYear)?.filing_status ?? 'single'
  // Only while the editors are mounted: a failed load unmounts them, and their last
  // reported flag must not outlive them into a spurious confirm.
  const dirty = detail !== null && (inputsDirty || bracketsDirty)

  // The year list alone: no selection change, no busy flip, nothing that blinks. It is the
  // reconciler behind an optimistic create and behind the chip counts a save moves, and
  // each caller decides for itself what a rejection means.
  const reconcileYears = () => fetchTaxYears().then((list) => setYears(list))

  // Counts on the chips are decoration. A save that SUCCEEDED must not end at an error
  // banner because the refresh of its side effects did not, so this one swallows.
  const refreshYearCounts = () => {
    reconcileYears().catch(() => undefined)
  }

  // Promise callbacks only: no setState in an effect's synchronous body (react-hooks 7).
  // The mount fetch is covered by the initial loading/busy values; the retry button flips
  // them itself. Re-created per render but reading no reactive value beyond the setters,
  // so exhaustive-deps has nothing to report (PortfolioPage's `load`).
  const loadYears = () => {
    fetchTaxYears()
      .then((list) => {
        const previous = getSnapshot<TaxYearOut[]>('taxes:years')
        setSnapshot('taxes:years', list)
        setLoadedOnce(true)
        setError(null)
        // Identical list: everything on screen already came from the same seed (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(list)) {
          if (!latestOf(list)) setBusy(false) // seeded-empty case: nothing to load
          return
        }
        setYears(list)
        const latest = latestOf(list)
        setNewYear(String(latest ? latest.year + 1 : new Date().getFullYear()))
        if (latest) {
          setSelection({ year: latest.year })
        } else {
          // Fresh database: there is nothing to load, so release the detail flag here —
          // the new-year form IS the page.
          setBusy(false)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
        setBusy(false)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadYears()
  }, [])

  // The chain lives inline rather than in a useCallback: this component owns eleven
  // setters, and manual memoization React Compiler cannot preserve drops the whole
  // component out of compilation (MonthlyUpdatePage's note).
  // `filingStatus` is a second reload key, not just a read: the brackets GET names a status
  // (its server-side default is 'single', NOT the year's own), so the tables on screen would
  // otherwise be single's under a married year. Both it and `selection` move in ONE batched
  // render on a status flip, so the pair re-runs this effect exactly once.
  useEffect(() => {
    if (selection === null) return
    const year = selection.year
    currentYearRef.current = year
    const seq = ++seqRef.current
    Promise.all([
      fetchTaxInputs(year),
      fetchTaxBrackets(year, filingStatus),
      fetchTaxSummary(year),
    ])
      .then(([inputs, brackets, summary]) => {
        if (seq !== seqRef.current) return
        const payload: YearDetail = { inputs, brackets, summary }
        const key = detailKey(year, filingStatus)
        const previous = getSnapshot<YearDetail>(key)
        setSnapshot(key, payload)
        // Identical payload: nothing re-renders (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(payload))
          return
        setDetail(payload)
        // No setError(null) here: every path that selects a year already cleared the
        // banner, and clearing it again would wipe a message raised meanwhile by the
        // list reconcile that runs ALONGSIDE this load (the create flow's).
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // Drop the previous year's data: left on screen it would read as this year's.
        setDetail(null)
        setError(err instanceof ApiError ? err.message : `Failed to load tax year ${year}`)
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }, [selection, filingStatus])

  // The "we are fetching" flip lives in the handlers that cause a fetch, never in the
  // effect above.
  const loadYear = (year: number) => {
    setBusy(true)
    setError(null)
    // A create error is about the form above, and the form's own state moved on the moment
    // the user navigated — leaving the sentence there would answer a question nobody asked.
    setCreateError(null)
    // Any totals refresh still in flight belongs to the year being left.
    summarySeqRef.current += 1
    // Already-seen year: paint its detail instantly and revalidate underneath.
    const status = years.find((y) => y.year === year)?.filing_status ?? 'single'
    const peeked = getSnapshot<YearDetail>(detailKey(year, status))
    if (peeked !== undefined) setDetail(peeked)
    setSelection({ year })
  }

  // The house confirm (TransactionsPanel's delete): a reload replaces both editors'
  // payloads, so unsaved work is gone the moment one starts.
  const confirmDiscard = () =>
    !dirty || window.confirm(`Discard unsaved changes for ${selectedYear}?`)

  const selectYear = (year: number) => {
    // Re-clicking the selected chip must not refetch (MonthlyUpdatePage's same-month
    // lesson: the identity would change and the whole page would blink).
    if (year === selection?.year) return
    if (!confirmDiscard()) return
    loadYear(year)
  }

  // The FIFTH reload door (chips, Retry, create, delete, status). Everything the engine
  // reads moves with the status — bracket tables are stored per (jurisdiction, status), the
  // per-person inputs split into two columns, and the summary is computed against the
  // status-selected tables — so it goes through the SAME discard gate and the same
  // loadYear(), whose fresh `{year}` object (together with the row this replaces) is what
  // re-runs the load effect for the year already on screen.
  const changeFilingStatus = (next: FilingStatus) => {
    if (selectedYear === null || next === filingStatus || statusSaving) return
    if (!confirmDiscard()) return
    const year = selectedYear
    setStatusSaving(true)
    setError(null)
    patchTaxYear(year, { filing_status: next })
      .then((row) => {
        // The echo is authoritative, and replacing the row HERE means the selector follows
        // even if no list reload ever happens.
        setYears((current) => current.map((y) => (y.year === row.year ? row : y)))
        loadYear(year)
      })
      .catch((err: unknown) => {
        // A 422 (an unknown status) or a 404 (the year went away) lands here verbatim. The
        // selection is untouched, so the control still reads the row the server has.
        setError(
          err instanceof ApiError ? err.message : `Failed to set the filing status for ${year}`,
        )
      })
      .finally(() => setStatusSaving(false))
  }

  // Saving inputs or brackets moves the engine's answer, so the totals line is refetched.
  // Guarded twice: by SEQUENCE, so two saves in a row cannot let the slower one's totals
  // land last (or its failure raise a banner over the newer one's success), and by YEAR,
  // so an echo that outlives a year switch cannot be read as the new year's.
  const refreshSummary = (year: number) => {
    const seq = ++summarySeqRef.current
    fetchTaxSummary(year)
      .then((summary) => {
        if (seq !== summarySeqRef.current) return
        setDetail((current) =>
          current !== null && current.summary.year === summary.year
            ? { ...current, summary }
            : current,
        )
        // Only here: a refresh that the guards above dropped changed nothing on screen,
        // and refetching the trend for it would be a request with nothing to show.
        setTrendRefresh((n) => n + 1)
      })
      .catch((err: unknown) => {
        if (seq !== summarySeqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Failed to refresh the totals')
      })
  }

  // A save that outlived a year switch echoes for a year nobody is looking at: the updaters
  // below drop it, and so must its side effects — refetching that year's totals would spend
  // a request whose only possible outcomes are "ignored" and "a banner about a dead year".
  const isStaleEcho = (year: number) => year !== currentYearRef.current

  const onInputsSaved = (echo: TaxInputsOut) => {
    setDetail((current) =>
      current !== null && current.inputs.year === echo.year ? { ...current, inputs: echo } : current,
    )
    if (isStaleEcho(echo.year)) return
    refreshSummary(echo.year)
    // The chips carry input/bracket counts, and this save just moved one of them.
    refreshYearCounts()
  }

  const onBracketsSaved = (echo: TaxBracketsOut) => {
    setDetail((current) =>
      current !== null &&
      current.brackets.year === echo.year &&
      // `detail.brackets` is the tables the ENGINE reads — the year's own status'. The editor
      // has status TABS, so a save (or a clone) can legitimately answer for another status:
      // adopting that here would put tables the engine never walks under the year's heading
      // AND change bracketsKey mid-edit, remounting the editor over its own work.
      current.brackets.filing_status === echo.filing_status
        ? { ...current, brackets: echo }
        : current,
    )
    if (isStaleEcho(echo.year)) return
    refreshSummary(echo.year)
    refreshYearCounts()
  }

  const createYear = () => {
    const year = Number(newYear.trim())
    if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
      setCreateError(`Enter a year between ${YEAR_MIN} and ${YEAR_MAX}`)
      return
    }
    // Third of the three reload doors (chips, Retry, create): creating a year jumps to
    // it and remounts the editors, so it needs the same discard gate — and it must sit
    // before the request so a declined confirm can't orphan a created year.
    if (!confirmDiscard()) return
    // Seed from the newest year that actually HAS brackets. With none — a fresh database,
    // or a year list imported inputs-first — an empty inputs PUT is what creates the
    // tax_years row (both PUTs auto-create it; that IS the "new year" affordance).
    const source = latestOf(years.filter((y) => y.bracket_count > 0))
    setCreating(true)
    setCreateError(null)
    const request = source
      ? cloneBrackets(year, source.year)
      : putTaxInputs(year, { values: {} })
    request
      .then(() => {
        // The year EXISTS from here on, so nothing past this point may be reported as a
        // create failure: under the form the only affordance left is Create, and a second
        // Create against a year that now has brackets answers 409 forever.
        setNewYear(String(year + 1))
        // Show it immediately, with placeholder counts the reconcile below overwrites — a
        // failed list reload otherwise leaves the page sitting on the OLD year with no
        // trace of the one that was just made.
        setYears((current) =>
          current.some((y) => y.year === year)
            ? current
            : [
                ...current,
                // 'single' is the column's own default, so the placeholder cannot claim a
                // status the row does not have; the reconcile below replaces it either way.
                // `satisfies`, not a bare literal: inside the array the status would widen
                // to plain `string` and stop being a FilingStatus.
                {
                  year,
                  notes: null,
                  input_count: 0,
                  bracket_count: 0,
                  filing_status: 'single',
                } satisfies TaxYearOut,
              ].sort((a, b) => a.year - b.year),
        )
        loadYear(year)
        // The main banner owns this one, because the main banner is the thing with Retry.
        return reconcileYears().catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
        })
      })
      .catch((err: unknown) => {
        // 409 (the target already has brackets) and 404 (the source has none) both land
        // here verbatim — the year list is untouched, so nothing jumps.
        setCreateError(err instanceof ApiError ? err.message : 'Could not create the tax year')
      })
      .finally(() => setCreating(false))
  }

  // The FOURTH reload door (chips, Retry, create, delete), and the only one that asks its
  // own question instead of confirmDiscard()'s: deleting the year throws away the SAVED
  // inputs and brackets as well as the typed ones, so "discard unsaved changes?" is a
  // weaker question with nothing left to add. One confirm, never two.
  const deleteYear = () => {
    if (selectedYear === null) return
    const year = selectedYear
    const ok = window.confirm(
      `Delete tax year ${year} and all of its inputs and brackets? This cannot be undone.`,
    )
    if (!ok) return
    // Everything still in flight belongs to a year that is going away: the detail seq (a
    // load that would repopulate the editors from a 404) and the totals seq (a refresh
    // whose only possible outcome is a banner about a year nobody can look at).
    const seq = ++seqRef.current
    summarySeqRef.current += 1
    // Nulled HERE, with the seq bumps, and not in the .then: the switch door (loadYear) does
    // its ref work synchronously at click time, and two tests pin that a save echoing after
    // a switch never banners. The delete door upholds the same invariant — a save echoing
    // back MID-delete must not spend a summary refresh or a list GET on the dying year.
    currentYearRef.current = null
    setBusy(true)
    setError(null)
    // An editor save that is still in flight and COMMITS after this request recreates the
    // year server-side (both PUTs `_ensure_year`; a deletion is not a tombstone). Accepted
    // single-user TOCTOU class: the next list load shows the year again, and the user
    // deletes it again.
    deleteTaxYear(year)
      .then(() => {
        // Gone on the server whoever is looking at the page by now, so the chip goes
        // unguarded — the create path's optimistic list edit, inverted.
        setYears((current) => current.filter((y) => y.year !== year))
        if (seq !== seqRef.current) return
        // No year is selected any more — the ref that says which year the page belongs to
        // was nulled at click time, above.
        setSelection(null)
        setDetail(null)
        setInputsDirty(false)
        setBracketsDirty(false)
        // The panel unmounts with the selection and refetches when a year is next selected,
        // so this is the counter staying honest rather than the thing that redraws it.
        setTrendRefresh((n) => n + 1)
        // The year EXISTS no more from here on, so nothing past this point may be reported
        // as a delete failure: the main banner owns it, because the main banner has Retry.
        return reconcileYears().catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
        })
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // The delete failed, so the year is still the page's: put the ref back, or every
        // later save echo would read as stale. INSIDE the seq guard — outside it, a newer
        // load's year would be clobbered by this dead one.
        currentYearRef.current = year
        // A 404 (someone deleted it first) lands here verbatim. The selection is untouched,
        // so Retry still means "reload the year I am looking at".
        setError(err instanceof ApiError ? err.message : `Failed to delete tax year ${year}`)
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  const retry = () => {
    if (!confirmDiscard()) return
    setError(null)
    if (selectedYear === null) {
      setLoading(true)
      setBusy(true)
      loadYears()
      return
    }
    loadYear(selectedYear)
    // The banner may have come from the LIST (a create whose reload failed leaves an
    // un-reconciled placeholder chip), so retry that too rather than only the detail.
    reconcileYears().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
    })
  }

  return (
    <div className="page taxes-page">
      <div className="page-header">
        <h1>Taxes</h1>
        <div className="spacer" />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          {/* A first-load failure leaves no year selected — retry the list itself, or the
              page dead-ends at the banner. */}
          <button className="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      <section className="card">
        <h2 className="eyebrow">
          Tax year
          <InfoHint text="One column of inputs and bracket tables per year. Creating a year copies the newest year&apos;s brackets." />
        </h2>
        {years.length > 0 && (
          <div className="chip-row">
            {years.map((y) => (
              <button
                key={y.year}
                type="button"
                className={y.year === selectedYear ? 'chip active' : 'chip'}
                aria-pressed={y.year === selectedYear}
                title={`${y.input_count} inputs · ${y.bracket_count} brackets`}
                onClick={() => selectYear(y.year)}
              >
                {y.year}
              </button>
            ))}
          </div>
        )}
        {/* The status of the SELECTED year, not another year to pick: its own row under the
            chips, in the app-wide segmented treatment (RangeChips' .segmented, declared once
            in panels.css). */}
        {selectedYear !== null && (
          <div className="filing-status-row">
            <span className="filing-status-label">Filing status</span>
            <InfoHint text="Which bracket tables the engine walks for this year, and whether the per-person inputs below split into two columns. Every year starts as Single." />
            <div className="segmented" role="group" aria-label="Filing status">
              {FILING_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={status === filingStatus ? 'active' : ''}
                  aria-pressed={status === filingStatus}
                  disabled={statusSaving || busy}
                  onClick={() => changeFilingStatus(status)}
                >
                  {FILING_STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Standing, never dismissible: MFS brackets without Form-8958 community-income
            splitting are wrong in California, and the sentence has to sit wherever the
            number does (audit §3.2, design decision log "MFS"). */}
        {selectedYear !== null && filingStatus === 'married_separate' && (
          <p className="filing-status-caveat" role="note">
            California is a community-property state; true MFS requires 50/50
            community-income splitting (Form 8958), which this calculator does not model.
          </p>
        )}
        {/* loadedOnce, not !loading: a FIRST load that failed knows nothing about whether
            there are years, and "No tax years yet" under an error banner reads as an
            answer. */}
        {loadedOnce && years.length === 0 && (
          <p className="empty-note">No tax years yet — create one to start.</p>
        )}
        <form
          className="new-year-form"
          // The bounds are enforced (and worded) by createYear. Left to the browser, the
          // message is a native bubble that differs per engine and blocks submit before
          // this page ever sees it.
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            createYear()
          }}
        >
          <label htmlFor="new-tax-year">New year</label>
          <input
            id="new-tax-year"
            className="field-input"
            type="number"
            inputMode="numeric"
            min={YEAR_MIN}
            max={YEAR_MAX}
            value={newYear}
            onChange={(e) => {
              setNewYear(e.target.value)
              // The sentence below describes the year that WAS in the box.
              setCreateError(null)
            }}
          />
          <button type="submit" className="button" disabled={creating || loading}>
            {creating ? 'Creating…' : 'Create year'}
          </button>
          {/* The other end of this row's job — Create makes the year in the box, Delete
              throws away the SELECTED one — and the one control row that renders even with
              no years, so its shut state is visible rather than absent. type="button", so
              the form's submit stays the create path's alone. */}
          <button
            type="button"
            className="button"
            disabled={selectedYear === null || busy || creating}
            onClick={deleteYear}
          >
            Delete year…
          </button>
          <span className="drill-hint">
            Copies the newest year&apos;s bracket tables; the values are then edited below.
          </span>
        </form>
        {createError && (
          <div className="error-banner" role="alert">
            {createError}
          </div>
        )}
      </section>

      {(loading || (busy && detail === null && years.length > 0)) && (
        <PageSkeleton
          cards={[
            { span: 12, height: 90 },
            { span: 12, height: 320 },
          ]}
        />
      )}

      {/* Only a delete gets here: every other path either selects a year or has no years to
          select. Without it the page ends at the form with nothing saying the chips above
          are waiting for a click. Mutually exclusive with the note above, by !busy. */}
      {!loading && !busy && selection === null && years.length > 0 && (
        <p className="empty-note">Select a tax year above.</p>
      )}

      {detail !== null && (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          {/* Deliberately NOT keyed by year: the panel's own feed is the all-years trend,
              which a year switch does not move — remounting it would spend a request to
              redraw the same chart. Its per-year half is a prop, so it follows the year
              anyway. */}
          <SummaryPanel
            summary={detail.summary}
            filingStatus={filingStatus}
            refreshKey={trendRefresh}
          />
          {/* D3 (2026-08-31): client-side ladder over the SAME two payloads the panels
              around it read — the summary and the year's own status' tables. Not keyed:
              both props are per-year payloads the load effect already replaces whole. */}
          <MarginalPanel summary={detail.summary} brackets={detail.brackets} />
          {/* The CURRENT year only, mirroring the endpoint's own 422 (a settled year may well
              be stored and summarizable, and this card still cannot be drawn for it) — asked
              here rather than spending a request on the refusal. Keyed by year like the card
              below, so a switch INTO this year mounts it fresh rather than leaving another
              year's estimate under this heading. */}
          {detail.summary.year === new Date().getFullYear() && (
            <WithholdingPanel
              key={`withholding-${detail.summary.year}`}
              year={detail.summary.year}
            />
          )}
          {/* Keyed by year for the editors' own reason: a real switch remounts it, so the
              typed legs and any scenario on screen go with the year they were run against
              (a stale scenario under a new year's heading would lie), while a same-year
              reload leaves half-typed legs alone. It owns its two feeds and loads them
              lazily on first open, so the remount costs nothing until the card is used.
              The seeds are handed to EVERY mount, this year's or the next one's: they are a
              property of the URL, not of the year, and the panel pins them at its own mount
              — so a year switch re-seeds the same leg against the year now on screen, which
              is what a link that says "model selling VTI" means. */}
          <WhatIfPanel
            key={`whatif-${detail.summary.year}`}
            year={detail.summary.year}
            initialTicker={whatIfTicker}
            initialLotId={whatIfLotId}
          />
          {/* Keyed by the payloads' own identity (see inputsKey/bracketsKey), not by load:
              a real year or status switch remounts the editors — 2023's typed rows must not
              carry into 2024, and a one-column year's cell ids are not a two-column year's —
              while a same-year same-status reload (Retry, or the refresh after a save) leaves
              them mounted. Their state seeds from useState initializers, so the replaced
              props cannot clobber typed work either. */}
          <InputsForm
            key={inputsKey(detail.inputs)}
            inputs={detail.inputs}
            onSaved={onInputsSaved}
            onDirtyChange={setInputsDirty}
          />
          <BracketsEditor
            key={bracketsKey(detail.brackets)}
            brackets={detail.brackets}
            yearStatus={filingStatus}
            onSaved={onBracketsSaved}
            onDirtyChange={setBracketsDirty}
          />
        </div>
      )}
    </div>
  )
}
