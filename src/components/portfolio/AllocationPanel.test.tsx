import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllocationData, fetchClassifications, fetchEmployerExposure } from '../../api/allocation'
import type { AllocationData, AllocationMember, EmployerExposure, SecurityClassification } from '../../api/allocation'
import { expectInDocumentOrder } from '../../testing/domOrder'
import AllocationPanel from './AllocationPanel'

vi.mock('../../api/allocation', async (original) => ({
  ...await original<typeof import('../../api/allocation')>(),
  fetchAllocationData: vi.fn(), fetchClassifications: vi.fn(), fetchEmployerExposure: vi.fn(), saveClassification: vi.fn(),
}))
// echarts is never rendered in jsdom (house law); the marker exposes the slice NAMES the donut draws.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel }: { option: { series?: { data?: { name: string }[] }[] }; ariaLabel?: string }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-names': (option.series?.[0]?.data ?? []).map((d) => d.name).join('|') }),
  }
})

const member = (ticker: string, id: number): AllocationMember => ({
  security_id: id, ticker, name: `${ticker} fund`, account: null, shares: '10', market_value: '150.00',
  quoted_at: '2026-09-10T00:00:00Z', classification_source: 'Existing security records', classification_reviewed_at: null,
})
const DATA: AllocationData = {
  by: 'asset_class', scope_key: 'household', total_market_value: '500.00', as_of: '2026-09-10T00:00:00Z',
  latest_quote_at: '2026-09-10T00:00:00Z', source_href: '/portfolio?section=holdings',
  slices: [
    { key: 'equity', label: 'Equity', market_value: '200.00', weight_pct: '0.4', holdings: 1, is_unknown: false, members: [member('NVDA', 1)] },
    { key: '__unknown__', label: 'Unknown', market_value: '300.00', weight_pct: '0.6', holdings: 2, is_unknown: true, members: [member('VFFSX', 2), member('FXAIX', 3)] },
  ],
  coverage: { holding_count: 3, priced_count: 3, unpriced_count: 0, classified_count: 1, classified_market_value: '200.00',
    unknown_market_value: '300.00', classified_weight_pct: '0.4', unpriced_holdings: [], warnings: [] },
  target_set: null, draft_target_set: null, drift: [],
}
const row = (id: number, ticker: string, over: Partial<SecurityClassification> = {}): SecurityClassification => ({
  security_id: id, ticker, name: `${ticker} fund`, holding_type: 'mutual_fund', asset_class: null, industry: null, geography: null,
  source: 'Existing security records', note: null, reviewed_at: null, industry_available: false, ...over,
})
const ROWS = [row(2, 'VFFSX'), row(3, 'FXAIX'), row(1, 'NVDA', { holding_type: 'stock', asset_class: 'equity', geography: 'us', industry: 'Semis', reviewed_at: '2026-09-01T00:00:00Z', industry_available: true })]
const EMPLOYER: EmployerExposure = { ticker: null, scope_key: 'household', as_of: '2026-09-10', quoted_at: null, held_shares: '0', held_value: null,
  held_weight_pct: null, priced_portfolio_value: '500.00', unvested_shares: 0, unvested_value: null, unvested_scope: 'primary', warnings: [] }

beforeEach(() => {
  vi.mocked(fetchAllocationData).mockResolvedValue(DATA)
  vi.mocked(fetchClassifications).mockResolvedValue(ROWS)
  vi.mocked(fetchEmployerExposure).mockResolvedValue(EMPLOYER)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const renderPanel = () => render(<MemoryRouter><AllocationPanel holdings={[]} onSelectTicker={vi.fn()} /></MemoryRouter>)

describe('AllocationPanel — one card', () => {
  it('renders the donut with the coverage line and the ranked table as its aside, spelling Unclassified', async () => {
    const { container } = renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    expect(container.querySelector('.allocation-overview-grid')).toBeNull()
    expect(container.querySelector('.allocation-ranked')).toBeNull()
    const card = screen.getByLabelText('Portfolio allocation by asset class').closest('.chart-card') as HTMLElement
    const aside = card.querySelector('.allocation-aside') as HTMLElement
    expect(aside).not.toBeNull()
    expect(aside.querySelector('.allocation-coverage-line')?.textContent).toBe('3 of 3 holdings priced · 40.0% of priced value classified')
    expect([...aside.querySelectorAll('.allocation-ranked-table tbody th button')].map((b) => b.textContent)).toEqual(['Equity', 'Unclassified'])
    expect(screen.getByTestId('echart').getAttribute('data-names')).toBe('Equity|Unclassified')
    // The coverage-count caveat belongs to books with unpriced holdings only (§14, C5).
    expect(screen.queryByText(/Missing-price value cannot be estimated/)).toBeNull()
    expect(screen.queryByText('Missing quotes (0)')).toBeNull()
  })

  it('shows the Missing-quotes disclosure and the caveat only when holdings are unpriced', async () => {
    vi.mocked(fetchAllocationData).mockResolvedValue({ ...DATA, coverage: { ...DATA.coverage, holding_count: 4, unpriced_count: 1,
      unpriced_holdings: [{ ...member('GAP', 9), market_value: null, quoted_at: null }] } })
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    expect(screen.getByText(/Missing-price value cannot be estimated/)).toBeTruthy()
    expect(screen.getByText('Missing quotes (1)').closest('details.disclosure')).not.toBeNull()
  })

  it('orders the cards allocation → Security classifications → targets', async () => {
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    expectInDocumentOrder(
      screen.getByLabelText('Portfolio allocation by asset class').closest('.chart-card') as HTMLElement,
      screen.getByRole('region', { name: 'Security classifications' }),
      screen.getByRole('region', { name: 'Allocation targets' }),
    )
  })

  it('the Unclassified row offers "Classify these 2 holdings"; the click pins the chip, scrolls the card in and focuses a select', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    try {
      renderPanel()
      const classify = await screen.findByRole('button', { name: 'Classify these 2 holdings' })
      await screen.findByLabelText('VFFSX asset class')
      // Scoped to the chip group: the ranked table's own "Unclassified" category button would
      // otherwise match the same prefix.
      const chips = within(screen.getByRole('group', { name: 'Classification filter' }))
      fireEvent.click(chips.getByRole('button', { name: /^All/ }))
      expect(screen.getByLabelText('NVDA asset class')).toBeTruthy()
      fireEvent.click(classify)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      expect(chips.getByRole('button', { name: /^Unclassified/ }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.queryByLabelText('NVDA asset class')).toBeNull()
      expect(document.activeElement).toBe(screen.getByLabelText('VFFSX asset class'))
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('selecting the Unclassified slice puts the classify action ahead of the Open buttons', async () => {
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    fireEvent.click(screen.getByRole('button', { name: 'Unclassified' }))
    const detail = document.querySelector('.chart-inline-selection') as HTMLElement
    expect(detail).not.toBeNull()
    expect(screen.getByRole('article', { name: 'Unclassified selected values' })).toBeTruthy()
    const labels = [...detail.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels.indexOf('Classify these 2 holdings')).toBeGreaterThan(-1)
    expect(labels.indexOf('Classify these 2 holdings')).toBeLessThan(labels.indexOf('Open VFFSX'))
    expect(labels).toContain('Open FXAIX')
  })

  it('an Equity selection carries no classify action', async () => {
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    fireEvent.click(screen.getByRole('button', { name: 'Equity' }))
    const detail = document.querySelector('.chart-inline-selection') as HTMLElement
    expect(detail.textContent).not.toContain('Classify these')
    expect(detail.textContent).toContain('Open NVDA')
  })
})
