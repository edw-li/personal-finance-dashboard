import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartSelection, MetricEvidence } from '../../types/metrics'
import DetailPanelProvider from './DetailPanelProvider'
import MetricInspector, { formatEvidenceValue, MetricInfoButton } from './MetricInspector'
import SelectionDetail from './SelectionDetail'
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
    // The header's title IS the metric; "About this number" as a subtitle said it twice (spec §4).
    expect(document.querySelector('.detail-panel-heading p')).toBeNull()
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
  it('speaks the data status and component labels as sentences and keeps the definition id as a tooltip', () => {
    const { container } = render(<MetricInspector evidence={{ ...evidence, components: [
      { label: 'pre_tax', value: '10', unit: 'USD' },
      { label: 'liability', value: '-5', unit: 'USD', included: false },
    ] }} />)
    // Row label and value (2026-09-13 spec §5): "Basis: mixed" → "Data status: Mixed sources".
    expect(screen.getByText('Data status').nextElementSibling?.textContent).toBe('Mixed sources')
    expect(screen.queryByText('Basis')).toBeNull()
    expect(screen.getByText('Pre tax')).toBeTruthy()
    expect(screen.getByText('Liability (excluded)')).toBeTruthy()
    // The developer footer is gone from the visible receipt; support still has the id on hover.
    expect(screen.queryByText(/Definition:/)).toBeNull()
    expect(container.querySelector('.metric-inspector-definition')?.getAttribute('title'))
      .toBe('Metric living_spending_previous_12, definition spending-v1')
  })
  it('SelectionDetail states the selection once — Scope is a receipt row, no leading paragraph', () => {
    const selection: ChartSelection = { kind: 'period', id: 'aug', period: '2026-08-01', label: 'August', scope: 'household', values: [{ label: 'Net worth', value: 200, unit: 'USD' }] }
    const { container } = render(<SelectionDetail selection={selection} chartTitle="Net worth" />)
    // The panel header already says "August" (audit B5: the label appeared three times in 120px).
    expect(container.querySelector('article > p')).toBeNull()
    const rows = Array.from(container.querySelectorAll('.metric-receipt-list > div'))
      .map((row) => `${row.querySelector('dt')?.textContent}: ${row.querySelector('dd')?.textContent}`)
    expect(rows).toEqual(['Scope: Household', 'Net worth: $200.00'])
  })
  // The calculation hangs off the shared Disclosure (2026-09-13 polish §2.6) — same closed-
  // until-asked behaviour, one grammar with the table twin and the assistant's blocks.
  it('SelectionDetail puts each calculation behind a closed Disclosure', async () => {
    const selection: ChartSelection = { kind: 'period', id: 'aug', period: '2026-08-01', label: 'August', scope: 'household', values: [{ label: 'Net worth', value: 200, unit: 'USD' }], evidence: [evidence] }
    const { container } = render(<SelectionDetail selection={selection} chartTitle="Net worth" />)
    const calc = () => container.querySelector('details.disclosure') as HTMLDetailsElement
    expect(calc().open).toBe(false)
    expect(calc().querySelector(':scope > summary')?.textContent).toBe('Previous 12 months: calculation')
    expect(calc().querySelector(':scope > .disclosure-body > .metric-inspector')).toBeTruthy()
    fireEvent.click(screen.getByText('Previous 12 months: calculation'))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(calc().open).toBe(true)
  })
})
