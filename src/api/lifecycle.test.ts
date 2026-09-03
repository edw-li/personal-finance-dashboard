import { beforeEach, expect, it, vi } from 'vitest'
import {
  createSnapshot,
  fetchActivity,
  fetchActivityRun,
  fetchHealth,
  fetchSnapshots,
  restoreStored,
  restoreUpload,
  undoBatch,
} from './lifecycle'

// Only the transport is stubbed — the paths and options this module builds ARE the test
// (src/api/netWorth.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const call = (n = 0) => vi.mocked(api).mock.calls[n] as [string, RequestInit | undefined]

it('lists and creates stored snapshots', async () => {
  await fetchSnapshots()
  expect(call()).toEqual(['/system/snapshots'])
  await createSnapshot()
  expect(call(1)[0]).toBe('/system/snapshots')
  expect(call(1)[1]?.method).toBe('POST')
})

it('uploads a snapshot as multipart with the dry-run flag and a long timeout', async () => {
  const file = new File(['zip bytes'], 'finance-export.zip')
  await restoreUpload(file, true)
  const [path, init] = call()
  expect(path).toBe('/import/snapshot?dry_run=true')
  expect(init?.method).toBe('POST')
  expect(init?.body).toBeInstanceOf(FormData)
  expect((init?.body as FormData).get('file')).toBe(file)
  expect(init?.signal).toBeInstanceOf(AbortSignal)
  await restoreUpload(file, false)
  expect(call(1)[0]).toBe('/import/snapshot?dry_run=false')
})

it('restores a stored snapshot by its encoded name', async () => {
  await restoreStored('finance-export-20260904-233000.zip', false)
  expect(call()[0]).toBe('/import/snapshot/stored/finance-export-20260904-233000.zip?dry_run=false')
  expect(call()[1]?.method).toBe('POST')
})

it('pages the activity feed with a before cursor', async () => {
  await fetchActivity()
  expect(call()[0]).toBe('/activity?limit=50')
  await fetchActivity('2026-09-04T03:00:00+00:00')
  expect(call(1)[0]).toBe('/activity?limit=50&before=2026-09-04T03%3A00%3A00%2B00%3A00')
  await fetchActivityRun(7)
  expect(call(2)[0]).toBe('/activity/runs/7')
})

it('undoes a batch and reads health', async () => {
  await undoBatch('0b2f5c1e-1111-4222-8333-444455556666')
  expect(call()).toEqual([
    '/activity/batches/0b2f5c1e-1111-4222-8333-444455556666/undo',
    { method: 'POST' },
  ])
  await fetchHealth()
  expect(call(1)).toEqual(['/system/health'])
})
