import { useMemo } from 'react'
import ChartCard from '../ChartCard'
import type { TaxBracketsOut, TaxSummaryOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import {
  additionalMedicareStep,
  ladderSegments,
  marginalCost,
  toBrackets,
} from './marginal'
import { ladderCsv, marginalLadderOption } from './taxChartOptions'
import type { LadderRow } from './taxChartOptions'
// This component's own sheet, like its siblings: the app-wide vocabulary (.card/.eyebrow/
// .empty-note/.drill-hint) is panels.css, which the PAGE imports.
import './taxes.css'

/**
 * Where this year's taxable income sits in the federal and state bracket ladders, and what
 * the next $1,000 of ordinary income costs. Everything here is CLIENT arithmetic over two
 * payloads the page already holds — the year's summary and its own status' bracket tables —
 * because the answer is a planning figure the engine deliberately does not store (design
 * 2026-08-31 §D3). The one licensed exception to "never re-derive": nothing computed here
 * is written anywhere or fed back to the API.
 */
export default function MarginalPanel({
  summary,
  brackets,
}: {
  summary: TaxSummaryOut
  /** The year's OWN status' tables — the payload the engine walks (TaxesPage always names
   *  the year's filing status on the brackets GET, never the server's 'single' default). */
  brackets: TaxBracketsOut
}) {
  // Non-empty means the engine REFUSED and every summary section is null on the wire —
  // there is no taxable income to place on a ladder, and the summary card above already
  // carries the missing-tables call to action.
  const refused = (summary.brackets_missing_for_status ?? []).length > 0

  // Memoized: EChart keys its redraw effect on [option] with notMerge, so a fresh object
  // every render would replay the chart on unrelated parent state (AllocationPanel's note).
  const model = useMemo(() => {
    if (refused) return null
    const federal = toBrackets(brackets.jurisdictions.federal ?? [])
    const state = toBrackets(brackets.jurisdictions.state ?? [])
    const medicare = toBrackets(brackets.jurisdictions.medicare ?? [])
    // Number() at the display boundary — see the module header's license.
    const federalIncome = Number(summary.federal.taxable_income)
    const stateIncome = Number(summary.state.taxable_income)
    const rows: LadderRow[] = []
    if (federal.length > 0)
      rows.push({
        label: 'Federal',
        segments: ladderSegments(federal, federalIncome),
        taxableIncome: federalIncome,
      })
    if (state.length > 0)
      rows.push({
        label: 'State',
        segments: ladderSegments(state, stateIncome),
        taxableIncome: stateIncome,
      })
    // A jurisdiction with NO table says nothing — an empty walk prices to $0.00, which
    // would read as "state is free" rather than "state is not entered".
    const parts = [
      ...(federal.length > 0
        ? [`${formatCurrency(marginalCost(federal, federalIncome))} federal`]
        : []),
      ...(state.length > 0
        ? [`${formatCurrency(marginalCost(state, stateIncome))} state`]
        : []),
    ]
    const medicareStep = additionalMedicareStep(
      medicare,
      Number(summary.medicare.taxable_wages),
    )
    return { option: marginalLadderOption(rows), parts, medicareStep, rows }
  }, [summary, brackets, refused])

  if (model === null) return null

  return (
    <ChartCard
      title={`Marginal rates — ${summary.year}`}
      hint="Where this year's taxable income (◆) sits in the bracket ladders, and what the next $1,000 of ordinary income costs. Computed in the browser from the stored tables — nothing here is saved."
      ariaLabel="Bracket ladder per jurisdiction with this year’s taxable income marked"
      option={model.option}
      empty="No federal or state bracket tables for this year yet — the ladder has nothing to walk. Enter them in the bracket tables below."
      exportName={`marginal-ladder-${summary.year}`}
      csv={() => ladderCsv(model.rows)}
      height={170}
      footer={
        model.parts.length === 0 ? undefined : (
          <>
            <p className="marginal-sentence">
              {`Your next $1,000 of ordinary income costs ${model.parts.join(' + ')}${
                model.medicareStep === null
                  ? ''
                  : ` + ${formatCurrency(model.medicareStep)} additional Medicare (combined wages sit above the top Medicare tier)`
              }.`}
            </p>
            <p className="drill-hint">
              Bracket boundaries and rates are this year&apos;s stored tables for its filing
              status. Capital gains stack separately and are not on this ladder.
            </p>
          </>
        )
      }
    />
  )
}
