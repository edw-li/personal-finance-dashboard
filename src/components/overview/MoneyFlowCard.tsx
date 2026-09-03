import { useMemo } from 'react'
import type { MoneyFlowOut } from '../../types/api'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { moneyFlowCsv, moneyFlowOption } from './moneyFlowOptions'
import '../panels.css'
import './moneyFlow.css'

/**
 * The annual money-flow card (2026-08-25 spec §5): presentational only — OverviewPage
 * owns the ISOLATED fetch (the Up-next pattern) and hands the payload down, so a
 * tax-engine hiccup dents this card and never the snapshot. Year chips come from the
 * payload's available_years; the active chip is the payload's own echoed year, so the
 * chip row can never disagree with the chart beside it. The chrome — header, export row,
 * states, table twin — is ChartCard's (chart spec §6).
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
    <ChartCard
      title={flow === null ? 'Money flow' : `Money flow — ${flow.year}`}
      hint="Where the year's money went. Income comes from the year's tax inputs through the tax engine; take-home cash is the entered monthly net pay; the right-hand fan is the year's entered spending. Retained equity & other is the residual — ≈ vest shares kept + ESPP contributions + timing between W-2 income and cash."
      ariaLabel={`Sankey diagram of ${flow?.year ?? 'the year'} money flow from income sources through taxes, savings and take-home cash to spending categories`}
      option={option}
      // The SERVER's refusal sentence, verbatim; the fallback covers only a renderable
      // payload the builder's negative backstop still refused.
      empty={flow?.reason ?? 'Nothing to draw for this year yet.'}
      exportName={`money-flow-${flow?.year ?? 'year'}`}
      csv={flow === null ? undefined : () => moneyFlowCsv(flow)}
      // ~17 nodes at most, so 380px keeps every ribbon legible.
      height={380}
      busy={flow === null && !failed}
      error={failed ? "Couldn't load the money flow." : null}
      controls={
        flow !== null && flow.available_years.length > 0 ? (
          <Segmented
            variant="toggle"
            size="sm"
            ariaLabel="Money-flow year"
            options={flow.available_years.map((year) => ({ value: String(year), label: String(year) }))}
            value={String(flow.year)}
            onChange={(value) => onYearChange(Number(value))}
          />
        ) : undefined
      }
      actions={
        failed ? (
          <button
            type="button"
            className="button"
            aria-label="Retry loading the money flow"
            onClick={onRetry}
          >
            Retry
          </button>
        ) : undefined
      }
      footer={
        flow !== null && flow.warnings.length > 0 ? (
          <p className="drill-hint">{flow.warnings.join(' · ')}</p>
        ) : undefined
      }
    />
  )
}
