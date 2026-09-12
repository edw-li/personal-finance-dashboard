import type { MetricEvidence } from './metrics'

export type AssistantIntent = 'month_review' | 'spending_changes' | 'contribution_pace' | 'selection'

export interface AssistantEvidenceBundle {
  title: string
  month: string | null
  summary_text: string
  metrics: MetricEvidence[]
  as_of: string
  context: Record<string, unknown>
  receipt: string
}

export interface AssistantFinding {
  id: number
  title: string
  content: string
  model_used: string | null
  context: Record<string, unknown>
  evidence: MetricEvidence[]
  evidence_as_of: string
  created_at: string
}

// SSE and restored browser storage are both untrusted boundaries. Check every
// collection the evidence renderer dereferences before accepting a bundle.
export function isEvidenceBundle(value: unknown): value is AssistantEvidenceBundle {
  if (!value || typeof value !== 'object') return false
  const b = value as AssistantEvidenceBundle
  return typeof b.title === 'string' && typeof b.summary_text === 'string'
    && typeof b.as_of === 'string' && typeof b.receipt === 'string'
    && b.context !== null && typeof b.context === 'object' && !Array.isArray(b.context)
    && Array.isArray(b.metrics) && b.metrics.length <= 100 && b.metrics.every((m) =>
      m !== null && typeof m === 'object' && typeof m.id === 'string'
      && typeof m.label === 'string' && typeof m.definition === 'string'
      && typeof m.completeness === 'string' && typeof m.source_link === 'string'
      && typeof m.unit === 'string'
      && (m.display_precision == null || (Number.isInteger(m.display_precision) && m.display_precision >= 0 && m.display_precision <= 9))
      && (m.value === null || typeof m.value === 'string' || typeof m.value === 'number')
      && Array.isArray(m.components) && m.components.every((c) => c && typeof c.label === 'string')
      && Array.isArray(m.warnings) && m.warnings.every((w) => typeof w === 'string')
      && (!m.window || (Array.isArray(m.window.included) && m.window.included.every((d) => typeof d === 'string')
        && Array.isArray(m.window.excluded) && m.window.excluded.every((d) => d && typeof d.month === 'string' && typeof d.reason === 'string'))))
}
