import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  api,
  ApiError,
  apiReadOnly,
  apiWithHeaders,
  expireSession,
  setAfterResponseHook,
  setToken,
} from './client'
import { clearSnapshots, getSnapshot, setSnapshot } from './snapshotCache'

function mockFetchOk(body: unknown = {}) {
  const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  vi.stubGlobal('fetch', spy)
  return spy
}

function mockFetchFailure(status: number, body: unknown, jsonThrows = false, statusText = 'Boom') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
      json: jsonThrows ? () => Promise.reject(new Error('not json')) : async () => body,
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
  // Module state, not per-test state: a hook left installed by a failing test would fire
  // (and its assertions would count) inside every test that ran after it.
  setAfterResponseHook(null)
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

// HTTP/2 (and HTTP/3) carry no reason phrase, so `res.statusText` is the EMPTY STRING on
// every response the production nginx serves — a non-JSON 502 there used to surface as a
// toast with no words in it at all.
it('names the status when statusText is empty, as it always is over HTTP/2', async () => {
  mockFetchFailure(502, null, true, '')
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error.message).toBe('HTTP 502')
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

  it('a successful POST to an unmapped path wipes the snapshot cache', async () => {
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

  // Family-scoped invalidation (2026-09-03 shell spec §13). The coarse wipe cost every
  // OTHER page its instant paint on every save — a spending edit cannot move holdings.
  it('a PUT to /spending drops spending, overview and projection but keeps portfolio', async () => {
    setSnapshot('spending', 1)
    setSnapshot('overview', 1)
    setSnapshot('projection:default', 1)
    setSnapshot('shell:coverage', 1)
    setSnapshot('portfolio:all', 1)
    mockFetchOk()
    await api('/spending/months/2026-09-01', { method: 'PUT', body: '{}' })
    expect(getSnapshot('spending')).toBeUndefined()
    expect(getSnapshot('overview')).toBeUndefined()
    expect(getSnapshot('projection:default')).toBeUndefined()
    // The scope ribbon reads month coverage — a saved month changes it.
    expect(getSnapshot('shell:coverage')).toBeUndefined()
    expect(getSnapshot('portfolio:all')).toBe(1)
  })

  // The credit-cards page keeps ONE snapshot that embeds the spending categories, the
  // spending matrix AND /net-worth/accounts, and the matrix's four_pct_rule is computed from
  // the net-worth investable bases — so a saved month moves both pages, not just its own.
  it('a PUT to /net-worth drops spending and credit-cards too, but keeps portfolio', async () => {
    setSnapshot('net-worth:monthly:all', 1)
    setSnapshot('spending', 1)
    setSnapshot('credit-cards', 1)
    setSnapshot('overview', 1)
    setSnapshot('portfolio:all', 1)
    mockFetchOk()
    await api('/net-worth/months/2026-09-01', { method: 'PUT', body: '{}' })
    expect(getSnapshot('net-worth:monthly:all')).toBeUndefined()
    expect(getSnapshot('spending')).toBeUndefined()
    expect(getSnapshot('credit-cards')).toBeUndefined()
    expect(getSnapshot('overview')).toBeUndefined()
    // Balances cannot move holdings — the portfolio page keeps its instant paint.
    expect(getSnapshot('portfolio:all')).toBe(1)
  })

  // ESPP lots and the comp vesting schedule are both VALUED at the portfolio's latest quote,
  // so a refresh restates them; nothing it does touches a tax year's stored inputs.
  it('a POST to /prices/refresh drops the espp and comp families but keeps taxes', async () => {
    setSnapshot('espp:lots', 1)
    setSnapshot('comp:schedule', 1)
    setSnapshot('portfolio:all', 1)
    setSnapshot('taxes:years', 1)
    mockFetchOk()
    await api('/prices/refresh', { method: 'POST', body: '{}' })
    expect(getSnapshot('espp:lots')).toBeUndefined()
    expect(getSnapshot('comp:schedule')).toBeUndefined()
    expect(getSnapshot('portfolio:all')).toBeUndefined()
    expect(getSnapshot('taxes:years')).toBe(1)
  })

  // Prefix matching is on the FAMILY, not on a substring: 'portfolio' must not take
  // 'projection:default' with it, and 'net-worth' must not spare 'net-worth:monthly:all'.
  it('a POST to /portfolio drops the portfolio, overview and calendar families only', async () => {
    setSnapshot('portfolio:all', 1)
    setSnapshot('overview:flow:auto', 1)
    setSnapshot('calendar:2026-09-01', 1)
    setSnapshot('projection:default', 1)
    setSnapshot('taxes:years', 1)
    mockFetchOk()
    await api('/portfolio/transactions', { method: 'POST', body: '{}' })
    expect(getSnapshot('portfolio:all')).toBeUndefined()
    expect(getSnapshot('overview:flow:auto')).toBeUndefined()
    expect(getSnapshot('calendar:2026-09-01')).toBeUndefined()
    expect(getSnapshot('projection:default')).toBe(1)
    expect(getSnapshot('taxes:years')).toBe(1)
  })

  it('an unknown mutation path still wipes everything', async () => {
    setSnapshot('portfolio:all', 1)
    setSnapshot('overview', 1)
    mockFetchOk()
    // /household, /settings, /import, anything new: correct beats clever.
    await api('/household/people', { method: 'POST', body: '{}' })
    expect(getSnapshot('portfolio:all')).toBeUndefined()
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
    // The assistant transcript is session data of the same kind: an expired token must
    // not leave the next person through this tab reading the last one's questions.
    sessionStorage.setItem('assistant:transcript', '[]')
    sessionStorage.setItem('assistant:model', 'kimi-k3')
    // jsdom refuses real navigation, so the redirect is stubbed for this case.
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mockFetchFailure(401, { detail: 'Not authenticated' })
    await expect(api('/things')).rejects.toThrow('Session expired')
    expect(assign).toHaveBeenCalledWith('/login?reason=expired')
    expect(getSnapshot('overview')).toBeUndefined()
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(sessionStorage.getItem('assistant:model')).toBeNull()
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

describe('session plumbing', () => {
  // Return-to-page (2026-09-03 shell spec §10): an expiry must not also cost the user the
  // page they were reading — the login sends them back to it.
  it('a 401 remembers the current path and sends the user to /login?reason=expired', async () => {
    const assign = vi.fn()
    // jsdom refuses real navigation, so the redirect (and the location it reads) is stubbed.
    vi.stubGlobal('location', {
      ...window.location,
      pathname: '/taxes',
      search: '?year=2026',
      assign,
    })
    setToken('x')
    mockFetchFailure(401, { detail: 'Not authenticated' })
    await expect(api('/net-worth/summary')).rejects.toMatchObject({ status: 401 })
    expect(sessionStorage.getItem('finance.returnTo')).toBe('/taxes?year=2026')
    expect(assign).toHaveBeenCalledWith('/login?reason=expired')
  })

  // One helper, shared with the assistant's stream (which bypasses request() entirely).
  it('expireSession clears the session, remembers the page and names the reason', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, pathname: '/portfolio', search: '', assign })
    setToken('x')
    setSnapshot('overview', { stale: true })
    sessionStorage.setItem('assistant:transcript', '[]')
    expireSession()
    expect(localStorage.getItem('finance_token')).toBeNull()
    expect(getSnapshot('overview')).toBeUndefined()
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(sessionStorage.getItem('finance.returnTo')).toBe('/portfolio')
    expect(assign).toHaveBeenCalledWith('/login?reason=expired')
  })

  it('runs the after-response hook on successful authenticated calls, not on auth routes', async () => {
    setToken('x')
    const hook = vi.fn()
    setAfterResponseHook(hook)
    mockFetchOk()
    await api('/net-worth/summary')
    expect(hook).toHaveBeenCalledTimes(1)
    // /auth/renew is itself an authenticated response; hooking it would recurse.
    await api('/auth/me')
    expect(hook).toHaveBeenCalledTimes(1)
  })

  // A renewal is a reward for a working session. A 500 or a 429 proves nothing about the
  // token, and hanging a renew off one would retry the failure on every response.
  it('leaves the hook alone on a failed response', async () => {
    setToken('x')
    const hook = vi.fn()
    setAfterResponseHook(hook)
    mockFetchFailure(500, { detail: 'boom' })
    await expect(api('/net-worth/summary')).rejects.toThrow('boom')
    expect(hook).not.toHaveBeenCalled()
  })

  it('leaves the hook alone when there is no token', async () => {
    const hook = vi.fn()
    setAfterResponseHook(hook)
    mockFetchOk()
    await api('/net-worth/summary')
    expect(hook).not.toHaveBeenCalled()
  })
})

describe('apiWithHeaders — the 204 + header reader', () => {
  beforeEach(() => clearSnapshots())

  it('returns the parsed body AND the response headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-Change-Batch': 'b-1' }),
        json: async () => ({ month: '2026-09-01' }),
      }),
    )
    const { data, headers } = await apiWithHeaders<{ month: string }>(
      '/net-worth/months/2026-09-01',
    )
    expect(data.month).toBe('2026-09-01')
    expect(headers.get('x-change-batch')).toBe('b-1')
  })

  it('hands back undefined data for a 204 but still the headers, and invalidates like api()', async () => {
    setSnapshot('net-worth:all', 1)
    setSnapshot('portfolio:all', 1)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers({ 'X-Change-Batch': 'b-2' }),
        json: async () => {
          throw new Error('no body')
        },
      }),
    )
    const { data, headers } = await apiWithHeaders<void>('/net-worth/months/2026-09-01', {
      method: 'DELETE',
    })
    expect(data).toBeUndefined()
    expect(headers.get('x-change-batch')).toBe('b-2')
    expect(getSnapshot('net-worth:all')).toBeUndefined()
    expect(getSnapshot('portfolio:all')).toBe(1)
  })

  it('tolerates a response object without headers (older fetch mocks)', async () => {
    mockFetchOk({ ok: true })
    const { headers } = await apiWithHeaders('/x')
    expect(headers.get('x-change-batch')).toBeNull()
  })
})

describe('api — preferences invalidation', () => {
  beforeEach(() => clearSnapshots())

  // A theme toggle PATCHes /prefs (debounced) several times a sitting; wiping every page
  // snapshot for it would cost every page its instant paint. Only the shell family moves.
  it('a PATCH to /prefs drops the shell family and nothing else', async () => {
    setSnapshot('shell:prefs', 1)
    setSnapshot('shell:coverage', 1)
    setSnapshot('overview', 1)
    setSnapshot('portfolio:all', 1)
    mockFetchOk({ prefs: {} })
    await api('/prefs', { method: 'PATCH', body: '{}' })
    expect(getSnapshot('shell:prefs')).toBeUndefined()
    expect(getSnapshot('shell:coverage')).toBeUndefined()
    expect(getSnapshot('overview')).toBe(1)
    expect(getSnapshot('portfolio:all')).toBe(1)
  })

  it('an undo and a restore still wipe everything (unmapped paths)', async () => {
    setSnapshot('overview', 1)
    mockFetchOk({})
    await api('/activity/batches/b-1/undo', { method: 'POST' })
    expect(getSnapshot('overview')).toBeUndefined()
    setSnapshot('overview', 1)
    await api('/import/snapshot?dry_run=false', { method: 'POST', body: new FormData() })
    expect(getSnapshot('overview')).toBeUndefined()
  })
})
