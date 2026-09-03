import { beforeEach, expect, it, vi } from 'vitest'
import { deletePref, fetchPrefs, patchPrefs } from './prefs'

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const call = (n = 0) => vi.mocked(api).mock.calls[n] as [string, RequestInit | undefined]

it('reads, patches partially and deletes one key — no trailing slashes', async () => {
  await fetchPrefs()
  expect(call()).toEqual(['/prefs'])
  await patchPrefs({ theme: 'light', scope: { owner: 'all', range: 'ytd' } })
  expect(call(1)[0]).toBe('/prefs')
  expect(call(1)[1]?.method).toBe('PATCH')
  expect(JSON.parse(call(1)[1]?.body as string)).toEqual({
    theme: 'light',
    scope: { owner: 'all', range: 'ytd' },
  })
  await deletePref('landing_page')
  expect(call(2)).toEqual(['/prefs/landing_page', { method: 'DELETE' }])
})
