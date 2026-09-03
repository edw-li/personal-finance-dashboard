import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HoldingsResponse,
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummaryOut,
  TaxYearOut,
  WhatIfOut,
} from '../types/api'
import { clearSnapshots } from '../api/snapshotCache'
import TaxesPage from './TaxesPage'

// The assistant's link, end to end. TaxesPage.test.tsx stands the what-if card in for a
// marker — deliberately, since that card owns three feeds and a file of its own — so
// nothing there can say whether the ENTRIES reach it, and WhatIfPanel.test.tsx mounts the
// card alone, so nothing there can say which year the page picked. `sandbox_links.py` emits
// /taxes?year=YYYY&whatif=…, and the only thing that makes that link honest is the two
// halves meeting: the year selected BEFORE any fetch, and the entries run against it.
vi.mock('../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/taxes')>()),
  fetchTaxYears: vi.fn(),
  fetchTaxInputs: vi.fn(),
  fetchTaxBrackets: vi.fn(),
  fetchTaxSummary: vi.fn(),
  fetchAllTaxSummaries: vi.fn(),
  fetchWithholding: vi.fn(),
}))
vi.mock('../api/whatif', () => ({ runWhatIf: vi.fn() }))
vi.mock('../api/portfolio', () => ({ fetchHoldings: vi.fn() }))
vi.mock('../api/espp', () => ({ fetchLots: vi.fn() }))
vi.mock('../api/limits', () => ({ fetchLimits: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law).
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel }: { ariaLabel?: string }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel }),
  }
})
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../components/ToastProvider', () => ({ useToast: () => toast }))
import { fetchLots } from '../api/espp'
import { fetchLimits } from '../api/limits'
import { fetchHoldings } from '../api/portfolio'
import {
  fetchAllTaxSummaries,
  fetchTaxBrackets,
  fetchTaxInputs,
  fetchTaxSummary,
  fetchTaxYears,
  fetchWithholding,
} from '../api/taxes'
import { runWhatIf } from '../api/whatif'

const yearRow = (year: number): TaxYearOut => ({
  year,
  notes: null,
  input_count: 21,
  bracket_count: 42,
  filing_status: 'single',
})

const inputsFor = (year: number): TaxInputsOut => ({
  year,
  filing_status: 'single',
  people: [{ id: 1, name: 'Alex' }],
  sections: [
    {
      section: 'ordinary_income',
      items: [
        {
          key: 'annual_salary',
          label: 'Annual Salary',
          sort_order: 10,
          is_derived: false,
          value: '200000.0000',
          suggested: null,
          is_per_person: true,
          person_id: 1,
        },
      ],
    },
  ],
})

const bracketsFor = (year: number): TaxBracketsOut => ({
  year,
  filing_status: 'single',
  statuses_with_rows: ['single'],
  jurisdictions: {
    federal: [{ bracket_index: 1, rate: '0.1000', threshold: '0.00' }],
    state: [],
    medicare: [],
    social_security: [],
    disability: [],
    capital_gains: [],
  },
})

function summaryFor(year: number): TaxSummaryOut {
  const income = { agi: '0.00', taxable_income: '0.00', tax: '0.00', effective_rate: null }
  const wage = { w2_income: '0.00', taxable_wages: '0.00', tax: '0.00', effective_rate: null }
  return {
    year,
    federal: income,
    state: income,
    medicare: wage,
    social_security: wage,
    disability: wage,
    capital_gains: { taxable_income: '0.00', gains_amount: '0.00', tax: '0.00', effective_rate: null },
    totals: {
      gross_income: '500000.00',
      total_income: '500000.00',
      total_tax: '123456.78',
      take_home: '376543.22',
      effective_rate: '0.246914',
    },
    warnings: [],
  }
}

const holdings = (): HoldingsResponse => ({
  holdings: [
    {
      security_id: 7,
      ticker: 'VTI',
      name: 'VTI fund',
      industry: null,
      holding_type: 'etf',
      is_manual_priced: false,
      shares: '100.000000',
      avg_cost: '50.0000',
      cost_basis: '5000.00',
      price: '62.5000',
      quoted_at: '2026-08-20T00:00:00Z',
      price_source: 'yfinance',
      day_change_pct: null,
      day_change_amount: null,
      market_value: '6250.00',
      weight_pct: null,
      unrealized_gl: null,
      unrealized_gl_pct: null,
      realized_gl: '0.00',
      dividends_collected: '0.00',
      annual_dividend: null,
      annual_income: null,
      yield_pct: null,
      yoc_pct: null,
      xirr_pct: null,
      accounts: [],
      warnings: [],
    },
  ],
  totals: {
    market_value: '6250.00',
    cost_basis: '5000.00',
    unrealized_gl: '1250.00',
    unrealized_gl_pct: '0.25',
    day_change_amount: null,
    day_change_pct: null,
    realized_gl: '0.00',
    dividends_collected: '0.00',
    annual_income: '0.00',
    unpriced_count: 0,
  },
  as_of: '2026-08-20T00:00:00Z',
  latest_quote_at: '2026-08-20T00:00:00Z',
})

function whatIfOut(year: number): WhatIfOut {
  return {
    year,
    baseline: summaryFor(year),
    scenario: summaryFor(year),
    delta: {
      total_tax: '4321.00',
      take_home: '-4321.00',
      federal_tax: '3000.00',
      state_tax: '1000.00',
      medicare_tax: '221.00',
      social_security_tax: '100.00',
      disability_tax: '0.00',
      capital_gains_tax: '0.00',
      effective_rate: '0.034320',
    },
    changed_inputs: [],
    sale_details: [],
    espp_sale_details: [],
    warnings: [],
  }
}

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}

const openButton = () =>
  screen.getByRole('button', { name: /^(Open|Close) what-if$/ }) as HTMLButtonElement

beforeEach(() => {
  clearSnapshots()
  localStorage.clear() // pins live in finance.sandbox.taxes
  vi.mocked(fetchTaxYears).mockResolvedValue([yearRow(2023), yearRow(2024)])
  vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(fetchTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(fetchTaxSummary).mockImplementation(async (year: number) => summaryFor(year))
  vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [] })
  vi.mocked(fetchWithholding).mockRejectedValue(new Error('not asked for a past year'))
  vi.mocked(fetchHoldings).mockResolvedValue(holdings())
  vi.mocked(fetchLots).mockResolvedValue({ espp_ticker: null, current_price: null, quoted_at: null, lots: [] })
  vi.mocked(fetchLimits).mockResolvedValue({ year: 2023, items: [] })
  vi.mocked(runWhatIf).mockImplementation(async (body) => whatIfOut(body.year))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the assistant’s sandbox link, page and card together', () => {
  it('opens the year the link names before any fetch, and runs its entries against it', async () => {
    render(
      <MemoryRouter initialEntries={['/taxes?year=2023&whatif=sale%3A7%3A40']}>
        <TaxesPage />
        <Url />
      </MemoryRouter>,
    )

    // Half one: the year. 2023's three payloads are the FIRST ones asked for — the latest
    // year is never loaded on the way past, so the entries can never run against it.
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))
    expect(vi.mocked(fetchTaxInputs)).not.toHaveBeenCalledWith(2024)
    expect(vi.mocked(fetchTaxSummary)).not.toHaveBeenCalledWith(2024)

    // Half two: the entries. The card is open on arrival and the leg is already in flight,
    // stamped with the linked year rather than the page's default.
    await waitFor(() => expect(openButton().getAttribute('aria-expanded')).toBe('true'))
    await waitFor(() =>
      expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({
        year: 2023,
        sales: [{ security_id: 7, shares: '40', term: 'long' }],
        espp_sales: [],
      }),
    )
    // Nothing rewrote the address the user is sitting on.
    expect(screen.getByTestId('url').textContent).toBe('/taxes?year=2023&whatif=sale%3A7%3A40')
  })
})
