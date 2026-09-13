import type { MetricEvidence } from '../types/metrics'
import type { HouseholdOut } from '../types/api'
import { getSnapshot } from '../api/snapshotCache'

/** Resolve a stored scope identifier for reading without changing the evidence. */
export function formatMetricScope(scope: MetricEvidence['scope']): string {
  if (scope === null || scope === 'household' || scope === 'Household' || scope === 'all') return 'Household'
  if (scope === 'joint') return 'Joint'
  const personId = typeof scope === 'number' ? scope : /^person:\d+$/.test(scope) ? Number(scope.slice(7)) : null
  if (personId === null) return scope as string
  return getSnapshot<HouseholdOut>('shell:household')?.people.find((person) => person.id === personId)?.name ?? 'Selected person'
}

/** Attach a receipt to an existing server value. Callers supply its actual date, scope
 * and components; this helper performs no monetary calculations. */
export function metricReceipt(input: Pick<MetricEvidence, 'id' | 'label' | 'value' | 'definition' | 'source_link'> & Partial<MetricEvidence>): MetricEvidence {
  return { definition_version: 'dashboard-v1', unit: 'USD', scope: 'household', completeness: input.value === null ? 'unavailable' : 'complete', components: [], source_label: 'Open source records', as_of: null, warnings: [], ...input }
}

/** The receipt's value in its unit's own notation. Lives here, not in MetricInspector, so the
 *  panel and the assistant's explain prompt format one figure the same way (MetricInspector
 *  re-exports it for its existing importers). */
export function formatEvidenceValue(value: string | number | null, unit?: string, displayPrecision?: number | null): string {
  if (value === null) return 'Unavailable'
  if (!unit) return String(value)
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  const precision = typeof displayPrecision === 'number' && Number.isInteger(displayPrecision) && displayPrecision >= 0 && displayPrecision <= 9 ? displayPrecision : undefined
  if (unit === 'USD') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: precision ?? 2 }).format(number)
  if (unit === 'ratio') return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: precision ?? 2 }).format(number)
  if (unit === 'percent') return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: precision ?? 2 }).format(number)}%`
  if (unit === 'count') return new Intl.NumberFormat('en-US', { maximumFractionDigits: precision ?? 6 }).format(number)
  return `${value} ${unit}`
}

/** Reader-facing words for the completeness enum (2026-09-13 spec §5): the server's five values
 *  (`backend/app/schemas/metrics.py`) plus the two the frontend sets itself (partial, estimate). */
export const COMPLETENESS_LABELS: Record<string, string> = {
  complete: 'Complete',
  unreviewed_history: 'Includes months not yet reviewed',
  incomplete: 'Incomplete — some months missing',
  unavailable: 'Unavailable',
  mixed: 'Mixed sources',
  partial: 'Partial — some holdings unpriced',
  estimate: 'Estimate',
}

/** Sentence case with no underscores: `pre_tax` → `Pre tax`, ` HSA employer ` → `HSA employer`.
 *  Only the first letter is touched, so acronyms and proper names keep their capitals. */
export function formatComponentLabel(label: string): string {
  const words = label.replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
  return words === '' ? '' : words.charAt(0).toUpperCase() + words.slice(1)
}

/** A completeness value — or an exclusion reason — as a reader would say it: the map first, the
 *  sentence-case fallback for anything the map has no words for. */
export function formatCompleteness(value: string): string {
  return COMPLETENESS_LABELS[value] ?? formatComponentLabel(value)
}
