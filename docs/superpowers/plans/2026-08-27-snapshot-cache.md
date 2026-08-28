# Snapshot Cache (Stale-While-Revalidate) Implementation Plan (Batch Plan 1/6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revisiting a page paints its last payload instantly and revalidates in the background under the existing `loading-dim` treatment; identical revalidation payloads change nothing on screen (no chart re-dance); any mutation, logout, or 401 wipes the cache.

**Architecture:** One module-level `Map` (`src/api/snapshotCache.ts`). Pages keep their exact fetch architecture — seq guards, busy-raised-by-callers, all-or-nothing snapshots — and gain three mechanical touches: (1) `useState` initializers seeded from the cache, (2) a store + JSON-equality skip at the top of each fetch's `.then`, (3) an `animateEntrance={!fromCache}` prop on their charts so a cached paint doesn't replay echarts' entrance. Invalidation is coarse: `api()` wipes the whole cache after any non-GET request (success OR failure — a 500 may still have written), and on 401; `AuthContext.logout` wipes too. Pages already branch their render on `payload === null`, so a seeded payload automatically lands in the existing `loading-dim` branch — **no render-branch changes in this plan** (Plan 3 owns those lines).

**Tech Stack:** React 19, vitest + @testing-library/react (jsdom), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-navigation-ux-polish-design.md` §1.

**Conventions:**
- Run tests with `npx vitest run <file>` from the repo root; never push; commit per task.
- **Excluded surfaces (do not touch):** `MonthlyUpdatePage`, `SettingsPage` (editing surfaces stay fetch-fresh — spec decision log), `LoginPage`, `NotFoundPage`.
- **The `.then` recipe** used everywhere below (adapted per page, shown fully each time):
  1. seq-guard early-return (where the page has one) — unchanged;
  2. build the snapshot object; read `previous = getSnapshot(KEY)`; `setSnapshot(KEY, snapshot)`;
  3. clear the page's error state (a stale banner must lift even when data didn't change);
  4. if `previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot)` → **return** (nothing re-renders, charts stay still);
  5. otherwise `setFromCache(false)` (charts may animate — the data really changed) and run the page's existing setState block.
- **Page test files:** each page already has a test harness that mocks its `../api/*` modules (and echarts where relevant). Extend each page's existing test file using its established mock helpers; the new tests to add are specified behaviorally per task with exact assertions. Two rules: seed the cache with `setSnapshot(...)` from `src/api/snapshotCache` and clear it in the file's `beforeEach` (`clearSnapshots()`), so tests stay order-independent.
- ESLint constraint (react-hooks v7): never call a setState synchronously in an effect body. All cache seeding happens in `useState` initializers or event handlers — the plan's code respects this; keep it that way if you adapt.

---

### Task 1: The cache module

**Files:**
- Create: `src/api/snapshotCache.ts`
- Create: `src/api/snapshotCache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/api/snapshotCache.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { clearSnapshots, getSnapshot, setSnapshot } from './snapshotCache'

beforeEach(() => clearSnapshots())

describe('snapshotCache', () => {
  it('stores and returns a value by key', () => {
    setSnapshot('overview', { a: 1 })
    expect(getSnapshot<{ a: number }>('overview')).toEqual({ a: 1 })
  })

  it('returns undefined for a missing key', () => {
    expect(getSnapshot('nope')).toBeUndefined()
  })

  it('overwrites on repeat set', () => {
    setSnapshot('k', 1)
    setSnapshot('k', 2)
    expect(getSnapshot('k')).toBe(2)
  })

  it('clears everything at once', () => {
    setSnapshot('a', 1)
    setSnapshot('b', 2)
    clearSnapshots()
    expect(getSnapshot('a')).toBeUndefined()
    expect(getSnapshot('b')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/api/snapshotCache.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/api/snapshotCache.ts`:

```ts
// Page-snapshot cache (2026-08-27 spec §1): in-memory, per-tab, token-scoped by the
// wipes below — a reload starts clean on purpose. Pages seed their useState
// initializers from here and revalidate on mount; api() wipes the whole map after any
// non-GET (coarse and always-correct), and the 401 path + logout wipe it because a
// snapshot is session data.
//
// Values are stored by reference and treated as immutable: pages must never mutate a
// payload they read back (they don't — every load replaces whole objects).
const cache = new Map<string, unknown>()

export function getSnapshot<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined
}

export function setSnapshot(key: string, value: unknown): void {
  cache.set(key, value)
}

export function clearSnapshots(): void {
  cache.clear()
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/api/snapshotCache.test.ts` — PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/snapshotCache.ts src/api/snapshotCache.test.ts
git commit -m "feat(cache): module-level page-snapshot cache"
```

---

### Task 2: `api()` wipes on mutation and on 401

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/api/client.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/api/client.test.ts` already mocks `fetch` for its existing cases — follow its established stubbing style. Add these tests (adapt the fetch-stub helper names to the file's own):

```ts
import { clearSnapshots, getSnapshot, setSnapshot } from './snapshotCache'
```

```ts
describe('api — snapshot invalidation', () => {
  beforeEach(() => clearSnapshots())

  it('a successful POST wipes the snapshot cache', async () => {
    setSnapshot('overview', { stale: true })
    // stub fetch → 200 {"ok":true}
    await api('/things', { method: 'POST', body: JSON.stringify({}) })
    expect(getSnapshot('overview')).toBeUndefined()
  })

  it('a FAILED POST wipes too — a 500 may still have written', async () => {
    setSnapshot('overview', { stale: true })
    // stub fetch → 500 {"detail":"boom"}
    await expect(api('/things', { method: 'POST' })).rejects.toThrow()
    expect(getSnapshot('overview')).toBeUndefined()
  })

  it('a GET leaves the cache alone', async () => {
    setSnapshot('overview', { fresh: true })
    // stub fetch → 200 {}
    await api('/things')
    expect(getSnapshot('overview')).toEqual({ fresh: true })
  })

  it('a 401 wipes (snapshots are session data)', async () => {
    setSnapshot('overview', { stale: true })
    // stub fetch → 401; the existing 401 test already stubs window.location.assign
    await expect(api('/things')).rejects.toThrow()
    expect(getSnapshot('overview')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/api/client.test.ts` — the four new tests FAIL.

- [ ] **Step 3: Implement in `client.ts`**

1. Add the import at the top:

```ts
import { clearSnapshots } from './snapshotCache'
```

2. Wrap the existing body of `api<T>` so mutations always wipe. The function currently starts at line 28. Change it to compute the method up front and wipe in a `finally`:

```ts
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  try {
    return await request<T>(path, options)
  } finally {
    // Coarse invalidation (2026-08-27 spec §1): ANY non-GET — success or failure, a 500
    // may still have written — drops every page snapshot. Correct beats clever here.
    if (method !== 'GET') clearSnapshots()
  }
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  // ← the previous body of api<T>, byte-identical, EXCEPT one addition in the 401
  //   branch below.
```

3. In the 401 branch (previously `client.ts:52-56`), add the wipe before the redirect:

```ts
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearToken()
    clearSnapshots() // snapshots are session data — they must not outlive the token
    window.location.assign('/login')
    throw new ApiError('Session expired', 401)
  }
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/api/client.test.ts` — PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts src/api/client.test.ts
git commit -m "feat(cache): api() wipes snapshots on any mutation and on 401"
```

---

### Task 3: `EChart` gains `animateEntrance`

**Files:**
- Modify: `src/components/EChart.tsx`
- Modify: `src/components/EChart.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/EChart.test.tsx` (it already mocks `../charts/echarts` with a `FakeChart` capturing `setOption` calls — use `__instances` exactly as the file's other tests do):

```tsx
it('animateEntrance={false} forces animation off in the option', () => {
  render(<EChart option={{ series: [] }} animateEntrance={false} />)
  const chart = instances[0]
  expect(chart.setOption).toHaveBeenCalledWith(
    expect.objectContaining({ animation: false }),
    { notMerge: true },
  )
})

it('animateEntrance defaults on (no forced animation flag)', () => {
  render(<EChart option={{ series: [] }} />)
  const chart = instances[0]
  const [option] = chart.setOption.mock.calls[0]
  expect('animation' in option).toBe(false)
})
```

(The second assertion holds because jsdom's `matchMedia` reports `matches: false`, so the REDUCED_MOTION path is idle in tests.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/EChart.test.tsx` — the new tests FAIL (unknown prop is ignored; first test sees no `animation: false`).

- [ ] **Step 3: Implement**

In `src/components/EChart.tsx`:

1. Add to the props (after `exportConfig` in both the destructuring and the type, keeping the additive-signature contract):

```tsx
  /** false = paint the option already-drawn (cached revisits must not replay the
   *  entrance dance — 2026-08-27 spec §1). Default true. Merged after the page's
   *  option, exactly like the reduced-motion force. */
  animateEntrance?: boolean
```

with destructuring default `animateEntrance = true`.

2. Replace the option effect (currently lines 115–125) with:

```tsx
  useEffect(() => {
    // notMerge: pages always send complete options; merging stale series causes ghosts.
    // Reduced-motion is forced AFTER the spread — a page option must never re-enable
    // animation against the user's OS preference (Global rules a11y promise). The flag
    // alone is not enough: ripple animators ignore it, so quiesceRipples covers the gap.
    // animateEntrance rides the same override slot: a cached paint is already-seen data.
    const base = REDUCED_MOTION ? quiesceRipples(option) : option
    chartRef.current?.setOption(
      {
        ...base,
        ...(REDUCED_MOTION || !animateEntrance ? { animation: false } : {}),
      },
      { notMerge: true },
    )
  }, [option, animateEntrance])
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/components/EChart.test.tsx` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(charts): EChart animateEntrance prop — cached paints render still"
```

---

### Task 4: Logout wipes the cache

**Files:**
- Modify: `src/contexts/AuthContext.tsx:40-43`
- Modify: `src/contexts/AuthContext.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/contexts/AuthContext.test.tsx` (follow the file's existing render/probe pattern for exercising `logout`):

```tsx
it('logout wipes the page-snapshot cache', () => {
  setSnapshot('overview', { stale: true })
  // render provider + probe, click/invoke logout exactly as the existing logout test does
  expect(getSnapshot('overview')).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/contexts/AuthContext.test.tsx` — new test FAILS.

- [ ] **Step 3: Implement**

In `src/contexts/AuthContext.tsx`, add the import and extend `logout` (currently lines 40–43):

```tsx
import { clearSnapshots } from '../api/snapshotCache'
```

```tsx
  const logout = useCallback(() => {
    authApi.logout()
    clearSnapshots() // snapshots are session data — they must not outlive the session
    setEmail(null)
  }, [])
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit**

```bash
git add src/contexts/AuthContext.tsx src/contexts/AuthContext.test.tsx
git commit -m "feat(cache): logout wipes page snapshots"
```

---

### Task 5: SpendingPage

**Files:**
- Modify: `src/pages/SpendingPage.tsx`
- Modify: `src/pages/SpendingPage.test.tsx`

- [ ] **Step 1: Wire the cache**

1. Imports (after the `fetchMatrix, fetchYearly` import):

```tsx
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
```

2. Above the component, add the key, snapshot shape, and the extracted trend-seed helper (its body is today's inline seed from `load`, verbatim math):

```tsx
const SNAPSHOT_KEY = 'spending'

interface SpendingSnapshot {
  matrix: SpendingMatrix
  yearly: SpendingYearly
}

// Default trend pick — the single biggest all-time category, slot 1. Extracted from
// load()'s .then so a cache-seeded mount derives the same default (spec §1).
function defaultTrend(m: SpendingMatrix): { categoryId: number; slot: number }[] {
  if (m.categories.length === 0) return []
  const totals = m.series.map((s) => ({
    id: s.category_id,
    total: s.values.reduce((acc, v) => acc + (v === null ? 0 : Number(v)), 0),
  }))
  totals.sort((a, b) => b.total - a.total)
  return [{ categoryId: totals[0].id, slot: 0 }]
}
```

3. Replace the state declarations at lines 67–71 with:

```tsx
  const cached = getSnapshot<SpendingSnapshot>(SNAPSHOT_KEY)
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(cached?.matrix ?? null)
  const [yearly, setYearly] = useState<SpendingYearly | null>(cached?.yearly ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trend, setTrend] = useState<{ categoryId: number; slot: number }[]>(() =>
    cached ? defaultTrend(cached.matrix) : [],
  )
  // false once a revalidation actually CHANGES the data — charts may animate again.
  const [fromCache, setFromCache] = useState(cached !== undefined)
```

4. Replace `load`'s `.then` (lines 120–135) with:

```tsx
      .then(([m, y]) => {
        const snapshot: SpendingSnapshot = { matrix: m, yearly: y }
        const previous = getSnapshot<SpendingSnapshot>(SNAPSHOT_KEY)
        setSnapshot(SNAPSHOT_KEY, snapshot)
        setError(null)
        // Identical payload: nothing re-renders, the charts stay still (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
          return
        setFromCache(false)
        setMatrix(m)
        setYearly(y)
        setTrend((current) =>
          current.length > 0 || m.categories.length === 0 ? current : defaultTrend(m),
        )
      })
```

5. Add `animateEntrance={!fromCache}` to all six `<EChart` usages (lines 644, 657, 736, 768, 785, 821 — option variables `monthDetailOption`, `barsOption`, `flowOption`, `heatmapOption`, `savingsOption`, `trendOption`).

- [ ] **Step 2: Extend the page tests**

In `src/pages/SpendingPage.test.tsx`, import `clearSnapshots`/`setSnapshot`, add `clearSnapshots()` to the `beforeEach`, and add (using the file's existing api-mock fixtures for a matrix/yearly payload):

```tsx
it('paints instantly from a seeded snapshot and still revalidates', async () => {
  setSnapshot('spending', { matrix: FIXTURE_MATRIX, yearly: FIXTURE_YEARLY })
  // mock fetchMatrix/fetchYearly to return promises that never resolve
  render(<SpendingPage />)   // via the file's usual wrapper
  // BEFORE any fetch resolution: content is up (query something only the matrix provides),
  // and no 'Loading' state is shown; fetchMatrix was still called (revalidation).
})

it('a changed revalidation payload updates the page', async () => {
  setSnapshot('spending', { matrix: FIXTURE_MATRIX, yearly: FIXTURE_YEARLY })
  // mock the fetches to resolve with a DIFFERENT matrix; await the flush the file's
  // other tests use; assert the new content replaced the seeded content.
})
```

- [ ] **Step 3: Run** — `npx vitest run src/pages/SpendingPage.test.tsx` then `npx eslint src/pages/SpendingPage.tsx` — both clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx
git commit -m "feat(cache): SpendingPage snapshot seed + revalidate"
```

---

### Task 6: CreditCardsPage

**Files:**
- Modify: `src/pages/CreditCardsPage.tsx`
- Modify: `src/pages/CreditCardsPage.test.tsx`

- [ ] **Step 1: Wire the cache**

1. Import `getSnapshot, setSnapshot` from `'../api/snapshotCache'`.

2. Above the component:

```tsx
const SNAPSHOT_KEY = 'credit-cards'

interface CreditCardsSnapshot {
  cards: CreditCardOut[]
  categories: RewardCategoryOut[]
  rates: RewardRateOut[]
  spendingCategories: CategoryOut[]
  matrix: SpendingMatrix
  accounts: AccountOut[]
}
```

3. Replace the state declarations at lines 44–52 with:

```tsx
  const cached = getSnapshot<CreditCardsSnapshot>(SNAPSHOT_KEY)
  const [cards, setCards] = useState<CreditCardOut[] | null>(cached?.cards ?? null)
  const [categories, setCategories] = useState<RewardCategoryOut[] | null>(
    cached?.categories ?? null,
  )
  const [rates, setRates] = useState<RewardRateOut[] | null>(cached?.rates ?? null)
  const [spendingCategories, setSpendingCategories] = useState<CategoryOut[]>(
    cached?.spendingCategories ?? [],
  )
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(cached?.matrix ?? null)
  const [accounts, setAccounts] = useState<AccountOut[]>(cached?.accounts ?? [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fromCache, setFromCache] = useState(cached !== undefined)
```

(`loading` stays starting `true` on purpose: a seeded grid renders full and dims under `loading-dim is-loading` until the mount revalidation resolves — the house revalidation cue, matching every other page in this plan. The `!loading &&` empty-notes cannot flash during that window because each one only renders when its data half is absent, and the seed fills them.)

4. Replace `load`'s `.then` (lines 78–86) with:

```tsx
      .then(([cardsData, categoriesData, ratesData, spendingData, matrixData, accountsData]) => {
        const snapshot: CreditCardsSnapshot = {
          cards: cardsData,
          categories: categoriesData,
          rates: ratesData,
          spendingCategories: spendingData,
          matrix: matrixData,
          accounts: accountsData,
        }
        const previous = getSnapshot<CreditCardsSnapshot>(SNAPSHOT_KEY)
        setSnapshot(SNAPSHOT_KEY, snapshot)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
          return
        setFromCache(false)
        setCards(cardsData)
        setCategories(categoriesData)
        setRates(ratesData)
        setSpendingCategories(spendingData)
        setMatrix(matrixData)
        setAccounts(accountsData)
      })
```

5. Add `animateEntrance={!fromCache}` to both `<EChart` usages (lines 315 `valueOption`, 335 `lineOption`).

- [ ] **Step 2: Extend the page tests** — same two behavioral tests as Task 5 (instant paint from seeded snapshot with pending fetches + revalidation update), using this file's fixtures; `clearSnapshots()` in `beforeEach`.

- [ ] **Step 3: Run** — `npx vitest run src/pages/CreditCardsPage.test.tsx` + eslint — clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(cache): CreditCardsPage snapshot seed + revalidate"
```

---

### Task 7: NetWorthPage

**Files:**
- Modify: `src/pages/NetWorthPage.tsx`
- Modify: `src/pages/NetWorthPage.test.tsx`

- [ ] **Step 1: Wire the cache**

1. Import `getSnapshot, setSnapshot` from `'../api/snapshotCache'`.

2. Above the component:

```tsx
// Keyed by the fetch parameters: flipping granularity or owner is a DIFFERENT snapshot.
function netWorthKey(granularity: 'monthly' | 'quarterly', owner: OwnerScope): string {
  return `net-worth:${granularity}:${owner ?? 'all'}`
}

interface NetWorthSnapshot {
  ts: NetWorthTimeseries
  summary: NetWorthSummary
}

// Default drill pick — the single biggest account by latest balance (signed, so
// liabilities never win; components skipped — their aggregate represents them).
// Extracted from load()'s .then so a cache-seeded mount derives the same default.
function defaultDrill(ts: NetWorthTimeseries): { accountId: number; slot: number }[] {
  if (ts.months.length === 0) return []
  const last = ts.months.length - 1
  const valueById = new Map(ts.series.map((s) => [s.account_id, s.values[last]]))
  const best = ts.accounts
    .filter((a) => !a.is_component)
    .map((a) => ({ id: a.id, value: Number(valueById.get(a.id) ?? 0) }))
    .filter((c) => Number.isFinite(c.value))
    .sort((a, b) => b.value - a.value)[0]
  return best ? [{ accountId: best.id, slot: 0 }] : []
}
```

3. State wiring. The initial fetch parameters are `granularity = 'monthly'`, `owner = null`, so the mount seed reads `netWorthKey('monthly', null)`. Replace the declarations at lines 76–89 (`stackBy` through `coverageMonths`; leave `granularity`/`owner`/`household` at 64–75 untouched) with:

```tsx
  const [stackBy, setStackBy] = useState<'group' | 'owner'>('group')
  const cached = getSnapshot<NetWorthSnapshot>(netWorthKey('monthly', null))
  const [data, setData] = useState<NetWorthTimeseries | null>(cached?.ts ?? null)
  const [summary, setSummary] = useState<NetWorthSummary | null>(cached?.summary ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(cached !== undefined)

  const [drill, setDrill] = useState<{ accountId: number; slot: number }[]>(() =>
    cached ? defaultDrill(cached.ts) : [],
  )

  const seededDrillRef = useRef(cached !== undefined && cached.ts.months.length > 0)

  const [coverageMonths, setCoverageMonths] = useState<string[]>(cached ? cached.ts.months : [])
```

(Keep the original comments that annotate `drill`/`seededDrillRef`/`coverageMonths` in place around the new code.)

4. Replace `load`'s `.then` body (lines 115–137) with:

```tsx
    Promise.all([fetchTimeseries(granularity, owner), fetchSummary(owner)])
      .then(([ts, sum]) => {
        const key = netWorthKey(granularity, owner)
        const snapshot: NetWorthSnapshot = { ts, summary: sum }
        const previous = getSnapshot<NetWorthSnapshot>(key)
        setSnapshot(key, snapshot)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
          return
        setFromCache(false)
        setData(ts)
        setSummary(sum)
        if (granularity === 'monthly') setCoverageMonths(ts.months)
        if (!seededDrillRef.current && ts.months.length > 0) {
          seededDrillRef.current = true
          const seed = defaultDrill(ts)
          if (seed.length > 0) {
            setDrill((current) => (current.length > 0 ? current : seed))
          }
        }
      })
```

(The `.catch`/`.finally` stay byte-identical.)

5. Add `animateEntrance={!fromCache}` to both `<EChart` usages (lines 514 `stackedOption`, 562 `drillOption`).

- [ ] **Step 2: Extend the page tests** — instant-paint + revalidation tests as in Task 5, seeding `setSnapshot('net-worth:monthly:all', { ts: FIXTURE_TS, summary: FIXTURE_SUMMARY })`; also assert the drill default derives from the seed (the drill chart section renders without waiting). `clearSnapshots()` in `beforeEach`.

- [ ] **Step 3: Run** — page tests + eslint clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.test.tsx
git commit -m "feat(cache): NetWorthPage parameter-keyed snapshot seed + revalidate"
```

---

### Task 8: PortfolioPage

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`

(No `PortfolioPage.test.tsx` exists on `main`; do NOT create one in this plan — the page's behavior is covered by the plan-final smoke and the existing component-panel tests.)

- [ ] **Step 1: Wire the cache**

1. Import `getSnapshot, setSnapshot` from `'../api/snapshotCache'`.

2. Above the component:

```tsx
const SNAPSHOT_KEY = 'portfolio'

interface PortfolioSnapshot {
  holdings: HoldingsResponse
  securities: SecurityOut[]
  transactions: TransactionOut[]
  dividends: DividendOut[]
  industry: AllocationResponse
  byType: AllocationResponse
  byAccount: AllocationResponse
  sparklines: SparklinesResponse
  history: PortfolioHistory
  realized: RealizedResponse
  refreshStatus: RefreshStatus
}
```

3. Replace the payload state declarations (lines 98–108) with seeded versions:

```tsx
  const cached = getSnapshot<PortfolioSnapshot>(SNAPSHOT_KEY)
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(cached?.holdings ?? null)
  const [securities, setSecurities] = useState<SecurityOut[]>(cached?.securities ?? [])
  const [transactions, setTransactions] = useState<TransactionOut[]>(cached?.transactions ?? [])
  const [dividends, setDividends] = useState<DividendOut[]>(cached?.dividends ?? [])
  const [industry, setIndustry] = useState<AllocationResponse | null>(cached?.industry ?? null)
  const [byType, setByType] = useState<AllocationResponse | null>(cached?.byType ?? null)
  const [byAccount, setByAccount] = useState<AllocationResponse | null>(
    cached?.byAccount ?? null,
  )
  const [sparklines, setSparklines] = useState<SparklinesResponse>(cached?.sparklines ?? {})
  const [history, setHistory] = useState<PortfolioHistory | null>(cached?.history ?? null)
  const [realized, setRealized] = useState<RealizedResponse | null>(cached?.realized ?? null)
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(
    cached?.refreshStatus ?? null,
  )
```

4. `loading` (line 138) seeds off the cache — the `loading ?` render branch must not swallow a seeded paint:

```tsx
  const [loading, setLoading] = useState(cached === undefined)
```

Add next to it:

```tsx
  const [fromCache, setFromCache] = useState(cached !== undefined)
```

5. In `load`'s `.then` (lines 166–180), apply the recipe:

```tsx
      .then(([h, secs, txns, divs, ind, typ, acct, spark, hist, real, status]) => {
        if (seq !== seqRef.current) return
        const snapshot: PortfolioSnapshot = {
          holdings: h,
          securities: secs,
          transactions: txns,
          dividends: divs,
          industry: ind,
          byType: typ,
          byAccount: acct,
          sparklines: spark,
          history: hist,
          realized: real,
          refreshStatus: status,
        }
        const previous = getSnapshot<PortfolioSnapshot>(SNAPSHOT_KEY)
        setSnapshot(SNAPSHOT_KEY, snapshot)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
          return
        setFromCache(false)
        setHoldings(h)
        setSecurities(secs)
        setTransactions(txns)
        setDividends(divs)
        setIndustry(ind)
        setByType(typ)
        setByAccount(acct)
        setSparklines(spark)
        setHistory(hist)
        setRealized(real)
        setRefreshStatus(status)
      })
```

6. The mount effect (lines 200–202) must dim a cached paint while revalidating — `reload()` is exactly that door:

```tsx
  useEffect(() => {
    // A cache hit revalidates under the reload dim; a cold mount takes the loading path.
    if (getSnapshot<PortfolioSnapshot>(SNAPSHOT_KEY) !== undefined) {
      reload()
    } else {
      load()
    }
    // mount-only: load/reload are plain functions over stable setters (house idiom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

(Match the file's existing lint posture: if the current mount effect carries no disable comment and lints clean, keep the same form.)

7. Add `animateEntrance={!fromCache}` to the `<EChart` at line 390 (`performanceOption`).

- [ ] **Step 2: Run** — `npx vitest run` (portfolio panel suites) + `npx eslint src/pages/PortfolioPage.tsx` + `npx tsc -b` — clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/PortfolioPage.tsx
git commit -m "feat(cache): PortfolioPage snapshot seed + revalidate under reload dim"
```

---

### Task 9: OverviewPage (three tracks)

**Files:**
- Modify: `src/pages/OverviewPage.tsx`
- Modify: `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Wire the cache**

1. Import `getSnapshot, setSnapshot` from `'../api/snapshotCache'`.

2. Above the component:

```tsx
const SNAPSHOT_KEY = 'overview'

// The up-next window slides with the calendar day — key it by today so a date rollover
// misses cleanly instead of painting yesterday's window.
function upNextKey(): string {
  return `overview:upnext:${todayIso()}`
}

function flowKey(year: number | null): string {
  return `overview:flow:${year ?? 'auto'}`
}
```

3. Seed the three tracks. Replace `const [data, setData] = useState<OverviewData | null>(null)` (line 73) and `const [busy, setBusy] = useState(true)` (line 74) with:

```tsx
  const cachedData = getSnapshot<OverviewData>(SNAPSHOT_KEY)
  const [data, setData] = useState<OverviewData | null>(cachedData ?? null)
  const [busy, setBusy] = useState(true)
  const [fromCache, setFromCache] = useState(cachedData !== undefined)
```

Replace `const [upNext, setUpNext] = useState<CalendarEvent[] | null>(null)` (line 83) with:

```tsx
  const [upNext, setUpNext] = useState<CalendarEvent[] | null>(
    () => getSnapshot<CalendarEvent[]>(upNextKey()) ?? null,
  )
```

Replace `const [flow, setFlow] = useState<MoneyFlowOut | null>(null)` (line 105) with:

```tsx
  const [flow, setFlow] = useState<MoneyFlowOut | null>(
    () => getSnapshot<MoneyFlowOut>(flowKey(null)) ?? null,
  )
```

4. `loadUpNext` `.then` (lines 91–95) becomes:

```tsx
      .then((data) => {
        if (seq !== upNextSeq.current) return
        const key = upNextKey()
        const previous = getSnapshot<CalendarEvent[]>(key)
        setSnapshot(key, data.events)
        setUpNextFailed(false)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data.events))
          return
        setUpNext(data.events)
      })
```

5. `loadFlow` gains an instant cache peek (event-handler seeding — chip clicks flip instantly) plus the recipe. Replace the whole function (lines 111–123) with:

```tsx
  const loadFlow = (year: number | null) => {
    const seq = ++flowSeq.current
    // Handler-side seed: a chip flip to an already-seen year paints instantly and
    // revalidates underneath (setState in a handler, never in an effect — lint rule).
    const peeked = getSnapshot<MoneyFlowOut>(flowKey(year))
    if (peeked !== undefined) setFlow(peeked)
    fetchMoneyFlow(year ?? undefined)
      .then((data) => {
        if (seq !== flowSeq.current) return
        const previous = getSnapshot<MoneyFlowOut>(flowKey(year))
        setSnapshot(flowKey(year), data)
        setFlowFailed(false)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setFlow(data)
      })
      .catch(() => {
        if (seq !== flowSeq.current) return
        setFlowFailed(true)
      })
  }
```

6. `load`'s `.then` (lines 144–151) becomes:

```tsx
      .then(
        ([summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system]) => {
          if (seq !== seqRef.current) return
          const snapshot: OverviewData = {
            summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system,
          }
          const previous = getSnapshot<OverviewData>(SNAPSHOT_KEY)
          setSnapshot(SNAPSHOT_KEY, snapshot)
          setError(null)
          if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
            return
          setFromCache(false)
          setData(snapshot)
        },
      )
```

7. Add `animateEntrance={!fromCache}` to the three `<EChart` usages (lines 420 `nwTrend`, 439 `perf`, 458 `bars`). Leave `MoneyFlowCard`'s internal chart alone (documented scope cut — its sankey is inside a child component and re-animating there is minor; spec §1 requires only the page-level charts).

- [ ] **Step 2: Extend the page tests** — instant-paint + revalidation tests seeding `setSnapshot('overview', FIXTURE_OVERVIEW_DATA)` with never-resolving api mocks (assert the hero tile's number is up and no `Loading…`); `clearSnapshots()` in the `beforeEach`. Reuse the file's existing full-payload fixture builders.

- [ ] **Step 3: Run** — page tests + eslint — clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(cache): OverviewPage three-track snapshot seed + revalidate"
```

---

### Task 10: CompPage + PaycheckPage

**Files:**
- Modify: `src/pages/CompPage.tsx`
- Modify: `src/pages/CompPage.test.tsx`
- Modify: `src/pages/PaycheckPage.tsx`
- Modify: `src/pages/PaycheckPage.test.tsx`

- [ ] **Step 1: CompPage**

Import the cache fns. Keys: `'comp:events'`, `'comp:schedule'`. Seed (lines 459–461 and 469–471):

```tsx
  const cachedEvents = getSnapshot<CompEventOut[]>('comp:events')
  const [events, setEvents] = useState<CompEventOut[] | null>(cachedEvents ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [fromCache, setFromCache] = useState(cachedEvents !== undefined)
```

```tsx
  const [schedule, setSchedule] = useState<VestingScheduleOut | null>(
    () => getSnapshot<VestingScheduleOut>('comp:schedule') ?? null,
  )
```

`load`'s `.then` (lines 479–483):

```tsx
      .then((data) => {
        if (seq !== seqRef.current) return
        const previous = getSnapshot<CompEventOut[]>('comp:events')
        setSnapshot('comp:events', data)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setFromCache(false)
        setEvents(data)
      })
```

`loadSchedule`'s `.then` (lines 500–504):

```tsx
      .then((data) => {
        if (seq !== scheduleSeq.current) return
        const previous = getSnapshot<VestingScheduleOut>('comp:schedule')
        setSnapshot('comp:schedule', data)
        setScheduleError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setSchedule(data)
      })
```

Add `animateEntrance={!fromCache}` to the `<EChart` at line 593 (`trajectory`).

- [ ] **Step 2: PaycheckPage**

Import the cache fns. Keys: `'paycheck:profiles'`, `` `paycheck:breakdown:${profileId ?? 'current'}` `` — add the helper above the component:

```tsx
function breakdownKey(profileId: number | null): string {
  return `paycheck:breakdown:${profileId ?? 'current'}`
}
```

Seed (lines 605–607 and 609–618):

```tsx
  const [profiles, setProfiles] = useState<PaycheckProfileOut[] | null>(
    () => getSnapshot<PaycheckProfileOut[]>('paycheck:profiles') ?? null,
  )
```

```tsx
  const cachedBreakdown = getSnapshot<PaycheckBreakdownOut>(breakdownKey(null))
  const [breakdown, setBreakdown] = useState<PaycheckBreakdownOut | null>(
    cachedBreakdown ?? null,
  )
  const [fromCache, setFromCache] = useState(cachedBreakdown !== undefined)
```

(`breakdownError`/`breakdownMissing`/`breakdownBusy`/`selection` stay as they are.)

`loadProfiles`'s `.then` (lines 631–636):

```tsx
      .then((data) => {
        if (seq !== profilesSeq.current) return
        const previous = getSnapshot<PaycheckProfileOut[]>('paycheck:profiles')
        setSnapshot('paycheck:profiles', data)
        setProfilesError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setProfiles(data)
      })
```

The breakdown effect's `.then` (lines 659–664):

```tsx
      .then((data) => {
        if (seq !== breakdownSeq.current) return
        const key = breakdownKey(selection.profileId)
        const previous = getSnapshot<PaycheckBreakdownOut>(key)
        setSnapshot(key, data)
        setBreakdownError(null)
        setBreakdownMissing(false)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setFromCache(false)
        setBreakdown(data)
      })
```

`FlowPanel` (in-file component) renders the sankey — thread the stillness through: give `FlowPanel` an extra prop `still: boolean`, pass `animateEntrance={!still}` on its `<EChart` (line 134), and render it as `<FlowPanel data={breakdown} still={fromCache} />` (line 774).

- [ ] **Step 3: Extend both test files** — instant-paint + revalidation for each track (`comp:events`, `comp:schedule`, `paycheck:profiles`, `paycheck:breakdown:current`), `clearSnapshots()` in each `beforeEach`.

- [ ] **Step 4: Run** — both page suites + eslint — clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CompPage.tsx src/pages/CompPage.test.tsx src/pages/PaycheckPage.tsx src/pages/PaycheckPage.test.tsx
git commit -m "feat(cache): Comp + Paycheck snapshot seed + revalidate"
```

---

### Task 11: EsppPage + CalendarPage

**Files:**
- Modify: `src/pages/EsppPage.tsx`
- Modify: `src/pages/EsppPage.test.tsx`
- Modify: `src/pages/CalendarPage.tsx`
- Modify: `src/pages/CalendarPage.test.tsx`

- [ ] **Step 1: EsppPage**

Import the cache fns. Keys: `'espp:lots'`, `'espp:offerings'`, `'espp:modeler:default'`.

Seed (lines 1191–1203):

```tsx
  const [lots, setLots] = useState<EsppLotsResponse | null>(
    () => getSnapshot<EsppLotsResponse>('espp:lots') ?? null,
  )
```

```tsx
  const [offerings, setOfferings] = useState<EsppOfferingOut[] | null>(
    () => getSnapshot<EsppOfferingOut[]>('espp:offerings') ?? null,
  )
```

```tsx
  const [modeler, setModeler] = useState<EsppModelerOut | null>(
    () => getSnapshot<EsppModelerOut>('espp:modeler:default') ?? null,
  )
```

(`barsFetched` stays `useRef(false)` — the employer-close bars are uncached and refetch lazily on the first revalidation, guarded exactly as today. The busy flags stay `useState(true)`; a seeded section renders under its `loading-dim` until the mount revalidation lands.)

`loadLots`'s `.then` (lines 1222–1233) — recipe inserted around the existing body (the bars trigger must run on every resolution, before the equality skip):

```tsx
      .then((data) => {
        if (seq !== lotsSeq.current) return
        if (!barsFetched.current && data.espp_ticker !== null) {
          barsFetched.current = true
          fetchPriceHistory(data.espp_ticker, 3650)
            .then((history) => setBars(history.points))
            .catch(() => setBars([]))
        }
        const previous = getSnapshot<EsppLotsResponse>('espp:lots')
        setSnapshot('espp:lots', data)
        setLotsError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setLots(data)
      })
```

`loadOfferings`'s `.then` — same recipe with key `'espp:offerings'` and setters `setOfferings`/`setOfferingsError`.

`loadModeler` learns an optional cache key so ONLY the mount's default run caches (knob-driven runs are user-parameterized and must not collide). Replace the signature and `.then` (lines 1262–1270):

```tsx
  const loadModeler = (params: ModelerParams = {}, cacheKey?: string) => {
    const seq = ++modelerSeq.current
    fetchModeler(params)
      .then((data) => {
        if (seq !== modelerSeq.current) return
        if (cacheKey !== undefined) {
          const previous = getSnapshot<EsppModelerOut>(cacheKey)
          setSnapshot(cacheKey, data)
          setModelerError(null)
          if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data))
            return
        } else {
          setModelerError(null)
        }
        setModeler(data)
      })
```

and the mount effect (lines 1282–1286) passes the key for the default run only:

```tsx
  useEffect(() => {
    loadLots()
    loadOfferings()
    loadModeler({}, 'espp:modeler:default')
  }, [])
```

(`runModeler` keeps calling `loadModeler({...})` with no cache key.)

- [ ] **Step 2: CalendarPage**

Import the cache fns. Key helper above the component:

```tsx
function calendarKey(monthIso: string): string {
  return `calendar:${monthIso}`
}
```

Seed (lines 39–40):

```tsx
  const [month, setMonth] = useState<string>(currentMonthIso())
  const [events, setEvents] = useState<CalendarEvent[] | null>(
    () => getSnapshot<CalendarEvent[]>(calendarKey(currentMonthIso())) ?? null,
  )
```

`load`'s `.then` (lines 68–72):

```tsx
      .then((data) => {
        if (seq !== seqRef.current) return
        const key = calendarKey(monthIso)
        const previous = getSnapshot<CalendarEvent[]>(key)
        setSnapshot(key, data.events)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data.events))
          return
        setEvents(data.events)
      })
```

`showMonth` (lines 88–93) gains a handler-side peek — month paging to an already-seen month paints instantly:

```tsx
  const showMonth = (next: string) => {
    setMonth(next)
    setOpen(null)
    // Already-seen month: paint it instantly and revalidate underneath (handler-side
    // seed — setState in a handler, never in an effect).
    const peeked = getSnapshot<CalendarEvent[]>(calendarKey(next))
    if (peeked !== undefined) setEvents(peeked)
    setBusy(true)
    load(next)
  }
```

- [ ] **Step 3: Extend both test files** — instant-paint + revalidation per track; for Calendar also: seed two months, page ‹/›, assert the second month's events paint before its fetch resolves. `clearSnapshots()` in each `beforeEach`.

- [ ] **Step 4: Run** — both suites + eslint — clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/EsppPage.tsx src/pages/EsppPage.test.tsx src/pages/CalendarPage.tsx src/pages/CalendarPage.test.tsx
git commit -m "feat(cache): ESPP + Calendar snapshot seed, instant month paging"
```

---

### Task 12: ProjectionPage

**Files:**
- Modify: `src/pages/ProjectionPage.tsx`
- Modify: `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Wire the cache**

Import the cache fns. Keys: `'projection:default'` (the mount run only — knob-driven recalculates are user-parameterized and uncached), `'projection:history'`.

1. Above the component, extract the echo→knobs mapping (today's inline seed, verbatim per-field logic against empty knobs):

```tsx
// The echo IS the seed, for all eight knobs alike (see load()'s comment). Extracted so a
// cache-seeded mount derives the same boxes without waiting for the revalidation.
function knobsFromEcho(res: ProjectionOut): Knobs {
  return {
    annualReturn: shiftPoint(res.annual_return, 2),
    monthlyContribution: res.monthly_contribution,
    annualSpend: res.annual_spend ?? '',
    swr: shiftPoint(res.swr_pct, 2),
    years: String(res.years),
    volatility: res.volatility != null ? shiftPoint(res.volatility, 2) : '',
    inflation: res.inflation != null ? shiftPoint(res.inflation, 2) : '',
    contributionGrowth:
      res.contribution_growth != null ? shiftPoint(res.contribution_growth, 2) : '',
  }
}
```

2. Seed the state (lines 77–96):

```tsx
  const cachedProjection = getSnapshot<ProjectionOut>('projection:default')
  const [data, setData] = useState<ProjectionOut | null>(cachedProjection ?? null)
  const [fromCache, setFromCache] = useState(cachedProjection !== undefined)
```

```tsx
  const [knobs, setKnobs] = useState<Knobs>(() =>
    cachedProjection ? knobsFromEcho(cachedProjection) : EMPTY_KNOBS,
  )
```

```tsx
  const [history, setHistory] = useState<NetWorthTimeseries | null>(
    () => getSnapshot<NetWorthTimeseries>('projection:history') ?? null,
  )
```

```tsx
  const knobsSeeded = useRef(cachedProjection !== undefined)
```

(All other declarations stay.)

3. `load` learns the optional cache key (mirror of ESPP's modeler). Signature: `const load = (params: ProjectionParams = {}, cacheKey?: string) => {`. Its `.then` keeps the whole existing body (including the `knobsSeeded` block, now expressed through the helper) and inserts the recipe at the top:

```tsx
      .then((res) => {
        if (seq !== seqRef.current) return
        if (cacheKey !== undefined) {
          const previous = getSnapshot<ProjectionOut>(cacheKey)
          setSnapshot(cacheKey, res)
          setError(null)
          setMissing(false)
          if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(res)) {
            if (!knobsSeeded.current) {
              knobsSeeded.current = true
              seedKnobs(res)
            }
            return
          }
          setFromCache(false)
        } else {
          setError(null)
          setMissing(false)
        }
        setData(res)
        if (!knobsSeeded.current) {
          knobsSeeded.current = true
          seedKnobs(res)
        }
      })
```

where `seedKnobs` is the existing per-field merge extracted into a component-scoped helper directly above `load` (preserving the blank-only-fills contract):

```tsx
  const seedKnobs = (res: ProjectionOut) => {
    const seed = knobsFromEcho(res)
    setKnobs((current) => ({
      annualReturn: current.annualReturn === '' ? seed.annualReturn : current.annualReturn,
      monthlyContribution:
        current.monthlyContribution === '' ? seed.monthlyContribution : current.monthlyContribution,
      annualSpend: current.annualSpend === '' ? seed.annualSpend : current.annualSpend,
      swr: current.swr === '' ? seed.swr : current.swr,
      years: current.years === '' ? seed.years : current.years,
      volatility: current.volatility === '' ? seed.volatility : current.volatility,
      inflation: current.inflation === '' ? seed.inflation : current.inflation,
      contributionGrowth:
        current.contributionGrowth === '' ? seed.contributionGrowth : current.contributionGrowth,
    }))
  }
```

4. The mount effect (lines 155–158) becomes `load({}, 'projection:default')`. `recalculate` keeps calling `load({...})` with no key.

5. The history effect (lines 160–168) gains the recipe (no seq guard exists there; keep it that way):

```tsx
  useEffect(() => {
    // Mount-only, never on Recalculate: the history doesn't change with the knobs — the
    // horizon reaches the chart through the projection echo instead.
    fetchTimeseries()
      .then((res) => {
        const previous = getSnapshot<NetWorthTimeseries>('projection:history')
        setSnapshot('projection:history', res)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(res)) return
        setHistory(res)
      })
      .catch((err: unknown) =>
        setHistoryError(message(err, 'Failed to load net-worth history')),
      )
  }, [])
```

6. Add `animateEntrance={!fromCache}` to both `<EChart` usages (lines 402 `nwChart`, 424 `chart`).

- [ ] **Step 2: Extend the page tests** — instant-paint (seed `projection:default` + `projection:history`, pending fetches, assert tiles/chart section and the SEEDED KNOB VALUES are up) + revalidation-update; `clearSnapshots()` in `beforeEach`.

- [ ] **Step 3: Run** — page suite + eslint — clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.test.tsx
git commit -m "feat(cache): ProjectionPage default-run + history snapshots, knob echo from seed"
```

---

### Task 13: TaxesPage

**Files:**
- Modify: `src/pages/TaxesPage.tsx`
- Modify: `src/pages/TaxesPage.test.tsx`

- [ ] **Step 1: Wire the cache**

Import the cache fns. Keys: `'taxes:years'`, `` `taxes:detail:${year}:${filingStatus}` `` — helper above the component:

```tsx
function detailKey(year: number, filingStatus: FilingStatus): string {
  return `taxes:detail:${year}:${filingStatus}`
}
```

1. Seed the list-and-selection cluster (lines 85–97). The seeded selection replicates `loadYears`'s pick (latest year), and the seeded detail reads the latest year's key using ITS OWN filing status from the cached row:

```tsx
  const cachedYears = getSnapshot<TaxYearOut[]>('taxes:years')
  const cachedLatest = cachedYears !== undefined ? latestOf(cachedYears) : undefined
  const [years, setYears] = useState<TaxYearOut[]>(cachedYears ?? [])
  const [selection, setSelection] = useState<{ year: number } | null>(
    cachedLatest ? { year: cachedLatest.year } : null,
  )
  const [detail, setDetail] = useState<YearDetail | null>(() =>
    cachedLatest
      ? (getSnapshot<YearDetail>(detailKey(cachedLatest.year, cachedLatest.filing_status)) ??
        null)
      : null,
  )
  const [loading, setLoading] = useState(cachedYears === undefined)
  const [loadedOnce, setLoadedOnce] = useState(cachedYears !== undefined)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newYear, setNewYear] = useState(() =>
    cachedYears !== undefined
      ? String(cachedLatest ? cachedLatest.year + 1 : new Date().getFullYear())
      : '',
  )
  const [creating, setCreating] = useState(false)
```

(Preserve the original explanatory comments on `selection`/`loading`/`loadedOnce`/`busy`. `latestOf` is the module helper `loadYears` already uses; if it is declared below the component, move it above — module-scope hoisting makes either fine for a `function` declaration, but keep source order tidy.)

Note the seeded-empty case: `cachedYears` = `[]` seeds `selection = null` and `busy` stays `true` with nothing to release it until revalidation — that is exactly what `loadYears` handles today (`setBusy(false)` in its no-latest branch), and the revalidation always runs, so no separate release is needed for the seeded case… **but the equality-skip below must replicate that release** (see step 2).

2. `loadYears`'s `.then` (lines 149–163) gains the recipe. On an identical list, everything already on screen came from the same seed — but the empty-list busy release must still fire:

```tsx
      .then((list) => {
        const previous = getSnapshot<TaxYearOut[]>('taxes:years')
        setSnapshot('taxes:years', list)
        setLoadedOnce(true)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(list)) {
          if (!latestOf(list)) setBusy(false) // seeded-empty case: nothing to load
          return
        }
        setYears(list)
        const latest = latestOf(list)
        setNewYear(String(latest ? latest.year + 1 : new Date().getFullYear()))
        if (latest) {
          setSelection({ year: latest.year })
        } else {
          // Fresh database: there is nothing to load, so release the detail flag here —
          // the new-year form IS the page.
          setBusy(false)
        }
      })
```

3. The detail effect (lines 181–207) gains the recipe around its existing body:

```tsx
      .then(([inputs, brackets, summary]) => {
        if (seq !== seqRef.current) return
        const payload: YearDetail = { inputs, brackets, summary }
        const key = detailKey(year, filingStatus)
        const previous = getSnapshot<YearDetail>(key)
        setSnapshot(key, payload)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(payload))
          return
        setDetail(payload)
        // No setError(null) here: every path that selects a year already cleared the
        // banner, and clearing it again would wipe a message raised meanwhile by the
        // list reconcile that runs ALONGSIDE this load (the create flow's).
      })
```

(`filingStatus` is already in the effect's dependency array and closure — read it directly.)

4. `loadYear` (lines 211–220) gains a handler-side peek so year-chip flips to an already-seen year paint instantly:

```tsx
  const loadYear = (year: number) => {
    setBusy(true)
    setError(null)
    // A create error is about the form above, and the form's own state moved on the moment
    // the user navigated — leaving the sentence there would answer a question nobody asked.
    setCreateError(null)
    // Any totals refresh still in flight belongs to the year being left.
    summarySeqRef.current += 1
    // Already-seen year: paint its detail instantly and revalidate underneath.
    const status = years.find((y) => y.year === year)?.filing_status ?? 'single'
    const peeked = getSnapshot<YearDetail>(detailKey(year, status))
    if (peeked !== undefined) setDetail(peeked)
    setSelection({ year })
  }
```

- [ ] **Step 2: Extend the page tests** — (a) instant-paint: seed `taxes:years` + the latest year's detail key, pending fetches, assert the year chips AND the detail panel render before any resolution; (b) revalidation-update with a changed summary; (c) chip flip to a seeded second year paints its detail before its fetch resolves. `clearSnapshots()` in `beforeEach`. Mind the file's existing `filing_status` fixtures — the detail key embeds it.

- [ ] **Step 3: Run** — `npx vitest run src/pages/TaxesPage.test.tsx` + eslint — clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/TaxesPage.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat(cache): TaxesPage year-list + per-year detail snapshots, instant chip flips"
```

---

### Task 14: Full verification

- [ ] **Step 1:** `npx tsc -b` — clean.
- [ ] **Step 2:** `npx vitest run` — fully green (record the count; it must be ≥ the pre-plan count).
- [ ] **Step 3:** `npx eslint src` — clean.
- [ ] **Step 4:** `git status` clean; `git log --oneline` shows the task commits.

---

## Self-review checklist (run before handing back)

- [ ] Every `.then` that stores a snapshot ALSO clears its error state before the equality skip (a stale banner must lift even when data didn't change).
- [ ] No setState is called synchronously in any effect body you touched (react-hooks v7).
- [ ] Seq-guard early-returns still come FIRST in every `.then` that had one.
- [ ] No render-branch (`payload === null ? … : …`) lines were modified — Plan 3 owns those.
- [ ] MonthlyUpdate/Settings/Login/NotFound untouched.
- [ ] `animateEntrance={!fromCache}` present on: Spending ×6, CreditCards ×2, NetWorth ×2, Portfolio ×1, Overview ×3, Comp ×1, Paycheck FlowPanel ×1, Projection ×2. (Taxes, Calendar, ESPP render no page-level charts.)
- [ ] Deep-equality skips compare against the PREVIOUS cache value read BEFORE `setSnapshot` overwrites it.
