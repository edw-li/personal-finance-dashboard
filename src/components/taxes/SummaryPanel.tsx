import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAllTaxSummaries } from '../../api/taxes'
import EChart from '../EChart'
import type { EChartEventParams } from '../EChart'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type { TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
import { taxTrendCsv, trendOption, waterfallOption, yearPieOption } from './taxChartOptions'
// Only this component's own sheet, like its two siblings: the app-wide vocabulary
// (.card/.eyebrow/.kpi-row/.empty-note/.error-banner) is panels.css, which the PAGE
// imports — and StatTile brings it along regardless.
import './taxes.css'

/**
 * The engine's answer for the selected year, told three ways: tiles for the headline
 * figures, a waterfall walking gross income down to take-home, and the all-years trend —
 * whose bars drill into a per-year jurisdiction pie on click (SpendingPage's month pie).
 *
 * The SELECTED year's summary is the page's (it already owns the three-payload load and
 * its year guard). The TREND feed is this panel's own: it is all-years, so a year switch
 * does not move it, and it reloads only when the page says a save landed — `refreshKey`.
 */
export default function SummaryPanel({
  summary,
  refreshKey = 0,
}: {
  summary: TaxSummaryOut
  /** Bumped by the page after a save's fresh totals land; each new value refetches. */
  refreshKey?: number
}) {
  // null = the feed has not answered yet (never [] — an empty feed is a real answer, and
  // the two say different things under the chart).
  const [years, setYears] = useState<TaxSummaryOut[] | null>(null)
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
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Failed to load the multi-year trend')
      })
  }, [refreshKey])

  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object every
  // render replays the chart on unrelated state flips (AllocationPanel's note).
  const waterfall = useMemo(() => waterfallOption(summary), [summary])
  const trend = useMemo(() => (years === null ? null : trendOption(years)), [years])

  // The drilled year's summary comes out of THIS panel's all-years feed, so a save that
  // moves the year's figures redraws the open pie with the fresh ones.
  const detailSummary = useMemo(
    () =>
      detailYear === null || years === null
        ? null
        : (years.find((y) => y.year === detailYear) ?? null),
    [years, detailYear],
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
    if (years !== null && years.some((y) => y.year === year)) setDetailYear(year)
  }

  const totals = summary.totals

  return (
    <>
      <section className="card">
        <h2 className="eyebrow">
          Totals — {summary.year}
          <InfoHint text="The engine&apos;s answer for this year, computed from the stored inputs and bracket tables below." />
        </h2>
        <div className="kpi-row">
          {/* Every figure is the engine's, rendered as it arrived (global rule 9). */}
          <StatTile
            label="Gross income"
            value={formatCurrency(totals.gross_income)}
            hint="Every income component summed before any tax — the waterfall&apos;s opening bar."
          />
          <StatTile
            label="Total tax"
            value={formatCurrency(totals.total_tax)}
            hint="All six jurisdictions summed: federal, state, Medicare, Social Security, SDI, and capital gains."
          />
          {/* Same size as its three siblings: the hero treatment belongs to pages with ONE
              headline figure, and here it just made take-home shout over the row. */}
          <StatTile
            label="Take-home"
            value={formatCurrency(totals.take_home)}
            hint="Gross income minus total tax."
          />
          <StatTile
            label="Effective rate"
            value={formatPct(totals.effective_rate, { signed: false })}
            hint="Total tax ÷ gross income."
          />
        </div>

        {summary.warnings.length > 0 && (
          // React text nodes, so the engine's sentences are escaped by construction. A
          // sparse year's "missing inputs defaulted to 0: …" names all 21 keys in one
          // line — it wraps (see taxes.css) rather than being clipped or summarised: the
          // list IS the message.
          <div className="tax-warnings">
            {summary.warnings.map((warning, i) => (
              // Index key: a fixed, non-reordered list rendered straight from the payload.
              <p key={i}>{warning}</p>
            ))}
          </div>
        )}

        <div className="tax-chart-block">
          <h3 className="eyebrow">
            Where {summary.year}&apos;s gross income went
            <InfoHint text="Gross income walked down to take-home — each floating bar is one jurisdiction&apos;s bite." />
          </h3>
          {waterfall ? (
            <EChart option={waterfall} height={320} />
          ) : (
            <p className="empty-note">
              Nothing to chart yet — this year computes to zero until its inputs are filled
              in below.
            </p>
          )}
        </div>
      </section>

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
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
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
        ) : trend && years ? (
          <>
            <p className="drill-hint">Click a year&apos;s bar to expand its tax breakdown.</p>
            <EChart
              option={trend}
              height={320}
              onClick={handleTrendClick}
              exportConfig={{ name: 'tax-trend', csv: () => taxTrendCsv(years) }}
            />
          </>
        ) : (
          !error && (
            <p className="empty-note">
              {years === null ? 'Loading…' : 'No years with stored inputs to compare yet.'}
            </p>
          )
        )}
      </section>
    </>
  )
}
