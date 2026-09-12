import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAllocationTargets, saveClassification } from '../../api/allocation'
import type { AllocationData, SecurityClassification } from '../../api/allocation'
import AllocationTargetEditor from './AllocationTargetEditor'
import ClassificationEditor from './ClassificationEditor'
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
    fireEvent.change(screen.getByLabelText('Unknown target percent'), { target: { value: '39.9999' } })
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
    fireEvent.change(screen.getByLabelText('Unknown target percent'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Equity tolerance percentage points'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate targets' }))
    await screen.findByText('Connection interrupted')
    expect((screen.getByLabelText('Equity target percent') as HTMLInputElement).value).toBe('60')
    expect(saveAllocationTargets).toHaveBeenCalledWith('asset_class', 7, 'active', expect.arrayContaining([
      { key: 'equity', target_pct: '60', tolerance_pp: '5' },
    ]))
  })
})

it('reviews a fund without pretending its wrapper is an industry', async () => {
  const fund: SecurityClassification = { security_id: 2, ticker: 'FUND', name: 'A fund', holding_type: 'etf',
    asset_class: null, industry: null, geography: null, source: 'Existing records', note: null,
    reviewed_at: null, industry_available: false }
  vi.mocked(saveClassification).mockResolvedValue({ data: fund, headers: new Headers() })
  render(<ClassificationEditor classifications={[fund]} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByText('Review security classifications'))
  fireEvent.click(screen.getByRole('button', { name: 'Review FUND classification' }))
  expect((screen.getByLabelText('Industry') as HTMLInputElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Asset class'), { target: { value: 'bonds' } })
  fireEvent.change(screen.getByLabelText('Geography'), { target: { value: 'us' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed classification' }))
  await waitFor(() => expect(saveClassification).toHaveBeenCalledWith(2, {
    asset_class: 'bonds', industry: null, geography: 'us', note: null,
  }))
})

it('keeps unknown exposure addressable and missing prices blank in the export', () => {
  const option = exposureOption(data) as unknown as { series: { data: { allocationKey: string; value: number }[] }[] }
  expect(option.series[0].data.map((row) => row.allocationKey)).toEqual(['equity', '__unknown__'])
  expect(option.series[0].data.reduce((sum, row) => sum + row.value, 0)).toBe(500)
  const csv = exposureCsv(data)
  expect(csv.rows[1].slice(0, 4)).toEqual(['Unknown', '300.00', '60.0000', 'Unknown'])
  expect(csv.rows[2].slice(0, 4)).toEqual(['Unpriced: GAP', '', '', 'Value unavailable'])
  expect(csv.rows[1]).toContain('person:7')
})
