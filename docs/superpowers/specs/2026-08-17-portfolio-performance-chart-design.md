# Portfolio Performance Chart — Design

**Date:** 2026-08-17
**Status:** Approved pending user spec review

## Goal

Reproduce the finances.xlsx "Portfolio Summary" tab's main chart — the area chart
titled **"Portfolio Value over Time"** (portfolio value, cost basis, and an S&P 500
baseline, weekly) — inside the app:

1. On the **Portfolio page**, above the Holdings section.
2. On the **Overview page**, replacing the "Allocation by type" donut.
3. Overview layout change: the net worth, portfolio performance, and recent
   spending charts each occupy a **full-width row**, in that order.
4. The portfolio-value line additionally shows a **live final datapoint** (current
   market value from latest prices), visually distinct via a ping/ripple effect.

## Source data (verified 2026-08-17 against the real workbook)

The "Portfolio Summary" sheet is chart-only (no cells). The chart's series resolve
to hidden columns on the **"Portfolio"** sheet, rows 3+:

| Col | Content | Fate |
|-----|---------|------|
| AB (28) | snapshot date (weekly, Mondays) | imported |
| AC (29) | portfolio market value | imported |
| AD (30) | portfolio % change WoW | ignored (derivable) |
| AE (31) | S&P 500 baseline value | imported |
| AF (32) | S&P baseline % change | ignored |
| AG (33) | cost basis | imported |
| AH (34) | cost basis % change | ignored |

Current contents: 147 rows, 2023-10-23 → 2026-08-10, dates strictly increasing,
all three value columns numeric (verified clean). The chart range is padded to
row 2153; the parser must bound its scan and stop on a blank streak, not trust
the range.

**S&P baseline semantics:** the sheet benchmarks only the *starting* balance
($53,619 ≈ 138.798 VOO shares bought at series start). Later contributions are
not added to it, so it reads far below the portfolio line. The app replicates
this faithfully and labels honestly (see Chart section). The benchmarked-shares
constant exists only in the sheet — the app cannot honestly extend this series.

## Decisions (user-ratified)

- **Import-only data flow.** The series is whatever the last workbook import
  carried; it advances on re-import. No app-side appending job. (Live-append was
  considered and deferred; the schema supports adding it later.)
- **Live final datapoint on the Portfolio-value line only**, frontend-only,
  sourced from data both pages already fetch (`holdings.totals.market_value`,
  `holdings.as_of`). Cost basis and S&P baseline end at the last imported row.
- **Rejected alternatives:** deriving history from `position_transactions` ×
  `price_history` (impossible: most transactions are undated by design, and price
  history predating the app doesn't exist); parsing the chart XML for ranges
  (over-engineered; fixed sheet layout is the importer's idiom).
- **Excel's overlapping-opaque-areas styling is not replicated** (occlusion
  anti-pattern); see Chart section for the house form.
- The sheet's companion "% Change over Time" line chart is **out of scope**.

## Data model + migration

New table `portfolio_value_history`:

| Column | Type | Notes |
|--------|------|-------|
| id | int PK | |
| snapshot_date | Date, unique | named to dodge the documented `date`-shadowing hazard (see PriceHistory.price_date) |
| market_value | Numeric(14,2) | |
| cost_basis | Numeric(14,2) | |
| sp500_value | Numeric(14,2) | |

One purely additive Alembic migration. **First migration since the Plan 6
"zero-migrations" deploy** — the deploy runbook step gains `alembic upgrade head`;
order-safe both directions (old code never touches the table, no backfill).

## Importer

- `parse_portfolio` gains a second bounded scan (`_iter_rows`, blank-streak stop,
  max_row 6000 — comfortably above the chart's padded range ending at row 2153)
  over AB/AC/AE/AG from row 3.
- `ParsedPortfolio` gains `history: list[ParsedValuePoint]`
  (`snapshot_date: date`, `market_value/cost_basis/sp500_value: Decimal` Q2).
- Strict (house posture — errors block the whole apply): non-date in AB with any
  value present, unparseable value cell, duplicate or non-increasing dates.
  Fully-blank rows skipped; a date with all three values missing is an error.
- New `apply_portfolio_history(db, parsed, report)`: upsert by `snapshot_date`
  via the existing create-or-`_diff_update` pattern; counts + samples under the
  existing `"portfolio"` sheet report key (bucket `portfolio_value_history`).
  **No deletes** — the series is append-only in the sheet; a vanished date row is
  left in place (same posture as net-worth snapshots). *(Superseded 2026-08-21:
  re-upload now overrides — rows absent from the workbook up to its last date are
  deleted; see `apply_portfolio_history`.)* Wired into
  `service.run_import` alongside the other appliers; dry-run/apply symmetry free.
- Idempotent: re-importing the same workbook yields 0 creates / 0 updates.

## API

`GET /portfolio/history` (same router/auth as the rest of `/portfolio`), ordered
by `snapshot_date` ascending:

```json
{
  "dates": ["2023-10-23", "..."],
  "market_value": ["53619.00", "..."],
  "cost_basis": ["53619.00", "..."],
  "sp500": ["53619.00", "..."]
}
```

Parallel arrays, decimals-as-strings (NetWorthTimeseries convention). Empty table
→ empty arrays, 200 (not 404).

## Chart (shared pure builder)

New `src/components/portfolio/historyChartOptions.ts` (+ unit tests), same posture
as `overviewChartOptions.ts`: pure option builder, `Number()` at the display
boundary only, no theme decisions of its own.

`portfolioHistoryOption(history, live?)` where `live` is
`{ date: string, value: number } | null` (derived by callers: the calendar-date
part of `holdings.as_of` — the quote timestamp — plus
`Number(totals.market_value)`; null when `as_of` is null).

- **Form:** three 2px lines, no point symbols; faint area wash under the
  Portfolio-value line only (netWorthSparkOption precedent). Y axis from zero
  (visible axis + fill = honest baseline), `formatCurrencyCompact` labels.
  Category x-axis of dates, `boundaryGap: false`, auto-thinned labels. Legend
  top (≥2 series ⇒ legend mandatory). Axis tooltip with `formatCurrency`.
- **Colors by fixed validated slot, never reordered:** Portfolio value =
  `PALETTE[0]` blue, Cost basis = `PALETTE[1]` orange, S&P 500 baseline =
  `PALETTE[2]` aqua.
- **Live point:** same blue (same entity — a new hue would read as a fourth
  series); `effectScatter` single point with ripple ("ping"), dashed 2px
  connector segment from the last imported point (dashed = provisional), its own
  "Live" legend entry, and a "Live" row in the shared axis tooltip under that
  category's date header (the date is the header, so a separate "prices as of
  <date>" string would repeat it). Under `prefers-reduced-motion` the ripple is
  neutralized (`rippleEffect.number: 0`) by `src/charts/motion.ts` — echarts
  starts ripple animators regardless of the global `animation` flag. Rendered only when
  a quote exists and its date ≥ the last imported date; if equal, the ping sits
  on the last category with no new category/connector. Self-retires otherwise.
- Returns null when the imported series has < 2 points → pages show an empty
  note ("No performance history yet — import your workbook in Settings to load
  it.").
- Series names: "Portfolio value", "Cost basis", "S&P 500 baseline", "Live".

## Portfolio page

New `<section className="panel">` titled **Performance** between the stat-tiles
row and the Holdings panel. `fetchHistory()` joins the existing `Promise.all`
(9th request; same seqRef discipline). EChart height ≈300. Beneath the chart, a
one-line `.hint`: the S&P 500 baseline tracks the starting balance invested in
VOO — later contributions aren't added to it. Empty state per above.

## Overview page

- `fetchAllocation('type')` → `fetchHistory()` in the snapshot `Promise.all`
  (still 6 requests, one coherent payload; `allocation` leaves `OverviewData`,
  `history` enters).
- Card grid becomes three `span-12` rows in order: **Net worth trend → Portfolio
  performance → Recent spending**, each keeping its drill link. Donut imports
  (`donutOption`, `positiveSlices`) removed — the allocation donut still lives on
  the Portfolio page's AllocationPanel, so nothing is lost.
- Same shared builder, height ≈280, live point included (holdings are already in
  the snapshot). Net worth spark stays the axis-free spark, now full width.
- The obsolete span-8/span-4 comment about the donut legend goes with the donut.

## Tests

- **Parser:** happy-path extraction (dates/values, Q2), blank-streak stop, bad
  value cell → sheet error, duplicate and non-increasing dates → errors, hollow
  columns (no history rows) → empty list without error.
- **Applier:** creates on first import; idempotent second pass (0/0); changed
  value → one diff update; counts/samples in report.
- **API:** empty table → empty arrays; populated ordering; auth required.
- **Builder units:** null under 2 points; series-to-slot color mapping; live
  point present/absent/equal-date rules; dashed connector only when a new
  category is appended.
- **Pages:** Overview test mocks swap allocation → history (and keep snapshot
  atomicity assertions); Portfolio page test gains the fetchHistory mock;
  empty-state rendering on both.

## Deployment / ops notes

- Run `alembic upgrade head` with the deploy (first migration since Plan 6; the
  README §7 runbook's migration step applies unchanged).
- Charts stay in their empty state until the next workbook import seeds
  `portfolio_value_history`.
- Import report: the new counts bucket surfaces via the existing generic
  ImportReportView rendering (verify at implementation; adjust the view only if
  it hard-codes bucket names).
