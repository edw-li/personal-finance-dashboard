# Net Worth over Time (Projected) — Projection-tab chart

**Date:** 2026-08-19
**Status:** Approved (user-validated brainstorm)
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

1. **Model:** faithful exponential best-fit to the monthly net-worth history — not the
   tab's knob-driven compounding, not both.
2. **Horizon:** follows the tab's existing Horizon (`years`) knob via the projection
   response echo. One horizon for the whole page; setting it to ~40 reproduces the
   sheet's sweep to 2065.
3. **Compute location:** client-side. The page fetches the existing
   `GET /net-worth/timeseries` and a pure TS module does the fit. Float math is
   display-only and never handed back to the API (format.ts's Number() rule).

## The fit — `src/components/projection/expTrend.ts` (new pure module)

The `attention.ts`/`ytd.ts` precedent: page-adjacent pure logic, no React, no fetching.

- Excel's `exp` trendline is least squares on `(x, ln y)`: slope `b`, intercept `a`,
  giving `y = e^(a + b·x)`.
- **x is the calendar month serial** `year*12 + (month − 1)` parsed from the ISO month
  string — NOT the array index — so a skipped snapshot month cannot compress time and
  skew the rate (Excel fits on true dates; serials are the equivalent under monthly
  data). Module-private `monthSerial(iso)` helper; same index formula `addMonths` uses.

```ts
export interface ExpTrendFit {
  /** e^b — fitted month-over-month growth factor. */
  monthlyGrowth: number
  /** monthlyGrowth^12 − 1, fraction form — feeds formatPct directly. */
  annualRate: number
  /** Fitted value at any ISO month ('YYYY-MM-…'): e^(a + b·serial). */
  valueAt(monthIso: string): number
}

export function fitExpTrend(months: string[], values: string[]): ExpTrendFit | null
```

Returns **null** (fit refused) when:
- fewer than 2 points, or
- any `Number(value)` is not finite or ≤ 0 (Excel's own refusal for exp trendlines —
  ln is undefined), or
- the x-variance is 0 (degenerate duplicate-month input; impossible from the server,
  guarded for totality).

`values` are the server's Decimal strings, parsed once with `Number()` — display-only.

## The builder — `netWorthProjectionOption` (added to `projectionChartOptions.ts`)

Same file as the sibling builder — the projection module's chart file. Pure, no theme
decisions of its own.

```ts
export const NET_WORTH_PROJECTION_SERIES = ['Net worth', 'Exponential trend'] as const

export function netWorthProjectionOption(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: ExpTrendFit | null,          // page computes once, passes in (no double-compute)
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
  history values `Number()`-parsed then null-padded across the continuation, and a
  **higher `z` than the trend** so dots stay visible where the curve passes through them.
- **Series 2 "Exponential trend":** `type: 'line'`, `symbol: 'none'`, solid width 2,
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
- **Mount-only** second effect: `fetchTimeseries('month')` with promise callbacks
  (`.then(setHistory)` / `.catch` → `historyError` via the page's `message()` helper,
  fallback sentence `'Failed to load net-worth history'`). **Not refetched on
  Recalculate** — history doesn't change with knobs; the horizon reaches the chart
  through the projection echo (`data.start_month`, `data.years`), so the Horizon knob +
  Recalculate re-extends the curve with zero new form state.
- Derivations are plain per-render calls (the page's existing `chart = projectionOption(data)`
  pattern): `fit = history ? fitExpTrend(history.months, history.net_worth) : null`,
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
     - fit present: *"Exponential best-fit over every monthly net-worth snapshot,
       extended {years} years — history implies ≈{formatPct(fit.annualRate,
       {signed: false})}/yr. Momentum, not a plan; the knob-driven model is the chart
       below."* (the implied rate is the fit's own output — the number the sheet never
       showed)
     - fit refused (≥2 points, some value ≤ 0): *"The exponential trendline needs every
       net-worth snapshot above zero — showing the history alone."*

## Testing

- **`expTrend.test.ts` (new):** recovers a known rate (months at 1000·1.01^i →
  `monthlyGrowth` ≈ 1.01, `annualRate` ≈ 1.01^12 − 1, `toBeCloseTo`); a gap-month series
  still recovers the true rate (serial-x correctness); refusals — single point, a zero
  value, a negative value → null; `valueAt` reproduces a perfect series' points and
  extends beyond them. Synthetic values only.
- **`projectionChartOptions.test.ts` (extend):** null under 2 history points; axis =
  history + continuation ending exactly at `addMonths(startMonth, years*12)`; dot data
  null-padded to axis length; trend data spans the full axis; trend series absent when
  fit is null; dataZoom present; dots' `z` above the trend's; a history month at or past
  the horizon end yields an empty continuation (axis = history months verbatim).
- **`ProjectionPage.test.tsx` (extend):** mock `../api/netWorth` with a resolved fixture
  in the default beforeEach (existing tests keep passing); new card renders with the
  eyebrow and chart; hint carries the implied %/yr; history rejection → card empty-note
  while tiles/sibling chart/form still render; `fetchTimeseries` called once and NOT
  re-called on Recalculate.

## Non-goals / constraints

- No backend or wire changes; no new knobs; no log-scale axis; no y-axis cap (the
  sheet's manual $50M clamp is replaced by dataZoom); no notes/annotation layer on this
  chart; Overview and NetWorthPage untouched.
- No new echarts component registrations (Scatter + Line already in the bundle) — the
  chunk advisory (720 kB) is not expected to move.
- Never copy real workbook dollar values into fixtures, code, or docs (standing rule).
