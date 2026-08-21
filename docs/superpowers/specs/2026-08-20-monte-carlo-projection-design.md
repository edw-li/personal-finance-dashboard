# Monte Carlo Projection — Design Spec

**Date:** 2026-08-20
**Status:** Feature approved by user in chat; design details settled autonomously in-session.
**Feature branch:** `feature/monte-carlo-projection`

## 1. Context & Goals

The projection is deliberately deterministic — one return, flat contributions, nominal
dollars — and the page carries that honesty in words. On a 30-year horizon a single line
invites false precision. The design spec's own v2 list names Monte Carlo.

Goals: percentile **bands** from simulated return sequences around the existing
deterministic line; an **inflation** knob so the chart can read in today's dollars
coherently; a **contribution growth** knob (raises); an **FI probability** figure.
Deterministic behavior with the new knobs absent stays byte-identical (back-compat).

## 2. API — `GET /projection` gains three optional knobs

- `volatility` — annual σ as a fraction. Absent ⇒ **no simulation runs and the response
  is unchanged** except for the three null echo fields. Bounds: `0 < volatility <= 1`
  (422 `volatility must be greater than 0 and at most 1`). Typical: `0.15`.
- `inflation` — annual rate. Absent ⇒ 0 (today's behavior). Bounds `[-0.1, 0.25]`.
  Applied by converting the return to a **real** return `(1+r)/(1+i) − 1` (and the
  contribution-growth rate identically) before any projection — deterministic lines and
  simulated paths alike shift together, and the FI target (today's spend ÷ SWR) stays in
  today's dollars, which is what makes the whole frame coherent.
- `contribution_growth` — annual escalator for the monthly contribution. Absent ⇒ 0.
  Bounds `[0, 0.25]`. Contribution in month m (1-based) is `base × (1+g_m)^(m−1)` — the first
  contribution is unescalated (both engines, pinned by test) — with
  `g_m = (1+g_real)^(1/12) − 1`.

Echo fields on `ProjectionOut` (nullable — stale-tab armor): `volatility`, `inflation`,
`contribution_growth`. `inflation`/`contribution_growth` echo the value actually used
(0.00… when defaulted? No — echo `null` when absent, the typed value when provided, so
the form's blank-box convention survives the round trip).

### New response block (present only when `volatility` was provided)

```
bands: {
  p10: [...], p25: [...], p50: [...], p75: [...], p90: [...]   // cents, aligned to months
} | null,
fi_probability: Decimal | null,   // share of paths whose balance reaches the target
                                  // within the horizon; 6dp fraction; null without a target
fi_month_p10: date | null, fi_month_p50: date | null, fi_month_p90: date | null
                                  // percentile FIRST-reach months across paths; a path
                                  // that never reaches contributes "never", so a
                                  // percentile lands null when too few paths arrive
```

Percentile-of-first-reach convention: sort each path's first-reach index with "never" as
+∞; `fi_month_p10` is the 10th percentile (the optimistic edge), `p90` the pessimistic;
null whenever that percentile is +∞ or there is no target.

## 3. Simulation model — `backend/app/services/montecarlo.py`

- **Monthly lognormal returns:** per month, growth factor `exp(draw)` with
  `draw ~ Normal(μ_m, σ_m)`, `μ_m = ln(1 + r_real) / 12` (so the median path compounds at
  exactly the deterministic rate — the p50 band hugs the deterministic line by
  construction), `σ_m = volatility / sqrt(12)`.
- **Recurrence:** `balance = balance × exp(draw) + contribution_m` — multiplicative, so
  balances never go negative.
- **Paths:** `SIMULATIONS = 500` (constant; 500 × 720 months is milliseconds in pure
  Python). **Seeded RNG:** `random.Random(MC_SEED)` with `MC_SEED = 20260820` — reruns
  with the same knobs return identical bands (pinnable tests, no flicker between
  Recalculates; a deliberate, documented choice: the bands answer "what does σ imply",
  not "give me fresh noise").
- **Float internals, documented departure:** the deterministic engine is Decimal; a
  360k-step simulation in Decimal is waste with zero display effect. The module runs
  float64 internally and quantizes only the OUTPUT percentiles to cents (module
  docstring carries the departure, `polyTrend.ts`'s float precedent).
- **Percentiles:** per month across paths via linear interpolation
  (`statistics.quantiles(n=20, method='inclusive')` slots or an explicit helper — pinned
  by tests either way; p10/p25/p50/p75/p90).
- The deterministic `projected`/`coast` arrays keep using the Decimal engine — the
  simulation never replaces them, it surrounds them.

Signature:

```python
@dataclass
class MonteCarloResult:
    bands: dict[str, list[Decimal]]      # keys p10/p25/p50/p75/p90, cents
    reach_indices: list[int | None]      # per path, first index >= target (None = never)

def simulate(
    starting_balance: Decimal, monthly_contribution: Decimal,
    annual_return_real: Decimal, volatility: Decimal,
    contribution_growth_real: Decimal, months: int,
    target: Decimal | None,
) -> MonteCarloResult
```

## 4. Router changes — `backend/app/api/projection.py`

- Parse/validate the three knobs (bounds above, `quantize_pct` on the way in).
- Compute `r_real` and `g_real` once; the existing `project(...)` calls receive `r_real`
  and a contribution schedule — `project` gains an optional
  `contribution_growth: Decimal = ZERO` parameter (geometric monthly escalator inside
  the loop; default keeps every existing call and test byte-identical).
- When `volatility` present: run `simulate(...)`, attach bands + fi_probability +
  percentile months (dates via the existing `months` axis).
- `fi_probability = Decimal(reached) / Decimal(SIMULATIONS)` quantized 6dp; null without
  a target.

## 5. Frontend

- **Knobs** (ProjectionPage form, blank-omit convention): `Volatility (%/yr)` — blank =
  deterministic only; `Inflation (%/yr)`; `Contribution growth (%/yr)`. Client fences in
  the box's vocabulary: volatility (0, 100], inflation [-10, 25], growth [0, 25].
  Echo-seeding: null echoes leave the boxes blank (the existing per-field seed rule).
- **Fan chart** (`projectionChartOptions.projectionOption` extended, same builder): when
  `bands` present, add band areas UNDER the existing lines using the stacked-area idiom —
  an invisible base series at `p10` plus two stacked washes (`p10→p25→p75→p90` needs four
  stack series; implement as: base `p10` (transparent, stack 'mc'), `p25−p10` wash at
  opacity 0.10, `p75−p25` wash at 0.18, `p90−p75` wash at 0.10 — all `PALETTE[0]` blue:
  uncertainty about one entity wears that entity's hue, never a new one). Two legend
  entries: "10–90% band", "25–75% band" (the two washes that differ); p50 is NOT drawn
  (the deterministic Projected line is the median by construction — drawing both would
  be two names for one curve). Tooltip: band series formatted as ranges is over-clever —
  keep the default rows but name them (`10–90% low`, …)? No: **suppress band series from
  the tooltip** (`tooltip: {show: false}` per band series) and let the three real lines
  carry it — the bands are geometry, the tooltip stays honest. **(Revised 2026-08-20,
  user request: the wash SERIES stay silent — their stacked values are diffs — but a
  chart-level formatter now reconstructs the real percentile RANGES from the bands
  arrays, appending "10–90% band: $a – $b" / "25–75% band" rows to the hover.)**
- **FI probability tile:** value `formatPct(fi_probability)` with delta line
  `p50 {formatMonth(fi_month_p50)} · p90 {formatMonth(fi_month_p90)}` when present;
  dash when deterministic-only.
- **Hint** append: "Bands are percentiles across 500 simulated lognormal-return paths at
  your volatility — seed-stable, so identical knobs redraw identical bands."
- Back-compat: no `bands` in the echo ⇒ the chart renders exactly as today (pinned).

## 6. Testing

- **pytest (`tests/test_montecarlo.py`, `tests/test_projection_api.py` extend):**
  - seed determinism: two `simulate` calls identical.
  - band ordering: p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 every month.
  - median sanity: with contributions 0, `p50[last]` within a few percent of the
    deterministic point (μ_m centering) — tolerance assert, not exact.
  - contribution growth: 2-month hand-computed case through `project(...,
    contribution_growth=...)` exact to the cent; growth=0 byte-identical to today.
  - inflation conversion: `r_real` pinned ((1.05)/(1.03)−1 to 6dp); deterministic arrays
    shift when inflation is provided; API echoes null when absent.
  - fi_probability bounds [0,1]; percentile months null without target; never-reaching
    paths push p90 to null at tiny horizons.
  - back-compat: response WITHOUT volatility carries `bands: null` and byte-identical
    deterministic arrays vs. a pre-change fixture.
  - bounds 422s for all three knobs.
- **vitest:** knob blank-omit + fences; fan series present only with bands; band series
  suppressed from tooltip; legend names; FI-probability tile; hint line; no-bands
  back-compat render.

## 7. Non-goals

- No historical-bootstrap or fat-tail models; lognormal i.i.d. is the v1 model and the
  hint names it.
- No per-run random seed or seed knob (determinism is the feature).
- No drawdown-phase simulation (post-FI withdrawals) — a later module.
- No numpy dependency.
- The trend chart ("Net worth over time (projected)") is untouched — bands belong to the
  plan chart, the quadratic fit stays momentum-only.
