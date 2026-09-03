# Shell 2 — Migrate Overview and Net worth onto the shell primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the shell primitives on the two pages that exercise all of them — Overview (PageFrame states, owner scope, cached paint) and Net worth (PageFrame, owner + range + month scope in the sticky row, ribbon 2.0 in view mode, the summary month parameter, Segmented toggles) — per `docs/superpowers/specs/2026-09-03-shell-grammar-design.md` §5–§8 and §16 phase 2.

**Architecture:** Each page deletes its hand-built header, error banner, skeleton and loading-dim wrapper and renders through `PageFrame`; owner/range/month state comes from `useScope` (the URL) instead of local `useState`; the `ScopeBar` in the sticky row replaces the per-page owner row, range chips and ribbon. Owner changes are adopted with React's adjust-during-render pattern (the house precedent in `CategoriesPanel`), never with setState inside an effect body. Everything the page tests assert by role and text is preserved; only the queries that named the old control markup change.

**Tech Stack:** React 19, react-router 7, vitest + Testing Library.

**Prerequisites:** Plans 1a, 1b and 1c merged into `main` (this plan imports `PageFrame`, `ScopeBar`, `useScope`, `Segmented`, `usePageFrame`, and relies on `fetchSummary(owner, month)`, `/coverage`, the family-scoped snapshot invalidation and `useArrivalValue`). Branch `shell-2` from `main` after those merges; frontend commands from the worktree root.

---

## File structure

| File | Change |
|---|---|
| `src/pages/OverviewPage.tsx` (+ `.css`, test) | PageFrame; owner scope; owner-aware fetches and snapshot key |
| `src/pages/NetWorthPage.tsx` (+ `.css`, test) | PageFrame; scope-driven owner/range/month; ribbon figures; viewed-month tiles + table; Segmented for stack-by and granularity |
| `src/components/shell/PageFrame.tsx` | unchanged (its `scopeRow` slot receives `<ScopeBar …/>`) |

---

### Task 1: Overview on PageFrame with owner scope

**Files:**
- Modify: `src/pages/OverviewPage.tsx`, `src/pages/OverviewPage.css`, `src/pages/OverviewPage.test.tsx`

Current markup to replace (lines ~316–351 of `OverviewPage.tsx`):

```tsx
      <header className="page-header">
        <h1>Overview</h1>
        <div className="spacer" />
        <button type="button" className="button" onClick={reload}>Refresh</button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {data === null ? error : `${error} — the page may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading the overview" onClick={reload}>Retry</button>
        </div>
      )}
      {data === null ? (
        busy && (<PageSkeleton tiles={4} cards={[{ span: 12, height: 220 }, { span: 12, height: 280 }, { span: 12, height: 240 }, { span: 12, height: 200 }]} />)
      ) : (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          …body…
        </div>
      )}
```

- [ ] **Step 1: Write the failing tests** (append to `OverviewPage.test.tsx`, reusing its existing fetch mocks and fixtures; mock `../api/household` and `../api/coverage` like the ScopeBar test does — `fetchHousehold` resolving two people, `fetchCoverage` resolving empty lists)

```tsx
describe('OverviewPage — shell frame and owner scope', () => {
  it('renders through PageFrame: one h1, actions on the right, no bespoke header', async () => {
    renderPage()
    await screen.findByText('Net worth — Sep 2026')  // or whatever the fixture's hero label is
    expect(document.querySelector('.page-frame-header h1')?.textContent).toBe('Overview')
    expect(document.querySelector('.page-header')).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh' }).closest('.page-frame-actions')).toBeTruthy()
  })

  it('a reload failure keeps the page and shows the frame’s stale line with Retry', async () => {
    renderPage()
    await screen.findByText('Overview')
    vi.mocked(fetchSummary).mockRejectedValueOnce(new ApiError('offline', 503))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(/Showing earlier data — offline/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(document.querySelector('.stat-tile')).toBeTruthy() // data stayed up
  })

  it('a first-load failure shows the frame’s alert alone', async () => {
    vi.mocked(fetchSummary).mockRejectedValueOnce(new ApiError('boom', 500))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('boom')
    expect(document.querySelector('.stat-tile')).toBeNull()
  })

  it('honors the owner scope from the URL for net worth and holdings, not spending', async () => {
    renderPage('/?owner=2')
    await screen.findByText('Overview')
    await waitFor(() => expect(vi.mocked(fetchSummary)).toHaveBeenCalledWith(2, undefined))
    expect(vi.mocked(fetchTimeseries)).toHaveBeenCalledWith('monthly', 2)
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledWith(2)
    expect(vi.mocked(fetchMatrix)).toHaveBeenCalledTimes(1) // household-wide, no owner
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
  })
})
```

(`renderPage(entry?)` is the file's render helper; extend it to accept an initial entry for `MemoryRouter`. If `fetchHoldings` has no owner parameter today, check `src/api/portfolio.ts` — the holdings fetcher takes an owner query; use its actual signature in the assertion.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx` → the four new tests fail.

- [ ] **Step 3: Migrate the page**

Imports: add `PageFrame from '../components/shell/PageFrame'`, `ScopeBar from '../components/shell/ScopeBar'`, `{ useScope } from '../components/shell/useScope'`; remove the `PageSkeleton` import.

Scope + load: replace `const load = () => { … }` (plain function) with a `useCallback` over the owner, and the snapshot key with an owner-keyed one:

```tsx
  const { scope } = useScope({ owner: true })
  const owner = scope.owner
  const snapshotKey = `overview:${owner === null ? 'all' : owner}`
  const cached = getSnapshot<OverviewData>(snapshotKey)
  // …the existing useState initializers read `cached` (they used SNAPSHOT_KEY before)…

  const load = useCallback(() => {
    const seq = ++seqRef.current
    Promise.all([
      fetchSummary(owner),
      fetchTimeseries('monthly', owner),
      fetchHoldings(owner),
      fetchHistory(),          // household until the history endpoint grows an owner param
      fetchMatrix(),
      fetchAllTaxSummaries(),
      fetchLots(),
      fetchTaxYears(),
      fetchYearly(),
      fetchDividends(),
      fetchSystemStatus(),
    ])
      .then(([summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system]) => {
        if (seq !== seqRef.current) return
        const snapshot: OverviewData = { summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system }
        const previous = getSnapshot<OverviewData>(snapshotKey)
        setSnapshot(snapshotKey, snapshot)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot)) return
        setFromCache(false)
        setData(snapshot)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the overview.')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }, [owner, snapshotKey])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    loadUpNext()
    loadFlow(null)
    // mount-only: these two are household-wide and never re-run on scope changes
  }, [])
```

(Keep the file's existing comments about seqRef and the house idioms; adapt them.) The `reload` handler stays (`setBusy(true); load(); loadUpNext(); loadFlow(flowYear)`).

Render: replace the header/banner/skeleton/dim block with:

```tsx
    <div className="page overview-page">
      <PageFrame
        title="Overview"
        actions={
          <button type="button" className="button" onClick={reload}>
            Refresh
          </button>
        }
        scopeRow={<ScopeBar owner />}
        resource={{
          status: data === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy,
          fromCache,
          retry: reload,
        }}
        skeleton={{
          tiles: 4,
          cards: [
            { span: 12, height: 220 },
            { span: 12, height: 280 },
            { span: 12, height: 240 },
            { span: 12, height: 200 },
          ],
        }}
      >
        {data !== null && (
          <>
            …the existing body: attention strip, kpi-row, YTD card, charts, money flow, up next, footer…
          </>
        )}
      </PageFrame>
    </div>
```

Delete the old `<header>`, `{error && …}` banner, the `data === null ? … : …` skeleton branch and the `loading-dim` wrapper (PageFrame renders the dim). Keep `data !== null &&` around the body so TypeScript narrows as before.

Owner-aware copy: on the Spending tile pass `hint={owner === null ? existingHint : `${existingHint} Household total — spending has no owner.`}`; on the Portfolio performance card's InfoHint append ` Household history; owner scope does not apply to the weekly checkpoints.` when `owner !== null`.

- [ ] **Step 4: Update the existing Overview tests**

Anything that queried `aria-label="Retry loading the overview"` now uses `getByRole('button', { name: 'Retry' })`; the stale sentence is `Showing earlier data — <error>`; the first-load-failure test asserts the frame's alert; tests that counted `.stat-tile` inside `.loading-dim` still work (PageFrame wraps children in `loading-dim`). Add `fetchHousehold`/`fetchCoverage` mocks to the module mocks.

- [ ] **Step 5: Run, lint, commit**

Run: `npx vitest run src/pages/OverviewPage.test.tsx && npx tsc -b && npx eslint src/pages/OverviewPage.tsx`

```bash
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.css src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): render through PageFrame; honor the shared owner scope"
```

---

### Task 2: Net worth on PageFrame — owner, range and month from the URL

**Files:**
- Modify: `src/pages/NetWorthPage.tsx`, `src/pages/NetWorthPage.css`, `src/pages/NetWorthPage.test.tsx`

What goes: the `<div className="page-header">…</div>` block with the old `MonthRibbon` and the Enter-month button (lines ~454–465); the `networth-owner-row` block (~468–486); the `error-banner` (~488–500); the `RangeChips` in the chart header (~593); the `.networth-owner-row` CSS. What stays: the owner strip `<dl className="networth-owner-strip">`, both charts, the account drill chips (converted to `Segmented variant="chips" multiple`), the accounts table.

- [ ] **Step 1: Write the failing tests** (append to `NetWorthPage.test.tsx`; add `vi.mock('../api/coverage', …)` resolving `{ balances: [...fixture months], spending: [], net_pay: [] }`; keep the existing `fetchHousehold` mock)

```tsx
describe('NetWorthPage — shell scope', () => {
  it('reads owner and range from the URL and fetches accordingly', async () => {
    renderPage('/net-worth?owner=joint&range=ytd')
    await screen.findByText('Net worth')
    await waitFor(() => expect(vi.mocked(fetchTimeseries)).toHaveBeenCalledWith('monthly', 'joint'))
    expect(vi.mocked(fetchSummary)).toHaveBeenCalledWith('joint', undefined)
    expect(screen.getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('picking an owner in the scope row rewrites the URL and refetches that scope', async () => {
    renderPage('/net-worth')
    await screen.findByRole('button', { name: 'Grace' })
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(vi.mocked(fetchTimeseries)).toHaveBeenLastCalledWith('monthly', 2))
    expect(screen.getByTestId('location').textContent).toContain('owner=2')
  })

  it('viewing a month through the ribbon fetches that month’s summary and shows its balances', async () => {
    renderPage('/net-worth')
    await screen.findByText('Net worth')
    fireEvent.click(await screen.findByRole('button', { name: /^Jul 2026/ }))
    await waitFor(() => expect(vi.mocked(fetchSummary)).toHaveBeenLastCalledWith(null, '2026-07-01'))
    expect(screen.getByTestId('location').textContent).toContain('month=2026-07')
    expect(screen.getByRole('button', { name: 'Back to latest' })).toBeTruthy()
    // The accounts table's Balance column now reads July's figures from the timeseries.
    expect(screen.getByText(JULY_CHECKING_BALANCE)).toBeTruthy()
  })

  it('renders no bespoke header, owner row, or range chips of its own', async () => {
    renderPage('/net-worth')
    await screen.findByText('Net worth')
    expect(document.querySelector('.page-header')).toBeNull()
    expect(document.querySelector('.networth-owner-row')).toBeNull()
    expect(document.querySelectorAll('[aria-label="Time range"]')).toHaveLength(1) // the scope row's
  })
})
```

Define `JULY_CHECKING_BALANCE` from the fixture (the formatted balance of one account in the July column of the timeseries fixture). `renderPage(entry)` renders inside `MemoryRouter` with a `LocationProbe` (`data-testid="location"`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/NetWorthPage.test.tsx`

- [ ] **Step 3: Migrate the page**

Imports: add `PageFrame`, `ScopeBar`, `useScope`, `Segmented`; remove `MonthRibbon`, `RangeChips`, `PencilLine` stays (Enter month button).

Scope adoption — replace the `owner`/`range` state and `selectOwner`:

```tsx
  const { scope, setScope } = useScope({ owner: true, range: true, month: true })

  // The URL is the source of truth for owner and range; this page ADOPTS changes with the
  // adjust-during-render pattern (CategoriesPanel's precedent) — never a setState inside an
  // effect body (react-hooks/set-state-in-effect). Local `owner` exists only so the peek-and-
  // reset sequence below runs exactly once per change.
  const [owner, setOwner] = useState<OwnerScope>(scope.owner)
  if (scope.owner !== owner) {
    // The drill-down holds ACCOUNT ids, and the next scope may not contain them — clear it
    // and let load()'s seed pick this scope's biggest account.
    setDrill([])
    setLoading(true)
    setError(null)
    const peeked = getSnapshot<NetWorthSnapshot>(netWorthKey(granularity, scope.owner, scope.month))
    if (peeked !== undefined) {
      shown.current = peeked
      setFromCache(true)
      setData(peeked.ts)
      setSummary(peeked.summary)
      if (peeked.ts.months.length > 0) setDrill(defaultDrill(peeked.ts))
    }
    setOwner(scope.owner)
  }

  const [range, setRange] = useState<RangeState>({ preset: scope.range })
  if (scope.range !== range.preset) {
    // A new preset from the scope row snaps any ctrl+wheel wander (the chips' old contract).
    setRange({ preset: scope.range })
  }
```

(`shown.current = peeked` is a ref write during render; `shown` is a `useRef` — move that one assignment into `load()`'s `.then` by comparing against `peeked` there instead, i.e. keep `shown` updated only from continuations. Concretely: drop the `shown.current = peeked` line here; in `load()`'s `.then`, the identical-payload skip already compares `shown.current` — the peeked paint then gets replaced by the live payload once, which is acceptable.)

Extend the snapshot key to carry the viewed month: `netWorthKey(granularity, owner, month: string | null)` → `` `networth:${granularity}:${owner ?? 'all'}:${month ?? 'latest'}` `` (rename the family prefix to `networth:` if it is not already — Plan 1c's invalidation map lists `networth`). `load` becomes:

```tsx
  const load = useCallback(() => {
    Promise.all([fetchTimeseries(granularity, owner), fetchSummary(owner, scope.month ?? undefined)])
      .then(([ts, sum]) => {
        const key = netWorthKey(granularity, owner, scope.month)
        // …existing continuation body, with the drill seed reset when the owner changed:
        if (lastOwnerRef.current !== owner) {
          lastOwnerRef.current = owner
          seededDrillRef.current = false
        }
        // …then the existing seed logic…
      })
      .catch(…)
      .finally(() => setLoading(false))
  }, [granularity, owner, scope.month])
```

with `const lastOwnerRef = useRef<OwnerScope>(scope.owner)` declared beside `seededDrillRef`. Delete `coverageMonths`, `filledMonths`, `anchor` and the `selectOwner` function. Keep `household`/`orderedPeople`/`ownerScopes` for the owner strip and the stack-by toggle.

Ribbon figures — the ribbon prints that month's net worth on hover:

```tsx
  const ribbonFigures = useMemo(
    () =>
      data === null
        ? undefined
        : Object.fromEntries(data.months.map((m, i) => [m, formatCurrency(data.net_worth[i])])),
    [data],
  )
```

Viewed month for the table — replace `const lastIndex = months.length - 1` with:

```tsx
  // The accounts table follows the viewed month (ribbon click → ?month=); latest by default.
  const viewedIndex = scope.month === null ? months.length - 1 : Math.max(0, months.indexOf(scope.month))
```

and use `viewedIndex` wherever `lastIndex` was used for the Balance and MoM % columns (the MoM % compares `viewedIndex` against `viewedIndex - 1`).

Render:

```tsx
    <div className="page">
      <PageFrame
        title="Net worth"
        actions={
          <button className="button button-primary" onClick={() => navigate('/update')}>
            <PencilLine size={15} /> Enter month
          </button>
        }
        scopeRow={
          <ScopeBar
            owner
            range
            month={{ mode: 'view', figures: ribbonFigures, editHref: (m) => `/update?month=${m}` }}
          />
        }
        resource={{
          status: data === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy: loading,
          fromCache,
          retry: () => {
            setLoading(true)
            setError(null)
            load()
          },
        }}
        skeleton={{ tiles: 4, cards: [{ span: 12, height: 360 }, { span: 12, height: 300 }] }}
      >
        {summary && summary.month && (<div className="kpi-row">…unchanged tiles…</div>)}
        {ownerScopes.length > 0 && summary && … && (<dl className="networth-owner-strip">…unchanged…</dl>)}
        <div className="card-grid">
          …the two chart cards and the accounts table, unchanged except:
          – the chart header's `<RangeChips …/>` is REMOVED (the scope row owns the range);
          – the "Stack by" and "Granularity" `.segmented` groups become
            <Segmented variant="toggle" ariaLabel="Stack by" options={[{ value: 'group', label: 'By group' }, { value: 'owner', label: 'By owner' }]} value={stackBy} onChange={setStackBy} />
            <Segmented variant="toggle" ariaLabel="Granularity" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }]} value={granularity} onChange={(g) => { setLoading(true); setError(null); setGranularity(g) }} />
          – the drill chip row becomes
            <Segmented variant="chips" multiple ariaLabel="Accounts to compare" options={orderedAccounts.map((a) => ({ value: String(a.id), label: a.name, disabled: !drill.some((d) => d.accountId === a.id) && drill.length >= PALETTE.length }))} value={drill.map((d) => String(d.accountId))} onChange={(values) => syncDrill(values.map(Number))} />
            where `syncDrill(ids)` adds newly present ids via the existing `toggleDrill` slot logic and removes absent ones.
        </div>
      </PageFrame>
    </div>
```

The `card-grid` no longer carries `loading-dim` (PageFrame dims). `beginLoad` is inlined where it was used.

- [ ] **Step 4: Update the existing Net worth tests**

- Owner chips: the group is now `getByRole('group', { name: 'Whose' })` (was `'Owner'`); the eyebrow text is "Whose".
- Range chips: `getByRole('group', { name: 'Time range' })` still exists (inside the scope row); tests asserting a re-click snaps a zoom wander should now assert that choosing a *different* preset snaps (the URL cannot express a re-click).
- Ribbon: old labels `"Sep 2026"` / `"Aug 2026 — no data"` become `"Sep 2026 — $806,667.88 — balances entered, spending missing"` style labels; use regex prefixes (`/^Sep 2026/`). The old "click navigates to /update?month=" test becomes the new view-mode test (Task 2 Step 1) plus an Edit-link assertion: `getByRole('link', { name: 'Edit Jul 2026 in the wizard' })` after selecting July.
- Header/banner: Retry is `getByRole('button', { name: 'Retry' })`; stale copy is `Showing earlier data — …`.
- Drill chips: `getByRole('button', { name: 'Schwab ESPP' })` inside the group `'Accounts to compare'`, `aria-pressed` semantics unchanged.
- Mock `fetchCoverage`.

- [ ] **Step 5: CSS**

Delete `.networth-owner-row` rules from `NetWorthPage.css`; keep `.networth-owner-strip` and `.networth-chart-header`.

- [ ] **Step 6: Run, lint, commit**

Run: `npx vitest run src/pages/NetWorthPage.test.tsx && npx tsc -b && npx eslint src/pages/NetWorthPage.tsx`

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.css src/pages/NetWorthPage.test.tsx
git commit -m "feat(net-worth): render through PageFrame; owner/range/month from the URL; ribbon view mode with summary month"
```

---

### Task 3: Whole-suite check and visual smoke

- [ ] Run `npx tsc -b && npx eslint src && npx vitest run`. Fix anything red (commit as `fix(shell): plan 2 suite fixes`).
- [ ] With the dev stack running (backend on 8000 with the 1b/1c endpoints, frontend on 5173), run the audit's headless walk for `/`, `/?owner=2`, `/net-worth`, `/net-worth?month=2026-07&range=ytd&owner=all` in both themes; confirm the sticky scope row pins on scroll (screenshot after `window.scrollTo(0, 1200)`), the ribbon shows two-tone chips and the Back-to-latest chip, and no console errors. Save screenshots under the session scratchpad.

---

## Self-review

**Spec coverage:** §5 PageFrame adoption on two pages (header, actions, subheader unused, sticky scope row, five states) → Tasks 1–2; §6 Overview honors owner with household-only spending/history noted in hints, Net worth owner + range + month from the URL, default range 1Y via `useScope`, owner row deletion → Tasks 1–2; §7 ribbon view mode with figures, Edit link, summary month, viewed-month table → Task 2; §8 Segmented adopters on Net worth (stack-by, granularity, drill chips) → Task 2; §16 phase 2 → both. **Placeholders:** none — where a fixture value is needed the step names which fixture to read. **Type consistency:** `useScope({owner, range, month})` returns `{scope, setScope}`; `ScopeBar` props `owner`, `range`, `month={{mode, figures, editHref}}`; `PageFrame` props `title/actions/scopeRow/resource/skeleton`; `fetchSummary(owner, month?)`; `netWorthKey(granularity, owner, month)` — consistent with Plans 1a/1b.
