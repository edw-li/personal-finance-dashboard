import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAllTaxSummaries } from '../../api/taxes'
import ChartCard from '../ChartCard'
import type { ChartSelection } from '../../types/metrics'
import SelectionDetail from '../details/SelectionDetail'
import type { TaxSummaryOut } from '../../types/api'
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

  const selectYear = (summary: TaxSummaryOut): ChartSelection => ({
    kind: 'period', id: `tax-year:${summary.year}`, period: String(summary.year), label: `Tax year ${summary.year}`, scope: 'household',
    values: [{ label: 'Total tax', value: summary.totals.total_tax, unit: 'USD' }, { label: 'Gross income', value: summary.totals.gross_income, unit: 'USD' }, { label: 'Effective rate', value: summary.totals.effective_rate, unit: 'ratio' }],
    source: { href: `/taxes?section=summary&year=${summary.year}`, label: `Open ${summary.year} return` },
    context: { year: summary.year },
  })

  return (
    <ChartCard
      title="Tax composition by year"
      hint="Tax composition per year stacked by jurisdiction, with the year's effective rate on each cap. Select a year to inspect its breakdown beside this history."
      ariaLabel="Stacked bar chart of tax by jurisdiction per year, with the effective rate on each cap"
      option={trend}
      empty={flaggedYears.length > 0 ? 'No comparable years yet — every year with stored inputs is missing bracket tables for its filing status.' : 'No years with stored inputs to compare yet.'}
      exportName="tax-trend"
      csv={chartable === null ? undefined : () => taxTrendCsv(chartable)}
      independentRangeLabel="All recorded years"
      height={320}
      busy={years === null && error === null}
      error={error}
      selection={detailSummary ? selectYear(detailSummary) : null}
      onSelectionChange={(selection) => setDetailYear(selection?.kind === 'period' ? Number(selection.period) : null)}
      selectionAdapter={(params) => {
        const summary = chartable?.find((year) => year.year === Number(params.name))
        return summary ? selectYear(summary) : null
      }}
      rowSelection={(row) => {
        const summary = chartable?.find((year) => year.year === Number(row[0]))
        return summary ? selectYear(summary) : null
      }}
      renderSelection={(selection) => <>
        <SelectionDetail selection={selection} chartTitle="Tax composition by year" onClear={() => setDetailYear(null)} />
        {detailSummary && <ChartCard
          title={`Tax breakdown — ${detailSummary.year}`}
          hint="The positive tax components for the selected year. The receipt above includes any negative components in the total."
          ariaLabel={`Donut chart of ${detailSummary.year}'s tax by jurisdiction`}
          option={detailPie}
          empty={`No tax computed for ${detailSummary.year}.`}
          exportName={`tax-breakdown-${detailSummary.year}`}
          csv={() => yearPieCsv(detailSummary)}
          height={260}
        />}
      </>}
      onLegendChange={(selected) => setLegendSelected((current) => ({ ...current, ...selected }))}
      footer={<>
        {trend !== null && <p className="drill-hint">Select a year to pin its values and inspect the calculation.</p>}
        {flaggedYears.length > 0 && <p className="drill-hint">Not charted: {flaggedYears.join(', ')} — no bracket tables for that year's filing status.</p>}
      </>}
    />
  )
}
