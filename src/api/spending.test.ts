import { beforeEach, expect, it, vi } from 'vitest'
import { deleteSpendingMonth } from './spending'

// Only the transport is stubbed — the request this module builds IS the test.
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
  apiWithHeaders: vi.fn(),
}))
import { apiWithHeaders } from './client'

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
