# Portfolio + Settings Ownership UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-28 — resolves Task 0's assumptions against the
> now-written backend plan):** (1) The param IS `owner` with the net-worth grammar, on all
> five endpoints; `/portfolio/accounts` GET/PATCH shapes match your Task 1 verbatim.
> (2) One backend behavior your empty-scope/test copy must respect: dividends with no
> account (`account: null` rows) are **household-only** — they appear on All and vanish
> from every person/joint scope by design; if a dividend test fixture carries null
> accounts, scoped views legitimately show fewer rows. (3) Your Task-3 cache surgery
> (owner-keyed snapshots + `shown` ref + peek-seed) is confirmed as the house rule — the
> same class was fixed at 9e20d15; do not weaken it.

**Goal:** Teach the Portfolio page "whose positions are these?" and give Settings the one place portfolio ownership is edited. `PortfolioPage` gains All / \<name\> / \<name\> / Joint owner chips (gated on a household with more than one person), wired into the **five owner-filterable fetches** — holdings, transactions, dividends, allocation (×3 dimensions) and realized. The performance chart, sparklines, securities and refresh status stay **whole-household** and say so in one line whenever a non-All chip is active. An owner scope with no positions renders the panels' existing empty notes, never silent zeros. `Settings → Accounts` gains a compact **Portfolio accounts** table (read-only label, owner select) driving `PATCH /portfolio/accounts/{id}`. **No backend work in this plan** — it lands in the sibling plan first (§Preconditions).

**Architecture:** One ownership vocabulary, shared with net worth: `OwnerScope = number | 'joint' | null`, where `null` sends **no `owner` param at all** so an unscoped request stays byte-identical to the pre-ownership one. `src/api/portfolio.ts` re-exports that type (a type-only import from `./netWorth`, erased at build time — no runtime edge between the two clients) and appends the param through one private `ownerQuery(owner, prefix)` helper, so the `?`-vs-`&` distinction (`/allocation` already carries `by=`) is decided in exactly one place.

On the page, `owner` is page state that participates in the **snapshot cache key**. Today `PortfolioPage` caches under the static key `'portfolio'` and judges its identical-payload revalidation skip against `getSnapshot(SNAPSHOT_KEY)`. That combination is exactly the 2026-08-28 stranding bug class fixed on `NetWorthPage` @9e20d15: render state and cache diverge across a scope switch, and skipping on the cache strands the page on the previous scope forever. So this plan makes **both** changes together — the key becomes `portfolioKey(owner)` → `` `portfolio:${owner ?? 'all'}` ``, and the skip is judged against a `shown` ref holding the snapshot the page is actually *rendering*, with `selectOwner` peek-seeding that ref (and the eleven state slots) from the destination key before flipping the scope. `load()` becomes a `useCallback([owner])` and the mount effect keys on `[load]`, which is how the scope switch actually re-fetches — the same shape `NetWorthPage` uses.

In Settings, the portfolio-accounts table lives **inside** `AccountsCard` (spec §5) but owns its own fetch, error slot and busy flag, deliberately not folded into the net-worth roster's: two tables from two routers, and one being down must not empty the other. The owner select saves **on change** with `person_id` as the only key on the wire — the card's existing `toggleActive` idiom — and always explicitly (`null` for joint), because an omitted key means "leave the owner alone" server-side.

**Tech Stack:** React 19 + TypeScript 5 (strict, `noUnusedLocals`/`noUnusedParameters`) + Vitest 3 + @testing-library/react 16 + ECharts 6 (never rendered in jsdom — house law). No new dependencies, no migrations, no backend files touched.

**Specs:** `docs/superpowers/specs/2026-08-28-household-portfolio-projection-design.md` §4.1, §5 (PortfolioPage / Settings bullets), §6, §7 and §9 Plan 2 are binding for semantics.

**Preconditions (the portfolio-accounts BACKEND plan runs first — do NOT re-create any of it):**
- `owner` query param (`<person_id>` | `joint` | absent) on `GET /portfolio/holdings`, `/allocation`, `/dividends`, `/realized`, `/transactions`, with **scope-consistent totals** (holdings totals, realized totals, dividend analytics all describe the filtered rows). Absent = today's behavior, byte-identical.
- `GET /portfolio/accounts` → `[{id, label, person_id}]` (`person_id` null = joint).
- `PATCH /portfolio/accounts/{id}` accepting `{person_id}` only; labels immutable this batch.
- Wire compatibility: every response that carried `account: str` still carries the same label string, and every request that accepted a free-text `account` still does (new labels get-or-create, owned by the primary person).
- Already on `main` @23e1dc7 and used verbatim: `GET /api/v1/household` + `fetchHousehold()` in `src/api/household.ts`; `PersonOut`/`HouseholdOut` in `src/types/api.ts`; `OwnerScope` in `src/api/netWorth.ts`; `getSnapshot`/`setSnapshot` in `src/api/snapshotCache.ts`.

**House rules that bind every task:**
- Decimal **strings** on the wire — never `Number()` a money value except at a chart/format boundary.
- Comments explain constraints, not narration. No file deletions. Frequent small commits. **Never push.**
- `npx vitest run <file>` is run **bare** (no `--`), from the repo root.
- echarts is never rendered in jsdom; page tests mock `../components/EChart` with a marker div.
- No cache-compared revalidation skips (house rule as of @9e20d15) — compare against rendered state.

---

## File structure

| File | Change |
|---|---|
| `src/types/api.ts` | `PortfolioAccountOut`, `PortfolioAccountUpdate` (after `RealizedResponse`, L377) |
| `src/api/portfolio.ts` | `OwnerScope` re-export, `ownerQuery()`, `owner` arg on five fetches, `fetchPortfolioAccounts`, `patchPortfolioAccount` |
| `src/api/portfolio.test.ts` **(new)** | query-string + PATCH-body plumbing |
| `src/pages/PortfolioPage.tsx` | household fetch, owner chips, `portfolioKey()`, `shown` ref, `selectOwner` peek-seed, `load` → `useCallback`, household hint |
| `src/pages/PortfolioPage.css` | `.portfolio-owner-row` |
| `src/pages/PortfolioPage.test.tsx` **(new)** | chips gate/wiring, household-wide pins, empty scope, snapshot keying, stranding regression |
| `src/components/settings/AccountsCard.tsx` | `aria-label` on the existing table; Portfolio accounts table + its fetch/PATCH/hint |
| `src/components/settings/AccountsCard.test.tsx` | portfolio mock; table-name repairs (8 sites); 5 new tests |
| `src/components/settings/settings.css` | `.portfolio-accounts-heading`, `.portfolio-accounts-table` |
| `src/pages/SettingsPage.test.tsx` | `../api/portfolio` mock + `beforeEach` stub (keeps the card's fetch deterministic) |

---

## Phase 0 — Preconditions & baseline

### Task 0: Verify the backend landed and the toolchain answers

**Files:** none (environment only)

- [ ] **Step 1: Confirm a clean tree on a feature branch.**

```bash
git status --porcelain          # expected: EMPTY
git rev-parse --abbrev-ref HEAD # expected: a feature branch, NOT main
```

If you are on `main`, branch first: `git checkout -b portfolio-ui`. Do not stash or discard anyone else's work.

- [ ] **Step 2: Verify the sibling backend plan's five owner params and the accounts routes exist.**

```bash
grep -n "owner" backend/app/api/portfolio.py | head -20
grep -n "portfolio/accounts\|def .*portfolio_account" backend/app/api/portfolio.py | head -10
```

Expected: an `owner: str | None = Query(None…)`-shaped param on the holdings / allocation / dividends / realized / transactions handlers, **and** a `GET`+`PATCH` pair on an `/accounts` sub-path. If either is missing, the sibling plan has **not** merged — **STOP and report**; nothing below can be verified against a real server.

If the accounts routes are mounted under a different sub-path (e.g. `/portfolio/account-labels`), adapt the two literals in Task 1 and note the substitution in that commit message; nothing else in this plan is affected.

- [ ] **Step 3: Verify the frontend preconditions.**

```bash
grep -n "export type OwnerScope" src/api/netWorth.ts
grep -n "export function fetchHousehold" src/api/household.ts
grep -n "PersonOut\|HouseholdOut" src/types/api.ts | head -4
grep -n "const SNAPSHOT_KEY = 'portfolio'" src/pages/PortfolioPage.tsx
ls src/pages/PortfolioPage.test.tsx 2>/dev/null || echo "NO PortfolioPage test yet (expected)"
```

Expected: `OwnerScope` exported, `fetchHousehold` exported, `PersonOut`/`HouseholdOut` declared, the **static** `'portfolio'` snapshot key present at L99, and **no** `PortfolioPage.test.tsx` (this plan creates it).

- [ ] **Step 4: Establish the frontend baseline.**

```bash
npx vitest run
npx tsc -b
```

Expected: `npx vitest run` green at **1213** tests; `npx tsc -b` silent. If the baseline is red, **STOP and report** — do not build on a red tree.

---

## Phase 1 — Types & client

### Task 1: `owner` on the five fetches + the portfolio-accounts client

**Files:**
- `src/api/portfolio.test.ts` **(new)**
- `src/api/portfolio.ts` (L1–17 imports; L38–40 `fetchTransactions`; L60–62 `fetchDividends`; L86–100 holdings/allocation/realized + new tail)
- `src/types/api.ts` (insert after `RealizedResponse`, L377)

- [ ] **Step 1: Write the failing client test.** Create `src/api/portfolio.test.ts` with EXACTLY this content:

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import {
  fetchAllocation,
  fetchDividends,
  fetchHoldings,
  fetchPortfolioAccounts,
  fetchRealized,
  fetchTransactions,
  patchPortfolioAccount,
} from './portfolio'

// Only the transport is stubbed — the query string this module builds IS the test
// (src/api/netWorth.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const path = () => vi.mocked(api).mock.calls[0][0]
const init = () => vi.mocked(api).mock.calls[0][1]

it('omits owner entirely from all five owner-filterable fetches', async () => {
  // Byte-identical to the pre-ownership requests: absent means household, server-side.
  await fetchHoldings()
  expect(path()).toBe('/portfolio/holdings')
  vi.clearAllMocks()
  await fetchTransactions()
  expect(path()).toBe('/portfolio/transactions')
  vi.clearAllMocks()
  await fetchDividends()
  expect(path()).toBe('/portfolio/dividends')
  vi.clearAllMocks()
  await fetchRealized()
  expect(path()).toBe('/portfolio/realized')
  vi.clearAllMocks()
  await fetchAllocation('industry')
  expect(path()).toBe('/portfolio/allocation?by=industry')
})

it('treats an EXPLICIT null owner as no param at all', async () => {
  // The page always passes its scope, and the household scope IS null — so null and
  // omitted have to build the same string or the household view stops being byte-identical.
  await fetchHoldings(null)
  expect(path()).toBe('/portfolio/holdings')
  vi.clearAllMocks()
  await fetchAllocation('type', null)
  expect(path()).toBe('/portfolio/allocation?by=type')
})

it('sends a person id as the owner scope on the four single-param fetches', async () => {
  await fetchHoldings(7)
  expect(path()).toBe('/portfolio/holdings?owner=7')
  vi.clearAllMocks()
  await fetchTransactions(7)
  expect(path()).toBe('/portfolio/transactions?owner=7')
  vi.clearAllMocks()
  await fetchDividends(7)
  expect(path()).toBe('/portfolio/dividends?owner=7')
  vi.clearAllMocks()
  await fetchRealized(7)
  expect(path()).toBe('/portfolio/realized?owner=7')
})

it('APPENDS the owner to allocation, which already carries by=', async () => {
  // & not ?: /allocation is the only one of the five with a param of its own.
  await fetchAllocation('account', 7)
  expect(path()).toBe('/portfolio/allocation?by=account&owner=7')
  vi.clearAllMocks()
  await fetchAllocation('industry', 'joint')
  expect(path()).toBe('/portfolio/allocation?by=industry&owner=joint')
})

it('sends the joint literal verbatim', async () => {
  await fetchHoldings('joint')
  expect(path()).toBe('/portfolio/holdings?owner=joint')
  vi.clearAllMocks()
  await fetchRealized('joint')
  expect(path()).toBe('/portfolio/realized?owner=joint')
})

it('reads the portfolio-account roster from its own unparameterised endpoint', async () => {
  await fetchPortfolioAccounts()
  expect(path()).toBe('/portfolio/accounts')
  expect(init()).toBeUndefined()
})

it('patches ONLY person_id, and sends an explicit null for joint', async () => {
  await patchPortfolioAccount(4, { person_id: null })
  expect(path()).toBe('/portfolio/accounts/4')
  expect(init()?.method).toBe('PATCH')
  // The key must SURVIVE JSON.stringify: an omitted person_id means "leave the owner
  // alone" server-side, so retagging to joint has to send null on purpose.
  expect(init()?.body).toBe('{"person_id":null}')
  vi.clearAllMocks()
  await patchPortfolioAccount(4, { person_id: 2 })
  expect(init()?.body).toBe('{"person_id":2}')
})
```

- [ ] **Step 2: Run it and see it fail.**

```bash
npx vitest run src/api/portfolio.test.ts
```

Expected failure: `SyntaxError: The requested module './portfolio' does not provide an export named 'fetchPortfolioAccounts'` (the whole file fails to import). That is the correct first failure.

- [ ] **Step 3: Add the two types.** In `src/types/api.ts`, insert this block immediately **after** the closing `}` of `RealizedResponse` (L377) and **before** `export interface RefreshResult` (L379):

```ts
// GET /portfolio/accounts — the labels behind every transaction's and dividend's `account`
// string, with their owner. person_id null = JOINT (the net-worth convention, never
// "unknown": the migration backfilled every pre-existing label to the primary person).
// Labels are immutable this batch — they are the positions' identity.
export interface PortfolioAccountOut {
  id: number
  label: string
  person_id: number | null
}

// PATCH /portfolio/accounts/{id} — person_id ONLY, and always explicitly: an omitted key
// means "leave the owner alone" server-side, so retagging to joint must send null.
export interface PortfolioAccountUpdate {
  person_id: number | null
}
```

- [ ] **Step 4: Rewrite the client's imports and the five fetches.** In `src/api/portfolio.ts`, replace the whole header (L1–17) with:

```ts
import { api } from './client'
import type { OwnerScope } from './netWorth'
import type {
  AllocationDimension,
  AllocationResponse,
  DividendCreate,
  DividendOut,
  DividendUpdate,
  HoldingsResponse,
  PortfolioAccountOut,
  PortfolioAccountUpdate,
  PortfolioHistory,
  RealizedResponse,
  SecurityCreate,
  SecurityOut,
  SecurityUpdate,
  TransactionCreate,
  TransactionOut,
  TransactionUpdate,
} from '../types/api'

// ONE ownership vocabulary across the app (spec §4.1: "net-worth grammar"). Re-exported so
// a caller that only talks to the portfolio endpoints imports the type from the module it
// is calling; `import type` is erased at build time, so this is not a runtime edge between
// the two clients.
export type { OwnerScope }

// The `?`-vs-`&` decision, made once: /holdings, /transactions, /dividends and /realized
// carry no other param, /allocation always carries by=. null builds the EMPTY string — the
// household request has to stay byte-identical to the pre-ownership one.
function ownerQuery(owner: OwnerScope, prefix: '?' | '&'): string {
  return owner === null ? '' : `${prefix}owner=${owner}`
}
```

- [ ] **Step 5: Add the param to `fetchTransactions`.** Replace L38–40 (post-edit line numbers shift; match on the function):

```ts
export function fetchTransactions(owner: OwnerScope = null): Promise<TransactionOut[]> {
  return api<TransactionOut[]>(`/portfolio/transactions${ownerQuery(owner, '?')}`)
}
```

- [ ] **Step 6: Add the param to `fetchDividends`.** Replace the existing `fetchDividends` with:

```ts
export function fetchDividends(owner: OwnerScope = null): Promise<DividendOut[]> {
  return api<DividendOut[]>(`/portfolio/dividends${ownerQuery(owner, '?')}`)
}
```

- [ ] **Step 7: Replace the file's tail (`fetchHoldings` through `fetchRealized`, L86–100) with the scoped versions plus the two new accounts calls:**

```ts
export function fetchHoldings(owner: OwnerScope = null): Promise<HoldingsResponse> {
  return api<HoldingsResponse>(`/portfolio/holdings${ownerQuery(owner, '?')}`)
}

export function fetchAllocation(
  by: AllocationDimension,
  owner: OwnerScope = null,
): Promise<AllocationResponse> {
  return api<AllocationResponse>(`/portfolio/allocation?by=${by}${ownerQuery(owner, '&')}`)
}

// Household-wide by design (spec §2 decision log): one row per Monday, so a per-owner
// series would have nothing honest to say. No owner param here, ever.
export function fetchHistory(): Promise<PortfolioHistory> {
  return api<PortfolioHistory>('/portfolio/history')
}

export function fetchRealized(owner: OwnerScope = null): Promise<RealizedResponse> {
  return api<RealizedResponse>(`/portfolio/realized${ownerQuery(owner, '?')}`)
}

// The label roster — small, unparameterised, and the ONLY place portfolio ownership is
// read for editing (Settings' Portfolio accounts table).
export function fetchPortfolioAccounts(): Promise<PortfolioAccountOut[]> {
  return api<PortfolioAccountOut[]>('/portfolio/accounts')
}

export function patchPortfolioAccount(
  id: number,
  body: PortfolioAccountUpdate,
): Promise<PortfolioAccountOut> {
  return api<PortfolioAccountOut>(`/portfolio/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 8: Run it and see it pass.**

```bash
npx vitest run src/api/portfolio.test.ts
```

Expected: 7 passed.

- [ ] **Step 9: Type gate.**

```bash
npx tsc -b
```

Expected: silent. (`PortfolioPage.tsx` still calls `fetchAllocation('industry')` etc. — every new param has a default, so nothing breaks.)

- [ ] **Step 10: Commit.**

```bash
git add src/api/portfolio.ts src/api/portfolio.test.ts src/types/api.ts
git commit -m "feat(portfolio-ui): owner scope on the five portfolio fetches + accounts client"
```

---

## Phase 2 — PortfolioPage owner chips

### Task 2: The chips, gated on a household with more than one person

**Files:**
- `src/pages/PortfolioPage.test.tsx` **(new)**
- `src/pages/PortfolioPage.tsx` (L1–15 imports; L38–49 type imports; L115–116 component head; L248–253 mount effect; L334–349 header)
- `src/pages/PortfolioPage.css` (append)

- [ ] **Step 1: Write the failing page test.** Create `src/pages/PortfolioPage.test.tsx` with EXACTLY this content (this file is the page's whole harness — it does not exist today):

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSnapshots } from '../api/snapshotCache'
import type {
  AllocationDimension,
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  HouseholdOut,
  PortfolioHistory,
  RealizedResponse,
  RefreshStatus,
  SecurityOut,
  TransactionOut,
} from '../types/api'
import PortfolioPage from './PortfolioPage'

// importOriginal spread: the panels below import mutation helpers from the same module,
// and an unspread factory would blank them (AccountsCard.test.tsx's posture).
vi.mock('../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/portfolio')>()),
  fetchAllocation: vi.fn(),
  fetchDividends: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHoldings: vi.fn(),
  fetchRealized: vi.fn(),
  fetchSecurities: vi.fn(),
  fetchTransactions: vi.fn(),
  updateSecurity: vi.fn(),
}))
vi.mock('../api/prices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/prices')>()),
  fetchPriceHistory: vi.fn(),
  fetchRefreshStatus: vi.fn(),
  fetchSparklines: vi.fn(),
  refreshPrices: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each chart
// DRAWS is pinned in historyChartOptions.test.ts and allocationChartOptions.test.ts; this
// marker exposes only what this page owns: the series names and the entrance flag.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      animateEntrance = true,
    }: {
      option: { series?: { name?: string }[] }
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})

import { fetchHousehold } from '../api/household'
import {
  fetchAllocation,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchRealized,
  fetchSecurities,
  fetchTransactions,
} from '../api/portfolio'
import { fetchRefreshStatus, fetchSparklines } from '../api/prices'

const ME = { id: 1, name: 'Me', is_primary: true }
const SAM = { id: 2, name: 'Sam', is_primary: false }

function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME, SAM], marriage_date: null, ...over }
}

const SECURITIES: SecurityOut[] = [
  {
    id: 1,
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    industry: 'Index',
    holding_type: 'etf',
    is_manual_priced: false,
    is_active: true,
    annual_dividend: '6.00',
    ex_div_date: '2026-06-20',
  },
]

const TRANSACTIONS: TransactionOut[] = [
  {
    id: 11,
    security_id: 1,
    account: 'Fidelity Brokerage',
    type: 'buy',
    txn_date: '2026-01-05',
    shares: '10',
    price: '400.00',
    fees: null,
    split_factor: null,
    sort_index: 0,
    source: 'ui',
    notes: null,
  },
]

const DIVIDENDS: DividendOut[] = [
  {
    id: 21,
    security_id: 1,
    account: 'Fidelity Brokerage',
    pay_date: '2026-06-25',
    amount: '15.00',
    source: 'manual',
    ex_date: null,
    per_share: null,
    shares_held: null,
    notes: null,
  },
]

function holdingsOut(): HoldingsResponse {
  return {
    as_of: '2026-08-27T20:00:00Z',
    latest_quote_at: '2026-08-27T20:00:00Z',
    totals: {
      market_value: '4500.00',
      cost_basis: '4000.00',
      unrealized_gl: '500.00',
      unrealized_gl_pct: '0.125',
      day_change_amount: '10.00',
      day_change_pct: '0.0022',
      realized_gl: '0.00',
      dividends_collected: '15.00',
      annual_income: '60.00',
      unpriced_count: 0,
    },
    holdings: [
      {
        security_id: 1,
        ticker: 'VOO',
        name: 'Vanguard S&P 500 ETF',
        industry: 'Index',
        holding_type: 'etf',
        is_manual_priced: false,
        shares: '10',
        avg_cost: '400.00',
        cost_basis: '4000.00',
        price: '450.00',
        quoted_at: '2026-08-27T20:00:00Z',
        price_source: 'yfinance',
        day_change_pct: '0.0022',
        day_change_amount: '10.00',
        market_value: '4500.00',
        weight_pct: '1.0',
        unrealized_gl: '500.00',
        unrealized_gl_pct: '0.125',
        realized_gl: '0.00',
        dividends_collected: '15.00',
        annual_dividend: '6.00',
        annual_income: '60.00',
        yield_pct: '0.0133',
        yoc_pct: '0.015',
        xirr_pct: '0.09',
        accounts: ['Fidelity Brokerage'],
        warnings: [],
      },
    ],
  }
}

// A scope whose owner holds nothing: scope-consistent ZERO totals, no rows. What the page
// must do with it is render the panels' own empty notes (spec §5).
const EMPTY_HOLDINGS: HoldingsResponse = {
  as_of: null,
  latest_quote_at: null,
  totals: {
    market_value: '0.00',
    cost_basis: '0.00',
    unrealized_gl: '0.00',
    unrealized_gl_pct: null,
    day_change_amount: null,
    day_change_pct: null,
    realized_gl: '0.00',
    dividends_collected: '0.00',
    annual_income: '0.00',
    unpriced_count: 0,
  },
  holdings: [],
}

function allocationOut(by: AllocationDimension): AllocationResponse {
  return {
    by,
    total_market_value: '4500.00',
    slices: [{ key: 'Index', market_value: '4500.00', weight_pct: '1.0', holdings: 1 }],
  }
}

function emptyAllocation(by: AllocationDimension): AllocationResponse {
  return { by, total_market_value: '0.00', slices: [] }
}

// Two dates minimum — portfolioHistoryOption returns null below that.
const HISTORY: PortfolioHistory = {
  dates: ['2026-08-17', '2026-08-24'],
  market_value: ['4400.00', '4500.00'],
  cost_basis: ['4000.00', '4000.00'],
  sp500: ['4300.00', '4450.00'],
  benchmark: ['4350.00', '4480.00'],
}

const REALIZED: RealizedResponse = { total: '0.00', rows: [] }
const STATUS: RefreshStatus = { last: null, next_run_at: null }

const NO_HOLDINGS_NOTE = 'No holdings yet — add transactions below.'

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchHoldings).mockResolvedValue(holdingsOut())
  vi.mocked(fetchSecurities).mockResolvedValue(SECURITIES)
  vi.mocked(fetchTransactions).mockResolvedValue(TRANSACTIONS)
  vi.mocked(fetchDividends).mockResolvedValue(DIVIDENDS)
  vi.mocked(fetchAllocation).mockImplementation((by) => Promise.resolve(allocationOut(by)))
  vi.mocked(fetchSparklines).mockResolvedValue({})
  vi.mocked(fetchHistory).mockResolvedValue(HISTORY)
  vi.mocked(fetchRealized).mockResolvedValue(REALIZED)
  vi.mocked(fetchRefreshStatus).mockResolvedValue(STATUS)
  vi.mocked(fetchHousehold).mockResolvedValue(household())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <PortfolioPage />
    </MemoryRouter>,
  )
}

// Scoped to the Owner group on purpose: the performance card carries RangeChips with an
// "All" of its own (NetWorthPage.test.tsx's lesson).
const ownerChips = () => screen.getByRole('group', { name: 'Owner' })
const chip = (label: string) =>
  [...ownerChips().querySelectorAll('button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement

it('hides the owner chips for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Portfolio')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  // Nothing to choose between: one person makes the chips one-option UI.
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  // The four household-wide fetches never take an argument, before or after this batch.
  expect(fetchSecurities).toHaveBeenCalledWith()
  expect(fetchHistory).toHaveBeenCalledWith()
  expect(fetchSparklines).toHaveBeenCalledWith()
  expect(fetchRefreshStatus).toHaveBeenCalledWith()
  // (The single-person BYTE-IDENTITY pin on the five scoped fetches lands in Task 3,
  // where the scope is actually wired into load().)
})

it('renders All / each person / Joint once a partner exists', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Owner' })
  expect([...chips.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    'All',
    'Me',
    'Sam',
    'Joint',
  ])
  // Primary first, then everyone else by id, joint last — the same order the server uses.
  expect(chip('All').getAttribute('aria-pressed')).toBe('true')
})

it('keeps the page alive when the household endpoint fails', async () => {
  vi.mocked(fetchHousehold).mockRejectedValue(new Error('household down'))
  renderPage()
  // The scope control is an affordance; losing it must cost the chips and nothing else.
  expect(await screen.findByText('Portfolio')).toBeTruthy()
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalled())
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())
})
```

- [ ] **Step 2: Run it and see it fail.**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx
```

Expected failure: the first test passes trivially (no chips exist yet), but **`renders All / each person / Joint once a partner exists` fails** with `Unable to find an accessible element with the role "group" and name "Owner"`. That is the correct first failure.

- [ ] **Step 3: Add the household fetch and the chips.** In `src/pages/PortfolioPage.tsx`:

**(a)** Replace the import header (L1–15) with:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '../api/client'
import { fetchHousehold } from '../api/household'
import {
  fetchAllocation,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchRealized,
  fetchSecurities,
  fetchTransactions,
  updateSecurity,
} from '../api/portfolio'
import type { OwnerScope } from '../api/portfolio'
import { fetchRefreshStatus, fetchSparklines, refreshPrices } from '../api/prices'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
```

**(b)** Add `HouseholdOut` to the type import block (L38–49), keeping it alphabetical:

```tsx
import type {
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  HouseholdOut,
  PortfolioHistory,
  RealizedResponse,
  RefreshResult,
  RefreshStatus,
  SecurityOut,
  SparklinesResponse,
  TransactionOut,
} from '../types/api'
```

**(c)** Immediately after `const [detailTicker, setDetailTicker] = useState<string | null>(null)` (L160), insert the scope + household state:

```tsx
  // The page's ownership scope: null = the whole household (and NO owner param at all, so
  // the requests stay byte-identical to the pre-ownership ones). It scopes the tiles, the
  // holdings table, the allocation charts and the three record tabs — which is why the
  // chips sit under the page header rather than inside one card.
  const [owner, setOwner] = useState<OwnerScope>(null)
  // Fetched on its own, never inside the page's Promise.all: the chips are an affordance,
  // and a household hiccup must not blank the portfolio (NetWorthPage's isolated-fetch
  // posture). null covers both "not loaded yet" and "failed".
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
```

**(d)** Immediately after the mount effect (L248–253), add the household effect:

```tsx
  // Once per visit, and deliberately not part of `load`: setState lives in the promise
  // continuations, never in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    fetchHousehold()
      .then(setHousehold)
      .catch(() => setHousehold(null))
  }, [])
```

**(e)** Immediately before `const totals = holdings?.totals` (L272), add the roster derivation:

```tsx
  // Primary first, then everyone else by id — the same order the server uses, so these
  // chips read left-to-right like the net-worth ones. The `?? []` lives INSIDE the memo: a
  // fresh literal in the dep list would re-sort on every render, which is the memo doing
  // nothing.
  const orderedPeople = useMemo(
    () =>
      [...(household?.people ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [household],
  )
  // One person means there is nothing to choose between: no chips at all.
  const ownerScopes: { scope: OwnerScope; label: string }[] =
    orderedPeople.length > 1
      ? [
          { scope: null, label: 'All' },
          ...orderedPeople.map((p) => ({ scope: p.id as OwnerScope, label: p.name })),
          { scope: 'joint' as OwnerScope, label: 'Joint' },
        ]
      : []
```

**(f)** Add the handler `selectOwner` immediately after `reload` (L240–243). This task ships the state half only — the chip highlights, and **Task 3 makes it fetch** (the mount effect is still mount-only here):

```tsx
  // Scope switches dim the body rather than swapping in the skeleton: a chip must not
  // unmount the panels (and the tab the user is reading) under them.
  const selectOwner = (next: OwnerScope) => {
    if (next === owner) return
    setReloading(true)
    setError(null)
    // The open drill-in holds a TICKER the next scope may not own — close it rather than
    // leave a detail panel resolving to null.
    setDetailTicker(null)
    setOwner(next)
  }
```

**(g)** Immediately after the closing `</header>` (L349) and **before** the refresh-note `<div>`, add the chips row:

```tsx
      {ownerScopes.length > 0 && (
        <div className="portfolio-owner-row">
          <span className="eyebrow">Whose money</span>
          <div className="segmented" role="group" aria-label="Owner">
            {ownerScopes.map(({ scope, label }) => (
              <button
                key={label}
                type="button"
                className={owner === scope ? 'active' : ''}
                aria-pressed={owner === scope}
                onClick={() => selectOwner(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          <InfoHint text="A person's view is their own portfolio accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts. Performance, sparklines and price refresh always cover the whole household." />
        </div>
      )}
```

- [ ] **Step 4: Add the row's CSS.** Append to `src/pages/PortfolioPage.css`:

```css
/* Page-level ownership scope (2026-08-28 spec §5). It sits directly under the header
   because it scopes the tiles too — a control that changes the hero number must not be
   buried in a card header. Mirrors .networth-owner-row; neither file reaches into the
   other. */
.portfolio-owner-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.portfolio-owner-row .eyebrow { margin: 0; }
```

- [ ] **Step 5: Run it and see it pass.**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx
```

Expected: 3 passed.

- [ ] **Step 6: Gates.**

```bash
npx tsc -b
npx eslint src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
```

Expected: both silent. If eslint reports `'owner' is assigned a value but never used` — it is used by the chips' `className`/`aria-pressed`; re-check step 3(f) landed.

- [ ] **Step 7: Commit.**

```bash
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.css src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio-ui): owner chips on PortfolioPage, gated on a multi-person household"
```

---

### Task 3: Wire the scope into the five fetches, re-key the snapshot, kill the cache-compared skip

**Files:**
- `src/pages/PortfolioPage.test.tsx` (append)
- `src/pages/PortfolioPage.tsx` (L99 `SNAPSHOT_KEY`; L116 `cached`; L174 `seqRef` area; L180–236 `load`; L240–253 `reload`/`selectOwner`/mount effect)

- [ ] **Step 1: Append the failing tests.** Add to the END of `src/pages/PortfolioPage.test.tsx`:

```tsx
it('scopes the five owner-filterable fetches to the picked chip, and back on All', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  const historyCallsBefore = vi.mocked(fetchHistory).mock.calls.length

  fireEvent.click(chip('Sam'))
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(SAM.id))
  expect(fetchTransactions).toHaveBeenCalledWith(SAM.id)
  expect(fetchDividends).toHaveBeenCalledWith(SAM.id)
  expect(fetchRealized).toHaveBeenCalledWith(SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('industry', SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('type', SAM.id)
  expect(fetchAllocation).toHaveBeenCalledWith('account', SAM.id)
  expect(chip('Sam').getAttribute('aria-pressed')).toBe('true')
  expect(chip('All').getAttribute('aria-pressed')).toBe('false')
  // The household-wide four ride the SAME load() but never gain a scope: the weekly
  // series is one row per Monday by design (spec §2 decision log).
  expect(vi.mocked(fetchHistory).mock.calls.length).toBeGreaterThan(historyCallsBefore)
  expect(fetchHistory).toHaveBeenLastCalledWith()
  expect(fetchSecurities).toHaveBeenLastCalledWith()
  expect(fetchSparklines).toHaveBeenLastCalledWith()
  expect(fetchRefreshStatus).toHaveBeenLastCalledWith()

  fireEvent.click(chip('Joint'))
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith('joint'))
  expect(fetchAllocation).toHaveBeenCalledWith('type', 'joint')

  fireEvent.click(chip('All'))
  // null, not omitted: the client turns null into no param at all (portfolio.test.ts).
  await waitFor(() => expect(fetchHoldings).toHaveBeenLastCalledWith(null))
  expect(fetchRealized).toHaveBeenLastCalledWith(null)
  expect(fetchAllocation).toHaveBeenLastCalledWith('account', null)
})

it('re-clicking the active chip spends no request', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledTimes(1))
  fireEvent.click(chip('All'))
  expect(vi.mocked(fetchHoldings).mock.calls.length).toBe(1)
})

it('paints instantly from a seeded snapshot under the household key and revalidates', () => {
  // 'portfolio:all' — the key mount READS and mount's load() WRITES. A static 'portfolio'
  // key would make every scope share one slot.
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  // Never-resolving holdings: whatever is on screen came from the seed alone.
  vi.mocked(fetchHoldings).mockReturnValue(new Promise(() => {}))
  const { container } = renderPage()
  expect(screen.getByText('Portfolio value')).toBeTruthy()
  expect(container.querySelector('.page-skeleton')).toBeNull()
  // Revalidating under the house dim, and the request really went out.
  expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
  expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
  // A cached paint renders the performance chart still. [0] and not .every(): the
  // allocation panel's two charts take no animateEntrance prop at all (they redraw on
  // their own dimension toggle), so only this one carries the flag.
  expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('false')
})

it('leaves the charts still when the revalidation payload is identical', async () => {
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  const { container } = renderPage()
  // The dim lifting is the revalidation landing — .finally runs on every resolution.
  await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
  expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('false')
})

it('a single-person household issues the pre-ownership requests, scope-free', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalled())
  // Byte-identity pin (spec §7): null is what the client turns into NO param at all
  // (portfolio.test.ts), so a one-person household sends exactly the eleven pre-ownership
  // requests — and there are no chips to send anything else.
  expect(fetchHoldings).toHaveBeenCalledWith(null)
  expect(fetchTransactions).toHaveBeenCalledWith(null)
  expect(fetchDividends).toHaveBeenCalledWith(null)
  expect(fetchRealized).toHaveBeenCalledWith(null)
  expect(fetchAllocation).toHaveBeenCalledWith('industry', null)
  expect(fetchAllocation).toHaveBeenCalledWith('type', null)
  expect(fetchAllocation).toHaveBeenCalledWith('account', null)
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
})

it('keys the snapshot by owner — a chip flip is a cache MISS that re-arms the charts', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  setSnapshot('portfolio:all', {
    holdings: holdingsOut(),
    securities: SECURITIES,
    transactions: TRANSACTIONS,
    dividends: DIVIDENDS,
    industry: allocationOut('industry'),
    byType: allocationOut('type'),
    byAccount: allocationOut('account'),
    sparklines: {},
    history: HISTORY,
    realized: REALIZED,
    refreshStatus: STATUS,
  })
  renderPage()
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(null))
  fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))
  await waitFor(() => expect(fetchHoldings).toHaveBeenCalledWith(SAM.id))
  // Different key, so the household payload can never satisfy the equality skip.
  await waitFor(() =>
    expect(screen.getAllByTestId('echart')[0].getAttribute('data-animate')).toBe('true'),
  )
})

// ── Owner-switch stranding regression (2026-08-28 bug class, fixed on NetWorthPage
// @9e20d15) ──────────────────────────────────────────────────────────────────────────────
// The identical-payload revalidation skip must be judged against the RENDERED snapshot,
// never against the snapshot cache: render and cache diverge across a scope switch (the
// previous scope is still on screen while the next scope's key is already warm), so a
// cache-compared skip left the empty owner view on screen forever.
it('restores the household view after visiting an owner with no positions', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  vi.mocked(fetchAllocation).mockImplementation((by, scope) =>
    Promise.resolve(scope === SAM.id ? emptyAllocation(by) : allocationOut(by)),
  )
  vi.mocked(fetchTransactions).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? [] : TRANSACTIONS),
  )
  vi.mocked(fetchDividends).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? [] : DIVIDENDS),
  )
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())

  fireEvent.click(chip('Sam'))
  expect(await screen.findByText(NO_HOLDINGS_NOTE)).toBeTruthy()

  fireEvent.click(chip('All'))
  // Peek-seed: the warm destination key paints BEFORE its revalidation lands.
  expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull()
  // And the revalidation — whose payload is identical to that warm snapshot — must not
  // undo it or skip its way back into the empty view.
  await waitFor(() => expect(fetchHoldings).toHaveBeenLastCalledWith(null))
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())
})
```

Add `setSnapshot` to the snapshot-cache import at the top of the file (it currently imports `clearSnapshots` only):

```tsx
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
```

- [ ] **Step 2: Run and see them fail.**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx
```

Expected failures: `scopes the five owner-filterable fetches…` fails on `expected "fetchHoldings" to be called with arguments: [ 2 ]` (the chip is inert), and the three snapshot tests fail because nothing is written to `portfolio:all` (the seeded paint shows the skeleton instead of `Portfolio value`).

- [ ] **Step 3: Replace the static key with an owner-keyed one.** In `src/pages/PortfolioPage.tsx`, replace L99 (`const SNAPSHOT_KEY = 'portfolio'`) with:

```tsx
// Keyed by the fetch parameters, exactly like NetWorthPage's netWorthKey: an owner switch
// is a DIFFERENT snapshot. 'all' spells the household view so the key can never collide
// with a person id.
function portfolioKey(owner: OwnerScope): string {
  return `portfolio:${owner ?? 'all'}`
}
```

- [ ] **Step 4: Seed from the household key and add the `shown` ref.** Replace L116 (`const cached = getSnapshot<PortfolioSnapshot>(SNAPSHOT_KEY)`) with:

```tsx
  // The initial fetch scope is the whole household, so the mount seed reads exactly the
  // key that mount's load() will write.
  const cached = getSnapshot<PortfolioSnapshot>(portfolioKey(null))
```

And immediately after the `seqRef` declaration (L174), add:

```tsx
  // What the page is actually SHOWING. The revalidation skip in load() is judged against
  // this, never against the snapshot cache: render and cache diverge across an owner
  // switch (the previous scope's panels are still up while the next scope's key is warm),
  // and skipping on the cache stranded the page on the previous scope forever (the
  // 2026-08-28 bug NetWorthPage fixed @9e20d15 — no cache-compared skips, house rule).
  const shown = useRef<PortfolioSnapshot | null>(cached ?? null)
```

- [ ] **Step 5: Rewrite `load` as a scoped `useCallback`.** Replace the whole `load` (L180–236) with:

```tsx
  // Promise callbacks, no setState in the effect's synchronous body — house react-hooks
  // law (see NetWorthPage). One load() refetches EVERYTHING: eleven cheap local queries,
  // and every mutation path (panels' onChanged, refresh) converges through it. Returns
  // the chain so callers can keep their own busy flag up until the data is on screen.
  // useCallback over [owner] because the mount effect keys on it: flipping the scope IS
  // what re-runs the effect, and exhaustive-deps requires the dependency now that load
  // reads a reactive value.
  const load = useCallback(() => {
    const seq = ++seqRef.current
    return Promise.all([
      fetchHoldings(owner),
      fetchSecurities(),
      fetchTransactions(owner),
      fetchDividends(owner),
      fetchAllocation('industry', owner),
      fetchAllocation('type', owner),
      fetchAllocation('account', owner),
      fetchSparklines(),
      fetchHistory(),
      fetchRealized(owner),
      fetchRefreshStatus(),
    ])
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
        setSnapshot(portfolioKey(owner), snapshot)
        setError(null)
        // Identical payload: nothing re-renders, the charts stay still (spec §1) — judged
        // against the RENDERED snapshot, never the cache (see `shown`).
        if (shown.current !== null && JSON.stringify(shown.current) === JSON.stringify(snapshot))
          return
        shown.current = snapshot
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
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Failed to load portfolio data')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }, [owner])
```

Add `useCallback` to the React import (step 3(a) of Task 2 wrote `useEffect, useMemo, useRef, useState`):

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 6: Key the mount effect on `load` and give `selectOwner` its peek-seed.** Replace the block from `reload` through the mount effect (L240–253 as shipped by Task 2, i.e. `reload`, `selectOwner`, the mount `useEffect`) with:

```tsx
  // Panel mutations refetch WITHOUT unmounting the panels (a spinner swap would throw
  // away the form the user is typing in) — the body dims instead.
  const reload = () => {
    setReloading(true)
    load().finally(() => setReloading(false))
  }

  // Scope switches dim the body rather than swapping in the skeleton: a chip must not
  // unmount the panels (and the tab the user is reading) under them.
  const selectOwner = (next: OwnerScope) => {
    if (next === owner) return
    setReloading(true)
    setError(null)
    // The open drill-in holds a TICKER the next scope may not own — close it rather than
    // leave a detail panel resolving to null.
    setDetailTicker(null)
    // Already-seen scope: paint it instantly and revalidate underneath (NetWorthPage's
    // selectOwner). Seeding `shown` here is what keeps load()'s equality skip truthful —
    // the guard is about what is RENDERED, and the destination payload is about to be it.
    const peeked = getSnapshot<PortfolioSnapshot>(portfolioKey(next))
    if (peeked !== undefined) {
      shown.current = peeked
      setFromCache(true)
      setHoldings(peeked.holdings)
      setSecurities(peeked.securities)
      setTransactions(peeked.transactions)
      setDividends(peeked.dividends)
      setIndustry(peeked.industry)
      setByType(peeked.byType)
      setByAccount(peeked.byAccount)
      setSparklines(peeked.sparklines)
      setHistory(peeked.history)
      setRealized(peeked.realized)
      setRefreshStatus(peeked.refreshStatus)
    }
    setOwner(next)
  }

  // Mount AND every owner switch: `load` changes identity with the scope, which is what
  // re-runs this effect. A cache hit revalidates under the reload dim (raised by
  // `reloading`'s initializer on mount, by selectOwner on a switch); the trailing release
  // is a no-op on a cold mount, where `reloading` never went up.
  useEffect(() => {
    load().finally(() => setReloading(false))
  }, [load])
```

- [ ] **Step 7: Run and see them pass.**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx
```

Expected: 10 passed.

- [ ] **Step 8: Gates.**

```bash
npx tsc -b
npx eslint src/pages/PortfolioPage.tsx
```

Expected: both silent. If eslint reports `react-hooks/exhaustive-deps` on the mount effect, the `[load]` dependency in step 6 did not land. If it reports `preserve-manual-memoization` on `load`, the `useCallback` dep array must be exactly `[owner]` — nothing else in the body is reactive.

- [ ] **Step 9: Whole-suite regression check** (the snapshot key moved; confirm no other page reads `'portfolio'`):

```bash
grep -rn "'portfolio'" src/ --include=*.ts --include=*.tsx
npx vitest run
```

Expected: the grep finds nothing outside `src/api/portfolio.ts`'s route strings; the suite is green at **1213 + 10 + 7 = 1230**.

- [ ] **Step 10: Commit.**

```bash
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio-ui): owner-keyed portfolio snapshot + rendered-state revalidation guard"
```

---

### Task 4: The household-wide hint and the empty-scope notes

**Files:**
- `src/pages/PortfolioPage.test.tsx` (append)
- `src/pages/PortfolioPage.tsx` (Performance panel title row, L454–461)

- [ ] **Step 1: Append the failing tests.** Add to the END of `src/pages/PortfolioPage.test.tsx`:

```tsx
// Pinned verbatim: this sentence is the page's only defence against reading the weekly
// performance line as one person's (spec §5).
const HOUSEHOLD_HINT =
  'Performance, sparklines and price refresh always cover the whole household — the owner ' +
  'chips scope holdings, allocation, dividends, transactions and realized gains.'

it('says the performance card is household-wide only while a scope is active', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  // Nothing is scoped on All, so the caveat would be noise.
  expect(screen.queryByText(HOUSEHOLD_HINT)).toBeNull()

  fireEvent.click(chip('Sam'))
  expect(await screen.findByText(HOUSEHOLD_HINT)).toBeTruthy()

  fireEvent.click(chip('Joint'))
  expect(screen.getByText(HOUSEHOLD_HINT)).toBeTruthy()

  fireEvent.click(chip('All'))
  await waitFor(() => expect(screen.queryByText(HOUSEHOLD_HINT)).toBeNull())
})

it('renders the panels real empty notes for an owner who holds nothing', async () => {
  vi.mocked(fetchHoldings).mockImplementation((scope) =>
    Promise.resolve(scope === SAM.id ? EMPTY_HOLDINGS : holdingsOut()),
  )
  vi.mocked(fetchAllocation).mockImplementation((by, scope) =>
    Promise.resolve(scope === SAM.id ? emptyAllocation(by) : allocationOut(by)),
  )
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  await waitFor(() => expect(screen.queryByText(NO_HOLDINGS_NOTE)).toBeNull())

  fireEvent.click(chip('Sam'))
  // HoldingsTable's OWN note, not an empty table that reads as a rendering bug.
  expect(await screen.findByText(NO_HOLDINGS_NOTE)).toBeTruthy()
  // The treemap and the donut both fall back to their notes rather than empty canvases.
  expect(screen.getAllByText('No priced holdings yet.').length).toBe(2)
  // And the performance chart is still up: it is household-wide, and the hint says so.
  expect(screen.getByText(HOUSEHOLD_HINT)).toBeTruthy()
  expect(screen.getAllByTestId('echart').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run and see them fail.**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx
```

Expected failure: `Unable to find an element with the text: Performance, sparklines and price refresh always cover the whole household — …`.

- [ ] **Step 3: Render the hint.** In `src/pages/PortfolioPage.tsx`, inside the Performance `<section className="panel">`, immediately after the closing `</div>` of `panel-title-row` (L461) and **before** the `{performanceOption && history ? (` ternary, insert:

```tsx
            {/* Outside the ternary on purpose: the caveat is true whether or not there is
                a history to draw, and it only appears once a chip has actually narrowed
                the rest of the page (spec §5 — on All it would be noise). */}
            {owner !== null && (
              <p className="hint">
                Performance, sparklines and price refresh always cover the whole household —
                the owner chips scope holdings, allocation, dividends, transactions and
                realized gains.
              </p>
            )}
```

- [ ] **Step 4: Run and see them pass.**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx
```

Expected: 12 passed. If `says the performance card is household-wide…` fails on whitespace, the JSX text node must normalize to exactly the `HOUSEHOLD_HINT` string — testing-library collapses newlines and indentation, so keep the em dash as a literal `—` and do not insert `{' '}` anywhere inside the sentence.

- [ ] **Step 5: Gates + commit.**

```bash
npx tsc -b
npx eslint src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio-ui): household-wide caveat on the performance card + empty-scope pins"
```

---

## Phase 3 — Settings portfolio accounts

### Task 5: The Portfolio accounts table in the Accounts card

**Files:**
- `src/components/settings/AccountsCard.test.tsx` (mock block L8–15; 8 table lookups at L57/61/73/97/117/130/147/165; append 5 tests)
- `src/components/settings/AccountsCard.tsx` (L1–9 imports; L42–50 state; L52–70 load/effect; L151–155 derivations; L267 table tag; L344–348 tail)
- `src/components/settings/settings.css` (append)
- `src/pages/SettingsPage.test.tsx` (mock block after L54; `beforeEach` L208–215)

- [ ] **Step 1: Repair the existing test's table lookups and add the portfolio mock.** In `src/components/settings/AccountsCard.test.tsx`:

**(a)** After the existing `vi.mock('../../api/netWorth', …)` block (L8–14) and its import line (L15), add:

```tsx
vi.mock('../../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/portfolio')>()),
  fetchPortfolioAccounts: vi.fn(),
  patchPortfolioAccount: vi.fn(),
}))
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
```

**(b)** Add `PortfolioAccountOut` to the type import (L4):

```tsx
import type { AccountOut, PersonOut, PortfolioAccountOut } from '../../types/api'
```

**(c)** Add the fixtures and the mock defaults. After the `HSA` fixture (L41), add:

```tsx
const BROKERAGE: PortfolioAccountOut = { id: 30, label: 'Fidelity Brokerage', person_id: 1 }
const JOINT_ROTH: PortfolioAccountOut = { id: 31, label: 'Joint Roth', person_id: null }
```

and inside `beforeEach` (L43–48) append:

```tsx
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([BROKERAGE, JOINT_ROTH])
  vi.mocked(patchPortfolioAccount).mockResolvedValue({ ...BROKERAGE, person_id: 2 })
```

**(d)** The card now renders **two** tables, so every bare `getByRole('table')`/`findByRole('table')` becomes ambiguous. Replace each of the 8 sites, keeping their surrounding code untouched:

- L57: `const roster = () => within(screen.getByRole('table'))` →
  ```tsx
  // Every roster assertion is scoped to the NET-WORTH table: account names are also options
  // in the parent select, owner names are also options in both owner selects, and the card
  // now carries a second table (Portfolio accounts).
  const roster = () => within(screen.getByRole('table', { name: 'Net-worth accounts' }))
  ```
- L61: `const table = within(await screen.findByRole('table'))` → `const table = within(await screen.findByRole('table', { name: 'Net-worth accounts' }))`
- L73, L97, L117, L130, L147, L165: `await screen.findByRole('table')` → `await screen.findByRole('table', { name: 'Net-worth accounts' })`

**(e)** Append the five new tests to the END of the file:

```tsx
const portfolioTable = () =>
  within(screen.getByRole('table', { name: 'Portfolio accounts' }))

it('lists the portfolio labels with their owner, joint spelled out', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  expect(portfolioTable().getByText('Fidelity Brokerage')).toBeTruthy()
  expect(portfolioTable().getByText('Joint Roth')).toBeTruthy()
  // The label is read-only TEXT this batch — it is the positions' identity, and the
  // server refuses to rename it.
  expect(portfolioTable().queryByRole('textbox')).toBeNull()
  // A NULL owner selects the Joint option, never a blank one.
  expect((screen.getByLabelText('Owner for Fidelity Brokerage') as HTMLSelectElement).value).toBe('1')
  expect((screen.getByLabelText('Owner for Joint Roth') as HTMLSelectElement).value).toBe('')
})

it('retags a portfolio account ON CHANGE with person_id alone', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  fireEvent.change(screen.getByLabelText('Owner for Fidelity Brokerage'), {
    target: { value: '2' },
  })

  await waitFor(() => expect(vi.mocked(patchPortfolioAccount)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(patchPortfolioAccount).mock.calls[0]).toEqual([30, { person_id: 2 }])
  // The round trip re-reads the roster rather than trusting the local select.
  await waitFor(() => expect(vi.mocked(fetchPortfolioAccounts)).toHaveBeenCalledTimes(2))
  // ONLY person_id on the wire: labels are immutable and sending them back would let a
  // stale render overwrite a concurrent edit (the card's toggleActive rule).
  expect(Object.keys(vi.mocked(patchPortfolioAccount).mock.calls[0][1])).toEqual(['person_id'])
})

it('retags a portfolio account to joint with an EXPLICIT null', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  fireEvent.change(screen.getByLabelText('Owner for Fidelity Brokerage'), {
    target: { value: '' },
  })

  await waitFor(() => expect(vi.mocked(patchPortfolioAccount)).toHaveBeenCalledTimes(1))
  const body = vi.mocked(patchPortfolioAccount).mock.calls[0][1]
  // The key must SURVIVE: an omitted person_id means "leave the owner alone" server-side.
  expect(Object.keys(body)).toContain('person_id')
  expect(body.person_id).toBeNull()
})

it('names the default owner for labels typed on a transaction', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Portfolio accounts' })

  // The one honesty note the spec requires (§6): a new label is created silently, owned by
  // the primary person, and this table is where it is re-tagged.
  expect(
    screen.getByText(
      'A new account label typed on a transaction or dividend is created owned by Me — ' +
        're-tag it here. The labels themselves are fixed: they identify the positions.',
    ),
  ).toBeTruthy()
})

it('keeps the net-worth roster alive when the portfolio labels fail to load', async () => {
  vi.mocked(fetchPortfolioAccounts).mockRejectedValue(
    new ApiError('portfolio accounts unavailable', 503),
  )
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Two tables from two routers: one being down must not empty the other.
  expect(await screen.findByText('portfolio accounts unavailable')).toBeTruthy()
  expect(roster().getByText('Fidelity HSA')).toBeTruthy()
  expect(screen.queryByRole('table', { name: 'Portfolio accounts' })).toBeNull()
})
```

- [ ] **Step 2: Run and see it fail.**

```bash
npx vitest run src/components/settings/AccountsCard.test.tsx
```

Expected failure: every test fails at `Unable to find an accessible element with the role "table" and name "Net-worth accounts"` (the table has no accessible name yet) — the correct first failure.

- [ ] **Step 3: Implement the card changes.** In `src/components/settings/AccountsCard.tsx`:

**(a)** Replace the import header (L1–9) with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { createAccount, deleteAccount, fetchAccounts, updateAccount } from '../../api/netWorth'
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'
import type {
  AccountGroup,
  AccountOut,
  PersonOut,
  PortfolioAccountOut,
} from '../../types/api'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'
```

**(b)** Immediately after `const seqRef = useRef(0)` (L49), add the second table's state:

```tsx
  // The portfolio labels get their OWN fetch, error slot, busy flag and seq guard —
  // deliberately not folded into the roster's above. Two tables from two routers, and one
  // being down must not empty the other (SystemCard's per-card posture).
  const [portfolioAccounts, setPortfolioAccounts] = useState<PortfolioAccountOut[]>([])
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  const [portfolioBusy, setPortfolioBusy] = useState(false)
  const portfolioSeqRef = useRef(0)
```

**(c)** Immediately after the roster's `load` (L52–65) and **before** the mount effect (L67–70), add:

```tsx
  const loadPortfolio = () => {
    const seq = ++portfolioSeqRef.current
    fetchPortfolioAccounts()
      .then((rows) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioAccounts(rows)
        setPortfolioError(null)
        setPortfolioLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioError(message(err, 'Could not load portfolio accounts.'))
      })
  }

  // ON CHANGE, one field on the wire — the card's toggleActive idiom. person_id is the only
  // column this control owns (labels are immutable server-side this batch), and the value
  // travels EXPLICITLY: an omitted key means "leave the owner alone", so clearing the
  // select has to send null on purpose.
  const retagPortfolioAccount = (account: PortfolioAccountOut, value: string) => {
    setPortfolioBusy(true)
    setPortfolioError(null)
    patchPortfolioAccount(account.id, { person_id: value === '' ? null : Number(value) })
      .then(() => loadPortfolio())
      .catch((err: unknown) => setPortfolioError(message(err, 'Could not retag the account.')))
      .finally(() => setPortfolioBusy(false))
  }
```

**(d)** Replace the mount effect (L67–70) with:

```tsx
  useEffect(() => {
    load()
    loadPortfolio()
    // mount-only: two plain functions over stable setters (house idiom)
  }, [])
```

**(e)** Immediately after `const parentOptions = accounts.filter((a) => a.id !== editingId)` (L155), add:

```tsx
  // Named in the hint below: the get-or-create on a new transaction label owns it to the
  // primary person, and this table is the only place that can be undone.
  const primaryName = people.find((p) => p.is_primary)?.name ?? 'the primary person'
```

**(f)** Give the existing table its accessible name — replace L267 (`<table className="data-table accounts-table">`) with:

```tsx
              {/* Named because the card now carries TWO tables (screen readers and the
                  role queries both need to tell them apart). */}
              <table className="data-table accounts-table" aria-label="Net-worth accounts">
```

**(g)** Add the second table. Replace the card's tail — the `)}` closing the `{loaded && (` fragment and the `</section>` (L345–348) — with:

```tsx
        </>
      )}

      {/* Portfolio accounts (2026-08-28 spec §5): the labels behind the positions ledger,
          and the ONE place their ownership is edited. Rendered OUTSIDE the roster's
          `loaded` gate on purpose — a net-worth GET that failed says nothing about the
          portfolio router. */}
      <h3 className="eyebrow portfolio-accounts-heading">
        Portfolio accounts
        <InfoHint text="The account labels your transactions and dividends are filed under. Owner blank = joint; a person's Portfolio view is their own labels plus the joint ones. Labels are fixed here — they are the positions' identity." />
      </h3>
      {portfolioError && (
        <div className="error-banner" role="alert">
          {portfolioError}{' '}
          <button className="button" onClick={loadPortfolio}>
            Retry
          </button>
        </div>
      )}
      {!portfolioLoaded && portfolioError === null && (
        <p className="empty-note">Loading portfolio accounts…</p>
      )}
      {portfolioLoaded &&
        (portfolioAccounts.length === 0 ? (
          <p className="empty-note">
            No portfolio accounts yet — one appears the first time a transaction or dividend
            names an account.
          </p>
        ) : (
          <>
            <div className="settings-scroll">
              <table
                className="data-table portfolio-accounts-table"
                aria-label="Portfolio accounts"
              >
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolioAccounts.map((account) => (
                    <tr key={account.id}>
                      {/* Read-only text, not an input: renaming a label would orphan every
                          position filed under it, and the server refuses it. */}
                      <td>{account.label}</td>
                      <td>
                        <select
                          className="field-input"
                          aria-label={`Owner for ${account.label}`}
                          value={account.person_id === null ? '' : String(account.person_id)}
                          disabled={portfolioBusy}
                          onChange={(e) => retagPortfolioAccount(account, e.target.value)}
                        >
                          <option value="">Joint</option>
                          {people.map((person) => (
                            <option key={person.id} value={String(person.id)}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="settings-note">
              A new account label typed on a transaction or dividend is created owned by{' '}
              {primaryName} — re-tag it here. The labels themselves are fixed: they identify
              the positions.
            </p>
          </>
        ))}
    </section>
  )
}
```

- [ ] **Step 4: Add the CSS.** Append to `src/components/settings/settings.css`:

```css
/* The Accounts card's SECOND table (2026-08-28 spec §5). Its heading needs the top gap the
   single-table layout never had, and the owner select needs a floor width or the longest
   name reflows the column on every retag. */
.portfolio-accounts-heading {
  margin-top: 1.25rem;
}

.portfolio-accounts-table select.field-input {
  min-width: 9rem;
}
```

- [ ] **Step 5: Run and see it pass.**

```bash
npx vitest run src/components/settings/AccountsCard.test.tsx
```

Expected: 12 passed (7 repaired + 5 new).

- [ ] **Step 6: Keep the SettingsPage suite deterministic.** `AccountsCard` now issues a third fetch, and `SettingsPage.test.tsx` does not stub it — an unmocked call rejects into a second `role="alert"` and a second `Retry` button, which its `banners a failed load and refetches on Retry` test (L378–393) would race. In `src/pages/SettingsPage.test.tsx`:

**(a)** After the `vi.mock('../api/spending', …)` block (ends L54) and before the import lines (L55+), add:

```tsx
// AccountsCard's Portfolio-accounts table owns a fetch of its own; unmocked it would make
// a real network call from every test in this file (and banner its failure).
vi.mock('../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/portfolio')>()),
  fetchPortfolioAccounts: vi.fn(),
  patchPortfolioAccount: vi.fn(),
}))
```

**(b)** Add the import next to the others (after `import { fetchAccounts } from '../api/netWorth'`, L58):

```tsx
import { fetchPortfolioAccounts } from '../api/portfolio'
```

**(c)** In `beforeEach`, next to `vi.mocked(fetchAccounts).mockResolvedValue([CHECKING])` (L214), add:

```tsx
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([])
```

- [ ] **Step 7: Run the Settings page suite.**

```bash
npx vitest run src/pages/SettingsPage.test.tsx
```

Expected: green, same count as the baseline.

- [ ] **Step 8: Gates + commit.**

```bash
npx tsc -b
npx eslint src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx src/pages/SettingsPage.test.tsx
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx src/components/settings/settings.css src/pages/SettingsPage.test.tsx
git commit -m "feat(portfolio-ui): Portfolio accounts table in the Settings Accounts card"
```

---

## Phase 4 — Verification

### Task 6: Full gates

**Files:** none (verification only)

- [ ] **Step 1: Whole frontend suite.**

```bash
npx vitest run
```

Expected: green. Count: **1213 baseline + 7 (`portfolio.test.ts`) + 12 (`PortfolioPage.test.tsx`) + 5 (`AccountsCard.test.tsx`) = 1237**. If the number differs, reconcile it against the per-file runs above before claiming completion — do not adjust the expectation to match reality without explaining the gap.

- [ ] **Step 2: Types, lint, production build.**

```bash
npx tsc -b
npx eslint .
npm run build
```

Expected: `tsc -b` silent; `eslint .` clean (warnings are failures here — the repo runs at zero); `npm run build` succeeds under the 730 kB chunk advisory (this plan adds no chart modules, so the echarts chunk is unchanged).

- [ ] **Step 3: Confirm the byte-identity claims one more time, by grep.**

```bash
grep -n "ownerQuery" src/api/portfolio.ts
grep -n "portfolioKey\|shown.current" src/pages/PortfolioPage.tsx
grep -rn "getSnapshot<PortfolioSnapshot>" src/pages/PortfolioPage.tsx
```

Expected: `ownerQuery` defined once and used five times; `portfolioKey` used at the mount seed, in `load`'s `setSnapshot`, and in `selectOwner`'s peek; `shown.current` read in `load`'s skip and written in both `load` and `selectOwner`; **no** `getSnapshot` result is compared against a fresh payload anywhere (the house rule).

- [ ] **Step 4: Real-browser smoke is Plan 4's job, not this one.** Record for the batch checklist (spec §7): portfolio chips flip the tiles/table/donut but not the performance line; the Settings Portfolio-accounts select round-trips; a partner with no positions shows the holdings empty note rather than a table of zeros.

- [ ] **Step 5: Final commit if anything moved.**

```bash
git status --porcelain
git add -A && git commit -m "feat(portfolio-ui): verification pass — suite, types, lint, build"
```

If `git status` is empty, skip the commit — there is nothing to record.

---

## Risks & open questions

1. **The `owner` param's shape is assumed, not verified.** This plan sends `?owner=<id>` / `?owner=joint` / nothing, copied from `src/api/netWorth.ts`. Task 0 Step 2 greps for it; if the sibling plan chose a different spelling (e.g. `person_id=`), fix `ownerQuery` and the seven expectations in `src/api/portfolio.test.ts` — nothing else changes.
2. **Scope-consistent totals are the backend's promise.** The page renders `totals.market_value` as the hero tile under a chip; if the server returns household totals with filtered rows, the tile lies and no frontend test can catch it. The pin lives in the sibling plan's API tests.
3. **`load` becoming a `useCallback` changes the mount effect's dependency.** Any future non-reactive value added to `load`'s body must go in the dep array or `react-hooks/exhaustive-deps` fails the lint gate (Task 3 Step 8 names the two errors to expect).
4. **Two tables in one card.** `AccountsCard.test.tsx` and `CategoriesCard.test.tsx` both used bare `getByRole('table')`. Only the Accounts one is repaired here — `CategoriesCard` renders one table and is untouched.
5. **The performance chart is never owner-scoped** (spec §2 decision log: one row per Monday). If a future batch wants per-owner performance, it needs a new server-side series, not an `owner` param on `/portfolio/history` — the hint text in Task 4 would need rewording at the same time.
