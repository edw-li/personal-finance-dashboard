import { useMemo } from 'react'
import type { MoneyFlowOut } from '../../types/api'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import { moneyFlowOption } from './moneyFlowOptions'
import '../panels.css'
import './moneyFlow.css'

/**
 * The annual money-flow card (2026-08-25 spec §5): presentational only — OverviewPage
 * owns the ISOLATED fetch (the Up-next pattern) and hands the payload down, so a
 * tax-engine hiccup dents this card and never the snapshot. Year chips come from the
 * payload's available_years; the active chip is the payload's own echoed year, so the
 * chip row can never disagree with the chart beside it.
 */
export default function MoneyFlowCard({
  flow,
  failed,
  onRetry,
  onYearChange,
}: {
  flow: MoneyFlowOut | null
  failed: boolean
  onRetry: () => void
  onYearChange: (year: number) => void
}) {
  const option = useMemo(() => (flow === null ? null : moneyFlowOption(flow)), [flow])
  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        {flow === null ? 'Money flow' : `Money flow — ${flow.year}`}
        <InfoHint text="Where the year's money went. Income comes from the year's tax inputs through the tax engine; take-home cash is the entered monthly net pay; the right-hand fan is the year's entered spending. Retained equity & other is the residual — ≈ vest shares kept + ESPP contributions + timing between W-2 income and cash." />
      </h2>
      {flow !== null && flow.available_years.length > 0 && (
        <div className="segmented money-flow-years" role="group" aria-label="Money-flow year">
          {flow.available_years.map((year) => (
            <button
              key={year}
              type="button"
              className={year === flow.year ? 'active' : ''}
              aria-pressed={year === flow.year}
              onClick={() => onYearChange(year)}
            >
              {year}
            </button>
          ))}
        </div>
      )}
      {failed ? (
        <p className="drill-hint">
          Couldn&apos;t load the money flow.{' '}
          <button
            type="button"
            className="button"
            aria-label="Retry loading the money flow"
            onClick={onRetry}
          >
            Retry
          </button>
        </p>
      ) : flow === null ? null : (
        <>
          {option !== null ? (
            // ~17 nodes at most (5 sources + gross + 4 mid + 7 categories + Other +
            // Saved), so 380px keeps every ribbon legible (spec §5's card sizing).
            <EChart
              option={option}
              height={380}
              ariaLabel={`Sankey diagram of ${flow.year} money flow from income sources through taxes, savings and take-home cash to spending categories`}
            />
          ) : (
            // The SERVER's refusal sentence, verbatim; the fallback covers only a
            // renderable payload the builder's negative backstop still refused.
            <p className="empty-note">{flow.reason ?? 'Nothing to draw for this year yet.'}</p>
          )}
          {flow.warnings.length > 0 && <p className="drill-hint">{flow.warnings.join(' · ')}</p>}
        </>
      )}
    </section>
  )
}
