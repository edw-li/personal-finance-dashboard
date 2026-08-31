# Tier 1 Plan D: Planning UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the computed-but-unrendered planning surface (design 2026-08-31, Workstream D, items D1–D5). D1: the what-if panel gains an **Input overrides** leg section — key select (label from the year payload's definitions), an `AmountInput`, a remove button; a blank value ships `null`, the endpoint's "clear this input in the scenario" spelling. D2: `SummaryPanel` gains a 7-row per-jurisdiction `data-table` (federal, state, **NIIT**, medicare, social security, disability, capital gains) × Base / Taxable / Tax / Eff. rate, with the house em-dash convention wherever a section reported nothing — including the `niit` section against a pre-C payload. D3: a **new** `MarginalPanel` below the summary — a horizontal bracket ladder for federal and state with this year's taxable income marked, plus the sentence "Your next $1,000 of ordinary income costs $X federal + $Y state (+ $Z additional Medicare when the combined-wage tier binds)", all client-side over the already-fetched bracket tables, with the math in a new pure module `src/components/taxes/marginal.ts`. D4: the withholding card gains the per-check remedy line ("Add $N per remaining paycheck (W-4 line 4c)…") and an **Apply** chip on the vest→W-2 prose that PUTs `w2_stock_rsus_sold` for the primary person and rides the page's reload chain. D5: NetWorthPage gains a compact per-owner strip under the KPI row (>1-person households only, segmented-control order), and ProjectionPage's FI-probability sub-label gains p10. **NO backend changes anywhere in this plan.**

**Architecture:** Everything hangs off payloads the pages already fetch. D1 threads the inputs payload's definitions down as a `definitions` prop (deduped by key in `TaxesPage` — overrides address the HOUSEHOLD key map, which is exactly why per-person repeats collapse) and serializes rows into `WhatIfBody.overrides`, which `src/api/whatif.ts` already types and `POST /taxes/what-if` already validates (`backend/app/api/taxes.py:1348-1352`); the response's `changed_inputs` list already renders the diffs, so there is zero output work. D2 lives inside `SummaryPanel`'s non-refusal branch (a refusal year carries null sections on the wire and already gets the missing-tables CTA instead), and reads `summary.niit` through an OPTIONAL type so stored/pre-C payloads render em-dashes rather than zeros. D3 is the one licensed exception to "never re-derive": the design ratifies pure client-side walking of the fetched tables, so the math lives in a dependency-free module (`marginal.ts`, mirroring `tax_service.walk`'s floor semantics exactly: thresholds are inclusive floors, a threshold belongs to the bracket BELOW it, non-positive income is untaxed), the chart geometry in a new `marginalLadderOption` builder beside the other pure builders in `taxChartOptions.ts`, and the panel is a fetch-free component fed `detail.summary` + `detail.brackets` (already the year's OWN status' tables). D4's Apply writes through the `values` shorthand of the existing inputs PUT (a per-person key with no owner IS the primary's column, server-side), and the page completes the loop with a new `onVestApplied` handler that adopts the echo AND remounts `InputsForm` via an epoch appended to its key — the form deliberately ignores prop replacement to protect typed work, so an external write must remount it, and the chip confirms any discard before PUTting. D5 renders `summary.owner_totals` ordered BY the owner chips (so the strip and the segmented control can never disagree) and prepends `fi_month_p10` to the existing sub-label format.

**Tech Stack:** React 19 + TypeScript 5.9 (strict) + Vitest 3 + @testing-library/react 16 + ECharts 6 (never rendered in jsdom — page/component tests mock `../EChart`/`../components/EChart` with marker divs). No new dependencies, no migrations, no backend files touched.

**Spec:** `docs/superpowers/specs/2026-08-31-tier1-trust-lifecycle-tax-planning-design.md` §Workstream D is binding. **Branch:** `tier1-batch` (Plans A → C → B land on it BEFORE this plan).

**Ratified deviation from the spec text (D4):** the spec writes `w2_stock_rsus_sold = vest.income_ytd + vest.income_projected`, but the backend computes `income_projected = income_ytd + future_vests` (`backend/app/services/withholding_calc.py:262-263`) — `income_projected` is already the FULL-year figure, so the spec's sum double-counts every past vest. The Apply chip therefore PUTs **`vest.income_projected` alone**, which is also the exact figure the prose beside the chip names ("This year's vests imply ≈$X…"). The spec's *intent* (full-year vest income into the W-2 input) is honored; Task 5 pins this with the fixture's own numbers and says so in a comment.

**House rules that bind every task:**
- Decimal **strings** on the wire; `Number()` only at display/chart boundaries. D3's module is display-bound by design and says so in its header comment.
- Comments explain constraints, not narration. No file deletions. One commit per task, conventional messages. **Never push.**
- `npx vitest run <file>` runs bare from the repo root. `npm test` = `vitest run`, `npm run lint` = `eslint .`.
- Anchors below were read at `main@e57a9bd` **before Plans A/C/B landed on `tier1-batch`** — line numbers WILL have drifted (A2 edits `NetWorthPage.tsx`; C edits `types/api.ts`, `taxChartOptions.ts`, possibly `SummaryPanel.tsx`). Every task re-verifies its anchors by the quoted code, not the line number.

---

## File structure

| File | Change |
|---|---|
| `src/components/taxes/marginal.ts` **(new)** | pure ladder math: `toBrackets`, `taxAt`, `marginalCost`, `ladderSegments`, `additionalMedicareStep`, `MARGINAL_STEP` |
| `src/components/taxes/marginal.test.ts` **(new)** | hand-derived vectors for all five functions |
| `src/components/taxes/taxChartOptions.ts` | `LadderRow` + `marginalLadderOption()` appended |
| `src/components/taxes/taxChartOptions.test.ts` | `describe('marginalLadderOption')` — 3 cases |
| `src/components/taxes/MarginalPanel.tsx` **(new)** | the D3 card (fetch-free) |
| `src/components/taxes/MarginalPanel.test.tsx` **(new)** | 6 cases |
| `src/components/taxes/SummaryPanel.tsx` | D2 table (`jurisdictionRows` + JSX in the non-refusal branch) |
| `src/components/taxes/WhatIfPanel.tsx` | D1: `OverrideDefinition`, `definitions` prop, override legs UI + `run()` serialization |
| `src/components/taxes/WhatIfPanel.test.tsx` | D1: `describe('input overrides')` — 6 cases |
| `src/components/taxes/WithholdingPanel.tsx` | D4: remedy line, Apply chip, `storedVestW2`/`inputsDirty`/`onVestApplied` props |
| `src/components/taxes/WithholdingPanel.test.tsx` | D4: `putTaxInputs` mock + 6 cases |
| `src/components/taxes/taxes.css` | `.marginal-sentence`, `.tax-jurisdiction-detail`, remedy border, chip spacing |
| `src/pages/TaxesPage.tsx` | mounts `MarginalPanel`; `overrideDefinitions()`/`vestW2Stored()` helpers; `definitions`/withholding props; `inputsEpoch` |
| `src/pages/TaxesPage.test.tsx` | WhatIfPanel mock gains `data-defs`; ~5 new cases; refusal case extended |
| `src/types/api.ts` | `niit?: CapitalGainsTaxOut` on `TaxSummaryOut` — **verify Plan C already added it; add only if absent** |
| `src/pages/NetWorthPage.tsx` | D5 owner strip under the KPI row |
| `src/pages/NetWorthPage.css` | `.networth-owner-strip` |
| `src/pages/NetWorthPage.test.tsx` | 2 new cases |
| `src/pages/ProjectionPage.tsx` | D5 p10 in the FI-probability sub-label + hint |
| `src/pages/ProjectionPage.test.tsx` | 1 pin updated, 1 case added |

---

## Phase 0 — Preconditions & baseline

### Task 0: Verify the branch state, Plan C's NIIT section, and the baseline

**Files:** none (environment only)

- [ ] **Step 1: Confirm the branch and a clean tree.**

```bash
git status --porcelain            # expected: EMPTY
git rev-parse --abbrev-ref HEAD   # expected: tier1-batch
```

If the tree is dirty or the branch is wrong, **STOP and report** — Plans A/C/B were to land on `tier1-batch` before this one.

- [ ] **Step 2: Verify Plan C's `niit` section exists (D2 renders it).**

```bash
grep -n "niit" backend/app/schemas/taxes.py | head -5
grep -n "niit" src/types/api.ts | head -5
grep -n "niit\|NIIT" src/components/taxes/taxChartOptions.ts | head -5
```

Expected: a `niit` field on the backend `TaxSummaryOut`, a `niit` member on the frontend `TaxSummaryOut` (Plan C's spec says the frontend types extend with it), and NIIT handling in the chart builders. If the **frontend type** is missing, Task 3 Step 1 adds it (the fallback is written there); if the **backend** field is missing, Plan C has not merged — **STOP and report**.

- [ ] **Step 3: Note the drifted anchors.**

```bash
grep -n "legendSelected" src/pages/NetWorthPage.tsx | head -6
grep -n "WhatIfPanel\|WithholdingPanel\|SummaryPanel\|InputsForm" src/pages/TaxesPage.tsx | head -12
```

Expected: Plan A2 split the net-worth legend state into two objects (two states/merge handlers instead of the single `legendSelected` at old `:139-145`) — Task 6 edits AROUND whatever shape landed; the four taxes panels still mount in the order summary → withholding → what-if → inputs → brackets. Record the actual line numbers for Tasks 2/4/5/6.

- [ ] **Step 4: Record the baseline.**

```bash
npx vitest run 2>&1 | tail -5
npx tsc -b
```

Expected: vitest fully green (count will exceed the pre-batch 1284 — A/C/B added tests; record the number), `tsc -b` silent. A red baseline is a **STOP and report** — do not build on it.

---

## Phase 1 — D3: the pure ladder-math module

### Task 1: `src/components/taxes/marginal.ts` + hand-derived vectors

**Files:**
- `src/components/taxes/marginal.test.ts` **(new)**
- `src/components/taxes/marginal.ts` **(new)**

- [ ] **Step 1: Write the failing test file.** Create `src/components/taxes/marginal.test.ts` with EXACTLY this content:

```ts
import { describe, expect, it } from 'vitest'
import type { TaxBracketOut } from '../../types/api'
import {
  additionalMedicareStep,
  ladderSegments,
  marginalCost,
  taxAt,
  toBrackets,
} from './marginal'

// A 2024-single-shaped federal table, SHUFFLED on purpose: order must come from the
// thresholds, never from bracket_index or row order (the server sorts defensively too).
const FED_ROWS: TaxBracketOut[] = [
  { bracket_index: 3, rate: '0.2200', threshold: '47150.00' },
  { bracket_index: 1, rate: '0.1000', threshold: '0.00' },
  { bracket_index: 4, rate: '0.2400', threshold: '100525.00' },
  { bracket_index: 2, rate: '0.1200', threshold: '11600.00' },
]
const FED = toBrackets(FED_ROWS)

// The Medicare pair: 1.45% base, 2.35% additional tier above 200k.
const MEDICARE = toBrackets([
  { bracket_index: 1, rate: '0.014500', threshold: '0.00' },
  { bracket_index: 2, rate: '0.023500', threshold: '200000.00' },
])

describe('toBrackets', () => {
  it('parses the wire strings and sorts ascending by threshold', () => {
    expect(FED).toEqual([
      { rate: 0.1, floor: 0 },
      { rate: 0.12, floor: 11600 },
      { rate: 0.22, floor: 47150 },
      { rate: 0.24, floor: 100525 },
    ])
  })
})

describe('taxAt (mirror of tax_service.walk)', () => {
  it('taxes nothing at zero or negative income', () => {
    expect(taxAt(FED, 0)).toBe(0)
    expect(taxAt(FED, -1)).toBe(0)
  })

  it('gives a threshold to the bracket BELOW it', () => {
    // 11600 × 10% = 1160 — the 12% bracket contributes nothing at exactly its own floor
    // (the engine's documented 2024-federal example, tax_service.py walk docstring).
    expect(taxAt(FED, 11600)).toBeCloseTo(1160, 6)
  })

  it('walks a mid-bracket income by hand', () => {
    // 11600×.10 + 35550×.12 + 2850×.22 = 1160 + 4266 + 627 = 6053
    expect(taxAt(FED, 50000)).toBeCloseTo(6053, 6)
    // 1160 + 4266 + 53375×.22 (=11742.50) + 19475×.24 (=4674) = 21842.50
    expect(taxAt(FED, 120000)).toBeCloseTo(21842.5, 6)
  })
})

describe('marginalCost', () => {
  it('prices $1,000 sitting fully inside one bracket', () => {
    expect(marginalCost(FED, 50000)).toBe(220) // 1000 × 22%
  })

  it('prices a boundary straddle piecewise', () => {
    // 650 more at 12% up to 47150 (=78) + 350 at 22% (=77) = 155
    expect(marginalCost(FED, 46500)).toBe(155)
  })

  it('starts at the bottom bracket for zero or negative income', () => {
    expect(marginalCost(FED, 0)).toBe(100) // 1000 × 10%
    // The walk clamps the non-positive side to 0, so only the positive half is taxed.
    expect(marginalCost(FED, -500)).toBe(50) // 500 × 10%
  })

  it('takes a custom step', () => {
    expect(marginalCost(FED, 50000, 100)).toBe(22)
  })
})

describe('ladderSegments', () => {
  it('marks the containing bracket and leaves the top ceiling open', () => {
    expect(ladderSegments(FED, 50000)).toEqual([
      { rate: 0.1, floor: 0, ceiling: 11600, current: false },
      { rate: 0.12, floor: 11600, ceiling: 47150, current: false },
      { rate: 0.22, floor: 47150, ceiling: 100525, current: true },
      { rate: 0.24, floor: 100525, ceiling: null, current: false },
    ])
  })

  it('keeps income exactly ON a floor in the bracket below', () => {
    const onBoundary = ladderSegments(FED, 47150)
    expect(onBoundary[1].current).toBe(true) // the 12% bracket owns its ceiling
    expect(onBoundary[2].current).toBe(false)
  })

  it('marks nothing on a zero-income year and answers [] for an empty table', () => {
    expect(ladderSegments(FED, 0).every((segment) => !segment.current)).toBe(true)
    expect(ladderSegments([], 50000)).toEqual([])
  })
})

describe('additionalMedicareStep', () => {
  it('prices the surcharge from the stored tier difference, at cents', () => {
    // (0.0235 − 0.0145) × 1000 — the float noise (…000002) must land back on 9 exactly.
    expect(additionalMedicareStep(MEDICARE, 250000)).toBe(9)
  })

  it('stays silent below the tier, exactly ON it, and with no tier at all', () => {
    expect(additionalMedicareStep(MEDICARE, 150000)).toBeNull()
    expect(additionalMedicareStep(MEDICARE, 200000)).toBeNull() // the floor belongs below
    expect(additionalMedicareStep([{ rate: 0.0145, floor: 0 }], 250000)).toBeNull()
    expect(additionalMedicareStep([], 250000)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail** (module does not exist):

```bash
npx vitest run src/components/taxes/marginal.test.ts
```

Expected: FAIL — cannot resolve `./marginal`.

- [ ] **Step 3: Write the module.** Create `src/components/taxes/marginal.ts` with EXACTLY this content:

```ts
// Pure marginal-rate math for the taxes page — no React, no fetching, no echarts. This is
// the ONE corner of the app licensed to do money arithmetic client-side, because its whole
// job is a planning figure the server deliberately does not compute (design 2026-08-31 §D3:
// "pure client-side — walk the already-fetched bracket tables"). Number() here is
// display-bound: nothing derived in this file is ever sent back to the API.
//
// Bracket semantics mirror backend/app/services/tax_service.py `walk` exactly: thresholds
// are inclusive FLOORS (the API validates ascending order with thresholds[0] == 0), a
// threshold belongs to the bracket BELOW it, and non-positive income is not taxed. Every
// function below assumes ascending order — toBrackets is the only door in and sorts.
import type { TaxBracketOut } from '../../types/api'

export interface Bracket {
  rate: number
  floor: number
}

export interface LadderSegment {
  rate: number
  floor: number
  /** The next bracket's floor; null on the unbounded top bracket. */
  ceiling: number | null
  /** Whether taxable income lands HERE (floor < ti <= ceiling — the walk's boundary rule). */
  current: boolean
}

/** The sentence's step: "your next $1,000". */
export const MARGINAL_STEP = 1000

// Display-only cents rounding (taxChartOptions' roundTo): the walk is float arithmetic,
// and a marginal figure must land back on cents before formatCurrency sees it.
function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Wire rows → sorted numeric brackets. bracket_index is ignored — order comes from the
 *  thresholds, defensively (the server's own posture). */
export function toBrackets(rows: TaxBracketOut[]): Bracket[] {
  return rows
    .map((row) => ({ rate: Number(row.rate), floor: Number(row.threshold) }))
    .sort((a, b) => a.floor - b.floor)
}

/** Progressive walk — tax_service.walk in floats. Full precision; callers round. */
export function taxAt(brackets: Bracket[], income: number): number {
  if (income <= 0) return 0
  let total = 0
  for (const [index, bracket] of brackets.entries()) {
    if (income <= bracket.floor) break
    const ceiling = index + 1 < brackets.length ? brackets[index + 1].floor : income
    total += (Math.min(income, ceiling) - bracket.floor) * bracket.rate
  }
  return total
}

/** What the NEXT `step` dollars of ordinary income cost in this table, at cents. */
export function marginalCost(
  brackets: Bracket[],
  taxableIncome: number,
  step = MARGINAL_STEP,
): number {
  return roundTo(taxAt(brackets, taxableIncome + step) - taxAt(brackets, taxableIncome), 2)
}

/** One jurisdiction's ladder rows, the containing bracket marked. Empty table → []. */
export function ladderSegments(brackets: Bracket[], taxableIncome: number): LadderSegment[] {
  return brackets.map((bracket, index) => {
    const ceiling = index + 1 < brackets.length ? brackets[index + 1].floor : null
    return {
      rate: bracket.rate,
      floor: bracket.floor,
      ceiling,
      // ti <= 0 sits nowhere (nothing is taxed), and income exactly ON a floor still sits
      // in the bracket beneath — both are the walk's own rules, restated as geometry.
      current:
        taxableIncome > bracket.floor && (ceiling === null || taxableIncome <= ceiling),
    }
  })
}

/**
 * The additional-Medicare tier's bite on the next `step` dollars of WAGES: (top rate minus
 * the rate below it) × step, at cents — the 0.9% surcharge priced from the STORED table's
 * own numbers, never a literal. Null when the table has fewer than two tiers or combined
 * wages do not sit strictly ABOVE the top floor (a wage exactly ON the floor belongs to
 * the tier below — the walk's boundary rule again).
 */
export function additionalMedicareStep(
  brackets: Bracket[],
  taxableWages: number,
  step = MARGINAL_STEP,
): number | null {
  if (brackets.length < 2) return null
  const top = brackets[brackets.length - 1]
  if (taxableWages <= top.floor) return null
  return roundTo((top.rate - brackets[brackets.length - 2].rate) * step, 2)
}
```

- [ ] **Step 4: Run the tests.**

```bash
npx vitest run src/components/taxes/marginal.test.ts
```

Expected: `Test Files  1 passed`, `Tests  13 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/taxes/marginal.ts src/components/taxes/marginal.test.ts
git commit -m "feat(taxes): pure marginal-rate math module (D3)"
```

---

## Phase 2 — D3: the ladder option builder and the panel

### Task 2: `marginalLadderOption` + `MarginalPanel` + the TaxesPage mount

**Files:**
- `src/components/taxes/taxChartOptions.ts` (append after `taxTrendCsv`, end of file — C's NIIT edits shifted earlier anchors)
- `src/components/taxes/taxChartOptions.test.ts` (append a describe block)
- `src/components/taxes/MarginalPanel.tsx` **(new)**
- `src/components/taxes/MarginalPanel.test.tsx` **(new)**
- `src/components/taxes/taxes.css` (append)
- `src/pages/TaxesPage.tsx` (import; mount directly after `<SummaryPanel …/>`, which sat at `:652-656` pre-batch)
- `src/pages/TaxesPage.test.tsx` (one new case)

- [ ] **Step 1: Write the failing builder tests.** Append to `src/components/taxes/taxChartOptions.test.ts` (inside the file's top-level scope, after the last existing describe; reuse the file's existing imports and ADD `marginalLadderOption`, `LadderRow` to the import from `'./taxChartOptions'` and `SEQUENTIAL_BLUE` to the theme import if not already imported):

```ts
describe('marginalLadderOption', () => {
  const fedRow: LadderRow = {
    label: 'Federal',
    taxableIncome: 50000,
    segments: [
      { rate: 0.1, floor: 0, ceiling: 11600, current: false },
      { rate: 0.12, floor: 11600, ceiling: 47150, current: false },
      { rate: 0.22, floor: 47150, ceiling: 100525, current: true },
      { rate: 0.24, floor: 100525, ceiling: null, current: false },
    ],
  }
  const stateRow: LadderRow = {
    label: 'State',
    taxableIncome: 60000,
    segments: [
      { rate: 0.01, floor: 0, ceiling: 10000, current: false },
      { rate: 0.093, floor: 10000, ceiling: null, current: true },
    ],
  }

  it('stacks one series per bracket slot plus the income marker', () => {
    const option = marginalLadderOption([fedRow, stateRow])!
    const series = option.series as {
      name: string
      type: string
      stack?: string
      data: ({ value: number; itemStyle: { color: string } } | null | (number | string)[])[]
    }[]
    // Four bracket slots (the deeper table's count) + the marker.
    expect(series).toHaveLength(5)
    expect(series.slice(0, 4).every((s) => s.stack === 'ladder')).toBe(true)
    // Spans are the bracket widths; the CURRENT bracket takes the bright slot, the rest
    // alternate the two mid tones so adjacent segments read apart.
    const fed0 = series[0].data[0] as { value: number; itemStyle: { color: string } }
    const fed2 = series[2].data[0] as { value: number; itemStyle: { color: string } }
    expect(fed0.value).toBe(11600)
    expect(fed0.itemStyle.color).toBe(SEQUENTIAL_BLUE[5])
    expect(fed2.value).toBe(53375) // 100525 − 47150
    expect(fed2.itemStyle.color).toBe(SEQUENTIAL_BLUE[10])
    // The state lane has two brackets: slots 3 and 4 hold nothing for it.
    expect(series[2].data[1]).toBeNull()
    expect(series[3].data[1]).toBeNull()
    // The marker rides last, one diamond per lane at that lane's own taxable income.
    expect(series[4].name).toBe('Taxable income')
    expect(series[4].type).toBe('scatter')
    expect(series[4].data).toEqual([
      [50000, 'Federal'],
      [60000, 'State'],
    ])
  })

  it('caps the open top bracket 15% past the larger of income and top floor', () => {
    const option = marginalLadderOption([fedRow, stateRow])!
    const series = option.series as { data: ({ value: number } | null)[] }[]
    // Federal: max(50000, 100525) × 1.15 = 115603.75 → span 15078.75.
    expect((series[3].data[0] as { value: number }).value).toBe(15078.75)
    // State: max(60000, 10000) × 1.15 = 69000 → span 59000.
    expect((series[1].data[1] as { value: number }).value).toBe(59000)
  })

  it('returns null with nothing drawable', () => {
    expect(marginalLadderOption([])).toBeNull()
    // A one-bracket table at $0 on a zero-income year caps at 0 — an empty lane, not a bar.
    expect(
      marginalLadderOption([
        {
          label: 'Federal',
          taxableIncome: 0,
          segments: [{ rate: 0.1, floor: 0, ceiling: null, current: false }],
        },
      ]),
    ).toBeNull()
  })
})
```

Run `npx vitest run src/components/taxes/taxChartOptions.test.ts` — expected: FAIL (no `marginalLadderOption` export).

- [ ] **Step 2: Append the builder to `src/components/taxes/taxChartOptions.ts`.** Add `LadderSegment` to the imports (`import type { LadderSegment } from './marginal'`) and append at the end of the file:

```ts
// --- D3: the marginal-rate ladder (design 2026-08-31 §D3) ------------------------------

export interface LadderRow {
  label: string
  segments: LadderSegment[]
  /** Number(summary.<jurisdiction>.taxable_income) — the ◆ marker's x position. */
  taxableIncome: number
}

// Three slots of the ONE hue family (the ≤3-hue law): adjacent segments alternate the two
// mid tones so their seam reads at a glance, and the bracket the income sits in takes the
// bright slot. All three sit at/above SEQUENTIAL_BLUE[4], the ramp's documented 3:1 floor.
const LADDER_BASE_A = SEQUENTIAL_BLUE[5]
const LADDER_BASE_B = SEQUENTIAL_BLUE[7]
const LADDER_CURRENT = SEQUENTIAL_BLUE[10]

/** Drawn ceiling of a lane's unbounded top bracket: 15% past the larger of the income and
 *  the top floor — headroom enough to read "and up" without dwarfing the lower spans. */
function ladderCap(row: LadderRow): number {
  const top = row.segments[row.segments.length - 1]
  return roundTo(Math.max(row.taxableIncome, top.floor) * 1.15, 2)
}

/**
 * Horizontal bracket ladder: one category lane per jurisdiction, one stacked-bar series
 * per bracket slot (a lane with fewer brackets holds null in the extra slots), and a
 * scatter diamond marking each lane's own taxable income — the two lanes have DIFFERENT
 * taxable incomes (state deductions differ), which is why a single markLine cannot do it.
 * Returns null when no lane is drawable — the caller renders its empty note.
 */
export function marginalLadderOption(rows: LadderRow[]): EChartsOption | null {
  const drawable = rows.filter((row) => row.segments.length > 0 && ladderCap(row) > 0)
  if (drawable.length === 0) return null

  interface Cell {
    span: number
    color: string
    rate: number
    floor: number
    ceiling: number | null
  }
  // cells[laneIndex][slotIndex] — the tooltip reads the same table the series are built of.
  const cells: Cell[][] = drawable.map((row) => {
    const cap = ladderCap(row)
    return row.segments.map((segment, i) => ({
      span: roundTo((segment.ceiling ?? cap) - segment.floor, 2),
      color: segment.current ? LADDER_CURRENT : i % 2 === 0 ? LADDER_BASE_A : LADDER_BASE_B,
      rate: segment.rate,
      floor: segment.floor,
      ceiling: segment.ceiling,
    }))
  })
  const maxSegments = Math.max(...cells.map((lane) => lane.length))

  return {
    grid: { left: 70, right: 24, top: 12, bottom: 28 },
    tooltip: {
      // Item trigger: an axis tooltip would announce every segment of the lane at once.
      // Own constants and formatted numbers only — no user text reaches this HTML.
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        const cell = cells[p.dataIndex ?? 0]?.[p.seriesIndex ?? 0]
        if (!cell) return ''
        const lane = drawable[p.dataIndex ?? 0]
        const range =
          cell.ceiling === null
            ? `${formatCurrency(cell.floor)} and up`
            : `${formatCurrency(cell.floor)} – ${formatCurrency(cell.ceiling)}`
        return `${lane.label} — <strong>${formatPct(cell.rate, { signed: false })}</strong> bracket<br/>${range}`
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    // inverse, so the first lane (Federal) reads on TOP the way the sentence orders them.
    yAxis: { type: 'category', data: drawable.map((row) => row.label), inverse: true },
    series: [
      ...Array.from({ length: maxSegments }, (_, i) => ({
        name: `Bracket ${i + 1}`,
        type: 'bar' as const,
        stack: 'ladder',
        barMaxWidth: 26,
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK } },
        data: cells.map((lane) =>
          lane[i] === undefined
            ? null
            : { value: lane[i].span, itemStyle: { color: lane[i].color } },
        ),
      })),
      {
        name: 'Taxable income',
        type: 'scatter' as const,
        symbol: 'diamond',
        symbolSize: 11,
        itemStyle: { color: INK },
        z: 10,
        data: drawable.map((row) => [row.taxableIncome, row.label]),
        tooltip: {
          formatter: (params) => {
            const p = Array.isArray(params) ? params[0] : params
            const lane = drawable[p.dataIndex ?? 0]
            return lane === undefined
              ? ''
              : `${lane.label} taxable income<br/><strong>${formatCurrency(lane.taxableIncome)}</strong>`
          },
        },
      },
    ],
  }
}
```

If `SEQUENTIAL_BLUE`, `INK`, `SURFACE`, `formatPct` are not already in this file's imports after Plan C's edits, add them to the existing import statements (they were all imported pre-batch except `formatPct` — check). Run the builder tests green:

```bash
npx vitest run src/components/taxes/taxChartOptions.test.ts
```

Expected: all existing cases + the 3 new ones pass.

- [ ] **Step 3: Write the failing panel tests.** Create `src/components/taxes/MarginalPanel.test.tsx` with EXACTLY this content:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaxBracketsOut, TaxSummaryOut } from '../../types/api'
import MarginalPanel from './MarginalPanel'

// echarts needs a real canvas and is NEVER rendered in jsdom (house law): what the ladder
// DRAWS is pinned in taxChartOptions.test.ts; this file only asks whether it is on screen.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option }: { option: { series?: { name?: string }[] } }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
      }),
  }
})

function bracketsFixture(
  over: Partial<TaxBracketsOut['jurisdictions']> = {},
): TaxBracketsOut {
  return {
    year: 2026,
    filing_status: 'single',
    statuses_with_rows: ['single'],
    jurisdictions: {
      federal: [
        { bracket_index: 1, rate: '0.1000', threshold: '0.00' },
        { bracket_index: 2, rate: '0.1200', threshold: '11600.00' },
        { bracket_index: 3, rate: '0.2200', threshold: '47150.00' },
        { bracket_index: 4, rate: '0.2400', threshold: '100525.00' },
      ],
      state: [
        { bracket_index: 1, rate: '0.0100', threshold: '0.00' },
        { bracket_index: 2, rate: '0.0930', threshold: '10000.00' },
      ],
      medicare: [
        { bracket_index: 1, rate: '0.014500', threshold: '0.00' },
        { bracket_index: 2, rate: '0.023500', threshold: '200000.00' },
      ],
      social_security: [],
      disability: [],
      capital_gains: [],
      ...over,
    },
  }
}

// Taxable incomes chosen against the tables above so every figure is hand-derivable:
// federal 50000 → next $1,000 at 22% = $220; state 60000 → 9.3% = $93; combined wages
// 250000 sit above the 200k Medicare tier → (2.35% − 1.45%) × 1000 = $9.
function summaryFixture(over: Partial<TaxSummaryOut> = {}): TaxSummaryOut {
  const wage = {
    w2_income: '260000.00',
    taxable_wages: '250000.00',
    tax: '0.00',
    effective_rate: null,
  }
  return {
    year: 2026,
    federal: {
      agi: '65000.00', taxable_income: '50000.00', tax: '6053.00', effective_rate: '0.093123',
    },
    state: {
      agi: '65000.00', taxable_income: '60000.00', tax: '4750.00', effective_rate: '0.073077',
    },
    medicare: wage,
    social_security: wage,
    disability: wage,
    capital_gains: {
      taxable_income: '50000.00', gains_amount: '0.00', tax: '0.00', effective_rate: null,
    },
    totals: {
      gross_income: '65000.00', total_income: '65000.00', total_tax: '10803.00',
      take_home: '54197.00', effective_rate: '0.166200',
    },
    warnings: [],
    ...over,
  }
}

afterEach(cleanup)

describe('MarginalPanel', () => {
  it('prices the next $1,000 per jurisdiction, with the Medicare tier clause', () => {
    render(<MarginalPanel summary={summaryFixture()} brackets={bracketsFixture()} />)
    expect(
      screen.getByText(
        'Your next $1,000 of ordinary income costs $220.00 federal + $93.00 state + $9.00 additional Medicare (combined wages sit above the top Medicare tier).',
      ),
    ).toBeTruthy()
    // Drawable tables → the ladder is on screen, marker series and all.
    expect(screen.getByTestId('echart').getAttribute('data-series')).toContain('Taxable income')
  })

  it('drops the Medicare clause when combined wages sit below the tier', () => {
    const summary = summaryFixture()
    summary.medicare = { ...summary.medicare, taxable_wages: '150000.00' }
    render(<MarginalPanel summary={summary} brackets={bracketsFixture()} />)
    expect(
      screen.getByText('Your next $1,000 of ordinary income costs $220.00 federal + $93.00 state.'),
    ).toBeTruthy()
  })

  it('names only the jurisdictions that HAVE a table — no $0.00 for a missing one', () => {
    render(<MarginalPanel summary={summaryFixture()} brackets={bracketsFixture({ state: [] })} />)
    expect(
      screen.getByText(
        'Your next $1,000 of ordinary income costs $220.00 federal + $9.00 additional Medicare (combined wages sit above the top Medicare tier).',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/state/)).toBeNull()
  })

  it('offers the empty note when neither ordinary table exists', () => {
    render(
      <MarginalPanel
        summary={summaryFixture()}
        brackets={bracketsFixture({ federal: [], state: [] })}
      />,
    )
    expect(screen.getByText(/the ladder has nothing to walk/i)).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('renders nothing at all on a refusal year', () => {
    // The router's refusal payload carries NO sections (they are null on the wire); the
    // summary card above owns that call to action, and a second card would be noise.
    const refused = {
      year: 2026,
      brackets_missing_for_status: ['federal'],
      warnings: [],
    } as unknown as TaxSummaryOut
    const { container } = render(<MarginalPanel summary={refused} brackets={bracketsFixture()} />)
    expect(container.firstChild).toBeNull()
  })

  it('keeps the sentence but skips the chart when the ladder is undrawable', () => {
    // One bracket at $0 on a zero-income year: the cap computes to 0 and there is no bar
    // to draw — but the next $1,000 still has a price, and the sentence carries it.
    const summary = summaryFixture()
    summary.federal = { ...summary.federal, taxable_income: '0.00' }
    summary.medicare = { ...summary.medicare, taxable_wages: '0.00' }
    render(
      <MarginalPanel
        summary={summary}
        brackets={bracketsFixture({
          federal: [{ bracket_index: 1, rate: '0.1000', threshold: '0.00' }],
          state: [],
        })}
      />,
    )
    expect(
      screen.getByText('Your next $1,000 of ordinary income costs $100.00 federal.'),
    ).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })
})
```

Run `npx vitest run src/components/taxes/MarginalPanel.test.tsx` — expected: FAIL (no component).

- [ ] **Step 4: Write the panel.** Create `src/components/taxes/MarginalPanel.tsx` with EXACTLY this content:

```tsx
import { useMemo } from 'react'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import type { TaxBracketsOut, TaxSummaryOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import {
  additionalMedicareStep,
  ladderSegments,
  marginalCost,
  toBrackets,
} from './marginal'
import { marginalLadderOption } from './taxChartOptions'
import type { LadderRow } from './taxChartOptions'
// This component's own sheet, like its siblings: the app-wide vocabulary (.card/.eyebrow/
// .empty-note/.drill-hint) is panels.css, which the PAGE imports.
import './taxes.css'

/**
 * Where this year's taxable income sits in the federal and state bracket ladders, and what
 * the next $1,000 of ordinary income costs. Everything here is CLIENT arithmetic over two
 * payloads the page already holds — the year's summary and its own status' bracket tables —
 * because the answer is a planning figure the engine deliberately does not store (design
 * 2026-08-31 §D3). The one licensed exception to "never re-derive": nothing computed here
 * is written anywhere or fed back to the API.
 */
export default function MarginalPanel({
  summary,
  brackets,
}: {
  summary: TaxSummaryOut
  /** The year's OWN status' tables — the payload the engine walks (TaxesPage always names
   *  the year's filing status on the brackets GET, never the server's 'single' default). */
  brackets: TaxBracketsOut
}) {
  // Non-empty means the engine REFUSED and every summary section is null on the wire —
  // there is no taxable income to place on a ladder, and the summary card above already
  // carries the missing-tables call to action.
  const refused = (summary.brackets_missing_for_status ?? []).length > 0

  // Memoized: EChart keys its redraw effect on [option] with notMerge, so a fresh object
  // every render would replay the chart on unrelated parent state (AllocationPanel's note).
  const model = useMemo(() => {
    if (refused) return null
    const federal = toBrackets(brackets.jurisdictions.federal ?? [])
    const state = toBrackets(brackets.jurisdictions.state ?? [])
    const medicare = toBrackets(brackets.jurisdictions.medicare ?? [])
    // Number() at the display boundary — see the module header's license.
    const federalIncome = Number(summary.federal.taxable_income)
    const stateIncome = Number(summary.state.taxable_income)
    const rows: LadderRow[] = []
    if (federal.length > 0)
      rows.push({
        label: 'Federal',
        segments: ladderSegments(federal, federalIncome),
        taxableIncome: federalIncome,
      })
    if (state.length > 0)
      rows.push({
        label: 'State',
        segments: ladderSegments(state, stateIncome),
        taxableIncome: stateIncome,
      })
    // A jurisdiction with NO table says nothing — an empty walk prices to $0.00, which
    // would read as "state is free" rather than "state is not entered".
    const parts = [
      ...(federal.length > 0
        ? [`${formatCurrency(marginalCost(federal, federalIncome))} federal`]
        : []),
      ...(state.length > 0
        ? [`${formatCurrency(marginalCost(state, stateIncome))} state`]
        : []),
    ]
    const medicareStep = additionalMedicareStep(
      medicare,
      Number(summary.medicare.taxable_wages),
    )
    return { option: marginalLadderOption(rows), parts, medicareStep }
  }, [summary, brackets, refused])

  if (model === null) return null

  return (
    <section className="card">
      <h2 className="eyebrow">
        Marginal rates — {summary.year}
        <InfoHint text="Where this year&apos;s taxable income (◆) sits in the bracket ladders, and what the next $1,000 of ordinary income costs. Computed in the browser from the stored tables — nothing here is saved." />
      </h2>
      {model.parts.length === 0 ? (
        <p className="empty-note">
          No federal or state bracket tables for this year yet — the ladder has nothing to
          walk. Enter them in the bracket tables below.
        </p>
      ) : (
        <>
          <p className="marginal-sentence">
            {`Your next $1,000 of ordinary income costs ${model.parts.join(' + ')}${
              model.medicareStep === null
                ? ''
                : ` + ${formatCurrency(model.medicareStep)} additional Medicare (combined wages sit above the top Medicare tier)`
            }.`}
          </p>
          {model.option !== null && <EChart option={model.option} height={170} />}
          <p className="drill-hint">
            Bracket boundaries and rates are this year&apos;s stored tables for its filing
            status. Capital gains stack separately and are not on this ladder.
          </p>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Add the sentence's CSS.** Append to `src/components/taxes/taxes.css`:

```css
/* --- marginal panel --- */

/* The headline answer, not a caveat: body ink above the ladder it summarizes. */
.marginal-sentence {
  margin: 0.2rem 0 0.9rem;
  font-size: 0.9rem;
}
```

Run `npx vitest run src/components/taxes/MarginalPanel.test.tsx` — expected: `Tests  6 passed`.

- [ ] **Step 6: Mount it on the page.** In `src/pages/TaxesPage.tsx`: add `import MarginalPanel from '../components/taxes/MarginalPanel'` beside the other panel imports, and insert directly AFTER the `<SummaryPanel …/>` element (pre-batch `:652-656`):

```tsx
          {/* D3 (2026-08-31): client-side ladder over the SAME two payloads the panels
              around it read — the summary and the year's own status' tables. Not keyed:
              both props are per-year payloads the load effect already replaces whole. */}
          <MarginalPanel summary={detail.summary} brackets={detail.brackets} />
```

- [ ] **Step 7: Pin the page wiring.** In `src/pages/TaxesPage.test.tsx`, add after the existing waterfall/tiles case (`'renders the totals tiles …'`, near pre-batch `:750-772`):

```tsx
  it('mounts the marginal card from the year’s own summary and tables', async () => {
    renderPage()
    // bracketsFor carries one federal bracket (10% at $0) and no state table, and the
    // fixture year's taxable income is 0: the sentence prices the bottom bracket while the
    // ladder itself is undrawable. The default beforeEach leaves the trend feed EMPTY, so
    // the page's only chart is the waterfall — the count must stay 1, proving the card
    // added no chart here.
    expect(await screen.findByText('Marginal rates — 2024')).toBeTruthy()
    expect(
      screen.getByText('Your next $1,000 of ordinary income costs $100.00 federal.'),
    ).toBeTruthy()
    await waitFor(() => expect(screen.getAllByTestId('echart')).toHaveLength(1))
  })
```

Also extend the EXISTING refusal-year case (the one asserting `queryAllByTestId('echart')).toHaveLength(0)`, pre-batch `:1374`) with one line:

```tsx
    expect(screen.queryByText(/Marginal rates —/)).toBeNull()
```

- [ ] **Step 8: Run the touched suites.**

```bash
npx vitest run src/components/taxes/MarginalPanel.test.tsx src/components/taxes/taxChartOptions.test.ts src/pages/TaxesPage.test.tsx
```

Expected: all green — the existing page pins at `toHaveLength(2)` / `toHaveLength(1)` / `toHaveLength(0)` still hold because the fixture ladder is undrawable (that is deliberate; do NOT "fix" them by loosening).

- [ ] **Step 9: Commit.**

```bash
git add src/components/taxes/marginal.ts src/components/taxes/MarginalPanel.tsx src/components/taxes/MarginalPanel.test.tsx src/components/taxes/taxChartOptions.ts src/components/taxes/taxChartOptions.test.ts src/components/taxes/taxes.css src/pages/TaxesPage.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat(taxes): marginal-rate ladder panel below the summary (D3)"
```

---

## Phase 3 — D2: the per-jurisdiction detail table

### Task 3: `SummaryPanel` gains the 7-row table (with the NIIT row)

**Files:**
- `src/types/api.ts` (verify/extend `TaxSummaryOut`)
- `src/components/taxes/SummaryPanel.tsx` (module-level helper + JSX after the `kpi-row` div, pre-batch `:157-181`)
- `src/components/taxes/taxes.css` (append)
- `src/pages/TaxesPage.test.tsx` (2 new cases; SummaryPanel's behavior is tested here — it has no test file of its own)

- [ ] **Step 1: Verify (or add) the optional `niit` type.**

```bash
grep -n "niit" src/types/api.ts
```

Plan C should already have added it. If — and only if — it is absent, add to `TaxSummaryOut` in `src/types/api.ts`, directly after the `capital_gains: CapitalGainsTaxOut` line (pre-batch `:677`):

```ts
  // NIIT (workstream C, 2026-08-31): additive and OPTIONAL — stored what-if payloads and
  // the pinned pre-C fixtures lack it, and its absence renders as em-dashes, never zeros.
  // Same shape as capital_gains: gains_amount carries net investment income, and
  // taxable_income the surcharged base (min(NII, MAGI excess)).
  niit?: CapitalGainsTaxOut
```

If C's landed type differs in SHAPE (not `CapitalGainsTaxOut`), adapt `jurisdictionRows` below to C's field names and note the substitution in the commit message — the row contract stays Base=NII, Taxable=surcharged base, Tax, Eff. rate.

- [ ] **Step 2: Write the failing page tests.** In `src/pages/TaxesPage.test.tsx`, add after the totals-tiles case:

```tsx
  it('renders the per-jurisdiction detail table straight from the summary payload', async () => {
    const detailed = summaryFor(2024)
    detailed.federal = {
      agi: '250000.00', taxable_income: '181305.00', tax: '40782.88', effective_rate: '0.163132',
    }
    detailed.medicare = {
      w2_income: '260000.00', taxable_wages: '250000.00', tax: '4325.00', effective_rate: '0.017300',
    }
    detailed.capital_gains = {
      taxable_income: '181305.00', gains_amount: '20000.00', tax: '3000.00', effective_rate: '0.150000',
    }
    detailed.niit = {
      taxable_income: '10000.00', gains_amount: '25000.00', tax: '380.00', effective_rate: '0.015200',
    }
    vi.mocked(fetchTaxSummary).mockResolvedValue(detailed)
    renderPage()

    await screen.findByText('By jurisdiction')
    // Every cell is the payload's own figure formatted — Base, Taxable, Tax, Eff. rate.
    const federal = screen.getByText('Federal').closest('tr')!
    expect(federal.textContent).toContain('$250,000.00')
    expect(federal.textContent).toContain('$181,305.00')
    expect(federal.textContent).toContain('$40,782.88')
    expect(federal.textContent).toContain('16.3%')
    // NIIT: Base is net investment income, Taxable the surcharged base.
    const niit = screen.getByText('NIIT').closest('tr')!
    expect(niit.textContent).toContain('$25,000.00')
    expect(niit.textContent).toContain('$10,000.00')
    expect(niit.textContent).toContain('$380.00')
    expect(niit.textContent).toContain('1.5%')
    // Capital gains: Base is the gains, Taxable the ordinary income they stack on.
    const cg = screen.getByText('Capital gains').closest('tr')!
    expect(cg.textContent).toContain('$20,000.00')
    expect(cg.textContent).toContain('$181,305.00')
  })

  it('renders the NIIT row as em-dashes against a pre-C payload', async () => {
    // A payload with NO niit key at all — what a stored summary from before workstream C
    // looks like. Built explicitly (delete, not "trust the fixture") so this pin survives
    // whatever Plan C did to the shared summaryFor. Absence is em-dash, never $0.00.
    const preC = { ...summaryFor(2024) }
    delete preC.niit
    vi.mocked(fetchTaxSummary).mockResolvedValue(preC)
    renderPage()
    await screen.findByText('By jurisdiction')
    const niit = screen.getByText('NIIT').closest('tr')!
    expect(niit.textContent?.match(/—/g)).toHaveLength(4)
    expect(niit.textContent).not.toContain('$0.00')
  })
```

Also extend the EXISTING refusal-year case with:

```tsx
    expect(screen.queryByText('By jurisdiction')).toBeNull()
```

Run `npx vitest run src/pages/TaxesPage.test.tsx` — expected: the two new cases FAIL (`By jurisdiction` not found).

- [ ] **Step 3: Implement in `SummaryPanel.tsx`.** Add the module-level helper above the component (after the imports):

```tsx
// D2 (2026-08-31): the summary sections rendered as FIGURES, not only as chart geometry.
// One rule per column: Base is the jurisdiction's income context (agi / w2_income /
// gains_amount), Taxable the field its rates are actually walked over (taxable_income /
// taxable_wages) — so for capital gains "Taxable" is the ordinary income the gains stack
// on top of, and for NIIT the surcharged base. `niit` is optional on the wire (stored
// pre-C payloads): absence renders the em-dash convention, never a zero.
interface DetailRow {
  label: string
  base: string | null
  taxable: string | null
  tax: string | null
  rate: string | null
}

function jurisdictionRows(summary: TaxSummaryOut): DetailRow[] {
  const { federal, state, niit, medicare, social_security, disability, capital_gains } =
    summary
  return [
    { label: 'Federal', base: federal.agi, taxable: federal.taxable_income, tax: federal.tax, rate: federal.effective_rate },
    { label: 'State', base: state.agi, taxable: state.taxable_income, tax: state.tax, rate: state.effective_rate },
    { label: 'NIIT', base: niit?.gains_amount ?? null, taxable: niit?.taxable_income ?? null, tax: niit?.tax ?? null, rate: niit?.effective_rate ?? null },
    { label: 'Medicare', base: medicare.w2_income, taxable: medicare.taxable_wages, tax: medicare.tax, rate: medicare.effective_rate },
    { label: 'Social Security', base: social_security.w2_income, taxable: social_security.taxable_wages, tax: social_security.tax, rate: social_security.effective_rate },
    { label: 'Disability', base: disability.w2_income, taxable: disability.taxable_wages, tax: disability.tax, rate: disability.effective_rate },
    { label: 'Capital gains', base: capital_gains.gains_amount, taxable: capital_gains.taxable_income, tax: capital_gains.tax, rate: capital_gains.effective_rate },
  ]
}
```

Then insert the table in the component's JSX, directly AFTER the closing `</div>` of the `kpi-row` and BEFORE the `summary.warnings.length > 0` block:

```tsx
        {/* Gated with the waterfall: a refusal year carries NULL sections on the wire, and
            the missing-tables call to action below is that state's whole answer. */}
        {missing.length === 0 && (
          <div className="tax-section tax-jurisdiction-detail">
            <h3 className="eyebrow">
              By jurisdiction
              <InfoHint text="Base is each jurisdiction&apos;s income context — AGI for the income taxes, W-2 wages for the payroll taxes, gains or net investment income for capital gains and NIIT. Taxable is what its rates are actually walked over: for capital gains, the ordinary income the gains stack on top of; for NIIT, the surcharged base." />
            </h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Jurisdiction</th>
                  <th className="num">Base</th>
                  <th className="num">Taxable</th>
                  <th className="num">Tax</th>
                  {/* "Eff. rate", NOT "Effective rate": the totals tile above already owns
                      that exact label, and two nodes spelling it would be ambiguous to a
                      reader and to getByText alike. */}
                  <th className="num">Eff. rate</th>
                </tr>
              </thead>
              <tbody>
                {jurisdictionRows(summary).map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="num">{formatCurrency(row.base)}</td>
                    <td className="num">{formatCurrency(row.taxable)}</td>
                    <td className="num">{formatCurrency(row.tax)}</td>
                    <td className="num">{formatPct(row.rate, { signed: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
```

(`formatCurrency(null)` and `formatPct(null)` both answer `'—'` — the house em-dash convention lives in `src/utils/format.ts:9-33`; nothing extra to write.)

- [ ] **Step 4: Spacing CSS.** Append to `src/components/taxes/taxes.css`:

```css
/* D2: the per-jurisdiction table sits between the tiles and the warnings — it needs the
   top gap .tax-section does not carry (that class only spaces downward). */
.tax-jurisdiction-detail {
  margin-top: 1.1rem;
}
```

- [ ] **Step 5: Run and commit.**

```bash
npx vitest run src/pages/TaxesPage.test.tsx
npx tsc -b
```

Expected: all green (the two new cases + the extended refusal case included), `tsc` silent.

```bash
git add src/types/api.ts src/components/taxes/SummaryPanel.tsx src/components/taxes/taxes.css src/pages/TaxesPage.test.tsx
git commit -m "feat(taxes): per-jurisdiction detail table with the NIIT row (D2)"
```

---

## Phase 4 — D1: the what-if overrides editor

### Task 4: override legs in `WhatIfPanel` + the definitions prop from `TaxesPage`

**Files:**
- `src/components/taxes/WhatIfPanel.tsx` (props `:82-96`; state `:110-111`; helpers near `:186-236`; `run()` `:246-315`; legs JSX after `:461`; actions `:469-502`; empty note `:463-467` — all pre-batch anchors)
- `src/components/taxes/WhatIfPanel.test.tsx` (new describe)
- `src/pages/TaxesPage.tsx` (helper + prop at the `<WhatIfPanel …/>` mount, pre-batch `:677-682`)
- `src/pages/TaxesPage.test.tsx` (mock update + 1 case)

- [ ] **Step 1: Write the failing component tests.** In `src/components/taxes/WhatIfPanel.test.tsx`, add at the end of the `describe('WhatIfPanel', …)` block (reusing the file's `openPanel`, `runButton`, `field` helpers):

```tsx
  // --- input overrides (D1, design 2026-08-31) -------------------------------------------

  const DEFS = [
    { key: 'annual_salary', label: 'Annual Salary' },
    { key: 'itemized_deduction', label: 'Itemized Deduction' },
  ]
  const addOverride = () =>
    screen.getByRole('button', { name: 'Add override' }) as HTMLButtonElement

  it('adds an override row on the first unused key and posts canonical values', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())

    // Label + key, from the definitions the page handed down.
    const select = screen.getByLabelText('Override') as HTMLSelectElement
    expect(select.value).toBe('annual_salary')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Annual Salary (annual_salary)',
      'Itemized Deduction (itemized_deduction)',
    ])

    // Run is open with ONLY an override leg — a scenario needs no sale to mean something.
    expect(runButton().disabled).toBe(false)
    fireEvent.change(field('Override 1 value'), { target: { value: '$210,000' } })
    fireEvent.click(runButton())

    // Canonical at the wire (the InputsForm boundary), and the two sale lists stay [].
    await waitFor(() =>
      expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({
        year: 2024,
        sales: [],
        espp_sales: [],
        overrides: { annual_salary: '210000' },
      }),
    )
  })

  it('sends null for a blank value — the clear-this-input case', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.click(runButton())

    await waitFor(() =>
      expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({
        year: 2024,
        sales: [],
        espp_sales: [],
        overrides: { annual_salary: null },
      }),
    )
  })

  it('omits the overrides key entirely when no override rows exist', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addSale())
    fireEvent.click(runButton())

    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    // The pre-override wire, byte-identical — the exact-body pins above depend on it.
    expect('overrides' in vi.mocked(runWhatIf).mock.calls[0][0]).toBe(false)
  })

  it('refuses a duplicated key in the box’s own vocabulary, before spending a request', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride()) // annual_salary
    fireEvent.click(addOverride()) // itemized_deduction
    // Point the second row at the first row's key.
    fireEvent.change(screen.getAllByLabelText('Override')[1], {
      target: { value: 'annual_salary' },
    })
    fireEvent.click(runButton())

    expect(screen.getByRole('alert').textContent).toContain(
      'Annual Salary is overridden twice — one row per key',
    )
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()
  })

  it('refuses a garbled value and names the row by its label', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.change(field('Override 1 value'), { target: { value: '12..3' } })
    fireEvent.click(runButton())

    expect(screen.getByRole('alert').textContent).toContain(
      'Annual Salary: enter a number, or leave the value blank to clear it',
    )
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()
  })

  it('keeps Add override shut once every key is taken, and with no definitions at all', async () => {
    render(<WhatIfPanel year={2024} definitions={DEFS} />)
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.click(addOverride())
    expect(addOverride().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove override 2' }))
    expect(addOverride().disabled).toBe(false)
    cleanup()

    vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
    vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
    render(<WhatIfPanel year={2024} />)
    await openPanel()
    expect(addOverride().disabled).toBe(true)
  })
```

Run `npx vitest run src/components/taxes/WhatIfPanel.test.tsx` — expected: 6 new FAILs (no `Add override` button), every existing case still green.

- [ ] **Step 2: Implement in `WhatIfPanel.tsx`.**

(a) Imports — add:

```tsx
import AmountInput from '../AmountInput'
import { canonicalAmount, isAmount } from '../../utils/amount'
```

(b) Export the definitions shape (above the component, near `SaleLegForm`):

```tsx
/** One option of the override select — the definition table's own label + key. TaxesPage
 *  dedupes per-person repeats before handing these down: overrides address the HOUSEHOLD
 *  key map (the endpoint applies them after aggregation), so a key appears once. */
export interface OverrideDefinition {
  key: string
  label: string
}

interface OverrideLegForm {
  key: string
  value: string
}
```

(c) Props — add `definitions = []` with the doc comment:

```tsx
  definitions = [],
}: {
  year: number
  initialTicker?: string | null
  initialLotId?: number | null
  /** The year payload's input definitions (deduped by key, payload order) — the override
   *  rows' key select. Optional so fetch-free mounts (and the pinned older tests) need no
   *  list; with none, Add override stays shut. */
  definitions?: OverrideDefinition[]
```

(d) State — beside `esppLegs`:

```tsx
  const [overrideLegs, setOverrideLegs] = useState<OverrideLegForm[]>([])
```

(e) Helpers — beside `nextLot`/`addEsppSale`/`removeEsppLeg`:

```tsx
  const nextDefinition = () => {
    const taken = new Set(overrideLegs.map((leg) => leg.key))
    return definitions.find((definition) => !taken.has(definition.key))
  }

  const addOverride = () => {
    const definition = nextDefinition()
    if (definition === undefined) return
    setError(null)
    setOverrideLegs((current) => [...current, { key: definition.key, value: '' }])
  }

  const setOverrideLeg = (index: number, patch: Partial<OverrideLegForm>) => {
    setError(null)
    setOverrideLegs((current) =>
      current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)),
    )
  }

  const removeOverrideLeg = (index: number) => {
    setError(null)
    setOverrideLegs((current) => current.filter((_, i) => i !== index))
  }
```

(f) `run()` — after the ESPP loop and before the `seq` bump, add:

```tsx
    const overrides: Record<string, string | null> = {}
    for (const [index, leg] of overrideLegs.entries()) {
      const definition = definitions.find((d) => d.key === leg.key)
      if (definition === undefined) {
        setError(`Override ${index + 1}: choose an input key`)
        return
      }
      if (leg.key in overrides) {
        // Last-write-wins on a dict would silently drop the earlier row — refuse instead
        // (the sale legs' same-security posture, override-flavoured).
        setError(`${definition.label} is overridden twice — one row per key`)
        return
      }
      const text = leg.value.trim()
      if (text !== '' && !isAmount(text)) {
        setError(`${definition.label}: enter a number, or leave the value blank to clear it`)
        return
      }
      // Canonical at the wire (InputsForm's boundary): AmountInput's tolerant grammar
      // ("$1,600", grouping) must never reach the server's Decimal column raw. A blank is
      // an explicit null — the endpoint's "clear this input" spelling, which the scenario
      // computes as 0 without churning the engine's missing-key warning
      // (tax_whatif.apply_scenario).
      overrides[leg.key] = text === '' ? null : canonicalAmount(text)
    }
```

and change the request body to:

```tsx
    runWhatIf({
      year,
      sales,
      espp_sales: esppSales,
      // Omitted entirely with no rows: the pre-override wire stays byte-identical, which
      // the exact-body test pins depend on.
      ...(overrideLegs.length === 0 ? {} : { overrides }),
    })
```

(g) Run/empty-note gating — replace the two `legCount === 0` reads that mean "nothing to run" (the empty note and the Run button's `disabled`) with a named flag declared beside `legCount`:

```tsx
  const scenarioEmpty = legCount === 0 && overrideLegs.length === 0
```

- empty note condition becomes `scenarioEmpty`, and its copy becomes: `No legs yet — add a sale or an input override to model it against {year}&apos;s stored inputs.`
- Run button: `disabled={scenarioEmpty}`.
- Do NOT fold `overrideLegs.length` into `legCount`: `legCount` feeds the `MAX_LEGS` fence, which is the server's per-list sales/ESPP cap (`WhatIfIn … max_length=20`) — overrides are a dict with no such cap.

(h) JSX — after the closing `</div>` of the existing `whatif-legs` block and BEFORE the empty note, insert the section:

```tsx
              {overrideLegs.length > 0 && (
                <div className="tax-section whatif-overrides">
                  <h3 className="eyebrow">
                    Input overrides
                    <InfoHint text="Absolute replacements applied AFTER the sale legs. An override addresses the household key map — on a married year a per-person line is replaced as one combined figure, the same aggregation the engine applies." />
                  </h3>
                  <p className="drill-hint">
                    Overrides set a key&apos;s household value for this scenario only. A
                    blank value clears the input (the scenario computes it as 0).
                  </p>
                  <div className="whatif-legs">
                    {/* Position IS the identity, like the sale legs above. */}
                    {overrideLegs.map((leg, index) => (
                      <div key={index} className="whatif-form">
                        <label htmlFor={`whatif-override-key-${index}`}>Override</label>
                        <select
                          id={`whatif-override-key-${index}`}
                          className="field-input whatif-select"
                          value={leg.key}
                          onChange={(e) => setOverrideLeg(index, { key: e.target.value })}
                        >
                          {definitions.map((definition) => (
                            <option key={definition.key} value={definition.key}>
                              {definition.label} ({definition.key})
                            </option>
                          ))}
                        </select>
                        <AmountInput
                          aria-label={`Override ${index + 1} value`}
                          value={leg.value}
                          onValueChange={(next) => setOverrideLeg(index, { value: next })}
                          placeholder="blank clears"
                        />
                        <button
                          type="button"
                          className="button"
                          aria-label={`Remove override ${index + 1}`}
                          onClick={() => removeOverrideLeg(index)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
```

(i) Actions row — insert between `Add ESPP sale` and the Run button:

```tsx
                <button
                  type="button"
                  className="button"
                  disabled={nextDefinition() === undefined}
                  onClick={addOverride}
                >
                  Add override
                </button>
```

(j) `src/api/whatif.ts` — update the stale comment on `overrides` (`:8-11`): replace the "The panel has no UI for it in v1" sentence with `// The overrides editor (D1, 2026-08-31) serializes rows into it; a null value clears the key in the scenario (computes as 0).`

- [ ] **Step 3: Thread the prop from the page.** In `src/pages/TaxesPage.tsx`:

(a) Type-only import (the page test mocks this module's RUNTIME with a default-only factory — a value import of anything else would crash there, a type import is erased):

```tsx
import type { OverrideDefinition } from '../components/taxes/WhatIfPanel'
```

(b) Module-level helper (beside `inputsKey`/`bracketsKey`):

```tsx
// D1: the override select's option list — every definition ONCE, payload order, label from
// the definition table. Per-person keys repeat once per column in the payload; overrides
// address the HOUSEHOLD key map, so the dedupe is the semantics, not a display nicety.
function overrideDefinitions(inputs: TaxInputsOut): OverrideDefinition[] {
  const seen = new Set<string>()
  const definitions: OverrideDefinition[] = []
  for (const section of inputs.sections)
    for (const item of section.items) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      definitions.push({ key: item.key, label: item.label })
    }
  return definitions
}
```

(c) The mount gains one prop:

```tsx
          <WhatIfPanel
            key={`whatif-${detail.summary.year}`}
            year={detail.summary.year}
            initialTicker={whatIfTicker}
            initialLotId={whatIfLotId}
            definitions={overrideDefinitions(detail.inputs)}
          />
```

- [ ] **Step 4: Update the page test's mock and pin the prop.** In `src/pages/TaxesPage.test.tsx`, extend the `vi.mock('../components/taxes/WhatIfPanel', …)` factory: add `definitions` to the destructured props (typed `definitions?: { key: string; label: string }[]`) and to the marker div:

```tsx
        'data-defs': (definitions ?? []).map((d) => d.key).join(','),
```

Then add one case beside the other deep-link/prop cases:

```tsx
  it('hands the year’s input definitions to the what-if card, deduped by key', async () => {
    // A married payload repeats annual_salary once per person column; the override list
    // must carry the KEY once — overrides are household-level.
    vi.mocked(fetchTaxInputs).mockImplementation(async (year: number) => marriedInputsFor(year))
    renderPage()
    const panel = await screen.findByTestId('whatif-panel')
    await waitFor(() => expect(panel.getAttribute('data-defs')).toBe('annual_salary'))
  })
```

- [ ] **Step 5: Run and commit.**

```bash
npx vitest run src/components/taxes/WhatIfPanel.test.tsx src/pages/TaxesPage.test.tsx
npx tsc -b
```

Expected: all green (existing exact-body pins untouched — the overrides key is omitted when absent), `tsc` silent.

```bash
git add src/components/taxes/WhatIfPanel.tsx src/components/taxes/WhatIfPanel.test.tsx src/api/whatif.ts src/pages/TaxesPage.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat(taxes): what-if input-overrides editor (D1)"
```

---

## Phase 5 — D4: per-check remedy + vest→W2 Apply

### Task 5: `WithholdingPanel` remedy line and Apply chip, with the page completing the loop

**Files:**
- `src/components/taxes/WithholdingPanel.tsx` (client-math comment `:70-78`; ytd drill-hint `:161-167`; vest prose `:300-306` — pre-batch anchors)
- `src/components/taxes/WithholdingPanel.test.tsx` (mock + 6 cases)
- `src/components/taxes/taxes.css` (two small appends)
- `src/pages/TaxesPage.tsx` (`inputsEpoch` state, `vestW2Stored`, `onVestApplied`, props at `:662-667`, `InputsForm` key at `:689-694`)
- `src/pages/TaxesPage.test.tsx` (1 case)

**Contract notes (bind the steps below):**
- The Apply figure is **`vest.income_projected` alone** — see the header's ratified deviation; the backend already folds `income_ytd` into it (`withholding_calc.py:262-263`).
- The write goes through the `values` shorthand: a per-person key with no owner **is** the primary's column (`TaxInputsUpdate`'s documented contract) — `w2_stock_rsus_sold` is a seeded per-person key (`backend/app/tax_keys.py:19,95`).
- `InputsForm` seeds its state from `useState` initializers and deliberately ignores prop replacement, and its key (`inputsKey`) is content-independent — so an EXTERNAL write must remount it or the form displays a stale figure forever. The page's `inputsEpoch` rides the key; the chip confirms first when the form is dirty.

- [ ] **Step 1: Write the failing component tests.** In `src/components/taxes/WithholdingPanel.test.tsx`:

(a) Extend the module mock and imports:

```tsx
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  fetchWithholding: vi.fn(),
  putTaxInputs: vi.fn(),
}))
import { fetchWithholding, putTaxInputs } from '../../api/taxes'
```

(b) Add at the end of the describe block:

```tsx
  // --- D4: per-check remedy + vest→W2 Apply (design 2026-08-31) --------------------------

  const REMEDY = 'Add $2,358.78 per remaining paycheck (W-4 line 4c) to close the gap.'
  const applyChip = () =>
    screen.getByRole('button', { name: 'Apply vest income to W-2 inputs' }) as HTMLButtonElement
  const inputsEcho = { year: 2026, filing_status: 'single' as const, people: [], sections: [] }

  it('computes the per-check remedy from the payload’s own fields', async () => {
    // 18,870.20 over the 8 checks still to come (24 − 16) = 2,358.775 → $2,358.78.
    render(<WithholdingPanel year={2026} />)
    expect(await screen.findByText(REMEDY)).toBeTruthy()
  })

  it('stays quiet about a remedy on a refund, and with no checks left', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(fixture({ balance_projected: '-2450.75' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText(/per remaining paycheck/)).toBeNull()
    cleanup()

    // Still owing, but the year's checks are spent: there is no paycheck to put it on.
    vi.mocked(fetchWithholding).mockResolvedValue(fixture({ checks_elapsed: 24 }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText(/per remaining paycheck/)).toBeNull()
  })

  it('applies the FULL-year vest figure to the primary’s W-2 input and reloads', async () => {
    vi.mocked(putTaxInputs).mockResolvedValue(inputsEcho)
    const onApplied = vi.fn()
    render(
      <WithholdingPanel year={2026} storedVestW2={null} inputsDirty={false} onVestApplied={onApplied} />,
    )
    await screen.findByText('$123,456.78')
    fireEvent.click(applyChip())

    // income_projected ALONE: the backend already sums past vests into it
    // (withholding_calc income_projected = income_ytd + future) — ytd + projected would
    // double-count every past vest. The values shorthand IS the primary-person write.
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2026, {
        values: { w2_stock_rsus_sold: '48000.00' },
      }),
    )
    expect(onApplied).toHaveBeenCalledWith(inputsEcho)
    // The liability this card compares against just moved with the input it wrote.
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(2))
  })

  it('disables Apply with a title when the stored value already equals the figure', async () => {
    // 4dp stored echo vs the estimate's 2dp: the comparison is numeric, not string.
    render(
      <WithholdingPanel
        year={2026}
        storedVestW2={'48000.0000'}
        inputsDirty={false}
        onVestApplied={vi.fn()}
      />,
    )
    await screen.findByText('$123,456.78')
    expect(applyChip().disabled).toBe(true)
    expect(applyChip().title).toBe('Stored W-2 vest input already equals this figure')
  })

  it('asks before clobbering unsaved input edits below, and respects a no', async () => {
    vi.mocked(putTaxInputs).mockResolvedValue(inputsEcho)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <WithholdingPanel year={2026} storedVestW2={null} inputsDirty={true} onVestApplied={vi.fn()} />,
    )
    await screen.findByText('$123,456.78')
    fireEvent.click(applyChip())
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(applyChip())
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledTimes(1))
    confirmSpy.mockRestore()
  })

  it('lands an Apply failure on its own error line, figures kept', async () => {
    vi.mocked(putTaxInputs).mockRejectedValue(new ApiError('inputs unavailable', 503))
    render(
      <WithholdingPanel year={2026} storedVestW2={null} inputsDirty={false} onVestApplied={vi.fn()} />,
    )
    await screen.findByText('$123,456.78')
    fireEvent.click(applyChip())

    expect(await screen.findByText('inputs unavailable')).toBeTruthy()
    // The estimate on screen is still true — and no reload was spent on a write that failed.
    expect(screen.getByText('$123,456.78')).toBeTruthy()
    expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(1)
  })
```

Run `npx vitest run src/components/taxes/WithholdingPanel.test.tsx` — expected: 6 FAILs, existing cases green (the chip renders only when `onVestApplied` is provided, so the prop-less legacy renders stay untouched).

- [ ] **Step 2: Implement in `WithholdingPanel.tsx`.**

(a) Imports: `fetchWithholding, putTaxInputs` from `'../../api/taxes'`; add `TaxInputsOut` to the type import.

(b) Signature:

```tsx
export default function WithholdingPanel({
  year,
  storedVestW2 = null,
  inputsDirty = false,
  onVestApplied,
}: {
  year: number
  /** The PRIMARY person's stored w2_stock_rsus_sold (the 4dp echo), null when unset —
   *  what the Apply chip's already-applied check compares against. */
  storedVestW2?: string | null
  /** The inputs form below holds unsaved edits: Apply asks before the page remounts it. */
  inputsDirty?: boolean
  /** The page's reload door: adopts the PUT echo, remounts the inputs form on it and
   *  refreshes the totals. The chip renders ONLY when the page provides this — an Apply
   *  that could not complete that loop would leave a stale form under a fresh number. */
  onVestApplied?: (echo: TaxInputsOut) => void
}) {
```

(c) State — beside `busy`:

```tsx
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
```

(d) Update the `:70-78` comment's opening ("The ONE piece of client math…") to: `// Client math on this card is display-only (utils/format.ts's Number() rule): the sign/abs below, and D4's per-check split further down.` Then, after the `balanceWords` block, add:

```tsx
  // D4 remedy: a positive balance split evenly over the checks still to come. Rides the
  // same null rule as the tile — no liability, no remedy — and says nothing once the
  // year's checks are spent (there is no paycheck left to put it on).
  const remainingChecks =
    withholding === null ? 0 : withholding.checks_total - withholding.checks_elapsed
  const perCheck =
    balance !== null && balance > 0 && remainingChecks > 0 ? balance / remainingChecks : null

  // D4 Apply: income_projected ALONE is the full-year vest base — the backend sums past
  // vests INTO it (withholding_calc.py: income_projected = income_ytd + future), so the
  // spec's "ytd + projected" spelling would double-count every past vest (ratified
  // deviation, plan 2026-08-31-tier1-d). It is also exactly the figure the prose names.
  const vestFigure = withholding === null ? null : withholding.vest.income_projected
  // Numeric compare across quanta: the stored echo is 4dp ("48000.0000"), the estimate
  // 2dp ("48000.00") — string equality would re-offer an Apply that changes nothing.
  const vestApplied =
    vestFigure !== null && storedVestW2 !== null && Number(storedVestW2) === Number(vestFigure)

  const applyVestIncome = () => {
    if (vestFigure === null || onVestApplied === undefined || applying || vestApplied) return
    if (
      inputsDirty &&
      !window.confirm(
        'Applying writes the W-2 vest input and reloads the inputs form below, discarding its unsaved edits. Continue?',
      )
    )
      return
    setApplying(true)
    setApplyError(null)
    // The `values` shorthand IS the primary-person write: a per-person key with no owner
    // resolves to the primary column server-side (TaxInputsUpdate's contract).
    putTaxInputs(year, { values: { w2_stock_rsus_sold: vestFigure } })
      .then((echo) => {
        onVestApplied(echo)
        // This card's own liability just moved with the input it wrote.
        setReload({})
      })
      .catch((err: unknown) => {
        setApplyError(err instanceof ApiError ? err.message : 'Failed to apply the vest income')
      })
      .finally(() => setApplying(false))
  }
```

(e) Remedy JSX — directly AFTER the ytd/checks `drill-hint` paragraph (`:161-167`):

```tsx
          {perCheck !== null && (
            <p className="hint withholding-remedy">
              {`Add ${formatCurrency(perCheck)} per remaining paycheck (W-4 line 4c) to close the gap.`}
            </p>
          )}
```

(f) Vest prose block (`:300-306`) — the sentence stays verbatim; append the chip and the error line:

```tsx
          {Number(withholding.vest.income_projected) > 0 && (
            <p className="hint">
              {`This year's vests imply ≈${formatCurrency(
                withholding.vest.income_projected,
              )} of W-2 income at vest prices — make sure your W-2 inputs below include it.`}
              {onVestApplied !== undefined && (
                <button
                  type="button"
                  className="chip"
                  disabled={applying || vestApplied}
                  aria-label="Apply vest income to W-2 inputs"
                  title={
                    vestApplied
                      ? 'Stored W-2 vest input already equals this figure'
                      : `Set W2: Stock/RSUs Sold to ${formatCurrency(
                          withholding.vest.income_projected,
                        )} for the primary person`
                  }
                  onClick={applyVestIncome}
                >
                  {applying ? 'Applying…' : 'Apply'}
                </button>
              )}
            </p>
          )}
          {applyError !== null && (
            <div className="error-banner" role="alert">
              {applyError}
            </div>
          )}
```

(g) CSS — in `src/components/taxes/taxes.css`, add `.withholding-panel .withholding-remedy` to the existing trap/cta border-left rule's selector list, and append:

```css
/* The Apply chip rides inside the vest sentence — one gap, not a new layout. */
.withholding-panel .hint .chip {
  margin-left: 0.5rem;
}
```

Run `npx vitest run src/components/taxes/WithholdingPanel.test.tsx` — expected: all green.

- [ ] **Step 3: Wire the page.** In `src/pages/TaxesPage.tsx`:

(a) Module-level helper (beside `overrideDefinitions`):

```tsx
// D4: the PRIMARY person's stored w2_stock_rsus_sold — the payload orders columns primary
// first, and a roster-less year spells the primary as person_id null.
function vestW2Stored(inputs: TaxInputsOut): string | null {
  const primary = inputs.people[0]?.id ?? null
  for (const section of inputs.sections)
    for (const item of section.items)
      if (
        item.key === 'w2_stock_rsus_sold' &&
        (item.person_id === primary || item.person_id === null)
      )
        return item.value
  return null
}
```

(b) State — beside `trendRefresh`:

```tsx
  // D4: bumped when an inputs write lands from OUTSIDE the form (the withholding card's
  // Apply). The form deliberately ignores prop replacement to protect typed work, so an
  // external echo must REMOUNT it — this rides its key. The chip confirmed any discard
  // before PUTting, so the remount never eats work silently.
  const [inputsEpoch, setInputsEpoch] = useState(0)
```

(c) Handler — beside `onInputsSaved`:

```tsx
  const onVestApplied = (echo: TaxInputsOut) => {
    setInputsEpoch((n) => n + 1)
    onInputsSaved(echo) // adopts the echo, refreshes the totals and the chip counts
  }
```

(d) The withholding mount (`:662-667`) gains the three props:

```tsx
            <WithholdingPanel
              key={`withholding-${detail.summary.year}`}
              year={detail.summary.year}
              storedVestW2={vestW2Stored(detail.inputs)}
              inputsDirty={inputsDirty}
              onVestApplied={onVestApplied}
            />
```

(e) The `InputsForm` key (`:689-694`) becomes:

```tsx
            key={`${inputsKey(detail.inputs)}:${inputsEpoch}`}
```

(keep the existing key comment; append one line: `// :epoch — remounts on an EXTERNAL inputs write (D4 Apply), never on the form's own save.`)

- [ ] **Step 4: Pin the page loop.** In `src/pages/TaxesPage.test.tsx`, inside the withholding describe (the `yearRow` helper's scope):

```tsx
  it('vest Apply writes through the page: PUT, remounted form, fresh totals', async () => {
    const thisYear = new Date().getFullYear()
    vi.mocked(fetchTaxYears).mockResolvedValue([yearRow(thisYear)])
    vi.mocked(fetchWithholding).mockImplementation(async (year: number) => ({
      ...withholdingFor(year),
      vest: {
        ...withholdingFor(year).vest,
        income_ytd: '31500.00',
        income_projected: '48000.00',
      },
    }))
    // The PUT echo carries a moved salary too — the remount is what puts it on screen,
    // because InputsForm ignores prop replacement by design.
    const echo = inputsFor(thisYear)
    echo.sections[0].items[0].value = '333000.0000'
    vi.mocked(putTaxInputs).mockResolvedValue(echo)
    renderPage()
    await screen.findByText(`Will I owe? — ${thisYear}`)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Apply vest income to W-2 inputs' }),
    )
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(thisYear, {
        values: { w2_stock_rsus_sold: '48000.00' },
      }),
    )
    // Remounted from the echo (a blurred AmountInput reads its formatted echo).
    await waitFor(() => expect(salary().value).toBe('$333,000.00'))
    // The page's save chain ran: totals refetched, and this card reloaded its own feed.
    await waitFor(() => expect(vi.mocked(fetchTaxSummary)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(2))
  })
```

- [ ] **Step 5: Run and commit.**

```bash
npx vitest run src/components/taxes/WithholdingPanel.test.tsx src/pages/TaxesPage.test.tsx
npx tsc -b
```

Expected: all green, `tsc` silent.

```bash
git add src/components/taxes/WithholdingPanel.tsx src/components/taxes/WithholdingPanel.test.tsx src/components/taxes/taxes.css src/pages/TaxesPage.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat(taxes): per-check remedy and vest-to-W2 apply on the withholding card (D4)"
```

---

## Phase 6 — D5: dead-payload rendering

### Task 6: NetWorthPage per-owner strip

**Files:**
- `src/pages/NetWorthPage.tsx` (after the KPI row block — pre-batch `:493-532`; `ownerScopes` sat at `:214-221`. **Plan A2 has since split the legend state in this file — re-locate the KPI row by the `summary && summary.month` guard, and touch NOTHING about the legend states.**)
- `src/pages/NetWorthPage.css` (append)
- `src/pages/NetWorthPage.test.tsx` (2 cases)

- [ ] **Step 1: Write the failing tests.** Add to `src/pages/NetWorthPage.test.tsx` (top-level, beside the owner-chip cases):

```tsx
it('renders the per-owner strip in chip order, skipping owners the payload lacks', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  const strip = document.querySelector('.networth-owner-strip')
  expect(strip).not.toBeNull()
  // Me then Joint — the fixture's owner_totals has no SAM row, and a missing owner is
  // SKIPPED, never rendered as $0.00. Order comes from the chips, so the two agree.
  expect([...strip!.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
    'Me',
    'Joint',
  ])
  expect([...strip!.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
    '$150.00',
    '$80.00',
  ])
})

it('hides the strip for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Net worth')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  expect(document.querySelector('.networth-owner-strip')).toBeNull()
})
```

Run `npx vitest run src/pages/NetWorthPage.test.tsx` — expected: 2 FAILs.

- [ ] **Step 2: Implement.** In `src/pages/NetWorthPage.tsx`, directly AFTER the closing of the `{summary && summary.month && ( <div className="kpi-row"> … )}` block, insert:

```tsx
      {/* D5 (2026-08-31): the latest snapshot split by owner — the same money the chips
          above scope, read straight off the already-fetched summary. Ordered BY the chips
          (primary, others, Joint) so the strip and the control can never disagree; an
          owner with no owner_totals row is SKIPPED, never a fabricated $0.00. Under a
          person scope the server narrows owner_totals to that person + Joint, and the
          strip honestly narrows with it. */}
      {ownerScopes.length > 0 && summary && summary.month && summary.owner_totals.length > 0 && (
        <dl className="networth-owner-strip">
          {ownerScopes
            .filter(({ scope }) => scope !== null)
            .map(({ scope, label }) => {
              const entry = summary.owner_totals.find((total) =>
                scope === 'joint' ? total.person_id === null : total.person_id === scope,
              )
              if (entry === undefined) return null
              return (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{formatCurrency(entry.total)}</dd>
                </div>
              )
            })}
        </dl>
      )}
```

- [ ] **Step 3: CSS.** Append to `src/pages/NetWorthPage.css` after the `.networth-owner-row` rules:

```css
/* D5: the per-owner split of the latest snapshot, under the KPI row. Typography borrowed
   from the withholding card's facts list — the house shape for a few labelled figures. */
.networth-owner-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 0 0 1rem;
}

.networth-owner-strip dt {
  font-size: 0.7rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.networth-owner-strip dd {
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Run and commit.**

```bash
npx vitest run src/pages/NetWorthPage.test.tsx
```

Expected: all green — including Plan A2's legend-split regression tests, untouched.

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.css src/pages/NetWorthPage.test.tsx
git commit -m "feat(net-worth): per-owner strip under the KPI row (D5)"
```

### Task 7: ProjectionPage p10 sub-label

**Files:**
- `src/pages/ProjectionPage.tsx` (FI-probability tile, pre-batch `:426-444`)
- `src/pages/ProjectionPage.test.tsx` (update the pin at `:476-483`; add one case)

- [ ] **Step 1: Update the pinned test and add the stale-backend case.** In `src/pages/ProjectionPage.test.tsx`, change the existing case:

```tsx
  it('states the FI probability with its p10, p50 and p90 months', async () => {
    renderPage()

    await screen.findByText('$1,500,000.00')
    const tile = tileFor('FI probability')
    expect(valueOf(tile)).toBe('62.0%')
    expect(deltaOf(tile)).toBe('p10 Jan 2050 · p50 Oct 2055 · p90 Mar 2061')
  })

  it('leaves p10 out when a stale backend omits it', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(projectionOut({ fi_month_p10: null }))
    renderPage()
    await screen.findByText('$1,500,000.00')
    expect(deltaOf(tileFor('FI probability'))).toBe('p50 Oct 2055 · p90 Mar 2061')
  })
```

(The `fanOff` case — all three nulls, no delta at all — stays exactly as it is and keeps passing.)

Run `npx vitest run src/pages/ProjectionPage.test.tsx` — expected: the updated pin FAILs (`p10 Jan 2050 · …` ≠ current output), the new case FAILs.

- [ ] **Step 2: Implement.** In `src/pages/ProjectionPage.tsx`, the FI-probability tile's `delta` becomes:

```tsx
                delta={
                  // The gate stays p50 (the fan's presence); p10/p90 append around it —
                  // a stale backend that predates either simply names fewer percentiles.
                  data.fi_month_p50 === null
                    ? undefined
                    : `${
                        data.fi_month_p10 === null
                          ? ''
                          : `p10 ${formatMonth(data.fi_month_p10)} · `
                      }p50 ${formatMonth(data.fi_month_p50)}${
                        data.fi_month_p90 === null
                          ? ''
                          : ` · p90 ${formatMonth(data.fi_month_p90)}`
                      }`
                }
```

and the tile's `hint` sentence becomes:

```tsx
                hint="Share of 500 simulated paths reaching the target within the horizon, with optimistic (p10), median (p50) and pessimistic (p90) dates."
```

- [ ] **Step 3: Run and commit.**

```bash
npx vitest run src/pages/ProjectionPage.test.tsx
```

Expected: all green.

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.test.tsx
git commit -m "feat(projection): p10 on the FI-probability sub-label (D5)"
```

---

## Phase 7 — Verification

### Task 8: Full suite, lint, types

**Files:** none

- [ ] **Step 1: Full frontend suite.**

```bash
npm test
```

Expected: green, count = Task 0's baseline + **31** new tests (13 marginal + 3 builder + 6 MarginalPanel + 6 WhatIfPanel + 6 WithholdingPanel + ~5 TaxesPage + 2 NetWorth + 1 Projection = 42 new/updated `it` blocks; 31 net-new files/cases minimum — report the exact number, do not hand-wave it).

- [ ] **Step 2: Lint + types.**

```bash
npm run lint
npx tsc -b
```

Expected: both silent. Common trip-wires: unused imports after edits (`noUnusedLocals`), and react-hooks rules — `MarginalPanel`'s `useMemo` runs before its early return on purpose (rules-of-hooks).

- [ ] **Step 3: Confirm no backend files moved.**

```bash
git diff --stat main...HEAD -- backend/ | tail -3   # D's commits must add NOTHING here beyond A/C/B's
git log --oneline -8
```

Expected: the eight D commits from Tasks 1–7 on `tier1-batch`, none touching `backend/` (the diff-stat shows only A/C/B's earlier work). Fix-up commits, if any, use `fix(taxes): …` / `test(taxes): …`. **Never push.**

---

## Self-Review (performed)

**D1–D5 coverage → tasks:**
- D1 (overrides editor: key select from definitions + AmountInput + remove; blank → null; household-key-map section hint) → **Task 4** (rows, `run()` serialization with conditional-spread `overrides`, dup/garble fences, `definitions` prop threaded from `TaxesPage` with per-person dedupe, page-mock `data-defs` pin).
- D2 (7-row × 4-column table incl. NIIT; em-dash when a section is absent, pre-C payload safe) → **Task 3** (table gated with the waterfall's refusal branch; `niit?` optional type verified-or-added; the pre-C fixture case pins 4 em-dashes and forbids `$0.00`; header says `Eff. rate` to avoid the totals tile's exact-label collision the existing page test pins).
- D3 (pure ladder math + panel) → **Task 1** (module: `toBrackets`/`taxAt`/`marginalCost`/`ladderSegments`/`additionalMedicareStep`, 13 hand-derived vectors: 1160/6053/21842.5 walks, 220/155/100/50/22 marginals, boundary-belongs-below pins, Medicare 9-vs-null pins) + **Task 2** (`marginalLadderOption` builder with capped top bracket 15078.75/59000 pins, `MarginalPanel` with the exact sentence in four compositions, TaxesPage mount, refusal renders nothing; the shared page fixture's ladder is undrawable by construction so the three existing `echart`-count pins hold unweakened).
- D4 (remedy when `balance_projected > 0` AND checks remain; Apply disabled-with-title when stored equals the figure) → **Task 5** ($2,358.78 remedy pin from the fixture's own 18,870.20/8; no-remedy on refund and on 24/24 checks; Apply PUT body pin, numeric 4dp-vs-2dp equality, dirty-confirm, failure isolation; page loop: epoch remount + summary/withholding refetch pins).
- D5 (NetWorth strip when >1 person, segmented-control order; Projection p10 in the existing format) → **Task 6** (strip ordered BY `ownerScopes`, missing owner skipped not zeroed, hidden for one person) + **Task 7** (`p10 Jan 2050 · p50 Oct 2055 · p90 Mar 2061` pin updated in place + stale-backend p10-null case; fan-off case untouched).
- NO backend changes: every task's file list is frontend-only; Task 8 Step 3 verifies it mechanically.

**Placeholder scan:** no TODO/TBD/`...`-as-code/"fill in later" anywhere above; every test carries literal expected strings and every command a stated expected outcome. The two deliberately non-literal spots are justified inline: the Task 0/8 test COUNTS (unknowable until A/C/B land — the plan says record and report exact numbers) and drifted line anchors (each task re-locates by quoted code).

**Name consistency:** `marginal.ts` exports `Bracket`, `LadderSegment`, `MARGINAL_STEP`, `toBrackets`, `taxAt`, `marginalCost`, `ladderSegments`, `additionalMedicareStep` — used with exactly these names in `marginal.test.ts`, `taxChartOptions.ts` (imports `LadderSegment`), and `MarginalPanel.tsx`. `taxChartOptions.ts` exports `LadderRow`, `marginalLadderOption` — same names in its test and the panel. Components: `MarginalPanel` (file `MarginalPanel.tsx`, test `MarginalPanel.test.tsx`, mounted in `TaxesPage.tsx`). Props: `definitions` (`OverrideDefinition[]`, exported from `WhatIfPanel.tsx`, type-only import in `TaxesPage.tsx`); `storedVestW2`/`inputsDirty`/`onVestApplied` on `WithholdingPanel` matching `TaxesPage`'s `vestW2Stored()`/`inputsDirty`/`onVestApplied`. State names: `overrideLegs`/`addOverride`/`setOverrideLeg`/`removeOverrideLeg`/`nextDefinition`/`scenarioEmpty` (WhatIfPanel); `applying`/`applyError`/`applyVestIncome`/`vestFigure`/`vestApplied`/`perCheck`/`remainingChecks` (WithholdingPanel); `inputsEpoch` (TaxesPage). CSS: `.marginal-sentence`, `.tax-jurisdiction-detail`, `.whatif-overrides`, `.withholding-remedy`, `.networth-owner-strip` — each declared once and referenced with the same spelling in exactly one component.

**Known code-vs-spec deltas, resolved in-plan:** (1) D4's `income_ytd + income_projected` double-counts — the plan PUTs `income_projected` alone, with the backend citation, a header callout, and a test comment (the one intentional spec deviation). (2) The spec's "blank sends null (clears)" is implemented as documented by `apply_scenario:157-158` — null sets the key to 0 in the scenario without the missing-key warning; the UI hint says "clears the input (the scenario computes it as 0)" so the copy matches the engine, not a looser paraphrase. (3) D2's "Effective rate" column header collides with an existing exact-text page pin — renamed `Eff. rate` rather than weakening the pin.
