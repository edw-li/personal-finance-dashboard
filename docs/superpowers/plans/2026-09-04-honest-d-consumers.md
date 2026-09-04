# Honest numbers — Lane D (consumers) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every read-only surface tell the truth lane A's wire now carries — the Overview footer names each hand-entered feed and the months it is still waiting for, the attention strip turns a missing or empty spending month into a one-click wizard job, the YTD card leads with the total savings rate and names every figure's window, the Spending savings chart draws total-and-cash with the words "Total (incl. payroll)" / "Cash", the yearly rollup carries both rates plus living / tax / transfer with a badge on every non-living category, the Projection Assumptions card prints the window its derived figures came from, and the money-flow sankey draws the take-home nobody has entered yet as a muted dashed node instead of hiding it inside retained equity.

**Architecture:** Every rule is a pure module first, a mount second — the `attention.ts` / `overviewChartOptions.ts` posture: no React and no fetching in the rule, `todayIso` injected, the page hands the module the snapshot it already holds. Two pure modules carry the new words (`overview/freshness.ts`, a widened `overview/ytd.ts`), with additive edits to `attention.ts`, `spendingChartOptions.ts`, `moneyFlowOptions.ts` and `projection/ScenarioPanel.tsx`. `OverviewPage` grows a twelfth snapshot client (`/coverage`) so the footer, the strip and the YTD card stand on the same instant as the tiles — a coverage line that disagreed with the spending tile beside it would be exactly the dishonesty this program removes. New wire fields are mirrored in `src/types/api.ts` as OPTIONAL, the `niit` / `bands` / `retirements` precedent: the live server always sends them, and a fixture written before this program keeps compiling — every reader degrades to today's behaviour instead of crashing. Chart work stays inside the grammar (`ChartCard`, tokens not literal colours, `legendFor`, `axisTooltip`, `SANKEY_MARKS`, an `ariaLabel` per mount) and every new or reshaped option gets a `src/charts/fixtures/*.fixture.ts` named in `conformance.test.ts`'s two-way `ROSTER`.

**Tech Stack:** React 19, TypeScript 5.9, react-router 7, vitest 3 + @testing-library/react (jsdom; `EChart` is mocked in page tests — house law), ECharts 6.1 through `src/charts/echarts.ts`.

**Worktree / commands:** Branch `honest-d` from `main` AFTER lane A merges (lane D reads A's wire): `git worktree add .worktrees/honest-d -b honest-d main`, then once inside it link the modules with `cmd //c "mklink /J node_modules ..\..\node_modules"`. All commands run from the worktree root: `npx vitest run <files>`, `npx tsc -b`, `npx eslint <files>`. LF endings, one commit per task, local commits only — **never push**.

**Read before starting:** `docs/superpowers/specs/2026-09-04-honest-numbers-design.md` (§1 UI, §2 Consumers, §3 Consumers, §7, §8 lane D), `src/charts/grammar.ts`, `src/charts/legend.ts`, `src/charts/tooltip.ts`, `src/charts/markLine.ts`, `src/charts/sankey.ts`, `src/charts/conformance.ts`, `src/charts/fixtures/_types.ts`, `src/components/ChartCard.tsx`.

**Done when:** `npx tsc -b`, `npx eslint .` and `npx vitest run` are green from the worktree root, and `npx vitest run src/charts/conformance.test.ts` lists passing cases for `spendingSavings`, `spendingSavingsCash`, `moneyFlow` and `moneyFlowPending`.

---

## Coordination with the other lanes

- **Lane A owns the server.** This lane only mirrors A's wire names. If a name here disagrees with what `/coverage`, `/spending/matrix`, `/spending/yearly`, `/projection` or `/overview/money-flow` actually return, **A's name wins** — fix the mirror, not the server.
- **Lane C also edits `src/types/api.ts`** (wizard side: `SpendingMonthUpsert.confirm_zero`, `MonthUpsertResult.derived`). This lane touches only the READ interfaces — `CoverageOut`, `CategoryOut`, `SpendingMatrix`, `YearRollup`, `ProjectionOut`, `MoneyFlowOut` — so the merge is additive. Do not reorder or reformat unrelated interfaces; a whitespace-only edit turns an additive merge into a conflict.
- **Lane E owns `CategoryCreate.kind` / `CategoryUpdate.kind`** (the Settings picker writes them). This lane adds only `CategoryOut.kind` and the shared `CategoryKind` union, because the rollup badge reads it. If E landed first and the union already exists, reuse it rather than declaring a second one.
- **`MonthlyUpdatePage.tsx` and its test belong to lane C.** Task 5 pins ribbon behaviour through `ScopeBar`, never through the wizard page.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types/api.ts` (modify) | Mirror lane A's wire: `CoverageOut.spending_empty` / `.spending_missing` / `.net_pay_missing` / `.latest`; `CategoryKind` + `CategoryOut.kind`; `SpendingMatrix.living_total` / `.tax_total` / `.transfer_total` / `.cash_savings` / `.payroll_savings` / `.total_savings` / `.total_savings_rate`; `YearRollup` with the same names as scalars + `.months_matched`; `DerivedWindowOut` + `ProjectionOut.derived_window`; `MoneyFlowOut.take_home_pending` / `.take_home_months_entered` |
| `src/components/overview/freshness.ts` (create) | Pure: `freshnessClauses(coverage)` — one clause per feed with its `lagging` flag; `spendingGaps(coverage)` — "Aug 2026 missing, Sep 2026 empty" |
| `src/components/overview/freshness.test.ts` (create) | Pins for the clause words, the parenthetical, the amber rule, the older-backend fallback |
| `src/components/overview/attention.ts` (modify) | `AttentionInputs.coverage`; two new items — `spending-missing`, `spending-empty` — linking to `/update?month=<m>&step=spending` |
| `src/components/overview/attention.test.ts` (modify) | Baseline gains an all-clear `coverage`; pins for both new items, their order and their links |
| `src/components/overview/ytd.ts` (modify) | `ytdStats(ts, yearly, dividends, coverage, todayIso)` — living spend, both saved figures, both rates, a named window per figure; `windowWords(window)` |
| `src/components/overview/ytd.test.ts` (modify) | Window naming, the matched-months guard, the older-backend fallback to `total` / `savings_rate` |
| `src/pages/OverviewPage.tsx` (modify) | Twelfth snapshot client (`fetchCoverage`); footer rebuilt from `freshnessClauses`; strip and YTD card fed the coverage; YTD card markup naming four windows |
| `src/pages/OverviewPage.test.tsx` (modify) | `Payload.coverage` armed by `serve()`; footer wording + amber; the two coverage attention items; the rewritten YTD card |
| `src/components/shell/ScopeBar.test.tsx` (modify) | Pins that the ribbon's spending dot follows `coverage.spending` only — an empty or missing month stays hollow |
| `src/components/spending/spendingChartOptions.ts` (modify) | `TOTAL_RATE_SERIES` / `CASH_RATE_SERIES`; `savingsRateOption` draws the total line with a muted cash line and a legend; `savingsRateCsv` carries both rates |
| `src/components/spending/spendingChartOptions.test.ts` (modify) | Two-line pins, the legend words, the degraded single-line branch, the CSV |
| `src/charts/fixtures/spendingBars.fixture.ts` (modify) | `MATRIX` gains the savings arrays (shared by the savings fixtures) |
| `src/charts/fixtures/spendingSavings.fixture.ts` (modify) | The two-line branch |
| `src/charts/fixtures/spendingSavingsCash.fixture.ts` (create) | The cash-only branch (older backend): no legend, `noLegend` grid |
| `src/charts/fixtures/moneyFlow.fixture.ts` (modify) | Fully-entered year: pending zero, node absent |
| `src/charts/fixtures/moneyFlowPending.fixture.ts` (create) | The pending-take-home branch of `moneyFlowOption` |
| `src/charts/conformance.test.ts` (modify) | `ROSTER` gains `spendingSavingsCash` and `moneyFlowPending` (the two-way pin) |
| `src/pages/SpendingPage.tsx` (modify) | Savings card title/hint/footer reworded; rollup rows for living / tax / transfers / both rates / months matched; kind badges on category rows; the heatmap card's non-living legend line |
| `src/pages/SpendingPage.test.tsx` (modify) | Legend-word sample, the rollup rows, the badges, the heatmap legend line |
| `src/charts/sankey.ts` (modify) | `SankeyNode.itemStyle` widened for a dashed node border |
| `src/components/overview/moneyFlowOptions.ts` (modify) | The muted dashed "Take-home not yet entered (N months)" node from gross, with its estimate-rule tooltip |
| `src/components/overview/moneyFlowOptions.test.ts` (modify) | Node, link, colour, dash, tooltip sentence, and the absent case |
| `src/components/overview/MoneyFlowCard.tsx` (modify) | Hint names the pending node |
| `src/components/projection/ScenarioPanel.tsx` (modify) | The derived window printed under the contribution and annual-spend knobs |
| `src/components/projection/ScenarioPanel.test.tsx` (modify) | The window sentence, and its absence on an older backend |

---

### Task 1: `freshness.ts` — the footer's sentence, and the `CoverageOut` mirror

**Files:**
- Create: `src/components/overview/freshness.ts`
- Create: `src/components/overview/freshness.test.ts`
- Modify: `src/types/api.ts` (the `CoverageOut` interface, around line 105)

Spec §3: "Balances through Sep 2026 · Spending through Jul 2026 (Aug missing, Sep empty) · Net pay through Jul 2026", amber when spending or net pay lags balances by ≥ 1 month.

- [ ] **Step 1: Write the failing test**

Create `src/components/overview/freshness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CoverageOut } from '../../types/api'
import { freshnessClauses, spendingGaps } from './freshness'

// Production's own shape on 2026-09-04 (spec §0): balances through September, spending
// entered through July, August never entered, September saved as nineteen rows of $0.00.
function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
    spending: ['2026-06-01', '2026-07-01'],
    net_pay: ['2026-06-01', '2026-07-01'],
    spending_empty: ['2026-09-01'],
    spending_missing: ['2026-08-01'],
    net_pay_missing: ['2026-08-01', '2026-09-01'],
    latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    ...over,
  }
}

const texts = (coverage: CoverageOut): string[] =>
  freshnessClauses(coverage).map((clause) => clause.text)
const amber = (coverage: CoverageOut): string[] =>
  freshnessClauses(coverage)
    .filter((clause) => clause.lagging)
    .map((clause) => clause.key)

describe('freshnessClauses — the footer sentence', () => {
  it('names each feed month and what the window is still waiting for', () => {
    expect(texts(coverageOut())).toEqual([
      'Balances through Sep 2026',
      'Spending through Jul 2026 (Aug missing, Sep empty)',
      'Net pay through Jul 2026',
    ])
  })

  it('ambers exactly the feeds a month or more behind the balances', () => {
    expect(amber(coverageOut())).toEqual(['spending', 'net_pay'])
  })

  it('stays quiet when every feed stands on the same month', () => {
    const level = coverageOut({
      spending: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
      net_pay: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
      spending_empty: [],
      spending_missing: [],
      net_pay_missing: [],
      latest: { balances: '2026-09-01', spending: '2026-09-01', net_pay: '2026-09-01' },
    })
    expect(texts(level)).toEqual([
      'Balances through Sep 2026',
      'Spending through Sep 2026',
      'Net pay through Sep 2026',
    ])
    expect(amber(level)).toEqual([])
  })

  it('says a feed never started rather than calling a fresh database late', () => {
    const fresh = coverageOut({
      balances: [],
      spending: [],
      net_pay: [],
      spending_empty: [],
      spending_missing: [],
      net_pay_missing: [],
      latest: { balances: null, spending: null, net_pay: null },
    })
    expect(texts(fresh)).toEqual([
      'Balances — no months',
      'Spending — no months',
      'Net pay — no months',
    ])
    expect(amber(fresh)).toEqual([])
  })

  it('reads the ascending arrays when the server is older than `latest`', () => {
    const older: CoverageOut = {
      balances: ['2026-08-01', '2026-09-01'],
      spending: ['2026-07-01'],
      net_pay: ['2026-07-01'],
    }
    expect(texts(older)).toEqual([
      'Balances through Sep 2026',
      'Spending through Jul 2026',
      'Net pay through Jul 2026',
    ])
    expect(amber(older)).toEqual(['spending', 'net_pay'])
  })
})

describe('spendingGaps — only what comes AFTER the last entered month', () => {
  it('labels missing and empty months in calendar order', () => {
    expect(spendingGaps(coverageOut())).toBe('Aug missing, Sep empty')
  })

  it('ignores an older hole — that is the strip and the Health card job', () => {
    expect(spendingGaps(coverageOut({ spending_missing: ['2026-03-01', '2026-08-01'] }))).toBe(
      'Aug missing, Sep empty',
    )
  })

  it('carries the year on a gap outside the clause own year', () => {
    const turn = coverageOut({
      balances: ['2025-12-01', '2026-01-01'],
      spending: ['2025-12-01'],
      spending_empty: [],
      spending_missing: ['2026-01-01'],
      latest: { balances: '2026-01-01', spending: '2025-12-01', net_pay: '2025-12-01' },
    })
    expect(spendingGaps(turn)).toBe('Jan 2026 missing')
  })

  it('folds past three named months', () => {
    const many = coverageOut({
      spending: ['2026-01-01'],
      spending_missing: ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'],
      spending_empty: ['2026-09-01'],
      latest: { balances: '2026-09-01', spending: '2026-01-01', net_pay: '2026-07-01' },
    })
    expect(spendingGaps(many)).toBe('Feb missing, Mar missing, Apr missing, +2 more')
  })

  it('is empty on a fully entered window', () => {
    expect(spendingGaps(coverageOut({ spending_empty: [], spending_missing: [] }))).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/components/overview/freshness.test.ts`
Expected: FAIL — `Failed to resolve import "./freshness"`, and TS errors on `spending_empty` / `spending_missing` / `net_pay_missing` / `latest` not existing on `CoverageOut`.

- [ ] **Step 3: Mirror lane A's `CoverageOut`**

In `src/types/api.ts`, replace the existing `CoverageOut` block:

```ts
/** Which months each hand-entered feed covers — ascending first-of-month ISO dates
 *  (GET /coverage, 2026-09-03 shell spec §7, extended by the 2026-09-04 honest-numbers
 *  spec §3). `spending` now lists ENTERED months only — a month with at least one non-zero
 *  amount OR a net-pay row; a month saved as all $0.00 with no net pay is `spending_empty`,
 *  and a month inside the balances window with no rows at all is `spending_missing`. The
 *  four added fields are OPTIONAL for the reason `MoneyFlowTaxes.niit` documents: the live
 *  server always sends them, and a fixture written before this program keeps compiling. */
export interface CoverageOut {
  balances: string[]
  spending: string[]
  net_pay: string[]
  /** Inside the window, saved with every category $0.00 and no take-home. */
  spending_empty?: string[]
  /** Inside the window, no spending rows at all. */
  spending_missing?: string[]
  /** Inside the window, no monthly-cashflow row. */
  net_pay_missing?: string[]
  /** The newest month of each feed; `null` where that feed has none. */
  latest?: {
    balances: string | null
    spending: string | null
    net_pay: string | null
  }
}
```

- [ ] **Step 4: Write the module**

Create `src/components/overview/freshness.ts`:

```ts
// The freshness sentence the Overview footer prints (2026-09-04 honest-numbers spec §3) —
// pure, no React, no fetching (attention.ts's posture). One clause per hand-entered feed,
// each standing on the month it actually has, and the spending clause naming what the
// window is still waiting for. Balances are the ritual's anchor (spec §3), so "late" is
// measured against them and nothing else.
import type { CoverageOut } from '../../types/api'
import { formatMonth } from '../../utils/format'

export type FreshnessKey = 'balances' | 'spending' | 'net_pay'

export interface FreshnessClause {
  key: FreshnessKey
  text: string
  /** Amber: this feed is at least one whole month behind the balances. */
  lagging: boolean
}

/** How many gap months the parenthetical names before it folds into "+N more". */
export const GAP_NAMES = 3

/** A month as a comparable integer. Never `new Date(iso)` — formatMonth's rule: UTC
 *  parsing shifts a first-of-month a day back in negative offsets. */
function monthIndex(iso: string): number {
  const [year, month] = iso.split('-').map(Number)
  return year * 12 + month
}

/** The newest month of a feed: the wire's own `latest` when the server sends it, else the
 *  tail of the ascending array — the same figure by construction, so a backend older than
 *  this program still gets a footer instead of a blank. */
function latestOf(coverage: CoverageOut, key: FreshnessKey): string | null {
  return coverage.latest?.[key] ?? coverage[key][coverage[key].length - 1] ?? null
}

/** "Aug" inside the clause's own year, "Aug 2025" outside it: the clause already names the
 *  year once, and repeating it on every gap turns a footer into a paragraph. */
function gapName(month: string, referenceYear: string | null): string {
  return month.slice(0, 4) === referenceYear ? formatMonth(month).slice(0, 3) : formatMonth(month)
}

/**
 * The spending clause's parenthetical: every month AFTER the latest entered one, labelled
 * `missing` (no rows at all) or `empty` (saved as all $0.00), in calendar order. The TAIL
 * only — an older hole is a repair job the attention strip and the Health card own, while
 * this line answers "where does this page stand", a question about the end of the window.
 */
export function spendingGaps(coverage: CoverageOut): string {
  const entered = latestOf(coverage, 'spending')
  const floor = entered === null ? 0 : monthIndex(entered)
  const reference = (entered ?? latestOf(coverage, 'balances'))?.slice(0, 4) ?? null
  const gaps = [
    ...(coverage.spending_missing ?? []).map((month) => ({ month, word: 'missing' })),
    ...(coverage.spending_empty ?? []).map((month) => ({ month, word: 'empty' })),
  ]
    .filter((gap) => monthIndex(gap.month) > floor)
    .sort((a, b) => a.month.localeCompare(b.month))
  if (gaps.length === 0) return ''
  const named = gaps
    .slice(0, GAP_NAMES)
    .map((gap) => `${gapName(gap.month, reference)} ${gap.word}`)
  const more = gaps.length - named.length
  return more > 0 ? `${named.join(', ')}, +${more} more` : named.join(', ')
}

/** The three clauses, in reading order. The page prints them with dot separators and wears
 *  the amber class on the ones that lag. */
export function freshnessClauses(coverage: CoverageOut): FreshnessClause[] {
  const balances = latestOf(coverage, 'balances')
  const anchor = balances === null ? null : monthIndex(balances)
  // A feed with no months at all has never started, which its own clause says out loud;
  // amber is for a feed that fell BEHIND a running ritual, never for a fresh database.
  const lags = (month: string | null): boolean =>
    anchor !== null && month !== null && anchor - monthIndex(month) >= 1
  const spending = latestOf(coverage, 'spending')
  const netPay = latestOf(coverage, 'net_pay')
  const gaps = spendingGaps(coverage)
  return [
    {
      key: 'balances',
      text:
        balances === null ? 'Balances — no months' : `Balances through ${formatMonth(balances)}`,
      // The anchor cannot lag itself.
      lagging: false,
    },
    {
      key: 'spending',
      text:
        spending === null
          ? 'Spending — no months'
          : `Spending through ${formatMonth(spending)}${gaps === '' ? '' : ` (${gaps})`}`,
      lagging: lags(spending),
    },
    {
      key: 'net_pay',
      text: netPay === null ? 'Net pay — no months' : `Net pay through ${formatMonth(netPay)}`,
      lagging: lags(netPay),
    },
  ]
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/components/overview/freshness.test.ts`
Expected: PASS — 10 tests, 0 failed.

- [ ] **Step 6: Prove the tests fail on a regression (mutation check)**

Change `anchor - monthIndex(month) >= 1` to `>= 2` in `freshness.ts` and run
`npx vitest run src/components/overview/freshness.test.ts`.
Expected: FAIL — "ambers exactly the feeds a month or more behind the balances" expects `['spending','net_pay']`, receives `[]`. Then change `.filter((gap) => monthIndex(gap.month) > floor)` to `>=` and run again.
Expected: FAIL — "labels missing and empty months in calendar order". Revert both edits and re-run.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx tsc -b && npx eslint src/components/overview/freshness.ts src/components/overview/freshness.test.ts src/types/api.ts
git add src/components/overview/freshness.ts src/components/overview/freshness.test.ts src/types/api.ts
git commit -m "feat(overview): the freshness sentence names every feed's month and the window's gaps (honest-numbers spec §3)"
```

---

### Task 2: two coverage items in the attention strip

**Files:**
- Modify: `src/components/overview/attention.ts`
- Modify: `src/components/overview/attention.test.ts`

Spec §3: "August 2026 spending was never entered" (link to the wizard's spending step for that month) and "September 2026 was saved with no spending". The existing balances nudge is unchanged.

- [ ] **Step 1: Write the failing test**

In `src/components/overview/attention.test.ts`, add `CoverageOut` to the type import list at the top, add the builder below `systemOut`, give the baseline a coverage, and append the new describe block.

Add to the import list (`import type { … } from '../../types/api'`): `CoverageOut,`.

Add after `systemOut`:

```ts
// The all-clear coverage: every month of the window entered on both feeds, nothing empty
// and nothing missing — the quiet default the other suites rely on.
function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: ['2026-06-01', '2026-07-01', '2026-08-01'],
    spending: ['2026-06-01', '2026-07-01', '2026-08-01'],
    net_pay: ['2026-06-01', '2026-07-01', '2026-08-01'],
    spending_empty: [],
    spending_missing: [],
    net_pay_missing: [],
    latest: { balances: '2026-08-01', spending: '2026-08-01', net_pay: '2026-08-01' },
    ...over,
  }
}
```

In `inputs()`, add the field so the baseline stays all-clear:

```ts
function inputs(over: Partial<AttentionInputs> = {}): AttentionInputs {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    holdings: holdingsOut(),
    lots: lotsOut([]),
    taxYears: [taxYear(2026)],
    system: systemOut(),
    coverage: coverageOut(),
    ...over,
  }
}
```

Append the new describe block at the end of the file:

```ts
describe('attentionItems — coverage honesty (honest-numbers spec §3)', () => {
  it('turns a month the window never got into a wizard job for that month', () => {
    const [item] = attentionItems(
      inputs({ coverage: coverageOut({ spending_missing: ['2026-07-01'] }) }),
      TODAY,
    )
    expect(item.key).toBe('spending-missing')
    expect(item.text).toBe('Jul 2026 spending was never entered')
    // Straight to the step that fixes it — the wizard reads both params.
    expect(item.to).toBe('/update?month=2026-07-01&step=spending')
  })

  it('names a month somebody saved with nothing in it', () => {
    const [item] = attentionItems(
      inputs({ coverage: coverageOut({ spending_empty: ['2026-08-01'] }) }),
      TODAY,
    )
    expect(item.key).toBe('spending-empty')
    expect(item.text).toBe('Aug 2026 was saved with no spending')
    expect(item.to).toBe('/update?month=2026-08-01&step=spending')
  })

  it('leads with the newest month of each class and counts the rest — one line per class', () => {
    const items = attentionItems(
      inputs({
        coverage: coverageOut({
          spending_missing: ['2026-04-01', '2026-05-01', '2026-07-01'],
          spending_empty: ['2026-06-01', '2026-08-01'],
        }),
      }),
      TODAY,
    )
    expect(items.map((i) => i.text)).toEqual([
      'Jul 2026 spending was never entered (+2 earlier months)',
      'Aug 2026 was saved with no spending (+1 earlier month)',
    ])
    expect(items.map((i) => i.to)).toEqual([
      '/update?month=2026-07-01&step=spending',
      '/update?month=2026-08-01&step=spending',
    ])
  })

  it('says nothing on a backend older than the coverage extension', () => {
    const older: CoverageOut = {
      balances: ['2026-08-01'],
      spending: ['2026-08-01'],
      net_pay: ['2026-08-01'],
    }
    expect(keys(inputs({ coverage: older }))).toEqual([])
  })

  it('sits with the other data-entry nudges, ahead of the price items', () => {
    const data = inputs({
      months: ['2026-06-01', '2026-07-01'], // Aug's update is late — the existing nudge
      coverage: coverageOut({ spending_missing: ['2026-07-01'] }),
      holdings: holdingsOut({ as_of: null }),
    })
    expect(keys(data)).toEqual(['update-due', 'spending-missing', 'prices-never'])
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/components/overview/attention.test.ts`
Expected: FAIL — TS error `Object literal may only specify known properties, and 'coverage' does not exist in type 'AttentionInputs'`, and the five new cases receive `[]`.

- [ ] **Step 3: Write the implementation**

In `src/components/overview/attention.ts`, add `CoverageOut` to the type import:

```ts
import type {
  CoverageOut,
  EsppLotsResponse,
  HoldingsResponse,
  SystemStatus,
  TaxYearOut,
} from '../../types/api'
```

Add the input field:

```ts
export interface AttentionInputs {
  /** Net-worth coverage (the wizard writes it) — the canonical "which months exist". */
  months: string[]
  holdings: HoldingsResponse
  lots: EsppLotsResponse
  taxYears: TaxYearOut[]
  /** GET /system/status — the last refresh outcome, backup marker and environment. */
  system: SystemStatus
  /** GET /coverage — which months each hand-entered feed actually has (spec §3). */
  coverage: CoverageOut
}
```

Insert this block immediately after the monthly-update `if (data.months.length > 0) { … }` block and before `const { as_of, totals, holdings } = data.holdings`:

```ts
  // Coverage honesty (spec §3). Two conditions the balances nudge above cannot see: a month
  // inside the window that spending never got, and a month somebody saved with nothing in
  // it. Both are the same repair — open that month's spending step — so both link straight
  // there. ONE line per class, naming the newest month (the one still in living memory) and
  // counting the rest, so a long backlog never turns the strip into a list.
  const wizardStep = (month: string) => `/update?month=${month}&step=spending`
  const older = (count: number) =>
    count > 0 ? ` (+${count} earlier ${plural(count, 'month', 'months')})` : ''

  const missing = [...(data.coverage.spending_missing ?? [])].sort()
  if (missing.length > 0) {
    const newest = missing[missing.length - 1]
    items.push({
      key: 'spending-missing',
      text: `${formatMonth(newest)} spending was never entered${older(missing.length - 1)}`,
      to: wizardStep(newest),
    })
  }

  const empty = [...(data.coverage.spending_empty ?? [])].sort()
  if (empty.length > 0) {
    const newest = empty[empty.length - 1]
    items.push({
      key: 'spending-empty',
      text: `${formatMonth(newest)} was saved with no spending${older(empty.length - 1)}`,
      to: wizardStep(newest),
    })
  }
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/components/overview/attention.test.ts`
Expected: PASS — every existing case still green (the baseline's coverage is all-clear) plus the five new ones.

- [ ] **Step 5: Prove the tests fail on a regression (mutation check)**

Change `const newest = missing[missing.length - 1]` to `const newest = missing[0]` and run
`npx vitest run src/components/overview/attention.test.ts`.
Expected: FAIL — "leads with the newest month of each class" receives `'Apr 2026 spending was never entered (+2 earlier months)'`. Revert and re-run.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx tsc -b && npx eslint src/components/overview/attention.ts src/components/overview/attention.test.ts
git add src/components/overview/attention.ts src/components/overview/attention.test.ts
git commit -m "feat(overview): a missing or empty spending month is a strip item linking to that month's wizard step (spec §3)"
```

---

### Task 3: `ytd.ts` — living spend, both savings figures, and a window on every one

**Files:**
- Modify: `src/types/api.ts` (the `YearRollup` interface, around line 194)
- Modify: `src/components/overview/ytd.ts`
- Modify: `src/components/overview/ytd.test.ts`

Spec §3: "Overview YTD card: every figure names its window — 'Net worth since Dec 2025 (through Sep)', 'Spend Jan–Jul', 'Saved Jan–Jul (total / cash)' — and rates use `YearRollup.months_matched`."

- [ ] **Step 1: Mirror lane A's `YearRollup`**

In `src/types/api.ts`, replace the `YearRollup` interface:

```ts
export interface YearRollup {
  year: number
  by_category: { category_id: number; total: string }[]
  total: string
  net_pay_total: string | null
  /** The CASH rate — (net pay − living spend − tax paid) ÷ net pay over the matched months
   *  (2026-09-04 honest-numbers spec §2). The name is unchanged, and so is the arithmetic
   *  wherever every category is living. */
  savings_rate: string | null
  // The honest-numbers additions (spec §2), all over MATCHED months. Optional for the
  // reason `MoneyFlowTaxes.niit` documents: the live server always sends them.
  living_total?: string
  tax_total?: string
  transfer_total?: string
  cash_savings?: string | null
  payroll_savings?: string | null
  total_savings?: string | null
  total_savings_rate?: string | null
  /** Months with BOTH entered spending and a net-pay row — the window every figure above
   *  was computed over. */
  months_matched?: number
}
```

- [ ] **Step 2: Write the failing test**

In `src/components/overview/ytd.test.ts`: add `CoverageOut` to the type import
(`import type { CoverageOut, DividendOut, SpendingYearly } from '../../types/api'`), replace
the `rollup` builder, add a `coverageOut` builder, then thread coverage through every call.

Replace `rollup`:

```ts
function rollup(year: number): SpendingYearly['years'][number] {
  return {
    year,
    by_category: [],
    total: '32000.00',
    net_pay_total: '90000.00',
    savings_rate: '0.644444',
    living_total: '27000.00',
    tax_total: '4000.00',
    transfer_total: '1000.00',
    cash_savings: '58000.00',
    payroll_savings: '12000.00',
    total_savings: '70000.00',
    total_savings_rate: '0.686274',
    months_matched: 7,
  }
}

// Production's 2026 shape: Jan–Jul entered on both feeds, August never entered, September
// saved empty — the windows the card has to name.
const JAN_TO_JUL = [
  '2026-01-01', '2026-02-01', '2026-03-01',
  '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01',
]

function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: [...JAN_TO_JUL, '2026-08-01', '2026-09-01'],
    spending: [...JAN_TO_JUL],
    net_pay: [...JAN_TO_JUL],
    spending_empty: ['2026-09-01'],
    spending_missing: ['2026-08-01'],
    net_pay_missing: ['2026-08-01', '2026-09-01'],
    latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    ...over,
  }
}
```

Thread the new argument through the twelve existing calls (coverage is the 4th positional
argument, `todayIso` stays last):

```bash
sed -i 's/, TODAY)/, coverageOut(), TODAY)/g' src/components/overview/ytd.test.ts
sed -i 's/^      TODAY,$/      coverageOut(),\n      TODAY,/' src/components/overview/ytd.test.ts
```

Replace the two rollup cases in `describe('ytdStats — the server rollup and the dividend log')`:

```ts
  it('hands the current year rollup through verbatim — living spend, not the raw total', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2025), rollup(2026)]), [], coverageOut(), TODAY)
    expect(stats.spend).toBe('27000.00')
    expect(stats.netPay).toBe('90000.00')
    expect(stats.cashRate).toBe('0.644444')
  })

  it('answers nulls when the current year has no rollup row', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2025)]), [], coverageOut(), TODAY)
    expect(stats.spend).toBeNull()
    expect(stats.netPay).toBeNull()
    expect(stats.cashRate).toBeNull()
    expect(stats.totalRate).toBeNull()
  })
```

Import `windowWords` (`import { windowWords, ytdStats } from './ytd'`) and append:

```ts
describe('ytdStats — every figure names its window (spec §3)', () => {
  it('names the spend, net-pay and saved windows from coverage, and the delta both ends', () => {
    const stats = ytdStats(
      ts(['2025-12-01', '2026-09-01'], [100, 130]),
      yearly([rollup(2026)]),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.spendWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.netPayWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.savedWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
    expect(stats.anchorMonth).toBe('2025-12-01')
    expect(stats.throughMonth).toBe('2026-09-01')
  })

  it('takes months_matched from the server, never from its own intersection', () => {
    // Six on the wire against seven overlapping months here: the server ran the arithmetic,
    // so its count is the one the card prints; coverage only names the edges.
    const stats = ytdStats(
      ts([], []),
      yearly([{ ...rollup(2026), months_matched: 6 }]),
      [],
      coverageOut(),
      TODAY,
    )
    expect(stats.savedWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 6 })
  })

  it('reads living spend and both savings figures from the rollup', () => {
    const stats = ytdStats(ts([], []), yearly([rollup(2026)]), [], coverageOut(), TODAY)
    expect(stats.spend).toBe('27000.00') // living — NOT the 32000.00 that includes tax
    expect(stats.totalSaved).toBe('70000.00')
    expect(stats.cashSaved).toBe('58000.00')
    expect(stats.totalRate).toBe('0.686274')
    expect(stats.cashRate).toBe('0.644444')
  })

  it('falls back to the plain total on a backend older than the category kinds', () => {
    const bare = {
      year: 2026,
      by_category: [],
      total: '32000.00',
      net_pay_total: '90000.00',
      savings_rate: '0.644444',
    }
    const stats = ytdStats(ts([], []), yearly([bare]), [], coverageOut(), TODAY)
    expect(stats.spend).toBe('32000.00')
    expect(stats.cashRate).toBe('0.644444')
    expect(stats.totalRate).toBeNull()
    expect(stats.totalSaved).toBeNull()
    // The window still comes from coverage; the count falls back to the intersection.
    expect(stats.savedWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
  })

  it('has no savings figure at all in a year nothing matched', () => {
    const stats = ytdStats(
      ts([], []),
      yearly([{ ...rollup(2026), months_matched: 0 }]),
      [],
      coverageOut({ net_pay: [], latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: null } }),
      TODAY,
    )
    expect(stats.totalSaved).toBeNull()
    expect(stats.cashSaved).toBeNull()
    expect(stats.totalRate).toBeNull()
    expect(stats.cashRate).toBeNull()
    expect(stats.savedWindow).toBeNull()
    expect(stats.netPayWindow).toBeNull()
    // Spend still has a window: the months were entered, they just had no paycheck beside them.
    expect(stats.spendWindow).toEqual({ from: '2026-01-01', to: '2026-07-01', months: 7 })
  })
})

describe('windowWords', () => {
  it('shortens a same-year span and spells a crossing one', () => {
    expect(windowWords({ from: '2026-01-01', to: '2026-07-01', months: 7 })).toBe('Jan–Jul')
    expect(windowWords({ from: '2026-03-01', to: '2026-03-01', months: 1 })).toBe('Mar')
    expect(windowWords({ from: '2025-08-01', to: '2026-07-01', months: 12 })).toBe('Aug 2025–Jul 2026')
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run src/components/overview/ytd.test.ts`
Expected: FAIL — `Expected 4 arguments, but got 5`, plus `Property 'windowWords' does not exist`, `Property 'spendWindow' does not exist on type 'YtdStats'`.

- [ ] **Step 4: Rewrite the module**

Replace the whole of `src/components/overview/ytd.ts`:

```ts
// Pure year-to-date math for the overview card — no React, no fetching (attention.ts's
// posture; `todayIso` injectable for tests). The spending figures are the SERVER's own
// yearly rollup, verbatim; only the two aggregates no endpoint computes — the net-worth
// delta over snapshots and the year's dividend sum — are display-only client floats
// (spendStats' sanctioned class). Every figure also carries the WINDOW it was computed
// over (2026-09-04 honest-numbers spec §3): a savings rate over seven matched months
// beside a net-worth delta over nine is two different years under one heading.
import type {
  CoverageOut,
  DividendOut,
  NetWorthTimeseries,
  SpendingYearly,
} from '../../types/api'
import { formatMonth } from '../../utils/format'

/** A span of months the card names out loud. The edges say where it starts and ends;
 *  `months` is how many months actually carried data — on the saved window that is the
 *  server's own `months_matched`. */
export interface YtdWindow {
  from: string
  to: string
  months: number
}

export interface YtdStats {
  year: number
  /** Latest in-year net worth minus the anchor's; null without two points to span. */
  netWorthDelta: number | null
  netWorthPct: number | null
  /** ISO month the delta is measured FROM — the card says "since {anchor}" out loud. */
  anchorMonth: string | null
  /** ISO month the delta is measured TO — "(through Sep)". */
  throughMonth: string | null
  /** LIVING spend for the year (the server's string), falling back to the plain total on a
   *  backend older than the category kinds. */
  spend: string | null
  spendWindow: YtdWindow | null
  netPay: string | null
  netPayWindow: YtdWindow | null
  /** Cash + payroll deductions, and cash alone — both over the matched window. */
  totalSaved: string | null
  cashSaved: string | null
  totalRate: string | null
  cashRate: string | null
  savedWindow: YtdWindow | null
  /** Sum of this year's dividend payments; null while the log has no rows at all. */
  dividends: number | null
}

/** "Jan–Jul" inside one year, "Aug 2025–Jul 2026" across a boundary, "Mar" for a single
 *  month — the words the card prints beside a figure. */
export function windowWords(window: YtdWindow): string {
  const short = (iso: string) => formatMonth(iso).slice(0, 3)
  if (window.from.slice(0, 4) !== window.to.slice(0, 4)) {
    return `${formatMonth(window.from)}–${formatMonth(window.to)}`
  }
  return window.from === window.to
    ? short(window.from)
    : `${short(window.from)}–${short(window.to)}`
}

export function ytdStats(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  yearly: SpendingYearly,
  dividends: DividendOut[],
  coverage: CoverageOut,
  todayIso: string,
): YtdStats {
  const year = Number(todayIso.slice(0, 4))
  const jan = `${year}-01-01`
  const prefix = `${year}-`

  // Anchor = the LAST snapshot before January 1 (the classic YTD base — usually the
  // prior December, honestly some earlier month across a gap). A series that starts
  // mid-year anchors on its own first in-year month instead.
  let anchorIdx = -1
  let latestIdx = -1
  let firstInYearIdx = -1
  ts.months.forEach((month, i) => {
    if (month < jan) anchorIdx = i
    if (month.startsWith(prefix)) {
      latestIdx = i
      if (firstInYearIdx === -1) firstInYearIdx = i
    }
  })

  let netWorthDelta: number | null = null
  let netWorthPct: number | null = null
  let anchorMonth: string | null = null
  const baseIdx = anchorIdx >= 0 ? anchorIdx : firstInYearIdx
  if (latestIdx >= 0 && baseIdx >= 0 && baseIdx !== latestIdx) {
    const from = Number(ts.net_worth[baseIdx])
    const to = Number(ts.net_worth[latestIdx])
    netWorthDelta = to - from
    netWorthPct = from === 0 ? null : (to - from) / Math.abs(from)
    anchorMonth = ts.months[baseIdx]
  }

  const row = yearly.years.find((y) => y.year === year)
  const dividendSum = dividends.reduce(
    (acc, d) => (d.pay_date.startsWith(prefix) ? acc + Number(d.amount) : acc),
    0,
  )

  // The windows come from /coverage — the only feed that knows which months were ENTERED.
  // Sorted defensively: the wire is ascending, and a window drawn from an unsorted list
  // would name the wrong edges.
  const inYear = (months: string[] | undefined): string[] =>
    (months ?? []).filter((month) => month.startsWith(prefix)).sort()
  const enteredSpend = inYear(coverage.spending)
  const enteredPay = inYear(coverage.net_pay)
  const paySet = new Set(enteredPay)
  const matched = enteredSpend.filter((month) => paySet.has(month))
  const spanOf = (months: string[], count?: number): YtdWindow | null =>
    months.length === 0
      ? null
      : { from: months[0], to: months[months.length - 1], months: count ?? months.length }

  // `months_matched` is the SERVER's count for the figures below, so it wins wherever it
  // disagrees with this intersection — which months matched is the service's call (spec
  // §2), not the shell's. Coverage still names the edges.
  const matchedCount = row?.months_matched ?? matched.length
  const hasMatch = matchedCount > 0

  return {
    year,
    netWorthDelta,
    netWorthPct,
    anchorMonth,
    throughMonth: latestIdx >= 0 ? ts.months[latestIdx] : null,
    // living_total is the honest spend; `total` is what a pre-kinds backend sends, and it
    // is what this card printed until today — so the fallback changes nothing for it.
    spend: row?.living_total ?? row?.total ?? null,
    spendWindow: spanOf(enteredSpend),
    netPay: row?.net_pay_total ?? null,
    netPayWindow: spanOf(enteredPay),
    // A year with no matched month has NO savings figure — not a zero one.
    totalSaved: hasMatch ? (row?.total_savings ?? null) : null,
    cashSaved: hasMatch ? (row?.cash_savings ?? null) : null,
    totalRate: hasMatch ? (row?.total_savings_rate ?? null) : null,
    cashRate: hasMatch ? (row?.savings_rate ?? null) : null,
    savedWindow: spanOf(matched, matchedCount),
    // null = the log is unused (a dash), 0 = it is used and nothing paid this year yet.
    dividends: dividends.length === 0 ? null : dividendSum,
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/components/overview/ytd.test.ts`
Expected: PASS. (`npx tsc -b` still fails here — `OverviewPage.tsx` calls the old 4-argument
signature and reads `ytd.savingsRate`; Task 4 fixes it.)

- [ ] **Step 6: Prove the tests fail on a regression (mutation check)**

Change `spend: row?.living_total ?? row?.total ?? null` to `spend: row?.total ?? null` and run
`npx vitest run src/components/overview/ytd.test.ts`.
Expected: FAIL — "reads living spend and both savings figures" receives `'32000.00'`. Then
change `const matchedCount = row?.months_matched ?? matched.length` to `matched.length` and run again.
Expected: FAIL — "takes months_matched from the server" receives `months: 7`. Revert both and re-run.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx eslint src/components/overview/ytd.ts src/components/overview/ytd.test.ts src/types/api.ts
git add src/components/overview/ytd.ts src/components/overview/ytd.test.ts src/types/api.ts
git commit -m "feat(overview): YTD reads living spend and both savings figures, each with its own window (spec §2/§3)"
```

---

### Task 4: the Overview page — coverage in the snapshot, the new footer, the new YTD card

**Files:**
- Modify: `src/pages/OverviewPage.tsx`
- Modify: `src/pages/OverviewPage.test.tsx`

`/coverage` joins the all-or-nothing snapshot rather than riding its own track (the Up-next
and money-flow pattern): the footer, the strip and the YTD card all read it, and a coverage
line disagreeing with the spending tile beside it is the exact dishonesty this program removes.

- [ ] **Step 1: Write the failing test**

In `src/pages/OverviewPage.test.tsx`: add `CoverageOut` to the `../types/api` type import,
add the builders under `const SPEND_MONTHS = …`, extend `Payload` / `serve` / `snapshotOf` /
`pendAllSnapshotFetches` / `failAll`, then replace the freshness and YTD describes.

Add after `const SPEND_MONTHS = monthsFrom('2025-08-01', 12) // …through Jul 2026`:

```ts
// The footer and the YTD windows read /coverage, and both are compared against the RUN's
// own year (the CURRENT_YEAR rule above) — a hard-coded 2026 fixture would start failing on
// the next New Year's Day, the stale-fixture class this file already guards against.
const YEAR_MONTHS = monthsFrom(`${CURRENT_YEAR}-01-01`, 7) // Jan … Jul
const AUG = `${CURRENT_YEAR}-08-01`
const SEP = `${CURRENT_YEAR}-09-01`

function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: [...YEAR_MONTHS],
    spending: [...YEAR_MONTHS],
    net_pay: [...YEAR_MONTHS],
    spending_empty: [],
    spending_missing: [],
    net_pay_missing: [],
    latest: { balances: YEAR_MONTHS[6], spending: YEAR_MONTHS[6], net_pay: YEAR_MONTHS[6] },
    ...over,
  }
}

// Production on 2026-09-04: balances through September, spending entered through July,
// August never entered, September saved as all $0.00.
const LAGGING = coverageOut({
  balances: [...YEAR_MONTHS, AUG, SEP],
  spending_empty: [SEP],
  spending_missing: [AUG],
  net_pay_missing: [AUG, SEP],
  latest: { balances: SEP, spending: YEAR_MONTHS[6], net_pay: YEAR_MONTHS[6] },
})
```

In `interface Payload`, add `coverage: CoverageOut` after `system: SystemStatus`. In `serve()`,
add `coverage: coverageOut(),` to the payload literal (after `system: systemOut(),`) and
`vi.mocked(fetchCoverage).mockResolvedValue(payload.coverage)` beside the other `mockResolvedValue`
lines. In `snapshotOf`, add `coverage: payload.coverage,` after `system: payload.system,`. In
`pendAllSnapshotFetches`, add `vi.mocked(fetchCoverage).mockImplementation(pending)`. In
`failAll`, add `vi.mocked(fetchCoverage).mockImplementation(boom)`.

Replace the whole `describe('OverviewPage freshness', …)` block:

```ts
describe('OverviewPage freshness', () => {
  it('dates the quotes and stands each hand-entered feed on its own month', async () => {
    const quoted = daysAgo(1)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    const prices = await screen.findByText(`Prices as of ${formatDate(quoted)}`)
    // Yesterday's bar is not stale — no amber.
    expect(prices.className).not.toContain('stale')
    expect(screen.getByText(`Balances through ${formatMonth(YEAR_MONTHS[6])}`)).toBeTruthy()
    expect(screen.getByText(`Spending through ${formatMonth(YEAR_MONTHS[6])}`)).toBeTruthy()
    expect(screen.getByText(`Net pay through ${formatMonth(YEAR_MONTHS[6])}`)).toBeTruthy()
    // Level feeds: nothing ambers.
    expect(document.querySelectorAll('.overview-freshness .stale')).toHaveLength(0)
  })

  it('names the months the window is still waiting for and ambers the feeds that lag', async () => {
    serve({ coverage: LAGGING })
    renderPage()

    const spending = await screen.findByText(
      `Spending through ${formatMonth(YEAR_MONTHS[6])} (Aug missing, Sep empty)`,
    )
    expect(spending.className).toContain('stale')
    const balances = screen.getByText(`Balances through ${formatMonth(SEP)}`)
    expect(balances.className).not.toContain('stale')
    expect(screen.getByText(`Net pay through ${formatMonth(YEAR_MONTHS[6])}`).className).toContain(
      'stale',
    )
  })

  it('ambers a quote date that has gone stale — and the strip says the same thing', async () => {
    const quoted = daysAgo(9)
    serve({ holdings: holdingsOut({ as_of: quoted }) })
    renderPage()

    const prices = await screen.findByText(`Prices as of ${formatDate(quoted)}`)
    expect(prices.className).toContain('stale')
    // Two registers for one fact: the freshness row states it, the strip makes it a task.
    expect(
      screen.getByRole('link', { name: /Quotes are stale/ }).getAttribute('href'),
    ).toBe('/portfolio')
  })
})
```

Replace the first test of `describe('OverviewPage year to date', …)` and add two:

```ts
  it('leads with the total rate, names every window, and reads living spend', async () => {
    serve({
      yearly: {
        years: [
          {
            year: CURRENT_YEAR,
            by_category: [],
            total: '32000.00',
            net_pay_total: '90000.00',
            savings_rate: '0.644444',
            living_total: '27000.00',
            tax_total: '4000.00',
            transfer_total: '1000.00',
            cash_savings: '58000.00',
            payroll_savings: '12000.00',
            total_savings: '70000.00',
            total_savings_rate: '0.686274',
            months_matched: 7,
          },
        ],
      },
      dividends: [
        {
          id: 1, security_id: 1, account: null, pay_date: `${CURRENT_YEAR}-03-15`,
          amount: '120.50', source: 'manual', ex_date: null, per_share: null,
          shares_held: null, notes: null,
        },
        // Last year's payout must stay OUT of this year's sum.
        {
          id: 2, security_id: 1, account: null, pay_date: `${CURRENT_YEAR - 1}-12-15`,
          amount: '999.00', source: 'manual', ex_date: null, per_share: null,
          shares_held: null, notes: null,
        },
      ],
    })
    renderPage()

    await screen.findByText(`Year to date — ${CURRENT_YEAR}`)
    // Living spend, not the raw total that carries April's tax bill.
    expect(screen.getByText('$27,000.00')).toBeTruthy()
    expect(screen.queryByText('$32,000.00')).toBeNull()
    expect(screen.getByText('$90,000.00')).toBeTruthy()
    // The headline rate is the TOTAL one; cash rides beside it.
    expect(screen.getByText('68.6% total')).toBeTruthy()
    expect(screen.getByText(/\$70,000\.00 · cash 64\.4% \(\$58,000\.00\)/)).toBeTruthy()
    // Every figure names its window (spec §3).
    expect(screen.getAllByText('Jan–Jul')).toHaveLength(3)
    expect(screen.getByText(/since .* \(through Sep\)/)).toBeTruthy()
    // The dividend sum is this year's payments only.
    expect(screen.getByText('$120.50')).toBeTruthy()
    expect(screen.queryByText('$999.00')).toBeNull()
  })

  it('dashes the savings row in a year nothing matched, rather than printing a zero', async () => {
    serve({
      coverage: coverageOut({ net_pay: [], latest: { balances: YEAR_MONTHS[6], spending: YEAR_MONTHS[6], net_pay: null } }),
      yearly: {
        years: [
          {
            year: CURRENT_YEAR, by_category: [], total: '32000.00', net_pay_total: null,
            savings_rate: null, living_total: '27000.00', total_savings: null,
            total_savings_rate: null, cash_savings: null, months_matched: 0,
          },
        ],
      },
    })
    renderPage()

    await screen.findByText(`Year to date — ${CURRENT_YEAR}`)
    const saved = screen.getByText('Saved').closest('.ytd-fact')
    expect(saved?.querySelector('dd')?.textContent).toBe('—')
  })
```

Append to `describe('OverviewPage attention strip', …)`:

```ts
  it('turns the coverage gaps into wizard links for those months', async () => {
    serve({ coverage: LAGGING })
    renderPage()

    await screen.findByRole('navigation', { name: 'Needs attention' })
    expect(
      screen
        .getByRole('link', { name: `${formatMonth(AUG)} spending was never entered` })
        .getAttribute('href'),
    ).toBe(`/update?month=${AUG}&step=spending`)
    expect(
      screen
        .getByRole('link', { name: `${formatMonth(SEP)} was saved with no spending` })
        .getAttribute('href'),
    ).toBe(`/update?month=${SEP}&step=spending`)
  })
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx`
Expected: FAIL — `Object literal may only specify known properties, and 'coverage' does not exist in type 'Payload'` once added, then at runtime "Unable to find an element with the text: Balances through …" (the footer still says "Net worth through …").

- [ ] **Step 3: Put coverage in the snapshot**

In `src/pages/OverviewPage.tsx`:

Add to the imports (alphabetical among the `../api/*` lines, after `import { ApiError } from '../api/client'`):

```ts
import { fetchCoverage } from '../api/coverage'
```

Add `Fragment` to the react import and `freshnessClauses` / `windowWords` to the overview imports:

```ts
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { freshnessClauses } from '../components/overview/freshness'
import { windowWords, ytdStats } from '../components/overview/ytd'
```

(The existing `import { ytdStats } from '../components/overview/ytd'` line is replaced by the
one above; keep the import block's order otherwise untouched.)

Add `CoverageOut,` to the `../types/api` type import list, and the field to the payload object:

```ts
interface OverviewData {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  history: PortfolioHistory
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
  // The attention strip's feeds (ESPP countdowns, tax-year input counts, the system
  // status — last refresh run, backup marker, environment) and the YTD card's (yearly
  // rollup, dividend log) ride the same all-or-nothing snapshot: per-slot degradation
  // stays the documented v2 shape.
  lots: EsppLotsResponse
  taxYears: TaxYearOut[]
  yearly: SpendingYearly
  dividends: DividendOut[]
  system: SystemStatus
  // /coverage rides it too (2026-09-04 honest-numbers spec §3): the footer, the strip and
  // the YTD card's windows all read it, and a footer standing on a different instant from
  // the spending tile beside it is precisely the dishonesty this program removes.
  coverage: CoverageOut
}
```

In `load()`, add the client and destructure it:

```ts
      fetchSystemStatus(),
      fetchCoverage(),
    ])
      .then(
        ([summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system, coverage]) => {
          if (seq !== seqRef.current) return
          const snapshot: OverviewData = {
            summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system, coverage,
          }
```

Feed the strip and the card:

```ts
  const attention = data
    ? attentionItems(
        {
          months: data.ts.months,
          holdings: data.holdings,
          lots: data.lots,
          taxYears: data.taxYears,
          system: data.system,
          coverage: data.coverage,
        },
        todayIso(),
      )
    : []
  const ytd = data ? ytdStats(data.ts, data.yearly, data.dividends, data.coverage, todayIso()) : null
```

- [ ] **Step 4: Rewrite the YTD card and the footer**

Replace the `{showYtd && ytd && ( … )}` section:

```tsx
            {showYtd && ytd && (
              <section className="card ytd-card">
                <h2 className="eyebrow">
                  Year to date — {ytd.year}
                  <InfoHint text="The year so far, each figure over the window it was measured on: net-worth change since the last pre-January snapshot, living spend (tax payments and transfers are counted apart), net pay, savings with payroll deductions counted in, and dividends collected." />
                </h2>
                <dl className="ytd-facts">
                  <div className="ytd-fact">
                    <dt>Net worth</dt>
                    <dd>
                      {ytd.netWorthDelta === null ? (
                        '—'
                      ) : (
                        // Glyph + colour + the signed number — three channels, none alone
                        // (StatTile's delta grammar). Up is good here, so glyph and tone agree.
                        <span
                          className={
                            ytd.netWorthDelta > 0
                              ? 'delta-positive'
                              : ytd.netWorthDelta < 0
                                ? 'delta-negative'
                                : ''
                          }
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
                          {' '}
                          since {formatMonth(ytd.anchorMonth)}
                          {ytd.throughMonth !== null &&
                            ` (through ${formatMonth(ytd.throughMonth).slice(0, 3)})`}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="ytd-fact">
                    <dt>
                      Spend
                      {ytd.spendWindow && (
                        <span className="ytd-sub"> {windowWords(ytd.spendWindow)}</span>
                      )}
                    </dt>
                    <dd>{formatCurrency(ytd.spend)}</dd>
                  </div>
                  <div className="ytd-fact">
                    <dt>
                      Net pay
                      {ytd.netPayWindow && (
                        <span className="ytd-sub"> {windowWords(ytd.netPayWindow)}</span>
                      )}
                    </dt>
                    <dd>{formatCurrency(ytd.netPay)}</dd>
                  </div>
                  {/* The headline is the TOTAL rate — payroll deductions are savings too
                      (spec §2) — with cash beside it, because the two answer different
                      questions: what the household kept, and what it could still spend. */}
                  <div className="ytd-fact">
                    <dt>
                      Saved
                      {ytd.savedWindow && (
                        <span className="ytd-sub"> {windowWords(ytd.savedWindow)}</span>
                      )}
                    </dt>
                    <dd>
                      {ytd.totalRate === null ? (
                        '—'
                      ) : (
                        <>
                          <span
                            className={
                              Number(ytd.totalRate) > 0
                                ? 'delta-positive'
                                : Number(ytd.totalRate) < 0
                                  ? 'delta-negative'
                                  : ''
                            }
                          >
                            {formatPct(ytd.totalRate, { signed: false })} total
                          </span>
                          <span className="ytd-sub">
                            {' '}
                            {formatCurrency(ytd.totalSaved)} · cash{' '}
                            {formatPct(ytd.cashRate, { signed: false })} (
                            {formatCurrency(ytd.cashSaved)})
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                  <div className="ytd-fact">
                    <dt>Dividends collected</dt>
                    <dd>{ytd.dividends === null ? '—' : formatCurrency(ytd.dividends)}</dd>
                  </div>
                </dl>
              </section>
            )}
```

Replace the `<div className="overview-freshness">` block:

```tsx
            {/* Four clocks: quotes move daily, while balances, spending and net pay are
                hand-entered and each stands on its OWN month (honest-numbers spec §3). A
                feed a month or more behind the balances wears the same amber a stale quote
                does — one visual language for "this number is older than it looks". */}
            <div className="overview-freshness">
              <span className={isStaleQuote(asOf) ? 'freshness stale' : 'freshness'}>
                {/* Capitalized, a deliberate departure from PortfolioPage's lowercase pair
                    ("prices as of …" / "prices never refreshed" — a note tucked beside its
                    Refresh button). This row is four PEER clauses separated by dots, and
                    the others capitalize; a lowercase one would read as a fragment. */}
                {asOf ? `Prices as of ${formatDate(asOf)}` : 'Prices never refreshed'}
              </span>
              {freshnessClauses(data.coverage).map((clause) => (
                <Fragment key={clause.key}>
                  <span aria-hidden="true">·</span>
                  <span className={clause.lagging ? 'freshness stale' : 'freshness'}>
                    {clause.text}
                  </span>
                </Fragment>
              ))}
            </div>
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/pages/OverviewPage.test.tsx && npx tsc -b`
Expected: PASS, and `tsc` clean (Task 3's dangling call site is now fixed).

- [ ] **Step 6: Prove the tests fail on a regression (mutation check)**

Change the footer's `clause.lagging ? 'freshness stale' : 'freshness'` to `'freshness'` and run
`npx vitest run src/pages/OverviewPage.test.tsx`.
Expected: FAIL — "names the months the window is still waiting for and ambers the feeds that lag".
Then drop `coverage: data.coverage` from the `attentionItems` call — TypeScript refuses it
(`Property 'coverage' is missing`), which is the pin working at compile time. Revert both.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx eslint src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): coverage joins the snapshot — footer names every feed and its gaps, YTD names every window (spec §3)"
```

---

### Task 5: the ribbon's spending dot lights only for entered months

**Files:**
- Modify: `src/components/shell/ScopeBar.test.tsx`

Spec §3: "Month ribbon: the spending dot lights only for entered months (empty months show
the hollow ring); no CSS change." This is a DATA change — lane A narrowed `coverage.spending`
to entered months, and `ScopeBar` already builds the ribbon's set straight from that array.
So this task adds no production code: it adds the pin that stops a future lane from
"helpfully" unioning the gap lists back in, and proves the pin can fail.

- [ ] **Step 1: Write the pin**

Append inside the existing `describe('ScopeBar', …)`, after the
`month (view): no Back to latest …` case:

```ts
  it('month (view): the spending dot follows ENTERED months only — an empty month stays hollow', async () => {
    // Lane A's /coverage lists entered months in `spending` (honest-numbers spec §3): August
    // has no spending rows at all, September was saved as nineteen rows of $0.00. Neither
    // may light the dot, and nothing here may union the two gap lists back into the set —
    // that would put the old lie ("September has spending") straight back on the ribbon.
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-07-01', '2026-08-01', '2026-09-01'],
      spending: ['2026-07-01'],
      net_pay: ['2026-07-01'],
      spending_empty: ['2026-09-01'],
      spending_missing: ['2026-08-01'],
      net_pay_missing: ['2026-08-01', '2026-09-01'],
      latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    })
    mount({ month: { mode: 'view', anchor: '2026-09-01' } })

    const july = await screen.findByRole('button', {
      name: /^Jul 2026 — balances and spending entered/,
    })
    expect(july.classList.contains('has-spending')).toBe(true)
    for (const month of ['Aug 2026', 'Sep 2026']) {
      const chip = screen.getByRole('button', {
        name: new RegExp(`^${month} — balances entered, spending missing`),
      })
      expect(chip.classList.contains('has-balances')).toBe(true)
      expect(chip.classList.contains('has-spending')).toBe(false)
    }
  })
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/components/shell/ScopeBar.test.tsx`
Expected: PASS on the first run — the behaviour is lane A's data change, and this pin states
it in the shell so it cannot be undone by accident. (A pin that passes immediately is only
worth keeping if it can fail; Step 3 proves that.)

- [ ] **Step 3: Prove the pin fails on a regression (mutation check)**

In `src/components/shell/ScopeBar.tsx`, temporarily widen the ribbon set:

```ts
  const ribbonCoverage = useMemo<RibbonCoverage | null>(
    () =>
      coverage === null
        ? null
        : {
            balances: new Set(coverage.balances),
            spending: new Set([...coverage.spending, ...(coverage.spending_empty ?? [])]),
          },
    [coverage],
  )
```

Run: `npx vitest run src/components/shell/ScopeBar.test.tsx`
Expected: FAIL — "the spending dot follows ENTERED months only": Sep 2026's chip is now
`balances and spending entered`, so `getByRole` cannot find the "spending missing" label.
Revert the edit (`git checkout -- src/components/shell/ScopeBar.tsx`) and re-run.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/components/shell/ScopeBar.test.tsx
git add src/components/shell/ScopeBar.test.tsx
git commit -m "test(shell): pin the ribbon's spending dot to ENTERED months — empty months stay hollow (spec §3)"
```

---

### Task 6: the savings chart — total over cash, with the words spelled out

**Files:**
- Modify: `src/types/api.ts` (the `SpendingMatrix` interface, around line 152)
- Modify: `src/components/spending/spendingChartOptions.ts`
- Modify: `src/components/spending/spendingChartOptions.test.ts`
- Modify: `src/charts/fixtures/spendingBars.fixture.ts`, `src/charts/fixtures/spendingSavings.fixture.ts`
- Create: `src/charts/fixtures/spendingSavingsCash.fixture.ts`
- Modify: `src/charts/conformance.test.ts`
- Modify: `src/pages/SpendingPage.tsx`, `src/pages/SpendingPage.test.tsx`

Spec §2: "Spending savings-rate chart: total rate as the line, cash rate as a second muted
line, legend words 'Total (incl. payroll)' / 'Cash'."

- [ ] **Step 1: Mirror lane A's `SpendingMatrix`**

In `src/types/api.ts`, replace the `SpendingMatrix` interface:

```ts
export interface SpendingMatrix {
  months: string[]
  categories: CategoryOut[]
  // budgets: the category's RESOLVED budget per month (greatest effective_month <= M,
  // spec §2), aligned with months; null = unbudgeted that month.
  series: { category_id: number; values: (string | null)[]; budgets: (string | null)[] }[]
  totals: string[]
  net_pay: (string | null)[]
  /** The CASH rate — (net pay − living spend − tax paid) ÷ net pay (2026-09-04
   *  honest-numbers spec §2). Same name, same arithmetic wherever every category is living. */
  savings_rate: (string | null)[]
  four_pct_rule: (string | null)[]
  /** Sum of the resolved category budgets per month; null when NO category has one. */
  total_budget: (string | null)[]
  // The honest-numbers additions (spec §2), each aligned with `months`. Optional for the
  // reason `MoneyFlowTaxes.niit` documents: the live server always sends them.
  living_total?: string[]
  tax_total?: string[]
  transfer_total?: string[]
  cash_savings?: (string | null)[]
  payroll_savings?: (string | null)[]
  total_savings?: (string | null)[]
  total_savings_rate?: (string | null)[]
}
```

- [ ] **Step 2: Write the failing test**

In `src/components/spending/spendingChartOptions.test.ts`, extend `matrixFixture` with the
new arrays (they are internally consistent: living + tax + transfer = total, cash = net pay −
living − tax, total = cash + payroll) and replace the `savingsRateOption` describe.

Add inside `matrixFixture`'s literal, after `total_budget: ['500.00', '500.00'],`:

```ts
    living_total: ['2600.00', '2000.00'],
    tax_total: ['150.00', '0.00'],
    transfer_total: ['0.00', '0.00'],
    cash_savings: ['3250.00', null],
    payroll_savings: ['1000.00', null],
    total_savings: ['4250.00', null],
    total_savings_rate: ['0.607142857', null],
```

Add `CASH_RATE_SERIES, TOTAL_RATE_SERIES,` to the import list from `./spendingChartOptions`
and replace the whole `describe('savingsRateOption', …)` block:

```ts
describe('savingsRateOption', () => {
  const savings = (over: Partial<SpendingMatrix> = {}) =>
    read(
      savingsRateOption({ matrix: matrixFixture(over), monthLabels: LABELS, range: { preset: 'all' } }),
    ) as unknown as {
      grid: unknown
      legend: { type: string } | undefined
      yAxis: { min: (e: { min: number }) => number; max: (e: { max: number }) => number; axisLabel: { formatter: unknown } }
      series: { name: string; color: string; markLine: unknown; data: unknown[]; emphasis: unknown }[]
      tooltip: { formatter: (p: unknown) => string }
    }

  it('draws the total rate over a muted cash line, the legend spelling both out', () => {
    const option = savings()
    expect(option.grid).toEqual(GRID_VARIANTS.default) // the legend row needs the top gutter
    expect(option.legend?.type).toBe('plain')
    expect(option.series.map((s) => s.name)).toEqual([TOTAL_RATE_SERIES, CASH_RATE_SERIES])
    // The WORDS are the point: "rate" alone never said which of the two it meant.
    expect(TOTAL_RATE_SERIES).toBe('Total (incl. payroll)')
    expect(CASH_RATE_SERIES).toBe('Cash')
    expect(option.series[0]).toMatchObject({ color: PALETTE[0], emphasis: { focus: 'series' } })
    expect(option.series[1].color).toBe(MUTED)
    expect(option.series[0].data).toEqual([0.607142857, null])
    expect(option.series[1].data).toEqual([0.541666667, null])
    // The zero baseline is drawn ONCE, by the leading series.
    expect(option.series[0].markLine).toEqual({
      silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'solid' },
      label: { show: false }, data: [{ yAxis: 0 }],
    })
    expect(option.series[1].markLine).toBeUndefined()
    expect(option.yAxis.axisLabel.formatter).toBe(percentLabel)
    expect(option.yAxis.min({ min: -1.8 })).toBe(-2)
    expect(option.yAxis.max({ max: 0.6 })).toBe(0.6)
    const rows = tooltipRows(
      option.tooltip.formatter([
        { seriesName: TOTAL_RATE_SERIES, seriesType: 'line', axisValueLabel: 'Jun 2026', value: 0.35, color: PALETTE[0] },
      ]),
    )
    expect(rows.rows).toEqual([{ kind: 'row', label: TOTAL_RATE_SERIES, value: '35.0%' }])
  })

  it('falls back to the lone cash line on a backend older than the savings service', () => {
    const option = savings({ total_savings_rate: undefined })
    expect(option.series.map((s) => s.name)).toEqual([CASH_RATE_SERIES])
    expect(option.grid).toEqual(GRID_VARIANTS.noLegend)
    expect(option.legend).toBeUndefined()
    // The baseline follows the leading series, whichever one that is.
    expect(option.series[0].markLine).not.toBeUndefined()
  })

  it('exports month, net pay, living and total spend, and both rates — blanks for nulls', () => {
    expect(savingsRateCsv(matrixFixture())).toEqual({
      headers: ['Month', 'Net pay', 'Living spend', 'Total spend', 'Cash rate', 'Total rate'],
      rows: [
        ['2026-06-01', '6000.00', '2600.00', '2750.00', '0.541666667', '0.607142857'],
        ['2026-07-01', '6000.00', '2000.00', '2000.00', '', ''],
      ],
    })
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts`
Expected: FAIL — `TOTAL_RATE_SERIES is not exported`, and the CSV case receives the old
four-column table.

- [ ] **Step 4: Write the builder**

In `src/components/spending/spendingChartOptions.ts`, replace `savingsRateOption` and
`savingsRateCsv`, and add `legendFor` to the imports if it is not already there (it is — the
bars use it):

```ts
/** The two savings words (2026-09-04 honest-numbers spec §2). Payroll deductions are money
 *  the household saved without ever seeing it as cash, so the headline line counts them;
 *  the muted line answers the other question — what was left of the paycheck. */
export const TOTAL_RATE_SERIES = 'Total (incl. payroll)'
export const CASH_RATE_SERIES = 'Cash'

export interface SavingsRateInput { matrix: SpendingMatrix; monthLabels: string[]; range: RangeState }

/** Rates over months with net pay; nulls break the line (connectNulls false). Clamped
 *  savings-rate extents (A7): ceiling +100%, floor expanding to the data. TWO lines when the
 *  server sends the total rate, one when it does not — the fallback is exactly the chart
 *  this card drew before the savings service, so an older backend degrades to the truth it
 *  can still tell rather than to a blank. */
export function savingsRateOption({ matrix, monthLabels, range }: SavingsRateInput): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const total = matrix.total_savings_rate
  const numbers = (values: (string | null)[]) => values.map((v) => (v === null ? null : Number(v)))
  const series = [
    ...(total === undefined
      ? []
      : [
          {
            ...LINE,
            name: TOTAL_RATE_SERIES,
            color: PALETTE[0],
            connectNulls: false,
            markLine: zeroLine(),
            data: numbers(total),
          },
        ]),
    {
      ...LINE,
      name: CASH_RATE_SERIES,
      color: MUTED,
      connectNulls: false,
      // The baseline belongs to whichever series leads — drawn twice it doubles its own ink.
      ...(total === undefined ? { markLine: zeroLine() } : {}),
      data: numbers(matrix.savings_rate),
    },
  ]
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid(total === undefined ? 'noLegend' : 'default'),
    ...(total === undefined ? {} : { legend: legendFor(series.length) }),
    // True value in the tooltip even when a line is clamped out of frame.
    tooltip: axisTooltip({ unit: 'percent' }),
    xAxis: monthAxis(monthLabels),
    yAxis: pctAxis(),
    series,
  }
}

/** The chart as a table (F12): both rates the lines draw, with the two spend figures that
 *  explain the gap between them. Verbatim server strings; blanks for absent, never '0.00'. */
export function savingsRateCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'net_pay' | 'totals' | 'savings_rate'> &
    Partial<Pick<SpendingMatrix, 'living_total' | 'total_savings_rate'>>,
): ExportTable {
  return {
    headers: ['Month', 'Net pay', 'Living spend', 'Total spend', 'Cash rate', 'Total rate'],
    rows: matrix.months.map((m, i) => [
      m,
      matrix.net_pay[i] ?? '',
      matrix.living_total?.[i] ?? '',
      matrix.totals[i],
      matrix.savings_rate[i] ?? '',
      matrix.total_savings_rate?.[i] ?? '',
    ]),
  }
}
```

Update the file-header map line to match:

```ts
//   savingsRateOption    + savingsRateCsv    — the total savings rate over the cash one
```

- [ ] **Step 5: Run the builder tests to see them pass**

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts`
Expected: PASS.

- [ ] **Step 6: Fixtures and the roster**

In `src/charts/fixtures/spendingBars.fixture.ts`, add to `MATRIX` after
`total_budget: ['500.00', '500.00', '500.00'],`:

```ts
  living_total: ['2600.00', '2480.00', '2610.00'],
  tax_total: ['150.00', '100.00', '90.00'],
  transfer_total: ['0.00', '0.00', '0.00'],
  cash_savings: ['3250.00', '3420.00', '3400.00'],
  payroll_savings: ['1000.00', '1000.00', '1000.00'],
  total_savings: ['4250.00', '4420.00', '4400.00'],
  total_savings_rate: ['0.607142857', '0.631428571', '0.619718310'],
```

Replace `src/charts/fixtures/spendingSavings.fixture.ts`:

```ts
import type { ChartFixture } from './_types'
import { savingsRateOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingSavings',
  kind: 'cartesian',
  ariaLabel:
    'Line chart of the monthly total savings rate over the cash rate, around a zero baseline',
  build: () => savingsRateOption({ matrix: MATRIX, monthLabels: LABELS, range: { preset: 'all' } }),
}
export default fixture
```

Create `src/charts/fixtures/spendingSavingsCash.fixture.ts`:

```ts
import type { ChartFixture } from './_types'
import { savingsRateOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX } from './spendingBars.fixture'

// The degraded branch (a backend older than the savings service): one muted line, no legend,
// the noLegend grid — a shape the two-line fixture never reaches, so the grammar would
// otherwise never check it (sandbox J's `projectionPinned` precedent).
const fixture: ChartFixture = {
  name: 'spendingSavingsCash',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the monthly cash savings rate around a zero baseline',
  build: () =>
    savingsRateOption({
      matrix: { ...MATRIX, total_savings_rate: undefined },
      monthLabels: LABELS,
      range: { preset: 'all' },
    }),
}
export default fixture
```

In `src/charts/conformance.test.ts`, add to `ROSTER` right after `'spendingSavings',`:

```ts
  // …and the same builder without the server's total rate (an older backend): one muted
  // line on the noLegend grid, a shape the two-line fixture never reaches.
  'spendingSavingsCash',
```

Run: `npx vitest run src/charts/conformance.test.ts`
Expected: PASS, with cases named `spendingSavings conforms` and `spendingSavingsCash conforms`.

- [ ] **Step 7: The page's words**

In `src/pages/SpendingPage.tsx`:

Replace the KPI tile:

```tsx
            <StatTile
              label="Savings rate — cash"
              value={kpis.savings === null ? '—' : formatPct(kpis.savings, { signed: false })}
              hint="(net pay − living spend − tax paid) ÷ net pay for the viewed month. Payroll deductions are not in this one — the chart below draws both readings."
            />
```

Replace the drill footer's savings clause:

```tsx
                  Total {formatCurrency(matrix.totals[detailIndex])} · Net pay{' '}
                  {formatCurrency(matrix.net_pay[detailIndex])} · Cash savings{' '}
                  {matrix.savings_rate[detailIndex] === null
                    ? '—'
                    : formatPct(matrix.savings_rate[detailIndex], { signed: false })}{' '}
                  — click the chart to go back.
```

Replace the savings `ChartCard`'s title, hint, ariaLabel and footer (every other prop stays):

```tsx
            title="Savings rate"
            hint="Two readings of the same month. Total counts the payroll deductions — 401(k), ESPP, HSA — that never reach your take-home; Cash is what was left of the paycheck: (net pay − living spend − tax paid) ÷ net pay. Above the zero line you saved, below it you overspent."
            ariaLabel="Line chart of the monthly total and cash savings rates around a zero baseline"
```

```tsx
            footer={
              <p className="drill-hint">
                Tax payments and transfers to your own accounts are not living spend, so
                neither line counts them as money gone. The old sheet's column tracked a
                planned rate, so values differ by design.
              </p>
            }
```

In `src/pages/SpendingPage.test.tsx`, update the two references to the old series/heading name:

```ts
            { seriesName: 'Total (incl. payroll)', seriesType: 'line', value: 0.35 },
```

```ts
    const savings = screen.getByRole('heading', { name: /^Savings rate$/ })
```

- [ ] **Step 8: Run everything this task touched**

Run: `npx vitest run src/components/spending src/charts/conformance.test.ts src/pages/SpendingPage.test.tsx && npx tsc -b`
Expected: PASS on all three files, `tsc` clean.

- [ ] **Step 9: Prove the tests fail on a regression (mutation check)**

Change `color: MUTED` on the cash series to `color: PALETTE[1]` and run
`npx vitest run src/components/spending/spendingChartOptions.test.ts`.
Expected: FAIL — "draws the total rate over a muted cash line". Then swap the two series
(cash first) and run again.
Expected: FAIL — the `series.map(name)` order and the `markLine` pins. Revert both and re-run.
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
npx eslint src/components/spending/spendingChartOptions.ts src/components/spending/spendingChartOptions.test.ts src/charts/fixtures/spendingBars.fixture.ts src/charts/fixtures/spendingSavings.fixture.ts src/charts/fixtures/spendingSavingsCash.fixture.ts src/charts/conformance.test.ts src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx src/types/api.ts
git add src/components/spending src/charts/fixtures/spendingBars.fixture.ts src/charts/fixtures/spendingSavings.fixture.ts src/charts/fixtures/spendingSavingsCash.fixture.ts src/charts/conformance.test.ts src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx src/types/api.ts
git commit -m "feat(spending): the savings chart draws Total (incl. payroll) over a muted Cash line (spec §2)"
```

---

### Task 7: the yearly rollup's own columns, and a badge on every non-living category

**Files:**
- Modify: `src/types/api.ts` (`CategoryOut`, around line 128)
- Modify: `src/pages/SpendingPage.tsx`
- Modify: `src/pages/SpendingPage.test.tsx`

Spec §2: "Spending yearly rollup: both rates, living spend, tax paid, transfers as columns."
Spec §1: "the badge on Spending's yearly rollup and heatmap legend names non-living categories
('tax', 'transfer') so their exclusion is visible, never silent."

- [ ] **Step 1: Mirror lane A's `CategoryOut`**

In `src/types/api.ts`, above `CategoryOut`, add the union and the field (lane E adds the same
`kind` to `CategoryCreate` / `CategoryUpdate` — leave those two alone here):

```ts
/** What a category's money IS (2026-09-04 honest-numbers spec §1): `living` left the
 *  household, `tax` is an income-tax payment made from take-home, `transfer` stayed yours
 *  (a brokerage top-up, extra principal). Only `living` counts as spend. */
export type CategoryKind = 'living' | 'tax' | 'transfer'

export interface CategoryOut {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
  /** Optional for the reason `MoneyFlowTaxes.niit` documents: the live server always sends
   *  it (server default `living`), and a fixture written before this program keeps
   *  compiling — readers take `undefined` as "living", which is what it used to mean. */
  kind?: CategoryKind
}
```

- [ ] **Step 2: Write the failing test**

In `src/pages/SpendingPage.test.tsx`: add `within` to the testing-library import
(`import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'`),
extend the `YEARLY` rollup, and append the new describe.

Replace the `YEARLY` constant (the cash rate now excludes the tax and transfer rows, so it
moves from 55.6% to 56.8% — the retroactive move the spec's §6 says out loud):

```ts
const YEARLY: SpendingYearly = {
  years: [
    {
      year: 2026,
      by_category: [
        { category_id: 1, total: '4000.00' },
        { category_id: 2, total: '1180.00' },
        { category_id: 3, total: '150.00' },
      ],
      total: '5330.00',
      net_pay_total: '12000.00',
      savings_rate: '0.568333333',
      living_total: '4000.00',
      tax_total: '1180.00',
      transfer_total: '150.00',
      cash_savings: '6820.00',
      payroll_savings: '2000.00',
      total_savings: '8820.00',
      total_savings_rate: '0.630000',
      months_matched: 7,
    },
  ],
}
```

Append at the end of the file:

```ts
describe('SpendingPage — the honest rollup (spec §1/§2)', () => {
  // Three kinds on one page: rent is living, the April tax bill is not spend at all, and a
  // brokerage transfer is money that stayed the household's.
  const withKinds = () =>
    matrixOut({
      categories: [
        { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true, kind: 'living' },
        { id: 2, name: 'Taxes', slug: 'taxes', sort_order: 1, is_active: true, kind: 'tax' },
        { id: 3, name: 'Investments', slug: 'investments', sort_order: 2, is_active: true, kind: 'transfer' },
      ],
    })

  const rollup = () =>
    screen.getByRole('heading', { name: /Yearly rollups/ }).closest('.card') as HTMLElement

  it('breaks the year into living, tax and transfers, with both rates over the matched months', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /Yearly rollups/ })
    const row = (label: string) => within(rollup()).getByText(label).closest('tr')
    expect(row('Living spend')?.textContent).toContain('$4,000.00')
    expect(row('Tax paid')?.textContent).toContain('$1,180.00')
    expect(row('Transfers')?.textContent).toContain('$150.00')
    expect(row('Net pay')?.textContent).toContain('$12,000.00')
    expect(row('Savings rate — total')?.textContent).toContain('63.0%')
    expect(row('Savings rate — cash')?.textContent).toContain('56.8%')
    // The window every figure above was computed over — named, not implied.
    expect(row('Months matched')?.textContent).toContain('7')
  })

  it('badges every non-living category so its exclusion is visible, never silent', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(withKinds())
    renderPage()
    await screen.findByRole('heading', { name: /Yearly rollups/ })
    expect(within(rollup()).getByText('Taxes').closest('tr')?.textContent).toContain('tax')
    expect(within(rollup()).getByText('Investments').closest('tr')?.textContent).toContain(
      'transfer',
    )
    // Living is the norm — badging it would make the exception invisible again.
    expect(within(rollup()).getByText('Rent').closest('tr')?.querySelector('.badge')).toBeNull()
  })

  it('names the non-living categories under the heatmap too', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(withKinds())
    renderPage()
    await screen.findByRole('heading', { name: /Month × category heatmap/ })
    expect(
      screen.getByText(/Not living spend: Taxes \(tax\) · Investments \(transfer\)/),
    ).toBeTruthy()
  })

  it('says nothing under the heatmap when every category is living', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /Month × category heatmap/ })
    expect(screen.queryByText(/Not living spend/)).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run src/pages/SpendingPage.test.tsx`
Expected: FAIL — "Unable to find an element with the text: Living spend", and the badge and
heatmap-legend cases likewise.

- [ ] **Step 4: Write the page**

In `src/pages/SpendingPage.tsx`, add the derived list beside the other memos (right after the
`ribbonFigures` memo):

```ts
  // The non-living categories, named once for the two full-history surfaces (spec §1): the
  // heatmap draws every row while the rollup's living total leaves these out, and a
  // difference like that has to be said out loud rather than discovered.
  const nonLiving = useMemo(
    () =>
      (matrix?.categories ?? []).filter(
        (category) => category.kind !== undefined && category.kind !== 'living',
      ),
    [matrix],
  )
```

Give the heatmap `ChartCard` a footer (insert the prop after its `actions={…}` prop):

```tsx
            footer={
              nonLiving.length === 0 ? undefined : (
                <p className="drill-hint">
                  Not living spend:{' '}
                  {nonLiving.map((category) => `${category.name} (${category.kind})`).join(' · ')} —
                  these rows are drawn here, but the savings figures and the year's living
                  total leave them out.
                </p>
              )
            }
```

Badge the category rows of the rollup:

```tsx
                  {matrix?.categories.map((category) => (
                    <tr key={category.id}>
                      <td>
                        {category.name}
                        {/* The kind is the REASON this row is missing from living spend, so
                            it belongs on the same line as the numbers (spec §1). */}
                        {category.kind !== undefined && category.kind !== 'living' && (
                          <>
                            {' '}
                            <span className="badge">{category.kind}</span>
                          </>
                        )}
                      </td>
```

Replace the rollup's whole `<tfoot>` — the three kinds decompose the total above it, then the
paycheck, then the two rates and the window they were computed over. `formatCurrency` and
`formatPct` both answer `—` for null AND undefined, so an older backend simply dashes:

```tsx
                <tfoot>
                  <tr>
                    <td>Living spend</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.living_total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Tax paid</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.tax_total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Transfers</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.transfer_total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num" style={{ fontWeight: 600 }}>
                        {formatCurrency(y.total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Net pay</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.net_pay_total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Savings rate — total</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatPct(y.total_savings_rate, { signed: false })}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Savings rate — cash</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatPct(y.savings_rate, { signed: false })}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Months matched</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {y.months_matched ?? '—'}
                      </td>
                    ))}
                  </tr>
                </tfoot>
```

Update the card's `InfoHint`:

```tsx
              <InfoHint text="Category totals per calendar year, then the three kinds that make up the total, the paycheck, and both savings rates — all over the months that have BOTH spending and net pay entered (the count is the last row)." />
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/pages/SpendingPage.test.tsx && npx tsc -b`
Expected: PASS, `tsc` clean.

- [ ] **Step 6: Prove the tests fail on a regression (mutation check)**

Change the badge condition to `category.kind === 'living'` and run
`npx vitest run src/pages/SpendingPage.test.tsx`.
Expected: FAIL — "badges every non-living category": Rent's row now carries a `.badge`.
Then change `formatPct(y.total_savings_rate, …)` to `formatPct(y.savings_rate, …)` and run again.
Expected: FAIL — "breaks the year into living, tax and transfers": the total row reads 56.8%.
Revert both and re-run.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx eslint src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx src/types/api.ts
git add src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx src/types/api.ts
git commit -m "feat(spending): the rollup carries living/tax/transfers and both rates, non-living categories wear their kind (spec §1/§2)"
```

---

### Task 8: the Assumptions card prints the window its figures were derived over

**Files:**
- Modify: `src/types/api.ts` (beside `ContributionBreakdownOut`, around line 1555)
- Modify: `src/components/projection/ScenarioPanel.tsx`
- Modify: `src/components/projection/ScenarioPanel.test.tsx`

Spec §3: "Projection: `annual_spend` and cash savings both derive over the MATCHED window …
the echo names the window (`derived_window: {from, to, months}`) and the Assumptions card
prints it."

- [ ] **Step 1: Mirror lane A's `derived_window`**

In `src/types/api.ts`, add above `ProjectionOut` (right after `ContributionBreakdownOut`):

```ts
/** The window the data-derived knobs were computed over (2026-09-04 honest-numbers spec §3):
 *  the trailing months that are BOTH entered and paid. `from`/`to` are first-of-month ISO
 *  dates, `months` the count. A mean with no window named is a number the reader must trust. */
export interface DerivedWindowOut {
  from: string
  to: string
  months: number
}
```

and the field to `ProjectionOut`, right after `contribution_breakdown`:

```ts
  /** The window `annual_spend` and the contribution's cash half were derived over. Null when
   *  nothing could be derived; absent from a backend older than 2026-09-04 — readers take it
   *  as `?? null`, the `bands` posture. */
  derived_window?: DerivedWindowOut | null
```

- [ ] **Step 2: Write the failing test**

In `src/components/projection/ScenarioPanel.test.tsx`, add the field to the `echo` fixture
(after `retirements: []`):

```ts
  derived_window: { from: '2025-08-01', to: '2026-07-01', months: 12 },
```

and append inside `describe('ScenarioPanel', …)`:

```ts
  it('prints the window under both derived-from-data figures, and the contribution arithmetic', async () => {
    preview.mockImplementation(async () => ({
      ...echo,
      contribution_breakdown: {
        cash: '1200.00',
        payroll: '2800.00',
        total: '4000.00',
        by_person: [{ person_id: 1, name: 'Edward', monthly: '2400.00' }],
      },
    }))
    mount()
    // Both the contribution and the annual spend derive from the SAME matched window, and
    // each says so under its own knob.
    await waitFor(() =>
      expect(screen.getAllByText('over Aug 2025 – Jul 2026 (12 months)')).toHaveLength(2),
    )
    expect(
      screen.getByText(
        'derived: $1,200.00 cash savings + $2,800.00 payroll deductions (Edward $2,400.00)',
      ),
    ).toBeTruthy()
  })

  it('says nothing about a window the echo cannot name', async () => {
    preview.mockImplementation(async () => ({ ...echo, derived_window: null }))
    mount()
    await waitFor(() => expect(preview).toHaveBeenCalled())
    expect(screen.queryByText(/^over /)).toBeNull()
  })
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run src/components/projection/ScenarioPanel.test.tsx`
Expected: FAIL — "Unable to find an element with the text: over Aug 2025 – Jul 2026 (12 months)".

- [ ] **Step 4: Write the card**

In `src/components/projection/ScenarioPanel.tsx`, add `formatMonth` to the format import:

```ts
import { formatCurrency, formatMonth } from '../../utils/format'
```

Reword the two hints whose derivation changed (spec §2/§3):

```ts
const HINTS: Partial<Record<ProjectionKnob, string>> = {
  monthly_contribution:
    "Derived from the months that have BOTH spending and net pay entered: (net pay − living spend − tax paid) plus every earner's payroll deductions — 401(k), ESPP and HSA. RSU vests are not included; raise it to model them.",
  annual_spend:
    'Derived from living spend over that same window, × 12. Tax payments and transfers to your own accounts are not living spend, so neither is in this figure.',
  swr: 'Derived from Settings. The FI target is annual spend ÷ this rate.',
  volatility: 'Turns the fan on; 0 turns it off.',
  inflation: 'Converts the chart to today\'s dollars; 0 reads nominal dollars.',
  contribution_growth: 'Models raises: the contribution escalates at this rate.',
}
```

Replace the `if (key !== 'monthly_contribution' || breakdown === null) return slider` block and
its `return` with:

```ts
        // The echo's own arithmetic under the contribution knob, and the WINDOW under both
        // figures the data derives (spec §3): a trailing mean is only honest beside the
        // months it averaged, and those months are no longer "the last 12" — they are the
        // last 12 that were entered AND paid. The window comes from the BASELINE echo, so it
        // keeps describing the derivation even while a typed knob overrides the value.
        const derivedWindow = baseline?.derived_window ?? null
        const windowed = key === 'monthly_contribution' || key === 'annual_spend'
        const showsBreakdown = key === 'monthly_contribution' && breakdown !== null
        if (!showsBreakdown && !(windowed && derivedWindow !== null)) return slider
        return (
          <div key={key} className="slider-box">
            {slider}
            {key === 'monthly_contribution' && breakdown !== null && (
              <span className="projection-derived">
                derived: {formatCurrency(breakdown.cash)} cash savings +{' '}
                {formatCurrency(breakdown.payroll)} payroll deductions
                {breakdown.by_person.length > 0 &&
                  ` (${breakdown.by_person.map((row) => `${row.name} ${formatCurrency(row.monthly)}`).join(' · ')})`}
              </span>
            )}
            {windowed && derivedWindow !== null && (
              <span className="projection-derived">
                over {formatMonth(derivedWindow.from)} – {formatMonth(derivedWindow.to)} (
                {derivedWindow.months} {derivedWindow.months === 1 ? 'month' : 'months'})
              </span>
            )}
          </div>
        )
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/components/projection/ScenarioPanel.test.tsx && npx tsc -b`
Expected: PASS, `tsc` clean.

- [ ] **Step 6: Prove the tests fail on a regression (mutation check)**

Change `const windowed = key === 'monthly_contribution' || key === 'annual_spend'` to
`key === 'monthly_contribution'` and run
`npx vitest run src/components/projection/ScenarioPanel.test.tsx`.
Expected: FAIL — "prints the window under both derived-from-data figures": found 1 element,
expected 2. Revert and re-run.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx eslint src/components/projection/ScenarioPanel.tsx src/components/projection/ScenarioPanel.test.tsx src/types/api.ts
git add src/components/projection/ScenarioPanel.tsx src/components/projection/ScenarioPanel.test.tsx src/types/api.ts
git commit -m "feat(projection): the Assumptions card names the matched window its derived figures came from (spec §3)"
```

---

### Task 9: the money-flow sankey draws the take-home nobody has entered yet

**Files:**
- Modify: `src/types/api.ts` (`MoneyFlowOut`, around line 1687)
- Modify: `src/charts/sankey.ts`
- Modify: `src/components/overview/moneyFlowOptions.ts`
- Modify: `src/components/overview/moneyFlowOptions.test.ts`
- Modify: `src/components/overview/MoneyFlowCard.tsx`
- Modify: `src/charts/fixtures/moneyFlow.fixture.ts`
- Create: `src/charts/fixtures/moneyFlowPending.fixture.ts`
- Modify: `src/charts/conformance.test.ts`

Spec §3: "`MoneyFlowOut` gains `take_home_pending: Decimal` and `take_home_months_entered:
int` … `retained_equity` subtracts it. The sankey draws a muted dashed node 'Take-home not
yet entered (5 months)' from gross beside take-home; the tooltip states the estimate rule.
Production today: $6,373.09 × 5 = $31,865.43."

- [ ] **Step 1: Mirror lane A's `MoneyFlowOut`**

In `src/types/api.ts`, add to `MoneyFlowOut` right after `take_home_cash: string`:

```ts
  /** The take-home of the year's UNENTERED months, estimated as the mean of the entered ones
   *  × the number missing; '0.00' once all twelve are entered (2026-09-04 honest-numbers spec
   *  §3). The server has already subtracted it from `retained_equity`, so conservation still
   *  holds with this node in the chart. Optional for the reason `MoneyFlowTaxes.niit`
   *  documents: the live server always sends it. */
  take_home_pending?: string
  /** How many of the year's twelve months have net pay entered. */
  take_home_months_entered?: number
```

- [ ] **Step 2: Widen the sankey node's `itemStyle`**

In `src/charts/sankey.ts`, replace the `itemStyle` line of `SankeyNode`:

```ts
  /** Node fill, plus the optional dashed hairline that marks a node the chart is
   *  ESTIMATING rather than reporting (the money-flow's unentered take-home). Every colour
   *  here is still a theme token — conformance walks these keys. SANKEY_MARKS sets
   *  `borderWidth: 0` for the series, so only a node that asks gets a border. */
  itemStyle: {
    color: string
    borderColor?: string
    borderWidth?: number
    borderType?: 'dashed'
  }
```

- [ ] **Step 3: Write the failing test**

In `src/components/overview/moneyFlowOptions.test.ts`, extend the `NodeLike` reader and the
`flowOut` default (a fully entered year — every existing case stays byte-identical), then
append the new describe.

Replace the `NodeLike` interface:

```ts
interface NodeLike {
  name?: string
  value?: number
  depth?: number
  itemStyle?: { color?: string; borderColor?: string; borderWidth?: number; borderType?: string }
}
```

Add to `flowOut`'s literal, after `take_home_cash: '120000.00',`:

```ts
    take_home_pending: '0.00',
    take_home_months_entered: 12,
```

Append at the end of the file:

```ts
describe('moneyFlowOption — the take-home nobody has entered yet (spec §3)', () => {
  // Production's own 2026 figures: seven months entered at a $6,373.09 mean, five missing.
  const pendingFlow = () =>
    flowOut({
      take_home_pending: '31865.43',
      take_home_months_entered: 7,
      // The server has already taken the estimate out of the residual, so the mid column
      // still sums back to gross with the new node in it.
      retained_equity: '61318.52',
    })

  it('draws it beside take-home, muted and dashed, fed from gross', () => {
    const series = sankeyOf(moneyFlowOption(pendingFlow())!)
    const name = 'Take-home not yet entered (5 months)'
    const node = series.data?.find((n) => n.name === name)
    expect(node?.depth).toBe(2) // the take-home column, not a fifth one
    expect(node?.value).toBe(31865.43)
    expect(node?.itemStyle).toEqual({
      color: MUTED,
      borderColor: MUTED,
      borderWidth: 1,
      borderType: 'dashed',
    })
    // Straight off gross, like every other mid-column terminal — and nothing flows OUT of
    // it: an estimate must not fan into categories as though it had been spent.
    expect(series.links?.filter((l) => l.target === name)).toEqual([
      { source: 'Gross income', target: name, value: 31865.43 },
    ])
    expect(series.links?.filter((l) => l.source === name)).toEqual([])
  })

  it('states the estimate rule in its tooltip', () => {
    const option = moneyFlowOption(pendingFlow())!
    const text = tooltipOf(option)({ name: 'Take-home not yet entered (5 months)' })
    expect(text).toContain('$31,865.43')
    expect(text).toContain('the average take-home of the 7 entered months × 5')
  })

  it('is absent from a fully entered year, and from a backend that cannot name it', () => {
    const full = sankeyOf(moneyFlowOption(flowOut())!)
    expect(full.data?.some((n) => n.name?.startsWith('Take-home not yet entered'))).toBe(false)
    const older = sankeyOf(
      moneyFlowOption(
        flowOut({ take_home_pending: undefined, take_home_months_entered: undefined }),
      )!,
    )
    expect(older.data?.some((n) => n.name?.startsWith('Take-home not yet entered'))).toBe(false)
  })

  it('says "1 month" for a single missing one, and carries the node into the export', () => {
    const one = flowOut({
      take_home_pending: '6373.09',
      take_home_months_entered: 11,
      retained_equity: '86810.86',
    })
    const series = sankeyOf(moneyFlowOption(one)!)
    expect(series.data?.some((n) => n.name === 'Take-home not yet entered (1 month)')).toBe(true)
    expect(moneyFlowCsv(one).rows).toContainEqual([
      'node',
      'Take-home not yet entered (1 month)',
      '',
      '6373.09',
    ])
  })

  it('refuses a negative estimate rather than drawing a backwards ribbon', () => {
    expect(moneyFlowOption(flowOut({ take_home_pending: '-1.00', take_home_months_entered: 7 }))).toBeNull()
  })
})
```

- [ ] **Step 4: Run the test to see it fail**

Run: `npx vitest run src/components/overview/moneyFlowOptions.test.ts`
Expected: FAIL — "draws it beside take-home": `node?.depth` is `undefined` (no such node).

- [ ] **Step 5: Write the builder**

In `src/components/overview/moneyFlowOptions.ts`, add the estimate to the negative backstop —
inside the `structural` array, after `...SOURCES.map((source) => flow.sources[source.key]),`:

```ts
    ...(flow.take_home_pending === undefined ? [] : [flow.take_home_pending]),
```

Insert this block immediately after the `for (const [name, value, color] of mid) { … }` loop
and before `// Take-home fans into the year's categories…`:

```ts
  // The take-home nobody has entered yet (spec §3). Without it, five unentered months of
  // paychecks sit inside `retained_equity` — the residual absorbs whatever the year cannot
  // explain, which is exactly how a data gap turns into a claim about money kept. The server
  // subtracts the estimate from the residual and hands it over NAMED, so the chart can draw
  // it beside take-home as what it is: muted like its neighbour (it IS take-home, just not on
  // record), dashed because it was computed rather than entered, and saying so on hover.
  const pending = Number(flow.take_home_pending ?? '0')
  const entered = flow.take_home_months_entered ?? 12
  const missingMonths = Math.max(0, 12 - entered)
  const pendingName = `Take-home not yet entered (${missingMonths} ${missingMonths === 1 ? 'month' : 'months'})`
  const drawsPending = missingMonths > 0 && pending >= A_CENT
  if (drawsPending) {
    // Claimed like any other name, but only when DRAWN: this label carries a count, so it
    // changes from year to year — seeding it unconditionally would make a colliding
    // category's rendering depend on how much of the year is entered.
    taken.add(pendingName)
    nodes.push({
      name: pendingName,
      value: cents(pending),
      depth: 2,
      itemStyle: { color: MUTED, borderColor: MUTED, borderWidth: 1, borderType: 'dashed' },
    })
    links.push({ source: GROSS, target: pendingName, value: cents(pending) })
  }
```

Extend the tooltip — inside the `brandTooltip` callback, after the `TAXES` branch:

```ts
    // The estimate says out loud how it was computed; the alternative is a reader who
    // believes a number nobody typed. Labels here are constants and digits — no user text.
    if (drawsPending && p && p.dataType !== 'edge' && p.name === pendingName) {
      return (
        `<strong>${formatCurrency(cents(pending))}</strong><br/>${pendingName}<br/>` +
        `Estimated: the average take-home of the ${entered} entered ` +
        `${entered === 1 ? 'month' : 'months'} × ${missingMonths}. Enter those months and this ` +
        `becomes a real figure.`
      )
    }
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run src/components/overview/moneyFlowOptions.test.ts`
Expected: PASS — the new describe plus every existing case (the default fixture is a fully
entered year, so the pinned node list is unchanged).

- [ ] **Step 7: Fixtures, roster and the card's hint**

In `src/charts/fixtures/moneyFlow.fixture.ts`, add to the payload after
`pre_tax_savings: '27300.00', take_home_cash: '120000.00', retained_equity: '93183.95',`:

```ts
      take_home_pending: '0.00', take_home_months_entered: 12,
```

Create `src/charts/fixtures/moneyFlowPending.fixture.ts`:

```ts
import type { ChartFixture } from './_types'
import { moneyFlowOption } from '../../components/overview/moneyFlowOptions'

// The pending-take-home branch (honest-numbers spec §3) — production's own 2026 figures:
// seven months entered, five estimated at $6,373.09 each. The plain moneyFlow fixture is a
// fully entered year, so it never reaches the dashed node; this one is the only place the
// grammar checks that node's colours (the projectionPinned precedent).
const fixture: ChartFixture = {
  name: 'moneyFlowPending',
  kind: 'sankey',
  ariaLabel:
    'Sankey diagram of 2026 money flow from income sources through taxes, savings and take-home cash to spending categories, with the take-home of the months not yet entered drawn as an estimate',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    moneyFlowOption({
      year: 2026, available_years: [2026], renderable: true, reason: null, warnings: [],
      sources: { salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '4000.00', investment_income: '2500.00', other_income: '1000.00', salary_people: [] },
      gross_income: '307500.00',
      taxes: { total: '67016.05', federal: '26520.00', state: '14225.00', medicare: '4345.65', social_security: '18581.40', disability: '3344.00', capital_gains: '0.00', niit: '123.45' },
      pre_tax_savings: '27300.00', take_home_cash: '44611.60', retained_equity: '136706.92',
      take_home_pending: '31865.43', take_home_months_entered: 7,
      categories: [{ name: 'Rent', amount: '24000.00' }, { name: 'Food', amount: '6000.00' }],
      other_spend: '1400.00', total_spend: '31400.00', saved: '13211.60',
    }),
}
export default fixture
```

In `src/charts/conformance.test.ts`, add to `ROSTER` right after `'moneyFlow',`:

```ts
  // …and the same builder on a year whose take-home is only part entered: the muted dashed
  // estimate node, a branch the fully-entered fixture never reaches.
  'moneyFlowPending',
```

In `src/components/overview/MoneyFlowCard.tsx`, extend the `hint` (one sentence added at the
end — the rest is untouched):

```tsx
      hint="Where the year's money went. Income comes from the year's tax inputs through the tax engine; take-home cash is the entered monthly net pay; the right-hand fan is the year's entered spending. Retained equity & other is the residual — ≈ vest shares kept + ESPP contributions + timing between W-2 income and cash. A dashed node appears when some months have no net pay entered: that take-home is estimated from the months you did enter, and hovering it says how."
```

Run: `npx vitest run src/charts/conformance.test.ts src/components/overview/MoneyFlowCard.test.tsx && npx tsc -b`
Expected: PASS, with cases named `moneyFlow conforms` and `moneyFlowPending conforms`.

- [ ] **Step 8: Prove the tests fail on a regression (mutation check)**

Change the node's `itemStyle` to `{ color: MUTED }` (drop the dashed border) and run
`npx vitest run src/components/overview/moneyFlowOptions.test.ts`.
Expected: FAIL — "draws it beside take-home, muted and dashed". Then change `depth: 2` to
`depth: 3` and run again.
Expected: FAIL — same case, on `node?.depth`. Then set the node colour to `PALETTE[1]` and run
`npx vitest run src/charts/conformance.test.ts`.
Expected: PASS (a palette hex is still a token) — so the DASH, not conformance, is what proves
the node reads as an estimate; keep both pins. Revert all three edits and re-run both files.
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
npx eslint src/charts/sankey.ts src/components/overview/moneyFlowOptions.ts src/components/overview/moneyFlowOptions.test.ts src/components/overview/MoneyFlowCard.tsx src/charts/fixtures/moneyFlow.fixture.ts src/charts/fixtures/moneyFlowPending.fixture.ts src/charts/conformance.test.ts src/types/api.ts
git add src/charts/sankey.ts src/components/overview/moneyFlowOptions.ts src/components/overview/moneyFlowOptions.test.ts src/components/overview/MoneyFlowCard.tsx src/charts/fixtures/moneyFlow.fixture.ts src/charts/fixtures/moneyFlowPending.fixture.ts src/charts/conformance.test.ts src/types/api.ts
git commit -m "feat(overview): the money flow draws unentered take-home as a muted dashed estimate instead of hiding it in the residual (spec §3)"
```

---

### Task 10: Verify the lane

**Files:** none — this task only runs, greps and commits whatever the runs touch.

- [ ] **Step 1: The full suites**

Run from the worktree root:

```bash
npx tsc -b && npx eslint . && npx vitest run
```

Expected: `tsc` silent, eslint silent, vitest green with no unhandled rejections. The
2026-09-03 baseline was 2272 frontend tests; this lane adds roughly 30, so expect ≈ 2300
passing and 0 failing.

- [ ] **Step 2: The conformance roster names every fixture this lane touched**

```bash
npx vitest run src/charts/conformance.test.ts
```

Expected: PASS, including the cases `spendingSavings conforms`, `spendingSavingsCash conforms`,
`moneyFlow conforms`, `moneyFlowPending conforms`, and the four roster cases ("every builder in
the spec has a fixture", "every fixture builds a non-null option", "names every fixture that
exists — the roster is a two-way pin", "names no fixture twice…").

- [ ] **Step 3: Grep the retired wordings out**

```bash
grep -rn "Savings rate (actual)" src
grep -rn "Net worth through" src
grep -rn "savingsRate" src
```

Expected: no output from any of the three. The first was the old single-line card title and
series name (Task 6), the second the old footer clause the balances clause replaced (Task 4),
the third the `YtdStats` field that became `cashRate` / `totalRate` (Task 3). Any hit is a call
site a task missed.

- [ ] **Step 4: Confirm the lane's own commits**

```bash
git log --oneline main..HEAD
```

Expected: nine commits, one per task (Tasks 1–9), newest first. Nothing is pushed — this lane
merges locally, like every other.

- [ ] **Step 5: Commit any stragglers**

If Steps 1–3 changed a file (a lint autofix, a missed call site), commit it:

```bash
git add -A
git commit -m "chore(honest-d): verify pass — lint and call-site fixes"
```

Expected: either a tenth commit or "nothing to commit, working tree clean". The lane is ready
to merge.

---

## Self-review

**1. Spec coverage.**

| Spec bullet | Task |
|---|---|
| §1 UI — "the badge on Spending's yearly rollup and heatmap legend names non-living categories ('tax', 'transfer')" | Task 7 (rollup rows badge the kind; the heatmap card's footer names them and says what leaves them out) |
| §2 Consumers — "Spending savings-rate chart: total rate as the line, cash rate as a second muted line, legend words 'Total (incl. payroll)' / 'Cash'" | Task 6 |
| §2 Consumers — "Spending yearly rollup: both rates, living spend, tax paid, transfers as columns" | Task 7 (plus a `Months matched` row, so the rates name their window on the same surface) |
| §2 Consumers — "Overview YTD card: headline total rate with the cash figure beside it and both windows named" | Tasks 3 (the arithmetic and the windows) and 4 (the card) |
| §2 Consumers — "Projection Assumptions card: the breakdown already printed, now sourced from the service" | Lane A re-sources it server-side; Task 8 keeps the card printing it and rewords the two hints whose derivation changed |
| §2 Consumers — "Assistant context: the same fields" | **Not lane D.** §8 gives lane A the services and wire; the assistant's context builder is backend-side and appears in no frontend lane's file list. Flagged for lane V's retire/verify sweep. |
| §3 Consumers — Overview footer: "Balances through … · Spending through … (Aug missing, Sep empty) · Net pay through …", amber when spending or net pay lags balances by ≥ 1 month | Tasks 1 (`freshnessClauses`) and 4 (the row) |
| §3 Consumers — System card freshness, same sentence | **Gap, deliberately flagged.** `components/settings/SystemCard.tsx` is in no lane's file list in §8 (E owns `CategoriesPanel.tsx` and `AccountsCard.tsx`), and it prints no month today. `freshnessClauses(coverage)` is exported from `src/components/overview/freshness.ts` precisely so that card can print the identical sentence from a `fetchCoverage()` call and one `.map` — roughly ten lines, no new logic. Raise it with lane V rather than reaching into another lane's file. |
| §3 Consumers — Attention: "August 2026 spending was never entered" / "September 2026 was saved with no spending", both linking to the wizard's spending step | Task 2 (`formatMonth`'s house spelling — "Aug 2026" — matches every other strip item; the spec's prose spells the month out) |
| §3 Consumers — "Month ribbon: the spending dot lights only for entered months … no CSS change" | Task 5 (data-only; the pin exists so the gap lists cannot be unioned back in) |
| §3 Consumers — Health card `check_zero_filled_spending` / `spending_gap` | Lane A (`services/health_checks.py`) |
| §3 Consumers — "the echo names the window (`derived_window`) and the Assumptions card prints it" | Task 8 |
| §3 Consumers — Money flow: "a muted dashed node 'Take-home not yet entered (5 months)' from gross beside take-home; the tooltip states the estimate rule" | Task 9 (plus a second roster-pinned fixture for that branch) |
| §3 Consumers — "Overview YTD card: every figure names its window … rates use `YearRollup.months_matched`" | Tasks 3 and 4 (four named windows: net worth, spend, net pay, saved; `months_matched` wins over the client's own intersection) |
| §7 Testing — "Frontend: … attention items from coverage, footer wording, YTD windows, sankey pending node conformance" | Tasks 2, 4, 3/4, 9 |
| §7 Testing — "Mutation checks" | One step per task (Tasks 1–9), each naming the edit, the case that must go red, and the revert |

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling". Every code
step carries its whole code; the four steps that say "the rest is untouched" (the savings
`ChartCard`'s other props in Task 6, the heatmap card's other props in Task 7, `MoneyFlowCard`'s
other props and the `moneyFlow` fixture's other fields in Task 9) name the exact props/fields
being replaced and leave named neighbours in place, which is an instruction, not a placeholder.
Two mechanical edits are given as exact `sed` commands (Task 3's twelve call sites) rather than
twelve rewritten blocks, with the replacement text spelled out.

**3. Type consistency with lane A's wire names (as the spec writes them).**
`CoverageOut.spending_empty` / `.spending_missing` / `.net_pay_missing` / `.latest{balances,
spending, net_pay}` (§3); `SpendingMatrix.living_total` / `.tax_total` / `.transfer_total` /
`.cash_savings` / `.payroll_savings` / `.total_savings` / `.total_savings_rate` with
`.savings_rate` KEEPING its name and meaning cash (§2); `YearRollup` carrying the same seven as
scalars plus `.months_matched`, with `net_pay_total` unchanged (§2); `CategoryOut.kind` over
`CategoryKind = 'living' | 'tax' | 'transfer'` (§1); `ProjectionOut.derived_window` as
`{from, to, months}` (§3); `MoneyFlowOut.take_home_pending` and `.take_home_months_entered`
(§3). Every one is spelled exactly as §1–§3 write it. Names this lane invents are all
client-side and used consistently across tasks: `FreshnessClause{key,text,lagging}`,
`freshnessClauses`, `spendingGaps`, `GAP_NAMES` (Tasks 1, 4); `AttentionInputs.coverage`, item
keys `spending-missing` / `spending-empty` (Tasks 2, 4); `YtdWindow{from,to,months}`,
`YtdStats.throughMonth` / `.spendWindow` / `.netPayWindow` / `.savedWindow` / `.totalSaved` /
`.cashSaved` / `.totalRate` / `.cashRate`, `windowWords` (Tasks 3, 4); `TOTAL_RATE_SERIES` /
`CASH_RATE_SERIES` (Task 6, consumed by the two fixtures and `SpendingPage.test.tsx`);
`nonLiving` (Task 7). `ytdStats` takes `(ts, yearly, dividends, coverage, todayIso)` in Task 3
and is called with exactly that order in Task 4. The one deliberate rename is
`YtdStats.savingsRate` → `.cashRate`, and Task 10's grep proves no caller kept the old name.

