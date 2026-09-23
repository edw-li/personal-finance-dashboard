import { beforeEach, expect, it, vi } from 'vitest'
import { reorderCreditCards, reorderRewardCategories } from './creditCards'

// Only the transport is stubbed — the request this module builds IS the test
// (src/api/netWorth.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

// Drag-to-reorder (2026-09-23 spec §3.2, §3.6): one PUT with the whole new order. Both routes
// are unlogged, so there is no change batch to read — the answer is the list itself.
it('reorderCreditCards PUTs every card id in its new order and returns the list', async () => {
  const cards = [{ id: 9 }, { id: 4 }]
  vi.mocked(api).mockResolvedValue(cards)
  expect(await reorderCreditCards([9, 4])).toEqual(cards)
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    '/credit-cards/order',
    { method: 'PUT', body: '{"ids":[9,4]}' },
  ])
})

it('reorderRewardCategories PUTs every category id in its new order', async () => {
  const categories = [{ id: 2 }, { id: 5 }, { id: 1 }]
  vi.mocked(api).mockResolvedValue(categories)
  expect(await reorderRewardCategories([2, 5, 1])).toEqual(categories)
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    '/credit-cards/categories/order',
    { method: 'PUT', body: '{"ids":[2,5,1]}' },
  ])
})
