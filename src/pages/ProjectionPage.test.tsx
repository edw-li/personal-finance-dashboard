import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import {
  BAND_SERIES,
  MEDIAN_SERIES,
  PROJECTION_SERIES,
} from '../components/projection/projectionChartOptions'
import type { NetWorthTimeseries, ProjectionOut } from '../types/api'
import { clearSnapshots, getSnapshot, setSnapshot } from '../api/snapshotCache'
import { PINS_VERSION, pinsKey } from '../sandbox/pins'
import ProjectionPage from './ProjectionPage'

vi.mock('../api/projection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/projection')>()),
  fetchProjection: vi.fn(),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what the chart
// draws is pinned in projectionChartOptions.test.ts; this marker says whether one is up.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      animateEntrance = true,
      onLegendChange,
    }: {
      option: {
        xAxis?: { data?: unknown[] }
        yAxis?: { type?: string }
        legend?: { selected?: unknown }
        series?: {
          name?: string
          markLine?: { data?: { xAxis?: string; label?: { formatter?: string } }[] }
        }[]
      }
      ariaLabel?: string
      animateEntrance?: boolean
      onLegendChange?: (selected: Record<string, boolean>) => void
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-categories': (option.xAxis?.data ?? []).join(','),
        // Linear vs Log (F3) and the picks the page feeds back in (§9).
        'data-y-type': String(option.yAxis?.type ?? ''),
        'data-legend-selected': JSON.stringify(option.legend?.selected ?? null),
        // Stands in for echarts' legendselectchanged, which jsdom can never fire.
        onMouseEnter: () => onLegendChange?.({ 'Growth only': false }),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        // Series names are the option capture: WHICH curves a payload puts on the chart
        // is the page's business (their geometry is pinned in the builder's own test).
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join(','),
        // ...and WHICH annotations it puts there (NetWorthPage's data-marriage idiom).
        'data-marks': (option.series ?? [])
          .flatMap((s) => s.markLine?.data ?? [])
          .map((d) => `${d.xAxis ?? ''}=${d.label?.formatter ?? ''}`)
          .join('|'),
      }),
  }
})
vi.mock('../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/netWorth')>()),
  fetchTimeseries: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// The sandbox's pin row toasts at the limit; the page never sees the provider in a test.
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../components/ToastProvider', () => ({ useToast: () => toast }))
import { fetchHousehold } from '../api/household'
import { fetchTimeseries } from '../api/netWorth'
import { fetchProjection } from '../api/projection'

// The bare GET's answer as the server now gives it: absent assumption knobs DEFAULT
// server-side, so the fan is up and the three echoes are filled — three months of
// hand-made percentiles standing in for the simulation.
function projectionOut(over: Partial<ProjectionOut> = {}): ProjectionOut {
  return {
    starting_balance: '100000.00',
    base_month: '2026-08-01',
    start_month: '2026-08-01',
    annual_return: '0.05',
    monthly_contribution: '4000.00',
    annual_spend: '60000.00',
    swr_pct: '0.04',
    years: 30,
    fi_target: '1500000.00',
    fi_ratio: '0.066667',
    fi_month: '2055-10-01',
    coast_fi_month: null,
    months: ['2026-08-01', '2026-09-01', '2026-10-01'],
    projected: ['100000.00', '104000.00', '108000.00'],
    coast: ['100000.00', '100000.00', '100000.00'],
    warnings: [],
    volatility: '0.150000',
    inflation: '0.030000',
    contribution_growth: '0.030000',
    bands: {
      p10: ['100000.00', '90000.00', '80000.00'],
      p25: ['100000.00', '95000.00', '92000.00'],
      p50: ['100000.00', '104000.00', '108000.00'],
      p75: ['100000.00', '112000.00', '125000.00'],
      p90: ['100000.00', '120000.00', '150000.00'],
    },
    fi_probability: '0.620000',
    fi_month_p10: '2050-01-01',
    fi_month_p50: '2055-10-01',
    fi_month_p90: '2061-03-01',
    retirements: [],
    ...over,
  }
}

// An explicit volatility=0: the echo is a real zero and the whole simulation block is
// null — the fan's off switch, which is a different payload from a stale backend's nulls.
function fanOff(over: Partial<ProjectionOut> = {}): ProjectionOut {
  return projectionOut({
    volatility: '0.000000',
    bands: null,
    fi_probability: null,
    fi_month_p10: null,
    fi_month_p50: null,
    fi_month_p90: null,
    ...over,
  })
}

// A STALE backend — one from before the defaults existed, still echoing nulls. Pinned so
// the page keeps rendering against it instead of greying in a number nothing ran with.
function staleEchoes(over: Partial<ProjectionOut> = {}): ProjectionOut {
  return fanOff({ volatility: null, inflation: null, contribution_growth: null, ...over })
}

function timeseries(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    accounts: [],
    series: [],
    group_totals: {
      cash: [],
      pre_tax: [],
      post_tax: [],
      taxable: [],
      equity: [],
      other: [],
      liability: [],
    },
    net_worth: ['100000.00', '101000.00', '102010.00'],
    mom_pct: [null, null, null],
    notes: [null, null, null],
    owner_series: [],
    ...over,
  }
}

function household(people = [
  { id: 1, name: 'Me', is_primary: true },
  { id: 2, name: 'Alex', is_primary: false },
]) {
  return { people, marriage_date: null }
}

// The URL IS the scenario state (2026-09-03 planning-sandboxes spec §6), so every test
// can read back what a knob wrote — and arrive with a scenario already in the address bar.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

function renderPage(entry = '/projection') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <ProjectionPage />
    </MemoryRouter>,
  )
}

const url = () => screen.getByTestId('location').textContent

// EXACT labels, never substrings: a hint's aria-label is a label too, and a SliderBox's
// range carries the knob's words with a " slider" suffix — /volatility/i would name two
// controls at once. `selector` picks the box out of its own <label>, which also labels the
// ⓘ button nested inside it. The box is the AmountInput beside the track.
const box = (label: string) =>
  screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement

// A SliderBox commits on blur (its own test pins the protocol): focus, type in the box's
// own vocabulary — percents are percents — then blur. That is one URL write.
function typeKnob(label: string, value: string) {
  const input = box(label)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

// The payload has landed: the frame swapped its skeleton for the page, whose tail is the
// knobs card. Every earlier "wait for a figure" anchor is now ambiguous — the compare table
// prints the same headline figures as the tiles.
const loaded = () => screen.findByRole('button', { name: 'Hide knobs' })

// A tile is addressed through its label (OverviewPage's idiom), inside the tile row: the
// compare table repeats those labels down its first column.
const tileFor = (label: string) =>
  within(document.querySelector('.kpi-row') as HTMLElement)
    .getByText(label)
    .closest('.stat-tile') as HTMLElement
const valueOf = (tile: HTMLElement) => tile.querySelector('.stat-value')?.textContent ?? ''
const deltaOf = (tile: HTMLElement) => tile.querySelector('.stat-delta')?.textContent ?? null
// DOM order is card order: [0] is the net-worth trend, [1] the investable chart.
const seriesOf = (chart: Element) => (chart.getAttribute('data-series') ?? '').split(',')

beforeEach(() => {
  clearSnapshots()
  localStorage.clear() // pins live in finance.sandbox.projection
  vi.mocked(fetchProjection).mockResolvedValue(projectionOut())
  vi.mocked(fetchTimeseries).mockResolvedValue(timeseries())
  vi.mocked(fetchHousehold).mockResolvedValue(household())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProjectionPage', () => {
  it('states the FI figures from the echo and names their derivations', async () => {
    renderPage()
    await loaded()

    expect(valueOf(tileFor('FI target'))).toBe('$1,500,000.00')
    expect(valueOf(tileFor('FI ratio'))).toBe('6.7%') // fi_ratio, formatPct 1dp
    expect(valueOf(tileFor('Investable balance'))).toBe('$100,000.00')
    expect(deltaOf(tileFor('Investable balance'))).toBe('as of Aug 2026')
    expect(valueOf(tileFor('Projected FI date'))).toBe('Oct 2055')
    expect(await screen.findAllByTestId('echart')).toHaveLength(2)
  })

  it('spells out how a derived contribution was built', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(
      projectionOut({
        monthly_contribution: '4400.00',
        contribution_breakdown: {
          cash: '4000.00',
          payroll: '400.00',
          total: '4400.00',
          by_person: [
            { person_id: 1, name: 'Me', monthly: '250.00' },
            { person_id: 2, name: 'Alex', monthly: '150.00' },
          ],
        },
      }),
    )
    renderPage()
    const note = await screen.findByText(/derived: \$4,000\.00 cash savings \+ \$400\.00 payroll/)
    expect(note.textContent).toContain('Me $250.00 · Alex $150.00')
  })

  it('says nothing about a derivation when the knob was typed', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(
      projectionOut({ monthly_contribution: '1000.00', contribution_breakdown: null }),
    )
    renderPage()
    // The echo is the PLACEHOLDER now: a typed knob is the one that fills the box.
    await waitFor(() => expect(box('Monthly contribution').placeholder).toBe('1000.00'))
    expect(screen.queryByText(/derived:/)).toBeNull()
  })

  it('shows the echo as each knob’s derived caption and placeholder', async () => {
    renderPage()
    await loaded()
    await waitFor(() => expect(box('Annual return').placeholder).toBe('5'))
    expect(box('Monthly contribution').placeholder).toBe('4000.00')
    expect(box('Annual spend').placeholder).toBe('60000.00')
    expect(box('Withdrawal rate').placeholder).toBe('4')
    expect(box('Horizon (years)').placeholder).toBe('30')
    // Blank means derived: the badge says so, and the caption resets the knob to it.
    expect(screen.getByRole('button', { name: 'actual 5%' })).toBeTruthy()
    expect(screen.getAllByText('derived')).toHaveLength(8)
  })

  it('writes a typed knob to the URL as a fraction and fetches it; blank knobs stay omitted', async () => {
    renderPage()
    await loaded()

    typeKnob('Annual return', '6')

    // ONE knob in the URL, one knob in the query: the seven blanks are still the server's
    // to derive, and the link IS the request.
    await waitFor(() =>
      expect(vi.mocked(fetchProjection)).toHaveBeenLastCalledWith({
        annualReturn: '0.06',
        retirements: [],
      }),
    )
    expect(url()).toBe('/projection?whatif=annual_return%3A0.06')
  })

  it('refuses an out-of-range withdrawal rate in the box vocabulary, spending no request', async () => {
    renderPage()
    await loaded()

    // The fence is the SliderBox's track (SLIDER.swr), worded in the box's percents.
    typeKnob('Withdrawal rate', '150')

    expect(screen.getByRole('alert').textContent).toBe(
      'Withdrawal rate must be between 0.1% and 10%',
    )
    expect(fetchProjection).toHaveBeenCalledTimes(1) // the derived run only
    expect(url()).toBe('/projection')
  })

  it('answers a fresh database with the wizard, not an error', async () => {
    vi.mocked(fetchProjection).mockRejectedValue(
      new ApiError('no net-worth snapshots to project from', 404),
    )
    renderPage()

    expect(await screen.findByText(/no net-worth snapshots to project from/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /enter a monthly update/i }).getAttribute('href')).toBe(
      '/update',
    )
    expect(screen.queryByRole('alert')).toBeNull() // an empty database is not an error
  })

  it('hands a first-load failure to the frame: one alert, one plain Retry that refetches', async () => {
    // The page-specific aria-label is retired with the hand-rolled banner — the frame's
    // alert is the only one, and its button is named Retry everywhere (shell spec §5).
    vi.mocked(fetchProjection).mockRejectedValueOnce(new ApiError('projection down', 500))
    renderPage()

    expect(await screen.findByText(/projection down/)).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByLabelText('Retry the projection')).toBeNull()

    // The frame's Retry bumps the sandbox's dataKey — the live scenario, the baseline and
    // every pin run again.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await loaded()
    expect(valueOf(tileFor('FI target'))).toBe('$1,500,000.00')
  })

  it('Retry on a REFUSED scenario drops the entries instead of re-sending them', async () => {
    // Cold cache, a deep link the server refuses, and a derived run that has nothing to
    // stand on (a database with no snapshots): the frame is the page's only surface, so its
    // Retry is the only door. Bumping the dataKey would ask the same 422 again forever —
    // the knob, not the data, is what the server named, so Retry there means "drop it".
    vi.mocked(fetchProjection).mockImplementation((params) =>
      params?.annualReturn !== undefined
        ? Promise.reject(new ApiError('annual_return must be between -0.5 and 0.5', 422))
        : Promise.reject(new ApiError('no net-worth snapshots yet', 404)),
    )
    renderPage('/projection?whatif=annual_return%3A0.06')

    expect(await screen.findByText(/annual_return must be between/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // The URL is the state, so dropping the refused knob IS the reset — and the run that
    // follows carries none of it.
    await waitFor(() => expect(url()).toBe('/projection'))
    await waitFor(() =>
      expect(vi.mocked(fetchProjection)).toHaveBeenLastCalledWith({ retirements: [] }),
    )
    // What is left is the empty database's own 404, which has its own answer, not a Retry.
    expect(await screen.findByText(/enter a monthly update/)).toBeTruthy()
  })

  it('holds the frame skeleton — not a bare page — while the FIRST payload is in flight', async () => {
    // A promise that never settles is the cold-load paint held still. Nothing else in this
    // file pins it: every other test lets the mount resolve, so a regression that dropped
    // the ghost layout (an empty <main> until the fan lands) would go unnoticed here.
    vi.mocked(fetchProjection).mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.page-skeleton')).not.toBeNull())
    // A pending load is not a failure, and the ghost stands INSTEAD of the real content.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryAllByTestId('echart')).toHaveLength(0)
  })

  it('renders the model warnings verbatim', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(
      projectionOut({
        warnings: ['no cashflow history — monthly contribution defaulted to 0'],
        monthly_contribution: '0.00',
      }),
    )
    renderPage()

    expect(
      await screen.findByText('no cashflow history — monthly contribution defaulted to 0'),
    ).toBeTruthy()
  })

  it('draws the net-worth history chart above the investable one, hint naming the model', async () => {
    renderPage()
    const charts = await screen.findAllByTestId('echart')
    expect(charts).toHaveLength(2)
    // DOM order IS the card order: the net-worth chart's axis starts at the history
    // (Jun 2026); the investable chart's starts at the projection t0 (Aug 2026).
    expect(charts[0].getAttribute('data-categories')).toContain('Jun 2026')
    expect(charts[1].getAttribute('data-categories')?.startsWith('Aug 2026')).toBe(true)
    expect(screen.getByText('Net worth over time (projected)')).toBeTruthy()
    expect(screen.getByText(/Second-degree polynomial best-fit/)).toBeTruthy()
  })

  it('keeps the page alive when the history fetch alone fails', async () => {
    vi.mocked(fetchTimeseries).mockRejectedValue(new ApiError('history unavailable', 500))
    renderPage()

    expect(await screen.findByText('history unavailable')).toBeTruthy()
    await loaded()
    expect(valueOf(tileFor('FI target'))).toBe('$1,500,000.00') // tiles still stand
    expect(screen.getAllByTestId('echart')).toHaveLength(1) // the investable chart
    expect(screen.queryByRole('alert')).toBeNull() // advisory note, not the page banner
  })

  it('does not refetch the history when a knob moves', async () => {
    renderPage()
    await loaded()

    typeKnob('Annual return', '6')

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchTimeseries).toHaveBeenCalledTimes(1)
  })

  it('still fits through a zero-value month — a parabola has no positivity rule', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseries({ net_worth: ['0.00', '101000.00', '102010.00'] }),
    )
    renderPage()

    expect(await screen.findByText(/Second-degree polynomial best-fit/)).toBeTruthy()
    expect(screen.getAllByTestId('echart')).toHaveLength(2)
  })

  it('draws dots alone and says why under three snapshots', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseries({
        months: ['2026-07-01', '2026-08-01'],
        net_worth: ['100000.00', '101000.00'],
        mom_pct: [null, null],
        notes: [null, null],
      }),
    )
    renderPage()

    expect(await screen.findByText(/needs at least three snapshots/)).toBeTruthy()
    expect(screen.getAllByTestId('echart')).toHaveLength(2) // the dots still chart
    // The heading a screen reader hears must not promise a curve that is NOT on the canvas.
    expect(screen.getByLabelText('Net worth history as dots, on a log scale')).toBeTruthy()
    expect(screen.queryByLabelText(/with a fitted trend/)).toBeNull()
  })

  it('gives the trend its own span chips — 10y default, 40y on demand', async () => {
    renderPage()
    const charts = await screen.findAllByTestId('echart')
    // Fixture history ends Aug 2026; the DEFAULT 10y span ends Aug 2036 — NOT the
    // knob's 30-year echo (that would read Aug 2056): the spans are decoupled.
    expect(charts[0].getAttribute('data-categories')?.endsWith('Aug 2036')).toBe(true)

    const group = screen.getByRole('group', { name: /trend span/i })
    expect(within(group).getByRole('button', { name: '10Y' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    fireEvent.click(within(group).getByRole('button', { name: '40Y' }))

    expect(
      screen.getAllByTestId('echart')[0].getAttribute('data-categories')?.endsWith('Aug 2066'),
    ).toBe(true)
    expect(fetchProjection).toHaveBeenCalledTimes(1) // a chip is a redraw, not a request
    expect(fetchTimeseries).toHaveBeenCalledTimes(1)
  })

  it('keeps the trend span fixed while the Horizon knob reshapes the chart below', async () => {
    renderPage()
    await loaded()

    typeKnob('Horizon (years)', '10')

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(
      screen.getAllByTestId('echart')[0].getAttribute('data-categories')?.endsWith('Aug 2036'),
    ).toBe(true)
  })

  it('asks for more snapshots under two history points', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseries({
        months: ['2026-08-01'],
        net_worth: ['100000.00'],
        mom_pct: [null],
        notes: [null],
      }),
    )
    renderPage()

    expect(await screen.findByText('Not enough monthly snapshots to chart yet.')).toBeTruthy()
    expect(screen.getAllByTestId('echart')).toHaveLength(1)
  })

  it('shows the three assumption echoes as placeholders like every other knob', async () => {
    renderPage()
    await loaded()

    // Placeholders, because blank now MEANS derived and says so in the URL's absence — the
    // box still names what the server actually ran (2026-09-03 spec §11).
    await waitFor(() => expect(box('Volatility').placeholder).toBe('15'))
    expect(box('Inflation').placeholder).toBe('3')
    expect(box('Contribution growth').placeholder).toBe('3')
  })

  it('leaves the assumption boxes blank when a stale backend echoes null', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(staleEchoes())
    renderPage()
    await loaded()

    // A null echo names NOTHING — no placeholder, and "not set" rather than "derived":
    // promising a default the server never applied would lie about what is on the chart.
    await waitFor(() => expect(screen.getAllByText('not set')).toHaveLength(3))
    for (const label of ['Volatility', 'Inflation', 'Contribution growth']) {
      expect(box(label).value).toBe('')
      expect(box(label).placeholder).toBe('')
    }
  })

  it('says in both hints that blank is what the server derives', async () => {
    renderPage()
    await loaded()

    expect(
      screen.getByText(/reads in today's dollars by default \(inflation is modelled\)/),
    ).toBeTruthy()
    // The knobs card's own hint rides in the ⓘ's BUBBLE: the button is named by its first
    // four words so a reader hears the sentence once (motion spec §8).
    fireEvent.click(screen.getByRole('button', { name: /^About Every knob the projection/ }))
    expect(screen.getByRole('tooltip').textContent).toMatch(
      /Blank knobs are derived from your data/,
    )
  })

  it('runs the Monte Carlo knobs shifted back to fractions', async () => {
    renderPage()
    await loaded()

    typeKnob('Volatility', '20')

    await waitFor(() =>
      expect(fetchProjection).toHaveBeenLastCalledWith(
        expect.objectContaining({ volatility: '0.2' }),
      ),
    )
  })

  it('sends a typed zero volatility — the fan’s off switch, not a refusal', async () => {
    renderPage()
    await loaded()

    typeKnob('Volatility', '0')

    // 0 is INSIDE the fence, and a typed 0 is a value, not a blank: it must reach the
    // server (where it means "run no simulation") and the URL, or a link would lose it.
    await waitFor(() =>
      expect(fetchProjection).toHaveBeenLastCalledWith(expect.objectContaining({ volatility: '0' })),
    )
    expect(url()).toContain('whatif=volatility%3A0')
  })

  it('fences volatility above 100 in the box vocabulary, spending no request', async () => {
    renderPage()
    await loaded()

    typeKnob('Volatility', '150')

    expect(screen.getByRole('alert').textContent).toBe('Volatility must be between 0% and 100%')
    expect(fetchProjection).toHaveBeenCalledTimes(1) // the derived run only
  })

  it('fences inflation and contribution growth in the same percent vocabulary', async () => {
    renderPage()
    await loaded()

    typeKnob('Inflation', '30')
    expect(screen.getByRole('alert').textContent).toBe('Inflation must be between -10% and 25%')

    typeKnob('Contribution growth', '-1') // a raise cut is not modelled
    expect(
      screen.getAllByRole('alert').map((a) => a.textContent),
    ).toContain('Contribution growth must be between 0% and 25%')

    expect(fetchProjection).toHaveBeenCalledTimes(1)
  })

  it('dashes the FI probability tile when the fan is switched off', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(fanOff())
    renderPage()
    await loaded()

    const tile = tileFor('FI probability')
    expect(valueOf(tile)).toBe('—')
    expect(deltaOf(tile)).toBeNull() // no percentile months to name
  })

  it('states the FI probability with its p10, p50 and p90 months', async () => {
    renderPage()

    await loaded()
    const tile = tileFor('FI probability')
    expect(valueOf(tile)).toBe('62.0%')
    expect(deltaOf(tile)).toBe('p10 Jan 2050 · p50 Oct 2055 · p90 Mar 2061')
  })

  it('leaves p10 out when a stale backend omits it', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(projectionOut({ fi_month_p10: null }))
    renderPage()
    await loaded()
    expect(deltaOf(tileFor('FI probability'))).toBe('p50 Oct 2055 · p90 Mar 2061')
  })

  it('draws the fan under the lines when the payload carries bands', async () => {
    renderPage()

    const charts = await screen.findAllByTestId('echart')
    // Band series FIRST (paint order), the three real lines on top of them.
    expect(seriesOf(charts[1])).toEqual([
      'mc-base',
      BAND_SERIES[0],
      BAND_SERIES[1],
      // The upper outer wash shares its half's NAME (F3), then the median hairline.
      BAND_SERIES[0],
      MEDIAN_SERIES,
      ...PROJECTION_SERIES,
    ])
  })

  it('charts the three deterministic series alone when there are no bands', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(fanOff())
    renderPage()

    const charts = await screen.findAllByTestId('echart')
    expect(seriesOf(charts[1])).toEqual([...PROJECTION_SERIES])
  })

  // The app-wide ⓘ transcription's canary (spec §5): the copy is only a deliverable if it
  // actually reaches the DOM, and this page carries both shapes — a tile label and two
  // chart-card headings. The authored words ride in aria-label, which is what a screen
  // reader hears; the bubble itself renders the same words when the hint opens.
  it('mounts both charts through ChartCard with house labels, export rows and the trend-span / axis-scale controls', async () => {
    renderPage()
    await screen.findByText('Projected investable balance')
    expect(screen.getByLabelText(/Projected investable balance over the next/)).toBeTruthy()
    expect(screen.getByLabelText(/Net worth history with a fitted trend/)).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /Export/ })).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Trend span' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Axis scale' })).toBeTruthy()
    expect(screen.getAllByText('ctrl+scroll to zoom · drag to pan')).toHaveLength(2)
  })

  it('Log flips the fan’s axis and the pick survives a recalculation', async () => {
    renderPage()
    await screen.findByText('Projected investable balance')
    const fan = () =>
      screen
        .getByLabelText(/Projected investable balance over the next/)
        .closest('.chart-card')!
        .querySelector('[data-testid="echart"]')!
    expect(fan().getAttribute('data-y-type')).toBe('value')
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    expect(fan().getAttribute('data-y-type')).toBe('log')
  })

  it('legend picks persist through an option rebuild', async () => {
    renderPage()
    await screen.findByText('Projected investable balance')
    const fan = screen
      .getByLabelText(/Projected investable balance over the next/)
      .closest('.chart-card')!
      .querySelector('[data-testid="echart"]')!
    fireEvent.mouseEnter(fan) // stands in for legendselectchanged
    fireEvent.click(screen.getByRole('button', { name: 'Log' })) // rebuilds the option
    expect(JSON.parse(fan.getAttribute('data-legend-selected')!)).toEqual({ 'Growth only': false })
  })

  it('pins the live scenario and draws it as a series on the investable chart', async () => {
    renderPage('/projection?whatif=annual_return%3A0.06')
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))

    const chart = await screen.findByLabelText(/Projected investable balance over the next/)
    await waitFor(() => expect(seriesOf(chart)).toContain('Return 6%'))
  })

  it('draws a pin stored from an earlier visit as a series on mount', async () => {
    // Personal working memory, KNOBS only (spec §4.5): the stored entries are re-run
    // against live data on arrival, so a pinned line can never show a stale figure.
    localStorage.setItem(
      pinsKey('projection'),
      JSON.stringify({
        version: PINS_VERSION,
        pins: [
          {
            id: 'p1',
            label: 'Retire Alex 2035-06',
            createdAt: '2026-09-01T00:00:00.000Z',
            entries: ['retire:2:2035-06'],
          },
        ],
      }),
    )
    renderPage()

    const chart = await screen.findByLabelText(/Projected investable balance over the next/)
    await waitFor(() => expect(seriesOf(chart)).toContain('Retire Alex 2035-06'))
    // Its own run, beside the derived one — and the URL is untouched: pins are not links.
    expect(vi.mocked(fetchProjection)).toHaveBeenCalledWith({
      retirements: [{ personId: 2, month: '2035-06' }],
    })
    expect(url()).toBe('/projection')
  })

  it('hangs a hint on the FI-target tile and on both chart headings', async () => {
    renderPage()
    await loaded()

    const fiHint = tileFor('FI target').querySelector('.stat-label button.info-hint')
    expect(fiHint?.getAttribute('aria-label')).toMatch(/^About Annual spend ÷ withdrawal/)
    expect(
      screen.getByText('Net worth over time (projected)').querySelector('button.info-hint'),
    ).toBeTruthy()
    expect(
      screen.getByText('Projected investable balance').querySelector('button.info-hint'),
    ).toBeTruthy()
  })
})

describe('ProjectionPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints tiles, both charts AND the derived knobs before any fetch resolves', () => {
    setSnapshot('projection:default', projectionOut())
    setSnapshot('projection:history', timeseries())
    // Never-resolving fetches: whatever is on screen came from the seeds alone.
    vi.mocked(fetchProjection).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchTimeseries).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(valueOf(tileFor('FI target'))).toBe('$1,500,000.00')
    // Both cards are up: the trend chart needs the history seed, the projection the other.
    expect(screen.getAllByTestId('echart')).toHaveLength(2)
    expect(screen.queryByText('Loading net-worth history…')).toBeNull()
    // The knob boxes carry the echo of the CACHED run: it seeds the sandbox's baseline.
    expect(box('Annual return').placeholder).toBe('5')
    expect(box('Volatility').placeholder).toBe('15')
    expect(box('Horizon (years)').placeholder).toBe('30')
    // A cached paint renders both charts still, and the revalidation still went out.
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
    expect(vi.mocked(fetchProjection)).toHaveBeenCalledTimes(1)
  })

  it('a changed revalidation payload updates the tiles and re-arms the charts', async () => {
    setSnapshot('projection:default', projectionOut())
    setSnapshot('projection:history', timeseries())
    vi.mocked(fetchProjection).mockResolvedValue(projectionOut({ fi_target: '2000000.00' }))
    renderPage()
    expect(valueOf(tileFor('FI target'))).toBe('$1,500,000.00')
    await waitFor(() => expect(valueOf(tileFor('FI target'))).toBe('$2,000,000.00'))
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'true'),
    ).toBe(true)
  })

  it('leaves the charts still when the revalidation payload is identical', async () => {
    setSnapshot('projection:default', projectionOut())
    setSnapshot('projection:history', timeseries())
    renderPage()
    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledTimes(1))
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })

  it('never caches a knob-driven run under the default key', async () => {
    renderPage()
    await loaded()
    const cachedDefault = getSnapshot<ProjectionOut>('projection:default')
    expect(cachedDefault).toEqual(projectionOut())
    vi.mocked(fetchProjection).mockResolvedValue(projectionOut({ fi_target: '9000000.00' }))
    typeKnob('Annual return', '7')
    await waitFor(() => expect(valueOf(tileFor('FI target'))).toBe('$9,000,000.00'))
    // The default key still holds the MOUNT run — a knob run is user-parameterized.
    expect(getSnapshot<ProjectionOut>('projection:default')).toEqual(cachedDefault)
  })
})

describe('ProjectionPage — dual-career retirements (2026-08-28 spec §4.3)', () => {
  it('offers one Retires knob per household person, blank by default', async () => {
    renderPage()
    await loaded()

    expect(box('Retires — Me').value).toBe('')
    expect(box('Retires — Alex').value).toBe('')
    // Blank is a real answer here, not a derived default: nobody retires.
    expect(screen.getByText(/Blank means that person works for the whole horizon/)).toBeTruthy()
  })

  it('renders one knob for a single-person household — same grammar, new capability', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue(household([{ id: 1, name: 'Me', is_primary: true }]))
    renderPage()
    await loaded()

    expect(box('Retires — Me')).toBeTruthy()
    expect(screen.queryByLabelText('Retires — Alex')).toBeNull()
  })

  it('renders no retirement knobs on a roster-less database', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue(household([]))
    renderPage()
    await loaded()

    expect(screen.queryByLabelText(/^Retires/)).toBeNull()
    expect(screen.queryByText(/Blank means that person works/)).toBeNull()
  })

  it('keeps the whole page alive when the household fetch alone fails', async () => {
    vi.mocked(fetchHousehold).mockRejectedValue(new ApiError('household unavailable', 500))
    renderPage()

    await loaded()
    expect(valueOf(tileFor('FI target'))).toBe('$1,500,000.00') // tiles still stand
    expect(screen.queryByLabelText(/^Retires/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull() // an affordance, never the page banner
  })

  it('sends a filled month as a retirement and leaves the blanks out', async () => {
    renderPage()
    await loaded()

    fireEvent.change(box('Retires — Alex'), { target: { value: '2035-06' } })

    await waitFor(() =>
      expect(fetchProjection).toHaveBeenLastCalledWith(
        expect.objectContaining({ retirements: [{ personId: 2, month: '2035-06' }] }),
      ),
    )
    expect(url()).toBe('/projection?whatif=retire%3A2%3A2035-06')
  })

  it('refuses a malformed month in the box vocabulary, spending no request', async () => {
    renderPage()
    await loaded()

    // A browser WITHOUT a month picker renders type="month" as a plain text box and hands
    // the typed characters straight through — that is the case this fence exists for. This
    // jsdom implements the month sanitiser (an invalid value becomes ''), so the box is
    // demoted to text here to reproduce the browser that does not.
    const monthBox = box('Retires — Alex')
    monthBox.type = 'text'
    fireEvent.change(monthBox, { target: { value: '2035-13' } })
    fireEvent.blur(monthBox) // the box's own commit point — typing is never refused mid-word

    expect(screen.getByText("Alex's retirement month must look like YYYY-MM")).toBeTruthy()
    expect(fetchProjection).toHaveBeenCalledTimes(1) // the derived run only
    expect(url()).toBe('/projection')
  })

  it('draws a dashed rule per echoed retirement, labelled by name', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(
      projectionOut({
        retirements: [
          { person_id: 2, name: 'Alex', month: '2026-09-01', monthly_drop: '2000.00' },
        ],
      }),
    )
    renderPage()

    const charts = await screen.findAllByTestId('echart')
    // [1] is the investable chart (DOM order is card order).
    expect(charts[1].getAttribute('data-marks')).toBe('Sep 2026=Alex')
    // The net-worth trend above it is untouched by retirements.
    expect(charts[0].getAttribute('data-marks')).toBe('')
  })

  it('renders the server refusal verbatim — nothing invented, nothing translated', async () => {
    renderPage()
    await loaded()
    vi.mocked(fetchProjection).mockRejectedValue(
      new ApiError('Alex has no paycheck profile in force — nothing to drop', 422),
    )

    fireEvent.change(box('Retires — Alex'), { target: { value: '2035-06' } })

    // ONE surface, and it is the knobs card's: the page's own resource is the DERIVED run,
    // whose figures are still on screen and still true. Saying it twice — and offering a
    // frame Retry that would re-send the refused scenario — is what this pins against.
    const shown = await screen.findAllByText(
      /Alex has no paycheck profile in force — nothing to drop/,
    )
    expect(shown).toHaveLength(1)
    expect(screen.getByRole('alert')).toBe(shown[0])
    expect(screen.queryByText(/Showing earlier data/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('names the approximation the drop actually is', async () => {
    renderPage()
    await loaded()

    expect(screen.getByText(/CURRENT monthly take-home/)).toBeTruthy()
    expect(screen.getByText(/Spending stays a household figure/)).toBeTruthy()
  })
})
