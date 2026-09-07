import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { esppLot, esppLotsResponse } from '../../testing/esppFixtures'
import LotAnatomyCard, { ANATOMY_ARIA } from './LotAnatomyCard'

vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel, onHover, onHoverEnd, onClick }: {
      option: { series?: { name: string }[] }
      ariaLabel?: string
      onHover?: (p: { dataIndex: number }) => void
      onHoverEnd?: () => void
      onClick?: (p: { dataIndex: number }) => void
    }) =>
      createElement(
        'div',
        { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-series': (option.series ?? []).map((s) => s.name).join('|') },
        createElement('button', { type: 'button', onClick: () => onHover?.({ dataIndex: 1 }) }, 'hover-1'),
        createElement('button', { type: 'button', onClick: () => onHoverEnd?.() }, 'hover-end'),
        createElement('button', { type: 'button', onClick: () => onClick?.({ dataIndex: 3 }) }, 'click-3'),
      ),
  }
})
// ChartCard reads the frame context; outside a PageFrame it is `fromCache: false`.
vi.mock('../shell/PageFrame', () => ({ usePageFrame: () => ({ fromCache: false }) }))

afterEach(cleanup)

describe('LotAnatomyCard', () => {
  it('mounts the Dollars view through ChartCard with the house sentence, the toggle and the footer', () => {
    render(<LotAnatomyCard data={esppLotsResponse()} />)
    expect(screen.getByRole('heading', { name: /Lot anatomy/ })).toBeTruthy()
    const chart = screen.getByTestId('echart')
    expect(chart.getAttribute('aria-label')).toBe(ANATOMY_ARIA)
    expect(chart.getAttribute('data-series')).toBe('Paid|Bargain element|Appreciation|loss-base|Below purchase FMV')
    expect(screen.getByRole('button', { name: 'Dollars' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/NVDA · \$171\.31 · as of Aug 15, 2026 · Hollow = sold/)).toBeTruthy()
    expect(
      screen.getByText('Of the $41,888.94 bargain element across your held lots, $3,645.45 was the plan discount and $38,243.49 the lookback.'),
    ).toBeTruthy()
  })

  it('switches to the per-share series on the toggle', () => {
    render(<LotAnatomyCard data={esppLotsResponse()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Per share' }))
    expect(screen.getByTestId('echart').getAttribute('data-series')).toBe(
      'ladder-base|Bargain element|Appreciation|loss-base|Below purchase FMV|Paid|Price|Subscription price|Current quote',
    )
    expect(screen.getByRole('button', { name: 'Per share' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reports the hovered and clicked lot by id, in chain order', () => {
    const onHoverLot = vi.fn()
    const onSelectLot = vi.fn()
    render(<LotAnatomyCard data={esppLotsResponse()} onHoverLot={onHoverLot} onSelectLot={onSelectLot} />)
    fireEvent.click(screen.getByText('hover-1'))
    expect(onHoverLot).toHaveBeenLastCalledWith(2) // the Aug 2024 lot is second in the chain
    fireEvent.click(screen.getByText('hover-end'))
    expect(onHoverLot).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByText('click-3'))
    expect(onSelectLot).toHaveBeenCalledWith(4)
  })

  it('shows the empty sentence with no lots, and a skeleton on a pre-batch payload', () => {
    const { rerender } = render(<LotAnatomyCard data={esppLotsResponse({ lots: [], totals: undefined })} />)
    expect(screen.getByText('No lots yet — add your first purchase in the Lots card below.')).toBeTruthy()
    const stale = { ...esppLot() } as Record<string, unknown>
    delete stale.fmv_value
    rerender(<LotAnatomyCard data={esppLotsResponse({ lots: [stale as unknown as ReturnType<typeof esppLot>], totals: undefined })} />)
    expect(document.querySelector('.chart-card-skeleton')).not.toBeNull()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('states the missing quote in the footer and drops the Hollow clause with nothing sold', () => {
    render(
      <LotAnatomyCard
        data={esppLotsResponse({
          current_price: null,
          quoted_at: null,
          lots: [esppLot({ market_value: null, gain_amount: null, gain_pct: null, appreciation: null })],
          totals: {
            ...esppLotsResponse().totals!,
            sold: { lots: 0, shares: '0.0000', cost_basis: '0.00', proceeds: '0.00', gain_amount: '0.00' },
          },
        })}
      />,
    )
    expect(screen.getByText('NVDA — no live quote; unsold lots are unpriced.')).toBeTruthy()
    expect(screen.queryByText(/Hollow = sold/)).toBeNull()
  })
})
