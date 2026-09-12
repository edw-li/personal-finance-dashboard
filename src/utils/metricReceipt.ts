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
