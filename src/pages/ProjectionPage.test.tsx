import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import {
  BAND_SERIES,
  PROJECTION_SERIES,
} from '../components/projection/projectionChartOptions'
import type { NetWorthTimeseries, ProjectionOut } from '../types/api'
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
    }: {
      option: { xAxis?: { data?: unknown[] }; series?: { name?: string }[] }
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
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
    // Deterministic by default — the Monte Carlo block is null until a volatility is sent.
    volatility: null,
    inflation: null,
    contribution_growth: null,
    bands: null,
    fi_probability: null,
    fi_month_p10: null,
    fi_month_p50: null,
    fi_month_p90: null,
    ...over,
  }
}

// The same payload with the simulation in play — three months of hand-made percentiles.
function simulated(over: Partial<ProjectionOut> = {}): ProjectionOut {
  return projectionOut({
    volatility: '0.150000',
    inflation: '0.030000',
    contribution_growth: '0.020000',
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
    ...over,
  })
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

const box = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement

// A tile is addressed through its label (OverviewPage's idiom).
const tileFor = (label: string) => screen.getByText(label).closest('.stat-tile') as HTMLElement
const valueOf = (tile: HTMLElement) => tile.querySelector('.stat-value')?.textContent ?? ''
const deltaOf = (tile: HTMLElement) => tile.querySelector('.stat-delta')?.textContent ?? null
// DOM order is card order: [0] is the net-worth trend, [1] the investable chart.
const seriesOf = (chart: Element) => (chart.getAttribute('data-series') ?? '').split(',')

beforeEach(() => {
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
    expect(box(/annual spend/i).value).toBe('60000.00')
    expect(box(/withdrawal rate/i).value).toBe('4')
    expect(box(/horizon/i).value).toBe('30')
  })

  it('recalculates with fraction-shifted knobs and hands blanks through as omissions', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/annual return/i), { target: { value: '7' } })
    fireEvent.change(box(/annual spend/i), { target: { value: '' } }) // re-derive server-side
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchProjection).toHaveBeenLastCalledWith({
      annualReturn: '0.07',
      monthlyContribution: '4000.00',
      annualSpend: '',
      swr: '0.04',
      // Never sent as zeros: blank is "no simulation", and the client omits blanks.
      volatility: '',
      inflation: '',
      contributionGrowth: '',
      years: '30',
    })
  })

  it('refuses an out-of-range withdrawal rate in the box vocabulary, spending no request', async () => {
    renderPage()
    await waitFor(() => expect(box(/withdrawal rate/i).value).toBe('4'))

    fireEvent.change(box(/withdrawal rate/i), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))

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

    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))

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
    await waitFor(() => expect(box(/horizon/i).value).toBe('30'))

    fireEvent.change(box(/horizon/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))

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

  it('leaves the three Monte Carlo boxes blank when their echoes are null', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    // A null echo seeds NOTHING — a zero here would read as "0% volatility, simulated",
    // which is the opposite of "no simulation was run".
    expect(box(/volatility/i).value).toBe('')
    expect(box(/inflation/i).value).toBe('')
    expect(box(/contribution growth/i).value).toBe('')
  })

  it('seeds the Monte Carlo boxes from a simulated echo, percent-shifted', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(simulated())
    renderPage()

    await waitFor(() => expect(box(/volatility/i).value).toBe('15'))
    expect(box(/inflation/i).value).toBe('3')
    expect(box(/contribution growth/i).value).toBe('2')
  })

  it('recalculates with the Monte Carlo knobs shifted back to fractions', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/volatility/i), { target: { value: '15' } })
    fireEvent.change(box(/inflation/i), { target: { value: '3' } })
    fireEvent.change(box(/contribution growth/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        volatility: '0.15',
        inflation: '0.03',
        contributionGrowth: '0.02',
      }),
    )
  })

  it('refuses a zero volatility in the box vocabulary, spending no request', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/volatility/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))

    expect(screen.getByText('Volatility % must be greater than 0 and at most 100')).toBeTruthy()
    expect(fetchProjection).toHaveBeenCalledTimes(1) // the mount load only
  })

  it('fences inflation and contribution growth in the same percent vocabulary', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box(/inflation/i), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))
    expect(screen.getByText('Inflation % must be between -10 and 25')).toBeTruthy()

    fireEvent.change(box(/inflation/i), { target: { value: '3' } }) // deflation is legal…
    fireEvent.change(box(/contribution growth/i), { target: { value: '-1' } }) // …a raise cut is not
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))
    expect(screen.getByText('Contribution growth % must be between 0 and 25')).toBeTruthy()

    expect(fetchProjection).toHaveBeenCalledTimes(1)
  })

  it('dashes the FI probability tile until a volatility is in play', async () => {
    renderPage()
    await screen.findByText('$1,500,000.00')

    const tile = tileFor('FI probability')
    expect(valueOf(tile)).toBe('—')
    expect(deltaOf(tile)).toBeNull() // no percentile months to name
  })

  it('states the FI probability with its p50 and p90 months', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(simulated())
    renderPage()

    await screen.findByText('$1,500,000.00')
    const tile = tileFor('FI probability')
    expect(valueOf(tile)).toBe('62.0%')
    expect(deltaOf(tile)).toBe('p50 Oct 2055 · p90 Mar 2061')
  })

  it('draws the fan under the lines when the payload carries bands', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(simulated())
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
    renderPage()

    const charts = await screen.findAllByTestId('echart')
    expect(seriesOf(charts[1])).toEqual([...PROJECTION_SERIES])
  })
})
