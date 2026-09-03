import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type {
  PaceItem,
  PaycheckBreakdownOut,
  PaycheckPreviewLines,
  PaycheckPreviewOut,
  PaycheckProfileOut,
} from '../../types/api'
import TryItPanel from './TryItPanel'

// One export, because the panel imports one: the write-purity conformance walk
// (sandboxConformance.test.ts) is what proves no writer is reachable from here — a
// `expect(createProfile).not.toHaveBeenCalled()` on a module the panel never imports would
// pass forever while proving nothing.
vi.mock('../../api/paycheck', () => ({ previewPaycheck: vi.fn() }))
import { previewPaycheck } from '../../api/paycheck'
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))

const profile: PaycheckProfileOut = {
  id: 7,
  person_id: 1,
  effective_date: '2026-01-01',
  annual_salary: '100000.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.130000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000',
  espp_pct: '0.110000000',
  withholding_pct: '0.300000000',
  dental_vision_per_check: '12.50',
  hsa_per_check: '100.00',
  hsa_coverage: 'self',
  notes: null,
}

const pace = (over: Partial<PaceItem>[] = []): PaceItem[] => [
  { key: 'limit_401k_elective', label: '401(k) elective deferral', annualized: '13000.00', limit: '24500.00', ratio: '0.5306', tone: 'ok' },
  { key: 'limit_415c_total', label: '415(c) total additions (excludes employer match)', annualized: '16000.00', limit: null, ratio: null, tone: 'ok' },
  { key: 'limit_hsa_self', label: 'HSA — self-only', annualized: '2400.00', limit: '4300.00', ratio: '0.5581', tone: 'ok' },
  { key: 'limit_espp_423', label: 'ESPP §423 annual', annualized: '11000.00', limit: '25000.00', ratio: '0.4400', tone: 'ok' },
  ...(over as PaceItem[]),
]

const lines = (net: string, savings: string): PaycheckPreviewLines => ({
  gross: '4166.67', trad_401k: '541.67', dental_vision: '12.50', hsa: '100.00', taxable: '3512.50',
  withholding: '1053.75', post_tax: '2458.75', roth_401k: '0.00', after_tax_401k: '125.00', espp: '458.33',
  net_pay: net, savings,
})

const breakdown: PaycheckBreakdownOut = {
  profile, gross: '4166.67', trad_401k: '541.67', dental_vision: '12.50', hsa: '100.00', taxable: '3512.50',
  withholding: '1053.75', post_tax: '2458.75', roth_401k: '0.00', after_tax_401k: '125.00', espp: '458.33',
  net_pay: '1875.42', monthly_net: '3750.84', warnings: [], pace: pace(),
}

function previewOut(scenarioNet = '1875.42', delta = '0.00'): PaycheckPreviewOut {
  const block = { baseline: lines('1875.42', '1225.00'), scenario: lines(scenarioNet, '1225.00'), delta: { ...lines('0.00', '0.00'), net_pay: delta } }
  const monthly = { baseline: lines('3750.84', '2450.00'), scenario: lines('3750.84', '2450.00'), delta: lines('0.00', '0.00') }
  return {
    profile,
    per_check: block,
    monthly,
    annual: { baseline: lines('45010.08', '29400.00'), scenario: lines('45010.08', '29400.00'), delta: lines('0.00', '0.00') },
    pace: { baseline: pace(), scenario: pace() },
    changed: [],
    warnings: [],
  }
}

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}

/** In-page navigations into scenario links — the assistant's deep links, as buttons. TWO of
 *  them, because a second link is a second arrival and has to behave like one. */
function DeepLink() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/paycheck?whatif=trad_401k_pct%3A0.15')}>
        Deep link
      </button>
      <button type="button" onClick={() => navigate('/paycheck?whatif=hsa_per_check%3A250')}>
        Other deep link
      </button>
    </>
  )
}

function mount(entry = '/paycheck', onApply = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TryItPanel profileId={null} personId={null} breakdown={breakdown} onApply={onApply} />
      <Url />
      <DeepLink />
    </MemoryRouter>,
  )
  return onApply
}

const url = () => screen.getByTestId('url').textContent
const toggle = () => screen.getByRole('button', { name: /^(Try it|Close)$/ })

beforeEach(() => {
  localStorage.clear()
  vi.mocked(previewPaycheck).mockImplementation(async () => previewOut())
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TryItPanel', () => {
  it('mounts closed and spends no request; opening runs the empty scenario against the shown profile', async () => {
    mount()
    expect(screen.getByRole('heading', { name: /Try it — effective Jan 1, 2026/ })).toBeTruthy()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(previewPaycheck).not.toHaveBeenCalled()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    expect(previewPaycheck).toHaveBeenCalledWith({ profile_id: null, person_id: null, overrides: {} })
    expect((screen.getByRole('button', { name: 'Reset to actual' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('arriving with entries opens the card and runs at once; the compare and pace strip read the scenario', async () => {
    vi.mocked(previewPaycheck).mockResolvedValue(previewOut('1958.75', '83.33'))
    mount('/paycheck?whatif=trad_401k_pct%3A0.15')
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledWith({ profile_id: null, person_id: null, overrides: { trad_401k_pct: '0.15' } }))
    const row = (await screen.findByText('Net pay')).closest('tr') as HTMLElement
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Net pay', '$1,875.42', '$1,958.75', '+$83.33'])
    expect(screen.getByRole('region', { name: 'Contribution pace' })).toBeTruthy()
    // The knob shows its distance from actual.
    expect(screen.getByText('+2.0 pp')).toBeTruthy()
  })

  it('a drag debounces; release writes the URL replace-style and previews once', async () => {
    vi.useFakeTimers()
    try {
      mount()
      fireEvent.click(toggle())
      await act(async () => {})
      const slider = screen.getByRole('slider', { name: 'Traditional 401(k) slider' })
      fireEvent.change(slider, { target: { value: '0.19' } })
      fireEvent.change(slider, { target: { value: '0.2' } })
      expect(url()).toBe('/paycheck')
      fireEvent.mouseUp(slider)
      expect(url()).toBe('/paycheck?whatif=trad_401k_pct%3A0.2')
      await act(async () => {})
      expect(previewPaycheck).toHaveBeenLastCalledWith({ profile_id: null, person_id: null, overrides: { trad_401k_pct: '0.2' } })
      expect(previewPaycheck).toHaveBeenCalledTimes(2) // the empty run, then the release
    } finally {
      vi.useRealTimers()
    }
  })

  it('presets are sized from the pace rows and set knobs immediately; a missing limit disables its chip', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Max 401(k)' }))
    expect(url()).toBe('/paycheck?whatif=trad_401k_pct%3A0.245')
    fireEvent.click(screen.getByRole('button', { name: 'Max HSA' }))
    expect(url()).toBe('/paycheck?whatif=hsa_per_check%3A179.16&whatif=trad_401k_pct%3A0.245')
    fireEvent.click(screen.getByRole('button', { name: 'Max ESPP' }))
    expect(url()).toContain('whatif=espp_pct%3A0.15')
    fireEvent.click(screen.getByRole('button', { name: 'Stop ESPP' }))
    expect(url()).toContain('whatif=espp_pct%3A0')
    expect(url()).not.toContain('0.15')
    cleanup()
    // Without an ESPP pace row the limit is unknown: disabled, with the sentence.
    render(
      <MemoryRouter initialEntries={['/paycheck']}>
        <TryItPanel profileId={null} personId={null} breakdown={{ ...breakdown, pace: pace().filter((r) => r.key !== 'limit_espp_423') }} onApply={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.click(toggle())
    const chip = screen.getByRole('button', { name: 'Max ESPP' }) as HTMLButtonElement
    expect(chip.disabled).toBe(true)
    expect(chip.title).toContain("Enter this year's ESPP §423 limit in Settings › Limits")
  })

  it('the unit toggle switches the compare to the monthly and annual blocks', async () => {
    mount('/paycheck?whatif=trad_401k_pct%3A0.15')
    await screen.findByText('Net pay')
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    const row = screen.getByText('Net pay').closest('tr') as HTMLElement
    expect(within(row).getAllByRole('cell')[1].textContent).toBe('$3,750.84')
    fireEvent.click(screen.getByRole('button', { name: 'Annual' }))
    expect(within(screen.getByText('Net pay').closest('tr') as HTMLElement).getAllByRole('cell')[1].textContent).toBe('$45,010.08')
  })

  it('Apply hands the pre-filled form seed to the page and writes nothing', async () => {
    const onApply = mount('/paycheck?whatif=trad_401k_pct%3A0.15&whatif=hsa_coverage%3Afamily')
    await screen.findByText('Net pay')
    fireEvent.click(screen.getByRole('button', { name: /^Save as profile effective / }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const seed = onApply.mock.calls[0][0]
    expect(seed.trad_401k_pct).toBe('15')
    expect(seed.hsa_coverage).toBe('family')
    expect(seed.annual_salary).toBe('100000.00')
    expect(seed.effective_date).toMatch(/^\d{4}-\d{2}-01$/)
  })

  it('no Apply while the scenario is empty', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /^Save as profile/ })).toBeNull()
  })

  it('a failed run keeps the last result under the stale line, in the server’s words', async () => {
    mount('/paycheck?whatif=trad_401k_pct%3A0.15')
    await screen.findByText('Net pay')
    vi.mocked(previewPaycheck).mockRejectedValueOnce(new ApiError('trad_401k_pct must be between 0 and 1', 422))
    fireEvent.click(screen.getByRole('button', { name: 'Stop ESPP' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('trad_401k_pct must be between 0 and 1 — this scenario may be showing earlier data.')
    expect(screen.getByText('Net pay')).toBeTruthy()
  })

  it('a navigation into a scenario link opens the card and runs it, page already mounted', async () => {
    mount()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(previewPaycheck).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Deep link' }))
    // Open on the SAME commit the URL changed on — no frame of closed card, no effect.
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    await waitFor(() =>
      expect(previewPaycheck).toHaveBeenCalledWith({ profile_id: null, person_id: null, overrides: { trad_401k_pct: '0.15' } }),
    )
    // Closing it by hand sticks, even though the URL still holds the knob.
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('a DIFFERENT scenario link re-opens a card the user closed by hand', async () => {
    // "Arriving with entries opens the panel and runs immediately" (spec §6) is about the
    // ENTRIES, not about whether there are any: a latch that only remembers "the URL had
    // knobs" swallows every link after the first, so the assistant's second answer would
    // land on a closed card with its scenario invisible in the address bar.
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Deep link' }))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Other deep link' }))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    await waitFor(() =>
      expect(previewPaycheck).toHaveBeenCalledWith({ profile_id: null, person_id: null, overrides: { hsa_per_check: '250' } }),
    )
  })

  it('a knob back on the profile’s own figure leaves the URL, whichever control moved it', async () => {
    mount('/paycheck?whatif=trad_401k_pct%3A0.15&whatif=hsa_coverage%3Afamily')
    await screen.findByText('Net pay')
    // The slider's caption hands back the profile's 9dp string; "0.13" is the same knob
    // position, so the entry goes rather than being restated.
    fireEvent.click(screen.getByRole('button', { name: 'actual 13%' }))
    expect(url()).toBe('/paycheck?whatif=hsa_coverage%3Afamily')
    fireEvent.click(within(screen.getByRole('group', { name: 'HSA coverage' })).getByRole('button', { name: 'Self only' }))
    expect(url()).toBe('/paycheck')
  })

  it('refuses a box spelling the URL grammar would drop, in the box’s own sentence', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    const salary = screen.getByLabelText('Annual salary') as HTMLInputElement
    // Number("200000.") is 200000, but the codec refuses a trailing point — without the
    // fence the URL would take it and drop it on the next render, reverting to actual.
    fireEvent.focus(salary)
    fireEvent.change(salary, { target: { value: '200000.' } })
    fireEvent.blur(salary)
    expect(screen.getByRole('alert').textContent).toBe('Annual salary must be a plain positive amount, like 200000')
    expect(url()).toBe('/paycheck')
    const periods = screen.getByLabelText('Pay periods per year') as HTMLInputElement
    fireEvent.focus(periods)
    fireEvent.change(periods, { target: { value: '26.5' } })
    fireEvent.blur(periods)
    expect(screen.getByText('pay_periods_per_year must be a whole number between 1 and 366')).toBeTruthy()
    expect(url()).toBe('/paycheck')
  })

  it('the coverage toggle and the salary box are knobs too', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    fireEvent.click(within(screen.getByRole('group', { name: 'HSA coverage' })).getByRole('button', { name: 'Family' }))
    expect(url()).toBe('/paycheck?whatif=hsa_coverage%3Afamily')
    const salary = screen.getByLabelText('Annual salary') as HTMLInputElement
    fireEvent.focus(salary)
    fireEvent.change(salary, { target: { value: '$200,000' } })
    fireEvent.blur(salary)
    expect(url()).toBe('/paycheck?whatif=annual_salary%3A200000&whatif=hsa_coverage%3Afamily')
  })
})
