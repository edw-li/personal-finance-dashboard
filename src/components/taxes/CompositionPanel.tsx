import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAllTaxSummaries } from '../../api/taxes'
import ChartCard from '../ChartCard'
import type { EChartEventParams } from '../EChart'
import type { TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
import { taxTrendCsv, trendOption, yearPieCsv, yearPieOption } from './taxChartOptions'
// Only this component's own sheet, like its siblings: the app-wide vocabulary
// (.card/.eyebrow/.empty-note/.error-banner) is panels.css, which the PAGE imports.
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
  // the URL (?comp=YYYY, 2026-08-25 spec §2d) so a drill is shareable. Stored as the
  // YEAR (never an index); a year the feed does not carry — including any garbled param,
  // which the integer fence below already nulls — falls back to the all-years view
  // through the detailSummary find.
  //
  // `comp`, not `year`: ?year= is the PAGE's selected tax year (2026-09-03 sandbox lane T),
  // and this is a different question with an answer the page's cannot express — "no drill"
  // is this card's resting state (the all-years trend), while the page always has a year
  // selected. Sharing one param would force a pie open on every visit.
  const [searchParams, setSearchParams] = useSearchParams()
  const compParam = Number(searchParams.get('comp'))
  const detailYear = Number.isInteger(compParam) && compParam > 0 ? compParam : null
  const setDetailYear = (year: number | null) => {
    // replace, not push (SpendingPage's drill rule) — and a COPY, so the page's own ?year=
    // and the what-if card's entries ride along untouched.
    setSearchParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (year === null) copy.delete('comp')
        else copy.set('comp', String(year))
        return copy
      },
      { replace: true },
    )
  }
  // The user's legend picks, mirrored back into the option (F9): a refetch or a theme swap
  // rebuilds the option, and without this every hidden jurisdiction would come back.
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
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
    () => (chartable === null ? null : trendOption(chartable, { selected: legendSelected })),
    [chartable, legendSelected],
  )

  // The drilled year's summary comes out of THIS panel's all-years feed, so a save that
  // moves the year's figures redraws the open pie with the fresh ones. From `chartable`, not
  // `years`: a refusal year carries no sections, so a ?comp= deep link to one would read
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
    <ChartCard
      title={
        detailSummary ? `Tax breakdown — ${detailSummary.year}` : 'Tax composition by year'
      }
      hint="Tax composition per year stacked by jurisdiction, with the year's effective rate on each cap. Click a year for its breakdown."
      ariaLabel={
        detailSummary
          ? `Donut chart of ${detailSummary.year}’s tax by jurisdiction`
          : 'Stacked bar chart of tax by jurisdiction per year, with the effective rate on each cap'
      }
      option={detailSummary ? detailPie : trend}
      empty={
        detailSummary
          ? `No tax computed for ${detailSummary.year}.`
          : flaggedYears.length > 0
            ? 'No comparable years yet — every year with stored inputs is missing bracket tables for its filing status.'
            : 'No years with stored inputs to compare yet.'
      }
      exportName={detailSummary ? `tax-breakdown-${detailSummary.year}` : 'tax-trend'}
      csv={
        detailSummary
          ? () => yearPieCsv(detailSummary)
          : chartable === null
            ? undefined
            : () => taxTrendCsv(chartable)
      }
      height={320}
      busy={years === null && error === null}
      error={error}
      onClick={handleTrendClick}
      onLegendChange={(selected) =>
        setLegendSelected((current) => ({ ...current, ...selected }))
      }
      actions={
        detailSummary ? (
          <button className="button" onClick={() => setDetailYear(null)}>
            All years
          </button>
        ) : undefined
      }
      // Footer prose that describes INTERACTING with the chart is conditioned on there
      // being one: under an empty sentence, "click the chart to go back" and "click a
      // year's bar" point at marks that were never drawn (the All years button is the
      // way back in the first case). Prose that EXPLAINS the emptiness — the flagged
      // years — stays, because that is what a reader wants under an empty card.
      footer={
        detailSummary ? (
          detailPie === null ? undefined : (
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
          )
        ) : (
          <>
            {trend !== null && (
              <p className="drill-hint">Click a year&apos;s bar to expand its tax breakdown.</p>
            )}
            {flaggedYears.length > 0 && (
              <p className="drill-hint">
                Not charted: {flaggedYears.join(', ')} — no bracket tables for that
                year&apos;s filing status.
              </p>
            )}
          </>
        )
      }
    />
  )
}
