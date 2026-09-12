import { expect, it } from 'vitest'
import { monthMovers } from './spending'

it('compares against the server eligible baseline even when excluded entries are much larger', () => {
  const result = monthMovers({ months: ['2026-06-01', '2026-07-01', '2026-08-01'], series: [
    { category_id: 1, values: ['100.00', '10000.00', '200.00'], budgets: [null, null, null], comparison_average: [null, '100.00', '100.00'], comparison_count: [0, 1, 1] },
  ] }, 2)
  expect(result[0].deltaAvg).toBe(100)
  expect(result[0].deltaPrior).toBe(-9800)
})

it('does not invent a zero category or compare an older snapshot as the preceding calendar month', () => {
  const result = monthMovers({ months: ['2026-06-01', '2026-08-01'], series: [
    { category_id: 1, values: ['100.00', '200.00'], budgets: [null, null], comparison_average: [null, '100.00'] },
    { category_id: 2, values: ['900.00', null], budgets: [null, null], comparison_average: [null, '900.00'] },
  ] }, 1)
  expect(result).toHaveLength(1)
  expect(result[0].deltaPrior).toBeNull()
  expect(result[0].value).toBe(200)
})
