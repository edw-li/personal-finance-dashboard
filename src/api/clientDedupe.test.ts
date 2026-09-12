import { afterEach, expect, it, vi } from 'vitest'
import { api, setToken } from './client'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
it('shares simultaneous reads and does not share between authenticated users', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r })).mockResolvedValue(new Response(JSON.stringify({ revision: 2 })))
  vi.stubGlobal('fetch', fetcher)
  setToken('user-a')
  const first = api('/spending/matrix')
  const second = api('/spending/matrix')
  expect(fetcher).toHaveBeenCalledOnce()
  setToken('user-b')
  const differentUser = api('/spending/matrix')
  expect(fetcher).toHaveBeenCalledTimes(2)
  resolve(new Response(JSON.stringify({ revision: 1 })))
  expect(await Promise.all([first, second, differentUser])).toEqual([{ revision: 1 }, { revision: 1 }, { revision: 2 }])
})

it('a successful save prevents the refresh from joining a pre-save read', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 2 })))
  vi.stubGlobal('fetch', fetcher)
  const before = api('/spending/matrix')
  await api('/month-review/months/2026-08-01', { method: 'PUT', body: '{}' })
  expect(await api('/spending/matrix')).toEqual({ revision: 2 })
  resolve(new Response(JSON.stringify({ revision: 1 })))
  expect(await before).toEqual({ revision: 1 })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
