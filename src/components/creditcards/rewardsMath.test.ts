import { describe, expect, it } from 'vitest'
import type { RewardCategoryOut, SpendingMatrix } from '../../types/api'
import {
  effectiveRate,
  optimize,
  resolveWeight,
  suggestedAnnualSpend,
  type MathCard,
  type MathCategory,
  type MathRate,
} from './rewardsMath'

function card(id: number, name: string, over: Partial<MathCard> = {}): MathCard {
  return { id, name, annualFee: 0, pointValueCents: 1, isActive: true, countedCredits: 0, ...over }
}
function category(id: number, name: string, over: Partial<MathCategory> = {}): MathCategory {
  return { id, name, weight: 1200, pinnedCardId: null, isActive: true, ...over }
}
function rate(
  cardId: number,
  categoryId: number,
  multiplier: number,
  monthlyCap: number | null = null,
): MathRate {
  return { cardId, categoryId, multiplier, monthlyCap }
}

describe('effectiveRate', () => {
  it('crosses currencies: 2x miles at 1.7¢ beats 3x cash', () => {
    expect(effectiveRate(2, 1.7)).toBeCloseTo(0.034)
    expect(effectiveRate(3, 1)).toBeCloseTo(0.03)
    expect(effectiveRate(2, 1.7)).toBeGreaterThan(effectiveRate(3, 1))
  })
})

describe('green set and ties', () => {
  const vx = card(1, 'Venture X', { annualFee: 395, pointValueCents: 1.7 })
  const savor = card(2, 'SavorOne')
  const rh = card(3, 'RH Gold')

  it('valuation flips the raw-multiplier answer', () => {
    // Groceries: VX 2x (3.4%) vs Savor 3x (3.0%) — VX alone is green.
    const result = optimize(
      [vx, savor],
      [category(10, 'Groceries')],
      [rate(1, 10, 2), rate(2, 10, 3)],
    )
    const verdict = result.verdicts.get(10)!
    expect(verdict.bestCardIds).toEqual([1])
    expect(verdict.tie).toBe(false)
  })

  it('equal effective rates are ALL green with tie set', () => {
    // Dining: Savor 3x cash vs RH 3x cash — tie; VX absent (no cell).
    const result = optimize([vx, savor, rh], [category(11, 'Dining')], [rate(2, 11, 3), rate(3, 11, 3)])
    const verdict = result.verdicts.get(11)!
    expect(verdict.bestCardIds.sort()).toEqual([2, 3])
    expect(verdict.tie).toBe(true)
  })

  it('tie-break: lower annual fee wins the allocation', () => {
    const feeCard = card(4, 'Fee Card', { annualFee: 95 })
    const result = optimize([feeCard, savor], [category(12, 'Gas')], [rate(4, 12, 3), rate(2, 12, 3)])
    expect(result.verdicts.get(12)!.primaryCardId).toBe(2) // SavorOne, $0 fee
  })

  it('tie-break: most outright wins, then name', () => {
    // Two $0-fee cards tie on Dining; card A uniquely wins Streaming, so A takes Dining.
    const a = card(5, 'Alpha')
    const b = card(6, 'Beta')
    const result = optimize(
      [a, b],
      [category(13, 'Dining'), category(14, 'Streaming')],
      [rate(5, 13, 3), rate(6, 13, 3), rate(5, 14, 3), rate(6, 14, 1)],
    )
    expect(result.verdicts.get(13)!.primaryCardId).toBe(5)
    // And with no wins either: alphabetical.
    const bare = optimize([a, b], [category(15, 'Pets')], [rate(5, 15, 2), rate(6, 15, 2)])
    expect(bare.verdicts.get(15)!.primaryCardId).toBe(5) // 'Alpha' < 'Beta'
  })
})

describe('pins', () => {
  it('pin overrides allocation but never the green set', () => {
    const vx = card(1, 'Venture X', { pointValueCents: 1.7 })
    const savor = card(2, 'SavorOne')
    const pinned = category(20, 'Groceries', { pinnedCardId: 2 })
    const result = optimize([vx, savor], [pinned], [rate(1, 20, 2), rate(2, 20, 3)])
    const verdict = result.verdicts.get(20)!
    expect(verdict.bestCardIds).toEqual([1]) // VX 3.4% still green
    expect(verdict.primaryCardId).toBe(2) // but the pin takes the spend
    expect(verdict.allocations[0]).toEqual({ cardId: 2, amount: 1200, earnings: 1200 * 0.03 })
  })

  it('a pin to a card with no cell falls back to best', () => {
    const vx = card(1, 'Venture X')
    const savor = card(2, 'SavorOne')
    const result = optimize([vx, savor], [category(21, 'Rent', { pinnedCardId: 1 })], [rate(2, 21, 1)])
    expect(result.verdicts.get(21)!.primaryCardId).toBe(2)
  })
})

describe('caps and spillover', () => {
  it('capped winner spills overflow to the next-best card', () => {
    // Citi 5x capped $500/mo; RH 3x uncapped. Weight $8,000: 6,000 at 5% + 2,000 at 3%.
    const citi = card(7, 'Citi CC')
    const rh = card(8, 'RH Gold')
    const result = optimize(
      [citi, rh],
      [category(30, 'Gas', { weight: 8000 })],
      [rate(7, 30, 5, 500), rate(8, 30, 3)],
    )
    const verdict = result.verdicts.get(30)!
    expect(verdict.allocations).toEqual([
      { cardId: 7, amount: 6000, earnings: 300 },
      { cardId: 8, amount: 2000, earnings: 60 },
    ])
    expect(verdict.earnings).toBeCloseTo(360)
  })

  it('all cards capped: the un-earnable tail is claimed by nobody', () => {
    const citi = card(7, 'Citi CC')
    const result = optimize([citi], [category(31, 'Gas', { weight: 8000 })], [rate(7, 31, 5, 500)])
    expect(result.verdicts.get(31)!.earnings).toBeCloseTo(300) // 6k × 5%, tail earns 0
  })
})

describe('marginal value and lineup', () => {
  const vx = card(1, 'Venture X', { annualFee: 395, pointValueCents: 1.7, countedCredits: 300 })
  const savor = card(2, 'SavorOne')
  const rh = card(3, 'RH Gold')

  it('a card that only ties has $0 marginal value', () => {
    const result = optimize(
      [savor, rh],
      [category(40, 'Dining', { weight: 6000 })],
      [rate(2, 40, 3), rate(3, 40, 3)],
    )
    for (const value of result.cardValues) expect(value.marginal).toBeCloseTo(0)
  })

  it('marginal reflects the next-best fallback, cap-aware', () => {
    // Hotels $2,400: VX 10x@1.7 = 17% → 408. Without VX: Savor 5x cash → 120. Marginal 288.
    const result = optimize(
      [vx, savor],
      [category(41, 'Hotels', { weight: 2400 })],
      [rate(1, 41, 10), rate(2, 41, 5)],
    )
    const value = result.cardValues.find((v) => v.cardId === 1)!
    expect(value.marginal).toBeCloseTo(408 - 120)
    expect(value.net).toBeCloseTo(288 + 300 - 395)
  })

  it('lineupNet is total + credits − fees, not Σ net', () => {
    const result = optimize(
      [vx, savor],
      [category(42, 'Hotels', { weight: 2400 })],
      [rate(1, 42, 10), rate(2, 42, 5)],
    )
    expect(result.optimalTotal).toBeCloseTo(408)
    expect(result.lineupNet).toBeCloseTo(408 + 300 - 395)
  })

  it('inactive cards are invisible; unweighted categories keep verdicts but no $', () => {
    const dead = card(9, 'Closed', { isActive: false })
    const result = optimize(
      [savor, dead],
      [category(43, 'Dining', { weight: null })],
      [rate(2, 43, 3), rate(9, 43, 10)],
    )
    const verdict = result.verdicts.get(43)!
    expect(verdict.bestCardIds).toEqual([2])
    expect(verdict.allocations).toEqual([])
    expect(result.optimalTotal).toBe(0)
    expect(result.cardValues.map((v) => v.cardId)).toEqual([2])
  })

  it('removing a card ignores pins that pointed at it', () => {
    // Pin Groceries to VX; VX's marginal must not double-count the pin (without VX,
    // Savor catches the spend at its own rate).
    const result = optimize(
      [vx, savor],
      [category(44, 'Groceries', { weight: 1200, pinnedCardId: 1 })],
      [rate(1, 44, 2), rate(2, 44, 3)],
    )
    const value = result.cardValues.find((v) => v.cardId === 1)!
    expect(value.marginal).toBeCloseTo(1200 * 0.034 - 1200 * 0.03)
  })
})

describe('weights', () => {
  const matrix = {
    months: ['2026-01-01', '2026-02-01', '2026-03-01'],
    categories: [],
    series: [
      { category_id: 7, values: ['100.00', null, '200.00'], budgets: [null, null, null] },
      { category_id: 8, values: [null, null, null], budgets: [null, null, null] },
    ],
    totals: [],
    net_pay: [],
    savings_rate: [],
    four_pct_rule: [],
    total_budget: [],
  } as unknown as SpendingMatrix

  it('annualizes a short window and skips all-null series', () => {
    const suggested = suggestedAnnualSpend(matrix)
    expect(suggested.get(7)).toBeCloseTo((300 * 12) / 3)
    expect(suggested.has(8)).toBe(false)
  })

  it('resolveWeight: override beats suggestion beats null', () => {
    const suggested = new Map([[7, 1200]])
    const base = {
      id: 1,
      name: 'Gas',
      slug: 'gas',
      sort_order: 0,
      is_active: true,
      annual_spend: null,
      spending_category_id: null,
      pinned_card_id: null,
    } as RewardCategoryOut
    expect(
      resolveWeight({ ...base, annual_spend: '2400.00', spending_category_id: 7 }, suggested),
    ).toBe(2400)
    expect(resolveWeight({ ...base, spending_category_id: 7 }, suggested)).toBe(1200)
    expect(resolveWeight(base, suggested)).toBeNull()
  })
})
