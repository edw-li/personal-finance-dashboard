import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPerson, fetchHousehold, putMarriageDate, updatePerson } from './household'

// The client module is a thin path/verb/body mapper; fetch is the seam (client.test.ts's
// arrangement). Every assertion here is about the REQUEST, not the response.
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // A FRESH Response per call, not one shared instance: a body can only be consumed once,
  // and the clear-the-date test calls its client twice.
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

function lastCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return [call[0] as string, call[1] as RequestInit]
}

it('GETs the household with no trailing slash', async () => {
  await fetchHousehold()
  const [url, init] = lastCall()
  // The router mounts GET at prefix "/household" with an EMPTY route path, so a trailing
  // slash costs a 307 redirect (the /settings precedent).
  expect(url).toBe('/api/v1/household')
  expect(init.method).toBeUndefined()
})

it('POSTs a new person', async () => {
  await createPerson('Partner')
  const [url, init] = lastCall()
  expect(url).toBe('/api/v1/household/people')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body as string)).toEqual({ name: 'Partner' })
})

it('PATCHes a rename by id', async () => {
  await updatePerson(2, 'Ed')
  const [url, init] = lastCall()
  expect(url).toBe('/api/v1/household/people/2')
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body as string)).toEqual({ name: 'Ed' })
})

it('PUTs the marriage date, and null EXPLICITLY when cleared', async () => {
  await putMarriageDate('2026-09-19')
  let [url, init] = lastCall()
  expect(url).toBe('/api/v1/household/marriage-date')
  expect(init.method).toBe('PUT')
  expect(JSON.parse(init.body as string)).toEqual({ marriage_date: '2026-09-19' })

  await putMarriageDate(null)
  ;[url, init] = lastCall()
  // The key must SURVIVE JSON.stringify: an undefined value is dropped and the field
  // defaults to None server-side, so "clear the date" and "I forgot to send it" would
  // arrive as the same request (the espp_ticker lesson).
  const body = JSON.parse(init.body as string)
  expect(Object.keys(body)).toContain('marriage_date')
  expect(body.marriage_date).toBeNull()
})
