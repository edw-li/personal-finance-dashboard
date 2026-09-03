import { beforeEach, expect, it, vi } from 'vitest'
import { deleteMonthBalances, fetchSummary, fetchTimeseries } from './netWorth'

// Only the transport is stubbed — the query string this module builds IS the test
// (src/api/projection.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
  apiWithHeaders: vi.fn(),
}))
import { api, apiWithHeaders } from './client'

beforeEach(() => vi.clearAllMocks())

const path = () => vi.mocked(api).mock.calls[0][0]

it('omits owner entirely for the household view', async () => {
  // Byte-identical to the pre-ownership request: absent means household, server-side.
  await fetchTimeseries()
  expect(path()).toBe('/net-worth/timeseries?granularity=monthly')
})

it('omits owner from the summary too', async () => {
  await fetchSummary()
  expect(path()).toBe('/net-worth/summary')
})

it('sends a person id as the owner scope, after granularity', async () => {
  await fetchTimeseries('quarterly', 3)
  expect(path()).toBe('/net-worth/timeseries?granularity=quarterly&owner=3')
})

it('sends the joint literal, and it is the summary query string on its own', async () => {
  await fetchSummary('joint')
  expect(path()).toBe('/net-worth/summary?owner=joint')
  vi.clearAllMocks()
  await fetchTimeseries('monthly', 'joint')
  expect(path()).toBe('/net-worth/timeseries?granularity=monthly&owner=joint')
})

it('sends owner and month together, month as a first-of-month ISO date', async () => {
  await fetchSummary('joint', '2026-02-01')
  expect(path()).toBe('/net-worth/summary?owner=joint&month=2026-02-01')
  vi.clearAllMocks()
  await fetchSummary(null, '2026-02-01')
  expect(path()).toBe('/net-worth/summary?month=2026-02-01')
})

// The DELETE answers 204 with the change batch in a header (2026-09-03 data-lifecycle spec
// §9) — the wizard needs the id to offer Undo, and null when nothing was logged.
it('deleteMonthBalances reads the change batch from the 204 header', async () => {
  vi.mocked(apiWithHeaders).mockResolvedValue({
    data: undefined,
    headers: new Headers({ 'X-Change-Batch': 'b-nw' }),
  })
  expect(await deleteMonthBalances('2026-09-01')).toEqual({ batchId: 'b-nw' })
  expect(vi.mocked(apiWithHeaders).mock.calls[0]).toEqual([
    '/net-worth/months/2026-09-01',
    { method: 'DELETE' },
  ])
  vi.mocked(apiWithHeaders).mockResolvedValue({ data: undefined, headers: new Headers() })
  expect(await deleteMonthBalances('2026-09-01')).toEqual({ batchId: null })
})
