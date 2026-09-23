import { describe, expect, it } from 'vitest'
import type { CreditCardOut } from '../../types/api'
import { closingEffect } from './closingEffect'

// What closing a card would change (2026-09-23 spec §B6): the total credit line, and — when
// every card's balance is known — household utilization, the same balances over a smaller line.

function card(id: number, limit: string | null, accountId: number | null): CreditCardOut {
  return {
    id, name: `Card ${id}`, slug: `card-${id}`, annual_fee: '0.00', rewards_currency: 'cash',
    point_value_cents: '1.0000', primary_holder: null, authorized_users: null, opened_on: null,
    is_active: true, account_id: accountId, person_id: 1, notes: null, sort_order: id,
    credits: [], current_limit: limit, limit_events: [],
  }
}

// Production's lineup, 2026-09-23: $115,350 of line across six limited cards (Costco has none).
const LINEUP = [
  card(1, '33000.00', 47),
  card(2, '40000.00', 48),
  card(3, '10000.00', 50),
  card(4, '7600.00', 46),
  card(5, '8000.00', 49),
  card(6, '16750.00', 51),
  card(7, null, 54),
]
const BALANCES = {
  month: '2026-10-01',
  // Liabilities are stored negative; utilization reads the magnitude.
  byAccount: new Map([
    [47, -120],
    [48, -0],
    [50, -1793.12],
    [46, -2888.4],
    [49, 0],
    [51, -60.48],
    [54, -44],
  ]),
}

describe('closingEffect', () => {
  it('takes the card’s limit out of the total line', () => {
    const effect = closingEffect(LINEUP[3], LINEUP, null)
    expect(effect.lineBefore).toBe(115350)
    expect(effect.lineAfter).toBe(107750)
    expect(effect.cardLimit).toBe(7600)
    expect(effect.utilization).toBeNull()
  })

  it('prices utilization as the same balances over the smaller line', () => {
    const effect = closingEffect(LINEUP[3], LINEUP, BALANCES)
    const total = 120 + 1793.12 + 2888.4 + 60.48
    expect(effect.utilization?.month).toBe('2026-10-01')
    expect(effect.utilization?.before).toBeCloseTo(total / 115350, 10)
    expect(effect.utilization?.after).toBeCloseTo(total / 107750, 10)
    expect(effect.utilization!.after!).toBeGreaterThan(effect.utilization!.before)
  })

  it('moves nothing for a card with no recorded limit', () => {
    const effect = closingEffect(LINEUP[6], LINEUP, BALANCES)
    expect(effect.cardLimit).toBeNull()
    expect(effect.lineAfter).toBe(effect.lineBefore)
  })

  it('leaves utilization out when any limited card’s balance is unknown', () => {
    const unlinked = LINEUP.map((c) => (c.id === 5 ? { ...c, account_id: null } : c))
    expect(closingEffect(unlinked[3], unlinked, BALANCES).utilization).toBeNull()
    const missing = { month: '2026-10-01', byAccount: new Map([...BALANCES.byAccount].filter(([id]) => id !== 51)) }
    expect(closingEffect(LINEUP[3], LINEUP, missing).utilization).toBeNull()
  })

  it('has no utilization after closing the only limited card — no line is left to use', () => {
    const lone = [card(1, '5000.00', 47)]
    const effect = closingEffect(lone[0], lone, { month: '2026-10-01', byAccount: new Map([[47, -500]]) })
    expect(effect.lineAfter).toBe(0)
    expect(effect.utilization).toEqual({ before: 0.1, after: null, month: '2026-10-01' })
  })

  it('ignores a zero limit the way the page’s total line does', () => {
    const zero = [...LINEUP, card(8, '0.00', null)]
    expect(closingEffect(zero[3], zero, BALANCES).utilization).not.toBeNull()
    expect(closingEffect(zero[3], zero, BALANCES).lineBefore).toBe(115350)
  })
})
