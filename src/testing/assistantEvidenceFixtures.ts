import type { AssistantEvidenceBundle } from '../types/assistantEvidence'

export const reviewEvidenceFixture: AssistantEvidenceBundle = {
  title: 'August 2026 review', month: '2026-08-01', as_of: '2026-09-12T09:00:00Z',
  summary_text: 'Living spending: [[metric:living_spending_2026_08_abc]].',
  context: { route: '/spending', search: { month: '2026-08-01' }, view: {} }, receipt: 'signed-receipt-fixture',
  metrics: [{ id: 'living_spending_2026_08_abc', definition_version: 'spending-v1', label: 'Living spending',
    definition: 'Living categories only; taxes and transfers are separate.', value: '1234.56', unit: 'USD', scope: 'Household',
    completeness: 'closed', components: [], source_link: '/spending?month=2026-08-01', source_label: 'Open August records',
    as_of: '2026-08-01', warnings: [], window: { from: '2026-08-01', to: '2026-08-01', included: ['2026-08-01'], excluded: [] } }],
}
