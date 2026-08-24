# Contribution-Matched Benchmark Line — Design Spec

**Date:** 2026-08-24 · **Status:** approved, not yet implemented
**Touches:** `services/value_history.py` (new pure computation), `api/portfolio.py` history endpoint + `schemas/portfolio.py`, `src/types/api.ts`, `src/components/portfolio/historyChartOptions.ts` (+ tests). **No migration; no stored state.**

## 1. Context & goals

The performance chart's "S&P 500 baseline" invests only the **starting** balance into VOO (`PortfolioValueHistory.sp500_value` — sheet-parity semantics, documented on the column). For an account receiving contributions every month, the portfolio line outruns it by construction: the comparison is decorative. The goal is a second benchmark line answering the real question — *"what if every dollar I put in had bought VOO instead?"* — without requiring dated transactions (positions are mostly undated by design).

**Key enabler (verified 2026-08-24):** the weekly series already stores `(snapshot_date, market_value, cost_basis)`, and VOO daily closes are in `price_history` (they power the existing baseline leg via `_baseline_close_on_or_before`). Week-over-week **cost-basis deltas are a usable proxy for contribution flows**, so the whole series is computable from stored data.

### User-confirmed decisions (2026-08-24 Q&A)

- The new line is **in addition to** the existing baseline — both render; neither replaces the other.
- **Read-time computation**, not a stored column (below).

## 2. Computation — pure function in `services/value_history.py`

```
benchmark[0] = market_value[0]                       # parity seed, the sheet's own t0 posture
flow[t]      = cost_basis[t] − cost_basis[t−1]       # contribution proxy (may be negative)
benchmark[t] = benchmark[t−1] × (close[t] / close[t−1]) + flow[t]
```

- `close[t]` = VOO close on-or-before `snapshot_date[t]` (reuse the existing on-or-before lookup, batched: **one** window-ranked query for all snapshot dates, not one per row — the `_closes_on_or_before` pattern).
- **Missing close** at either end of a step ⇒ growth factor 1 (carry flat) — the existing baseline leg's own rule; the flow still lands.
- **Guard:** if `benchmark[t−1] ≤ 0` after a large negative flow, clamp the growth term at 0 before adding the flow (a hypothetical account can be fully drained; it must not go negative via multiplication).
- Output quantizes to `MONEY_Q` HALF_UP per row (module convention). Pure of the DB: takes `rows: list[(date, market_value, cost_basis)]` and `closes: dict[date, Decimal]`-ish inputs so pytest drives it with literals.
- **Live extension** (the chart's ping-day leg): extend exactly like `_extended_baseline` but anchored on the computed series' last value — implied shares = `benchmark[last] / close_on_or_before(last_date)`, today's leg = shares × today's close. Same method, same idempotence.

**Why read-time, not stored:** ~190 weekly rows × one multiply-add is free at request time; it recomputes correctly when a workbook re-import overrides history rows (`apply_portfolio_history`'s contract); there is no backfill migration and no splice/drift risk (the reason `BASELINE_TICKER` is a constant applies doubly to derived state). A stored `benchmark_shares` column buys nothing at this scale.

## 3. Known approximations (documented, not fixed)

Stated in an InfoHint (§4) and in code comments; none block the feature:

1. **Sells flow out at average-cost basis, not proceeds** — withdrawing appreciated shares understates the hypothetical withdrawal. Mostly-accumulating book ⇒ second-order.
2. **Backfilled Mondays share today's cost basis** (`backfill_missed_snapshots` prices today's book), so Δcost_basis is 0 across a backfilled span and the flow lands where live rows resume — same class of anachronism the backfill already documents.
3. **Price-return VOO** — the hypothetical leg earns no dividends. (Recorded reinvestment buys raise cost basis and thus count as contributions to the benchmark too, which is roughly fair; total-return precision needs data the app doesn't hold.)
4. Cost-basis deltas fold fees in (fees are part of basis) — acceptable; the hypothetical investor pays them too.

## 4. API & frontend

- **API:** the portfolio history response gains `benchmark: list[Decimal | None]` aligned with `dates`. Rows are Decimal everywhere the series is computable — leading rows before the first VOO bar carry the seed flat (§2's factor-1 rule), so gaps produce flats, not holes. The all-None degradation exists for exactly one case: no VOO bars at all (ticker absent / never refreshed) — GET-never-rejects law, nulls not 500. Schema + `src/types/api.ts` `PortfolioHistory` updated.
- **Chart** (`historyChartOptions.ts`): fourth line series, name **"VOO (your contributions)"**, fixed palette slot 4 (`PALETTE[3]`, yellow) per the theme's slot law — value=1 blue, cost=2 orange, baseline=3 aqua, benchmark=4. No wash (the wash rides the value line only). The shared axis tooltip and legend handle the new series with no changes; null rows are already skipped by `historyTooltipFormatter`.
- Both consumers (PortfolioPage, OverviewPage) get the line for free — same builder, same payload.
- An `InfoHint` beside the chart title: "Estimated: contributions inferred from weekly cost-basis changes; dividends excluded on the VOO leg." (advisory register, verbatim-sentence posture).
- The legacy line's legend name stays "S&P 500 baseline"; the two names must make the distinction self-explanatory in the legend alone.

## 5. Testing

- **pytest** (pure function, literal-driven): parity seed; single contribution lands then grows; negative flow (sell); missing-close carry-flat step; leading rows with no VOO bars; drain-to-zero clamp; golden 6-row series checked to the cent; live-extension idempotence (same-day recompute = same value).
- **API test:** history endpoint carries `benchmark` aligned with `dates`; degrades (nulls, not 500) when VOO has no bars at all.
- **vitest** (`historyChartOptions.test.ts`): fourth series present with slot-4 color, absent when the payload omits/nulls it, tooltip skips null rows, live ping unaffected.

## 6. Out of scope (natural follow-ons, separate specs)

- Portfolio TWR + per-window return % chips (same inputs; the metric layer from the 2026-08-24 audit).
- Configurable benchmark ticker (BASELINE_TICKER constant's anti-splice rationale stands).
- Replacing `sp500_value`'s implied-shares chain (import-owned sheet parity; untouched).
