import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAllTaxSummaries } from '../../api/taxes'
import EChart from '../EChart'
import type { EChartEventParams } from '../EChart'
import InfoHint from '../InfoHint'
import type { TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
import { taxTrendCsv, trendOption, yearPieOption } from './taxChartOptions'
// Only this component's own sheet, like its siblings: the app-wide vocabulary
// (.card/.eyebrow/.empty-note/.error-banner) is panels.css, which the PAGE imports.
import { FeedBanner } from '../shell/Feed'
import './taxes.css'

/**
 * The all-years composition trend — whose bars drill into a per-year jurisdiction pie on
 * click (SpendingPage's month pie). Split out of SummaryPanel (2026-08-31 audit) so the
 * year-scoped answer cards can sit contiguously and this card can close the answers half.
 *
 * The feed is this panel's own: it is all-years, so a year switch does not move it, and
 * it reloads only when the page says the engine's answer moved — a save or a
 * filing-status flip — via `refreshKey`.
 */
export default function CompositionPanel({
  refreshKey = 0,
}: {
  /** Bumped by the page after a save's fresh totals land; each new value refetches. */
  refreshKey?: number
}) {
  // null = the feed has not answered yet (never [] — an empty feed is a real answer, and
  // the two say different things under the chart).
  const [years, setYears] = useState<TaxSummaryOut[] | null>(null)
  // The years the feed had to SKIP: a year whose filing status has no bracket tables carries
  // no sections at all, so the trend leaves it out rather than drawing a zero column that
  // would read as a real answer. Named under the chart instead.
  const [incompleteYears, setIncompleteYears] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  // Year drill-in: the year whose jurisdiction pie replaces the trend chart — READ from
  // the URL (?year=YYYY, 2026-08-25 spec §2d) so a drill is shareable. Stored as the
  // YEAR (never an index); a year the feed does not carry — including any garbled param,
  // which the integer fence below already nulls (TaxesPage's whatif-lot idiom) — falls
  // back to the all-years view through the detailSummary find.
  const [searchParams, setSearchParams] = useSearchParams()
  const yearParam = Number(searchParams.get('year'))
  const detailYear = Number.isInteger(yearParam) && yearParam > 0 ? yearParam : null
  const setDetailYear = (year: number | null) => {
    // replace, not push (SpendingPage's drill rule) — and a COPY, so the page's own
    // ?whatif= seeds ride along untouched.
    setSearchParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (year === null) copy.delete('year')
        else copy.set('year', String(year))
        return copy
      },
      { replace: true },
    )
  }
  // Two saves in a row are two feeds in flight; only the newest may land or complain.
  const seqRef = useRef(0)

  // Promise callbacks only — no setState in the effect's synchronous body (react-hooks 7).
  // Nothing flips a "loading" flag on a REFRESH either: the chart on screen is still true
  // until the newer one arrives, and blanking it would make every save blink.
  useEffect(() => {
    const seq = ++seqRef.current
    fetchAllTaxSummaries()
      .then((data) => {
        if (seq !== seqRef.current) return
        setYears(data.years)
        setIncompleteYears((data.incomplete ?? []).map((row) => row.year))
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Failed to load the multi-year trend')
      })
  }, [refreshKey])

  // Belt-and-braces against the feed's own contract: `years` should never contain a refusal
  // year (its sections are null, so trendOption would read figures that are not there), and
  // one that slipped through is named alongside the feed's own `incomplete` list rather than
  // charted.
  const chartable = useMemo(
    () =>
      years === null
        ? null
        : years.filter((y) => (y.brackets_missing_for_status ?? []).length === 0),
    [years],
  )
  const flaggedYears = useMemo(() => {
    const slipped = (years ?? [])
      .filter((y) => (y.brackets_missing_for_status ?? []).length > 0)
      .map((y) => y.year)
    return [...new Set([...incompleteYears, ...slipped])].sort((a, b) => a - b)
  }, [years, incompleteYears])
  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object every
  // render replays the chart on unrelated state flips (AllocationPanel's note).
  const trend = useMemo(
    () => (chartable === null ? null : trendOption(chartable)),
    [chartable],
  )

  // The drilled year's summary comes out of THIS panel's all-years feed, so a save that
  // moves the year's figures redraws the open pie with the fresh ones. From `chartable`, not
  // `years`: a refusal year carries no sections, so a ?year= deep link to one would read
  // figures that are not there — and the panel falls back to the all-years view instead.
  const detailSummary = useMemo(
    () =>
      detailYear === null || chartable === null
        ? null
        : (chartable.find((y) => y.year === detailYear) ?? null),
    [chartable, detailYear],
  )
  const detailPie = useMemo(
    () => (detailSummary === null ? null : yearPieOption(detailSummary)),
    [detailSummary],
  )

  const handleTrendClick = (params: EChartEventParams) => {
    if (detailSummary !== null) {
      setDetailYear(null) // any chart click in detail mode returns to all years
      return
    }
    // The category NAME is the year on every clickable series (bars and rate line
    // alike) — a dataIndex would have to re-derive trendOption's own ascending sort.
    const year = Number(params.name)
    if (chartable !== null && chartable.some((y) => y.year === year)) setDetailYear(year)
  }

  return (
    <section className="card">
      <div className="tax-chart-header">
        <h2 className="eyebrow">
          {detailSummary
            ? `Tax breakdown — ${detailSummary.year}`
            : 'Tax composition and effective rate by year'}
          <InfoHint text="Tax composition per year stacked by jurisdiction, with the overall effective rate on the right axis. Click a year for its breakdown." />
        </h2>
        {detailSummary && (
          <button className="button" onClick={() => setDetailYear(null)}>
            All years
          </button>
        )}
      </div>
      <FeedBanner error={error} />
      {detailSummary ? (
        <>
          <p className="drill-hint">
            {/* The SERVER's totals, negatives and all — the pie can only draw the
                positive slices (yearPieOption's note). */}
            Total tax {formatCurrency(detailSummary.totals.total_tax)} · Gross{' '}
            {formatCurrency(detailSummary.totals.gross_income)} · Effective rate{' '}
            {detailSummary.totals.effective_rate === null
              ? '—'
              : formatPct(detailSummary.totals.effective_rate, { signed: false })}{' '}
            — click the chart to go back.
          </p>
          {detailPie ? (
            <EChart option={detailPie} height={320} onClick={handleTrendClick} />
          ) : (
            <p className="empty-note">No tax computed for {detailSummary.year}.</p>
          )}
        </>
      ) : trend && chartable ? (
        <>
          <p className="drill-hint">Click a year&apos;s bar to expand its tax breakdown.</p>
          {flaggedYears.length > 0 && (
            <p className="drill-hint">
              Not charted: {flaggedYears.join(', ')} — no bracket tables for that
              year&apos;s filing status.
            </p>
          )}
          <EChart
            option={trend}
            height={320}
            onClick={handleTrendClick}
            exportConfig={{ name: 'tax-trend', csv: () => taxTrendCsv(chartable) }}
          />
        </>
      ) : (
        !error && (
          <p className="empty-note">
            {years === null
              ? 'Loading…'
              : flaggedYears.length > 0
                ? 'No comparable years yet — every year with stored inputs is missing bracket tables for its filing status.'
                : 'No years with stored inputs to compare yet.'}
          </p>
        )
      )}
    </section>
  )
}
