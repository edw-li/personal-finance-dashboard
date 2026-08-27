import { beforeEach, expect, it, vi } from 'vitest'
import { fetchSummary, fetchTimeseries } from './netWorth'

// Only the transport is stubbed — the query string this module builds IS the test
// (src/api/projection.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

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
