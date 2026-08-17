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
// year's brackets under another year's totals. `id` is the load that produced them, and
// it re-keys the editors so a reload drops their in-progress local state.
interface YearDetail {
  id: number
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
  const [busy, setBusy] = useState(true) // the selected year's three payloads
  const [error, setError] = useState<string | null>(null)
  const [newYear, setNewYear] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Year chips can be clicked faster than three requests come back — a slow earlier year
  // must never overwrite a later one (PortfolioPage's guard).
  const seqRef = useRef(0)

  // Promise callbacks only: no setState in an effect's synchronous body (react-hooks 7).
  // The mount fetch is covered by the initial loading/busy values; the retry button flips
  // them itself. Re-created per render but reading no reactive value beyond the setters,
  // so exhaustive-deps has nothing to report (PortfolioPage's `load`).
  const loadYears = () => {
    fetchTaxYears()
      .then((list) => {
        setYears(list)
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
    const seq = ++seqRef.current
    Promise.all([fetchTaxInputs(year), fetchTaxBrackets(year), fetchTaxSummary(year)])
      .then(([inputs, brackets, summary]) => {
        if (seq !== seqRef.current) return
        setDetail({ id: seq, inputs, brackets, summary })
        setError(null)
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
    setSelection({ year })
  }

  const selectYear = (year: number) => {
    // Re-clicking the selected chip must not refetch (MonthlyUpdatePage's same-month
    // lesson: the identity would change and the whole page would blink).
    if (year === selection?.year) return
    loadYear(year)
  }

  // Saving inputs or brackets moves the engine's answer, so the totals line is refetched.
  // Guarded by year, not by sequence: an echo that arrives after a year switch belongs to
  // the year that is gone.
  const refreshSummary = (year: number) => {
    fetchTaxSummary(year)
      .then((summary) => {
        setDetail((current) =>
          current !== null && current.summary.year === summary.year
            ? { ...current, summary }
            : current,
        )
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to refresh the totals')
      })
  }

  const onInputsSaved = (echo: TaxInputsOut) => {
    setDetail((current) =>
      current !== null && current.inputs.year === echo.year ? { ...current, inputs: echo } : current,
    )
    refreshSummary(echo.year)
  }

  const onBracketsSaved = (echo: TaxBracketsOut) => {
    setDetail((current) =>
      current !== null && current.brackets.year === echo.year
        ? { ...current, brackets: echo }
        : current,
    )
    refreshSummary(echo.year)
  }

  const createYear = () => {
    const year = Number(newYear.trim())
    if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
      setCreateError(`Enter a year between ${YEAR_MIN} and ${YEAR_MAX}`)
      return
    }
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
      .then(() => fetchTaxYears())
      .then((list) => {
        setYears(list)
        setNewYear(String(year + 1))
        loadYear(year)
      })
      .catch((err: unknown) => {
        // 409 (the target already has brackets) and 404 (the source has none) both land
        // here verbatim — the year list is untouched, so nothing jumps.
        setCreateError(err instanceof ApiError ? err.message : 'Could not create the tax year')
      })
      .finally(() => setCreating(false))
  }

  const selectedYear = selection?.year ?? null
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
          <button
            className="button"
            onClick={() => {
              setError(null)
              if (selectedYear === null) {
                setLoading(true)
                setBusy(true)
                loadYears()
              } else {
                loadYear(selectedYear)
              }
            }}
          >
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
        {!loading && years.length === 0 && (
          <p className="empty-note">No tax years yet — create one to start.</p>
        )}
        <form
          className="new-year-form"
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
            onChange={(e) => setNewYear(e.target.value)}
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
          <InputsForm key={`inputs-${detail.id}`} inputs={detail.inputs} onSaved={onInputsSaved} />
          <BracketsEditor
            key={`brackets-${detail.id}`}
            brackets={detail.brackets}
            onSaved={onBracketsSaved}
          />
        </div>
      )}
    </div>
  )
}
