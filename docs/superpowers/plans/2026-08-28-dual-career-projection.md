# Dual-Career Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-28):** This plan's knob-availability deviation is
> BLESSED over spec §4.3's literal text: knobs render per household person, always enabled,
> and a profile-less person's retirement 422s with the server's sentence rendered verbatim —
> the in-force rule keeps exactly one owner (`_default_profile`). The drop's real-vs-nominal
> treatment (today's dollars, same escalator as the contribution, understatement risk named
> in the hint) is approved as specced here. Your `marriageMarkLine` extraction must leave
> the net-worth suites green UNEDITED (your own Task 5 revert rule stands). Wave 1,
> alongside the portfolio-backend plan — zero shared files.

**Goal:** Teach the FIRE projection two (or N) careers. `GET /projection` gains repeated `retire=<person_id>:<YYYY-MM>` params; each one drops that person's in-force monthly take-home out of the household contribution stream at that month, in BOTH the deterministic line and the Monte Carlo fan, and the response echoes what it did. The page grows one **Retires** month knob per household person and one dashed, name-labelled vertical rule per retirement on the projected-balance chart. With no `retire` param the engine, the arrays and the bands are byte-identical to today.

**Architecture:** The contribution stream stays ONE household figure (spec decision log: no per-person savings attribution) and gains a *schedule of decrements*. `services/projection.drop_schedule` is the single owner of the normalisation rule — two drops in one month **sum**, index 0 folds onto index 1 (t0 carries no contribution; it is the starting balance itself), indices past the horizon never fire — and `montecarlo.simulate` imports it rather than re-deriving it, so the fan can only ever bend where the line bends. Inside both loops a scheduled drop lands **before** that month's contribution, the stream is floored at 0 (a drop bigger than what is left retires the whole stream, and `0 × growth` stays 0), and the escalator then compounds the **remainder**. The router owns every decision the engine must not know about: `monthly_drop` is `paycheck_calc.breakdown(profile)["monthly_net"]` for the profile `paycheck.py::_default_profile` says is in force *today* — a cross-router borrow on `taxes.py`'s precedent, because the Paycheck page, the Taxes page and this drop must never disagree about which profile is current.

**Real-vs-nominal (the one modelling subtlety, `api/projection.py:225-230`).** The router converts BOTH rates to real terms (`real_return`, `real_growth`) and hands the engine a NOMINAL-today `monthly_contribution`, which is also its real value at t0; the escalator carries it forward in today's dollars. `monthly_drop` is read the same way — a today's-dollars take-home — so it is passed through **untouched by the Fisher conversion**. Deflating it would model a nominal *future* paycheck, which is not what `_default_profile` read. The honest asterisk, named in the page hint: the remaining stream escalates in real terms while the drop does not, so a far-off retirement understates the loss slightly (the retiree never gets their share of the modelled raises). That is deliberate and cheap to explain; anything smarter needs per-person savings attribution, which this batch explicitly does not have.

**Validation order (the latent-gap note).** `retire` params are order-free, so the FIRST param with a problem is the one that answers — reporting them all would lengthen the message, not the fix. Within one param the checks run in a fixed order: **format → person exists → not a duplicate → inside the horizon → has a profile in force → that profile's `pay_periods_per_year` is usable**. Every refusal is a 422 carrying the server's own sentence, which the page renders verbatim (house rule).

**Wire contract change.** The response GAINS exactly one key: `retirements: []` when no `retire` param was sent. Every pre-existing key, and every element of `projected` / `coast` / `bands`, is byte-identical — the committed `BACKCOMPAT_PROJECTED_2Y` / `BACKCOMPAT_COAST_2Y` pins in `test_projection_api.py` run **unmodified** and must stay green after every engine task.

**Tech Stack:** FastAPI 0.141 + SQLAlchemy 2 async + Postgres 16 (real-DB pytest), React 19 + TypeScript + Vitest + echarts. No new dependencies. **No migrations in this plan** — the only tables read (`people`, `paycheck_profiles`) already exist.

**Spec:** `docs/superpowers/specs/2026-08-28-household-portfolio-projection-design.md` — §4.3 (the whole feature), §6 (the 422 rendered verbatim), §7 (byte-identity pins), §9 Plan 3. **Do NOT flip the spec's status line when done** — this is wave 1 of the batch and the orchestrator tracks batch status.

**Scope boundary (Plan 3 of 4, independent — runs in parallel with Plan 1).** In scope: `services/projection.py`, `services/montecarlo.py`, `schemas/projection.py`, `api/projection.py`, their tests, `src/types/api.ts`, `src/api/projection.ts`, a new `src/charts/markLine.ts`, `src/components/projection/projectionChartOptions.ts`, `src/pages/ProjectionPage.tsx` and their tests, plus a two-line reuse edit in `src/components/networth/netWorthChartOptions.ts`. Explicitly NOT in this plan: portfolio accounts / owner filters (Plan 1), Settings portfolio table (Plan 2), credit-card owners / calendar person tags / the batch browser smoke (Plan 4), per-person savings attribution, per-person spend, Social-Security or pension income, a withdrawal phase, any migration, any push.

**House rules that bind every task:** a GET never rejects stored data (an unusable stored profile degrades or 422s with the *paycheck router's own words*, never a 500); server sentences render verbatim in the UI; Decimals and dates cross the wire as strings; comments explain constraints, not narration; no file deletions (anything that looks deletable goes on the morning list); **never push**.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/projection.py` | `drop_schedule` (new) + `project(..., drops=())` |
| `backend/app/services/montecarlo.py` | `simulate(..., drops=())`, borrowing `drop_schedule` |
| `backend/app/schemas/projection.py` | `RetirementOut` (new); `ProjectionOut.retirements` |
| `backend/app/api/projection.py` | `retire` query param, `_resolve_retirements`, engine wiring, echo |
| `backend/tests/test_projection_api.py` | engine drop math + API validation table + echo + pins |
| `backend/tests/test_montecarlo.py` | MC drop math + deterministic parity at sigma 0 |
| `src/types/api.ts` | `RetirementEcho` (new); `ProjectionOut.retirements` |
| `src/api/projection.ts` (+`.test.ts`) | `retirements` param → repeated `retire=` |
| `src/charts/markLine.ts` (+`.test.ts`) | shared anchor rule + dashed-MUTED vocabulary (new) |
| `src/components/networth/netWorthChartOptions.ts` | `marriageMarkLine` delegates to the shared anchor (same shape) |
| `src/components/projection/projectionChartOptions.ts` (+`.test.ts`) | `retirementMarkLine` + wiring onto the Projected series |
| `src/pages/ProjectionPage.tsx` (+`.test.tsx`) | household fetch, Retires knobs, hint, request wiring |

NOT touched, on purpose: `backend/app/api/paycheck.py` (this plan only *reads* `_default_profile`), any Alembic version file, `src/components/networth/netWorthChartOptions.test.ts` and `src/pages/NetWorthPage.test.tsx` (the marriage annotation's rendered shape does not change — if either goes red, the extraction was wrong).

---

## Phase 0 — Baseline verification

### Task 0: Verify the checkout, the venv, the suites, and that nothing here exists yet

**Files:** none (verification only)

- [ ] **Step 1: Confirm a clean tree at the batch baseline.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git status --porcelain
cd /c/Users/edyli/personal-finance-dashboard && git log --oneline -1
```

Expected: empty porcelain output, and `23e1dc7 docs: household portfolio + dual-career projection batch design (P4, approved scope)` (or a later commit on the same branch if the orchestrator has moved). If the tree is dirty, STOP and report — do not stash.

- [ ] **Step 2: Confirm no part of this feature already exists.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && grep -rn "retire\|drop_schedule\|retirement" backend/app/services/projection.py backend/app/services/montecarlo.py backend/app/api/projection.py backend/app/schemas/projection.py src/api/projection.ts src/pages/ProjectionPage.tsx
```

Expected: **no output**. Any hit means a previous run left work behind — STOP and report.

- [ ] **Step 3: Backend baseline (the two suites this plan edits).**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py tests/test_montecarlo.py tests/test_paycheck_comp_api.py -q
```

Expected: all green. If it fails on connection, run `cd /c/Users/edyli/personal-finance-dashboard/backend && docker compose up -d db` and retry once; if it still fails, read `backend/app/config.py` for the dev `DATABASE_URL` default — do not guess.

- [ ] **Step 4: Frontend baseline (the four suites this plan edits or must not break).**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/ProjectionPage.test.tsx src/components/projection/projectionChartOptions.test.ts src/api/projection.test.ts src/components/networth/netWorthChartOptions.test.ts src/pages/NetWorthPage.test.tsx
```

Expected: all green. If node modules are missing, run `npm ci` once and retry.

- [ ] **Step 5: Confirm the cross-router borrow is available exactly as this plan assumes.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && grep -n "async def _default_profile\|^MIN_PAY_PERIODS\|^PAY_PERIODS_MESSAGE" app/api/paycheck.py
cd /c/Users/edyli/personal-finance-dashboard/backend && grep -n "_default_profile" app/api/taxes.py
```

Expected: `_default_profile(db, person_id, today)` declared around line 295, `MIN_PAY_PERIODS` / `PAY_PERIODS_MESSAGE` around lines 53-58, and `taxes.py` already importing `_default_profile` from `app.api.paycheck` (the precedent this plan follows). If the signature is not the three-argument one, STOP and report — the drop has no other honest source.

No commit for this task.

---

## Phase 1 — The engine

### Task 1: `project()` learns a drop schedule

**Files:**
- `backend/app/services/projection.py` (whole file — 62 lines today)
- `backend/tests/test_projection_api.py` (engine section, lines 398-419 — append after `test_project_contribution_growth_two_months_exact`)

- [ ] **Step 1: Write the failing engine tests.** Append this COMPLETE block to the end of `backend/tests/test_projection_api.py` (the file already imports `project` from `app.services.projection` at line 12 — extend that import to `from app.services.projection import drop_schedule, project`):

```python
# --- the retirement schedule (2026-08-28 spec §4.3) ---


def test_drop_schedule_sums_a_month_and_folds_index_zero():
    # Two retirements in one month cost the household BOTH paychecks at once.
    assert drop_schedule([(7, Decimal("100")), (7, Decimal("40"))]) == {7: Decimal("140")}
    # t0 carries no contribution (it IS the starting balance), so "already retired when the
    # projection starts" and "retires at month 1" are the same chain — folded, not dropped.
    assert drop_schedule([(0, Decimal("40"))]) == {1: Decimal("40")}
    assert drop_schedule([]) == {}


def test_project_without_drops_is_byte_identical():
    # The back-compat guarantee is a test, not a hope: the four strings below are the ones
    # test_project_growth_zero_matches_previous_behavior already pins, and the new
    # parameter must not move them on either the defaulted or the explicit-empty path.
    plain = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3)
    assert [str(p) for p in plain] == ["1000.00", "1104.07", "1208.57", "1313.50"]
    assert project(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3, Decimal("0"), []) == plain


def test_project_drop_lands_before_that_month_contribution():
    # r = 0 collapses the compounding to plain addition, so the whole chain is exact:
    # 100/month until month 3, where a 40 drop leaves 60/month for the rest.
    points = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 5, Decimal("0"),
                     [(3, Decimal("40.00"))])
    assert [str(p) for p in points] == [
        "1000.00", "1100.00", "1200.00", "1260.00", "1320.00", "1380.00"
    ]


def test_project_drop_at_index_zero_is_the_same_chain_as_index_one():
    at_zero = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 3, Decimal("0"),
                      [(0, Decimal("40.00"))])
    at_one = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 3, Decimal("0"),
                     [(1, Decimal("40.00"))])
    assert [str(p) for p in at_zero] == ["1000.00", "1060.00", "1120.00", "1180.00"]
    assert at_zero == at_one


def test_project_two_drops_in_one_month_sum():
    points = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 3, Decimal("0"),
                     [(2, Decimal("30.00")), (2, Decimal("20.00"))])
    assert [str(p) for p in points] == ["1000.00", "1100.00", "1150.00", "1200.00"]


def test_project_floors_the_stream_at_zero_and_growth_cannot_revive_it():
    # A drop bigger than what is left retires the WHOLE stream; 0 x (1+g) is still 0, so a
    # 12%/yr escalator must never bring a retired paycheck back.
    points = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 4, Decimal("0.12"),
                     [(2, Decimal("500.00"))])
    assert [str(p) for p in points] == ["1000.00", "1100.00", "1100.00", "1100.00", "1100.00"]


def test_project_growth_escalates_only_the_remainder():
    # Dropping 40 at the FIRST contribution is arithmetically a 60/month stream from the
    # start: the escalator has to compound what is LEFT, never the original 100. Equality
    # over a 36-month chain is a much sharper pin than any single hand-computed point.
    dropped = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 36, Decimal("0.12"),
                      [(1, Decimal("40.00"))])
    assert dropped == project(Decimal("1000.00"), Decimal("60.00"), Decimal("0"), 36,
                              Decimal("0.12"))
    # ...and the first two points are checkable by eye: 1000 + 60, then + 60 x 1.12^(1/12)
    # = 60.56932757607497844758130414 -> 1120.5693... -> HALF_UP -> 1120.57.
    assert [str(p) for p in dropped[:3]] == ["1000.00", "1060.00", "1120.57"]


def test_project_ignores_a_drop_past_the_horizon():
    # The API fences the range; the ENGINE stays total rather than raising on one.
    assert project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 3, Decimal("0"),
                   [(99, Decimal("40.00"))]) == project(
        Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 3, Decimal("0")
    )
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py -q -k "drop_schedule or project_"
```

Expected: collection fails with `ImportError: cannot import name 'drop_schedule'`.

- [ ] **Step 3: Implement.** Replace `backend/app/services/projection.py` with this COMPLETE content:

```python
"""Deterministic net-worth projection — the FIRE module's engine.

Pure Decimal math, no I/O, no clock: the router owns the database reads (starting
balance, trailing savings, trailing spend, the stored SWR) and the calendar; this module
owns only the compounding. Deliberately deterministic — one return assumption, no Monte
Carlo — and the PAGE carries that honesty in words; the numbers here never pretend to be
more than arithmetic over the knobs.
"""

from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal

ONE = Decimal(1)
TWELVE = Decimal(12)
CENT = Decimal("0.01")
ZERO = Decimal("0")


def monthly_rate(annual_return: Decimal) -> Decimal:
    """Geometric monthly equivalent of an annual return: (1 + r)^(1/12) − 1.

    Decimal ** with a fractional exponent is context-rounded (28 significant digits) —
    orders of magnitude under the 2dp display quantum, and deterministic, which is what
    lets the API tests pin exact strings. The router bounds the NOMINAL r to [-0.5, 0.5]
    and may pass a real-terms conversion of it; the inflation bounds keep the worst
    case at -0.6, so the base stays strictly positive and the power is always defined.
    """
    return (ONE + annual_return) ** (ONE / TWELVE) - ONE


def drop_schedule(drops: Sequence[tuple[int, Decimal]]) -> dict[int, Decimal]:
    """`(month_index, amount)` pairs folded into ONE decrement per month index.

    The single owner of the retirement-schedule rule: `montecarlo.simulate` imports this
    rather than re-deriving it, because the fan has to bend exactly where the line bends
    and a second copy could only drift.

    Two retirements in the same month SUM — the household loses both paychecks at once.
    Index 0 folds onto index 1 because t0 carries no contribution (it IS the starting
    balance), so "already retired when the projection starts" and "retires at month 1"
    are the same chain. Indices past the horizon simply never fire: the API validates the
    range, and this function stays total.
    """
    schedule: dict[int, Decimal] = {}
    for index, amount in drops:
        key = max(index, 1)
        schedule[key] = schedule.get(key, ZERO) + amount
    return schedule


def project(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    months: int,
    contribution_growth: Decimal = Decimal("0"),
    drops: Sequence[tuple[int, Decimal]] = (),
) -> list[Decimal]:
    """months+1 points at cents; t0 is the starting balance itself, and each later point
    is `previous × (1 + monthly rate) + contribution`, where the contribution escalates
    geometrically by `contribution_growth` per year ((1+g)^(1/12) per month — 0 keeps
    the historical flat behavior byte-identical). The chain runs at full precision and
    only the OUTPUTS land on cents, so no month's dust can compound into the next.

    `drops` are retirements (2026-08-28 spec §4.3): at each scheduled month index the
    contribution stream is decremented BEFORE that month's contribution is added, floored
    at 0 (a drop larger than what is left retires the whole stream, and 0 × growth stays
    0), and the escalator then keeps compounding the REMAINDER. An empty schedule leaves
    every output byte-identical to the pre-retirement engine.
    """
    rate = monthly_rate(annual_return)
    growth = (ONE + contribution_growth) ** (ONE / TWELVE)
    schedule = drop_schedule(drops)
    points = [starting_balance.quantize(CENT, rounding=ROUND_HALF_UP)]
    balance = starting_balance
    contribution = monthly_contribution
    for index in range(1, months + 1):
        drop = schedule.get(index)
        if drop is not None:
            contribution = contribution - drop
            if contribution < ZERO:
                contribution = ZERO
        balance = balance * (ONE + rate) + contribution
        contribution *= growth
        points.append(balance.quantize(CENT, rounding=ROUND_HALF_UP))
    return points


def first_reaching(points: list[Decimal], target: Decimal) -> int | None:
    """Index of the first point at or past the target — None when the horizon never gets
    there. Judged on the QUANTIZED points, so the answer can never contradict the chart
    the user is looking at."""
    for i, value in enumerate(points):
        if value >= target:
            return i
    return None
```

- [ ] **Step 4: Run the new tests to green.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py -q -k "drop_schedule or project_"
```

Expected: all green.

- [ ] **Step 5: GOLDEN CHECK — the untouched suites must not have moved.** This is the byte-identity discipline: the pre-existing fixtures and the `BACKCOMPAT_*` string pins run **unmodified**.

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py tests/test_montecarlo.py -q
```

Expected: every test green, including `test_projection_explicit_zero_knobs_reproduce_the_pre_monte_carlo_arrays` and `test_project_growth_zero_matches_previous_behavior`. **If any of them changed, STOP** — the engine moved and the drop is not additive.

- [ ] **Step 6: Lint and commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m ruff check app tests
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): project() takes a retirement drop schedule"
```

---

### Task 2: `simulate()` consumes the identical schedule

**Files:**
- `backend/app/services/montecarlo.py` (`simulate` at lines 55-96)
- `backend/tests/test_montecarlo.py` (append after `test_contribution_growth_shifts_bands_up`)

- [ ] **Step 1: Capture the pre-change band pin.** The Monte Carlo output is float-derived, so the byte-identity pin has to be a CAPTURED value, not a guessed one. Run this BEFORE editing `montecarlo.py`:

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -c "from decimal import Decimal as D; from app.services.montecarlo import simulate; r = simulate(D('100000'), D('1000'), D('0.05'), D('0.15'), D('0'), 60, D('500000')); print(r.bands['p10'][-1], r.bands['p50'][-1], r.bands['p90'][-1])"
```

Write down the three strings — call them `$P10`, `$P50`, `$P90`. They go verbatim into Step 2's test.

- [ ] **Step 2: Write the failing MC tests.** Append this COMPLETE block to `backend/tests/test_montecarlo.py`, substituting the three captured strings where marked (extend the import at line 3 to also pull `project`: add `from app.services.projection import project` under it):

```python
# --- retirement drops (2026-08-28 spec §4.3) ---


def test_simulate_without_drops_is_byte_identical():
    # CAPTURED FROM simulate() BEFORE THE DROPS PARAMETER EXISTED. The schedule lookup must
    # cost the walk nothing — not one extra rng draw, not one changed multiply — so these
    # three strings are what byte-identity is measured against. They are NOT regenerated:
    # if they stop matching, the simulation moved.
    args = (Decimal("100000"), Decimal("1000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    result = simulate(*args, 60, Decimal("500000"))
    assert str(result.bands["p10"][-1]) == "$P10"  # <- paste the captured p10
    assert str(result.bands["p50"][-1]) == "$P50"  # <- paste the captured p50
    assert str(result.bands["p90"][-1]) == "$P90"  # <- paste the captured p90
    # An EXPLICIT empty schedule is the same walk, and so is one that never fires.
    assert simulate(*args, 60, Decimal("500000"), []).bands == result.bands
    assert simulate(*args, 60, Decimal("500000"), [(999, Decimal("500"))]).bands == result.bands


def test_simulate_shares_the_deterministic_drop_schedule():
    # Sigma 0 collapses every path onto exp(mu_m) = (1+r)^(1/12) — the deterministic
    # recurrence itself — so p50 must TRACK project() month for month. That is what pins
    # the two functions onto ONE schedule: a mismatched index or a missed sum would
    # diverge by the drop amount, orders of magnitude above this tolerance. The tolerance
    # itself is float-vs-Decimal dust only (~1e-9 on these magnitudes).
    schedule = [(24, Decimal("2500.00"))]
    line = project(Decimal("100000"), Decimal("4000"), Decimal("0.05"), 60, Decimal("0.03"),
                   schedule)
    fan = simulate(Decimal("100000"), Decimal("4000"), Decimal("0.05"), Decimal("0"),
                   Decimal("0.03"), 60, None, schedule)
    for index, point in enumerate(line):
        assert abs(fan.bands["p50"][index] - point) <= Decimal("0.05"), index


def test_simulate_drops_lower_every_band_from_the_retirement_month():
    # Same seed, same draws: the only difference is 2,000 a month leaving the stream at
    # month 12, so nothing after it can be higher and the end must be strictly lower.
    args = (Decimal("100000"), Decimal("4000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    full = simulate(*args, 36, None)
    retired = simulate(*args, 36, None, [(12, Decimal("2000.00"))])
    for key in BAND_KEYS:
        assert retired.bands[key][:12] == full.bands[key][:12]  # nothing before it moves
        assert retired.bands[key][-1] < full.bands[key][-1]


def test_simulate_floors_the_stream_at_zero():
    # A drop bigger than the stream retires it entirely; the escalator cannot revive a 0.
    args = (Decimal("100000"), Decimal("1000"), Decimal("0.05"), Decimal("0.15"),
            Decimal("0.05"))
    retired = simulate(*args, 36, None, [(6, Decimal("5000.00"))])
    coasting = simulate(Decimal("100000"), Decimal("0"), Decimal("0.05"), Decimal("0.15"),
                        Decimal("0.05"), 36, None, [(6, Decimal("5000.00"))])
    # From month 6 on, a retired stream and a stream that never existed are the same walk
    # — the balances differ only by the six contributions made before the drop.
    assert retired.bands["p50"][-1] > coasting.bands["p50"][-1]
    assert all(v >= Decimal("0") for v in retired.bands["p10"])
```

- [ ] **Step 3: Run and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_montecarlo.py -q
```

Expected: the four new tests fail (`simulate() takes 7 positional arguments but 8 were given`); the pre-existing ones stay green.

- [ ] **Step 4: Implement.** In `backend/app/services/montecarlo.py`, replace the import block (lines 22-25) with:

```python
import math
import random
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.services.projection import drop_schedule
```

Then replace the whole `simulate` function (lines 55-96) with:

```python
def simulate(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    volatility: Decimal,
    contribution_growth: Decimal,
    months: int,
    target: Decimal | None,
    drops: Sequence[tuple[int, Decimal]] = (),
) -> MonteCarloResult:
    """`annual_return`/`contribution_growth` arrive ALREADY converted to real terms by
    the router when inflation is in play — this module knows nothing about inflation.

    `drops` is the deterministic engine's retirement schedule, normalised by
    `services.projection.drop_schedule` rather than re-derived here: the fan has to bend
    exactly where the line bends, so there is one owner of "two drops in one month sum,
    index 0 folds onto 1". Applying it costs the walk no randomness — one dict lookup per
    month, no extra rng draw — which is what keeps an empty schedule byte-identical.
    """
    rng = random.Random(MC_SEED)
    start = float(starting_balance)
    base_contribution = float(monthly_contribution)
    mu_m = math.log(1 + float(annual_return)) / 12
    sigma_m = float(volatility) / math.sqrt(12)
    growth_m = (1 + float(contribution_growth)) ** (1 / 12)
    target_f = None if target is None else float(target)
    # Converted ONCE, outside the path loop: the schedule is the same for every path.
    schedule = {index: float(amount) for index, amount in drop_schedule(drops).items()}

    paths: list[list[float]] = []
    reach_indices: list[int | None] = []
    for _ in range(SIMULATIONS):
        balance = start
        path = [balance]
        reached: int | None = 0 if target_f is not None and balance >= target_f else None
        contribution = base_contribution
        for month_index in range(1, months + 1):
            drop = schedule.get(month_index)
            if drop is not None:
                contribution = max(contribution - drop, 0.0)
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
            value = Decimal(str(_percentile(column, p))).quantize(CENT, rounding=ROUND_HALF_UP)
            bands[f"p{p}"].append(value)
    return MonteCarloResult(bands=bands, reach_indices=reach_indices)
```

Also extend the module docstring's model paragraph — after the sentence ending `and may escalate geometrically.` (line 18-19), add: `A retirement schedule may decrement it at named month indices (services/projection.drop_schedule's rule, floored at 0).`

- [ ] **Step 5: Run to green.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_montecarlo.py -q
```

- [ ] **Step 6: GOLDEN CHECK — the API's pins again, unmodified.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py -q
```

Expected: green, including `test_projection_seed_stability` and `test_projection_bands_shape_and_alignment`. **If a band moved, STOP** — the walk consumed different randomness.

- [ ] **Step 7: Lint and commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m ruff check app tests
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): the Monte Carlo fan consumes the same retirement schedule"
```

---

## Phase 2 — The API

### Task 3: `retire=<person_id>:<YYYY-MM>` — schema, resolution, echo, wiring

**Files:**
- `backend/app/schemas/projection.py` (whole file — 41 lines today)
- `backend/app/api/projection.py` (imports 20-35; constants 41-76; signature 132-143; body 232-323)
- `backend/tests/test_projection_api.py` (helpers near line 23; new API tests after `test_projection_bounds_the_monte_carlo_knobs`, i.e. before the `--- the engine itself` divider at line 398)

- [ ] **Step 1: Write the failing API tests.** First extend the imports at the top of `backend/tests/test_projection_api.py` — line 1 becomes `from datetime import date, timedelta`, and the model import block (lines 4-11) gains `PaycheckProfile` and `Person`:

```python
from datetime import date, timedelta
from decimal import Decimal

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    SpendingCategory,
)
from app.services.projection import drop_schedule, project
```

Then insert these helpers directly after `_seed_book` (i.e. after line 62's `return this_month`):

```python
async def _seed_person(db, name: str, *, primary: bool = False) -> Person:
    """`create_all` seeds no roster, so every retirement test names its own people."""
    person = Person(name=name, is_primary=primary)
    db.add(person)
    await db.commit()
    return person


async def _seed_profile(db, person: Person, **overrides) -> PaycheckProfile:
    """A deliberately round profile: 24,000/yr over 24 periods with every pct and rider at
    0 nets 1,000.00 a check, i.e. a monthly_net of exactly 2,000.00 — so the drop the
    endpoint applies is checkable by eye against the 4,000 derived contribution."""
    fields = {
        "effective_date": date.today() - timedelta(days=30),
        "annual_salary": Decimal("24000.00"),
        "pay_periods_per_year": 24,
    }
    fields.update(overrides)
    profile = PaycheckProfile(person_id=person.id, **fields)
    db.add(profile)
    await db.commit()
    return profile


def _month_param(month: date) -> str:
    return f"{month:%Y-%m}"
```

Now append these tests immediately before the `# --- the engine itself` divider:

```python
# --- dual-career retirements (2026-08-28 spec §4.3) ---


async def test_projection_without_retire_params_echoes_an_empty_list(auth_client, db):
    # The wire GAINS exactly one key. Every array is measured against the SAME constants
    # the pre-retirement pin uses, so "byte-identical outputs" is a test, not a hope.
    await _seed_book(db)
    zeros = "volatility=0&inflation=0&contribution_growth=0"
    body = (await auth_client.get(f"/api/v1/projection?years=2&{zeros}")).json()
    assert body["retirements"] == []
    assert body["projected"] == BACKCOMPAT_PROJECTED_2Y
    assert body["coast"] == BACKCOMPAT_COAST_2Y


async def test_projection_retirement_drops_the_stream_and_echoes_what_it_did(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    retires = month_add(this_month, 12)
    # Nominal zeros make the chain exact addition: 4,000/month until month 12, where
    # Alex's 2,000 take-home leaves the stream.
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()

    assert body["retirements"] == [
        {
            "person_id": alex.id,
            "name": "Alex",
            "month": retires.isoformat(),
            "monthly_drop": "2000.00",
        }
    ]
    assert body["projected"][11] == "144000.00"  # 100,000 + 11 x 4,000
    assert body["projected"][12] == "146000.00"  # the first HALVED month
    assert body["projected"][13] == "148000.00"
    # The coast line has no contribution to drop — it must not move an inch.
    assert body["coast"][12] == "100000.00"


async def test_projection_retirement_drop_is_not_deflated(auth_client, db):
    # 3% return against 3% inflation is a real rate of exactly 0, and 3% contribution
    # growth against it is exactly 0 too, so every month-over-month step is the raw
    # contribution. The drop is a TODAY's-dollars figure like the contribution itself and
    # crosses the Fisher conversion UNTOUCHED: the step must fall by exactly 2,000.00.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    retires = month_add(this_month, 6)
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0.03&inflation=0.03&contribution_growth=0.03"
            f"&volatility=0&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()

    def step(i: int) -> Decimal:
        return Decimal(body["projected"][i]) - Decimal(body["projected"][i - 1])

    assert step(5) == Decimal("4000.00")
    assert step(6) == Decimal("2000.00")
    assert step(7) == Decimal("2000.00")


async def test_projection_two_retirements_echo_sorted_by_month(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo, annual_salary=Decimal("48000.00"))  # nets 4,000 a month
    early, late = month_add(this_month, 6), month_add(this_month, 18)
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(late)}&retire={bo.id}:{_month_param(early)}"
        )
    ).json()

    # Order-free params, an echo in the order the drops actually HAPPEN.
    assert [row["name"] for row in body["retirements"]] == ["Bo", "Alex"]
    assert [row["monthly_drop"] for row in body["retirements"]] == ["4000.00", "2000.00"]
    # Bo's 4,000 retires the whole 4,000 stream at month 6; Alex's 2,000 then has nothing
    # left to take (the floor), so the balance simply stops moving.
    assert body["projected"][5] == "120000.00"
    assert body["projected"][6] == "120000.00"
    assert body["projected"][19] == "120000.00"


async def test_projection_retirement_reaches_the_monte_carlo_fan(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    base = "/api/v1/projection?volatility=0.15&years=5"
    full = (await auth_client.get(base)).json()
    retired = (
        await auth_client.get(
            f"{base}&retire={alex.id}:{_month_param(month_add(this_month, 12))}"
        )
    ).json()
    # The fan has to wrap the line it belongs to: same seed, smaller stream, lower bands.
    assert Decimal(retired["bands"]["p50"][-1]) < Decimal(full["bands"]["p50"][-1])
    assert Decimal(retired["bands"]["p90"][-1]) < Decimal(full["bands"]["p90"][-1])
    assert retired["bands"]["p50"][:12] == full["bands"]["p50"][:12]


async def test_projection_retirement_validation_table(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")  # no profile at all
    await _seed_profile(db, alex)
    soon = _month_param(month_add(this_month, 6))
    fmt = "retire must be '<person_id>:<YYYY-MM>' (e.g. retire=2:2035-06)"

    for bad in ("alex", f"{alex.id}", f"{alex.id}:2035", f"{alex.id}:2035-6",
                f"{alex.id}:2035-13", f"{alex.id}:2035-06-01", f":{soon}"):
        resp = await auth_client.get(f"/api/v1/projection?retire={bad}")
        assert resp.status_code == 422, bad
        assert resp.json()["detail"] == fmt, bad

    resp = await auth_client.get(f"/api/v1/projection?retire=987654:{soon}")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "retire names person 987654, who is not in the household"

    resp = await auth_client.get(
        f"/api/v1/projection?retire={alex.id}:{soon}&retire={alex.id}:{soon}"
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Alex has more than one retirement month"

    for outside in (month_add(this_month, -1), month_add(this_month, 400)):
        resp = await auth_client.get(
            f"/api/v1/projection?retire={alex.id}:{_month_param(outside)}"
        )
        assert resp.status_code == 422
        assert "Alex's retirement month is outside the 30-year horizon" in resp.json()["detail"]

    resp = await auth_client.get(f"/api/v1/projection?retire={bo.id}:{soon}")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Bo has no paycheck profile in force — nothing to drop"


async def test_projection_retirement_answers_on_the_first_bad_param(auth_client, db):
    # Order-free params, ONE answer: the first one with a problem is the one that speaks,
    # so a fix is a fix rather than the first of several.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    soon = _month_param(month_add(this_month, 6))
    resp = await auth_client.get(f"/api/v1/projection?retire=nonsense&retire=987654:{soon}")
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith("retire must be")


async def test_projection_retirement_degrades_on_unusable_stored_profiles(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    # A hand-written 0 cadence: `gross = salary / periods` would be a DivisionByZero 500,
    # so the projection refuses in the PAYCHECK router's own words rather than crashing.
    await _seed_profile(db, alex, pay_periods_per_year=0)
    resp = await auth_client.get(
        f"/api/v1/projection?retire={alex.id}:{_month_param(month_add(this_month, 6))}"
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "Alex's paycheck profile: pay_periods_per_year must be between 1 and 366"
    )


async def test_projection_retirement_of_a_negative_net_drops_nothing(auth_client, db):
    # An over-committed check nets negative: gross 1,000 with 50% roth and 80% espp is
    # -300 a check, -600.00 a month. A retirement must never ADD to the stream, so the
    # drop floors at 0 — and the echo says 0.00 rather than inventing a raise.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, roth_401k_pct=Decimal("0.500000000"),
                        espp_pct=Decimal("0.800000000"))
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(month_add(this_month, 6))}"
        )
    ).json()
    assert body["retirements"][0]["monthly_drop"] == "0.00"
    assert body["projected"][7] == "128000.00"  # 100,000 + 7 x 4,000, untouched


async def test_projection_retirement_uses_the_profile_in_force_not_the_newest(auth_client, db):
    # The Paycheck page, the Taxes page and this drop must never disagree about which
    # profile is current: a raise dated next year is not today's take-home.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)  # 24,000 -> 2,000/month, effective 30 days ago
    await _seed_profile(db, alex, effective_date=date.today() + timedelta(days=400),
                        annual_salary=Decimal("120000.00"))
    body = (
        await auth_client.get(
            f"/api/v1/projection?retire={alex.id}:{_month_param(month_add(this_month, 6))}"
        )
    ).json()
    assert body["retirements"][0]["monthly_drop"] == "2000.00"
```

- [ ] **Step 2: Run and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py -q -k retirement
```

Expected: failures — `KeyError: 'retirements'` on the echo tests and 200s where 422s are expected (an unknown query param is ignored today).

- [ ] **Step 3: Add the schema.** Replace `backend/app/schemas/projection.py` with this COMPLETE content:

```python
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class RetirementOut(BaseModel):
    """One resolved `retire=<person_id>:<YYYY-MM>` param (2026-08-28 spec §4.3).

    `monthly_drop` is that person's take-home from the paycheck profile in force AT
    REQUEST TIME — today's honest approximation, named in the page's hint — so the echo is
    also what tells the user what a date actually costs the contribution stream.
    """

    person_id: int
    name: str
    month: date  # always a first-of-month, on the projection's own axis
    monthly_drop: Decimal


class ProjectionOut(BaseModel):
    # Echoed knobs — the values the model actually ran with (the ESPP modeler's posture:
    # the echo IS what the page's form seeds from).
    starting_balance: Decimal
    base_month: date  # the snapshot month the starting balance came from
    start_month: date  # the projection's t0 — the current calendar month
    annual_return: Decimal
    monthly_contribution: Decimal
    annual_spend: Decimal | None
    swr_pct: Decimal
    years: int
    # Derived headline figures — null whenever there is no spend/SWR to make a target of.
    fi_target: Decimal | None
    fi_ratio: Decimal | None
    fi_month: date | None
    coast_fi_month: date | None
    # Parallel arrays (GET /portfolio/history's posture): index i across all three lists
    # is one month.
    months: list[date]
    projected: list[Decimal]
    coast: list[Decimal]
    warnings: list[str]
    # Monte Carlo. A live server now always echoes the three assumption knobs (absent ones
    # default in the router), and `bands`/probability/percentile months are present unless
    # volatility is an explicit 0. The echoes stay NULLABLE anyway: a stale tab or a stored
    # older payload must keep rendering, and the page reads a null echo as "no placeholder".
    volatility: Decimal | None = None
    inflation: Decimal | None = None
    contribution_growth: Decimal | None = None
    bands: dict[str, list[Decimal]] | None = None
    fi_probability: Decimal | None = None
    fi_month_p10: date | None = None
    fi_month_p50: date | None = None
    fi_month_p90: date | None = None
    # The retirements this run applied, SORTED BY MONTH — the order the drops happen, so
    # the echo, the chart's markLines and the engine's schedule all read the same way.
    # Empty for every request without a `retire` param, which leaves the rest of this
    # payload byte-identical to the pre-retirement one.
    retirements: list[RetirementOut] = []
```

- [ ] **Step 4: Implement the router.** In `backend/app/api/projection.py`:

**(a)** Replace the import block (lines 20-35) with:

```python
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user

# Cross-router borrow, on taxes.py's precedent: the paycheck router owns the "profile in
# force" rule AND the divide-by-zero fence on a stored cadence. The Paycheck page, the
# Taxes page and this drop must never disagree about which profile is current, and a
# second copy of either rule here could only drift.
from app.api.paycheck import MIN_PAY_PERIODS, PAY_PERIODS_MESSAGE, _default_profile
from app.database import get_db
from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot
from app.schemas.projection import ProjectionOut, RetirementOut
from app.services.money import quantize_money, quantize_pct
from app.services.montecarlo import SIMULATIONS, reach_percentile, simulate
from app.services.net_worth_calc import get_swr_pct, investable_base
from app.services.paycheck_calc import breakdown, half_up2
from app.services.people import load_people
from app.services.projection import CENT, first_reaching, project
```

**(b)** After `YearsQuery = Annotated[int, Query(ge=1, le=60)]` (line 70) insert:

```python
# Repeated, order-free, and STRINGS: "<person_id>:<YYYY-MM>" is one value the user can see
# in the URL, where two parallel int/date lists could arrive at different lengths. No count
# fence is needed — a second mention of the same person 422s, so the loop below can never
# run longer than the roster.
RetireQuery = Annotated[list[str] | None, Query()]
RETIRE_PATTERN = re.compile(r"^(\d{1,10}):(\d{4})-(\d{2})$")
RETIRE_FORMAT_MESSAGE = "retire must be '<person_id>:<YYYY-MM>' (e.g. retire=2:2035-06)"
```

**(c)** After `_trailing_savings` (i.e. after line 129's `return total / len(cash)`) insert:

```python
async def _resolve_retirements(
    db: AsyncSession, raw: list[str], months: list[date], years: int, today: date
) -> list[RetirementOut]:
    """`retire=<person_id>:<YYYY-MM>` params resolved to the echo rows, sorted by month.

    Every refusal is a 422 carrying the sentence the page renders verbatim, and the FIRST
    param with a problem is the one that answers: the params are order-free, so reporting
    them all would only make the message longer, never the fix clearer. Within one param
    the order is fixed — format, person, duplicate, horizon, profile, cadence — so the
    message always names the nearest thing to fix.

    The drop is that person's monthly take-home from the profile `_default_profile` says
    is in force TODAY. It is a today's-dollars figure exactly like `monthly_contribution`,
    and the caller hands it to the engine UNCONVERTED — see the Fisher note at the call.
    """
    people = {person.id: person for person in await load_people(db)}
    rows: list[RetirementOut] = []
    seen: set[int] = set()
    for item in raw:
        match = RETIRE_PATTERN.match(item.strip())
        if match is None:
            raise HTTPException(status_code=422, detail=RETIRE_FORMAT_MESSAGE)
        person_id = int(match.group(1))
        try:
            month = date(int(match.group(2)), int(match.group(3)), 1)
        except ValueError:
            # Month 00 or 13: a spelling problem, answered in the spelling's own words.
            raise HTTPException(status_code=422, detail=RETIRE_FORMAT_MESSAGE) from None
        person = people.get(person_id)
        if person is None:
            raise HTTPException(
                status_code=422,
                detail=f"retire names person {person_id}, who is not in the household",
            )
        if person_id in seen:
            raise HTTPException(
                status_code=422, detail=f"{person.name} has more than one retirement month"
            )
        seen.add(person_id)
        if not months[0] <= month <= months[-1]:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{person.name}'s retirement month is outside the {years}-year horizon "
                    f"({months[0]:%Y-%m} to {months[-1]:%Y-%m})"
                ),
            )
        profile = await _default_profile(db, person_id, today)
        if profile is None:
            raise HTTPException(
                status_code=422,
                detail=f"{person.name} has no paycheck profile in force — nothing to drop",
            )
        if profile.pay_periods_per_year < MIN_PAY_PERIODS:
            # The stored-data fence, in paycheck.py's own words: gross = salary / periods,
            # and a hand-written 0 would be a DivisionByZero 500 inside `breakdown`.
            raise HTTPException(
                status_code=422,
                detail=f"{person.name}'s paycheck profile: {PAY_PERIODS_MESSAGE}",
            )
        drop = half_up2(breakdown(profile)["monthly_net"])
        if drop < ZERO:
            # An over-committed check nets negative; a retirement must never ADD to the
            # stream, so a negative take-home simply has nothing to drop.
            drop = ZERO
        rows.append(
            RetirementOut(person_id=person_id, name=person.name, month=month, monthly_drop=drop)
        )
    # Sorted by month (person id breaks a tie) so the echo, the chart's markLines and the
    # engine's schedule all read in the order the drops actually happen.
    rows.sort(key=lambda row: (row.month, row.person_id))
    return rows
```

**(d)** Add the parameter to the endpoint signature — insert `retire: RetireQuery = None,` between `contribution_growth: Decimal | None = Query(default=None),` (line 141) and `db: AsyncSession = Depends(get_db),`.

**(e)** Replace lines 232-243 (from `month_count = years * 12` through the `coast = project(...)` line) with:

```python
    month_count = years * 12
    months = _months_from(start_month, month_count)
    retirements = await _resolve_retirements(db, retire or [], months, years, today)
    # (month_index, amount), sorted — the SAME schedule feeds the deterministic line and
    # the fan, which is what keeps the bands wrapped around the line they belong to.
    # `months` is contiguous from t0, so the horizon check above guarantees every month
    # is on the axis.
    #
    # The drop does NOT go through the real-terms conversion below: `monthly_drop` is a
    # TODAY's-dollars take-home, exactly like `monthly_contribution`, and the engine's
    # escalator is what carries both forward. Deflating it would model a nominal FUTURE
    # paycheck, which is not what `_default_profile` read. The honest asterisk — the
    # remaining stream escalates in real terms while the drop does not — is named in the
    # page's hint rather than papered over here.
    drops = [(months.index(row.month), row.monthly_drop) for row in retirements]
    # Every ARRAY below runs on `real_return` (= annual_return under an EXPLICIT
    # inflation=0, which is what reproduces the pre-Monte-Carlo arrays byte for byte);
    # the ECHOED `annual_return` stays the NOMINAL value the user provided or the default
    # — the echo is what seeds the form, and `inflation` echoes separately so the page can
    # reconstruct the real rate.
    projected = project(
        starting, monthly_contribution, real_return, month_count, real_growth, drops
    )
    # The coast line: the same growth with the contributions turned off — the distance
    # between the two lines is what the saving is buying. Nothing to escalate, so the
    # escalator is 0 here too, and nothing to drop either: a retirement cannot move a
    # stream that is already off.
    coast = project(starting, ZERO, real_return, month_count, Decimal("0"))
```

Note the comment block that used to sit above `projected` (lines 234-238) moves with it, and the `_months_from` call moves ABOVE the retirement resolution — the resolver needs the axis for its horizon check.

**(f)** Add `drops` to the simulate call — the `mc = simulate(` block (lines 275-283) becomes:

```python
        mc = simulate(
            starting,
            monthly_contribution,
            real_return,
            volatility,
            real_growth,
            month_count,
            fi_target,
            drops,
        )
```

**(g)** Add `retirements=retirements,` to the `ProjectionOut(...)` construction, immediately after `fi_month_p90=fi_month_p90,`.

**(h)** Extend the module docstring — after the paragraph ending `blank always means "whatever the echo says".` add:

```
Retirements (2026-08-28 spec §4.3) arrive as repeated `retire=<person_id>:<YYYY-MM>`
params and are the one input this module resolves against ANOTHER router's rule: the drop
is the take-home of the paycheck profile `paycheck._default_profile` says is in force
today. Absent, the response is the pre-retirement one plus an empty `retirements` echo.
```

- [ ] **Step 5: Run the new tests to green.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py -q
```

Expected: every test green, including all the pre-existing ones.

- [ ] **Step 6: GOLDEN CHECK — the whole backend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest -q
```

Expected: 1131 + the new tests, zero failures. A failure in `test_paycheck_comp_api.py` or `test_taxes_api.py` means the cross-router import created a cycle — STOP and report rather than reshuffling imports.

- [ ] **Step 7: Lint and commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m ruff check app tests
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): retire=<person_id>:<YYYY-MM> params, validation and echo"
```

---

## Phase 3 — The client and the chart grammar

### Task 4: TypeScript types and the `retire` query builder

**Files:**
- `src/types/api.ts` (the projection block, lines 1291-1329)
- `src/api/projection.ts` (whole file — 31 lines today)
- `src/api/projection.test.ts` (append)

- [ ] **Step 1: Write the failing client tests.** Append to `src/api/projection.test.ts`:

```ts
it('appends one retire param per filled month and omits the blanks', async () => {
  await fetchProjection({
    retirements: [
      { personId: 1, month: '2035-06' },
      { personId: 2, month: '' }, // blank = that person works for the whole horizon
      { personId: 3, month: '2040-01' },
    ],
  })
  // Repeated, not comma-joined: FastAPI reads `retire` as a list, and a comma would be
  // one malformed value rather than two good ones.
  expect(path()).toBe('/projection?retire=1%3A2035-06&retire=3%3A2040-01')
})

it('keeps the knobs ahead of the retirements in the query', async () => {
  await fetchProjection({
    annualReturn: '0.07',
    years: '30',
    retirements: [{ personId: 2, month: '2035-06' }],
  })
  expect(path()).toBe('/projection?annual_return=0.07&years=30&retire=2%3A2035-06')
})

it('is still the bare projection when every retirement is blank', async () => {
  await fetchProjection({ retirements: [{ personId: 1, month: '' }] })
  expect(path()).toBe('/projection')
})
```

- [ ] **Step 2: Run and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/api/projection.test.ts
```

Expected: TypeScript rejects `retirements` — `Object literal may only specify known properties`.

- [ ] **Step 3: Implement the types.** In `src/types/api.ts`, insert directly ABOVE `export interface ProjectionOut {` (line 1296):

```ts
/** One resolved retirement (GET /projection?retire=<person_id>:<YYYY-MM>, 2026-08-28
 *  spec §4.3). `month` is a first-of-month ISO date on the projection's own axis;
 *  `monthly_drop` is that person's take-home from the paycheck profile in force at
 *  request time — today's figure, not a projection of it. */
export interface RetirementEcho {
  person_id: number
  name: string
  month: string
  monthly_drop: string
}
```

and add, as the last field of `ProjectionOut` (after `fi_month_p90`):

```ts
  /** Echoed retirements, sorted by month. `[]` from a live server with no `retire`
   *  param; null/absent from a backend older than the dual-career batch — the `bands`
   *  posture, so every reader takes it as `?? []`. */
  retirements: RetirementEcho[] | null
```

- [ ] **Step 4: Implement the client.** Replace `src/api/projection.ts` with this COMPLETE content:

```ts
import { api } from './client'
import type { ProjectionOut } from '../types/api'

/** One retirement knob's value. A blank `month` is "this person works for the whole
 *  horizon" and is omitted from the query entirely — the blank-omits rule below. */
export interface RetirementParam {
  personId: number
  month: string
}

export interface ProjectionParams {
  annualReturn?: string
  monthlyContribution?: string
  annualSpend?: string
  swr?: string
  years?: string
  volatility?: string
  inflation?: string
  contributionGrowth?: string
  retirements?: RetirementParam[]
}

// Blank knobs are OMITTED (the espp client's rule): a blanked box means "derive it
// server-side", and an empty string would 422 as Decimal('').
export function fetchProjection(params: ProjectionParams = {}): Promise<ProjectionOut> {
  const query = new URLSearchParams()
  if (params.annualReturn) query.set('annual_return', params.annualReturn)
  if (params.monthlyContribution) query.set('monthly_contribution', params.monthlyContribution)
  if (params.annualSpend) query.set('annual_spend', params.annualSpend)
  if (params.swr) query.set('swr', params.swr)
  if (params.years) query.set('years', params.years)
  // Blank omits (the server then defaults it); "0" is a VALUE and must survive this
  // filter — it is the fan's off switch. Non-empty strings are truthy, "0" included.
  if (params.volatility) query.set('volatility', params.volatility)
  if (params.inflation) query.set('inflation', params.inflation)
  if (params.contributionGrowth) query.set('contribution_growth', params.contributionGrowth)
  // APPEND, never set: `retire` is a repeated param server-side, one per retiring person,
  // and a blank month is the absence of a retirement rather than an empty one.
  for (const retirement of params.retirements ?? []) {
    if (retirement.month) query.append('retire', `${retirement.personId}:${retirement.month}`)
  }
  const qs = query.toString()
  return api<ProjectionOut>(`/projection${qs ? `?${qs}` : ''}`)
}
```

- [ ] **Step 5: Run to green.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/api/projection.test.ts
```

- [ ] **Step 6: Fix the one fixture the new required field breaks.** In `src/pages/ProjectionPage.test.tsx`, add `retirements: [],` to the `projectionOut()` fixture (after `fi_month_p90: '2061-03-01',`, before the `...over` spread). Then:

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/ProjectionPage.test.tsx && npx tsc -b
```

Expected: green, and `tsc -b` clean.

- [ ] **Step 7: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): retirements on the projection client and types"
```

---

### Task 5: Extract the shared markLine grammar (no rendered change)

**Files:**
- `src/charts/markLine.ts` (new)
- `src/charts/markLine.test.ts` (new)
- `src/components/networth/netWorthChartOptions.ts` (imports at lines 4 and 7; `marriageMarkLine` at lines 105-127)

- [ ] **Step 1: Write the failing test.** Create `src/charts/markLine.test.ts` with COMPLETE content:

```ts
import { describe, expect, it } from 'vitest'
import { MUTED } from './theme'
import { MARK_LINE_LABEL, MARK_LINE_STYLE, anchorMonthLabel } from './markLine'

const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']

describe('anchorMonthLabel', () => {
  it('speaks the axis vocabulary — a formatMonth LABEL, never an ISO string', () => {
    // The x-axis carries formatMonth labels, so a markLine's value has to be one too.
    expect(anchorMonthLabel(MONTHS, '2026-08-14')).toBe('Aug 2026')
    expect(anchorMonthLabel(MONTHS, '2026-08-01')).toBe('Aug 2026')
  })

  it('falls FORWARD when the exact month is not on the axis', () => {
    expect(anchorMonthLabel(['2026-06-01', '2026-09-01'], '2026-08-14')).toBe('Sep 2026')
  })

  it('draws nothing it cannot honestly place', () => {
    expect(anchorMonthLabel(MONTHS, null)).toBeUndefined()
    expect(anchorMonthLabel(MONTHS, undefined)).toBeUndefined()
    expect(anchorMonthLabel(MONTHS, '')).toBeUndefined()
    expect(anchorMonthLabel([], '2026-08-14')).toBeUndefined()
    // Later than every month on the axis: clamping onto the last one would date the rule
    // to a month the event is not in.
    expect(anchorMonthLabel(MONTHS, '2027-01-01')).toBeUndefined()
  })
})

describe('the annotation vocabulary', () => {
  it('is dashed, hairline and muted — solid is reserved for data', () => {
    expect(MARK_LINE_STYLE).toEqual({ color: MUTED, width: 1, type: 'dashed' })
    expect(MARK_LINE_LABEL).toEqual({
      show: true,
      position: 'insideEndTop',
      color: MUTED,
      fontSize: 11,
    })
  })
})
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/charts/markLine.test.ts
```

Expected: `Failed to resolve import "./markLine"`.

- [ ] **Step 3: Implement.** Create `src/charts/markLine.ts` with COMPLETE content:

```ts
// Shared category-axis annotation grammar: the ANCHOR rule (an ISO date onto a
// formatMonth axis, falling forward) and the dashed-MUTED vocabulary every vertical rule
// in this app wears. One owner, because two copies of "which month does this land on"
// could only drift — the wedding rule on the net-worth trend and the retirement rules on
// the projection are the same annotation with different words.
import { MUTED } from './theme'
import { formatMonth } from '../utils/format'

/** Dashed, hairline, muted: the annotation/threshold vocabulary. Solid is for data. */
export const MARK_LINE_STYLE = { color: MUTED, width: 1, type: 'dashed' as const }

/** The label block a vertical rule wears. Callers supply the words — one `formatter` at
 *  this level for a single-rule annotation, or one per `data` entry when each rule has
 *  its own name (echarts merges the entry's label over this one). */
export const MARK_LINE_LABEL = {
  show: true as const,
  position: 'insideEndTop' as const,
  color: MUTED,
  fontSize: 11,
}

/**
 * The x-axis category label an ISO date lands on, or undefined when it cannot be placed.
 *
 * The date is normalised to its month; if that exact month is not on the axis (a gap, or
 * quarterly granularity) the anchor falls FORWARD to the first month after it. A date
 * later than every month returns undefined — there is nothing to mark yet, and clamping
 * onto the last month would date a rule to a month the event is not in.
 */
export function anchorMonthLabel(
  months: string[],
  iso: string | null | undefined,
): string | undefined {
  if (!iso || months.length === 0) return undefined
  // ISO first-of-month strings compare lexicographically (utils/months.ts's contract).
  const bucket = `${iso.slice(0, 7)}-01`
  const index = months.findIndex((month) => month >= bucket)
  return index === -1 ? undefined : formatMonth(months[index])
}
```

- [ ] **Step 4: Delegate the marriage annotation to it.** In `src/components/networth/netWorthChartOptions.ts`:

Replace line 4 with `import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'`, replace line 7 with `import { escapeHtml, formatCurrency } from '../../utils/format'`, and add after line 4:

```ts
import { MARK_LINE_LABEL, MARK_LINE_STYLE, anchorMonthLabel } from '../../charts/markLine'
```

Then replace the body of `marriageMarkLine` (lines 105-127) with:

```ts
export function marriageMarkLine(
  months: string[],
  marriageDate: string | null | undefined,
): MarriageMarkLine | undefined {
  const anchor = anchorMonthLabel(months, marriageDate)
  if (anchor === undefined) return undefined
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { ...MARK_LINE_STYLE },
    label: { ...MARK_LINE_LABEL, formatter: 'Married' },
    data: [{ xAxis: anchor }],
  }
}
```

Leave the docstring at lines 94-104 in place, but replace its second paragraph (`The x-axis is a CATEGORY axis…` through `…date a line to the future.`) with:

```
 * The anchor rule lives in charts/markLine.ts (shared with the projection's retirement
 * rules): a formatMonth LABEL rather than an ISO date, falling forward through a gap, and
 * undefined for a wedding later than every snapshot.
```

- [ ] **Step 5: Run to green — the net-worth suites must be UNTOUCHED and still pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/charts/markLine.test.ts src/components/networth/netWorthChartOptions.test.ts src/pages/NetWorthPage.test.tsx
```

Expected: all green with **no edits to either net-worth test file**. `marriageMarkLine`'s returned shape is identical, which is the whole point of the extraction. **If either goes red, revert Step 4 and report** — the projection can carry its own copy rather than change what the net-worth chart draws.

- [ ] **Step 6: Lint and commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx eslint src/charts/markLine.ts src/components/networth/netWorthChartOptions.ts && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): share the month-annotation anchor and dashed vocabulary"
```

---

### Task 6: `retirementMarkLine` on the projected-balance chart

**Files:**
- `src/components/projection/projectionChartOptions.ts` (imports 4-12; `projectionOption` signature at 87-89; the Projected series at 179-187)
- `src/components/projection/projectionChartOptions.test.ts` (`DATA` at 15-21; append a `describe`)

- [ ] **Step 1: Write the failing builder tests.** In `src/components/projection/projectionChartOptions.test.ts`, extend the narrowing helper `read` (lines 34-52) so the series slice exposes the annotation — add this property inside the `series: { … }[]` shape, after `lineStyle: { type?: string; width?: number }`:

```ts
      markLine?: {
        silent: boolean
        symbol: string
        lineStyle: { color: string; width: number; type: string }
        label: { show: boolean; position: string; color: string; fontSize: number }
        data: { xAxis: string; label: { formatter: string } }[]
      }
```

Then append this COMPLETE block to the end of the file:

```ts
import { MARK_LINE_LABEL, MARK_LINE_STYLE } from '../../charts/markLine'
import { retirementMarkLine } from './projectionChartOptions'

describe('retirementMarkLine', () => {
  const MONTHS = ['2026-08-01', '2026-09-01', '2026-10-01']

  it('draws one dashed muted rule per retirement, each labelled with the name', () => {
    const mark = retirementMarkLine(MONTHS, [
      { month: '2026-09-01', name: 'Alex' },
      { month: '2026-10-01', name: 'Bo' },
    ])
    // The axis carries formatMonth labels, so the rules have to speak the same words.
    expect(mark?.data).toEqual([
      { xAxis: 'Sep 2026', label: { formatter: 'Alex' } },
      { xAxis: 'Oct 2026', label: { formatter: 'Bo' } },
    ])
    expect(mark?.lineStyle).toEqual(MARK_LINE_STYLE)
    expect(mark?.label).toEqual(MARK_LINE_LABEL)
    expect(mark?.silent).toBe(true)
    expect(mark?.symbol).toBe('none')
  })

  it('draws nothing it cannot honestly place', () => {
    expect(retirementMarkLine(MONTHS, [])).toBeUndefined()
    // A payload whose horizon shrank under a stale tab: the server fences the month into
    // the axis, so this is a guard, and it DROPS the rule rather than clamping it.
    expect(retirementMarkLine(MONTHS, [{ month: '2040-01-01', name: 'Alex' }])).toBeUndefined()
    expect(retirementMarkLine([], [{ month: '2026-09-01', name: 'Alex' }])).toBeUndefined()
  })
})

describe('projectionOption retirement rules', () => {
  it('hangs the rules on the Projected series, above the fan', () => {
    const option = read(
      projectionOption({
        ...DATA,
        retirements: [
          {
            person_id: 2,
            name: 'Alex',
            month: '2026-09-01',
            monthly_drop: '2000.00',
          },
        ],
      }),
    )
    const projected = option.series.find((s) => s.name === PROJECTION_SERIES[0])
    expect(projected?.markLine?.data).toEqual([{ xAxis: 'Sep 2026', label: { formatter: 'Alex' } }])
    // One annotation, on the ONE series every payload has.
    expect(option.series.filter((s) => s.markLine !== undefined)).toHaveLength(1)
  })

  it('carries no markLine at all without retirements — back-compat', () => {
    // Both shapes: a live server's empty list and a stale payload with no key.
    for (const data of [{ ...DATA, retirements: [] }, DATA]) {
      const option = read(projectionOption(data))
      expect(option.series.every((s) => s.markLine === undefined)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/projection/projectionChartOptions.test.ts
```

Expected: `retirementMarkLine is not exported`.

- [ ] **Step 3: Implement.** In `src/components/projection/projectionChartOptions.ts`:

Add to the imports (after line 4's `import type { EChartsOption }`):

```ts
import { MARK_LINE_LABEL, MARK_LINE_STYLE, anchorMonthLabel } from '../../charts/markLine'
```

Insert this above `projectionOption`'s docstring (line 77):

```ts
/** The annotation shape — narrow on purpose, so the test can read it without echarts'
 *  `any`-ish option types (the MarriageMarkLine posture). */
export interface RetirementMarkLine {
  silent: true
  symbol: 'none'
  lineStyle: { color: string; width: number; type: 'dashed' }
  label: { show: true; position: 'insideEndTop'; color: string; fontSize: number }
  data: { xAxis: string; label: { formatter: string } }[]
}

/**
 * One dashed vertical rule per echoed retirement, each labelled with that person's name
 * — the wedding annotation's grammar, shared through charts/markLine.ts rather than
 * copied. The step at each rule is REAL (the contribution stream drops there), so it has
 * to read as intentional rather than as a kink in the data.
 *
 * The server has already fenced every month onto this axis, so the fall-forward anchor is
 * only a guard for a stale payload whose horizon shrank: a rule that cannot be placed is
 * DROPPED, never clamped onto a month the retirement is not in.
 */
export function retirementMarkLine(
  months: string[],
  retirements: { month: string; name: string }[],
): RetirementMarkLine | undefined {
  const data = retirements
    .map((retirement) => ({
      xAxis: anchorMonthLabel(months, retirement.month),
      label: { formatter: retirement.name },
    }))
    .filter((entry): entry is { xAxis: string; label: { formatter: string } } => {
      return entry.xAxis !== undefined
    })
  if (data.length === 0) return undefined
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { ...MARK_LINE_STYLE },
    label: { ...MARK_LINE_LABEL },
    data,
  }
}
```

Change `projectionOption`'s signature (lines 87-89) to:

```ts
export function projectionOption(
  data: Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'fi_target' | 'bands'> &
    Partial<Pick<ProjectionOut, 'retirements'>>,
): EChartsOption | null {
```

(`Partial` on purpose: every existing call site and fixture keeps compiling, and a stale payload with no key reads as "no rules".)

Add, immediately after `const bands = data.bands ?? null` (line 92):

```ts
  const retirementMark = retirementMarkLine(data.months, data.retirements ?? [])
```

and hang it on the Projected series — the series object at lines 179-187 becomes:

```ts
      {
        name: PROJECTION_SERIES[0],
        type: 'line',
        symbol: 'none',
        lineStyle: { width: 2 },
        color: PALETTE[0],
        areaStyle: { opacity: 0.12 },
        // The retirement rules ride the ONE series every payload has, above the fan.
        ...(retirementMark ? { markLine: retirementMark } : {}),
        data: data.projected.map(Number),
      },
```

- [ ] **Step 4: Run to green.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/projection/projectionChartOptions.test.ts src/charts/markLine.test.ts
```

- [ ] **Step 5: Lint and commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx eslint src/components/projection/projectionChartOptions.ts && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): a dashed named rule per retirement on the balance chart"
```

---

## Phase 4 — The page

### Task 7: Retires knobs, the household fetch, and the honest hint

**Files:**
- `src/pages/ProjectionPage.tsx` (imports 1-23; state 94-126; `recalculate` 218-311; the form 504-588)
- `src/pages/ProjectionPage.test.tsx` (mocks 13-45; fixture 50-84; helpers 128-157; new `describe`)

- [ ] **Step 1: Write the failing page tests.** In `src/pages/ProjectionPage.test.tsx`:

**(a)** Add the household mock next to the others (after the `vi.mock('../api/netWorth', …)` block at lines 40-43):

```tsx
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
import { fetchHousehold } from '../api/household'
```

**(b)** Extend the EChart mock (lines 19-39) so the annotation is readable — replace the whole `vi.mock('../components/EChart', …)` block with:

```tsx
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      animateEntrance = true,
    }: {
      option: {
        xAxis?: { data?: unknown[] }
        series?: {
          name?: string
          markLine?: { data?: { xAxis?: string; label?: { formatter?: string } }[] }
        }[]
      }
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        // Series names are the option capture: WHICH curves a payload puts on the chart
        // is the page's business (their geometry is pinned in the builder's own test).
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join(','),
        // ...and WHICH annotations it puts there (NetWorthPage's data-marriage idiom).
        'data-marks': (option.series ?? [])
          .flatMap((s) => s.markLine?.data ?? [])
          .map((d) => `${d.xAxis ?? ''}=${d.label?.formatter ?? ''}`)
          .join('|'),
      }),
  }
})
```

**(c)** Add a household fixture next to `timeseries()` (after line 126):

```tsx
function household(people = [
  { id: 1, name: 'Me', is_primary: true },
  { id: 2, name: 'Alex', is_primary: false },
]) {
  return { people, marriage_date: null }
}
```

**(d)** Seed it in `beforeEach` (line 148-152) — add `vi.mocked(fetchHousehold).mockResolvedValue(household())` after the `fetchTimeseries` line.

**(e)** The existing "hands blanks through as omissions" assertion at lines 189-200 now also carries the retirements array — add `retirements: [],` as the last property of the expected object (both boxes are blank, so the page sends an empty list, which the client turns into no query at all).

**(f)** Append this COMPLETE `describe` block to the end of the file:

```tsx
describe('ProjectionPage — dual-career retirements (2026-08-28 spec §4.3)', () => {
  it('offers one Retires knob per household person, blank by default', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    expect(box('Retires — Me').value).toBe('')
    expect(box('Retires — Alex').value).toBe('')
    // Blank is a real answer here, not a derived default: nobody retires.
    expect(screen.getByText(/Blank means that person works for the whole horizon/)).toBeTruthy()
  })

  it('renders one knob for a single-person household — same grammar, new capability', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue(household([{ id: 1, name: 'Me', is_primary: true }]))
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    expect(box('Retires — Me')).toBeTruthy()
    expect(screen.queryByLabelText('Retires — Alex')).toBeNull()
  })

  it('renders no retirement knobs on a roster-less database', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue(household([]))
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    expect(screen.queryByLabelText(/^Retires/)).toBeNull()
    expect(screen.queryByText(/Blank means that person works/)).toBeNull()
  })

  it('keeps the whole page alive when the household fetch alone fails', async () => {
    vi.mocked(fetchHousehold).mockRejectedValue(new ApiError('household unavailable', 500))
    renderPage()

    expect(await screen.findByText('$1,500,000.00')).toBeTruthy() // tiles still stand
    expect(screen.queryByLabelText(/^Retires/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull() // an affordance, never the page banner
  })

  it('sends a filled month as a retirement and leaves the blanks out', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.change(box('Retires — Alex'), { target: { value: '2035-06' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({ retirements: [{ personId: 2, month: '2035-06' }] }),
    )
  })

  it('refuses a malformed month in the box vocabulary, spending no request', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    // jsdom does not enforce type="month", and neither does a pasted value in a browser.
    fireEvent.change(box('Retires — Alex'), { target: { value: '2035-13' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    expect(screen.getByText("Alex's retirement month must look like YYYY-MM")).toBeTruthy()
    expect(fetchProjection).toHaveBeenCalledTimes(1) // the mount load only
  })

  it('draws a dashed rule per echoed retirement, labelled by name', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(
      projectionOut({
        retirements: [
          { person_id: 2, name: 'Alex', month: '2026-09-01', monthly_drop: '2000.00' },
        ],
      }),
    )
    renderPage()

    const charts = await screen.findAllByTestId('echart')
    // [1] is the investable chart (DOM order is card order).
    expect(charts[1].getAttribute('data-marks')).toBe('Sep 2026=Alex')
    // The net-worth trend above it is untouched by retirements.
    expect(charts[0].getAttribute('data-marks')).toBe('')
  })

  it('renders the server refusal verbatim — nothing invented, nothing translated', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))
    vi.mocked(fetchProjection).mockRejectedValue(
      new ApiError('Alex has no paycheck profile in force — nothing to drop', 422),
    )

    fireEvent.change(box('Retires — Alex'), { target: { value: '2035-06' } })
    fireEvent.click(screen.getByRole('button', { name: /^recalculate$/i }))

    expect(
      await screen.findByText(/Alex has no paycheck profile in force — nothing to drop/),
    ).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy() // a refusal IS the page banner
  })

  it('names the approximation the drop actually is', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    expect(screen.getByText(/CURRENT monthly take-home/)).toBeTruthy()
    expect(screen.getByText(/Spending stays a household figure/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/ProjectionPage.test.tsx
```

Expected: the new block fails on `Unable to find a label with the text of: Retires — Me`.

- [ ] **Step 3: Implement the page.** In `src/pages/ProjectionPage.tsx`:

**(a)** Add to the imports — after line 4's `import { fetchTimeseries } from '../api/netWorth'`:

```tsx
import { fetchHousehold } from '../api/household'
```

and extend line 19's type import to `import type { HouseholdOut, NetWorthTimeseries, ProjectionOut } from '../types/api'`.

**(b)** Add a module constant next to the other fences (after line 69's `const YEARS_MAX = 60`):

```tsx
// The BOX's own fence, refused here rather than spending a request on the 422 (the
// PaycheckPage posture): type="month" gives a browser this shape for free, but a paste —
// and jsdom — do not. Everything the box CANNOT see (is this person real, do they have a
// profile, is the month inside the horizon) stays the server's answer, rendered verbatim.
const RETIRE_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
```

**(c)** Add state next to the other page state (after line 115's `const [trendYears, setTrendYears] = useState<TrendSpan>(10)`):

```tsx
  // Fetched on its own, never inside a Promise.all: the knobs are an affordance, and a
  // household hiccup must not blank the projection (NetWorthPage's isolated-fetch
  // posture). null covers both "not loaded yet" and "failed".
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
  // Person id -> "YYYY-MM". Deliberately NOT seeded from the echo, unlike the eight knobs
  // above: blank here does not mean "the server derives one", it means "nobody retires",
  // so there is nothing an echo could seed the box WITH beyond what was typed.
  const [retireMonths, setRetireMonths] = useState<Record<number, string>>({})
```

**(d)** Add the fetch effect after the history effect (after line 211's closing `}, [])`):

```tsx
  useEffect(() => {
    // Once per visit. Its own failure: no knobs, and the rest of the page never notices.
    fetchHousehold()
      .then(setHousehold)
      .catch(() => setHousehold(null))
  }, [])
```

**(e)** Add the ordered roster and the setter after `setKnob` (after line 216's closing `}`):

```tsx
  // Server order: primary first, then by id — the same order every owner control uses.
  const people = household?.people ?? []

  const setRetireMonth = (personId: number) => (value: string) => {
    setRetireMonths((current) => ({ ...current, [personId]: value }))
    setFormError(null) // the sentence described the values that WERE in the boxes
  }
```

**(f)** In `recalculate`, insert this block directly after the `years` validation (after line 296's closing `}`) and before `setBusy(true)`:

```tsx
    const retirements: { personId: number; month: string }[] = []
    for (const person of people) {
      const month = (retireMonths[person.id] ?? '').trim()
      if (month === '') continue // blank = this person works for the whole horizon
      if (!RETIRE_MONTH_RE.test(month)) {
        setFormError(`${person.name}'s retirement month must look like YYYY-MM`)
        return
      }
      retirements.push({ personId: person.id, month })
    }
```

and add `retirements,` as the last property of the `load({ … })` call (after `years,`).

**(g)** Add the knobs to the form — insert directly after the Horizon `</label>` (line 582) and before `<div className="projection-actions">`:

```tsx
                {people.map((person) => (
                  <label key={person.id}>
                    Retires — {person.name}
                    <input
                      type="month"
                      className="field-input"
                      value={retireMonths[person.id] ?? ''}
                      onChange={(e) => setRetireMonth(person.id)(e.target.value)}
                    />
                  </label>
                ))}
```

**(h)** Add the honest hint directly after the `</form>` (line 588) and before the `{formError && …}` block:

```tsx
              {people.length > 0 && (
                <p className="drill-hint">
                  A retirement month drops that person&apos;s CURRENT monthly take-home —
                  the paycheck profile in force today, not a projection of it — out of the
                  contribution stream from that month on; whatever is left keeps escalating
                  at the contribution-growth rate. Spending stays a household figure, so
                  the FI target does not move. Blank means that person works for the whole
                  horizon.
                </p>
              )}
```

- [ ] **Step 4: Run to green.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/ProjectionPage.test.tsx
```

Expected: the whole file green, including every pre-existing test.

- [ ] **Step 5: Lint and commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx eslint src/pages/ProjectionPage.tsx && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): a Retires knob per household person, with the drop named honestly"
```

---

## Phase 5 — Gates

### Task 8: Full suites, types, lint, build

**Files:** none (verification only)

- [ ] **Step 1: The whole backend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest -q
```

Expected: 1131 pre-existing + the ~20 added here, zero failures.

- [ ] **Step 2: Backend lint.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m ruff check app tests
```

- [ ] **Step 3: The whole frontend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run
```

Expected: 1213 pre-existing + the ~20 added here, zero failures. Pay particular attention to `netWorthChartOptions.test.ts` and `NetWorthPage.test.tsx` — neither was edited, and both must be green.

- [ ] **Step 4: Types, lint, build.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && npm run lint
cd /c/Users/edyli/personal-finance-dashboard && npm run build
```

- [ ] **Step 5: Confirm the additive-wire promise one last time, by hand.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4proj .venv/Scripts/python.exe -m pytest tests/test_projection_api.py -q -k "backcompat or reproduce or without_retire or byte_identical"
```

Expected: green. These are the pins that say a client which has never heard of `retire` still gets the same numbers it always did.

- [ ] **Step 6: Final commit (only if Steps 1-5 produced changes; otherwise skip).**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git status --porcelain
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(projection): dual-career projection gates green"
```

**Do NOT push.** Report to the orchestrator: the suite counts, the three captured Monte Carlo pin strings from Task 2 Step 1, and anything that surprised you — especially if `marriageMarkLine`'s extraction had to be reverted.

---

## Notes for the reviewer

- **The one wire addition.** `retirements: []` is a new key on every response. It is additive by construction (a pydantic default), the arrays beside it are pinned byte-for-byte against constants captured before Monte Carlo existed, and the TS type is `RetirementEcho[] | null` so a stale payload with no key reads as "no rules" via `?? []`.
- **The approximation, stated plainly.** `monthly_drop` is today's take-home, applied at a future month, in a chart that reads in today's dollars. It is deliberately NOT deflated (it is already a today's figure), and it deliberately does NOT escalate with the rest of the stream (the engine's rule is "growth applies to the remainder"). The net effect is a slight UNDERSTATEMENT of a distant retirement's cost, which the page's hint names in words. Fixing it properly needs per-person savings attribution — explicitly out of scope for this batch (spec §2 decision log).
- **Knob availability.** Knobs render per HOUSEHOLD person, always enabled; a person without an in-force profile 422s with the server's sentence, rendered verbatim. The alternative — knobs only for people the server says are eligible — would need the page to either re-derive `_default_profile`'s "in force" rule (two owners of one concept) or the response to grow a second echo the spec did not ask for. Disabling the box instead was rejected as disabled-mystery: a greyed box that says nothing is worse than a box that answers.
- **Browser smoke.** Plan 4's checklist already lists "projection markLines". The one thing that unit tests cannot prove is that echarts renders a PER-DATA-ITEM markLine label (the marriage rule uses a series-level one). Eyeball it there.
