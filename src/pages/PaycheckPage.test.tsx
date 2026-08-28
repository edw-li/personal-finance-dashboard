import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { PaycheckBreakdownOut, PaycheckProfileOut } from '../types/api'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import PaycheckPage from './PaycheckPage'

// Every request is stubbed.
vi.mock('../api/paycheck', () => ({
  fetchProfiles: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  fetchBreakdown: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — the flow
// card's geometry is pinned in paycheckSankeyOptions.test.ts; this marker only says
// whether the chart is up and which nodes it carries. The async factory keeps the JSX
// runtime out of vi.mock's hoisted scope.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      animateEntrance = true,
    }: {
      option: { series?: { data?: { name?: string }[] }[] }
      ariaLabel?: string
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-nodes': (option.series?.[0]?.data ?? []).map((n) => n.name ?? '').join(','),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})
import {
  createProfile,
  deleteProfile,
  fetchBreakdown,
  fetchProfiles,
  updateProfile,
} from '../api/paycheck'

// --- fixtures -------------------------------------------------------------------------
// The 2026 profile and its eleven lines are the Workbook reference (plan §"Paycheck
// Modeler": salary 188930, 24 periods, trad .13, roth 0, after-tax .03, espp .11,
// withholding 0.334009167, d&v 12.50, HSA 100 -> gross 7872.08 ... net 3384.16, monthly
// 6768.33), sanctioned for golden fixtures. The 2025 row is INVENTED — it exists so the
// table has two rows and the profile switch has somewhere to go.

const profile2026: PaycheckProfileOut = {
  id: 1,
  person_id: 1,
  effective_date: '2026-01-01',
  annual_salary: '188930.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.130000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000',
  espp_pct: '0.110000000',
  withholding_pct: '0.334009167',
  dental_vision_per_check: '12.50',
  hsa_per_check: '100.00',
  hsa_coverage: 'self',
  notes: null,
}

const profile2025: PaycheckProfileOut = {
  id: 2,
  person_id: 1,
  effective_date: '2025-01-01',
  annual_salary: '162000.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.100000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.020000000',
  espp_pct: '0.150000000',
  withholding_pct: '0.310000000',
  dental_vision_per_check: '11.00',
  hsa_per_check: '75.00',
  hsa_coverage: 'self',
  notes: '2025 comp',
}

// effective_date DESC, the order the router answers in.
const PROFILES = [profile2026, profile2025]

function breakdownOf(
  profile: PaycheckProfileOut,
  over: Partial<PaycheckBreakdownOut> = {},
): PaycheckBreakdownOut {
  return {
    profile,
    gross: '7872.08',
    trad_401k: '1023.37',
    dental_vision: '12.50',
    hsa: '100.00',
    taxable: '6736.21',
    withholding: '2249.96',
    post_tax: '4486.26',
    roth_401k: '0.00',
    after_tax_401k: '236.16',
    espp: '865.93',
    net_pay: '3384.16',
    monthly_net: '6768.33',
    warnings: [],
    ...over,
  }
}

// A visibly different waterfall, for the switch tests.
const breakdown2025 = breakdownOf(profile2025, {
  gross: '6750.00',
  trad_401k: '675.00',
  dental_vision: '11.00',
  hsa: '75.00',
  taxable: '5989.00',
  withholding: '1856.59',
  post_tax: '4132.41',
  roth_401k: '0.00',
  after_tax_401k: '135.00',
  espp: '1012.50',
  net_pay: '2984.91',
  monthly_net: '5969.82',
})

// --- helpers --------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } })

/**
 * The value beside a waterfall label. The same words also head a table column and label a
 * form box, so the lookup is anchored on the definition TERM — the one element that only
 * the waterfall has.
 */
function line(label: string): string {
  const term = screen.getAllByText(label).find((el) => el.tagName === 'DT')
  expect(term).toBeTruthy()
  return term?.nextElementSibling?.textContent ?? ''
}

const confirmSpy = vi.spyOn(window, 'confirm')

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchProfiles).mockResolvedValue(PROFILES)
  vi.mocked(fetchBreakdown).mockResolvedValue(breakdownOf(profile2026))
  vi.mocked(createProfile).mockResolvedValue(profile2026)
  vi.mocked(updateProfile).mockResolvedValue(profile2026)
  vi.mocked(deleteProfile).mockResolvedValue(undefined)
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PaycheckPage — the waterfall', () => {
  it('renders the eleven golden lines and the monthly tile, nothing re-derived', async () => {
    // Seeded so the paint is a CACHED one: the Monthly-net hero counts up on fresh paints
    // only (spec §8), and a settling number is not a string this test can pin. The
    // revalidation below still goes out — and lands the identical payload.
    setSnapshot('paycheck:breakdown:current', breakdownOf(profile2026))
    render(<PaycheckPage />)

    expect(await screen.findByText('$3,384.16')).toBeTruthy()
    expect(line('Gross')).toBe('$7,872.08')
    expect(line('Traditional 401(k)')).toBe('$1,023.37')
    expect(line('Dental & vision')).toBe('$12.50')
    expect(line('HSA')).toBe('$100.00')
    expect(line('Taxable')).toBe('$6,736.21')
    expect(line('Withholding')).toBe('$2,249.96')
    expect(line('Post-tax')).toBe('$4,486.26')
    expect(line('Roth 401(k)')).toBe('$0.00')
    expect(line('After-tax 401(k)')).toBe('$236.16')
    expect(line('ESPP')).toBe('$865.93')
    // The authoritative one: the displayed lines above do NOT reconcile to it by a cent
    // (4486.26 - 236.16 - 865.93 = 3384.17), which is exactly why none of them is added up
    // on this side of the wire.
    expect(line('Net pay')).toBe('$3,384.16')
    expect(screen.getByText('Monthly net')).toBeTruthy()
    expect(screen.getByText('$6,768.33')).toBeTruthy()

    // The panel says whose waterfall it is, so a stale one can never pass for another's.
    expect(screen.getByText('Per-check breakdown — effective Jan 1, 2026')).toBeTruthy()
    // The default profile is the SERVER's: no id goes out on the first request.
    expect(vi.mocked(fetchBreakdown).mock.calls[0][0]).toBeUndefined()
  })

  it('marks the net-pay line as the one that counts', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    const net = screen.getAllByText('Net pay').find((el) => el.tagName === 'DT')
    expect(net?.parentElement?.className).toContain('is-net')
  })

  it('renders the engine’s warnings as advice, not as an error', async () => {
    vi.mocked(fetchBreakdown).mockResolvedValue(
      breakdownOf(profile2026, {
        net_pay: '-120.00',
        warnings: ['contribution percentages exceed 100%', 'net pay is negative'],
      }),
    )
    render(<PaycheckPage />)

    expect(await screen.findByText('contribution percentages exceed 100%')).toBeTruthy()
    expect(screen.getByText('net pay is negative')).toBeTruthy()
    // Advisory: nothing failed, so no alert is raised over the page.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(line('Net pay')).toBe('-$120.00')
  })

  it('refetches the breakdown for the profile whose row is chosen', async () => {
    vi.mocked(fetchBreakdown)
      .mockResolvedValueOnce(breakdownOf(profile2026))
      .mockResolvedValueOnce(breakdown2025)
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' }))

    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(2))
    // The id the client turns into ?profile_id= (src/api/paycheck.ts owns the query string).
    expect(vi.mocked(fetchBreakdown).mock.calls[1][0]).toBe(2)
    expect(await screen.findByText('$2,984.91')).toBeTruthy()
    expect(screen.getByText('Per-check breakdown — effective Jan 1, 2025')).toBeTruthy()
    // The profiles list is a separate load: choosing a profile never refetches it.
    expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(1)

    // Re-clicking the row that is already shown must not spend another request.
    fireEvent.click(screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' }))
    expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(2)

    // ...and there is a way back to whichever profile is in force today.
    fireEvent.click(screen.getByRole('button', { name: 'Show the current profile' }))
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(3))
    expect(vi.mocked(fetchBreakdown).mock.calls[2][0]).toBeUndefined()
  })

  it('lights up the row the BREAKDOWN is about, not the one that was asked for', async () => {
    // Nothing is pinned on arrival, so the SERVER chooses — and the highlight has to come
    // from its answer. Here it answers with the 2025 profile while the page asked for no
    // profile at all, which is exactly the case a `pinnedId` highlight would get wrong
    // (it would light nothing up, or light up the wrong row after a delete).
    vi.mocked(fetchBreakdown).mockResolvedValue(breakdown2025)
    render(<PaycheckPage />)
    await screen.findByText('$2,984.91')

    expect(vi.mocked(fetchBreakdown).mock.calls[0][0]).toBeUndefined()
    const pressed = (label: string) =>
      screen.getByRole('button', { name: label }).getAttribute('aria-pressed')
    expect(pressed('Show the breakdown for Jan 1, 2025')).toBe('true')
    expect(pressed('Show the breakdown for Jan 1, 2026')).toBe('false')
  })

  it('points at the form when there are no profiles at all', async () => {
    vi.mocked(fetchProfiles).mockResolvedValue([])
    vi.mocked(fetchBreakdown).mockRejectedValue(new ApiError('no paycheck profiles', 404))
    render(<PaycheckPage />)

    expect(
      await screen.findByText('no paycheck profiles — add one below to see the waterfall.'),
    ).toBeTruthy()
    // An empty state, not a failure: no banner and no half-drawn waterfall.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Gross')).toBeNull()
    // The form is still there, with nothing to copy from.
    expect(field('Annual salary').value).toBe('')
    expect(field('Pay periods per year').value).toBe('24')
  })

  it('points at the table when the PINNED profile is the one that has gone', async () => {
    // The other 404 on this route: the row was deleted from somewhere else, so the answer
    // is the table, not the form.
    vi.mocked(fetchBreakdown).mockRejectedValue(new ApiError('paycheck profile not found', 404))
    render(<PaycheckPage />)

    expect(
      await screen.findByText('paycheck profile not found — choose a profile below.'),
    ).toBeTruthy()
    expect(screen.getByText('$188,930.00')).toBeTruthy()
  })

  it('keeps a breakdown failure off the profiles table', async () => {
    vi.mocked(fetchBreakdown).mockRejectedValue(new ApiError('breakdown unavailable', 503))
    render(<PaycheckPage />)

    // A FIRST-load failure: the bare sentence, with no stale cue, because there is no
    // earlier waterfall for one to be about.
    expect(await screen.findByText('breakdown unavailable')).toBeTruthy()
    // Independent loads: the table answered and is untouched.
    expect(screen.getByText('$188,930.00')).toBeTruthy()
  })

  it('says the breakdown may be behind when a RELOAD fails, and keeps it on screen', async () => {
    vi.mocked(fetchBreakdown)
      .mockResolvedValueOnce(breakdownOf(profile2026))
      .mockRejectedValueOnce(new ApiError('breakdown unavailable', 503))
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' }))

    // The other branch of the same banner: something IS still on screen, so the sentence
    // says so rather than leaving the old figures passing for the ones just asked for.
    expect(
      await screen.findByText(
        'breakdown unavailable — this breakdown may be showing earlier data.',
      ),
    ).toBeTruthy()
    // Kept, and still named — which is what makes keeping it honest.
    expect(screen.getByText('$3,384.16')).toBeTruthy()
    expect(screen.getByText('Per-check breakdown — effective Jan 1, 2026')).toBeTruthy()
  })
})

describe('PaycheckPage — the profile form', () => {
  it('prefills the new-profile form from the latest profile, percents in percent form', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    // The comp-change ritual: everything carries over except the date it takes effect on.
    // Every figure box is an AmountInput, so a BLURRED one shows its formatted echo
    // (display rule §3.3) — the shifted percent strings themselves are what is in state.
    expect(field('Effective date').value).toBe('')
    expect(field('Annual salary').value).toBe('$188,930.00')
    // Pay periods is a whole-number box and stays a plain input.
    expect(field('Pay periods per year').value).toBe('24')
    // 0.130000000 comes back as "13", not 13.000000000000002 — echoed "13%".
    expect(field('Traditional 401(k) %').value).toBe('13%')
    expect(field('Roth 401(k) %').value).toBe('0%')
    expect(field('After-tax 401(k) %').value).toBe('3%')
    expect(field('ESPP %').value).toBe('11%')
    expect(field('Withholding %').value).toBe('33.4009167%')
    expect(field('Dental & vision').value).toBe('$12.50')
    expect(field('HSA').value).toBe('$100.00')
    expect(field('Notes').value).toBe('')

    // The other half of the display rule: focus swaps the echo for the raw state, which is
    // the human-scale percent the wire body shifts. (fireEvent.focus fires React's onFocus,
    // which is all this swap turns on — it does not move activeElement, and need not.)
    fireEvent.focus(field('Traditional 401(k) %'))
    expect(field('Traditional 401(k) %').value).toBe('13')
  })

  it('posts the full profile with every percent shifted, never divided', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    type('Traditional 401(k) %', '13')
    type('Notes', 'July raise')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(createProfile).mock.calls[0][0]
    // 13 / 100 is 0.13 in binary by luck; 33.4009167 / 100 is 0.33400916699999995. String
    // math is what makes BOTH of them exact.
    expect(body.trad_401k_pct).toBe('0.13')
    expect(body).toEqual({
      effective_date: '2026-07-01',
      annual_salary: '188930.00',
      pay_periods_per_year: 24,
      trad_401k_pct: '0.13',
      roth_401k_pct: '0',
      after_tax_401k_pct: '0.03',
      espp_pct: '0.11',
      withholding_pct: '0.334009167',
      dental_vision_per_check: '12.50',
      hsa_per_check: '100.00',
      notes: 'July raise',
    })
    // A new profile moves both halves of the page: the list, and which one is in force.
    await waitFor(() => expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(2))
  })

  it('PATCHes the FULL profile shape, never a delta', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit the profile effective Jan 1, 2026' }),
    )
    expect(field('Effective date').value).toBe('2026-01-01')
    type('Notes', 'Jan 2026 comp')
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(vi.mocked(updateProfile)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateProfile).mock.calls[0][0]).toBe(1)
    // Task 4 review M6's binding: the router validates the MERGED profile, so a delta
    // PATCH would 422 on a stored field this form never touched.
    expect(vi.mocked(updateProfile).mock.calls[0][1]).toEqual({
      effective_date: '2026-01-01',
      annual_salary: '188930.00',
      pay_periods_per_year: 24,
      trad_401k_pct: '0.13',
      roth_401k_pct: '0',
      after_tax_401k_pct: '0.03',
      espp_pct: '0.11',
      withholding_pct: '0.334009167',
      dental_vision_per_check: '12.50',
      hsa_per_check: '100.00',
      notes: 'Jan 2026 comp',
    })
  })

  it('treats a blanked optional money box as a real zero', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit the profile effective Jan 1, 2026' }),
    )
    type('HSA', '')
    type('Dental & vision', '')
    type('Roth 401(k) %', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(vi.mocked(updateProfile)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(updateProfile).mock.calls[0][1]
    // "" would reach the API as Decimal('') and 422 as an opaque parse error; and the box
    // was PREFILLED from the row, so clearing it means zero, not "leave it alone".
    expect(body.hsa_per_check).toBe('0')
    expect(body.dental_vision_per_check).toBe('0')
    expect(body.roth_401k_pct).toBe('0')
  })

  it('deletes a profile only after the confirm is accepted', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    confirmSpy.mockReturnValue(false)
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete the profile effective Jan 1, 2025' }),
    )
    expect(vi.mocked(deleteProfile)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete the profile effective Jan 1, 2025' }),
    )
    await waitFor(() => expect(vi.mocked(deleteProfile)).toHaveBeenCalledWith(2))
    await waitFor(() => expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(2))
  })

  it('falls back to the server default when the profile on screen is deleted', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' }))
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(2))

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete the profile effective Jan 1, 2025' }),
    )
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(3))
    // Asking for the deleted id again would 404 forever; the selection goes back to
    // "whichever profile is in force".
    expect(vi.mocked(fetchBreakdown).mock.calls[2][0]).toBeUndefined()
  })

  it('requires the three NOT NULL columns before spending a request', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    expect(
      await screen.findByText('Effective date, annual salary and pay periods are required'),
    ).toBeTruthy()
    expect(vi.mocked(createProfile)).not.toHaveBeenCalled()
  })

  it('answers a zero pay-period count in the server’s own sentence', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    type('Pay periods per year', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    // THE divide-by-zero guard, in the server's words — it reads the same on both sides.
    expect(
      await screen.findByText('pay_periods_per_year must be between 1 and 366'),
    ).toBeTruthy()
    expect(vi.mocked(createProfile)).not.toHaveBeenCalled()
  })

  it('bounds a percent in the box’s own vocabulary, not the stored fraction’s', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    type('ESPP %', '110')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    // NOT the server's "espp_pct must be between 0 and 1": this box is labelled "ESPP %"
    // and holds 11 for 11%, so the stored fraction's sentence would call a perfectly good
    // 11 out of range and wave a 0.5 (half a percent) through.
    expect(await screen.findByText('ESPP % must be between 0 and 100')).toBeTruthy()
    expect(vi.mocked(createProfile)).not.toHaveBeenCalled()

    // The guard is a range, not a suspicion: the whole 100 is a legal contribution.
    type('ESPP %', '100')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createProfile).mock.calls[0][0].espp_pct).toBe('1')
  })

  it('refuses exponent notation in a percent box, client-side', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    type('Traditional 401(k) %', '1e-3')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    // NOT a case the server rescues: shiftPoint hands "1e-3" back untouched, Decimal reads
    // it as a perfectly legal 0.001, and a box that said a thousandth of a percent would be
    // stored as a tenth of one. No request may leave with it.
    expect(await screen.findByText('Traditional 401(k) % must be a number')).toBeTruthy()
    expect(vi.mocked(createProfile)).not.toHaveBeenCalled()

    // ...and the plain decimal that follows is converted, not refused.
    type('Traditional 401(k) %', '0.001')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createProfile).mock.calls[0][0].trad_401k_pct).toBe('0.00001')
  })

  it('canonicalizes a grouped salary at the wire boundary, with no blur', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    type('Annual salary', '$150,000')
    type('Traditional 401(k) %', '13')
    // Typed and clicked, never blurred — a mouse user who fills the form and presses Add
    // produces exactly this sequence, so the payload BELT in submit(), not AmountInput's
    // blur commit, is what keeps "$150,000" out of a Decimal column. The percent travels
    // the same belt and is still SHIFTED, never divided.
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(createProfile).mock.calls[0][0]
    expect(body.annual_salary).toBe('150000')
    expect(body.trad_401k_pct).toBe('0.13')
  })

  it('refuses an =-expression in a percent box, which the box itself will not evaluate', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    type('Traditional 401(k) %', '=13')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    // THE consistency rule: these boxes render kind="percent", which refuses a leading "="
    // outright — the evaluator quantizes to 2dp, and these columns are 9dp fractions, so
    // "=1/8" would store 0.0013 where an eighth of a percent (0.00125) was meant. A gate
    // left on the money default would green-light text the cell itself marks invalid, and
    // the belt beside it would then evaluate it. Both sides pass { expressions: false }.
    expect(await screen.findByText('Traditional 401(k) % must be a number')).toBeTruthy()
    expect(vi.mocked(createProfile)).not.toHaveBeenCalled()
  })

  it('reseeds the form from the row that is newest AFTER the save', async () => {
    // The latest profile's date moves BACKWARD, behind the 2025 row. The echo is no longer
    // the newest thing in the table, so the next new profile must copy the 2025 row —
    // seeding from the echo would carry a salary that is no longer the current one.
    vi.mocked(updateProfile).mockResolvedValue({ ...profile2026, effective_date: '2024-06-01' })
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit the profile effective Jan 1, 2026' }),
    )
    type('Effective date', '2024-06-01')
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(vi.mocked(updateProfile)).toHaveBeenCalledTimes(1))
    // The 2025 row's numbers, in the new-profile form: salary, and its own 10% traditional
    // — blurred, so each box shows its formatted echo (display rule §3.3).
    await waitFor(() => expect(field('Annual salary').value).toBe('$162,000.00'))
    expect(field('Traditional 401(k) %').value).toBe('10%')
    expect(field('ESPP %').value).toBe('15%')
    // The two things a new profile never inherits.
    expect(field('Effective date').value).toBe('')
    expect(field('Notes').value).toBe('')
    expect(screen.getByRole('button', { name: 'Add profile' })).toBeTruthy()
  })

  it('puts the caret back on the effective date after a save', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    // The reseed and the focus are ONE ritual (spec §5.1): the carry-forward form refills
    // from the newest row, and the caret lands on the one box a new profile never inherits
    // — so the next comp change is typed, not clicked into. Without it the caret strands on
    // the Add button, which is where the last entry session ended, not where the next starts.
    await waitFor(() => expect(document.activeElement).toBe(field('Effective date')))
    expect(field('Effective date').value).toBe('')
  })

  it('renders a 409 verbatim and keeps the typed row', async () => {
    vi.mocked(createProfile).mockRejectedValue(
      new ApiError('a paycheck profile for 2026-07-01 already exists', 409),
    )
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    expect(
      await screen.findByText('a paycheck profile for 2026-07-01 already exists'),
    ).toBeTruthy()
    expect(field('Effective date').value).toBe('2026-07-01')
    expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(1)
  })

  it('renders a 422 verbatim', async () => {
    vi.mocked(createProfile).mockRejectedValue(
      new ApiError('annual_salary must be positive', 422),
    )
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    type('Annual salary', '0.001')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    expect(await screen.findByText('annual_salary must be positive')).toBeTruthy()
  })
})

describe('PaycheckPage — loading', () => {
  it('offers a retry when the profiles load fails, with no stale cue behind it', async () => {
    vi.mocked(fetchProfiles).mockRejectedValueOnce(new ApiError('profiles unavailable', 503))
    render(<PaycheckPage />)

    expect(await screen.findByText('profiles unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading profiles' }))
    expect(await screen.findByText('$188,930.00')).toBeTruthy()
    expect(screen.queryByText('profiles unavailable')).toBeNull()
  })

  it('says the table may be behind when a RELOAD fails, and keeps the rows', async () => {
    vi.mocked(fetchProfiles)
      .mockResolvedValueOnce(PROFILES)
      .mockRejectedValueOnce(new ApiError('profiles unavailable', 503))
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Notes', 'half-typed profile')
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete the profile effective Jan 1, 2025' }),
    )
    await waitFor(() => expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(2))

    expect(
      await screen.findByText('profiles unavailable — the table may be showing earlier data.'),
    ).toBeTruthy()
    expect(screen.getByText('$188,930.00')).toBeTruthy()
    expect(field('Notes').value).toBe('half-typed profile')
  })

  it('keeps a row chosen DURING a save when the save lands', async () => {
    const save = deferred<PaycheckProfileOut>()
    vi.mocked(createProfile).mockReturnValueOnce(save.promise)
    vi.mocked(fetchBreakdown)
      .mockResolvedValueOnce(breakdownOf(profile2026)) // the mount
      .mockResolvedValueOnce(breakdown2025) // the row pressed mid-save
      .mockResolvedValueOnce(breakdown2025) // the write's own refetch
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    type('Effective date', '2026-07-01')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))

    // The user does not wait for the write: this row is pressed while it is still in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' }))
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchBreakdown).mock.calls[1][0]).toBe(2)

    await act(async () => {
      save.resolve(profile2026)
    })

    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(3))
    // The write refetches the selection as it is NOW, not the one it closed over when it
    // was submitted — otherwise the resolving promise silently undoes the row press.
    expect(vi.mocked(fetchBreakdown).mock.calls[2][0]).toBe(2)
    expect(await screen.findByText('$2,984.91')).toBeTruthy()
  })

  it('lets only the NEWEST of two overlapping breakdowns land', async () => {
    const slow = deferred<PaycheckBreakdownOut>()
    const fast = deferred<PaycheckBreakdownOut>()
    vi.mocked(fetchBreakdown)
      .mockResolvedValueOnce(breakdownOf(profile2026)) // the mount
      .mockReturnValueOnce(slow.promise) // the 2025 row
      .mockReturnValueOnce(fast.promise) // back to the current one
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    fireEvent.click(screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' }))
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Show the current profile' }))
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(3))

    fast.resolve(breakdownOf(profile2026, { net_pay: '2222.22' }))
    expect(await screen.findByText('$2,222.22')).toBeTruthy()

    await act(async () => {
      slow.resolve(breakdown2025)
    })
    // The older request answers LAST and must not replace the waterfall the user is
    // looking at — the seq ref, not the network, decides which one is on screen.
    expect(screen.queryByText('$2,984.91')).toBeNull()
    expect(screen.getByText('$2,222.22')).toBeTruthy()
  })
})

describe('PaycheckPage — the flow card', () => {
  it('draws the flow beside the waterfall from the same payload, zero branches omitted', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    expect(screen.getByText('Where each check goes')).toBeTruthy()
    const marker = screen.getByTestId('echart')
    // The golden fixture's roth_401k is 0.00 — its node is omitted outright.
    expect(marker.getAttribute('data-nodes')).toBe(
      'Gross,Taxable,Post-tax,Traditional 401(k),Dental & vision,HSA,Withholding,After-tax 401(k),ESPP,Net pay',
    )
  })

  it('shows the guard sentence instead of a chart when a figure is negative', async () => {
    vi.mocked(fetchBreakdown).mockResolvedValue(
      breakdownOf(profile2026, { net_pay: '-120.00' }),
    )
    render(<PaycheckPage />)
    await screen.findByText('-$120.00')

    // The table (which handles negatives fine) stays; the sankey steps aside (spec §4).
    expect(screen.getByText(/deductions exceed pay — see the table/)).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('names the sankey for assistive tech', async () => {
    render(<PaycheckPage />)
    await screen.findByText('Where each check goes')
    expect(
      document.querySelector('[aria-label="Sankey flow of one paycheck from gross to net"]'),
    ).not.toBeNull()
  })
})

describe('PaycheckPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints the waterfall instantly from a seeded breakdown and still revalidates', () => {
    setSnapshot('paycheck:breakdown:current', breakdownOf(profile2026))
    // Never-resolving fetch: whatever is on screen came from the seed alone.
    vi.mocked(fetchBreakdown).mockReturnValue(new Promise(() => {}))
    render(<PaycheckPage />)
    expect(line('Gross')).toBe('$7,872.08')
    expect(screen.queryByText('Loading the breakdown…')).toBeNull()
    // The flow card rides the same payload and renders still on a cached paint.
    expect(screen.getByTestId('echart').getAttribute('data-animate')).toBe('false')
    expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(1)
  })

  it('seeds the profile table from its own key', () => {
    setSnapshot('paycheck:profiles', PROFILES)
    vi.mocked(fetchProfiles).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchBreakdown).mockReturnValue(new Promise(() => {}))
    render(<PaycheckPage />)
    // Both effective dates are on screen before either request answers.
    expect(screen.getByText('Jan 1, 2026')).toBeTruthy()
    expect(screen.getByText('Jan 1, 2025')).toBeTruthy()
  })

  it('a changed revalidation payload updates the waterfall and re-arms the flow', async () => {
    setSnapshot('paycheck:breakdown:current', breakdownOf(profile2026))
    vi.mocked(fetchBreakdown).mockResolvedValue(breakdown2025)
    render(<PaycheckPage />)
    expect(line('Gross')).toBe('$7,872.08')
    await waitFor(() => expect(line('Gross')).toBe('$6,750.00'))
    expect(screen.getByTestId('echart').getAttribute('data-animate')).toBe('true')
  })

  it('leaves the flow still when the revalidation payload is identical', async () => {
    setSnapshot('paycheck:breakdown:current', breakdownOf(profile2026))
    render(<PaycheckPage />)
    await waitFor(() => expect(fetchBreakdown).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.getByTestId('echart').getAttribute('data-animate')).toBe('false')
  })
})
