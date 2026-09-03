import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RENEW_WITHIN_MS,
  RETURN_TO_KEY,
  consumeReturnTo,
  expiryOf,
  maybeRenew,
  rememberReturnTo,
  shouldRenew,
} from './session'

const b64 = (s: string) => Buffer.from(s).toString('base64url')

function tokenWithPayload(payload: string): string {
  return `${b64('{"alg":"HS256","typ":"JWT"}')}.${payload}.sig`
}

function tokenExpiringAt(epochSeconds: number): string {
  return tokenWithPayload(b64(JSON.stringify({ sub: '1', exp: epochSeconds })))
}

vi.mock('../../api/client', () => ({
  apiReadOnly: vi.fn(),
  getToken: vi.fn(),
  setToken: vi.fn(),
}))
import { apiReadOnly, getToken, setToken } from '../../api/client'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'))
  sessionStorage.clear()
  vi.mocked(apiReadOnly).mockReset()
  vi.mocked(getToken).mockReset()
  vi.mocked(setToken).mockReset()
})
afterEach(() => vi.useRealTimers())

const NOW = Math.floor(Date.parse('2026-09-03T12:00:00Z') / 1000)

describe('expiryOf / shouldRenew', () => {
  it('decodes exp from a base64url payload and null from garbage', () => {
    expect(expiryOf(tokenExpiringAt(NOW + 100))).toBe((NOW + 100) * 1000)
    expect(expiryOf('not.a.jwt')).toBeNull()
    expect(expiryOf('')).toBeNull()
  })

  // Every shape a payload can take without an epoch in it. null means "cannot schedule a
  // renewal", which shouldRenew turns into "leave this token alone" — never a NaN deadline
  // that renews on every single response.
  it('reads null from payloads that carry no usable exp', () => {
    expect(expiryOf(tokenWithPayload(b64('{"sub":"1"}')))).toBeNull() // no exp at all
    expect(expiryOf(tokenWithPayload(b64('{"exp":"soon"}')))).toBeNull() // exp, not a number
    expect(expiryOf(tokenWithPayload(b64('not json')))).toBeNull() // decodes, will not parse
    expect(shouldRenew(tokenWithPayload(b64('{"sub":"1"}')), NOW * 1000)).toBe(false)
  })

  it('renews only inside the last six hours of a live token', () => {
    const now = NOW * 1000
    expect(shouldRenew(tokenExpiringAt(NOW + 7 * 3600), now)).toBe(false)
    expect(shouldRenew(tokenExpiringAt(NOW + 5 * 3600), now)).toBe(true)
    expect(shouldRenew(tokenExpiringAt(NOW - 1), now)).toBe(false) // already dead: the 401 path owns it
    expect(RENEW_WITHIN_MS).toBe(6 * 60 * 60 * 1000)
  })
})

describe('maybeRenew', () => {
  it('is a no-op with a fresh token', async () => {
    vi.mocked(getToken).mockReturnValue(tokenExpiringAt(NOW + 20 * 3600))
    await maybeRenew()
    expect(apiReadOnly).not.toHaveBeenCalled()
  })

  it('renews once, single-flight, and stores the new token', async () => {
    vi.mocked(getToken).mockReturnValue(tokenExpiringAt(NOW + 3600))
    let resolve!: (v: { access_token: string }) => void
    vi.mocked(apiReadOnly).mockReturnValue(new Promise((r) => (resolve = r)))
    const a = maybeRenew()
    const b = maybeRenew()
    expect(apiReadOnly).toHaveBeenCalledTimes(1)
    expect(apiReadOnly).toHaveBeenCalledWith('/auth/renew', {})
    resolve({ access_token: 'new.token.here' })
    await Promise.all([a, b])
    expect(setToken).toHaveBeenCalledWith('new.token.here')
  })

  // Compare-and-set: the renewal is only allowed to replace the token it set out to renew.
  it('drops its answer when the session changed under it', async () => {
    const live = tokenExpiringAt(NOW + 3600)
    // Signed out mid-flight: the token this renewal was extending no longer exists.
    vi.mocked(getToken).mockReturnValueOnce(live).mockReturnValue(null)
    vi.mocked(apiReadOnly).mockResolvedValueOnce({ access_token: 'renewed' })
    await maybeRenew()
    expect(setToken).not.toHaveBeenCalled()
  })

  it('drops its answer when a DIFFERENT session signed in under it', async () => {
    const live = tokenExpiringAt(NOW + 3600)
    // Somebody else's sign-in landed first; overwriting it would sign them back out.
    vi.mocked(getToken).mockReturnValueOnce(live).mockReturnValue('other')
    vi.mocked(apiReadOnly).mockResolvedValueOnce({ access_token: 'renewed' })
    await maybeRenew()
    expect(setToken).not.toHaveBeenCalled()
  })

  it('swallows a failed renew and lets the next call try again', async () => {
    vi.mocked(getToken).mockReturnValue(tokenExpiringAt(NOW + 3600))
    vi.mocked(apiReadOnly).mockRejectedValueOnce(new Error('offline'))
    await expect(maybeRenew()).resolves.toBeUndefined()
    vi.mocked(apiReadOnly).mockResolvedValueOnce({ access_token: 't2' })
    await maybeRenew()
    expect(setToken).toHaveBeenCalledWith('t2')
  })
})

// The helpers themselves live in (and are tested from) the import-free returnTo leaf; what
// this pins is that the session still speaks for them, so a caller that thinks of the
// session as one thing does not have to know about the split.
describe('return-to re-exports', () => {
  it('round-trips through the session module', () => {
    rememberReturnTo('/taxes?year=2026')
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/taxes?year=2026')
    expect(consumeReturnTo()).toBe('/taxes?year=2026')
    expect(consumeReturnTo()).toBeNull()
  })
})
