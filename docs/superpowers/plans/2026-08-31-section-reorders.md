# Section Reorders & Headline Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 2026-08-31 page-arrangement audit's approved display changes — three section reorders (Taxes, Credit cards, Spending), the Settings data-in/data-out pairing, top KPI strips on Comp and ESPP, and the nav Tracking order — with zero behavior/data changes.

**Architecture:** Pure frontend display work. Every task is a JSX mount reorder, a copy flip, or a hoist of already-fetched payload figures into a page-top strip. One real component split (Taxes: `SummaryPanel` emits two cards today; the all-years trend card becomes its own `CompositionPanel` so the year-scoped cards can sit contiguously). No API, type, or state-shape changes anywhere.

**Tech Stack:** React 19 + TypeScript, vitest + @testing-library/react (jsdom; EChart is always a marker stub), house test idiom for order pins: `compareDocumentPosition` + `Node.DOCUMENT_POSITION_FOLLOWING` (see `src/pages/EsppPage.test.tsx` ~line 652).

**Ground rules for every task (house law):**
- TDD: write the order-pin/strip test first, watch it fail, then move JSX. Run only your task's test file: `npx vitest run <file>`.
- Figures are the server's, rendered verbatim — never re-derive (global rule 9).
- Do NOT run any `git` command (the coordinator commits). Do NOT touch files outside your task's list. Do NOT change fetch logic, state, keys, or effects — mounts move, behavior doesn't.
- Match the house comment style: comments state constraints/rationale with date tags (e.g., `2026-08-31 audit`), not narration.

**Parallelization map (disjoint file sets):**
- Coordinator inline: Tasks 1, 2, 3, 5.
- Subagent A: Task 4 (Credit cards). Subagent B: Task 6 (Comp). Subagent C: Task 7 (ESPP).

---

### Task 1: Nav Tracking order matches Overview (coordinator)

**Files:**
- Modify: `src/components/navItems.ts:42-50`
- Test: `src/components/Layout.test.tsx:115-129`

- [ ] **Step 1: Update the pinned nav-order test to the new contract**

In `Layout.test.tsx`, the full-order assertion (~line 115) swaps Spending/Portfolio:

```ts
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)).toEqual([
      'Overview',
      'Monthly update',
      'Net worth',
      'Portfolio',
      'Spending',
      'Credit cards',
      'Paycheck',
      'Comp',
      'ESPP',
      'Taxes',
      'Projection',
      'Calendar',
      'Settings',
    ])
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/Layout.test.tsx` → the order test FAILS (Spending before Portfolio).

- [ ] **Step 3: Reorder `NAV_SECTIONS` Tracking items** in `navItems.ts` (Net worth, Portfolio, Spending, Credit cards) with a one-line rationale comment:

```ts
  {
    heading: 'Tracking',
    // Stocks then flows, matching Overview's tile/chart order (2026-08-31 audit): the
    // wealth pair (Net worth, Portfolio) reads before the flow pair (Spending, Credit cards).
    items: [
      { to: '/net-worth', label: 'Net worth', icon: TrendingUp },
      { to: '/portfolio', label: 'Portfolio', icon: LineChart },
      { to: '/spending', label: 'Spending', icon: Wallet },
      { to: '/credit-cards', label: 'Credit cards', icon: CreditCard },
    ],
  },
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/components/Layout.test.tsx src/components/routeChunks.test.ts` → PASS (routeChunks compares path *sets*, unaffected).

---

### Task 2: Spending — long-run half summary-first (coordinator)

**Files:**
- Modify: `src/pages/SpendingPage.tsx` (move the two `card span-6` sections above the heatmap card)
- Test: `src/pages/SpendingPage.test.tsx`

Target order inside the card-grid: bars → What changed → flow → BudgetPanel → **Savings rate | Category trends** → **heatmap** → Yearly rollups.

- [ ] **Step 1: Write the failing order test** (new describe at the end of the file):

```tsx
describe('SpendingPage — section order (2026-08-31 audit)', () => {
  it('long-run half reads summary-first: budgets, savings+trends, heatmap, yearly', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const budgets = screen.getByRole('heading', { name: /Budgets — / })
    const savings = screen.getByRole('heading', { name: /Savings rate \(actual\)/ })
    const trends = screen.getByRole('heading', { name: /Category trends/ })
    const heatmap = screen.getByRole('heading', { name: /Month × category heatmap/ })
    const yearly = screen.getByRole('heading', { name: /Yearly rollups/ })
    // The windowed pair sits with the other windowed charts; the never-windowed
    // full-history pair (heatmap, yearly) closes the page.
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(budgets.compareDocumentPosition(savings) & following).toBeTruthy()
    expect(savings.compareDocumentPosition(trends) & following).toBeTruthy()
    expect(trends.compareDocumentPosition(heatmap) & following).toBeTruthy()
    expect(heatmap.compareDocumentPosition(yearly) & following).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/pages/SpendingPage.test.tsx` → new test FAILS (heatmap precedes savings today).

- [ ] **Step 3: Move JSX.** Cut the two sibling `<div className="card span-6">` sections ("Savings rate (actual)" and "Category trends", currently between the heatmap card and the yearly card) and paste them directly ABOVE the heatmap card (`<div className="card span-12">` whose h2 is "Month × category heatmap"). Add the rationale comment above the moved pair:

```tsx
        {/* Long-run half, summary before detail (2026-08-31 audit): the range-windowed
            pair reads right after the budgets that feed the trends chart's step lines;
            the never-windowed full-history pair (heatmap, yearly) closes the page. */}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/pages/SpendingPage.test.tsx` → PASS, all existing tests green.

---

### Task 3: Settings — pair data-out with data-in (coordinator)

**Files:**
- Modify: `src/pages/SettingsPage.tsx:475-493` (move `<SystemCard />` to directly after the Import section)
- Test: `src/pages/SettingsPage.test.tsx` (extend the system-card describe)

- [ ] **Step 1: Write the failing order test** (inside `describe('SettingsPage — system card', ...)`):

```tsx
  it('pairs data-out with data-in: System follows Import and precedes the forms (2026-08-31 audit)', async () => {
    render(<SettingsPage />)
    await screen.findByText('No refresh recorded yet')
    const importH = screen.getByRole('heading', { name: /Import workbook/ })
    const system = screen.getByRole('heading', { name: /System/ })
    const appSettings = screen.getByRole('heading', { name: /App settings/ })
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(importH.compareDocumentPosition(system) & following).toBeTruthy()
    expect(system.compareDocumentPosition(appSettings) & following).toBeTruthy()
  })
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/pages/SettingsPage.test.tsx` → FAILS (System is last today).

- [ ] **Step 3: Move the mount.** Cut `<SystemCard />` (and rewrite its comment) from the bottom of the card-grid and paste directly after the Import `</section>`:

```tsx
          {/* Data-out beside data-in (2026-08-31 audit): the snapshot download and backup
              trail live on this card, so it sits with the import rather than closing the
              page as pure status. Own fetch/error (SystemCard), same loadedOnce gate as
              everything here: a settings GET that failed means the API is unreachable. */}
          <SystemCard />
```

The management cards (Household/Categories/Accounts/Limits) keep their order and comments; nothing else moves.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/pages/SettingsPage.test.tsx src/components/settings/SystemCard.test.tsx` → PASS.

---

### Task 4: Credit cards — consult before manage (Subagent A)

**Files:**
- Modify: `src/pages/CreditCardsPage.tsx` (reorder card-grid children; flip one copy string)
- Test: `src/pages/CreditCardsPage.test.tsx`

Target order inside `<div className="card-grid ...">`: RewardsMatrix (incl. its empty-state fallback card — the whole ternary moves) → "Is each card worth keeping? (est.)" card → "Credit line history" card → CardsPanel → CategoriesPanel. The owner-chips row, KPI row, and CardDetail drill are untouched.

- [ ] **Step 1: Write the failing order test** (new describe; `seedHappyPath()` + `renderPage()` are existing helpers):

```tsx
describe('CreditCardsPage — section order (2026-08-31 audit)', () => {
  it('consult before manage: matrix, worth-keeping, line history, then the CRUD panels', async () => {
    seedHappyPath()
    renderPage()
    const matrix = await screen.findByRole('heading', { name: /Rewards matrix/ })
    const value = screen.getByRole('heading', { name: /worth keeping/i })
    const line = screen.getByRole('heading', { name: /Credit line history/ })
    const roster = screen.getByRole('heading', { name: /Card roster/ })
    const categories = screen.getByRole('heading', { name: /Categories & weights/ })
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(matrix.compareDocumentPosition(value) & following).toBeTruthy()
    expect(value.compareDocumentPosition(line) & following).toBeTruthy()
    expect(line.compareDocumentPosition(roster) & following).toBeTruthy()
    expect(roster.compareDocumentPosition(categories) & following).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/pages/CreditCardsPage.test.tsx` → FAILS (roster/categories precede the matrix today).

- [ ] **Step 3: Reorder + flip copy.** Inside the card-grid, move `{cards !== null && (<CardsPanel .../>)}` and `{categories !== null && (<CategoriesPanel .../>)}` to AFTER the "Credit line history" card. Add above the matrix ternary:

```tsx
            {/* Consult before manage (2026-08-31 audit): the matrix and the keep/drop and
                line-history answers lead; the roster and weights that parameterize them
                follow. The header's "+ Add card" still jumps straight to the roster form. */}
```

In the matrix empty-state copy, flip the direction word (the roster now sits below):

```tsx
                    The matrix appears once there is at least one active card and one category —
                    add a card below
```

(The owner-chip InfoHint already says "the roster below" — now literally true; leave it.)

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/pages/CreditCardsPage.test.tsx` → PASS, every existing test green (none pins the old order or the old copy).

---

### Task 5: Taxes — split SummaryPanel, reorder the answer cards (coordinator)

**Files:**
- Create: `src/components/taxes/CompositionPanel.tsx`
- Modify: `src/components/taxes/SummaryPanel.tsx` (drop the trend half), `src/pages/TaxesPage.tsx` (import + mount order)
- Test: `src/pages/TaxesPage.test.tsx` (order pin; re-scope the `trendCategories()` helper off chart index)

Target mount order under `detail !== null`: SummaryPanel (Totals card only) → WithholdingPanel (current year only, unchanged gate) → MarginalPanel → WhatIfPanel → CompositionPanel → InputsForm → BracketsEditor.

- [ ] **Step 1: Write the failing order test** (current-year fixture so the withholding card mounts; the what-if card is this file's marker mock):

```tsx
describe('TaxesPage — section order (2026-08-31 audit)', () => {
  it('year-scoped answers read contiguously; the all-years trend closes the answers half', async () => {
    const thisYear = new Date().getFullYear()
    vi.mocked(fetchTaxYears).mockResolvedValue([
      { year: thisYear, notes: null, input_count: 21, bracket_count: 42, filing_status: 'single' },
    ])
    renderPage()
    const willIOwe = await screen.findByText(`Will I owe? — ${thisYear}`)
    const totals = screen.getByText(`Totals — ${thisYear}`)
    const marginal = screen.getByText(`Marginal rates — ${thisYear}`)
    const whatIf = screen.getByTestId('whatif-panel')
    const trend = screen.getByText('Tax composition and effective rate by year')
    const inputs = screen.getByText(`Tax inputs — ${thisYear}`)
    const brackets = screen.getByText(`Bracket tables — ${thisYear}`)
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(totals.compareDocumentPosition(willIOwe) & following).toBeTruthy()
    expect(willIOwe.compareDocumentPosition(marginal) & following).toBeTruthy()
    expect(marginal.compareDocumentPosition(whatIf) & following).toBeTruthy()
    expect(whatIf.compareDocumentPosition(trend) & following).toBeTruthy()
    expect(trend.compareDocumentPosition(inputs) & following).toBeTruthy()
    expect(inputs.compareDocumentPosition(brackets) & following).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/pages/TaxesPage.test.tsx` → the new test FAILS (trend precedes Will-I-owe today).

- [ ] **Step 3: Create `CompositionPanel.tsx`** — the second `<section>` of today's SummaryPanel moved whole, with its state, feed, memos, drill and comments (props: `{ refreshKey?: number }`). Everything below is a verbatim relocation of SummaryPanel lines 71–172 and 299–363 except the doc comment:

```tsx
import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAllTaxSummaries } from '../../api/taxes'
import EChart from '../EChart'
import type { EChartEventParams } from '../EChart'
import type { TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
import { taxTrendCsv, trendOption, yearPieOption } from './taxChartOptions'
import InfoHint from '../InfoHint'
import './taxes.css'

/**
 * The all-years composition trend, drilling into a per-year jurisdiction pie on click
 * (SpendingPage's month pie). Split out of SummaryPanel (2026-08-31 audit) so the
 * year-scoped answer cards can sit contiguously and this card can close the answers half.
 *
 * The feed is this panel's own: it is all-years, so a year switch does not move it, and it
 * reloads only when the page says a save landed — `refreshKey`.
 */
export default function CompositionPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  /* state/effect/memos/handlers/JSX: moved verbatim from SummaryPanel — years,
     incompleteYears, error, seqRef, the ?year searchParams drill (setDetailYear keeps its
     replace-not-push comment), chartable/flaggedYears/trend/detailSummary/detailPie memos,
     handleTrendClick, and the whole second <section className="card"> return. */
}
```

- [ ] **Step 4: Slim `SummaryPanel.tsx`.** Remove the moved state/effect/memos/handlers and the second section; the component returns the Totals `<section>` alone (no more fragment). Drop the now-unused imports (`useSearchParams`, `useEffect`, `useRef`, `useState`, `ApiError`, `fetchAllTaxSummaries`, `EChartEventParams`, `taxTrendCsv`, `trendOption`, `yearPieOption`) and the `refreshKey` prop. Rewrite the doc comment: the engine's answer told two ways (tiles, waterfall) plus the by-jurisdiction table; name where the trend went.

- [ ] **Step 5: Reorder mounts in `TaxesPage.tsx`.** Import `CompositionPanel`; under `detail !== null` mount: SummaryPanel (drop `refreshKey`), WithholdingPanel (unchanged gate + key), MarginalPanel, WhatIfPanel (unchanged key/seeds), `<CompositionPanel refreshKey={trendRefresh} />`, InputsForm, BracketsEditor. Move the "deliberately NOT keyed — all-years feed" comment onto CompositionPanel; add the block rationale comment citing the 2026-08-31 audit.

- [ ] **Step 6: Fix the positional test helper.** `trendCategories()` reads `getAllByTestId('echart')[1]` ("the trend is the SECOND chart") — after the reorder the ladder chart is second. Re-scope it to the composition card and update its comment:

```tsx
// The trend chart is found by its own card, never by index: the marginal ladder also
// mounts a marker, and position moved with the 2026-08-31 reorder — position is not
// identity. The card's heading swaps to "Tax breakdown — YYYY" while drilled.
const trendCard = () =>
  (screen.getByText(/Tax composition and effective rate by year|Tax breakdown — /)
    .closest('.card') ?? (() => { throw new Error('no trend card') })()) as HTMLElement
const trendCategories = () =>
  within(trendCard()).getByTestId('echart').getAttribute('data-categories')
```

Audit every other `getAllByTestId('echart')[n]` / chart-click in the file and re-scope any that meant "the trend chart" or "the pie" through `trendCard()`; the waterfall stays the first chart on the page.

- [ ] **Step 7: Run to verify** — `npx vitest run src/pages/TaxesPage.test.tsx` → all green, including the drill/deep-link/refresh tests against CompositionPanel.

---

### Task 6: Comp — hoist the vest tiles to the page top (Subagent B)

**Files:**
- Modify: `src/components/comp/VestingSchedulePanel.tsx` (export `VestingTiles`; drop the in-card kpi-row), `src/pages/CompPage.tsx` (render the strip)
- Test: `src/pages/CompPage.test.tsx`

The pinned card order (focal history → TC chart → grants → schedule) is UNTOUCHED — the strip is a page-level kpi-row above the cards, the same register as NetWorth/Spending tiles.

- [ ] **Step 1: Write the failing test** (SCHEDULE is the existing populated fixture):

```tsx
  it('surfaces the vest tiles at the page top, above the focal history (2026-08-31 audit)', async () => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue(SCHEDULE)
    render(<CompPage />)
    const nextVest = await screen.findByText('Next vest')
    const focal = screen.getByText('Focal history')
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(nextVest.compareDocumentPosition(focal) & following).toBeTruthy()
  })
```

(Match the file's existing render wrapper — if the vesting describe wraps with ToastProvider, do the same.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/pages/CompPage.test.tsx` (tiles currently render inside the schedule card, below Focal history).

- [ ] **Step 3: Extract `VestingTiles`.** In `VestingSchedulePanel.tsx`, add a named export rendering exactly today's three StatTiles (moved verbatim — labels, values, deltas, hints, including the null-delta rule on `vested_this_year_income`):

```tsx
/**
 * The schedule's three headline tiles, hoisted to the page top (2026-08-31 audit: the
 * next-vest figures sat below the fold). Same payload, same figures, rendered once —
 * the panel below keeps the quote line, the calendar and the table.
 */
export function VestingTiles({ schedule }: { schedule: VestingScheduleOut }) {
  const { tiles, ticker } = schedule
  const quoteSource = ticker === null ? 'the latest employer quote' : `the latest ${ticker} quote`
  const nextVest = tiles.next_vest
  return (
    <div className="kpi-row">
      {/* ...the three StatTiles exactly as they read in today's panel... */}
    </div>
  )
}
```

Remove the `<div className="kpi-row">…</div>` from the panel's populated branch (everything else — quote line, chart, warnings, table — stays). Keep `quoteSource`/`nextVest` only where still used.

- [ ] **Step 4: Render the strip in `CompPage.tsx`** directly after the page-header div, before the events error banner:

```tsx
      {/* The schedule's headline tiles at the page top (2026-08-31 audit). The pinned card
          order below is untouched; with no grants the panel's empty state carries the
          message, so the strip renders nothing. Dimmed by the schedule feed's own flag,
          like the cards it summarizes. */}
      {schedule !== null && schedule.grants.length > 0 && (
        <div className={`loading-dim${scheduleBusy ? ' is-loading' : ''}`}>
          <VestingTiles schedule={schedule} />
        </div>
      )}
```

Import: `import VestingSchedulePanel, { VestingTiles } from '../components/comp/VestingSchedulePanel'`.

- [ ] **Step 5: Run to verify** — `npx vitest run src/pages/CompPage.test.tsx` → all green. Existing tile assertions (`tile('Next vest')` etc.) query globally, so they follow the tiles to the top; if any scopes into the schedule card, re-scope it to the page.

---

### Task 7: ESPP — $25k figure at the page top (Subagent C)

**Files:**
- Modify: `src/pages/EsppPage.tsx` (top strip from `modeler.totals`; import StatTile)
- Test: `src/pages/EsppPage.test.tsx`

- [ ] **Step 1: Write the failing test** (the `modelerResponse()` fixture answers `total_25k_value: '18917.13'`, `remaining_25k: '6082.87'`; check the fixture's `year` and use it):

```tsx
  it('surfaces the $25k figure at the page top, above the lots (2026-08-31 audit)', async () => {
    renderPage()
    const tile = await screen.findByText(/\$25k limit used — /)
    const lots = screen.getByRole('heading', { name: /Lots/ })
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(tile.compareDocumentPosition(lots) & following).toBeTruthy()
    // The modeler payload's own figures, verbatim — used and remaining.
    expect(screen.getByText('$18,917.13')).toBeTruthy()
    expect(screen.getByText('$6,082.87 left')).toBeTruthy()
  })
```

(If `$18,917.13` also renders inside the modeler card's gauge, scope the assertions with `within(...)` on the strip's `.kpi-row`.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/pages/EsppPage.test.tsx`.

- [ ] **Step 3: Render the strip** in `EsppPage.tsx` directly after the page-header div:

```tsx
      {/* The modeler's $25k figure at the page top (2026-08-31 audit: the gauge sat below
          the fold). The MODELER's chain — its year and knobs — so it can never disagree
          with the card below; absent until that feed answers, exactly like the card. */}
      {modeler !== null && (
        <div className={`loading-dim${modelerBusy ? ' is-loading' : ''}`}>
          <div className="kpi-row">
            <StatTile
              label={`$25k limit used — ${modeler.year}`}
              value={formatCurrency(modeler.totals.total_25k_value)}
              delta={`${formatCurrency(modeler.totals.remaining_25k)} left`}
              tone="neutral"
              hint="The Purchase modeler's chained total against the IRS §423 ceiling, at its current year and knobs — the gauge in that card draws the same figure long."
            />
          </div>
        </div>
      )}
```

Add `import StatTile from '../components/StatTile'` (formatCurrency is already imported). Nothing else changes — the gauge stays in the modeler card.

- [ ] **Step 4: Run to verify** — `npx vitest run src/pages/EsppPage.test.tsx` → all green (the section-order pin at ~line 652 is unaffected; the strip is above all three cards).

---

### Final verification (coordinator, after all tasks merge into the branch)

- [ ] `npm test` (full vitest suite) → green
- [ ] `npx tsc -b` → clean
- [ ] `npm run lint` → clean
- [ ] `npm run build` → succeeds
- [ ] Code review of the whole branch diff; fix findings; then merge `feat/section-reorders` → `main` locally (NO push).

**Self-review notes:** every audit item approved by the user maps to a task (Taxes→5, Credit cards→4, Spending→2, Settings→3, Comp→6, ESPP→7, nav→1); no TBDs; `VestingTiles`/`CompositionPanel` names are used consistently; Tasks 4/6/7 file sets are disjoint from each other and from 1/2/3/5.
