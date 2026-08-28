import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import {
  BAND_SERIES,
  PROJECTION_SERIES,
} from '../components/projection/projectionChartOptions'
import type { NetWorthTimeseries, ProjectionOut } from '../types/api'
import { clearSnapshots, getSnapshot, setSnapshot } from '../api/snapshotCache'
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
      animateEntrance = true,
    }: {
      option: { xAxis?: { data?: unknown[] }; series?: { name?: string }[] }
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        // Series names are the option capture: WHICH curves a payload puts on the chart
        // is the page's business (their geometry is pinned in the builder's own test).
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join(','),
      }),
  }
})
vi.mock('../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/netWorth')>()),
  fetchTimeseries: vi.fn(),
}))
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

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectionPage />
    </MemoryRouter>,
  )
}

// A hint's aria-label is a label (and a name) too, so the three knobs whose words the tile
// hints repeat — annual spend, withdrawal rate, horizon — are addressed by their EXACT label
// rather than a substring, and the Recalculate button by an anchored name. Same controls.
const box = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement

// A tile is addressed through its label (OverviewPage's idiom).
const tileFor = (label: string) => screen.getByText(label).closest('.stat-tile') as HTMLElement
const valueOf = (tile: HTMLElement) => tile.querySelector('.stat-value')?.textContent ?? ''
const deltaOf = (tile: HTMLElement) => tile.querySelector('.stat-delta')?.textContent ?? null
// DOM order is card order: [0] is the net-worth trend, [1] the investable chart.
const seriesOf = (chart: Element) => (chart.getAttribute('data-series') ?? '').split(',')

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchProjection).mockResolvedValue(projectionOut())
  vi.mocked(fetchTimeseries).mockResolvedValue(timeseries())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProjectionPage', () => {
  it('states the FI figures from the echo and names their derivations', async () => {
    renderPage()
    await screen.findByText('$1,500,000.00') // FI target

    expect(screen.getByText('6.7%')).toBeTruthy() // fi_ratio, formatPct 1dp
    expect(screen.getByText('$100,000.00')).toBeTruthy()
    expect(screen.getByText('as of Aug 2026')).toBeTruthy()
    expect(screen.getByText('Oct 2055')).toBeTruthy() // projected FI date
    expect(await screen.findAllByTestId('echart')).toHaveLength(2)
  })

  it('seeds the knobs from the echo, percent-shifted into the boxes vocabulary', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))
    expect(box(/monthly contribution/i).value).toBe('4000.00')
    expect(box('Annual spend').value).toBe('60000.00')
    expect(box('Withdrawal rate (%/yr)').value).toBe('4')
    expect(box('Horizon (years)').value).toBe('30')
  })

  it('recalculates with fraction-shifted knobs and hands blanks through as omissions', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/annual return/i), { target: { value: '7' } })
    fireEvent.change(box('Annual spend'), { target: { value: '' } }) // re-derive server-side
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchProjection).toHaveBeenLastCalledWith({
      annualReturn: '0.07',
      monthlyContribution: '4000.00',
      annualSpend: '',
      swr: '0.04',
      // Seeded like every other knob (2026-08-20 revision), so the echoed defaults ride
      // back out as explicit fractions; a CLEARED box is what asks for the default again.
      volatility: '0.15',
      inflation: '0.03',
      contributionGrowth: '0.03',
      years: '30',
    })
  })

  it('refuses an out-of-range withdrawal rate in the box vocabulary, spending no request', async () => {
    renderPage()
    await waitFor(() => expect(box('Withdrawal rate (%/yr)').value).toBe('4'))

    fireEvent.change(box('Withdrawal rate (%/yr)'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    expect(
      screen.getByText('Withdrawal rate % must be greater than 0 and at most 100'),
    ).toBeTruthy()
    expect(fetchProjection).toHaveBeenCalledTimes(1) // the mount load only
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
    expect(await screen.findByText('$1,500,000.00')).toBeTruthy() // tiles still stand
    expect(screen.getAllByTestId('echart')).toHaveLength(1) // the investable chart
    expect(screen.queryByRole('alert')).toBeNull() // advisory note, not the page banner
  })

  it('does not refetch the history on Recalculate', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

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
    await waitFor(() => expect(box('Horizon (years)').value).toBe('30'))

    fireEvent.change(box('Horizon (years)'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

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

  it('seeds the three assumption boxes from the echo like every other knob', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    // Filled VALUES, not placeholders (2026-08-20 user revision): the echo is the seed
    // for all eight knobs, percent-shifted — so the box always names what the server
    // actually ran.
    expect(box(/volatility/i).value).toBe('15')
    expect(box(/inflation/i).value).toBe('3')
    expect(box(/contribution growth/i).value).toBe('3')
  })

  it('leaves the assumption boxes blank when a stale backend echoes null', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(staleEchoes())
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    // A null echo names NOTHING — seeding a default the server never applied would be a
    // lie about what is on the chart.
    expect(box(/volatility/i).value).toBe('')
    expect(box(/inflation/i).value).toBe('')
    expect(box(/contribution growth/i).value).toBe('')
  })

  it('says in both hints that the defaults are what blank runs', async () => {
    renderPage()
    await screen.findByText('$1,500,000.00')

    expect(
      screen.getByText(/reads in today's dollars by default \(inflation is modelled\)/),
    ).toBeTruthy()
    expect(
      screen.getByText(/the three assumptions from their defaults \(15 \/ 3 \/ 3\)/),
    ).toBeTruthy()
  })

  it('recalculates with the Monte Carlo knobs shifted back to fractions', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/volatility/i), { target: { value: '15' } })
    fireEvent.change(box(/inflation/i), { target: { value: '3' } })
    fireEvent.change(box(/contribution growth/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        volatility: '0.15',
        inflation: '0.03',
        contributionGrowth: '0.02',
      }),
    )
  })

  it('sends a typed zero volatility — the fan’s off switch, not a refusal', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/volatility/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    // 0 is INSIDE the fence now, and a typed 0 is a value, not a blank: it must reach the
    // server, where it means "run no simulation".
    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchProjection).toHaveBeenLastCalledWith(expect.objectContaining({ volatility: '0' }))
  })

  it('fences volatility above 100 in the box vocabulary, spending no request', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/volatility/i), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    expect(screen.getByText('Volatility % must be between 0 and 100')).toBeTruthy()
    expect(fetchProjection).toHaveBeenCalledTimes(1) // the mount load only
  })

  it('fences inflation and contribution growth in the same percent vocabulary', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/inflation/i), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))
    expect(screen.getByText('Inflation % must be between -10 and 25')).toBeTruthy()

    fireEvent.change(box(/inflation/i), { target: { value: '3' } }) // deflation is legal…
    fireEvent.change(box(/contribution growth/i), { target: { value: '-1' } }) // …a raise cut is not
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))
    expect(screen.getByText('Contribution growth % must be between 0 and 25')).toBeTruthy()

    expect(fetchProjection).toHaveBeenCalledTimes(1)
  })

  it('dashes the FI probability tile when the fan is switched off', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(fanOff())
    renderPage()
    await screen.findByText('$1,500,000.00')

    const tile = tileFor('FI probability')
    expect(valueOf(tile)).toBe('—')
    expect(deltaOf(tile)).toBeNull() // no percentile months to name
  })

  it('states the FI probability with its p50 and p90 months', async () => {
    renderPage()

    await screen.findByText('$1,500,000.00')
    const tile = tileFor('FI probability')
    expect(valueOf(tile)).toBe('62.0%')
    expect(deltaOf(tile)).toBe('p50 Oct 2055 · p90 Mar 2061')
  })

  it('draws the fan under the lines when the payload carries bands', async () => {
    renderPage()

    const charts = await screen.findAllByTestId('echart')
    // Band series FIRST (paint order), the three real lines on top of them.
    expect(seriesOf(charts[1])).toEqual([
      'mc-base',
      BAND_SERIES[0],
      BAND_SERIES[1],
      `${BAND_SERIES[0]}-upper`,
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
  // reader hears and what the CSS bubble renders from data-tip.
  it('hangs a hint on the FI-target tile and on both chart headings', async () => {
    renderPage()
    await screen.findByText('$1,500,000.00')

    const fiHint = tileFor('FI target').querySelector('.stat-label button.info-hint')
    expect(fiHint?.getAttribute('aria-label')).toMatch(/^Annual spend ÷ withdrawal rate/)
    expect(
      screen.getByText('Net worth over time (projected)').querySelector('button.info-hint'),
    ).toBeTruthy()
    expect(
      screen.getByText('Projected investable balance').querySelector('button.info-hint'),
    ).toBeTruthy()
  })
})

describe('ProjectionPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints tiles, both charts AND the seeded knobs before any fetch resolves', () => {
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
    // The knob boxes carry the echo of the CACHED run, not blanks.
    expect(box(/annual return/i).value).toBe('5')
    expect(box(/volatility/i).value).toBe('15')
    expect(box('Horizon (years)').value).toBe('30')
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

  it('never caches a knob-driven recalculate under the default key', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))
    const cachedDefault = getSnapshot<ProjectionOut>('projection:default')
    expect(cachedDefault).toEqual(projectionOut())
    vi.mocked(fetchProjection).mockResolvedValue(projectionOut({ fi_target: '9000000.00' }))
    fireEvent.change(box(/annual return/i), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /^Recalculate$/ }))
    await waitFor(() => expect(valueOf(tileFor('FI target'))).toBe('$9,000,000.00'))
    // The default key still holds the MOUNT run — a knob run is user-parameterized.
    expect(getSnapshot<ProjectionOut>('projection:default')).toEqual(cachedDefault)
  })
})
