import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type {
  TaxBracketsCloneOut,
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummariesOut,
  TaxSummaryOut,
  TaxYearOut,
  TaxYearUpdate,
  WithholdingOut,
} from '../types/api'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import TaxesPage from './TaxesPage'
import { expectInDocumentOrder } from '../testing/domOrder'

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
  patchTaxYear: vi.fn(),
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
      ariaLabel,
      onClick,
    }: {
      option: { xAxis?: { data?: unknown[] } }
      ariaLabel?: string
      onClick?: (params: { name?: string }) => void
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        // Every mount is a ChartCard now, and each one names what it draws (F11).
        'aria-label': ariaLabel,
        'data-categories': (option.xAxis?.data ?? []).join(','),
        // A click on the marker stands in for a click on the chart's FIRST category —
        // enough to walk the trend's drill-in door both ways without a canvas. Charts
        // given no handler (the waterfall) stay inert, like the real thing.
        onClick: () => onClick?.({ name: String((option.xAxis?.data ?? [])[0] ?? '') }),
      }),
  }
})
// The what-if card owns three feeds and a whole test file of its own (WhatIfPanel.test.tsx
// pins the URL grammar and its own year-keyed remount). Here it is a marker reporting the
// props the page hands it — which IS this page's whole contract with it — plus a door onto
// the Apply callback, and it keeps a card the page never opens from spending requests.
vi.mock('../components/taxes/WhatIfPanel', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      year,
      definitions,
      onApplyOverrides,
    }: {
      year: number
      definitions?: { key: string; label: string }[]
      onApplyOverrides?: (
        overrides: Record<string, string | null>,
        changed: { key: string; label: string; before: string; after: string }[],
      ) => void
    }) =>
      createElement(
        'div',
        {
          'data-testid': 'whatif-panel',
          'data-year': String(year),
          'data-defs': (definitions ?? []).map((d) => d.key).join(','),
        },
        createElement(
          'button',
          {
            type: 'button',
            onClick: () =>
              onApplyOverrides?.({ annual_salary: '210000' }, [
                {
                  key: 'annual_salary',
                  label: 'Annual Salary',
                  before: '188930.00',
                  after: '210000.00',
                },
              ]),
          },
          'Apply 1 override to 2024',
        ),
      ),
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
  patchTaxYear,
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

const year2023: TaxYearOut = {
  year: 2023, notes: null, input_count: 21, bracket_count: 42, filing_status: 'single',
}
const year2024: TaxYearOut = {
  year: 2024, notes: null, input_count: 21, bracket_count: 42, filing_status: 'single',
}
const year2025: TaxYearOut = {
  year: 2025, notes: null, input_count: 0, bracket_count: 42, filing_status: 'single',
}

function inputsFor(year: number): TaxInputsOut {
  return {
    year,
    // A single-status year: ONE person column, so the payload is shaped exactly as it was
    // before filing statuses existed (the server folds the primary's rows into it).
    filing_status: 'single',
    people: [{ id: 1, name: 'Alex' }],
    sections: [
      {
        section: 'ordinary_income',
        items: [
          {
            key: 'annual_salary', label: 'Annual Salary', sort_order: 10,
            is_derived: false, value: '200000.0000', suggested: null,
            is_per_person: true, person_id: 1,
          },
        ],
      },
    ],
  }
}

function bracketsFor(year: number): TaxBracketsOut {
  return {
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
  }
}

// The same year as the API answers it once it is filed jointly: the per-person key comes back
// once per person COLUMN, each stamped with its own person_id and value. The roster rides on
// the payload, so the page never asks for it separately.
function marriedInputsFor(year: number): TaxInputsOut {
  const single = inputsFor(year)
  const salary = single.sections[0].items[0]
  return {
    ...single,
    filing_status: 'married_joint',
    people: [
      { id: 1, name: 'Alex' },
      { id: 4, name: 'Sam' },
    ],
    sections: [
      {
        section: 'ordinary_income',
        items: [
          { ...salary, person_id: 1 },
          { ...salary, person_id: 4, value: '90000.0000' },
        ],
      },
    ],
  }
}

// A married year on a database with fewer than two people: ONE null column, which is the
// pre-household payload exactly.
function marriedNoRosterFor(year: number): TaxInputsOut {
  const single = inputsFor(year)
  return {
    ...single,
    filing_status: 'married_joint',
    people: [],
    sections: single.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({ ...item, person_id: null })),
    })),
  }
}

// The clone answers with review flags too — the brackets editor reads them. This page only
// needs the year's tables back, so the flags are empty here; BracketsEditor.test.tsx is
// where they carry meaning.
function cloneFor(year: number): TaxBracketsCloneOut {
  return { ...bracketsFor(year), review_flags: { verbatim_ok: [], review: [] } }
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

// The engine's REFUSAL payload, exactly as the router sends it: the year, its status, the
// tables it is waiting for, and NO numbers at all — every section is null on the wire
// (backend _missing_summary_out). TaxSummaryOut types the sections non-nullable so the
// pinned golden fixtures in taxChartOptions.test.ts / overviewChartOptions.test.ts keep
// compiling, so this fixture states the real shape through ONE deliberate cast — which is
// what makes the panel's guard below a real test rather than a fixture-shaped one.
function missingSummaryFor(year: number, missing: string[]): TaxSummaryOut {
  return {
    year,
    brackets_missing_for_status: missing,
    warnings: [
      `${year} is filed as married_joint and has no married_joint bracket table for: ` +
        missing.join(', '),
    ],
  } as unknown as TaxSummaryOut
}

// The withholding card's feed — the panel has a file of its own (WithholdingPanel.test.tsx),
// so this is the minimum that renders, with figures deliberately unlike every other fixture's
// so a tile of it can never be mistaken for one of the summary panel's.
function withholdingFor(year: number): WithholdingOut {
  const leg = { ytd: '2000.00', projected: '4000.00' }
  return {
    year,
    filing_status: 'single',
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
    // A single filer: no partner leg, no surtax gap, no missing tables — the silences the
    // panel's own file exercises in full.
    partner_wages: null,
    partner_withheld_fed: null,
    partner_withheld_state: null,
    partner_source: 'entered',
    partner_salary: null,
    additional_medicare_gap: '0.00',
    brackets_missing_for_status: [],
    safe_harbor: null,
    warnings: [],
  }
}

// The engine's own sparse-year sentence: ENGINE_INPUT_KEYS in definition order, all 22 of
// them, in ONE line (backend/app/services/tax_service.py MISSING_INPUTS_WARNING). It is
// rendered verbatim — the list IS the message.
const MISSING_22 =
  'missing inputs defaulted to 0: latest_w2_income, other_w2_income, stcg_total, ' +
  'stcg_standard, unqualified_dividends, unq_div_us_treasuries_etf, ' +
  'unq_div_state_exempt_pct, interest_total, other_income_1099, trad_401k_contributions, ' +
  'hsa_contributions, hsa_contributions_employer, capital_loss_deductions, ' +
  'other_pretax_deductions, standard_deduction, itemized_deduction, ' +
  'state_standard_deduction, state_exemption_credits, ltcg_total, ltcg_brokerage, ' +
  'qualified_dividends, other_capital_gains'

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
// The trend chart is found through its own card, never by chart index: the marginal
// ladder mounts a marker too, and the 2026-08-31 reorder moved the card — position is
// not identity. The heading swaps to "Tax breakdown — YYYY" while a year is drilled, so
// the matcher accepts both faces of the same card.
const trendCard = () =>
  screen
    .getByText(/Tax composition by year|Tax breakdown — /)
    .closest('.card') as HTMLElement
const trendChart = () => within(trendCard()).getByTestId('echart')
const trendCategories = () => trendChart().getAttribute('data-categories')

// The per-jurisdiction table's OWN scope. Several cards on this page render a node that
// reads exactly like one of its row labels — InputsForm heads a section "Capital gains"
// (SECTION_LABELS), and BracketsEditor heads its tables "Federal brackets" — so a bare
// screen.getByText('Capital gains').closest('tr') is one fixture field away from resolving
// against somebody else's heading and asserting on the wrong row (or on none). Scoping to
// the table makes the pins say what they mean.
const jurisdictionTable = () =>
  within(screen.getByText('By jurisdiction').closest('.tax-jurisdiction-detail') as HTMLElement)

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
  clearSnapshots()
  vi.mocked(fetchTaxYears).mockResolvedValue([year2023, year2024])
  vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(fetchTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(fetchTaxSummary).mockImplementation(async (year: number) => summaryFor(year))
  // The panel's own feed. Empty by default so no test's pins can collide with a trend
  // year's numbers; the tests that are ABOUT the trend fill it in.
  vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [] })
  vi.mocked(fetchWithholding).mockImplementation(async (year: number) => withholdingFor(year))
  vi.mocked(cloneBrackets).mockImplementation(async (year: number) => cloneFor(year))
  vi.mocked(putTaxInputs).mockImplementation(async (year: number) => inputsFor(year))
  vi.mocked(putTaxBrackets).mockImplementation(async (year: number) => bracketsFor(year))
  vi.mocked(deleteTaxYear).mockResolvedValue(undefined)
  // The echo is authoritative: the selector reads the SERVER's status, never the button
  // that was pressed.
  vi.mocked(patchTaxYear).mockImplementation(async (year: number, body: TaxYearUpdate) => ({
    year, notes: null, input_count: 21, bracket_count: 42, filing_status: body.filing_status,
  }))
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaxesPage — frame', () => {
  it('renders its title row through PageFrame, not a hand-rolled page header', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')

    expect(screen.getByRole('heading', { level: 1, name: 'Taxes' })).toBeTruthy()
    // The shell owns the title row now — the page's own header markup is gone.
    expect(document.querySelector('.page-header')).toBeNull()
    expect(document.querySelector('.page-frame-header')).toBeTruthy()
  })

  it('paints the frame ghost — two cards, NO tile row — while the year LIST is in flight', () => {
    // Never answers: the first list load is the page's own lifecycle, and it is the only
    // thing this page ever paints a full-page ghost for.
    vi.mocked(fetchTaxYears).mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByText('Loading…')).toBeTruthy()
    // tiles: 0 — this page has no KPI row to ghost, so it must not draw one.
    expect(document.querySelector('.page-skeleton .kpi-row')).toBeNull()
    expect(document.querySelectorAll('.page-skeleton .card')).toHaveLength(2)
    // ...and the body is not up yet: a year list nobody has seen has no chips and no form.
    expect(screen.queryByLabelText('New year')).toBeNull()
  })

  it('dims the year being loaded without taking the chips that switch it out of reach', async () => {
    const pending = deferred<TaxInputsOut>()
    vi.mocked(fetchTaxInputs)
      .mockResolvedValueOnce(inputsFor(2024))
      .mockReturnValueOnce(pending.promise)
    renderPage()
    await screen.findByLabelText('Annual Salary')

    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(2))

    // The editors fade — and .taxes-page's own pointer-events rule rides that class, so
    // they stop taking keystrokes the arriving payload is about to replace...
    expect(screen.getByLabelText('Annual Salary').closest('.loading-dim.is-loading')).toBeTruthy()
    // ...while the chips that switch years, and the new-year box, stay live. A page-wide
    // dim would put both behind pointer-events: none for the length of every load.
    expect(
      screen.getByRole('button', { name: '2024' }).closest('.loading-dim.is-loading'),
    ).toBeNull()
    expect(screen.getByLabelText('New year').closest('.loading-dim.is-loading')).toBeNull()
  })
})

describe('TaxesPage', () => {
  it('renders a chip per tax year and loads the latest', async () => {
    renderPage()
    await screen.findByRole('button', { name: '2024' })
    expect(screen.getByRole('button', { name: '2023' })).toBeTruthy()
    // Latest year wins on arrival — the sheet's rightmost column.
    expect((screen.getByRole('button', { name: '2024' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024))
    // The status is ALWAYS named: the brackets GET defaults to 'single' server-side rather
    // than to the year's own status, so an omitted argument would be a silent wrong answer.
    expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2024, 'single')
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
    expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2023, 'single')
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
    // Years ARE on screen (the optimistic chip), so this is the frame's stale line.
    expect(await screen.findByText(/years unavailable/)).toBeTruthy()
    // And the year exists, so the page is on it: optimistically, with placeholder counts.
    const chip = await screen.findByRole('button', { name: '2025' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip.getAttribute('title')).toBe('0 inputs · 0 brackets')
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2025))
    // 2025's payloads arriving must NOT clear the banner underneath them — the two
    // requests are in flight together, and only one of them failed.
    expect(await screen.findByText('$123,456.78')).toBeTruthy()
    expect(screen.getByText(/years unavailable/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.queryByText(/years unavailable/)).toBeNull())
    // Reconciled: the server's counts replace the placeholder.
    expect(screen.getByRole('button', { name: '2025' }).getAttribute('title')).toBe(
      '0 inputs · 42 brackets',
    )
  })

  it('shows ONLY the banner when the first year-list load fails', async () => {
    vi.mocked(fetchTaxYears).mockRejectedValueOnce(new ApiError('years unavailable', 503))
    renderPage()

    // No years, so the failure is the FRAME's: an assertive banner and nothing behind it.
    expect(await screen.findByText('years unavailable')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('years unavailable')
    expect(screen.queryByLabelText('New year')).toBeNull()
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
    await waitFor(() => expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2023, 'single'))
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
      .mockResolvedValueOnce([
        { year: thisYear, notes: null, input_count: 0, bracket_count: 0, filing_status: 'single' },
      ])
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
        filing_status: 'single',
        jurisdictions: { federal: [{ rate: '0.12', threshold: '0' }] },
      }),
    )
  })

  it('lands on the form primary from the last cell, and saves on Ctrl+Enter', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '210000' } })

    // The scope preventDefaults Enter, so it never implicit-submits; on the LAST cell it
    // hands focus to the form's primary instead. This page fixture holds ONE line item, so
    // that cell is both first and last — the multi-cell walk across sections is pinned in
    // InputsForm.test.tsx, against a fixture with four items in three sections.
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
    // Both mount through ChartCard: the house sentence (F11) and the export row (F12).
    expect(screen.getByLabelText(/Waterfall chart walking gross income/)).toBeTruthy()
    expect(screen.getByLabelText(/Stacked bar chart of tax by jurisdiction per year/)).toBeTruthy()
    expect(screen.getByRole('group', { name: /Export tax-trend/ })).toBeTruthy()
  })

  it('renders the per-jurisdiction detail table straight from the summary payload', async () => {
    const detailed = summaryFor(2024)
    detailed.federal = {
      agi: '250000.00', taxable_income: '181305.00', tax: '40782.88', effective_rate: '0.163132',
    }
    detailed.medicare = {
      w2_income: '260000.00', taxable_wages: '250000.00', tax: '4325.00', effective_rate: '0.017300',
    }
    detailed.capital_gains = {
      taxable_income: '181305.00', gains_amount: '20000.00', tax: '3000.00', effective_rate: '0.150000',
    }
    detailed.niit = {
      taxable_income: '10000.00', gains_amount: '25000.00', tax: '380.00', effective_rate: '0.015200',
    }
    vi.mocked(fetchTaxSummary).mockResolvedValue(detailed)
    renderPage()

    await screen.findByText('By jurisdiction')
    // Every cell is the payload's own figure formatted — Base, Taxable, Tax, Eff. rate.
    const federal = jurisdictionTable().getByText('Federal').closest('tr')!
    expect(federal.textContent).toContain('$250,000.00')
    expect(federal.textContent).toContain('$181,305.00')
    expect(federal.textContent).toContain('$40,782.88')
    expect(federal.textContent).toContain('16.3%')
    // NIIT: Base is net investment income, Taxable the surcharged base.
    const niit = jurisdictionTable().getByText('NIIT').closest('tr')!
    expect(niit.textContent).toContain('$25,000.00')
    expect(niit.textContent).toContain('$10,000.00')
    expect(niit.textContent).toContain('$380.00')
    expect(niit.textContent).toContain('1.5%')
    // Capital gains: Base is the gains, Taxable the ordinary income they stack on.
    const cg = jurisdictionTable().getByText('Capital gains').closest('tr')!
    expect(cg.textContent).toContain('$20,000.00')
    expect(cg.textContent).toContain('$181,305.00')
  })

  it('renders the NIIT row as em-dashes against a pre-C payload', async () => {
    // A payload with NO niit key at all — what a stored summary from before workstream C
    // looks like. Built explicitly (delete, not "trust the fixture") so this pin survives
    // whatever Plan C did to the shared summaryFor. Absence is em-dash, never $0.00.
    const preC = { ...summaryFor(2024) }
    delete preC.niit
    vi.mocked(fetchTaxSummary).mockResolvedValue(preC)
    renderPage()
    await screen.findByText('By jurisdiction')
    const niit = jurisdictionTable().getByText('NIIT').closest('tr')!
    expect(niit.textContent?.match(/—/g)).toHaveLength(4)
    expect(niit.textContent).not.toContain('$0.00')
  })

  it('mounts the marginal card from the year’s own summary and tables', async () => {
    renderPage()
    // bracketsFor carries one federal bracket (10% at $0) and no state table, and the
    // fixture year's taxable income is 0: the sentence prices the bottom bracket while the
    // ladder itself is undrawable. The default beforeEach leaves the trend feed EMPTY, so
    // the page's only chart is the waterfall — the count must stay 1, proving the card
    // added no chart here.
    expect(await screen.findByText('Marginal rates — 2024')).toBeTruthy()
    expect(
      screen.getByText('Your next $1,000 of ordinary income costs $100.00 federal.'),
    ).toBeTruthy()
    await waitFor(() => expect(screen.getAllByTestId('echart')).toHaveLength(1))
  })

  it('renders every engine warning verbatim, including the 22-key sparse-year line', async () => {
    const sparse = summaryFor(2024)
    sparse.warnings = [MISSING_22, 'no state brackets for 2024: state tax computed as 0']
    vi.mocked(fetchTaxSummary).mockResolvedValue(sparse)
    renderPage()

    // One text node, wrapped by CSS — not truncated, not summarised, not re-worded.
    expect(await screen.findByText(MISSING_22)).toBeTruthy()
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
    // The switch itself must LAND (not just be called) before the save below: this races
    // parallel-load scheduling under the full suite, so the assertion must retry — saving
    // against the still-mounted 2024 editor would echo year 2024, which onInputsSaved
    // drops as stale, and the trend refetch this test is about would never fire.
    await waitFor(() => expect(deleteYearButton().disabled).toBe(false))

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
    fireEvent.click(trendChart())
    expect(await screen.findByText('Tax breakdown — 2023')).toBeTruthy()
    // Same mount, now a pie — no x axis — and the way back is written beside it, with
    // the SERVER's totals for the year (the pie itself only draws positive slices).
    expect(trendCategories()).toBe('')
    expect(screen.getByLabelText(/Donut chart of 2023’s tax by jurisdiction/)).toBeTruthy()
    expect(screen.getByText(/click the chart to go back/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All years' })).toBeTruthy()

    // Any click in detail mode returns to all years.
    fireEvent.click(trendChart())
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

    fireEvent.click(trendChart())
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

  it('leaves the whatif family in the URL for the card to read, and re-keys it on a year switch', async () => {
    renderPage('/taxes?whatif=sale%3A7%3A40')
    await screen.findByLabelText('Annual Salary')
    // Deliberately NOT read or cleared here: the entries are the PANEL's state now
    // (WhatIfPanel.test.tsx owns that grammar), and this page only re-keys the card by year.
    expect(screen.getByTestId('location').textContent).toBe('/taxes?whatif=sale%3A7%3A40')

    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))

    // waitFor, not a bare read off findByTestId: the card is on screen either way (it is the
    // PROPS that move), and the year only reaches it when the switch's three payloads land —
    // which the "was 2023 requested" wait above does not promise. Read straight, this raced
    // the Promise.all's own microtasks and read 2024 about one run in six.
    await waitFor(() =>
      expect(screen.getByTestId('whatif-panel').getAttribute('data-year')).toBe('2023'),
    )
    // The scenario belongs to the URL, not to the year: it survives the switch to be re-run
    // against whichever year is now on screen.
    expect(screen.getByTestId('location').textContent).toContain('whatif=sale%3A7%3A40')
  })

  it('Apply from the what-if confirms before → after, PUTs the overrides once and remounts the inputs form', async () => {
    // The PUT echo carries the moved salary — the remount is what puts it on screen,
    // because InputsForm ignores prop replacement by design.
    const echo = inputsFor(2024)
    echo.sections[0].items[0].value = '210000.0000'
    vi.mocked(putTaxInputs).mockResolvedValue(echo)
    renderPage()
    await screen.findByTestId('whatif-panel')
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 override to 2024' }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    // The server's own before → after, and only for the key actually being WRITTEN.
    expect(confirmSpy.mock.calls[0][0]).toBe(
      "This writes 1 input to 2024's stored return and reloads the form below. Continue?\nAnnual Salary: $188,930.00 → $210,000.00",
    )
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
      values: { annual_salary: '210000' },
    })
    // The same landing chain the withholding card's Apply uses: remounted form, fresh totals.
    await waitFor(() => expect(salary().value).toBe('$210,000.00'))
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))
  })

  it('names the unsaved edits Apply is about to discard', async () => {
    renderPage()
    await screen.findByTestId('whatif-panel')
    fireEvent.change(salary(), { target: { value: '$999,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 override to 2024' }))
    // ONE question, not two: the write and the discard are the same decision.
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toContain(
      "reloads the form below, discarding its unsaved edits. Continue?",
    )
    // The epoch remount threw the typed value away with the form that held it.
    await waitFor(() => expect(salary().value).toBe('$200,000.00'))
  })

  it('a declined confirm writes nothing', async () => {
    confirmSpy.mockReturnValue(false)
    renderPage()
    await screen.findByTestId('whatif-panel')
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 override to 2024' }))
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()
  })

  it('hands the year’s input definitions to the what-if card, deduped by key', async () => {
    // A married payload repeats annual_salary once per person column; the override list
    // must carry the KEY once — overrides are household-level.
    vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => marriedInputsFor(year))
    renderPage()
    const panel = await screen.findByTestId('whatif-panel')
    await waitFor(() => expect(panel.getAttribute('data-defs')).toBe('annual_salary'))
  })

  // --- the withholding card (Task 9) ----------------------------------------------------
  // Clock-relative years throughout, never a pinned 2026: the card is the CURRENT year's or
  // nothing at all, and a hard-coded fixture year would rot on a New Year's Day.

  const yearRow = (year: number): TaxYearOut => ({
    year, notes: null, input_count: 21, bracket_count: 42, filing_status: 'single',
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

  it('vest Apply writes through the page: PUT, remounted form, fresh totals', async () => {
    const thisYear = new Date().getFullYear()
    vi.mocked(fetchTaxYears).mockResolvedValue([yearRow(thisYear)])
    vi.mocked(fetchWithholding).mockImplementation(async (year: number) => ({
      ...withholdingFor(year),
      vest: {
        ...withholdingFor(year).vest,
        income_ytd: '31500.00',
        income_projected: '48000.00',
      },
    }))
    // The PUT echo carries a moved salary too — the remount is what puts it on screen,
    // because InputsForm ignores prop replacement by design.
    const echo = inputsFor(thisYear)
    echo.sections[0].items[0].value = '333000.0000'
    vi.mocked(putTaxInputs).mockResolvedValue(echo)
    renderPage()
    await screen.findByText(`Will I owe? — ${thisYear}`)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Apply vest income to W-2 inputs' }),
    )
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(thisYear, {
        values: { w2_stock_rsus_sold: '48000.00' },
      }),
    )
    // Remounted from the echo (a blurred AmountInput reads its formatted echo).
    await waitFor(() => expect(salary().value).toBe('$333,000.00'))
    // The page's save chain ran: totals refetched, and this card reloaded its own feed.
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(2))
  })
})

// The composition card's drill is ?comp=, NOT ?year= — that one is the page's own selected
// tax year (below). Two different questions: this card's resting state is "no drill at all",
// which a selected year cannot say.
describe('?comp= composition drill (2026-08-25 spec §2d)', () => {
  it('opens the year pie straight from the URL', async () => {
    const taxed2023 = summaryFor(2023)
    taxed2023.federal = { ...taxed2023.federal, tax: '1000.00' }
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [taxed2023, summaryFor(2024)] })
    renderPage('/taxes?comp=2023')
    expect(await screen.findByText('Tax breakdown — 2023')).toBeTruthy()
  })

  it('drills independently of the year the PAGE is on', async () => {
    const taxed2023 = summaryFor(2023)
    taxed2023.federal = { ...taxed2023.federal, tax: '1000.00' }
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [taxed2023, summaryFor(2024)] })
    renderPage('/taxes?comp=2023')
    // The pie is 2023's while the page — and the what-if card it hands the year to — is
    // still on the latest year. One param each, so neither can drag the other.
    expect(await screen.findByText('Tax breakdown — 2023')).toBeTruthy()
    expect(screen.getByTestId('whatif-panel').getAttribute('data-year')).toBe('2024')
  })

  it('ignores a garbled or unknown year — the trend renders as usual', async () => {
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({
      years: [summaryFor(2023), summaryFor(2024)],
    })
    renderPage('/taxes?comp=banana')
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    expect(screen.queryByText(/Tax breakdown —/)).toBeNull()
    cleanup()
    renderPage('/taxes?comp=1999')
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    expect(screen.queryByText(/Tax breakdown —/)).toBeNull()
  })

  it('mirrors a trend-click drill into the URL, preserving sibling params, and clears it', async () => {
    const taxed2023 = summaryFor(2023)
    taxed2023.federal = { ...taxed2023.federal, tax: '1000.00' }
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [taxed2023, summaryFor(2024)] })
    renderPage('/taxes?whatif=sale%3A7%3A40')
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    fireEvent.click(trendChart()) // the trend; the mock clicks 2023
    await screen.findByText('Tax breakdown — 2023')
    expect(screen.getByTestId('location').textContent).toBe(
      '/taxes?whatif=sale%3A7%3A40&comp=2023',
    )
    fireEvent.click(trendChart()) // any click in detail mode returns
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    expect(screen.getByTestId('location').textContent).toBe('/taxes?whatif=sale%3A7%3A40')
  })
})

describe('filing status (2026-08-26 design §6)', () => {
  // Scoped to the YEAR card's control: the brackets editor below renders a tab row with the
  // same three names, and only this one changes how the year is filed.
  const statusButton = (name: string) =>
    within(screen.getByRole('group', { name: 'Filing status' })).getByRole('button', {
      name,
    }) as HTMLButtonElement

  const CA_CAVEAT =
    'California is a community-property state; true MFS requires 50/50 community-income ' +
    'splitting (Form 8958), which this calculator does not model.'

  it('renders the selected year status as a segmented control', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')

    expect(statusButton('Single').getAttribute('aria-pressed')).toBe('true')
    expect(statusButton('Married filing jointly').getAttribute('aria-pressed')).toBe('false')
    expect(statusButton('Married filing separately').getAttribute('aria-pressed')).toBe('false')
    // The caveat belongs to MFS alone — a single year must not carry a warning about a
    // filing status it is not filed under.
    expect(screen.queryByText(CA_CAVEAT)).toBeNull()
  })

  it('keeps the control off a page with no year selected', async () => {
    vi.mocked(fetchTaxYears).mockResolvedValue([])
    renderPage()
    await screen.findByText(/no tax years yet/i)
    expect(screen.queryByRole('button', { name: 'Single' })).toBeNull()
  })

  it('PATCHes the new status and reloads the year under it', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1))

    fireEvent.click(statusButton('Married filing jointly'))

    await waitFor(() =>
      expect(vi.mocked(patchTaxYear)).toHaveBeenCalledWith(2024, {
        filing_status: 'married_joint',
      }),
    )
    // All THREE payloads move with the status — brackets are stored per (jurisdiction,
    // status), the inputs grow a person column, the summary is computed against the
    // status-selected tables — and the year is the one already on screen, so this only
    // happens because `selection` is replaced by a FRESH object.
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenLastCalledWith(2024)
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2)
    // ...and the brackets GET names the NEW status, or it would read single's tables under
    // a married year.
    expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchTaxBrackets)).toHaveBeenLastCalledWith(2024, 'married_joint')
    // The echo replaced the row, so the control follows without a list reload.
    await waitFor(() =>
      expect(statusButton('Married filing jointly').getAttribute('aria-pressed')).toBe('true'),
    )
  })

  it('a status flip refetches the all-years trend — the composition follows the new status', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')
    await waitFor(() => expect(vi.mocked(fetchAllTaxSummaries)).toHaveBeenCalledTimes(1))

    fireEvent.click(statusButton('Married filing jointly'))

    // The flip moves the engine's answer for the year (possibly to a refusal), which moves
    // that year's column in the all-years trend too — CompositionPanel must refetch
    // (2026-08-31 review round; the bug predated the split).
    await waitFor(() => expect(vi.mocked(fetchAllTaxSummaries)).toHaveBeenCalledTimes(2))
  })

  it('neither asks nor sends when the pressed status is already the year’s', async () => {
    renderPage()
    await screen.findByLabelText('Annual Salary')

    fireEvent.click(statusButton('Single'))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(vi.mocked(patchTaxYear)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1)
  })

  it('asks before a status change that would discard typed work', async () => {
    confirmSpy.mockReturnValue(false)
    renderPage()
    await screen.findByLabelText('Annual Salary')
    fireEvent.change(salary(), { target: { value: '999' } })

    fireEvent.click(statusButton('Married filing jointly'))
    // The same question the other four reload doors ask — a status flip replaces both
    // editors' payloads, so unsaved work is gone the moment it starts.
    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes for 2024?')
    expect(vi.mocked(patchTaxYear)).not.toHaveBeenCalled()
    expect(salary().value).toBe('$999.00')
  })

  it('surfaces a status failure verbatim and leaves the year alone', async () => {
    vi.mocked(patchTaxYear).mockRejectedValue(
      new ApiError('filing_status must be one of single, married_joint, married_separate', 422),
    )
    renderPage()
    await screen.findByLabelText('Annual Salary')

    fireEvent.click(statusButton('Married filing separately'))
    expect(
      await screen.findByText(
        'filing_status must be one of single, married_joint, married_separate',
      ),
    ).toBeTruthy()
    // Nothing was reloaded, and the control still reads the row the server has.
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1)
    expect(statusButton('Single').getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps a status refusal an ALERT beside the year, not the frame stale line', async () => {
    vi.mocked(patchTaxYear).mockRejectedValue(new ApiError('filing_status is not settable', 422))
    renderPage()
    await screen.findByLabelText('Annual Salary')

    fireEvent.click(statusButton('Married filing jointly'))

    // The PATCH changed nothing, so "Showing earlier data" — the year LIST's grammar —
    // would be a lie about it. The year's own bucket keeps the assertive banner.
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('filing_status is not settable')
    expect(screen.queryByText(/showing earlier data/i)).toBeNull()
    // ...and the year it is about is still on screen behind it.
    expect(salary().value).toBe('$200,000.00')
  })

  it('stands the California community-property caveat under MFS only', async () => {
    vi.mocked(fetchTaxYears).mockResolvedValue([
      { ...year2024, filing_status: 'married_separate' },
    ])
    renderPage()
    await screen.findByLabelText('Annual Salary')

    // Verbatim, and not dismissible: an MFS calculation without Form-8958 community-income
    // splitting is wrong in California, so the sentence stays wherever the number is.
    expect(screen.getByText(CA_CAVEAT)).toBeTruthy()

    fireEvent.click(statusButton('Married filing jointly'))
    await waitFor(() => expect(screen.queryByText(CA_CAVEAT)).toBeNull())
  })

  it('splits the per-person inputs into named columns on a married year', async () => {
    vi.mocked(fetchTaxYears).mockResolvedValue([{ ...year2024, filing_status: 'married_joint' }])
    vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => marriedInputsFor(year))
    renderPage()

    expect(await screen.findByLabelText('Annual Salary — Alex')).toBeTruthy()
    expect(screen.getByLabelText('Annual Salary — Sam')).toBeTruthy()
    // One request, not two: the person columns ride on the inputs payload, so the page never
    // spends a second round trip on a roster the server has already narrowed for it.
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledTimes(1)
  })

  it('keeps one column when the year payload carries fewer than two people', async () => {
    vi.mocked(fetchTaxYears).mockResolvedValue([{ ...year2024, filing_status: 'married_joint' }])
    vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => marriedNoRosterFor(year))
    renderPage()

    // The honest degrade is today's layout — whose unqualified per-person writes the server
    // still resolves onto the primary person — and it is not an error.
    expect(await screen.findByLabelText('Annual Salary')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-seeds the inputs form when a status flip brings a second column', async () => {
    vi.mocked(fetchTaxInputs)
      .mockResolvedValueOnce(inputsFor(2024))
      .mockResolvedValueOnce(marriedInputsFor(2024))
    renderPage()
    await screen.findByLabelText('Annual Salary')

    fireEvent.click(statusButton('Married filing jointly'))

    // The editors are keyed by year AND status, so a flip REMOUNTS them: their value maps are
    // keyed by cell id, and a one-column year's ids are not a two-column year's — left
    // mounted, every new box would read blank.
    const partner = (await screen.findByLabelText('Annual Salary — Sam')) as HTMLInputElement
    expect(partner.value).toBe('$90,000.00')
  })

  it('leaves the year’s own tables in place when another status tab saves', async () => {
    // An MFJ tab opened from a year still filed single: the tab's own tables are empty.
    vi.mocked(fetchTaxBrackets).mockImplementation(async (year: number, status) => ({
      ...bracketsFor(year),
      filing_status: status,
      statuses_with_rows: ['single', 'married_joint'],
      jurisdictions:
        status === 'single'
          ? bracketsFor(year).jurisdictions
          : {
              federal: [], state: [], medicare: [],
              social_security: [], disability: [], capital_gains: [],
            },
    }))
    // The echo of a one-jurisdiction save still carries the whole year+status payload —
    // including a STATE table this editor never asked about.
    vi.mocked(putTaxBrackets).mockImplementation(async (year: number, body) => ({
      ...bracketsFor(year),
      filing_status: body.filing_status,
      statuses_with_rows: ['single', 'married_joint'],
      jurisdictions: {
        federal: [{ bracket_index: 1, rate: '0.1000', threshold: '0.00' }],
        state: [{ bracket_index: 1, rate: '0.0930', threshold: '0.00' }],
        medicare: [], social_security: [], disability: [], capital_gains: [],
      },
    }))
    renderPage()
    await screen.findByLabelText('Annual Salary')

    // Scoped: the YEAR card carries a control with the same three names.
    const tabs = within(screen.getByRole('group', { name: 'Bracket filing status' }))
    fireEvent.click(tabs.getByRole('button', { name: 'Married filing jointly' }))
    await waitFor(() =>
      expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2024, 'married_joint'),
    )
    await screen.findByText('No brackets for Federal.')

    fireEvent.click(screen.getByRole('button', { name: 'Save Federal brackets' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Federal bracket 1 rate (%)')).toBeTruthy(),
    )
    // A save re-syncs THAT table only. `detail.brackets` is the YEAR's tables, so an echo
    // from another status must not replace it — adopting it would remount this editor on the
    // page's key and throw away every other jurisdiction's half-edited rows with it.
    expect(screen.getByText('No brackets for State.')).toBeTruthy()
    expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2)
  })

  it('replaces the waterfall with a way out when the status has no tables', async () => {
    vi.mocked(fetchTaxYears).mockResolvedValue([{ ...year2024, filing_status: 'married_joint' }])
    vi.mocked(fetchTaxSummary).mockResolvedValue(
      missingSummaryFor(2024, ['federal', 'state', 'capital_gains']),
    )
    renderPage()

    expect(
      await screen.findByText('No Married filing jointly bracket tables for 2024'),
    ).toBeTruthy()
    // The jurisdictions are named with the SAME labels the editor heads its tables with.
    expect(screen.getByText('Federal, State, Capital gains')).toBeTruthy()
    // The waterfall is what goes — and the trend feed is empty in this fixture, so no chart
    // is left on the page at all.
    await waitFor(() => expect(screen.queryAllByTestId('echart')).toHaveLength(0))
    expect(screen.queryByText(/Marginal rates —/)).toBeNull()
    // The tiles stay, reading em-dashes: the engine sent no figures, and inventing zeros
    // would be exactly the confidently-wrong answer it refused to compute.
    expect(screen.getByText('Total tax')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('By jurisdiction')).toBeNull()
  })

  it('draws the waterfall as usual when the flag list came back empty', async () => {
    const complete = summaryFor(2024)
    complete.brackets_missing_for_status = []
    vi.mocked(fetchTaxSummary).mockResolvedValue(complete)
    renderPage()

    // An empty list is a COMPLETE year, not a missing one. (The heading's &apos; entity is
    // an apostrophe in the DOM, so the pin is written with a plain one.)
    expect(await screen.findByText("Where 2024's gross income went")).toBeTruthy()
    expect(screen.queryByText(/bracket tables for 2024/)).toBeNull()
  })

  it('drops a flagged year out of the trend and names it underneath', async () => {
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({
      years: [summaryFor(2024)],
      incomplete: [
        { year: 2026, filing_status: 'married_joint', brackets_missing_for_status: ['federal'] },
      ],
    })
    renderPage()

    // The feed keeps a refusal year OUT of `years` — it carries no sections at all, so a
    // column for it would be a lie the chart builder could not even draw — and names it in
    // `incomplete` instead. The chart shows what was computed; the note shows what was not.
    await waitFor(() => expect(trendCategories()).toBe('2024'))
    expect(screen.getByText(/Not charted: 2026/)).toBeTruthy()
  })

  it('says why the trend is empty when every year is flagged', async () => {
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({
      years: [],
      incomplete: [
        { year: 2024, filing_status: 'married_joint', brackets_missing_for_status: ['federal'] },
      ],
    })
    renderPage()

    // Distinct from "no years with stored inputs": there ARE years, they simply cannot be
    // compared yet.
    expect(
      await screen.findByText(/every year with stored inputs is missing bracket tables/i),
    ).toBeTruthy()
    expect(screen.queryByText(/no years with stored inputs/i)).toBeNull()
  })
})

describe('TaxesPage — snapshot cache (2026-08-27 spec §1)', () => {
  /** The detail payload for one year, shaped exactly as the page stores it. */
  function detailFor(year: number, totalTax: string) {
    const summary = summaryFor(year)
    summary.totals.total_tax = totalTax
    return { inputs: inputsFor(year), brackets: bracketsFor(year), summary }
  }

  /** The year list and the latest year's detail, keyed exactly as the page keys them. */
  function seedBoth(): void {
    setSnapshot('taxes:years', [year2023, year2024])
    setSnapshot('taxes:detail:2024:single', detailFor(2024, '77777.77'))
  }

  /** Holds all four year-scoped requests pending: what is on screen came from the seeds. */
  function pendAll(): void {
    const pending = () => new Promise<never>(() => {})
    vi.mocked(fetchTaxYears).mockImplementation(pending)
    vi.mocked(fetchTaxInputs).mockImplementation(pending)
    vi.mocked(fetchTaxBrackets).mockImplementation(pending)
    vi.mocked(fetchTaxSummary).mockImplementation(pending)
  }

  it('paints the year chips AND the detail panel before any fetch resolves', () => {
    seedBoth()
    pendAll()
    renderPage()
    // Both chips are up from the list seed...
    expect(screen.getByRole('button', { name: '2024' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '2023' })).toBeTruthy()
    // ...and the latest year's editors and totals from the detail seed.
    expect(salary().value).toBe('$200,000.00')
    expect(screen.getByText('$77,777.77')).toBeTruthy()
    // The new-year box is seeded off the cached latest year, not left blank.
    expect((screen.getByLabelText('New year') as HTMLInputElement).value).toBe('2025')
    // Both revalidations still went out.
    expect(vi.mocked(fetchTaxYears)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2024)
  })

  it('a changed revalidation summary updates the totals', async () => {
    seedBoth()
    const fresher = summaryFor(2024)
    fresher.totals.total_tax = '88888.88'
    vi.mocked(fetchTaxSummary).mockResolvedValue(fresher)
    renderPage()
    expect(screen.getByText('$77,777.77')).toBeTruthy()
    expect(await screen.findByText('$88,888.88')).toBeTruthy()
  })

  it('flips to a seeded second year and paints its detail before its fetch resolves', async () => {
    seedBoth()
    setSnapshot('taxes:detail:2023:single', detailFor(2023, '11111.11'))
    renderPage()
    await waitFor(() => expect(fetchTaxSummary).toHaveBeenCalledWith(2024))
    // The 2023 requests never answer, so only the seed can put its number on screen.
    pendAll()
    fireEvent.click(screen.getByRole('button', { name: '2023' }))
    expect(screen.getByText('$11,111.11')).toBeTruthy()
  })

  it('settles a byte-identical EMPTY year list instead of waiting forever', async () => {
    setSnapshot('taxes:years', [])
    vi.mocked(fetchTaxYears).mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(fetchTaxYears).toHaveBeenCalledTimes(1))
    await act(async () => {})
    // Nothing to select and nothing to load — the new-year form IS the page, and the
    // equality skip still has to release the detail flag (no year fetch will).
    expect(screen.getByText('No tax years yet — create one to start.')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })
})

describe('TaxesPage — section order (2026-08-31 audit)', () => {
  it('year-scoped answers read contiguously; the all-years trend closes the answers half', async () => {
    const thisYear = new Date().getFullYear()
    vi.mocked(fetchTaxYears).mockResolvedValue([
      { year: thisYear, notes: null, input_count: 21, bracket_count: 42, filing_status: 'single' },
    ])
    renderPage()
    const willIOwe = await screen.findByText(`Will I owe? — ${thisYear}`)
    const totals = screen.getByText(`Totals — ${thisYear}`)
    const marginal = screen.getByText(`Marginal rates — ${thisYear}`)
    const whatIf = screen.getByTestId('whatif-panel')
    const trend = screen.getByText('Tax composition by year')
    const inputs = screen.getByText(`Tax inputs — ${thisYear}`)
    const brackets = screen.getByText(`Bracket tables — ${thisYear}`)
    expectInDocumentOrder(totals, willIOwe, marginal, whatIf, trend, inputs, brackets)
  })
})
