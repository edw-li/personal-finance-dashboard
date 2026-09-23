import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { downloadStoredSnapshot } from './system'

// What each captured anchor looked like AT click time — the anchor is removed right after,
// so reading it later would see nothing (utils/download.test.ts's arrangement).
let clicks: { download: string; href: string }[]

beforeEach(() => {
  clicks = []
  localStorage.setItem('finance_token', 'tok')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({ download: this.download, href: this.href })
  })
  // jsdom implements neither.
  URL.createObjectURL = vi.fn(() => 'blob:mock-1')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('downloads a stored file by its encoded name, authenticated, saved under that name', async () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(['zip']), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await downloadStoredSnapshot('pre-restore-20260904-091500-123456.zip')
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('/api/v1/system/snapshots/pre-restore-20260904-091500-123456.zip/download')
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  expect(clicks).toEqual([
    { download: 'pre-restore-20260904-091500-123456.zip', href: 'blob:mock-1' },
  ])
})

it("says the server's 404 sentence verbatim", async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "No stored snapshot named 'x'" }), { status: 404 }),
    ),
  )
  await expect(downloadStoredSnapshot('x')).rejects.toThrow("No stored snapshot named 'x'")
  expect(clicks).toEqual([])
})
