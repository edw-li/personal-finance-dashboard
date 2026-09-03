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

function tokenExpiringAt(epochSeconds: number): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64url')
  return `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify({ sub: '1', exp: epochSeconds }))}.sig`
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

  it('swallows a failed renew and lets the next call try again', async () => {
    vi.mocked(getToken).mockReturnValue(tokenExpiringAt(NOW + 3600))
    vi.mocked(apiReadOnly).mockRejectedValueOnce(new Error('offline'))
    await expect(maybeRenew()).resolves.toBeUndefined()
    vi.mocked(apiReadOnly).mockResolvedValueOnce({ access_token: 't2' })
    await maybeRenew()
    expect(setToken).toHaveBeenCalledWith('t2')
  })
})

describe('return-to', () => {
  it('remembers an in-app path and hands it back once', () => {
    rememberReturnTo('/taxes?year=2026')
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/taxes?year=2026')
    expect(consumeReturnTo()).toBe('/taxes?year=2026')
    expect(consumeReturnTo()).toBeNull()
  })

  it('refuses anything that is not a same-origin path', () => {
    rememberReturnTo('//evil.example/x')
    expect(consumeReturnTo()).toBeNull()
    rememberReturnTo('https://evil.example')
    expect(consumeReturnTo()).toBeNull()
    rememberReturnTo('/login?reason=expired')
    expect(consumeReturnTo()).toBeNull() // never bounce back to login itself
  })
})
