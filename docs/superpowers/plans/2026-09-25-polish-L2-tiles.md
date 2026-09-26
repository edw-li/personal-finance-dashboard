# Polish lane L2 — tile rows read as one strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** implement item 5 of `docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md` (§4, all of it,
with §0's before-numbers and §1 D7): every KPI tile row reads as one aligned strip — values on one baseline, deltas on one
line, row heights steady as months change, five-tile rows 3 + 2 (never 4 + 1), bare tiles in mixed rows given a real
second line, Paycheck's lone tile and nested hero made one row, and skeletons that land without a jump.

**Architecture:** contract C4 of `2026-09-25-polish-00-overview.md`. `StatTile` always renders four children —
`.stat-label`, `.stat-badge-row`, `.stat-value`, `.stat-delta` — and inside a `.kpi-row` each tile is a four-row CSS
**subgrid** of the row, so a line's labels, badges, values and deltas share tracks. The tile stops being a size container
(a container establishes an independent formatting context, which turns subgrid off — measured in Edge); `.stat-value`
becomes the container its figure sizes against. The row's own row gap is 0 (a parent gutter leaks into every subgrid
track — an empty badge line measured 16 px in Edge); lines of tiles are spaced by each tile's bottom margin instead. A
`.kpi-row-steady` modifier reserves the badge line and one delta line for rows whose content changes with the month.
Ghost tiles draw their blocks inside the real tile's line boxes, so a ghost is exactly as tall as the tile that replaces it.

**Tech Stack:** React 19 + TypeScript 5.9, Vite 6, Vitest 3 + Testing Library (jsdom), plain CSS (container queries,
subgrid), headless Edge via playwright-core for the browser checks.

---

## Evidence gathered before planning (lane L2's own probes, 2026-09-25, production copy on :8077, headless Edge 153)

**Mechanism probes** (`scratchpad/work-L2/exp1-subgrid.mjs`, `exp2-wrap.mjs`):
- A tile with `container-type: inline-size` does NOT subgrid: its four lines drift apart (label heights 15 / 21.8 /
  18.5 px, value baselines 100 / 88.5 / 81.9 px across four tiles).
- `container-type: inline-size` on `.stat-value` keeps its baseline (four baselines equal at 95 px) and applies no
  layout containment in Edge 153 (a `position: fixed` child positions against the viewport).
- Cross-tile baseline alignment works through subgrids, including a hero figure (32 px) beside normal ones (21 px), and
  through a wrapper subgrid around a tile (CashflowStrip's labelled groups).
- `last baseline` lifts a tile whose value has a unit line (Money lasts) 16 px above the others; first baseline keeps
  every figure on one line. **Deviation from spec §4.1's "last baseline": the value line uses the first baseline.**
- With the row's `row-gap: 16px` and the tile's `row-gap: 0`, an EMPTY badge line still measured 16 px and an empty delta
  line 8 px (the parent's gutters are absorbed into the subgrid tracks). With the row's `row-gap: 0` they are 0 px.

**Before-numbers** (`scratchpad/work-L2/measure.mjs`, `ghost.mjs`, `widths.mjs`; results JSON beside them):

| Surface | Before |
|---|---|
| Overview row @1440 | value baselines 23.4 px apart (badges wrapped under two labels); deltas on 2 lines; 42 px blank under one-line tiles |
| Net worth row @1440 | baselines 23.4 px apart; hero delta 2 lines |
| Spending row @1440 | baselines 17.4 px apart; Living delta 2 lines; 2 bare tiles; 57 px blank |
| Net worth row across its 38 ribbon months | 88.2 / 110.8 / 127.8 / 145.2 px (4 heights) |
| Spending row across its 38 ribbon months (dock open: 2 × 2) | 199.6 / 216.8 px |
| Calendar strip | 22.6 px ragged bottom (two wrapped tiles 77.5 px in 100.1 px cells) |
| ESPP strip @1280 | 4 + 1 |
| Portfolio row, dock open @1440 | 2 + 2 + 1; Projection 3 + 2; Calendar 3 + 2 |
| Ghost → landed, first card's top @1440 | Portfolio −143, Projection −113, Calendar −146, ESPP −147, Paycheck +119, Overview +70, Net worth +30, Spending +22, Credit cards −14 |
| Ghost → landed @1280 | Portfolio −23, Projection −10, Calendar −149, ESPP −29, Paycheck +118, Overview +64, Net worth +67, Spending +21, Credit cards −15 |
| Cold-load CLS @1440 (API held 1.5 s) | Paycheck 0.054, Overview 0.085, Net worth 0.0095, Portfolio 0.0014, others ~0 (a replaced ghost is not a "shift": the ghost-parity row above is the honest measure) |

**Delta widths at 1440** (tile content box 239 px on Overview, Net worth and Spending; delta font 12.8 px system-ui):
`▲ $126,583 (+15.7%) since Sep 1 · 21 days` 239 px (fits exactly); `▲ $5,309 (+6.3%) · September: Sep 1, 2023 → Oct 1,
2023` 324 px and `· September: Sep 1 → Oct 1` 256 px (never fit); `▲ $5,309 (+6.3%) · Sep 1 → Oct 1` ~194 px;
`▼ under $5,417 12-mo avg · Aug 2026` 217 px; `Cash outflow $9,803 · tax $5,044 · transfers $1,200` 281 px (never fits);
`tax $5,044 · transfers $1,200` 157 px. Hence two wording decisions below (Tasks 6 and 8).

**Test blast radius of the C4 markup** (probe: markup applied, full suite run, reverted): 10 failures in 4 files —
`StatTile.test.tsx` (2), `CompPage.test.tsx:839`, `OverviewPage.test.tsx:756/798/844/1456/1458/2109`,
`PositionStrip.test.tsx:111/123`.

## Decisions this plan takes (all recorded again in "As built")

1. **First baseline, not last** for the value line (probe above).
2. **Delta clauses are `display: inline-block`**, not `white-space: nowrap`: a clause still never breaks inside "Sep 1",
   and a clause wider than its whole tile wraps inside itself instead of running out of the tile. Clauses are split at
   the delta's top-level " · " (never inside parentheses — the Monthly update's "(Sep 1 → Sep 22 · provisional)" is one).
3. **`.kpi-row-steady`** reserves the badge line and one delta line (an invisible no-break space in the badge's own box
   and the delta's own type). Worn by the Overview, Net worth and Spending rows (their badges and deltas come and go with
   the month; the ghosts cannot know which). Rows where no tile ever has a badge keep a 0 px badge line.
4. **Net worth's month story in a tile reads "· Sep 1 → Oct 1"** — the two 1sts, no month name, no years (the label above
   names the year). changePhrase's "September: Sep 1, 2023 → Oct 1, 2023" cannot fit a quarter-width tile at 1440. The
   provisional form is the spec's own example, "▲ $126,583 (+15.7%) since Sep 1 · 21 days". Charts and movers keep
   changePhrase untouched.
5. **Spending's Living spending delta reads "tax $X · transfers $Y"** (the tile's own hint already says tax and transfers
   "are shown separately"); the Cash outflow total (= living + tax) is derivable and was what pushed the line to two.
6. **Whole dollars in every tile delta that prints an amount** (§4.3's rule, applied app-wide); per-share prices keep
   cents (the spec's own "NVDA $224.58", "avg $54.14 / sh").
7. **FI ratio's line is "$1,400,000 to go"** (whole dollars per §4.3) rather than the table's "$802K": no compact dialect
   is added (MOTION-17, app-wide number dialects, is out of scope).
8. **Calendar keeps five across from 880 px** (its own rule, 2026-09-23 spec §B2), so its skeleton passes the page class
   (`cal-strip`) with the `five` variant; likewise the Projection band's class (`projection-outcomes`).
9. **Paycheck's row:** Household take-home is the hero when a household of two or more shows it, else Monthly net; the
   breakdown card loses its nested tile AND its "Employer match +$X per check" line (now the fourth tile).

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/format.ts` (+ test) | number formatting | add `formatCurrencyWhole` |
| `src/components/StatTile.tsx` (+ test) | the tile | four children always; badge line; figure span; delta clauses |
| `src/components/panels.css` | shared tile CSS (L2's region: `.kpi-row`/`.stat-*` ~79–217, skeleton tiles ~686–732) | subgrid rows, value container, badge/delta lines, steady rows, five-tile rows, ghost lines |
| `src/components/tileRowCss.test.ts` (new) | CSS text pins for all of the above | new |
| `src/components/PageSkeleton.tsx` (+ test) | ghosts | row variants, hero, steady, page class; ghosts in real lines |
| `src/components/skeletonMetrics.ts` (+ test) | ghost arithmetic | drop the CSS tile twin; measured tile height; paycheck feed ghost |
| `src/components/networth/headline.ts` (+ test) | Net worth hero words | whole dollars; tile month story |
| `src/pages/NetWorthPage.tsx` (+ test) | tile region only | steady row, whole-dollar groups, ghost spec |
| `src/pages/OverviewPage.tsx` (+ test) | tile region only (L1 owns the primary band/Customize) | steady row, hero ghost, whole dollars, "12-mo avg" |
| `src/pages/SpendingPage.tsx` (+ test) | KPI row only (L1 owns Trends) | steady row, tax/transfers line, vs-previous-month lines, ghost spec |
| `src/pages/ProjectionPage.tsx`, `ProjectionPage.css`, `projectionCss.test.ts` | outcomes band | FI ratio line; local 3 + 2 copy deleted; band margins; ghost spec |
| `src/components/calendar/CashflowStrip.tsx` (+ test), `src/pages/CalendarPage.tsx` (skeleton prop), `src/pages/CalendarPage.css` (`.cal-strip` rules only; L1 owns `.cal-grid`) | cash-flow strip | tile slots; Scheduled in/out lines; five-across reset |
| `src/components/espp/PositionStrip.tsx` (+ test) | ESPP strip | quote and avg-cost lines; whole dollars; five ghost row |
| `src/pages/PortfolioPage.tsx` (+ test) | tile region + skeleton prop | holdings count line; whole dollars; dense hero ghosts per tab |
| `src/components/taxes/WithholdingPanel.tsx` (+ test), `src/pages/TaxesPage.tsx` (one prop) | Will I owe? tiles | "27.3% effective"; whole dollars |
| `src/components/taxes/WhatIfPanel.tsx` (+ test) | What-if rows | mixed rows get lines; whole dollars |
| `src/components/comp/VestingSchedulePanel.tsx`, `src/pages/CompPage.test.tsx` | vesting tiles | whole dollars |
| `src/pages/MonthlyUpdatePage.tsx`, `MonthlyUpdatePage.css` (`.review-kpis`), `src/components/monthly/story.ts` (+ tests) | Review tiles | Living spending line; whole dollars; row spacing variable |
| `src/pages/CreditCardsPage.tsx` (+ test) | card tiles | five-tile row when the advantage tile shows |
| `src/pages/PaycheckPage.tsx`, `PaycheckPage.css` (+ test) | Summary tiles + BreakdownPanel only (L6 owns Profiles) | one row of four; nested tile and match line gone |
| `docs/superpowers/plans/2026-09-25-polish-L2-tiles.md` | this plan | "As built" appended at the end |

Commands run from the worktree root `C:\Users\edyli\personal-finance-dashboard\.worktrees\polish-tiles` (Git Bash).

---

### Task 1: A whole-dollar formatter

**Files:**
- Modify: `src/utils/format.ts` (after `formatCurrency`, line 12)
- Test: `src/utils/format.test.ts`

- [ ] **Step 1: Write the failing test** — add `formatCurrencyWhole` to the import list at the top of
  `src/utils/format.test.ts`, then append:

```ts
// A stat tile's delta amount (2026-09-25 polish spec §4.3): whole dollars, while the tile's value
// keeps its cents.
describe('formatCurrencyWhole', () => {
  it('rounds a server decimal string to whole dollars, signed the way formatCurrency signs', () => {
    expect(formatCurrencyWhole('126583.02')).toBe('$126,583')
    expect(formatCurrencyWhole('-2911.11')).toBe('-$2,911')
    expect(formatCurrencyWhole(1234.5)).toBe('$1,235')
    expect(formatCurrencyWhole('-0.5')).toBe('-$1')
  })

  it('prints a figure that rounds to nothing as "$0", never "-$0"', () => {
    expect(formatCurrencyWhole('-0.49')).toBe('$0')
    expect(formatCurrencyWhole('0.49')).toBe('$0')
    expect(formatCurrencyWhole(0)).toBe('$0')
  })

  it('dashes a missing figure, like formatCurrency', () => {
    expect(formatCurrencyWhole(null)).toBe('—')
    expect(formatCurrencyWhole(undefined)).toBe('—')
    expect(formatCurrencyWhole('')).toBe('—')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/utils/format.test.ts`
Expected: FAIL — `formatCurrencyWhole is not a function` (or a TS import error).

- [ ] **Step 3: Implement** — in `src/utils/format.ts`, after `formatCurrency`:

```ts
const wholeCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** "$126,583" — the amount in a stat tile's delta (2026-09-25 polish spec §4.3): whole dollars, while
 *  the tile's value keeps its cents. A figure that rounds to nothing prints "$0", never "-$0". */
export function formatCurrencyWhole(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return wholeCurrency.format(Math.abs(n) < 0.5 ? 0 : n)
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/utils/format.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/format.ts src/utils/format.test.ts
git commit -m "feat(format): formatCurrencyWhole — whole dollars for tile deltas" -m "Spec 2026-09-25 §4.3: a tile's delta shows whole dollars while its value keeps the cents. A figure that rounds to nothing prints \$0, never -\$0."
```

---

### Task 2: StatTile renders four lines — label · badge · value · delta (contract C4)

**Files:**
- Modify: `src/components/StatTile.tsx` (render, lines 1 and 119–143; new module-private `clausesOf`)
- Test: `src/components/StatTile.test.tsx`; fallout in `src/pages/OverviewPage.test.tsx`,
  `src/components/espp/PositionStrip.test.tsx`, `src/pages/CompPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — append to `src/components/StatTile.test.tsx`:

```tsx
// Contract C4 (2026-09-25 polish spec §4.1): four children, always, in this order — each is a line
// the row shares, so a line's labels, badges, values and deltas can sit on shared tracks.
describe('StatTile four lines', () => {
  it('renders label, badge row, value and delta in that order, all four every time', () => {
    render(<StatTile label="Net worth" value="$1.00" />)
    const tile = document.querySelector('.stat-tile') as HTMLElement
    expect([...tile.children].map((child) => child.className)).toEqual([
      'stat-label',
      'stat-badge-row',
      'stat-value',
      'stat-delta stat-delta-neutral',
    ])
    // Empty lines are EMPTY — no whitespace node — so CSS `:empty` can size them to nothing.
    expect(tile.querySelector('.stat-badge-row')?.childNodes.length).toBe(0)
    expect(tile.querySelector('.stat-delta')?.childNodes.length).toBe(0)
  })

  it('sets the figure in its own span, the unit after it', () => {
    render(<StatTile label="Money lasts" value="92.4%" unit="of paths through 2075" />)
    const value = document.querySelector('.stat-value') as HTMLElement
    expect(value.querySelector('.stat-value-figure')?.textContent).toBe('92.4%')
    expect(value.textContent).toBe('92.4% of paths through 2075')
  })

  it('splits a delta into clauses at its top-level dots, the glyph riding the first', () => {
    render(<StatTile label="Net worth" value="$1.00" delta="$126,583 (+15.7%) since Sep 1 · 21 days" tone="positive" />)
    const clauses = [...document.querySelectorAll('.stat-delta > .stat-delta-clause')].map((c) => c.textContent)
    expect(clauses).toEqual(['▲ $126,583 (+15.7%) since Sep 1', '· 21 days'])
    // The words read exactly as before: the clauses add no text.
    expect(document.querySelector('.stat-delta')?.textContent).toBe('▲ $126,583 (+15.7%) since Sep 1 · 21 days')
    expect(document.querySelector('.stat-delta-clause span[aria-hidden="true"]')?.textContent).toBe('▲ ')
  })

  it('never splits inside parentheses, and leaves a one-clause delta as plain text', () => {
    render(<StatTile label="Sep 1 balances" value="$1.00" delta="September's change: ▲ $1 (Sep 1 → Sep 22 · provisional)" />)
    expect(document.querySelector('.stat-delta-clause')).toBeNull()
    expect(screen.getByText("September's change: ▲ $1 (Sep 1 → Sep 22 · provisional)")).toBeTruthy()
  })
})
```

  Replace the second half of `'hides the glyph from assistive tech and drops the whole row with no delta'` (from
  `cleanup()` to the end of the test) and rename it:

```tsx
  it('hides the glyph from assistive tech, and keeps an EMPTY delta line with no delta', () => {
    render(<StatTile label="Net worth" value="$1.00" delta="$10.00 MoM" tone="positive" />)
    // ▲/▼ are decoration: the colour is redundant with the caller's words, and a screen
    // reader announcing "black up-pointing triangle" adds nothing the text does not say.
    expect(delta()?.querySelector('span')?.getAttribute('aria-hidden')).toBe('true')
    // …and the words survive intact beside it (plain attribute/text asserts — this project
    // does not install jest-dom matchers).
    expect(delta()?.textContent).toBe('▲ $10.00 MoM')

    cleanup()
    // A rate is a level, not a movement: no delta prop — and the delta LINE stays, empty, because
    // it is the row's track, not the tile's (2026-09-25 polish spec §4.1).
    render(<StatTile label="Effective tax" value="24.7%" tone="positive" />)
    expect(delta()?.textContent).toBe('')
    expect(delta()?.childNodes.length).toBe(0)
    expect(screen.getByText('24.7%')).toBeTruthy()
  })
```

  Replace the first two tests of `describe('StatTile badge and label unit', …)`:

```tsx
  it('renders the badge as a pill on its own line, never inside the label', () => {
    render(<StatTile label="Living spending" value="$4,932.87" badge="Not yet reviewed" hint="Cash outflow this month." />)
    const badge = document.querySelector('.stat-badge-row > .stat-badge')
    expect(badge?.textContent).toBe('Not yet reviewed')
    // The label line holds the label alone: a badge there wrapped under it at 1440 and dropped that
    // one value 17–19px below its neighbours (OU-03).
    expect(document.querySelector('.stat-label .stat-badge')).toBeNull()
    expect(document.querySelector('.stat-label')?.textContent).toBe('Living spending')
    // Every page test that finds a tile by its label keeps working: the text is one node.
    expect(screen.getByText('Living spending')).toBeTruthy()
    // Text and (i) share one nowrap span, so the icon can never wrap alone.
    const unit = document.querySelector('.stat-label-text') as HTMLElement
    expect(unit.textContent).toBe('Living spending')
    expect(unit.querySelector('button.info-hint')).toBeTruthy()
  })

  it('renders no badge node without the prop — the badge line stays, empty', () => {
    render(<StatTile label="Net worth" value="$1.00" />)
    expect(document.querySelector('.stat-badge')).toBeNull()
    expect(document.querySelector('.stat-badge-row')?.childNodes.length).toBe(0)
    expect(document.querySelector('.stat-label')?.textContent).toBe('Net worth')
  })
```

  (The CSS pin in that describe block is rewritten in Task 3.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/StatTile.test.tsx`
Expected: FAIL — the four-lines tests (children are `stat-label, stat-value` only), the clause tests, the badge-row tests.

- [ ] **Step 3: Implement** — `src/components/StatTile.tsx`: first line becomes
  `import { Fragment, useEffect, useRef, useState } from 'react'`; replace the `return (…)` (lines 119–143) with:

```tsx
  const clauses = delta === undefined ? [] : clausesOf(delta)
  const glyphSpan = glyph ? <span aria-hidden="true">{glyph} </span> : null
  return (
    <div className={hero ? 'stat-tile stat-tile-hero' : 'stat-tile'}>
      {/* Four lines, always, in this order (2026-09-25 polish spec §4.1, contract C4). Inside a row
          each is a track the row shares — label · badge · value · delta — so a line's figures sit on
          one baseline and its deltas start on one line whatever each tile carries. */}
      <div className="stat-label">
        {/* One nowrap unit for the words and their (i): an atomic inline may break before it,
            and the icon kept landing alone on a second line (audit P-11). */}
        <span className="stat-label-text">
          {label}
          {hint !== undefined && evidence === undefined && <InfoHint text={hint} />}
          {evidence !== undefined && <MetricInfoButton evidence={evidence} />}
        </span>
      </div>
      {/* The badge's own line: beside the label it wrapped under it in a narrow tile and pushed that
          one value off the row's baseline (OU-03). Empty without a badge. */}
      <div className="stat-badge-row">{badge !== undefined && <span className="stat-badge">{badge}</span>}</div>
      <div className="stat-value">
        {/* The figure is what .stat-value's container width sizes (panels.css). */}
        <span className="stat-value-figure">{display ?? value}</span>
        {unit !== undefined && <span className="stat-value-unit"> {unit}</span>}
      </div>
      {/* Always present, empty without a delta: the line is the row's, not this tile's. */}
      <div className={`stat-delta stat-delta-${tone ?? 'neutral'}`}>
        {clauses.length === 1 && (
          <>
            {glyphSpan}
            {delta}
          </>
        )}
        {clauses.length > 1 &&
          clauses.map((clause, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              {/* One unbreakable clause (spec §4.3): the line breaks between "…since Sep 1" and
                  "· 21 days", never inside "Sep 1" or "21 days". */}
              <span className="stat-delta-clause">
                {i === 0 ? glyphSpan : '· '}
                {clause}
              </span>
            </Fragment>
          ))}
      </div>
    </div>
  )
}

/** A delta's clauses: its top-level " · " splits it ("…since Sep 1" | "21 days"); one inside
 *  parentheses never does ("(Sep 1 → Sep 22 · provisional)" stays whole). */
function clausesOf(delta: string): string[] {
  const clauses: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < delta.length; i++) {
    const char = delta[i]
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && delta.startsWith(' · ', i)) {
      clauses.push(delta.slice(start, i))
      start = i + 3
      i += 2
    }
  }
  clauses.push(delta.slice(start))
  return clauses
}
```

  Also update the doc comment of the `badge` prop to: `/** A small status pill on the badge line under the label
  ("Not yet reviewed") — its own line since 2026-09-25 (polish spec §4.1). */`

- [ ] **Step 4: Fix the fallout the probe found** (an absent delta is now an empty `.stat-delta`; a multi-clause delta is
  no longer one text node):
  - `src/pages/OverviewPage.test.tsx` lines 756, 798, 844, 1456, 1458, 2109: `expect(deltaOf(X)).toBeNull()` →
    `expect(deltaOf(X)?.textContent).toBe('')` (X as written on each line).
  - `src/components/espp/PositionStrip.test.tsx` lines 111 and 123: `expect(tile.querySelector('.stat-delta')).toBeNull()`
    → `expect(tile.querySelector('.stat-delta')?.textContent).toBe('')`.
  - `src/pages/CompPage.test.tsx` line 839: `expect(within(tile('Next vest')).getByText('105 sh · $20,101.20')).toBeTruthy()`
    → `expect(tile('Next vest').querySelector('.stat-delta')?.textContent).toBe('105 sh · $20,101.20')`.

- [ ] **Step 5: Run the touched files, then the whole suite**

Run: `npx vitest run src/components/StatTile.test.tsx src/pages/OverviewPage.test.tsx src/components/espp/PositionStrip.test.tsx src/pages/CompPage.test.tsx`
Expected: PASS. Then `npx vitest run --maxWorkers=4` — Expected: PASS (the probe found no other fallout).

- [ ] **Step 6: Commit**

```bash
git add src/components/StatTile.tsx src/components/StatTile.test.tsx src/pages/OverviewPage.test.tsx src/components/espp/PositionStrip.test.tsx src/pages/CompPage.test.tsx
git commit -m "feat(tiles): StatTile renders four lines — label, badge, value, delta (contract C4)" -m "Spec 2026-09-25 §4.1: the badge leaves the label line for a line of its own (it wrapped under two labels at 1440 and dropped those values 17-19px, OU-03); the delta line is always present, empty without a delta; the figure sits in its own span for the value line's container; a delta's top-level ' · ' clauses become atomic spans so a line breaks between clauses, never inside 'Sep 1'."
```

---

### Task 3: The row is the grid, the tile its four-line subgrid (panels.css)

**Files:**
- Modify: `src/components/panels.css` (tile section, lines 79–217)
- Create: `src/components/tileRowCss.test.ts`
- Modify: `src/components/StatTile.test.tsx` (the CSS pin, last test of the badge describe)

- [ ] **Step 1: Write the failing CSS pins** — create `src/components/tileRowCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom): a pin survives a re-indent and
// a comment moving, and fails only when a declaration changes. jsdom lays nothing out and resolves no
// subgrid or container query, so the stylesheet's text is what can be held to spec 2026-09-25 §4; the
// browser checks in the plan's Task 16 measure the result.
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const CSS = flat('panels.css')
// The rule whose selector is exactly `selector` — "} .stat-tile {", never the tail of
// ".stat-tile-slot > .stat-tile {".
const rule = (selector: string) => {
  const at = CSS.indexOf(`} ${selector} {`)
  if (at < 0) throw new Error(`panels.css has no rule for ${selector}`)
  return CSS.slice(at + 2, CSS.indexOf('}', at + 2) + 1)
}

describe('tile rows share one grid (spec §4.1)', () => {
  it('makes every tile — or its labelled slot — a four-line subgrid of its row', () => {
    expect(CSS).toContain(
      '.kpi-row > .stat-tile, .kpi-row > .stat-tile-slot, .stat-tile-slot > .stat-tile { grid-row: span 4; grid-template-rows: subgrid; row-gap: 0; }',
    )
    expect(CSS).toContain('.stat-tile-slot { display: grid; grid-template-columns: minmax(0, 1fr); }')
  })

  // A parent gutter is absorbed INTO subgrid tracks: with a 16px row gap an empty badge line measured
  // 16px in Edge. So the row has none, lines are spaced by each tile's bottom margin, and the row's
  // own margin gives that back — the space under a row is --kpi-row-after either way.
  it('spaces lines of tiles with the tiles, not with a row gap', () => {
    expect(rule('.kpi-row')).toContain('row-gap: 0;')
    expect(rule('.kpi-row')).toContain('column-gap: var(--density-grid-gap);')
    expect(rule('.kpi-row')).toContain('--kpi-row-after: 1rem;')
    expect(rule('.kpi-row')).toContain('margin-bottom: calc(var(--kpi-row-after) - var(--density-grid-gap));')
    expect(CSS).toContain('.kpi-row > * { margin-bottom: var(--density-grid-gap); }')
  })

  // A size container establishes an independent formatting context, and that turns subgrid off:
  // four tiles' lines drifted apart in Edge. .stat-value is the container now — the same width.
  it('keeps the tile out of container-type and sizes the figure from .stat-value', () => {
    expect(rule('.stat-tile')).not.toContain('container-type')
    expect(rule('.stat-tile')).toContain('display: grid;')
    expect(rule('.stat-tile')).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(rule('.stat-value')).toContain('container-type: inline-size;')
    expect(rule('.stat-value')).toContain('align-self: baseline;')
    expect(CSS).toContain('.stat-value-figure { font-size: min(clamp(1.1rem, 0.9rem + 0.5vw, 1.45rem), 10.5cqi); }')
    expect(CSS).toContain('.stat-tile-hero .stat-value-figure { font-size: min(clamp(1.5rem, 1rem + 1.1vw, 2.4rem), 12cqi); }')
  })

  it('costs an empty badge or delta line nothing, and keeps each delta clause whole', () => {
    expect(CSS).toContain('.stat-badge-row { display: flex; align-items: center; }')
    expect(CSS).toContain('.stat-badge-row:not(:empty) { margin-bottom: 0.35rem; }')
    expect(CSS).toContain('.stat-delta:empty { margin-top: 0; }')
    expect(CSS).toContain('.stat-delta-clause { display: inline-block; }')
  })

  it('reserves the badge line and one delta line on a steady row, in their own boxes', () => {
    expect(CSS).toContain(
      '.stat-badge, .kpi-row-steady .stat-badge-row:empty::before { padding: 0.05rem 0.45rem; font-size: 0.7rem; font-weight: 500; }',
    )
    expect(CSS).toContain(
      ".kpi-row-steady .stat-badge-row:empty::before, .kpi-row-steady .stat-delta:empty::before { content: '\\a0'; visibility: hidden; }",
    )
    expect(CSS).toContain('.kpi-row-steady .stat-badge-row { margin-bottom: 0.35rem; }')
    expect(CSS).toContain('.kpi-row-steady .stat-delta:empty { margin-top: 0.35rem; }')
  })
})
```

  In `src/components/StatTile.test.tsx`, replace the test `'pins the CSS: the unit is nowrap and the pill wears --fill at
  .7rem in the caller’s casing'` with:

```tsx
  it('pins the CSS: the unit is nowrap and the pill wears --fill in the caller’s casing', () => {
    const css = readFileSync(path.join(__dirname, 'panels.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
    expect(css).toContain('.stat-label-text { white-space: nowrap; }')
    expect(css).toMatch(/\.stat-badge \{[^}]*background: var\(--fill\);[^}]*text-transform: none;/)
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/tileRowCss.test.ts src/components/StatTile.test.tsx`
Expected: FAIL — `.kpi-row` has `gap:`, no subgrid rule, `.stat-tile` has `container-type`, no `.stat-value-figure`.

- [ ] **Step 3: Implement** — in `src/components/panels.css` replace the `.kpi-row { … }` rule (lines 81–86) with:

```css
/* One strip, four lines (2026-09-25 polish spec §4.1, contract C4). The row is the grid and every tile
   a four-row SUBGRID of it — label · badge · value · delta — so a line's labels, badges, values and
   deltas share tracks: the figures sit on one baseline and the deltas start on one line whatever each
   tile carries. The row has NO row gap on purpose: a subgrid's tracks absorb half the parent's gutter
   on each side, so a row gap opened inside every tile (an empty badge line measured 16px in Edge).
   Lines of tiles are spaced by each tile's bottom margin instead, and the row's own margin gives that
   back: the space under a row is --kpi-row-after either way (a page that wants more sets the variable). */
.kpi-row {
  --kpi-row-after: 1rem;
  display: grid;
  column-gap: var(--density-grid-gap);
  row-gap: 0;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-bottom: calc(var(--kpi-row-after) - var(--density-grid-gap));
}

.kpi-row > * {
  margin-bottom: var(--density-grid-gap);
}

.kpi-row > .stat-tile,
.kpi-row > .stat-tile-slot,
.stat-tile-slot > .stat-tile {
  grid-row: span 4;
  grid-template-rows: subgrid;
  row-gap: 0;
}

/* A wrapper that labels its tile (CashflowStrip's role="group") takes part in the row's four lines
   too: a subgrid of the row whose one child is a subgrid of it — the wrappers were stretched while
   the tiles inside kept their content height, a 22px ragged bottom (PCC-17). */
.stat-tile-slot {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
```

  Replace the `.stat-tile { … }` rule (lines 125–132) with:

```css
.stat-tile {
  display: grid;
  /* One track exactly the tile's width: an auto column would widen to a nowrap label and wrap the
     delta past the tile's edge. */
  grid-template-columns: minmax(0, 1fr);
  /* A tile outside a row (Card detail's verdict) has four rows of its own, packed at the top. */
  align-content: start;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.9rem 1.1rem 1rem;
  /* NOT a size container: a container establishes an independent formatting context, and that turns
     the subgrid off — four tiles' lines drifted apart in Edge. .stat-value is the container now. */
}
```

  Replace the `.stat-badge { … }` rule and its comment (lines 150–164) with:

```css
/* Line 2, the badge's own line: beside the label a badge wrapped under it in a narrow tile and dropped
   that one value off the row's baseline (OU-03). Empty, it is 0px — a line where no tile has a badge
   costs nothing. A flex row, so the line is the badge's own height and not a text strut's. */
.stat-badge-row {
  display: flex;
  align-items: center;
}

.stat-badge-row:not(:empty) {
  margin-bottom: 0.35rem;
}

/* The badge's box — shared with a steady row's reserve (below), so a reserved line is exactly a badge
   tall. */
.stat-badge,
.kpi-row-steady .stat-badge-row:empty::before {
  padding: 0.05rem 0.45rem;
  font-size: 0.7rem;
  font-weight: 500;
}

/* A small status pill in the caller's own casing — a state, not an eyebrow. */
.stat-badge {
  border-radius: 999px;
  background: var(--fill);
  color: var(--muted);
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
}
```

  Replace the `.stat-value { … }` rule (lines 173–180, keeping the comment block above it but retargeted) and the hero
  rule (lines 193–195) with:

```css
/* Line 3. The size container its figure scales against — the tile cannot be one (see .stat-tile), and
   this box is the tile's content width, what cqi read when the tile was the container. Values share
   the line's FIRST baseline, a hero's included; a unit line hangs below its figure (Money lasts) rather
   than lifting it off the row, which is what `last baseline` did (measured 16px in Edge). */
.stat-value {
  container-type: inline-size;
  align-self: baseline;
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  /* Small on purpose: the figure sets the line, this only sizes the line's strut. */
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Sized from the TILE, not the viewport. …(the existing comment, unchanged)… */
.stat-value-figure {
  font-size: min(clamp(1.1rem, 0.9rem + 0.5vw, 1.45rem), 10.5cqi);
}

/* The hero's cqi cap is LOOSER …(the existing comment, unchanged)… */
.stat-tile-hero .stat-value-figure {
  font-size: min(clamp(1.5rem, 1rem + 1.1vw, 2.4rem), 12cqi);
}
```

  Replace the `.stat-delta { … }` rule (lines 209–212) with:

```css
/* Line 4. Empty, it costs nothing: a line whose tiles carry no delta ends at its values. */
.stat-delta {
  margin-top: 0.35rem;
  font-size: 0.8rem;
}

.stat-delta:empty {
  margin-top: 0;
}

/* A delta's clauses are atomic (spec §4.3): the line breaks between "…since Sep 1" and "· 21 days",
   never inside "Sep 1" or "21 days". inline-block rather than nowrap, so a clause wider than its whole
   tile still wraps inside itself instead of running out of the tile. */
.stat-delta-clause {
  display: inline-block;
}

/* A steady row keeps one height as its month changes (the Overview, Net worth, Spending; spec §4.3):
   its badge line and one delta line stand whether or not the month on show fills them. The reserve is
   an invisible no-break space in the badge's own box and in the delta's own type, so a reserved line is
   exactly as tall as the line it stands in for. */
.kpi-row-steady .stat-badge-row {
  margin-bottom: 0.35rem;
}

.kpi-row-steady .stat-badge-row:empty::before,
.kpi-row-steady .stat-delta:empty::before {
  content: '\a0';
  visibility: hidden;
}

.kpi-row-steady .stat-delta:empty {
  margin-top: 0.35rem;
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components/tileRowCss.test.ts src/components/StatTile.test.tsx src/components/PageSkeleton.test.tsx src/components/skeletonMetrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels.css src/components/tileRowCss.test.ts src/components/StatTile.test.tsx
git commit -m "feat(tiles): each tile is a four-line subgrid of its row" -m "Spec 2026-09-25 §4.1 / D7: label, badge, value and delta lines are row tracks, so values share a baseline (23.4px apart on the Overview before) and deltas start on one line. The tile stops being a size container (containers turn subgrid off - measured in Edge); .stat-value is the container its figure sizes against. The row has no row gap (a parent gutter leaked 16px into every empty badge line); tiles carry the line spacing. .kpi-row-steady reserves the badge line and one delta line."
```

---

### Task 4: Five-tile rows go 3 + 2, never 4 + 1 (spec §4.2)

**Files:**
- Modify: `src/components/panels.css` (the "Balanced rows" block, lines 95–123)
- Modify: `src/pages/ProjectionPage.css` (delete lines 49–60's 3 + 2 copy; band margins)
- Modify: `src/pages/projectionCss.test.ts`
- Modify: `src/pages/CalendarPage.css` (`.cal-strip` rules, lines 448–463 only)
- Test: `src/components/tileRowCss.test.ts`

- [ ] **Step 1: Write the failing pins** — append to `src/components/tileRowCss.test.ts`:

```ts
describe('five-tile rows (spec §4.2)', () => {
  const FIVE = '.kpi-row:is(.kpi-row-5, .kpi-row-dense)'
  const block = (query: string) => {
    const at = CSS.indexOf(`@container page ${query} {`)
    if (at < 0) throw new Error(`panels.css has no ${query} block`)
    return CSS.slice(at, CSS.indexOf('} }', at) + 3)
  }

  it('lays five tiles five across from 1000px of page', () => {
    expect(CSS).toContain('.kpi-row-5, .kpi-row-dense { grid-template-columns: repeat(5, minmax(0, 1fr)); }')
  })

  // Projection's local rule, generalised (batch 2 final verification D5): six tracks, each tile spans
  // two, the fourth and fifth span three — both lines filled (PE-02: 2 + 2 + 1 with the dock).
  it('goes a balanced 3 + 2 on six tracks from 660 to 999px', () => {
    const body = block('(660px <= width < 1000px)')
    expect(body).toContain(`${FIVE} { grid-template-columns: repeat(6, minmax(0, 1fr)); }`)
    expect(body).toContain(`${FIVE} > * { grid-column: span 2; }`)
    expect(body).toContain(`${FIVE} > :nth-child(n + 4) { grid-column: span 3; }`)
  })

  it('goes two columns under 660px, the odd last tile spanning both', () => {
    const body = block('(width < 660px)')
    expect(body).toContain(`${FIVE} { grid-template-columns: repeat(2, minmax(0, 1fr)); }`)
    expect(body).toContain(`${FIVE} > :last-child:nth-child(odd) { grid-column: 1 / -1; }`)
  })

  it('keeps every other row auto-fit, then two columns under 980px', () => {
    const body = block('(max-width: 980px)')
    expect(body).toContain('.kpi-row:not(.kpi-row-5, .kpi-row-dense) { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
    expect(body).toContain('.kpi-row:not(.kpi-row-5, .kpi-row-dense) > :last-child:nth-child(odd) { grid-column: 1 / -1; }')
  })
})

describe("the calendar strip's own five-across (CalendarPage.css)", () => {
  const CAL = flat('../pages/CalendarPage.css')

  // Five across from 880px (2026-09-23 spec §B2), so the shared 3 + 2 spans must stand down there or
  // the fifth tile wraps; (0,4,0) and (0,3,0) outrank panels.css's (0,3,0)/(0,2,0) in any load order.
  it('holds five columns from 880px with every tile on one track', () => {
    expect(CAL).toContain(
      '@container page (min-width: 880px) { .cal-strip.kpi-row.kpi-row-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); } .cal-strip.kpi-row.kpi-row-5 > :nth-child(n) { grid-column: auto; } }',
    )
  })

  it('leaves the space under the strip to the row (no second margin)', () => {
    expect(CAL).not.toMatch(/\.cal-strip \{[^}]*margin-bottom/)
  })
})
```

  In `src/pages/projectionCss.test.ts` replace the whole `describe('ProjectionPage.css — the outcomes band on a laptop …')`
  block with:

```ts
describe('ProjectionPage.css — the outcomes band (2026-09-25 polish spec §4.2)', () => {
  // The 3 + 2 rule this sheet kept for itself lives in panels.css for every five-tile row now.
  it('keeps no local copy of the five-tile layout', () => {
    expect(css).not.toContain('repeat(6, minmax(0, 1fr))')
    expect(css).not.toMatch(/\.projection-outcomes > :nth-child/)
  })

  // Pinned, the band's own 8px padding is its bottom space: the tiles' 16px line margin (panels.css)
  // would stand inside the pinned band and grow it, so there the tiles keep 8px and the band 1rem.
  it('keeps the pinned band as tall as its one line plus 8px each side', () => {
    const block = at(/@container page \(width >= 1000px\) \{/, '>=1000px container block')
    const body = css.slice(block, css.indexOf('\n}', block))
    expect(body).toMatch(/\.projection-outcomes\.kpi-row \{[^}]*padding-bottom: 0;[^}]*margin-bottom: 1rem;/)
    expect(body).toMatch(/\.projection-outcomes\.kpi-row > \* \{[^}]*margin-bottom: 8px;/)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/tileRowCss.test.ts src/pages/projectionCss.test.ts`
Expected: FAIL — no `repeat(5` base rule for both, no range blocks, Projection copy still present, `.cal-strip` margin.

- [ ] **Step 3: Implement** — in `src/components/panels.css` replace lines 95–123 (the comment and the four rules from
  `.kpi-row-5 { … }` through the `@container page (max-width: 980px)` block) with:

```css
/* Balanced rows (2026-09-13 polish §12; 2026-09-25 polish spec §4.2). Container queries on the page, not
   media queries: the dock is the thing that changes the width. A default row — four tiles or fewer —
   auto-fits, then goes two columns under 980px, where four read as 3 + 1. A FIVE-tile row (.kpi-row-5:
   ESPP's strip, the Projection's outcomes, the calendar's cash flow; .kpi-row-dense: Portfolio's) is
   five across from 1000px; from 660 to 999px a balanced 3 + 2 on six tracks — each tile spans two, the
   fourth and fifth span three, so both lines fill the width (the Projection's own rule, generalised);
   under 660px two columns. Never 4 + 1 or 2 + 2 + 1, dock open or closed (PE-02).
   There is NO CSS-only fill for an auto-fit band: `.kpi-row > :last-child { grid-column-end: -1 }`
   resolved to a one-track item in the LAST column (2026-09-13 review round). A span needs a known start
   line, so the spans live only where the arithmetic IS known — the fixed six- and two-column bands. */
.kpi-row-5,
.kpi-row-dense {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

@container page (660px <= width < 1000px) {
  .kpi-row:is(.kpi-row-5, .kpi-row-dense) { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .kpi-row:is(.kpi-row-5, .kpi-row-dense) > * { grid-column: span 2; }
  .kpi-row:is(.kpi-row-5, .kpi-row-dense) > :nth-child(n + 4) { grid-column: span 3; }
}

@container page (width < 660px) {
  .kpi-row:is(.kpi-row-5, .kpi-row-dense) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpi-row:is(.kpi-row-5, .kpi-row-dense) > :last-child:nth-child(odd) { grid-column: 1 / -1; }
}

@container page (max-width: 980px) {
  .kpi-row:not(.kpi-row-5, .kpi-row-dense) { grid-template-columns: repeat(2, minmax(0, 1fr)); }

  /* Exactly two columns here, so "starts a new line" IS knowable: :nth-child(odd) is the last tile
     of an odd count, and it spans the pair instead of sitting half-width beside a hole. */
  .kpi-row:not(.kpi-row-5, .kpi-row-dense) > :last-child:nth-child(odd) { grid-column: 1 / -1; }
}
```

  (Keep `.kpi-row-lone` and its comment where they are, between the base `.kpi-row` rules and this block.)

  In `src/pages/ProjectionPage.css`: delete the comment and block from `/* …and in that band the five tiles are a balanced
  3 + 2` through the closing `}` of `@container page (min-width: 660px) and (max-width: 999px) { … }` (lines 49–60), and
  after the `.projection-outcomes { … }` rule (line 22) add:

```css
/* Pinned (one line of tiles, ≥1000px) the band's own 8px padding is its bottom space: the row spaces
   its lines with each tile's 16px bottom margin (panels.css, 2026-09-25 polish §4.1), which would stand
   inside the pinned band and grow it 16px. So there the tiles keep 8px and the band its 1rem below —
   the band is as tall as before. Unpinned (<1000px, 3 + 2) the shared spacing stands. */
@container page (width >= 1000px) {
  .projection-outcomes.kpi-row { padding-bottom: 0; margin-bottom: 1rem; }
  .projection-outcomes.kpi-row > * { margin-bottom: 8px; }
}
```

  In `src/pages/CalendarPage.css` replace lines 448–463 (`/* The strip sits above the card grid…` through the close of
  the `@container page (min-width: 880px)` block) with:

```css
/* Five tiles since Living costs joined the strip (2026-09-23 spec §B2). The shared five-tile row goes
   3 + 2 below 1000px of page (panels.css), but these tiles carry short labels and cent figures (the value
   font scales with its own tile), so they hold five columns from 880px — a 1280 window gives this page
   ~990px. Every tile takes one track there: the shared 3 + 2 spans would push the fifth to a second
   line. The space under the strip is the row's own (panels.css --kpi-row-after). */
@container page (min-width: 880px) {
  .cal-strip.kpi-row.kpi-row-5 {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .cal-strip.kpi-row.kpi-row-5 > :nth-child(n) {
    grid-column: auto;
  }
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components/tileRowCss.test.ts src/pages/projectionCss.test.ts src/components/calendar/CashflowStrip.test.tsx src/pages/ProjectionPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels.css src/components/tileRowCss.test.ts src/pages/ProjectionPage.css src/pages/projectionCss.test.ts src/pages/CalendarPage.css
git commit -m "feat(tiles): five-tile rows go 3 + 2 below 1000px, never 4 + 1" -m "Spec 2026-09-25 §4.2: .kpi-row-5 and .kpi-row-dense take the Projection's six-track rule (tiles span 2, the 4th and 5th span 3) from 660 to 999px and two columns below; five across from 1000px for both (dense stayed auto-fit and went 4 + 1 at 1000-1064px). Before: ESPP 4 + 1 at 1280, Portfolio 2 + 2 + 1 with the dock. The Projection-local copy goes; its pinned band keeps its height under the row's new line margins; the calendar keeps its own five-across from 880px with the shared spans reset."
```

---

### Task 5: Ghosts stand in the real lines and take the row's variant (spec §4.6)

**Files:**
- Modify: `src/components/PageSkeleton.tsx`
- Modify: `src/components/panels.css` (skeleton tile rules, lines 693–732)
- Modify: `src/components/skeletonMetrics.ts` (STAT_TILE comment/value)
- Test: `src/components/PageSkeleton.test.tsx`, `src/components/skeletonMetrics.test.ts`, `src/components/tileRowCss.test.ts`

- [ ] **Step 1: Write the failing tests** — in `src/components/PageSkeleton.test.tsx` replace the whole
  `describe('ghost parity (motion spec §7)', …)` block with:

```tsx
describe('ghost parity (motion spec §7; 2026-09-25 polish spec §4.6)', () => {
  const lines = (tile: Element) => [...tile.children].map((child) => child.className)

  it('draws each ghost as the real tile’s four lines, a block inside three of them', () => {
    const { rerender } = render(<PageSkeleton tiles={2} strip />)
    const tiles = document.querySelectorAll('.kpi-row .stat-tile.skeleton-tile')
    expect(tiles.length).toBe(2)
    expect(lines(tiles[0])).toEqual(['stat-label', 'stat-badge-row', 'stat-value', 'stat-delta'])
    expect(tiles[0].querySelectorAll('.skeleton').length).toBe(3) // label, value, delta
    expect(tiles[0].querySelector('.stat-value > .stat-value-figure > .skeleton-value')).not.toBeNull()
    expect(tiles[0].querySelector('.stat-badge-row')?.childNodes.length).toBe(0)
    expect(document.querySelector('.skeleton-strip')?.getAttribute('aria-hidden')).toBe('true')
    rerender(<PageSkeleton tiles={2} />)
    expect(document.querySelector('.skeleton-strip')).toBeNull()
  })

  it('takes the real row’s variant, steadiness, hero and page class', () => {
    render(<PageSkeleton tiles={{ count: 5, row: 'five', className: 'cal-strip' }} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-5 cal-strip')
    cleanup()
    render(<PageSkeleton tiles={{ count: 5, row: 'dense', hero: true }} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-dense')
    const ghosts = document.querySelectorAll('.stat-tile.skeleton-tile')
    expect(ghosts[0].classList.contains('stat-tile-hero')).toBe(true)
    expect(ghosts[1].classList.contains('stat-tile-hero')).toBe(false)
    cleanup()
    render(<PageSkeleton tiles={{ count: 4, steady: true }} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-steady')
  })

  it('reserves a five-tile or lone KPI row on its own, with the SAME tile the page skeleton draws', () => {
    // ESPP's strip ghosts its own row (no page-level skeleton above it): the row must be the strip's
    // five-tile row, or it wraps 4 + 1 and the strip lands 147px shorter (PE-09).
    render(<SkeletonTileRow tiles={5} row="five" label="Loading the ESPP headline…" />)
    const row = document.querySelector('.kpi-row')
    expect(row?.className).toBe('kpi-row kpi-row-5')
    expect(row?.getAttribute('aria-hidden')).toBe('true')
    expect(row?.querySelectorAll('.stat-tile.skeleton-tile .skeleton').length).toBe(15)
    expect(screen.getByRole('status').textContent).toBe('Loading the ESPP headline…')
    // …and it rides the same delay every other ghost does, so a fast answer shows nothing.
    expect(document.querySelector('.loading-fallback')).not.toBeNull()
    cleanup()
    render(<SkeletonTileRow row="lone" />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-lone')
    cleanup()
    render(<SkeletonTileRow tiles={3} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row')
  })

  it('leaves no hand-written ghost height at the call sites this lane owns', () => {
    // A literal here is a number nobody can check against the block it stands in for.
    const page = (name: string) => readFileSync(path.join(__dirname, '..', 'pages', `${name}.tsx`), 'utf8')
    expect(page('PaycheckPage')).toContain('height: FEED_SKELETON.paycheckBreakdown')
    expect(page('CompPage')).toContain('height: FEED_SKELETON.compVesting')
    expect(page('CompPage')).toContain('height: FEED_SKELETON.compEvents')
    expect(page('EsppPage')).toContain('height: FEED_SKELETON.esppLots')
    expect(page('EsppPage')).toContain('height: FEED_SKELETON.esppOfferings')
    expect(page('NetWorthPage')).toContain('ghostCardBody(chartCardBox(360, { controls: true, zoomable: true }) + LEDE_ROW)')
    expect(page('NetWorthPage')).toContain('ghostCardBody(chartCardBox(255, { controls: true }))')
    expect(page('NetWorthPage')).toContain('ghostCardBody(chartCardBox(280, { zoomable: true, footer: true }))')
  })

  it('exports the one ghost tile so a page can ghost a single slot of a mixed row', () => {
    render(<GhostTile />)
    const tile = document.querySelector('.stat-tile.skeleton-tile')
    expect(tile).not.toBeNull()
    expect(tile?.querySelectorAll('.skeleton').length).toBe(3) // label, value, delta
    // Its own attribute, not the row's: in the ESPP strip this tile stands BESIDE real tiles,
    // so no aria-hidden container is above it to silence it.
    expect(tile?.getAttribute('aria-hidden')).toBe('true')
  })

  // The fixed ghost heights (--m-stat-tile 115px, the bare 93px) were right at one width: OU-01 measured
  // a 76px ghost under a 145px tile, PE-09 115 against 103. A ghost set in the real lines needs none.
  it('stands the ghost blocks in the real lines, with no fixed tile height anywhere', () => {
    const css = readFileSync(path.join(__dirname, 'panels.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
    expect(css).not.toContain('--m-stat-tile')
    expect(css).toContain('.skeleton-tile .skeleton { display: inline-block; vertical-align: middle; }')
    expect(css).toContain('.skeleton-tile .skeleton-label { margin: 0; }')
    expect(css).toContain('.skeleton-value { width: 65%; height: 0.8em; }')
    expect(css).toContain('.skeleton-delta { width: 50%; height: 0.75em; }')
  })

  it('draws a delta-less ghost on request: two blocks and an empty delta line', () => {
    // Credit cards' tiles carry no delta line (2026-09-13 polish §9): an empty line costs 0px.
    render(<GhostTile delta={false} />)
    const tile = document.querySelector('.stat-tile.skeleton-tile') as HTMLElement
    expect(tile.querySelectorAll('.skeleton').length).toBe(2) // label, value
    expect(tile.className).toContain('skeleton-tile-bare')
    expect(tile.querySelector('.stat-delta')?.childNodes.length).toBe(0)
  })

  it('accepts a tiles object so a page can ghost a delta-less row, and a count still draws the full tile', () => {
    render(<PageSkeleton tiles={{ count: 4, delta: false }} />)
    expect(document.querySelectorAll('.kpi-row .skeleton-tile-bare').length).toBe(4)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(0)
    cleanup()
    render(<PageSkeleton tiles={{ count: 2 }} />)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(2)
    expect(document.querySelector('.skeleton-tile-bare')).toBeNull()
    cleanup()
    render(<PageSkeleton tiles={3} />)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(3)
  })
})
```

  In `src/components/skeletonMetrics.test.ts` replace `expect(CSS).toContain(\`--m-stat-tile: ${STAT_TILE}px\`)` with:

```ts
    // The tile has no CSS twin any more (2026-09-25 polish §4.6: ghosts stand in the real lines);
    // STAT_TILE is the measured one-delta tile at 1440, for card ghosts standing in for a tile row.
    expect(CSS).not.toContain('--m-stat-tile')
    expect(STAT_TILE).toBe(101)
```

  and change the FEED_SKELETON pin to `.toEqual([581, 57, 357, 315, 216])` (compVesting = ghostCardBody(101 + 16) = 57;
  the paycheck figure moves in Task 15).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/PageSkeleton.test.tsx src/components/skeletonMetrics.test.ts`
Expected: FAIL — ghosts have three children and no variant classes; `--m-stat-tile` still declared; STAT_TILE is 115.

- [ ] **Step 3: Implement** — `src/components/PageSkeleton.tsx` becomes:

```tsx
import './panels.css'

// Ghost first paint (2026-08-27 spec §3): the page's REAL chrome — kpi-row, card,
// card-grid — with silent blocks where data will land, so the structure appears
// immediately and nothing jumps when the payload fills it. Ghosts are aria-hidden;
// what a screen reader gets is the visually-hidden status line, exactly the sentence
// the old text fallback carried. Both components ride .loading-fallback, so anything
// resolving inside the delay window shows nothing at all.

/** The modifier of the real row a ghost row stands in for (2026-09-25 polish spec §4.6). */
export type TileRowVariant = 'five' | 'dense' | 'lone'

const ROW_CLASS: Record<TileRowVariant, string> = {
  five: 'kpi-row-5',
  dense: 'kpi-row-dense',
  lone: 'kpi-row-lone',
}

/** A ghost tile row described like the real one, so the two share every rule that lays them out —
 *  a bare `.kpi-row` wrapped five tiles 4 + 1 where the real row stood five across (PE-09, MOTION-01). */
export interface GhostRowSpec {
  count: number
  /** false: the delta-less tile, for rows whose real tiles carry no delta line (Credit cards). */
  delta?: boolean
  /** The real row's five-tile or lone modifier. */
  row?: TileRowVariant
  /** The real row reserves its badge and delta lines (.kpi-row-steady). */
  steady?: boolean
  /** The first tile is the page's hero figure. */
  hero?: boolean
  /** A page's own class on the real row (the calendar's .cal-strip, the Projection's band). */
  className?: string
}

function rowClass({ row, steady, className }: Pick<GhostRowSpec, 'row' | 'steady' | 'className'>): string {
  return ['kpi-row', row === undefined ? null : ROW_CLASS[row], steady === true ? 'kpi-row-steady' : null, className ?? null]
    .filter((name): name is string => name !== null)
    .join(' ')
}

export default function PageSkeleton({
  tiles = 0,
  cards = [],
  strip = false,
}: {
  /** Tile ghosts: a count draws the full tile (label, value, delta line) in a plain row; an object
   *  describes the real row — its variant, steadiness, hero, page class, or a delta-less tile. */
  tiles?: number | GhostRowSpec
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
  /** Net worth's per-owner strip under the tiles — ghosted, or the tiles jump when it lands. */
  strip?: boolean
}) {
  const spec: GhostRowSpec = typeof tiles === 'number' ? { count: tiles } : tiles
  return (
    <div className="page-skeleton loading-fallback">
      <p className="visually-hidden" role="status">
        Loading…
      </p>
      {spec.count > 0 && (
        <div className={rowClass(spec)} aria-hidden="true">
          {Array.from({ length: spec.count }, (_, i) => (
            <GhostTile key={i} delta={spec.delta ?? true} hero={spec.hero === true && i === 0} />
          ))}
        </div>
      )}
      {strip && <div className="skeleton-strip" aria-hidden="true"><div className="skeleton skeleton-label" /></div>}
      {cards.length > 0 && (
        <div className="card-grid" aria-hidden="true">
          {cards.map((card, i) => (
            <section className={`card span-${card.span}`} key={i}>
              <div className="skeleton skeleton-label" />
              <div
                className="skeleton skeleton-body"
                style={{ height: card.height ?? 220 }}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/* A ghost tile IS a tile (2026-09-25 polish spec §4.6): the real four lines, a block set inside the
   label's, the figure's and the delta's line box, so it stands exactly as tall as the tile that
   replaces it — the same type sets every line, at every width — and takes the row's subgrid like any
   tile. Exported (2026-09-07): the ESPP strip, the Overview and Paycheck ghost single slots of a mixed
   row with this very tile. `delta: false` is the delta-less tile's twin (2026-09-13 polish §9); `hero`
   sets the figure line in the hero's size. */
export function GhostTile({ delta = true, hero = false }: { delta?: boolean; hero?: boolean }) {
  const classes = ['stat-tile', 'skeleton-tile', hero ? 'stat-tile-hero' : null, delta ? null : 'skeleton-tile-bare']
    .filter((name): name is string => name !== null)
    .join(' ')
  return (
    // aria-hidden on the TILE, not only on the row above it: in a mixed row its neighbours are real
    // tiles that must stay readable, so there is no hidden container.
    <div className={classes} aria-hidden="true">
      <div className="stat-label">
        <span className="skeleton skeleton-label" />
      </div>
      <div className="stat-badge-row" />
      <div className="stat-value">
        <span className="stat-value-figure">
          <span className="skeleton skeleton-value" />
        </span>
      </div>
      <div className="stat-delta">{delta && <span className="skeleton skeleton-delta" />}</div>
    </div>
  )
}

/** The KPI row ALONE, for a page that ghosts per feed instead of behind a page-level skeleton
 *  and still has headline tiles above its feeds. ESPP's strip appeared out of nothing when the
 *  modeler answered and moved the whole page down 118px on every cold load (2026-09-05 lane V
 *  smoke, `cls/espp`); reserving its box is the fix. `row` is the real row's variant. */
export function SkeletonTileRow({
  tiles = 1,
  row,
  label = 'Loading…',
}: {
  tiles?: number
  row?: TileRowVariant
  label?: string
}) {
  return (
    <div className="loading-fallback">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <div className={rowClass({ row })} aria-hidden="true">
        {Array.from({ length: tiles }, (_, i) => (
          <GhostTile key={i} />
        ))}
      </div>
    </div>
  )
}

/** Section-level ghost for pages whose sentinels are per-card ("Loading lots…"):
 *  one house card, same delay, label preserved for AT parity with the old text. */
export function SkeletonCard({
  height = 200,
  label = 'Loading…',
}: {
  height?: number
  label?: string
}) {
  return (
    <section className="card loading-fallback">
      <p className="visually-hidden">{label}</p>
      <div aria-hidden="true">
        <div className="skeleton skeleton-label" />
        <div className="skeleton skeleton-body" style={{ height }} />
      </div>
    </section>
  )
}
```

  In `src/components/panels.css`: `.skeleton-value` (lines 699–702) becomes `{ width: 65%; height: 0.8em; }`; delete the
  `--m-stat-tile` and `--m-stat-tile-bare` declarations with their comments from `.page-skeleton, .loading-fallback`
  (keeping `--m-owner-strip: 41px;`), and retitle that block's comment to "The owner strip's box …"; replace the
  `.skeleton-tile`, `.skeleton-tile-bare` and `.skeleton-delta` rules (lines 718–732) with:

```css
/* A ghost tile draws its blocks INSIDE the real tile's lines (2026-09-25 polish spec §4.6): each block
   is an inline-block in the line box of the real .stat-label, .stat-value-figure and .stat-delta, so
   the ghost stands exactly as tall as the tile that replaces it — the same type sets every line, in
   every row variant, at every width. The fixed ghost heights that stood in for this (115px, the bare
   93px) were right at one width only: OU-01 measured a 76px ghost under a 145px tile, PE-09 115
   against 103. Middle-aligned blocks shorter than their line never set its height. */
.skeleton-tile .skeleton {
  display: inline-block;
  vertical-align: middle;
}

.skeleton-tile .skeleton-label {
  margin: 0;
}

.skeleton-delta {
  width: 50%;
  height: 0.75em;
}
```

  In `src/components/skeletonMetrics.ts` replace the STAT_TILE doc and value with:

```ts
/** The real .stat-tile with one delta line, measured at 1440 in Edge (2026-09-25 polish §4.6): 14.4 +
 *  1 border + 15.3 label + 7.2 + 23.8 figure + 5.6 + 17 delta + 16 + 1. Ghost TILES need no number —
 *  they stand in the real lines — so this is only for a CARD ghost standing in for a tile row. */
export const STAT_TILE = 101
```

  Add the CSS pin for the steady/ghost interplay to `src/components/tileRowCss.test.ts`'s first describe:

```ts
  it('lets a ghost tile take its row’s subgrid like any tile', () => {
    // GhostTile renders `.stat-tile.skeleton-tile`, so the subgrid selectors above reach it unchanged.
    expect(CSS).not.toMatch(/\.skeleton-tile \{[^}]*min-height/)
  })
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components/PageSkeleton.test.tsx src/components/skeletonMetrics.test.ts src/components/tileRowCss.test.ts src/components/shell/PageFrame.test.tsx src/components/espp/PositionStrip.test.tsx`
Expected: PASS (PositionStrip still passes `tiles={5}` without `row` until Task 11 — its row class is plain `kpi-row`).

- [ ] **Step 5: Commit**

```bash
git add src/components/PageSkeleton.tsx src/components/PageSkeleton.test.tsx src/components/panels.css src/components/skeletonMetrics.ts src/components/skeletonMetrics.test.ts src/components/tileRowCss.test.ts
git commit -m "feat(skeleton): ghost tiles stand in the real tile lines and take the row's variant" -m "Spec 2026-09-25 §4.6: PageSkeleton / GhostTile / SkeletonTileRow take the real row's variant (five | dense | lone), steadiness, hero and page class, and a ghost is the real four lines with blocks inside them - exactly as tall as the tile that lands, at every width. The fixed 115px / 93px ghost heights (right at one width: 76 vs 145px on the Overview, OU-01; 115 vs 103 on Portfolio, PE-09) are gone; STAT_TILE is the measured 101px for card ghosts standing in for a tile row."
```

---

### Task 6: Net worth — the hero's words fit one line, the row is steady

**Files:**
- Modify: `src/components/networth/headline.ts`
- Modify: `src/pages/NetWorthPage.tsx` (skeleton prop ~682–689; tile row ~719–767)
- Test: `src/components/networth/headline.test.ts`, `src/pages/NetWorthPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — in `src/components/networth/headline.test.ts` update the expectations:
  - line 38: `delta: '$126,583 (+15.7%) since Sep 1 · 21 days',`
  - line 42's test title → `'a final snapshot, consecutive: the change and its two 1sts, a tile’s line long'`, line 46:
    `delta: '$126,583 (+15.7%) · Sep 1 → Oct 1',`
  - line 52: `'$126,583 (+15.7%) · Sep 1 → Oct 1 · spending not complete yet',`; line 56:
    `'$126,583 (+15.7%) · Sep 1 → Oct 1',`
  - lines 67, 69, 74: `'$126,583 (+15.7%) since Sep 1 · 21 days'`, `'$126,583 (+15.7%) since Aug 1 · 2 months'` (×2)
  - line 84: `'$126,583 (+15.7%) since Sep 22 · 40 days (Oct 1 balances stayed provisional)',`
  - line 90: `'$126,583 (+15.7%) since Jun 1'`; line 104: `delta: '$1 (+50.0%)'`
  and add inside the first describe:

```ts
  // A quarter of the row at 1440 is 239px (2026-09-25 polish spec §4.3): "· September: Sep 1, 2023 → Oct 1,
  // 2023" measured 324px and moved the Net worth row between 111 and 128px as months were picked. The
  // label above names the year; the tile's line names the two 1sts.
  it('drops the month name and the years from a past month’s story — the label carries the year', () => {
    const past: NetWorthSummary = {
      ...FINAL,
      month: '2023-10-01',
      as_of: '2023-10-01',
      recorded_on: '2023-10-01',
      mom_delta: '5309.08',
      mom_pct: '0.063',
      previous: { month: '2023-09-01', as_of: '2023-09-01', provisional: false },
    }
    expect(netWorthHeadline(past)).toEqual({
      label: 'Net worth — as of Oct 1, 2023',
      badge: undefined,
      delta: '$5,309 (+6.3%) · Sep 1 → Oct 1',
    })
  })
```

  In `src/pages/NetWorthPage.test.tsx` update line 816 `'▲ $60 (+35.3%) since Mar 1'`, 817 `'▲ $15 since Mar 1'`, 887
  `'▲ $60 (+35.3%) · Jul 1 → Aug 1'`, 890 `'▼ -$5 since Jul 1'`, 901 `'▲ $60 (+35.3%)'`, 981
  `'▲ $126,583 (+15.7%) · Sep 1 → Oct 1 · spending not complete yet'`, 1043 `'▲ $126,583 (+15.7%) since Sep 1 · 21 days'`,
  and add a test in the file's tiles describe (the one holding line 816):

```tsx
  // 2026-09-25 polish spec §4.3: the row keeps one height across every month the ribbon offers — its
  // badge line and one delta line are reserved (.kpi-row-steady), and the hero is the first tile.
  it('keeps a steady tile row with the hero first', async () => {
    renderPage()
    const hero = await screen.findByText(/^Net worth — /, { selector: '.stat-label-text' })
    const row = hero.closest('.kpi-row') as HTMLElement
    expect(row.className).toBe('kpi-row kpi-row-steady')
    expect(row.firstElementChild?.className).toContain('stat-tile-hero')
  })
```

  (Use the file's own `renderPage` helper and fixture; if the describe's tests seed a specific summary first, do the same.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/networth/headline.test.ts src/pages/NetWorthPage.test.tsx`
Expected: FAIL — cents still printed, "September:" still in the story, row class `kpi-row`.

- [ ] **Step 3: Implement** — `src/components/networth/headline.ts`: imports become
  `import { formatCurrencyWhole, formatMonth, formatPct } from '../../utils/format'`; the header comment's example becomes
  `"Net worth — as of Sep 22" · Provisional · "$126,583 (+15.7%) since Sep 1 · 21 days", or "· Sep 1 → Oct 1" between two
  final 1sts (a tile's line: whole dollars, the two 1sts without their years — 2026-09-25 polish spec §4.3)`; add above
  `netWorthHeadline`:

```ts
/** "Sep 1" — a day without its year: the label above the tile's line names the year. */
function shortDay(iso: string): string {
  return `${formatMonth(iso).slice(0, 3)} ${Number(iso.slice(8, 10))}`
}
```

  and replace the body from `const previous = …` through the `const delta = …` statement with:

```ts
  const previous = summary.previous ?? null
  const period = { period: summary.period ?? 'month' }
  // A month's own story stands apart after a dot; "since …" reads on from the figures.
  const monthStory = isMonthStory(previous, current, period)
  // A tile's line is a quarter of the row (2026-09-25 polish spec §4.3): a month's story is its two
  // 1sts alone — "Sep 1 → Oct 1" — where changePhrase's "September: Sep 1, 2025 → Oct 1, 2025" ran to
  // two lines and moved the row between 111 and 128px as months were picked. Charts keep changePhrase.
  const phrase =
    monthStory && previous !== null
      ? `${shortDay(previous.as_of ?? previous.month)} → ${shortDay(current.as_of ?? current.month)}`
      : changePhrase(previous, current, period)
  const span = phrase === null ? '' : monthStory ? ` · ${phrase}` : ` ${phrase}`
  // The month the change covers is the previous snapshot's: Sep 1 → Oct 1 is September's story,
  // incomplete while September's spending is listed as due (§0.4(d) storyNote). Only a month's
  // story carries the note (§T1): a "since …" span — balances typed early, a gap of months, a
  // previous snapshot that stayed provisional — is not one month's story.
  const story =
    previous !== null && monthStory ? storyNote(flowsDue?.find((flows) => flows.month === previous.month)) : ''
  // Whole dollars (spec §4.3): the tile's value keeps the cents.
  const delta =
    summary.mom_delta != null && summary.mom_pct != null
      ? `${formatCurrencyWhole(summary.mom_delta)} (${formatPct(summary.mom_pct)})${span}${story}`
      : undefined
```

  (Keep the `formatAsOf` import from `../../utils/asOf` — the label still uses it.)

  `src/pages/NetWorthPage.tsx`: the skeleton's `tiles: 4,` becomes `tiles: { count: 4, hero: true, steady: true },`; the
  row `<div className="kpi-row">` (line 719) becomes:

```tsx
              // Steady (2026-09-25 polish spec §4.3): the badge line and one delta line are reserved, so
              // the row keeps one height across every month the ribbon offers (88 → 145px before).
              <div className="kpi-row kpi-row-steady">
```

  and the group tile's delta (line 763) becomes
  `delta={delta === null ? undefined : \`${formatCurrencyWhole(delta)} ${groupSince}\`}` with `formatCurrencyWhole` added
  to the page's `../utils/format` import.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components/networth/headline.test.ts src/pages/NetWorthPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/networth/headline.ts src/components/networth/headline.test.ts src/pages/NetWorthPage.tsx src/pages/NetWorthPage.test.tsx
git commit -m "feat(networth): hero and group deltas fit one tile line; the row is steady" -m "Spec 2026-09-25 §4.3: whole dollars in the tile deltas; a month's story in a tile is its two 1sts ('· Sep 1 → Oct 1', the label names the year) - 'September: Sep 1, 2023 → Oct 1, 2023' measured 324px against a 239px tile and moved the row 88/111/128/145px across the 38 ribbon months. The row reserves its badge and delta lines (.kpi-row-steady); the page ghost is the steady row with a hero first."
```

---

### Task 7: Overview — steady row, hero ghost, whole dollars, "12-mo avg"

**Files:**
- Modify: `src/pages/OverviewPage.tsx` (tile region only: the living-spending delta ~450–460, `tileElements` ~486–558, the
  skeleton prop ~773–781, the row at ~788)
- Test: `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — in `src/pages/OverviewPage.test.tsx` update: line 711–712 →
  `` `▲ $10,000 (+0.8%) · Jul 1 → Aug 1` ``; 723–724 → `` `▼ -$2,500 (-0.3%) on ${formatDate(daysAgo(1))}` ``; 734 →
  `'▲ over $5,000 12-mo avg · Jul 2026'`; 767 → `'▼ -$2,500 (-0.3%) today'`; 776–777 →
  `` `▼ -$2,500 (-0.3%) on ${formatDate(daysAgo(3))}` ``; 787 → `'▼ -$2,500 (-0.3%)'`; 809 →
  `'▼ under $5,000 12-mo avg · Jul 2026'`; 828 → `'▲ over $5,000 12-mo avg · Jul 2026'`; 867 → `'at $0 12-mo avg · Jul 2026'`;
  1212 and 1277 → `'▲ $126,583 (+15.7%) since Sep 1 · 21 days'`; 1251 → `'▲ $126,583 (+15.7%) since Aug 1 · 2 months'`;
  2310 → `toContain('$1,235 12-mo avg · Jun 2026')`; and any other `$…​.​dd (` hero/portfolio delta string the file pins
  (search `(+` and `12-mo average`) the same way. Add to `describe('OverviewPage tiles', …)`:

```tsx
  // 2026-09-25 polish spec §4.3/§4.6 (OU-01): the row reserves its badge and delta lines, and while a
  // group loads its slot is a ghost set in the real lines — the hero's in the hero's size — so the
  // row stands at its landed height from the first paint (76px ghosts under 145px tiles before).
  it('stands a steady row of ghosts at the landed geometry while the groups load', async () => {
    serve()
    vi.mocked(fetchSummary).mockReturnValue(new Promise(() => {}))
    renderPage()
    const row = document.querySelector('.kpi-row') as HTMLElement
    expect(row.className).toBe('kpi-row kpi-row-steady')
    const ghost = row.querySelector('.stat-tile.skeleton-tile') as HTMLElement
    expect(ghost.classList.contains('stat-tile-hero')).toBe(true)
    expect(ghost.querySelector('.skeleton-delta')).not.toBeNull()
  })
```

  (Import `fetchSummary` from the mocked `../api/netWorth` module if the file does not already; `serve()` installs every
  other feed.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx`
Expected: FAIL — cents, "previous 12-mo average", row class `kpi-row`, `delta={false}` ghosts without hero.

- [ ] **Step 3: Implement** — in `src/pages/OverviewPage.tsx` add `formatCurrencyWhole` to the `../utils/format` import;
  the `spendDelta` text becomes:

```tsx
          text: `${Number(stats.total) === stats.avg12 ? 'at' : stats.aboveAvg ? 'over' : 'under'} ${formatCurrencyWhole(stats.avg12)} 12-mo avg${spendMonth ? ` · ${spendMonth}` : ''}`,
```

  and above it, extend the comment block's last paragraph with: `One tile line at 1440 (2026-09-25 polish spec §4.3):
  whole dollars and "12-mo avg" — "under $5,417.48 previous 12-mo average · Aug 2026" wrapped to two.`
  In `tileElements`: the three `<GhostTile delta={false} />` for portfolio, living_spending and tax become `<GhostTile />`,
  and net_worth's becomes `<GhostTile hero />`; the portfolio delta becomes:

```tsx
                    ? `${formatCurrencyWhole(totals.day_change_amount)} (${formatPct(
                        totals.day_change_pct,
                      )})${dayChangeWhen}`
```

  The skeleton's `tiles: 4,` becomes `tiles: { count: 4, hero: true, steady: true },`; the row becomes:

```tsx
            {/* Steady (2026-09-25 polish spec §4.3): the badge line and one delta line are reserved, so a
                ghost row stands at the landed height and a scope switch never resizes the strip. */}
            <div className="kpi-row kpi-row-steady">{layout.tiles.map(id => <Fragment key={id}>{tileElements[id]}</Fragment>)}</div>
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/pages/OverviewPage.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): one-line tile deltas, a steady row and ghosts at the landed height" -m "Spec 2026-09-25 §4.3/§4.6: whole dollars in the portfolio and hero deltas; 'under \$5,417 12-mo avg · Aug 2026' (was two lines); the row reserves its badge and delta lines; each loading slot is a ghost with its delta line, the hero's in the hero's size - 76px ghosts under 145px tiles moved the page 70px on every cold load (OU-01)."
```

---

### Task 8: Spending — a steady row where every tile has a second line

**Files:**
- Modify: `src/pages/SpendingPage.tsx` (imports; the `kpis` memo ~446–459; skeleton prop ~525–532; KPI row ~538–571)
- Test: `src/pages/SpendingPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — in `src/pages/SpendingPage.test.tsx` update lines 766 and 772 to
  `.toBe('tax $0 · transfers $0')` and add to `describe('SpendingPage — reviewed-month metrics', …)`:

```tsx
  // 2026-09-25 polish spec §4.4: the two bare tiles get a real second line — the month before, from the
  // matrix (up is good for both) — and the row reserves its badge and delta lines (§4.3).
  it('compares savings and net pay with the month before, and keeps the row steady', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(matrixFixture())
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const delta = (label: string) => screen.getByText(label).closest('.stat-tile')?.querySelector('.stat-delta')
    // 57.0% against June's 54.2%: 2.8 points up, green.
    expect(delta('Savings rate — cash')?.textContent).toBe('▲ 2.8 pts vs Jun')
    expect(delta('Savings rate — cash')?.className).toContain('stat-delta-positive')
    // $6,000.00 both months.
    expect(delta('Net pay')?.textContent).toBe('same as Jun')
    expect(delta('Net pay')?.className).toContain('stat-delta-neutral')
    expect(screen.getByText('Savings rate — cash').closest('.kpi-row')?.className).toBe('kpi-row kpi-row-steady')
  })

  it('says a month with nothing before it has nothing to compare', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(matrixFixture({ default_month: '2026-06-01', review_state: ['closed', 'in_progress'] }))
    renderPage()
    await screen.findByText('Where Jun 2026 went')
    const delta = (label: string) => screen.getByText(label).closest('.stat-tile')?.querySelector('.stat-delta')
    expect(delta('Savings rate — cash')?.textContent).toBe('No May to compare')
    expect(delta('Net pay')?.textContent).toBe('No May to compare')
  })

  it('prints the net-pay change in whole dollars, signed and toned', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(matrixFixture({ net_pay: ['6000.00', '5141.25'], savings_rate: ['0.541666667', '0.5'] }))
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const delta = (label: string) => screen.getByText(label).closest('.stat-tile')?.querySelector('.stat-delta')
    expect(delta('Net pay')?.textContent).toBe('▼ -$859 vs Jun')
    expect(delta('Net pay')?.className).toContain('stat-delta-negative')
    expect(delta('Savings rate — cash')?.textContent).toBe('▼ 4.2 pts vs Jun')
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/SpendingPage.test.tsx`
Expected: FAIL — "Cash outflow …" still printed; the Savings/Net pay tiles have empty deltas; row class `kpi-row`.

- [ ] **Step 3: Implement** — in `src/pages/SpendingPage.tsx`: the format import gains `formatCurrencyWhole`; the months
  import becomes `import { addMonths, todayIso } from '../utils/months'`; above `export default function SpendingPage`
  add:

```tsx
/** A tile's second line against the month before (2026-09-25 polish spec §4.4): "▲ 2.8 pts vs Jun",
 *  "▼ -$859 vs Jun" — up is good for both, so the tone follows the direction — "same as Jun", or "No Jun
 *  to compare" when that month has no figure. `change` words the difference; `flat` is the least change
 *  that is not "same". */
function versusMonthBefore(
  current: string | null,
  previous: string | null,
  previousMonth: string,
  change: (difference: number) => string,
  flat: number,
): { text: string; tone: 'positive' | 'negative' | 'neutral' } {
  const name = formatMonth(previousMonth).slice(0, 3)
  if (current === null) return { text: 'no take-home entered', tone: 'neutral' }
  if (previous === null) return { text: `No ${name} to compare`, tone: 'neutral' }
  const difference = Number(current) - Number(previous)
  if (Math.abs(difference) < flat) return { text: `same as ${name}`, tone: 'neutral' }
  return { text: `${change(difference)} vs ${name}`, tone: difference > 0 ? 'positive' : 'negative' }
}
```

  The `kpis` memo's return becomes:

```tsx
    // The calendar month before, for the two tiles' second lines (spec §4.4) — absent from the matrix,
    // or unentered there, it has no figure to compare with.
    const previousMonth = addMonths(matrix.months[focusIndex], -1)
    const previousIndex = matrix.months.indexOf(previousMonth)
    return {
      month: matrix.months[focusIndex],
      total: matrix.living_total?.[focusIndex] ?? null,
      average: matrix.comparison_average?.[focusIndex] ?? null,
      savings: matrix.savings_rate[focusIndex],
      netPay: matrix.net_pay[focusIndex],
      previousMonth,
      previousSavings: previousIndex < 0 ? null : matrix.savings_rate[previousIndex],
      previousNetPay: previousIndex < 0 ? null : matrix.net_pay[previousIndex],
    }
```

  The skeleton's `tiles: 4,` becomes `tiles: { count: 4, steady: true },`. The KPI row (from `{kpis && (` to its closing
  `)}`) becomes:

```tsx
        {kpis && (
          // Steady (2026-09-25 polish spec §4.3): the badge line and one delta line are reserved, so the
          // row keeps one height across every month the ribbon offers (200 ↔ 217px before, badge months).
          <div className="kpi-row kpi-row-steady">
            <StatTile
              label={`Living spending — ${formatMonth(kpis.month)}`}
              value={formatCurrency(kpis.total)}
              // T3 (2026-09-13 audit): the month's other outflows are this tile's own second line — tax
              // and transfers, whole dollars, one line at 1440 (2026-09-25 spec §4.3; the cash total, =
              // living + tax, ran it to two). The review state is its badge (closed = nothing to flag).
              delta={`tax ${formatCurrencyWhole(matrix?.tax_total?.[focusIndex])} · transfers ${formatCurrencyWhole(matrix?.transfer_total?.[focusIndex])}`}
              tone="neutral"
              badge={reviewState !== undefined && reviewState !== 'closed' ? REVIEW_LABELS[reviewState] : undefined}
              hint="Living categories only. Tax paid from take-home and transfers are shown separately."
              evidence={evidence.metric('living_spending')}
            />
            <StatTile
              label="Previous 12 months"
              value={formatCurrency(kpis.average)}
              hint="Mean living spending in eligible months within the previous 12 calendar months, excluding this month. Missing months do not pull older entries into the comparison."
              delta={`${matrix?.comparison_count?.[focusIndex] ?? evidence.data?.comparison.window?.included.length ?? 0} eligible months`}
              evidence={evidence.data?.comparison}
            />
            <StatTile
              label="Savings rate — cash"
              value={kpis.savings === null ? '—' : formatPct(kpis.savings, { signed: false })}
              delta={savingsLine?.text}
              tone={savingsLine?.tone}
              hint="(net pay − living spend − tax paid) ÷ net pay for the viewed month. Payroll deductions are not in this one — the Savings rate chart on Trends draws both readings."
              evidence={evidence.metric('cash_savings_rate')}
            />
            <StatTile
              label="Net pay"
              value={formatCurrency(kpis.netPay)}
              delta={netPayLine?.text}
              tone={netPayLine?.tone}
              hint="Take-home pay entered for the viewed month."
              evidence={evidence.metric('net_pay')}
            />
          </div>
        )}
```

  and, right after the `kpis` memo (before `const reviewState = …`), the two lines it reads:

```tsx
  // The two tiles' second lines against the month before (spec §4.4): points for the rate, whole
  // dollars for the pay.
  const savingsLine = kpis && versusMonthBefore(kpis.savings, kpis.previousSavings, kpis.previousMonth, (d) => `${Math.abs(d * 100).toFixed(1)} pts`, 0.0005)
  const netPayLine = kpis && versusMonthBefore(kpis.netPay, kpis.previousNetPay, kpis.previousMonth, formatCurrencyWhole, 0.5)
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/pages/SpendingPage.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx
git commit -m "feat(spending): every KPI tile has a second line; the row is steady" -m "Spec 2026-09-25 §4.3/§4.4: Savings rate and Net pay compare with the month before ('▲ 2.8 pts vs Jun', '▼ -\$859 vs Jun', 'No May to compare') where they stood bare with 35-58px of blank; Living spending's line is 'tax \$X · transfers \$Y' in whole dollars (the cash triple measured 281px against a 239px tile); the row reserves its badge and delta lines so it keeps one height across the ribbon's months (200 ↔ 217px before)."
```

---

### Task 9: Projection — FI ratio's second line; the band's ghost

**Files:**
- Modify: `src/pages/ProjectionPage.tsx` (imports; the skeleton prop at line 112; the FI ratio tile at 122–123; a module
  helper)
- Test: `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — add to `describe('ProjectionPage — surface polish (2026-09-13 spec §12)', …)`:

```tsx
  // 2026-09-25 polish spec §4.4 (PCC-12: "its tile is half empty"): what is left to the target, whole
  // dollars — $1,500,000 target, $100,000 invested — or that it is reached.
  it('gives FI ratio a second line: what is left to the target, or that it is reached', async () => {
    renderPage()
    await loaded()
    const tile = screen.getByText('FI ratio').closest('.stat-tile') as HTMLElement
    expect(tile.querySelector('.stat-delta')?.textContent).toBe('$1,400,000 to go')
    expect(tile.querySelector('.stat-delta')?.className).toContain('stat-delta-neutral')
  })

  it('says the target is reached, green and with no glyph', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(projectionOut({ fi_ratio: '1.050000' }))
    renderPage()
    await loaded()
    const delta = screen.getByText('FI ratio').closest('.stat-tile')?.querySelector('.stat-delta') as HTMLElement
    expect(delta.textContent).toBe('Target reached')
    expect(delta.className).toContain('stat-delta-positive')
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx` — Expected: FAIL (FI ratio delta is empty).

- [ ] **Step 3: Implement** — in `src/pages/ProjectionPage.tsx` the format import becomes
  `import { formatCurrency, formatCurrencyWhole, formatMonth, formatPct } from '../utils/format'`; after
  `const SECTIONS = …` add:

```tsx
/** FI ratio's second line (2026-09-25 polish spec §4.4): what is left to the target in whole dollars — a
 *  display-only difference of the server's two figures — or that the target is reached. */
function fiRatioLine(data: ProjectionOut): { text: string; tone: 'positive' | 'neutral' } | undefined {
  if (data.fi_target === null || data.fi_ratio === null) return undefined
  if (Number(data.fi_ratio) >= 1) return { text: 'Target reached', tone: 'positive' }
  return { text: `${formatCurrencyWhole(Number(data.fi_target) - Number(data.starting_balance))} to go`, tone: 'neutral' }
}
```

  The skeleton prop `skeleton={{ tiles: 5, cards: [{ span: 12, height: 400 }] }}` becomes
  `skeleton={{ tiles: { count: 5, row: 'five', className: 'projection-outcomes' }, cards: [{ span: 12, height: 400 }] }}`,
  and the FI ratio tile becomes:

```tsx
              {/* Its second line (spec §4.4): the gap to the target — a verdict when reached, never a glyph. */}
              <StatTile label="FI ratio" value={formatPct(data.fi_ratio, { signed: false })} evidence={receipts.ratio}
                delta={fiRatioLine(data)?.text} tone={fiRatioLine(data)?.tone} direction="none"
                hint="Investable balance as a share of the FI target." />
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx src/pages/projectionCss.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.test.tsx
git commit -m "feat(projection): FI ratio says what is left to the target; the band's ghost is the band" -m "Spec 2026-09-25 §4.4 (PCC-12): '\$1,400,000 to go' / 'Target reached' under the ratio, whole dollars (§4.3). The page ghost is the five-tile band itself (row five, class projection-outcomes), so a cold load no longer drops 113px from a 4 + 1 ghost."
```

---

### Task 10: Calendar — the strip's tiles share its lines; Scheduled in/out say what they count

**Files:**
- Modify: `src/components/calendar/CashflowStrip.tsx`
- Modify: `src/pages/CalendarPage.tsx` (the skeleton prop at line 642 only)
- Test: `src/components/calendar/CashflowStrip.test.tsx`

- [ ] **Step 1: Write the failing tests** — append to `describe('CashflowStrip', …)`:

```tsx
  // 2026-09-25 polish spec §4.1 (PCC-17): each labelled group is a slot that takes part in the row's
  // four lines, so the strip ends on one edge (the wrapped tiles were 22px short).
  it('wraps each tile in a slot of the row', () => {
    render(<CashflowStrip events={events} month="2026-09-01" quoteAsOf={null} living={BUDGET} />)
    const groups = screen.getAllByRole('group')
    expect(groups.every((group) => group.className === 'stat-tile-slot')).toBe(true)
    expect(groups.every((group) => group.firstElementChild?.classList.contains('stat-tile'))).toBe(true)
  })

  // 2026-09-25 polish spec §4.4: the two bare legs say what they count, hidden events left out.
  it('names what the scheduled legs count', () => {
    render(<CashflowStrip events={events} month="2026-09-01" quoteAsOf={null} living={BUDGET} />)
    const delta = (name: string) => screen.getByRole('group', { name }).querySelector('.stat-delta')?.textContent
    expect(delta('Scheduled in')).toBe('2 paydays') // the RSU vest is Vesting's, not cash in
    expect(delta('Scheduled out')).toBe('1 tax payment') // the hidden card fee is not on the calendar
    cleanup()
    render(<CashflowStrip events={[]} month="2026-09-01" quoteAsOf={null} living={BUDGET} />)
    expect(delta('Scheduled in')).toBe('Nothing scheduled')
    expect(delta('Scheduled out')).toBe('Nothing due')
  })

  it('names the two most frequent kinds and counts the rest', () => {
    const busy = [
      calendarEvent({ date: '2026-10-01', type: 'card_fee', label: 'Fee', amount: '95.00', direction: 'out' }),
      calendarEvent({ date: '2026-10-02', type: 'card_fee', label: 'Fee', amount: '95.00', direction: 'out' }),
      calendarEvent({ date: '2026-10-15', type: 'tax_deadline', label: 'Q4', amount: '395.00', direction: 'out' }),
      calendarEvent({ date: '2026-10-20', type: 'custom', label: 'Gym', amount: '50.00', direction: 'out', id: 7 }),
      calendarEvent({ date: '2026-10-09', type: 'ex_dividend', label: 'VOO', amount: '12.00', direction: 'in' }),
    ]
    render(<CashflowStrip events={busy} month="2026-10-01" quoteAsOf={null} living={[]} />)
    const delta = (name: string) => screen.getByRole('group', { name }).querySelector('.stat-delta')?.textContent
    expect(delta('Scheduled out')).toBe('2 card fees · 1 tax payment · 1 more')
    expect(delta('Scheduled in')).toBe('1 dividend')
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/calendar/CashflowStrip.test.tsx`
Expected: FAIL — groups have no class; Scheduled in/out deltas empty.

- [ ] **Step 3: Implement** — in `src/components/calendar/CashflowStrip.tsx` the types import becomes
  `import type { CalendarEvent, CalendarEventType, CalendarLiving } from '../../types/api'`; after `livingDefinition` add:

```tsx
/** What a scheduled leg counts, in the reader's nouns (singular, plural). */
const LEG_NOUNS: Partial<Record<CalendarEventType, [string, string]>> = {
  payday: ['payday', 'paydays'],
  ex_dividend: ['dividend', 'dividends'],
  card_credit: ['card credit', 'card credits'],
  card_fee: ['card fee', 'card fees'],
  tax_deadline: ['tax payment', 'tax payments'],
  custom: ['custom event', 'custom events'],
}

/** A scheduled leg's second line (2026-09-25 polish spec §4.4): the events it sums, by kind — "2
 *  paydays", "2 card fees · 1 tax payment · 1 more" (the two most frequent kinds, then the rest) — or
 *  that there is nothing. Hidden events and vests are left out, as the leg's own sum leaves them. */
function legWords(events: CalendarEvent[], month: string, direction: 'in' | 'out'): string {
  const prefix = month.slice(0, 7)
  const counts = new Map<CalendarEventType, number>()
  for (const event of events) {
    if (event.hidden || event.source === 'rsu' || event.direction !== direction || event.date.slice(0, 7) !== prefix) continue
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  }
  if (counts.size === 0) return direction === 'in' ? 'Nothing scheduled' : 'Nothing due'
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const named = ranked.slice(0, 2).map(([type, n]) => {
    const [one, many] = LEG_NOUNS[type] ?? ['event', 'events']
    return `${n} ${n === 1 ? one : many}`
  })
  const rest = ranked.slice(2).reduce((sum, [, n]) => sum + n, 0)
  return [...named, ...(rest > 0 ? [`${rest} more`] : [])].join(' · ')
}
```

  In the component: every `<div role="group" aria-label=…>` wrapper gets `className="stat-tile-slot"` (five wrappers);
  the Scheduled in tile gains `delta={legWords(events, month, 'in')}` and `tone="neutral"`; the Scheduled out tile gains
  `delta={legWords(events, month, 'out')}` and `tone="neutral"`. Update the component's top comment's last sentence to:
  `…done deadlines are included (the money still moved). Each labelled group is a slot of the row's four lines
  (2026-09-25 polish spec §4.1), and the two scheduled legs say what they count (§4.4).`
  In `src/pages/CalendarPage.tsx` line 642, `skeleton={{ tiles: 5, cards: [{ span: 12, height: 420 }] }}` becomes
  `skeleton={{ tiles: { count: 5, row: 'five', className: 'cal-strip' }, cards: [{ span: 12, height: 420 }] }}`.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components/calendar/CashflowStrip.test.tsx src/pages/CalendarPage.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/CashflowStrip.tsx src/components/calendar/CashflowStrip.test.tsx src/pages/CalendarPage.tsx
git commit -m "feat(calendar): the cash-flow strip's tiles share its lines; scheduled legs say what they count" -m "Spec 2026-09-25 §4.1/§4.4 (PCC-17): each labelled group is a .stat-tile-slot subgrid, so the strip ends on one edge (two tiles stood 22px short); Scheduled in/out read '2 paydays' / '1 tax payment' / 'Nothing due' from the month's own events. The page ghost is the strip's own five-across row, so a cold load at 1280 no longer drops 149px from a 4 + 1 ghost."
```

---

### Task 11: ESPP strip — the quote and the average cost under the two bare tiles

**Files:**
- Modify: `src/components/espp/PositionStrip.tsx`
- Test: `src/components/espp/PositionStrip.test.tsx`

- [ ] **Step 1: Write the failing tests** — append to `describe('PositionStrip', …)`:

```tsx
  // 2026-09-25 polish spec §4.4: the quote the strip is priced at, and what a held share cost — the two
  // tiles that stood bare beside three with second lines.
  it('puts the quote under Market value and the average cost under Cost basis', () => {
    render(<PositionStrip lots={lots} lotsBusy={false} modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    const delta = (label: string) => screen.getByText(label).closest('.stat-tile')?.querySelector('.stat-delta')?.textContent
    expect(delta('Market value')).toBe('NVDA $171.31')
    expect(delta('Cost basis')).toBe('avg $41.23 / sh')
    // Whole dollars in a tile's delta (§4.3); the value keeps its cents.
    expect(delta('$25k limit used — 2024')).toBe('$6,083 left')
  })

  it('ghosts the strip as its own five-tile row', () => {
    render(<PositionStrip lots={null} lotsBusy modeler={null} modelerBusy modelerDirty={false} />)
    expect(document.querySelector('.kpi-row')?.className).toBe('kpi-row kpi-row-5')
  })
```

  Update any existing assertion in the file on `'$6,082.87 left'` to `'$6,083 left'`.

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/components/espp/PositionStrip.test.tsx` — FAIL.

- [ ] **Step 3: Implement** — in `src/components/espp/PositionStrip.tsx`: format import gains `formatCurrencyWhole`; the
  all-ghost return becomes `return <SkeletonTileRow tiles={5} row="five" label={STRIP_LABEL} />`; the priced Market value
  tile's delta becomes

```tsx
              // The quote the strip is priced at (2026-09-25 polish spec §4.4); unpriced, why not.
              delta={held.market_value === null || lots.current_price === null ? unpricedNote(lots) : `${lots.espp_ticker ?? 'Quote'} ${formatCurrency(lots.current_price)}`}
```

  the Cost basis tile gains

```tsx
              // What a held share cost, the server's own average (spec §4.4).
              delta={held.avg_paid === null ? undefined : `avg ${formatCurrency(held.avg_paid)} / sh`}
              tone="neutral"
```

  and the $25k tile's delta becomes `` delta={`${formatCurrencyWhole(modeler.totals.remaining_25k)} left`} ``. The
  comment above the row ("Five tiles on ONE row at 1440 …") gains: `Below 1000px it is 3 + 2 (panels.css), never 4 + 1.`

- [ ] **Step 4: Run to see them pass** — `npx vitest run src/components/espp/PositionStrip.test.tsx src/pages/EsppPage.test.tsx` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/espp/PositionStrip.tsx src/components/espp/PositionStrip.test.tsx
git commit -m "feat(espp): the strip's bare tiles get the quote and the average cost" -m "Spec 2026-09-25 §4.4: Market value reads 'NVDA \$171.31' and Cost basis 'avg \$41.23 / sh' under their values; the \$25k tile's remainder is whole dollars (§4.3). The ghost is the strip's own five-tile row, so a cold load no longer lands 147px up from a 4 + 1 ghost (PE-09)."
```

---

### Task 12: Portfolio — Cost basis counts the holdings; the ghost follows the tab

**Files:**
- Modify: `src/pages/PortfolioPage.tsx` (skeleton prop ~700–706; tile region ~710–773)
- Test: `src/pages/PortfolioPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — add to `describe('PortfolioPage — tiles per view', …)`:

```tsx
  // 2026-09-25 polish spec §4.3/§4.4: Cost basis says how many holdings it covers; deltas are whole dollars.
  it('counts the holdings under Cost basis and prints tile deltas in whole dollars', async () => {
    renderPage()
    await screen.findByText('Portfolio value')
    const delta = (label: string) => screen.getByText(label).closest('.stat-tile')?.querySelector('.stat-delta')?.textContent
    expect(delta('Cost basis')).toBe('1 holding')
    expect(delta('Portfolio value')).toMatch(/^▲ \$10 today \(/)
    expect(delta('Dividend entries')).toBe('$60/yr expected')
  })
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run src/pages/PortfolioPage.test.tsx` — FAIL.

- [ ] **Step 3: Implement** — `src/pages/PortfolioPage.tsx`: format import gains `formatCurrencyWhole`; the skeleton prop
  becomes:

```tsx
        // The ghost follows the arriving tab (PE-09): the five dense tiles, hero first, only where the
        // page shows them — Income and Manage have none.
        skeleton={{
          tiles: TILE_VIEWS.has(views.section) ? { count: 5, row: 'dense', hero: true } : 0,
          cards: [
            { span: 12, height: 340 },
            { span: 12, height: 300 },
          ],
        }}
```

  the Portfolio value delta becomes
  `` `${formatCurrencyWhole(totals.day_change_amount)} today (${formatPct(totals.day_change_pct)})` ``, the Dividend
  entries delta `` `${formatCurrencyWhole(totals.annual_income)}/yr expected` ``, and the Cost basis tile gains:

```tsx
                  // Its second line (spec §4.4): how many holdings the basis covers.
                  delta={`${holdings.holdings.length} ${holdings.holdings.length === 1 ? 'holding' : 'holdings'}`}
                  tone="neutral"
```

- [ ] **Step 4: Run to see it pass** — `npx vitest run src/pages/PortfolioPage.test.tsx` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio): Cost basis counts its holdings; the ghost follows the tab" -m "Spec 2026-09-25 §4.3/§4.4/§4.6: Cost basis reads '37 holdings' (Realized gains stays bare, out of scope); whole-dollar deltas. The ghost row is the dense five-tile row with the hero first and only on the tabs that show tiles - a 4 + 1 ghost dropped the page 143px at 1440 and Income/Manage ghosted tiles they never draw (PE-09)."
```

---

### Task 13: Taxes — Will I owe? and What-if rows

**Files:**
- Modify: `src/components/taxes/WithholdingPanel.tsx` (props; tiles ~601–650)
- Modify: `src/pages/TaxesPage.tsx` (one prop at the `<WithholdingPanel` call, ~966–973)
- Modify: `src/components/taxes/WhatIfPanel.tsx` (the two kpi-rows ~470–541)
- Test: `src/components/taxes/WithholdingPanel.test.tsx`, `src/components/taxes/WhatIfPanel.test.tsx`

- [ ] **Step 1: Write the failing tests** — WithholdingPanel.test.tsx: update line 200 to `toContain('$69,276 so far')`
  and line 237 to `toContain('$25,753 owed')`; add:

```tsx
  // 2026-09-25 polish spec §4.4 (TPC-18): Projected tax was the one tile of three with no second line.
  it('puts the effective rate under Projected tax', async () => {
    render(<WithholdingPanel year={2026} effectiveRate="0.273" />)
    await screen.findByText('$123,456.78')
    expect(deltaOf('Projected tax').textContent).toBe('27.3% effective')
    cleanup()
    render(<WithholdingPanel year={2026} effectiveRate={null} />)
    await screen.findByText('$123,456.78')
    expect(deltaOf('Projected tax').textContent).toBe('not computed')
  })
```

  WhatIfPanel.test.tsx: line 437 → `toContain('$38,250 gain before tax')`, line 462 → `toContain('$4,000 loss before tax')`,
  and add after line 438 (inside the sale test):

```tsx
    // 2026-09-25 polish spec §4.4: the mixed row's three bare tiles get lines from the payload.
    const line = (label: string) => tile(label).querySelector('.stat-delta')?.textContent
    expect(line('Proceeds')).toBe('1 sale')
    expect(line('Tax due')).toBe('30.5% of the gain')
    expect(line('Net cash')).toBe('80.4% of proceeds')
```

  and in the Δ-tiles test after line 395:

```tsx
    // The rate's second line (spec §4.4): the points it moved, no glyph — a level, not a movement.
    expect(tile('Effective rate').querySelector('.stat-delta')?.textContent).toBe('3.4 pts higher')
    expect(tile('Effective rate').querySelector('.stat-delta')?.className).toContain('stat-delta-neutral')
```

- [ ] **Step 2: Run to see them fail** —
  `npx vitest run src/components/taxes/WithholdingPanel.test.tsx src/components/taxes/WhatIfPanel.test.tsx` — FAIL.

- [ ] **Step 3: Implement** — WithholdingPanel.tsx: add to the props type

```tsx
  /** The year's effective rate (the Summary's totals), for Projected tax's second line (2026-09-25
   *  polish spec §4.4); null when the engine refused the year. */
  effectiveRate?: string | null
```

  and `effectiveRate,` to the destructuring; import `formatCurrencyWhole` and `formatPct` (if not imported) from
  `../../utils/format`; the Projected tax tile gains

```tsx
                delta={
                  effectiveRate === undefined
                    ? undefined
                    : effectiveRate === null || withholding.liability_total === null
                      ? 'not computed'
                      : `${formatPct(effectiveRate, { signed: false })} effective`
                }
                tone="neutral"
```

  the withholding delta becomes `` `${formatCurrencyWhole(withholding.total.ytd)} so far` `` and the payroll delta
  `` `${formatCurrencyWhole(split.payroll.liability)} owed` ``. TaxesPage.tsx: add
  `effectiveRate={d.summary.totals?.effective_rate ?? null}` to the `<WithholdingPanel …>` props.
  WhatIfPanel.tsx: import `formatCurrencyWhole`; before `return (` add:

```tsx
  // The sale row's and the Δ row's bare tiles, given lines from the payload (2026-09-25 polish spec §4.4):
  // how many sales, the tax as a share of the gain, the cash kept of the proceeds, and the rate's move.
  const salesCount = saleDetails.length + esppSaleDetails.length
  const ratio = (part: string, whole: string) => Math.abs(Number(part)) / Math.abs(Number(whole))
  const rateMove =
    result === null || previewUnusable
      ? null
      : (Number(result.scenario.totals.effective_rate) - Number(result.baseline.totals.effective_rate)) * 100
```

  and give the tiles: Proceeds `` delta={`${salesCount} ${salesCount === 1 ? 'sale' : 'sales'}`} tone="neutral" ``;
  Tax due/saved

```tsx
                    delta={Number(saleSummary.gain) === 0 ? 'no gain to tax' : `${formatPct(ratio(saleSummary.tax_due, saleSummary.gain), { signed: false })} of the ${lossBeforeTax ? 'loss' : 'gain'}`}
                    tone="neutral"
```

  Net cash

```tsx
                    delta={Number(saleSummary.proceeds) === 0 ? 'no proceeds' : `${formatPct(ratio(saleSummary.net_cash, saleSummary.proceeds), { signed: false })} of proceeds`}
                    tone="neutral"
```

  After-tax gain/loss: `formatCurrency(Math.abs(Number(saleSummary.gain)))` → `formatCurrencyWhole(Math.abs(Number(saleSummary.gain)))`;
  Δ take-home: both `formatCurrency(result.*.totals.take_home)` in its delta → `formatCurrencyWhole(…)`; Effective rate:

```tsx
                  delta={rateMove === null || Math.abs(rateMove) < 0.05 ? 'no change' : `${Math.abs(rateMove).toFixed(1)} pts ${rateMove > 0 ? 'higher' : 'lower'}`}
                  tone="neutral"
```

- [ ] **Step 4: Run to see them pass** —
  `npx vitest run src/components/taxes/WithholdingPanel.test.tsx src/components/taxes/WhatIfPanel.test.tsx src/pages/TaxesPage.test.tsx` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/WithholdingPanel.tsx src/components/taxes/WithholdingPanel.test.tsx src/pages/TaxesPage.tsx src/components/taxes/WhatIfPanel.tsx src/components/taxes/WhatIfPanel.test.tsx
git commit -m "feat(taxes): every tile in Will I owe? and What-if has a second line" -m "Spec 2026-09-25 §4.4 (TPC-18): Projected tax reads '27.3% effective' (the Summary's rate, passed by the page); the What-if sale row reads '1 sale' / '30.5% of the gain' / '80.4% of proceeds' and the Δ row's rate '3.4 pts higher' (the audit's other mixed rows). Tile deltas are whole dollars (§4.3)."
```

---

### Task 14: The remaining rows — Comp vesting, Monthly review, Credit cards

**Files:**
- Modify: `src/components/comp/VestingSchedulePanel.tsx` (VestingTiles), `src/pages/CompPage.test.tsx`
- Modify: `src/pages/MonthlyUpdatePage.tsx` (review-kpis ~2287–2312), `src/pages/MonthlyUpdatePage.css` (`.review-kpis`
  line 283), `src/components/monthly/story.ts`, `src/pages/MonthlyUpdatePage.test.tsx`, `src/components/monthly/story.test.ts`
- Modify: `src/pages/CreditCardsPage.tsx` (the kpi-row at ~410), `src/pages/CreditCardsPage.test.tsx`

- [ ] **Step 1: Write the failing tests** —
  CompPage.test.tsx: the Task 2 line becomes `.toBe('105 sh · $20,101')`; `getByText('$235,471.20')` →
  `getByText('$235,471')`; `getByText('$13,200.00')` → `getByText('$13,200')`.
  MonthlyUpdatePage.test.tsx lines 2633/2635 → `'tax $50 · transfers $100'`, `'$700 of $1,000 take-home'`; add after 2632:

```tsx
  // 2026-09-25 polish spec §4.4: the one bare tile of four gets a line — living as a share of take-home.
  expect(tile('Living spending').querySelector('.stat-delta')?.textContent).toBe('25.0% of take-home')
```

  and the story strings (lines 3521–3530 and the rest of that describe): `▲ $126,583.02 (` → `▲ $126,583 (`.
  story.test.ts: every `$…​.​dd` inside a `text` expectation → whole dollars (e.g. `▲ $126,583 (Sep 1 → Oct 1)`).
  CreditCardsPage.test.tsx inside `'shows the advantage tile only when merging genuinely wins'`, after the tile is found:

```tsx
    // Five tiles are a five-tile row (2026-09-25 polish spec §4.2): 3 + 2 below 1000px, never 4 + 1.
    expect(tile.closest('.kpi-row')?.className).toBe('kpi-row kpi-row-5')
```

- [ ] **Step 2: Run to see them fail** —
  `npx vitest run src/pages/CompPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/components/monthly/story.test.ts src/pages/CreditCardsPage.test.tsx` — FAIL.

- [ ] **Step 3: Implement** —
  VestingSchedulePanel.tsx: import `formatCurrencyWhole`; Next vest delta
  `` `${formatShares(nextVest.shares)} sh · ${formatCurrencyWhole(nextVest.est_value)}` ``; Unvested
  `delta={formatCurrencyWhole(tiles.unvested_value)}`; Vested this year `: formatCurrencyWhole(tiles.vested_this_year_income)`.
  story.ts: import `formatCurrencyWhole` instead of `formatCurrency`; the text uses
  `${formatCurrencyWhole(cents === 0 ? 0 : cents / 100)}`; update the comment's "$0.00" → "$0".
  MonthlyUpdatePage.tsx: import `formatCurrencyWhole`; the Living spending tile gains

```tsx
                // Its second line (2026-09-25 polish spec §4.4): living as a share of take-home.
                delta={preview.netPay !== null && preview.netPay > 0 ? `${formatPct(preview.livingSpend / preview.netPay, { signed: false })} of take-home` : 'enter household take-home to compare'}
                tone="neutral"
```

  Cash outflow's delta → `` `tax ${formatCurrencyWhole(preview.taxSpend)} · transfers ${formatCurrencyWhole(preview.transfers)}` ``;
  Cash saved's → `` `${formatCurrencyWhole(preview.cashSaved)} of ${formatCurrencyWhole(preview.netPay)} take-home` ``.
  MonthlyUpdatePage.css line 283 `.review-kpis { margin-bottom: 1.25rem; }` →

```css
/* The space under the Review tiles; the row turns it into its own margin (panels.css). */
.review-kpis { --kpi-row-after: 1.25rem; }
```

  CreditCardsPage.tsx: `<div className="kpi-row">` →

```tsx
              // Five tiles when the household advantage shows: a five-tile row (spec §4.2), never 4 + 1.
              <div className={advantage !== null ? 'kpi-row kpi-row-5' : 'kpi-row'}>
```

- [ ] **Step 4: Run to see them pass** — the Step 2 command — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/comp/VestingSchedulePanel.tsx src/pages/CompPage.test.tsx src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/components/monthly/story.ts src/components/monthly/story.test.ts src/pages/MonthlyUpdatePage.test.tsx src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(tiles): the audit's remaining rows - whole dollars, the Review's bare tile, five-tile cards" -m "Spec 2026-09-25 §4.3/§4.4 audit of every .kpi-row: Comp's vesting deltas and the Monthly Review's deltas (incl. the month's story) in whole dollars; the Review's Living spending gets '25.0% of take-home'; Credit cards' row is a five-tile row when the household advantage shows. All-bare rows stay bare (Credit cards, Taxes totals, Dividends, ESPP limit)."
```

---

### Task 15: Paycheck — one row of tiles, no card inside a card (spec §4.5)

**Files:**
- Modify: `src/pages/PaycheckPage.tsx` (BreakdownPanel ~90–156; new `SummaryTiles`; the summary region ~1405–1500)
- Modify: `src/pages/PaycheckPage.css` (tile comments; `.paycheck-household` rule)
- Modify: `src/components/skeletonMetrics.ts` (`FEED_SKELETON.paycheckBreakdown`) + its test
- Test: `src/pages/PaycheckPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — in `src/pages/PaycheckPage.test.tsx`:
  - replace every `await screen.findByText('$3,384.16')` with `await netPayLanded()` and every
    `expect(screen.getByText('$3,384.16')).toBeTruthy()` with `expect(line('Net pay')).toBe('$3,384.16')` (13 sites — the
    figure now also stands in the Net pay per check tile), adding beside `line()`:

```tsx
// The waterfall's own NET PAY line — the figure also stands in the tile row now (2026-09-25 polish §4.5).
const netPayLanded = () => waitFor(() => expect(line('Net pay')).toBe('$3,384.16'))
```

  - replace the test `'names the employer match under the waterfall, outside the pay it adds up'` with:

```tsx
  it('names the employer match in its own tile, outside the pay it adds up', async () => {
    vi.mocked(fetchBreakdown).mockResolvedValue(breakdownOf(profile2026, { employer_match: '479.17' }))
    render(<MemoryRouter initialEntries={['/paycheck?section=summary']}><PaycheckPage /></MemoryRouter>)
    const match = (await screen.findByText('Employer match per check')).closest('.stat-tile') as HTMLElement
    expect(match.querySelector('.stat-value')?.textContent).toBe('$479.17')
    expect(match.querySelector('.stat-delta')?.textContent).toBe('not part of your pay')
    // The line under the waterfall said the same thing twice over; the tile says it once.
    expect(screen.queryByText(/per check, not part of your pay/)).toBeNull()
    cleanup()
    clearSnapshots()
    vi.mocked(fetchBreakdown).mockResolvedValue(breakdownOf(profile2026, { employer_match: '0.00' }))
    render(<MemoryRouter initialEntries={['/paycheck?section=summary']}><PaycheckPage /></MemoryRouter>)
    const none = (await screen.findByText('Employer match per check')).closest('.stat-tile') as HTMLElement
    await waitFor(() => expect(none.querySelector('.stat-value')?.textContent).toBe('$0.00'))
    expect(none.querySelector('.stat-delta')?.textContent).toBe('no employer match')
  })
```

  - household tests: `document.querySelector('.paycheck-household .stat-delta')?.textContent` →
    `screen.getByText('Household take-home').closest('.stat-tile')?.querySelector('.stat-delta')?.textContent`, expecting
    `'Me $6,768 · Sam $5,231'` (both sites); `document.querySelector('.paycheck-household .drill-hint')` →
    `document.querySelector('.paycheck-tiles')?.parentElement?.querySelector('.drill-hint')` (still null: no caption
    beside the row).
  - add a describe:

```tsx
describe('PaycheckPage — the Summary tile row (2026-09-25 polish spec §4.5)', () => {
  it('lays one row: household take-home, monthly net, net pay and match per check — no tile in the card', async () => {
    twoEarners()
    render(<MemoryRouter initialEntries={['/paycheck?section=summary']}><PaycheckPage /></MemoryRouter>)
    await screen.findByText('Household take-home')
    const row = document.querySelector('.kpi-row.paycheck-tiles') as HTMLElement
    expect([...row.querySelectorAll('.stat-label-text')].map((label) => label.textContent)).toEqual([
      'Household take-home', 'Monthly net', 'Net pay per check', 'Employer match per check',
    ])
    // The page's headline is the biggest figure (TPC-01): the household, not one person's net.
    expect(row.querySelector('.stat-tile-hero .stat-label-text')?.textContent).toBe('Household take-home')
    const monthly = screen.getByText('Monthly net').closest('.stat-tile') as HTMLElement
    expect(monthly.querySelector('.stat-delta')?.textContent).toBe('Me · 24 checks a year')
    expect(screen.getByText('Net pay per check').closest('.stat-tile')?.querySelector('.stat-delta')?.textContent).toBe('of $7,872 gross')
    // No box in a box: the breakdown card holds its list and nothing tile-shaped.
    expect(screen.getByText(/^Per-check breakdown/).closest('.card')?.querySelector('.stat-tile')).toBeNull()
  })

  it('makes the monthly net the hero for one person, and names nobody', async () => {
    render(<MemoryRouter initialEntries={['/paycheck?section=summary']}><PaycheckPage /></MemoryRouter>)
    await netPayLanded()
    const row = document.querySelector('.kpi-row.paycheck-tiles') as HTMLElement
    expect(row.querySelectorAll('.stat-tile')).toHaveLength(3)
    expect(row.querySelector('.stat-tile-hero .stat-label-text')?.textContent).toBe('Monthly net')
    expect(screen.getByText('Monthly net').closest('.stat-tile')?.querySelector('.stat-delta')?.textContent).toBe('24 checks a year')
  })

  it('stands the row as ghosts while the check loads, so nothing below moves when it lands (TPC-04)', async () => {
    vi.mocked(fetchBreakdown).mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter initialEntries={['/paycheck?section=summary']}><PaycheckPage /></MemoryRouter>)
    const row = document.querySelector('.kpi-row.paycheck-tiles') as HTMLElement
    const ghosts = row.querySelectorAll('.stat-tile.skeleton-tile')
    expect(ghosts).toHaveLength(3)
    expect(ghosts[0].classList.contains('stat-tile-hero')).toBe(true)
  })
})
```

  In `src/components/skeletonMetrics.test.ts` the FEED_SKELETON pin's first number becomes the value Step 3 derives.

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/pages/PaycheckPage.test.tsx src/components/skeletonMetrics.test.ts` — FAIL.

- [ ] **Step 3: Implement** — in `src/pages/PaycheckPage.tsx`:
  - imports: add `import { GhostTile } from '../components/PageSkeleton'` and `formatCurrencyWhole` to the format import.
  - `BreakdownPanel` becomes `function BreakdownPanel({ data }: { data: PaycheckBreakdownOut })`, with the nested
    `<div className="kpi-row kpi-row-lone">…</div>` block and its comment removed, and the closing
    `{Number(data.employer_match) !== 0 && (<p className="drill-hint">Employer match +… </p>)}` block and its comment
    removed; the call site becomes `<BreakdownPanel data={data} />`.
  - after `BreakdownPanel` add:

```tsx
// ── The Summary's tile row ───────────────────────────────────────────────────────────────

/**
 * One strip over the breakdown (2026-09-25 polish spec §4.5; audit TPC-01): the household's take-home
 * beside the check on screen — what it comes to a month, its net and its match — where a lone household
 * tile sat over a hero tile nested inside the breakdown card. The household figure is the page's headline
 * when there is a household; otherwise the monthly net is. Each slot ghosts while its own feed is in
 * flight, so the row stands from the first paint and nothing below it moves when the answers land (the
 * 119px of TPC-04).
 */
function SummaryTiles({
  household,
  householdPending,
  check,
  checkPending,
  personName,
  still,
}: {
  /** Each person's in-force monthly net; the tile shows for two or more. */
  household: { name: string; monthlyNet: string }[] | null
  /** A household of two or more whose legs have not answered yet. */
  householdPending: boolean
  /** The check on screen — it follows the WHOSE chip and any pinned row. */
  check: PaycheckBreakdownOut | null
  checkPending: boolean
  /** Whose check it is, when there is more than one person to tell apart. */
  personName: string | null
  /** A cached paint: the monthly net shows still instead of counting up (spec §8). */
  still: boolean
}) {
  const showHousehold = household !== null && household.length > 1
  const householdSlot = showHousehold || householdPending
  if (!householdSlot && check === null && !checkPending) return null
  // The ONE place this page adds money up, and only because there is no server figure for it: each
  // leg is an AUTHORITATIVE per-person `monthly_net`, not a display-rounded view of a longer chain.
  // Two 2dp figures added in float and re-rounded to cents, so the tile never prints a float artefact.
  const householdTotal = showHousehold
    ? Math.round(household.reduce((acc, leg) => acc + Number(leg.monthlyNet), 0) * 100) / 100
    : null
  return (
    <div className="kpi-row paycheck-tiles">
      {showHousehold ? (
        <StatTile
          label="Household take-home"
          hero
          value={formatCurrency(householdTotal)}
          // The legs under the total, in the tile's own delta line (2026-09-13 polish spec §10), whole
          // dollars (2026-09-25 §4.3). Neutral: a level, not a movement.
          delta={household.map((leg) => `${leg.name} ${formatCurrencyWhole(leg.monthlyNet)}`).join(' · ')}
          tone="neutral"
          evidence={metricReceipt({ id: 'household_take_home', label: 'Household take-home', value: householdTotal,
            definition: 'Sum of monthly net estimates for the paycheck profile currently in force for each person. A person without an in-force profile is omitted.',
            completeness: 'estimate', source_link: '/paycheck?section=summary',
            components: household.map(leg => ({ label: leg.name, value: leg.monthlyNet, unit: 'USD' })) })}
          hint="The monthly net of the profile IN FORCE for each person, added together. It ignores the chip and any pinned row — it is always the whole household — and a person with no profile in force is not counted. Each person has their own profile timeline. The waterfall, the flow beside it and the history in Profiles all follow the chip; the household figure does not — it is always both of you."
        />
      ) : householdPending ? (
        <GhostTile hero />
      ) : null}
      {check !== null ? (
        <>
          <StatTile
            label="Monthly net"
            hero={!householdSlot}
            value={formatCurrency(check.monthly_net)}
            delta={`${personName === null ? '' : `${personName} · `}${check.profile.pay_periods_per_year} checks a year`}
            tone="neutral"
            evidence={metricReceipt({ id: 'paycheck_monthly_net', label: 'Monthly net', value: check.monthly_net,
              definition: 'The paycheck calculator’s net per check multiplied by the profile’s annual check count and divided by twelve. This is a profile-based estimate, separate from monthly take-home entries.',
              scope: check.profile.person_id, as_of: check.profile.effective_date, completeness: 'estimate', warnings: check.warnings,
              source_link: `/paycheck?section=summary&profile=${check.profile.id}&owner=${check.profile.person_id}`,
              components: [{ label: 'Net per check', value: check.net_pay, unit: 'USD' }, { label: 'Checks per year', value: check.profile.pay_periods_per_year, unit: 'count' }] })}
            // Fresh paints only (spec §8). A decimal-string amount, so Number() for the ease.
            countUp={!still ? { value: Number(check.monthly_net), format: formatCurrency } : undefined}
            hint="Net pay per check × checks per year ÷ 12."
          />
          <StatTile
            label="Net pay per check"
            value={formatCurrency(check.net_pay)}
            delta={`of ${formatCurrencyWhole(check.gross)} gross`}
            tone="neutral"
            hint="What lands in the account from one check — the breakdown's authoritative last line."
          />
          <StatTile
            label="Employer match per check"
            value={formatCurrency(check.employer_match)}
            delta={Number(check.employer_match) === 0 ? 'no employer match' : 'not part of your pay'}
            tone="neutral"
            hint="The employer's 401(k) match on one check. It never passes through the check, so the breakdown's lines do not add it."
          />
        </>
      ) : checkPending ? (
        <>
          <GhostTile hero={!householdSlot} />
          <GhostTile />
          <GhostTile />
        </>
      ) : null}
    </div>
  )
}
```

  - in `PaycheckPage`: delete the `householdTotal` constant and its comment (moved above); before `return (` add:

```tsx
  // The check the Summary shows — the Feed's data and busy, read once for the tile row as well.
  const summaryCheck = breakdownMissing || profileArrival !== null ? null : breakdown
  const summaryBusy = profileArrival !== null || (breakdownBusy && !breakdownMissing)
```

  - replace the `<div hidden={views.section !== 'summary'}>…</div>` block with:

```tsx
        <div hidden={views.section !== 'summary'}>
          {/* Dimmed while a reload runs over figures already on screen (the ESPP strip's rule). */}
          <div className={`loading-dim${summaryCheck !== null && summaryBusy ? ' is-loading' : ''}`}>
            <SummaryTiles
              household={householdNets}
              householdPending={orderedPeople.length > 1 && householdNets === null}
              check={summaryCheck}
              checkPending={summaryCheck === null && summaryBusy}
              personName={switchable ? (orderedPeople.find((person) => person.id === summaryCheck?.profile.person_id)?.name ?? null) : null}
              still={fromCache}
            />
          </div>
        </div>
```

  - the `<Feed data={…} busy={…}` props become `data={summaryCheck}` and `busy={summaryBusy}`.
  `src/pages/PaycheckPage.css`: delete the comment "Both of this page's kpi-rows hold one tile …" (lines 22–23) and the
  whole "The household figure" block (the heading comment and `.paycheck-household { … }`, lines 185–191).
  `src/components/skeletonMetrics.ts`: `paycheckBreakdown` becomes `3 * HINT_LINE + 12 * TABLE_ROW, // 3-line hint, 11
  waterfall lines + total — the tile row stands outside the feed now (2026-09-25 polish §4.5)` (= 450); the test pin
  becomes `[450, 57, 357, 315, 216]`. (Task 16 checks this against the landed card and adjusts, recording it.)

- [ ] **Step 4: Run to see them pass** —
  `npx vitest run src/pages/PaycheckPage.test.tsx src/components/skeletonMetrics.test.ts src/components/PageSkeleton.test.tsx` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PaycheckPage.tsx src/pages/PaycheckPage.css src/pages/PaycheckPage.test.tsx src/components/skeletonMetrics.ts src/components/skeletonMetrics.test.ts
git commit -m "feat(paycheck): one Summary tile row, no tile nested in the breakdown card" -m "Spec 2026-09-25 §4.5 (TPC-01a/b, TPC-04): Household take-home · Monthly net (follows WHOSE) · Net pay per check · Employer match per check in one row; the household total is the hero when there is a household. The breakdown card loses its nested hero tile and its employer-match line; its list keeps NET PAY as its total. The row stands as ghosts from the first paint, so the page no longer lands 119px lower."
```

---

### Task 16: Verify in a real browser

**Files:** none in the repo (scripts in `scratchpad/work-L2/`).

- [ ] **Step 1:** vite from the worktree on 127.0.0.1:5272 against :8077 (running since the before-measurement; restart
  with `VITE_API_PROXY=http://127.0.0.1:8077 node node_modules/vite/bin/vite.js --config <scratch>/work-L2/vite.config.mjs --host 127.0.0.1 --port 5272 --strictPort`).
- [ ] **Step 2:** `APP_BASE=http://127.0.0.1:5272 node measure.mjs after pages dark`, then `… after-months months dark`,
  `… after-cls cls dark`, `node ghost.mjs after 1440`, `node ghost.mjs after 1280`, and the pages pass again in light.
  Expected: every line's `baselineSpread` ≤ 1; `maxDeltaLines` 1 on Overview, Net worth and Spending at 1440; Net worth
  and Spending month heights one value (±1); no `4+1` / `2+2+1` layout at 1280/1440/1920, docked or not; ghost → landed
  first-card Δ ≈ 0 on the nine pages; Paycheck CLS ≈ 0.
- [ ] **Step 3:** screenshots of each tile row, both themes, 1440 (and 1280 for the five-tile rows); look at them.
- [ ] **Step 4:** fix anything the numbers or the eye find (each fix its own TDD commit); then close browsers and stop vite.

### Task 17: Gates and "As built"

- [ ] `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.node.json --noEmit` — clean.
- [ ] `npx eslint .` — 0 errors, ≤ 26 warnings.
- [ ] `npx vitest run --maxWorkers=4` — green.
- [ ] Append "As built" (deviations and why, measured before → after, gate numbers, outside-scope touches) and commit
  `docs(plan): polish L2 as built — …`.

---

## Self-review

- **Spec coverage:** §4.1 structure → Tasks 2–3 (+ slots in 10); §4.2 → Task 4 (+ Credit cards' five-tile case in 14);
  §4.3 → Task 1 + whole dollars in 6–15, clause atomicity in 2–3, the Overview wording in 7, steady rows in 3/6/7/8;
  §4.4 table → Spending 8, Projection 9, Calendar 10, Taxes 13, ESPP 11, Portfolio 12; the audit of every `.kpi-row` →
  13 (What-if), 14 (Review, Comp, Credit cards), with Dividends, ESPP limit, Taxes totals and Credit cards (4 tiles) all
  bare and left bare; §4.5 → Task 15; §4.6 → Task 5 + each page's skeleton prop (6, 7, 8, 9, 10, 11, 12, 15).
- **Placeholders:** none; the Paycheck feed ghost's number is derived (450) and re-checked in Task 16 by measurement.
- **Type consistency:** `GhostRowSpec`/`TileRowVariant` (Task 5) are what Tasks 6–12 pass; `formatCurrencyWhole`
  (Task 1) is the one formatter every later task imports; `.kpi-row-steady`, `.stat-tile-slot`, `.stat-value-figure`,
  `.stat-delta-clause`, `.stat-badge-row` are named identically in the TSX and the CSS.

---

## As built (2026-09-25)

Branch `feat/polish-tiles`, 20 commits on `657e3d62`: the plan (`465c04e7`), Tasks 1–15 (`f4c92055` … `e5495786`), the
three browser-found fixes (`61ea0079` glyph, `035b1a48` tax deadline, `799d70de` label line + pinned band), then this
section. 51 files. Nothing pushed, nothing merged. Then the review round — `main` merged in and fourteen fix commits,
under "Review round" at the end of this section; the numbers above it are the first round's.

### Measured before → after

Headless Edge 153, the production copy on :8077, dark unless noted; light is identical in geometry (checked on every
row at 1440). Scripts and JSON in `scratchpad/work-L2/` (`measure.mjs`, `ghost.mjs`, `layouts.mjs`, `results-*.json`,
`ghost-*.json`); row screenshots in `scratchpad/shots/L2/`.

| Acceptance line | Before | After |
|---|---|---|
| Value baselines within a tile line — every row, every page, 1280 / 1440 / 1920 | Overview 23.4 px, Net worth 23.4, Spending 17.4, Portfolio 3.5 (9.5 @1920) apart | 0.0 px on every line of every row |
| Deltas on one line @1440, both themes — Overview, Net worth, Spending | hero 2 lines, Living spending 2–3, Spending's cash triple 2 | 1 line on every tile, both themes |
| Net worth row height across its 38 ribbon months @1440 | 88.2 / 110.8 / 127.8 / 145.2 px | 149 px in all 38 |
| Spending row height across its 38 ribbon months @1440 (a picked month opens the dock → 2 × 2) | 199.6 / 216.8 px | 282.3 px in all 38 |
| Bare tiles in mixed rows | Spending 2, Projection 1, Calendar 2, ESPP 2, Portfolio 2, Will I owe 1, What-if 3 + 1, Review 1 | 0, except Portfolio's Realized gains (out of scope, left bare) |
| Calendar strip bottom edge | 22.6 px ragged | 0 |
| Five-tile rows at 1280 / 1440 / 1920, dock open and closed | ESPP 4 + 1 @1280; Portfolio 2 + 2 + 1 docked @1440 | five across or 3 + 2 everywhere (Portfolio docked 3 + 2, ESPP @1280 3 + 2, Projection / Calendar docked 3 + 2) |
| Ghost → landed, first card's top @1440 | Portfolio −143, Projection −113, Calendar −146, ESPP −147 (row), Paycheck +119, Overview +70, Net worth +30, Spending +22, Credit cards −14 | 0, 0, +1, +0.6 (row), −3, +1, 0, 0, +1 |
| Same @1280 | −23, −10, −149, −29 (row), +118, +64, +67, +21, −15 | +1, +1, +1, +1.3 (row), −6, +18, +60 (+42 of it above the tile row, as before), +1, +1 |
| Cold-load CLS @1440 (API held 1.5 s) | Paycheck 0.054, Overview 0.085, Net worth 0.0095, others ≤ 0.0014 | Paycheck 0.001, Overview 0.033 (the Up next / Data status column — OU-01's second jump, not tiles), Net worth 0.0095, others ≤ 0.0014 |
| Projection's pinned band @1440 | 133.1 px | 131.6 px |

### Deviations from the plan and the spec, and why

1. **First baseline, not "last baseline"** (spec §4.1): `last baseline` lifted Money lasts' figure 16 px off the row
   (its unit line hangs below it). Measured before planning.
2. **Clauses are `inline-block`, not `white-space: nowrap`** (§4.3): the same break rule, but a clause wider than its
   whole tile wraps inside itself instead of running out of the tile.
3. **`.kpi-row-steady`** (Overview, Net worth, Spending) reserves the badge line and one delta line; §4.1's "row 2 is
   0 px when no tile has a badge" holds for every other row. Without it the Net worth row could not keep one height
   across months (its badge comes and goes with the month), nor could its ghosts match.
4. **The row's row gap is 0; lines are spaced by tile margins** (`--kpi-row-after`): a parent row gap leaks into every
   subgrid track (an empty badge line measured 16 px). The Projection's pinned band keeps its height with an 8 px tile
   margin at ≥ 1000 px; the Monthly Review sets `--kpi-row-after: 1.25rem`; the calendar strip's own 1rem margin went.
5. **The tile is no longer a size container; `.stat-value` is** (a container turns subgrid off — measured).
6. **Net worth's month story in a tile reads "· Sep 1 → Oct 1"** (no month name, no years; the label names the
   year): "September: Sep 1, 2023 → Oct 1, 2023" is 324 px against a 239 px tile. Charts keep changePhrase.
7. **Spending's Living spending line is "tax $X · transfers $Y"**: with the cash total (= living + tax) it was 281 px.
8. **Whole dollars in every tile delta that prints an amount**, app-wide (§4.3's rule); per-share prices keep cents
   (the spec's own "NVDA $224.58", "avg $54.14 / sh").
9. **FI ratio reads "$802,141 to go"** (whole dollars) rather than "$802K": no compact dialect was added (MOTION-17 is
   out of scope).
10. **Browser-found: the spec's own hero example was 0.58 px too wide at 1440** (239.14 px in a 238.56 px delta box),
    so "· 21 days" wrapped. The ▲/▼'s own space closes by 0.1em (`.stat-delta-glyph`); the words and textContent are
    unchanged (`61ea0079`).
11. **Browser-found: the evidence (i) grew its label line** from 15 to 17.1 px, so every ghost stood 2 px short:
    `.stat-label .metric-info-button` takes InfoHint's −5.5 px block margins (the target is still 24 px) (`799d70de`).
12. **Browser-found: the pinned Projection band's deltas run two lines**, so it reserves two (`min-height: 2lh`,
    ≥ 1000 px); its ghost stood 19 px short (`799d70de`).
13. **Browser-found: "1 tax payment" under "$0.00"** (September's estimated payment is $0, the safe harbor is met):
    the leg names a "tax deadline", the calendar's own noun (`035b1a48`).
14. **Scheduled in/out name up to two kinds, then "N more"** ("2 card fees · 1 tax deadline · 1 more"), generalising
    the table's "2 paydays" / "1 card fee"; "Nothing scheduled" / "Nothing due" when empty.
15. **Paycheck:** Household take-home is the hero when it shows, else Monthly net; the breakdown card's "Employer match
    +$X per check" line went with the nested tile (the fourth tile says it). Monthly net's line names the person only
    when there are two or more to tell apart.
16. **Ghost numbers:** `--m-stat-tile` / `--m-stat-tile-bare` and the fixed ghost min-heights are gone (ghosts stand
    in the real lines); `STAT_TILE` is the measured 101 px, used only by card ghosts standing in for a tile row
    (`compVesting` 71 → 57, and 41 in the review round); `paycheckBreakdown` 581 → 450 (no tile inside the card any
    more; 396, the measured card, in the review round).
17. **The skeleton API takes more than the spec's variants:** besides `five | dense` (`lone` retired in the review
    round — no row wore it), `GhostRowSpec` takes
    `steady`, `hero` and `className` (the calendar's `cal-strip` keeps its five-across from 880 px; the Projection's
    band is sticky and padded). Without them the ghost and the landed row differ at 1280.
18. **The What-if, Monthly Review and Credit cards rows** were found mixed (or five-tile) by the audit and given the
    same treatment (lines from the payload; `kpi-row-5` for the advantage case).

### The `.kpi-row` audit (spec §4.4, "every .kpi-row")

21 JSX rows — the spec's "26" counts CSS mentions too. Overview, Net worth, Spending (steady, every tile a line);
Projection (FI ratio line); CashflowStrip (slots; Scheduled in / out lines); PositionStrip (quote, average cost);
ESPP limit row (all bare — kept bare); Portfolio (Cost basis line; Realized gains out of scope); Will I owe? combined
(Projected tax line) and split (all lines already); Taxes Summary (all bare — kept bare); What-if sale row (Proceeds,
Tax due, Net cash lines) and Δ row (Effective rate line); Dividends (all bare — kept bare); Comp vesting (all lines);
Credit cards (all bare — kept bare; a five-tile row when the household advantage shows); Monthly Review (Living
spending line); Paycheck (one row); and the three skeleton rows. Card detail's verdict tile stands outside any row
(unchanged).

### Outside-scope touches (minimal, each for a named reason)

- `src/utils/format.ts` — `formatCurrencyWhole` (the task said "check before adding one"; none existed).
- `src/components/monthly/story.ts` — the Review tile's delta producer (whole dollars).
- `src/pages/TaxesPage.tsx` — one prop (`effectiveRate`) on the `<WithholdingPanel>` call.
- `src/pages/CalendarPage.tsx` (the skeleton prop) and `src/pages/CalendarPage.css` (the `.cal-strip` rules only; L1
  owns `.cal-grid`).
- `src/pages/MonthlyUpdatePage.css` (`.review-kpis` only) and `src/pages/PaycheckPage.css` (tile comments and the
  retired `.paycheck-household` rule).
- Tests following the changed files: `surfaceGrammar.test.ts` and `calendarCss.test.ts` (their KPI pins),
  `EsppPage.test.tsx` (one $25k assertion), `CompPage.test.tsx`, `CreditCardsPage.test.tsx`,
  `MonthlyUpdatePage.test.tsx`, `story.test.ts`.

### Known remainders

- ~~At 1280 the Overview / Net worth hero's two clauses wrap, so those steady rows are one delta line taller than their
  ghost there and can differ by a line between months~~ — fixed in the review round (two lines reserved from 980 to
  1150 px of page).
- Paycheck on a truly cold load (no household snapshot) ghosts 3 slots; a two-person household lands 4 tiles, whose
  narrower hero figure is 3 px (1440) / 6 px (1280) shorter.
- A month's story note ("· spending not entered yet") adds a delta line in the months it applies (none on the copy).
- The Projection band still grows by a badge line when a what-if verdict appears (steady there would add ~22 px to the
  default band); Credit cards' five-tile row keeps the advantage tile's verdict line beside four bare tiles (not in
  the production data).
- Paycheck's breakdown ghost is still one full-width card, and a Profiles deep link still ghosts it (TPC-04's other
  half — the Profiles region is L6's).

### Gates (run from the worktree on the final tree)

- `npx tsc -p tsconfig.app.json --noEmit` — clean; `npx tsc -p tsconfig.node.json --noEmit` — clean.
- `npx eslint .` — 0 errors, 26 warnings (the baseline).
- `npx vitest run --maxWorkers=4` — 301 files, 4,519 tests passed.
- My vite on 5272 stopped; no headless Edge left running; the shared :8077 backend untouched.

## Review round (2026-09-25, after merging main)

The independent review said "ready with fixes". `main` @`5b9da791` (L1 layout, L4 feedback, L3a/b/c undo) merged in as
`ca718c35` without conflicts; the suite on the merged tree before any fix: 320 files, 4,751 passed. Then fourteen
commits, `0d76b5c6` … `fdf33b48`, and this section:

| # | Review item | What changed | Commits |
|---|---|---|---|
| 1 | The space under a row grew 16 px where the next block has a top margin of its own | The tiles' bottom margins sit inside the grid, so they no longer collapse with a follower's margin — they stack. The two followers that carry one stand down: `.kpi-row + .tax-jurisdiction-detail` keeps only the rest of its 1.1rem (`calc(1.1rem - var(--density-grid-gap))`), and `.kpi-row.review-kpis + .review-changes > .review-changes-head:first-child` leaves the space to the row's own 1.25rem. The `.kpi-row` comment says why; both rules pinned (tileRowCss.test.ts). The lane probe measures the gap now (`tiles-lib.mjs` `below`) | `9aa66864`, `bcb0e944` |
| 2 | Whole dollars could print a coloured "▲ $0" | `formatCurrencyWhole` keeps the cents under a dollar (formatCurrencyCompact's rule — the glyph and colour read the unrounded figure); exact zero stays "$0" | `0d76b5c6` |
| 3 | Paycheck's pair flipped with L1's fill: a 37 px (21 at 1280) blank band under NET PAY | FlowPanel's plot floor 320 → 280, under the breakdown's own height, so the list sets the row and the plot fills the rest (C5). The breakdown feed's ghost is the measured card (`paycheckBreakdown` 450 → 396) | `65a2a7dd` |
| 4 | Net worth's steady row went 142.2 ↔ 159.2 px across months at 1280 | A steady row with a hero reserves two delta lines from 980 to 1150 px of page (`min-height: 2lh`, the Projection band's pattern): the hero's longest words across every month ("▲ $126,583 (+15.7%) since Sep 1 · 21 days", 237.9 px) need a 1148 px row. The ghost row wears the same classes | `77f38640` |
| 5 | Spending's "vs <previous month>" ignored comparability | The previous month counts only when `eligible_savings` says so ("No Jun to compare"); an entered $0 take-home reads "$0 take-home", never "no take-home entered" | `f993d1f2` |
| 6 | Comp's vesting ghost stood 16 px tall | `compVesting: ghostCardBody(STAT_TILE)` — the ghost card's own margin is the row's 1rem; `TILE_ROW` is gone | `fd87e8a3` |
| 7 | Nothing stopped a non-tile child of a `.kpi-row` | `tileRowFence.test.ts`: walks every `.tsx` AST (noNativeConfirm's way) — a row holds `StatTile` / `GhostTile` / `JurisdictionTile` or a one-tile `.stat-tile-slot`, through fragments, conditionals, `&&`, `.map` / `Array.from` callbacks and a same-file table of tiles (the Overview's); anything opaque fails. Proven by planting a `<p>` in Comp's row | `22a29443` |
| 8 | Dead code | `.kpi-row-lone` and the `lone` ghost variant retired (no row wore them since the Paycheck and ESPP strips) | `e4323010` |
| 9 | Wording | Spending's Living line names only the outflows the month had ("No tax or transfers" for neither, whole dollars); Net pay's change is unsigned beside its glyph ("▼ $859 vs Jun"); the guide places the employer match in its tile; the calendar legs no longer count an event whose amount the sum leaves out, and the unreachable `card_credit` noun is gone; What-if's rate line is the move between the two rates it displays (and empty when the engine gave none) | `f993d1f2`, `954456ea`, `a096292f` |
| 10 | Tests | `versusMonthBefore` with a null current month and an ineligible previous one; FI ratio's line at exactly 1.0 ("Target reached") and without a target (empty) | `f993d1f2`, `954456ea` |
| — | Found while re-measuring | "1 eligible months" (the history's first month) → "1 eligible month"; the Review's Cash outflow said "tax $0 · transfers $0" beside Spending's "No tax or transfers" for the same month — one helper now (`utils/format` `outflowsLine`) | `3a5c8178`, `f67bfd07` |

### Re-measured (headless Edge 153, the production copy on :8077)

- **#1** — lowest tile edge → next box, every tile row on 16 routes; before = main's tile CSS (the L1 worktree), after = this
  branch: Taxes totals → "By jurisdiction" 17.6 → **33.6** → 17.6 px at 1440 and 1280 (compact at 1440: 15.8, as
  before); Monthly Review → "Changes since last save" 20 → **36** → 20 px (compact 18, as before). Every other row
  equals its pre-L2 gap: 16 px (compact 14.4), the Projection band 24 (22.4). Scripts: `fix-L2/gaps2.mjs`, `gaps-*.txt`.
- **#3** — Paycheck at 1280 / 1440 / 1920, dark and light: breakdown and flow cards 472 / 456 / 456 px, ending on one
  line, 0 px of blank band in either (was 493 with 21 / 37 / 37 px under NET PAY); the sankey fills to 299 / 283 /
  283 px, labels clear. The feed ghost: 456 px box at every width (was 510) — 0 px against the pair at 1440 / 1920,
  16 px short at 1280 (the hint runs three lines there).
- **#4** — Net worth at 1280 across ten ribbon months: 159.2 px in all ten (was 142.2 / 159.2); its ghost 158.6.
  Overview 159.2 (ghost 158.6), Spending unchanged at 138.8; 1440 / 1920 unchanged (147.5 / 156.6, one line).
- **#6** — Comp, the block under the vesting row, ghost → landed: 248.0 → 248.3 px at 1440, 248.0 → 247.4 at 1280
  (was 264: +15.7 / +16.6).
- The lane probe again (`measure.mjs`, 12 routes × 1280 / 1440 / 1920, both themes): value baselines 0.0 on every
  line of every row; one delta line at 1440 on the Overview, Net worth and Spending; the space under every row 16 px
  except the Taxes totals 17.6, the Review 20 and the Projection band 24; light identical to dark in geometry.

### Outside-scope touches added in the round

- `src/components/taxes/taxes.css` — the one follower rule (#1).
- `src/guide/content/pages-income.tsx` — one step's copy (#9).
- `src/utils/format.ts` — `outflowsLine`, shared by Spending and the Review.
- `src/components/espp/PositionStrip.test.tsx`, `src/pages/EsppPage.test.tsx` — their assertions on the retired
  `.kpi-row-lone`, now positive (the row is the five-tile one).
- New test file `src/components/tileRowFence.test.ts`.

### Remainders after the round

- Net worth at 1280 still lands its first card 42 px below where its ghost stood — all of it above the tile row (the
  frame's scope area), as before L2 (67 px then, with the row's own 25).
- The Review's month story is a sentence and runs two lines in its card at every width (spec §M5's words).
- Portfolio's Realized gains stays bare (out of scope), and the Paycheck remainders above stand.

### Gates on the merged tree (review round)

- `npx tsc -p tsconfig.app.json --noEmit` — clean; `npx tsc -p tsconfig.node.json --noEmit` — clean.
- `npx eslint .` — 0 errors, 26 warnings (the baseline).
- `npx vitest run --maxWorkers=4` — 321 files, 4,766 tests passed (320 / 4,751 on the merged tree before the round).
- Both vite servers stopped (mine on 5272, the baseline on 5283); no headless Edge left running; the shared :8077
  backend untouched.
