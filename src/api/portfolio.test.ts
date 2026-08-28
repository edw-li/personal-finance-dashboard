import { beforeEach, expect, it, vi } from 'vitest'
import {
  fetchAllocation,
  fetchDividends,
  fetchHoldings,
  fetchPortfolioAccounts,
  fetchRealized,
  fetchTransactions,
  patchPortfolioAccount,
} from './portfolio'

// Only the transport is stubbed — the query string this module builds IS the test
// (src/api/netWorth.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const path = () => vi.mocked(api).mock.calls[0][0]
const init = () => vi.mocked(api).mock.calls[0][1]

it('omits owner entirely from all five owner-filterable fetches', async () => {
  // Byte-identical to the pre-ownership requests: absent means household, server-side.
  await fetchHoldings()
  expect(path()).toBe('/portfolio/holdings')
  vi.clearAllMocks()
  await fetchTransactions()
  expect(path()).toBe('/portfolio/transactions')
  vi.clearAllMocks()
  await fetchDividends()
  expect(path()).toBe('/portfolio/dividends')
  vi.clearAllMocks()
  await fetchRealized()
  expect(path()).toBe('/portfolio/realized')
  vi.clearAllMocks()
  await fetchAllocation('industry')
  expect(path()).toBe('/portfolio/allocation?by=industry')
})

it('treats an EXPLICIT null owner as no param at all', async () => {
  // The page always passes its scope, and the household scope IS null — so null and
  // omitted have to build the same string or the household view stops being byte-identical.
  await fetchHoldings(null)
  expect(path()).toBe('/portfolio/holdings')
  vi.clearAllMocks()
  await fetchAllocation('type', null)
  expect(path()).toBe('/portfolio/allocation?by=type')
})

it('sends a person id as the owner scope on the four single-param fetches', async () => {
  await fetchHoldings(7)
  expect(path()).toBe('/portfolio/holdings?owner=7')
  vi.clearAllMocks()
  await fetchTransactions(7)
  expect(path()).toBe('/portfolio/transactions?owner=7')
  vi.clearAllMocks()
  await fetchDividends(7)
  expect(path()).toBe('/portfolio/dividends?owner=7')
  vi.clearAllMocks()
  await fetchRealized(7)
  expect(path()).toBe('/portfolio/realized?owner=7')
})

it('APPENDS the owner to allocation, which already carries by=', async () => {
  // & not ?: /allocation is the only one of the five with a param of its own.
  await fetchAllocation('account', 7)
  expect(path()).toBe('/portfolio/allocation?by=account&owner=7')
  vi.clearAllMocks()
  await fetchAllocation('industry', 'joint')
  expect(path()).toBe('/portfolio/allocation?by=industry&owner=joint')
})

it('sends the joint literal verbatim', async () => {
  await fetchHoldings('joint')
  expect(path()).toBe('/portfolio/holdings?owner=joint')
  vi.clearAllMocks()
  await fetchRealized('joint')
  expect(path()).toBe('/portfolio/realized?owner=joint')
})

it('reads the portfolio-account roster from its own unparameterised endpoint', async () => {
  await fetchPortfolioAccounts()
  expect(path()).toBe('/portfolio/accounts')
  expect(init()).toBeUndefined()
})

it('patches ONLY person_id, and sends an explicit null for joint', async () => {
  await patchPortfolioAccount(4, { person_id: null })
  expect(path()).toBe('/portfolio/accounts/4')
  expect(init()?.method).toBe('PATCH')
  // The key must SURVIVE JSON.stringify: an omitted person_id means "leave the owner
  // alone" server-side, so retagging to joint has to send null on purpose.
  expect(init()?.body).toBe('{"person_id":null}')
  vi.clearAllMocks()
  await patchPortfolioAccount(4, { person_id: 2 })
  expect(init()?.body).toBe('{"person_id":2}')
})
