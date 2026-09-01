import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, apiReadOnly, setToken } from './client'
import { clearSnapshots, getSnapshot, setSnapshot } from './snapshotCache'

function mockFetchOk(body: unknown = {}) {
  const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  vi.stubGlobal('fetch', spy)
  return spy
}

function mockFetchFailure(status: number, body: unknown, jsonThrows = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Boom',
      json: jsonThrows ? () => Promise.reject(new Error('not json')) : async () => body,
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('joins FastAPI 422 validation arrays into one message', async () => {
  mockFetchFailure(422, { detail: [{ msg: 'field a is bad' }, { msg: 'field b is bad' }] })
  const error = await api('/anything').catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).status).toBe(422)
  expect((error as ApiError).message).toBe('field a is bad; field b is bad')
})

it('reads slowapi 429 bodies from the error key', async () => {
  mockFetchFailure(429, { error: 'Rate limit exceeded: 10 per 1 minute' })
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error.status).toBe(429)
  expect(error.message).toBe('Rate limit exceeded: 10 per 1 minute')
})

it('falls back to statusText on non-JSON error bodies', async () => {
  mockFetchFailure(500, null, true)
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error.message).toBe('Boom')
})

it('maps fetch rejections to ApiError instead of raw TypeError', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error).toBeInstanceOf(ApiError)
  expect(error.status).toBe(0)
  expect(error.message).toBe('Network error — is the server reachable?')
})

it('maps timeout aborts to a timed-out ApiError', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
  )
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error).toBeInstanceOf(ApiError)
  expect(error.status).toBe(0)
  expect(error.message).toBe('Request timed out')
})

it('passes a default timeout signal to fetch but honors a caller signal', async () => {
  const spy = mockFetchOk()
  await api('/x')
  expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  const own = new AbortController().signal
  await api('/y', { signal: own })
  expect(spy.mock.calls[1][1].signal).toBe(own)
})

// A FormData body must reach fetch with NO Content-Type: the browser writes
// multipart/form-data plus its own boundary, and a hand-set value omits that boundary,
// so the server sees an unparseable part. Auth must still ride along.
it('omits the JSON content type for FormData bodies', async () => {
  const fetchMock = mockFetchOk()
  setToken('tok') // afterEach's localStorage.clear() unsets it
  await api('/import/xlsx?dry_run=true', { method: 'POST', body: new FormData() })
  const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
  expect('Content-Type' in headers).toBe(false)
  expect(headers.Authorization).toBe('Bearer tok')
})

it('still sends the JSON content type for plain bodies', async () => {
  const fetchMock = mockFetchOk()
  await api('/settings', { method: 'PUT', body: JSON.stringify({}) })
  const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
  expect(headers['Content-Type']).toBe('application/json')
})

it('rethrows caller-initiated aborts untouched', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
  )
  const error = (await api('/anything').catch((e: unknown) => e)) as DOMException
  expect(error).toBeInstanceOf(DOMException)
  expect(error.name).toBe('AbortError')
})

describe('api — snapshot invalidation', () => {
  beforeEach(() => clearSnapshots())

  it('a successful POST wipes the snapshot cache', async () => {
    setSnapshot('overview', { stale: true })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    )
    await api('/things', { method: 'POST', body: JSON.stringify({}) })
    expect(getSnapshot('overview')).toBeUndefined()
  })

  it('a FAILED POST wipes too — a 500 may still have written', async () => {
    setSnapshot('overview', { stale: true })
    mockFetchFailure(500, { detail: 'boom' })
    await expect(api('/things', { method: 'POST' })).rejects.toThrow()
    expect(getSnapshot('overview')).toBeUndefined()
  })

  it('a GET leaves the cache alone', async () => {
    setSnapshot('overview', { fresh: true })
    mockFetchOk()
    await api('/things')
    expect(getSnapshot('overview')).toEqual({ fresh: true })
  })

  it('a 401 wipes (snapshots are session data)', async () => {
    setSnapshot('overview', { stale: true })
    // jsdom refuses real navigation, so the redirect is stubbed for this case.
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mockFetchFailure(401, { detail: 'Not authenticated' })
    await expect(api('/things')).rejects.toThrow('Session expired')
    expect(assign).toHaveBeenCalledWith('/login')
    expect(getSnapshot('overview')).toBeUndefined()
  })
})

describe('apiReadOnly — POST-for-read', () => {
  beforeEach(() => clearSnapshots())

  it('POSTs the body but leaves the snapshot cache standing', async () => {
    setSnapshot('overview', { kept: true })
    const fetchMock = mockFetchOk({ ok: true })
    const result = await apiReadOnly<{ ok: boolean }>('/assistant/context-preview', { context: {} })
    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/assistant/context-preview')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"context":{}}')
    // The whole point: a compute-read must not cost every page its instant paint.
    expect(getSnapshot('overview')).toEqual({ kept: true })
  })
})
