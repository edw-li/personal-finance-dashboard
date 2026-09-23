import { StrictMode, createElement, type ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnapshots, getSnapshot } from '../../api/snapshotCache'
import type { SpendingEvidence } from '../../api/monthReview'
import useSpendingEvidence from './useSpendingEvidence'

// One spending-evidence request per view (2026-09-23 spec §P3). `fetch` is the only fake:
// the real api() client, its in-flight dedupe and the snapshot cache all run.

const SERVER_DEFAULT = '2026-08-01'
const DEFAULT_URL = '/api/v1/metrics/spending'
const monthUrl = (month: string) => `${DEFAULT_URL}?month=${month}`

const metric = (id: string) => ({
  id, definition_version: 'spending-v1', label: id, definition: id, value: '1', unit: 'USD', scope: 'household',
  completeness: 'complete', components: [], source_link: '/spending', source_label: 'Entries', as_of: '2026-09-12', warnings: [],
})
// `metrics[0].id` records which request produced the answer.
const evidence = (month: string | null, source: string) =>
  ({ month, review: null, metrics: [metric(source)], comparison: metric('comparison'), rolling: metric('rolling') }) as unknown as SpendingEvidence

interface Pending { url: string; resolve: (body: unknown, status?: number) => void }
let pending: Pending[] = []
const urls = () => pending.map((request) => request.url)

beforeEach(() => {
  clearSnapshots()
  pending = []
  vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>((done) => {
    pending.push({ url, resolve: (body, status = 200) => done(new Response(JSON.stringify(body), { status })) })
  })))
})
afterEach(async () => {
  cleanup()
  // Settle whatever a test left in flight: api() shares identical in-flight GETs module-wide,
  // so an unanswered request would otherwise be JOINED by the next test's identical one.
  await act(async () => {
    for (const request of pending) request.resolve({ detail: 'test over' }, 503)
    await new Promise((settled) => setTimeout(settled, 0))
  })
  vi.unstubAllGlobals()
})

/** Answer request `i` the way the server does: the default request is for the server's default
 *  month, `?month=` echoes the month asked for. */
async function answer(i: number, override?: { body?: unknown; status?: number }) {
  const request = pending[i]
  const month = new URL(request.url, 'http://x').searchParams.get('month') ?? SERVER_DEFAULT
  await act(async () => request.resolve(override?.body ?? evidence(month, request.url), override?.status))
}

type Props = { month?: string; revision?: unknown }
const render = (initialProps: Props = {}) =>
  renderHook(({ month, revision }: Props) => useSpendingEvidence(month, revision), { initialProps })

const MATRIX_A = { matrix: 'A' }
const MATRIX_B = { matrix: 'B' }

describe('useSpendingEvidence — one request per view', () => {
  it('Overview-shaped: the matrix names the month while the default request is in flight — one request', async () => {
    const { result, rerender } = render()
    expect(urls()).toEqual([DEFAULT_URL])
    rerender({ month: SERVER_DEFAULT, revision: MATRIX_A })
    await answer(0)
    await waitFor(() => expect(result.current.data?.month).toBe(SERVER_DEFAULT))
    expect(urls()).toEqual([DEFAULT_URL])
    // Filed under the month too, so a later visit keyed by that month paints at once.
    expect(getSnapshot(`spending:evidence:${SERVER_DEFAULT}`)).toBe(result.current.data)
  })

  it('a matrix arriving after the default answer costs no request and never blanks the receipts', async () => {
    const { result, rerender } = render({ month: undefined, revision: null })
    await answer(0)
    await waitFor(() => expect(result.current.data?.month).toBe(SERVER_DEFAULT))
    const shown = result.current.data
    rerender({ month: SERVER_DEFAULT, revision: MATRIX_A })
    expect(result.current.data).toBe(shown) // the very render that switches keys
    await waitFor(() => expect(result.current.data).toBe(shown))
    expect(urls()).toEqual([DEFAULT_URL])
  })

  it('a Spending drill to another month makes exactly one extra request; drilling back makes none', async () => {
    const { result, rerender } = render({ month: undefined, revision: null })
    rerender({ month: SERVER_DEFAULT, revision: MATRIX_A })
    await answer(0)
    await waitFor(() => expect(result.current.data?.month).toBe(SERVER_DEFAULT))
    rerender({ month: '2026-06-01', revision: MATRIX_A })
    await waitFor(() => expect(urls()).toEqual([DEFAULT_URL, monthUrl('2026-06-01')]))
    await answer(1)
    await waitFor(() => expect(result.current.data?.month).toBe('2026-06-01'))
    rerender({ month: SERVER_DEFAULT, revision: MATRIX_A })
    await waitFor(() => expect(result.current.data?.month).toBe(SERVER_DEFAULT))
    expect(urls()).toHaveLength(2)
  })

  it('a revision change refetches the month', async () => {
    const { result, rerender } = render()
    rerender({ month: SERVER_DEFAULT, revision: MATRIX_A })
    await answer(0)
    await waitFor(() => expect(result.current.data?.month).toBe(SERVER_DEFAULT))
    rerender({ month: SERVER_DEFAULT, revision: MATRIX_B })
    await waitFor(() => expect(urls()).toEqual([DEFAULT_URL, monthUrl(SERVER_DEFAULT)]))
    await answer(1)
    await waitFor(() => expect(result.current.data?.metrics[0].id).toBe(monthUrl(SERVER_DEFAULT)))
  })

  it('a failed default request falls back to the month’s own request', async () => {
    const { result, rerender } = render()
    rerender({ month: SERVER_DEFAULT, revision: MATRIX_A })
    await answer(0, { body: { detail: 'boom' }, status: 500 })
    await waitFor(() => expect(urls()).toEqual([DEFAULT_URL, monthUrl(SERVER_DEFAULT)]))
    await answer(1)
    await waitFor(() => expect(result.current.data?.month).toBe(SERVER_DEFAULT))
    expect(result.current.error).toBeNull()
  })

  it('a default answer for a different month (the data moved between two reads) falls back too', async () => {
    const { result, rerender } = render()
    rerender({ month: '2026-07-01', revision: MATRIX_A })
    await answer(0) // the server's default is August, not the July the matrix named
    await waitFor(() => expect(urls()).toEqual([DEFAULT_URL, monthUrl('2026-07-01')]))
    await answer(1)
    await waitFor(() => expect(result.current.data?.month).toBe('2026-07-01'))
  })

  it('an unmount mid-flight neither renders nor caches the late answer', async () => {
    const { result, unmount } = render({ month: SERVER_DEFAULT, revision: MATRIX_A })
    expect(urls()).toEqual([monthUrl(SERVER_DEFAULT)])
    const before = result.current
    unmount()
    await answer(0)
    expect(result.current).toBe(before)
    expect(getSnapshot(`spending:evidence:${SERVER_DEFAULT}`)).toBeUndefined()
  })

  it('StrictMode’s double effect still makes one request', () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)
    renderHook(() => useSpendingEvidence(undefined, undefined), { wrapper })
    expect(urls()).toEqual([DEFAULT_URL])
  })

  it('month identity is YYYY-MM-01: a short month matches the default answer and is asked for as the first', async () => {
    const { result, rerender } = render()
    rerender({ month: '2026-08', revision: MATRIX_A })
    await answer(0)
    await waitFor(() => expect(result.current.data?.month).toBe(SERVER_DEFAULT))
    expect(urls()).toEqual([DEFAULT_URL])
    rerender({ month: '2026-06', revision: MATRIX_A })
    await waitFor(() => expect(urls()).toEqual([DEFAULT_URL, monthUrl('2026-06-01')]))
  })
})
