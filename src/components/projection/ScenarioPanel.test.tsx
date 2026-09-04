import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSandbox, type Sandbox, type SandboxSpec } from '../../sandbox/useSandbox'
import type { PersonOut, ProjectionOut } from '../../types/api'
import { EMPTY_PROJECTION_SCENARIO, decodeProjection, encodeProjection, isEmptyProjection, labelForProjection, type ProjectionScenario } from './projectionScenario'
import ScenarioPanel from './ScenarioPanel'

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))

const echo: ProjectionOut = {
  starting_balance: '100000.00', base_month: '2026-09-01', start_month: '2026-09-01', annual_return: '0.05',
  monthly_contribution: '4000.00', annual_spend: '60000.00', swr_pct: '0.04', years: 30, fi_target: '1500000.00',
  fi_ratio: '0.066667', fi_month: '2041-03-01', coast_fi_month: null, months: ['2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104400.00'], coast: ['100000.00', '100400.00'], warnings: [], volatility: '0.15',
  inflation: '0.03', contribution_growth: '0.03', bands: null, fi_probability: '0.62', fi_month_p10: '2038-01-01',
  fi_month_p50: '2041-06-01', fi_month_p90: null, retirements: [],
  derived_window: { from: '2025-08-01', to: '2026-07-01', months: 12 },
}
const people: PersonOut[] = [{ id: 1, name: 'Edward', is_primary: true }, { id: 2, name: 'Grace', is_primary: false }]
const preview = vi.fn<(s: ProjectionScenario) => Promise<ProjectionOut>>()

function Host() {
  const spec: SandboxSpec<ProjectionScenario, ProjectionOut> = {
    page: 'projection', decode: decodeProjection, encode: encodeProjection, isEmpty: isEmptyProjection,
    preview, dataKey: 'projection', debounceMs: 300, labelFor: labelForProjection,
  }
  const sandbox = useSandbox(spec)
  const location = useLocation()
  return (
    <>
      <ScenarioPanel sandbox={sandbox} baseline={sandbox.baseline} people={people} />
      <span data-testid="url">{location.pathname + location.search}</span>
    </>
  )
}

function mount(entry = '/projection') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Host />
    </MemoryRouter>,
  )
}
const url = () => screen.getByTestId('url').textContent

beforeEach(() => {
  localStorage.clear()
  preview.mockReset()
  preview.mockImplementation(async (s) => ({ ...echo, annual_return: s.knobs.annual_return ?? echo.annual_return, fi_month: s.knobs.annual_return ? '2039-01-01' : echo.fi_month }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ScenarioPanel', () => {
  it('opens by default with every knob derived: badge, placeholder and caption from the echo; no Apply', async () => {
    mount()
    expect(screen.getByRole('button', { name: 'Hide knobs' }).getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ knobs: {}, retirements: {} }))
    await waitFor(() => expect(screen.getAllByText('derived')).toHaveLength(8))
    expect((screen.getByLabelText('Annual return') as HTMLInputElement).placeholder).toBe('5')
    expect(screen.getByRole('button', { name: 'actual 5%' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Reset to derived' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/^Apply/)).toBeNull()
  })

  it('a typed knob writes the URL as a fraction, shows its delta chip and is fetched', async () => {
    mount()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    const box = screen.getByLabelText('Annual return') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '6' } })
    fireEvent.blur(box)
    expect(url()).toBe('/projection?whatif=annual_return%3A0.06')
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ knobs: { annual_return: '0.06' }, retirements: {} }))
    expect(screen.getByText('+1.0 pp')).toBeTruthy()
    expect(screen.getAllByText('derived')).toHaveLength(7)
  })

  it('a retirement month is an immediate retire entry; blank removes it', async () => {
    mount()
    // Wait for the derived run to LAND: a non-empty scenario asked for before it does
    // makes the hook fetch the baseline too, and that empty run would be the last call.
    await waitFor(() => expect(screen.getAllByText('derived')).toHaveLength(8))
    const grace = screen.getByLabelText('Retires — Grace') as HTMLInputElement
    fireEvent.change(grace, { target: { value: '2035-06' } })
    expect(url()).toBe('/projection?whatif=retire%3A2%3A2035-06')
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ knobs: {}, retirements: { 2: '2035-06' } }))
    fireEvent.change(grace, { target: { value: '' } })
    expect(url()).toBe('/projection')
  })

  it('lets a month be typed one character at a time, then refuses a garbled one on blur', () => {
    mount()
    // A browser WITHOUT a month picker renders type="month" as a plain text box and hands
    // the typed characters straight through — that is the case the draft exists for. This
    // jsdom implements the month sanitiser (an invalid value becomes ''), so the box is
    // demoted to text here to reproduce the browser that does not.
    const grace = screen.getByLabelText('Retires — Grace') as HTMLInputElement
    // Demoted before EVERY keystroke: React re-applies type="month" on each update, and
    // jsdom's month sanitiser would empty a partial value before the handler ever read it.
    // The DOM value is not asserted for the same reason — the draft STATE is what holds
    // the text, which the blur below proves, since the refusal it words comes from there.
    const asPlainText = () => {
      grace.type = 'text'
      return grace
    }
    for (const partial of ['2', '20', '203', '2035', '2035-', '2035-0']) {
      fireEvent.change(asPlainText(), { target: { value: partial } })
      expect(screen.queryByRole('alert')).toBeNull() // never refused mid-word…
      expect(url()).toBe('/projection') // …and never written half-typed
    }
    fireEvent.blur(grace)
    expect(screen.getByRole('alert').textContent).toBe("Grace's retirement month must look like YYYY-MM")
    expect(url()).toBe('/projection') // the refused text never lands

    // Completed, it commits on the spot — a picker hands over the whole month at once.
    fireEvent.change(asPlainText(), { target: { value: '2035-06' } })
    expect(url()).toBe('/projection?whatif=retire%3A2%3A2035-06')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Enter commits a typed month, and Reset clears both the draft and the refusal', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByText('derived')).toHaveLength(8))
    const grace = screen.getByLabelText('Retires — Grace') as HTMLInputElement
    // See the test above: type="month" is re-applied by React on every update.
    const asPlainText = () => {
      grace.type = 'text'
      return grace
    }
    fireEvent.change(asPlainText(), { target: { value: '2035-0' } })
    fireEvent.keyDown(grace, { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeTruthy() // Enter is a commit point too
    fireEvent.change(asPlainText(), { target: { value: '2035-06' } })
    expect(url()).toBe('/projection?whatif=retire%3A2%3A2035-06')

    // Reset drops the URL, and with it the drafts and the refusal they earned: a later
    // blur still carrying the old text would write back a scenario just cleared.
    fireEvent.change(asPlainText(), { target: { value: '2035-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to derived' }))
    expect(url()).toBe('/projection')
    fireEvent.blur(grace)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(url()).toBe('/projection')
  })

  // A hand-built sandbox, so `entries` can be any list the TYPE allows rather than only the
  // lists this page's own encoder happens to produce, and a harness that SWAPS them in place
  // — the panel must keep its state across the change, which is the whole question here.
  const stub = (entries: string[]): Sandbox<ProjectionScenario, ProjectionOut> => ({
    scenario: EMPTY_PROJECTION_SCENARIO, entries, empty: entries.length === 0, set: vi.fn(),
    reset: vi.fn(), baseline: echo, result: echo, busy: false, error: null, errorStatus: null,
    stale: false, pins: [], pin: vi.fn(), unpin: vi.fn(), pinResults: {}, link: '/projection',
  })

  it('asks the SAME question about a scenario change that the hook does', () => {
    // The panel's draft reset and useSandbox's run key both mean "are these the same
    // entries?", and they have to agree. The hook joins on a unit separator precisely
    // because a bare join is lossy — ['a', '', 'b'] and ['a', 'b'] flatten alike — so a
    // panel keyed on join('') would hold a half-typed month across a scenario change the
    // hook already re-ran, and the next blur would write back a month nobody asked for.
    function Swapper() {
      const [entries, setEntries] = useState(['retire:2:2035-06', ''])
      return (
        <MemoryRouter>
          <button type="button" onClick={() => setEntries(['retire:2:2035-06'])}>swap</button>
          <ScenarioPanel sandbox={stub(entries)} baseline={echo} people={people} />
        </MemoryRouter>
      )
    }
    render(<Swapper />)
    const grace = screen.getByLabelText('Retires — Grace') as HTMLInputElement
    grace.type = 'text' // see above: React re-applies type="month" and jsdom empties a partial
    fireEvent.change(grace, { target: { value: '2035-1' } })

    fireEvent.click(screen.getByRole('button', { name: 'swap' }))
    fireEvent.blur(grace)
    // The draft went with the scenario: nothing to commit, so nothing to refuse.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('compares baseline and scenario without a Δ column, and pins as columns', async () => {
    mount('/projection?whatif=annual_return%3A0.06')
    const row = (await screen.findByText('FI date')).closest('tr') as HTMLElement
    await waitFor(() => expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['FI date', 'Mar 2041', 'Jan 2039']))
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Baseline', 'Scenario'])
    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))
    await waitFor(() => expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Return 6%Unpin'))
  })

  it('Reset to derived empties the URL', async () => {
    mount('/projection?whatif=years%3A40&whatif=retire%3A2%3A2035-06')
    await waitFor(() => expect(preview).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Reset to derived' }))
    expect(url()).toBe('/projection')
  })

  it('prints the window under both derived-from-data figures, and the contribution arithmetic', async () => {
    preview.mockImplementation(async () => ({
      ...echo,
      contribution_breakdown: {
        cash: '1200.00',
        payroll: '2800.00',
        total: '4000.00',
        by_person: [{ person_id: 1, name: 'Edward', monthly: '2400.00' }],
      },
    }))
    mount()
    // Both the contribution and the annual spend derive from the SAME matched window, and
    // each says so under its own knob.
    await waitFor(() =>
      expect(screen.getAllByText('derived over Aug 2025–Jul 2026 (12 months)')).toHaveLength(2),
    )
    expect(
      screen.getByText(
        'derived: $1,200.00 cash savings + $2,800.00 payroll deductions (Edward $2,400.00)',
      ),
    ).toBeTruthy()
  })

  it('says nothing about a window the echo cannot name', async () => {
    preview.mockImplementation(async () => ({ ...echo, derived_window: null }))
    mount()
    await waitFor(() => expect(preview).toHaveBeenCalled())
    expect(screen.queryByText(/derived over/)).toBeNull()
  })

  it('states that the seed is fixed and points the withdrawal rate at Settings', () => {
    mount()
    expect(screen.getByText(/seed-stable/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
  })
})
