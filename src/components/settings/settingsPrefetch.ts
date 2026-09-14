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

/** Drop every parked promise. Wire this at sign-out: a primed body must never cross a session
 *  boundary, and nothing else in the app may read a promise started for a reader who has left. */
export function resetWarm(): void {
  warm.clear()
}

/** The same thing, under the name the suites reach for in `beforeEach`. */
export const resetWarmForTests = resetWarm

/** Which SECTIONS hold cards that can write each endpoint. Three are read by two sections each,
 *  and the page's per-section guard cannot see that: a hover over Planning primes /household, the
 *  reader then edits a person on the Household tab they are standing on, and Planning's card would
 *  mount on the pre-edit roster for the rest of the 30s window. So a key whose writer has been
 *  OPEN this session is never primed at all (2026-09-13 P4 review). Keyed by the WARM value; the
 *  per-year limits key is looked up under its `limits` stem. */
export const WRITERS: Record<string, SettingsSection[]> = {
  [WARM.household]: ['household'],
  [WARM.categories]: ['household'],
  [WARM.accounts]: ['household'],
  [WARM.portfolioAccounts]: ['household'],
  limits: ['planning'],
  [WARM.appSettings]: ['planning', 'integrations'],
  [WARM.profiles]: ['planning'],
  [WARM.systemStatus]: ['integrations', 'data'],
  [WARM.assistant]: ['integrations'],
  [WARM.feedTokens]: ['integrations'],
  [WARM.snapshots]: ['data'],
  [WARM.health]: ['data'],
  [WARM.coverage]: ['data'],
  [WARM.activity]: ['data'],
}

/** `limits:2026` is written by whoever writes `limits`. An unlisted key has no writer here and is
 *  always safe to prime. */
function writersFor(key: string): readonly SettingsSection[] {
  return WRITERS[key] ?? WRITERS[key.split(':')[0]] ?? []
}

/** What a section's loader is handed: `primeWarm`, minus the keys this session has put at risk. */
type Prime = <T>(key: string, loader: () => Promise<T>) => void

// What each task's cards ask for on mount (their load chains name the same keys). Account has no
// fetching card (Appearance and Password own no request).
const LOADERS: Record<SettingsSection, (prime: Prime) => void> = {
  household: (prime) => {
    prime(WARM.household, fetchHousehold)
    prime(WARM.categories, fetchCategories)
    prime(WARM.accounts, fetchAccounts)
    prime(WARM.portfolioAccounts, fetchPortfolioAccounts)
  },
  planning: (prime) => {
    const year = new Date().getFullYear() // LimitsCard opens on the current year
    prime(WARM.limits(year), () => fetchLimits(year))
    prime(WARM.appSettings, fetchAppSettings)
    prime(WARM.profiles, fetchProfiles)
    prime(WARM.household, fetchHousehold)
  },
  account: () => {},
  integrations: (prime) => {
    prime(WARM.systemStatus, fetchSystemStatus)
    prime(WARM.appSettings, fetchAppSettings)
    prime(WARM.assistant, fetchAssistantSettings)
    prime(WARM.feedTokens, fetchFeedTokens)
  },
  data: (prime) => {
    prime(WARM.snapshots, fetchSnapshots)
    prime(WARM.health, fetchHealth)
    prime(WARM.systemStatus, fetchSystemStatus)
    prime(WARM.coverage, fetchCoverage)
    prime(WARM.activity, () => fetchActivity())
  },
}

/** Warm a section's data before its tab is clicked. Idempotent inside the window. `visited` is the
 *  sections this reader has already had open — any key one of them can write is skipped. */
export function prefetchSection(section: SettingsSection, visited: ReadonlySet<SettingsSection>): void {
  LOADERS[section]((key, loader) => {
    if (writersFor(key).some((writer) => visited.has(writer))) return
    primeWarm(key, loader)
  })
}
