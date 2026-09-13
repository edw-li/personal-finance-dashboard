import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WARM,
  WARM_TTL_MS,
  prefetchSection,
  primeWarm,
  resetWarm,
  resetWarmForTests,
  takeWarm,
  warmSource,
} from './settingsPrefetch'
import type { SettingsSection } from './settingsPrefetch'

// The section loaders call the real API modules, so every one of them is a spy here: what is
// under test is WHICH loaders a hover starts, not what they return.
vi.mock('../../api/assistant', () => ({ fetchAssistantSettings: vi.fn(async () => null) }))
vi.mock('../../api/calendarFeed', () => ({ fetchFeedTokens: vi.fn(async () => []) }))
vi.mock('../../api/coverage', () => ({ fetchCoverage: vi.fn(async () => null) }))
vi.mock('../../api/household', () => ({ fetchHousehold: vi.fn(async () => null) }))
vi.mock('../../api/lifecycle', () => ({
  fetchActivity: vi.fn(async () => null),
  fetchHealth: vi.fn(async () => null),
  fetchSnapshots: vi.fn(async () => []),
}))
vi.mock('../../api/limits', () => ({ fetchLimits: vi.fn(async () => null) }))
vi.mock('../../api/netWorth', () => ({ fetchAccounts: vi.fn(async () => []) }))
vi.mock('../../api/paycheck', () => ({ fetchProfiles: vi.fn(async () => []) }))
vi.mock('../../api/portfolio', () => ({ fetchPortfolioAccounts: vi.fn(async () => []) }))
vi.mock('../../api/settings', () => ({ fetchAppSettings: vi.fn(async () => null) }))
vi.mock('../../api/spending', () => ({ fetchCategories: vi.fn(async () => []) }))
vi.mock('../../api/system', () => ({ fetchSystemStatus: vi.fn(async () => null) }))
import { fetchAssistantSettings } from '../../api/assistant'
import { fetchHousehold } from '../../api/household'
import { fetchLimits } from '../../api/limits'
import { fetchProfiles } from '../../api/paycheck'
import { fetchAppSettings } from '../../api/settings'
import { fetchSystemStatus } from '../../api/system'

const NONE: ReadonlySet<SettingsSection> = new Set<SettingsSection>()
const visited = (...sections: SettingsSection[]): ReadonlySet<SettingsSection> =>
  new Set<SettingsSection>(sections)

afterEach(() => {
  resetWarmForTests()
  vi.clearAllMocks()
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

describe('prefetchSection — a VISITED writer disqualifies its key', () => {
  // Three endpoints are read by two sections each (/household by Household and Planning,
  // /settings by Planning and Integrations, /system by Integrations and Data), and the
  // per-SECTION guard cannot see that: a prime taken on a hover, then a save on the section the
  // reader is standing in, and the sibling's card would mount on the pre-edit body for the rest
  // of the 30s window. A key whose writer has been open is simply not primed (P4 review).
  it('leaves /household unprimed for Planning once Household has been open', () => {
    prefetchSection('planning', visited('household'))
    expect(fetchHousehold).not.toHaveBeenCalled()
    // Everything Planning alone reads is still warmed — the guard is per key, not per section.
    expect(fetchProfiles).toHaveBeenCalledTimes(1)
    expect(fetchLimits).toHaveBeenCalledTimes(1)
    expect(fetchAppSettings).toHaveBeenCalledTimes(1)
  })

  it('leaves /settings unprimed for Integrations once Planning has been open — both write it', () => {
    prefetchSection('integrations', visited('planning'))
    expect(fetchAppSettings).not.toHaveBeenCalled()
    expect(fetchAssistantSettings).toHaveBeenCalledTimes(1)
  })

  it('leaves /system unprimed for Data once Integrations has been open', () => {
    prefetchSection('data', visited('integrations'))
    expect(fetchSystemStatus).not.toHaveBeenCalled()
  })

  it('primes every key when no writer has been open, and the card takes what was primed', async () => {
    prefetchSection('planning', NONE)
    expect(fetchHousehold).toHaveBeenCalledTimes(1)
    const fresh = vi.fn(async () => 'fresh')
    await takeWarm(WARM.household, fresh)
    expect(fresh).not.toHaveBeenCalled()
  })

  it('resetWarm drops every parked promise — the hook the lead wires at logout', async () => {
    primeWarm('k', async () => 'primed')
    resetWarm()
    const fresh = vi.fn(async () => 'fresh')
    await expect(takeWarm('k', fresh)).resolves.toBe('fresh')
  })
})
