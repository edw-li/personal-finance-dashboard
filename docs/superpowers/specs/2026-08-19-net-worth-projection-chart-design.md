# Net Worth over Time (Projected) — Projection-tab chart

**Date:** 2026-08-19
**Status:** Approved (user-validated brainstorm); **revised same day after first ship** —
the fit changed from Excel's `exp` trendline to a **second-degree polynomial** at the
user's request (the exponential outgrows the axis so fast the visible history flattens
into the floor; the user also recalls the sheet originally using a poly-2 trendline —
the current file carries `exp`, but the polynomial is the picture they want).
**Scope:** Frontend only — no backend changes, no migrations, no new endpoints.

## Goal

Port the finances.xlsx "Net Worth over Time (Projected)" chart (Net Worth Summary sheet)
onto the `/projection` page, placed directly **above** the existing "Projected investable
balance" card. The sheet's chart is a scatter of actual monthly net worth with an Excel
**exponential trendline** (`exp` type) extended across blank future months — the
extension IS the projection; there are no assumptions or knobs, the growth rate is
derived entirely from history. This chart answers a different question than the sibling
card ("if my net worth keeps growing the way it has, where does it land?") and the page
carries that distinction in words.

## Decisions (user-confirmed)

1. **Model:** a trendline fitted to the monthly net-worth history — not the tab's
   knob-driven compounding, not both. Originally the exponential fit; **revised to a
   second-degree polynomial least-squares fit** (see Status).
2. **Horizon:** follows the tab's existing Horizon (`years`) knob via the projection
   response echo. One horizon for the whole page; setting it to ~40 reproduces the
   sheet's sweep to 2065.
3. **Compute location:** client-side. The page fetches the existing
   `GET /net-worth/timeseries` and a pure TS module does the fit. Float math is
   display-only and never handed back to the API (format.ts's Number() rule).

## The fit — `src/components/projection/polyTrend.ts` (new pure module)

The `attention.ts`/`ytd.ts` precedent: page-adjacent pure logic, no React, no fetching.

- A second-degree polynomial trendline: least squares of `y = c0 + c1·x + c2·x²`
  (3×3 normal equations solved by Cramer's rule — dependency-free).
- **x is the calendar month serial** `year*12 + (month − 1)` parsed from the ISO month
  string — NOT the array index — so a skipped snapshot month cannot compress time and
  bend the curve (Excel fits on true dates; serials are the equivalent under monthly
  data). Exported `monthSerial(iso)` helper (the builder reuses it for the continuation
  count); same index formula `addMonths` uses. Inside the fit, x is **offset from the
  first month's serial** so the sums stay small exact integers in float64 (raw serials
  ~24000 would push Σx⁴ past 2^53 and shred the conditioning) — and because the S-sums
  are exact integers, a degenerate x-set makes the determinant EXACTLY zero, so the
  singularity guard is sound.

```ts
export interface PolyTrendFit {
  /** Fitted value at any ISO month ('YYYY-MM-…'): c0 + c1·x + c2·x². */
  valueAt(monthIso: string): number
}

export function fitPolyTrend(months: string[], values: string[]): PolyTrendFit | null
```

Returns **null** (fit refused) when:
- fewer than 3 points (a unique parabola needs three), or
- any `Number(value)` is not finite, or
- the normal equations are singular (fewer than three DISTINCT months; impossible from
  the server, guarded for totality).

Unlike the exponential fit there is **no positivity rule** — a parabola is happy through
zero and below. `values` are the server's Decimal strings, parsed once with `Number()`
— display-only.

## The builder — `netWorthProjectionOption` (added to `projectionChartOptions.ts`)

Same file as the sibling builder — the projection module's chart file. Pure, no theme
decisions of its own.

```ts
export const NET_WORTH_PROJECTION_SERIES = ['Net worth', 'Quadratic trend'] as const

export function netWorthProjectionOption(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: PolyTrendFit | null,         // page computes once, passes in (no double-compute)
  startMonth: string,               // ProjectionOut.start_month
  years: number,                    // ProjectionOut.years
): EChartsOption | null
```

- **Null under 2 history points** (sibling builder's posture) — the card shows an
  empty-note instead.
- **Axis:** category months = `history.months` + a generated continuation. The horizon
  end is `addMonths(startMonth, years*12)` — the SAME final month as the sibling chart.
  Continuation runs from the month after the LAST history month to that end,
  `max(0, …)` months long: a future-dated snapshot (e.g. the 2026-09-01 entry) simply
  shortens or empties the continuation; the axis stays monotonic. `boundaryGap: false`.
- **Series 1 "Net worth":** `type: 'scatter'` (already registered in `charts/echarts.ts`),
  `PALETTE[0]` blue (net worth's app-wide color identity), `symbolSize: 6`,
  history values `Number()`-parsed and UNPADDED — on a category axis the shorter series
  simply ends where history does (no null-typing friction; beyond history the tooltip
  lists the trend alone), and a
  **higher `z` than the trend** so dots stay visible where the curve passes through them.
- **Series 2 "Quadratic trend":** `type: 'line'`, `symbol: 'none'`, solid width 2,
  `PALETTE[1]` orange (on this page orange = derived growth model; dashed stays reserved
  for thresholds), **no area wash** (an area under a 30-year exponential swallows the
  chart), data = `axisMonths.map((m) => fit.valueAt(m))` — drawn over history too, like
  Excel's trendline, so fit-vs-dots is visible. **Omitted entirely when `fit` is null**
  (dots-only chart; the card's hint explains why).
- **Legend:** top 0, with `data` entries so the scatter's swatch renders as
  `icon: 'circle'` — the two entries stay tellable apart.
- **Axes/tooltip/zoom:** zero-anchored value axis with `formatCurrencyCompact` labels;
  axis-trigger tooltip with the sibling's `valueFormatter` (null → '—', else
  `formatCurrency`); `dataZoom: timeZoom(axisMonths, 'all')` (ctrl+wheel over the long
  axis); grid `{ left: 76, right: 24, top: 40, bottom: 28 }` matching the sibling.

## Page wiring — `ProjectionPage.tsx`

- New state: `history: NetWorthTimeseries | null`, `historyError: string | null`.
- **Mount-only** second effect: `fetchTimeseries()` (the client's `'monthly'` default)
  with promise callbacks
  (`.then(setHistory)` / `.catch` → `historyError` via the page's `message()` helper,
  fallback sentence `'Failed to load net-worth history'`). **Not refetched on
  Recalculate** — history doesn't change with knobs; the horizon reaches the chart
  through the projection echo (`data.start_month`, `data.years`), so the Horizon knob +
  Recalculate re-extends the curve with zero new form state.
- Derivations are plain per-render calls (the page's existing `chart = projectionOption(data)`
  pattern): `fit = history ? fitPolyTrend(history.months, history.net_worth) : null`,
  then `nwChart = history && data ? netWorthProjectionOption(…) : null`.
- **Placement:** inside the existing `data && (…)` branch (inherits the 404 → wizard
  empty state), **after the warnings block, before the investable chart card**:

  ```
  KPI row → warnings → NEW "Net worth over time (projected)" card
          → "Projected investable balance" card → Assumptions card
  ```

- Card: `<section className="card projection-chart-card">`, eyebrow
  **"Net worth over time (projected)"** (sheet's name, house casing), `EChart height={340}`.
  Existing classes only — no CSS changes expected.
- Card body branches, in order:
  1. `historyError` → `empty-note` with the error sentence (advisory, never the
     page-level error banner — the rest of the page is untouched).
  2. still loading (`history === null`, no error) → `empty-note` "Loading net-worth
     history…".
  3. builder returned null (<2 snapshots) → `empty-note` "Not enough monthly snapshots
     to chart yet."
  4. chart → `EChart` + hint line (`drill-hint`):
     - fit present: *"Second-degree polynomial best-fit over every monthly net-worth
       snapshot, extended {years} years — momentum, not a plan; the knob-driven model is
       the chart below."* (a parabola has no single growth rate, so no implied-%/yr claim)
     - fit refused (exactly 2 points — the chart draws, the parabola can't): *"The
       polynomial trendline needs at least three snapshots — showing the history alone."*

## Testing

- **`polyTrend.test.ts` (new):** recovers a known quadratic (values at 1000 + 50x + 2x²,
  `toBeCloseTo`); a gap-month series still recovers the generator (serial-x correctness);
  zero/negative values FIT (no positivity rule); refusals — under three points,
  non-finite value, mismatched lengths, duplicate months → null; `valueAt` reproduces a
  perfect series' points and extends beyond them. Synthetic values only.
- **`projectionChartOptions.test.ts` (extend):** null under 2 history points; axis =
  history + continuation ending exactly at `addMonths(startMonth, years*12)`; dot data
  spans exactly the history months; trend data spans the full axis; trend series absent when
  fit is null; dataZoom present; dots' `z` above the trend's; a history month at or past
  the horizon end yields an empty continuation (axis = history months verbatim).
- **`ProjectionPage.test.tsx` (extend):** mock `../api/netWorth` with a resolved fixture
  in the default beforeEach (existing tests keep passing); new card renders with the
  eyebrow and chart; hint names the model; history rejection → card empty-note
  while tiles/sibling chart/form still render; `fetchTimeseries` called once and NOT
  re-called on Recalculate.

## Non-goals / constraints

- No backend or wire changes; no new knobs; no log-scale axis; no y-axis cap (the
  sheet's manual $50M clamp is replaced by dataZoom); no notes/annotation layer on this
  chart; Overview and NetWorthPage untouched.
- No new echarts component registrations (Scatter + Line already in the bundle) — the
  chunk advisory (720 kB) is not expected to move.
- Never copy real workbook dollar values into fixtures, code, or docs (standing rule).
