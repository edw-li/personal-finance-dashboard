import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'

vi.mock('../../api/settings', () => ({ fetchAppSettings: vi.fn(), putAppSettings: vi.fn() }))
vi.mock('../../api/paycheck', () => ({ fetchProfiles: vi.fn() }))
vi.mock('../../api/household', () => ({ fetchHousehold: vi.fn() }))
import { fetchHousehold } from '../../api/household'
import { fetchProfiles } from '../../api/paycheck'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import PlanAssumptionsCard from './PlanAssumptionsCard'

const SETTINGS = {
  swr_pct: '0.045000',
  espp_ticker: 'NVDA',
  price_refresh_cron: '10 13 * * mon-fri',
  calendar_update_due_day: 1,
  espp_discount_pct: '0.150000',
}
const PROFILE = {
  id: 1, person_id: 1, effective_date: '2026-01-01', annual_salary: '188930.00',
  pay_periods_per_year: 24, trad_401k_pct: '0.130000000', roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000', espp_pct: '0.120000000', withholding_pct: '0.220000000',
  dental_vision_per_check: '40.00', hsa_per_check: '150.00', hsa_coverage: 'family' as const,
  notes: null, in_force: true,
  match_rate_1: '1.000000000', match_band_1: '6000.00',
  match_rate_2: '0.500000000', match_band_2: '11000.00',
  hsa_employer_annual: '2000.00', hsa_employer_per_dependent: '500.00', hsa_dependents: 0,
  fed_withholding_pct: null, state_withholding_pct: null,
}
const ME = { id: 1, name: 'Me', is_primary: true }

const mount = () => render(<MemoryRouter><PlanAssumptionsCard /></MemoryRouter>)
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement
// Anchored at both ends, this file's family convention: a bare /^sav/i would also match the
// other settings cards' buttons once the page mounts them together.
const save = () => screen.getByRole('button', { name: /^sav(e assumptions|ing…)$/i })
const type = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value } })

beforeEach(() => {
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(putAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(fetchProfiles).mockResolvedValue([PROFILE])
  vi.mocked(fetchHousehold).mockResolvedValue({ people: [ME], marriage_date: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PlanAssumptionsCard', () => {
  it('seeds the three boxes from the stored settings, percent-shifted for display', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Plan assumptions' })).toBeTruthy()
    expect(document.getElementById('plan-assumptions')).toBeTruthy()
    // The columns store fractions; the boxes speak percent. Number() trims the stored
    // quantizer's trailing zeros, and the box round-trips through shiftPoint on save, so no
    // float ever reaches the wire.
    expect(box('Withdrawal rate (% / year)').value).toBe('4.5')
    expect(box('ESPP ticker').value).toBe('NVDA')
    expect(box('ESPP discount (%)').value).toBe('15')
  })

  it('states each person’s in-force match in words, with a link to the Paycheck page', async () => {
    mount()
    // Word for word the sentence the Paycheck profile form prints (spec §2.3): whole-cent
    // amounts through formatCurrency, the rate shifted off the stored fraction rather than
    // multiplied. Two surfaces describing one policy must not phrase it two ways.
    expect(
      await screen.findByText(
        'Me: 100% of the first $6,000.00, then 50% of the next $11,000.00',
      ),
    ).toBeTruthy()
    // Read-only here on purpose: the policy is effective-dated on the profile, and two places
    // to edit one number is how they drift.
    expect(
      screen.getByRole('link', { name: 'Set it on the Paycheck page' }).getAttribute('href'),
    ).toBe('/paycheck')
  })

  it('says so plainly when there is no match, and when there is no profile at all', async () => {
    vi.mocked(fetchProfiles).mockResolvedValue([
      { ...PROFILE, match_rate_1: '0.000000000', match_band_1: '0.00', match_rate_2: '0.000000000', match_band_2: '0.00' },
    ])
    vi.mocked(fetchHousehold).mockResolvedValue({
      people: [ME, { id: 2, name: 'Sam', is_primary: false }],
      marriage_date: null,
    })
    mount()
    expect(await screen.findByText('Me: No employer match entered.')).toBeTruthy()
    expect(screen.getByText('Sam: no paycheck profile yet')).toBeTruthy()
  })

  it('prints a tier the employer funds at nothing, because a zero rate is a policy', async () => {
    // A band with a 0% rate is a real arrangement — the money is matched at nothing past the
    // first tier — and the profile form prints it. Dropping it here would make the two
    // surfaces disagree about a policy that exists.
    vi.mocked(fetchProfiles).mockResolvedValue([
      { ...PROFILE, match_rate_2: '0.000000000' },
    ])
    mount()
    expect(
      await screen.findByText('Me: 100% of the first $6,000.00, then 0% of the next $11,000.00'),
    ).toBeTruthy()
  })

  it('sends ONLY its own three fields, so the partial PUT leaves the rest standing', async () => {
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('Withdrawal rate (% / year)'), '3.75')
    // As TYPED: the server owns normalization (it uppercases), and a client that pre-empted it
    // would be a second opinion about the same string.
    type(box('ESPP ticker'), 'msft')
    type(box('ESPP discount (%)'), '10')
    fireEvent.click(save())

    await waitFor(() => expect(putAppSettings).toHaveBeenCalledTimes(1))
    // No price_refresh_cron and no calendar_update_due_day — not even as nulls. The server
    // reads the body with exclude_unset, so an absent key keeps its stored value while a null
    // would clear it.
    expect(vi.mocked(putAppSettings).mock.calls[0][0]).toEqual({
      swr_pct: '0.0375',
      espp_ticker: 'msft',
      espp_discount_pct: '0.1',
    })
    expect(await screen.findByText('Saved.')).toBeTruthy()

    // The sentence is about the values that WERE saved — the next keystroke moves on.
    type(box('ESPP ticker'), 'nvda')
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('re-seeds the boxes from the PUT RESPONSE, not from what was typed', async () => {
    vi.mocked(putAppSettings).mockResolvedValue({
      ...SETTINGS,
      swr_pct: '0.037500',
      espp_ticker: 'MSFT',
      espp_discount_pct: '0.100000',
    })
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('Withdrawal rate (% / year)'), '3.7500')
    type(box('ESPP ticker'), 'msft')
    type(box('ESPP discount (%)'), '10')
    fireEvent.click(save())

    // The server answers with what it STORED (quantized rate, uppercased ticker). Keeping the
    // typed text would leave the form reading as unsaved work against values that are already
    // in the database.
    await waitFor(() => expect(box('ESPP ticker').value).toBe('MSFT'))
    expect(box('Withdrawal rate (% / year)').value).toBe('3.75')
    expect(box('ESPP discount (%)').value).toBe('10')
  })

  it('sends espp_ticker: null EXPLICITLY when the ticker box is emptied', async () => {
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('ESPP ticker'), '   ')
    fireEvent.click(save())

    await waitFor(() => expect(putAppSettings).toHaveBeenCalledTimes(1))
    const body = vi.mocked(putAppSettings).mock.calls[0][0]
    // The key must SURVIVE JSON.stringify: an undefined value is dropped from the JSON, and
    // under the partial PUT a dropped key means "keep the stored ticker" — so "clear it" and
    // "I forgot to send it" would arrive as the same request. Null says it on purpose.
    expect(Object.keys(body)).toContain('espp_ticker')
    expect(body.espp_ticker).toBeNull()
    expect(JSON.parse(JSON.stringify(body)).espp_ticker).toBeNull()
  })

  it('refuses exponent text and out-of-range values without spending a request', async () => {
    mount()
    await screen.findByLabelText('ESPP ticker')

    // Exponent AND out of range (1e3 is 1000): the two gates disagree about this box, so the
    // message names which ran FIRST. Only plain-decimal-before-Number() is correct.
    type(box('Withdrawal rate (% / year)'), '1e3')
    fireEvent.click(save())
    expect(await screen.findByText('Enter a plain decimal (no exponents).')).toBeTruthy()

    type(box('Withdrawal rate (% / year)'), '150')
    fireEvent.click(save())
    // The box is labelled in PERCENT, so it says 100 — not the server's "between 0 and 1",
    // which is the stored fraction's vocabulary and would read as the opposite advice.
    expect(await screen.findByText('Must be between 0 and 100.')).toBeTruthy()

    type(box('Withdrawal rate (% / year)'), '4')
    type(box('ESPP discount (%)'), '20')
    fireEvent.click(save())
    expect(await screen.findByText('Must be between 0 and 15 — the §423 maximum.')).toBeTruthy()

    expect(putAppSettings).not.toHaveBeenCalled()
  })

  it('renders a PUT rejection verbatim in the form-level error slot', async () => {
    const detail = 'ticker must be 1-20 characters of A-Z, 0-9, dot or dash, starting alphanumeric'
    vi.mocked(putAppSettings).mockRejectedValue(new ApiError(detail, 422))
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('ESPP ticker'), '$$$')
    fireEvent.click(save())

    // Form-level on purpose: the ticker 422 is NOT field-prefixed, so there is nothing
    // reliable to map the message onto a single box with.
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('banners a failed load and refetches on Retry, offering no form to save', async () => {
    vi.mocked(fetchProfiles).mockRejectedValue(new ApiError('profiles unavailable', 503))
    mount()

    expect(await screen.findByText('profiles unavailable')).toBeTruthy()
    // A first load that failed knows nothing about the stored settings, and a form seeded with
    // blanks would offer to save them.
    expect(screen.queryByLabelText('ESPP ticker')).toBeNull()
    // Nor an empty match list under a heading: the read that would have filled it is the one
    // that failed, and a blank list reads as "nobody has a match".
    expect(screen.queryByText('Employer 401(k) match')).toBeNull()

    vi.mocked(fetchProfiles).mockResolvedValue([PROFILE])
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the plan assumptions' }))
    expect(await screen.findByLabelText('ESPP ticker')).toBeTruthy()
  })
})
