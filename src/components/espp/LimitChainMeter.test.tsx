import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EsppModelerOut, EsppModelerPeriod } from '../../types/api'
import LimitChainMeter from './LimitChainMeter'

afterEach(cleanup)

// The page test's modeler fixture: a stored February row under the cap and a derived August
// row that hits it and refunds.
const h1 = {
  label: '1H24', over_limit: false, cost: '8370.22', refund: '0.00', carry_forward_out: '29.78', value_25k: '9847.00',
} as unknown as EsppModelerPeriod
const h2 = {
  label: 'Mar–Aug 2024', over_limit: true, cost: '7760.50', refund: '681.28', carry_forward_out: '0.00', value_25k: '9070.13',
} as unknown as EsppModelerPeriod
function modeler(over: Partial<EsppModelerOut['totals']> = {}, carry = '0.00'): EsppModelerOut {
  return {
    year: 2024,
    carry_forward: carry,
    periods: [h1, h2],
    totals: {
      total_25k_value: '18917.13', out_of_pocket_cost: '16130.72', fmv_of_shares: '19200.00', remaining_25k: '6082.87',
      total_shares: '390', total_contribution: '16812.00', total_refund: '681.28', ...over,
    },
  } as unknown as EsppModelerOut
}
// The component writes toFixed(2) percentages; the CSSOM serializes them back without their
// trailing zeros ('0.40%' reads as '0.4%'), exactly as a browser does — so these expectations
// are the ROUND-TRIPPED strings, not the source ones.
const widths = (row: Element) => [...row.querySelectorAll('.chain-seg')].map((s) => (s as HTMLElement).style.width)

describe('LimitChainMeter', () => {
  it('draws the limit row on the $25k scale: two period segments, the track and the tick at $25,000', () => {
    render(<LimitChainMeter data={modeler()} />)
    const [limit] = screen.getAllByRole('meter')
    expect(limit.getAttribute('aria-valuemin')).toBe('0')
    expect(limit.getAttribute('aria-valuemax')).toBe('25000')
    expect(limit.getAttribute('aria-valuenow')).toBe('18917.13')
    expect(limit.getAttribute('aria-valuetext')).toBe('$18,917.13 of $25,000.00 used')
    expect(widths(limit)).toEqual(['39.39%', '36.28%']) // 9847 / 25000, 9070.13 / 25000
    expect((limit.querySelector('.chain-track') as HTMLElement).style.width).toBe('100%')
    expect((limit.querySelector('.chain-tick') as HTMLElement).style.left).toBe('100%')
    expect(screen.getByText('$18,917.13 used · $6,082.87 left')).toBeTruthy()
  })

  it('draws the contributions row on the SAME scale: cost per period, then the refund', () => {
    render(<LimitChainMeter data={modeler()} />)
    const [, cash] = screen.getAllByRole('meter')
    expect(cash.getAttribute('aria-valuemax')).toBe('25000')
    expect(cash.getAttribute('aria-valuenow')).toBe('16812')
    expect(cash.getAttribute('aria-valuetext')).toBe('$16,812.00 contributed; $16,130.72 bought shares; $681.28 refunded')
    expect(widths(cash)).toEqual(['33.48%', '31.04%', '2.73%']) // 8370.22, 7760.50, 681.28 / 25000
    expect(screen.getByText('$16,812.00 contributed · $681.28 refunded')).toBeTruthy()
  })

  it('grows the shared scale past $25k when contributions exceed it, and the track ends short', () => {
    render(<LimitChainMeter data={modeler({ total_contribution: '30000.00', total_refund: '0.00' })} />)
    const [limit, cash] = screen.getAllByRole('meter')
    expect(cash.getAttribute('aria-valuemax')).toBe('30000')
    expect((limit.querySelector('.chain-track') as HTMLElement).style.width).toBe('83.33%')
    expect((limit.querySelector('.chain-tick') as HTMLElement).style.left).toBe('83.33%')
    expect(widths(limit)).toEqual(['32.82%', '30.23%']) // 9847 / 30000, 9070.13 / 30000
    expect(widths(cash)).toEqual(['27.9%', '25.87%']) // no refund segment at $0
  })

  it('leads the contributions row with the carry-in and says what carries forward', () => {
    const data = modeler({}, '100.00')
    data.periods = [h1, { ...h2, over_limit: false, refund: '0.00', carry_forward_out: '45.10' }]
    data.totals = { ...data.totals, total_refund: '0.00' }
    render(<LimitChainMeter data={data} />)
    const [, cash] = screen.getAllByRole('meter')
    expect(cash.querySelector('.chain-seg')?.className).toContain('is-carry')
    expect(widths(cash)[0]).toBe('0.4%') // 100 / 25000
    expect(screen.getByText('$16,812.00 contributed · $45.10 carries forward')).toBeTruthy()
  })

  it('names every capped period in the advisory register', () => {
    render(<LimitChainMeter data={modeler()} />)
    const note = screen.getByText('Cap reached in Mar–Aug 2024 — $681.28 refunded.')
    expect(note.className).toContain('espp-warning')
  })

  it('draws the legend with the period labels, the refund and the remaining track', () => {
    render(<LimitChainMeter data={modeler()} />)
    const legend = document.querySelector('.chain-legend') as HTMLElement
    expect(legend.textContent).toContain('1H24')
    expect(legend.textContent).toContain('Mar–Aug 2024')
    expect(legend.textContent).toContain('Refunded')
    expect(legend.textContent).toContain('Remaining')
  })

  it('draws the limit row alone when a pre-batch payload carries no contribution totals', () => {
    const stale = modeler()
    delete (stale.totals as Partial<EsppModelerOut['totals']>).total_contribution
    delete (stale.totals as Partial<EsppModelerOut['totals']>).total_refund
    render(<LimitChainMeter data={stale} />)
    expect(screen.getAllByRole('meter').length).toBe(1)
    expect(document.querySelector('.chain-legend')?.textContent).not.toContain('Refunded')
  })
})
