# Monte Carlo Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /projection` gains `volatility`, `inflation`, and `contribution_growth` knobs; with volatility set, a seeded lognormal simulation returns p10/25/50/75/90 bands, an FI probability, and percentile FI months; the page draws the bands as blue washes around the existing lines and grows the three knobs plus an FI-probability tile. Without the new knobs the response and chart are byte-identical to today.

**Architecture:** A new pure `montecarlo.py` service simulates 500 seeded lognormal paths in float64 (documented departure — the deterministic Decimal engine is untouched and still produces `projected`/`coast`); the router converts nominal→real once (inflation) and threads a geometric contribution escalator through the existing `project()` via a defaulted parameter. Bands ride the response only when volatility is present.

**Tech Stack:** FastAPI, pure Python stdlib (`random.Random`, no numpy), pydantic v2, React 19 + TS + echarts (no new component registrations — Line/Grid already ship).

**Spec:** `docs/superpowers/specs/2026-08-20-monte-carlo-projection-design.md`

**Binding rules:** implementation subagents on Opus; pytest `-W error`; frontend gates `npm run test` / `npm run lint` (1 sanctioned warning) / `npm run build`; NO migrations (alembic head unmoved); back-compat is a test, not a hope.

---

### Task 1: Simulation service

**Files:**
- Create: `backend/app/services/montecarlo.py`
- Test: `backend/tests/test_montecarlo.py` (new)

- [ ] **Step 1: Write the service** (complete file):

```python
"""Seeded Monte Carlo over the projection's monthly recurrence.

FLOAT INTERNALS — a documented departure from the Decimal house rule: 500 paths × up to
720 months is 360k multiplies with zero display effect beyond the cent, so the walk runs
float64 and only the OUTPUT percentiles land on cents (polyTrend.ts's float precedent on
the frontend). The deterministic engine (services/projection.py) stays Decimal and its
arrays are untouched — the simulation surrounds the line, never replaces it.

Model: monthly growth factor exp(N(mu_m, sigma_m)) with mu_m = ln(1 + r) / 12, so the
MEDIAN path compounds at exactly the deterministic rate and the p50 band hugs the
deterministic line by construction; sigma_m = sigma / sqrt(12). Contributions are added
after growth each month (the deterministic recurrence's own order) and may escalate
geometrically. Balances stay positive by construction (multiplicative).

SEEDED, deliberately: identical knobs must redraw identical bands — the bands answer
"what does this sigma imply", not "give me fresh noise" — and the tests pin exact values.
"""

import math
import random
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

SIMULATIONS = 500
MC_SEED = 20260820
CENT = Decimal("0.01")
PERCENTILES = (10, 25, 50, 75, 90)


@dataclass
class MonteCarloResult:
    # Keys "p10"/"p25"/"p50"/"p75"/"p90"; each list is months+1 points at cents,
    # aligned to the deterministic axis (t0 = the starting balance in every path).
    bands: dict[str, list[Decimal]]
    # Per path: first month index whose balance >= target; None = never (or no target).
    reach_indices: list[int | None]


def _percentile(sorted_values: list[float], pct: int) -> float:
    """Linear interpolation between closest ranks (numpy's default) — pinned by tests."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (pct / 100) * (len(sorted_values) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return sorted_values[low]
    fraction = rank - low
    return sorted_values[low] * (1 - fraction) + sorted_values[high] * fraction


def simulate(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    volatility: Decimal,
    contribution_growth: Decimal,
    months: int,
    target: Decimal | None,
) -> MonteCarloResult:
    """`annual_return`/`contribution_growth` arrive ALREADY converted to real terms by
    the router when inflation is in play — this module knows nothing about inflation."""
    rng = random.Random(MC_SEED)
    start = float(starting_balance)
    base_contribution = float(monthly_contribution)
    mu_m = math.log(1 + float(annual_return)) / 12
    sigma_m = float(volatility) / math.sqrt(12)
    growth_m = (1 + float(contribution_growth)) ** (1 / 12)
    target_f = None if target is None else float(target)

    paths: list[list[float]] = []
    reach_indices: list[int | None] = []
    for _ in range(SIMULATIONS):
        balance = start
        path = [balance]
        reached: int | None = 0 if target_f is not None and balance >= target_f else None
        contribution = base_contribution
        for month_index in range(1, months + 1):
            balance = balance * math.exp(rng.gauss(mu_m, sigma_m)) + contribution
            contribution *= growth_m
            path.append(balance)
            if reached is None and target_f is not None and balance >= target_f:
                reached = month_index
        paths.append(path)
        reach_indices.append(reached)

    bands: dict[str, list[Decimal]] = {f"p{p}": [] for p in PERCENTILES}
    for month_index in range(months + 1):
        column = sorted(path[month_index] for path in paths)
        for p in PERCENTILES:
            value = Decimal(str(_percentile(column, p))).quantize(
                CENT, rounding=ROUND_HALF_UP
            )
            bands[f"p{p}"].append(value)
    return MonteCarloResult(bands=bands, reach_indices=reach_indices)


def reach_percentile(reach_indices: list[int | None], pct: int) -> int | None:
    """The pct-th percentile of first-reach month indices, 'never' sorting as +infinity —
    p10 is the optimistic edge, p90 the pessimistic. None when that percentile never
    reaches (or nothing does)."""
    if not reach_indices:
        return None
    sentinel = float("inf")
    ordered = sorted(sentinel if index is None else float(index) for index in reach_indices)
    value = _percentile(ordered, pct)
    return None if math.isinf(value) else round(value)
```

- [ ] **Step 2: Unit tests** at `backend/tests/test_montecarlo.py` (pure, no DB):

1. `test_seed_determinism` — two identical `simulate(...)` calls return equal bands and reach_indices.
2. `test_band_ordering` — for every month, p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 (240-month run, 5% return, 15% vol).
3. `test_median_tracks_deterministic_rate` — contributions 0, 120 months: `bands["p50"][-1]` within 5% of `Decimal("100000") × (1.05)^10` (tolerance, not exact — sampling noise).
4. `test_t0_is_the_starting_balance_in_every_band` — all five bands' first point == starting balance at cents.
5. `test_zero_target_reached_immediately` — target below start → every reach index 0; `reach_percentile(…, 90) == 0`.
6. `test_never_reaching_paths_percentile_none` — absurd target → all None → `reach_percentile` None at every pct.
7. `test_reach_percentile_mixed` — hand-built indices `[2, 5, None, None]`: p10 → 2 area, p90 → None (interpolation against inf).
8. `test_contribution_growth_shifts_bands_up` — same knobs ± growth 0.05: final p50 strictly greater with growth.

- [ ] **Step 3: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_montecarlo.py -q` → PASS. `ruff check .` clean.

- [ ] **Step 4: Commit** — `git commit -am "feat: seeded lognormal Monte Carlo service with percentile bands"`

---

### Task 2: Deterministic engine grows a contribution escalator

**Files:**
- Modify: `backend/app/services/projection.py` (`project` gains a defaulted param)
- Test: `backend/tests/test_projection_api.py` or the engine's own test file (extend — locate `project`'s existing direct tests first)

- [ ] **Step 1: Extend `project`** — the default keeps every existing call byte-identical:

```python
def project(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    months: int,
    contribution_growth: Decimal = Decimal("0"),
) -> list[Decimal]:
    """months+1 points at cents; t0 is the starting balance itself, and each later point
    is `previous × (1 + monthly rate) + contribution`, where the contribution escalates
    geometrically by `contribution_growth` per year ((1+g)^(1/12) per month — 0 keeps
    the historical flat behavior byte-identical). The chain runs at full precision and
    only the OUTPUTS land on cents, so no month's dust can compound into the next.
    """
    rate = monthly_rate(annual_return)
    growth = (ONE + contribution_growth) ** (ONE / TWELVE)
    points = [starting_balance.quantize(CENT, rounding=ROUND_HALF_UP)]
    balance = starting_balance
    contribution = monthly_contribution
    for _ in range(months):
        balance = balance * (ONE + rate) + contribution
        contribution *= growth
        points.append(balance.quantize(CENT, rounding=ROUND_HALF_UP))
    return points
```

- [ ] **Step 2: Tests** — `test_project_growth_zero_matches_previous_behavior` (pin a 3-month exact sequence WITHOUT the param, values computed by today's code before you change it — run it first to capture); `test_project_contribution_growth_two_months_exact` (hand-computed: start 1000, contribution 100, r 0, g 0.12 → month1 = 1100.00, month2 = 1100 + 100×1.12^(1/12) ≈ pin the exact cents the Decimal math yields — compute with Python once and pin the string).

- [ ] **Step 3: Run + commit** — `git commit -am "feat: project() gains a geometric contribution escalator (default 0, byte-identical)"`

---

### Task 3: Router knobs + response block

**Files:**
- Modify: `backend/app/api/projection.py`
- Modify: `backend/app/schemas/projection.py`
- Test: `backend/tests/test_projection_api.py` (extend)

- [ ] **Step 1: Schema additions** (`ProjectionOut`):

```python
    # Monte Carlo (present only when `volatility` was provided; echoes are nullable so a
    # stale tab against an older payload keeps rendering).
    volatility: Decimal | None = None
    inflation: Decimal | None = None
    contribution_growth: Decimal | None = None
    bands: dict[str, list[Decimal]] | None = None
    fi_probability: Decimal | None = None
    fi_month_p10: date | None = None
    fi_month_p50: date | None = None
    fi_month_p90: date | None = None
```

- [ ] **Step 2: Router.** New bounds/messages beside the existing ones:

```python
VOLATILITY_MESSAGE = "volatility must be greater than 0 and at most 1"
INFLATION_MIN = Decimal("-0.1")
INFLATION_MAX = Decimal("0.25")
INFLATION_MESSAGE = "inflation must be between -0.1 and 0.25"
GROWTH_MAX = Decimal("0.25")
GROWTH_MESSAGE = "contribution_growth must be between 0 and 0.25"
```

Params on the endpoint: `volatility: Decimal | None = Query(default=None)`, `inflation: Decimal | None = Query(default=None)`, `contribution_growth: Decimal | None = Query(default=None)`; validate each (is_finite + bounds; `quantize_pct` on the way in, the annual_return pattern).

Real-terms conversion after validation (full precision; ONE from services.projection):

```python
    # Inflation converts BOTH rates to real terms so every line and band shifts together
    # while the FI target stays in today's dollars — the whole frame reads in one unit.
    inflation_rate = inflation if inflation is not None else Decimal("0")
    real_return = (Decimal(1) + annual_return) / (Decimal(1) + inflation_rate) - Decimal(1)
    growth_rate = contribution_growth if contribution_growth is not None else Decimal("0")
    real_growth = (Decimal(1) + growth_rate) / (Decimal(1) + inflation_rate) - Decimal(1)
```

The two `project(...)` calls use `real_return` and pass `contribution_growth=real_growth` (coast keeps contribution 0 AND growth 0). `first_reaching` unchanged. Then:

```python
    bands = None
    fi_probability = None
    fi_month_p10 = fi_month_p50 = fi_month_p90 = None
    if volatility is not None:
        mc = simulate(
            starting, monthly_contribution, real_return, volatility, real_growth,
            month_count, fi_target,
        )
        bands = mc.bands
        if fi_target is not None:
            reached = sum(1 for index in mc.reach_indices if index is not None)
            fi_probability = quantize_pct(Decimal(reached) / Decimal(SIMULATIONS))
            p10 = reach_percentile(mc.reach_indices, 10)
            p50 = reach_percentile(mc.reach_indices, 50)
            p90 = reach_percentile(mc.reach_indices, 90)
            fi_month_p10 = None if p10 is None else months[min(p10, month_count)]
            fi_month_p50 = None if p50 is None else months[min(p50, month_count)]
            fi_month_p90 = None if p90 is None else months[min(p90, month_count)]
```

and thread all eight new fields into `ProjectionOut(...)` (echoes: `volatility=volatility`, `inflation=inflation`, `contribution_growth=contribution_growth` — null when absent, the blank-box round trip).

- [ ] **Step 3: API tests** (extend `tests/test_projection_api.py`, its clock-relative seed style):

1. `test_projection_backcompat_without_new_knobs` — response has `bands is None`, three null echoes, and `projected`/`coast` EQUAL to a pre-change captured fixture call (seed identical data; capture the arrays by running the endpoint before editing, pin as literals).
2. `test_projection_bands_shape_and_alignment` — with `volatility=0.15`: five keys, each `len == months`, every month ordered p10 ≤ … ≤ p90, `bands["p50"][0] == starting_balance`.
3. `test_projection_inflation_moves_deterministic_lines` — same seed, `inflation=0.03` vs absent: `projected[-1]` strictly smaller with inflation; echo carries "0.030000".
4. `test_projection_contribution_growth` — `contribution_growth=0.05` raises `projected[-1]` vs absent.
5. `test_projection_fi_probability_and_percentiles` — modest target → `0 < fi_probability <= 1`, p10 month ≤ p50 ≤ p90 when all present.
6. `test_projection_seed_stability` — two identical calls, identical `bands`.
7. Bounds 422s: volatility 0 / 1.5, inflation −0.2 / 0.3, growth −0.01 / 0.3 (six asserts, the router's exact messages).

- [ ] **Step 4: Run** the two projection test files + full suite once; `ruff check .`.

- [ ] **Step 5: Commit** — `git commit -am "feat: GET /projection — volatility/inflation/contribution-growth knobs, seeded percentile bands, FI probability"`

---

### Task 4: Frontend — knobs, fan chart, probability tile

**Files:**
- Modify: `src/types/api.ts` (ProjectionOut additions)
- Modify: `src/api/projection.ts` (three params, blank-omit)
- Modify: `src/components/projection/projectionChartOptions.ts` (bands in `projectionOption`)
- Modify: `src/components/projection/projectionChartOptions.test.ts`
- Modify: `src/pages/ProjectionPage.tsx` (knobs, fences, tile, hint)
- Modify: `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Types** — `ProjectionOut` gains `volatility: string | null`, `inflation: string | null`, `contribution_growth: string | null`, `bands: Record<string, string[]> | null`, `fi_probability: string | null`, `fi_month_p10/50/90: string | null` (all OPTIONAL-with-null semantics exactly as the wire).

- [ ] **Step 2: Client** — `ProjectionParams` gains `volatility?: string; inflation?: string; contributionGrowth?: string`; append to the query string ONLY when non-empty (the module's existing blank-omit convention; wire name `contribution_growth`).

- [ ] **Step 3: Builder.** Extend `projectionOption(data)` — signature unchanged; it already receives the whole `ProjectionOut`-shaped pick, widen the Pick to include `bands`. When `data.bands` is non-null, PREPEND (so lines draw on top) four band series in the stacked-area idiom, all `PALETTE[0]`, all silent to the tooltip:

```ts
const bandSeries =
  data.bands === null || data.bands === undefined
    ? []
    : (() => {
        const p10 = data.bands.p10.map(Number)
        const p25 = data.bands.p25.map(Number)
        const p75 = data.bands.p75.map(Number)
        const p90 = data.bands.p90.map(Number)
        const diff = (hi: number[], lo: number[]) => hi.map((v, i) => v - lo[i])
        // Stacked washes: an invisible base at p10, then p25−p10 (outer), p75−p25
        // (inner), p90−p75 (outer) — two opacities read as "50% of paths" vs "80%".
        // All the projection's own blue: uncertainty about one entity wears that
        // entity's hue (theme law — never a new hue). Tooltip-silent: the bands are
        // geometry; the three real lines carry the numbers.
        const wash = (name: string, values: number[], opacity: number) => ({
          name,
          type: 'line' as const,
          stack: 'mc-band',
          symbol: 'none' as const,
          lineStyle: { width: 0 },
          color: PALETTE[0],
          emphasis: { disabled: true },
          tooltip: { show: false },
          silent: true,
          areaStyle: { opacity },
          data: values,
        })
        return [
          {
            name: 'mc-base',
            type: 'line' as const,
            stack: 'mc-band',
            symbol: 'none' as const,
            lineStyle: { width: 0 },
            color: 'transparent',
            emphasis: { disabled: true },
            tooltip: { show: false },
            silent: true,
            data: p10,
          },
          wash('10–90% band', diff(p25, p10), 0.1),
          wash('25–75% band', diff(p75, p25), 0.18),
          wash('10–90% band-upper', diff(p90, p75), 0.1),
        ]
      })()
```

Legend: explicitly list entries so the base and the duplicate upper wash stay OUT of it —
`legend: { top: 0, data: [...PROJECTION_SERIES filtered to present ones, ...(bands ? ['10–90% band', '25–75% band'] : [])] }`
(the '…band-upper' series shares the outer opacity but is legend-hidden; toggling the
legend entry hides only the lower outer wash — an accepted echarts stack quirk, note it
in a comment). Bands render BEFORE the three line series in the `series` array.

- [ ] **Step 4: Builder tests** — bands absent ⇒ series array identical to today's (pin: 3 series when target present); bands present ⇒ 4 extra series FIRST, stack shared, tooltip-silent, diffs exact for a hand fixture (p25−p10 etc.), legend data excludes 'mc-base' and the upper wash, includes the two labels.

- [ ] **Step 5: Page.** `Knobs` gains `volatility` / `inflation` / `contributionGrowth` (blank-seeded from null echoes via the existing per-field seed rule — shiftPoint(…, 2) for all three since they're percent boxes). Fences in `recalculate` (the page's existing pattern + wording): volatility blank or (0, 100]; inflation blank or [-10, 25]; growth blank or [0, 25]. Pass through `load()` with `shiftPoint(…, -2)`. New form fields labelled `Volatility (%/yr)`, `Inflation (%/yr)`, `Contribution growth (%/yr)` (after Withdrawal rate, before Horizon). New tile in the KPI row:

```tsx
              <StatTile
                label="FI probability"
                value={
                  data.fi_probability === null
                    ? '—'
                    : formatPct(data.fi_probability, { signed: false })
                }
                delta={
                  data.fi_month_p50 === null
                    ? undefined
                    : `p50 ${formatMonth(data.fi_month_p50)}${
                        data.fi_month_p90 === null
                          ? ''
                          : ` · p90 ${formatMonth(data.fi_month_p90)}`
                      }`
                }
                tone="neutral"
              />
```

Hint under the investable chart appends: `" With a volatility, bands are percentiles across 500 simulated lognormal-return paths — seed-stable, so identical knobs redraw identical bands."` Assumptions drill-hint gains: `"Volatility turns on the bands; inflation converts everything to today's dollars; contribution growth models raises."`

- [ ] **Step 6: Page tests** — knobs render and blank-omit (recalculate with all blank sends none of the three params); fence messages; FI-probability tile dash without bands, formatted with; echo-seeding leaves blank boxes blank (null echoes); with a bands fixture the chart option carries the band series (via the mocked EChart's option capture, the file's existing pattern).

- [ ] **Step 7: Run gates; commit** — `git commit -am "feat: Monte Carlo bands, inflation + contribution-growth knobs, FI probability tile"`

---

### Task 5: Whole-feature gate

- [ ] **Step 1:** `cd backend && .venv/Scripts/python.exe -m pytest -q`; `ruff check .`; `alembic check` (head unmoved).
- [ ] **Step 2:** `npm run test && npm run lint && npm run build`.
- [ ] **Step 3:** Tick all plan checkboxes; `git commit -am "chore: monte carlo feature gate green"`.

---

## Self-review notes (spec → plan)

- Spec §2 knobs/bounds/echoes → Task 3 (nullable echoes, blank-omit round trip pinned in Task 4 Step 6).
- Spec §3 model → Task 1 (mu centering, seed, float departure documented, linear-interp percentiles pinned, reach convention).
- Spec §4 router → Task 3 (real-terms conversion feeding BOTH engines; coast keeps 0/0).
- Spec §5 frontend → Task 4 (band idiom, one hue, tooltip-silent, legend curation, tile, hints, fences).
- Back-compat → Task 2 Step 2 pin + Task 3 test 1 + Task 4 builder test (no bands ⇒ identical series).
- Non-goals introduce no tasks (correct). Type consistency: `simulate(...)`/`MonteCarloResult`/`reach_percentile` names match across Tasks 1/3; `bands` wire shape `Record<string, string[]>` matches `dict[str, list[Decimal]]`.
