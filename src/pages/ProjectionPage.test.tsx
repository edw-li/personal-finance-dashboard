import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { ProjectionOut } from '../types/api'
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
    default: ({ option }: { option: { xAxis?: { data?: unknown[] } } }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
      }),
  }
})
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

beforeEach(() => {
  vi.mocked(fetchProjection).mockResolvedValue(projectionOut())
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
    expect(await screen.findByTestId('echart')).toBeTruthy()
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
})
