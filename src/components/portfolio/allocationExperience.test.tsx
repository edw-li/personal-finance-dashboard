import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { allocationLabel, displayLabel, saveAllocationTargets } from '../../api/allocation'
import type { AllocationData } from '../../api/allocation'
import AllocationTargetEditor from './AllocationTargetEditor'
import { exposureCsv, exposureOption } from './allocationChartOptions'

vi.mock('../../api/allocation', async (original) => ({
  ...await original<typeof import('../../api/allocation')>(),
  saveAllocationTargets: vi.fn(), saveClassification: vi.fn(),
}))

const data: AllocationData = {
  by: 'asset_class', scope_key: 'person:7', total_market_value: '500.00', as_of: '2026-09-10T00:00:00Z',
  latest_quote_at: '2026-09-11T00:00:00Z', source_href: '/portfolio?section=holdings&owner=7',
  slices: [
    { key: 'equity', label: 'Equity', market_value: '200.00', weight_pct: '0.400000', holdings: 1, is_unknown: false, members: [] },
    { key: '__unknown__', label: 'Unknown', market_value: '300.00', weight_pct: '0.600000', holdings: 1, is_unknown: true, members: [] },
  ], coverage: { holding_count: 3, priced_count: 2, unpriced_count: 1, classified_count: 1,
    classified_market_value: '200.00', unknown_market_value: '300.00', classified_weight_pct: '0.4', warnings: [],
    unpriced_holdings: [{ security_id: 3, ticker: 'GAP', name: 'Missing quote', account: null, shares: '10',
      market_value: null, quoted_at: null, classification_source: 'Existing records', classification_reviewed_at: null }],
  }, target_set: null, draft_target_set: null, drift: [],
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('allocation targets', () => {
  it('seeds only classified categories, offers no Unclassified target, and points at the classify path', async () => {
    vi.mocked(saveAllocationTargets).mockResolvedValue({ data: {} as never, headers: new Headers() })
    const onChanged = vi.fn()
    const onClassify = vi.fn()
    render(<AllocationTargetEditor data={data} owner={7} onChanged={onChanged} onClassify={onClassify} unclassifiedCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set targets' }))
    // No __unknown__ row (spec §13): a gap to close, not a category to hold a weight.
    expect(screen.queryByLabelText('Unknown target percent')).toBeNull()
    expect(screen.queryByLabelText('Unclassified target percent')).toBeNull()
    const add = screen.getByRole('combobox') as HTMLSelectElement
    expect([...add.options].map((option) => option.textContent)).toEqual([
      'Choose a category', 'Bonds', 'Cash / cash equivalents', 'Real assets', 'Mixed', 'Other',
    ])
    // 300 of the 500 priced book has no classification — the form says so and hands over the verb.
    expect(screen.getByText(/Unclassified holdings are 60\.0% of the priced book — classify them first\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Classify these 1 holding' }))
    expect(onClassify).toHaveBeenCalledOnce()
    // Activation still needs exactly 100% — and stays available, drift stays honest.
    fireEvent.change(screen.getByLabelText('Equity target percent'), { target: { value: '60' } })
    expect((screen.getByRole('button', { name: 'Activate targets' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(saveAllocationTargets).toHaveBeenCalledWith('asset_class', 7, 'draft', [
      { key: 'equity', target_pct: '60', tolerance_pp: '0' },
    ])
  })

  it('keeps input after a failed activation and sends percentage-point tolerance explicitly', async () => {
    vi.mocked(saveAllocationTargets).mockRejectedValue(new Error('Connection interrupted'))
    render(<AllocationTargetEditor data={data} owner={7} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set targets' }))
    fireEvent.change(screen.getByLabelText('Equity target percent'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Equity tolerance percentage points'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate targets' }))
    await screen.findByText('Connection interrupted')
    expect((screen.getByLabelText('Equity target percent') as HTMLInputElement).value).toBe('100')
    expect(saveAllocationTargets).toHaveBeenCalledWith('asset_class', 7, 'active', [
      { key: 'equity', target_pct: '100', tolerance_pp: '5' },
    ])
    // Without the callback the hint still states the share; only the action is absent.
    expect(screen.getByText(/Unclassified holdings are 60\.0%/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Classify these/ })).toBeNull()
  })

  it('labels a saved Unclassified drift row by the page word, not the wire word', () => {
    const drifted: AllocationData = { ...data, target_set: { id: 1, scope_key: 'person:7', dimension: 'asset_class', state: 'active', updated_at: '2026-09-01T00:00:00Z',
      targets: [{ key: 'equity', target_pct: '40', tolerance_pp: '5' }, { key: '__unknown__', target_pct: '60', tolerance_pp: '5' }] },
      drift: [
        { key: 'equity', label: 'Equity', market_value: '200.00', weight_pct: '0.4', target_pct: '40', tolerance_pp: '5', drift_pp: '0.00', drift_amount: '0.00', outside_tolerance: false, has_unpriced: false },
        { key: '__unknown__', label: 'Unknown', market_value: '300.00', weight_pct: '0.6', target_pct: '60', tolerance_pp: '5', drift_pp: '0.00', drift_amount: '0.00', outside_tolerance: false, has_unpriced: false },
      ] }
    render(<AllocationTargetEditor data={drifted} owner={7} onChanged={vi.fn()} />)
    expect(screen.getByRole('rowheader', { name: 'Unclassified' })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: 'Unknown' })).toBeNull()
  })
})

it('spells the catch-all slice Unclassified in the donut and the export, and keeps missing prices blank', () => {
  const option = exposureOption(data) as unknown as { series: { data: { name: string; allocationKey: string; value: number }[] }[] }
  expect(option.series[0].data.map((row) => row.allocationKey)).toEqual(['equity', '__unknown__'])
  // The wire says "Unknown"; the page says what it means (2026-09-13 polish §13).
  expect(option.series[0].data.map((row) => row.name)).toEqual(['Equity', 'Unclassified'])
  expect(option.series[0].data.reduce((sum, row) => sum + row.value, 0)).toBe(500)
  const csv = exposureCsv(data)
  expect(csv.rows[1].slice(0, 4)).toEqual(['Unclassified', '300.00', '60.0000', 'Unclassified'])
  expect(csv.rows[2].slice(0, 4)).toEqual(['Unpriced: GAP', '', '', 'Value unavailable'])
  expect(csv.rows[1]).toContain('person:7')
  expect(allocationLabel('__unknown__', 'asset_class')).toBe('Unclassified')
  expect(displayLabel('__unknown__', 'Unknown', 'asset_class')).toBe('Unclassified')
  expect(displayLabel('equity', 'Equity', 'asset_class')).toBe('Equity')
})

// "Unclassified" is a claim about the ASSET CLASS gap the classifications card closes. On every
// other dimension the catch-all is the server's own word for a missing fact, and renaming it
// would promise a fix this page does not offer (P2 review round 1).
it('leaves the catch-all in the wire’s words on every dimension but asset class', () => {
  expect(displayLabel('__unknown__', 'Unknown industry', 'industry')).toBe('Unknown industry')
  expect(displayLabel('__unknown__', 'Unknown', 'account')).toBe('Unknown')
  expect(allocationLabel('__unknown__', 'industry')).toBe('Unknown')
  expect(allocationLabel('__unknown__', 'geography')).toBe('Unknown')
  const byIndustry: AllocationData = { ...data, by: 'industry',
    slices: [{ ...data.slices[0], key: 'semis', label: 'Semiconductors' },
      { ...data.slices[1], label: 'Unknown industry' }] }
  const option = exposureOption(byIndustry) as unknown as { series: { data: { name: string }[] }[] }
  expect(option.series[0].data.map((row) => row.name)).toEqual(['Semiconductors', 'Unknown industry'])
  expect(exposureCsv(byIndustry).rows[1].slice(0, 4)).toEqual(['Unknown industry', '300.00', '60.0000', 'Unknown'])
})
