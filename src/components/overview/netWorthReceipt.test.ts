import { expect, it } from 'vitest'
import { netWorthComponents } from './netWorthReceipt'

it('labels the hero receipt components like every chart legend — Liabilities, not "liability"', () => {
  expect(netWorthComponents([
    { group: 'liability', total: '-4200.00', mom_delta: null },
    { group: 'pre_tax', total: '100.00', mom_delta: '1.00' },
  ])).toEqual([
    { label: 'Liabilities', value: '-4200.00', unit: 'USD' },
    { label: 'Pre-tax', value: '100.00', unit: 'USD' },
  ])
})
