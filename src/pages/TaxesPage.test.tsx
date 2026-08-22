import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type {
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummariesOut,
  TaxSummaryOut,
  TaxYearOut,
  WithholdingOut,
} from '../types/api'
import TaxesPage from './TaxesPage'

// JURISDICTIONS (render order) stays real; every request is stubbed — including the
// withholding card's own, which the page mounts (unmocked, unlike the what-if one) whenever
// the selected year IS the current one.
vi.mock('../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/taxes')>()),
  fetchTaxYears: vi.fn(),
  fetchTaxInputs: vi.fn(),
  fetchTaxBrackets: vi.fn(),
  fetchTaxSummary: vi.fn(),
  fetchAllTaxSummaries: vi.fn(),
  fetchWithholding: vi.fn(),
  putTaxInputs: vi.fn(),
  putTaxBrackets: vi.fn(),
  cloneBrackets: vi.fn(),
  deleteTaxYear: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law), so the wrapper
// the summary panel mounts is a marker div here. What the charts actually DRAW is pinned
// against the golden summaries in src/components/taxes/taxChartOptions.test.ts; this file
// only asks whether a chart is on screen — and, via the x-axis categories the marker
// carries, WHICH feed drew it. The async factory + dynamic import keeps the JSX runtime
// out of vi.mock's hoisted scope.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      onClick,
    }: {
      option: { xAxis?: { data?: unknown[] } }
      onClick?: (params: { name?: string }) => void
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
        // A click on the marker stands in for a click on the chart's FIRST category —
        // enough to walk the trend's drill-in door both ways without a canvas. Charts
        // given no handler (the waterfall) stay inert, like the real thing.
        onClick: () => onClick?.({ name: String((option.xAxis?.data ?? [])[0] ?? '') }),
      }),
  }
})
// The what-if card owns two feeds and a whole test file of its own (WhatIfPanel.test.tsx
// pins the seeding end of the deep links, and its own year-keyed remount). Here it is a
// marker reporting the three props the page hands it — which IS this page's whole contract
// with it, and keeps a card the page never opens from spending requests in these tests.
vi.mock('../components/taxes/WhatIfPanel', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      year,
      initialTicker,
      initialLotId,
    }: {
      year: number
      initialTicker?: string | null
      initialLotId?: number | null
    }) =>
      createElement('div', {
        'data-testid': 'whatif-panel',
        'data-year': String(year),
        'data-ticker': initialTicker ?? '',
        'data-lot': initialLotId == null ? '' : String(initialLotId),
      }),
  }
})
import {
  cloneBrackets,
  deleteTaxYear,
  fetchAllTaxSummaries,
  fetchTaxBrackets,
  fetchTaxInputs,
  fetchTaxSummary,
  fetchTaxYears,
  fetchWithholding,
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

// The withholding card's feed — the panel has a file of its own (WithholdingPanel.test.tsx),
// so this is the minimum that renders, with figures deliberately unlike every other fixture's
// so a tile of it can never be mistaken for one of the summary panel's.
function withholdingFor(year: number): WithholdingOut {
  const leg = { ytd: '2000.00', projected: '4000.00' }
  return {
    year,
    liability_total: '5000.00',
    salary: leg,
    vest: {
      income_ytd: '0.00', income_projected: '0.00',
      supplemental_ytd: '0.00', supplemental_projected: '0.00',
      fica_ytd: '0.00', fica_projected: '0.00',
    },
    total: leg,
    balance_projected: '1000.00',
    checks_elapsed: 12,
    checks_total: 24,
    safe_harbor: null,
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

// The tax inputs and the bracket cells are AmountInputs now, so a BLURRED box reads its
// formatted echo, not its raw state (spec §3.3): "999" shows as "$999.00", and a percent
// cell's "10" as "10%". Every `.value` pin below is on a box nothing has focused — the
// echo IS what the user sees — while the wire-body pins stay canonical plain decimals.
const salary = () => screen.getByLabelText('Annual Salary') as HTMLInputElement
const saveInputs = () => screen.getByRole('button', { name: /save inputs/i }) as HTMLButtonElement
const deleteYearButton = () =>
  screen.getByRole('button', { name: /delete year/i }) as HTMLButtonElement
// The one question the delete door asks — worded for a row of tables nobody can get back.
const DELETE_2024_CONFIRM =
  'Delete tax year 2024 and all of its inputs and brackets? This cannot be undone.'
// The trend is the SECOND chart on the page — the selected year's own waterfall is the
// first — and its x-axis categories are the years of whichever feed drew it.
const trendCategories = () => screen.getAllByTestId('echart')[1]?.getAttribute('data-categories')

// The unsaved-work guard is a window.confirm; "yes" is the default so only the tests that
// are ABOUT the guard have to think about it.
const confirmSpy = vi.spyOn(window, 'confirm')

// The URL as the router holds it — the deep-link tests below pin that this page READS the
// what-if params and never rewrites them (a reload re-seeding the same leg is honest).
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

// Every render goes through a router: the page reads the what-if deep-link params with
// useSearchParams, which is not optional about its router.
const renderPage = (entry = '/taxes') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TaxesPage />
      <LocationProbe />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.mocked(fetchTaxYears).mockResolvedValue([year2023, year2024])
  vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(fetchTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(fetchTaxSummary).mockImplementation(async (year: number) => summaryFor(year))
  // The panel's own feed. Empty by default so no test's pins can collide with a trend
  // year's numbers; the tests that are ABOUT the trend fill it in.
  vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [] })
  vi.mocked(fetchWithholding).mockImplementation(async (year: number) => withholdingFor(year))
  vi.mocked(cloneBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(putTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(putTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(deleteTaxYear).mockResolvedValue(undefined)
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaxesPage', () => {
  it('renders a chip per tax year and loads the latest', async () => {
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()

    expect(await screen.findByText('years unavailable')).toBeTruthy()
    // A load that never came back knows nothing about whether the database is empty.
    expect(screen.queryByText(/no tax years yet/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: '2024' })).toBeTruthy()
    expect(screen.queryByText(/no tax years yet/i)).toBeNull()
  })

  it('asks before a year switch that would discard typed work', async () => {
    confirmSpy.mockReturnValue(false)
    renderPage()
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '999' } })

    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes for 2024?')
    // Declined: nothing was refetched and nothing was lost.
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1)
    expect(salary().value).toBe('$999.00')

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))
    // A REAL switch remounts the editors, which is what discards the work.
    await waitFor(() => expect(salary().value).toBe('$200,000.00'))
  })

  it('asks before creating a year that would discard typed work', async () => {
    confirmSpy.mockReturnValue(false)
    renderPage()
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '999' } })

    fireEvent.change(screen.getByLabelText('New year'), { target: { value: '2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create year' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes for 2024?')
    // Declined BEFORE the request: no year was created, nothing was lost.
    expect(vi.mocked(cloneBrackets)).not.toHaveBeenCalled()
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()
    expect(salary().value).toBe('$999.00')
  })

  it('keeps typed work across a same-year reload', async () => {
    vi.mocked(fetchTaxSummary)
      .mockResolvedValueOnce(summaryFor(2024))
      .mockRejectedValueOnce(new ApiError('totals unavailable', 500))
    renderPage()
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
    expect(salary().value).toBe('$4,242.00')
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
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
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
    expect(rate.value).toBe('10%')
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2)
  })

  it('answers an out-of-range year itself rather than leaving it to the browser', async () => {
    renderPage()
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
    renderPage()
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
    renderPage()

    expect(await screen.findByText(/no tax years yet/i)).toBeTruthy()
    expect((screen.getByLabelText('New year') as HTMLInputElement).value).toBe(String(thisYear))
    expect(vi.mocked(fetchTaxInputs)).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /create year/i }))
    // Nothing to clone FROM: the empty inputs PUT is what auto-creates the tax_years row.
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(thisYear, { values: {} }))
    expect(vi.mocked(cloneBrackets)).not.toHaveBeenCalled()
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(thisYear))
  })

  // --- AmountInput adoption: entry scopes and the wire boundary -------------------------

  it('canonicalizes spreadsheet-formatted entry into both PUT bodies', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')

    // A jsdom click never blurs, so the blur-time canonicalization never runs here: the
    // wire boundary in submit() is the only thing between "$210,000" and a Decimal column.
    fireEvent.change(salary(), { target: { value: '$210,000' } })
    fireEvent.click(saveInputs())
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { annual_salary: '210000' },
      }),
    )

    // Same boundary in the bracket editor, which canonicalizes BEFORE it validates — so
    // "$0" is judged as the 0 first threshold the API demands, not refused as a shape.
    fireEvent.change(screen.getByLabelText('Federal bracket 1 threshold'), {
      target: { value: '$0' },
    })
    fireEvent.change(screen.getByLabelText('Federal bracket 1 rate (%)'), {
      target: { value: '12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Federal brackets' }))
    await waitFor(() =>
      expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
        jurisdictions: { federal: [{ rate: '0.12', threshold: '0' }] },
      }),
    )
  })

  it('advances on Enter and saves on Ctrl+Enter in the tax inputs form', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '210000' } })

    // The scope preventDefaults Enter, so it never implicit-submits; on the LAST cell it
    // hands focus to the form's primary instead. This is the documented behavior change.
    act(() => salary().focus())
    fireEvent.keyDown(salary(), { key: 'Enter' })
    expect(document.activeElement).toBe(saveInputs())
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()

    // Ctrl+Enter from inside a cell is what preserves the old save habit.
    act(() => salary().focus())
    fireEvent.keyDown(salary(), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledTimes(1))
  })

  it('walks a bracket row on Enter and stops at the Save of that jurisdiction', async () => {
    renderPage()
    const rate = await screen.findByLabelText('Federal bracket 1 rate (%)')
    const threshold = screen.getByLabelText('Federal bracket 1 threshold')

    act(() => rate.focus())
    fireEvent.keyDown(rate, { key: 'Enter' })
    expect(document.activeElement).toBe(threshold)

    // Last cell of THIS scope: each jurisdiction is its own form, so the walk ends on
    // Federal's Save rather than wandering into the next table's rows.
    fireEvent.keyDown(threshold, { key: 'Enter' })
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Save Federal brackets' }),
    )
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()
  })

  // --- the summary panel (Task 7) ------------------------------------------------------

  it('renders the totals as stat tiles beside the waterfall and the trend', async () => {
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({
      years: [summaryFor(2023), summaryFor(2024)],
    })
    renderPage()

    expect(await screen.findByText('$123,456.78')).toBeTruthy() // total tax
    expect(screen.getByText('Gross income')).toBeTruthy()
    expect(screen.getByText('$500,000.00')).toBeTruthy()
    expect(screen.getByText('Total tax')).toBeTruthy()
    expect(screen.getByText('Take-home')).toBeTruthy()
    expect(screen.getByText('$376,543.22')).toBeTruthy()
    // All four tiles share one size: the hero treatment belongs to pages with ONE
    // headline figure, and here it made take-home shout over its own row.
    expect(
      screen.getByText('$376,543.22').closest('.stat-tile')!.className,
    ).not.toContain('stat-tile-hero')
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
    renderPage()

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
    renderPage()

    expect(await screen.findByText(/nothing to chart yet/i)).toBeTruthy()
    // And an empty feed is an answer of its own, distinct from "still loading".
    expect(await screen.findByText(/no years with stored inputs/i)).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('loads the trend feed once per visit, and again after a save lands', async () => {
    renderPage()
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

  it('lets only the newest trend feed land', async () => {
    // The panel keeps a sequence of its own: the page's `summarySeqRef` guards the
    // per-year totals, and nothing there can speak for an ALL-years feed.
    const slow = deferred<TaxSummariesOut>()
    const fast = deferred<TaxSummariesOut>()
    vi.mocked(fetchAllTaxSummaries)
      .mockReturnValueOnce(slow.promise) // the mount feed
      .mockReturnValueOnce(fast.promise) // the one the save's refreshKey bump starts
    renderPage()
    await screen.findByLabelText('Annual Salary')
    await waitFor(() => expect(vi.mocked(fetchAllTaxSummaries)).toHaveBeenCalledTimes(1))

    // A save bumps refreshKey while the mount feed is still open — two feeds in flight.
    fireEvent.change(salary(), { target: { value: '210000' } })
    fireEvent.click(saveInputs())
    await waitFor(() => expect(vi.mocked(fetchAllTaxSummaries)).toHaveBeenCalledTimes(2))

    await act(async () => {
      fast.resolve({ years: [summaryFor(2025), summaryFor(2026)] })
    })
    await waitFor(() => expect(trendCategories()).toBe('2025,2026'))

    // The mount feed answers LAST, carrying years the save has already superseded.
    await act(async () => {
      slow.resolve({ years: [summaryFor(2021), summaryFor(2022)] })
    })
    expect(trendCategories()).toBe('2025,2026')
  })

  it('drills into a year on a trend click and returns on the next click', async () => {
    // The shared fixture computes every jurisdiction to zero; give 2023 a federal tax so
    // its pie has something to draw. (Replace the object — summaryFor aliases federal
    // and state to ONE `income` literal, so writing through it would tax both.)
    const taxed2023 = summaryFor(2023)
    taxed2023.federal = { ...taxed2023.federal, tax: '1000.00' }
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [taxed2023, summaryFor(2024)] })
    renderPage()
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))

    // The mock forwards the first category: 2023.
    fireEvent.click(screen.getAllByTestId('echart')[1])
    expect(await screen.findByText('Tax breakdown — 2023')).toBeTruthy()
    // Same mount, now a pie — no x axis — and the way back is written beside it, with
    // the SERVER's totals for the year (the pie itself only draws positive slices).
    expect(trendCategories()).toBe('')
    expect(screen.getByText(/click the chart to go back/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All years' })).toBeTruthy()

    // Any click in detail mode returns to all years.
    fireEvent.click(screen.getAllByTestId('echart')[1])
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    expect(screen.queryByText('Tax breakdown — 2023')).toBeNull()
    expect(screen.queryByRole('button', { name: 'All years' })).toBeNull()
  })

  it('offers a note and the All years button for a year whose pie has nothing to draw', async () => {
    // Every jurisdiction is zero in the shared fixture: the drill-in opens on a year
    // with no drawable slice, and the button is the only chart-free way back.
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [summaryFor(2023)] })
    renderPage()
    await waitFor(() => expect(trendCategories()).toBe('2023'))

    fireEvent.click(screen.getAllByTestId('echart')[1])
    expect(await screen.findByText('Tax breakdown — 2023')).toBeTruthy()
    expect(screen.getByText('No tax computed for 2023.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'All years' }))
    await waitFor(() => expect(trendCategories()).toBe('2023'))
    expect(screen.queryByText('No tax computed for 2023.')).toBeNull()
  })

  it('notes a trend-feed failure without disturbing the selected year', async () => {
    vi.mocked(fetchAllTaxSummaries).mockRejectedValue(new ApiError('trend unavailable', 503))
    renderPage()

    expect(await screen.findByText('trend unavailable')).toBeTruthy()
    // Different request, still on screen: the year's own totals are unaffected.
    expect(screen.getByText('$123,456.78')).toBeTruthy()
    expect(screen.getAllByTestId('echart')).toHaveLength(1)
  })

  // --- deleting a year (Task 4) ---------------------------------------------------------

  it('offers a delete affordance that is shut until a year is selected', async () => {
    // A fresh database has nothing to delete — and the button still has to be THERE, or
    // its disabled state would be indistinguishable from a missing feature.
    vi.mocked(fetchTaxYears).mockResolvedValue([])
    renderPage()
    await screen.findByText(/no tax years yet/i)

    // The exact label, pinned once: every other test here finds it by pattern.
    expect(screen.getByRole('button', { name: 'Delete year…' })).toBeTruthy()
    expect(deleteYearButton().disabled).toBe(true)
    // A shut door asks nothing and sends nothing.
    fireEvent.click(deleteYearButton())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(vi.mocked(deleteTaxYear)).not.toHaveBeenCalled()
  })

  it('asks ONE question before deleting — the delete confirm subsumes the discard one', async () => {
    confirmSpy.mockReturnValue(false)
    renderPage()
    await screen.findByLabelText('Annual Salary')
    // Unsaved work, so the discard gate would fire too if the page stacked them.
    fireEvent.change(salary(), { target: { value: '999' } })

    fireEvent.click(deleteYearButton())
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    // And it is the STRONGER question: deleting the year throws away the saved rows as
    // well as the typed ones, so "discard unsaved changes?" has nothing left to ask.
    expect(confirmSpy).toHaveBeenCalledWith(DELETE_2024_CONFIRM)
    // Declined: no request, and the typed work is still there.
    expect(vi.mocked(deleteTaxYear)).not.toHaveBeenCalled()
    expect(salary().value).toBe('$999.00')
    // And no busy leaked out of a question that was answered "no" — the door is open for a
    // second thought.
    expect(deleteYearButton().disabled).toBe(false)
  })

  it('deletes the selected year, then reloads the list and clears the detail panel', async () => {
    vi.mocked(fetchTaxYears)
      .mockResolvedValueOnce([year2023, year2024])
      .mockResolvedValueOnce([year2023])
    renderPage()
    await screen.findByLabelText('Annual Salary')
    await waitFor(() => expect(deleteYearButton().disabled).toBe(false))

    fireEvent.click(deleteYearButton())
    expect(confirmSpy).toHaveBeenCalledWith(DELETE_2024_CONFIRM)
    await waitFor(() => expect(vi.mocked(deleteTaxYear)).toHaveBeenCalledWith(2024))

    // The list is reloaded and the deleted year is gone from the chips...
    await waitFor(() => expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: '2024' })).toBeNull())
    expect(screen.getByRole('button', { name: '2023' })).toBeTruthy()
    // ...and nothing is selected, so the editors and the totals went with it rather than
    // sitting there as a year the server no longer has.
    expect(await screen.findByText(/select a tax year/i)).toBeTruthy()
    expect(screen.queryByLabelText('Annual Salary')).toBeNull()
    expect(screen.queryByText('$123,456.78')).toBeNull()
    expect(deleteYearButton().disabled).toBe(true)
    // Nothing was refetched for the year that is gone.
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops an inputs save that echoes into the year being deleted', async () => {
    const save = deferred<TaxInputsOut>()
    const del = deferred<void>()
    vi.mocked(putTaxInputs).mockReturnValueOnce(save.promise)
    vi.mocked(deleteTaxYear).mockReturnValueOnce(del.promise)
    vi.mocked(fetchTaxYears)
      .mockResolvedValueOnce([year2023, year2024])
      .mockResolvedValue([year2023])
    renderPage()
    await screen.findByLabelText('Annual Salary')

    // A save against 2024 is still open when the year is deleted out from under it.
    fireEvent.change(salary(), { target: { value: '210000' } })
    fireEvent.click(saveInputs())
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledTimes(1))

    fireEvent.click(deleteYearButton())
    expect(confirmSpy).toHaveBeenCalledWith(DELETE_2024_CONFIRM)
    await waitFor(() => expect(vi.mocked(deleteTaxYear)).toHaveBeenCalledWith(2024))
    const summaries = vi.mocked(fetchTaxSummary).mock.calls.length
    const lists = vi.mocked(fetchTaxYears).mock.calls.length

    // The PUT answers MID-delete. The page stopped belonging to 2024 at click time, so this
    // echo is already stale: nothing may be spent on a year that is on its way out.
    await act(async () => {
      save.resolve(inputsFor(2024))
    })
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(summaries)
    expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(lists)
    expect(screen.queryByRole('alert')).toBeNull()

    // The delete lands last: the chip goes, the page ends on the prompt, and the echo never
    // bought a totals refresh on the way there.
    await act(async () => {
      del.resolve(undefined)
    })
    expect(await screen.findByText(/select a tax year/i)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: '2024' })).toBeNull())
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(summaries)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a delete failure verbatim and keeps the year on screen', async () => {
    vi.mocked(deleteTaxYear).mockRejectedValue(new ApiError('tax year 2024 not found', 404))
    renderPage()
    await screen.findByLabelText('Annual Salary')

    fireEvent.click(deleteYearButton())
    expect(await screen.findByText('tax year 2024 not found')).toBeTruthy()
    // Nothing was dropped: the list was never reloaded and the year is still the page's.
    expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '2024' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '2023' })).toBeTruthy()
    expect(salary().value).toBe('$200,000.00')
    // The door is open again for a second try.
    await waitFor(() => expect(deleteYearButton().disabled).toBe(false))
  })

  it('hands the what-if card the ticker a holdings deep link named', async () => {
    renderPage('/taxes?whatif=VTI')
    const panel = await screen.findByTestId('whatif-panel')

    // Verbatim off the URL — the panel matches it against its own holdings feed, and a
    // ticker that matches nothing is its problem, not the page's.
    expect(panel.getAttribute('data-ticker')).toBe('VTI')
    expect(panel.getAttribute('data-lot')).toBe('')
    expect(panel.getAttribute('data-year')).toBe('2024')
    // Deliberately NOT cleared: this page owns no history writes, and a reload re-seeding
    // the same leg is the honest reading of the URL the user is sitting on.
    expect(screen.getByTestId('location').textContent).toBe('/taxes?whatif=VTI')
  })

  it('reads ?whatif-lot as a lot id, and lets a garbled one seed nothing', async () => {
    renderPage('/taxes?whatif-lot=3')
    const panel = await screen.findByTestId('whatif-panel')
    expect(panel.getAttribute('data-lot')).toBe('3')
    expect(panel.getAttribute('data-ticker')).toBe('')
    cleanup()

    // A hand-edited URL is nobody's lot: null seeds nothing and the card mounts closed, the
    // way it does for every visitor who arrived without a link.
    renderPage('/taxes?whatif-lot=not-a-lot')
    expect((await screen.findByTestId('whatif-panel')).getAttribute('data-lot')).toBe('')
  })

  it('keeps the seeds on the card across a year switch', async () => {
    renderPage('/taxes?whatif=VTI')
    await screen.findByLabelText('Annual Salary')

    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))

    // The panel is keyed by year, so this is a fresh mount — and the seed is a property of
    // the URL, not of the year, so it goes down again: the link said "model selling VTI",
    // and it means that against whichever year is on screen.
    //
    // waitFor, not a bare read off findByTestId: the card is on screen either way (it is the
    // PROPS that move), and the year only reaches it when the switch's three payloads land —
    // which the "was 2023 requested" wait above does not promise. Read straight, this raced
    // the Promise.all's own microtasks and read 2024 about one run in six.
    await waitFor(() =>
      expect(screen.getByTestId('whatif-panel').getAttribute('data-year')).toBe('2023'),
    )
    expect(screen.getByTestId('whatif-panel').getAttribute('data-ticker')).toBe('VTI')
  })

  // --- the withholding card (Task 9) ----------------------------------------------------
  // Clock-relative years throughout, never a pinned 2026: the card is the CURRENT year's or
  // nothing at all, and a hard-coded fixture year would rot on a New Year's Day.

  const yearRow = (year: number): TaxYearOut => ({
    year, notes: null, input_count: 21, bracket_count: 42,
  })

  it('mounts the will-I-owe card on the current year and loads it for that year', async () => {
    const thisYear = new Date().getFullYear()
    vi.mocked(fetchTaxYears).mockResolvedValue([yearRow(thisYear - 1), yearRow(thisYear)])
    renderPage()

    // The latest year wins on arrival, and it is this one.
    expect(await screen.findByText(`Will I owe? — ${thisYear}`)).toBeTruthy()
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledWith(thisYear))
    // The card's own figures, from its own feed — not the summary panel's.
    expect(await screen.findByText('$5,000.00')).toBeTruthy()
  })

  it('leaves the card off a past year rather than spending a request on the 422', async () => {
    vi.mocked(fetchTaxYears).mockResolvedValue([yearRow(new Date().getFullYear() - 1)])
    renderPage()
    await screen.findByLabelText('Annual Salary')

    // The endpoint refuses any year but the current one; the page asks the same question here
    // rather than drawing a card whose only possible content is that refusal.
    expect(screen.queryByText(/will i owe/i)).toBeNull()
    expect(vi.mocked(fetchWithholding)).not.toHaveBeenCalled()
  })

  it('takes the card away when the user switches off the current year', async () => {
    const thisYear = new Date().getFullYear()
    vi.mocked(fetchTaxYears).mockResolvedValue([yearRow(thisYear - 1), yearRow(thisYear)])
    renderPage()
    await screen.findByText(`Will I owe? — ${thisYear}`)

    fireEvent.click(screen.getByRole('button', { name: String(thisYear - 1) }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(thisYear - 1))
    // Gone with the year it belonged to, and no second request was spent on the way out.
    await waitFor(() => expect(screen.queryByText(/will i owe/i)).toBeNull())
    expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(1)
  })
})
