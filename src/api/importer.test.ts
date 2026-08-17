import { beforeEach, expect, it, vi } from 'vitest'
import { importXlsx } from './importer'

// ApiError and the token helpers stay real; only the transport is stubbed.
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const workbook = () => new File(['xlsx bytes'], 'finances.xlsx')

it('posts the workbook as multipart with the dry-run flag on', async () => {
  const file = workbook()
  await importXlsx(file, true)
  const [path, options] = vi.mocked(api).mock.calls[0]
  expect(path).toBe('/import/xlsx?dry_run=true')
  // FormData, not JSON: client.ts then leaves Content-Type to the browser.
  expect(options?.body).toBeInstanceOf(FormData)
  // Field name 'file' is what the backend's UploadFile parameter is called.
  expect((options?.body as FormData).get('file')).toBe(file)
  // A signal of its own — a workbook outruns the client's 15s default.
  expect(options?.signal).toBeInstanceOf(AbortSignal)
})

// Apply is the same upload with the flag flipped: the server keeps nothing between the
// two calls, so the File rides along a second time.
it('flips the query to dry_run=false when applying', async () => {
  const file = workbook()
  await importXlsx(file, false)
  const [path, options] = vi.mocked(api).mock.calls[0]
  expect(path).toBe('/import/xlsx?dry_run=false')
  expect((options?.body as FormData).get('file')).toBe(file)
})
