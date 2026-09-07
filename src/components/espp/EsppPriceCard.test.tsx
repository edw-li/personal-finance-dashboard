import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PricePoint } from '../../types/api'
import { anatomyLots, bars, esppLot, septOffering } from '../../testing/esppFixtures'
import EsppPriceCard from './EsppPriceCard'

vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel }: { option: { xAxis?: { data?: unknown[] }; series?: { name: string }[] }; ariaLabel?: string }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        // '|', not the house ',': formatDate emits "Feb 27, 2024", so a comma-joined attribute
        // cannot be split back into categories (the count assertions below double).
        'data-categories': (option.xAxis?.data ?? []).join('|'),
        'data-series': (option.series ?? []).map((s) => s.name).join('|'),
      }),
  }
})
vi.mock('../shell/PageFrame', () => ({ usePageFrame: () => ({ fromCache: false }) }))
// The chips and the footer are anchored on today; pin it a day after the last bar.
vi.mock('../../utils/months', async () => {
  const actual = await vi.importActual<typeof import('../../utils/months')>('../../utils/months')
  return { ...actual, todayIso: () => '2024-09-04' }
})

afterEach(cleanup)

/** Ten years of one bar a month — long enough that every chip stays live. */
const decade: PricePoint[] = Array.from({ length: 120 }, (_, i) => {
  const year = 2014 + Math.floor((i + 8) / 12)
  const month = ((i + 8) % 12) + 1
  return { d: `${year}-${String(month).padStart(2, '0')}-15`, c: String(50 + i) }
})

describe('EsppPriceCard', () => {
  it('titles itself after the ticker, mounts the chart on the whole fetched series, and says where the history starts', () => {
    render(<EsppPriceCard ticker="NVDA" bars={bars} offerings={[septOffering]} lots={anatomyLots} />)
    expect(screen.getByRole('heading', { name: /NVDA vs your purchases/ })).toBeTruthy()
    const chart = screen.getByTestId('echart')
    expect(chart.getAttribute('aria-label')).toBe(
      "Line chart of NVDA's daily closes against the subscription price and your average paid per share, with purchase markers",
    )
    expect(chart.getAttribute('data-categories')?.split('|').length).toBe(5)
    // Five bars answer a 3650-day request: the extent is known, so 3Y and All would refetch nothing
    // and the widest live chip (1Y) is the one pressed.
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '3Y' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'All' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/\+61\.3% over this window · history since Feb 27, 2024/)).toBeTruthy()
  })

  it('counts the lots the stored history cannot reach, on both sides and in one sentence', () => {
    // The four shared lots straddle this five-bar window: two were bought after its last bar.
    render(<EsppPriceCard ticker="NVDA" bars={bars} offerings={[septOffering]} lots={[esppLot({ purchase_date: '2023-12-01' }), ...anatomyLots]} />)
    expect(
      screen.getByText('1 lot predates the stored history and 2 postdate it — the next price refresh reaches them.'),
    ).toBeTruthy()
  })

  it('names one side alone without a dangling pronoun', () => {
    render(<EsppPriceCard ticker="NVDA" bars={bars} offerings={[septOffering]} lots={[anatomyLots[3]]} />)
    expect(screen.getByText('1 lot postdates the stored history — the next price refresh reaches it.')).toBeTruthy()
  })

  it('says nothing about reach when every lot is inside the window', () => {
    render(<EsppPriceCard ticker="NVDA" bars={bars} offerings={[septOffering]} lots={[esppLot()]} />)
    expect(screen.queryByText(/the stored history/)).toBeNull()
  })

  it('defaults to All over a long history and slices the series when a chip is pressed', () => {
    render(<EsppPriceCard ticker="NVDA" bars={decade} offerings={[septOffering]} lots={anatomyLots} />)
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('echart').getAttribute('data-categories')?.split('|').length).toBe(120)
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(screen.getByTestId('echart').getAttribute('data-categories')?.split('|').length).toBe(12)
    expect(screen.getByText(/window from/)).toBeTruthy() // a full-length window says nothing about inception
  })

  it('holds a skeleton while the bars are in flight, and names the missing ticker or history', () => {
    const { rerender } = render(<EsppPriceCard ticker="NVDA" bars={null} offerings={[]} lots={[]} />)
    expect(document.querySelector('.chart-card-skeleton')).not.toBeNull()
    rerender(<EsppPriceCard ticker="NVDA" bars={[]} offerings={[]} lots={[]} />)
    expect(screen.getByText('No stored price history for NVDA yet — run a price refresh.')).toBeTruthy()
    rerender(<EsppPriceCard ticker={null} bars={[]} offerings={[]} lots={[]} />)
    expect(screen.getByRole('heading', { name: /Employer price vs your purchases/ })).toBeTruthy()
    expect(screen.getByText('No ESPP ticker configured — set the espp_ticker setting to chart the price.')).toBeTruthy()
  })
})
