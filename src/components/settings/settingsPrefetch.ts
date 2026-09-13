import { fetchAssistantSettings } from '../../api/assistant'
import { fetchFeedTokens } from '../../api/calendarFeed'
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import { fetchActivity, fetchHealth, fetchSnapshots } from '../../api/lifecycle'
import { fetchLimits } from '../../api/limits'
import { fetchAccounts } from '../../api/netWorth'
import { fetchProfiles } from '../../api/paycheck'
import { fetchPortfolioAccounts } from '../../api/portfolio'
import { fetchAppSettings } from '../../api/settings'
import { fetchCategories } from '../../api/spending'
import { fetchSystemStatus } from '../../api/system'

// Tab-hover prefetch for the Settings page (2026-09-13 polish spec §9). The API client shares
// identical GETs only while they are IN FLIGHT (client.ts `pendingReads`), so a hover that
// resolved before the click would be thrown away; the section loaders park their promises here
// and every card's MOUNT load takes its own key. Reloads after a save never call takeWarm — a
// primed result may predate the write (the page also never primes a section it has visited).

export type SettingsSection = 'household' | 'planning' | 'account' | 'integrations' | 'data'

/** One key per endpoint, shared by the page's loaders and the cards' mount loads so they cannot
 *  drift apart. Two cards wanting the same endpoint: the first takes it, the second fetches (and
 *  client.ts shares the request if the first is still in flight). */
export const WARM = {
  household: 'household',
  categories: 'categories',
  accounts: 'accounts',
  portfolioAccounts: 'portfolio-accounts',
  limits: (year: number) => `limits:${year}`,
  appSettings: 'app-settings',
  profiles: 'profiles',
  systemStatus: 'system-status',
  assistant: 'assistant-settings',
  feedTokens: 'feed-tokens',
  snapshots: 'snapshots',
  health: 'health',
  coverage: 'coverage',
  activity: 'activity',
} as const

/** How long a primed result may wait for its card. A hover that never became a click is forgotten. */
export const WARM_TTL_MS = 30_000

const warm = new Map<string, { at: number; promise: Promise<unknown> }>()

/** Start `loader` for `key` unless a fresh prime is already parked there. A prime that fails is
 *  forgotten, never served: the card's own load is the one that reports and offers Retry. */
export function primeWarm<T>(key: string, loader: () => Promise<T>): void {
  const entry = warm.get(key)
  if (entry !== undefined && Date.now() - entry.at < WARM_TTL_MS) return
  const promise = loader()
  promise.catch(() => {
    if (warm.get(key)?.promise === promise) warm.delete(key)
  })
  warm.set(key, { at: Date.now(), promise })
}

/** The mount load's source: the primed promise if one is fresh (and it is consumed — the next
 *  taker fetches), else `loader()`. */
export function takeWarm<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const entry = warm.get(key)
  warm.delete(key)
  if (entry !== undefined && Date.now() - entry.at < WARM_TTL_MS) return entry.promise as Promise<T>
  return loader()
}

/** The plain loader, in takeWarm's shape, for every load that is not the mount load. */
export function fresh<T>(_key: string, loader: () => Promise<T>): Promise<T> {
  return loader()
}

export type WarmSource = <T>(key: string, loader: () => Promise<T>) => Promise<T>

/** `initial` is the mount load — take a primed result if there is one; anything else fetches. */
export function warmSource(initial: boolean): WarmSource {
  return initial ? takeWarm : fresh
}

export function resetWarmForTests(): void {
  warm.clear()
}

// What each task's cards ask for on mount (their load chains name the same keys). Account has no
// fetching card (Appearance and Password own no request).
const LOADERS: Record<SettingsSection, () => void> = {
  household: () => {
    primeWarm(WARM.household, fetchHousehold)
    primeWarm(WARM.categories, fetchCategories)
    primeWarm(WARM.accounts, fetchAccounts)
    primeWarm(WARM.portfolioAccounts, fetchPortfolioAccounts)
  },
  planning: () => {
    const year = new Date().getFullYear() // LimitsCard opens on the current year
    primeWarm(WARM.limits(year), () => fetchLimits(year))
    primeWarm(WARM.appSettings, fetchAppSettings)
    primeWarm(WARM.profiles, fetchProfiles)
    primeWarm(WARM.household, fetchHousehold)
  },
  account: () => {},
  integrations: () => {
    primeWarm(WARM.systemStatus, fetchSystemStatus)
    primeWarm(WARM.appSettings, fetchAppSettings)
    primeWarm(WARM.assistant, fetchAssistantSettings)
    primeWarm(WARM.feedTokens, fetchFeedTokens)
  },
  data: () => {
    primeWarm(WARM.snapshots, fetchSnapshots)
    primeWarm(WARM.health, fetchHealth)
    primeWarm(WARM.systemStatus, fetchSystemStatus)
    primeWarm(WARM.coverage, fetchCoverage)
    primeWarm(WARM.activity, () => fetchActivity())
  },
}

/** Warm a section's data before its tab is clicked. Idempotent inside the window. */
export function prefetchSection(section: SettingsSection): void {
  LOADERS[section]()
}
