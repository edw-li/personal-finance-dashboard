# Projection Default Assumptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absent volatility/inflation/contribution-growth default server-side (0.15 / 0.03 / 0.03) so the fan, real-dollar lines, and FI-probability tile render on first load; the three boxes stay blank with echo-fed grey placeholders; explicit `volatility=0` (newly legal) turns the fan off; explicit zeros for the other two reproduce the pre-Monte-Carlo arrays byte-for-byte.

**Architecture:** Pure parameter-defaulting in the router (no service changes — `simulate`/`project` are untouched); the page swaps echo-seeding for echo-fed `placeholder=` attributes on exactly these three inputs.

**Tech Stack:** unchanged; NO migrations (alembic head `b3d47a1c9e62` unmoved).

**Spec:** `docs/superpowers/specs/2026-08-20-projection-default-assumptions-design.md`

---

### Task 1: Router defaults + widened volatility floor

**Files:**
- Modify: `backend/app/api/projection.py`
- Test: `backend/tests/test_projection_api.py`

- [x] **Step 1:** Read `backend/app/api/projection.py` in full. Beside the existing constants add:

```python
# Assumption defaults (user decision 2026-08-20): absent knobs mean these, so a fresh
# page shows the fan and reads in today's dollars with no typing. Explicit values —
# including the zeros — always win; volatility 0 is the fan's off switch.
DEFAULT_VOLATILITY = Decimal("0.15")
DEFAULT_INFLATION = Decimal("0.03")
DEFAULT_CONTRIBUTION_GROWTH = Decimal("0.03")
```

Change the volatility validation: bounds become `0 <= volatility <= 1` with
`VOLATILITY_MESSAGE = "volatility must be between 0 and 1"`; absent →
`volatility = DEFAULT_VOLATILITY`. Same absent→default treatment for `inflation` and
`contribution_growth` (their bounds/messages unchanged). The simulation gate changes
from `volatility is not None` to `volatility > 0`. The echo fields now pass the
resolved values (never None). Where the current code computes `inflation_rate`/
`growth_rate` from `None`, simplify — the values are always resolved by then.

- [x] **Step 2:** Update the tests in `backend/tests/test_projection_api.py`:

1. RETIRE `test_projection_backcompat_without_new_knobs`'s absent-knob framing: rename it
   `test_projection_explicit_zero_knobs_reproduce_the_pre_monte_carlo_arrays`, call the
   endpoint with `inflation=0&contribution_growth=0` (+ any volatility — pick `0`), and
   keep every pinned literal EXACTLY as it stands (they were captured from the
   pre-Monte-Carlo engine and must keep passing under explicit zeros). Assert
   `bands is None` and the three echoes are `"0.000000"`.
2. NEW `test_projection_defaults_apply_when_knobs_absent`: no knob params → echoes
   `"0.150000"` / `"0.030000"` / `"0.030000"`, `bands` non-null with the five keys,
   `fi_probability` non-null when a target exists, and `projected[-1]` differs from the
   explicit-zeros run (the real-terms shift is observable).
3. `test_projection_volatility_zero_turns_the_fan_off`: explicit `volatility=0` → 200,
   `bands is None`, `fi_probability is None`, echo `"0.000000"`.
4. Update the volatility bounds 422 asserts: `-0.01` and `1.5` now carry
   "volatility must be between 0 and 1"; `0` is no longer a 422 (covered by test 3).
5. The existing inflation/growth tests that relied on absent == 0 must switch to
   explicit `inflation=0` / `contribution_growth=0` where they pinned nominal behavior
   (read each and adjust the minimal set — report which).

- [x] **Step 3:** Run `cd backend && .venv/Scripts/python.exe -m pytest tests/test_projection_api.py tests/test_montecarlo.py -q -W error` → PASS; `ruff check .` and `ruff format --check .` clean.

- [x] **Step 4:** Commit — `git commit -am "feat: projection assumptions default server-side — fan and today's-dollars by default, volatility 0 is the off switch"`

---

### Task 2: Placeholders instead of echo-seeding

**Files:**
- Modify: `src/pages/ProjectionPage.tsx`
- Test: `src/pages/ProjectionPage.test.tsx`

- [x] **Step 1:** Read `src/pages/ProjectionPage.tsx` in full. In the one-shot echo-seed
  block, REMOVE the three new-knob entries (volatility/inflation/contributionGrowth stay
  `''` — with a comment: assumptions render as placeholders, not filled boxes; the five
  derived knobs keep seeding). On each of the three inputs add
  `placeholder={data?.volatility == null ? '' : shiftPoint(data.volatility, 2)}` (same
  shape for the other two; `data` is in scope where the form renders — inside the
  `data && (…)` branch, so `data.volatility == null ? '' : …` suffices; null echoes —
  a stale backend — leave the placeholder empty rather than lying).
- [x] **Step 2:** Widen the volatility fence to `[0, 100]` with the message
  `"Volatility % must be between 0 and 100"`. Update the assumptions drill-hint: append
  `"The three assumption boxes grey in their defaults — blank uses them; 0 turns the fan
  off (volatility) or reads nominal dollars (inflation)."` Update the investable-chart
  hint sentence from "Enter a real (after-inflation) return to read the chart in today's
  dollars" to `"The chart reads in today's dollars by default (inflation is modelled);
  set inflation to 0 to read nominal dollars."`
- [x] **Step 3:** Tests: default fixture's three echoes become `"0.150000"` /
  `"0.030000"` / `"0.030000"` with a bands object (the server's new truth — keep ONE
  fixture variant with null echoes to pin stale-backend placeholder-empties); assert the
  three boxes have `value === ''` AND the placeholder attributes carry `"15"`, `"3"`,
  `"3"`; assert recalculate with blank boxes still omits all three params; volatility
  `"0"` typed → param `volatility=0` sent (fence allows it); fence message pin updated;
  hint text pins updated.
- [x] **Step 4:** `npm run test`, `npm run lint` (1 sanctioned warning), `npm run build` → green.
- [x] **Step 5:** Commit — `git commit -am "feat: assumption boxes show echo-fed placeholders; fan on by default"`

---

### Task 3: Gate

- [x] Full backend suite (expect 627 net of renames/additions — report exact), `ruff check`, `ruff format --check`, `alembic check` clean; full frontend gates; spec/plan checkboxes ticked; commit stragglers `chore: projection defaults gate green`.

**Gate results (2026-08-20):** backend `pytest -q` **629 passed** (+2: the defaults test and
the volatility-0 off-switch test; the back-compat pin was renamed, not added); `ruff check`
and `ruff format --check` clean over 120 files; `alembic check` — "No new upgrade operations
detected", head **b3d47a1c9e62** unmoved. Frontend `npm run test` **491 passed / 45 files**
(+3: the stale-echo placeholder test, the volatility>100 fence test, the hint-text pin, less
the retired echo-seeding test, plus one in `src/api/projection.test.ts` pinning that `"0"`
survives the blank-omit filter); `npm run lint` 1 sanctioned warning (AuthContext fast-refresh);
`npm run build` green.

---

## Self-review notes

- Spec §2 → Task 1 (defaults, widened floor, off-switch, echoes-never-null, explicit-zeros byte-identity re-anchor).
- Spec §3 → Task 2 (no seeding, echo-fed placeholders, fence, both hints).
- Spec §4 → the two test steps, item for item.
- Type consistency: no schema/type changes anywhere (echoes were already nullable strings; the page already reads `data.volatility`).
