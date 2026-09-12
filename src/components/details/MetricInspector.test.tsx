import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartSelection, MetricEvidence } from '../../types/metrics'
import DetailPanelProvider from './DetailPanelProvider'
import MetricInspector, { formatEvidenceValue, MetricInfoButton } from './MetricInspector'
import { explainSelection, onExplainSelection } from './explainSelection'

const evidence: MetricEvidence = {
  id: 'living_spending_previous_12', definition_version: 'spending-v1', label: 'Previous 12 months', definition: 'Eligible living spending before the selected month.', value: '123.45', unit: 'USD', scope: 'household', completeness: 'mixed',
  window: { from: '2025-08-01', to: '2026-07-01', included: ['2026-06-01', '2026-07-01'], excluded: [{ month: '2026-05-01', reason: 'Take-home missing' }], unreviewed_history_count: 1 },
  components: [{ label: 'Living spending', value: '246.90', unit: 'USD' }], source_link: '/spending?month=2026-08', source_label: 'Open August', as_of: '2026-09-12', warnings: ['Two months contribute.'],
}
afterEach(cleanup)
describe('metric receipts and captured questions', () => {
  it('keeps explicit election precision while normal amounts retain familiar formatting', () => {
    expect(formatEvidenceValue('0.123456789', 'ratio', 7)).toBe('12.3456789%')
    expect(formatEvidenceValue('123.45', 'USD')).toBe('$123.45')
    expect(formatEvidenceValue('0.123456789', 'ratio', 99)).toBe('12.35%')
    render(<MetricInspector evidence={{ ...evidence, value: '0.123456789', unit: 'ratio', display_precision: 7 }} />)
    expect(screen.getByText('12.3456789%')).toBeTruthy()
  })
  it('shows exact window, inclusion/exclusion, source and historical basis', () => {
    render(<MetricInspector evidence={evidence} />)
    expect(screen.getByText('$123.45')).toBeTruthy()
    expect(screen.getByText('2025-08-01 to 2026-07-01')).toBeTruthy()
    expect(screen.getByText('Take-home missing')).toBeTruthy()
    expect(screen.getByText('1 included month is unreviewed history.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open August' }).getAttribute('href')).toBe('/spending?month=2026-08')
  })
  it('opens from the figure and refreshes the visible receipt when its source changes', () => {
    const { rerender } = render(<DetailPanelProvider><MetricInfoButton evidence={evidence} /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'About this number: Previous 12 months' }))
    expect(screen.getByText('$123.45')).toBeTruthy()
    rerender(<DetailPanelProvider><MetricInfoButton evidence={{ ...evidence, value: '140.50' }} /></DetailPanelProvider>)
    expect(screen.getByText('$140.50')).toBeTruthy()
    expect(screen.queryByText('$123.45')).toBeNull()
  })
  it('copies scope, period and scenario before a later navigation or edit', () => {
    const receive = vi.fn()
    const stop = onExplainSelection(receive)
    const selection: ChartSelection = { kind: 'projection', id: '2030', date: '2030-01-01', label: '2030', scope: 2, values: [{ label: 'Balance', value: '1000', unit: 'USD' }], scenario: { contribution: 500 } }
    explainSelection(selection, 'Planning')
    selection.scenario!.contribution = 900
    expect(receive.mock.calls[0][0]).toMatchObject({ chartTitle: 'Planning', selection: { scope: 2, date: '2030-01-01', scenario: { contribution: 500 } } })
    stop()
  })
})
