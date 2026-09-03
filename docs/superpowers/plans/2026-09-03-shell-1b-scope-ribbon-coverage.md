# Shell 1b — Scope store, ScopeBar, Month ribbon 2.0, coverage endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared scope model from `docs/superpowers/specs/2026-09-03-shell-grammar-design.md` §6–§7: a `useScope` hook whose source of truth is the URL and whose memory is localStorage, a `ScopeBar` that renders only the controls a page declares, the month ribbon 2.0 with paging, year dividers, today marker and two-tone coverage chips, plus the two small backend additions they need (`GET /coverage`, `GET /net-worth/summary?month=`). No page adopts any of this here — Plans 2 and 3 do.

**Architecture:** `useScope` parses `owner`, `range`, `month` from `useSearchParams`, falls back to `localStorage['finance.scope']` for owner/range and to defaults (`all`, `1y`), rewrites the URL from memory on arrival with a `replace`, and writes both URL and memory through one setter. `ScopeBar` owns its own household and coverage fetches (snapshot-cached under `shell:household` and `shell:coverage`) so pages only declare what they use. The new ribbon lives in `src/components/shell/MonthRibbon.tsx`; the old `src/components/MonthRibbon.tsx` stays until Plan 4 deletes it.

**Tech Stack:** React 19, react-router 7 (`useSearchParams`, `useNavigate`), TypeScript, vitest + Testing Library; FastAPI + SQLAlchemy async + pytest for the two endpoints.

**Worktree / commands:** Branch `shell-1b`. Frontend from the worktree root: `npx vitest run <file>`. Backend from `<worktree>/backend` with the ROOT venv interpreter and a private test database so parallel lanes never share one:
`FINANCE_TEST_DB=finance_test_1b ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
(adjust the relative path to the root `backend/.venv` from your worktree; the conftest accepts any `<name>_test[_suffix]`).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/schemas/coverage.py` (new) | `CoverageOut` |
| `backend/app/api/coverage.py` (new) | `GET /coverage` |
| `backend/app/main.py` (modify) | include the router |
| `backend/tests/test_coverage_api.py` (new) | auth, empty, populated, ordering |
| `backend/app/api/net_worth.py` (modify) | optional `month` on `/summary` |
| `backend/tests/test_net_worth_api.py` (modify) | month parameter cases |
| `src/types/api.ts` (modify) | `CoverageOut` |
| `src/api/coverage.ts` (new) | `fetchCoverage()` |
| `src/api/netWorth.ts` (modify) | `fetchSummary(owner, month?)` |
| `src/components/shell/useScope.ts` (new) | parse/serialize, memory, the hook |
| `src/components/shell/useScope.test.tsx` (new) | precedence, rewrite, setter, month not remembered |
| `src/components/shell/MonthRibbon.tsx` (new) | ribbon 2.0 |
| `src/components/shell/MonthRibbon.test.tsx` (new) | paging, dividers, today, two-tone, click modes, figures |
| `src/components/shell/ScopeBar.tsx` (new) | owner · range · month controls from a declaration |
| `src/components/shell/ScopeBar.test.tsx` (new) | renders only declared controls; fetches; wiring |
| `src/components/shell/shell.css` (modify — created by Plan 1a) | ribbon styles appended |

Plan 1a creates `shell.css` and `Segmented.tsx`; this plan imports `Segmented` and appends CSS. If Plan 1a has not merged yet when you start, create `shell.css` with only the ribbon block below and let the merge combine them.

---

### Task 1: `GET /coverage`

**Files:**
- Create: `backend/app/schemas/coverage.py`, `backend/app/api/coverage.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_coverage_api.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_coverage_api.py
from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot, SpendingCategory


async def test_coverage_requires_auth(client):
    assert (await client.get("/api/v1/coverage")).status_code == 401


async def test_coverage_is_empty_on_an_empty_book(auth_client):
    resp = await auth_client.get("/api/v1/coverage")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"balances": [], "spending": [], "net_pay": []}


async def test_coverage_lists_each_feed_ascending_and_deduplicated(auth_client, db):
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 3, 1)),
            NetWorthSnapshot(month=date(2026, 1, 1)),
            # Two rows in one month collapse to one coverage entry.
            MonthlySpending(month=date(2026, 2, 1), category_id=cat.id, amount=Decimal("10.00")),
            MonthlyCashflow(month=date(2026, 1, 1), net_pay=Decimal("5000.00")),
        ]
    )
    cat2 = SpendingCategory(name="Food", slug="food", sort_order=2)
    db.add(cat2)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 2, 1), category_id=cat2.id, amount=Decimal("20.00")))
    await db.commit()

    body = (await auth_client.get("/api/v1/coverage")).json()
    assert body == {
        "balances": ["2026-01-01", "2026-03-01"],
        "spending": ["2026-02-01"],
        "net_pay": ["2026-01-01"],
    }
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `FINANCE_TEST_DB=finance_test_1b <venv-python> -m pytest tests/test_coverage_api.py -q`
Expected: FAIL with 404s (no router).

- [ ] **Step 3: Write the schema and router**

```python
# backend/app/schemas/coverage.py
from datetime import date

from pydantic import BaseModel


class CoverageOut(BaseModel):
    """Which months each hand-entered feed covers (2026-09-03 shell spec §7). Ascending
    first-of-month dates, one entry per month regardless of row count. The month ribbon
    reads it for its two-tone chips; the later coverage-honesty work reads it for reminders."""

    balances: list[date]
    spending: list[date]
    net_pay: list[date]
```

```python
# backend/app/api/coverage.py
"""Coverage — the months each feed covers, in one cheap GET (2026-09-03 shell spec §7).

Three DISTINCT month lists, nothing else: no totals, no owners, no derived flags. The ribbon
needs presence, and presence is what this answers. Balances are snapshot months (the wizard
writes a snapshot per saved month); spending is any category row; net pay is the cashflow
row. Ordering is ascending so clients can take `[0]` as the earliest covered month.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot
from app.schemas.coverage import CoverageOut

router = APIRouter(prefix="/coverage", tags=["coverage"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=CoverageOut)
async def coverage(db: AsyncSession = Depends(get_db)) -> CoverageOut:
    balances = (
        await db.execute(select(NetWorthSnapshot.month).distinct().order_by(NetWorthSnapshot.month))
    ).scalars().all()
    spending = (
        await db.execute(select(MonthlySpending.month).distinct().order_by(MonthlySpending.month))
    ).scalars().all()
    net_pay = (
        await db.execute(select(MonthlyCashflow.month).distinct().order_by(MonthlyCashflow.month))
    ).scalars().all()
    return CoverageOut(balances=list(balances), spending=list(spending), net_pay=list(net_pay))
```

In `backend/app/main.py` add `coverage,` to the `from app.api import (...)` list (alphabetical, after `comp`) and `app.include_router(coverage.router, prefix="/api/v1")` after the `calendar` include.

- [ ] **Step 4: Run the test**

Run: `FINANCE_TEST_DB=finance_test_1b <venv-python> -m pytest tests/test_coverage_api.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/coverage.py backend/app/api/coverage.py backend/app/main.py backend/tests/test_coverage_api.py
git commit -m "feat(api): GET /coverage — months covered by balances, spending and net pay"
```

---

### Task 2: `GET /net-worth/summary?month=`

**Files:**
- Modify: `backend/app/api/net_worth.py` (the `summary` route, currently lines 267–310)
- Test: `backend/tests/test_net_worth_api.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_net_worth_api.py`, reusing the file's existing seeding helper for two or more snapshots (it already tests `/summary`; copy the seeding lines the existing summary test uses so this test stands alone):

```python
async def test_summary_month_param_returns_that_month_and_its_own_delta(auth_client, db):
    # Three months: 100 → 150 → 200 in one taxable account.
    acct = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(acct)
    await db.flush()
    snaps = [NetWorthSnapshot(month=date(2026, m, 1)) for m in (1, 2, 3)]
    db.add_all(snaps)
    await db.flush()
    for snap, amount in zip(snaps, ("100.00", "150.00", "200.00"), strict=True):
        db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal(amount)))
    await db.commit()

    latest = (await auth_client.get("/api/v1/net-worth/summary")).json()
    assert latest["month"] == "2026-03-01"
    assert latest["net_worth"] == "200.00"
    assert latest["mom_delta"] == "50.00"

    viewed = (await auth_client.get("/api/v1/net-worth/summary?month=2026-02-01")).json()
    assert viewed["month"] == "2026-02-01"
    assert viewed["net_worth"] == "150.00"
    assert viewed["mom_delta"] == "50.00"  # against January, not March

    first = (await auth_client.get("/api/v1/net-worth/summary?month=2026-01-01")).json()
    assert first["mom_delta"] is None  # nothing before the first month


async def test_summary_month_param_404s_for_a_month_with_no_snapshot(auth_client, db):
    acct = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    snap = NetWorthSnapshot(month=date(2026, 1, 1))
    db.add_all([acct, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("1.00")))
    await db.commit()
    resp = await auth_client.get("/api/v1/net-worth/summary?month=2025-12-01")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no snapshot for 2025-12"
```

Make sure the file imports `date`, `Decimal`, `Account`, `AccountBalance`, `NetWorthSnapshot` (it almost certainly does; add any missing import).

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_1b <venv-python> -m pytest tests/test_net_worth_api.py -q -k "summary_month"`
Expected: FAIL — the param is ignored, so `viewed["month"]` is March; the 404 case returns 200.

- [ ] **Step 3: Implement**

In `backend/app/api/net_worth.py`, change the route to:

```python
@router.get("/summary", response_model=SummaryOut)
async def summary(
    owner: OwnerQuery = None,
    month: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> SummaryOut:
    """The latest month by default; `month=YYYY-MM-01` views an earlier snapshot with ITS
    month-over-month delta (against the snapshot immediately before it), for the ribbon's
    click-to-view (2026-09-03 shell spec §7). The charts are unaffected — they span all months."""
    snapshots, accounts, balances = await load_balance_matrix(db, _owner_filter(owner))
    if not snapshots:
        if month is not None:
            raise HTTPException(status_code=404, detail=f"no snapshot for {month:%Y-%m}")
        return SummaryOut(
            month=None,
            net_worth=None,
            mom_delta=None,
            mom_pct=None,
            groups=[],
            owner_totals=[],
        )
    if month is None:
        index = len(snapshots) - 1
    else:
        index = next((i for i, snap in enumerate(snapshots) if snap.month == month), -1)
        if index == -1:
            raise HTTPException(status_code=404, detail=f"no snapshot for {month:%Y-%m}")
    latest = snapshots[index]
    previous = snapshots[index - 1] if index > 0 else None
    # …the rest of the function is unchanged from `latest_nw = …` onward…
```

Confirm `date`, `Query` and `HTTPException` are imported at the top of the module (`from datetime import date`, `from fastapi import APIRouter, Depends, HTTPException, Query`); add whichever is missing.

- [ ] **Step 4: Run the whole net-worth API module**

Run: `FINANCE_TEST_DB=finance_test_1b <venv-python> -m pytest tests/test_net_worth_api.py -q`
Expected: all passed, including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/net_worth.py backend/tests/test_net_worth_api.py
git commit -m "feat(api): optional month on GET /net-worth/summary for the ribbon's click-to-view"
```

---

### Task 3: Frontend API surface for coverage and the summary month

**Files:**
- Modify: `src/types/api.ts` (append near the net-worth types)
- Create: `src/api/coverage.ts`
- Modify: `src/api/netWorth.ts` (`fetchSummary`)
- Test: `src/api/netWorth.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/api/netWorth.test.ts` (it already mocks `fetch` for the other cases; follow the same pattern used by its `fetchSummary` owner test):

```ts
it('fetchSummary sends owner and month together, month as a first-of-month ISO date', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
  await fetchSummary('joint', '2026-02-01')
  expect(spy.mock.calls[0][0]).toBe('/api/v1/net-worth/summary?owner=joint&month=2026-02-01')
  await fetchSummary(null, '2026-02-01')
  expect(spy.mock.calls[1][0]).toBe('/api/v1/net-worth/summary?month=2026-02-01')
  spy.mockRestore()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/api/netWorth.test.ts`
Expected: FAIL — `fetchSummary` takes one argument and ignores the month.

- [ ] **Step 3: Implement**

`src/types/api.ts` — add after `NetWorthSummary`:

```ts
/** Which months each hand-entered feed covers — ascending first-of-month ISO dates
 *  (GET /coverage, 2026-09-03 shell spec §7). */
export interface CoverageOut {
  balances: string[]
  spending: string[]
  net_pay: string[]
}
```

`src/api/coverage.ts`:

```ts
import { api } from './client'
import type { CoverageOut } from '../types/api'

// No trailing slash (the /settings and /household precedent: the router mounts GET on the
// bare prefix, and "/coverage/" would cost a 307).
export function fetchCoverage(): Promise<CoverageOut> {
  return api<CoverageOut>('/coverage')
}
```

`src/api/netWorth.ts` — replace `fetchSummary`:

```ts
/** Latest month by default; `month` (a first-of-month ISO date) views that snapshot with its
 *  own month-over-month delta — the ribbon's click-to-view (2026-09-03 shell spec §7). */
export function fetchSummary(owner: OwnerScope = null, month?: string): Promise<NetWorthSummary> {
  const params = new URLSearchParams()
  if (owner !== null) params.set('owner', String(owner))
  if (month !== undefined) params.set('month', month)
  const query = params.toString()
  return api<NetWorthSummary>(`/net-worth/summary${query === '' ? '' : `?${query}`}`)
}
```

- [ ] **Step 4: Run the api tests**

Run: `npx vitest run src/api`
Expected: PASS (the existing owner test still holds: `?owner=2` exactly).

- [ ] **Step 5: Commit**

```bash
git add src/types/api.ts src/api/coverage.ts src/api/netWorth.ts src/api/netWorth.test.ts
git commit -m "feat(api-client): fetchCoverage and a month parameter on fetchSummary"
```

---

### Task 4: `useScope`

**Files:**
- Create: `src/components/shell/useScope.ts`
- Test: `src/components/shell/useScope.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/useScope.test.tsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCOPE_KEY, useScope, type ScopeUses } from './useScope'

function Probe({ uses }: { uses: ScopeUses }) {
  const { scope, setScope } = useScope(uses)
  const location = useLocation()
  return (
    <div>
      <span data-testid="scope">{`${String(scope.owner)}|${scope.range}|${String(scope.month)}`}</span>
      <span data-testid="url">{location.pathname + location.search}</span>
      <button onClick={() => setScope({ owner: 2 })}>owner 2</button>
      <button onClick={() => setScope({ owner: 'joint' })}>joint</button>
      <button onClick={() => setScope({ range: 'ytd' })}>ytd</button>
      <button onClick={() => setScope({ month: '2026-02-01' })}>feb</button>
      <button onClick={() => setScope({ month: null })}>latest</button>
    </div>
  )
}

function mount(entry: string, uses: ScopeUses = { owner: true, range: true, month: true }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe uses={uses} />
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const scope = () => screen.getByTestId('scope').textContent
const url = () => screen.getByTestId('url').textContent

describe('useScope', () => {
  it('reads the URL first', () => {
    mount('/net-worth?owner=2&range=ytd&month=2026-02')
    expect(scope()).toBe('2|ytd|2026-02-01')
  })

  it('falls back to memory, then defaults, and rewrites the URL on arrival (replace)', () => {
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ owner: 'joint', range: 'all' }))
    mount('/net-worth')
    expect(scope()).toBe('joint|all|null')
    expect(url()).toBe('/net-worth?owner=joint&range=all')
  })

  it('defaults to the household and one year', () => {
    mount('/portfolio', { owner: true, range: true })
    expect(scope()).toBe('null|1y|null')
    expect(url()).toBe('/portfolio?owner=all&range=1y')
  })

  it('normalizes only the keys the page uses', () => {
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ owner: 2, range: 'ytd' }))
    mount('/credit-cards', { owner: true })
    expect(url()).toBe('/credit-cards?owner=2')
    expect(scope()).toBe('2|ytd|null') // range is still readable, just not written
  })

  it('setScope writes the URL and remembers owner and range, never month', () => {
    mount('/net-worth')
    act(() => screen.getByText('owner 2').click())
    act(() => screen.getByText('ytd').click())
    act(() => screen.getByText('feb').click())
    expect(scope()).toBe('2|ytd|2026-02-01')
    expect(url()).toBe('/net-worth?owner=2&range=ytd&month=2026-02')
    expect(JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}')).toEqual({ owner: 2, range: 'ytd' })
    act(() => screen.getByText('latest').click())
    expect(url()).toBe('/net-worth?owner=2&range=ytd')
  })

  it('ignores garbage values and falls through to defaults', () => {
    mount('/net-worth?owner=bob&range=5y&month=next')
    expect(scope()).toBe('null|1y|null')
  })

  it('accepts a legacy YYYY-MM-DD month link and rewrites it to YYYY-MM', () => {
    mount('/spending?month=2026-07-01', { month: true })
    expect(scope()).toBe('null|1y|2026-07-01')
    expect(url()).toBe('/spending?month=2026-07')
  })

  it('joint and all round-trip through the URL', () => {
    mount('/net-worth')
    act(() => screen.getByText('joint').click())
    expect(url()).toContain('owner=joint')
    expect(scope().startsWith('joint|')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/useScope.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// src/components/shell/useScope.ts
import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { OwnerScope } from '../../api/netWorth'
import type { RangePreset } from '../../charts/timeZoom'

// The ONE scope rule (2026-09-03 shell spec §6): the URL is the source of truth, localStorage
// remembers owner and range across pages, defaults fill whatever is left. `month` is never
// remembered — it means something different on every page that has one.
export const SCOPE_KEY = 'finance.scope'
export const DEFAULT_RANGE: RangePreset = '1y'

export interface Scope {
  owner: OwnerScope
  range: RangePreset
  /** First-of-month ISO date, or null for "the latest / none". */
  month: string | null
}

/** Which keys a page uses — only those are normalized INTO the URL on arrival. */
export interface ScopeUses {
  owner?: boolean
  range?: boolean
  month?: boolean
}

interface ScopeMemory {
  owner?: OwnerScope
  range?: RangePreset
}

export function parseOwner(raw: string | null): OwnerScope | undefined {
  if (raw === null) return undefined
  if (raw === 'all') return null
  if (raw === 'joint') return 'joint'
  return /^\d{1,10}$/.test(raw) ? Number(raw) : undefined
}

export function parseRange(raw: string | null): RangePreset | undefined {
  return raw === 'all' || raw === '1y' || raw === 'ytd' ? raw : undefined
}

/** `YYYY-MM` in the URL → the app's `YYYY-MM-01` month currency. A legacy `YYYY-MM-DD` deep
 *  link (Overview → Spending drills, the wizard's own param) is accepted too — its day is
 *  dropped — and the arrival normalization below rewrites it to the short form. */
export function parseMonth(raw: string | null): string | undefined {
  if (raw === null) return undefined
  const match = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:-\d{2})?$/.exec(raw)
  return match ? `${match[1]}-01` : undefined
}

export function ownerToParam(owner: OwnerScope): string {
  return owner === null ? 'all' : String(owner)
}

export function readMemory(): ScopeMemory {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}')
    if (parsed === null || typeof parsed !== 'object') return {}
    const record = parsed as Record<string, unknown>
    const memory: ScopeMemory = {}
    if (record.owner === null || record.owner === 'joint' || typeof record.owner === 'number') {
      memory.owner = record.owner as OwnerScope
    }
    if (record.range === 'all' || record.range === '1y' || record.range === 'ytd') {
      memory.range = record.range
    }
    return memory
  } catch {
    return {}
  }
}

function writeMemory(next: ScopeMemory): void {
  try {
    localStorage.setItem(SCOPE_KEY, JSON.stringify(next))
  } catch {
    // Memory is a nicety; the URL still carries the truth.
  }
}

export function useScope(uses: ScopeUses = {}): {
  scope: Scope
  setScope: (partial: Partial<Scope>) => void
} {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawOwner = searchParams.get('owner')
  const rawRange = searchParams.get('range')
  const rawMonth = searchParams.get('month')

  const scope = useMemo<Scope>(() => {
    const memory = readMemory()
    const owner = parseOwner(rawOwner)
    const range = parseRange(rawRange)
    return {
      owner: owner !== undefined ? owner : (memory.owner ?? null),
      range: range !== undefined ? range : (memory.range ?? DEFAULT_RANGE),
      month: parseMonth(rawMonth) ?? null,
    }
  }, [rawOwner, rawRange, rawMonth])

  // Arrival normalization: a page that USES a key gets it written into the URL when it is
  // absent or garbage, so every view is shareable. Replace, never push (the drill-param
  // convention) — the back button never sees this. Idempotent: it only fires when the URL
  // actually differs from what the scope resolved to.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    if (uses.owner && rawOwner !== ownerToParam(scope.owner)) {
      next.set('owner', ownerToParam(scope.owner))
      changed = true
    }
    if (uses.range && rawRange !== scope.range) {
      next.set('range', scope.range)
      changed = true
    }
    if (uses.month && rawMonth !== null) {
      const parsed = parseMonth(rawMonth)
      if (parsed === undefined) {
        next.delete('month') // garbage month: drop it rather than invent one
        changed = true
      } else if (rawMonth !== parsed.slice(0, 7)) {
        next.set('month', parsed.slice(0, 7)) // legacy YYYY-MM-DD link → the short grammar
        changed = true
      }
    }
    if (changed) setSearchParams(next, { replace: true })
  }, [uses.owner, uses.range, uses.month, rawOwner, rawRange, rawMonth, scope, searchParams, setSearchParams])

  const setScope = useCallback(
    (partial: Partial<Scope>) => {
      const next = new URLSearchParams(searchParams)
      const memory = readMemory()
      if (partial.owner !== undefined) {
        next.set('owner', ownerToParam(partial.owner))
        memory.owner = partial.owner
      }
      if (partial.range !== undefined) {
        next.set('range', partial.range)
        memory.range = partial.range
      }
      if ('month' in partial) {
        if (partial.month === null || partial.month === undefined) next.delete('month')
        else next.set('month', partial.month.slice(0, 7))
      }
      if (partial.owner !== undefined || partial.range !== undefined) writeMemory(memory)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  return { scope, setScope }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/shell/useScope.test.tsx`
Expected: PASS (8 tests). If the "normalizes only the keys the page uses" case shows `owner=2&range=ytd`, the effect wrote an unused key — check the `uses.range &&` guard.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/useScope.ts src/components/shell/useScope.test.tsx
git commit -m "feat(shell): useScope — URL-first owner/range/month with localStorage memory"
```

---

### Task 5: Month ribbon 2.0

**Files:**
- Create: `src/components/shell/MonthRibbon.tsx`
- Modify: `src/components/shell/shell.css` (append the ribbon block)
- Test: `src/components/shell/MonthRibbon.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/MonthRibbon.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MonthRibbon from './MonthRibbon'

afterEach(cleanup)

const coverage = {
  balances: new Set(['2026-09-01', '2026-08-01', '2026-07-01', '2025-01-01']),
  spending: new Set(['2026-07-01', '2026-06-01', '2025-01-01']),
}

function mount(over: Partial<Parameters<typeof MonthRibbon>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <MemoryRouter>
      <MonthRibbon
        anchor="2026-09-01"
        earliest="2025-01-01"
        coverage={coverage}
        mode="view"
        onSelect={onSelect}
        {...over}
      />
    </MemoryRouter>,
  )
  return onSelect
}

describe('MonthRibbon 2.0', () => {
  it('shows twelve chips ending at the anchor, with two-tone coverage and a today ring', () => {
    mount()
    const chips = screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })
    expect(chips).toHaveLength(12)
    expect(chips[0].getAttribute('aria-label')).toMatch(/^Oct 2025/)
    expect(chips[11].getAttribute('aria-label')).toMatch(/^Sep 2026/)
    expect(chips[11].classList.contains('is-today')).toBe(true)
    // September: balances only. July: both. June: spending only. May: neither.
    expect(chips[11].classList.contains('has-balances')).toBe(true)
    expect(chips[11].classList.contains('has-spending')).toBe(false)
    expect(chips[9].classList.contains('has-balances')).toBe(true)
    expect(chips[9].classList.contains('has-spending')).toBe(true)
    expect(chips[8].classList.contains('has-spending')).toBe(true)
    expect(chips[8].classList.contains('has-balances')).toBe(false)
    expect(chips[11].getAttribute('aria-label')).toBe('Sep 2026 — balances entered, spending missing')
  })

  it('labels the year where it changes inside the window', () => {
    mount()
    const years = document.querySelectorAll('.ribbon-year')
    expect([...years].map((el) => el.textContent)).toEqual(['2025', '2026'])
  })

  it('pages back to the earliest covered month and forward to the anchor, no further', () => {
    mount()
    const prev = screen.getByRole('button', { name: 'Earlier months' })
    const next = screen.getByRole('button', { name: 'Later months' })
    expect((next as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(prev)
    expect(screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })[0].getAttribute('aria-label')).toMatch(/^Oct 2024/)
    expect((prev as HTMLButtonElement).disabled).toBe(true) // Oct 2024 window already contains Jan 2025
    fireEvent.click(next)
    expect((next as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens on the window that contains the selected month', () => {
    mount({ selected: '2025-01-01' })
    const chips = screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })
    expect(chips.some((c) => c.classList.contains('selected') && /^Jan 2025/.test(c.getAttribute('aria-label') ?? ''))).toBe(true)
  })

  it('view mode: click selects; the Edit link points at the wizard for the selected month', () => {
    const onSelect = mount({ selected: '2026-07-01', editHref: (m) => `/update?month=${m}` })
    fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
    expect(onSelect).toHaveBeenCalledWith('2026-06-01')
    const edit = screen.getByRole('link', { name: 'Edit Jul 2026 in the wizard' })
    expect(edit.getAttribute('href')).toBe('/update?month=2026-07-01')
  })

  it('prints a figure in the label when one is known', () => {
    mount({ figures: { '2026-09-01': '$806,667.88' } })
    expect(screen.getByRole('button', { name: /^Sep 2026/ }).getAttribute('aria-label')).toBe(
      'Sep 2026 — $806,667.88 — balances entered, spending missing',
    )
  })

  it('renders hollow chips and no dividers while coverage is unknown', () => {
    mount({ coverage: null, earliest: null })
    const chips = screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })
    expect(chips.every((c) => !c.classList.contains('has-balances'))).toBe(true)
    expect((screen.getByRole('button', { name: 'Earlier months' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/MonthRibbon.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/shell/MonthRibbon.tsx
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMonth } from '../../utils/format'
import { addMonths, lastNMonths } from '../../utils/months'
import './shell.css'

// The app's signature device, second edition (2026-09-03 shell spec §7): a twelve-month
// window that pages back to the earliest covered month, year labels where the year turns, a
// ring on the current month, and TWO-TONE chips — left half balances, right half spending —
// so "entered" finally means which feed. Click semantics belong to the caller: view pages
// select a month, the wizard edits one; the Edit link covers the other verb.
export interface RibbonCoverage {
  balances: ReadonlySet<string>
  spending: ReadonlySet<string>
}

export const RIBBON_PAGE = 12

function windowFor(anchor: string, page: number): string[] {
  return lastNMonths(addMonths(anchor, -page * RIBBON_PAGE), RIBBON_PAGE)
}

/** The page index whose window contains `month` (0 = the window ending at the anchor). */
export function pageContaining(anchor: string, month: string): number {
  const [ay, am] = anchor.split('-').map(Number)
  const [my, mm] = month.split('-').map(Number)
  const distance = ay * 12 + am - (my * 12 + mm)
  return distance <= 0 ? 0 : Math.floor(distance / RIBBON_PAGE)
}

export default function MonthRibbon({
  anchor,
  earliest,
  coverage,
  selected,
  mode,
  onSelect,
  figures,
  editHref,
}: {
  /** The current calendar month (first-of-month ISO) — the ribbon's right edge. */
  anchor: string
  /** Earliest covered month across the feeds, or null while unknown (no paging back). */
  earliest: string | null
  coverage: RibbonCoverage | null
  selected?: string
  mode: 'view' | 'edit'
  onSelect: (monthIso: string) => void
  /** Figure to print in a chip's label (Net worth: that month's total). */
  figures?: Record<string, string>
  /** View pages: where "Edit <month>" goes. */
  editHref?: (monthIso: string) => string
}) {
  const [page, setPage] = useState(() => (selected ? pageContaining(anchor, selected) : 0))
  // A selection made elsewhere (a deep link, the "Back to latest" chip) pulls the window to it.
  useEffect(() => {
    if (selected) setPage(pageContaining(anchor, selected))
  }, [anchor, selected])

  const months = windowFor(anchor, page)
  const canGoEarlier = earliest !== null && months[0] > earliest
  const canGoLater = page > 0

  return (
    <div className="ribbon" role="group" aria-label="Month coverage">
      <button
        type="button"
        className="ribbon-page"
        aria-label="Earlier months"
        disabled={!canGoEarlier}
        onClick={() => setPage((p) => p + 1)}
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      {months.map((month, index) => {
        const hasBalances = coverage?.balances.has(month) ?? false
        const hasSpending = coverage?.spending.has(month) ?? false
        const yearTurns = index === 0 || month.slice(0, 4) !== months[index - 1].slice(0, 4)
        const state =
          coverage === null
            ? 'coverage unknown'
            : hasBalances && hasSpending
              ? 'balances and spending entered'
              : hasBalances
                ? 'balances entered, spending missing'
                : hasSpending
                  ? 'spending entered, balances missing'
                  : 'nothing entered'
        const figure = figures?.[month]
        const label = `${formatMonth(month)} — ${figure ? `${figure} — ` : ''}${state}`
        const classes = [
          'month-chip2',
          hasBalances ? 'has-balances' : '',
          hasSpending ? 'has-spending' : '',
          month === anchor ? 'is-today' : '',
          month === selected ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <span className="ribbon-slot" key={month}>
            {yearTurns && coverage !== null && (
              <span className="ribbon-year" aria-hidden="true">
                {month.slice(0, 4)}
              </span>
            )}
            <button
              type="button"
              className={classes}
              title={label}
              aria-label={label}
              aria-pressed={selected === undefined ? undefined : month === selected}
              onClick={() => onSelect(month)}
            >
              <span className="month-chip2-dot" aria-hidden="true" />
              <span className="month-chip2-label">{formatMonth(month).slice(0, 3)}</span>
            </button>
          </span>
        )
      })}
      <button
        type="button"
        className="ribbon-page"
        aria-label="Later months"
        disabled={!canGoLater}
        onClick={() => setPage((p) => Math.max(0, p - 1))}
      >
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {mode === 'view' && selected !== undefined && editHref !== undefined && (
        <Link className="ribbon-edit" to={editHref(selected)} aria-label={`Edit ${formatMonth(selected)} in the wizard`}>
          Edit ↗
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Append the ribbon styles to `src/components/shell/shell.css`**

```css
/* ── Month ribbon 2.0 ────────────────────────────────────────────────────── */

.ribbon {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.ribbon-page {
  display: inline-flex;
  align-items: center;
  padding: 6px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
  align-self: center;
}

.ribbon-page:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}

.ribbon-page:disabled {
  opacity: 0.35;
  cursor: default;
}

.ribbon-page:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.ribbon-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ribbon-year {
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  color: var(--muted);
  line-height: 1;
  margin-bottom: 2px;
}

.month-chip2 {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 7px 5px;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.7rem;
  line-height: 1;
}

.month-chip2:hover {
  background: var(--surface-2);
}

.month-chip2:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Two halves: left = balances (accent), right = spending (chart slot 3, aqua). A hollow
   ring means nothing entered; the ring stays visible under either fill. */
.month-chip2-dot {
  --left: transparent;
  --right: transparent;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid var(--muted);
  background: linear-gradient(90deg, var(--left) 50%, var(--right) 50%);
}

.month-chip2.has-balances .month-chip2-dot {
  --left: var(--accent);
  border-color: var(--accent);
}

.month-chip2.has-spending .month-chip2-dot {
  --right: var(--chart-3);
  border-color: var(--accent);
}

.month-chip2.has-spending:not(.has-balances) .month-chip2-dot {
  border-color: var(--chart-3);
}

.month-chip2.is-today .month-chip2-dot {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--muted);
}

.month-chip2.selected {
  border-color: var(--accent);
  color: var(--text);
}

.ribbon-edit {
  align-self: center;
  margin-left: 0.5rem;
  font-size: 0.72rem;
  white-space: nowrap;
}

@media (prefers-reduced-motion: no-preference) {
  .month-chip2,
  .ribbon-page {
    transition:
      background-color var(--t-fast) ease,
      border-color var(--t-fast) ease,
      color var(--t-fast) ease;
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/components/shell/MonthRibbon.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/MonthRibbon.tsx src/components/shell/MonthRibbon.test.tsx src/components/shell/shell.css
git commit -m "feat(shell): month ribbon 2.0 — paging, year labels, today ring, two-tone coverage, edit link"
```

---

### Task 6: ScopeBar

**Files:**
- Create: `src/components/shell/ScopeBar.tsx`
- Test: `src/components/shell/ScopeBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/ScopeBar.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/household', () => ({ fetchHousehold: vi.fn() }))
vi.mock('../../api/coverage', () => ({ fetchCoverage: vi.fn() }))
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import { clearSnapshots } from '../../api/snapshotCache'
import ScopeBar from './ScopeBar'

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}

function mount(props: Parameters<typeof ScopeBar>[0], entry = '/net-worth') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<><ScopeBar {...props} /><Url /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  clearSnapshots()
  vi.mocked(fetchHousehold).mockResolvedValue({
    people: [{ id: 1, name: 'Edward', is_primary: true }, { id: 2, name: 'Grace', is_primary: false }],
    marriage_date: null,
  })
  vi.mocked(fetchCoverage).mockResolvedValue({
    balances: ['2026-07-01', '2026-08-01', '2026-09-01'],
    spending: ['2026-07-01'],
    net_pay: ['2026-07-01'],
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ScopeBar', () => {
  it('renders the owner chips only for a multi-person household, with Joint', async () => {
    mount({ owner: true })
    expect(await screen.findByRole('button', { name: 'Grace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Joint' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=2'))
  })

  it('hides Joint when asked, and the whole owner control for one person', async () => {
    mount({ owner: { joint: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    cleanup()
    vi.mocked(fetchHousehold).mockResolvedValue({ people: [{ id: 1, name: 'Edward', is_primary: true }], marriage_date: null })
    mount({ owner: true })
    await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
  })

  it('hides All when asked and shows a null scope as the primary person', async () => {
    mount({ owner: { joint: false, all: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edward' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=2'))
  })

  it('range chips write the URL and default to 1Y', () => {
    mount({ range: true })
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?range=ytd')
    expect(fetchHousehold).not.toHaveBeenCalled()
    expect(fetchCoverage).not.toHaveBeenCalled()
  })

  it('month (view): the ribbon selects into ?month= and Back to latest clears it', async () => {
    mount({ month: { mode: 'view', anchor: '2026-09-01', editHref: (m) => `/update?month=${m}` } })
    const july = await screen.findByRole('button', { name: /^Jul 2026 — balances and spending entered/ })
    fireEvent.click(july)
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?month=2026-07')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to latest' }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth')
  })

  it('month (edit): the ribbon navigates to the wizard', async () => {
    mount({ month: { mode: 'edit', anchor: '2026-09-01' } }, '/spending')
    fireEvent.click(await screen.findByRole('button', { name: /^Aug 2026/ }))
    expect(screen.getByTestId('url').textContent).toBe('/update?month=2026-08-01')
  })

  it('month (edit) with a page-owned handler: the wizard keeps the click and the selection', async () => {
    const onSelect = vi.fn()
    mount(
      { month: { mode: 'edit', anchor: '2026-09-01', selected: '2026-09-01', onSelect } },
      '/update?month=2026-09-01',
    )
    const aug = await screen.findByRole('button', { name: /^Aug 2026/ })
    expect(screen.getByRole('button', { name: /^Sep 2026/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(aug)
    expect(onSelect).toHaveBeenCalledWith('2026-08-01')
    expect(screen.getByTestId('url').textContent).toBe('/update?month=2026-09-01')
  })

  it('renders nothing at all when no control is declared', () => {
    const { container } = mount({})
    expect(container.querySelector('.scope-bar')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/ScopeBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/shell/ScopeBar.tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import type { OwnerScope } from '../../api/netWorth'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import type { RangePreset } from '../../charts/timeZoom'
import type { CoverageOut, HouseholdOut } from '../../types/api'
import { currentMonthIso } from '../../utils/months'
import MonthRibbon, { type RibbonCoverage } from './MonthRibbon'
import Segmented from './Segmented'
import { useScope } from './useScope'
import './shell.css'

// The one scope row (2026-09-03 shell spec §6): renders ONLY the controls a page declares,
// and owns the two fetches they need — the household for the owner chips, coverage for the
// ribbon — so pages declare rather than wire. Both are snapshot-cached under shell:* keys.
export interface MonthScopeProps {
  mode: 'view' | 'edit'
  /** The current calendar month; defaults to today's. Injectable for tests. */
  anchor?: string
  /** Figures to print in chip labels (Net worth passes that month's total). */
  figures?: Record<string, string>
  /** View pages only: where the ribbon's Edit link goes. */
  editHref?: (monthIso: string) => string
  /** Edit pages only (the wizard): the month being edited, and what a chip click does —
   *  the wizard guards its draft in its own handler, so it must own the click. */
  selected?: string
  onSelect?: (monthIso: string) => void
}

export interface ScopeBarProps {
  /** `{ joint: false }` hides Joint (a paycheck has no joint); `{ all: false }` also hides
   *  All and shows a null scope as the primary person — for pages that are always about
   *  ONE person (Paycheck). */
  owner?: boolean | { joint: boolean; all?: boolean }
  range?: boolean
  month?: MonthScopeProps
  /** Any value; when it changes the household and coverage fetches re-run. Pages that write
   *  balances/spending while the bar stays mounted (the wizard after a save) bump it so the
   *  just-saved month's chip fills without leaving the page. */
  revalidate?: unknown
}

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1y', label: '1Y' },
  { value: 'ytd', label: 'YTD' },
]

export const HOUSEHOLD_SNAPSHOT = 'shell:household'
export const COVERAGE_SNAPSHOT = 'shell:coverage'

function ownerValue(owner: OwnerScope): string {
  return owner === null ? 'all' : String(owner)
}

function ownerFromValue(value: string): OwnerScope {
  if (value === 'all') return null
  if (value === 'joint') return 'joint'
  return Number(value)
}

export default function ScopeBar({ owner, range, month }: ScopeBarProps) {
  const navigate = useNavigate()
  const { scope, setScope } = useScope({
    owner: owner !== undefined && owner !== false,
    range: range === true,
    month: month !== undefined && month.mode === 'view',
  })

  const [household, setHousehold] = useState<HouseholdOut | null>(
    () => getSnapshot<HouseholdOut>(HOUSEHOLD_SNAPSHOT) ?? null,
  )
  const [coverage, setCoverage] = useState<CoverageOut | null>(
    () => getSnapshot<CoverageOut>(COVERAGE_SNAPSHOT) ?? null,
  )

  const wantsOwner = owner !== undefined && owner !== false
  useEffect(() => {
    if (!wantsOwner) return
    fetchHousehold()
      .then((data) => {
        setSnapshot(HOUSEHOLD_SNAPSHOT, data)
        setHousehold(data)
      })
      .catch(() => setHousehold((current) => current))
  }, [wantsOwner])

  const wantsMonth = month !== undefined
  useEffect(() => {
    if (!wantsMonth) return
    fetchCoverage()
      .then((data) => {
        setSnapshot(COVERAGE_SNAPSHOT, data)
        setCoverage(data)
      })
      .catch(() => setCoverage((current) => current))
  }, [wantsMonth])

  const people = useMemo(
    () =>
      [...(household?.people ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [household],
  )
  const showJoint = owner === true || (typeof owner === 'object' && owner.joint)
  const showAll = !(typeof owner === 'object' && owner.all === false)
  const ownerOptions = useMemo(
    () => [
      ...(showAll ? [{ value: 'all', label: 'All' }] : []),
      ...people.map((p) => ({ value: String(p.id), label: p.name })),
      ...(showJoint ? [{ value: 'joint', label: 'Joint' }] : []),
    ],
    [people, showAll, showJoint],
  )
  // Without an All chip a null (household) scope has to land somewhere: the primary — the
  // person the page has always been about when nothing is picked. Joint likewise.
  const ownerChipValue =
    !showAll && (scope.owner === null || scope.owner === 'joint') && people.length > 0
      ? String(people[0].id)
      : ownerValue(scope.owner)

  const ribbonCoverage = useMemo<RibbonCoverage | null>(
    () =>
      coverage === null
        ? null
        : { balances: new Set(coverage.balances), spending: new Set(coverage.spending) },
    [coverage],
  )
  const earliest = useMemo(() => {
    if (coverage === null) return null
    const all = [...coverage.balances, ...coverage.spending, ...coverage.net_pay].sort()
    return all[0] ?? null
  }, [coverage])

  const showOwner = wantsOwner && people.length > 1
  if (!showOwner && !range && month === undefined) return null

  const anchor = month?.anchor ?? currentMonthIso()

  return (
    <div className="scope-bar">
      {showOwner && (
        <div className="scope-bar-group">
          <span className="eyebrow">Whose</span>
          <Segmented
            variant="toggle"
            ariaLabel="Whose"
            options={ownerOptions}
            value={ownerChipValue}
            onChange={(value) => setScope({ owner: ownerFromValue(value) })}
          />
        </div>
      )}
      {range && (
        <Segmented
          variant="toggle"
          ariaLabel="Time range"
          options={RANGE_OPTIONS}
          value={scope.range}
          onChange={(value) => setScope({ range: value })}
        />
      )}
      {month !== undefined && (
        <div className="scope-bar-group">
          <MonthRibbon
            anchor={anchor}
            earliest={earliest}
            coverage={ribbonCoverage}
            selected={month.mode === 'view' ? (scope.month ?? undefined) : month.selected}
            mode={month.mode}
            figures={month.figures}
            editHref={month.editHref}
            onSelect={(m) => {
              if (month.mode === 'view') setScope({ month: m })
              else if (month.onSelect !== undefined) month.onSelect(m)
              else navigate(`/update?month=${m}`)
            }}
          />
          {month.mode === 'view' && scope.month !== null && (
            <button type="button" className="chip" onClick={() => setScope({ month: null })}>
              Back to latest
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

Append to `shell.css`:

```css
/* ── ScopeBar ─────────────────────────────────────────────────────────────── */

.scope-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.25rem;
  width: 100%;
}

.scope-bar-group {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/shell/ScopeBar.test.tsx`
Expected: PASS (6 tests). The "hides Joint…" case mounts twice; if `fetchHousehold` call counting is brittle in your run, assert on the absence of the `Whose` group only.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/ScopeBar.tsx src/components/shell/ScopeBar.test.tsx src/components/shell/shell.css
git commit -m "feat(shell): ScopeBar — declared owner/range/month controls with cached household and coverage"
```

---

### Task 7: Type-check, lint, suites

- [ ] **Step 1: Frontend**

Run: `npx tsc -b && npx eslint src/components/shell src/api/coverage.ts src/api/netWorth.ts src/types/api.ts && npx vitest run`
Expected: clean, all green.

- [ ] **Step 2: Backend**

Run (from `<worktree>/backend`): `FINANCE_TEST_DB=finance_test_1b <venv-python> -m pytest -q tests/test_coverage_api.py tests/test_net_worth_api.py && <venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`
Expected: passed; ruff clean.

---

## Self-review

**Spec coverage:** §6 URL grammar, memory, defaults, arrival rewrite, one setter → Task 4; ScopeBar rendering only declared controls, household gate, "Whose" eyebrow, Joint control → Task 6; §7 ribbon (twelve chips, paging bounds, year labels, today ring, two-tone, hover figures, Edit link, view/edit click semantics, Back to latest) → Tasks 5–6; §7 backend (`/coverage`, `summary?month=`) → Tasks 1–2; client surface → Task 3. Page adoption (Overview owner, Net worth viewed month) is Plan 2/3 by design. **Placeholders:** none. **Type consistency:** `ScopeUses`, `Scope`, `useScope(uses)` return `{scope, setScope}`, `RibbonCoverage`, `MonthScopeProps`, `ScopeBarProps`, `fetchSummary(owner, month?)`, `CoverageOut` used consistently; `Segmented` props match Plan 1a's definition (`variant`, `options`, `value`, `onChange`, `ariaLabel`).
