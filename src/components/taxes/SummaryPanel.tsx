import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAllTaxSummaries } from '../../api/taxes'
import EChart from '../EChart'
import StatTile from '../StatTile'
import type { TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
import { trendOption, waterfallOption } from './taxChartOptions'
// Only this component's own sheet, like its two siblings: the app-wide vocabulary
// (.card/.eyebrow/.kpi-row/.empty-note/.error-banner) is panels.css, which the PAGE
// imports — and StatTile brings it along regardless.
import './taxes.css'

/**
 * The engine's answer for the selected year, told three ways: tiles for the headline
 * figures, a waterfall walking gross income down to take-home, and the all-years trend.
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

  const totals = summary.totals

  return (
    <>
      <section className="card">
        <h2 className="eyebrow">Totals — {summary.year}</h2>
        <div className="kpi-row">
          {/* Every figure is the engine's, rendered as it arrived (global rule 9). */}
          <StatTile label="Gross income" value={formatCurrency(totals.gross_income)} />
          <StatTile label="Total tax" value={formatCurrency(totals.total_tax)} />
          <StatTile label="Take-home" value={formatCurrency(totals.take_home)} hero />
          <StatTile
            label="Effective rate"
            value={formatPct(totals.effective_rate, { signed: false })}
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
          <h3 className="eyebrow">Where {summary.year}&apos;s gross income went</h3>
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
        <h2 className="eyebrow">Tax composition and effective rate by year</h2>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {trend ? (
          <EChart option={trend} height={320} />
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
