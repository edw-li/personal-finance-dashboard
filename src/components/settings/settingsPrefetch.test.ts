import { afterEach, describe, expect, it, vi } from 'vitest'
import { WARM_TTL_MS, primeWarm, resetWarmForTests, takeWarm, warmSource } from './settingsPrefetch'

afterEach(() => {
  resetWarmForTests()
  vi.useRealTimers()
})

describe('settings warm cache', () => {
  it('hands a primed promise to the first taker and then forgets it', async () => {
    const loader = vi.fn(async () => 'primed')
    primeWarm('k', loader)
    primeWarm('k', loader) // a second prime inside the window is a no-op
    expect(loader).toHaveBeenCalledTimes(1)
    const later = vi.fn(async () => 'fresh')
    await expect(takeWarm('k', later)).resolves.toBe('primed')
    expect(later).not.toHaveBeenCalled()
    await expect(takeWarm('k', later)).resolves.toBe('fresh')
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('ignores a prime older than the window', async () => {
    vi.useFakeTimers({ now: 1_000 })
    primeWarm('k', async () => 'old')
    vi.setSystemTime(1_000 + WARM_TTL_MS + 1)
    const later = vi.fn(async () => 'fresh')
    await expect(takeWarm('k', later)).resolves.toBe('fresh')
  })

  it('never serves a prime that failed', async () => {
    primeWarm('k', () => Promise.reject(new Error('down')))
    await Promise.resolve()
    await Promise.resolve() // the rejection's own handler runs, and forgets the entry
    const later = vi.fn(async () => 'fresh')
    await expect(takeWarm('k', later)).resolves.toBe('fresh')
  })

  it('warmSource(true) takes, warmSource(false) is the plain loader', async () => {
    primeWarm('k', async () => 'primed')
    await expect(warmSource(false)('k', async () => 'fresh')).resolves.toBe('fresh')
    await expect(warmSource(true)('k', async () => 'fresh')).resolves.toBe('primed')
  })
})
