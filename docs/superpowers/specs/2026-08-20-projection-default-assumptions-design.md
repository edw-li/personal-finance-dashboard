# Projection Default Assumptions — Design Spec

**Date:** 2026-08-20 (same-day follow-up to the Monte Carlo feature)
**Status:** User-requested: "placeholder values for volatility, inflation, and contribution
growth in the assumptions section, and have the graph reflect these placeholder values by
default." Design details settled autonomously in-session.
**Feature branch:** `feature/projection-default-assumptions`

## 1. Behavior change

Today the three Monte Carlo knobs are absent-off: blank boxes mean no simulation, zero
inflation, flat contributions. After this change the **server defaults them** when absent —
so a fresh page load shows the fan, the FI-probability tile, and real-dollar lines with no
typing — and the **boxes stay blank but carry the defaults as grey placeholders** fed from
the server's echo, so the placeholder can never disagree with what actually ran.

| Knob | Absent now means | Default | Turn it off |
|---|---|---|---|
| `volatility` | **0.15** (15%/yr — a balanced-equity planning default) | fan + FI probability on by default | explicit `0` (newly legal) = deterministic-only, `bands` null |
| `inflation` | **0.03** (3%/yr — the common planning figure) | lines and bands read in today's dollars by default | explicit `0` = nominal mode (the pre-change behavior) |
| `contribution_growth` | **0.03** (3%/yr — raises roughly tracking inflation) | contributions escalate by default | explicit `0` = flat contributions |

The five older knobs are untouched (they already default/derive server-side and echo-seed
their boxes — those are *your* numbers; these three are *assumptions*, which is why they
render as placeholders instead of filled boxes).

## 2. API

- `volatility` bounds widen from `(0, 1]` to `[0, 1]`; message becomes
  `"volatility must be between 0 and 1"`. `volatility == 0` (explicit) skips the
  simulation exactly like `None` does today: `bands`/`fi_probability`/percentile months
  all null. Absent → `DEFAULT_VOLATILITY = Decimal("0.15")`.
- `inflation` absent → `DEFAULT_INFLATION = Decimal("0.03")`; `contribution_growth`
  absent → `DEFAULT_CONTRIBUTION_GROWTH = Decimal("0.03")`. Bounds unchanged.
- **Echoes are never null anymore** (they carry the value actually used, defaulted or
  typed — the ESPP-modeler echo contract). The schema fields stay nullable for stale
  stored payloads and old tabs; the frontend keeps treating null echoes as blank.
- The back-compat guarantee RESTATES rather than disappears: **explicit
  `inflation=0&contribution_growth=0` reproduces the pre-Monte-Carlo deterministic
  arrays byte-for-byte** (volatility never touches the deterministic lines). The old
  "absent knobs = old arrays" pin is deliberately retired — absent now means defaults;
  that is the whole feature.

## 3. Frontend (ProjectionPage)

> **(Revised 2026-08-20, user request: the boxes seed ACTUAL VALUES from the echo like
> every other assumption box — the placeholder treatment below is retired. Blank-on-
> Recalculate still restores the defaults; null echoes — a stale backend — leave the
> boxes blank. Server behavior in §2 is unchanged.)**

- The three boxes are **not** echo-seeded (removed from the one-shot seed block); instead
  each `<input>` gains `placeholder={...}` derived from the latest echo
  (`shiftPoint(data.volatility, 2)` etc., empty string until the first echo lands).
  Blank still omits the param (the blank-omit convention), which now yields the default —
  the placeholder therefore always names exactly what blank did.
- Client fence for volatility widens to `[0, 100]` in the box's vocabulary ("Volatility %
  must be between 0 and 100"). Inflation/growth fences unchanged.
- Assumptions hint gains: defaults are greyed into the empty boxes; enter `0` to turn the
  fan off (volatility) or to read nominal dollars (inflation). The investable-chart hint's
  "Enter a real (after-inflation) return…" sentence is updated: the chart now reads in
  today's dollars **by default**.
- The FI-probability tile and fan render on first load by construction (no code change —
  they key off the response).

## 4. Testing

- Backend: absent-knobs response carries the three defaulted echoes (`"0.150000"`,
  `"0.030000"`, `"0.030000"`) and non-null bands; explicit `volatility=0` → 200 with null
  bands/probability; explicit zeros byte-identity pin (the retired absent-pin's literals,
  re-anchored on explicit params); bounds 422s updated for the widened volatility floor;
  defaults shift the deterministic arrays vs explicit zeros (inequality assert).
- Frontend: boxes stay blank while placeholders carry the echo values; typed values still
  round-trip; blank-omit unchanged; fence message updated; hint text pinned.

## 5. Non-goals

- No new knobs, no per-user persisted assumption settings (app_settings is a later call).
- The five older knobs' echo-seeding is untouched.
- `DEFAULT_ANNUAL_RETURN` stays 0.05 — now explicitly nominal by default (the hint says
  so); changing it is a modeling decision this feature does not take.
