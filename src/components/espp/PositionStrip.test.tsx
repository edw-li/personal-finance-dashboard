import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EsppLotsResponse, EsppModelerOut } from '../../types/api'
import PositionStrip, { STRIP_LABEL } from './PositionStrip'

afterEach(cleanup)

// The page test's own fixture figures (EsppPage.test.tsx): two held lots, two sold.
const lots: EsppLotsResponse = {
  espp_ticker: 'NVDA',
  current_price: '171.3100',
  quoted_at: '2026-08-15T20:00:00Z',
  lots: [],
  totals: {
    held: {
      lots: 2, shares: '501.0000', cost_basis: '20657.56', fmv_value: '62546.50',
      market_value: '85826.31', gain_amount: '65168.75', gain_pct: '3.154717',
      bargain_element: '41888.94', lookback_component: '38243.49', discount_component: '3645.45',
      appreciation: '23279.81', avg_paid: '41.23265',
    },
    sold: { lots: 2, shares: '529.0000', cost_basis: '21812.08', proceeds: '60740.00', gain_amount: '38927.92' },
  },
}
const unpriced: EsppLotsResponse = {
  ...lots,
  current_price: null,
  quoted_at: null,
  totals: {
    held: { ...lots.totals!.held, market_value: null, gain_amount: null, gain_pct: null, appreciation: null },
    sold: lots.totals!.sold,
  },
}
const modeler = {
  year: 2024,
  totals: { total_25k_value: '18917.13', out_of_pocket_cost: '16130.72', fmv_of_shares: '19200.00', remaining_25k: '6082.87' },
} as unknown as EsppModelerOut

const tiles = () => document.querySelectorAll('.kpi-row .stat-tile')
const ghosts = () => document.querySelectorAll('.kpi-row .stat-tile.skeleton-tile')

describe('PositionStrip', () => {
  it('ghosts the whole five-tile row while neither feed has answered', () => {
    render(<PositionStrip lots={null} lotsBusy modeler={null} modelerBusy modelerDirty={false} />)
    expect(screen.getByRole('status').textContent).toBe(STRIP_LABEL)
    expect(ghosts().length).toBe(5)
    expect(document.querySelector('.kpi-row-lone')).toBeNull()
  })

  it('paints the four lot tiles and ghosts the $25k slot until the modeler lands', () => {
    render(<PositionStrip lots={lots} lotsBusy={false} modeler={null} modelerBusy modelerDirty={false} />)
    expect(tiles().length).toBe(5)
    expect(ghosts().length).toBe(1)
    expect(screen.getByText('Market value').closest('.stat-tile')?.textContent).toContain('$85,826.31')
    expect(screen.getByText('Cost basis').closest('.stat-tile')?.textContent).toContain('$20,657.56')
    const gain = screen.getByText('Unrealized gain').closest('.stat-tile') as HTMLElement
    expect(gain.textContent).toContain('$65,168.75')
    expect(gain.textContent).toContain('+315.5%')
    expect(gain.querySelector('.stat-delta')?.className).toContain('stat-delta-positive')
    const shares = screen.getByText('Shares held').closest('.stat-tile') as HTMLElement
    expect(shares.textContent).toContain('501')
    expect(shares.textContent).toContain('2 lots')
  })

  it('paints the $25k tile and ghosts the four lot slots until the lots land', () => {
    render(<PositionStrip lots={null} lotsBusy modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    expect(ghosts().length).toBe(4)
    const tile = screen.getByText('$25k limit used — 2024').closest('.stat-tile') as HTMLElement
    expect(tile.textContent).toContain('$18,917.13')
    expect(tile.textContent).toContain('$6,082.87 left')
  })

  it('treats a lots payload without totals (a pre-batch snapshot) as not loaded yet', () => {
    render(<PositionStrip lots={{ ...lots, totals: undefined }} lotsBusy modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    expect(ghosts().length).toBe(4)
  })

  it('says "no live quote" instead of a zero when the position is unpriced', () => {
    render(<PositionStrip lots={unpriced} lotsBusy={false} modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    const value = screen.getByText('Market value').closest('.stat-tile') as HTMLElement
    expect(value.querySelector('.stat-value')?.textContent).toBe('—')
    expect(value.textContent).toContain('no live quote')
    const gain = screen.getByText('Unrealized gain').closest('.stat-tile') as HTMLElement
    expect(gain.querySelector('.stat-value')?.textContent).toBe('—')
    expect(gain.querySelector('.stat-delta')?.className).toContain('stat-delta-neutral')
    // Cost and shares never need a quote.
    expect(screen.getByText('Cost basis').closest('.stat-tile')?.textContent).toContain('$20,657.56')
  })

  it('names the missing ticker when there is none', () => {
    render(<PositionStrip lots={{ ...unpriced, espp_ticker: null }} lotsBusy={false} modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    expect(screen.getByText('Market value').closest('.stat-tile')?.textContent).toContain('no ESPP ticker configured')
  })

  it('renders nothing when both feeds failed with nothing to show — the banner speaks', () => {
    const { container } = render(<PositionStrip lots={null} lotsBusy={false} modeler={null} modelerBusy={false} modelerDirty={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('dims the row while a feed revalidates and carries the modeler dirty note', () => {
    render(<PositionStrip lots={lots} lotsBusy modeler={modeler} modelerBusy={false} modelerDirty />)
    expect(document.querySelector('.loading-dim.is-loading')).not.toBeNull()
    expect(screen.getByText(/Unsaved period edits below/).className).toBe('hint')
  })
})
