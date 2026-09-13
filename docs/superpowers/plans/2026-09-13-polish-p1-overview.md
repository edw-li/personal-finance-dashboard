# Polish P1 — Overview · Monthly update · Spending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land lane P1 of the 2026-09-13 surface-grammar batch: a real loading state for the monthly update, the Review step re-laid as tiles + attached notes + a kebab menu + a card for historical review, the Overview's orphan text folded into a Data status card and tile badges, deeper cards on the grid, ghosts instead of dashes, action-phrased attention rows, popover Customize, the Spending page's orphan line folded into its tile, dock donut with a legend list, Total-budget gating, an inline single-open budget editor, and the review-vocabulary copy pass.

**Architecture:** Every change is inside the files lane P1 owns (`OverviewPage.*`, `components/overview/*`, `MonthlyUpdatePage.*`, `components/monthly/*`, `SpendingPage.*`, `components/spending/*`, `api/monthReview.ts` labels, README). Shared primitives (`StatTile badge`, `GhostTile delta`, `Disclosure`, `usePopoverDismiss` + `.popover-surface`, `ChartCard aside`, `PageFrame sections`) were delivered by lanes F1/F2 and are consumed by name here, never edited. Pure rules that need a clock or a fixture (attention rows, freshness labels, receipt labels, pie legend, budget gating) live in small pure modules with their own tests; pages only wire them.

**Tech Stack:** React 19 + TypeScript (Vite), vitest + Testing Library/jsdom, lucide-react icons, ECharts option builders (never rendered in jsdom), CSS with motion tokens only (`var(--t-*)`).

**Worktree / branch:** `.worktrees/polish-p1` on `polish/p1-overview`, branched from `main` AFTER F1 and F2 merged. Implementer runs `model: opus` (house mandate). No pushes. Commit after every task with the prefixes given (`feat(update):`, `fix(review):`, `feat(overview):`, `feat(spending):`, `docs(readme):`).

---

## Assumed primitives (delivered by F1/F2 — verify in Task 0, adapt only import names)

| Name | Where | Signature assumed here |
| --- | --- | --- |
| `StatTile` | `src/components/StatTile.tsx` (default export) | gains `badge?: ReactNode`, rendered after the label as `.stat-badge` |
| `GhostTile` | `src/components/PageSkeleton.tsx` (named export) | gains `delta?: boolean` |
| `Disclosure` | `src/components/Disclosure.tsx` (default export assumed) | `summary: ReactNode`, `defaultOpen?`, `open?`, `onToggle?`, `onOpen?`, `className?` → renders `<details class="disclosure …"><summary>…</summary><div class="disclosure-body">children</div></details>` with children ALWAYS rendered |
| `usePopoverDismiss` | `src/components/usePopoverDismiss.ts` (named export) | `usePopoverDismiss(open: boolean, onClose: () => void, triggerRef: RefObject<HTMLElement \| null>, surfaceRef: RefObject<HTMLElement \| null>)` — outside `pointerdown` + Escape close, focus returns to the trigger |
| `.popover-surface` | `src/components/panels.css` | `position:absolute; z-index:20; background/border/shadow/padding` — the caller positions it (`right`/`top`) inside a `position: relative` wrapper |
| `ChartCard` | `src/components/ChartCard.tsx` | gains `aside?: ReactNode` (second column beside the chart) |
| `PageFrame` | `src/components/shell/PageFrame.tsx` | `sections` slot already wired for Spending by F2 (`sections={<LocalSectionNav … />}` replaced the `subheader` prop) — do NOT re-wire |
| `.kpi-row`, `.card-grid`, `.span-6`, `.span-12` | `panels.css` | as today, plus F2's `.kpi-row > :last-child { grid-column-end: -1 }` and the container-query two-column fallback |

If a name differs (e.g. `Disclosure` is a named export, or the hook takes three arguments), change the IMPORT/CALL in this lane's files to match — never edit the primitive.

## File structure

| File | Responsibility (after this plan) |
| --- | --- |
| `src/components/monthly/ReviewChanges.tsx` (+ test) | The Review step's two difference tables; only categories the save will record are compared (bug F2); count eyebrow + method footer |
| `src/pages/MonthlyUpdatePage.tsx` (+ `.css`, test) | Two-tier load (seed feeds first, aids later), `seeded` sentinel, skeleton, keep-mounted busy card, coverage instead of timeseries, Review KPI row, footer note, kebab month-actions popover |
| `src/components/monthly/HistoricalReview.tsx` (+ test) | A `.card` with eyebrow, summary, Load history, rows grouped by year, per-year Select all eligible, missing-feed reasons, "Close selected months (N)" |
| `src/components/overview/freshness.ts` (+ test) | Each clause also exposes `label`/`detail` for the Data status card's `dl` |
| `src/components/overview/DataStatusCard.tsx` (new, + test) | The third agenda card: four clocks as `dl` rows + the comparison sentence |
| `src/components/overview/netWorthReceipt.ts` (new, + test) | Hero receipt components labelled with `GROUP_LABELS` |
| `src/components/overview/attention.ts` (+ test) | `reviewAttentionItems()` — past-month review rows phrased as actions; `UPDATE_NUDGE_DAY` exported |
| `src/components/overview/OverviewCustomize.tsx` | Popover (`aria-haspopup="dialog"`, `.popover-surface[role=dialog]`, Done, "Recent spending") |
| `src/pages/OverviewPage.tsx` (+ `.css`, test) | Uses the above; tiles ghost while their group is busy; deeper cards on `card-grid`; YTD copy/layout; no orphan text |
| `src/components/spending/spendingChartOptions.ts` (+ test) | `spendingBarsOption` budget gating by displayed window; `monthPieOption(..., { compact })`; `monthPieLegend()` |
| `src/components/spending/BreakdownLegend.tsx` (new) + `breakdownLegend.css` | The dock donut's legend list (ChartCard `aside`) |
| `src/components/spending/BudgetPanel.tsx` (+ `budgets.css`, test) | Single-open inline editor (Set/Edit budget buttons), unbudgeted section as plain section or `Disclosure`, seed empty state on one row |
| `src/pages/SpendingPage.tsx` (+ `.css`, test) | Tile delta/badge replaces the orphan line; range chips only on Overview/Trends; donut aside |
| `src/pages/OverviewPage.css` | `.spending-metric-context` deleted (it styled another page) |
| `src/api/monthReview.ts` (+ new test) | `REVIEW_LABELS` copy |
| `README.md` | Windows `DATABASE_URL` host note |

## Conventions the implementer must keep

- **Motion:** no literal durations in any stylesheet (`motion.test.ts` fails the build); use `var(--t-fast)` etc. Nothing in this lane needs a new animation — the shared `.popover-surface` and `.disclosure` already animate.
- **Per-page stylesheets never depend on another page's sheet.** `.spending-metric-context` in `OverviewPage.css` is deleted, not moved.
- **React hooks lint:** no `setState` in an effect's synchronous body; promise callbacks are fine. Do not add `useCallback` around the wizard's load chain (React Compiler note in the file).
- **Tests:** update, never delete. Every new behaviour gets a focused test. echarts is never rendered in jsdom — the `EChart` mock is already in place in each page test.
- **Commands** run from the worktree root. Expected outputs below are the shapes to look for; counts may differ by a few if other lanes merged more tests.

---

### Task 0: Branch, verify the primitives, baseline the gates

**Files:** none modified.

- [ ] **Step 1: Create the worktree from the merged main**

```bash
cd C:/Users/edyli/personal-finance-dashboard
git worktree add .worktrees/polish-p1 -b polish/p1-overview main
cd .worktrees/polish-p1
npm ci
```
Expected: `added N packages` and a clean `git status`.

- [ ] **Step 2: Verify every assumed primitive exists under the assumed name**

```bash
grep -n "badge" src/components/StatTile.tsx | head -3
grep -n "export function GhostTile" src/components/PageSkeleton.tsx
grep -n "^export" src/components/Disclosure.tsx
grep -n "^export" src/components/usePopoverDismiss.ts
grep -n "popover-surface" src/components/panels.css | head -2
grep -n "aside" src/components/ChartCard.tsx | head -3
grep -n "sections=" src/pages/SpendingPage.tsx
```
Expected: each grep prints at least one line. Note the exact export style of `Disclosure` (default vs named) and the parameter list of `usePopoverDismiss`; if they differ from the table above, use the real names in every import/call below.

- [ ] **Step 3: Baseline the gates so regressions are attributable**

```bash
npx tsc -b && npx vitest run --reporter=dot 2>&1 | tail -5
```
Expected: `tsc` silent; vitest summary `Test Files N passed`, `Tests M passed` (no failures on the merged main). Write the two numbers down — the final gate compares against them.

---

### Task 1: `ReviewChanges` compares only the categories the save will record (bug F2)

**Files:**
- Modify: `src/components/monthly/ReviewChanges.tsx`
- Modify: `src/components/monthly/ReviewChanges.test.tsx`
- Modify: `src/pages/MonthlyUpdatePage.tsx` (hoist `sentCategories`; pass `recordedCategories`)
- Modify: `src/pages/MonthlyUpdatePage.test.tsx` (new page-level test)

- [ ] **Step 1: Write the failing component test**

Replace the whole of `src/components/monthly/ReviewChanges.test.tsx` with:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import ReviewChanges from './ReviewChanges'

afterEach(cleanup)
const accounts = [{ id: 1, name: 'Checking', is_component: false }] as AccountOut[]
const categories = [{ id: 2, name: 'Food' }] as CategoryOut[]
const matrix = { months: ['2025-01-01'], series: [{ category_id: 2, values: ['100.00'], budgets: [null] }] } as SpendingMatrix

it('counts blank-to-zero as an entry change and does not show missing input as a measured drop', () => {
  const base = { accounts, categories, priorBalances: { 1: '500.00' }, month: '2025-02-01', monthExisted: true, matrix,
    baseline: JSON.stringify({ balances: { 1: '' }, amounts: { 2: '' }, netPay: '' }) }
  const view = render(<ReviewChanges {...base} balances={{ 1: '' }} amounts={{ 2: '' }} recordedCategories={new Set()} />)
  expect(screen.getByText('No changed balances with a prior-month reference.')).toBeTruthy()
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  // A typed $0.00 for a category with a stored row IS a recorded figure — the save lists it.
  view.rerender(<ReviewChanges {...base} balances={{ 1: '0.00' }} amounts={{ 2: '0.00' }} recordedCategories={new Set([2])} />)
  expect(screen.getByRole('status').textContent).toContain('1 account balances and 1 categories changed')
  expect(screen.getByText('Food')).toBeTruthy()
  expect(screen.getByText('Checking')).toBeTruthy()
})

// Bug F2 (2026-09-13 audit): the wizard seeds every category at "0.00", so a month mid-entry
// listed nineteen untouched seeds as nineteen −100% "differences".
it('leaves an untouched $0.00 seed out of the spending differences, but compares a recorded zero', () => {
  const base = { accounts, categories, priorBalances: {}, balances: {}, month: '2025-02-01', monthExisted: false, matrix, baseline: null }
  const view = render(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set()} />)
  expect(screen.getByText('No differences with an available recent reference.')).toBeTruthy()
  expect(screen.queryByText('Food')).toBeNull()
  view.rerender(<ReviewChanges {...base} amounts={{ 2: '0.00' }} recordedCategories={new Set([2])} />)
  expect(screen.getByText('Food')).toBeTruthy()
  expect(screen.getByText('-$100.00')).toBeTruthy()
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/monthly/ReviewChanges.test.tsx`
Expected: FAIL — TypeScript/runtime: `recordedCategories` is not a prop yet; the second test finds "Food" in the differences table.

- [ ] **Step 3: Implement the prop in `ReviewChanges.tsx`**

Change the signature and the `unusual` computation (lines 30-42):

```tsx
export default function ReviewChanges({ accounts, categories, balances, amounts, priorBalances, baseline, month, matrix, monthExisted, recordedCategories }: {
  accounts: AccountOut[]; categories: CategoryOut[]; balances: Record<number, string>; amounts: Record<number, string>
  priorBalances: Record<number, string>; baseline: string | null; month: string; matrix: SpendingMatrix | null; monthExisted: boolean
  /** The category ids this save will write a spending row for — the page's `sentCategories`
   *  with `willWriteSpending` folded in (empty when the leg is skipped). A category outside it
   *  is an untouched "0.00" seed, and a seed is not a figure to check against a median (bug F2). */
  recordedCategories: ReadonlySet<number>
}) {
  const saved = baseline ? JSON.parse(baseline) as { balances: Record<number, string>; amounts: Record<number, string>; netPay: string } : null
  const balanceRows = accounts.filter(a => !a.is_component)
  const prior = largest(balanceRows.filter(a => entered(priorBalances[a.id]) && entered(balances[a.id])).map(a => ({ id: a.id, label: a.name, before: amount(priorBalances[a.id]), after: amount(balances[a.id]) })))
  const unsavedBalances = saved ? balanceRows.filter(a => changed(saved.balances[a.id], balances[a.id])).length : 0
  const unsavedCategories = saved ? categories.filter(c => changed(saved.amounts[c.id], amounts[c.id])).length : 0
  const unusual = largest(categories.flatMap(c => {
    const typical = matrix ? typicalSpend(matrix, month, c.id) : null
    return typical === null || !recordedCategories.has(c.id) || !entered(amounts[c.id]) ? [] : [{ id: c.id, label: c.name, before: typical, after: amount(amounts[c.id]) }]
  }))
```
Leave the JSX as it is for now (Task 3 restructures it).

- [ ] **Step 4: Hoist `sentCategories` in the page and pass the set**

In `src/pages/MonthlyUpdatePage.tsx`, directly after the `willWriteSpending` const (ends at line 687, `hadSpending || anyAmountEntered || netPay.trim() !== '' || recordZero`), add:

```tsx
  // The categories the spending leg LISTS (2026-09-09 item 1): every one with a stored row (a
  // correction to $0.00 must land), every one carrying a figure, and all of them under the $0
  // consent. Derived ONCE, here, for save()'s body AND the Review step's difference table
  // (bug F2, 2026-09-13): a seed nobody touched is in neither.
  const sentCategories = useMemo(
    () =>
      categories.filter(
        (c) =>
          recordZero ||
          storedCategories.has(c.id) ||
          (Number(canonicalAmount(amounts[c.id] ?? '')) || 0) !== 0,
      ),
    [categories, recordZero, storedCategories, amounts],
  )
  // …and as a set, only while the leg will run at all: a skipped leg records nothing.
  const recordedCategoryIds = useMemo(
    () => new Set(willWriteSpending ? sentCategories.map((c) => c.id) : []),
    [willWriteSpending, sentCategories],
  )
```

Inside `save()`, delete the local computation (the comment block starting `// Spec 2026-09-09 item 1: what the body LISTS is what gets a row.` through the closing `)` of `const sentCategories = categories.filter(…)`, lines 792-802) and replace it with:

```tsx
    // `sentCategories` is the component-level memo above — one rule for the wire and the review.
```
The rest of `save()` already refers to `sentCategories` and keeps working.

In the Review step JSX, extend the `<ReviewChanges … />` call (line 1766-1768) with the new prop:

```tsx
            <ReviewChanges accounts={accounts} categories={categories} balances={balances} amounts={amounts}
              priorBalances={priorBalances} baseline={baseline?.month === month ? baseline.data : null}
              month={month} matrix={matrix} monthExisted={monthExisted} recordedCategories={recordedCategoryIds} />
```

- [ ] **Step 5: Add the page-level test**

Append to `src/pages/MonthlyUpdatePage.test.tsx` (after the `'writes balances only when nothing was entered on the spending step, and says so'` test, ~line 1365):

```tsx
// Bug F2 (2026-09-13 audit): Food has a $300 median in the fixture matrix; its seeded "0.00"
// is not a −$300 difference until something is actually recorded for the month.
it('lists no spending difference for a seeded category nobody touched, then lists it once entered', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  await screen.findByText('No differences with an available recent reference.')
  expect(screen.queryByRole('rowheader', { name: 'Food' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
  await enterSpending('250.00')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  expect(await screen.findByRole('rowheader', { name: 'Food' })).toBeTruthy()
  expect(screen.getByText('-$50.00')).toBeTruthy()
})
```

- [ ] **Step 6: Run both test files**

Run: `npx vitest run src/components/monthly/ReviewChanges.test.tsx src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS (all tests in both files).

- [ ] **Step 7: Commit**

```bash
git add src/components/monthly/ReviewChanges.tsx src/components/monthly/ReviewChanges.test.tsx src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "fix(review): compare only the categories the save records — an untouched \$0.00 seed is not a spending difference (bug F2)"
```

---
### Task 2: Monthly update — skeleton, two-tier load, keep-mounted busy card, coverage instead of timeseries

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (imports, state, load effect ~L402-602, `resource`/`skeleton` ~L1264-1270, the four `!loading &&` gates ~L1315/1578/1728/1836)
- Modify: `src/pages/MonthlyUpdatePage.test.tsx`

Design (spec §9, evidence F1/L7). Two tiers of feeds: the SIX per-month feeds the seed and the save are built from — accounts, categories, this month's balances, the prior month's balances (a new month is pre-filled from them), this month's spending, and the review (a save carries its revision) — gate the first paint; the THREE household-wide aids (matrix behind the Typical column, household grouping, coverage) land on their own and each already tolerates absence. A new `seeded: LoadedMonth | null` state says "a seed is on screen"; `loading` keeps saying "a load is in flight". The step card is gated on `seeded !== null` (not `!loading`), carries `key={seeded.generation}` (so a landed load remounts it and the first cell's `autoFocus` fires as before), and while `loading` it is `aria-busy` + `inert` under the frame's busy dim.

- [ ] **Step 1: Add a `deferred` helper and three failing tests to `MonthlyUpdatePage.test.tsx`**

Add after the `renderWizard()` helper (~line 213):

```tsx
// A promise settled by hand — the only way to hold one feed in flight while the page paints
// (OverviewPage.test's helper).
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
```

Add these tests right after the `'offers a Retry instead of a dead form when the month fails to load'` test (~line 683):

```tsx
// F1 (2026-09-13 audit): every visit showed an empty body for the slowest feed's duration.
it('ghosts the step card while the first month loads instead of leaving the body blank', async () => {
  const gate = deferred<(typeof account)[]>()
  vi.mocked(netWorthApi.fetchAccounts).mockImplementation(() => gate.promise)
  renderWizard()
  await screen.findByRole('heading', { level: 1, name: `Monthly update — ${formatMonth('2026-08-01')}` })
  expect(document.querySelector('.page-skeleton')).not.toBeNull()
  expect(screen.queryByLabelText('Checking')).toBeNull()
  await act(async () => { gate.resolve([account]) })
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
  expect(document.querySelector('.page-skeleton')).toBeNull()
})

it('keeps the step card mounted and busy through a month switch, swapping when the new month lands', async () => {
  type Balances = Awaited<ReturnType<typeof netWorthApi.fetchMonthBalances>>
  const june = deferred<Balances>()
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation((month: string) =>
    month === '2026-06-01'
      ? june.promise
      : Promise.resolve({ month, exists: month === '2026-07-01', recorded_on: null, notes: null,
          balances: month === '2026-07-01' ? [{ account_id: 1, balance: '1500.00' }] : [] }),
  )
  const { container } = renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  // Still on screen — dimmed, marked busy and inert — no skeleton, no blank, no height jump.
  const card = screen.getByLabelText('Checking').closest('.card') as HTMLElement
  expect(card.getAttribute('aria-busy')).toBe('true')
  expect(card.hasAttribute('inert')).toBe(true)
  expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
  expect(document.querySelector('.page-skeleton')).toBeNull()
  await act(async () => {
    june.resolve({ month: '2026-06-01', exists: true, recorded_on: null, notes: null, balances: [{ account_id: 1, balance: '900.00' }] })
  })
  await waitFor(() => expect((screen.getByLabelText('Checking') as HTMLInputElement).value).toBe('900.00'))
  const landed = screen.getByLabelText('Checking').closest('.card') as HTMLElement
  expect(landed.getAttribute('aria-busy')).toBeNull()
  expect(landed.hasAttribute('inert')).toBe(false)
  expect(container.querySelector('.loading-dim.is-loading')).toBeNull()
})

it('reads which months exist from /coverage rather than the whole net-worth timeseries', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  await waitFor(() => expect(fetchCoverage).toHaveBeenCalled())
  expect(netWorthApi.fetchTimeseries).not.toHaveBeenCalled()
})
```

Then fix the one existing test that fed `coveredMonths` through the timeseries. In the test whose body contains `const next = addMonths(current, 1)` (~line 353), replace the whole `vi.mocked(netWorthApi.fetchTimeseries).mockResolvedValue({ … })` block (lines ~361-373) with:

```tsx
  vi.mocked(fetchCoverage).mockResolvedValue({ balances: [current], spending: [current], net_pay: [current] })
```

- [ ] **Step 2: Run the file to see the new tests fail**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx -t "ghosts the step card|keeps the step card mounted|reads which months exist|start"`
Expected: the three new tests FAIL (no `.page-skeleton`; `aria-busy` null; `fetchTimeseries` called); the "Start next month" test fails too until coverage drives the anchor.

- [ ] **Step 3: Imports and state**

In `src/pages/MonthlyUpdatePage.tsx`:

Replace the netWorth import block (lines 6-11) with:
```tsx
import {
  deleteMonthBalances,
  fetchAccounts,
  fetchMonthBalances,
} from '../api/netWorth'
import { fetchCoverage } from '../api/coverage'
```
Add `CoverageOut,` to the `import type { … } from '../types/api'` list (after `CategoryOut,`).

Replace line 306 (`const [coveredMonths, setCoveredMonths] = useState<Set<string>>(new Set())`) with:
```tsx
  // /coverage — the shared "which months exist" feed (the scope row reads the same one and the
  // api client dedupes the in-flight GET). It replaces the full monthly timeseries the wizard
  // used to download only to learn which months have balances (2026-09-13 polish spec §9).
  const [coverage, setCoverage] = useState<CoverageOut | null>(null)
  const coveredMonths = useMemo(() => new Set(coverage?.balances ?? []), [coverage])
  // The load whose SEED is on screen — null until the first month lands. `loading` says a load
  // is in flight; this says whether there is anything to show under it. A month switch keeps
  // the previous seed mounted and dimmed until the new one arrives (spec §9), so the body is
  // never blank and never jumps 900 → 2,400px.
  const [seeded, setSeeded] = useState<LoadedMonth | null>(null)
```

- [ ] **Step 4: Rewrite the load effect (lines 402-602)**

Replace the effect's opening through the `.then((…) => {` destructuring so it reads:

```tsx
  useEffect(() => {
    // loadNonce has no data role: the wizard delete bumps it to force this chain when
    // the deleted month is the month already on screen.
    void loadNonce
    let cancelled = false
    const loaded = { month, generation: ++loadGeneration.current }
    loadedMonth.current = loaded
    // Two tiers (2026-09-13 polish spec §9). The FIRST PAINT waits for the six per-month feeds
    // the seed and the save are built from. The three household-wide AIDS below land on their
    // own and each already tolerates absence — '—' in the Typical column, a flat group walk, an
    // empty covered set. Every callback checks the same `cancelled` flag, so a late answer for
    // a month the user has left can never land over the month they moved to.
    const matrixPromise = fetchMatrix().catch((): SpendingMatrix | null => null)
    const householdPromise = fetchHousehold().catch((): HouseholdOut | null => null)
    const coveragePromise = fetchCoverage().catch((): CoverageOut | null => null)
    void matrixPromise.then((matrixData) => { if (!cancelled) setMatrix(matrixData) })
    void householdPromise.then((householdData) => { if (!cancelled) setPeople(householdData?.people ?? []) })
    void coveragePromise.then((coverageData) => { if (!cancelled && coverageData !== null) setCoverage(coverageData) })
    Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchMonthBalances(month),
      fetchMonthBalances(addMonths(month, -1)),
      fetchSpendingMonth(month),
      fetchMonthReview(month),
    ])
      .then(([accountList, categoryList, thisMonth, priorMonth, spendMonth, monthReview]) => {
        if (cancelled) return
        setError(null)
        setLoadError(null)
        setLegs(null)
        setReview(monthReview)
        setReviewConfirmations({})
        setFinalCurrentMonth(false)
        setReviewConflict(false)
        setSaving(false)
        saveRequest.current = null
```
Keep the existing body from `// Nested order: component inputs sit right after their aggregate's input` down to `setRestored(draft !== null)` exactly as it is today (it seeds accounts, categories, balances, amounts, net pay, the draft restore and the baseline from the six feeds above) except for these three deletions inside it:
- delete `setCoveredMonths(new Set(timeseries.months))`
- delete `setMatrix(matrixData)`
- delete `setPeople(householdData?.people ?? [])`

Then replace the tail (`.catch` / `.finally` / cleanup) with:

```tsx
        // The seed is on screen from this render: the frame's skeleton or the previous month's
        // dimmed card gives way to this month's. Same batch as the setters above.
        setSeeded(loaded)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(describeError(err, 'this month'))
        setLoading(false)
      })
    return () => {
      cancelled = true
      if (loadedMonth.current === loaded) loadedMonth.current = null
    }
  }, [month, loadNonce])
```

- [ ] **Step 5: The frame's `resource` and `skeleton`**

Replace the `resource={…}` prop (lines 1262-1270, including its comment) with:

```tsx
        // The wizard is a FORM, not a feed — its SAVE failures are banners inside it. Its LOAD is
        // a lifecycle like any other page's (2026-09-13 polish spec §9): a skeleton until the
        // first seed lands, an error-only view when a load fails with nothing to show, and the
        // busy dim over the previous month's card while a switch is in flight. `!loading`
        // retires an error the instant a switch or a Retry starts — the banner is about the
        // month being LEFT, and the load chain clears it on arrival.
        resource={
          loadError !== null && seeded === null && !loading
            ? { status: 'error', error: loadError, retry: retryLoad }
            : {
                status: loading && seeded === null ? 'loading' : 'ready',
                busy: loading,
                error: loading ? null : loadError,
                retry: retryLoad,
              }
        }
        skeleton={{
          tiles: 0,
          cards:
            step === 'review'
              ? [{ span: 12, height: 480 }, { span: 12, height: 58 }]
              : [{ span: 12, height: 640 }],
        }}
```

- [ ] **Step 6: The four gates**

Line 1315 `{!loading && step === 'balances' && (` becomes `{seeded !== null && step === 'balances' && (` and the `<div className="card" data-entry-scope=""` right under it gains three attributes:
```tsx
          <div
            key={seeded.generation}
            aria-busy={loading || undefined}
            inert={loading || undefined}
            className="card"
            data-entry-scope=""
            onPaste={(e) =>
```
(the three new lines go directly under `<div`; the existing `onPaste={(e) => handlePaste(e, orderedBalanceRows.filter((a) => !isReadOnlyRow(a)), (id) => \`bal-${id}\`, fillBalances)}` attribute and the closing `>` follow exactly as they are today).
Line 1578 `{!loading && step === 'spending' && (` becomes `{seeded !== null && step === 'spending' && (` and its card gets the same `key`, `aria-busy`, `inert` attributes.
Line 1728 `{!loading && step === 'review' && (` becomes `{seeded !== null && step === 'review' && (` and `<div className="card">` becomes `<div key={seeded.generation} className="card" aria-busy={loading || undefined} inert={loading || undefined}>`.
Line 1836 `{!loading && step === 'review' && <HistoricalReview …` becomes `{seeded !== null && step === 'review' && <HistoricalReview …` (no key — it is month-independent and keeps its own loaded list).

Why `key`: the old `!loading` gate unmounted the card on every load and remounted it on arrival, which is what ran the first typable cell's `autoFocus` after a month switch, an Undo or the empty-month repair (the `'lands the caret on the first cell after the repair'` test). Keying by the landed generation keeps exactly that: the card stays mounted during the load and is replaced by a fresh mount when the new seed lands.

- [ ] **Step 7: Type-check, then run the wizard suite**

Run: `npx tsc -b && npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: tsc silent (if `inert` is rejected by the JSX types, write `{...(loading ? { inert: true } : {})}` instead — @types/react 19.2 accepts the boolean); all wizard tests PASS including the three new ones and the "Start next month" test.

- [ ] **Step 8: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(update): skeleton on first load, two-tier feeds, keep the step card mounted and busy through a month switch, coverage instead of the timeseries (F1)"
```

---
### Task 3: Review step — four tiles, notes attached to their subjects, pill background, trimmed eyebrow

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (the `preview` memo ~L692-730; the Review card JSX ~L1728-1835)
- Modify: `src/pages/MonthlyUpdatePage.css` (`.review-grid`, `.review-save-summary`, `.month-review-status`, `.wizard-footer`, new rules)
- Modify: `src/components/monthly/ReviewChanges.tsx` (JSX only) and `ReviewChanges.test.tsx`
- Modify: `src/pages/MonthlyUpdatePage.test.tsx` (new test)

Evidence W5/T4/F3/C3. The three floating stats + the tax/transfers/cash-outflow line become a real `.kpi-row` of four `StatTile`s (Net worth, Living spending, Cash outflow with the tax/transfers split as its delta, Cash saved); the "changed since last save" count becomes the eyebrow of the change tables; the method note becomes their footer; the close-gate sentence moves into `.wizard-footer` beside the disabled primary; `.month-review-status` gets a real background; the eyebrow reads "Review & save" (the h1 already names the month).

- [ ] **Step 1: Write the failing tests**

`src/components/monthly/ReviewChanges.test.tsx` — in the first test, change the status assertion to the new grammar:
```tsx
  expect(screen.getByRole('status').textContent).toBe('1 balance · 1 category')
  expect(screen.getByRole('heading', { name: 'Changes since last save' })).toBeTruthy()
```
and add to the end of the file:
```tsx
it('names a new month as a snapshot, not as zero changes', () => {
  render(<ReviewChanges accounts={accounts} categories={categories} balances={{}} amounts={{}} priorBalances={{}} baseline={null} month="2025-02-01" matrix={null} monthExisted={false} recordedCategories={new Set()} />)
  expect(screen.getByRole('status').textContent).toBe('New balance snapshot — review the carried-forward balances before confirming.')
  expect(screen.getByText(/Spending references use up to three prior entered months/).className).toContain('review-changes-footer')
})
```

`src/pages/MonthlyUpdatePage.test.tsx` — append:
```tsx
// W5/T4 (2026-09-13 audit): the receipt reads like the Overview it feeds — four tiles, and the
// close-gate sentence sits in the footer beside the button it explains.
it('lays the Review step out as four tiles with the cash split and the close gate in the footer', async () => {
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category, transferCategory, taxCategory])
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '250.00' } })
  fireEvent.change(screen.getByLabelText('Brokerage deposit'), { target: { value: '100.00' } })
  fireEvent.change(screen.getByLabelText('Tax payment'), { target: { value: '50.00' } })
  fireEvent.change(screen.getByLabelText('Household take-home'), { target: { value: '1000.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  await screen.findByRole('heading', { name: /^Review & save/ })
  const tile = (label: string) => screen.getByText(label).closest('.stat-tile') as HTMLElement
  expect(tile('Net worth').querySelector('.stat-value')?.textContent).toBe('$1,500.00')
  expect(tile('Living spending').querySelector('.stat-value')?.textContent).toBe('$250.00')
  expect(tile('Cash outflow').querySelector('.stat-value')?.textContent).toBe('$300.00')
  expect(tile('Cash outflow').querySelector('.stat-delta')?.textContent).toBe('tax $50.00 · transfers $100.00')
  expect(tile('Cash saved').querySelector('.stat-value')?.textContent).toBe('70.0%')
  expect(tile('Cash saved').querySelector('.stat-delta')?.textContent).toBe('$700.00 of $1,000.00 take-home')
  // The gate sentence lives in the footer, next to the disabled primary.
  const footer = screen.getByRole('button', { name: 'Save and close month' }).closest('.wizard-footer') as HTMLElement
  expect(footer.textContent).toContain('To close, complete all three confirmations')
  // The month is printed by the h1; the eyebrow does not repeat it.
  expect(screen.queryByRole('heading', { name: /Review & save — / })).toBeNull()
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/monthly/ReviewChanges.test.tsx src/pages/MonthlyUpdatePage.test.tsx -t "Changes since|new month as a snapshot|four tiles"`
Expected: FAIL (old status sentence; no "Cash outflow" tile; eyebrow still carries the month).

- [ ] **Step 3: `ReviewChanges.tsx` — eyebrow, count, footer**

Replace `ChangeTable`'s heading from `<h3 className="eyebrow">` to `<h4 className="eyebrow">` (the group now has its own `h3`), then replace the component's `return` with:

```tsx
  const balancesWord = unsavedBalances === 1 ? 'balance' : 'balances'
  const categoriesWord = unsavedCategories === 1 ? 'category' : 'categories'
  return <div className="review-changes">
    {/* T4 (2026-09-13 audit): the count is the eyebrow of the tables it summarises, the method
        note their footer — connective tissue attached to its subject instead of floating. */}
    <div className="review-changes-head">
      <h3 className="eyebrow">Changes since last save</h3>
      <span className="review-changes-count" role="status">{monthExisted
        ? `${unsavedBalances} ${balancesWord} · ${unsavedCategories} ${categoriesWord}`
        : 'New balance snapshot — review the carried-forward balances before confirming.'}</span>
    </div>
    <div className="review-change-grid">
      <ChangeTable title="Largest balance changes · prior month" rows={prior} empty="No changed balances with a prior-month reference." />
      <ChangeTable title="Largest spending differences · recent median" rows={unusual} empty="No differences with an available recent reference." />
    </div>
    <p className="drill-hint review-changes-footer">Spending references use up to three prior entered months. Differences are prompts to check your entries.</p>
  </div>
```

- [ ] **Step 4: `MonthlyUpdatePage.tsx` — the preview carries take-home and cash saved**

In the `preview` memo, after `const pay = netPay.trim() === '' ? null : Number(canonicalAmount(netPay))` add nothing; in the returned object add two fields after `cashSpend,`:
```tsx
      cashSpend,
      // The Cash saved tile's second line: what was left of take-home after cash went out.
      netPay: pay,
      cashSaved: pay === null ? null : pay - cashSpend,
```
Add `import StatTile from '../components/StatTile'` next to the other component imports.

- [ ] **Step 5: `MonthlyUpdatePage.tsx` — the Review card JSX**

Replace everything from `<h2 className="eyebrow">` inside the review card (line 1730) through the closing `</p>` of the tax/transfers hint (line 1765) with:

```tsx
            <div className="review-head">
              <h2 className="eyebrow">
                Review & save
                <InfoHint text="Review the entered figures, then save progress or close a completed month. Your entries stay in this browser until saved." />
              </h2>
              {review && <p className={`month-review-status month-review-status-${review.state}`}>{REVIEW_LABELS[review.state]}{review.closed_at ? ` · Last closed ${new Date(review.closed_at).toLocaleDateString()}` : ''}</p>}
            </div>
            {/* W5 (2026-09-13 audit): the four figures of the approved receipt (design §4.3) as
                real tiles — the app's tile vocabulary, not three label/value pairs 375px apart.
                Cash outflow carries the tax/transfers split the old floating line printed. */}
            <div className="kpi-row review-kpis">
              <StatTile
                label="Net worth"
                value={formatCurrency(preview.netWorth)}
                delta={preview.delta === null ? undefined : `${formatCurrency(preview.delta)} vs prior month`}
                tone={preview.delta === null ? undefined : preview.delta >= 0 ? 'positive' : 'negative'}
                hint="Every non-component balance from the Balances step, summed as it stands now."
              />
              <StatTile
                label="Living spending"
                value={formatCurrency(preview.livingSpend)}
                hint="Living categories only — tax paid from take-home and transfers are counted apart."
              />
              <StatTile
                label="Cash outflow"
                value={formatCurrency(preview.cashSpend)}
                delta={`tax ${formatCurrency(preview.taxSpend)} · transfers ${formatCurrency(preview.transfers)}`}
                tone="neutral"
                hint="Living spending plus tax paid from take-home. Transfers to your own accounts stayed yours and are listed, not counted."
              />
              <StatTile
                label="Cash saved"
                value={preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
                delta={preview.netPay === null || preview.cashSaved === null ? 'enter household take-home to measure' : `${formatCurrency(preview.cashSaved)} of ${formatCurrency(preview.netPay)} take-home`}
                tone="neutral"
                hint="(take-home − living − tax) ÷ take-home — the cash rate the Spending page reports for the month."
              />
            </div>
```

Then replace the two gate/hint paragraphs and the footer — from `{month > currentMonthIso() && <p className="drill-hint">Future months…` (line 1777) through the closing `</div>` of `.wizard-footer` (line 1833) — with:

```tsx
            {month > currentMonthIso() && <p className="drill-hint">Future months can be saved as drafts. Close this month once the period arrives and the figures are final.</p>}
            {!willWriteSpending && (
              // Said BEFORE the click, not only in the receipt after it: "Save month" on an
              // untouched spending step now writes balances only, and a user who expected a
              // month of zeros deserves to learn that while they can still act on it.
              <p className="drill-hint" role="status">
                Spending: nothing entered — this save writes balances only.
              </p>
            )}
            <div className="wizard-footer">
              <button className="button" onClick={() => setStep('spending')}>
                Back
              </button>
              {/* T4: the only explanation of a disabled primary sits beside it, not 90px above. */}
              {!balancesValid ? (
                <p className="drill-hint wizard-footer-note" role="status">Fix balance entries first.</p>
              ) : !canRequestClose ? (
                <p className="drill-hint wizard-footer-note">Save progress at any time. To close, complete all three confirmations and enter spending and household take-home, including explicit zeros where appropriate.</p>
              ) : null}
              <div className="wizard-footer-actions">
                {/* accounts.length === 0 doubles as the "load succeeded" sentinel: after a
                    failed load both validity flags are vacuously true, and a meta-only PUT
                    to an existing month would clear its saved note. */}
                <button
                  className="button"
                  disabled={
                    saving || loading || review === null || accounts.length === 0 || !balancesValid || !amountsValid
                  }
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : 'Save progress'}
                </button>
                <button className="button button-primary" disabled={saving || loading || review === null || accounts.length === 0 || !balancesValid || !amountsValid || !canRequestClose} onClick={() => void save(true)}>Save and close month</button>
              </div>
            </div>
```
(The `monthExisted && <details className="month-actions">…</details>` block between them is untouched here — Task 4 replaces it.) `stepIndex` is now unused: delete `const stepIndex = STEPS.indexOf(step)` (line 1020).

- [ ] **Step 6: CSS**

In `src/pages/MonthlyUpdatePage.css`:
- Delete the `.review-grid { … }` rule (lines 166-170) and the `.review-save-summary { … }` line (272).
- Replace the `.month-review-status { … }` line (276) with:
```css
/* F3 (2026-09-13 audit): the pill's two tokens (--surface-raised, --bg-card) never existed, so
   it painted transparent. --surface-2 is the raised fill every other pill here wears. */
.month-review-status { display: inline-flex; padding: .3rem .7rem; border-radius: 100px; background: var(--surface-2); border: 1px solid var(--border); font-size: .8rem; margin: 0; }
```
- Change `.review-change-grid { … margin: 1.25rem 0; }` to `margin: .75rem 0 0;`.
- Append:
```css
/* The Review step's head row: eyebrow, review pill, and (Task 4) the month-actions kebab. */
.review-head { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; margin-bottom: .9rem; }
.review-head .eyebrow { margin: 0; }
.review-kpis { margin-bottom: 1.25rem; }
.review-changes-head { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; flex-wrap: wrap; margin-top: 1.25rem; }
.review-changes-head .eyebrow { margin: 0; }
.review-changes-count { color: var(--muted); font-size: .85rem; }
.review-changes-footer { margin: .75rem 0 0; padding-top: .6rem; border-top: 1px solid var(--border); }
/* The footer's middle slot: the gate sentence beside the button it explains (T4). */
.wizard-footer { align-items: center; }
.wizard-footer-note { flex: 1; margin: 0; text-align: right; }
.wizard-footer-actions { display: flex; gap: .6rem; }
```

- [ ] **Step 7: Run the two suites**

Run: `npx tsc -b && npx vitest run src/components/monthly/ReviewChanges.test.tsx src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/components/monthly/ReviewChanges.tsx src/components/monthly/ReviewChanges.test.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(update): Review step as four tiles, notes attached to their tables and footer, pill background, eyebrow without the month (W5, T4, F3, C3)"
```

---

### Task 4: "Month actions" becomes a kebab popover in the Review head

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (imports, state, `setStep`/`selectMonth`/`deleteMonth`, the `<details className="month-actions">` block)
- Modify: `src/pages/MonthlyUpdatePage.css`
- Modify: `src/pages/MonthlyUpdatePage.test.tsx` (five delete tests + one new)

Evidence A2 / spec §11: a `⋯` icon button in the Review card's eyebrow row opens a `.popover-surface` holding the existing delete arm-and-confirm; the footer never moves.

- [ ] **Step 1: Update the five delete tests and add the popover test**

In `src/pages/MonthlyUpdatePage.test.tsx`, add a helper after `renderWizardAt`:
```tsx
// A2 (2026-09-13 audit): the delete arm-and-confirm lives behind the Review head's kebab.
async function openMonthActions() {
  fireEvent.click(await screen.findByRole('button', { name: 'Month actions' }))
  return screen.getByRole('dialog', { name: 'Month actions' })
}
```
Then:
- `'offers no delete on a month the server has never seen'`: replace `expect(screen.queryByRole('button', { name: 'Delete this month' })).toBeNull()` with `expect(screen.queryByRole('button', { name: 'Month actions' })).toBeNull()`.
- In each of `'arms on the typed month, fires both deletes…'`, `'surfaces a non-404 delete failure…'`, `'the delete toast carries Undo…'`, `'a 404 leg leaves no batch to undo…'`, `'a partial undo still reloads…'`: insert `await openMonthActions()` as the first line after `renderWizardAt(…)`. Their existing `findByRole('button', { name: 'Delete this month' })` / `findByLabelText('Type 2026-07 to confirm')` lines then resolve inside the popover unchanged.

Append the new test:
```tsx
it('the kebab opens the month-actions popover and Escape closes it back onto the button', async () => {
  renderWizardAt('/update?month=2026-07-01&step=review')
  const trigger = await screen.findByRole('button', { name: 'Month actions' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
  const dialog = await openMonthActions()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(dialog.className).toContain('popover-surface')
  expect(within(dialog).getByRole('button', { name: 'Delete this month' })).toBeTruthy()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Month actions' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
```
If F2's `usePopoverDismiss` listens for a different event than `keydown` on the document (read `src/components/usePopoverDismiss.ts`), fire that event instead — the behaviour under test is the hook's contract, not its wiring.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx -t "delete|undo|kebab"`
Expected: FAIL — no button named "Month actions".

- [ ] **Step 3: Implement**

Imports: change `import { CalendarPlus } from 'lucide-react'` to `import { CalendarPlus, Ellipsis } from 'lucide-react'`; add `import { usePopoverDismiss } from '../components/usePopoverDismiss'`.

State (next to `deleteArm`, ~line 368):
```tsx
  // The Review head's kebab (2026-09-13 polish spec §11): the delete arm-and-confirm lives in a
  // popover, so opening it never pushes the footer down the page.
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsTriggerRef = useRef<HTMLButtonElement>(null)
  const actionsSurfaceRef = useRef<HTMLDivElement>(null)
  const closeActions = () => setActionsOpen(false)
  usePopoverDismiss(actionsOpen, closeActions, actionsTriggerRef, actionsSurfaceRef)
```
In `setStep` (after `setFlashIds(new Set())`) and in `selectMonth` (after `setDeleteArm('')`) add `setActionsOpen(false)`. In `deleteMonth`'s success path, after `setDeleteArm('')`, add `setActionsOpen(false)`.

In the Review head (`.review-head` from Task 3), after the review pill, add:
```tsx
              {monthExisted && (
                <div className="month-actions">
                  <button
                    ref={actionsTriggerRef}
                    type="button"
                    className="button month-actions-trigger"
                    aria-label="Month actions"
                    aria-haspopup="dialog"
                    aria-expanded={actionsOpen}
                    onClick={() => setActionsOpen((open) => !open)}
                  >
                    <Ellipsis size={15} aria-hidden="true" />
                  </button>
                  {actionsOpen && (
                    <div ref={actionsSurfaceRef} className="popover-surface month-actions-popover" role="dialog" aria-label="Month actions">
                      <p className="drill-hint">
                        Delete this month everywhere: its balances snapshot, spending rows and
                        take-home. Undo is offered for six seconds afterwards, and the Activity card
                        can undo it later.
                      </p>
                      <div className="danger-row">
                        <label htmlFor="delete-arm">Type {month.slice(0, 7)} to confirm</label>
                        <input
                          id="delete-arm"
                          type="text"
                          className="field-input"
                          value={deleteArm}
                          onChange={(e) => setDeleteArm(e.target.value)}
                          placeholder={month.slice(0, 7)}
                        />
                        <button
                          type="button"
                          className="button danger-button"
                          disabled={saving || deleting || deleteArm.trim() !== month.slice(0, 7)}
                          onClick={() => void deleteMonth()}
                        >
                          {deleting ? 'Deleting…' : 'Delete this month'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
```
Delete the old `{monthExisted && (<details className="month-actions">…</details>)}` block from below the confirmations.

CSS — replace the three `.month-actions…` lines (279-281) with:
```css
/* The kebab and its popover. The wrapper is the popover's positioning box; the surface itself
   is the shared .popover-surface (panels.css) — F2's motion and tokens, nothing local. */
.month-actions { position: relative; margin-left: auto; }
.month-actions-trigger { padding: .3rem .5rem; line-height: 0; }
.month-actions-popover { right: 0; top: calc(100% + .4rem); width: min(440px, 90vw); }
.month-actions-popover .danger-row { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; margin-top: .5rem; }
```
(`.danger-zone .danger-row` no longer matches anything; the rule above replaces it. Delete the `.danger-zone` block, lines 253-264, keeping `.danger-button:not(:disabled)`.)

- [ ] **Step 4: Run the suite**

Run: `npx tsc -b && npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(update): month actions as a kebab popover in the Review head — the footer never moves (A2)"
```

---
### Task 5: `HistoricalReview` becomes a card — summary, Load history, years, eligible-select, reasons

**Files:**
- Modify: `src/components/monthly/HistoricalReview.tsx`
- Modify: `src/components/monthly/HistoricalReview.test.tsx`
- Modify: `src/pages/MonthlyUpdatePage.tsx` (pass `coverage`)
- Modify: `src/pages/MonthlyUpdatePage.css` (`.historical-review*`, `.history-review-*`)

Evidence A3/F4/C3 and spec §11: a `.card` (not `.panel`, which lives in portfolio.css) with eyebrow "Review historical months", a one-line summary ("37 months entered before month review existed"), a **Load history** button that fetches and renders the list, rows grouped by year with a per-year "Select all eligible", disabled rows naming the missing feed from `m.coverage`, and a footer button "Close selected months" that shows the count only when > 0. The summary before loading comes from `coverage.review_months` (the wizard already holds `/coverage` since Task 2).

- [ ] **Step 1: Rewrite the test file**

Replace `src/components/monthly/HistoricalReview.test.tsx` with:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonthReview } from '../../api/monthReview'
import { ApiError } from '../../api/client'
import HistoricalReview from './HistoricalReview'

const mocks = vi.hoisted(() => ({ list: vi.fn(), close: vi.fn() }))
vi.mock('../../api/monthReview', async original => ({ ...(await original<typeof import('../../api/monthReview')>()), fetchMonthReviews: mocks.list, batchCloseMonths: mocks.close }))
const review: MonthReview = { month: '2025-06-01', state: 'unreviewed_history', input_revision: 'original', reviewed: { balances: false, spending: false, take_home: false }, coverage: { balances: true, spending: true, take_home: true, spending_nonzero: true, missing_account_ids: [], missing_category_ids: [] }, can_close: false, blockers: [], eligible_spending: true, eligible_savings: true, legacy_eligible: true, closed_at: null, closed_by: null, source_link: '/update?month=2025-06-01' }
beforeEach(() => { mocks.list.mockResolvedValue({ months: [review] }); mocks.close.mockResolvedValue({ months: [{ ...review, state: 'closed' }] }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
function renderCard(coverage?: Parameters<typeof HistoricalReview>[0]['coverage']) {
  const onChanged = vi.fn()
  render(<MemoryRouter><HistoricalReview onChanged={onChanged} coverage={coverage} /></MemoryRouter>)
  return onChanged
}
async function open(coverage?: Parameters<typeof HistoricalReview>[0]['coverage']) {
  const onChanged = renderCard(coverage)
  fireEvent.click(screen.getByRole('button', { name: 'Load history' }))
  await screen.findByRole('button', { name: 'Refresh history' })
  return onChanged
}
it('is a card with an eyebrow and a summary drawn from coverage before anything is loaded', () => {
  renderCard({ balances: [], spending: [], net_pay: [], review_months: [review, { ...review, month: '2025-07-01' }, { ...review, month: '2025-08-01', state: 'in_progress' }, { ...review, month: '2025-05-01', state: 'closed' }] })
  const card = screen.getByRole('heading', { name: 'Review historical months' }).closest('.card') as HTMLElement
  expect(card).not.toBeNull()
  expect(card.classList.contains('panel')).toBe(false)
  expect(within(card).getByText('2 months entered before month review existed · 1 month not yet closed.')).toBeTruthy()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(within(card).getByRole('button', { name: 'Close selected months' })).toBeTruthy()
})
it('groups the loaded months by year, selects a year’s eligible rows at once, and names a disabled row’s missing feed', async () => {
  mocks.list.mockResolvedValue({ months: [
    { ...review, month: '2024-11-01' },
    { ...review, month: '2025-06-01' },
    { ...review, month: '2025-07-01', coverage: { ...review.coverage, take_home: false } },
  ] })
  await open()
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['2025', '2024'])
  const year2025 = screen.getByRole('heading', { name: '2025' }).closest('.history-review-year') as HTMLElement
  expect(within(year2025).getByText(/missing take-home/)).toBeTruthy()
  expect((within(year2025).getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(within(year2025).getByRole('button', { name: 'Select all eligible' }))
  expect((within(year2025).getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  expect((within(year2025).getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false)
  expect(screen.getByRole('button', { name: 'Close selected months (1)' })).toBeTruthy()
})
it('requires a confirmation for the exact selected historical set and clears it when the selection changes', async () => {
  mocks.list.mockResolvedValue({ months: [review, { ...review, month: '2025-07-01' }] })
  const onChanged = await open()
  const boxes = screen.getAllByRole('checkbox')
  fireEvent.click(boxes[0])
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(boxes[1])
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close selected months (2)' }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(screen.getByRole('button', { name: 'Close selected months (2)' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  expect(mocks.close).toHaveBeenCalledWith([{ month: '2025-06-01', expected_revision: 'original' }, { month: '2025-07-01', expected_revision: 'original' }])
})
it('retains the selection on a conflict and offers refresh to obtain a new revision before reconfirming', async () => {
  mocks.close.mockRejectedValue(new ApiError('A selected month changed.', 409))
  await open()
  fireEvent.click(screen.getAllByRole('checkbox')[0])
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(screen.getByRole('button', { name: 'Close selected months (1)' }))
  await screen.findByText(/A selected month changed/)
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  mocks.list.mockResolvedValue({ months: [{ ...review, input_revision: 'changed' }] })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh history' })))
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByLabelText(/I checked balances/)).toBeNull()
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/monthly/HistoricalReview.test.tsx`
Expected: FAIL (no `coverage` prop; no "Load history" before opening a `<details>`; old button names).

- [ ] **Step 3: Rewrite the component**

Replace `src/components/monthly/HistoricalReview.tsx` with:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { batchCloseMonths, fetchMonthReviews, REVIEW_LABELS } from '../../api/monthReview'
import type { MonthReview, ReviewState } from '../../api/monthReview'
import { describeError } from '../../api/client'
import type { CoverageOut } from '../../types/api'
import { formatMonth } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'

type OpenMonth = Pick<MonthReview, 'month' | 'state'>

/** The rows this tool works on: past months that are not closed. */
function openMonths<T extends OpenMonth>(months: T[]): T[] {
  const current = currentMonthIso()
  return months.filter((m) => m.month < current && m.state !== 'closed')
}

/** The feeds a month is missing, in the user's words — the reason a row is disabled. */
function missingFeeds(m: MonthReview): string[] {
  const missing: string[] = []
  if (!m.coverage.balances) missing.push('balances')
  if (!m.coverage.spending) missing.push('spending')
  if (!m.coverage.take_home) missing.push('take-home')
  return missing
}

const eligible = (m: MonthReview) => missingFeeds(m).length === 0

/** One sentence about the backlog: how many months pre-date month review, how many other
 *  open months there are. Drawn from /coverage before the list is loaded, from the list after. */
function summaryOf(known: OpenMonth[] | null): string {
  if (known === null) return 'Existing history keeps its review status. Load it to close the months whose balances, spending and take-home you have checked.'
  if (known.length === 0) return 'All historical months are closed.'
  const legacy = known.filter((m) => m.state === 'unreviewed_history').length
  const other = known.length - legacy
  const parts = [
    legacy > 0 ? `${legacy} ${legacy === 1 ? 'month' : 'months'} entered before month review existed` : '',
    other > 0 ? `${other} ${other === 1 ? 'month' : 'months'} not yet closed` : '',
  ].filter((part) => part !== '')
  return `${parts.join(' · ')}.`
}

// A .card, not portfolio.css's .panel (F4, 2026-09-13 audit): this page must not depend on another
// page's stylesheet being in the bundle. Rows group by year so 37 months read as three lists
// rather than one 320px scroller, and a disabled row says WHY (A3).
export default function HistoricalReview({ onChanged, coverage }: { onChanged: () => void; coverage?: CoverageOut | null }) {
  const [months, setMonths] = useState<MonthReview[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const load = async () => {
    setBusy(true)
    try { const data = await fetchMonthReviews(); setMonths(openMonths(data.months)); setSelected(new Set()); setConfirmed(false); setMessage(null) }
    catch (err) { setMessage(describeError(err, 'historical reviews')) }
    finally { setBusy(false) }
  }
  const close = async () => {
    setBusy(true)
    try {
      const result = await batchCloseMonths((months ?? []).filter(m => selected.has(m.month)).map(m => ({ month: m.month, expected_revision: m.input_revision })))
      setMonths(current => current?.filter(m => !result.months.some(closed => closed.month === m.month)) ?? null)
      setSelected(new Set()); setConfirmed(false); setMessage(`Closed ${result.months.length} reviewed months.`); onChanged()
    } catch (err) { setMessage(describeError(err, 'closing historical months')) }
    finally { setBusy(false) }
  }
  const toggle = (month: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(month); else next.delete(month)
    setSelected(next); setConfirmed(false)
  }
  const selectYear = (rows: MonthReview[]) => {
    const next = new Set(selected)
    rows.filter(eligible).forEach((m) => next.add(m.month))
    setSelected(next); setConfirmed(false)
  }
  // Newest year first, newest month first within it — the months still in living memory lead.
  const years = months === null ? [] : [...new Set(months.map((m) => m.month.slice(0, 4)))].sort((a, b) => b.localeCompare(a))
    .map((year) => ({ year, rows: months.filter((m) => m.month.startsWith(year)).sort((a, b) => b.month.localeCompare(a.month)) }))
  const known: OpenMonth[] | null = months ?? (coverage?.review_months ? openMonths(coverage.review_months) : null)
  const stateWord = (state: ReviewState) => REVIEW_LABELS[state]
  return <section className="card historical-review">
    <div className="historical-review-head">
      <h2 className="eyebrow">Review historical months</h2>
      {months === null
        ? <button type="button" className="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Load history'}</button>
        : <button type="button" className="button" disabled={busy} onClick={() => void load()}>Refresh history</button>}
    </div>
    <p className="drill-hint">{summaryOf(known)}</p>
    {message && <p role="status">{message}</p>}
    {months !== null && months.length > 0 && <div className="history-review-list">
      {years.map(({ year, rows }) => <section className="history-review-year" key={year}>
        <div className="history-review-year-head">
          <h3 className="eyebrow">{year}</h3>
          <button type="button" className="button" disabled={busy || !rows.some(eligible)} onClick={() => selectYear(rows)}>Select all eligible</button>
        </div>
        {rows.map(m => {
          const missing = missingFeeds(m)
          return <label key={m.month} className="history-review-row">
            <input type="checkbox" disabled={busy || missing.length > 0} checked={selected.has(m.month)} onChange={e => toggle(m.month, e.target.checked)} />
            <span>{formatMonth(m.month)}</span>
            <span>{stateWord(m.state)}{missing.length > 0 && <span className="history-review-missing"> · missing {missing.join(', ')}</span>}</span>
            <Link to={`/update?month=${m.month}&step=review`}>Review entries</Link>
          </label>
        })}
      </section>)}
    </div>}
    {selected.size > 0 && <label className="entry-zero-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked balances, spending, and take-home for these {selected.size} months.</label>}
    <div className="historical-review-footer">
      <button type="button" className="button" disabled={busy || !confirmed || selected.size === 0} onClick={() => void close()}>
        {busy && confirmed ? 'Closing…' : selected.size > 0 ? `Close selected months (${selected.size})` : 'Close selected months'}
      </button>
    </div>
  </section>
}
```

- [ ] **Step 4: Pass coverage from the page and restyle**

In `src/pages/MonthlyUpdatePage.tsx` the HistoricalReview line becomes:
```tsx
        {seeded !== null && step === 'review' && <HistoricalReview coverage={coverage} onChanged={() => { setCoverageNonce(n => n + 1) }} />}
```

In `src/pages/MonthlyUpdatePage.css` replace the `.historical-review`, `.history-review-list`, `.history-review-row` rules (the old lines 280-284 minus the `.month-actions` parts already replaced) with:
```css
/* Review historical months — a .card like every other block on the page (F4). */
.historical-review { margin-top: 1rem; }
.historical-review-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
.historical-review-head .eyebrow { margin: 0; }
.history-review-list { margin: .75rem 0 0; }
.history-review-year { margin-top: .75rem; }
.history-review-year-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .25rem; }
.history-review-year-head .eyebrow { margin: 0; }
.history-review-row { display: grid; grid-template-columns: 1.25rem 1fr 1.4fr auto; align-items: center; gap: .75rem; padding: .5rem 0; border-bottom: 1px solid var(--border); font-size: .85rem; }
.history-review-missing { color: var(--muted); font-size: .78rem; }
.historical-review-footer { display: flex; justify-content: flex-end; margin-top: .9rem; }
```

- [ ] **Step 5: Run**

Run: `npx tsc -b && npx vitest run src/components/monthly/HistoricalReview.test.tsx src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/monthly/HistoricalReview.tsx src/components/monthly/HistoricalReview.test.tsx src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css
git commit -m "feat(update): historical review as a card — coverage summary, Load history, years with Select all eligible, missing-feed reasons, Close selected months (A3, F4)"
```

---
### Task 6: Overview — the Data status card replaces the orphan line and the freshness footer

**Files:**
- Modify: `src/components/overview/freshness.ts` (+ `freshness.test.ts`)
- Create: `src/components/overview/DataStatusCard.tsx`, `src/components/overview/DataStatusCard.test.tsx`
- Modify: `src/pages/OverviewPage.tsx` (imports; agenda column; delete L735 and L737-757), `src/pages/OverviewPage.css`
- Modify: `src/pages/OverviewPage.test.tsx` (freshness describe, fresh-database test)

Spec §10: a third agenda card **Data status** listing the four clocks as `dl` rows (Prices as of / Balances through / Spending through / Net pay through, amber `.stale` kept) and the comparison line ("Living spending compares Aug 2026 with 12 eligible months"). The `<p class="drill-hint">` at L735 and the `.overview-freshness` footer go.

- [ ] **Step 1: Failing test for the clause split**

Append to `src/components/overview/freshness.test.ts` (it already imports `freshnessClauses` and the `CoverageOut` type at the top; add `import type { CoverageOut } from '../../types/api'` / `import { freshnessClauses } from './freshness'` only if either is missing):

```ts
describe('freshnessClauses — dt/dd split for the Data status card (2026-09-13 polish §10)', () => {
  it('exposes a label and a detail whose concatenation is the sentence', () => {
    const coverage: CoverageOut = {
      balances: ['2026-07-01', '2026-08-01'], spending: ['2026-07-01'], net_pay: [],
      spending_missing: ['2026-08-01'],
      latest: { balances: '2026-08-01', spending: '2026-07-01', net_pay: null },
    }
    const [balances, spending, netPay] = freshnessClauses(coverage)
    expect(balances).toMatchObject({ label: 'Balances through', detail: 'Aug 2026', text: 'Balances through Aug 2026', lagging: false })
    expect(spending).toMatchObject({ label: 'Spending through', detail: 'Jul 2026 (Aug missing)', text: 'Spending through Jul 2026 (Aug missing)', lagging: true })
    expect(netPay).toMatchObject({ label: 'Net pay', detail: 'no months', text: 'Net pay — no months', lagging: false })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/overview/freshness.test.ts`
Expected: FAIL — `label`/`detail` undefined.

- [ ] **Step 3: Implement in `freshness.ts`**

Extend the interface (lines 11-16):
```ts
export interface FreshnessClause {
  key: FreshnessKey
  /** The row's <dt>: "Balances through" while the feed has months, the bare feed name once it never started. */
  label: string
  /** The row's <dd>: the month (plus the spending gaps), or "no months". */
  detail: string
  /** `${label} ${detail}` as one sentence — what the old footer printed. */
  text: string
  /** Amber: this feed is at least one whole month behind the balances. */
  lagging: boolean
}
```
Replace the body of `freshnessClauses` from `return [` to the end of the function with:
```ts
  const clause = (key: FreshnessKey, name: string, latest: string | null, tail: string, lagging: boolean): FreshnessClause => {
    if (latest === null) return { key, label: name, detail: 'no months', text: `${name} — no months`, lagging: false }
    const detail = `${formatMonth(latest)}${tail}`
    return { key, label: `${name} through`, detail, text: `${name} through ${detail}`, lagging }
  }
  return [
    // The anchor cannot lag itself.
    clause('balances', 'Balances', balances, '', false),
    clause('spending', 'Spending', spending, gaps === '' ? '' : ` (${gaps})`, lags(spending)),
    clause('net_pay', 'Net pay', netPay, '', lags(netPay)),
  ]
```
Run `npx vitest run src/components/overview/freshness.test.ts` → PASS (every existing `text` assertion still holds).

- [ ] **Step 4: Failing component test for the card**

Create `src/components/overview/DataStatusCard.test.tsx`:
```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { CoverageOut } from '../../types/api'
import { formatDate } from '../../utils/format'
import DataStatusCard from './DataStatusCard'

afterEach(cleanup)
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const coverage: CoverageOut = {
  balances: ['2026-07-01', '2026-08-01'], spending: ['2026-07-01'], net_pay: ['2026-07-01'],
  spending_missing: ['2026-08-01'], net_pay_missing: ['2026-08-01'],
  latest: { balances: '2026-08-01', spending: '2026-07-01', net_pay: '2026-07-01' },
}
const value = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement

it('lists the four clocks as definition rows, ambers the lagging feeds and states the comparison', () => {
  const quoted = daysAgo(1)
  render(<DataStatusCard asOf={quoted} coverage={coverage} comparison={{ month: '2026-07-01', included: 12 }} />)
  expect(screen.getByRole('heading', { name: 'Data status' })).toBeTruthy()
  expect(value('Prices as of').textContent).toBe(formatDate(quoted))
  expect(value('Prices as of').className).not.toContain('stale')
  expect(value('Balances through').textContent).toBe('Aug 2026')
  expect(value('Balances through').className).not.toContain('stale')
  expect(value('Spending through').textContent).toBe('Jul 2026 (Aug missing)')
  expect(value('Spending through').className).toContain('stale')
  expect(value('Net pay through').className).toContain('stale')
  expect(screen.getByText('Living spending compares Jul 2026 with 12 eligible months.')).toBeTruthy()
})

it('ambers a stale quote, and says a feed never started without amber', () => {
  render(<DataStatusCard asOf={daysAgo(9)} coverage={{ balances: [], spending: [], net_pay: [] }} />)
  expect(value('Prices as of').className).toContain('stale')
  expect(value('Balances').textContent).toBe('no months')
  expect(value('Spending').textContent).toBe('no months')
  expect(value('Net pay').textContent).toBe('no months')
  expect(document.querySelectorAll('.stale')).toHaveLength(1)
  expect(screen.queryByText(/Living spending compares/)).toBeNull()
})

it('says the quotes were never refreshed when there is no quote date', () => {
  render(<DataStatusCard asOf={null} />)
  expect(value('Prices').textContent).toBe('never refreshed')
  expect(document.querySelectorAll('dt')).toHaveLength(1)
})
```

- [ ] **Step 5: Create the card**

Create `src/components/overview/DataStatusCard.tsx`:
```tsx
import type { CoverageOut } from '../../types/api'
import { formatDate, formatMonth } from '../../utils/format'
import { isStaleQuote } from '../../utils/staleness'
import { freshnessClauses } from './freshness'

/**
 * The agenda column's third card (2026-09-13 polish spec §10). Four clocks: quotes move daily,
 * while balances, spending and net pay are hand-entered and each stands on its OWN month
 * (honest-numbers spec §3). They used to be a bare row of clauses at the page floor and a
 * one-line orphan between two card groups; here they are `dl` rows inside a card, and the
 * sentence about the Living spending comparison sits beneath them. A feed a month or more
 * behind the balances wears the same amber a stale quote does — one language for "older than
 * it looks". Capitalised labels on purpose: these are peer rows, not a footnote.
 */
export default function DataStatusCard({
  asOf,
  coverage,
  comparison,
}: {
  asOf: string | null
  coverage?: CoverageOut
  /** The month the Living spending tile compares, and how many eligible months it is compared with. */
  comparison?: { month: string; included: number } | null
}) {
  const clauses = coverage ? freshnessClauses(coverage) : []
  return (
    <section className="card overview-data-status">
      <h2 className="eyebrow">Data status</h2>
      <dl className="data-status-list">
        <div className="data-status-row">
          <dt>{asOf ? 'Prices as of' : 'Prices'}</dt>
          <dd className={isStaleQuote(asOf) ? 'stale' : undefined}>{asOf ? formatDate(asOf) : 'never refreshed'}</dd>
        </div>
        {clauses.map((clause) => (
          <div className="data-status-row" key={clause.key}>
            <dt>{clause.label}</dt>
            <dd className={clause.lagging ? 'stale' : undefined}>{clause.detail}</dd>
          </div>
        ))}
      </dl>
      {comparison && (
        <p className="drill-hint data-status-note">
          Living spending compares {formatMonth(comparison.month)} with {comparison.included} eligible{' '}
          {comparison.included === 1 ? 'month' : 'months'}.
        </p>
      )}
    </section>
  )
}
```
Run `npx vitest run src/components/overview/DataStatusCard.test.tsx` → PASS.

- [ ] **Step 6: Wire the page and delete the orphans**

`src/pages/OverviewPage.tsx`:
- Add `import DataStatusCard from '../components/overview/DataStatusCard'`; delete the `freshnessClauses` import (line 18) and the `isStaleQuote` import (line 70).
- In the agenda `<aside className="overview-agenda-column">`, immediately after the `</section>` that closes `.overview-attention` (line 732), add:
```tsx
                <DataStatusCard
                  asOf={asOf}
                  coverage={data.coverage}
                  comparison={
                    spendingEvidence.data?.review
                      ? { month: spendingEvidence.data.review.month, included: spendingEvidence.data.comparison.window?.included.length ?? 0 }
                      : null
                  }
                />
```
- Delete line 735 (`{spendingEvidence.data?.review && <p className="drill-hint">Living spending: …`).
- Delete lines 737-757 (the `{/* Four clocks … */}` comment and the whole `<div className="overview-freshness">…</div>`).

`src/pages/OverviewPage.css`: delete the `.overview-freshness { … }` and `.overview-freshness .stale { … }` rules (lines 88-101, with their comments) and append:
```css
/* Data status card: the four clocks as definition rows (2026-09-13 polish §10). Amber is the
   advisory register (--warn) — a feed behind the ritual, a quote past its day. */
.overview-data-status .data-status-list { margin: 0; display: grid; gap: .35rem; }
.data-status-row { display: flex; justify-content: space-between; align-items: baseline; gap: .75rem; font-size: .85rem; }
.data-status-row dt { color: var(--muted); }
.data-status-row dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.overview-data-status .stale { color: var(--warn); }
.data-status-note { margin: .6rem 0 0; }
```

- [ ] **Step 7: Update the page tests**

In `src/pages/OverviewPage.test.tsx` add a helper next to `valueOf`/`deltaOf`:
```tsx
// The Data status card's rows are <dt>label</dt><dd>value</dd>; this reads the value beside a label.
function statusValue(label: string): HTMLElement {
  const card = document.querySelector('.overview-data-status') as HTMLElement
  return within(card).getByText(label).nextElementSibling as HTMLElement
}
```
Rewrite the `describe('OverviewPage freshness', …)` block (lines 894-937) as:
```tsx
describe('OverviewPage data status card', () => {
  it('dates the quotes and stands each hand-entered feed on its own month, inside the agenda column', async () => {
    const quoted = daysAgo(1)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    await waitFor(() => expect(statusValue('Prices as of').textContent).toBe(formatDate(quoted)))
    // Yesterday's bar is not stale — no amber.
    expect(statusValue('Prices as of').className).not.toContain('stale')
    expect(statusValue('Balances through').textContent).toBe(formatMonth(YEAR_MONTHS[6]))
    expect(statusValue('Spending through').textContent).toBe(formatMonth(YEAR_MONTHS[6]))
    expect(statusValue('Net pay through').textContent).toBe(formatMonth(YEAR_MONTHS[6]))
    // Level feeds: nothing ambers.
    expect(document.querySelectorAll('.overview-data-status .stale')).toHaveLength(0)
    // It is a card in the agenda column — no bare footer row, no orphan sentence (T1, T2).
    expect(document.querySelector('.overview-agenda-column .overview-data-status')).not.toBeNull()
    expect(document.querySelector('.overview-freshness')).toBeNull()
    expect(screen.queryByText(/^Living spending: /)).toBeNull()
  })

  it('names the months the window is still waiting for and ambers the feeds that lag', async () => {
    serve({ coverage: LAGGING })
    renderPage()

    await waitFor(() =>
      expect(statusValue('Spending through').textContent).toBe(`${formatMonth(YEAR_MONTHS[6])} (Aug missing, Sep empty)`),
    )
    expect(statusValue('Spending through').className).toContain('stale')
    expect(statusValue('Balances through').textContent).toBe(formatMonth(SEP))
    expect(statusValue('Balances through').className).not.toContain('stale')
    expect(statusValue('Net pay through').className).toContain('stale')
  })

  it('ambers a quote date that has gone stale — and the strip says the same thing', async () => {
    const quoted = daysAgo(9)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    await waitFor(() => expect(statusValue('Prices as of').className).toContain('stale'))
    // Two registers for one fact: the card states it, the strip makes it a task.
    expect(screen.getByRole('link', { name: /Quotes are stale/ }).getAttribute('href')).toBe('/portfolio')
  })
})
```
In the fresh-database test (lines 1170-1177) replace the comment and the five expectations with:
```tsx
    // A feed that never started says so — a fresh database is not a late one, so none of these
    // wears the amber.
    expect(statusValue('Prices').textContent).toBe('never refreshed')
    expect(statusValue('Balances').textContent).toBe('no months')
    expect(statusValue('Spending').textContent).toBe('no months')
    expect(statusValue('Net pay').textContent).toBe('no months')
    expect(document.querySelectorAll('.overview-data-status .stale')).toHaveLength(0)
```

- [ ] **Step 8: Run**

Run: `npx tsc -b && npx vitest run src/components/overview src/pages/OverviewPage.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/overview/freshness.ts src/components/overview/freshness.test.ts src/components/overview/DataStatusCard.tsx src/components/overview/DataStatusCard.test.tsx src/pages/OverviewPage.tsx src/pages/OverviewPage.css src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): Data status card — the four clocks as dl rows plus the comparison line; orphan sentence and freshness footer removed (T1, T2)"
```

---

### Task 7: Overview tiles — "Living spending" label + badge + month in the delta, ghosts while a group is busy, receipt labels

**Files:**
- Create: `src/components/overview/netWorthReceipt.ts`, `src/components/overview/netWorthReceipt.test.ts`
- Modify: `src/pages/OverviewPage.tsx` (imports, `spendDelta`, `tileElements`)
- Modify: `src/pages/OverviewPage.test.tsx`

Spec §9/§10/§5, evidence W2/L3/C4: the Living spending tile's label is "Living spending", the month moves into the delta text, the review state (when not `closed`) is the tile's `badge`; a tile whose resource group is `busy` with no data renders `GhostTile` (no delta) instead of "—"; the hero receipt's components use `GROUP_LABELS` ("Liabilities").

- [ ] **Step 1: Failing unit test for the receipt helper**

Create `src/components/overview/netWorthReceipt.test.ts`:
```ts
import { expect, it } from 'vitest'
import { netWorthComponents } from './netWorthReceipt'

it('labels the hero receipt components like every chart legend — Liabilities, not "liability"', () => {
  expect(netWorthComponents([
    { group: 'liability', total: '-4200.00', mom_delta: null },
    { group: 'pre_tax', total: '100.00', mom_delta: '1.00' },
  ])).toEqual([
    { label: 'Liabilities', value: '-4200.00', unit: 'USD' },
    { label: 'Pre-tax', value: '100.00', unit: 'USD' },
  ])
})
```
Create `src/components/overview/netWorthReceipt.ts`:
```ts
import { GROUP_LABELS } from '../../charts/theme'
import type { MetricEvidence } from '../../types/metrics'
import type { NetWorthSummary } from '../../types/api'

/** The hero receipt's component rows: one per account group, labelled the way every legend
 *  labels them (GROUP_LABELS — "Liabilities", never "liability"; 2026-09-13 polish spec §5).
 *  Verbatim server totals; no arithmetic. */
export function netWorthComponents(groups: NetWorthSummary['groups']): MetricEvidence['components'] {
  return groups.map((group) => ({ label: GROUP_LABELS[group.group], value: group.total, unit: 'USD' }))
}
```
Run `npx vitest run src/components/overview/netWorthReceipt.test.ts` → PASS.

- [ ] **Step 2: Update the page tests to the new tile grammar (they fail until Step 3)**

In `src/pages/OverviewPage.test.tsx` add imports at the top: `import { REVIEW_LABELS } from '../api/monthReview'` and `import type { MonthReview } from '../api/monthReview'`, and next to the other helpers:
```tsx
// The spending tile's label no longer carries the month (W2); wait for its VALUE instead.
async function spendingTileShowing(value: string): Promise<HTMLElement> {
  await waitFor(() => expect(valueOf(tileFor('Living spending'))).toBe(value))
  return tileFor('Living spending')
}
```
Then make these edits:
- line 642: `const spending = tileFor('Living spending')`; line 644 expected delta `'▲ over $5,000.00 previous 12-mo average · Jul 2026'`.
- lines 716-718: `const tile = await spendingTileShowing('$4,000.00')` (drop the `findByText` + `closest` pair); line 721 expected `'▼ under $5,000.00 previous 12-mo average · Jul 2026'`.
- line 737: `const tile = await spendingTileShowing('$6,000.00')`; line 740 expected `'▲ over $5,000.00 previous 12-mo average · Jul 2026'`.
- lines 769-773 (first-ever month of zero): 
```tsx
    const tile = await spendingTileShowing('$0.00')
    // The month still has a home: the delta line, neutral, no glyph.
    expect(deltaOf(tile)?.textContent).toBe('Aug 2025')
    expect(deltaOf(tile)?.className).toContain('stat-delta-neutral')
```
- lines 779-784: `const tile = await spendingTileShowing('$0.00')`; expected delta `'at $0.00 previous 12-mo average · Jul 2026'`.
- line 1610: `expect(valueOf(tileFor('Living spending'))).toBe('$6,000.00')`.
- lines 1657-1660:
```tsx
    expect(container.querySelectorAll('.chart-card-skeleton')).toHaveLength(2)
    // L3: a group that is busy with nothing to show ghosts its tiles instead of printing "—".
    expect(container.querySelectorAll('.kpi-row .skeleton-tile')).toHaveLength(2)
    expect(valueOf(tileFor('Living spending'))).toBe('$6,000.00')
```
- line 1776: `await spendingTileShowing('$6,000.00')`; line 1785: same; line 1792: `expect(valueOf(tileFor('Living spending'))).toBe('$6,000.00')`.
- line 1807: `await waitFor(() => expect(document.querySelectorAll('.kpi-row .skeleton-tile')).toHaveLength(1))`.
- lines 1822-1823: `await spendingTileShowing('$0.00')` (drop the separate `expect(valueOf(…)).toBe('$0.00')`).
- lines 1830-1832: `const tile = await spendingTileShowing('$3,000.00')` then `expect(deltaOf(tile)?.textContent).toContain('$1,234.56 previous 12-mo average · Jun 2026')`.
- line 1845: `expect(within(document.querySelector('.kpi-row') as HTMLElement).queryByText('Living spending')).toBeNull()`.

Append a new test to `describe('OverviewPage tiles', …)`:
```tsx
  // T1/C4 (2026-09-13 audit): the review state rides the tile as a badge; the comparison
  // sentence lives in the Data status card.
  it('badges the spending tile with a non-closed review state and states the comparison in Data status', async () => {
    serve()
    const base = await fetchSpendingEvidence()
    const review: MonthReview = { month: '2026-07-01', state: 'unreviewed_history', input_revision: 'r', reviewed: { balances: false, spending: false, take_home: false }, coverage: { balances: true, spending: true, take_home: true, spending_nonzero: true, missing_account_ids: [], missing_category_ids: [] }, can_close: false, blockers: [], eligible_spending: true, eligible_savings: true, legacy_eligible: true, closed_at: null, closed_by: null, source_link: '/update?month=2026-07-01' }
    vi.mocked(fetchSpendingEvidence).mockResolvedValue({ ...base, review })
    renderPage()
    const tile = await spendingTileShowing('$6,000.00')
    await waitFor(() => expect(tile.querySelector('.stat-badge')?.textContent).toBe(REVIEW_LABELS.unreviewed_history))
    expect(within(document.querySelector('.overview-data-status') as HTMLElement).getByText('Living spending compares Jul 2026 with 0 eligible months.')).toBeTruthy()
    cleanup()
    vi.mocked(fetchSpendingEvidence).mockResolvedValue({ ...base, review: { ...review, state: 'closed' } })
    renderPage()
    const closed = await spendingTileShowing('$6,000.00')
    await waitFor(() => expect(screen.getByText('Living spending compares Jul 2026 with 0 eligible months.')).toBeTruthy())
    expect(closed.querySelector('.stat-badge')).toBeNull()
  })
```

- [ ] **Step 3: Implement in `OverviewPage.tsx`**

Imports: add `import { GhostTile } from '../components/PageSkeleton'` and `import { netWorthComponents } from '../components/overview/netWorthReceipt'`.

Replace the `spendDelta` block (lines 329-344) with:
```tsx
  // ONE object, three channels: the words, the colour and the glyph are either all present
  // or all absent. Spending up is BAD, so tone is the INVERSE of direction here — and that is
  // exactly why the tile hands StatTile an explicit direction: left to derive the glyph from
  // the tone, an over-average month would render ▼ on a number that went UP. The MONTH rides
  // the delta line too (W2, 2026-09-13 audit): the label is "Living spending" at every width,
  // and a month with no comparison still says which month it is — neutral, no glyph.
  const spendMonth = stats?.month ? formatMonth(stats.month) : null
  const spendDelta =
    stats && stats.avg12 !== null && stats.aboveAvg !== null && !cashflowOnly
      ? {
          text: `${Number(stats.total) === stats.avg12 ? 'at' : stats.aboveAvg ? 'over' : 'under'} ${formatCurrency(stats.avg12)} previous 12-mo average${spendMonth ? ` · ${spendMonth}` : ''}`,
          tone: Number(stats.total) === stats.avg12 ? ('neutral' as const) : stats.aboveAvg ? ('negative' as const) : ('positive' as const),
          direction: Number(stats.total) === stats.avg12 ? undefined : stats.aboveAvg ? ('up' as const) : ('down' as const),
        }
      : spendMonth !== null
        ? { text: spendMonth, tone: 'neutral' as const, direction: undefined }
        : null
  // The compared month's review state — a badge on the tile when it is not closed (T1); the
  // sentence about the comparison window lives in the Data status card.
  const reviewState = spendingEvidence.data?.review?.state
```
In `tileElements` (lines 368-440) each tile is wrapped in its group's ghost condition (spec §9: a group that is busy with no data renders `GhostTile`, no delta) — four one-line find/replace edits on the entry openers, one on the hero's receipt, and one rewritten entry:

1. Line 369, `    net_worth: (` → `    net_worth: wealth.busy && data.summary === undefined ? <GhostTile delta={false} /> : (`
2. Line 398, `    portfolio: (` → `    portfolio: investments.busy && data.holdings === undefined ? <GhostTile delta={false} /> : (`
3. Line 431, `    tax: (` → `    tax: planning.busy && data.taxes === undefined ? <GhostTile delta={false} /> : (`
4. In the hero's `metricReceipt({ … })` (line 395) replace `components: summary.groups.map(group => ({ label: group.group.replaceAll('_', ' '), value: group.total, unit: 'USD' }))` with `components: netWorthComponents(summary.groups)`.
5. Replace the whole `living_spending` entry (lines 420-430) with:
```tsx
    living_spending: spending.busy && data.matrix === undefined ? <GhostTile delta={false} /> : (
              <StatTile
                label="Living spending"
                badge={reviewState !== undefined && reviewState !== 'closed' ? REVIEW_LABELS[reviewState] : undefined}
                value={cashflowOnly ? '—' : formatCurrency(stats?.total)}
                delta={spendDelta?.text}
                tone={spendDelta?.tone}
                direction={spendDelta?.direction}
                hint={spendingHint}
                evidence={spendingEvidence.metric('living_spending')}
              />
    ),
```
The closing `),` of every entry and all other `StatTile` props stay exactly as they are; the ternaries close on the existing `)` before each `),`.

- [ ] **Step 4: Run**

Run: `npx tsc -b && npx vitest run src/components/overview src/pages/OverviewPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/overview/netWorthReceipt.ts src/components/overview/netWorthReceipt.test.ts src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): Living spending tile — one-line label, review badge, month in the delta; ghost tiles while a group loads; GROUP_LABELS on the hero receipt (W2, L3, C4, §5)"
```

---
### Task 8: Overview — deeper cards on the card grid, YTD copy/layout, YTD slot reserved

**Files:**
- Modify: `src/pages/OverviewPage.tsx` (`deeperCards`, the `.overview-deeper` div)
- Modify: `src/pages/OverviewPage.css` (`.ytd-facts`, `.ytd-fact dd`, `.overview-deeper`)
- Modify: `src/pages/OverviewPage.test.tsx`

Spec §12/§9, evidence W3/W4: `.overview-deeper` becomes a `card-grid` with `performance` and `spending` at `span-6`, `ytd` and `money_flow` at `span-12`; the YTD `<dt>` reads "Dividends" with the ex-date note in `.ytd-sub`; the Net worth fact splits value/sub with a nowrap amount; column minimum 200px; the YTD card's slot is reserved by a ghost while its feeds are pending.

- [ ] **Step 1: Failing tests**

Append to `describe('OverviewPage year to date', …)`:
```tsx
  it('reads "Dividends" with the ex-date note as a sub-label, and keeps the net-worth amount whole', async () => {
    serve({ yearly: { years: [{ year: CURRENT_YEAR, by_category: [], total: '1.00', net_pay_total: '2.00', savings_rate: '0.5' }] } })
    renderPage()
    await screen.findByText(`Year to date — ${CURRENT_YEAR}`)
    const dividends = screen.getByText('Dividends').closest('dt') as HTMLElement
    expect(dividends.querySelector('.ytd-sub')?.textContent).toContain('ex-date for automatic records')
    const netWorth = screen.getByText('Net worth', { selector: 'dt' }).closest('.ytd-fact') as HTMLElement
    expect(netWorth.querySelector('dd .ytd-value')?.textContent).toContain('$34,567.00')
    expect(netWorth.querySelector('dd .ytd-sub')?.textContent).toMatch(/^since .*\(through .*\)$/)
  })

  it('reserves the year-to-date slot with a ghost while its feeds are pending', async () => {
    const payload = serve({ yearly: { years: [{ year: CURRENT_YEAR, by_category: [], total: '1.00', net_pay_total: '2.00', savings_rate: '0.5' }] } })
    const dividends = deferred<DividendOut[]>()
    vi.mocked(fetchDividends).mockImplementation(() => dividends.promise)
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    expect(document.querySelector('.overview-deeper .span-12 .loading-fallback')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: /Year to date/ })).toBeNull()
    await act(async () => { dividends.resolve(payload.dividends) })
    expect(await screen.findByRole('heading', { name: /Year to date/ })).toBeTruthy()
    expect(document.querySelector('.overview-deeper .loading-fallback')).toBeNull()
  })
```
Append to `describe('OverviewPage chart cards (charts C2)', …)`:
```tsx
  it('lays the deeper cards on the card grid — performance and spending side by side, YTD and money flow full width', async () => {
    serve({ yearly: { years: [{ year: CURRENT_YEAR, by_category: [], total: '1.00', net_pay_total: '2.00', savings_rate: '0.5' }] } })
    renderPage()
    await screen.findByText('Net worth trend')
    const deeper = document.querySelector('.overview-deeper') as HTMLElement
    expect(deeper.classList.contains('card-grid')).toBe(true)
    const cardOf = (name: RegExp) => screen.getByRole('heading', { name }).closest('.card') as HTMLElement
    expect(cardOf(/Portfolio performance/).classList.contains('span-6')).toBe(true)
    expect(cardOf(/Recent spending/).classList.contains('span-6')).toBe(true)
    expect(cardOf(/Year to date/).classList.contains('span-12')).toBe(true)
    expect(cardOf(new RegExp(`Money flow.*${CURRENT_YEAR}`)).classList.contains('span-12')).toBe(true)
  })
```
(`DividendOut` and `act` are already imported in this file.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx -t "Dividends|reserves the year-to-date|card grid"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/OverviewPage.tsx`:
- Add `import { SkeletonCard } from '../components/PageSkeleton'` (merge with the `GhostTile` import: `import { GhostTile, SkeletonCard } from '../components/PageSkeleton'`).
- `deeperCards.ytd` (lines 442-549) — three edits around the section, whose children (the `<h2>` and the `<dl className="ytd-facts">` with its five facts) stay in place apart from the two fact edits listed after this:
  1. Line 442, `    ytd: (showYtd && ytd && (` → `    ytd: showYtd && ytd ? (`
  2. Line 443, `              <section className="card ytd-card">` → `              <section className="card ytd-card span-12">`
  3. Line 549, `            )),` → the ternary's other two arms:
```tsx
            ) : ytd === null && (wealth.busy || investments.busy || spending.busy) ? (
              // Spec §9: reserve the slot while the feeds behind it are still in flight — the card
              // used to appear out of nothing when `dividends` landed and shoved the deeper stack
              // down 212px on a slow investments feed.
              <div className="span-12">
                <SkeletonCard height={96} label="Loading year to date…" />
              </div>
            ) : null,
```
  - Net worth fact `<dd>` (lines 451-481): wrap the amount span so the value and the sub are two children:
```tsx
                    <dd>
                      {ytd.netWorthDelta === null ? (
                        '—'
                      ) : (
                        // Glyph + colour + the signed number — three channels, none alone
                        // (StatTile's delta grammar). Up is good here, so glyph and tone agree.
                        // The amount is one unbreakable run (W4): the sub-line wraps, it never does.
                        <span
                          className={`ytd-value ${
                            ytd.netWorthDelta > 0 ? 'delta-positive' : ytd.netWorthDelta < 0 ? 'delta-negative' : ''
                          }`.trim()}
                        >
                          <span aria-hidden="true">
                            {ytd.netWorthDelta > 0 ? '▲ ' : ytd.netWorthDelta < 0 ? '▼ ' : ''}
                          </span>
                          {formatCurrency(ytd.netWorthDelta)}
                          {ytd.netWorthPct !== null && ` (${formatPct(ytd.netWorthPct)})`}
                        </span>
                      )}
                      {ytd.anchorMonth && (
                        <span className="ytd-sub">
                          since {formatMonth(ytd.anchorMonth)}
                          {ytd.throughMonth !== null &&
                            ` (through ${formatMonth(ytd.throughMonth).slice(0, 3)})`}
                        </span>
                      )}
                    </dd>
```
  - Dividends fact (lines 543-546):
```tsx
                  <div className="ytd-fact">
                    <dt>
                      Dividends
                      <span className="ytd-sub"> ex-date for automatic records</span>
                    </dt>
                    <dd>{ytd.dividends === null ? '—' : formatCurrency(ytd.dividends)}</dd>
                  </div>
```
- `performance` and `spending` ChartCards: add `span={6}` to each.
- The deeper container (line 736): `<div className="overview-deeper card-grid">`.

`src/pages/OverviewPage.css`:
- `.ytd-facts`: `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));` (was 180px).
- `.ytd-fact dd`: add `display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 0.35rem;` and a new rule `.ytd-fact .ytd-value { white-space: nowrap; }`.
- `.overview-deeper { display: grid; gap: 1rem; margin-top: 1rem; }` → `.overview-deeper { margin-top: 1rem; }` (the `card-grid` class supplies the grid and the density gap). Keep `.overview-deeper > .card { margin: 0 }`.

- [ ] **Step 4: Run**

Run: `npx tsc -b && npx vitest run src/pages/OverviewPage.test.tsx`
Expected: PASS. (The existing YTD test's `getByText(/since .* \(through Sep\)/)` still matches the `.ytd-sub` span.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.css src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): deeper cards on the card grid (performance + spending side by side), YTD Dividends label and unbreakable net-worth amount, YTD slot reserved while loading (W3, W4, §9)"
```

---

### Task 9: Needs attention — review rows only for past months, phrased as actions

**Files:**
- Modify: `src/components/overview/attention.ts`, `src/components/overview/attention.test.ts`
- Modify: `src/pages/OverviewPage.tsx` (`reviewAttention`, the attention card)
- Modify: `src/pages/OverviewPage.test.tsx`

Spec §14, evidence C1: review rows only for past months (`in_progress`, `needs_review`, `ready_to_review`), phrased as actions ("Finish Aug 2026's update →", "Aug 2026 changed since review — reopen →", "Jul 2026 is ready to close →"); the current month appears only after `UPDATE_NUDGE_DAY`. The rows join the same `.attention-strip` list as the other to-dos.

- [ ] **Step 1: Failing unit tests**

Append to `src/components/overview/attention.test.ts` (add `import { reviewAttentionItems } from './attention'` beside the existing `attentionItems` import, and `import type { ReviewState } from '../../api/monthReview'`):
```ts
describe('reviewAttentionItems — past months as actions (2026-09-13 polish §14)', () => {
  const review = (month: string, state: ReviewState) => ({ month, state })

  it('turns open past months into to-dos, newest first, two at most', () => {
    const items = reviewAttentionItems(
      [review('2026-04-01', 'closed'), review('2026-05-01', 'ready_to_review'), review('2026-06-01', 'needs_review'), review('2026-07-01', 'in_progress')],
      TODAY,
    )
    expect(items.map((i) => i.text)).toEqual(["Finish Jul 2026's update", 'Jun 2026 changed since review — reopen'])
    expect(items[0]).toMatchObject({ key: 'review-2026-07-01', to: '/update?month=2026-07-01&step=review' })
    expect(reviewAttentionItems([review('2026-05-01', 'ready_to_review')], TODAY)[0].text).toBe('May 2026 is ready to close')
  })

  it('leaves the current month alone before the nudge day and names it after', () => {
    expect(reviewAttentionItems([review('2026-08-01', 'in_progress')], '2026-08-05')).toEqual([])
    expect(reviewAttentionItems([review('2026-08-01', 'in_progress')], TODAY)[0].text).toBe("Finish Aug 2026's update")
    expect(reviewAttentionItems([review('2026-09-01', 'in_progress')], TODAY)).toEqual([])
  })

  it('never lists closed, unreviewed-history or not-started months, and tolerates no coverage', () => {
    expect(reviewAttentionItems([review('2026-06-01', 'closed'), review('2026-05-01', 'unreviewed_history'), review('2026-04-01', 'not_started')], TODAY)).toEqual([])
    expect(reviewAttentionItems(undefined, TODAY)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/overview/attention.test.ts`
Expected: FAIL — `reviewAttentionItems` is not exported.

- [ ] **Step 3: Implement in `attention.ts`**

Change `const UPDATE_NUDGE_DAY = 7` to `export const UPDATE_NUDGE_DAY = 7`, add `import type { MonthReview } from '../../api/monthReview'`, and append:
```ts
/**
 * The month-review rows of the Needs attention card (2026-09-13 polish spec §14). Past months
 * only — the current month is in progress by definition (design §3.2) and used to sit in the
 * card every day of every month as a state, not a task. Each row is phrased as the action it
 * asks for and links to that month's Review step; newest first, at most two, so a backlog
 * never turns the card into a list. The current month joins only once UPDATE_NUDGE_DAY has
 * passed — the same patience the balances nudge above shows.
 */
export function reviewAttentionItems(
  reviews: Pick<MonthReview, 'month' | 'state'>[] | undefined,
  todayIso: string,
): AttentionItem[] {
  const currentMonth = `${todayIso.slice(0, 7)}-01`
  const dayOfMonth = Number(todayIso.slice(8, 10))
  return (reviews ?? [])
    .filter(
      (review) =>
        review.month < currentMonth ||
        (review.month === currentMonth && dayOfMonth >= UPDATE_NUDGE_DAY),
    )
    .flatMap((review) => {
      const name = formatMonth(review.month)
      const text =
        review.state === 'in_progress'
          ? `Finish ${name}'s update`
          : review.state === 'needs_review'
            ? `${name} changed since review — reopen`
            : review.state === 'ready_to_review'
              ? `${name} is ready to close`
              : null
      return text === null
        ? []
        : [{ key: `review-${review.month}`, text, to: `/update?month=${review.month}&step=review` }]
    })
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, 2)
}
```
Run `npx vitest run src/components/overview/attention.test.ts` → PASS.

- [ ] **Step 4: Wire the page**

`src/pages/OverviewPage.tsx`:
- Import: `import { attentionItems, reviewAttentionItems } from '../components/overview/attention'`.
- Replace the `attention` const (lines 310-313) with:
```tsx
  // Review rows lead (they are this household's own ritual), then the feed checks; both are
  // phrased as actions and rendered by the same strip (2026-09-13 polish spec §14).
  const attention = [
    ...reviewAttentionItems(data.coverage?.review_months, todayIso()),
    ...attentionItems({
      months: data.ts?.months, holdings: data.holdings, lots: data.lots,
      taxYears: data.taxYears, system: data.system, coverage: data.coverage,
    }, todayIso()).filter(item => item.key !== 'espp-qualifying'),
  ]
```
- Delete the `reviewAttention` const (line 367) and, in the attention card, delete the line `{reviewAttention.map(item => <NavLink … />)}` (line 717); change the empty-state condition on line 731 from `attention.length === 0 && reviewAttention.length === 0` to `attention.length === 0`.
- `REVIEW_LABELS` is still used by the spending tile badge; keep the import.

- [ ] **Step 5: Page test**

Append to `describe('OverviewPage attention strip', …)` in `src/pages/OverviewPage.test.tsx`:
```tsx
  // C1 (2026-09-13 audit): a past open month is a to-do with a verb; a closed one is silence.
  it('lists past review months as actions in the strip and never a closed one', async () => {
    const reviewOut = (month: string, state: MonthReview['state']): MonthReview => ({ month, state, input_revision: 'r', reviewed: { balances: true, spending: true, take_home: true }, coverage: { balances: true, spending: true, take_home: true, spending_nonzero: true, missing_account_ids: [], missing_category_ids: [] }, can_close: true, blockers: [], eligible_spending: true, eligible_savings: true, legacy_eligible: false, closed_at: null, closed_by: null, source_link: `/update?month=${month}` })
    const past = addMonths(currentMonthIso(), -2)
    const closed = addMonths(currentMonthIso(), -3)
    serve({ coverage: coverageOut({ review_months: [reviewOut(past, 'ready_to_review'), reviewOut(closed, 'closed')] }) })
    renderPage()
    const strip = await screen.findByRole('navigation', { name: 'Needs attention' })
    const row = within(strip).getByRole('link', { name: `${formatMonth(past)} is ready to close →` })
    expect(row.getAttribute('href')).toBe(`/update?month=${past}&step=review`)
    expect(within(strip).queryByRole('link', { name: new RegExp(formatMonth(closed)) })).toBeNull()
    expect(strip.querySelectorAll('a')).toHaveLength(1)
  })
```

- [ ] **Step 6: Run**

Run: `npx tsc -b && npx vitest run src/components/overview/attention.test.ts src/pages/OverviewPage.test.tsx`
Expected: PASS (`'stays absent when nothing needs doing'` still passes — the default coverage has no `review_months`).

- [ ] **Step 7: Commit**

```bash
git add src/components/overview/attention.ts src/components/overview/attention.test.ts src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): Needs attention review rows only for past months, phrased as actions; current month after the nudge day (C1)"
```

---

### Task 10: Customize becomes a popover

**Files:**
- Modify: `src/components/overview/OverviewCustomize.tsx`
- Modify: `src/pages/OverviewPage.css` (`.overview-customize*`)
- Modify: `src/pages/OverviewPage.test.tsx`

Spec §11/§14, evidence A4: `button.button[aria-haspopup="dialog"][aria-expanded]` + `div.popover-surface[role="dialog"][aria-label="Customize overview"]`, outside `pointerdown` and Escape close with focus return (`usePopoverDismiss`), a Done button, label "Recent spending".

- [ ] **Step 1: Failing test**

Append to `describe('OverviewPage independent groups and preferences', …)`:
```tsx
  // A4 (2026-09-13 audit): a real popover — closes on Escape and outside pointer, focus returns.
  it('the Customize popover opens as a dialog, closes on Escape / outside pointer / Done, and names the spending card as titled', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    const trigger = screen.getByRole('button', { name: 'Customize' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Customize overview' })
    expect(dialog.className).toContain('popover-surface')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(within(dialog).getByRole('checkbox', { name: 'Recent spending' })).toBeTruthy()
    expect(within(dialog).queryByText('Recent living spending')).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Customize overview' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Customize overview' })).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Customize overview' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
```
If `usePopoverDismiss` listens for `mousedown` rather than `pointerdown` (read the hook), fire that event instead.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx -t "Customize popover"`
Expected: FAIL — no dialog role; `aria-haspopup` missing.

- [ ] **Step 3: Rewrite `OverviewCustomize.tsx`**

```tsx
import { useRef, useState } from 'react'
import { DEFAULT_OVERVIEW_LAYOUT, OVERVIEW_CARDS, OVERVIEW_TILES } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'
import { usePopoverDismiss } from '../usePopoverDismiss'

// Labels mirror the tile and card titles exactly (2026-09-13 polish spec §14): the spending
// card is titled "Recent spending", so its checkbox is too.
const LABELS = { net_worth: 'Net worth', portfolio: 'Portfolio', living_spending: 'Living spending', tax: 'Estimated tax', ytd: 'Year to date', performance: 'Portfolio performance', spending: 'Recent spending', money_flow: 'Money flow' }

// A popover, not a <details> (spec §11): outside pointer and Escape close it, focus returns to
// the button, and it wears the shared .popover-surface (F2's tokens and pop-in motion).
export default function OverviewCustomize({ value, onChange }: { value: OverviewLayout; onChange: (value: OverviewLayout) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  usePopoverDismiss(open, close, triggerRef, surfaceRef)
  const done = () => { setOpen(false); triggerRef.current?.focus() }
  return <div className="overview-customize">
    <button ref={triggerRef} type="button" className="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>Customize</button>
    {open && <div ref={surfaceRef} className="popover-surface overview-customize-menu" role="dialog" aria-label="Customize overview">
      {(['tiles', 'cards'] as const).map(group => <fieldset key={group}><legend>{group === 'tiles' ? 'Summary tiles' : 'Deeper views'}</legend>
        {(group === 'tiles' ? OVERVIEW_TILES : OVERVIEW_CARDS).map(id => {
          const items = value[group] as string[]
          const index = items.indexOf(id)
          const move = (direction: number) => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange({ ...value, [group]: next }) }
          return <div className="overview-customize-row" key={id}><label><input type="checkbox" checked={index >= 0} disabled={group === 'tiles' && index >= 0 && items.length === 1}
            onChange={e => onChange({ ...value, [group]: e.target.checked ? [...items, id] : items.filter(item => item !== id) })} />{LABELS[id]}</label>
            <span>{index >= 0 ? index + 1 : 'Hidden'}</span>
            <button type="button" className="button" aria-label={`Move ${LABELS[id]} earlier`} disabled={index <= 0} onClick={() => move(-1)}>↑</button>
            <button type="button" className="button" aria-label={`Move ${LABELS[id]} later`} disabled={index < 0 || index === items.length - 1} onClick={() => move(1)}>↓</button>
          </div>
        })}
      </fieldset>)}
      <div className="overview-customize-actions">
        <button type="button" className="button" onClick={() => onChange(DEFAULT_OVERVIEW_LAYOUT)}>Reset to defaults</button>
        <button type="button" className="button button-primary" onClick={done}>Done</button>
      </div>
    </div>}
  </div>
}
```

- [ ] **Step 4: CSS**

In `src/pages/OverviewPage.css` replace the `.overview-customize`, `.overview-customize summary` and `.overview-customize-menu` rules (lines 172-174) with:
```css
/* Customize: the wrapper positions the shared .popover-surface; the surface supplies its own
   background, border, shadow, padding, z-index and pop-in motion (panels.css, F2). */
.overview-customize { position: relative; }
.overview-customize-menu { right: 0; top: calc(100% + .5rem); width: 390px; }
.overview-customize-actions { display: flex; justify-content: space-between; gap: .5rem; margin-top: .5rem; }
```
Keep the `fieldset`/`legend`/`-row` rules.

- [ ] **Step 5: Run**

Run: `npx tsc -b && npx vitest run src/pages/OverviewPage.test.tsx`
Expected: PASS — the two existing Customize tests still click `getByText('Customize')`, which is the button.

- [ ] **Step 6: Commit**

```bash
git add src/components/overview/OverviewCustomize.tsx src/pages/OverviewPage.css src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): Customize as a dismissable popover dialog with Done; label matches the Recent spending card (A4, §11)"
```

---
### Task 11: Spending — the orphan line becomes the tile's delta + badge; range chips only where they apply

**Files:**
- Modify: `src/pages/SpendingPage.tsx` (imports; the Living spending `StatTile` ~L509-514; delete ~L536; `ScopeBar range`)
- Modify: `src/pages/OverviewPage.css` (delete `.spending-metric-context`)
- Modify: `src/pages/SpendingPage.test.tsx`

Spec §10/§1, evidence T3/L4/L5: delete `p.drill-hint.spending-metric-context` (and its rule, which lives in the OTHER page's sheet — delete, do not move); the Living spending tile's `delta` reads "Cash outflow $X · tax $Y · transfers $Z" (neutral) and its `badge` is the review state when not `closed`; the "Review month" link is dropped (the ribbon's Edit link and the header's Enter month remain); the range chips hide on Budgets and History.

- [ ] **Step 1: Failing tests**

In `src/pages/SpendingPage.test.tsx`: change line 9 to `import { fetchSpendingEvidence, REVIEW_LABELS } from '../api/monthReview'`. In `'defaults to the eligible month supplied by the server and lets a user inspect a newer incomplete month'` replace the two `getByText(/… · Tax paid from take-home/)` lines:
```tsx
    const june = screen.getByText('Living spending — Jun 2026').closest('.stat-tile') as HTMLElement
    expect(june.querySelector('.stat-badge')).toBeNull() // a closed month wears no badge
    expect(june.querySelector('.stat-delta')?.textContent).toBe('Cash outflow $2,750.00 · tax $0.00 · transfers $0.00')
```
and, after the July drill:
```tsx
    const july = screen.getByText('Living spending — Jul 2026').closest('.stat-tile') as HTMLElement
    expect(july.querySelector('.stat-badge')?.textContent).toBe(REVIEW_LABELS.in_progress)
    expect(july.querySelector('.stat-delta')?.textContent).toBe('Cash outflow $2,580.00 · tax $0.00 · transfers $0.00')
    // T3/L4: no bare line under the tiles and no third door into the wizard.
    expect(document.querySelector('.spending-metric-context')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Review month' })).toBeNull()
```
Append to `describe('SpendingPage — shell scope', …)`:
```tsx
  // L5 (2026-09-13 audit): All / 1Y / YTD stayed in the sticky row on views that ignore them.
  it('hides the range chips on Budgets and History and shows them on Overview and Trends', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    expect(document.querySelectorAll('[aria-label="Time range"]')).toHaveLength(1)
    await openView('Budgets')
    expect(document.querySelectorAll('[aria-label="Time range"]')).toHaveLength(0)
    await openView('History')
    expect(document.querySelectorAll('[aria-label="Time range"]')).toHaveLength(0)
    await openView('Trends')
    expect(document.querySelectorAll('[aria-label="Time range"]')).toHaveLength(1)
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/SpendingPage.test.tsx -t "defaults to the eligible month|hides the range chips"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/SpendingPage.tsx`:
- Line 2: `import { useNavigate } from 'react-router-dom'` (drop `Link`; its only use was the deleted line).
- ScopeBar: `range` → `range={views.section === 'overview' || views.section === 'trends'}` with a comment:
```tsx
          <ScopeBar
            // The window applies to the time charts on Overview and Trends only (L5): Budgets
            // reads the ribbon's month and History declares "Full recorded history".
            range={views.section === 'overview' || views.section === 'trends'}
            month={{
              mode: 'view',
              figures: ribbonFigures,
              editHref: (month) => `/update?month=${month}&step=spending`,
            }}
          />
```
- Replace the Living spending tile (lines 509-514) with:
```tsx
            <StatTile
              label={`Living spending — ${formatMonth(kpis.month)}`}
              value={formatCurrency(kpis.total)}
              // T3 (2026-09-13 audit): the cash triple that floated under the row as a bare line
              // is this tile's own second line; the review state is its badge (closed = nothing
              // to flag). Neutral tone — a split, not a judgment.
              delta={`Cash outflow ${formatCurrency(matrix?.cash_outflow?.[focusIndex])} · tax ${formatCurrency(matrix?.tax_total?.[focusIndex])} · transfers ${formatCurrency(matrix?.transfer_total?.[focusIndex])}`}
              tone="neutral"
              badge={reviewState !== undefined && reviewState !== 'closed' ? REVIEW_LABELS[reviewState] : undefined}
              hint="Living categories only. Tax paid from take-home and transfers are shown separately."
              evidence={evidence.metric('living_spending')}
            />
```
  and add, right after the `kpis` memo (~line 439): `const reviewState = matrix?.review_state?.[focusIndex]`.
- Delete line 536 (`{kpis && <p className="drill-hint spending-metric-context">…</p>}`).

`src/pages/OverviewPage.css`: delete the last line, `.spending-metric-context { margin: -.25rem 0 1rem; }` — it styled the Spending page from the Overview sheet (F4).

- [ ] **Step 4: Run**

Run: `npx tsc -b && npx vitest run src/pages/SpendingPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SpendingPage.tsx src/pages/OverviewPage.css src/pages/SpendingPage.test.tsx
git commit -m "feat(spending): cash split and review badge on the Living spending tile instead of a bare line; range chips only on Overview and Trends (T3, L4, L5, F4)"
```

---

### Task 12: Spending — dock donut with a legend list; Total budget only with two budgeted months in view

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts` (`spendingBarsOption` hasBudget; `monthPieOption` options; new `monthPieLegend`)
- Modify: `src/components/spending/spendingChartOptions.test.ts`
- Create: `src/components/spending/BreakdownLegend.tsx`, `src/components/spending/breakdownLegend.css`
- Modify: `src/pages/SpendingPage.tsx` (selection renderer), `src/pages/SpendingPage.test.tsx`

Spec §12, evidence W7/F5: inside the dock the donut has no leader labels (`label: { show: false }`) and a legend list (category · amount · %) as the ChartCard `aside`; the "Total budget" series and legend chip exist only when the displayed window shows ≥ 2 budgeted months.

- [ ] **Step 1: Failing option-builder tests**

In `src/components/spending/spendingChartOptions.test.ts`, inside `describe('spendingBarsOption', …)` after `'omits the budget step when no month has a total budget'`, add:
```ts
  // F5 (2026-09-13 audit): one budgeted month in 38 drove a permanent legend chip.
  it('omits the budget step unless the DISPLAYED window shows at least two budgeted months', () => {
    expect(read(spendingBarsOption(barsInput(matrixFixture({ total_budget: ['500.00', null] })))).series.map((s) => s.id)).not.toContain('budget-Total budget')
    const three = matrixFixture({
      months: ['2026-05-01', '2026-06-01', '2026-07-01'],
      series: [
        { category_id: 1, values: ['2000.00', '2000.00', '2000.00'], budgets: ['500.00', '500.00', null] },
        { category_id: 2, values: ['600.00', '600.00', null], budgets: [null, null, null] },
        { category_id: 3, values: ['150.00', '150.00', null], budgets: [null, null, null] },
      ],
      totals: ['2750.00', '2750.00', '2000.00'], net_pay: ['6000.00', '6000.00', '6000.00'],
      savings_rate: ['0.54', '0.54', null], four_pct_rule: ['4100.50', '4100.50', '4100.50'],
      total_budget: ['500.00', '500.00', null],
    })
    const labels = ['May 2026', 'Jun 2026', 'Jul 2026']
    const inView = read(spendingBarsOption({ ...barsInput(three), monthLabels: labels, range: { preset: 'all' as const, window: { startValue: 0, endValue: 1 } } }))
    expect(inView.series.map((s) => s.id)).toContain('budget-Total budget')
    const outOfView = read(spendingBarsOption({ ...barsInput(three), monthLabels: labels, range: { preset: 'all' as const, window: { startValue: 2, endValue: 2 } } }))
    expect(outOfView.series.map((s) => s.id)).not.toContain('budget-Total budget')
  })
```
Inside `describe('monthPieOption', …)` add:
```ts
  it('drops the leader labels in the compact (dock) variant and keeps them by default (W7)', () => {
    type Pie = { series: { label?: { show?: boolean; formatter?: string } }[] }
    expect((monthPieOption(matrixFixture(), [1, 2], 0) as unknown as Pie).series[0].label).toMatchObject({ formatter: '{b}  {d}%' })
    expect((monthPieOption(matrixFixture(), [1, 2], 0, { compact: true }) as unknown as Pie).series[0].label).toEqual({ show: false })
  })
```
Add a new describe (import `monthPieLegend` beside `monthPieOption` at the top):
```ts
describe('monthPieLegend', () => {
  it('lists the drawn slices with their share of the month and their palette slot', () => {
    expect(monthPieLegend(matrixFixture(), [1, 2], 0)).toEqual([
      { name: 'Rent', value: 2000, share: 2000 / 2750, slot: 0 },
      { name: 'Groceries <b>& more</b>', value: 600, share: 600 / 2750, slot: 1 },
      { name: 'Other', value: 150, share: 150 / 2750, slot: null },
    ])
    expect(monthPieLegend(matrixFixture(), [1, 2], -1)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts`
Expected: FAIL (budget step present for `['500.00', null]`; `monthPieLegend` not exported; compact option unknown).

- [ ] **Step 3: Implement the builders**

In `src/components/spending/spendingChartOptions.ts`:
- Change the timeZoom import to `import { rangeZoom, resolvedWindow } from '../../charts/timeZoom'`.
- In `spendingBarsOption`, replace `const hasBudget = matrix.total_budget.some((v) => v !== null)` with:
```ts
  // F5 (2026-09-13 audit): a single budgeted month in 38 drove a permanent legend entry. The step
  // and its chip exist only when the DISPLAYED window shows at least two budgeted months — one
  // point draws no step, and a book with no budgets in view has nothing to summon.
  const { startValue, endValue } = resolvedWindow(matrix.months, range)
  const budgetedInView = matrix.total_budget.slice(startValue, endValue + 1).filter((v) => v !== null).length
  const hasBudget = budgetedInView >= 2
```
- Replace the `monthPieOption` signature and label line:
```ts
export interface MonthPieOptions {
  /** The dock variant (W7): no leader labels — they truncated to "Hous…" at 440px. The names
   *  ride a legend list beside the chart instead (monthPieLegend + ChartCard `aside`). */
  compact?: boolean
}

/** One month's breakdown as the bars' drill-in: the SAME top-N fold and slots as the stack,
 *  morphing from the bar segments by id. Null when the month has nothing positive to draw. */
export function monthPieOption(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  topIds: number[],
  monthIndex: number,
  { compact = false }: MonthPieOptions = {},
): EChartsOption | null {
```
  and inside the series: `label: compact ? { show: false } : { color: INK, formatter: '{b}  {d}%' },`
- After `monthPieCsv`, add:
```ts
/** The legend list beside the dock donut: the drawn slices, each one's share of the month and
 *  the palette slot it wears (null = the folded Other). The same fold as the pie, so the list and
 *  the slices agree by construction. Display-only floats (format.ts's rule). */
export function monthPieLegend(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  topIds: number[],
  monthIndex: number,
): { name: string; value: number; share: number; slot: number | null }[] {
  const slices = buildMonthSlices(matrix, topIds, monthIndex)
  const total = slices.reduce((acc, slice) => acc + slice.value, 0)
  return slices.map((slice) => ({ name: slice.name, value: slice.value, share: total === 0 ? 0 : slice.value / total, slot: slice.slot }))
}
```
Run `npx vitest run src/components/spending/spendingChartOptions.test.ts` → PASS.

- [ ] **Step 4: The legend component**

Create `src/components/spending/breakdownLegend.css`:
```css
/* The dock donut's legend (2026-09-13 polish §12): name · amount · share, swatches on the CSS
   slot tokens so they follow the theme like the trend chips do. No motion of its own. */
.breakdown-legend { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; align-content: start; font-size: .82rem; }
.breakdown-legend li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; align-items: center; gap: .5rem; }
.breakdown-swatch { width: 10px; height: 10px; border-radius: 2px; }
.breakdown-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.breakdown-amount, .breakdown-share { color: var(--muted); font-variant-numeric: tabular-nums; }
```
Create `src/components/spending/BreakdownLegend.tsx`:
```tsx
import { formatCurrency, formatPct } from '../../utils/format'
import type { monthPieLegend } from './spendingChartOptions'
import './breakdownLegend.css'

type Row = ReturnType<typeof monthPieLegend>[number]

/** The names the dock donut no longer draws as leader labels (W7): a list beside the chart —
 *  category · amount · share. Other wears the folded-stack grey; slots are 0-based, the CSS
 *  tokens 1-based (the trend chips' rule). */
export default function BreakdownLegend({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <ul className="breakdown-legend" aria-label={label}>
      {rows.map((row) => (
        <li key={row.name}>
          <span
            className="breakdown-swatch"
            aria-hidden="true"
            style={{ background: row.slot === null ? 'var(--other-series)' : `var(--chart-${row.slot + 1})` }}
          />
          <span className="breakdown-name">{row.name}</span>
          <span className="breakdown-amount">{formatCurrency(row.value)}</span>
          <span className="breakdown-share">{formatPct(row.share, { signed: false })}</span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 5: Wire the dock donut and add the page test**

`src/pages/SpendingPage.tsx`: add `import BreakdownLegend from '../components/spending/BreakdownLegend'` and `monthPieLegend,` to the `spendingChartOptions` import list. In the `renderSelection` (lines 554-561) replace the nested `<ChartCard …/>` with:
```tsx
              return <><SelectionDetail selection={selected} chartTitle="Monthly category entries" />{matrix && index >= 0 && <ChartCard
                title={`${selected.label} breakdown`} hint="Positive categories make up this donut. Refunds are included in the totals above."
                ariaLabel={`Donut chart of ${selected.label} categories`} option={monthPieOption(matrix, topIds, index, { compact: true })}
                empty="No positive category amounts to draw." exportName={`spending-breakdown-${matrix.months[index]}`}
                csv={() => monthPieCsv(matrix, topIds, index)} height={240}
                // W7: names beside the chart instead of leader labels that truncate in the dock.
                aside={<BreakdownLegend rows={monthPieLegend(matrix, topIds, index)} label={`${selected.label} breakdown legend`} />} />}</>
```
In `src/pages/SpendingPage.test.tsx`, inside `'drills a month from the ribbon into ?month=YYYY-MM and shows that month’s breakdown'`, after `expect(await screen.findByText(/Jul 2026 breakdown/)).toBeTruthy()` add:
```tsx
    // W7: the donut's names ride a legend list beside it (ChartCard aside).
    const legend = screen.getByRole('list', { name: 'Jul 2026 breakdown legend' })
    expect(within(legend).getByText('Rent')).toBeTruthy()
    expect(within(legend).getByText('$2,000.00')).toBeTruthy()
    expect(within(legend).getByText('77.5%')).toBeTruthy()
    expect(within(legend).getByText('22.5%')).toBeTruthy()
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2) // Fun is $0.00 in July: not a slice
```

- [ ] **Step 6: Run**

Run: `npx tsc -b && npx vitest run src/components/spending/spendingChartOptions.test.ts src/pages/SpendingPage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/spending/spendingChartOptions.ts src/components/spending/spendingChartOptions.test.ts src/components/spending/BreakdownLegend.tsx src/components/spending/breakdownLegend.css src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx
git commit -m "feat(spending): dock donut with a legend list instead of truncated leader labels; Total budget only with two budgeted months in view (W7, F5)"
```

---
### Task 13: Budgets — inline single-open editor, "No budget yet (N)" section, seed sentence on one row

**Files:**
- Modify: `src/components/spending/BudgetPanel.tsx`
- Modify: `src/components/spending/budgets.css`
- Modify: `src/components/spending/BudgetPanel.test.tsx`

Spec §11 (table row "Budgets `budget-unbudgeted` + 19 `budget-editor`") and §16 ("only one open editor at a time; unsaved amounts in a closing editor are kept in `editors` state"), evidence A1/W6: every `<details class="budget-editor">` goes — a budgeted row gets an **Edit budget** button, an unbudgeted row a **Set budget** button, each opening the existing editor inline for that one category (`openEditor` state; opening another closes the first; typed amounts survive in `editors`). Unbudgeted rows sit in a section headed "No budget yet (N)" — a `Disclosure` when budgets exist, an always-open plain section when the book has none — on a two-column grid. The empty state's sentence and its seed button share one row.

- [ ] **Step 1: Update and add tests**

In `src/components/spending/BudgetPanel.test.tsx`:

- Replace `'lists unbudgeted ACTIVE categories collapsed, without meters or inactive ones'` with:
```tsx
it('lists unbudgeted ACTIVE categories under "No budget yet", collapsed while budgets exist, without meters or inactive ones', () => {
  renderPanel(0)
  const section = screen.getByText('No budget yet (1)').closest('details') as HTMLElement
  expect(section).not.toBeNull()
  expect(section.hasAttribute('open')).toBe(false)
  expect(within(section).getByText('Rent')).toBeDefined()
  expect(within(section).getByRole('button', { name: 'Set Rent budget' })).toBeDefined()
  expect(within(section).queryByText('Old')).toBeNull()
  expect(screen.queryByRole('meter', { name: 'Rent spend vs budget' })).toBeNull()
  // A1: no accordion inside the accordion — the editor opens from the row's button.
  expect(document.querySelectorAll('details.budget-editor')).toHaveLength(0)
})
```
- In `'saves through the PUT (editor defaults to the FOCUSED month)…'`, `'follows the focused month when the page drills elsewhere'`, `'a blank amount saves the null end-marker'`, `'deletes a history row through the DELETE…'` and `'rejects a negative amount client-side…'`: insert `fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))` as the first line after `renderPanel(…)`.
- In `'degrades when the suggestions cannot load…'` replace `expect(screen.getByLabelText('Food budget amount')).toBeDefined()` with:
```tsx
  fireEvent.click(screen.getByRole('button', { name: 'Set Food budget' }))
  expect(screen.getByLabelText('Food budget amount')).toBeDefined()
```
- Replace `'the editor shows suggestion chips and a chip fills the amount box; the cue names the shape'` with:
```tsx
it('the editor shows suggestion chips, a chip fills the amount box, and opening another row closes the first', async () => {
  renderPanel(0)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Use Food median $390.00' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$390.00')
  fireEvent.click(screen.getByRole('button', { name: 'Use Food suggested $413.00' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$413.00')
  // One editor at a time (spec §16): Rent's opens, Food's closes.
  fireEvent.click(screen.getByRole('button', { name: 'Set Rent budget' }))
  expect(screen.queryByLabelText('Food budget amount')).toBeNull()
  expect(screen.getByRole('button', { name: 'Use Rent last month $2,000.00' })).toBeDefined()
  expect(screen.getByText(/^Steady — within 10% every month/)).toBeDefined()
  // Reopening Food brings back what was typed — the draft lives in `editors`, not in the DOM.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$413.00')
  expect(screen.queryByLabelText('Rent budget amount')).toBeNull()
})
```
- In `'hides Re-seed when every seed already stands'` replace `await screen.findByRole('button', { name: 'Use Food median $390.00' }) // suggestions arrived` with:
```tsx
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  await screen.findByRole('button', { name: 'Use Food median $390.00' }) // suggestions arrived
```
- Append:
```tsx
// A1/W6 (2026-09-13 audit): with no budgets the whole job of the card is to get one set, so the
// list is open and plain, and the seed sentence sits beside its button.
it('shows the unbudgeted list as an open plain section when the book has no budgets, with the seed sentence and button on one row', async () => {
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  expect(screen.getByRole('heading', { name: 'No budget yet (2)' })).toBeDefined()
  expect(document.querySelector('.budget-unbudgeted')?.tagName).toBe('SECTION')
  expect(screen.getByRole('button', { name: 'Set Food budget' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Set Rent budget' })).toBeDefined()
  const row = screen.getByText('No budgets yet.').closest('.budget-seed-row') as HTMLElement
  expect(within(row).getByRole('button', { name: 'Start from my averages' })).toBeDefined()
  await screen.findByText(/Writes a budget for 2 living categories/)
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/spending/BudgetPanel.test.tsx`
Expected: FAIL (no "Edit Food budget" button; "No budget — set one (1)" still the summary).

- [ ] **Step 3: Implement in `BudgetPanel.tsx`**

Imports: add `import Disclosure from '../Disclosure'` (adjust to the real export style from Task 0).

State (after `editors`):
```tsx
  // The one open inline editor (2026-09-13 polish spec §11/§16): a row's Set/Edit button opens
  // its editor and closes any other. What was typed in a closed editor stays in `editors`
  // (keyed by category), so switching rows never loses work.
  const [openEditor, setOpenEditor] = useState<number | null>(null)
```
In `save().then`, after the `setEditors(…)` call, add `setOpenEditor(null)`.

Replace `editorBlock` (lines 222-303) so it returns the form without the `<details>`/`<summary>`:
```tsx
  const editorBlock = (category: CategoryOut, budget: string | null) => {
    const editor = editors[category.id] ?? {
      amount: budget ?? '',
      effectiveFrom: defaultEffectiveFrom,
    }
    const setEditor = (patch: Partial<EditorState>) =>
      setEditors((cur) => ({ ...cur, [category.id]: { ...editor, ...patch } }))
    const history = histories[category.id]
    const suggestion = suggestionById.get(category.id)
    return (
      <div className="budget-editor">
        <div className="budget-editor-form">
          <label>
            Monthly budget
            <AmountInput
              value={editor.amount}
              onValueChange={(next) => setEditor({ amount: next })}
              placeholder="blank ends the budget"
              aria-label={`${category.name} budget amount`}
            />
          </label>
          <label>
            Effective from
            <input
              type="month"
              className="field-input"
              aria-label={`${category.name} budget effective from`}
              value={editor.effectiveFrom}
              onChange={(e) => setEditor({ effectiveFrom: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button"
            aria-label={`Save ${category.name} budget`}
            disabled={busy}
            onClick={() => save(category, editor)}
          >
            Save
          </button>
          {/* A5: promoted into the control row (was parked between the form and the
              history list) — the past-dating warning must be read at the moment the date
              is chosen, one short line. */}
          <p className="drill-hint budget-editor-hint">
            Defaults to {formatMonth(month)} — the month the meters read. Dating it in the
            past re-writes what that era&apos;s budget was.
          </p>
          {suggestion !== undefined && (
            <BudgetSuggestions
              categoryName={category.name}
              kind={category.kind}
              suggestion={suggestion}
              onPick={(amount) => setEditor({ amount })}
            />
          )}
        </div>
        {history !== undefined && (
          <ul className="budget-history">
            {history.map((entry) => (
              <li key={entry.effective_month}>
                <span>
                  {`${formatMonth(entry.effective_month)} — ${
                    entry.amount === null ? 'budget ends' : formatCurrency(entry.amount)
                  }`}
                </span>
                <button
                  type="button"
                  className="button"
                  aria-label={`Delete the ${formatMonth(entry.effective_month)} budget row for ${category.name}`}
                  disabled={busy}
                  onClick={() => removeRow(category, entry.effective_month)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // The row's one control: "Edit budget" where a budget stands, "Set budget" where none does.
  const editorToggle = (category: CategoryOut, verb: 'Set' | 'Edit') => (
    <button
      type="button"
      className="button budget-editor-toggle"
      aria-label={`${verb} ${category.name} budget`}
      aria-expanded={openEditor === category.id}
      onClick={() => setOpenEditor((current) => (current === category.id ? null : category.id))}
    >
      {verb} budget
    </button>
  )
```
Budgeted rows (lines 363-390): wrap each row so the editor renders under it, outside the four-column grid:
```tsx
          <div className="budget-rows">
            {budgeted.map(({ category, budget, progress }) => (
              <div className="budget-entry" key={category.id}>
                <div className="budget-row">
                  <span className="budget-name">{category.name}</span>
                  <div
                    className="budget-meter"
                    role="meter"
                    aria-label={`${category.name} spend vs budget`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress.fillPct)}
                    aria-valuetext={`${formatCurrency(progress.spent)} of ${formatCurrency(progress.budget)}`}
                  >
                    <div
                      className={`budget-fill${progress.over ? ' is-over' : ''}`}
                      style={{ width: `${progress.fillPct.toFixed(2)}%` }}
                    />
                    {/* Over-ness rides a POSITION channel (the tick past the track's end),
                        not colour alone — the summary line carries it in words too. */}
                    {progress.over && <span className="budget-overflow-tick" aria-hidden="true" />}
                  </div>
                  <span className={`budget-figures${progress.over ? ' delta-negative' : ''}`}>
                    {`${formatCurrency(progress.spent)} / ${formatCurrency(progress.budget)}`}
                  </span>
                  {editorToggle(category, 'Edit')}
                </div>
                {openEditor === category.id && editorBlock(category, budget)}
              </div>
            ))}
          </div>
```
Empty state (lines 393-409):
```tsx
        <div className="budget-seed">
          {/* W6: a lead sentence beside its button — not a centred placeholder 24px from both. */}
          <div className="budget-seed-row">
            <p className="empty-note">No budgets yet.</p>
            <button
              type="button"
              className="button button-primary"
              // Disabled says THAT it cannot run; only the hint says why, so the button has to
              // name it — a disabled control is otherwise mute to a screen reader.
              aria-describedby="budget-seed-hint"
              disabled={busy || !canSeed}
              onClick={seed}
            >
              Start from my averages
            </button>
          </div>
          <p className="drill-hint budget-seed-hint" id="budget-seed-hint">
            {seedHint()}
          </p>
        </div>
```
Unbudgeted section (lines 411-423):
```tsx
      {unbudgeted.length > 0 && (() => {
        const title = `No budget yet (${unbudgeted.length})`
        const rows = (
          <div className="budget-rows">
            {unbudgeted.map(({ category, budget }) => (
              <div className="budget-entry" key={category.id}>
                <div className="budget-row budget-row-unbudgeted">
                  <span className="budget-name">{category.name}</span>
                  {editorToggle(category, 'Set')}
                </div>
                {openEditor === category.id && editorBlock(category, budget)}
              </div>
            ))}
          </div>
        )
        // A disclosure only while budgets exist above it (spec §11); with none, getting one set IS
        // the card's job, so the list is open and plain.
        return budgeted.length > 0 ? (
          <Disclosure className="budget-unbudgeted" summary={title}>{rows}</Disclosure>
        ) : (
          <section className="budget-unbudgeted">
            <h3 className="eyebrow">{title}</h3>
            {rows}
          </section>
        )
      })()}
```

- [ ] **Step 4: CSS**

In `src/components/spending/budgets.css` replace the two `summary` rules (lines 66-76) with:
```css
/* Rows and their inline editor (2026-09-13 polish §11): one editor open at a time, opened by the
   row's own Set/Edit button — no accordion inside an accordion. */
.budget-entry { display: flex; flex-direction: column; gap: 0.35rem; }
.budget-row-unbudgeted { grid-template-columns: minmax(110px, 160px) auto; justify-content: start; }
.button.budget-editor-toggle { font-size: 0.72rem; padding: 0.2rem 0.55rem; }
.budget-editor { margin: 0.1rem 0 0.4rem; padding: 0.6rem 0.75rem; border: 1px solid var(--border); border-radius: 8px; }
.budget-unbudgeted { margin-top: 0.75rem; }
.budget-unbudgeted .eyebrow { margin-bottom: 0.5rem; }
```
Replace the `.budget-seed { … }` and `.budget-seed .empty-note { … }` rules (lines 132-141) with:
```css
.budget-seed { display: flex; flex-direction: column; gap: 0.5rem; }
.budget-seed-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
/* W6: a lead sentence, not a placeholder — no vertical padding, no centring. */
.budget-seed .empty-note { margin: 0; padding: 0; text-align: left; }
```

- [ ] **Step 5: Run**

Run: `npx tsc -b && npx vitest run src/components/spending/BudgetPanel.test.tsx src/pages/SpendingPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/spending/BudgetPanel.tsx src/components/spending/budgets.css src/components/spending/BudgetPanel.test.tsx
git commit -m "feat(spending): budgets — inline single-open editor from Set/Edit buttons, No budget yet section (disclosure only when budgets exist), seed sentence beside its button (A1, W6)"
```

---

### Task 14: Review vocabulary copy pass

**Files:**
- Modify: `src/api/monthReview.ts` (lines 49-52)
- Create: `src/api/monthReview.test.ts`

Spec §14: unreviewed_history → "Not yet reviewed", needs_review → "Changed since review", closed → "Reviewed", in_progress → "In progress", ready_to_review → "Ready to review", not_started → "Not started". Every consumer (Overview badge, Spending badge, ribbon chips, wizard pill, historical list) reads the map; the only tests that pinned the old words were rewritten in Task 11.

- [ ] **Step 1: Failing test**

Create `src/api/monthReview.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { REVIEW_LABELS } from './monthReview'

describe('REVIEW_LABELS', () => {
  it('reads as plain language, not review-system jargon (2026-09-13 polish spec §14)', () => {
    expect(REVIEW_LABELS).toEqual({
      not_started: 'Not started',
      in_progress: 'In progress',
      ready_to_review: 'Ready to review',
      closed: 'Reviewed',
      needs_review: 'Changed since review',
      unreviewed_history: 'Not yet reviewed',
    })
  })
})
```
Run: `npx vitest run src/api/monthReview.test.ts` → FAIL.

- [ ] **Step 2: Change the map**

```ts
// Plain words for a person reading a chip (2026-09-13 polish spec §14): "history" and "closed"
// were the system's terms, not the reader's. The inspector still explains what
// unreviewed_history means ("entered before month review existed").
export const REVIEW_LABELS: Record<ReviewState, string> = {
  not_started: 'Not started', in_progress: 'In progress', ready_to_review: 'Ready to review',
  closed: 'Reviewed', needs_review: 'Changed since review', unreviewed_history: 'Not yet reviewed',
}
```

- [ ] **Step 3: Run the label test and every consumer's suite**

Run: `npx vitest run src/api/monthReview.test.ts src/pages/OverviewPage.test.tsx src/pages/SpendingPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/components/monthly src/components/shell`
Expected: PASS (the badge tests interpolate `REVIEW_LABELS`, the ribbon tests never pinned a label word).

- [ ] **Step 4: Commit**

```bash
git add src/api/monthReview.ts src/api/monthReview.test.ts
git commit -m "fix(review): plain-language review states — Not yet reviewed, Changed since review, Reviewed (spec §14)"
```

---

### Task 15: README — the Windows `DATABASE_URL` host note

**Files:**
- Modify: `README.md` (the `## Troubleshooting` section, ~line 868)

Spec §9 asks for an environment note in the README's dev section; the README has no dev section (it is the deployment runbook), so the note joins **Troubleshooting**, where the other "why is this slow / failing" entries live.

- [ ] **Step 1: Add the entry**

Insert directly under the `## Troubleshooting` heading, before the first `**Backend unhealthy…**` entry:

```markdown
**Local development on Windows: every wizard load or month switch takes ~2 s** — the local
`backend/.env` `DATABASE_URL` points at `localhost`, and on the Windows Proactor loop
`asyncio.open_connection('localhost', …)` tries `::1` first while PostgreSQL listens on
`127.0.0.1` only: every overflow pool connection past `pool_size=5` pays ~2,035 ms before
falling back (measured 2026-09-13; nine parallel wizard feeds open several). Set the host to
`127.0.0.1` in the local `DATABASE_URL` (`postgresql+asyncpg://…@127.0.0.1:5433/…`) and restart
uvicorn; the wizard's first content then lands under a second. Production uses
`host.docker.internal` on Linux, where a refused `::1` returns instantly.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): Windows dev note — DATABASE_URL host 127.0.0.1 avoids the ::1 stall on overflow pool connections"
```

---

### Task 16: Gates

**Files:** none modified (fixes, if any, go into the task they belong to with a follow-up commit).

- [ ] **Step 1: Type-check**

Run: `npx tsc -b`
Expected: no output.

- [ ] **Step 2: Lint the lane's files**

Run: `npx eslint src/pages/OverviewPage.tsx src/pages/MonthlyUpdatePage.tsx src/pages/SpendingPage.tsx src/components/overview src/components/monthly src/components/spending`
Expected: no errors; the warning count must not exceed the pre-lane baseline for these paths (`react-refresh/only-export-components` warnings already present are allowed, new ones are not).

- [ ] **Step 3: Scoped tests**

Run: `npx vitest run src/pages/OverviewPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/pages/SpendingPage.test.tsx src/components/overview src/components/monthly src/components/spending src/api/monthReview.test.ts`
Expected: all files PASS.

- [ ] **Step 4: Full suite**

Run: `npx vitest run --reporter=dot 2>&1 | tail -6`
Expected: `Test Files N passed`, `Tests M passed` with M ≥ the Task 0 baseline + the tests added here (≈ 30 new); zero failures. `motion.test.ts` and `tokens.test.ts` in particular must still pass (no literal durations were introduced — every new rule is layout only).

- [ ] **Step 5: Production build**

Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built in …` with no TypeScript errors.

- [ ] **Step 6: Hand-off note for lane V (append to the lane's report, not a commit)**

Acceptance items this lane moves (spec §15): #3 — the ORPHAN list on Overview and Spending must now be empty (`p.drill-hint` at the old L735, `.overview-freshness`, `.spending-metric-context` are gone); #6 — `/update` shows `.skeleton` before its first card and no blank on a month switch (`.loading-dim.is-loading` over the previous card, `aria-busy`); #1 — `.popover-surface` (Customize, Month actions) and `.disclosure` (Budgets "No budget yet") carry F2's motion. Deferred by design: the Spending tile label keeps its month (`Living spending — Jul 2026`) — only the Overview tile was asked to shorten; the budgeted rows' editors also moved to buttons (see the self-review).

---

## Self-review

**Spec coverage (sections 9–12, 14 as they apply to P1):**

| Requirement | Task |
| --- | --- |
| §9 Monthly update `resource`/`skeleton`, keep-mounted month switch, first paint on the seed feeds, coverage instead of timeseries | Task 2 |
| §9 README environment note | Task 15 |
| §9 Overview tiles ghost while busy, YTD slot reserved | Tasks 7, 8 |
| §10 Overview: Data status card, orphan + footer removed, spending badge | Tasks 6, 7 |
| §10 Spending: `.spending-metric-context` → tile delta + badge, Review month link dropped | Task 11 |
| §11 `OverviewCustomize` popover | Task 10 |
| §11 Month actions kebab popover | Task 4 |
| §11 `HistoricalReview` card | Task 5 |
| §11 Budgets: No budget yet section, Set budget inline single-open editor, two-column rows | Task 13 |
| §12 `.overview-deeper` card-grid, spans | Task 8 |
| §12 ChartCard `aside` for the dock donut, labels off | Task 12 |
| §14 `REVIEW_LABELS` | Task 14 |
| §14 Needs attention rows as actions, past months, nudge day | Task 9 |
| §14 Customize label alignment | Task 10 |
| Evidence F2 (seed exclusion) / F3 (pill background) / F5 (Total budget) / W4 (YTD) / W5+T4 (Review tiles, footer note) / W6 (seed row) / C3 (eyebrow without month, Close selected months) | Tasks 1, 3, 12, 8, 3, 13, 3+5 |

**Placeholder scan:** every code step carries the code it asks for; where a task wraps or edits an existing block (Task 7's tile ghosts, Task 13's editor), the full replacement is written out and the find/replace anchors name the exact lines; no "TBD", "similar to Task N", or "add appropriate handling" anywhere.

**Type consistency checked across tasks:** `recordedCategories: ReadonlySet<number>` (Task 1 prop) ← `recordedCategoryIds` (Task 1 page memo); `seeded: LoadedMonth | null` and `key={seeded.generation}` (Task 2) reused by Tasks 3–5's gates; `coverage: CoverageOut | null` state (Task 2) ← `HistoricalReview coverage` prop (Task 5); `FreshnessClause.label/detail` (Task 6) ← `DataStatusCard`; `reviewAttentionItems(reviews, todayIso)` (Task 9) returns `AttentionItem[]` with the same `{ key, text, to }` shape the strip renders; `monthPieLegend()` row shape (Task 12) ← `BreakdownLegend rows`; `usePopoverDismiss(open, onClose, triggerRef, surfaceRef)` called identically in Tasks 4 and 10.

**Ambiguities resolved (also reported to the lead):**

1. *Which feeds gate the wizard's first paint.* The brief listed "matrix, household, review, timeseries, prior month" as tolerant of absence and asked to verify. In code the prior month is NOT tolerant (a new month is seeded from it and the draft baseline is built from that seed) and neither is the review (a save carries `input_revision`; `emptyMonth` reads `reviewed.spending`). So the first paint waits for six per-month feeds (accounts, categories, this month, prior month, spending month, review) and the three household-wide aids (matrix, household, coverage) land independently — exactly the three that already have `.catch(() => null)` fallbacks.
2. *`ReviewChanges` inputs.* Rather than passing `storedCategories` + `willWriteSpending` and re-deriving the save rule inside the component (a second copy of `sentCategories`), the page hoists `sentCategories` to component scope, uses it in `save()`, and hands `ReviewChanges` one `recordedCategories` set with `willWriteSpending` and `recordZero` already folded in.
3. *Budgeted rows' editors.* The spec's site is "`budget-unbudgeted` + 19 `budget-editor`"; the 19 in the prod book are all unbudgeted, but `budget-editor` is the class of every row's editor and §16 says "only one open editor at a time". Both row kinds move to the button-opened single-open editor (Edit budget / Set budget), so the card has one accordion policy.
4. *Spending tile label.* Only the Overview tile was asked to shorten to "Living spending"; the Spending page's tile keeps `Living spending — Jul 2026` (its month IS the page's ribbon selection) and gains the badge and cash-split delta.
5. *README dev section.* None exists (the README is the deployment runbook); the note lands in `## Troubleshooting`.
6. *Data status `dl` rows.* `freshnessClauses` gains `label`/`detail` (keeping `text`) so the rows are honest `<dt>/<dd>` pairs ("Balances through" / "Jul 2026", "Balances" / "no months") instead of a sentence stuffed into a `dd`.
7. *Error-only branch.* Spec §9's resource formula names only the loading branch; the plan keeps the existing error-only view for a first load that fails with nothing to show (`status: 'error'`), and uses ready+stale-line once a seed is on screen.
