import { api } from './client'
import type { AssistantEvidenceBundle, AssistantFinding } from '../types/assistantEvidence'

export const fetchFindings = () => api<AssistantFinding[]>('/assistant/findings')
export const deleteFinding = (id: number) => api<void>(`/assistant/findings/${id}`, { method: 'DELETE' })
export const saveFinding = (question: string, content: string, model: string | undefined, bundle: AssistantEvidenceBundle) =>
  api<AssistantFinding>('/assistant/findings', {
    method: 'POST',
    body: JSON.stringify({
      title: (question || bundle.title).slice(0, 160),
      content: `Question: ${question || bundle.title}\n\n${content || bundle.summary_text}`.slice(0, 32000),
      model_used: model ?? null,
      context: bundle.context,
      evidence: bundle.metrics,
      evidence_as_of: bundle.as_of,
      receipt: bundle.receipt,
    }),
  })
