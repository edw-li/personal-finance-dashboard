import { afterEach, expect, it, vi } from 'vitest'
import { changePassword } from './auth'
import { getToken } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

// The server bumps token_version on a password change (2026-09-03 shell spec §10), which
// kills every token issued before it — including the one THIS tab is holding. Storing the
// one the response hands back is the whole reason the endpoint returns a body: without it
// the tab that changed the password signs itself out on its very next request.
it('stores the token a successful password change hands back', async () => {
  localStorage.setItem('finance_token', 'stale-token')
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'rotated-token', token_type: 'bearer' }),
  })
  vi.stubGlobal('fetch', fetchMock)

  await changePassword('old-pw', 'new-pw-12345')

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/v1/auth/change-password')
  expect(init.body).toBe('{"current_password":"old-pw","new_password":"new-pw-12345"}')
  expect(getToken()).toBe('rotated-token')
})

it('leaves the old token in place when the change is rejected', async () => {
  localStorage.setItem('finance_token', 'still-good')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ detail: 'Current password is incorrect' }),
    })
  )
  await expect(changePassword('wrong-pw', 'new-pw-12345')).rejects.toThrow(
    'Current password is incorrect'
  )
  expect(getToken()).toBe('still-good')
})
