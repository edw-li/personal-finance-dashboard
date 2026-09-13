import { describe, expect, it } from 'vitest'
import type { ExplainSelectionRequest, MetricEvidence } from '../../types/metrics'
import { explainPrompt } from './explainSelection'

const evidence: MetricEvidence = {
  id: 'net_worth', definition_version: 'dashboard-v1', label: 'Net worth', definition: 'Sum of balances.',
  value: '806708.50', unit: 'USD', scope: 'household', completeness: 'complete', components: [],
  source_link: '/net-worth', source_label: 'Open source records', as_of: '2026-08-01', warnings: [],
}
const base = { sourceRoute: '/', capturedAt: '2026-09-13T00:00:00Z' }

// "Explain Net worth in Net worth." (audit E4) — a metric's chart title is its own label, so a
// metric is asked about as a FIGURE: value, period or as-of, scope (2026-09-13 spec §5).
describe('explainPrompt', () => {
  it('asks about a metric as a figure with its value, as-of date and scope', () => {
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Net worth', selection: {
      kind: 'point', id: 'metric:net_worth', label: 'Net worth', date: '2026-08-01', scope: 'household',
      values: [{ label: 'Net worth', value: '806708.50', unit: 'USD' }], evidence: [evidence],
    } }
    expect(explainPrompt(request)).toBe(
      'Explain the Net worth figure ($806,708.50, as of 2026-08-01, Household). Use the captured evidence and distinguish recorded facts from interpretation.',
    )
  })

  it('prefers the evidence window over the as-of date and honours display precision', () => {
    const windowed: MetricEvidence = { ...evidence, id: 'to_cap_rate', label: 'Election to reach cap', value: '0.123456789', unit: 'ratio', display_precision: 7,
      window: { from: '2025-08-01', to: '2026-07-01', included: [], excluded: [] } }
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Election to reach cap', selection: {
      kind: 'point', id: 'metric:to_cap_rate', label: 'Election to reach cap', scope: 1,
      values: [{ label: 'Election to reach cap', value: '0.123456789', unit: 'ratio' }], evidence: [windowed],
    } }
    expect(explainPrompt(request)).toBe(
      'Explain the Election to reach cap figure (12.3456789%, 2025-08-01 to 2026-07-01, Selected person). Use the captured evidence and distinguish recorded facts from interpretation.',
    )
  })

  it('leaves the parenthesis out when nothing is known beyond the label', () => {
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Mystery', selection: { kind: 'point', id: 'metric:mystery', label: 'Mystery', values: [] } }
    expect(explainPrompt(request)).toBe('Explain the Mystery figure. Use the captured evidence and distinguish recorded facts from interpretation.')
  })

  it('keeps the chart-in-title form for chart selections', () => {
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Net worth', selection: {
      kind: 'period', id: 'aug', period: '2026-08-01', label: 'August', values: [{ label: 'Net worth', value: 200, unit: 'USD' }],
    } }
    expect(explainPrompt(request)).toBe('Explain August in Net worth. Use the captured selection and distinguish recorded facts from interpretation.')
  })
})
