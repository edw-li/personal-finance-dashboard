import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  fetchAllTaxSummaries: vi.fn(),
  putTaxInputs: vi.fn(),
  putTaxBrackets: vi.fn(),
  cloneBrackets: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law), so the wrapper
// the summary panel mounts is a marker div here. What the charts actually DRAW is pinned
// against the golden summaries in src/components/taxes/taxChartOptions.test.ts; this file
// only asks whether a chart is on screen at all. The async factory + dynamic import keeps
// the JSX runtime out of vi.mock's hoisted scope.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', { 'data-testid': 'echart' }) }
})
import {
  cloneBrackets,
  fetchAllTaxSummaries,
  fetchTaxBrackets,
  fetchTaxInputs,
  fetchTaxSummary,
  fetchTaxYears,
  putTaxBrackets,
  putTaxInputs,
} from '../api/taxes'

// A promise this file settles by hand — the only way to hold two refreshes in flight at
// once and choose which one answers first.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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

// The engine's own sparse-year sentence: ENGINE_INPUT_KEYS in definition order, all 21 of
// them, in ONE line (backend/app/services/tax_service.py MISSING_INPUTS_WARNING). It is
// rendered verbatim — the list IS the message.
const MISSING_21 =
  'missing inputs defaulted to 0: latest_w2_income, other_w2_income, stcg_total, ' +
  'stcg_standard, unqualified_dividends, unq_div_us_treasuries_etf, ' +
  'unq_div_state_exempt_pct, interest_total, other_income_1099, trad_401k_contributions, ' +
  'hsa_contributions, hsa_contributions_employer, other_pretax_deductions, ' +
  'standard_deduction, itemized_deduction, state_standard_deduction, ' +
  'state_exemption_credits, ltcg_total, ltcg_brokerage, qualified_dividends, ' +
  'other_capital_gains'

const salary = () => screen.getByLabelText('Annual Salary') as HTMLInputElement
const saveInputs = () => screen.getByRole('button', { name: /save inputs/i }) as HTMLButtonElement

// The unsaved-work guard is a window.confirm; "yes" is the default so only the tests that
// are ABOUT the guard have to think about it.
const confirmSpy = vi.spyOn(window, 'confirm')

beforeEach(() => {
  vi.mocked(fetchTaxYears).mockResolvedValue([year2023, year2024])
  vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(fetchTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(fetchTaxSummary).mockImplementation(async (year: number) => summaryFor(year))
  // The panel's own feed. Empty by default so no test's pins can collide with a trend
  // year's numbers; the tests that are ABOUT the trend fill it in.
  vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [] })
  vi.mocked(cloneBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(putTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(putTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  confirmSpy.mockReturnValue(true)
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
    // The summary panel's tiles render SERVER numbers — nothing is re-derived here.
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

  it('keeps a created year on screen when the list reload fails, and reconciles on Retry', async () => {
    vi.mocked(fetchTaxYears)
      .mockResolvedValueOnce([year2023, year2024])
      .mockRejectedValueOnce(new ApiError('years unavailable', 503))
      .mockResolvedValue([year2023, year2024, year2025])
    render(<TaxesPage />)
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))

    fireEvent.click(screen.getByRole('button', { name: /create year/i }))
    await waitFor(() => expect(vi.mocked(cloneBrackets)).toHaveBeenCalledWith(2025, 2024))

    // The clone SUCCEEDED, so this failure belongs to the main banner — the one with a
    // Retry. Under the create form the only affordance left is a Create that now 409s.
    expect(await screen.findByText('years unavailable')).toBeTruthy()
    // And the year exists, so the page is on it: optimistically, with placeholder counts.
    const chip = await screen.findByRole('button', { name: '2025' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip.getAttribute('title')).toBe('0 inputs · 0 brackets')
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2025))
    // 2025's payloads arriving must NOT clear the banner underneath them — the two
    // requests are in flight together, and only one of them failed.
    expect(await screen.findByText('$123,456.78')).toBeTruthy()
    expect(screen.getByText('years unavailable')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.queryByText('years unavailable')).toBeNull())
    // Reconciled: the server's counts replace the placeholder.
    expect(screen.getByRole('button', { name: '2025' }).getAttribute('title')).toBe(
      '0 inputs · 42 brackets',
    )
  })

  it('shows ONLY the banner when the first year-list load fails', async () => {
    vi.mocked(fetchTaxYears).mockRejectedValueOnce(new ApiError('years unavailable', 503))
    render(<TaxesPage />)

    expect(await screen.findByText('years unavailable')).toBeTruthy()
    // A load that never came back knows nothing about whether the database is empty.
    expect(screen.queryByText(/no tax years yet/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: '2024' })).toBeTruthy()
    expect(screen.queryByText(/no tax years yet/i)).toBeNull()
  })

  it('asks before a year switch that would discard typed work', async () => {
    confirmSpy.mockReturnValue(false)
    render(<TaxesPage />)
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '999' } })

    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes for 2024?')
    // Declined: nothing was refetched and nothing was lost.
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1)
    expect(salary().value).toBe('999')

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))
    // A REAL switch remounts the editors, which is what discards the work.
    await waitFor(() => expect(salary().value).toBe('200000.0000'))
  })

  it('asks before creating a year that would discard typed work', async () => {
    confirmSpy.mockReturnValue(false)
    render(<TaxesPage />)
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '999' } })

    fireEvent.change(screen.getByLabelText('New year'), { target: { value: '2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create year' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes for 2024?')
    // Declined BEFORE the request: no year was created, nothing was lost.
    expect(vi.mocked(cloneBrackets)).not.toHaveBeenCalled()
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()
    expect(salary().value).toBe('999')
  })

  it('keeps typed work across a same-year reload', async () => {
    vi.mocked(fetchTaxSummary)
      .mockResolvedValueOnce(summaryFor(2024))
      .mockRejectedValueOnce(new ApiError('totals unavailable', 500))
    render(<TaxesPage />)
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '4242' } })

    // A BRACKETS save moves the totals; that refresh failing is what puts a Retry on
    // screen without touching the inputs form.
    fireEvent.click(screen.getByRole('button', { name: 'Save Federal brackets' }))
    expect(await screen.findByText('totals unavailable')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes for 2024?')
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(2))
    // Same year, so the editors were never remounted and their state seeds from a
    // useState initializer — the replaced payload cannot reach into it.
    expect(salary().value).toBe('4242')
  })

  it('lets only the newest totals refresh land', async () => {
    const slow = deferred<TaxSummaryOut>()
    const fast = deferred<TaxSummaryOut>()
    const older = summaryFor(2024)
    older.totals.total_tax = '11.11'
    const newer = summaryFor(2024)
    newer.totals.total_tax = '22.22'
    vi.mocked(fetchTaxSummary)
      .mockResolvedValueOnce(summaryFor(2024)) // the initial load
      .mockReturnValueOnce(slow.promise) // the first save's refresh
      .mockReturnValueOnce(fast.promise) // the second save's
    render(<TaxesPage />)
    await screen.findByLabelText('Annual Salary')

    fireEvent.change(salary(), { target: { value: '210000' } })
    fireEvent.click(saveInputs())
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))

    fireEvent.change(salary(), { target: { value: '220000' } })
    await waitFor(() => expect(saveInputs().disabled).toBe(false))
    fireEvent.click(saveInputs())
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(3))

    fast.resolve(newer)
    expect(await screen.findByText('$22.22')).toBeTruthy()
    // The older refresh answers LAST and must not roll the totals back to its snapshot.
    await act(async () => {
      slow.resolve(older)
    })
    expect(screen.queryByText('$11.11')).toBeNull()
    expect(screen.getByText('$22.22')).toBeTruthy()
  })

  it('never banners a totals refresh that a year switch has outlived', async () => {
    const pending = deferred<TaxSummaryOut>()
    vi.mocked(fetchTaxSummary)
      .mockResolvedValueOnce(summaryFor(2024))
      .mockReturnValueOnce(pending.promise)
    render(<TaxesPage />)
    await screen.findByLabelText('Annual Salary')

    fireEvent.change(salary(), { target: { value: '210000' } })
    fireEvent.click(saveInputs())
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))

    await act(async () => {
      pending.reject(new ApiError('totals unavailable', 500))
    })
    // The failure belongs to a year nobody is looking at.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('refreshes the totals AND the chip counts after a save', async () => {
    render(<TaxesPage />)
    await screen.findByLabelText('Annual Salary')
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(1)

    fireEvent.change(salary(), { target: { value: '210000' } })
    fireEvent.click(saveInputs())

    // The engine's answer moved, so the totals line is refetched...
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenLastCalledWith(2024)
    // ...and so are the input/bracket counts the chips carry.
    await waitFor(() => expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '2024' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('drops a bracket save that echoes after a year switch', async () => {
    const pending = deferred<TaxBracketsOut>()
    vi.mocked(putTaxBrackets).mockReturnValueOnce(pending.promise)
    render(<TaxesPage />)
    await screen.findByLabelText('Federal bracket 1 rate (%)')

    fireEvent.click(screen.getByRole('button', { name: 'Save Federal brackets' }))
    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2023))
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))

    // 2024's echo, landing on 2023's page.
    const stale = bracketsFor(2024)
    stale.jurisdictions.federal = [{ bracket_index: 1, rate: '0.9900', threshold: '0.00' }]
    await act(async () => {
      pending.resolve(stale)
    })

    expect(screen.getByRole('button', { name: '2023' }).getAttribute('aria-pressed')).toBe('true')
    // 2023's table is untouched — and no totals refetch was spent on the year that is gone.
    const rate = screen.getByLabelText('Federal bracket 1 rate (%)') as HTMLInputElement
    expect(rate.value).toBe('10')
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2)
  })

  it('answers an out-of-range year itself rather than leaving it to the browser', async () => {
    render(<TaxesPage />)
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))

    const input = screen.getByLabelText('New year')
    // A native bubble is worded by the engine, sits outside the page's error vocabulary
    // and never lets this code run at all.
    expect(input.closest('form')?.hasAttribute('novalidate')).toBe(true)

    fireEvent.change(input, { target: { value: '3025' } })
    fireEvent.click(screen.getByRole('button', { name: /create year/i }))
    expect(screen.getByText('Enter a year between 1900 and 2100')).toBeTruthy()
    expect(vi.mocked(cloneBrackets)).not.toHaveBeenCalled()
  })

  it('retires the create error when the user moves on', async () => {
    vi.mocked(cloneBrackets).mockRejectedValue(
      new ApiError('tax year 2025 already has 42 brackets', 409),
    )
    render(<TaxesPage />)
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))

    fireEvent.click(screen.getByRole('button', { name: /create year/i }))
    expect(await screen.findByText('tax year 2025 already has 42 brackets')).toBeTruthy()

    // The sentence is about the year that WAS in the box.
    fireEvent.change(screen.getByLabelText('New year'), { target: { value: '2026' } })
    expect(screen.queryByText('tax year 2025 already has 42 brackets')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /create year/i }))
    expect(await screen.findByText('tax year 2025 already has 42 brackets')).toBeTruthy()
    // Navigating away answers it too — it has nothing to say about 2023.
    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() =>
      expect(screen.queryByText('tax year 2025 already has 42 brackets')).toBeNull(),
    )
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

  // --- the summary panel (Task 7) ------------------------------------------------------

  it('renders the totals as stat tiles beside the waterfall and the trend', async () => {
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({
      years: [summaryFor(2023), summaryFor(2024)],
    })
    render(<TaxesPage />)

    expect(await screen.findByText('$123,456.78')).toBeTruthy() // total tax
    expect(screen.getByText('Gross income')).toBeTruthy()
    expect(screen.getByText('$500,000.00')).toBeTruthy()
    expect(screen.getByText('Total tax')).toBeTruthy()
    expect(screen.getByText('Take-home')).toBeTruthy()
    expect(screen.getByText('$376,543.22')).toBeTruthy()
    expect(screen.getByText('Effective rate')).toBeTruthy()
    // The server's 6dp rate, rendered by format.ts and never recomputed from the tiles.
    expect(screen.getByText('24.7%')).toBeTruthy()
    // Two charts: this year's waterfall and the all-years trend.
    await waitFor(() => expect(screen.getAllByTestId('echart')).toHaveLength(2))
  })

  it('renders every engine warning verbatim, including the 21-key sparse-year line', async () => {
    const sparse = summaryFor(2024)
    sparse.warnings = [MISSING_21, 'no state brackets for 2024: state tax computed as 0']
    vi.mocked(fetchTaxSummary).mockResolvedValue(sparse)
    render(<TaxesPage />)

    // One text node, wrapped by CSS — not truncated, not summarised, not re-worded.
    expect(await screen.findByText(MISSING_21)).toBeTruthy()
    expect(screen.getByText('no state brackets for 2024: state tax computed as 0')).toBeTruthy()
  })

  it('offers a note instead of a waterfall for a year that computes to zeros', async () => {
    const zeros = summaryFor(2024)
    zeros.totals = {
      gross_income: '0.00', total_income: '0.00', total_tax: '0.00',
      take_home: '0.00', effective_rate: null,
    }
    vi.mocked(fetchTaxSummary).mockResolvedValue(zeros)
    render(<TaxesPage />)

    expect(await screen.findByText(/nothing to chart yet/i)).toBeTruthy()
    // And an empty feed is an answer of its own, distinct from "still loading".
    expect(await screen.findByText(/no years with stored inputs/i)).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('loads the trend feed once per visit, and again after a save lands', async () => {
    render(<TaxesPage />)
    await screen.findByLabelText('Annual Salary')
    await waitFor(() => expect(vi.mocked(fetchAllTaxSummaries)).toHaveBeenCalledTimes(1))

    // A year switch cannot move an ALL-years feed, so it must not spend a request on it.
    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchAllTaxSummaries)).toHaveBeenCalledTimes(1)

    // A save does move it: this year's column just changed.
    fireEvent.change(salary(), { target: { value: '210000' } })
    fireEvent.click(saveInputs())
    await waitFor(() => expect(vi.mocked(fetchAllTaxSummaries)).toHaveBeenCalledTimes(2))
  })

  it('notes a trend-feed failure without disturbing the selected year', async () => {
    vi.mocked(fetchAllTaxSummaries).mockRejectedValue(new ApiError('trend unavailable', 503))
    render(<TaxesPage />)

    expect(await screen.findByText('trend unavailable')).toBeTruthy()
    // Different request, still on screen: the year's own totals are unaffected.
    expect(screen.getByText('$123,456.78')).toBeTruthy()
    expect(screen.getAllByTestId('echart')).toHaveLength(1)
  })
})
