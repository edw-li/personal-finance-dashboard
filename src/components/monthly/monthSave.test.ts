import { describe, expect, it } from 'vitest'
import { buildMonthSave, type MonthSaveInput, type SaveKind } from './monthSave'

// The month-review PUT body the wizard sends (2026-09-23 spec §M1): each part's save carries its own
// leg only, the Confirm carries none, the Review carries the dirty parts — and never recorded_on.

const input = (kind: SaveKind, overrides: Partial<MonthSaveInput> = {}): MonthSaveInput => ({
  kind,
  revision: 'r'.repeat(64),
  reviewed: { balances: true, spending: false, take_home: false },
  dirty: { balances: false, flows: false },
  notBegun: false,
  balances: { notes: '', rows: [{ account_id: 1, balance: '1500.00' }] },
  spending: {
    amounts: [{ category_id: 7, amount: '250.00' }],
    netPay: '6000.00',
    hadNetPay: false,
    recordZero: false,
  },
  ...overrides,
})

describe('buildMonthSave', () => {
  it('a balances save carries the balances leg only, notes blank as null, never recorded_on', () => {
    const built = buildMonthSave(input('balances'))
    expect(built.sendBalances).toBe(true)
    expect(built.sendSpending).toBe(false)
    expect(built.body).toEqual({
      expected_revision: 'r'.repeat(64),
      reviewed: { balances: true, spending: false, take_home: false },
      close: false,
      balances: { notes: null, balances: [{ account_id: 1, balance: '1500.00' }] },
    })
    expect('recorded_on' in (built.body.balances ?? {})).toBe(false)
  })

  it('a spending save carries the spending leg only: amounts, take-home, the $0 consent', () => {
    const built = buildMonthSave(input('spending', {
      spending: { amounts: [], netPay: '', hadNetPay: false, recordZero: true },
    }))
    expect([built.sendBalances, built.sendSpending]).toEqual([false, true])
    expect('balances' in built.body).toBe(false)
    expect(built.body.spending).toEqual({ amounts: [], confirm_zero: true })
  })

  it('a blanked take-home the month had is sent as an explicit null; one it never had is left off', () => {
    const blanked = { amounts: [], netPay: '', recordZero: false }
    expect(buildMonthSave(input('spending', { spending: { ...blanked, hadNetPay: true } })).body.spending)
      .toEqual({ amounts: [], net_pay: null })
    expect('net_pay' in (buildMonthSave(input('spending', { spending: { ...blanked, hadNetPay: false } })).body.spending ?? {}))
      .toBe(false)
  })

  it('the Confirm carries no leg and ticks spending, leaving the other ticks as they stand', () => {
    const built = buildMonthSave(input('confirm-spending', { dirty: { balances: true, flows: false } }))
    expect([built.sendBalances, built.sendSpending]).toEqual([false, false])
    expect(built.body).toEqual({
      expected_revision: 'r'.repeat(64),
      reviewed: { balances: true, spending: true, take_home: false },
      close: false,
    })
  })

  it('the Review sends only the dirty parts, and close says so', () => {
    const neither = buildMonthSave(input('review'))
    expect(Object.keys(neither.body).sort()).toEqual(['close', 'expected_revision', 'reviewed'])
    const both = buildMonthSave(input('close', { dirty: { balances: true, flows: true } }))
    expect([both.sendBalances, both.sendSpending, both.body.close]).toEqual([true, true, true])
    const spendingOnly = buildMonthSave(input('review', { dirty: { balances: false, flows: true } }))
    expect([spendingOnly.sendBalances, spendingOnly.sendSpending]).toEqual([false, true])
  })

  // Spec review G1 (2026-09-23 spec §M3): a month that has not begun takes no spending. Its inputs
  // are disabled, but a restored draft or a paste could still leave the part dirty — the Review
  // must not carry it to the server.
  it('the Review never sends the spending of a month that has not begun, dirty or not', () => {
    for (const kind of ['review', 'close'] as const) {
      const built = buildMonthSave(input(kind, { dirty: { balances: true, flows: true }, notBegun: true }))
      expect([built.sendBalances, built.sendSpending]).toEqual([true, false])
      expect('spending' in built.body).toBe(false)
    }
  })
})
