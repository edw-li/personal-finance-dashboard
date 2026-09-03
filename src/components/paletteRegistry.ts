import { formatMonth } from '../utils/format'
import { fuzzyScore } from '../utils/fuzzy'
import { NAV_ITEMS } from './navItems'

// What the palette can reach (2026-09-03 shell spec §9): pages (with aliases), Settings
// sections (anchored), actions, and lazily loaded entities. Matching is the house fuzzy
// scorer over label + keywords (+ sub for entities).
export type PaletteKind = 'page' | 'section' | 'action' | 'entity'

export interface PaletteEntry {
  kind: PaletteKind
  id: string
  label: string
  /** Secondary line for entities ("NVIDIA", "Cash · Edward"). */
  sub?: string
  keywords: string[]
  /** Destination for page/section/entity entries. */
  to?: string
  /** Runner for actions. */
  run?: () => void
  /** Group title for entities (Holdings, Accounts, Categories, Cards). */
  group?: 'Holdings' | 'Accounts' | 'Categories' | 'Cards'
}

export interface PaletteGroup {
  title: 'Actions' | 'Pages' | 'Settings' | 'Holdings' | 'Accounts' | 'Categories' | 'Cards'
  items: PaletteEntry[]
}

const GROUP_ORDER: PaletteGroup['title'][] = [
  'Actions',
  'Pages',
  'Settings',
  'Holdings',
  'Accounts',
  'Categories',
  'Cards',
]
export const GROUP_CAP = 6

/** Settings cards reachable as anchored destinations; ids match the cards' `id` attributes.
 *  `appearance` is the one entry whose card is not in this branch: it is the theme lane's
 *  `AppearanceCard` (id="appearance"), so the anchor only lands once that lane merges —
 *  until then /settings#appearance opens the page with no ring, which is the same
 *  no-op the browser gives any unknown hash. */
export const SETTINGS_SECTIONS: { id: string; label: string; keywords: string[] }[] = [
  { id: 'import', label: 'Import workbook', keywords: ['xlsx', 'spreadsheet', 'upload', 'dry run'] },
  {
    id: 'system',
    label: 'System status',
    keywords: ['backup', 'scheduler', 'refresh', 'database', 'alembic', 'export', 'snapshot'],
  },
  {
    id: 'app-settings',
    label: 'App settings',
    keywords: ['withdrawal rate', 'swr', 'espp ticker', 'cron'],
  },
  { id: 'password', label: 'Change password', keywords: ['security', 'sign out everywhere'] },
  { id: 'household', label: 'Household', keywords: ['partner', 'spouse', 'marriage', 'people'] },
  { id: 'categories', label: 'Spending categories', keywords: ['category', 'retire category'] },
  {
    id: 'accounts',
    label: 'Accounts',
    keywords: ['account', 'owner', 'component', 'retire account'],
  },
  {
    id: 'limits',
    label: 'Contribution limits',
    keywords: ['401k limit', 'hsa limit', 'espp limit', 'irs'],
  },
  { id: 'assistant', label: 'Assistant', keywords: ['ai', 'api key', 'model', 'nvidia'] },
  { id: 'appearance', label: 'Appearance', keywords: ['theme', 'dark', 'light', 'density', 'compact'] },
]

export interface RegistryRunners {
  refreshPrices: () => void
  askAssistant: () => void
}

/** The static half of the registry: pages, sections, actions. Entities are appended by the
 *  palette once loaded (see `entityEntries`). */
export function buildEntries(opts: { month: string; run: RegistryRunners }): PaletteEntry[] {
  const pages: PaletteEntry[] = NAV_ITEMS.map((item) => ({
    kind: 'page',
    id: `nav:${item.to}`,
    label: item.label,
    keywords: item.keywords,
    to: item.to,
  }))
  const sections: PaletteEntry[] = SETTINGS_SECTIONS.map((s) => ({
    kind: 'section',
    id: `section:${s.id}`,
    label: s.label,
    sub: 'Settings',
    keywords: [...s.keywords, 'settings'],
    to: `/settings#${s.id}`,
  }))
  const actions: PaletteEntry[] = [
    {
      kind: 'action',
      id: 'action:refresh-prices',
      label: 'Refresh prices',
      keywords: ['quotes', 'update prices'],
      run: opts.run.refreshPrices,
    },
    {
      kind: 'action',
      id: 'action:enter-update',
      label: `Enter ${formatMonth(opts.month)} update`,
      keywords: ['wizard', 'balances', 'monthly'],
      to: '/update',
    },
    // ?tab= and ?add= are arrival-only deep links their pages consume once: the dividends
    // ledger scrolls in with its first field focused, the calendar opens its add form.
    {
      kind: 'action',
      id: 'action:add-dividend',
      label: 'Add dividend',
      keywords: ['payment', 'income'],
      to: '/portfolio?tab=dividends',
    },
    {
      kind: 'action',
      id: 'action:add-custom-event',
      label: 'Add custom event',
      keywords: ['calendar', 'reminder'],
      to: '/calendar?add=1',
    },
    {
      kind: 'action',
      id: 'action:ask-assistant',
      label: 'Ask assistant',
      keywords: ['ai', 'chat', 'help'],
      run: opts.run.askAssistant,
    },
  ]
  return [...actions, ...pages, ...sections]
}

export interface EntitySources {
  securities: { ticker: string; name: string }[]
  accounts: { slug: string; name: string; group: string }[]
  categories: { slug: string; name: string }[]
  cards: { slug: string; name: string }[]
}

export function entityEntries(sources: EntitySources): PaletteEntry[] {
  return [
    ...sources.securities.map((s) => ({
      kind: 'entity' as const,
      id: `ticker:${s.ticker}`,
      label: s.ticker,
      sub: s.name,
      keywords: [s.name],
      to: `/portfolio?ticker=${encodeURIComponent(s.ticker)}`,
      group: 'Holdings' as const,
    })),
    ...sources.accounts.map((a) => ({
      kind: 'entity' as const,
      id: `account:${a.slug}`,
      label: a.name,
      sub: a.group,
      keywords: [a.group],
      to: `/net-worth?drill=${encodeURIComponent(a.slug)}`,
      group: 'Accounts' as const,
    })),
    ...sources.categories.map((c) => ({
      kind: 'entity' as const,
      id: `category:${c.slug}`,
      label: c.name,
      sub: 'Spending',
      keywords: [],
      to: `/spending?trend=${encodeURIComponent(c.slug)}`,
      group: 'Categories' as const,
    })),
    ...sources.cards.map((c) => ({
      kind: 'entity' as const,
      id: `card:${c.slug}`,
      label: c.name,
      sub: 'Card',
      keywords: [],
      to: `/credit-cards?card=${encodeURIComponent(c.slug)}`,
      group: 'Cards' as const,
    })),
  ]
}

function scoreEntry(query: string, entry: PaletteEntry): number | null {
  const label = fuzzyScore(query, entry.label)
  const alias = [...entry.keywords, entry.sub ?? ''].reduce<number | null>((best, word) => {
    const s = fuzzyScore(query, word)
    return s === null ? best : best === null ? s : Math.max(best, s)
  }, null)
  if (label === null && alias === null) return null
  // A label hit outranks an alias hit of equal strength.
  return Math.max(label === null ? -1 : label + 1, alias ?? -1)
}

/** Ranked matches; the empty query returns everything with `recents` first. */
export function matchEntries(
  query: string,
  entries: PaletteEntry[],
  recents: string[] = [],
): PaletteEntry[] {
  const trimmed = query.trim()
  if (trimmed === '') {
    // Array.prototype.sort is stable, so everything outside `recents` keeps registry order.
    const rank = new Map(recents.map((id, index) => [id, index]))
    return [...entries].sort(
      (a, b) => (rank.get(a.id) ?? recents.length) - (rank.get(b.id) ?? recents.length),
    )
  }
  return entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(trimmed, entry) }))
    .filter((x): x is { entry: PaletteEntry; index: number; score: number } => x.score !== null)
    // The tie-break is spelled out rather than left to sort's stability: equal scores mean
    // "the registry already decided", i.e. actions before pages before sections — so
    // "assistant" runs Ask assistant instead of jumping to the Settings card of the same name.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.entry)
}

function titleOf(entry: PaletteEntry): PaletteGroup['title'] {
  if (entry.kind === 'action') return 'Actions'
  if (entry.kind === 'page') return 'Pages'
  if (entry.kind === 'section') return 'Settings'
  return entry.group ?? 'Holdings'
}

/** Kind headers in the house order, at most GROUP_CAP per group, rank order preserved. */
export function groupMatches(matches: PaletteEntry[]): PaletteGroup[] {
  const buckets = new Map<PaletteGroup['title'], PaletteEntry[]>()
  for (const entry of matches) {
    const title = titleOf(entry)
    const bucket = buckets.get(title) ?? []
    if (bucket.length < GROUP_CAP) bucket.push(entry)
    buckets.set(title, bucket)
  }
  return GROUP_ORDER.filter((t) => buckets.has(t)).map((title) => ({
    title,
    items: buckets.get(title)!,
  }))
}
