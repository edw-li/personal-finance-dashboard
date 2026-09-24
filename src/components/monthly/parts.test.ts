import { describe, expect, it } from 'vitest'
import { amountKey, balancesKey, flowsKey, sortedIds } from './parts'

const b = (value: string, notes = '', typed: number[] = []) =>
  balancesKey({ balances: { 1: value, 2: '5.00' }, notes, typedParents: typed })
const f = (value: string, netPay = '') => flowsKey({ amounts: { 7: value }, netPay })

describe('part keys (2026-09-23 spec §M1: dirty = differs from the loaded baseline)', () => {
  it('reads amounts as the numbers a save writes', () => {
    expect(b('1500')).toBe(b('1500.00'))
    expect(b('$1,500')).toBe(b('1500.00'))
    expect(b('=1000+500')).toBe(b('1500.00'))
    expect(b('1500.01')).not.toBe(b('1500.00'))
    expect(f('250')).toBe(f('250.00'))
  })

  it('one amount reads as one key however it is written — a blank is not a zero', () => {
    expect(amountKey('6000')).toBe(amountKey('$6,000.00'))
    expect(amountKey('6000')).not.toBe(amountKey('6000.01'))
    expect(amountKey('')).not.toBe(amountKey('0'))
  })

  it('keeps text that is not an amount as itself, so it stays dirty', () => {
    expect(b('abc')).not.toBe(b('0.00'))
    expect(b('')).not.toBe(b('0.00'))
  })

  it('compares notes exactly and hand-typed parents as a set', () => {
    expect(b('1', 'a')).not.toBe(b('1', 'b'))
    expect(b('1', '', [9, 8])).toBe(b('1', '', [8, 9]))
    expect(b('1', '', [8])).not.toBe(b('1', '', []))
  })

  it('keeps a blank take-home distinct from an explicit zero', () => {
    expect(f('0.00', '')).not.toBe(f('0.00', '0'))
    expect(f('0.00', '9,000')).toBe(f('0.00', '9000.00'))
    expect(f('0.00', '  ')).toBe(f('0.00', ''))
  })

  it('sorts ids ascending', () => {
    expect(sortedIds(new Set([10, 2, 7]))).toEqual([2, 7, 10])
  })
})
