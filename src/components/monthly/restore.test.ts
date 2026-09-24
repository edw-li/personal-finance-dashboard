import { describe, expect, it } from 'vitest'
import { restoreParts, type RestoreInput } from './restore'

// Restoring unsaved work at load (2026-09-23 spec §M6): each part's stored draft is laid over its
// seed when it differs from it, and dropped when it matches — one part never drags the other.

// Parent 10 sums its components 11 and 12 unless the month keeps it hand-typed.
const derive = (typed: Set<number>, record: Record<number, string>) =>
  typed.has(10)
    ? record
    : { ...record, 10: (Number(record[11] ?? 0) + Number(record[12] ?? 0)).toFixed(2) }

const input = (overrides: Partial<RestoreInput> = {}): RestoreInput => ({
  balancesSeed: { balances: { 1: '1500.00', 10: '30.00', 11: '10.00', 12: '20.00' }, notes: '', typedParents: [] },
  flowsSeed: { amounts: { 7: '0.00', 8: '2072.23' }, netPay: '', recordZero: false },
  balancesDraft: null,
  flowsDraft: null,
  accountIds: [1, 10, 11, 12],
  categoryIds: [7, 8],
  derive,
  notBegun: false,
  ...overrides,
})

describe('restoreParts', () => {
  it('with no drafts, both parts are their seeds and nothing is restored or dropped', () => {
    const out = restoreParts(input())
    expect(out.balances).toEqual(input().balancesSeed)
    expect(out.flows).toEqual({ amounts: { 7: '0.00', 8: '2072.23' }, netPay: '' })
    expect(out.restored).toEqual({ balances: false, flows: false })
    expect(out.drop).toEqual({ balances: false, flows: false })
  })

  it('restores a differing draft per field over its seed, re-deriving parents, and leaves the other part alone', () => {
    const out = restoreParts(input({ balancesDraft: { balances: { 11: '15.00' }, notes: 'late statement' } }))
    expect(out.restored).toEqual({ balances: true, flows: false })
    expect(out.balances.balances).toEqual({ 1: '1500.00', 10: '35.00', 11: '15.00', 12: '20.00' })
    expect(out.balances.notes).toBe('late statement')
    expect(out.flows.amounts).toEqual({ 7: '0.00', 8: '2072.23' })
  })

  it('drops a draft that matches its seed — a reformat is not unsaved work', () => {
    const out = restoreParts(input({ flowsDraft: { amounts: { 8: '$2,072.23' }, netPay: '' } }))
    expect(out.restored.flows).toBe(false)
    expect(out.drop.flows).toBe(true)
  })

  it('a draft may only hand hand-typed parents over, never add one back', () => {
    const seed = { balances: { 1: '1500.00', 10: '99.00', 11: '10.00', 12: '20.00' }, notes: '', typedParents: [10] }
    const out = restoreParts(input({ balancesSeed: seed, balancesDraft: { balances: { 11: '12.00' }, typedParents: [] } }))
    expect(out.balances.typedParents).toEqual([])
    expect(out.balances.balances[10]).toBe('32.00')
  })

  it('a take-home typed into a draft restores the flows part', () => {
    const out = restoreParts(input({ flowsDraft: { netPay: '6000.00' } }))
    expect(out.restored.flows).toBe(true)
    expect(out.flows).toEqual({ amounts: { 7: '0.00', 8: '2072.23' }, netPay: '6000.00' })
  })

  // Spec review G1 (2026-09-23 spec §M3): spending typed for a month that has not begun — an old
  // whole-month "Start Nov" draft, split — is not laid over the disabled boxes, where the Review
  // would send it. It waits in storage until the month begins; a copy of the seed still goes.
  it('a spending draft for a month that has not begun is neither restored nor dropped', () => {
    const waiting = restoreParts(input({ notBegun: true, flowsDraft: { amounts: { 7: '250.00' }, netPay: '6000.00' } }))
    expect(waiting.restored.flows).toBe(false)
    expect(waiting.flows).toEqual({ amounts: { 7: '0.00', 8: '2072.23' }, netPay: '' })
    expect(waiting.drop.flows).toBe(false)
    const stale = restoreParts(input({ notBegun: true, flowsDraft: { amounts: { 8: '2072.23' } } }))
    expect(stale.drop.flows).toBe(true)
  })

  it("a month that has not begun still restores its balances — they may be recorded early", () => {
    const out = restoreParts(input({ notBegun: true, balancesDraft: { balances: { 1: '1600.00' } } }))
    expect(out.restored.balances).toBe(true)
  })
})
