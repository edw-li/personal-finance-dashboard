import { afterEach, describe, expect, it, vi } from 'vitest'
import { NAV_SECTIONS } from './navItems'
import { prefetchRoute, ROUTE_CHUNKS, warmAllRoutes } from './routeChunks'
import type { RouteChunk } from './routeChunks'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ROUTE_CHUNKS', () => {
  it('covers every sidebar destination', () => {
    const paths = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.to))
    for (const path of paths) {
      expect(ROUTE_CHUNKS[path], `missing chunk for ${path}`).toBeDefined()
    }
  })

  it('has no chunk without a sidebar destination (map and nav stay in lockstep)', () => {
    const paths = new Set(NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.to)))
    for (const key of Object.keys(ROUTE_CHUNKS)) {
      expect(paths.has(key), `chunk ${key} has no sidebar destination`).toBe(true)
    }
  })
})

describe('prefetchRoute', () => {
  it('invokes the matching thunk once and ignores unknown paths', () => {
    const thunk = vi.fn(() => Promise.resolve({ default: () => null }))
    const chunks: Record<string, RouteChunk> = { '/x': thunk as unknown as RouteChunk }
    prefetchRoute('/x', chunks)
    prefetchRoute('/nope', chunks)
    expect(thunk).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejected chunk fetch', async () => {
    const chunks: Record<string, RouteChunk> = {
      '/x': (() => Promise.reject(new Error('offline'))) as unknown as RouteChunk,
    }
    expect(() => prefetchRoute('/x', chunks)).not.toThrow()
    // Flush the microtask queue; an unhandled rejection would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('warmAllRoutes', () => {
  it('walks every thunk via requestIdleCallback, one per idle slot', () => {
    const calls: string[] = []
    const mk = (name: string) =>
      (() => {
        calls.push(name)
        return Promise.resolve({ default: () => null })
      }) as unknown as RouteChunk
    const chunks: Record<string, RouteChunk> = { a: mk('a'), b: mk('b'), c: mk('c') }
    // Synchronous idle: each scheduled callback runs immediately.
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      cb()
      return 1
    })
    warmAllRoutes(chunks)
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('falls back to setTimeout when requestIdleCallback is missing (Safari)', () => {
    const thunk = vi.fn(() => Promise.resolve({ default: () => null }))
    const chunks: Record<string, RouteChunk> = { only: thunk as unknown as RouteChunk }
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    warmAllRoutes(chunks)
    expect(thunk).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(thunk).toHaveBeenCalledTimes(1)
  })

  it('swallows rejections while continuing the walk', async () => {
    const second = vi.fn(() => Promise.resolve({ default: () => null }))
    const chunks: Record<string, RouteChunk> = {
      bad: (() => Promise.reject(new Error('offline'))) as unknown as RouteChunk,
      good: second as unknown as RouteChunk,
    }
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      cb()
      return 1
    })
    warmAllRoutes(chunks)
    expect(second).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
