import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  cloneBrackets,
  fetchTaxBrackets,
  fetchTaxInputs,
  fetchTaxSummary,
  fetchTaxYears,
  putTaxInputs,
} from '../api/taxes'
import BracketsEditor from '../components/taxes/BracketsEditor'
import InputsForm from '../components/taxes/InputsForm'
import type { TaxBracketsOut, TaxInputsOut, TaxSummaryOut, TaxYearOut } from '../types/api'
import { formatCurrency, formatPct } from '../utils/format'
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

function latestOf(years: TaxYearOut[]): TaxYearOut | undefined {
  // The router already orders by year; reducing makes the page independent of that.
  return years.length === 0 ? undefined : years.reduce((a, b) => (b.year > a.year ? b : a))
}

export default function TaxesPage() {
  const [years, setYears] = useState<TaxYearOut[]>([])
  // An OBJECT, not a bare number: a fresh identity re-runs the load effect, so selecting
  // the year that is already selected (right after cloning into it) still refetches.
  const [selection, setSelection] = useState<{ year: number } | null>(null)
  const [detail, setDetail] = useState<YearDetail | null>(null)
  const [loading, setLoading] = useState(true) // the year list
  // A FIRST list load that failed must not also claim the database is empty: the empty
  // state belongs to a load that actually came back (PortfolioPage's null-holdings rule).
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [busy, setBusy] = useState(true) // the selected year's three payloads
  const [error, setError] = useState<string | null>(null)
  const [newYear, setNewYear] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // What the two editors report about their own unsaved work — a reload destroys it, so
  // every path that reloads asks first.
  const [inputsDirty, setInputsDirty] = useState(false)
  const [bracketsDirty, setBracketsDirty] = useState(false)
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
        setYears(list)
        setLoadedOnce(true)
        setError(null)
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
  useEffect(() => {
    if (selection === null) return
    const year = selection.year
    currentYearRef.current = year
    const seq = ++seqRef.current
    Promise.all([fetchTaxInputs(year), fetchTaxBrackets(year), fetchTaxSummary(year)])
      .then(([inputs, brackets, summary]) => {
        if (seq !== seqRef.current) return
        setDetail({ inputs, brackets, summary })
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
  }, [selection])

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
      current !== null && current.brackets.year === echo.year
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
            : [...current, { year, notes: null, input_count: 0, bracket_count: 0 }].sort(
                (a, b) => a.year - b.year,
              ),
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

  const totals = detail?.summary.totals

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
        <h2 className="eyebrow">Tax year</h2>
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
        <p className="empty-note">Loading…</p>
      )}

      {detail !== null && (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          {/* Task 7 replaces this block with <SummaryPanel/> (waterfall, trends, warnings
              and stat tiles). Until then the raw server totals stand in — every number
              here is the engine's, never re-derived on the client. */}
          <section className="card">
            <h2 className="eyebrow">Totals — {detail.summary.year}</h2>
            <dl className="tax-totals">
              <div>
                <dt>Gross income</dt>
                <dd>{formatCurrency(totals?.gross_income)}</dd>
              </div>
              <div>
                <dt>Total tax</dt>
                <dd>{formatCurrency(totals?.total_tax)}</dd>
              </div>
              <div>
                <dt>Take-home</dt>
                <dd>{formatCurrency(totals?.take_home)}</dd>
              </div>
              <div>
                <dt>Effective rate</dt>
                <dd>{formatPct(totals?.effective_rate, { signed: false })}</dd>
              </div>
            </dl>
          </section>
          {/* Keyed by YEAR, not by load: a real switch remounts the editors (2023's typed
              rows must not carry into 2024), while a same-year reload — Retry, or the
              refresh after a save — leaves them mounted. Their state seeds from useState
              initializers, so the replaced props cannot clobber typed work either. */}
          <InputsForm
            key={`inputs-${detail.inputs.year}`}
            inputs={detail.inputs}
            onSaved={onInputsSaved}
            onDirtyChange={setInputsDirty}
          />
          <BracketsEditor
            key={`brackets-${detail.brackets.year}`}
            brackets={detail.brackets}
            onSaved={onBracketsSaved}
            onDirtyChange={setBracketsDirty}
          />
        </div>
      )}
    </div>
  )
}
