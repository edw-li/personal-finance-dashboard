import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { TaxBracketsOut, TaxInputsOut, TaxSummaryOut, TaxYearOut } from '../types/api'
import TaxesPage from './TaxesPage'

// JURISDICTIONS (render order) stays real; every request is stubbed.
vi.mock('../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/taxes')>()),
  fetchTaxYears: vi.fn(),
  fetchTaxInputs: vi.fn(),
  fetchTaxBrackets: vi.fn(),
  fetchTaxSummary: vi.fn(),
  putTaxInputs: vi.fn(),
  putTaxBrackets: vi.fn(),
  cloneBrackets: vi.fn(),
}))
import {
  cloneBrackets,
  fetchTaxBrackets,
  fetchTaxInputs,
  fetchTaxSummary,
  fetchTaxYears,
  putTaxInputs,
} from '../api/taxes'

const year2023: TaxYearOut = { year: 2023, notes: null, input_count: 21, bracket_count: 42 }
const year2024: TaxYearOut = { year: 2024, notes: null, input_count: 21, bracket_count: 42 }
const year2025: TaxYearOut = { year: 2025, notes: null, input_count: 0, bracket_count: 42 }

function inputsFor(year: number): TaxInputsOut {
  return {
    year,
    sections: [
      {
        section: 'ordinary_income',
        items: [
          {
            key: 'annual_salary', label: 'Annual Salary', sort_order: 10,
            is_derived: false, value: '200000.0000', suggested: null,
          },
        ],
      },
    ],
  }
}

function bracketsFor(year: number): TaxBracketsOut {
  return {
    year,
    jurisdictions: {
      federal: [{ bracket_index: 1, rate: '0.1000', threshold: '0.00' }],
      state: [],
      medicare: [],
      social_security: [],
      disability: [],
      capital_gains: [],
    },
  }
}

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
    capital_gains: {
      taxable_income: '0.00', gains_amount: '0.00', tax: '0.00', effective_rate: null,
    },
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

beforeEach(() => {
  vi.mocked(fetchTaxYears).mockResolvedValue([year2023, year2024])
  vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(fetchTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(fetchTaxSummary).mockImplementation(async (year: number) => summaryFor(year))
  vi.mocked(cloneBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(putTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaxesPage', () => {
  it('renders a chip per tax year and loads the latest', async () => {
    render(<TaxesPage />)
    await screen.findByRole('button', { name: '2024' })
    expect(screen.getByRole('button', { name: '2023' })).toBeTruthy()
    // Latest year wins on arrival — the sheet's rightmost column.
    expect((screen.getByRole('button', { name: '2024' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))
    expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2024)
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledWith(2024)
    // The raw totals line (Task 7 replaces it with the summary panel) renders SERVER
    // numbers — nothing is re-derived here.
    expect(await screen.findByText('$123,456.78')).toBeTruthy()
    expect(screen.getByText('$376,543.22')).toBeTruthy()
  })

  it('reloads inputs, brackets and summary on a year switch — and not on a re-click', async () => {
    render(<TaxesPage />)
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))

    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))
    expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2023)
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledWith(2023)
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2)

    // Clicking the SELECTED chip must not refetch (MonthlyUpdatePage's same-month lesson).
    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledTimes(2)
  })

  it('creates a year by cloning the latest brackets, then reloads years and selects it', async () => {
    vi.mocked(fetchTaxYears)
      .mockResolvedValueOnce([year2023, year2024])
      .mockResolvedValueOnce([year2023, year2024, year2025])
    render(<TaxesPage />)
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))

    // Default = latest + 1.
    expect((screen.getByLabelText('New year') as HTMLInputElement).value).toBe('2025')
    fireEvent.click(screen.getByRole('button', { name: /create year/i }))

    await waitFor(() => expect(vi.mocked(cloneBrackets)).toHaveBeenCalledWith(2025, 2024))
    // Reload the year list, then jump to the new year.
    await waitFor(() => expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2025))
    expect(await screen.findByRole('button', { name: '2025' })).toBeTruthy()
  })

  it('surfaces a clone 409 inline and stays on the current year', async () => {
    vi.mocked(cloneBrackets).mockRejectedValue(
      new ApiError('tax year 2025 already has 42 brackets', 409),
    )
    render(<TaxesPage />)
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))

    fireEvent.click(screen.getByRole('button', { name: /create year/i }))
    expect(await screen.findByText('tax year 2025 already has 42 brackets')).toBeTruthy()
    // No jump: the year list never changed.
    expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1)
  })

  it('offers the new-year form on a fresh database with no years', async () => {
    const thisYear = new Date().getFullYear()
    vi.mocked(fetchTaxYears)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ year: thisYear, notes: null, input_count: 0, bracket_count: 0 }])
    render(<TaxesPage />)

    expect(await screen.findByText(/no tax years yet/i)).toBeTruthy()
    expect((screen.getByLabelText('New year') as HTMLInputElement).value).toBe(String(thisYear))
    expect(vi.mocked(fetchTaxInputs)).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /create year/i }))
    // Nothing to clone FROM: the empty inputs PUT is what auto-creates the tax_years row.
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(thisYear, { values: {} }))
    expect(vi.mocked(cloneBrackets)).not.toHaveBeenCalled()
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(thisYear))
  })
})
