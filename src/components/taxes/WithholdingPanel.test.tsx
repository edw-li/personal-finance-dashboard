import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { WithholdingOut } from '../../types/api'
import WithholdingPanel from './WithholdingPanel'

// Every case mounts inside a router: the nudge under the unsplit card links to the Paycheck
// page, and a <Link> outside a Router throws.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: MemoryRouter })

// The two calls this card makes: its own feed, and (D4) the inputs PUT the Apply chip fires.
// JURISDICTIONS and the other taxes helpers stay real — nothing here touches them, but the
// page-level module is shared (TaxesPage.test.tsx's mock).
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  fetchWithholding: vi.fn(),
  putTaxInputs: vi.fn(),
}))
import { fetchWithholding, putTaxInputs } from '../../api/taxes'

// A promise this file settles by hand — the only way to hold two loads in flight at once and
// choose which one answers first (TaxesPage.test.tsx's).
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * The wire payload of GET /taxes/years/{year}/withholding, and an internally CONSISTENT one:
 * salary 88,000.00 + vest supplemental 15,470.40 (48,000 x 0.3223) + vest FICA 1,116.18 is the
 * 104,586.58 projected total, and 123,456.78 of liability less that total is the 18,870.20
 * balance. The safe harbor is the LESSER of its two statutory legs — 110% of the prior
 * year's 110,000.00 is 121,000.00, 90% of this year's 123,456.78 is 111,111.10, so the
 * current-year leg binds — and the projection does not reach it, so `met` is false, exactly
 * as the server would compute it.
 */
function fixture(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
  return {
    year: 2026,
    filing_status: 'single',
    liability_total: '123456.78',
    salary: { ytd: '58666.67', projected: '88000.00' },
    vest: {
      income_ytd: '31500.00',
      income_projected: '48000.00',
      supplemental_ytd: '10152.45',
      supplemental_projected: '15470.40',
      fica_ytd: '456.75',
      fica_projected: '1116.18',
    },
    total: { ytd: '69275.87', projected: '104586.58' },
    balance_projected: '18870.20',
    checks_elapsed: 16,
    checks_total: 24,
    partner_wages: null,
    partner_withheld_fed: null,
    partner_withheld_state: null,
    partner_source: 'entered',
    partner_salary: null,
    additional_medicare_gap: '0.00',
    brackets_missing_for_status: [],
    // The ordinary state: nobody has typed the two paystub rates yet.
    jurisdictions: null,
    safe_harbor: {
      prior_year: 2025,
      prior_total_tax: '110000.00',
      prior_agi: '400000.00',
      multiplier: '1.10',
      threshold: '121000.00',
      prior_filing_status: 'single',
      current_year_threshold: '111111.10',
      effective_threshold: '111111.10',
      met: false,
    },
    warnings: [],
    ...overrides,
  }
}

/**
 * The same payload with the split available — the server's own figures from
 * test_withholding_api's `split_world`: a federal refund, a California shortfall, and a
 * payroll leg that is informational only (no remedy, no harbor).
 */
function withSplit(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
  return fixture({
    jurisdictions: {
      federal: {
        liability: '60000.00',
        withheld_ytd: '31570.00',
        withheld_projected: '63580.00',
        balance: '-3580.00',
        // The formula is max(balance, 0) over the checks left, so a refund reads 0.00 —
        // and the card must not turn that into an instruction.
        remedy_per_check: '0.00',
        safe_harbor: {
          prior_year: 2025,
          prior_total_tax: '40000.00',
          prior_agi: '400000.00',
          multiplier: '1.10',
          threshold: '44000.00',
          prior_filing_status: 'single',
          current_year_threshold: '54000.00',
          effective_threshold: '44000.00',
          met: true,
        },
      },
      state: {
        liability: '30000.00',
        withheld_ytd: '11286.00',
        withheld_projected: '22159.50',
        balance: '7840.50',
        remedy_per_check: '603.12',
        safe_harbor: {
          prior_year: null,
          prior_total_tax: null,
          prior_agi: null,
          multiplier: null,
          threshold: null,
          prior_filing_status: null,
          current_year_threshold: '27000.00',
          effective_threshold: '27000.00',
          met: false,
        },
      },
      payroll: {
        liability: '25753.20',
        withheld_ytd: '8489.00',
        withheld_projected: '11143.50',
        balance: '14609.70',
        remedy_per_check: null,
        safe_harbor: null,
      },
    },
    ...overrides,
  })
}

/** The married payload the partner cases share. */
function married(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
  return fixture({
    filing_status: 'married_joint',
    partner_wages: '150000.00',
    partner_withheld_fed: '18000.00',
    partner_withheld_state: '6000.00',
    additional_medicare_gap: '900.00',
    ...overrides,
  })
}

// A tile is found by its LABEL, then read for the two things the contract is about: the figure
// and the delta line's tone/glyph (WhatIfPanel.test.tsx's).
function tile(label: string): HTMLElement {
  const node = screen.getByText(label).closest('.stat-tile')
  if (node === null) throw new Error(`no stat tile labelled ${label}`)
  return node as HTMLElement
}

function deltaOf(label: string): HTMLElement {
  const node = tile(label).querySelector('.stat-delta')
  if (node === null) throw new Error(`no delta line on the ${label} tile`)
  return node as HTMLElement
}

// The panel's own Retry, named apart from the page's year-list one.
const retryButton = () =>
  screen.getByRole('button', { name: 'Retry loading the withholding estimate' })

beforeEach(() => {
  vi.mocked(fetchWithholding).mockResolvedValue(fixture())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WithholdingPanel', () => {
  it('loads the year on mount and renders the three tiles verbatim', async () => {
    render(<WithholdingPanel year={2026} />)
    // The heading is up from the first paint; the figures are what the request is for.
    expect(screen.getByText('Will I owe? — 2026')).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()

    expect(await screen.findByText('$123,456.78')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(vi.mocked(fetchWithholding)).toHaveBeenCalledWith(2026)
    expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(1)

    // Every figure is the server's, formatted and never re-derived (global rule 9).
    expect(tile('Projected tax').textContent).toContain('$123,456.78')
    expect(tile('Projected withholding').textContent).toContain('$104,586.58')
    expect(deltaOf('Projected withholding').textContent).toContain('$69,275.87 so far')
    // The withholding tile is a LEVEL with its progress under it: no glyph, no colour.
    expect(deltaOf('Projected withholding').className).toContain('stat-delta-neutral')
    expect(deltaOf('Projected withholding').textContent).not.toContain('▲')
  })

  it('nudges toward the paystub rates while the split is unavailable', async () => {
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        /Enter the federal and state rates from a paystub on your/,
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'paycheck profile' }).getAttribute('href')).toBe(
      '/paycheck',
    )
    // The combined card is exactly what it was.
    expect(tile('Projected balance').textContent).toContain('$18,870.20')
    expect(screen.queryByText('Federal balance')).toBeNull()
  })

  it('renders a balance tile per jurisdiction when the rates are entered', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(withSplit())
    render(<WithholdingPanel year={2026} />)

    // A federal refund and a California shortfall are two facts, each with its own words
    // and its own tone — which is the whole point of the split.
    expect(await screen.findByText('Federal balance')).toBeTruthy()
    expect(tile('Federal balance').textContent).toContain('$3,580.00')
    expect(deltaOf('Federal balance').textContent).toContain('refund expected')
    expect(deltaOf('Federal balance').className).toContain('stat-delta-positive')
    expect(tile('California balance').textContent).toContain('$7,840.50')
    expect(deltaOf('California balance').textContent).toContain('to pay at filing')
    expect(deltaOf('California balance').className).toContain('stat-delta-negative')
    // Payroll is informational: what will be withheld against what is owed, no balance
    // words and nothing to act on.
    expect(tile('Payroll taxes').textContent).toContain('$11,143.50')
    expect(deltaOf('Payroll taxes').textContent).toContain('$25,753.20 owed')
    // The three combined tiles give way to them; the combined figures keep one line.
    expect(screen.queryByText('Projected balance')).toBeNull()
    expect(
      screen.getByText(
        'Combined: $123,456.78 tax · $104,586.58 projected withholding · $18,870.20 to pay at filing',
      ),
    ).toBeTruthy()
    // ...and the nudge is gone, because there is nothing left to do about it.
    expect(screen.queryByText(/Enter the federal and state rates/)).toBeNull()
  })

  it('aims each remedy at the form that jurisdiction is actually fixed on', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(withSplit())
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText('Add $603.12 per remaining paycheck on DE 4.'),
    ).toBeTruthy()
    // The federal leg is a refund (remedy 0.00) and payroll has no form at all, so neither
    // asks for anything — and the old combined "W-4 line 4c" line is gone with them.
    expect(screen.queryByText(/W-4 line 4c/)).toBeNull()
    expect(screen.queryByText(/to close the gap/)).toBeNull()
  })

  it('names a positive federal shortfall on the W-4, not on the DE 4', async () => {
    // The mirror of the case above: this household under-withheld federally, so the federal
    // tile is the one with an instruction and it names the federal form.
    const owing = withSplit()
    owing.jurisdictions = {
      ...owing.jurisdictions!,
      federal: {
        ...owing.jurisdictions!.federal,
        balance: '6500.00',
        remedy_per_check: '500.00',
      },
    }
    vi.mocked(fetchWithholding).mockResolvedValue(owing)
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText('Add $500.00 per remaining paycheck on W-4 line 4c.'),
    ).toBeTruthy()
    // Both forms name themselves; neither borrows the other's.
    expect(screen.getByText('Add $603.12 per remaining paycheck on DE 4.')).toBeTruthy()
    expect(deltaOf('Federal balance').textContent).toContain('to pay at filing')
  })

  it('gives each jurisdiction its own safe-harbor sentence instead of the combined one', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(withSplit())
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText(
        "Federal safe harbor: the lesser of 110% of 2025's federal tax ($44,000.00) and 90% of " +
          "this year's projected liability ($54,000.00) is $44,000.00 — the prior-year leg " +
          'binds; covered by projected withholding',
      ),
    ).toBeTruthy()
    // California here has only the current-year leg (a first year, or the $1M rule), so the
    // survivor's own figure IS the threshold and is named once. Where the prior leg DOES
    // exist, its noun is that jurisdiction's tax — "total tax" beside $44,000.00 of a
    // $110,000.00 return would read as an arithmetic error.
    expect(
      screen.getByText(
        "California safe harbor: 90% of this year's projected liability is $27,000.00 — NOT " +
          'covered by projected withholding',
      ),
    ).toBeTruthy()
    // The approximate all-in sentence is superseded, not stacked on top of them.
    expect(screen.queryByText(/Safe harbor \(approx\.\)/)).toBeNull()
  })

  it('shows the split with no figures when the engine refused the year', async () => {
    const refused = withSplit({ liability_total: null, balance_projected: null })
    refused.jurisdictions = {
      federal: {
        liability: null,
        withheld_ytd: '31570.00',
        withheld_projected: '63580.00',
        balance: null,
        remedy_per_check: null,
        safe_harbor: null,
      },
      state: {
        liability: null,
        withheld_ytd: '11286.00',
        withheld_projected: '22159.50',
        balance: null,
        remedy_per_check: null,
        safe_harbor: null,
      },
      payroll: {
        liability: null,
        withheld_ytd: '8489.00',
        withheld_projected: '11143.50',
        balance: null,
        remedy_per_check: null,
        safe_harbor: null,
      },
    }
    vi.mocked(fetchWithholding).mockResolvedValue(refused)
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('Federal balance')).toBeTruthy()
    // Nothing is known, so the tile says nothing rather than a confident "dead even".
    expect(tile('Federal balance').textContent).toContain('—')
    expect(deltaOf('Federal balance').textContent).toContain('no liability to compare')
    expect(screen.queryByText(/per remaining paycheck/)).toBeNull()
  })

  it('reads a POSITIVE balance as money to pay, in words and in the bad tone', async () => {
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')

    // The magnitude, unsigned — the judgment is carried by the words beside it.
    expect(tile('Projected balance').textContent).toContain('$18,870.20')
    expect(tile('Projected balance').textContent).not.toContain('-$18,870.20')
    const delta = deltaOf('Projected balance')
    expect(delta.textContent).toContain('to pay at filing')
    // Owing is the BAD direction (colour), on a number that went UP (glyph): the two channels
    // deliberately disagree, which is what StatTile's explicit `direction` is for.
    expect(delta.className).toContain('stat-delta-negative')
    expect(delta.textContent).toContain('▲')
  })

  it('reads a NEGATIVE balance as a refund, in the good tone', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(fixture({ balance_projected: '-2450.75' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')

    expect(tile('Projected balance').textContent).toContain('$2,450.75')
    const delta = deltaOf('Projected balance')
    expect(delta.textContent).toContain('refund expected')
    expect(delta.className).toContain('stat-delta-positive')
    expect(delta.textContent).toContain('▼')
  })

  it('reads a balance of exactly zero as neither, with no arrow at all', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(fixture({ balance_projected: '0.00' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')

    expect(tile('Projected balance').textContent).toContain('$0.00')
    const delta = deltaOf('Projected balance')
    expect(delta.textContent).toContain('dead even')
    expect(delta.className).toContain('stat-delta-neutral')
    // A green ▲ on a flat balance is a lie in every direction (utils/tone.ts's zero rule).
    expect(delta.textContent).not.toContain('▲')
    expect(delta.textContent).not.toContain('▼')
  })

  it('writes the year-to-date sentence out of the payload', async () => {
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        '$69,275.87 withheld so far · 16 of 24 checks · vest income so far $31,500.00',
      ),
    ).toBeTruthy()
  })

  it('says the safe-harbor threshold was NOT covered when the server says so', async () => {
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): the lesser of 110% of 2025's total tax ($121,000.00) and 90% of this year's projected liability ($111,111.10) is $111,111.10 — the current-year leg binds; NOT covered by projected withholding",
      ),
    ).toBeTruthy()
  })

  it('says covered when the projection clears the threshold', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        safe_harbor: {
          prior_year: 2025,
          prior_total_tax: '90000.00',
          prior_agi: '400000.00',
          multiplier: '1.10',
          threshold: '99000.00',
          prior_filing_status: 'single',
          current_year_threshold: '111111.10',
          effective_threshold: '99000.00',
          met: true,
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): the lesser of 110% of 2025's total tax ($99,000.00) and 90% of this year's projected liability ($111,111.10) is $99,000.00 — the prior-year leg binds; covered by projected withholding",
      ),
    ).toBeTruthy()
  })

  it('renders the current-year leg alone when there is no prior return', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        safe_harbor: {
          prior_year: null,
          prior_total_tax: null,
          prior_agi: null,
          multiplier: null,
          threshold: null,
          prior_filing_status: null,
          current_year_threshold: '111111.10',
          effective_threshold: '111111.10',
          met: false,
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): 90% of this year's projected liability is $111,111.10 — NOT covered by projected withholding",
      ),
    ).toBeTruthy()
    // No prior return -> no wedding-year note either.
    expect(screen.queryByText(/still the legal safe harbor/)).toBeNull()
  })

  it('renders the prior-year leg alone when the engine refused this year', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        liability_total: null,
        balance_projected: null,
        safe_harbor: {
          prior_year: 2025,
          prior_total_tax: '110000.00',
          prior_agi: '400000.00',
          multiplier: '1.10',
          threshold: '121000.00',
          prior_filing_status: 'single',
          current_year_threshold: null,
          effective_threshold: '121000.00',
          met: false,
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): 110% of 2025's total tax is $121,000.00 — NOT covered by projected withholding",
      ),
    ).toBeTruthy()
  })

  it('renders NOTHING about safe harbor when the server sent none', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(fixture({ safe_harbor: null }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')

    // A missing prior year is the normal first-year case and arrives with no warning of its
    // own — so there is no absence here to explain, and inventing copy for it would be this
    // card answering a question the server never asked.
    expect(screen.queryByText(/safe harbor/i)).toBeNull()
  })

  it('nudges the W-2 inputs only while the year has vest income to declare', async () => {
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        // BELOW: the inputs form the reader has to fix this in renders under this card
        // (TaxesPage's order — summary, this card, what-if, then the two editors).
        "This year's vests imply ≈$48,000.00 of W-2 income at vest prices — make sure your W-2 inputs below include it.",
      ),
    ).toBeTruthy()
    cleanup()

    // No vests this year (or every one of them excluded): there is nothing for the W-2 inputs
    // to be missing, and a "≈$0.00" nudge would be noise.
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        vest: {
          income_ytd: '0.00',
          income_projected: '0.00',
          supplemental_ytd: '0.00',
          supplemental_projected: '0.00',
          fica_ytd: '0.00',
          fica_projected: '0.00',
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText(/vests imply/)).toBeNull()
  })

  it('always says how the estimate was made', async () => {
    render(<WithholdingPanel year={2026} />)
    // Every assumption that moves the balance above it: the check grid, the FICA stacking, and
    // the quote the future half is valued at — the last one is why the balance moves with the
    // stock. The lean is worded as a tendency, not a promise (additional-Medicare convexity
    // can run the other way, and an even grid is direction-neutral). The supplemental rates
    // name BOTH tiers and both California rates, because a card that only ever says 22% is
    // wrong for anyone whose vests and bonuses pass a million.
    expect(
      await screen.findByText(
        /Checks are estimated on an even calendar grid.*an approximation that tends to err toward owing more\. Future vests are valued at the latest quote\. Supplemental rates: 22% federal, rising to 37% above \$1,000,000 of vests and bonuses in a year; California 10\.23% on vests and 6\.6% on bonuses\./,
      ),
    ).toBeTruthy()
  })

  it('renders every server warning verbatim, beside the estimate rather than over it', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        warnings: [
          'vest on 2026-02-18 has no stored price — excluded from the estimate',
          'no usable paycheck profile — salary withholding estimated as 0',
        ],
      }),
    )
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText('vest on 2026-02-18 has no stored price — excluded from the estimate'),
    ).toBeTruthy()
    expect(
      screen.getByText('no usable paycheck profile — salary withholding estimated as 0'),
    ).toBeTruthy()
    // The estimate CAME BACK: these are asterisks on it, not a failure of it.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(tile('Projected tax').textContent).toContain('$123,456.78')
  })

  it('shows ONLY the banner when the first load fails, and refetches on Retry', async () => {
    vi.mocked(fetchWithholding)
      .mockRejectedValueOnce(new ApiError('withholding unavailable', 503))
      .mockResolvedValue(fixture())
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('withholding unavailable')).toBeTruthy()
    // Nothing behind it to be stale, and no "Loading…" under a request that already answered.
    expect(screen.queryByText(/may be showing earlier figures/)).toBeNull()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText('$123,456.78')).toBeNull()

    fireEvent.click(retryButton())
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('$123,456.78')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the figures on screen when a RELOAD fails, and says they may be old', async () => {
    vi.mocked(fetchWithholding)
      .mockResolvedValueOnce(fixture())
      .mockRejectedValue(new ApiError('withholding unavailable', 503))
    // The year prop is the panel's other reload door: the page keys this card by year today,
    // so a switch remounts it — but the effect follows the prop, and a load that fails over a
    // card with figures on it must not blank them.
    const { rerender } = render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')

    rerender(<WithholdingPanel year={2027} />)
    expect(
      await screen.findByText('withholding unavailable — may be showing earlier figures.'),
    ).toBeTruthy()
    // Still there, dimmed but not dropped — a reload that failed did not make them untrue.
    expect(screen.getByText('$123,456.78')).toBeTruthy()
    expect(vi.mocked(fetchWithholding)).toHaveBeenLastCalledWith(2027)
  })

  it('lets only the newest load land', async () => {
    const slow = deferred<WithholdingOut>()
    const fast = deferred<WithholdingOut>()
    vi.mocked(fetchWithholding)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const { rerender } = render(<WithholdingPanel year={2026} />)
    rerender(<WithholdingPanel year={2027} />)
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(2))

    await act(async () => {
      fast.resolve(fixture({ year: 2027, liability_total: '99999.99' }))
    })
    expect(await screen.findByText('$99,999.99')).toBeTruthy()

    // The first load answers LAST, carrying a year the card has already moved past.
    await act(async () => {
      slow.resolve(fixture({ liability_total: '11111.11' }))
    })
    expect(screen.queryByText('$11,111.11')).toBeNull()
    expect(screen.getByText('$99,999.99')).toBeTruthy()
  })

  it('renders NO partner section on a single year', async () => {
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText('Partner — entered, not simulated')).toBeNull()
    expect(screen.queryByText(/Additional Medicare gap/)).toBeNull()
  })

  it('shows the partner figures and says which side is entered rather than simulated', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('Partner — entered, not simulated')).toBeTruthy()
    expect(screen.getByText('$150,000.00')).toBeTruthy()
    expect(screen.getByText('$18,000.00')).toBeTruthy()
    expect(screen.getByText('$6,000.00')).toBeTruthy()
    // The card is read-only: the inputs form under it owns these three rows (they are seeded
    // per-person definitions, so it already renders an editable cell for each), and two write
    // paths to one row would race each other.
    expect(
      screen.getByText(
        /Your side is simulated from paycheck profiles; your partner’s is entered\. Edit all three in the inputs form below\./,
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('says "not entered" rather than $0.00 for a withholding row the server left null', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      married({ partner_withheld_fed: null, partner_withheld_state: null }),
    )
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('Partner — entered, not simulated')
    // Blank and zero say very different things about a withholding figure.
    expect(screen.getAllByText('not entered')).toHaveLength(2)
  })

  it('explains the Additional-Medicare trap in one sentence when the gap is positive', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText(
        /Additional Medicare gap ≈\$900\.00: each employer withholds the 0\.9% surtax only above \$200,000 of its own wages, but this return owes it on its combined wages above a lower threshold — wages that stay under the per-employer line still leave this much unwithheld\./,
      ),
    ).toBeTruthy()
  })

  it('stays quiet about the gap when it is zero or negative', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married({ additional_medicare_gap: '0.00' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('Partner — entered, not simulated')
    expect(screen.queryByText(/Additional Medicare gap/)).toBeNull()
    cleanup()

    // Over-withholding is not a trap to shout about — the figure stays in the payload and
    // out of the copy.
    vi.mocked(fetchWithholding).mockResolvedValue(married({ additional_medicare_gap: '-450.00' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('Partner — entered, not simulated')
    expect(screen.queryByText(/Additional Medicare gap/)).toBeNull()
  })

  it('calls the reader to the brackets editor when the status has no tables', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      married({
        brackets_missing_for_status: ['federal', 'medicare'],
        liability_total: null,
        balance_projected: null,
      }),
    )
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText(
        /No federal, medicare bracket table for this year’s filing status — the tax engine cannot price the year until they exist\. Add them in the brackets editor below, or clone another year’s and edit the thresholds\./,
      ),
    ).toBeTruthy()
  })

  it('refuses to call a year with no liability "dead even"', async () => {
    // The server sends null for both figures when it REFUSED to price the year, and a bare
    // Number(null) is 0 — which this card used to render as a confident "dead even" beside a
    // $0.00 balance. Nothing is known here, and the tiles have to say nothing.
    vi.mocked(fetchWithholding).mockResolvedValue(
      married({
        brackets_missing_for_status: ['federal', 'medicare'],
        liability_total: null,
        balance_projected: null,
      }),
    )
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('Partner — entered, not simulated')

    expect(tile('Projected tax').textContent).toContain('—')
    const delta = deltaOf('Projected balance')
    expect(delta.textContent).toContain('no liability to compare')
    expect(delta.textContent).not.toContain('dead even')
    expect(delta.textContent).not.toContain('▲')
    expect(delta.textContent).not.toContain('▼')
    expect(tile('Projected balance').textContent).not.toContain('$0.00')
    // The withholding leg is still real money and still shown: it came from profiles and
    // vests, not from the bracket tables the engine is missing.
    expect(tile('Projected withholding').textContent).toContain('$104,586.58')
  })

  it('renders the safe-harbor multiplier the server applied, not a hardcoded 110%', async () => {
    // Below the IRC 6654(d)(1)(C) AGI gate the safe harbor is a plain 100% of last year's
    // tax. The old copy said "110%" whatever the wire carried, which read as an arithmetic
    // error next to a threshold that equals the prior-year figure.
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        safe_harbor: {
          prior_year: 2025,
          prior_total_tax: '110000.00',
          prior_agi: '100000.00',
          multiplier: '1.00',
          threshold: '110000.00',
          prior_filing_status: 'single',
          current_year_threshold: '111111.10',
          effective_threshold: '110000.00',
          met: false,
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): the lesser of 100% of 2025's total tax ($110,000.00) and 90% of this year's projected liability ($111,111.10) is $110,000.00 — the prior-year leg binds; NOT covered by projected withholding",
      ),
    ).toBeTruthy()
  })

  it('labels a safe harbor that references a return filed under another status', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    // The wedding-year note: the number is still the legal safe harbor, only the household
    // behind it changed — a labelling matter, never a math one.
    expect(
      await screen.findByText(
        /That reference return was filed as single — still the legal safe harbor, just a different household\./,
      ),
    ).toBeTruthy()
  })

  it('says nothing about the reference status when it matches this year', async () => {
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText(/still the legal safe harbor/)).toBeNull()
  })

  /** The married payload with the partner SIMULATED — a profile exists, so the tracker
      rows are stored history and the leg is the card's answer. */
  function simulated(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
    return married({
      partner_source: 'simulated',
      partner_salary: {
        ytd: '13750.00',
        projected: '30000.00',
        checks_elapsed: 11,
        checks_total: 24,
      },
      ...overrides,
    })
  }

  it('says the partner is SIMULATED and shows their leg instead of the tracker rows', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(simulated())
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('Partner — simulated')).toBeTruthy()
    expect(screen.queryByText('Partner — entered, not simulated')).toBeNull()
    // Their wages still come from the W-2 inputs — only the WITHHOLDING side moved.
    expect(screen.getByText('$150,000.00')).toBeTruthy()
    expect(screen.getByText('Withheld so far')).toBeTruthy()
    expect(screen.getByText('$13,750.00')).toBeTruthy()
    // "Projected for the year", not "Projected withholding": the latter is already this
    // card's own stat-tile label for the HOUSEHOLD total, and one card must not spell two
    // different figures the same way.
    expect(screen.getByText('Projected for the year')).toBeTruthy()
    expect(screen.getByText('$30,000.00')).toBeTruthy()
    // The two tracker rows are GONE from the facts list — one source of truth at a time.
    expect(screen.queryByText('Federal withheld')).toBeNull()
    expect(screen.queryByText('State withheld')).toBeNull()
    expect(screen.queryByText('$18,000.00')).toBeNull()
  })

  it('names the provenance of the simulated partner leg', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(simulated())
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText(
        /Simulated from their paycheck profile — 11 of 24 checks at their all-in withholding %\. Their entered W-2 withholding rows are ignored while that profile exists\./,
      ),
    ).toBeTruthy()
    // The entered-mode sentence is not also on screen.
    expect(screen.queryByText(/your partner’s is entered/)).toBeNull()
  })

  it('keeps the entered fallback rendering when there is no partner profile', async () => {
    // The byte-identity pin, stated as its own test: the same payload the P2 cases use
    // still draws the P2 card, heading and sentence included.
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('Partner — entered, not simulated')).toBeTruthy()
    expect(screen.getByText('Federal withheld')).toBeTruthy()
    expect(screen.getByText('State withheld')).toBeTruthy()
    expect(screen.queryByText('Withheld so far')).toBeNull()
    expect(screen.queryByText(/Simulated from their paycheck profile/)).toBeNull()
  })

  // --- D4: per-check remedy + vest→W2 Apply (design 2026-08-31) --------------------------

  // Derived from fixture() itself: balance_projected 18,870.20 over the 24 − 16 = 8 checks
  // still to come is 2,358.775, which formatCurrency rounds half-away-from-zero to 2,358.78.
  const REMEDY = 'Add $2,358.78 per remaining paycheck (W-4 line 4c) to close the gap.'
  const applyChip = () =>
    screen.getByRole('button', { name: 'Apply vest income to W-2 inputs' }) as HTMLButtonElement
  const inputsEcho = { year: 2026, filing_status: 'single' as const, people: [], sections: [] }

  it("computes the per-check remedy from the payload's own fields", async () => {
    // 18,870.20 over the 8 checks still to come (24 − 16) = 2,358.775 → $2,358.78.
    render(<WithholdingPanel year={2026} />)
    expect(await screen.findByText(REMEDY)).toBeTruthy()
  })

  it('stays quiet about a remedy on a refund, and with no checks left', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(fixture({ balance_projected: '-2450.75' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText(/per remaining paycheck/)).toBeNull()
    cleanup()

    // Still owing, but the year's checks are spent: there is no paycheck to put it on.
    vi.mocked(fetchWithholding).mockResolvedValue(fixture({ checks_elapsed: 24 }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText(/per remaining paycheck/)).toBeNull()
  })

  it("applies the FULL-year vest figure to the primary's W-2 input and reloads", async () => {
    vi.mocked(putTaxInputs).mockResolvedValue(inputsEcho)
    const onApplied = vi.fn()
    render(
      <WithholdingPanel year={2026} storedVestW2={null} inputsDirty={false} onVestApplied={onApplied} />,
    )
    await screen.findByText('$123,456.78')
    fireEvent.click(applyChip())

    // income_projected ALONE: the backend already sums past vests into it
    // (withholding_calc income_projected = income_ytd + future) — ytd + projected would
    // double-count every past vest. The values shorthand IS the primary-person write.
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2026, {
        values: { w2_stock_rsus_sold: '48000.00' },
      }),
    )
    expect(onApplied).toHaveBeenCalledWith(inputsEcho)
    // The liability this card compares against just moved with the input it wrote.
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(2))
  })

  it('disables Apply with a title when the stored value already equals the figure', async () => {
    // 4dp stored echo vs the estimate's 2dp: the comparison is numeric, not string.
    render(
      <WithholdingPanel
        year={2026}
        storedVestW2={'48000.0000'}
        inputsDirty={false}
        onVestApplied={vi.fn()}
      />,
    )
    await screen.findByText('$123,456.78')
    expect(applyChip().disabled).toBe(true)
    expect(applyChip().title).toBe('Stored W-2 vest input already equals this figure')
  })

  it('asks before clobbering unsaved input edits below, and respects a no', async () => {
    vi.mocked(putTaxInputs).mockResolvedValue(inputsEcho)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <WithholdingPanel year={2026} storedVestW2={null} inputsDirty={true} onVestApplied={vi.fn()} />,
    )
    await screen.findByText('$123,456.78')
    fireEvent.click(applyChip())
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(applyChip())
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledTimes(1))
    confirmSpy.mockRestore()
  })

  it('lands an Apply failure on its own error line, figures kept', async () => {
    vi.mocked(putTaxInputs).mockRejectedValue(new ApiError('inputs unavailable', 503))
    render(
      <WithholdingPanel year={2026} storedVestW2={null} inputsDirty={false} onVestApplied={vi.fn()} />,
    )
    await screen.findByText('$123,456.78')
    fireEvent.click(applyChip())

    expect(await screen.findByText('inputs unavailable')).toBeTruthy()
    // The estimate on screen is still true — and no reload was spent on a write that failed.
    expect(screen.getByText('$123,456.78')).toBeTruthy()
    expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(1)
  })
})
