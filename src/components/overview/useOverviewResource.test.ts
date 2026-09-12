import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnapshots, getSnapshot, setSnapshot } from '../../api/snapshotCache'
import useOverviewResource from './useOverviewResource'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(clearSnapshots)
afterEach(cleanup)

describe('independent Overview resource scopes', () => {
  it('retains the arriving owner’s cache after a failed revalidation and recovers on retry', async () => {
    const first = { total: '100.00' }
    const cached = { total: '250.00' }
    const refreshed = { total: '275.00' }
    setSnapshot('overview:wealth:2', cached)
    const pending = deferred<typeof cached>()
    const loadFirst = vi.fn(async () => first)
    const loadSecond = vi.fn<() => Promise<typeof cached>>()
      .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(refreshed)
    const { result, rerender } = renderHook(({ key, loader }) => useOverviewResource(key, 'wealth', loader), {
      initialProps: { key: 'overview:wealth:1', loader: loadFirst },
    })
    await waitFor(() => expect(result.current.data).toEqual(first))
    rerender({ key: 'overview:wealth:2', loader: loadSecond })
    expect(result.current).toMatchObject({ data: cached, busy: true, fromCache: true })
    await act(async () => pending.reject(new Error('Owner feed unavailable')))
    expect(result.current).toMatchObject({ data: cached, busy: false, fromCache: true, stale: true })
    expect(result.current.error).toContain('Owner feed unavailable')
    await act(async () => result.current.retry())
    expect(result.current).toMatchObject({ data: refreshed, busy: false, error: null, stale: false })
    expect(getSnapshot('overview:wealth:2')).toEqual(refreshed)
  })

  it('never uses the previous owner’s data when an uncached owner fails', async () => {
    const loadFirst = vi.fn(async () => ({ total: '100.00' }))
    const pending = deferred<{ total: string }>()
    const loadSecond = vi.fn(() => pending.promise)
    const { result, rerender } = renderHook(({ key, loader }) => useOverviewResource(key, 'wealth', loader), {
      initialProps: { key: 'overview:wealth:1', loader: loadFirst },
    })
    await waitFor(() => expect(result.current.data).toEqual({ total: '100.00' }))
    rerender({ key: 'overview:wealth:2', loader: loadSecond })
    expect(result.current.data).toBeNull()
    await act(async () => pending.reject(new Error('Unavailable')))
    expect(result.current).toMatchObject({ key: 'overview:wealth:2', data: null, busy: false, stale: false, fromCache: false })
  })

  it('ignores a previous owner’s late response after the new owner has failed', async () => {
    const first = deferred<{ total: string }>()
    const second = deferred<{ total: string }>()
    setSnapshot('overview:wealth:2', { total: '250.00' })
    const { result, rerender } = renderHook(({ key, loader }) => useOverviewResource(key, 'wealth', loader), {
      initialProps: { key: 'overview:wealth:1', loader: () => first.promise },
    })
    rerender({ key: 'overview:wealth:2', loader: () => second.promise })
    await act(async () => second.reject(new Error('Unavailable')))
    await act(async () => first.resolve({ total: '999.00' }))
    expect(result.current).toMatchObject({ key: 'overview:wealth:2', data: { total: '250.00' }, stale: true })
    expect(getSnapshot('overview:wealth:1')).toBeUndefined()
  })
})
