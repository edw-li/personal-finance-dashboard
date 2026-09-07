import type { BudgetSuggestion, CategoryKind } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { profileCue } from './budgetSeed'

/**
 * One editor's suggestion line (2026-09-07 spec §3.4): the seed the one-click action would
 * write, then a chip per statistic that exists — each sets the amount box — and the profile's
 * cue. Chips are `.button`s at the editor's size; figures in the monospace family. No colour
 * carries meaning here: the suggested chip is outlined, and it says "suggested".
 */
export default function BudgetSuggestions({
  categoryName,
  kind,
  suggestion,
  onPick,
}: {
  categoryName: string
  kind: CategoryKind
  suggestion: BudgetSuggestion
  onPick: (amount: string) => void
}) {
  const chips: { key: string; label: string; value: string; suggested?: boolean }[] = []
  if (suggestion.seed !== null) {
    chips.push({ key: 'seed', label: 'suggested', value: suggestion.seed, suggested: true })
  }
  if (suggestion.mean !== null) chips.push({ key: 'mean', label: 'mean', value: suggestion.mean })
  if (suggestion.median !== null) chips.push({ key: 'median', label: 'median', value: suggestion.median })
  if (suggestion.latest !== null) chips.push({ key: 'latest', label: 'last month', value: suggestion.latest })
  const cue = profileCue(suggestion, kind)
  return (
    <div className="budget-suggest">
      {suggestion.seed === null && <span className="budget-suggest-none">no suggestion</span>}
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={`button budget-chip${chip.suggested ? ' is-suggested' : ''}`}
          aria-label={`Use ${categoryName} ${chip.label} ${formatCurrency(chip.value)}`}
          onClick={() => onPick(chip.value)}
        >
          {`${chip.label} ${formatCurrency(chip.value)}`}
        </button>
      ))}
      {cue !== null && <p className="drill-hint budget-suggest-cue">{cue}</p>}
    </div>
  )
}
