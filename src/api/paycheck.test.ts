import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProfile, fetchBreakdown, fetchProfiles } from './paycheck'

// The client module is a thin path/verb/body mapper; fetch is the seam (household.test.ts's
// arrangement). Every assertion here is about the REQUEST, not the response.
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // A FRESH Response per call: a body can only be consumed once, and these tests call
  // their client more than once.
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function lastUrl(): string {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string
}

it('asks for the default breakdown with NO query string at all', async () => {
  await fetchBreakdown()
  // The byte-identity pin (spec §7): a single-earner household must send exactly the
  // request the server has always answered — no person_id, no empty "?".
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown')
})

it('sends profile_id alone, person_id alone, and both in that order', async () => {
  await fetchBreakdown(7)
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown?profile_id=7')

  await fetchBreakdown(undefined, 2)
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown?person_id=2')

  await fetchBreakdown(7, 2)
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown?profile_id=7&person_id=2')
})

it('leaves the profiles list unscoped — one ordered list, grouped by the UI', async () => {
  await fetchProfiles()
  // Spec §4.1: the list stays one payload for every person, so a chip press costs no
  // request for the table.
  expect(lastUrl()).toBe('/api/v1/paycheck/profiles')
})

it('POSTs the create body verbatim, person_id included when the caller sends one', async () => {
  await createProfile({
    effective_date: '2026-09-01',
    annual_salary: '120000',
    person_id: 2,
    hsa_coverage: 'family',
  })
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit
  expect(lastUrl()).toBe('/api/v1/paycheck/profiles')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body as string)).toEqual({
    effective_date: '2026-09-01',
    annual_salary: '120000',
    person_id: 2,
    hsa_coverage: 'family',
  })
})
