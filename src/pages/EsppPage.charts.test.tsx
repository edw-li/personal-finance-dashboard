import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnapshots } from '../api/snapshotCache'
import { bars, esppLotsResponse, septOffering } from '../testing/esppFixtures'
import EsppPage from './EsppPage'

vi.mock('../api/espp', () => ({
  fetchLots: vi.fn(), createLot: vi.fn(), updateLot: vi.fn(), deleteLot: vi.fn(),
  fetchOfferings: vi.fn(), createOffering: vi.fn(), updateOffering: vi.fn(), deleteOffering: vi.fn(),
  createPeriod: vi.fn(), updatePeriod: vi.fn(), deletePeriod: vi.fn(), fetchModeler: vi.fn(),
}))
vi.mock('../api/prices', () => ({ fetchPriceHistory: vi.fn() }))
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel, onHover, onHoverEnd, onClick }: {
      option: { xAxis?: { data?: unknown[] }; series?: { name: string }[] }
      ariaLabel?: string
      onHover?: (p: { dataIndex: number }) => void
      onHoverEnd?: () => void
      onClick?: (p: { dataIndex: number }) => void
    }) =>
      createElement(
        'div',
        // '|' joins the categories: formatDate emits "Feb 27, 2024", so a comma-joined attribute
        // could not be split back into them.
        { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-categories': (option.xAxis?.data ?? []).join('|'), 'data-series': (option.series ?? []).map((s) => s.name).join('|') },
        createElement('button', { type: 'button', onClick: () => onHover?.({ dataIndex: 0 }) }, `${ariaLabel}::hover-0`),
        createElement('button', { type: 'button', onClick: () => onHoverEnd?.() }, `${ariaLabel}::hover-end`),
        createElement('button', { type: 'button', onClick: () => onClick?.({ dataIndex: 0 }) }, `${ariaLabel}::click-0`),
      ),
  }
})
import { fetchLots, fetchModeler, fetchOfferings } from '../api/espp'
import { fetchPriceHistory } from '../api/prices'

const renderPage = () => render(<EsppPage />, { wrapper: MemoryRouter })
const anatomyAria = "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view"

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchLots).mockResolvedValue(esppLotsResponse())
  vi.mocked(fetchOfferings).mockResolvedValue([septOffering])
  // The modeler is Lane 2's concern; a rejected feed keeps its card out of these tests' way.
  vi.mocked(fetchModeler).mockRejectedValue(new Error('not under test'))
  vi.mocked(fetchPriceHistory).mockResolvedValue({ ticker: 'NVDA', points: bars })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EsppPage — the two chart cards', () => {
  it('mounts both chart cards in Summary and keeps Lots in its own task view', async () => {
    renderPage()
    await screen.findByLabelText(anatomyAria)
    const grid = document.querySelector('.card-grid') as HTMLElement
    expect(grid).not.toBeNull()
    const cards = grid.querySelectorAll('.chart-card')
    expect(cards.length).toBe(2)
    expect(cards[0].className).toContain('span-6')
    expect(cards[1].className).toContain('span-6')
    expect(screen.getByLabelText(anatomyAria)).toBeTruthy()
    expect(await screen.findByLabelText(/Line chart of NVDA's daily closes/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^Lots/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Lots' }))
    expect(await screen.findByRole('heading', { name: /^Lots/ })).toBeTruthy()
  })

  it('fetches ten years of bars once and hands them to the price card', async () => {
    renderPage()
    await screen.findByLabelText(/Line chart of NVDA's daily closes/)
    expect(vi.mocked(fetchPriceHistory)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchPriceHistory)).toHaveBeenCalledWith('NVDA', 3650)
    expect(screen.getByLabelText(/Line chart of NVDA's daily closes/).getAttribute('data-categories')?.split('|').length).toBe(5)
  })

  it('pins a lot without replacing the chart and opens its exact record on request', async () => {
    renderPage()
    const canvas = await screen.findByLabelText(anatomyAria)
    fireEvent.click(screen.getByText(`${anatomyAria}::click-0`))
    expect(screen.getByLabelText(anatomyAria)).toBe(canvas)
    expect(screen.queryByRole('heading', { name: /^Lots/ })).toBeNull()
    const source = screen.getByRole('link', { name: 'Open lot records' })
    expect(source.getAttribute('href')).toBe('/espp?section=lots&lot=1')
    fireEvent.click(source)
    expect(await screen.findByRole('heading', { name: /^Lots/ })).toBeTruthy()
    await waitFor(() => expect(document.getElementById('lot-row-1')?.className).toContain('is-highlighted'))
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    expect(screen.getByLabelText(anatomyAria)).toBe(canvas)
  })

  it('shows the price card’s empty sentence when the bars fetch fails, never a skeleton forever', async () => {
    vi.mocked(fetchPriceHistory).mockRejectedValue(new Error('offline'))
    renderPage()
    expect(await screen.findByText('No stored price history for NVDA yet — run a price refresh.')).toBeTruthy()
  })

  it('names the missing ticker on the price card without ever fetching bars', async () => {
    vi.mocked(fetchLots).mockResolvedValue(esppLotsResponse({ espp_ticker: null, current_price: null, quoted_at: null }))
    renderPage()
    expect(await screen.findByText('No ESPP ticker configured — set the espp_ticker setting to chart the price.')).toBeTruthy()
    await act(async () => {})
    expect(vi.mocked(fetchPriceHistory)).not.toHaveBeenCalled()
    await waitFor(() => expect(document.querySelector('.chart-card-skeleton')).toBeNull())
  })
})
