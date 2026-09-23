import { beforeEach, expect, it, vi } from 'vitest'
import { deleteSpendingMonth, putSpendingMonth, reorderCategories } from './spending'

// Only the transport is stubbed — the request this module builds IS the test.
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
  apiWithHeaders: vi.fn(),
}))
import { api, apiWithHeaders } from './client'

beforeEach(() => vi.clearAllMocks())

it('deleteSpendingMonth reads the change batch and sends the repair source only when asked', async () => {
  vi.mocked(apiWithHeaders).mockResolvedValue({
    data: undefined,
    headers: new Headers({ 'X-Change-Batch': 'b-sp' }),
  })
  expect(await deleteSpendingMonth('2026-09-01')).toEqual({ batchId: 'b-sp' })
  expect(vi.mocked(apiWithHeaders).mock.calls[0]).toEqual([
    '/spending/months/2026-09-01',
    { method: 'DELETE' },
  ])
  await deleteSpendingMonth('2026-09-01', { source: 'repair' })
  expect(vi.mocked(apiWithHeaders).mock.calls[1]).toEqual([
    '/spending/months/2026-09-01',
    { method: 'DELETE', headers: { 'X-Change-Source': 'repair' } },
  ])
})

// 2026-09-04 honest-numbers spec §4: confirm_zero is the wizard's "Record this month as $0"
// checkbox and nothing else. The KEY must be absent unless the caller set it — an
// always-present `confirm_zero: false` would read as "the client considered it and said no",
// and a future default flip on the server would then be silently overridden.
it('putSpendingMonth ships the body verbatim, with confirm_zero only when the caller sets it', async () => {
  vi.mocked(api).mockResolvedValue({
    month: '2026-09-01',
    created: 0,
    updated: 19,
    unchanged: 0,
    net_pay_set: false,
    net_pay_cleared: false,
  })
  await putSpendingMonth('2026-09-01', { amounts: [{ category_id: 1, amount: '0.00' }] })
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    '/spending/months/2026-09-01',
    { method: 'PUT', body: '{"amounts":[{"category_id":1,"amount":"0.00"}]}' },
  ])

  await putSpendingMonth('2026-09-01', {
    amounts: [{ category_id: 1, amount: '0.00' }],
    confirm_zero: true,
  })
  expect(vi.mocked(api).mock.calls[1][1]).toEqual({
    method: 'PUT',
    body: '{"amounts":[{"category_id":1,"amount":"0.00"}],"confirm_zero":true}',
  })
})

// Drag-to-reorder (2026-09-23 spec §3.2, §3.6): one PUT with the whole new order; the change
// batch rides the X-Change-Batch header, null when the order was unchanged.
it('reorderCategories PUTs every id in its new order and reads the change batch', async () => {
  const rows = [
    { id: 4, sort_order: 0 },
    { id: 2, sort_order: 1 },
  ]
  vi.mocked(apiWithHeaders).mockResolvedValue({
    data: rows,
    headers: new Headers({ 'X-Change-Batch': 'b-cat' }),
  })
  expect(await reorderCategories([4, 2])).toEqual({ data: rows, batchId: 'b-cat' })
  expect(vi.mocked(apiWithHeaders).mock.calls[0]).toEqual([
    '/spending/categories/order',
    { method: 'PUT', body: '{"ids":[4,2]}' },
  ])
  vi.mocked(apiWithHeaders).mockResolvedValue({ data: rows, headers: new Headers() })
  expect((await reorderCategories([4, 2])).batchId).toBeNull()
})
