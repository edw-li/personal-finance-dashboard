import { GROUP_LABELS } from '../../charts/theme'
import type { MetricEvidence } from '../../types/metrics'
import type { NetWorthSummary } from '../../types/api'

/** The hero receipt's component rows: one per account group, labelled the way every legend
 *  labels them (GROUP_LABELS — "Liabilities", never "liability"; 2026-09-13 polish spec §5).
 *  Verbatim server totals; no arithmetic. */
export function netWorthComponents(groups: NetWorthSummary['groups']): MetricEvidence['components'] {
  return groups.map((group) => ({ label: GROUP_LABELS[group.group], value: group.total, unit: 'USD' }))
}
