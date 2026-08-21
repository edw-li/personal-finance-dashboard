import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { WithholdingOut } from '../../types/api'
import WithholdingPanel from './WithholdingPanel'

// The one request this card makes. JURISDICTIONS and the other taxes helpers stay real —
// nothing here touches them, but the page-level module is shared (TaxesPage.test.tsx's mock).
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  fetchWithholding: vi.fn(),
}))
import { fetchWithholding } from '../../api/taxes'

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
 * balance. The safe-harbor threshold is 110% of the prior year's 110,000.00, which the
 * projection does not reach — so `met` is false, exactly as the server would compute it.
 */
function fixture(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
  return {
    year: 2026,
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
    safe_harbor: {
      prior_year: 2025,
      prior_total_tax: '110000.00',
      threshold: '121000.00',
      met: false,
    },
    warnings: [],
    ...overrides,
  }
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
        "Safe harbor (approx.): 110% of 2025's total tax is $121,000.00 — NOT covered by projected withholding",
      ),
    ).toBeTruthy()
  })

  it('says covered when the projection clears the threshold', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        safe_harbor: {
          prior_year: 2025,
          prior_total_tax: '90000.00',
          threshold: '99000.00',
          met: true,
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): 110% of 2025's total tax is $99,000.00 — covered by projected withholding",
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
        "This year's vests imply ≈$48,000.00 of W-2 income at vest prices — make sure your W-2 inputs above include it.",
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
    expect(
      await screen.findByText(
        /Checks are estimated on an even calendar grid.*conservative, owe-more approximation\. Supplemental rates: 22% federal \+ 10\.23% CA\./,
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
})
