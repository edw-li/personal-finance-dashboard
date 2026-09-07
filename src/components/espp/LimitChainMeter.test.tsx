import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EsppModelerOut, EsppModelerPeriod } from '../../types/api'
import LimitChainMeter from './LimitChainMeter'

afterEach(cleanup)

// The page test's modeler fixture: a stored February row under the cap and a derived August
// row that hits it and refunds.
const h1 = {
  label: '1H24', over_limit: false, shares: '203', subscription_price: '48.50900', purchase_price: '41.23265',
  contribution: '8400.00', available: '8400.00', unused_25k: '25000.00', max_shares_25k: '515',
  cost: '8370.22', refund: '0.00', carry_forward_out: '29.78', value_25k: '9847.00',
} as unknown as EsppModelerPeriod
const h2 = {
  label: 'Mar–Aug 2024', over_limit: true, shares: '187', subscription_price: '48.50900', purchase_price: '41.50000',
  contribution: '8412.00', available: '8441.78', unused_25k: '15153.00', max_shares_25k: '187',
  cost: '7760.50', refund: '681.28', carry_forward_out: '0.00', value_25k: '9070.13',
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
/** The tip's lines, one per span — the tooltip's textContent runs them together. */
const tipLines = () => [...screen.getByRole('tooltip').querySelectorAll('span')].map((s) => s.textContent)
const part = (row: Element, key: string) => row.querySelector(`[data-part="${key}"]`) as HTMLElement

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
    // The legend names the first segment too, in the order the row draws it.
    const chips = [...(document.querySelector('.chain-legend') as HTMLElement).children]
    expect(chips[0].textContent).toBe('Carried in')
    expect(chips[0].querySelector('.chain-swatch')?.className).toContain('is-carry')
    // …and its hover says where the money came from.
    fireEvent.mouseOver(part(cash, 'carry'))
    expect(tipLines()).toEqual(["Carried in $100.00 — last year's unspent cash"])
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

  // mouseOver/mouseOut, NOT mouseEnter/mouseLeave: React synthesizes onMouseEnter from the
  // bubbling pair, so a dispatched `mouseenter` reaches no handler (PacePanel.test.tsx's note).
  describe('hover and focus (the pace meter grammar)', () => {
    it('tells the limit row’s parts apart: each period, the remaining track and the $25k tick', () => {
      render(<LimitChainMeter data={modeler()} />)
      const [limit] = screen.getAllByRole('meter')
      expect(screen.queryByRole('tooltip')).toBeNull()

      fireEvent.mouseOver(part(limit, 'limit-0'))
      expect(tipLines()).toEqual([
        '1H24 — $9,847.00 of the limit',
        '203 sh × $48.51 subscription price',
        '$25,000.00 of limit was left at the start',
      ])
      expect(part(limit, 'limit-0').className).toContain('is-hot')
      expect(part(limit, 'limit-1').className).not.toContain('is-hot')

      fireEvent.mouseOver(part(limit, 'limit-1'))
      expect(tipLines()).toEqual([
        'Mar–Aug 2024 — $9,070.13 of the limit',
        '187 sh × $48.51 subscription price',
        'Cap reached — capped at 187 sh; $15,153.00 of limit was left at the start',
      ])
      expect(part(limit, 'limit-1').className).toContain('is-hot')
      expect(part(limit, 'limit-0').className).not.toContain('is-hot')

      // The empty stretch of the track is the REMAINING limit — it does have something to say.
      fireEvent.mouseOver(part(limit, 'remaining'))
      expect(tipLines()).toEqual(['Remaining $6,082.87 of the $25,000.00 limit'])
      expect(part(limit, 'remaining').className).toContain('is-hot')

      fireEvent.mouseOver(part(limit, 'tick'))
      expect(tipLines()).toEqual(['The $25,000.00 §423 limit — shares counted at the subscription price'])
      expect(part(limit, 'tick').className).toContain('is-hot')

      fireEvent.mouseOut(limit)
      expect(screen.queryByRole('tooltip')).toBeNull()
      expect(limit.querySelector('.is-hot')).toBeNull()
    })

    it('tells the cash row’s parts apart: what each period bought, what carried, what came back', () => {
      render(<LimitChainMeter data={modeler()} />)
      const [, cash] = screen.getAllByRole('meter')

      fireEvent.mouseOver(part(cash, 'cash-0'))
      expect(tipLines()).toEqual([
        '1H24 — $8,370.22 bought 203 sh at $41.23',
        'Contribution $8,400.00',
        '$29.78 carries into the next period',
      ])

      fireEvent.mouseOver(part(cash, 'cash-1'))
      expect(tipLines()).toEqual([
        'Mar–Aug 2024 — $7,760.50 bought 187 sh at $41.50',
        'Contribution $8,412.00 · $8,441.78 available with the carry-in',
        '$681.28 refunded — cap reached',
      ])

      fireEvent.mouseOver(part(cash, 'refund'))
      expect(tipLines()).toEqual(['Refunded $681.28 — cash the cap sent back'])
      expect(part(cash, 'refund').className).toContain('is-hot')

      // The cash row has no track: its empty stretch says nothing.
      fireEvent.mouseOver(cash)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('lists each refunding period when more than one refunded', () => {
      const data = modeler({ total_refund: '781.28' })
      data.periods = [{ ...h1, over_limit: true, refund: '100.00', carry_forward_out: '0.00' }, h2]
      render(<LimitChainMeter data={data} />)
      const [, cash] = screen.getAllByRole('meter')
      fireEvent.mouseOver(part(cash, 'refund'))
      expect(tipLines()).toEqual([
        'Refunded $781.28 — cash the cap sent back',
        '1H24: $100.00',
        'Mar–Aug 2024: $681.28',
      ])
    })

    it('shows every part’s headline at once on focus, and puts it away on Escape or blur', () => {
      render(<LimitChainMeter data={modeler()} />)
      const [limit, cash] = screen.getAllByRole('meter')
      expect(limit.getAttribute('tabindex')).toBe('0')

      fireEvent.focus(limit)
      expect(tipLines()).toEqual([
        '1H24 — $9,847.00 of the limit',
        'Mar–Aug 2024 — $9,070.13 of the limit',
        'Remaining $6,082.87 of the $25,000.00 limit',
      ])
      expect(limit.querySelector('.is-hot')).toBeNull() // focus lights nothing: it is over no part
      fireEvent.keyDown(limit, { key: 'Escape' })
      expect(screen.queryByRole('tooltip')).toBeNull()

      fireEvent.focus(cash)
      expect(tipLines()).toEqual([
        '1H24 — $8,370.22 bought 203 sh at $41.23',
        'Mar–Aug 2024 — $7,760.50 bought 187 sh at $41.50',
        'Refunded $681.28 — cash the cap sent back',
      ])
      fireEvent.blur(cash)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('opens the tip at the pointer, follows it, and clamps it to the bar', () => {
      render(<LimitChainMeter data={modeler()} />)
      const [limit] = screen.getAllByRole('meter')
      // jsdom measures nothing, so the bar is given a rect: 200px wide, starting at x=100.
      limit.getBoundingClientRect = () =>
        ({ left: 100, right: 300, width: 200, top: 0, bottom: 14, height: 14, x: 100, y: 0 }) as DOMRect
      const seg = part(limit, 'limit-0')

      fireEvent.mouseOver(seg, { clientX: 150 })
      expect((screen.getByRole('tooltip') as HTMLElement).style.left).toBe('25%')
      fireEvent.mouseMove(seg, { clientX: 180 })
      expect((screen.getByRole('tooltip') as HTMLElement).style.left).toBe('40%')
      fireEvent.mouseMove(seg, { clientX: 90 })
      expect((screen.getByRole('tooltip') as HTMLElement).style.left).toBe('2%')
      fireEvent.mouseMove(seg, { clientX: 400 })
      expect((screen.getByRole('tooltip') as HTMLElement).style.left).toBe('98%')

      fireEvent.focus(limit)
      expect((screen.getByRole('tooltip') as HTMLElement).style.left).toBe('50%')
    })
  })
})
