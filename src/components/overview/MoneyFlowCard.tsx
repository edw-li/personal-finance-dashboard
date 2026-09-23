import { useMemo } from 'react'
import type { CategoryFold } from '../../charts/entities'
import { spendingLeftOut } from '../../charts/windowWords'
import type { MoneyFlowOut } from '../../types/api'
import { todayIso } from '../../utils/months'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { moneyFlowCsv, moneyFlowOption, monthWords } from './moneyFlowOptions'
import '../panels.css'
import './moneyFlow.css'

/** The right-hand side's window in words (2026-09-23 spec §C1): the months the spending fan
 *  and Saved cover — the months with both take-home and spending entered. */
function windowSentence(flow: MoneyFlowOut): string | null {
  const matched = flow.matched_months
  if (matched === undefined || !flow.renderable) return null
  return matched.length === 0
    ? `Spending and saved: no month of ${flow.year} has both take-home and spending entered yet`
    : `Spending and saved: ${monthWords(matched)}`
}

/** Spending with no take-home beside it (the month in progress) is left out of the fan — and
 *  said out loud, in the words the Spending "Where … went" year uses too (charts/windowWords). */
function unmatchedSpendingSentence(flow: MoneyFlowOut): string | null {
  return spendingLeftOut(flow.spending_unmatched_months ?? [], flow.year, flow.spending_unmatched_total ?? '0.00')
}

/**
 * The annual money-flow card (2026-08-25 spec §5): presentational only — OverviewPage
 * owns the ISOLATED fetch (the Up-next pattern) and hands the payload down, so a
 * tax-engine hiccup dents this card and never the snapshot. Year chips come from the
 * payload's available_years; the active chip is the payload's own echoed year, so the
 * chip row can never disagree with the chart beside it. The chrome — header, export row,
 * states, table twin — is ChartCard's (chart spec §6).
 *
 * `fold` is the Spending page's category fold (charts/entities.ts, 2026-09-23 spec §C2), so a
 * category wears the colour it wears on /spending. While it is still loading (`foldPending`)
 * the card waits rather than drawing with its own ranking and recolouring a moment later;
 * without one at all (the spending feed failed) it folds by the payload's own ranking.
 */
export default function MoneyFlowCard({
  flow,
  failed,
  onRetry,
  onYearChange,
  fold = null,
  foldPending = false,
}: {
  flow: MoneyFlowOut | null
  failed: boolean
  onRetry: () => void
  onYearChange: (year: number) => void
  fold?: CategoryFold | null
  foldPending?: boolean
}) {
  const today = todayIso()
  const option = useMemo(
    () => (flow === null || foldPending ? null : moneyFlowOption(flow, { fold, todayIso: today })),
    [flow, fold, foldPending, today],
  )
  const lede = flow === null ? null : windowSentence(flow)
  const leftOut = flow === null ? null : unmatchedSpendingSentence(flow)
  return (
    <ChartCard
      title={flow === null ? 'Money flow' : `Money flow — ${flow.year}`}
      hint="Where the year's money went. Income and taxes are the year's full figures from its tax inputs through the tax engine; take-home cash is the net pay entered, and a dashed node estimates the months without it (hover it for how). The spending fan and Saved cover only the months with both take-home and spending entered — named above the chart — so Saved matches the Year-to-date card's cash saved. Retained equity & other is the residual — ≈ vest shares kept + ESPP contributions + timing between W-2 income and cash."
      ariaLabel={`Sankey diagram of ${flow?.year ?? 'the year'} money flow from income sources through taxes, savings and take-home cash to spending categories`}
      option={option}
      // The SERVER's refusal sentence, verbatim; the fallback covers only a renderable
      // payload the builder's negative backstop still refused.
      empty={flow?.reason ?? 'Nothing to draw for this year yet.'}
      exportName={`money-flow-${flow?.year ?? 'year'}`}
      csv={flow === null ? undefined : () => moneyFlowCsv(flow, { fold, todayIso: today })}
      // ~17 nodes at most, so 380px keeps every ribbon legible.
      height={380}
      busy={(flow === null && !failed) || (flow !== null && foldPending)}
      error={failed ? "Couldn't load the money flow." : null}
      lede={lede === null ? undefined : lede}
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
        flow !== null && (leftOut !== null || flow.warnings.length > 0) ? (
          <>
            {leftOut !== null && <p className="drill-hint">{leftOut}</p>}
            {flow.warnings.length > 0 && <p className="drill-hint">{flow.warnings.join(' · ')}</p>}
          </>
        ) : undefined
      }
    />
  )
}
