# Charts C1 — Grammar primitives, ChartCard, EChart plumbing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every page-independent unit of `docs/superpowers/specs/2026-09-03-chart-grammar-design.md` §5: the `charts/` grammar modules (grid variants, axes, tooltip contract, legend rule, reference/annotation helpers, scales, entities, waterfall, motion block), the diverging token ramp with its recolor/CSS/contrast plumbing, the `EChart` changes (`group` → `connect`, live reduced motion, opt-in decals, `ariaLabel` still optional), `ChartCard` + `ChartTable` + the grown export menu (Table · Copy · captioned PNG), `useReducedMotion` shared with `StatTile`, the Appearance "Chart patterns" control, and the fixture-driven conformance harness with three grammar fixtures. Nothing in this plan migrates a builder or a page; lanes C2–C6 do that in parallel once this merges. It also folds in four review leftovers from 2026-09-03 (theme test `toHaveBeenLastCalledWith`, the `recolor.ts` gradient-INSTANCE comment, the parity test's duplicate-hex claim; `TAX_COLORS[2]` → `SEQUENTIAL_BLUE[7]` goes to C6).

**Architecture:** Helpers live in `src/charts/*` (the non-React lazy chart chunk) and return the exact literals today's builders spell out, so a migrated builder's dark option stays byte-identical except where §15 names a change. `ChartCard` (`src/components/`) owns chrome and lifecycle — header, hint, controls, export row, five states, zoom hint, footer, the accessibility table twin — and never rewrites series; `EChart` keeps its recolor / reduced-motion / entrance touches and gains `chart.group` + `echarts.connect`, a live `prefers-reduced-motion` subscription and the `aria.decal` merge. A conformance test walks `src/charts/fixtures/*.fixture.ts` and enforces the grammar structurally (token colors, grammar axis formatters by identity, named grid variants, branded tooltips, bar marks, scroll legends, dashed-only-for-references, stagger on stacks), with fixtures declaring exemptions for exotic forms.

**Tech Stack:** React 19, TypeScript 5.9, Vite 6, vitest 3 + @testing-library/react (jsdom — real echarts never renders in tests; the engine is stubbed at the module boundary as `EChart.test.tsx` already does), ECharts 6.1 (`echarts/core` tree-shaken via `src/charts/echarts.ts`), plain CSS custom properties.

**Worktree / commands:** Work in a worktree on branch `charts-c1` (`git worktree add .worktrees/charts-c1 -b charts-c1 main`). Frontend deps are not installed per worktree — junction them once from the worktree root: `cmd //c "mklink /J node_modules ..\\..\\node_modules"`. Commands run from the worktree root: `npx vitest run <file>`, `npx vitest run` (full), `npx tsc -b`, `npx eslint <files>`. No backend work. Commit after every task; local commits only (nothing is pushed tonight).

**Byte-identical rule (for the lanes that follow):** every helper here reproduces today's literal exactly (`MONEY_GRID` = `{70,24,40,28}`, `BAR_MARKS.itemStyle` = `{ borderColor: SURFACE, borderWidth: 1 }`, `referenceLine` = the 4%-rule series, `zeroLine` = the savings-rate markLine, `sequentialVisualMap` = the heatmap's visualMap). Where the spec names a change (§8 grid variants, §9 `emphasis.focus`/legend rule, §11 motion, F7 tooltips, F13 `barMaxWidth` 24) the helper carries the NEW value and the lane's commit message cites the section.

---

## File structure

| File | Responsibility |
|---|---|
| `src/charts/theme.test.ts` (modify) | Leftover: dark@0 registration asserted with `toHaveBeenLastCalledWith` |
| `src/charts/recolor.ts` (modify) | Leftover: gradient-INSTANCE comment corrected; diverging ramp joins the DARK→LIGHT map (ramp + lone keys) |
| `src/charts/recolor.test.ts` (modify) | Leftover: the parity test asserts hex DISTINCTNESS (the comment claimed it already did); diverging twins |
| `src/theme/tokens.ts` (modify) | `diverging` 9-tuple on `ThemeTokens`, DARK/LIGHT values, `--diverge-1…9` in `cssDeclarations` |
| `src/theme/tokens.test.ts` (modify) | Monotone lightness per arm, ≥ 3:1 on the two outer steps of each arm on both surfaces, no step equals another token hex, CSS drift |
| `src/index.css` (modify) | `--diverge-1…9` in both palette blocks |
| `src/charts/motion.ts` (modify) | `MOTION` block; stale ScatterChart comment corrected |
| `src/charts/theme.ts` (modify) | `buildTheme` spreads `MOTION`; tooltip `className: 'chart-tip'`; `DIVERGING` export |
| `src/charts/grammar.ts` (new) | `MONEY_GRID` + `GRID_VARIANTS` + `grid()` + `isGridVariant()`, `compactMoney`, `percentLabel`, `moneyAxis`, `pctAxis`, `monthAxis`/`dateAxis`, `BAR_MARKS`, `capLabel`, `LINE`, `WASH`, `STACK_WASH`, `roundTo`, `cents`, `stagger` |
| `src/charts/tooltip.ts` (new) | `axisTooltip`, `itemTooltip`, `swatch`, `formatUnit`, `brandTooltip`, `isGrammarTooltip`, `AxisTooltipParam` |
| `src/testing/tooltipRows.ts` (new) | Test-only parser of the `.chart-tip` markup → `{ head, rows, notes }` (lanes assert structure, not HTML bytes) |
| `src/charts/sankey.ts` (modify) | Factory output branded via `brandTooltip`; `sankeyCsv(nodes, links)` for the three flow cards |
| `src/charts/legend.ts` (new) | `legendFor(count, selected)`, `FOCUS` |
| `src/charts/reference.ts` (new) | `referenceLine(name, data, { step, id })` — absorbs `budgetStepSeries` |
| `src/charts/markLine.ts` (modify) | `anchorLabel`, `ruleAt`, `annotationRules`, `todayRule`, `arrivalRule`, `afterArea`, `percentileMarks`, `zeroLine`; `anchorMonthLabel` kept as a wrapper |
| `src/charts/scales.ts` (new) | `sequentialVisualMap`, `divergingVisualMap`, `rowNormalize`, `vsAverage` |
| `src/charts/entities.ts` (new) | `GROUP_COLORS` re-export, `personSlot`, `slotColor`, `lowestFreeSlot`, `foldColor` |
| `src/charts/waterfall.ts` (new) | `waterfallSteps`, `waterfallSeries`, `waterfallTooltip` — lifted from `taxChartOptions` (C6 rewires the tax builder onto it) |
| `src/charts/echarts.ts` (modify) | Registers `MarkAreaComponent`, `MarkPointComponent`, `AriaComponent`; exports `connect`; `AriaComponentOption` in the option union |
| `vite.config.ts` (modify) | `chunkSizeWarningLimit` 730 → 760 (three more components in the lazy chart chunk) |
| `src/components/useReducedMotion.ts` (new) | `prefersReducedMotion()` + `useReducedMotion()` (matchMedia `change` subscription) |
| `src/components/StatTile.tsx` (modify) | Reads `useReducedMotion`; count-up 350 → 450 ms |
| `src/components/StatTile.test.tsx` (modify) | Final-frame timestamp moved past 450 ms |
| `src/components/useChartDecals.ts` (new) | `finance.chartDecals` store: `readChartDecals`, `setChartDecals`, `useChartDecals` |
| `src/components/settings/AppearanceCard.tsx` (modify) | Third field: Chart patterns Off/On |
| `src/components/EChart.tsx` (modify) | `group` prop → `chart.group` + `connect`; live reduced motion; `aria.decal` merge (label generation OFF); `ariaLabel` stays optional until C7 |
| `src/components/EChart.test.tsx` (modify) | connect per init/re-init, decal merge, live media change; the 23 existing cases stay green |
| `src/charts/exportImage.ts` (new) | `captionedPng()` offscreen-canvas composite, `dataUrlToBlob()` |
| `src/components/ChartExportMenu.tsx` (modify) | Buttons PNG · Copy · CSV · Table; captioned PNG; Copy with download fallback + toast |
| `src/components/ChartExportMenu.test.tsx` (new) | Table toggle, Copy fallback, caption composite, CSV unchanged |
| `src/components/ChartTable.tsx` (new) | The accessibility twin: `ExportTable` → `<details><table class="data-table">` |
| `src/components/ChartCard.tsx` (new) | Header · hint · controls · actions · export row · five states · EChart · zoom hint · footer; `animateEntrance` from `usePageFrame().fromCache` |
| `src/components/ChartCard.test.tsx` (new) | Five states, required props, `fromCache` from context, controls/actions, export row, Table toggle, `group` pass-through |
| `src/components/panels.css` (modify) | `.chart-card*`, `.chart-tip*`, `.chart-table*` |
| `src/charts/fixtures/_types.ts` (new) | `ChartFixture` interface (`name`, `kind`, `ariaLabel`, `exempt`, `dashed`, `build`) |
| `src/charts/fixtures/grammar-line.fixture.ts`, `grammar-stack.fixture.ts`, `grammar-heatmap.fixture.ts` (new) | Three synthetic fixtures built purely from the grammar — the harness's own proof; lanes add one `<builder>.fixture.ts` per real builder |
| `src/charts/conformance.ts` (new) | `checkConformance(option, fixture) → string[]` — the pure rule set |
| `src/charts/conformance.test.ts` (new) | Rule unit tests (negative cases) + the glob walk over `fixtures/*.fixture.ts` |

Lane ownership after this plan merges: C2 Net worth + Overview, C3 Spending, C4 Portfolio, C5 Projection + Comp/ESPP, C6 Taxes + Credit cards + Paycheck, C7 retire + verify. Nothing here touches a `*ChartOptions.ts` module or a page, so the five lanes start from a clean base.

---

### Task 1: Review leftovers — theme test assertion, recolor comments, parity distinctness

**Files:**
- Modify: `src/charts/theme.test.ts:42-45`
- Modify: `src/charts/recolor.ts:6-17` and `:104-108`
- Modify: `src/charts/recolor.test.ts:149-161`

Three small corrections from the 2026-09-03 review round. They come first because Task 2 edits the same three files.

- [ ] **Step 1: Make the dark@0 registration test able to fail**

`echarts.ts` registers `'finance'` with `FINANCE_THEME` at import time, so `toHaveBeenCalledWith('finance', FINANCE_THEME)` passes even if `registerThemeVersion('dark', 0)` registered nothing. Replace the last test in `src/charts/theme.test.ts`:

```ts
  it('registers DARK for the dark palette under the same version-0 name as import time', () => {
    expect(registerThemeVersion('dark', 0)).toBe('finance')
    // LAST call, not any call: echarts.ts already registered 'finance' at import, so a
    // registerThemeVersion that registered nothing would still satisfy toHaveBeenCalledWith.
    expect(vi.mocked(echarts.registerTheme)).toHaveBeenLastCalledWith('finance', FINANCE_THEME)
  })
```

Run: `npx vitest run src/charts/theme.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 2: Correct the gradient-INSTANCE comment in `recolor.ts`**

The header comment (lines 10–13) and the pass-through comment (lines 104–108) claim a non-plain object "cannot hold a token hex in an enumerable string field". An echarts `graphic.LinearGradient` INSTANCE does exactly that (`colorStops[].color`), and it is passed through UNrecolored. Replace the header bullet:

```ts
//   • non-plain objects (Date, typed arrays, an echarts `graphic.LinearGradient`
//     INSTANCE) pass through by identity: a spread copy would drop their prototype and
//     hand echarts a lookalike it no longer recognizes. The cost is real for the gradient
//     instance — its colorStops DO carry hexes and they are NOT recolored — which is why
//     builders must write gradients as plain `{ type: 'linear', colorStops }` literals
//     (walked like any object) and never `new echarts.graphic.LinearGradient(...)`;
```

and the in-function comment:

```ts
    // Only `{}` literals and null-prototype bags are safe to rebuild key-by-key. A Date,
    // a typed array (echarts accepts them as series data) or an echarts LinearGradient
    // INSTANCE would come back as a plain lookalike with its prototype — and so its
    // methods and echarts' own type checks — gone. Dates and typed arrays carry no color;
    // a gradient INSTANCE does, and it stays dark under the light theme — hence the
    // plain-literal rule for gradients in the header comment.
```

- [ ] **Step 3: Make the parity test actually test distinctness**

`recolor.test.ts:149-152` says "a duplicated hex inside one palette would silently shrink the map without changing any length" — but the assertions only check that every dark hex is IN the map, which a duplicate would still satisfy. Replace that test:

```ts
  // Position mapping is only safe while the two scales are the same length, every dark
  // hex has a light twin AND no hex repeats inside a scale: a duplicate would make two
  // positions share one Map key, so the earlier position's light twin would be lost —
  // and the "every hex is in the map" check below would still pass. Hence the Set sizes.
  it('every dark chart hex has a light twin in the map, and no scale repeats a hex', () => {
    for (const hex of DARK.sequential) {
      expect(lightFromDark.get('ramp:' + hex.toLowerCase())).toBeDefined()
      expect(lightFromDark.get(hex.toLowerCase())).toBeDefined()
    }
    for (const hex of DARK.palette) expect(lightFromDark.get(hex.toLowerCase())).toBeDefined()
    expect(DARK.sequential).toHaveLength(LIGHT.sequential.length)
    expect(DARK.palette).toHaveLength(LIGHT.palette.length)
    expect(new Set(DARK.sequential.map((h) => h.toLowerCase())).size).toBe(DARK.sequential.length)
    expect(new Set(LIGHT.sequential.map((h) => h.toLowerCase())).size).toBe(LIGHT.sequential.length)
    expect(new Set(DARK.palette.map((h) => h.toLowerCase())).size).toBe(DARK.palette.length)
    expect(new Set(LIGHT.palette.map((h) => h.toLowerCase())).size).toBe(LIGHT.palette.length)
  })
```

Run: `npx vitest run src/charts/recolor.test.ts src/charts/theme.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/charts/theme.test.ts src/charts/recolor.ts src/charts/recolor.test.ts
git commit -m "test(charts): dark@0 asserts the LAST registration; parity test checks hex distinctness; gradient-instance comment corrected"
```

---

### Task 2: The diverging ramp — tokens, CSS, recolor plumbing, contrast acceptance

**Files:**
- Modify: `src/theme/tokens.ts`, `src/theme/tokens.test.ts`, `src/index.css`
- Modify: `src/charts/recolor.ts`, `src/charts/recolor.test.ts`
- Modify: `src/charts/theme.ts` (one export)

Spec §12 "Diverging": a 9-tuple, orange arm ← neutral → blue arm, midpoint receding into the card. The values below are the spec's starting points; the tests are the acceptance — if one fails, move LIGHTNESS and hold hue until it passes.

- [ ] **Step 1: Write the failing token tests**

Append to `src/theme/tokens.test.ts` inside `describe('tokens', …)`:

```ts
  // §12 diverging: index 4 is the neutral midpoint. Read OUTWARD from it, each arm's
  // luminance moves monotonically — brighter on the dark surface (the midpoint recedes
  // into the card), darker on the light one — and the two outer steps of each arm carry
  // the 3:1 floor on both text-bearing backgrounds, because those are the steps that
  // encode "far above / far below average" and must be legible as marks.
  it.each(surfaces)('%s: the diverging ramp is monotone per arm and reads 3:1 at its outer steps', (_name, t) => {
    const d = t.diverging
    expect(d).toHaveLength(9)
    const lum = d.map(luminance)
    const outward = Math.sign(lum[5] - lum[4])
    expect(outward).not.toBe(0)
    for (let i = 4; i > 0; i -= 1) expect(Math.sign(lum[i - 1] - lum[i]), `orange step ${i}`).toBe(outward)
    for (let i = 4; i < 8; i += 1) expect(Math.sign(lum[i + 1] - lum[i]), `blue step ${i}`).toBe(outward)
    for (const hex of [d[0], d[1], d[7], d[8]]) {
      expect(contrastRatio(hex, t.surface), `${hex} on surface`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(hex, t.bg), `${hex} on bg`).toBeGreaterThanOrEqual(3)
    }
  })

  // recolor.ts elects a winner wherever two token names share one hex; the diverging
  // steps must never enter that election, so no step may equal any other token — and no
  // step may repeat (a repeat would collapse two ramp positions onto one map key).
  it.each(surfaces)('%s: no diverging step equals another token hex or another step', (_name, t) => {
    const others = new Set(
      [
        t.bg, t.surface, t.surface2, t.border, t.text, t.muted, t.accent, t.onAccent,
        t.positive, t.negative, t.warn, t.gridLine, t.axisLine, t.otherSeries,
        ...t.palette, ...t.sequential,
      ].map((h) => h.toLowerCase()),
    )
    for (const hex of t.diverging) expect(others.has(hex.toLowerCase()), hex).toBe(false)
    expect(new Set(t.diverging.map((h) => h.toLowerCase())).size).toBe(9)
  })
```

The existing `index.css declares every token…` test picks up `--diverge-N` automatically once `cssDeclarations` emits them.

Run: `npx vitest run src/theme/tokens.test.ts`
Expected: FAIL — `d` is undefined (`Cannot read properties of undefined (reading 'length')`).

- [ ] **Step 2: Add the tuple to `tokens.ts`**

In `ThemeTokens`, after `sequential`:

```ts
  /** 9 steps: orange arm (0–3) ← neutral midpoint (4) → blue arm (5–8). Used ONLY through
   *  charts/scales.ts `divergingVisualMap` (the heatmap's "vs average" mode, the
   *  heat-treemap). Fixed length like the other ramps: recolor.ts maps by position. */
  diverging: readonly [string, string, string, string, string, string, string, string, string]
```

In `DARK`, after `sequential`:

```ts
  diverging: [
    '#f28b57', '#e57236', '#b85a2a', '#6b4436', '#272c37', '#2b4a7a', '#2f6bb8', '#4a8ee6', '#7fb2f0',
  ],
```

In `LIGHT`, after `sequential`:

```ts
  diverging: [
    '#a63f12', '#c8501f', '#e07a4e', '#f2b899', '#e5eaf1', '#a9c6f0', '#6f9ddf', '#3f76cb', '#2559a8',
  ],
```

In `cssDeclarations`, after the palette line:

```ts
    ...t.diverging.map((hex, i) => `--diverge-${i + 1}: ${hex};`),
```

- [ ] **Step 3: Mirror the values in `src/index.css`**

After `--chart-8: #e66767;` in `:root`:

```css
  /* Diverging ramp (chart spec §12): orange arm ← neutral → blue arm. Read only by charts. */
  --diverge-1: #f28b57;
  --diverge-2: #e57236;
  --diverge-3: #b85a2a;
  --diverge-4: #6b4436;
  --diverge-5: #272c37;
  --diverge-6: #2b4a7a;
  --diverge-7: #2f6bb8;
  --diverge-8: #4a8ee6;
  --diverge-9: #7fb2f0;
```

After `--chart-8: #c94848;` in `[data-theme="light"]`:

```css
  --diverge-1: #a63f12;
  --diverge-2: #c8501f;
  --diverge-3: #e07a4e;
  --diverge-4: #f2b899;
  --diverge-5: #e5eaf1;
  --diverge-6: #a9c6f0;
  --diverge-7: #6f9ddf;
  --diverge-8: #3f76cb;
  --diverge-9: #2559a8;
```

Run: `npx vitest run src/theme/tokens.test.ts`
Expected: PASS (all token tests, including the CSS drift test).

- [ ] **Step 4: Write the failing recolor test**

Append to the `shared dark hexes` describe in `src/charts/recolor.test.ts`:

```ts
  // The diverging tuple joins the map like `sequential`: by POSITION inside an array (the
  // ramp rule) and as lone colors. tokens.test.ts guarantees no step shares a hex with any
  // other token, so the tuple never enters the election above.
  it('maps the diverging ramp by position and as lone colors', () => {
    expect(recolorOption({ inRange: { color: [...DARK.diverging] } }, lightFromDark)).toEqual({
      inRange: { color: [...LIGHT.diverging] },
    })
    expect(recolorOption(DARK.diverging[0], lightFromDark)).toBe(LIGHT.diverging[0])
    expect(recolorOption(DARK.diverging[8], lightFromDark)).toBe(LIGHT.diverging[8])
    expect(DARK.diverging).toHaveLength(LIGHT.diverging.length)
    expect(new Set(DARK.diverging.map((h) => h.toLowerCase())).size).toBe(DARK.diverging.length)
  })
```

Run: `npx vitest run src/charts/recolor.test.ts`
Expected: FAIL — the diverging hexes pass through unchanged.

- [ ] **Step 5: Register the tuple in `recolor.ts`**

In `pairs()`, between the `sequential` loop and the `palette` loop:

```ts
  // Diverging steps are distinct from every other token (tokens.test.ts), so their order
  // in this block is not an election — it is just the same ramp+lone registration the
  // sequential scale gets, so a visualMap `inRange.color` array recolors by position.
  from.diverging.forEach((hex, i) => {
    map.set(RAMP + hex.toLowerCase(), to.diverging[i])
    map.set(hex.toLowerCase(), to.diverging[i])
  })
```

Update the block-order comment above `pairs` to read `scalars → sequential → diverging → palette`.

- [ ] **Step 6: Export the dark tuple for builders**

In `src/charts/theme.ts`, after `SEQUENTIAL_BLUE`:

```ts
// Diverging, orange ← neutral → blue (chart spec §12). Only charts/scales.ts reads it —
// builders never index into it directly.
export const DIVERGING = DARK.diverging
```

Run: `npx vitest run src/charts/recolor.test.ts src/theme/tokens.test.ts src/charts/theme.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/theme/tokens.ts src/theme/tokens.test.ts src/index.css src/charts/recolor.ts src/charts/recolor.test.ts src/charts/theme.ts
git commit -m "feat(charts): diverging 9-step ramp in tokens, CSS and the light recolor map, with contrast and monotonicity acceptance (spec §12)"
```

---

### Task 3: House motion block in the ECharts theme

**Files:**
- Modify: `src/charts/motion.ts`, `src/charts/motion.test.ts`
- Modify: `src/charts/theme.ts`, `src/charts/theme.test.ts`

Spec §11: `MOTION = { animationDuration: 450, animationEasing: 'cubicOut', animationDurationUpdate: 300, animationEasingUpdate: 'cubicInOut' }` spreads into `buildTheme()` so every chart inherits it; the tooltip gains `className: 'chart-tip'` (§7) so the CSS rows in Task 15 style every tooltip, grammar-built or not. Also corrects `motion.ts`'s stale "ScatterChart is not registered" comment (it has been registered since the net-worth note markers).

- [ ] **Step 1: Write the failing tests**

Append to `src/charts/motion.test.ts`:

```ts
import { MOTION } from './motion'

describe('MOTION', () => {
  it('is the house clock: 450ms cubicOut entrance, 300ms cubicInOut update', () => {
    expect(MOTION).toEqual({
      animationDuration: 450,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 300,
      animationEasingUpdate: 'cubicInOut',
    })
  })
})
```

Append to `src/charts/theme.test.ts` (inside the describe):

```ts
  it('carries the house motion block and the tooltip class into every theme', () => {
    for (const theme of [buildTheme(DARK), buildTheme(LIGHT)]) {
      expect(theme.animationDuration).toBe(450)
      expect(theme.animationEasing).toBe('cubicOut')
      expect(theme.animationDurationUpdate).toBe(300)
      expect(theme.animationEasingUpdate).toBe('cubicInOut')
      expect(theme.tooltip.className).toBe('chart-tip')
    }
  })
```

Run: `npx vitest run src/charts/motion.test.ts src/charts/theme.test.ts`
Expected: FAIL — `MOTION` is not exported; `animationDuration` undefined.

- [ ] **Step 2: Add `MOTION` and fix the comment in `motion.ts`**

Replace the file's header comment block (lines 1–11) and add the constant; `quiesceRipples` is unchanged:

```ts
// Motion rules that a global flag cannot express, plus the house clock every chart
// inherits. Lives beside echarts.ts rather than in EChart.tsx because the wrapper is a
// component module (a value export there trips react-refresh/only-export-components).
import type { EChartsOption } from './echarts'

/** The house motion clock (chart spec §11). buildTheme() spreads it into every registered
 *  theme, so no builder names a duration; grammar.ts's `stagger()` layers a per-series
 *  delay on stacks. Reduced motion still wins: EChart forces `animation: false` after
 *  the option spread, and `quiesceRipples` below covers the one animator that ignores it. */
export const MOTION = {
  animationDuration: 450,
  animationEasing: 'cubicOut' as const,
  animationDurationUpdate: 300,
  animationEasingUpdate: 'cubicInOut' as const,
}

// `animation: false` does NOT reach an effectScatter's ripple: EffectSymbol starts a
// looping zrender animator per ripple unconditionally (nothing in that module consults
// the global animation flag), so a live ping would pulse forever against the OS
// preference. Setting rippleEffect.number to 0 makes that loop body never run — the
// point still renders, only the motion is gone. Swapping the series to type 'scatter' is
// NOT the fix either: ScatterChart IS registered (the net-worth note markers), but a
// still dot loses the live ping's one meaning — "this reading is now" — which the ripple
// carries and a plain marker does not.
```

- [ ] **Step 3: Spread `MOTION` into `buildTheme` and add the tooltip class**

In `src/charts/theme.ts`, import and spread:

```ts
import { MOTION } from './motion'
```

```ts
export function buildTheme(t: ThemeTokens) {
  return {
    // The house clock (chart spec §11): entrance 450ms cubicOut, update 300ms cubicInOut.
    ...MOTION,
    color: [...t.palette],
    backgroundColor: 'transparent',
    textStyle: { color: t.muted, fontFamily: FONT_FAMILY },
    // … categoryAxis / valueAxis / legend unchanged …
    tooltip: {
      // The grammar's tooltip rows (charts/tooltip.ts) are styled by panels.css under this
      // class; a theme-level className means even a non-grammar tooltip inherits the box.
      className: 'chart-tip',
      backgroundColor: t.surface2,
      borderColor: t.axisLine,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 8px;',
    },
    visualMap: { textStyle: { color: t.muted } },
  }
}
```

(`motion.ts` imports only a type from `echarts.ts`, and `theme.ts` is imported by `echarts.ts` — no cycle is introduced: `motion.ts` → `echarts.ts` is type-only and erased.)

Run: `npx vitest run src/charts/motion.test.ts src/charts/theme.test.ts src/components/EChart.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/charts/motion.ts src/charts/motion.test.ts src/charts/theme.ts src/charts/theme.test.ts
git commit -m "feat(charts): house MOTION block in buildTheme, tooltip className, motion.ts comment corrected (spec §11)"
```

---

### Task 4: `grammar.ts` — grids, axes, marks, rounding, stagger

**Files:**
- Create: `src/charts/grammar.ts`
- Test: `src/charts/grammar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/charts/grammar.test.ts
import { describe, expect, it } from 'vitest'
import { INK, MUTED, SURFACE } from './theme'
import {
  BAR_MARKS, GRID_VARIANTS, LINE, MONEY_GRID, STACK_WASH, WASH, capLabel, cents, compactMoney,
  dateAxis, grid, isGridVariant, moneyAxis, monthAxis, pctAxis, percentLabel, roundTo, stagger,
} from './grammar'

describe('grids', () => {
  it('MONEY_GRID is the eight-builder literal and every variant differs from it in one named way', () => {
    expect(MONEY_GRID).toEqual({ left: 70, right: 24, top: 40, bottom: 28 })
    expect(GRID_VARIANTS.noLegend).toEqual({ left: 70, right: 24, top: 16, bottom: 28 })
    expect(GRID_VARIANTS.endLabel).toEqual({ left: 70, right: 84, top: 40, bottom: 28 })
    expect(GRID_VARIANTS.horizontal).toEqual({ left: 130, right: 40, top: 8, bottom: 28 })
    expect(GRID_VARIANTS.heatmap).toEqual({ left: 130, right: 24, top: 8, bottom: 96 })
    expect(GRID_VARIANTS.fan).toEqual({ left: 76, right: 24, top: 40, bottom: 28 })
  })
  it('grid() returns a COPY of a variant and defaults to the money grid', () => {
    const g = grid()
    expect(g).toEqual(MONEY_GRID)
    expect(g).not.toBe(MONEY_GRID)
    expect(grid('heatmap')).toEqual(GRID_VARIANTS.heatmap)
  })
  it('isGridVariant recognises exactly the named shapes', () => {
    expect(isGridVariant({ left: 70, right: 24, top: 40, bottom: 28 })).toBe(true)
    expect(isGridVariant({ left: 70, right: 16, top: 12, bottom: 28 })).toBe(false) // the old trend literal
    expect(isGridVariant({ left: 70, right: 24, top: 40, bottom: 28, containLabel: true })).toBe(false)
    expect(isGridVariant(undefined)).toBe(false)
  })
})

describe('axes', () => {
  it('moneyAxis: zero-anchored by default, scale:true only when asked, log when asked', () => {
    expect(moneyAxis()).toEqual({ type: 'value', axisLabel: { formatter: compactMoney } })
    expect(moneyAxis({ zero: false })).toEqual({ type: 'value', scale: true, axisLabel: { formatter: compactMoney } })
    expect(moneyAxis({ log: true })).toEqual({ type: 'log', axisLabel: { formatter: compactMoney } })
    // The formatter is the grammar's function BY IDENTITY — what conformance checks.
    expect(moneyAxis().axisLabel.formatter).toBe(compactMoney)
    expect(compactMoney(1500)).toBe('$1.5K')
    expect(compactMoney(1_450_000)).toBe('$1.45M')
  })
  it('pctAxis reproduces the savings-rate extents and labels whole percents', () => {
    const axis = pctAxis()
    expect(axis.min({ min: -1.8 })).toBe(-2) // floors to a whole −100% step
    expect(axis.min({ min: 0.4 })).toBe(-1) // never above the −100% floor
    expect(axis.max({ max: 0.6 })).toBe(0.6)
    expect(axis.max({ max: 1.7 })).toBe(1) // rates above 100% are impossible
    expect(axis.max({ max: -0.5 })).toBe(0.1)
    expect(axis.axisLabel.formatter).toBe(percentLabel)
    expect(percentLabel(0.35)).toBe('35%')
    expect(pctAxis({ floor: 0, ceiling: 2 }).min({ min: 0.5 })).toBe(0)
  })
  it('monthAxis: no boundary gap for lines, gap for bars, interval 0 at 12 categories or fewer', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `M${i}`)
    const thirteen = [...twelve, 'M12']
    expect(monthAxis(twelve)).toEqual({ type: 'category', data: twelve, boundaryGap: false, axisLabel: { interval: 0 } })
    expect(monthAxis(thirteen)).toEqual({ type: 'category', data: thirteen, boundaryGap: false })
    expect(monthAxis(thirteen, { gap: true })).toEqual({ type: 'category', data: thirteen })
    expect(monthAxis(thirteen, { gap: true, rotate: 45 })).toEqual({ type: 'category', data: thirteen, axisLabel: { rotate: 45 } })
    expect(dateAxis(['Aug 10, 2026', 'Aug 11, 2026'])).toEqual({
      type: 'category', data: ['Aug 10, 2026', 'Aug 11, 2026'], boundaryGap: false, axisLabel: { interval: 0 },
    })
  })
})

describe('marks', () => {
  it('BAR_MARKS carries the surface hairline, the 22px cap and series focus', () => {
    expect(BAR_MARKS).toEqual({
      barMaxWidth: 22,
      itemStyle: { borderColor: SURFACE, borderWidth: 1 },
      emphasis: { focus: 'series', itemStyle: { borderColor: INK } },
    })
  })
  it('LINE, WASH and STACK_WASH are the line-chart literals', () => {
    expect(LINE).toEqual({ type: 'line', symbol: 'none', lineStyle: { width: 2 }, emphasis: { focus: 'series' } })
    expect(WASH).toEqual({ areaStyle: { opacity: 0.12 } })
    expect(STACK_WASH).toEqual({ lineStyle: { width: 1 }, areaStyle: { opacity: 0.5 } })
  })
  it('capLabel is the waterfall/cap direct-label block with the caller formatter', () => {
    const f = (p: { dataIndex: number }) => `#${p.dataIndex}`
    expect(capLabel(f)).toEqual({ show: true, position: 'top', color: MUTED, fontSize: 11, formatter: f })
  })
})

describe('rounding and stagger', () => {
  it('roundTo/cents land float dust back on the requested places', () => {
    expect(roundTo(601854.46 - 188930, 2)).toBe(412924.46)
    expect(cents(38 * 183.2508)).toBe(6963.53)
    expect(roundTo(0.30602 * 100, 4)).toBe(30.602)
  })
  it('stagger is a FUNCTION delay (invisible to the JSON fingerprint) of 12ms per series', () => {
    const s = stagger(3)
    expect(typeof s.animationDelay).toBe('function')
    expect(s.animationDelay()).toBe(36)
    expect(JSON.stringify({ a: 1, ...stagger(2) })).toBe('{"a":1}')
  })
})
```

Run: `npx vitest run src/charts/grammar.test.ts`
Expected: FAIL — `Cannot find module './grammar'`.

- [ ] **Step 2: Write the module**

```ts
// src/charts/grammar.ts
// The cartesian grammar every builder composes from (chart spec §8, §13). Every value is
// today's literal, so a migrated builder's dark option is byte-identical unless the spec
// names the change (§9 adds `emphasis.focus`; F13 shrinks the tax/comp bars to 24 through
// the waterfall helper and BAR_MARKS's cap). conformance.ts checks grids by VARIANT and
// axis formatters by IDENTITY, so builders reference these — never re-spell them.
// How it is used: `grid('endLabel')`, `yAxis: moneyAxis()`, `xAxis: monthAxis(labels)`,
// `{ ...LINE, name, color, data }`, `{ type: 'bar', ...BAR_MARKS, ...stagger(i), stack }`.
// Depends on: charts/theme.ts (dark constants), utils/format.ts (the two label formatters).
import { INK, MUTED, SURFACE } from './theme'
import { formatCurrencyCompact, formatPct } from '../utils/format'

export const MONEY_GRID = { left: 70, right: 24, top: 40, bottom: 28 } as const

/** The named grids — the ONLY grids a cartesian builder may emit. default: legend row on
 *  top · noLegend: single series · endLabel: room for the net-worth end label · horizontal:
 *  category y-axis with 118px labels (card values, the bracket ladder) · heatmap: category
 *  y-axis + rotated month labels + the visualMap bar under them · fan: the projection's
 *  wider money labels. */
export const GRID_VARIANTS = {
  default: MONEY_GRID,
  noLegend: { left: 70, right: 24, top: 16, bottom: 28 },
  endLabel: { left: 70, right: 84, top: 40, bottom: 28 },
  horizontal: { left: 130, right: 40, top: 8, bottom: 28 },
  heatmap: { left: 130, right: 24, top: 8, bottom: 96 },
  fan: { left: 76, right: 24, top: 40, bottom: 28 },
} as const

export type GridVariant = keyof typeof GRID_VARIANTS
export interface Grid {
  left: number
  right: number
  top: number
  bottom: number
}

/** A fresh copy of a variant (builders sometimes spread onto it; the constants stay frozen). */
export function grid(variant: GridVariant = 'default'): Grid {
  return { ...GRID_VARIANTS[variant] }
}

/** Conformance's grid rule: exactly one of the named shapes, no extra keys. */
export function isGridVariant(candidate: unknown): candidate is Grid {
  if (candidate === null || typeof candidate !== 'object') return false
  const c = candidate as Record<string, unknown>
  if (Object.keys(c).length !== 4) return false
  return Object.values(GRID_VARIANTS).some(
    (g) => g.left === c.left && g.right === c.right && g.top === c.top && g.bottom === c.bottom,
  )
}

/** Compact money ticks ($1.2K, $1.45M) — THE money axis formatter (§13), passed by reference. */
export const compactMoney = (value: number): string => formatCurrencyCompact(value)
/** Whole-percent ticks (§13) — THE percent axis formatter. */
export const percentLabel = (value: number): string =>
  formatPct(value, { signed: false, decimals: 0 })

/** Money value axis. `zero: false` (scale: true) is legal only on an UNWASHED line — a fill
 *  floating on a non-zero floor misrepresents (the price chart is the one case); `log` only
 *  on unwashed forms for the same reason (a log axis has no zero to anchor a wash on). */
export function moneyAxis({ zero = true, log = false }: { zero?: boolean; log?: boolean } = {}) {
  return {
    type: log ? ('log' as const) : ('value' as const),
    ...(zero || log ? {} : { scale: true }),
    axisLabel: { formatter: compactMoney },
  }
}

/** Percent value axis with the savings-rate extents: the ceiling stays where rates stop
 *  being possible, the floor expands to the data in whole −100% steps (2026-08-31 A7). */
export function pctAxis({ floor = -1, ceiling = 1 }: { floor?: number; ceiling?: number } = {}) {
  return {
    type: 'value' as const,
    min: (extent: { min: number }) => Math.min(floor, Math.floor(extent.min)),
    max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), ceiling),
    axisLabel: { formatter: percentLabel },
  }
}

/** Category axis of month (or date) labels. Lines touch the card edges (`boundaryGap:
 *  false`, the default); bars pass `gap: true` and keep echarts' default gap — the key is
 *  omitted so today's bar options stay byte-identical. Twelve categories or fewer label
 *  every one (a year of months must not skip alternate labels). */
export function monthAxis(
  labels: string[],
  { gap = false, rotate }: { gap?: boolean; rotate?: number } = {},
) {
  const axisLabel = {
    ...(labels.length <= 12 ? { interval: 0 } : {}),
    ...(rotate === undefined ? {} : { rotate }),
  }
  return {
    type: 'category' as const,
    data: labels,
    ...(gap ? {} : { boundaryGap: false }),
    ...(Object.keys(axisLabel).length > 0 ? { axisLabel } : {}),
  }
}

/** Daily-date categories read exactly like months: no gap, every label under 13 points. */
export const dateAxis = (labels: string[]) => monthAxis(labels)

/** Every bar: the surface hairline that separates stack segments (and insets a lone bar so
 *  it reads as the same family), the 22px cap, INK on hover, and series focus (§9). */
export const BAR_MARKS = {
  barMaxWidth: 22,
  itemStyle: { borderColor: SURFACE, borderWidth: 1 },
  emphasis: { focus: 'series' as const, itemStyle: { borderColor: INK } },
}

/** A direct label on a bar's cap (the waterfall's amounts, the tax trend's rate — F15). */
export function capLabel(formatter: (params: { dataIndex: number }) => string) {
  return { show: true as const, position: 'top' as const, color: MUTED, fontSize: 11, formatter }
}

/** Every data line: 2px, no symbols, series focus (§9). Spread first, then name/color/data. */
export const LINE = {
  type: 'line' as const,
  symbol: 'none' as const,
  lineStyle: { width: 2 },
  emphasis: { focus: 'series' as const },
}

/** The house visible-axis wash under a primary line (net-worth trend, portfolio value). */
export const WASH = { areaStyle: { opacity: 0.12 } }
/** A stacked-area member: hairline stroke, half-opaque fill (the net-worth stack). */
export const STACK_WASH = { lineStyle: { width: 1 }, areaStyle: { opacity: 0.5 } }

/** Display-only rounding for DERIVED chart geometry — a stack segment, a running remainder,
 *  a rate × 100. Float arithmetic on the server's cent-quantized strings leaves dust
 *  (601854.46 − 188930 = 412924.45999999996), and dust must never reach an axis label or a
 *  tooltip. Never applied to a reported figure: those are rendered as they arrived. */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
export const cents = (value: number): number => roundTo(value, 2)

/** Per-series entrance delay for stacked bars (§11): 12ms × series index. A FUNCTION so it
 *  is invisible to EChart's JSON fingerprint — the zoom fast path must not see a changed
 *  option when only the delay closure is fresh. */
export function stagger(seriesIndex: number) {
  return { animationDelay: () => seriesIndex * 12 }
}
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/charts/grammar.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 4: Commit**

```bash
git add src/charts/grammar.ts src/charts/grammar.test.ts
git commit -m "feat(charts): grammar.ts — grid variants, money/percent/month axes, bar and line marks, rounding, stagger (spec §8, §13)"
```

---

### Task 5: `tooltip.ts` — the one tooltip contract, plus the test parser and the sankey brand

**Files:**
- Create: `src/charts/tooltip.ts`, `src/testing/tooltipRows.ts`
- Modify: `src/charts/sankey.ts`, `src/charts/sankey.test.ts`
- Test: `src/charts/tooltip.test.ts`

Spec §7. Row order is the contract: **bold axis header → group rows sorted valueDesc → bold Total → other data series in series order → reference rows (muted) → annotation lines → footer lines**. Swatches are CSS custom properties resolved from the series color (`recolor.ts` cannot reach formatter output, so `var(--chart-N)` follows the theme for free). Lanes assert STRUCTURE through `tooltipRows()` rather than HTML bytes.

- [ ] **Step 1: Write the failing tests**

```ts
// src/charts/tooltip.test.ts
import { describe, expect, it } from 'vitest'
import { tooltipRows } from '../testing/tooltipRows'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE } from './theme'
import { axisTooltip, brandTooltip, isGrammarTooltip, itemTooltip, swatch } from './tooltip'

const P = (over: Record<string, unknown>) => ({ seriesType: 'bar', color: PALETTE[0], ...over })

describe('axisTooltip row order', () => {
  it('header, groups by value desc, Total, other data, references, annotations, footer', () => {
    const { formatter } = axisTooltip({
      unit: 'money',
      groups: ['Rent', 'Food', 'Other'],
      shareOf: true,
      references: ['Sustainable spend'],
      annotationSeries: ['Notes'],
      annotations: (p) => [`note: ${String((p.data as { note?: string }).note)}`],
      footer: (index) => [`index ${index}`],
    })
    const html = formatter([
      P({ seriesName: 'Food', axisValueLabel: 'Jun 2026', dataIndex: 3, value: 300 }),
      P({ seriesName: 'Rent', value: 1500 }),
      P({ seriesName: 'Other', value: 200, color: OTHER_SERIES_COLOR }),
      P({ seriesName: 'Net pay', seriesType: 'line', value: 6000, color: INK }),
      P({ seriesName: 'Sustainable spend', seriesType: 'line', value: 4100.5, color: MUTED }),
      P({ seriesName: 'Notes', seriesType: 'scatter', value: ['Jun 2026', 6000], data: { note: 'moved' } }),
    ])
    const parsed = tooltipRows(html)
    expect(parsed.head).toBe('Jun 2026')
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Rent', '$1,500.00 (75.0%)'],
      ['row', 'Food', '$300.00 (15.0%)'],
      ['row', 'Other', '$200.00 (10.0%)'],
      ['total', 'Total', '$2,000.00'],
      ['row', 'Net pay', '$6,000.00'],
      ['ref', 'Sustainable spend', '$4,100.50'],
    ])
    expect(parsed.notes).toEqual(['note: moved'])
    expect(parsed.foot).toEqual(['index 3'])
  })

  it('drops null/NaN rows (never dashes), prints absentText once when no group row is finite, and totals only real rows', () => {
    const { formatter } = axisTooltip({ groups: ['Rent'], absentText: 'no spending entered' })
    const parsed = tooltipRows(
      formatter([
        P({ seriesName: 'Rent', axisValueLabel: 'Aug 2026', value: null }),
        P({ seriesName: 'Net pay', seriesType: 'line', value: 6000 }),
      ]),
    )
    expect(parsed.rows.map((r) => r.label)).toEqual(['Net pay'])
    expect(parsed.notes).toEqual(['no spending entered'])
    expect(formatter([P({ seriesName: 'Rent', value: Number.NaN })])).toContain('no spending entered')
    // Nothing finite, no absent text → no tooltip at all.
    expect(axisTooltip().formatter([P({ seriesName: 'Rent', value: null })])).toBe('')
    expect(axisTooltip().formatter([])).toBe('')
  })

  it('escapes every series name, the header and suffixes unconditionally', () => {
    const { formatter } = axisTooltip({ rowSuffix: () => '<est.>' })
    const html = formatter([P({ seriesName: '<b>Fun</b>', axisValueLabel: '<i>Jun</i>', value: 1 })])
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;Fun&lt;/b&gt; &lt;est.&gt;')
    expect(tooltipRows(html).head).toBe('&lt;i&gt;Jun&lt;/i&gt;')
  })

  it('formats by unit and can drop the Total row', () => {
    expect(tooltipRows(axisTooltip({ unit: 'percent' }).formatter([P({ seriesName: 'Savings', value: 0.35 })])).rows[0].value).toBe('35.0%')
    expect(tooltipRows(axisTooltip({ unit: 'shares' }).formatter([P({ seriesName: 'Vest', value: 1822 })])).rows[0].value).toBe('1,822')
    const noTotal = axisTooltip({ groups: ['Base', 'Equity'], totalLabel: false }).formatter([
      P({ seriesName: 'Base', value: 100 }),
      P({ seriesName: 'Equity', value: 50 }),
    ])
    expect(tooltipRows(noTotal).rows.map((r) => r.kind)).toEqual(['row', 'row'])
  })

  it('paints swatches with CSS variables, a 10×2 stroke for lines and an 8×8 square for bars/stack members', () => {
    const html = axisTooltip({ groups: ['Cash'] }).formatter([
      P({ seriesName: 'Cash', seriesType: 'line', color: PALETTE[0], value: 1 }),
      P({ seriesName: 'Net worth', seriesType: 'line', color: INK, value: 2 }),
    ])
    expect(html).toContain('<i class="chart-tip-swatch" style="background:var(--chart-1)"></i>')
    expect(html).toContain('<i class="chart-tip-swatch is-line" style="background:var(--text)"></i>')
  })

  it('carries the shadow pointer only when asked, and the class always', () => {
    expect(axisTooltip({ pointer: 'shadow' })).toMatchObject({ trigger: 'axis', className: 'chart-tip', axisPointer: { type: 'shadow' } })
    expect('axisPointer' in axisTooltip()).toBe(false)
    expect(isGrammarTooltip(axisTooltip().formatter)).toBe(true)
    expect(isGrammarTooltip(() => '')).toBe(false)
    const own = brandTooltip(() => 'x')
    expect(isGrammarTooltip(own)).toBe(true)
  })
})

describe('swatch', () => {
  it('maps token hexes to variables, falls back to the hex, and washes on request', () => {
    expect(swatch(PALETTE[3])).toContain('var(--chart-4)')
    expect(swatch(OTHER_SERIES_COLOR)).toContain('var(--other-series)')
    expect(swatch(SEQUENTIAL_BLUE[9])).toContain(`background:${SEQUENTIAL_BLUE[9]}`)
    expect(swatch(PALETTE[0], { wash: true })).toContain('is-wash')
    expect(swatch(undefined)).toContain('var(--muted)') // an unknown color can never inject
    expect(swatch('javascript:alert(1)')).toContain('var(--muted)')
  })
})

describe('itemTooltip', () => {
  it('lays the value first, then the escaped label and sub; null body → no tooltip', () => {
    const { formatter, trigger } = itemTooltip<{ name?: string; value?: number }>({
      body: (p) => (p.name ? { value: p.value ?? 0, label: p.name, sub: '75.0% of tax' } : null),
    })
    expect(trigger).toBe('item')
    const parsed = tooltipRows(formatter({ name: '<b>x</b>', value: 3000 }))
    expect(parsed.lead).toBe('$3,000.00')
    expect(parsed.label).toBe('&lt;b&gt;x&lt;/b&gt;')
    expect(parsed.sub).toBe('75.0% of tax')
    expect(formatter({ name: '' })).toBe('')
    expect(formatter([{ name: 'a', value: 1 }])).toContain('$1.00') // echarts may hand an array
    // A pre-formatted string value passes through (escaped), for "56.0% of tax"-style leads.
    const pct = itemTooltip<{ v: string }>({ body: (p) => ({ value: p.v, label: 'Federal' }) })
    expect(tooltipRows(pct.formatter({ v: '56.0%' })).lead).toBe('56.0%')
    expect(isGrammarTooltip(pct.formatter)).toBe(true)
  })
})
```

Add to `src/charts/sankey.test.ts`:

```ts
import { isGrammarTooltip } from './tooltip'
import { sankeyCsv } from './sankey'

describe('sankey grammar conformance', () => {
  it('brands its formatter and exports nodes + links as one table', () => {
    const nodes = [{ name: 'Net pay', value: 6000, itemStyle: { color: '#000000' } }]
    const links = [{ source: 'Net pay', target: 'Rent', value: 2000 }]
    expect(isGrammarTooltip(makeSankeyTooltipFormatter(nodes, links))).toBe(true)
    expect(sankeyCsv(nodes, links)).toEqual({
      headers: ['Kind', 'Source', 'Target', 'Value'],
      rows: [
        ['node', 'Net pay', '', '6000.00'],
        ['link', 'Net pay', 'Rent', '2000.00'],
      ],
    })
  })
})
```

Run: `npx vitest run src/charts/tooltip.test.ts src/charts/sankey.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 2: Write the test parser**

```ts
// src/testing/tooltipRows.ts
// Test-only reader of the grammar tooltip markup (charts/tooltip.ts). Builder tests assert
// the ROW CONTRACT — order, labels, values, kinds — not HTML bytes, so a markup tweak in
// tooltip.ts is one edit here rather than thirty pinned strings.
export interface TooltipRow {
  label: string
  value: string
  kind: 'row' | 'total' | 'ref'
}

export interface ParsedTooltip {
  head: string
  rows: TooltipRow[]
  notes: string[]
  foot: string[]
  /** itemTooltip's value-first layout. */
  lead?: string
  label?: string
  sub?: string
}

const ROW = /<div class="chart-tip-row( chart-tip-total| chart-tip-ref)?">.*?<span class="chart-tip-label">(.*?)<\/span><span class="chart-tip-value">(.*?)<\/span><\/div>/g
const block = (html: string, cls: string): string[] =>
  [...html.matchAll(new RegExp(`<div class="${cls}">(.*?)</div>`, 'g'))].map((m) => m[1])

export function tooltipRows(html: string): ParsedTooltip {
  const rows: TooltipRow[] = [...html.matchAll(ROW)].map((m) => ({
    kind: m[1] === ' chart-tip-total' ? 'total' : m[1] === ' chart-tip-ref' ? 'ref' : 'row',
    label: m[2],
    value: m[3],
  }))
  return {
    head: block(html, 'chart-tip-head')[0] ?? '',
    rows,
    notes: block(html, 'chart-tip-note'),
    foot: block(html, 'chart-tip-foot'),
    lead: block(html, 'chart-tip-lead')[0],
    label: rows.length === 0 ? block(html, 'chart-tip-label')[0] : undefined,
    sub: block(html, 'chart-tip-sub')[0],
  }
}
```

(`chart-tip-label` is a `<span>` inside axis rows and a `<div>` in the item layout, so the regex above only matches the item form when no rows exist.)

- [ ] **Step 3: Write the module**

```ts
// src/charts/tooltip.ts
// THE tooltip contract (chart spec §7). axisTooltip() and itemTooltip() return complete
// `tooltip` components with one branded formatter each; conformance.ts refuses any option
// whose formatter is not branded here or in sankey.ts. Row order is the contract — see
// axisTooltip. Colors in the markup are CSS custom properties resolved from the series
// color, because recolor.ts cannot reach a formatter's output and `var(--chart-N)` follows
// the theme for free. Every series name is escaped unconditionally: category, account,
// grant and card names are user text, and the "own constants only" exemption ends here.
// Depends on: charts/theme.ts (the token hexes the swatch map keys on), utils/format.ts.
import { INK, MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from './theme'
import { escapeHtml, formatCurrency, formatPct, formatShares } from '../utils/format'

export type TooltipUnit = 'money' | 'percent' | 'shares'

/** The echarts params subset the formatters read (the runtime object carries more). */
export interface AxisTooltipParam {
  seriesName?: string
  seriesType?: string
  marker?: string
  axisValueLabel?: string
  dataIndex?: number
  value?: unknown
  data?: unknown
  color?: unknown
}

export interface AxisTooltipOptions {
  /** Picks the value formatter: full currency (default), unsigned percent, shares. */
  unit?: TooltipUnit
  /** Stack members: sorted by value desc and totalled. */
  groups?: readonly string[]
  /** The Total row's label; `false` drops the row (a chart whose line IS the total). */
  totalLabel?: string | false
  /** Append "(xx.x%)" of the group total to every group row. */
  shareOf?: boolean
  /** Comparison series (budgets, sustainable spend, averages): listed after the total,
   *  muted, never summed. */
  references?: readonly string[]
  /** Marker series (Notes, Events) routed to `annotations` instead of a value row. */
  annotationSeries?: readonly string[]
  /** Returns ESCAPED lines for one annotation param (the caller escapes its own text). */
  annotations?: (param: AxisTooltipParam) => string[]
  /** Appended to a row's label (" (est.)"); escaped here. */
  rowSuffix?: (param: AxisTooltipParam) => string | null
  /** ESCAPED lines under everything, keyed by the hovered index (band ranges, a rate). */
  footer?: (dataIndex: number, params: AxisTooltipParam[]) => string[]
  /** Printed once when `groups` is set and no group row is finite (an absent month). */
  absentText?: string
  /** Bars pass 'shadow'; lines keep echarts' default rule (the key is omitted). */
  pointer?: 'line' | 'shadow'
}

// Branding is a WeakSet, not a property: a property would survive a `{ ...formatter }`
// copy that is no longer the function, and it would show up in JSON fingerprints.
const BRAND = new WeakSet<object>()

/** Marks a formatter as grammar-conformant (sankey.ts brands its own factory this way). */
export function brandTooltip<F extends (params: unknown) => string>(formatter: F): F {
  BRAND.add(formatter)
  return formatter
}

export function isGrammarTooltip(formatter: unknown): boolean {
  return typeof formatter === 'function' && BRAND.has(formatter)
}

// Token hex → CSS variable. Sequential/diverging steps have no variable and fall back to
// the hex (they stay dark under the light theme — a documented cost, spec §7).
const CSS_VARS: ReadonlyMap<string, string> = new Map<string, string>([
  ...PALETTE.map((hex, i) => [hex.toLowerCase(), `var(--chart-${i + 1})`] as [string, string]),
  [OTHER_SERIES_COLOR.toLowerCase(), 'var(--other-series)'],
  [INK.toLowerCase(), 'var(--text)'],
  [MUTED.toLowerCase(), 'var(--muted)'],
  [POSITIVE.toLowerCase(), 'var(--positive)'],
  [NEGATIVE.toLowerCase(), 'var(--negative)'],
])
const HEX6 = /^#[0-9a-f]{6}$/i

/** The swatch cell: `square` (8×8) for bars, areas and stack members, `line` (10×2) for
 *  data lines; `wash` paints it at fill strength (the projection's band rows). Anything
 *  that is not a token or a plain hex paints MUTED — a color string never reaches the
 *  style attribute unvalidated. */
export function swatch(
  color: unknown,
  { shape = 'square', wash = false }: { shape?: 'square' | 'line'; wash?: boolean } = {},
): string {
  const hex = typeof color === 'string' ? color : ''
  const paint = CSS_VARS.get(hex.toLowerCase()) ?? (HEX6.test(hex) ? hex : 'var(--muted)')
  const classes = ['chart-tip-swatch', shape === 'line' ? 'is-line' : '', wash ? 'is-wash' : '']
    .filter(Boolean)
    .join(' ')
  return `<i class="${classes}" style="background:${paint}"></i>`
}

export function formatUnit(unit: TooltipUnit, value: number): string {
  if (unit === 'percent') return formatPct(value, { signed: false })
  if (unit === 'shares') return formatShares(value)
  return formatCurrency(value)
}

// Line rows carry plain numbers (null on a padded category); scatter markers carry a
// [category, y] pair. Non-finite → the row is dropped (§7: never dashed).
function finiteValue(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[1] : value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

const BLANK_SWATCH = '<i class="chart-tip-swatch is-blank"></i>'

function row(label: string, value: string, sw: string, kind = ''): string {
  return (
    `<div class="chart-tip-row${kind}">${sw}` +
    `<span class="chart-tip-label">${label}</span>` +
    `<span class="chart-tip-value">${value}</span></div>`
  )
}

interface Valued {
  p: AxisTooltipParam
  v: number
}

/** A complete axis tooltip: header → groups (valueDesc) → Total → other data (series
 *  order) → references → annotations → footer. */
export function axisTooltip(options: AxisTooltipOptions = {}) {
  const {
    unit = 'money',
    groups = [],
    totalLabel = 'Total',
    shareOf = false,
    references = [],
    annotationSeries = [],
    annotations,
    rowSuffix,
    footer,
    absentText,
    pointer = 'line',
  } = options
  const groupSet = new Set(groups)
  const refSet = new Set(references)
  const noteSet = new Set(annotationSeries)
  const nameOf = (p: AxisTooltipParam) => p.seriesName ?? ''
  const valued = (p: AxisTooltipParam): Valued[] => {
    const v = finiteValue(p.value)
    return v === null ? [] : [{ p, v }]
  }

  const formatter = brandTooltip((params: unknown): string => {
    const list = (Array.isArray(params) ? params : [params]).filter(Boolean) as AxisTooltipParam[]
    if (list.length === 0) return ''
    const head = list.find((p) => p.axisValueLabel)?.axisValueLabel ?? ''
    const groupRows = list.filter((p) => groupSet.has(nameOf(p))).flatMap(valued)
    groupRows.sort((a, b) => b.v - a.v)
    const total = groupRows.reduce((sum, r) => sum + r.v, 0)
    const dataRows = list
      .filter((p) => !groupSet.has(nameOf(p)) && !refSet.has(nameOf(p)) && !noteSet.has(nameOf(p)))
      .flatMap(valued)
    const refRows = list.filter((p) => refSet.has(nameOf(p))).flatMap(valued)
    const noteLines = annotations ? list.filter((p) => noteSet.has(nameOf(p))).flatMap(annotations) : []
    const index = list.find((p) => typeof p.dataIndex === 'number')?.dataIndex
    const footLines = footer !== undefined && typeof index === 'number' ? footer(index, list) : []
    const absent = groups.length > 0 && groupRows.length === 0 && absentText !== undefined
    if (
      groupRows.length + dataRows.length + refRows.length + noteLines.length + footLines.length === 0 &&
      !absent
    ) {
      return ''
    }

    const label = (p: AxisTooltipParam) => {
      const suffix = rowSuffix?.(p)
      return escapeHtml(nameOf(p)) + (suffix ? ` ${escapeHtml(suffix)}` : '')
    }
    const cell = (v: number, share: boolean) =>
      formatUnit(unit, v) + (share && shareOf && total > 0 ? ` (${((v / total) * 100).toFixed(1)}%)` : '')
    const sw = (p: AxisTooltipParam) =>
      swatch(p.color, { shape: p.seriesType === 'line' && !groupSet.has(nameOf(p)) ? 'line' : 'square' })

    const parts = [`<div class="chart-tip-head">${escapeHtml(head)}</div>`]
    for (const { p, v } of groupRows) parts.push(row(label(p), cell(v, true), sw(p)))
    if (groupRows.length > 0 && totalLabel !== false) {
      parts.push(row(escapeHtml(totalLabel), formatUnit(unit, total), BLANK_SWATCH, ' chart-tip-total'))
    }
    if (absent) parts.push(`<div class="chart-tip-note">${escapeHtml(absentText)}</div>`)
    for (const { p, v } of dataRows) parts.push(row(label(p), cell(v, false), sw(p)))
    for (const { p, v } of refRows) parts.push(row(label(p), cell(v, false), sw(p), ' chart-tip-ref'))
    for (const line of noteLines) parts.push(`<div class="chart-tip-note">${line}</div>`)
    for (const line of footLines) parts.push(`<div class="chart-tip-foot">${line}</div>`)
    return parts.join('')
  })

  return {
    trigger: 'axis' as const,
    className: 'chart-tip',
    ...(pointer === 'shadow' ? { axisPointer: { type: 'shadow' as const } } : {}),
    formatter,
  }
}

export interface ItemTooltipBody {
  /** A number is formatted by `unit`; a string is a pre-formatted lead ("56.0% of tax"). */
  value: number | string
  label: string
  sub?: string
}

/** Pies, treemaps, heatmaps, waterfalls, ladders: value first, then the label, then a
 *  sub-line. `body` returns null for hovers that are not data (a treemap's root). */
export function itemTooltip<P = unknown>({
  unit = 'money',
  body,
}: {
  unit?: TooltipUnit
  body: (param: P) => ItemTooltipBody | null
}) {
  const formatter = brandTooltip((params: unknown): string => {
    const p = (Array.isArray(params) ? params[0] : params) as P | null | undefined
    if (p === null || p === undefined) return ''
    const b = body(p)
    if (b === null) return ''
    const lead = typeof b.value === 'number' ? formatUnit(unit, b.value) : escapeHtml(b.value)
    return (
      `<div class="chart-tip-lead">${lead}</div>` +
      `<div class="chart-tip-label">${escapeHtml(b.label)}</div>` +
      (b.sub !== undefined ? `<div class="chart-tip-sub">${escapeHtml(b.sub)}</div>` : '')
    )
  })
  return { trigger: 'item' as const, className: 'chart-tip', formatter }
}
```

- [ ] **Step 4: Brand the sankey factory and add `sankeyCsv`**

In `src/charts/sankey.ts`: import `brandTooltip` from `./tooltip` and `type { ExportTable } from '../utils/download'`; wrap the returned function:

```ts
export function makeSankeyTooltipFormatter(
  nodes: SankeyNode[],
  links: SankeyLink[],
): (params: unknown) => string {
  const nodeValue = new Map(nodes.map((node) => [node.name, node.value]))
  const linkValue = new Map(
    links.map((link) => [`${link.source} ${link.target}`, link.value]),
  )
  // Branded (charts/tooltip.ts): this factory already conforms to §7 — value first, name
  // second, escaped — so conformance accepts it alongside axisTooltip/itemTooltip.
  return brandTooltip((params: unknown): string => {
    // … body unchanged …
  })
}

/** The flow as a table (F12 "sankeys (nodes + links)"): every node with the PAGE's own
 *  figure, then every link — the same figures the tooltip echoes. */
export function sankeyCsv(nodes: SankeyNode[], links: SankeyLink[]): ExportTable {
  return {
    headers: ['Kind', 'Source', 'Target', 'Value'],
    rows: [
      ...nodes.map((node) => ['node', node.name, '', node.value.toFixed(2)]),
      ...links.map((link) => ['link', link.source, link.target, link.value.toFixed(2)]),
    ],
  }
}
```

Run: `npx vitest run src/charts/tooltip.test.ts src/charts/sankey.test.ts src/components/overview/moneyFlowOptions.test.ts src/components/spending/spendingSankeyOptions.test.ts src/components/paycheck/paycheckSankeyOptions.test.ts`
Expected: PASS (the three sankey builders' tests still pass — output bytes are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/charts/tooltip.ts src/charts/tooltip.test.ts src/testing/tooltipRows.ts src/charts/sankey.ts src/charts/sankey.test.ts
git commit -m "feat(charts): tooltip.ts — axisTooltip/itemTooltip contract with CSS-variable swatches and a brand; sankey factory branded + sankeyCsv (spec §7, F12)"
```

---

### Task 6: `legend.ts` and `reference.ts`

**Files:**
- Create: `src/charts/legend.ts`, `src/charts/reference.ts`
- Test: `src/charts/legend.test.ts`, `src/charts/reference.test.ts`

Spec §9 (one legend rule: scroll past 8, persisted picks, series focus) and §10 (reference series = a comparison with its own data: dashed MUTED 2 px, `symbol: 'none'`, `z: 9`, optional `step: 'end'`). `referenceLine` is byte-for-byte the 4%-rule series and, with `step`, `budgetStepSeries` — the second test pins that against the old module so the absorption is provable.

- [ ] **Step 1: Write the failing tests**

```ts
// src/charts/legend.test.ts
import { describe, expect, it } from 'vitest'
import { FOCUS, legendFor } from './legend'
import { MUTED } from './theme'

describe('legendFor', () => {
  it('is plain up to eight entries and scrolls past them, muted pager either way', () => {
    expect(legendFor(8)).toEqual({ top: 0, type: 'plain', pageIconColor: MUTED, pageTextStyle: { color: MUTED } })
    expect(legendFor(9).type).toBe('scroll')
  })
  it('carries the page's persisted picks when given, and no key when not', () => {
    expect(legendFor(3, { 'Total budget': false }).selected).toEqual({ 'Total budget': false })
    expect('selected' in legendFor(3)).toBe(false)
  })
  it('FOCUS is the series-focus emphasis every multi-series line/bar spreads', () => {
    expect(FOCUS).toEqual({ emphasis: { focus: 'series' } })
  })
})
```

```ts
// src/charts/reference.test.ts
import { describe, expect, it } from 'vitest'
import { budgetStepSeries } from '../components/spending/budgetChartOptions'
import { budgetReference, referenceLine } from './reference'
import { MUTED } from './theme'

describe('referenceLine', () => {
  it('is the 4%-rule series exactly: dashed MUTED 2px, no symbols, z 9, gaps kept', () => {
    expect(referenceLine('Sustainable spend', [1, null, 3], { id: 'sustainable-spend' })).toEqual({
      id: 'sustainable-spend',
      name: 'Sustainable spend',
      type: 'line',
      symbol: 'none',
      lineStyle: { width: 2, type: 'dashed' },
      color: MUTED,
      z: 9,
      connectNulls: false,
      data: [1, null, 3],
    })
    expect('id' in referenceLine('x', [])).toBe(false)
    expect('step' in referenceLine('x', [])).toBe(false)
  })
  it('budgetReference absorbs budgetStepSeries byte for byte', () => {
    expect(budgetReference('Food budget', ['400.00', null, '350.00'])).toEqual(
      budgetStepSeries('Food budget', ['400.00', null, '350.00']),
    )
  })
})
```

Run: `npx vitest run src/charts/legend.test.ts src/charts/reference.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 2: Write the modules**

```ts
// src/charts/legend.ts
// The one legend rule (chart spec §9). Every multi-series card: top: 0, scroll past eight
// entries (so the grid.top: 40 collision is structurally gone — a scroll legend never
// wraps), the page's mirrored picks fed back through `selected`, a muted pager. Builders
// that list `data` explicitly (the projection) spread this and add `data`.
// Depends on: charts/theme.ts (MUTED).
import { MUTED } from './theme'

/** Spread onto every multi-series line/bar series: hovering one dims the rest. */
export const FOCUS = { emphasis: { focus: 'series' as const } }

export function legendFor(count: number, selected?: Record<string, boolean>) {
  return {
    top: 0,
    type: count > 8 ? ('scroll' as const) : ('plain' as const),
    ...(selected === undefined ? {} : { selected }),
    pageIconColor: MUTED,
    pageTextStyle: { color: MUTED },
  }
}
```

```ts
// src/charts/reference.ts
// Reference SERIES (chart spec §10): a comparison with its own data — the sustainable-spend
// line, budgets, the FI target, averages. Dashed MUTED 2px, no symbols, above the data
// (z 9), gaps kept. Dashed is reserved for thresholds and events; data is solid.
// Absorbs spending/budgetChartOptions.budgetStepSeries (`budgetReference`).
// Depends on: charts/theme.ts (MUTED).
import { MUTED } from './theme'

export function referenceLine(
  name: string,
  data: (number | null)[],
  { step, id }: { step?: 'end'; id?: string } = {},
) {
  return {
    ...(id === undefined ? {} : { id }),
    name,
    type: 'line' as const,
    symbol: 'none' as const,
    // Budgets change discretely — steps, not slopes: each point already carries its month's
    // RESOLVED value, so the line holds level and jumps at the month a new row lands.
    ...(step === undefined ? {} : { step }),
    lineStyle: { width: 2, type: 'dashed' as const },
    color: MUTED,
    z: 9,
    connectNulls: false,
    data,
  }
}

/** A budget series over the matrix's resolved per-month strings; null = unbudgeted. */
export function budgetReference(name: string, budgets: (string | null)[]) {
  return referenceLine(
    name,
    budgets.map((v) => (v === null ? null : Number(v))),
    { step: 'end', id: `budget-${name}` },
  )
}
```

Run: `npx vitest run src/charts/legend.test.ts src/charts/reference.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/charts/legend.ts src/charts/legend.test.ts src/charts/reference.ts src/charts/reference.test.ts
git commit -m "feat(charts): legendFor/FOCUS and referenceLine/budgetReference (spec §9, §10; absorbs budgetStepSeries)"
```

---

### Task 7: `markLine.ts` — annotation rules, areas, marks, baselines

**Files:**
- Modify: `src/charts/markLine.ts`, `src/charts/markLine.test.ts`

Spec §10: three vocabularies, one helper each. Annotation RULES (events on the time axis — Married, retirements, Today, FI, Coast FI) are dashed MUTED 1 px with an `insideEndTop` label, anchored by falling forward; `afterArea` is a `markArea` wash in `SURFACE_2` at 0.35; `percentileMarks` is a `markPoint` set of MUTED circles labelled `p10/p50/p90`; `zeroLine` is the solid MUTED baseline the savings-rate and card-value charts already draw. `anchorMonthLabel` becomes a wrapper over `anchorLabel` (which also anchors ISO DATES onto daily axes for the price chart's markers).

- [ ] **Step 1: Write the failing tests**

Append to `src/charts/markLine.test.ts`:

```ts
import { INK, SURFACE_2 } from './theme'
import { formatDate } from '../utils/format'
import {
  afterArea, anchorLabel, annotationRules, arrivalRule, percentileMarks, ruleAt, todayRule, zeroLine,
} from './markLine'

describe('anchorLabel', () => {
  it('anchors a date onto a DAILY axis by the same fall-forward rule, in the axis vocabulary', () => {
    const days = ['2026-08-10', '2026-08-11', '2026-08-13']
    expect(anchorLabel(days, '2026-08-11', formatDate)).toBe('Aug 11, 2026')
    expect(anchorLabel(days, '2026-08-12', formatDate)).toBe('Aug 13, 2026') // falls forward over the gap
    expect(anchorLabel(days, '2026-08-14', formatDate)).toBeUndefined()
    expect(anchorLabel(days, null, formatDate)).toBeUndefined()
  })
  it('anchorMonthLabel is the month-bucketed form of the same rule', () => {
    expect(anchorMonthLabel(MONTHS, '2026-08-14')).toBe(anchorLabel(MONTHS, '2026-08-14', formatMonth, (iso) => `${iso.slice(0, 7)}-01`))
  })
})

describe('annotation rules', () => {
  it('ruleAt yields a labelled entry; annotationRules wraps entries in the dashed-MUTED markLine and drops the unplaceable', () => {
    expect(ruleAt(MONTHS, '2026-08-01', 'FI', formatMonth, (iso) => `${iso.slice(0, 7)}-01`)).toEqual({
      xAxis: 'Aug 2026', label: { formatter: 'FI' },
    })
    expect(arrivalRule(MONTHS, '2026-07-20', 'Coast FI')).toEqual({ xAxis: 'Jul 2026', label: { formatter: 'Coast FI' } })
    expect(arrivalRule(MONTHS, null, 'FI')).toBeUndefined()
    expect(todayRule(['2026-08-20', '2026-11-18'], '2026-09-03', formatDate)).toEqual({
      xAxis: 'Nov 18, 2026', label: { formatter: 'Today' },
    })
    expect(todayRule(['2026-08-20'], '2026-09-03', formatDate)).toBeUndefined() // everything is past
    expect(annotationRules([arrivalRule(MONTHS, '2026-08-01', 'FI'), undefined])).toEqual({
      silent: true,
      symbol: 'none',
      lineStyle: { color: MUTED, width: 1, type: 'dashed' },
      label: { show: true, position: 'insideEndTop', color: MUTED, fontSize: 11 },
      data: [{ xAxis: 'Aug 2026', label: { formatter: 'FI' } }],
    })
    expect(annotationRules([undefined])).toBeUndefined()
  })
})

describe('areas, marks, baselines', () => {
  it('afterArea is a SURFACE_2 wash at 0.35 with a muted inside-top label', () => {
    expect(afterArea('Aug 2030', 'Aug 2056', 'After FI')).toEqual({
      silent: true,
      itemStyle: { color: SURFACE_2, opacity: 0.35 },
      label: { show: true, position: 'insideTop', color: MUTED, fontSize: 11, formatter: 'After FI' },
      data: [[{ xAxis: 'Aug 2030' }, { xAxis: 'Aug 2056' }]],
    })
  })
  it('percentileMarks are MUTED circles with INK borders labelled by name', () => {
    const marks = percentileMarks([{ name: 'p50', label: 'Aug 2030', value: 1500000 }])
    expect(marks).toMatchObject({
      silent: true, symbol: 'circle', symbolSize: 8,
      itemStyle: { color: MUTED, borderColor: INK, borderWidth: 1 },
      data: [{ name: 'p50', coord: ['Aug 2030', 1500000] }],
    })
    expect(marks.label.formatter({ name: 'p50' })).toBe('p50')
  })
  it('zeroLine is the solid MUTED hairline the savings-rate and card-value charts draw', () => {
    expect(zeroLine()).toEqual({
      silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }],
    })
    expect(zeroLine('x').data).toEqual([{ xAxis: 0 }])
  })
})
```

(`MONTHS`, `MUTED`, `formatMonth`, `anchorMonthLabel` are already imported/declared at the top of the file — add `formatMonth` from `'../utils/format'` if not.)

Run: `npx vitest run src/charts/markLine.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 2: Extend the module**

Replace `src/charts/markLine.ts` (the two constants are unchanged):

```ts
// src/charts/markLine.ts
// The annotation grammar (chart spec §10): the ANCHOR rule (an ISO date onto a labelled
// category axis, falling forward), the dashed-MUTED vertical RULE every event wears
// (Married, retirements, Today, FI, Coast FI), the post-event AREA wash, the percentile
// MARKS, and the solid MUTED BASELINE. One owner, because two copies of "which month does
// this land on" could only drift. Data is solid; thresholds and events are dashed; nothing
// else is. Depends on: charts/theme.ts, utils/format.ts.
import { INK, MUTED, SURFACE_2 } from './theme'
import { formatMonth } from '../utils/format'

/** Dashed, hairline, muted: the annotation/threshold vocabulary. Solid is for data. */
export const MARK_LINE_STYLE = { color: MUTED, width: 1, type: 'dashed' as const }

/** The label block a vertical rule wears (one formatter per `data` entry). */
export const MARK_LINE_LABEL = {
  show: true as const,
  position: 'insideEndTop' as const,
  color: MUTED,
  fontSize: 11,
}

const monthBucket = (iso: string) => `${iso.slice(0, 7)}-01`

/**
 * The category label an ISO value lands on, or undefined when it cannot be placed. `isos`
 * are the axis's own ISO categories (ascending; ISO strings compare lexicographically —
 * utils/months.ts's contract); `normalize` buckets the target first (months bucket to the
 * first of the month; daily axes take the date as is). If the exact category is absent
 * (a gap, quarterly granularity) the anchor falls FORWARD to the first category after it. A
 * value later than every category returns undefined — there is nothing to mark yet, and
 * clamping onto the last category would date an event to a period it is not in.
 */
export function anchorLabel(
  isos: string[],
  iso: string | null | undefined,
  format: (iso: string) => string,
  normalize: (iso: string) => string = (s) => s,
): string | undefined {
  if (!iso || isos.length === 0) return undefined
  const target = normalize(iso)
  const index = isos.findIndex((candidate) => candidate >= target)
  return index === -1 ? undefined : format(isos[index])
}

/** Months only — kept as the name the net-worth and projection builders already use. */
export function anchorMonthLabel(months: string[], iso: string | null | undefined): string | undefined {
  return anchorLabel(months, iso, formatMonth, monthBucket)
}

export interface RuleEntry {
  xAxis: string
  label: { formatter: string }
}

/** One rule's data entry, or undefined when it cannot be placed (the caller filters). */
export function ruleAt(
  isos: string[],
  iso: string | null | undefined,
  label: string,
  format: (iso: string) => string,
  normalize?: (iso: string) => string,
): RuleEntry | undefined {
  const xAxis = anchorLabel(isos, iso, format, normalize)
  return xAxis === undefined ? undefined : { xAxis, label: { formatter: label } }
}

/** "Today" on a daily/date axis (the vesting calendar): the first category on or after today. */
export const todayRule = (isos: string[], todayIso: string, format: (iso: string) => string) =>
  ruleAt(isos, todayIso, 'Today', format)

/** An arrival on the month axis (FI, Coast FI — the projection). */
export const arrivalRule = (months: string[], iso: string | null | undefined, label: string) =>
  ruleAt(months, iso, label, formatMonth, monthBucket)

/** The one `markLine` a series carries for ALL its rules (echarts allows one per series). */
export function annotationRules(entries: (RuleEntry | undefined)[]) {
  const data = entries.filter((entry): entry is RuleEntry => entry !== undefined)
  if (data.length === 0) return undefined
  return {
    silent: true as const,
    symbol: 'none' as const,
    lineStyle: { ...MARK_LINE_STYLE },
    label: { ...MARK_LINE_LABEL },
    data,
  }
}

/** The wash after an event (the projection's "After FI"): SURFACE_2 at 0.35, muted label. */
export function afterArea(fromLabel: string, toLabel: string, label: string) {
  return {
    silent: true as const,
    itemStyle: { color: SURFACE_2, opacity: 0.35 },
    label: { show: true as const, position: 'insideTop' as const, color: MUTED, fontSize: 11, formatter: label },
    data: [[{ xAxis: fromLabel }, { xAxis: toLabel }]],
  }
}

/** p10/p50/p90 arrival marks on a reference line: MUTED circles, INK border, named labels. */
export function percentileMarks(points: { name: string; label: string; value: number }[]) {
  return {
    silent: true as const,
    symbol: 'circle' as const,
    symbolSize: 8,
    itemStyle: { color: MUTED, borderColor: INK, borderWidth: 1 },
    label: {
      show: true as const,
      position: 'top' as const,
      color: MUTED,
      fontSize: 11,
      formatter: (p: { name?: string }) => p.name ?? '',
    },
    data: points.map((p) => ({ name: p.name, coord: [p.label, p.value] as [string, number] })),
  }
}

/** The baseline: a solid MUTED hairline at zero on the named axis. */
export function zeroLine(axis: 'x' | 'y' = 'y') {
  return {
    silent: true as const,
    symbol: 'none' as const,
    lineStyle: { color: MUTED, width: 1, type: 'solid' as const },
    label: { show: false as const },
    data: [axis === 'y' ? { yAxis: 0 } : { xAxis: 0 }],
  }
}
```

Run: `npx vitest run src/charts/markLine.test.ts src/components/networth/netWorthChartOptions.test.ts src/components/projection/projectionChartOptions.test.ts`
Expected: PASS (the two builders' marriage/retirement pins are unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/charts/markLine.ts src/charts/markLine.test.ts
git commit -m "feat(charts): markLine.ts — anchorLabel, annotationRules/todayRule/arrivalRule, afterArea, percentileMarks, zeroLine (spec §10)"
```

---

### Task 8: `scales.ts` — sequential and diverging visual maps, row normalisation, vs-average

**Files:**
- Create: `src/charts/scales.ts`
- Test: `src/charts/scales.test.ts`

Spec §12 sequential/diverging + F1's two transforms. `sequentialVisualMap` is byte-for-byte the heatmap's current `visualMap` (plus an optional `text` pair); `divergingVisualMap` is the only consumer API for `DIVERGING`. Which arm carries the HIGH end is a parameter: the spending heatmap wants orange = above average, the heat-treemap wants blue = gain.

- [ ] **Step 1: Write the failing test**

```ts
// src/charts/scales.test.ts
import { describe, expect, it } from 'vitest'
import { divergingVisualMap, rowNormalize, sequentialVisualMap, vsAverage } from './scales'
import { DIVERGING, MUTED, SEQUENTIAL_BLUE } from './theme'
import { formatCurrencyCompact } from '../utils/format'

describe('sequentialVisualMap', () => {
  it('is the heatmap literal: horizontal bar under the grid, the blue ramp, muted text', () => {
    const vm = sequentialVisualMap({ min: 0, max: 900, formatter: formatCurrencyCompact })
    expect(vm).toMatchObject({
      min: 0, max: 900, calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: [...SEQUENTIAL_BLUE] }, textStyle: { color: MUTED },
    })
    expect(vm.formatter(1500)).toBe('$1.5K')
    expect('text' in vm).toBe(false)
    expect(sequentialVisualMap({ min: 0, max: 1, formatter: String, labels: ['row max', '0'] }).text).toEqual(['row max', '0'])
  })
})

describe('divergingVisualMap', () => {
  it('spans symmetrically around the centre; blue carries the high end by default, orange on request', () => {
    const blueHigh = divergingVisualMap({ span: 0.5, formatter: String })
    expect(blueHigh).toMatchObject({ type: 'continuous', min: -0.5, max: 0.5, inRange: { color: [...DIVERGING] } })
    const orangeHigh = divergingVisualMap({ span: 1, center: 0, formatter: String, highArm: 'orange', labels: ['above', 'below'] })
    expect(orangeHigh.inRange.color).toEqual([...DIVERGING].reverse())
    expect(orangeHigh.text).toEqual(['above', 'below'])
    expect(divergingVisualMap({ span: 2, center: 10, formatter: String })).toMatchObject({ min: 8, max: 12 })
  })
})

describe('rowNormalize', () => {
  it('scales each row to its own 0 → max, keeps nulls, and zeroes an all-zero row', () => {
    expect(rowNormalize([[100, 50, null, 0], [0, 0, 0, 0], [null, 8]])).toEqual([
      [1, 0.5, null, 0],
      [0, 0, 0, 0],
      [null, 1],
    ])
  })
})

describe('vsAverage', () => {
  it('is the ratio to the trailing mean of prior non-null months, blank until six prior months exist', () => {
    const row = [100, 100, 100, 100, 100, 100, 150, null, 50]
    const out = vsAverage([row])[0]
    expect(out.slice(0, 6)).toEqual([null, null, null, null, null, null]) // fewer than six priors
    expect(out[6]).toBeCloseTo(0.5, 6) // 150 vs mean 100
    expect(out[7]).toBeNull() // the month itself is absent
    // Index 8: priors are the 12 before it minus the null = seven values, mean (600+150)/7.
    expect(out[8]).toBeCloseTo(50 / (750 / 7) - 1, 6)
  })
  it('honours the window and the minimum, and blanks a zero mean', () => {
    expect(vsAverage([[5, 5, 10]], { window: 2, minPrior: 2 })[0]).toEqual([null, null, 1])
    expect(vsAverage([[0, 0, 5]], { window: 2, minPrior: 2 })[0]).toEqual([null, null, null])
  })
})
```

Run: `npx vitest run src/charts/scales.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: Write the module**

```ts
// src/charts/scales.ts
// Continuous colour scales (chart spec §12) and the two heatmap transforms behind F1.
// `sequentialVisualMap` is the spending heatmap's current visualMap verbatim; the diverging
// map is the ONLY reader of the DIVERGING tuple. Both return plain literals — recolor.ts maps
// the `inRange.color` arrays by position under the light theme (the ramp rule), whichever way
// round they are. Depends on: charts/theme.ts.
import { DIVERGING, MUTED, SEQUENTIAL_BLUE } from './theme'

const BAR = {
  calculable: false,
  orient: 'horizontal' as const,
  left: 'center' as const,
  bottom: 0,
  textStyle: { color: MUTED },
}

export interface SequentialVisualMapInput {
  min: number
  max: number
  formatter: (value: number) => string
  /** visualMap `text` is [high, low] — the labels at the two ends of the bar. */
  labels?: [string, string]
}

export function sequentialVisualMap({ min, max, formatter, labels }: SequentialVisualMapInput) {
  return {
    min,
    max,
    ...BAR,
    inRange: { color: [...SEQUENTIAL_BLUE] },
    formatter: (value: unknown) => formatter(value as number),
    ...(labels ? { text: labels } : {}),
  }
}

export interface DivergingVisualMapInput {
  /** Half-width: the scale runs center − span … center + span. */
  span: number
  center?: number
  formatter: (value: number) => string
  labels?: [string, string]
  /** Which arm paints the HIGH end. Gains read blue (default); "above your average
   *  spend" reads orange. */
  highArm?: 'blue' | 'orange'
}

export function divergingVisualMap({
  span,
  center = 0,
  formatter,
  labels,
  highArm = 'blue',
}: DivergingVisualMapInput) {
  return {
    type: 'continuous' as const,
    min: center - span,
    max: center + span,
    ...BAR,
    inRange: { color: highArm === 'blue' ? [...DIVERGING] : [...DIVERGING].reverse() },
    formatter: (value: unknown) => formatter(value as number),
    ...(labels ? { text: labels } : {}),
  }
}

/** F1 "Row": each row on its own 0 → max scale, so a $200 category's busiest month reads as
 *  dark as a $2,000 one's. Nulls stay null (absent ≠ zero); an all-zero row stays zero. */
export function rowNormalize(rows: (number | null)[][]): (number | null)[][] {
  return rows.map((row) => {
    const max = row.reduce<number>((m, v) => (v === null ? m : Math.max(m, v)), 0)
    return row.map((v) => (v === null ? null : max > 0 ? v / max : 0))
  })
}

/** F1 "vs average": (value − mean of the prior `window` non-null months) ÷ that mean, as a
 *  ratio. Null until `minPrior` prior months exist (sparse history says nothing), null when
 *  the month itself is absent, null when the mean is zero (a ratio to nothing). */
export function vsAverage(
  rows: (number | null)[][],
  { window = 12, minPrior = 6 }: { window?: number; minPrior?: number } = {},
): (number | null)[][] {
  return rows.map((row) =>
    row.map((v, i) => {
      if (v === null) return null
      const prior = row.slice(Math.max(0, i - window), i).filter((x): x is number => x !== null)
      if (prior.length < minPrior) return null
      const mean = prior.reduce((a, b) => a + b, 0) / prior.length
      return mean > 0 ? (v - mean) / mean : null
    }),
  )
}
```

Run: `npx vitest run src/charts/scales.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/charts/scales.ts src/charts/scales.test.ts
git commit -m "feat(charts): scales.ts — sequential/diverging visual maps, rowNormalize, vsAverage (spec §12, F1)"
```

---

### Task 9: `entities.ts` and `waterfall.ts`

**Files:**
- Create: `src/charts/entities.ts`, `src/charts/waterfall.ts`
- Test: `src/charts/entities.test.ts`, `src/charts/waterfall.test.ts`

Spec §12 (categorical slots assigned by ENTITY: people primary-0/others-by-id/Joint-last lifted from `NetWorthPage`; tails fold into `OTHER_SERIES_COLOR`) and §5 (`waterfall.ts` lifted from `taxChartOptions` so the Net-worth bridge can reuse it). The waterfall tests are the tax builder's remainder pins re-expressed on the helper — C6 rewires the tax builder and its own pins keep passing.

- [ ] **Step 1: Write the failing tests**

```ts
// src/charts/entities.test.ts
import { describe, expect, it } from 'vitest'
import { foldColor, lowestFreeSlot, orderedPeople, personSlot, slotColor } from './entities'
import { GROUP_COLORS, OTHER_SERIES_COLOR, PALETTE } from './theme'

const PEOPLE = [
  { id: 7, name: 'Sam', is_primary: false },
  { id: 3, name: 'Me', is_primary: true },
  { id: 9, name: 'Kim', is_primary: false },
]

describe('personSlot', () => {
  it('primary is slot 0, others follow by id, Joint (null) is last', () => {
    expect(orderedPeople(PEOPLE).map((p) => p.name)).toEqual(['Me', 'Sam', 'Kim'])
    expect(personSlot(PEOPLE, 3)).toBe(0)
    expect(personSlot(PEOPLE, 7)).toBe(1)
    expect(personSlot(PEOPLE, 9)).toBe(2)
    expect(personSlot(PEOPLE, null)).toBe(3)
    expect(personSlot(PEOPLE, 42)).toBe(0) // unknown id: the primary's slot, never -1
  })
})

describe('slots', () => {
  it('slotColor is the palette slot and folds past eight; foldColor is the Other gray', () => {
    expect(slotColor(0)).toBe(PALETTE[0])
    expect(slotColor(7)).toBe(PALETTE[7])
    expect(slotColor(8)).toBe(OTHER_SERIES_COLOR)
    expect(foldColor).toBe(OTHER_SERIES_COLOR)
    expect(GROUP_COLORS.cash).toBe(PALETTE[0]) // re-exported unchanged
  })
  it('lowestFreeSlot hands out the first unused slot and null when all eight are taken', () => {
    expect(lowestFreeSlot([])).toBe(0)
    expect(lowestFreeSlot([0, 1, 3])).toBe(2)
    expect(lowestFreeSlot([0, 1, 2, 3, 4, 5, 6, 7])).toBeNull()
    expect(lowestFreeSlot([0, 1], 3)).toBe(2)
  })
})
```

```ts
// src/charts/waterfall.test.ts
import { describe, expect, it } from 'vitest'
import { tooltipRows } from '../testing/tooltipRows'
import { OTHER_SERIES_COLOR, POSITIVE, SEQUENTIAL_BLUE, SURFACE } from './theme'
import { isGrammarTooltip } from './tooltip'
import { waterfallCsv, waterfallSeries, waterfallSteps, waterfallTooltip } from './waterfall'

// The 2024 tax year (taxChartOptions.test's canonical table): gross, seven taxes, take-home.
const TAXES: [string, number][] = [
  ['Federal', 40782.88], ['State', 15901.12], ['Medicare', 3634.95], ['Soc. Sec.', 10453.2],
  ['SDI', 1950], ['Cap. gains', 26.87], ['NIIT', 75.59],
]
const steps = () =>
  waterfallSteps(
    { label: 'Gross', amount: 237973.17, color: OTHER_SERIES_COLOR },
    TAXES.map(([label, tax], i) => ({ label, amount: tax, delta: -tax, color: SEQUENTIAL_BLUE[4 + i] })),
    { label: 'Take-home', amount: 165148.56, color: POSITIVE },
  )

describe('waterfallSteps', () => {
  it('floats each step on the remainder LEFT after it, rounding the chain to cents', () => {
    const s = steps()
    expect(s.map((x) => x.base)).toEqual([0, 197190.29, 181289.17, 177654.22, 167201.02, 165251.02, 165224.15, 165148.56, 0])
    expect(s.map((x) => x.height)).toEqual([237973.17, 40782.88, 15901.12, 3634.95, 10453.2, 1950, 26.87, 75.59, 165148.56])
    expect(s[1].remaining).toBe(197190.29)
    expect(s[0].remaining).toBeNull()
    expect(s[8].remaining).toBeNull()
    // The chain lands on the closing amount to the cent — the caller's invariant to assert.
    expect(s[7].remaining).toBe(165148.56)
  })
  it('draws a positive delta (a credit, a gain) as a step UP from the lower remainder', () => {
    const s = waterfallSteps(
      { label: 'Start', amount: 100, color: OTHER_SERIES_COLOR },
      [{ label: 'Refund', amount: 25, delta: 25, color: POSITIVE }],
      { label: 'End', amount: 125, color: POSITIVE },
    )
    expect(s[1]).toMatchObject({ base: 100, height: 25, remaining: 125 })
  })
})

describe('waterfallSeries', () => {
  it('is the placeholder + Amount pair: stack all, silent transparent floor, 24px capped bars with direct labels', () => {
    const [placeholder, amount] = waterfallSeries(steps())
    expect(placeholder).toMatchObject({
      name: 'placeholder', type: 'bar', stack: 'waterfall', stackStrategy: 'all', silent: true,
      itemStyle: { color: 'transparent' }, tooltip: { show: false },
    })
    expect(placeholder.data).toEqual(steps().map((s) => s.base))
    expect(amount).toMatchObject({
      name: 'Amount', type: 'bar', stack: 'waterfall', stackStrategy: 'all', barMaxWidth: 24,
      itemStyle: { borderColor: SURFACE, borderWidth: 1 },
    })
    expect(amount.data[1]).toEqual({ value: 40782.88, itemStyle: { color: SEQUENTIAL_BLUE[4] } })
    expect(amount.label.formatter({ dataIndex: 1 })).toBe('$40.8K')
  })
})

describe('waterfallTooltip / waterfallCsv', () => {
  it('reads the step by index: the reported amount first, the label, what is left', () => {
    const { formatter, trigger } = waterfallTooltip(steps())
    expect(trigger).toBe('item')
    expect(isGrammarTooltip(formatter)).toBe(true)
    const federal = tooltipRows(formatter({ dataIndex: 1 }))
    expect([federal.lead, federal.label, federal.sub]).toEqual(['$40,782.88', 'Federal', 'Left: $197,190.29'])
    expect(tooltipRows(formatter({ dataIndex: 0 })).sub).toBeUndefined()
    expect(formatter({ dataIndex: 42 })).toBe('')
  })
  it('exports step, amount, remaining', () => {
    expect(waterfallCsv(steps()).headers).toEqual(['Step', 'Amount', 'Remaining'])
    expect(waterfallCsv(steps()).rows[1]).toEqual(['Federal', '40782.88', '197190.29'])
    expect(waterfallCsv(steps()).rows[8]).toEqual(['Take-home', '165148.56', ''])
  })
})
```

Run: `npx vitest run src/charts/entities.test.ts src/charts/waterfall.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 2: Write the modules**

```ts
// src/charts/entities.ts
// Entity → colour (chart spec §12): PALETTE slots are assigned by WHO or WHAT a series is,
// never by its rank in a response, and never past eight — the tail folds into the Other
// gray. Account groups already have fixed slots (GROUP_COLORS, re-exported); people take the
// household order (primary first, then by id, Joint last — lifted from NetWorthPage so the
// stack, the money-flow salary tints and any future per-person chart agree).
// Depends on: charts/theme.ts.
import { GROUP_COLORS, OTHER_SERIES_COLOR, PALETTE } from './theme'

export { GROUP_COLORS }

/** Primary first, then everyone else by id — the server's own owner_series order. */
export function orderedPeople<P extends { id: number; is_primary: boolean }>(people: readonly P[]): P[] {
  return [...people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id)
}

/** A person's palette slot; `null` (Joint) sits after every person; an unknown id takes the
 *  primary's slot rather than -1 (the page's own `Math.max(findIndex, 0)`). */
export function personSlot(
  people: readonly { id: number; is_primary: boolean }[],
  personId: number | null,
): number {
  const ordered = orderedPeople(people)
  if (personId === null) return ordered.length
  return Math.max(ordered.findIndex((p) => p.id === personId), 0)
}

/** The colour for a slot: the eight validated hues, then the fold gray — never a wrap. */
export function slotColor(slot: number): string {
  return slot < PALETTE.length ? PALETTE[slot] : OTHER_SERIES_COLOR
}

/** The gray every folded tail wears (Other categories, the ninth grant, the fourth donut slice). */
export const foldColor = OTHER_SERIES_COLOR

/** Drill/trend picks take the lowest free slot so removing one never repaints the survivors. */
export function lowestFreeSlot(used: Iterable<number>, max: number = PALETTE.length): number | null {
  const taken = new Set(used)
  for (let slot = 0; slot < max; slot += 1) if (!taken.has(slot)) return slot
  return null
}
```

```ts
// src/charts/waterfall.ts
// The invisible-placeholder waterfall (lifted from taxChartOptions, 2026-09-04): an opening
// bar on the floor, each step floating on the remainder LEFT after it, a closing bar on the
// floor. `delta` is what a step DOES to the running total (a tax is −tax), `amount` is what
// it REPORTS (the tax itself) — the tooltip and the cap label say the amount. Used by the tax
// waterfall and the net-worth "What moved" bridge. Depends on: grammar.ts, tooltip.ts, theme.ts.
import type { ExportTable } from '../utils/download'
import { formatCurrency, formatCurrencyCompact } from '../utils/format'
import { capLabel, roundTo } from './grammar'
import { INK, SURFACE } from './theme'
import { itemTooltip } from './tooltip'

export interface WaterfallEnd {
  label: string
  amount: number
  color: string
}

export interface WaterfallItem {
  label: string
  /** The signed figure the step reports. */
  amount: number
  /** The change applied to the running remainder (a tax is the negative of its amount). */
  delta: number
  color: string
}

export interface WaterfallStep {
  label: string
  amount: number
  /** Floor of the floating segment (the invisible placeholder bar). */
  base: number
  /** Height of the visible segment: |delta|, so a step in either direction draws. */
  height: number
  color: string
  /** What is left after this step; null on the two full-height end bars. */
  remaining: number | null
}

export function waterfallSteps(opening: WaterfallEnd, items: WaterfallItem[], closing: WaterfallEnd): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    { label: opening.label, amount: opening.amount, base: 0, height: opening.amount, color: opening.color, remaining: null },
  ]
  let remainder = opening.amount
  for (const item of items) {
    // The chain is float arithmetic on cent-quantized figures — each remainder lands back on
    // cents (a running remainder is chart geometry, never a reported figure).
    const after = roundTo(remainder + item.delta, 2)
    steps.push({
      label: item.label,
      amount: item.amount,
      // A step that goes UP (a credit-driven negative tax, a gain) spans [before, after]: the
      // LOWER end is the floor and |delta| the height, which reduces to "floor = remainder
      // after" for every ordinary downward step.
      base: Math.min(remainder, after),
      height: Math.abs(roundTo(item.delta, 2)),
      color: item.color,
      remaining: after,
    })
    remainder = after
  }
  // The closing bar is the CALLER's figure (the server's take-home, the month's net worth),
  // never the chain's last remainder — the chain landing on it is the caller's invariant.
  steps.push({ label: closing.label, amount: closing.amount, base: 0, height: closing.amount, color: closing.color, remaining: null })
  return steps
}

export function waterfallSeries(steps: WaterfallStep[]) {
  return [
    {
      name: 'placeholder',
      type: 'bar' as const,
      stack: 'waterfall',
      // 'all', not echarts' default 'samesign': samesign un-floats a segment whose base has
      // gone negative (total_tax > gross on a half-entered year), flattening the walk.
      stackStrategy: 'all' as const,
      // Silent + transparent: it exists only to lift the visible segment off the floor.
      silent: true,
      itemStyle: { color: 'transparent' },
      emphasis: { itemStyle: { color: 'transparent' } },
      tooltip: { show: false },
      data: steps.map((s) => s.base),
    },
    {
      name: 'Amount',
      type: 'bar' as const,
      stack: 'waterfall',
      stackStrategy: 'all' as const,
      barMaxWidth: 24,
      itemStyle: { borderColor: SURFACE, borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: INK } },
      // Direct labels: a waterfall is read step by step, and hover-only numbers make that a hunt.
      label: capLabel((p) => formatCurrencyCompact(steps[p.dataIndex]?.amount ?? 0)),
      data: steps.map((s) => ({ value: s.height, itemStyle: { color: s.color } })),
    },
  ]
}

/** Item trigger, not axis: an axis tooltip would announce the invisible placeholder too. */
export function waterfallTooltip(steps: WaterfallStep[]) {
  return itemTooltip<{ dataIndex?: number }>({
    body: (p) => {
      const step = steps[p.dataIndex ?? -1]
      if (step === undefined) return null
      return {
        value: step.amount,
        label: step.label,
        ...(step.remaining === null ? {} : { sub: `Left: ${formatCurrency(step.remaining)}` }),
      }
    },
  })
}

export function waterfallCsv(steps: WaterfallStep[]): ExportTable {
  return {
    headers: ['Step', 'Amount', 'Remaining'],
    rows: steps.map((s) => [s.label, s.amount.toFixed(2), s.remaining === null ? '' : s.remaining.toFixed(2)]),
  }
}
```

Run: `npx vitest run src/charts/entities.test.ts src/charts/waterfall.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/charts/entities.ts src/charts/entities.test.ts src/charts/waterfall.ts src/charts/waterfall.test.ts
git commit -m "feat(charts): entities.ts (personSlot/slotColor/lowestFreeSlot) and waterfall.ts lifted from the tax builder (spec §12, §5)"
```

---

### Task 10: ECharts registrations for the new forms

**Files:**
- Modify: `src/charts/echarts.ts`, `vite.config.ts`

`markArea` (After FI), `markPoint` (percentile marks) and `aria` (decals) are components that must be registered in the tree-shaken build or they silently draw nothing. `echarts.connect` / `disconnect` already ride the `echarts` namespace this module re-exports (`echarts/core` exports both) — `EChart` calls `echarts.connect(group)`, so no separate export is needed. `VisualMapComponent` already includes the piecewise flavour (it is the union of `VisualMapContinuousComponent` and `VisualMapPiecewiseComponent`), so the price chart's piecewise wash needs nothing new.

- [ ] **Step 1: Register the components and widen the option type**

In `src/charts/echarts.ts`:

```ts
import {
  AriaComponent,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
// …
import type {
  AriaComponentOption,
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'
```

In the `echarts.use([...])` list, after `MarkLineComponent`:

```ts
  MarkLineComponent,
  // Chart grammar (2026-09-04): the post-FI wash is a markArea, the p10/p50/p90 arrivals are
  // markPoints, and the opt-in textures ride the aria component's decal (Appearance › Chart
  // patterns). Registered here or they draw NOTHING in the tree-shaken build — the real-echarts
  // probes in C4/C5/C7 are what prove the registration, since jsdom never paints.
  MarkAreaComponent,
  MarkPointComponent,
  AriaComponent,
```

And in `EChartsOption`:

```ts
export type EChartsOption = ComposeOption<
  | BarSeriesOption
  // … unchanged …
  | VisualMapComponentOption
  | AriaComponentOption
>
```

- [ ] **Step 2: Raise the chunk advisory**

In `vite.config.ts`, extend the history comment and the number:

```ts
    // … SankeyChart lands at 723.95 (724.53 with the shared marks module), hence 730; the
    // chart grammar's MarkArea/MarkPoint/Aria components (2026-09-04) push past it, hence 760.
    chunkSizeWarningLimit: 760,
```

Run: `npx tsc -b && npm run build`
Expected: both pass; the build prints the chart chunk's size — if it is still over the limit, raise the number to the printed size rounded up to the next 10 and record the figure in the comment (the limit documents deliberateness, nothing else).

Run: `npx vitest run src/charts src/components/EChart.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/charts/echarts.ts vite.config.ts
git commit -m "feat(charts): register MarkArea, MarkPoint and Aria components; chunk advisory 760 (spec §5)"
```

---

### Task 11: `useReducedMotion` shared by EChart and StatTile; count-up on the house clock

**Files:**
- Create: `src/components/useReducedMotion.ts`, `src/components/useReducedMotion.test.tsx`
- Modify: `src/components/StatTile.tsx`, `src/components/StatTile.test.tsx`

Spec §11: one subscription to `(prefers-reduced-motion: reduce)` with its `change` event, read by both consumers; StatTile's count-up moves from 350 to 450 ms. (`EChart` adopts the hook in Task 13.)

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/useReducedMotion.test.tsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion'

function fakeMedia(initial: boolean) {
  let listeners: (() => void)[] = []
  const query = {
    matches: initial,
    addEventListener: (_: string, cb: () => void) => { listeners.push(cb) },
    removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb) },
  }
  return {
    query,
    set(next: boolean) { query.matches = next; listeners.forEach((l) => l()) },
    count: () => listeners.length,
  }
}

function Probe() {
  const reduced = useReducedMotion()
  return <span data-testid="probe">{String(reduced)}</span>
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('useReducedMotion', () => {
  it('reads the media query and follows a LIVE change', () => {
    const media = fakeMedia(false)
    vi.stubGlobal('matchMedia', () => media.query)
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('false')
    act(() => media.set(true))
    expect(screen.getByTestId('probe').textContent).toBe('true')
    expect(media.count()).toBe(1)
  })
  it('unsubscribes on unmount and tolerates a matchMedia stub without addEventListener', () => {
    const media = fakeMedia(true)
    vi.stubGlobal('matchMedia', () => media.query)
    const { unmount } = render(<Probe />)
    unmount()
    expect(media.count()).toBe(0)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('true')
    expect(prefersReducedMotion()).toBe(true)
  })
  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
```

In `src/components/StatTile.test.tsx`, the count-up case: the final frame moves past the new duration —

```ts
    // Past the duration (450ms now — the house clock, spec §11): the override clears and the
    // CALLER's exact string renders.
    act(() => frames[frames.length - 1](500))
    expect(valueEl.textContent).toBe('$100.00')
```

Run: `npx vitest run src/components/useReducedMotion.test.tsx src/components/StatTile.test.tsx`
Expected: FAIL — module missing; StatTile's mid-flight frame at 175 still passes but the module is not yet on 450 (the test passes by accident until Step 2 lands — run it again after).

- [ ] **Step 2: Write the hook**

```ts
// src/components/useReducedMotion.ts
// THE reduced-motion read (chart spec §11). One media query, subscribed to its `change` event
// through useSyncExternalStore, so a live OS toggle re-applies `animation: false` in EChart
// without a reload. `prefersReducedMotion()` is the synchronous read for initializers
// (StatTile decides its zero-frame during the first render). Guards: no matchMedia (SSR,
// old jsdom) reads as "motion allowed"; a matchMedia stub without addEventListener (the
// tests' `() => ({ matches })`) subscribes to nothing rather than throwing.
import { useSyncExternalStore } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null
}

export function prefersReducedMotion(): boolean {
  return query()?.matches === true
}

function subscribe(onChange: () => void): () => void {
  const q = query()
  if (q === null || typeof q.addEventListener !== 'function') return () => {}
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
```

- [ ] **Step 3: Move StatTile onto it**

In `src/components/StatTile.tsx`:

```ts
import { prefersReducedMotion } from './useReducedMotion'

// The settle runs only when every leg holds; the useState initializer and the effect share
// this single predicate so the zero-frame can never strand. The reduced-motion read is the
// shared one (useReducedMotion.ts) — a synchronous call, because it runs in an initializer.
function shouldCountUp(countUp: CountUp | undefined): countUp is CountUp {
  return (
    countUp !== undefined &&
    typeof requestAnimationFrame === 'function' &&
    !prefersReducedMotion()
  )
}

// The house entrance clock (chart spec §11) — the same 450ms the charts animate in on.
const COUNT_UP_MS = 450
```

Update the `countUp` prop's doc comment ("over ~450ms").

Run: `npx vitest run src/components/useReducedMotion.test.tsx src/components/StatTile.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/useReducedMotion.ts src/components/useReducedMotion.test.tsx src/components/StatTile.tsx src/components/StatTile.test.tsx
git commit -m "feat(motion): shared useReducedMotion with a live media subscription; StatTile count-up on the 450ms house clock (spec §11)"
```

---

### Task 12: Chart patterns — the `finance.chartDecals` store and the Appearance control

**Files:**
- Create: `src/components/useChartDecals.ts`, `src/components/useChartDecals.test.tsx`
- Modify: `src/components/settings/AppearanceCard.tsx`, `src/components/settings/AppearanceCard.test.tsx`

Spec §14: `Appearance › Chart patterns (Off/On)` stores `finance.chartDecals`; when on, `EChart` (Task 13) merges the aria decal. Browser-local like theme and density, with the same one-sentence note. A tiny external store rather than a context: `EChart` mounts lazily inside the chart chunk and must not depend on a new provider being wrapped around the app.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/useChartDecals.test.tsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DECALS_KEY, readChartDecals, setChartDecals, useChartDecals } from './useChartDecals'

function Probe() {
  return <span data-testid="probe">{String(useChartDecals())}</span>
}
beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('chart decals store', () => {
  it('reads off by default, persists a choice under finance.chartDecals, and notifies live readers', () => {
    expect(readChartDecals()).toBe(false)
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('false')
    act(() => setChartDecals(true))
    expect(localStorage.getItem(DECALS_KEY)).toBe('on')
    expect(screen.getByTestId('probe').textContent).toBe('true')
    act(() => setChartDecals(false))
    expect(screen.getByTestId('probe').textContent).toBe('false')
  })
  it('seeds from a persisted value', () => {
    localStorage.setItem(DECALS_KEY, 'on')
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('true')
  })
})
```

Add to `AppearanceCard.test.tsx`'s first case, after the density clicks:

```ts
    fireEvent.click(screen.getByRole('button', { name: 'On' }))
    expect(localStorage.getItem('finance.chartDecals')).toBe('on')
    expect(screen.getByRole('button', { name: 'On' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed')).toBe('false')
```

Run: `npx vitest run src/components/useChartDecals.test.tsx src/components/settings/AppearanceCard.test.tsx`
Expected: FAIL — module missing; no `On` button.

- [ ] **Step 2: Write the store**

```ts
// src/components/useChartDecals.ts
// Appearance › Chart patterns (chart spec §14): opt-in 45°/135° textures on stacks and pies
// through echarts' aria decal. Browser-local like theme/density (the Data-lifecycle spec's
// server prefs later). An external store, not a context: EChart lives in the lazy chart chunk
// and must read this without a provider wrapped around the app.
import { useSyncExternalStore } from 'react'

export const DECALS_KEY = 'finance.chartDecals'
const CHANGE_EVENT = 'finance:decals'

export function readChartDecals(): boolean {
  try {
    return localStorage.getItem(DECALS_KEY) === 'on'
  } catch {
    return false
  }
}

export function setChartDecals(on: boolean): void {
  try {
    localStorage.setItem(DECALS_KEY, on ? 'on' : 'off')
  } catch {
    // A blocked localStorage costs persistence, never the switch itself.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  // Another tab's Settings page flips it → `storage` fires here.
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useChartDecals(): boolean {
  return useSyncExternalStore(subscribe, readChartDecals, () => false)
}
```

- [ ] **Step 3: Add the control to the Appearance card**

In `AppearanceCard.tsx`:

```tsx
import { setChartDecals, useChartDecals } from '../useChartDecals'

const DECALS: { value: 'off' | 'on'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
]
```

Inside the component, `const decals = useChartDecals()`, and after the Density field:

```tsx
      <div className="settings-field">
        <span className="eyebrow">Chart patterns</span>
        <Segmented
          variant="toggle"
          ariaLabel="Chart patterns"
          options={DECALS}
          value={decals ? 'on' : 'off'}
          onChange={(next) => setChartDecals(next === 'on')}
        />
      </div>
```

Update the card's `InfoHint` text to: `"Theme, density and chart patterns are remembered in this browser. System follows your operating system's light or dark setting live. Chart patterns add textures to stacked bars and pies so segments read apart without colour."`

Run: `npx vitest run src/components/useChartDecals.test.tsx src/components/settings/AppearanceCard.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/useChartDecals.ts src/components/useChartDecals.test.tsx src/components/settings/AppearanceCard.tsx src/components/settings/AppearanceCard.test.tsx
git commit -m "feat(settings): Chart patterns Off/On stored under finance.chartDecals with a live store (spec §14)"
```

---

### Task 13: `EChart` — `group` → `connect`, live reduced motion, opt-in decals

**Files:**
- Modify: `src/components/EChart.tsx`, `src/components/EChart.test.tsx`

Spec §8 (linked siblings), §11 (live reduced motion), §14 (decals). `ariaLabel` stays optional here — C7 flips it once every mount is on `ChartCard`. One deliberate reading of §20's "disconnect on dispose": `echarts.disconnect(group)` unlinks the WHOLE group, so calling it when one sibling unmounts (the drill chart going null) would strand the survivors; a disposed instance drops out of its group on its own, and every init re-runs `connect`, so dispose needs nothing. The test pins connect-per-init instead.

- [ ] **Step 1: Write the failing tests**

In `EChart.test.tsx`, add `connect: vi.fn()` to the fake `echarts` object in the module mock (beside `init`), and a `group` field on `FakeChart` (`group = ''`). Then append:

```tsx
describe('EChart — group, decals, live reduced motion (chart grammar)', () => {
  const connect = () => vi.mocked((chartsModule.echarts as unknown as { connect: (g: string) => void }).connect)

  it('sets chart.group and connects on every init — the theme re-init included', async () => {
    function Harness() {
      const { setTheme } = useTheme()
      return (
        <>
          <button onClick={() => setTheme('light')}>go light</button>
          <EChart option={OPTION} group="net-worth" />
        </>
      )
    }
    render(<ThemeProvider><Harness /></ThemeProvider>)
    expect((lastChart() as unknown as { group: string }).group).toBe('net-worth')
    expect(connect()).toHaveBeenCalledWith('net-worth')
    act(() => screen.getByText('go light').click())
    await waitFor(() => expect(connect()).toHaveBeenCalledTimes(2))
    expect((lastChart() as unknown as { group: string }).group).toBe('net-worth')
  })

  it('does not connect a chart without a group', () => {
    render(<EChart option={OPTION} />)
    expect(connect()).not.toHaveBeenCalled()
  })

  it('merges the aria decal when Chart patterns is on, with echarts’ own label generation OFF', () => {
    localStorage.setItem('finance.chartDecals', 'on')
    render(<EChart option={{ series: [] } as EChartsOption} ariaLabel="Test" />)
    const [applied] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect(applied.aria).toEqual({ enabled: true, label: { enabled: false }, decal: { show: true } })
    localStorage.clear()
    cleanup()
    render(<EChart option={{ series: [] } as EChartsOption} />)
    expect('aria' in (lastChart().setOption.mock.calls[0] as [Record<string, unknown>])[0]).toBe(false)
  })

  it('re-applies animation: false when the OS preference flips while mounted', () => {
    let listeners: (() => void)[] = []
    const media = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => { listeners.push(cb) },
      removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb) },
    }
    vi.stubGlobal('matchMedia', () => media)
    render(<EChart option={{ series: [] } as EChartsOption} />)
    const chart = lastChart()
    expect('animation' in (chart.setOption.mock.calls[0] as [Record<string, unknown>])[0]).toBe(false)
    act(() => { media.matches = true; listeners.forEach((l) => l()) })
    const last = chart.setOption.mock.calls.at(-1) as [Record<string, unknown>]
    expect(last[0].animation).toBe(false)
  })
})
```

(`act` and `useTheme` are already imported in this file.)

Run: `npx vitest run src/components/EChart.test.tsx`
Expected: FAIL — no `group` prop; no `aria`; no re-apply.

- [ ] **Step 2: Change the component**

In `src/components/EChart.tsx`:

```ts
import { useChartDecals } from './useChartDecals'
import { useReducedMotion } from './useReducedMotion'
```

Delete the module-scope `REDUCED_MOTION` constant. Add the prop (after `zoomWindow` in the signature and the type):

```ts
  /** echarts.connect group (chart spec §8): same-axis siblings share axisPointer and zoom.
   *  Set on the instance and connected in the init effect so a theme re-init re-connects. */
  group?: string
```

At the top of the component body:

```ts
  const { resolved, version: themeVersion } = useTheme()
  // Live (spec §11): a change of the OS preference while mounted re-runs the option effect
  // below and re-applies `animation: false` — the module-scope read it replaces froze the
  // answer at first import.
  const reducedMotion = useReducedMotion()
  // Appearance › Chart patterns (spec §14).
  const decals = useChartDecals()
```

In the init effect, right after `const chart = echarts.init(el, name)`:

```ts
    if (group !== undefined) {
      // A disposed instance leaves its group by itself, and every init (theme re-inits
      // included) reconnects — so dispose below deliberately does NOT call disconnect(),
      // which would unlink the surviving siblings too.
      chart.group = group
      echarts.connect(group)
    }
```

and add `group` to that effect's dependency array: `[instanceRef, resolved, themeVersion, group]`.

In the option effect: the fingerprint and the guards read the hook values —

```ts
    const stripped = JSON.stringify({ ...option, dataZoom: undefined, __theme: resolved, __decals: decals })
    if (!reducedMotion && zoomWindow !== undefined && lastStrippedRef.current !== null && lastStrippedRef.current === stripped) {
      // … unchanged …
    }
    const themed = resolved === 'light' ? (recolorOption(option, lightFromDark) as EChartsOption) : option
    const base = reducedMotion ? quiesceRipples(themed) : themed
    chart.setOption(
      {
        ...base,
        // Decals ride echarts' aria component; its own label generation is OFF because it
        // would overwrite the container's house aria-label with a generated sentence.
        ...(decals ? { aria: { enabled: true, label: { enabled: false }, decal: { show: true } } } : {}),
        ...(reducedMotion ? { animation: false } : !animateEntrance ? { animationDuration: 0 } : {}),
      },
      { notMerge: true },
    )
```

and the dependency array becomes `[option, animateEntrance, zoomWindow, resolved, themeVersion, reducedMotion, decals]`. Update the comment above `REDUCED_MOTION`'s old uses accordingly (the "fingerprint is JSON" contract paragraph now also names `__decals`).

Run: `npx vitest run src/components/EChart.test.tsx src/components/StatTile.test.tsx`
Expected: PASS — the 23 pre-existing EChart cases and the four new ones.

- [ ] **Step 3: Commit**

```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(charts): EChart group→connect per init, live reduced motion, opt-in aria decals with generated labels off (spec §8, §11, §14)"
```

---

### Task 14: The export menu grows Table, Copy and a captioned PNG

**Files:**
- Create: `src/charts/exportImage.ts`, `src/charts/exportImage.test.ts`, `src/components/ChartExportMenu.test.tsx`
- Modify: `src/components/ChartExportMenu.tsx`

Spec §14. PNG composites a caption strip — title, caption, "Exported {date}" in INK/MUTED on the resolved `SURFACE` — through an offscreen canvas; Copy writes a PNG `ClipboardItem` and, where that is unsupported or refused, downloads instead with the toast "Clipboard unavailable — downloaded instead"; Table toggles the card's data table. The legacy path (an `ExportConfig` without `title`, i.e. `EChart`'s own `exportConfig` until the lanes finish) stays synchronous and byte-identical, so the existing `EChart.test.tsx` export cases keep passing.

- [ ] **Step 1: Write the failing tests**

```ts
// src/charts/exportImage.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captionedPng, dataUrlToBlob } from './exportImage'

const RAW = 'data:image/png;base64,iVBORw0KGgo='
const INPUT = { title: 'Net worth', caption: 'as of Aug 14, 2026', exportedOn: 'Sep 3, 2026', surface: '#171a21', ink: '#e6e9ef', muted: '#8b93a3' }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('dataUrlToBlob', () => {
  it('decodes the base64 body into a typed Blob', async () => {
    const blob = dataUrlToBlob(RAW)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(8)
  })
})

describe('captionedPng', () => {
  it('falls back to the raw image where the canvas cannot draw (jsdom, a blocked canvas)', async () => {
    vi.stubGlobal('Image', class { width = 200; height = 100; onload: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()) } })
    // jsdom's getContext returns null without the `canvas` package — the fallback path.
    expect(await captionedPng(RAW, INPUT)).toBe(RAW)
  })
  it('paints the strip — surface, title in ink, caption and date in muted — above the chart', async () => {
    vi.stubGlobal('Image', class { width = 200; height = 100; onload: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()) } })
    const context = { fillStyle: '', font: '', fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,CAPTIONED')
    expect(await captionedPng(RAW, INPUT)).toBe('data:image/png;base64,CAPTIONED')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 200, 100 + 128) // 2× pixel ratio: a 64px strip is 128px
    expect(context.fillText.mock.calls.map((c) => c[0])).toEqual(['Net worth', 'as of Aug 14, 2026 · Exported Sep 3, 2026'])
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 128)
  })
})
```

```tsx
// src/components/ChartExportMenu.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/download', () => ({ toCsv: vi.fn(() => 'CSV'), downloadDataUrl: vi.fn(), downloadText: vi.fn() }))
vi.mock('../charts/exportImage', () => ({
  captionedPng: vi.fn(async () => 'data:image/png;base64,CAPTIONED'),
  dataUrlToBlob: vi.fn(() => new Blob(['x'], { type: 'image/png' })),
}))

import ChartExportMenu from './ChartExportMenu'
import ToastProvider from './ToastProvider'
import { captionedPng } from '../charts/exportImage'
import { downloadDataUrl, downloadText } from '../utils/download'

const chart = { getDataURL: vi.fn(() => 'data:image/png;base64,RAW') }
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('ChartExportMenu', () => {
  it('legacy config (no title): PNG downloads the raw snapshot synchronously', () => {
    render(<ChartExportMenu config={{ name: 'demo' }} getChart={() => chart} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,RAW', 'demo.png')
    expect(captionedPng).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull() // Copy needs a title too
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull()
  })

  it('captioned PNG: composites title, caption and the export date on the resolved surface', async () => {
    render(<ChartExportMenu config={{ name: 'net-worth', title: 'Net worth', caption: 'as of Aug 14, 2026' }} getChart={() => chart} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    await waitFor(() => expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,CAPTIONED', 'net-worth.png'))
    expect(captionedPng).toHaveBeenCalledWith('data:image/png;base64,RAW', expect.objectContaining({
      title: 'Net worth', caption: 'as of Aug 14, 2026', surface: '#171a21', ink: '#e6e9ef', muted: '#8b93a3', exportedOn: expect.stringMatching(/\w{3} \d{1,2}, \d{4}/),
    }))
  })

  it('Copy writes a PNG ClipboardItem when the browser can', async () => {
    const write = vi.fn(async () => {})
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    vi.stubGlobal('navigator', { clipboard: { write } })
    render(<ToastProvider><ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(downloadDataUrl).not.toHaveBeenCalled()
    expect(await screen.findByText('Chart copied')).toBeTruthy()
  })

  it('Copy falls back to a download with the toast when ClipboardItem is missing (Firefox default)', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    render(<ToastProvider><ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,CAPTIONED', 'demo.png'))
    expect(await screen.findByText('Clipboard unavailable — downloaded instead')).toBeTruthy()
  })

  it('Table toggles through the callback and reports its state; CSV is unchanged', () => {
    const onToggleTable = vi.fn()
    const csv = vi.fn(() => ({ headers: ['A'], rows: [[1]] }))
    render(<ChartExportMenu config={{ name: 'demo', title: 'Demo', csv }} getChart={() => chart} tableShown={false} onToggleTable={onToggleTable} />)
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(onToggleTable).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    expect(csv).toHaveBeenCalledTimes(1)
    expect(downloadText).toHaveBeenCalledWith('CSV', 'demo.csv', 'text/csv;charset=utf-8')
  })
})
```

Run: `npx vitest run src/charts/exportImage.test.ts src/components/ChartExportMenu.test.tsx`
Expected: FAIL — module missing; no Copy/Table buttons.

- [ ] **Step 2: Write `exportImage.ts`**

```ts
// src/charts/exportImage.ts
// The PNG export's caption strip (chart spec §14) and the clipboard's Blob. Pure DOM/canvas
// work, no React, no echarts — testable with a stubbed Image and 2d context. Where the canvas
// cannot draw (jsdom, a blocked canvas) the RAW snapshot comes back uncaptioned: an export
// must never fail on decoration.
export interface CaptionInput {
  title: string
  caption?: string
  /** formatDate(today) — passed in so the module stays clock-free. */
  exportedOn: string
  /** The resolved theme's tokens: the strip is painted in the palette the chart was drawn in. */
  surface: string
  ink: string
  muted: string
}

/** EChart snapshots at pixelRatio 2 (ChartExportMenu); the strip is laid out in that scale. */
const SCALE = 2
const STRIP = 64 * SCALE
const PAD = 16 * SCALE
const FONT = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('export image failed to decode'))
    image.src = src
  })
}

export async function captionedPng(dataUrl: string, input: CaptionInput): Promise<string> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context === null) return dataUrl
  canvas.width = image.width
  canvas.height = image.height + STRIP
  context.fillStyle = input.surface
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = input.ink
  context.font = `600 ${13 * SCALE}px ${FONT}`
  context.fillText(input.title, PAD, 24 * SCALE)
  context.fillStyle = input.muted
  context.font = `${11 * SCALE}px ${FONT}`
  context.fillText([input.caption, `Exported ${input.exportedOn}`].filter(Boolean).join(' · '), PAD, 44 * SCALE)
  context.drawImage(image, 0, STRIP)
  return canvas.toDataURL('image/png')
}

/** `data:<mime>;base64,<body>` → Blob, without a fetch (jsdom has none for data URLs). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body = ''] = dataUrl.split(',')
  const mime = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  const bytes = atob(body)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], { type: mime })
}
```

- [ ] **Step 3: Rewrite the menu**

```tsx
// src/components/ChartExportMenu.tsx
import { captionedPng, dataUrlToBlob } from '../charts/exportImage'
import { DARK, LIGHT } from '../theme/tokens'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'
import type { ExportTable } from '../utils/download'
import { formatDate } from '../utils/format'
import { todayIso } from '../utils/months'
import { useTheme } from './shell/ThemeProvider'
import { useToast } from './ToastProvider'
import './panels.css'

export interface ExportConfig {
  /** Download basename — the files land as {name}.png / {name}.csv. */
  name: string
  /** Rows supplied by the CALLER from data already in scope — never introspected from echarts
   *  options. Invoked lazily, on click. */
  csv?: () => ExportTable
  /** The card's title (chart spec §14). Present → the PNG carries a caption strip and Copy is
   *  offered; absent → the legacy raw snapshot (EChart's own exportConfig, until every mount
   *  is on ChartCard). */
  title?: string
  /** "as of Aug 14, 2026" — the strip's second line. */
  caption?: string
}

export interface ExportableChart {
  getDataURL: (opts: { pixelRatio: number; backgroundColor: string }) => string
}

/**
 * The house ⤓ menu: PNG · Copy · CSV · Table. PNG snapshots the live canvas at 2× on the
 * resolved card surface (the theme paints the canvas transparent, which would export black)
 * and, with a title, composites the caption strip. Copy writes a PNG ClipboardItem; where the
 * browser has none (Firefox by default) or refuses, the PNG downloads and a toast says so.
 * Table is the card's data-table toggle (ChartCard owns the state).
 */
export default function ChartExportMenu({
  config,
  getChart,
  tableShown,
  onToggleTable,
}: {
  config: ExportConfig
  getChart: () => ExportableChart | null
  tableShown?: boolean
  onToggleTable?: () => void
}) {
  const { resolved } = useTheme()
  const toast = useToast()
  const tokens = resolved === 'light' ? LIGHT : DARK

  const snapshot = (): string | null => {
    const chart = getChart()
    return chart === null ? null : chart.getDataURL({ pixelRatio: 2, backgroundColor: tokens.surface })
  }
  const captioned = async (raw: string): Promise<string> =>
    config.title === undefined
      ? raw
      : captionedPng(raw, {
          title: config.title,
          caption: config.caption,
          exportedOn: formatDate(todayIso()),
          surface: tokens.surface,
          ink: tokens.text,
          muted: tokens.muted,
        })

  const png = () => {
    const raw = snapshot()
    if (raw === null) return // disposed mid-click: nothing to snapshot
    // Legacy configs stay synchronous — the pre-grammar behaviour, byte for byte.
    if (config.title === undefined) {
      downloadDataUrl(raw, `${config.name}.png`)
      return
    }
    void captioned(raw).then((url) => downloadDataUrl(url, `${config.name}.png`))
  }

  const copy = async () => {
    const raw = snapshot()
    if (raw === null) return
    const url = await captioned(raw)
    const Item = (globalThis as { ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem }).ClipboardItem
    if (Item !== undefined && typeof navigator.clipboard?.write === 'function') {
      try {
        await navigator.clipboard.write([new Item({ 'image/png': dataUrlToBlob(url) })])
        toast.success('Chart copied')
        return
      } catch {
        // Permission denied or an unsupported type: fall through to the download.
      }
    }
    downloadDataUrl(url, `${config.name}.png`)
    toast.info('Clipboard unavailable — downloaded instead')
  }

  const csv = config.csv
  return (
    <div className="chart-export" role="group" aria-label={`Export ${config.name}`}>
      <span className="chart-export-glyph" aria-hidden="true">⤓</span>
      <div className="segmented">
        <button type="button" onClick={png}>PNG</button>
        {config.title !== undefined && (
          <button type="button" onClick={() => void copy()}>Copy</button>
        )}
        {csv && (
          <button
            type="button"
            onClick={() => {
              const { headers, rows } = csv()
              downloadText(toCsv(headers, rows), `${config.name}.csv`, 'text/csv;charset=utf-8')
            }}
          >
            CSV
          </button>
        )}
        {onToggleTable !== undefined && (
          <button type="button" aria-pressed={tableShown === true} onClick={onToggleTable}>Table</button>
        )}
      </div>
    </div>
  )
}
```

Run: `npx vitest run src/charts/exportImage.test.ts src/components/ChartExportMenu.test.tsx src/components/EChart.test.tsx`
Expected: PASS (EChart's legacy export cases included).

- [ ] **Step 4: Commit**

```bash
git add src/charts/exportImage.ts src/charts/exportImage.test.ts src/components/ChartExportMenu.tsx src/components/ChartExportMenu.test.tsx
git commit -m "feat(charts): export menu grows Copy, Table and a captioned PNG on the resolved surface; clipboard falls back to a download with a toast (spec §14)"
```

---

### Task 15: `ChartCard`, `ChartTable` and their CSS

**Files:**
- Create: `src/components/ChartCard.tsx`, `src/components/ChartCard.test.tsx`, `src/components/ChartTable.tsx`
- Modify: `src/components/panels.css`

Spec §6 and §14. The card owns chrome and lifecycle and never touches series: header (eyebrow + `InfoHint`, controls then actions on the right) → export row → body by state → `ChartZoomHint` when `zoomable` → the Table twin → `footer`. `animateEntrance` comes from `usePageFrame().fromCache` — the prop disappears from every page. Every prop the spec lists is here; `EChart` pass-throughs are forwarded untouched.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ChartCard.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'

// The engine never draws in jsdom: the page tests' mock shape, so this file pins the CARD.
vi.mock('./EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel, animateEntrance = true, group, height }: { ariaLabel?: string; animateEntrance?: boolean; group?: string; height?: number }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-animate': String(animateEntrance), 'data-group': group ?? '', 'data-height': String(height) }),
  }
})
vi.mock('../utils/download', () => ({ toCsv: vi.fn(() => 'CSV'), downloadDataUrl: vi.fn(), downloadText: vi.fn() }))

import ChartCard from './ChartCard'
import PageFrame from './shell/PageFrame'

const OPTION = { series: [] } as EChartsOption
const base = { title: 'Net worth', hint: 'What it shows.', ariaLabel: 'Line chart of net worth', empty: 'No snapshots yet.', exportName: 'net-worth' }
afterEach(cleanup)

describe('ChartCard states', () => {
  it('null + busy → a skeleton block of the card height, and a status line for AT', () => {
    render(<ChartCard {...base} option={null} busy height={280} />)
    const skeleton = document.querySelector('.chart-card-skeleton') as HTMLElement
    expect(skeleton.style.height).toBe('280px')
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    expect(screen.queryByText('No snapshots yet.')).toBeNull()
    expect(screen.queryByRole('group', { name: /Export/ })).toBeNull()
  })
  it('null + error → the error sentence as the empty note', () => {
    render(<ChartCard {...base} option={null} error="Failed to load price history" />)
    expect(screen.getByText('Failed to load price history').className).toBe('empty-note')
  })
  it('null → the required empty sentence, no default prose', () => {
    render(<ChartCard {...base} option={null} />)
    expect(screen.getByText('No snapshots yet.').className).toBe('empty-note')
  })
  it('option → the chart with the house label, the export row, and a dim (not a skeleton) while busy', () => {
    const { rerender } = render(<ChartCard {...base} option={OPTION} height={320} />)
    expect(screen.getByTestId('echart').getAttribute('aria-label')).toBe('Line chart of net worth')
    expect(screen.getByTestId('echart').getAttribute('data-height')).toBe('320')
    expect(screen.getByRole('group', { name: 'Export net-worth' })).toBeTruthy()
    expect(document.querySelector('.loading-dim.is-loading')).toBeNull()
    rerender(<ChartCard {...base} option={OPTION} busy />)
    expect(document.querySelector('.loading-dim.is-loading')).toBeTruthy()
    expect(screen.getByTestId('echart')).toBeTruthy() // the previous render holds
    expect(document.querySelector('.chart-card-skeleton')).toBeNull()
  })
  it('option + error → a card-local advisory above the chart, never the page banner', () => {
    render(<ChartCard {...base} option={OPTION} error="Refetch failed — showing the previous window" />)
    expect(screen.getByRole('status').textContent).toContain('Refetch failed')
    expect(screen.getByTestId('echart')).toBeTruthy()
  })
})

describe('ChartCard chrome', () => {
  it('renders the eyebrow with its hint, controls then actions on the right, zoom hint and footer', () => {
    render(
      <ChartCard {...base} option={OPTION} zoomable span={6}
        controls={<button>Monthly</button>} actions={<button>All months</button>} footer={<p className="drill-hint">Click a bar.</p>} />,
    )
    const section = document.querySelector('section.card.chart-card.span-6') as HTMLElement
    expect(section).toBeTruthy()
    expect(section.querySelector('h2.eyebrow')?.textContent).toBe('Net worth')
    expect(section.querySelector('h2.eyebrow button.info-hint')?.getAttribute('aria-label')).toBe('What it shows.')
    const controls = section.querySelector('.chart-card-controls') as HTMLElement
    expect(controls.textContent).toBe('MonthlyAll months')
    expect(screen.getByText('ctrl+scroll to zoom · drag to pan')).toBeTruthy()
    expect(screen.getByText('Click a bar.')).toBeTruthy()
  })
  it('reads fromCache from the PageFrame context: cached → no entrance, bare → entrance', () => {
    render(
      <PageFrame title="P" resource={{ status: 'ready', fromCache: true }}>
        <ChartCard {...base} option={OPTION} />
      </PageFrame>,
    )
    expect(screen.getByTestId('echart').getAttribute('data-animate')).toBe('false')
    cleanup()
    render(<ChartCard {...base} option={OPTION} />)
    expect(screen.getByTestId('echart').getAttribute('data-animate')).toBe('true')
  })
  it('passes the group through and offers Table only with a csv, toggling the twin', () => {
    const csv = vi.fn(() => ({ headers: ['Month', 'Net worth'], rows: [['2026-08-01', '1500.00']] }))
    const { rerender } = render(<ChartCard {...base} option={OPTION} group="net-worth" />)
    expect(screen.getByTestId('echart').getAttribute('data-group')).toBe('net-worth')
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull()
    rerender(<ChartCard {...base} option={OPTION} csv={csv} />)
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Net worth' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '1500.00' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.queryByRole('table')).toBeNull()
  })
})
```

Run: `npx vitest run src/components/ChartCard.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 2: Write `ChartTable`**

```tsx
// src/components/ChartTable.tsx
import type { ExportTable } from '../utils/download'
import './panels.css'

/** The accessibility twin (chart spec §14): the builder's own ExportTable as a real table
 *  under the chart, so no value is tooltip-only and a screen reader gets every figure. */
export default function ChartTable({ table, caption }: { table: ExportTable; caption: string }) {
  const numeric = (cell: string | number) => typeof cell === 'number' || /^-?\d/.test(String(cell))
  return (
    <details className="chart-table" open>
      <summary>Data table</summary>
      <div className="chart-table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {table.headers.map((header, i) => (
                <th key={i} scope="col">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={numeric(cell) ? 'num' : undefined}>
                    {cell === '' ? '—' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
```

- [ ] **Step 3: Write `ChartCard`**

```tsx
// src/components/ChartCard.tsx
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { EChartsOption } from '../charts/echarts'
import type { ZoomWindow } from '../charts/timeZoom'
import type { ExportTable } from '../utils/download'
import ChartExportMenu from './ChartExportMenu'
import ChartTable from './ChartTable'
import ChartZoomHint from './ChartZoomHint'
import EChart from './EChart'
import type { EChartEventParams, EChartsInstance } from './EChart'
import InfoHint from './InfoHint'
import { usePageFrame } from './shell/PageFrame'
import './panels.css'

// The one chart mount (chart spec §6): header · hint · controls · export row · states · chart ·
// zoom hint · table twin · footer. It never rewrites series — helpers inside builders carry
// everything data-shaped; this carries chrome and lifecycle. `animateEntrance` comes from the
// frame's context, so no page passes it. The shell `Segmented` renders every control a caller
// hands in; scope controls (range, owner, month) belong to the ScopeBar, never here.
export interface ChartCardProps {
  /** Eyebrow, sentence case. */
  title: string
  /** InfoHint copy — required. */
  hint: string
  /** One sentence: what the chart SHOWS — required, forwarded to EChart. */
  ariaLabel: string
  option: EChartsOption | null
  /** The sentence shown when option is null — required, no default prose. */
  empty: string
  /** {exportName}.png / .csv; the PNG caption's slug. */
  exportName: string
  /** Enables CSV and the Table twin. */
  csv?: () => ExportTable
  /** "as of Aug 14, 2026" — the PNG caption's second line. */
  caption?: string
  height?: number
  /** Chart-local Segmented(s) — never scope controls. */
  controls?: ReactNode
  /** Rare: the drill-in's "All months" button, a Retry. */
  actions?: ReactNode
  /** Drill-hint paragraph(s), pickers. */
  footer?: ReactNode
  /** Renders ChartZoomHint; the option carries the dataZoom. */
  zoomable?: boolean
  /** echarts.connect group for same-axis siblings. */
  group?: string
  /** Card-local revalidation: the previous render holds under a dim (a skeleton only when
   *  there is nothing to hold). */
  busy?: boolean
  /** Card-local advisory — never the page banner. */
  error?: string | null
  span?: 6 | 12
  // Pass-through to EChart.
  onClick?: (params: EChartEventParams) => void
  onHover?: (params: EChartEventParams) => void
  onHoverEnd?: () => void
  instanceRef?: { current: EChartsInstance | null }
  onLegendChange?: (selected: Record<string, boolean>) => void
  onDataZoom?: (window: { startValue: number; endValue: number }) => void
  zoomWindow?: ZoomWindow
}

export default function ChartCard({
  title, hint, ariaLabel, option, empty, exportName, csv, caption, height = 320, controls, actions, footer,
  zoomable = false, group, busy = false, error = null, span = 12,
  onClick, onHover, onHoverEnd, instanceRef, onLegendChange, onDataZoom, zoomWindow,
}: ChartCardProps) {
  const { fromCache } = usePageFrame()
  const [tableOpen, setTableOpen] = useState(false)
  // The export menu needs the live instance. A caller's ref is honoured (SpendingPage
  // dispatches highlights into its bars); otherwise the card keeps its own. Either way the
  // object handed to EChart is stable — a fresh one would re-init the chart every render.
  const ownRef = useRef<EChartsInstance | null>(null)
  const chartRef = instanceRef ?? ownRef
  const showTable = tableOpen && csv !== undefined && option !== null

  let body: ReactNode
  if (option === null) {
    body = busy ? (
      <>
        <p className="visually-hidden" role="status">Loading…</p>
        <div className="skeleton chart-card-skeleton" aria-hidden="true" style={{ height }} />
      </>
    ) : (
      <p className="empty-note">{error ?? empty}</p>
    )
  } else {
    body = (
      <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
        <EChart
          option={option}
          height={height}
          ariaLabel={ariaLabel}
          animateEntrance={!fromCache}
          group={group}
          onClick={onClick}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
          instanceRef={chartRef}
          onLegendChange={onLegendChange}
          onDataZoom={onDataZoom}
          zoomWindow={zoomWindow}
        />
      </div>
    )
  }

  return (
    <section className={`card chart-card span-${span}`}>
      <div className="chart-card-header">
        <h2 className="eyebrow">
          {title}
          <InfoHint text={hint} />
        </h2>
        {(controls !== undefined || actions !== undefined) && (
          <div className="chart-card-controls">
            {controls}
            {actions}
          </div>
        )}
      </div>
      {option !== null && (
        <ChartExportMenu
          config={{ name: exportName, csv, title, caption }}
          getChart={() => chartRef.current}
          tableShown={showTable}
          onToggleTable={csv === undefined ? undefined : () => setTableOpen((open) => !open)}
        />
      )}
      {option !== null && error !== null && (
        <p className="chart-card-error" role="status">{error}</p>
      )}
      {body}
      {zoomable && option !== null && <ChartZoomHint />}
      {showTable && csv !== undefined && <ChartTable table={csv()} caption={`${title} — data table`} />}
      {footer}
    </section>
  )
}
```

- [ ] **Step 4: Add the CSS**

Append to `src/components/panels.css`:

```css
/* ── Chart card (chart grammar spec §6) ────────────────────────────── */
/* The one chart mount. Replaces the per-page header copies (networth/spending/tax/projection
   -chart-header, .panel-title-row) — those rules are retired in the morning, not tonight. */

.chart-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.chart-card-header .eyebrow {
  margin: 0;
}

.chart-card-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* A card-local advisory (a failed refetch with the previous window still drawn). */
.chart-card-error {
  margin: 0 0 0.5rem;
  color: var(--warn);
  font-size: 0.8rem;
}

.chart-card-skeleton {
  border-radius: 8px;
}

/* ── Tooltip rows (chart grammar spec §7) ──────────────────────────── */
/* echarts owns the tooltip box (surface, border, shadow from the theme); these rules lay out
   the grammar's rows inside it. Swatches are painted by CSS variables in the markup, so they
   follow the theme. */

.chart-tip-head {
  font-weight: 600;
  margin-bottom: 4px;
}

.chart-tip-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0 8px;
  line-height: 1.5;
}

.chart-tip-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  justify-self: center;
}

.chart-tip-swatch.is-line {
  width: 10px;
  height: 2px;
  border-radius: 1px;
}

.chart-tip-swatch.is-wash {
  opacity: 0.3;
}

.chart-tip-swatch.is-blank {
  background: transparent;
}

.chart-tip-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.chart-tip-total {
  margin-top: 2px;
  padding-top: 2px;
  border-top: 1px solid var(--border);
}

.chart-tip-ref {
  color: var(--muted);
}

.chart-tip-ref .chart-tip-value {
  font-weight: 400;
}

.chart-tip-note,
.chart-tip-foot {
  margin-top: 3px;
  color: var(--muted);
}

.chart-tip-lead {
  font-size: 0.95rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.chart-tip-sub {
  color: var(--muted);
}

/* ── Table twin (chart grammar spec §14) ───────────────────────────── */

.chart-table {
  margin-top: 0.75rem;
}

.chart-table summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 0.75rem;
}

.chart-table-scroll {
  margin-top: 0.5rem;
  max-height: 320px;
  overflow: auto;
}
```

Run: `npx vitest run src/components/ChartCard.test.tsx src/components/ChartExportMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChartCard.tsx src/components/ChartCard.test.tsx src/components/ChartTable.tsx src/components/panels.css
git commit -m "feat(charts): ChartCard (chrome + five states + export row + table twin, fromCache from the frame) and ChartTable; tooltip/card CSS (spec §6, §7, §14)"
```

---

### Task 16: Fixtures and the conformance harness

**Files:**
- Create: `src/charts/fixtures/_types.ts`, `src/charts/fixtures/grammar-line.fixture.ts`, `grammar-stack.fixture.ts`, `grammar-heatmap.fixture.ts`
- Create: `src/charts/conformance.ts`, `src/charts/conformance.test.ts`

Spec §17 "Conformance": walk `charts/fixtures/*` and, per non-null option, assert token colours, grammar axis formatters by identity, named grids (cartesian/heatmap kinds), branded tooltips, bar marks (`barMaxWidth ≤ 24`, SURFACE border), scroll legends past 8, dashed only on references/annotations, a stagger on stacked bars. Fixtures declare exemptions; the rules are additive. C1 ships three synthetic fixtures built purely from the grammar — the harness's own proof — and the lanes add one per real builder.

- [ ] **Step 1: Write the failing test**

```ts
// src/charts/conformance.test.ts
import { describe, expect, it } from 'vitest'
import { checkConformance } from './conformance'
import type { ChartFixture } from './fixtures/_types'
import { BAR_MARKS, LINE, compactMoney, grid, moneyAxis, monthAxis, stagger } from './grammar'
import { legendFor } from './legend'
import { PALETTE } from './theme'
import { axisTooltip } from './tooltip'

// Vite's glob keeps the walk declarative: dropping a fixture file removes its cases, adding
// one adds them — nothing to register.
const modules = import.meta.glob<{ default: ChartFixture }>('./fixtures/*.fixture.ts', { eager: true })
export const fixtures = Object.values(modules).map((m) => m.default)

describe('conformance over the fixtures', () => {
  it('finds the three grammar fixtures at least', () => {
    expect(fixtures.map((f) => f.name)).toEqual(expect.arrayContaining(['grammar-line', 'grammar-stack', 'grammar-heatmap']))
  })
  for (const fixture of fixtures) {
    it(`${fixture.name} conforms`, () => {
      const option = fixture.build()
      expect(option, `${fixture.name} built null`).not.toBeNull()
      expect(checkConformance(option, fixture)).toEqual([])
    })
  }
})

// The rules must be able to FAIL: each negative case is one deviation from a conforming
// option, and the message names the rule.
describe('conformance rules reject', () => {
  const base = (): Record<string, unknown> => ({
    grid: grid(),
    legend: legendFor(2),
    tooltip: axisTooltip({ pointer: 'shadow' }),
    xAxis: monthAxis(['Jun 2026'], { gap: true }),
    yAxis: moneyAxis(),
    series: [
      { type: 'bar', name: 'A', stack: 's', ...BAR_MARKS, ...stagger(0), color: PALETTE[0], data: [1] },
      { type: 'bar', name: 'B', stack: 's', ...BAR_MARKS, ...stagger(1), color: PALETTE[1], data: [1] },
    ],
  })
  const fixture: ChartFixture = { name: 'neg', kind: 'cartesian', ariaLabel: 'x', build: () => null }
  const only = (option: Record<string, unknown>) => checkConformance(option, fixture)

  it('accepts the conforming base', () => expect(only(base())).toEqual([]))
  it('a literal grid', () => expect(only({ ...base(), grid: { left: 70, right: 16, top: 12, bottom: 28 } })[0]).toMatch(/grid/))
  it('a non-token colour, wherever it hides', () => {
    const o = base()
    ;(o.series as { color: string }[])[0].color = '#123456'
    expect(only(o)[0]).toMatch(/color #123456/)
    const nested = base()
    ;(nested.series as { data: unknown[] }[])[0].data = [{ value: 1, itemStyle: { color: 'rgba(0,0,0,0.5)' } }]
    expect(only(nested)[0]).toMatch(/color rgba/)
  })
  it('an inline axis formatter', () => {
    const o = base()
    o.yAxis = { type: 'value', axisLabel: { formatter: (v: number) => compactMoney(v) } }
    expect(only(o)[0]).toMatch(/formatter/)
  })
  it('an unbranded tooltip', () => expect(only({ ...base(), tooltip: { trigger: 'axis', formatter: () => '' } })[0]).toMatch(/branded/))
  it('a 46px bar or a bar without the surface border', () => {
    const wide = base()
    ;(wide.series as { barMaxWidth: number }[])[0].barMaxWidth = 46
    expect(only(wide)[0]).toMatch(/barMaxWidth/)
    const bare = base()
    ;(bare.series as { itemStyle: unknown }[])[0].itemStyle = { borderWidth: 1 }
    expect(only(bare)[0]).toMatch(/SURFACE border/)
  })
  it('a nine-entry plain legend', () => {
    const o = base()
    o.legend = { top: 0, type: 'plain' }
    o.series = Array.from({ length: 9 }, (_, i) => ({ type: 'bar', name: `S${i}`, stack: 's', ...BAR_MARKS, ...stagger(i), color: PALETTE[i % 8], data: [1] }))
    expect(only(o)[0]).toMatch(/scroll/)
  })
  it('a dashed DATA line', () => {
    const o = base()
    ;(o.series as unknown[]).push({ ...LINE, name: 'Data', lineStyle: { width: 2, type: 'dashed' }, color: PALETTE[2], data: [1] })
    expect(only(o)[0]).toMatch(/dashed/)
  })
  it('a stacked bar without a stagger', () => {
    const o = base()
    delete (o.series as Record<string, unknown>[])[1].animationDelay
    expect(only(o)[0]).toMatch(/stagger/)
  })
})
```

Run: `npx vitest run src/charts/conformance.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 2: Write the fixture type and the three grammar fixtures**

```ts
// src/charts/fixtures/_types.ts
// One fixture per builder (chart spec §17): a name, its form, the house aria sentence its
// mount will carry, declared exemptions for exotic forms, and a builder call over synthetic
// data. conformance.test.ts globs this folder.
import type { EChartsOption } from '../echarts'

export type FixtureKind = 'cartesian' | 'pie' | 'treemap' | 'sankey' | 'heatmap'
export type Exemption = 'grid' | 'axis' | 'legend'

export interface ChartFixture {
  name: string
  kind: FixtureKind
  /** The sentence the ChartCard mount uses — lanes copy it from here (F11). */
  ariaLabel: string
  exempt?: Exemption[]
  /** Series allowed to wear a dashed lineStyle beyond the grammar's own reference lines. */
  dashed?: string[]
  build: () => EChartsOption | null
}
```

```ts
// src/charts/fixtures/grammar-line.fixture.ts
import type { ChartFixture } from './_types'
import { LINE, WASH, grid, moneyAxis, monthAxis } from '../grammar'
import { PALETTE } from '../theme'
import { axisTooltip } from '../tooltip'

const fixture: ChartFixture = {
  name: 'grammar-line',
  kind: 'cartesian',
  ariaLabel: 'Synthetic: one washed line',
  build: () => ({
    grid: grid('noLegend'),
    xAxis: monthAxis(['Jun 2026', 'Jul 2026', 'Aug 2026']),
    yAxis: moneyAxis(),
    tooltip: axisTooltip({ unit: 'money' }),
    series: [{ ...LINE, name: 'Net worth', ...WASH, color: PALETTE[0], data: [1, 2, 3] }],
  }),
}
export default fixture
```

```ts
// src/charts/fixtures/grammar-stack.fixture.ts
import type { ChartFixture } from './_types'
import { BAR_MARKS, LINE, grid, moneyAxis, monthAxis, stagger } from '../grammar'
import { legendFor } from '../legend'
import { referenceLine } from '../reference'
import { INK, PALETTE } from '../theme'
import { axisTooltip } from '../tooltip'

const fixture: ChartFixture = {
  name: 'grammar-stack',
  kind: 'cartesian',
  ariaLabel: 'Synthetic: two stacked bars under a line with a reference',
  build: () => ({
    grid: grid(),
    legend: legendFor(4),
    tooltip: axisTooltip({ unit: 'money', groups: ['Rent', 'Food'], shareOf: true, references: ['Budget'], pointer: 'shadow' }),
    xAxis: monthAxis(['Jun 2026', 'Jul 2026'], { gap: true }),
    yAxis: moneyAxis(),
    series: [
      { type: 'bar', name: 'Rent', stack: 'spend', ...BAR_MARKS, ...stagger(0), color: PALETTE[0], data: [2000, 2000] },
      { type: 'bar', name: 'Food', stack: 'spend', ...BAR_MARKS, ...stagger(1), color: PALETTE[1], data: [600, null] },
      { ...LINE, name: 'Net pay', color: INK, z: 10, connectNulls: false, data: [6000, 6000] },
      referenceLine('Budget', [500, 500], { step: 'end' }),
    ],
  }),
}
export default fixture
```

```ts
// src/charts/fixtures/grammar-heatmap.fixture.ts
import type { ChartFixture } from './_types'
import { grid, monthAxis } from '../grammar'
import { sequentialVisualMap } from '../scales'
import { INK, SURFACE } from '../theme'
import { itemTooltip } from '../tooltip'
import { formatCurrencyCompact } from '../../utils/format'

const fixture: ChartFixture = {
  name: 'grammar-heatmap',
  kind: 'heatmap',
  ariaLabel: 'Synthetic: a two-row heatmap on the sequential scale',
  exempt: ['axis'],
  build: () => ({
    grid: grid('heatmap'),
    tooltip: itemTooltip<{ value?: [number, number, number] }>({ body: (p) => ({ value: p.value?.[2] ?? 0, label: 'cell' }) }),
    xAxis: monthAxis(['Jun 2026', 'Jul 2026'], { gap: true, rotate: 45 }),
    yAxis: { type: 'category', data: ['Rent', 'Food'], inverse: true, axisLabel: { width: 118, overflow: 'truncate' as const } },
    visualMap: sequentialVisualMap({ min: 0, max: 2000, formatter: formatCurrencyCompact }),
    series: [{ type: 'heatmap', data: [[0, 0, 2000], [1, 1, 600]], itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } } }],
  }),
}
export default fixture
```

- [ ] **Step 3: Write the rule set**

```ts
// src/charts/conformance.ts
// The grammar enforced structurally (chart spec §17). Pure: option in, a list of violations
// out — an empty list is conformance. Rules are additive so a lane can land before a rule
// tightens; fixtures declare exemptions for exotic forms (pie/treemap/sankey have no grid).
import { DARK } from '../theme/tokens'
import type { ChartFixture } from './fixtures/_types'
import { compactMoney, isGridVariant, percentLabel } from './grammar'
import { MUTED, SURFACE } from './theme'
import { isGrammarTooltip } from './tooltip'

// Every hex a builder may emit: the DARK tokens, scalars and ramps alike (builders never
// branch on theme — recolor.ts maps these under light).
const TOKEN_HEXES = new Set(
  Object.values(DARK)
    .flatMap((value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? [...value] : []))
    .map((hex) => hex.toLowerCase()),
)
const ALLOWED_WORDS = new Set(['transparent', 'source', 'inherit'])
const COLOR_KEYS = new Set(['color', 'borderColor', 'backgroundColor', 'pageIconColor', 'shadowColor'])

interface SeriesLike {
  type?: string
  name?: string
  stack?: string
  silent?: boolean
  barMaxWidth?: number
  itemStyle?: { borderColor?: string }
  lineStyle?: { type?: string; width?: number }
  color?: string
  z?: number
  tooltip?: { show?: boolean }
  animationDelay?: unknown
}
interface AxisLike {
  type?: string
  axisLabel?: { formatter?: unknown }
}

const asList = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : value === undefined || value === null ? [] : [value as T])

function walkColors(value: unknown, path: string, report: (color: string, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkColors(item, `${path}[${i}]`, report))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${key}`
    if (COLOR_KEYS.has(key)) {
      for (const color of asList<unknown>(item)) if (typeof color === 'string') report(color, here)
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) walkColors(item, here, report) // gradient literals
      continue
    }
    walkColors(item, here, report)
  }
}

/** A grammar reference line (charts/reference.ts) — dashed by definition. */
const isReference = (s: SeriesLike) =>
  s.lineStyle?.type === 'dashed' && s.lineStyle.width === 2 && s.color === MUTED && s.z === 9

export function checkConformance(option: unknown, fixture: ChartFixture): string[] {
  const problems: string[] = []
  const o = (option ?? {}) as Record<string, unknown>
  const exempt = new Set(fixture.exempt ?? [])
  const series = asList<SeriesLike>(o.series)

  // 1. Colours: token hexes, 'transparent', 'source' — nothing invented, nothing rgba().
  walkColors(o, 'option', (color, path) => {
    if (!TOKEN_HEXES.has(color.toLowerCase()) && !ALLOWED_WORDS.has(color)) problems.push(`${path}: color ${color} is not a token`)
  })

  // 2. Value/log axes label through the grammar's formatters, by identity.
  if (!exempt.has('axis')) {
    for (const [name, axes] of [['xAxis', asList<AxisLike>(o.xAxis)], ['yAxis', asList<AxisLike>(o.yAxis)]] as const) {
      axes.forEach((axis, i) => {
        if (axis.type !== 'value' && axis.type !== 'log') return
        const f = axis.axisLabel?.formatter
        if (f !== compactMoney && f !== percentLabel) problems.push(`${name}[${i}]: value-axis formatter is not the grammar's (compactMoney/percentLabel)`)
      })
    }
  }

  // 3. Grid is a named variant on cartesian and heatmap forms.
  if (!exempt.has('grid') && (fixture.kind === 'cartesian' || fixture.kind === 'heatmap') && !isGridVariant(o.grid)) {
    problems.push('grid is not a named variant (grammar.ts GRID_VARIANTS)')
  }

  // 4. The tooltip formatter is branded by tooltip.ts or sankey.ts.
  const tooltip = o.tooltip as { formatter?: unknown } | undefined
  if (tooltip === undefined || !isGrammarTooltip(tooltip.formatter)) problems.push('tooltip formatter is not branded by tooltip.ts or sankey.ts')

  for (const s of series) {
    const label = s.name ?? s.type ?? 'series'
    // 5. Bars: capped at 24px, the SURFACE hairline. Silent placeholders (the waterfall floor) are exempt.
    if (s.type === 'bar' && s.silent !== true) {
      if (!(typeof s.barMaxWidth === 'number' && s.barMaxWidth <= 24)) problems.push(`${label}: barMaxWidth must be ≤ 24`)
      if (s.itemStyle?.borderColor !== SURFACE) problems.push(`${label}: bars carry the SURFACE border`)
      // 8. Stacked bars stagger in (a function delay — invisible to the fingerprint).
      if (s.stack !== undefined && typeof s.animationDelay !== 'function') problems.push(`${label}: stacked bars carry a stagger`)
    }
    // 7. Dashed only on references (the grammar's own or the fixture's declared annotations).
    if (s.lineStyle?.type === 'dashed' && !isReference(s) && !(fixture.dashed ?? []).includes(s.name ?? '')) {
      problems.push(`${label}: dashed lineStyle only on reference/annotation series`)
    }
  }

  // 6. Legends past eight entries scroll.
  const legend = o.legend as { type?: string; data?: unknown[] } | undefined
  if (!exempt.has('legend') && legend !== undefined) {
    const count = legend.data?.length ?? series.filter((s) => s.name !== undefined && s.tooltip?.show !== false).length
    if (count > 8 && legend.type !== 'scroll') problems.push(`legend has ${count} entries and must scroll`)
  }

  // 9. The mount's sentence exists.
  if (fixture.ariaLabel.trim() === '') problems.push('fixture needs an ariaLabel')
  return problems
}
```

Run: `npx vitest run src/charts/conformance.test.ts`
Expected: PASS — 3 fixture cases + the rule cases.

- [ ] **Step 4: Commit**

```bash
git add src/charts/fixtures src/charts/conformance.ts src/charts/conformance.test.ts
git commit -m "test(charts): conformance harness over fixtures — token colours, grammar axes, named grids, branded tooltips, bar marks, scroll legends, dashed-only-references, stagger (spec §17)"
```

---

### Task 17: Type-check, lint, full suite

- [ ] **Step 1: Run everything**

```bash
npx tsc -b
npx eslint .
npx vitest run
```

Expected: all green. `eslint` may warn `react-refresh/only-export-components` on `ChartCard.tsx` if a type is exported alongside the component — type exports are allowed; a VALUE export there is the thing to move into `src/charts/`.

- [ ] **Step 2: Commit anything the runs touched, then hand off**

```bash
git status --short
git commit -am "chore(charts): C1 primitives green — tsc, eslint, vitest" # only if anything changed
```

Merge `charts-c1` into `main` (fast-forward or a merge commit — local only), then dispatch C2–C6 in parallel worktrees from the merged `main`.

---

## Self-review

**Spec coverage (§ of the design):** §5 module map → Tasks 4–9 (`grammar`, `tooltip`, `legend`, `reference`, `markLine`, `scales`, `entities`, `waterfall`), 3 (`motion`/`theme`), 10 (`echarts.ts`), 14–15 (`ChartCard`, `ChartTable`, export menu), 11–12 (`useReducedMotion`, decals + Appearance), 16 (fixtures + conformance). §6 ChartCard props and states → Task 15 (every listed prop; success criteria are C7's audits). §7 tooltip contract → Task 5 (row order, unit, groups/total/shareOf/references/annotations/absentText, escaping, CSS-variable swatches, shadow pointer; `BAND_MARKER` → `swatch(…, { wash })` is C5's use). §8 grids/axes/alignment → Task 4 (variants, `moneyAxis`, `pctAxis`, `monthAxis`) + Task 13 (`group` → `connect`). §9 legends → Task 6 (`legendFor`, `FOCUS`). §10 references/annotations → Tasks 6–7. §11 motion → Tasks 3, 4 (`stagger`), 11, 13. §12 colour → Tasks 2 (diverging), 8 (visual maps), 9 (entities). §13 number formatting → Task 4 (`compactMoney`, `percentLabel`, one `roundTo`/`cents`). §14 accessibility/export → Tasks 12–15 (decals, Table, Copy, captioned PNG; `ariaLabel` required is C7). §17 conformance → Task 16. Review leftovers → Tasks 1 (three) and C6 Task 1 (`TAX_COLORS[2]`). Deviation recorded: §20's "disconnect on dispose" is deliberately not called (group-wide) — Task 13 explains and pins connect-per-init instead. **Placeholders:** none — every step carries its code or its exact command. **Type consistency:** `grid()`/`GridVariant`, `moneyAxis({ zero, log })`, `pctAxis({ floor, ceiling })`, `monthAxis(labels, { gap, rotate })`, `BAR_MARKS`/`LINE`/`WASH`/`STACK_WASH`/`capLabel`, `stagger(i)`, `axisTooltip({ unit, groups, totalLabel, shareOf, references, annotationSeries, annotations, rowSuffix, footer, absentText, pointer })`, `itemTooltip({ unit, body })`, `swatch(color, { shape, wash })`, `brandTooltip`/`isGrammarTooltip`, `legendFor(count, selected)`, `referenceLine(name, data, { step, id })`/`budgetReference`, `anchorLabel`/`ruleAt`/`annotationRules`/`todayRule`/`arrivalRule`/`afterArea`/`percentileMarks`/`zeroLine`, `sequentialVisualMap`/`divergingVisualMap({ span, center, formatter, labels, highArm })`/`rowNormalize`/`vsAverage`, `personSlot`/`slotColor`/`lowestFreeSlot`/`foldColor`, `waterfallSteps`/`waterfallSeries`/`waterfallTooltip`/`waterfallCsv`, `sankeyCsv`, `ChartFixture { name, kind, ariaLabel, exempt, dashed, build }`, `checkConformance(option, fixture)`, `ChartCardProps`, `ExportConfig { name, csv, title, caption }`, `useReducedMotion`/`prefersReducedMotion`, `useChartDecals`/`setChartDecals`/`readChartDecals` are used with these exact names in C2–C7.

