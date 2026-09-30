import { describe, expect, it } from 'vitest'
import { canonicalTakeHome, takeHomeStatus } from './takeHome'
import { flowsKey } from './parts'

describe('individual take-home', () => {
  it('sums each rounded amount in cents, including formatted amounts and expressions', () => {
    expect(takeHomeStatus({ 1: '0.105', 2: '0.105' }, [1, 2]).total).toBe('0.22')
    expect(takeHomeStatus({ 1: '$1,234.56', 2: '=1000+0.10' }, [1, 2]))
      .toEqual({ total: '2234.66', valid: true, missing: [] })
    expect(canonicalTakeHome({ 1: '0.105', 2: '$1,234.56' })).toEqual({ 1: '0.11', 2: '1234.56' })
  })

  it('distinguishes skipped, incomplete, and explicitly zero income', () => {
    expect(takeHomeStatus({ 1: '', 2: '' }, [1, 2])).toEqual({ total: '', valid: true, missing: [1, 2] })
    expect(takeHomeStatus({ 1: '10', 2: '' }, [1, 2])).toEqual({ total: '10.00', valid: false, missing: [2] })
    expect(takeHomeStatus({ 1: '0', 2: '0' }, [1, 2])).toEqual({ total: '0.00', valid: true, missing: [] })
  })

  it.each(['-1', '=broken', 'NaN', '10000000000'])('blocks an invalid individual amount: %s', value => {
    expect(takeHomeStatus({ 1: value, 2: '0' }, [1, 2]).valid).toBe(false)
  })

  it('enforces the aggregate storage limit after rounding', () => {
    expect(takeHomeStatus({ 1: '9999999999.98', 2: '.01' }, [1, 2]).valid).toBe(true)
    expect(takeHomeStatus({ 1: '9999999999.99', 2: '.005' }, [1, 2]).valid).toBe(false)
  })

  it('treats a reallocation as an edit even when the household total is unchanged', () => {
    const base = { amounts: {}, netPay: '1000.00' }
    expect(flowsKey({ ...base, netPayByPerson: { 1: '400', 2: '600' } }))
      .not.toBe(flowsKey({ ...base, netPayByPerson: { 1: '500', 2: '500' } }))
    expect(flowsKey({ amounts: {}, netPay: '', netPayByPerson: { 1: '', 2: '' } }))
      .toBe(flowsKey({ amounts: {}, netPay: '' }))
  })
})
