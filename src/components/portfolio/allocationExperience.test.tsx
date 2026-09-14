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
  it('saves unfinished drafts with the chosen owner and requires exactly 100% to activate', async () => {
    vi.mocked(saveAllocationTargets).mockResolvedValue({ data: {} as never, headers: new Headers() })
    const onChanged = vi.fn()
    render(<AllocationTargetEditor data={data} owner={7} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set targets' }))
    fireEvent.change(screen.getByLabelText('Equity target percent'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Unclassified target percent'), { target: { value: '39.9999' } })
    expect((screen.getByRole('button', { name: 'Activate targets' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(saveAllocationTargets).toHaveBeenCalledWith('asset_class', 7, 'draft', [
      { key: 'equity', target_pct: '60', tolerance_pp: '0' },
      { key: '__unknown__', target_pct: '39.9999', tolerance_pp: '0' },
    ])
  })

  it('keeps input after a failed activation and sends percentage-point tolerance explicitly', async () => {
    vi.mocked(saveAllocationTargets).mockRejectedValue(new Error('Connection interrupted'))
    render(<AllocationTargetEditor data={data} owner={7} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set targets' }))
    fireEvent.change(screen.getByLabelText('Equity target percent'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Unclassified target percent'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Equity tolerance percentage points'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate targets' }))
    await screen.findByText('Connection interrupted')
    expect((screen.getByLabelText('Equity target percent') as HTMLInputElement).value).toBe('60')
    expect(saveAllocationTargets).toHaveBeenCalledWith('asset_class', 7, 'active', expect.arrayContaining([
      { key: 'equity', target_pct: '60', tolerance_pp: '5' },
    ]))
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
  expect(displayLabel('__unknown__', 'Unknown')).toBe('Unclassified')
  expect(displayLabel('equity', 'Equity')).toBe('Equity')
})
