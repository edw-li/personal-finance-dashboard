# Simulated Two-Earner Withholding + Money-Flow Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-27 — resolves this plan's preconditions table
> against the now-written person-paycheck-profiles plan):** (1) `_default_profile` is
> **`(db, person_id, today)`** — three args, clock injected — this plan's choice NOT to call
> it (one ordered pass, NULL folds to primary) stands and is compatible. (2) Plan-1
> migrations are `d4f9a1c8e307 → a2c6b8d40f19` on `e26b9d70a4c1`; this plan adds none.
> (3) Breakdown wire: `GET /paycheck/breakdown?profile_id=&person_id=`, profile_id wins.
> (4) Plan 1 already gives `test_withholding_api.py`'s `seed_profile` a self-healing primary
> Person seed — this plan's "callable without a person" assumption holds through that
> fixture, not through the schema (person_id is NOT NULL after Plan 1). (5) Plan 1's
> derived-suggestion hook is an `annual_salary` per-column overlay — no impact here.
> (6) Roster-less profile writes now 422 "household has no primary person" — irrelevant to
> this plan's fixtures, which always seed people.

**Goal:** Make the partner a simulated earner everywhere the primary already is. Three
surfaces change and each one has a byte-identical fallback: (1) the withholding tracker
simulates the partner's salary leg from THEIR paycheck profile when one exists — checks at
their all-in withholding %, no vest/ESPP legs — and keeps the P2 entered-inputs fallback
untouched when it does not; (2) the Overview money-flow sankey splits its single salary
source node into one node per earner on a married year that carries partner W-2 rows, with
conservation arithmetic unchanged; (3) the calendar composes paydays from the profile in
force PER PERSON, labelling the chips only when more than one person has a profile.

**Architecture:** Every rule stays in the pure services and every load stays in the routers,
which is how this codebase already splits the work.
- `services/withholding_calc.py` gains `_salary_leg` — the existing check-grid walk,
  extracted verbatim — and calls it twice: once for the primary's profiles (today's
  behavior, unmoved) and once for the partner's. The caller owns the WORDING of each leg's
  warnings, so "no profiles" and "checks before the first profile" can differ per person.
  `partner_source` is `"simulated"` exactly when a partner profile list arrives non-empty.
- `api/taxes.py` buckets the fenced profile rows by owner (a NULL `person_id` folds onto the
  primary, `_owner_column`'s pre-household rule) and hands each bucket to the service. The
  totals add BOTH partner terms unconditionally — one of them is always ZERO — so no branch
  can drift.
- `services/money_flow.py` takes an optional `salary_by_person` list of `(name, amount)`
  pairs and emits `sources.salary_people`. `sources.salary_and_bonus` stays the household
  total, so conservation, the balancing node and the residual are literally the same
  arithmetic; a split that does not sum to the total is refused with a warning and the card
  draws its single node.
- `moneyFlowOptions.ts` builds its depth-0 salary nodes from `salary_people`, seeding their
  names into the `claimNodeName` set so a spending category spelled `Salary — Sam` can never
  duplicate a node (the 2026-08-25 Overview crash).
- `services/calendar_events.py` replaces the single `payday_semi_monthly: bool` with a
  `list[PaydaySource]`; `api/calendar.py` resolves the in-force profile per person in one
  pass (paycheck.py's `_default_profile` rule: latest effective today or earlier, else the
  earliest future one).

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Pydantic v2 (backend, pytest), React 19 +
TypeScript + echarts 6 (frontend, vitest + Testing Library). Decimal end to end; money
quantized at the schema boundary only.

---

## Preconditions — interfaces assumed from Plan 1 (reconcile before starting)

Plan 1 of this batch (`docs/superpowers/plans/2026-08-27-person-paycheck-profiles.md`) lands
first. **That file did not exist when this plan was written** — the following are the
interfaces this plan assumes, taken from the design spec §3/§4.1 and the batch brief. Verify
each against Plan 1's text before Task 2; if a name differs, change the CALL here, never the
behavior.

| Assumed | Used by | If it differs |
|---|---|---|
| `paycheck_profiles.person_id` exists, NOT NULL, FK → `people.id`; unique is `(person_id, effective_date)` | Tasks 2, 8 | The bucketing here reads `profile.person_id` and folds `None` onto the primary — it is already correct for a nullable column, so only the test seeding changes |
| `PaycheckProfile(**fields, person_id=...)` is constructible in tests | Tasks 2, 8 tests | Use whatever Plan 1's own test helper does |
| `tests/test_withholding_api.py::seed_profile` still works with no `person_id` (Plan 1 defaults it to the primary, or the column stays nullable in `create_all` databases) | Task 2 tests | If Plan 1 changed `seed_profile`'s signature, pass the primary's id explicitly |
| `_default_profile(db, person_id)` exists in `api/paycheck.py` | **NOT called here** — see below | — |

**Deliberate non-dependency:** `api/calendar.py` does NOT call `_default_profile`. It needs
the in-force profile for EVERY person at once, and the spec's brief spells the helper
`_default_profile(db, person_id)` while today's signature is `_default_profile(db, today)` —
an unreconciled shape. Task 8 therefore does one ordered `SELECT` and resolves all people in
a single pass, applying the SAME rule in nine lines. If Plan 1's helper turns out to take
`(db, today, person_id)`, this stays correct and cheaper (one query instead of N).

**Also note:** `api/taxes.py`'s withholding route currently selects EVERY `paycheck_profiles`
row and feeds them all to the primary's leg. Once Plan 1 lands, that is a live wrong-money
bug — the partner's profile would inflate the primary's salary withholding. Task 2 fixes it
and pins the fix.

---

## Palette mechanism (spec §4.3) — decided, with the measurements

`src/charts/theme.ts` says: *"Fixed slot order IS the CVD-safety mechanism — never reorder,
never cycle past 8, never invent a hue outside this file."* Sources already own PALETTE[0..4]
and the mid column [5..7], so there is no free slot and no new hue may be minted.

**Mechanism: lightness steps of the theme's own `SEQUENTIAL_BLUE` ramp, whose index 6 IS
`PALETTE[0]` (`#3987e5`).** The primary earner keeps `PALETTE[0]` verbatim — so the
single-node path and the primary's split node are the exact color the card draws today — and
the partner takes `SEQUENTIAL_BLUE[9]` (`#86b6ef`). A third step, `SEQUENTIAL_BLUE[3]`
(`#1c5cab`), exists so a three-person household cannot fall off the end; beyond that the last
tint repeats and the LABELS carry the distinction.

Measured on the card surface `#171a21` (same method as the theme header's 2026-08-14
validation — CIE ΔE76, Machado-style CVD matrices at full severity):

| Color | L\* | Contrast vs surface | ΔE vs PALETTE[0] normal / protan / deutan / tritan |
|---|---|---|---|
| `PALETTE[0]` `#3987e5` (primary) | 55.9 | 4.78:1 | — |
| `SEQUENTIAL_BLUE[9]` `#86b6ef` (partner) | 72.7 | 8.25:1 | 28.5 / 25.1 / 28.9 / **15.1** |
| `SEQUENTIAL_BLUE[3]` `#1c5cab` (third) | 39.3 | 2.63:1\* | 18.0 / 18.3 / 17.8 / 18.2 |

The worst case (tritan, 15.1) is ~1.8× the palette's own validated adjacency floor of 8.4, and
`#86b6ef` also sits ΔE 100 from PALETTE[1] orange, 67 from PALETTE[2] aqua and 27 from MUTED.
\*The third tint's 2.63:1 is below the 3:1 target and is why it is a documented last resort
for an unreachable household size, not a shipped two-earner color.

---

## Task 1 — `withholding_calc`: simulate the partner's salary leg

**Files:**
- `backend/app/services/withholding_calc.py` (module docstring :1-29, constants :51-55,
  `WithholdingEstimate` :61-79, `estimate` :147-222)
- `backend/tests/test_withholding_calc.py` (two-earner block starts :370; `run` helper :274;
  `Profile` helper :26-46)

### Steps

- [ ] **Write the failing tests.** Append to `backend/tests/test_withholding_calc.py`:

```python
# --- the SIMULATED partner leg (2026-08-27 spec §4.2) ---

PARTNER_EARLY = "partner checks before their first profile's effective date use that profile"
PARTNER_TRACKER_IGNORED = (
    "partner withholding simulated from their paycheck profile — the entered "
    "w2_fed_withholding / w2_state_withholding rows are ignored"
)


def partner_profile(effective=date(2025, 1, 1)):
    """The partner's check, chosen to be hand-derivable next to the primary's: 150000 / 24
    = 6250 gross, NOTHING pre-tax, 20% all-in -> 1250.00 withheld a check."""
    return Profile(
        effective,
        D("150000"),
        withholding=D("0.20"),
        trad=D("0"),
        dv=D("0"),
        hsa=D("0"),
    )


def test_partner_profile_simulates_their_leg_exactly_like_the_primarys():
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_profiles=[partner_profile()],
    )
    assert result.partner_source == "simulated"
    # 11 of 24 checks have landed on 2026-07-01 (the salary-leg tests' own grid).
    assert result.partner_checks_elapsed == 11
    assert result.partner_checks_total == 24
    assert result.partner_salary_ytd == D("13750.00")  # 11 x 1250
    assert result.partner_salary_projected == D("30000.00")  # 24 x 1250
    # The primary's leg does not move: two legs, one grid rule, no interference.
    assert result.salary_ytd == D("30855.00")
    assert result.salary_projected == D("67320.00")
    # The gap reads WAGES, never the simulation — 240k + 150k against the 250k MFJ tier.
    assert result.additional_medicare_gap == D("900.00")
    assert result.warnings == []


def test_a_partner_profile_silences_the_not_entered_nag():
    # The nag exists to say "we counted zero because you told us nothing". With a profile
    # there IS an answer, so the sentence would be a lie.
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_profiles=[partner_profile()],
    )
    assert PARTNER_MISSING not in result.warnings


def test_a_partner_profile_ignores_their_entered_tracker_rows_with_a_note():
    # ONE source of truth at a time (spec §4.2): no blending, and the note says so rather
    # than letting 24000 quietly vanish from a total the user has been watching.
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_withheld_fed=D("18000"),
        partner_withheld_state=D("6000"),
        partner_profiles=[partner_profile()],
    )
    assert result.partner_source == "simulated"
    assert result.partner_withheld_total == D("0.00")
    assert result.partner_salary_projected == D("30000.00")
    assert result.warnings == [PARTNER_TRACKER_IGNORED]


def test_a_partner_profile_effective_mid_year_warns_about_their_early_checks():
    # The primary's own EARLY_CHECKS posture, worded for the other person: the whole year
    # is still priced off that profile, and the sentence names the approximation.
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_profiles=[partner_profile(date(2026, 3, 1))],
    )
    assert result.warnings == [PARTNER_EARLY]
    assert result.partner_salary_projected == D("30000.00")


def test_no_partner_profile_leaves_the_entered_fallback_exactly_as_it_was():
    # THE pin: absent a profile, every partner field reads as it did before this plan.
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_withheld_fed=D("18000"),
        partner_withheld_state=D("6000"),
    )
    assert result.partner_source == "entered"
    assert result.partner_withheld_total == D("24000.00")
    assert result.partner_salary_ytd == D("0.00")
    assert result.partner_salary_projected == D("0.00")
    assert result.partner_checks_elapsed == 0
    assert result.partner_checks_total == 0
    assert result.warnings == []
```

- [ ] **Run them — expect failure.** From `backend/`:
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_withholding_calc.py -q`
      Expected: `TypeError: estimate() got an unexpected keyword argument 'partner_profiles'`
      on five tests; every pre-existing test in the file still passes.

- [ ] **Implement.** In `backend/app/services/withholding_calc.py`, replace the constants
      block (currently lines 51-55) with:

```python
NO_PROFILES_WARNING = "no usable paycheck profile — salary withholding estimated as 0"
EARLY_CHECKS_WARNING = "checks before the first profile's effective date use that profile"
PARTNER_WITHHOLDING_MISSING_WARNING = (
    "partner withholding not entered — their W-2 withholding counts as 0 until you enter it"
)
# The partner's own two sentences (2026-08-27 spec §4.2). Separate constants rather than a
# shared one with a name in it: these are wire strings the panel renders verbatim, and the
# primary's copy must not move when the partner's does.
PARTNER_EARLY_CHECKS_WARNING = (
    "partner checks before their first profile's effective date use that profile"
)
PARTNER_TRACKER_IGNORED_NOTE = (
    "partner withholding simulated from their paycheck profile — the entered "
    "w2_fed_withholding / w2_state_withholding rows are ignored"
)
# The two spellings of `partner_source`. A profile wins over the tracker keys ALWAYS — one
# source of truth at a time, never a blend of a simulation and a running snapshot.
PARTNER_ENTERED = "entered"
PARTNER_SIMULATED = "simulated"
```

- [ ] **Implement.** Add the extracted leg above `estimate` (after `_additional_medicare_gap`,
      i.e. after line 144):

```python
@dataclass
class _SalaryLeg:
    """One person's salary withholding over the year's check grid — the arithmetic only.

    The WARNINGS are the caller's: "no usable profile" and "checks before the first one"
    read differently depending on whose leg they describe, and this helper deliberately
    does not know whose it is computing.
    """

    checks_elapsed: int
    checks_total: int
    withheld_ytd: Decimal
    withheld_projected: Decimal
    gross_ytd: Decimal
    gross_projected: Decimal
    # The grid's FIRST check predates the earliest profile, so those checks are priced with
    # a profile that was not yet in force.
    early_checks: bool = False


def _salary_leg(year: int, today: date, profiles: list) -> _SalaryLeg:
    """The check-grid walk, per person: cadence from the profile in force TODAY, then one
    `breakdown` per check against the profile in force on THAT day.

    Preconditions are the module's (see the header): every profile's
    `pay_periods_per_year` >= 1, fenced at the API boundary. An empty list is not an
    error here — it returns a zeroed leg, which is exactly what a partner without a
    profile contributes and what the no-profiles primary path has always computed.
    """
    ordered = sorted(profiles, key=lambda p: p.effective_date)
    if not ordered:
        return _SalaryLeg(0, 0, ZERO, ZERO, ZERO, ZERO)
    current = [p for p in ordered if p.effective_date <= today] or [ordered[0]]
    grid = check_dates(year, current[-1].pay_periods_per_year)
    withheld_ytd = withheld_projected = gross_ytd = gross_projected = ZERO
    elapsed = 0
    for check_day in grid:
        in_force = [p for p in ordered if p.effective_date <= check_day] or [ordered[0]]
        lines = breakdown(in_force[-1])
        withheld_projected += lines["withholding"]
        gross_projected += lines["gross"]
        if check_day <= today:
            elapsed += 1
            withheld_ytd += lines["withholding"]
            gross_ytd += lines["gross"]
    return _SalaryLeg(
        checks_elapsed=elapsed,
        checks_total=len(grid),
        withheld_ytd=withheld_ytd,
        withheld_projected=withheld_projected,
        gross_ytd=gross_ytd,
        gross_projected=gross_projected,
        early_checks=ordered[0].effective_date > grid[0],
    )
```

- [ ] **Implement.** Add the new fields to `WithholdingEstimate` — replace its last three
      lines (`partner_withheld_total` … `warnings`) with:

```python
    partner_withheld_total: Decimal = ZERO
    additional_medicare_gap: Decimal = ZERO
    # --- the SIMULATED partner leg (2026-08-27 spec §4.2). "entered" is the default, so a
    # single-earner call — and the whole P2 fallback — is unmoved. In "simulated" mode
    # `partner_withheld_total` is ZERO and these carry the money; in "entered" mode the
    # reverse. The two are never both non-zero, which is what lets the router add both.
    partner_source: str = PARTNER_ENTERED
    partner_salary_ytd: Decimal = ZERO
    partner_salary_projected: Decimal = ZERO
    partner_checks_elapsed: int = 0
    partner_checks_total: int = 0
    warnings: list[str] = field(default_factory=list)
```

- [ ] **Implement.** Replace the whole of `estimate` (currently lines 147-222) with:

```python
def estimate(
    *,
    year: int,
    today: date,
    profiles: list,  # the PRIMARY's paycheck_profiles rows, any order
    past_vests: list[VestTuple],
    future_vests: list[VestTuple],
    medicare: list[Bracket],
    social_security: list[Bracket],
    disability: list[Bracket],
    # The two-earner block (2026-08-26 spec §5.6). Wages are the year's stored W-2 figures
    # PER PERSON — the same numbers the liability is computed on — not the paycheck
    # simulation, because the additional-Medicare split is about what each EMPLOYER saw.
    primary_wages: Decimal = ZERO,
    partner_wages: Decimal = ZERO,
    # The ENTERED fallback (P2): None means "no row stored" (which warns); Decimal("0")
    # means "entered as zero". Ignored entirely once `partner_profiles` is non-empty.
    partner_withheld_fed: Decimal | None = None,
    partner_withheld_state: Decimal | None = None,
    # The partner's own profiles (2026-08-27 spec §4.2). NON-EMPTY is the whole switch:
    # their leg is then simulated exactly like the primary's salary leg — no vest or ESPP
    # legs, which is the lean scope, not an oversight.
    partner_profiles: list | None = None,
) -> WithholdingEstimate:
    warnings: list[str] = []
    leg = _salary_leg(year, today, profiles)
    if not profiles:
        warnings.append(NO_PROFILES_WARNING)
    elif leg.early_checks:
        warnings.append(EARLY_CHECKS_WARNING)

    def fica(wages: Decimal) -> Decimal:
        return walk(medicare, wages) + walk(social_security, wages) + walk(disability, wages)

    income_ytd = sum((Decimal(s) * price for _, s, price in past_vests), ZERO)
    income_projected = income_ytd + sum((Decimal(s) * price for _, s, price in future_vests), ZERO)
    supplemental = FED_SUPPLEMENTAL + CA_SUPPLEMENTAL
    # Vest FICA stacks on the PRIMARY's gross alone: the vests are the primary's grants,
    # and the partner's checks are a separate employer's wage base whose own FICA their
    # all-in withholding_pct already carries.
    fica_ytd = fica(leg.gross_ytd + income_ytd) - fica(leg.gross_ytd)
    fica_projected = fica(leg.gross_projected + income_projected) - fica(leg.gross_projected)

    simulated = bool(partner_profiles)
    partner_leg = _salary_leg(year, today, partner_profiles or [])
    if simulated:
        # SIMULATED: the tracker keys are not blended in, not halved, not preferred when
        # larger — they are ignored, and said to be.
        partner_withheld_total = ZERO
        if partner_leg.early_checks:
            warnings.append(PARTNER_EARLY_CHECKS_WARNING)
        if partner_withheld_fed is not None or partner_withheld_state is not None:
            warnings.append(PARTNER_TRACKER_IGNORED_NOTE)
    else:
        partner_withheld_total = (partner_withheld_fed or ZERO) + (partner_withheld_state or ZERO)
        if partner_wages > 0 and partner_withheld_fed is None and partner_withheld_state is None:
            # Only BOTH being unset is "not entered": an entered 0 is a real answer (a state
            # with no income tax, or a W-4 that zeroed it) and must not be nagged about.
            warnings.append(PARTNER_WITHHOLDING_MISSING_WARNING)
    gap = _additional_medicare_gap(medicare, primary_wages, partner_wages)
    return WithholdingEstimate(
        checks_elapsed=leg.checks_elapsed,
        checks_total=leg.checks_total,
        salary_ytd=_cents(leg.withheld_ytd),
        salary_projected=_cents(leg.withheld_projected),
        salary_gross_ytd=_cents(leg.gross_ytd),
        salary_gross_projected=_cents(leg.gross_projected),
        vest_income_ytd=_cents(income_ytd),
        vest_income_projected=_cents(income_projected),
        vest_supplemental_ytd=_cents(income_ytd * supplemental),
        vest_supplemental_projected=_cents(income_projected * supplemental),
        vest_fica_ytd=_cents(fica_ytd),
        vest_fica_projected=_cents(fica_projected),
        partner_withheld_total=_cents(partner_withheld_total),
        additional_medicare_gap=_cents(gap),
        partner_source=PARTNER_SIMULATED if simulated else PARTNER_ENTERED,
        partner_salary_ytd=_cents(partner_leg.withheld_ytd if simulated else ZERO),
        partner_salary_projected=_cents(partner_leg.withheld_projected if simulated else ZERO),
        partner_checks_elapsed=partner_leg.checks_elapsed if simulated else 0,
        partner_checks_total=partner_leg.checks_total if simulated else 0,
        warnings=warnings,
    )
```

- [ ] **Implement.** Update the module docstring's partner paragraph (lines 8-11) — it
      currently says the partner is never simulated. Replace that sentence with:

```python
carries it (user decision, 2026-08-21). The partner leg has TWO modes (2026-08-27 spec
§4.2): with `partner_profiles` it is simulated by the very same `_salary_leg` walk the
primary's uses (no vest or ESPP legs — lean scope); without one it falls back to the
2026-08-26 behavior, where their W-2 wages and their two withholding figures are read
straight from the year's per-person tax inputs and the module's only arithmetic on them is
the sum and the additional-Medicare gap below. The two never mix.
```

- [ ] **Run to pass.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_withholding_calc.py -q`
      Expected: every test in the file passes, old and new.
- [ ] **Check the goldens did not move.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_tax_service.py -q`
      and `git status --porcelain backend/tests/test_tax_service.py` → must print NOTHING.
- [ ] **Commit:** `feat(withholding): simulate the partner's salary leg from their paycheck profile`

---

## Task 2 — withholding route: per-person profile buckets + `partner_source` on the wire

**Files:**
- `backend/app/api/taxes.py` (profile fence loop :1070-1080, `estimate` call ~:1145-1160,
  totals ~:1163-1178, `WithholdingOut(...)` return ~:1212-1244)
- `backend/app/schemas/taxes.py` (`WithholdingLegOut` :277, `WithholdingOut` :309-338)
- `backend/tests/test_withholding_api.py` (married block from :603; `seed_profile` :104;
  `married_world` :685)

### Steps

- [ ] **Write the failing tests.** Append to `backend/tests/test_withholding_api.py`:

```python
# --- the SIMULATED partner leg (2026-08-27 spec §4.2) ---

PARTNER_TRACKER_IGNORED = (
    "partner withholding simulated from their paycheck profile — the entered "
    "w2_fed_withholding / w2_state_withholding rows are ignored"
)


async def seed_partner_profile(db, partner_id: int) -> PaycheckProfile:
    """The partner's check: 150000 / 24 = 6250 gross, nothing pre-tax, 20% all-in ->
    1250.00 a check. A DIFFERENT effective_date from the primary's so the row is legal
    under either unique constraint, and early enough that no check predates it."""
    return await seed_profile(
        db,
        person_id=partner_id,
        effective_date=date(2025, 2, 1),
        annual_salary=Decimal("150000.00"),
        trad_401k_pct=Decimal("0"),
        withholding_pct=Decimal("0.200000000"),
        dental_vision_per_check=Decimal("0.00"),
        hsa_per_check=Decimal("0.00"),
    )


async def test_withholding_simulates_the_partner_when_they_have_a_profile(
    auth_client, db, married_world, frozen_today
):
    _me_id, partner_id = married_world
    await seed_partner_profile(db, partner_id)
    body = await get_withholding(auth_client)

    assert body["partner_source"] == "simulated"
    assert body["partner_salary"] == {
        "ytd": "13750.00",  # 11 of 24 checks x 1250.00
        "projected": "30000.00",
        "checks_elapsed": 11,
        "checks_total": 24,
    }
    # The primary's leg is untouched — a partner profile must never land in their bucket.
    assert body["salary"] == {"ytd": "30855.00", "projected": "67320.00"}
    # Simulated on BOTH sides now, so the two legs no longer agree between ytd and
    # projected the way an entered snapshot does: 30855 + 13750 and 67320 + 30000.
    assert body["total"]["ytd"] == "44605.00"
    assert body["total"]["projected"] == "97320.00"
    # The gap is wage arithmetic and does not move.
    assert body["additional_medicare_gap"] == "900.00"


async def test_a_partner_profile_ignores_their_tracker_rows_but_still_reports_them(
    auth_client, db, married_world, frozen_today
):
    # married_world seeds both tracker rows. They are STORED facts, so they stay on the
    # wire; they are simply not money in any total, and the note says which side won.
    _me_id, partner_id = married_world
    await seed_partner_profile(db, partner_id)
    body = await get_withholding(auth_client)

    assert body["partner_withheld_fed"] == "18000.00"
    assert body["partner_withheld_state"] == "6000.00"
    assert PARTNER_TRACKER_IGNORED in body["warnings"]
    assert PARTNER_MISSING not in body["warnings"]
    # 24000 of entered withholding is nowhere in the total (which would be 121320.00).
    assert body["total"]["projected"] == "97320.00"


async def test_a_partner_profile_on_a_separate_return_is_not_simulated(
    auth_client, db, definitions, frozen_today
):
    # MFS is ONE return for ONE person: the spouse's inputs are off it (the P2 pin), and
    # so is their paycheck. Their profile must neither simulate a leg nor — the real trap
    # — fall into the primary's bucket and inflate the primary's own salary withholding.
    me_id, partner_id = await seed_household(db)
    await seed_married_year(db, YEAR, me_id, partner_id, status="married_separate")
    await seed_profile(db, person_id=me_id)
    await seed_partner_profile(db, partner_id)
    body = await get_withholding(auth_client)

    assert body["partner_source"] == "entered"
    assert body["partner_salary"] is None
    assert body["partner_wages"] is None
    assert body["salary"] == {"ytd": "30855.00", "projected": "67320.00"}


async def test_withholding_without_a_partner_profile_is_the_entered_fallback(
    auth_client, married_world, frozen_today
):
    # THE pin: the P2 world, untouched. Every figure below is the one that file already
    # asserts — repeated here so a regression names the source flag as the cause.
    body = await get_withholding(auth_client)
    assert body["partner_source"] == "entered"
    assert body["partner_salary"] is None
    assert body["total"]["ytd"] == "54855.00"
    assert body["total"]["projected"] == "91320.00"


async def test_single_year_carries_the_source_flag_as_entered(
    auth_client, db, definitions, frozen_today
):
    await seed_tax_year(db, YEAR, "240000")
    await seed_profile(db)
    body = await get_withholding(auth_client)
    assert body["partner_source"] == "entered"
    assert body["partner_salary"] is None
```

- [ ] **Run them — expect failure.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q`
      Expected: `KeyError: 'partner_source'` / `'partner_salary'` on the new tests, and
      `test_withholding_simulates_the_partner_when_they_have_a_profile` additionally shows
      the primary's leg inflated to `"46605.00"`-ish — the bucketing bug this task fixes.

- [ ] **Implement the schema.** In `backend/app/schemas/taxes.py`, add after
      `WithholdingVestOut` (i.e. after line 290) — and add
      `from app.services.withholding_calc import PARTNER_ENTERED` to the imports beside
      `from app.tax_keys import SINGLE` (services import only `app.tax_keys`, so there is no
      cycle):

```python
class WithholdingPartnerLegOut(BaseModel):
    """The partner's SIMULATED salary leg — the primary's `salary` shape plus its OWN check
    grid, because the cadence is their profile's and need not match the primary's."""

    ytd: Decimal
    projected: Decimal
    checks_elapsed: int
    checks_total: int
```

- [ ] **Implement the schema.** In `WithholdingOut`, insert after `partner_withheld_state`
      (line 331):

```python
    # "simulated" exactly when the partner has a paycheck profile, "entered" otherwise (the
    # 2026-08-26 fallback, byte-identical). ONE source at a time: in "simulated" the two
    # withheld fields above are still reported — they are stored facts — but they are money
    # in no total, and a warning names the ignoring.
    partner_source: str = PARTNER_ENTERED
    # NULL in "entered" mode. A leg that was never simulated has no figures at all, and
    # 0.00 would read as "simulated, and it came to nothing".
    partner_salary: WithholdingPartnerLegOut | None = None
```

- [ ] **Implement the router bucketing.** In `backend/app/api/taxes.py`, insert immediately
      after the profile fence loop (after line 1080, `profiles.append(profile)`):

```python
    # Whose paycheck is whose (2026-08-27 spec §4.2). Before the person migration every
    # profile was the primary's and this route fed them all to one leg; with per-person
    # profiles that would price the primary's checks off the partner's salary.
    #
    # THREE ways, not a subtraction (the wage bases above can subtract because
    # `_assemble_inputs` has already dropped off-return people; nothing has filtered these
    # rows): a partner on this return simulates, the primary — including the NULL
    # person_id that is the pre-household spelling of "the primary", and everything when
    # the roster has no primary at all — feeds the existing leg, and a person this year's
    # return does NOT cover (the MFS spouse) is dropped in the same silence their W-2 rows
    # are.
    primary = primary_person(people)
    primary_profiles: list[PaycheckProfile] = []
    partner_profiles: list[PaycheckProfile] = []
    for profile in profiles:
        owner = getattr(profile, "person_id", None)
        if owner is not None and owner in partner_ids:
            partner_profiles.append(profile)
        elif owner is None or primary is None or owner == primary.id:
            primary_profiles.append(profile)
```

- [ ] **Implement the router call.** In the `withholding_calc.estimate(` call, change
      `profiles=profiles,` to `profiles=primary_profiles,` and add after
      `partner_withheld_state=partner_state,`:

```python
        # Non-empty flips the partner's leg from ENTERED to SIMULATED, and the service
        # words the ignoring of the tracker rows above.
        partner_profiles=partner_profiles,
```

- [ ] **Implement the totals.** Replace the two total expressions with:

```python
    total_ytd = _money(
        estimated.salary_ytd
        + estimated.vest_supplemental_ytd
        + estimated.vest_fica_ytd
        + estimated.partner_withheld_total
        + estimated.partner_salary_ytd
    )
    total_projected = _money(
        estimated.salary_projected
        + estimated.vest_supplemental_projected
        + estimated.vest_fica_projected
        + estimated.partner_withheld_total
        + estimated.partner_salary_projected
    )
```

      …and extend the comment block above them with:

```python
    # The two partner terms are MUTUALLY EXCLUSIVE by construction — the service zeroes
    # whichever mode did not win — so both are added unconditionally rather than branched
    # on `partner_source`. A branch here and a branch there is how the two drift.
```

- [ ] **Implement the response.** In the `WithholdingOut(` return, insert after
      `partner_withheld_state=...`:

```python
        partner_source=estimated.partner_source,
        partner_salary=(
            None
            if estimated.partner_source != withholding_calc.PARTNER_SIMULATED
            else WithholdingPartnerLegOut(
                ytd=_money(estimated.partner_salary_ytd),
                projected=_money(estimated.partner_salary_projected),
                checks_elapsed=estimated.partner_checks_elapsed,
                checks_total=estimated.partner_checks_total,
            )
        ),
```

      …and add `WithholdingPartnerLegOut` to the `from app.schemas.taxes import (...)` list.

- [ ] **Run to pass.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py tests/test_withholding_calc.py -q`
      Expected: all green, including every pre-existing married/entered test with NO edits.
- [ ] **Run the neighbours** (the route shares `_engine_feed` with three other surfaces):
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py tests/test_overview_api.py tests/test_paycheck_comp_api.py -q`
- [ ] **Check the goldens did not move.** `git status --porcelain backend/tests/test_tax_service.py`
      → must print NOTHING.
- [ ] **Commit:** `feat(withholding): scope profiles per person and report partner_source on the wire`

---

## Task 3 — `WithholdingPanel`: the heading, the facts and the provenance follow the source

**Files:**
- `src/types/api.ts` (`WithholdingOut` :761-825, partner block :796-803)
- `src/components/taxes/WithholdingPanel.tsx` (partner section :161-196)
- `src/components/taxes/WithholdingPanel.test.tsx` (`fixture()` :34-69, `married()` :71-81,
  partner tests :348-410)
- `src/pages/TaxesPage.test.tsx` (withholding fixture ~:256-272)

### Steps

- [ ] **Write the failing tests.** In `src/components/taxes/WithholdingPanel.test.tsx`, add
      the two new fields to `fixture()` — immediately after `partner_withheld_state: null,`
      (this is a FIXTURE edit; **no existing assertion in the file changes**):

```ts
    partner_source: 'entered',
    partner_salary: null,
```

      …then append inside the `describe('WithholdingPanel', ...)` block:

```tsx
  /** The married payload with the partner SIMULATED — a profile exists, so the tracker
      rows are stored history and the leg is the card's answer. */
  function simulated(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
    return married({
      partner_source: 'simulated',
      partner_salary: {
        ytd: '13750.00',
        projected: '30000.00',
        checks_elapsed: 11,
        checks_total: 24,
      },
      ...overrides,
    })
  }

  it('says the partner is SIMULATED and shows their leg instead of the tracker rows', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(simulated())
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('Partner — simulated')).toBeTruthy()
    expect(screen.queryByText('Partner — entered, not simulated')).toBeNull()
    // Their wages still come from the W-2 inputs — only the WITHHOLDING side moved.
    expect(screen.getByText('$150,000.00')).toBeTruthy()
    expect(screen.getByText('Withheld so far')).toBeTruthy()
    expect(screen.getByText('$13,750.00')).toBeTruthy()
    expect(screen.getByText('Projected withholding')).toBeTruthy()
    expect(screen.getByText('$30,000.00')).toBeTruthy()
    // The two tracker rows are GONE from the facts list — one source of truth at a time.
    expect(screen.queryByText('Federal withheld')).toBeNull()
    expect(screen.queryByText('State withheld')).toBeNull()
    expect(screen.queryByText('$18,000.00')).toBeNull()
  })

  it('names the provenance of the simulated partner leg', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(simulated())
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText(
        /Simulated from their paycheck profile — 11 of 24 checks at their all-in withholding %\. Their entered W-2 withholding rows are ignored while that profile exists\./,
      ),
    ).toBeTruthy()
    // The entered-mode sentence is not also on screen.
    expect(screen.queryByText(/your partner’s is entered/)).toBeNull()
  })

  it('keeps the entered fallback rendering when there is no partner profile', async () => {
    // The byte-identity pin, stated as its own test: the same payload the P2 cases use
    // still draws the P2 card, heading and sentence included.
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('Partner — entered, not simulated')).toBeTruthy()
    expect(screen.getByText('Federal withheld')).toBeTruthy()
    expect(screen.getByText('State withheld')).toBeTruthy()
    expect(screen.queryByText('Withheld so far')).toBeNull()
    expect(screen.queryByText(/Simulated from their paycheck profile/)).toBeNull()
  })
```

- [ ] **Run them — expect failure.** `npx vitest run src/components/taxes/WithholdingPanel.test.tsx`
      Expected: the two simulated tests fail on `Unable to find an element with the text:
      Partner — simulated`; the ten pre-existing tests still pass.

- [ ] **Implement the types.** In `src/types/api.ts`, add above `WithholdingOut` (before
      line 761):

```ts
/** The partner's SIMULATED salary leg — the primary's leg shape plus its own check grid. */
export interface WithholdingPartnerLeg {
  ytd: string
  projected: string
  checks_elapsed: number
  checks_total: number
}
```

      …and inside `WithholdingOut`, after `partner_withheld_state: string | null`:

```ts
  // 'simulated' exactly when the partner has a paycheck profile, 'entered' otherwise (the
  // 2026-08-26 fallback). In 'simulated' the two withheld fields above are still stored
  // facts on the wire, but they are money in no total and a warning says so.
  partner_source: string
  // Null in 'entered' mode: a leg that was never simulated has no figures, and '0.00'
  // would read as "simulated, and it came to nothing".
  partner_salary: WithholdingPartnerLeg | null
```

- [ ] **Implement the panel.** In `src/components/taxes/WithholdingPanel.tsx`, add beside the
      `balanceWords` block (after line 97):

```tsx
  // Which partner story this card is telling. The SOURCE picks the words (it is the
  // server's own decision, and the only field that can say "a profile exists"); the LEG
  // supplies the figures. A 'simulated' source with no leg would be a server bug — the
  // heading would say simulated and the rows would fall back to the entered ones rather
  // than crash on a null.
  const partnerSimulated = withholding !== null && withholding.partner_source === 'simulated'
  const partnerLeg = withholding === null ? null : withholding.partner_salary
```

- [ ] **Implement the panel.** Replace the partner mini-section (lines 165-196) with:

```tsx
          {withholding.partner_wages !== null && (
            <div className="withholding-partner">
              <h3 className="eyebrow">
                {partnerSimulated ? 'Partner — simulated' : 'Partner — entered, not simulated'}
              </h3>
              <dl className="withholding-partner-facts">
                <div>
                  <dt>W-2 wages</dt>
                  {/* Both modes: wages are the year's W-2 inputs, never the simulation —
                      the liability beside them is computed on exactly these. */}
                  <dd>{formatCurrency(withholding.partner_wages)}</dd>
                </div>
                {partnerSimulated ? (
                  <>
                    <div>
                      <dt>Withheld so far</dt>
                      <dd>{formatCurrency(partnerLeg === null ? null : partnerLeg.ytd)}</dd>
                    </div>
                    <div>
                      <dt>Projected withholding</dt>
                      <dd>{formatCurrency(partnerLeg === null ? null : partnerLeg.projected)}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt>Federal withheld</dt>
                      <dd>
                        {withholding.partner_withheld_fed === null
                          ? 'not entered'
                          : formatCurrency(withholding.partner_withheld_fed)}
                      </dd>
                    </div>
                    <div>
                      <dt>State withheld</dt>
                      <dd>
                        {withholding.partner_withheld_state === null
                          ? 'not entered'
                          : formatCurrency(withholding.partner_withheld_state)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {partnerSimulated ? (
                partnerLeg !== null && (
                  <p className="drill-hint">
                    {`Simulated from their paycheck profile — ${partnerLeg.checks_elapsed} of ${partnerLeg.checks_total} checks at their all-in withholding %. Their entered W-2 withholding rows are ignored while that profile exists.`}
                  </p>
                )
              ) : (
                <p className="drill-hint">
                  Your side is simulated from paycheck profiles; your partner&rsquo;s is
                  entered. Edit all three in the inputs form below. Partner amounts are already
                  counted once in each total above — don&rsquo;t add them again.
                </p>
              )}
            </div>
          )}
```

      Keep the existing comment block above it (lines 161-164) and extend its last line with:
      `Simulated mode swaps the two tracker rows for the leg the server computed — the rows
      stay editable below, they simply stop being this card's answer.`

- [ ] **Implement the page fixture.** In `src/pages/TaxesPage.test.tsx`, add to the
      withholding fixture after `partner_withheld_state: null,`:

```ts
    partner_source: 'entered',
    partner_salary: null,
```

- [ ] **Run to pass.**
      `npx vitest run src/components/taxes/WithholdingPanel.test.tsx src/pages/TaxesPage.test.tsx`
- [ ] **Typecheck:** `npx tsc -b`
- [ ] **Commit:** `feat(withholding): panel heading, facts and provenance follow partner_source`

---

## Task 4 — `money_flow`: split the salary source per person (service)

**Files:**
- `backend/app/services/money_flow.py` (warning constants :61-66, `MoneyFlowSources` :99-105,
  `compose_money_flow` signature :144-171, salary sum :181, warnings block :219-240)
- `backend/tests/test_money_flow.py` (`compose` helper :77-88)

### Steps

- [ ] **Write the failing tests.** Append to `backend/tests/test_money_flow.py`:

```python
# --- the per-person salary split (2026-08-27 spec §4.3) ---


def test_salary_splits_per_person_without_touching_conservation():
    flow = compose(salary_by_person=[("Me", D("160000")), ("Sam", D("60000"))])
    # The SPLIT is new; the node it splits is not: 200000 + 15000 + 5000 unchanged.
    assert flow.sources.salary_and_bonus == D("220000")
    assert [(entry.name, entry.amount) for entry in flow.sources.salary_people] == [
        ("Me", D("160000")),
        ("Sam", D("60000")),
    ]
    # Conservation is the whole contract and it is one node split in two, nothing else.
    named = (
        flow.sources.salary_and_bonus
        + flow.sources.rsu_vests
        + flow.sources.espp
        + flow.sources.investment_income
        + flow.sources.other_income
    )
    assert named == flow.gross_income
    assert (
        flow.taxes.total + flow.pre_tax_savings + flow.take_home_cash + flow.retained_equity
        == flow.gross_income
    )
    assert flow.renderable is True
    assert flow.warnings == compose().warnings


def test_a_single_entry_is_not_a_split():
    # One earner is not two nodes with one missing — it is today's single node.
    assert compose(salary_by_person=[("Me", D("220000"))]).sources.salary_people == []
    assert compose(salary_by_person=[]).sources.salary_people == []
    assert compose().sources.salary_people == []


def test_a_split_that_does_not_sum_to_the_salary_node_is_refused_with_a_warning():
    # Not a refusal to RENDER: the card still draws, with the one node it can prove. A
    # split that does not add up would put a lie in the chart's own conservation.
    flow = compose(salary_by_person=[("Me", D("160000")), ("Sam", D("50000"))])
    assert flow.sources.salary_people == []
    assert flow.renderable is True
    assert (
        "per-person salary rows sum to 210000.00, not the year's 220000.00 — "
        "showing one salary node"
    ) in flow.warnings
```

- [ ] **Run them — expect failure.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_money_flow.py -q`
      Expected: `TypeError: compose_money_flow() got an unexpected keyword argument
      'salary_by_person'`.

- [ ] **Implement.** In `backend/app/services/money_flow.py`, add after
      `SPENDING_COVERAGE_WARNING` (line 65):

```python
SALARY_SPLIT_MISMATCH_WARNING = (
    "per-person salary rows sum to {split}, not the year's {total} — showing one salary node"
)
```

- [ ] **Implement.** Add the dataclass above `MoneyFlowSources` (before line 99) and the new
      field to it:

```python
@dataclass
class MoneyFlowPersonSalary:
    """One earner's slice of the salary source node (2026-08-27 spec §4.3)."""

    name: str
    amount: Decimal


@dataclass
class MoneyFlowSources:
    salary_and_bonus: Decimal
    rsu_vests: Decimal
    espp: Decimal
    investment_income: Decimal
    other_income: Decimal
    # EMPTY is today's single `Salary & bonus` node, byte-identically — single years,
    # partner-less years and any year whose split does not reconcile. Two or more entries
    # (primary first) split THAT node per earner: they sum to `salary_and_bonus` above,
    # which stays the household total, so nothing downstream of the sources column moves.
    salary_people: list[MoneyFlowPersonSalary] = field(default_factory=list)
```

- [ ] **Implement.** Add the parameter to `compose_money_flow`, after
      `brackets_missing_for_status` (line 156):

```python
    salary_by_person: list[tuple[str, Decimal]] | None = None,
```

      …and replace the docstring's last paragraph (lines 167-170) with:

```python
    `filing_status`/`earners` are passed STRAIGHT THROUGH to the engine, so the card's tax
    decomposition is the same arithmetic the Taxes summary shows — with the defaults, that
    is byte-for-byte today's answer. `salary_by_person` is the ROUTER's per-earner sum of
    the same SALARY_KEYS this function totals (primary first); this module only checks
    that a split IS a split — same money, more nodes — and declines to draw one that is
    not.
```

- [ ] **Implement.** Insert the split block immediately after the coverage warnings (after
      the `SPENDING_COVERAGE_WARNING` append, line 240) and before the refusal ladder:

```python
    # The per-person split (spec §4.3). Fewer than two entries is not a split at all —
    # one earner keeps the single node — and a sum that misses `salary_and_bonus` is a
    # bug upstream, so the node stays whole and the warning names the discrepancy rather
    # than drawing a column that does not add up.
    salary_people: list[MoneyFlowPersonSalary] = []
    if salary_by_person is not None and len(salary_by_person) > 1:
        split_total = sum((amount for _name, amount in salary_by_person), ZERO)
        if split_total == salary_and_bonus:
            salary_people = [
                MoneyFlowPersonSalary(name=name, amount=amount) for name, amount in salary_by_person
            ]
        else:
            warnings.append(
                SALARY_SPLIT_MISMATCH_WARNING.format(
                    split=_display(split_total), total=_display(salary_and_bonus)
                )
            )
```

- [ ] **Implement.** In the `MoneyFlow(` return, add to the `MoneyFlowSources(...)` call:

```python
            other_income=other_income,
            salary_people=salary_people,
```

- [ ] **Run to pass.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_money_flow.py -q`
      Expected: all green — the 17 existing tests included, untouched.
- [ ] **Commit:** `feat(money-flow): split the salary source per person without moving conservation`

---

## Task 5 — money-flow route: build the split from the year's per-person W-2 rows

**Files:**
- `backend/app/api/overview.py` (imports :20-30, `_money_flow_out` :39-77, endpoint :80-137)
- `backend/app/schemas/overview.py` (`MoneyFlowSourcesOut` :6-13)
- `backend/tests/test_overview_api.py` (`_seed_married_flow_year` :266-308, married tests :312+)

### Steps

- [ ] **Write the failing tests.** Append to `backend/tests/test_overview_api.py`:

```python
async def test_money_flow_splits_the_salary_node_per_earner(auth_client, db, definitions):
    year = product_today().year
    await _seed_married_flow_year(db, year)
    body = (await auth_client.get(MONEY_FLOW)).json()

    # Primary first — the column order `_return_people` establishes.
    assert body["sources"]["salary_people"] == [
        {"name": "Me", "amount": "200000.00"},
        {"name": "Partner", "amount": "150000.00"},
    ]
    # The node they split is unchanged, and so is everything computed from it.
    assert body["sources"]["salary_and_bonus"] == "350000.00"
    assert body["gross_income"] == "350000.00"
    assert body["renderable"] is True
    assert Decimal(body["taxes"]["total"]) + Decimal(body["pre_tax_savings"]) + Decimal(
        body["take_home_cash"]
    ) + Decimal(body["retained_equity"]) == Decimal(body["gross_income"])


async def test_money_flow_single_year_carries_an_empty_split(auth_client, db, definitions):
    # The byte-identity pin: one earner draws one node, and the wire says so with [].
    year = product_today().year
    await seed_tax_year(auth_client, year)
    body = (await auth_client.get(MONEY_FLOW)).json()
    assert body["sources"]["salary_people"] == []
    assert body["sources"]["salary_and_bonus"] == "220000.00"


async def test_money_flow_does_not_split_when_only_one_earner_has_w2_rows(
    auth_client, db, definitions
):
    # A married year where the partner has no salary yet: a zero node the chart would drop
    # anyway, leaving a lone labelled node where the plain one belongs. Don't split.
    year = product_today().year
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    db.add(TaxYear(year=year, filing_status="married_joint"))
    await db.flush()
    db.add(TaxInput(year=year, key="latest_w2_income", value=Decimal("200000"), person_id=me.id))
    for name, table in MFJ_BRACKETS:
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                    filing_status="married_joint",
                )
            )
    await db.commit()

    body = (await auth_client.get(MONEY_FLOW)).json()
    assert body["sources"]["salary_people"] == []
    assert body["sources"]["salary_and_bonus"] == "200000.00"


async def test_money_flow_on_a_separate_return_does_not_split(auth_client, db, definitions):
    # MFS is one return for ONE person — the partner's W-2 is off it entirely, so there is
    # nothing to split and the single node is the honest one.
    year = product_today().year
    await _seed_married_flow_year(db, year)
    row = await db.get(TaxYear, year)
    row.filing_status = "married_separate"
    await db.commit()

    body = (await auth_client.get(MONEY_FLOW)).json()
    assert body["sources"]["salary_people"] == []
```

- [ ] **Run them — expect failure.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_overview_api.py -q`
      Expected: `KeyError: 'salary_people'` on all four.

- [ ] **Implement the schema.** In `backend/app/schemas/overview.py`, change the import to
      `from pydantic import BaseModel, Field` and replace `MoneyFlowSourcesOut` with:

```python
class MoneyFlowPersonSalaryOut(BaseModel):
    name: str
    amount: Decimal


class MoneyFlowSourcesOut(BaseModel):
    salary_and_bonus: Decimal
    rsu_vests: Decimal
    espp: Decimal
    investment_income: Decimal
    # BALANCING node: engine gross minus the four named sources (1099 income, employer
    # HSA, w2_other, and any stored-total-vs-component drift live here).
    other_income: Decimal
    # EMPTY on single, MFS and partner-less years — the card draws today's ONE salary node.
    # Two or more entries (primary first) split it per earner; they sum to
    # `salary_and_bonus`, which stays the household total.
    salary_people: list[MoneyFlowPersonSalaryOut] = Field(default_factory=list)
```

- [ ] **Implement the router.** In `backend/app/api/overview.py`, extend the imports:

```python
from app.api.taxes import YEAR_MAX, YEAR_MIN, EngineFeed, _engine_feed, _money, _return_people
from app.models import MonthlyCashflow, MonthlySpending, Person, SpendingCategory, TaxInput
from app.schemas.overview import (
    MoneyFlowCategoryOut,
    MoneyFlowOut,
    MoneyFlowPersonSalaryOut,
    MoneyFlowSourcesOut,
    MoneyFlowTaxesOut,
)
from app.services.money_flow import SALARY_KEYS, MoneyFlow, compose_money_flow
from app.services.people import load_people
```

      …and add beside `YearQuery` (after line 36):

```python
ZERO = Decimal("0")
```

- [ ] **Implement the router.** Add the helper above `_money_flow_out` (before line 39):

```python
def _salary_by_person(feed: EngineFeed, people: list[Person]) -> list[tuple[str, Decimal]] | None:
    """Each earner's salary-source sum, primary first — or None when there is no split.

    The people are the ones `_engine_feed` put on THIS return (`_return_people`), so a
    single or MFS year has one column and never splits. A NULL `person_id` is the
    pre-household spelling of "the primary" and folds onto the first column exactly as
    `_owner_column` does for the engine's own inputs, which is what makes the two sums
    reconcile to the cent — the service refuses a split that does not.

    Only POSITIVE sums are entries: a partner with no W-2 rows would otherwise contribute
    a zero node the chart drops anyway, leaving a lone `Salary — Me` where today's plain
    node belongs.
    """
    columns = _return_people(people, feed.filing_status)
    if len(columns) < 2:
        return None
    ids = [person.id for person in columns]
    sums: dict[int, Decimal] = {}
    for row in feed.rows:
        if row.key not in SALARY_KEYS:
            continue
        owner = ids[0] if row.person_id is None else row.person_id
        if owner not in ids:
            continue  # a person this return does not cover — off it, like their inputs
        sums[owner] = sums.get(owner, ZERO) + row.value
    pairs = [
        (person.name, sums[person.id]) for person in columns if sums.get(person.id, ZERO) > 0
    ]
    return pairs if len(pairs) > 1 else None
```

- [ ] **Implement the router.** In `_money_flow_out`, add to the `MoneyFlowSourcesOut(...)`
      call:

```python
            other_income=_money(flow.sources.other_income),
            salary_people=[
                MoneyFlowPersonSalaryOut(name=entry.name, amount=_money(entry.amount))
                for entry in flow.sources.salary_people
            ],
```

- [ ] **Implement the endpoint.** Replace `feed = await _engine_feed(db, year)` (line 85)
      with:

```python
    # The roster is loaded HERE and handed down, so the feed's own columns and the salary
    # split below are decided by one read of `people` rather than two that could straddle
    # a write.
    people = await load_people(db)
    feed = await _engine_feed(db, year, people)
```

      …and add to the `compose_money_flow(` call, after `brackets_missing_for_status=...`:

```python
        salary_by_person=_salary_by_person(feed, people),
```

- [ ] **Run to pass.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_overview_api.py tests/test_money_flow.py -q`
- [ ] **Check the goldens did not move.** `git status --porcelain backend/tests/test_tax_service.py`
      → NOTHING.
- [ ] **Commit:** `feat(money-flow): build the per-person salary split from the year's W-2 rows`

---

## Task 6 — `moneyFlowOptions`: two salary nodes in one hue family

**Files:**
- `src/components/overview/moneyFlowOptions.ts` (`SOURCES` :28-43, `STRUCTURAL_NAMES` :45-59,
  backstop :89-99, `taken` :104, source loop :109-114)
- `src/components/overview/moneyFlowOptions.test.ts` (`flowOut` :11-51, node/color pins :82-135,
  zero-source test :161-182)
- `src/types/api.ts` (`MoneyFlowSources` :1341-1349)
- `src/components/overview/MoneyFlowCard.test.tsx` (fixture :21-27),
  `src/pages/OverviewPage.test.tsx` (fixture :225-228)

### Steps

- [ ] **Write the failing tests.** In `src/components/overview/moneyFlowOptions.test.ts`, add
      `salary_people: [],` to the `sources` object in `flowOut()` (after `other_income`) and
      to the inline `sources` override inside
      `it('omits a zero source without reshuffling its neighbours', ...)` — fixture edits, no
      assertion changes — then append:

```ts
  it('splits the salary node per earner, sharing the salary hue family', () => {
    const series = sankeyOf(
      moneyFlowOption(
        flowOut({
          sources: {
            salary_and_bonus: '220000.00',
            rsu_vests: '80000.00',
            espp: '4000.00',
            investment_income: '2500.00',
            other_income: '1000.00',
            salary_people: [
              { name: 'Me', amount: '132000.00' },
              { name: 'Sam', amount: '88000.00' },
            ],
          },
        }),
      )!,
    )
    const names = series.data?.map((n) => n.name)
    expect(names?.slice(0, 6)).toEqual([
      'Salary — Me',
      'Salary — Sam',
      'RSU vests',
      'ESPP',
      'Investment income',
      'Other income',
    ])
    expect(names).not.toContain('Salary & bonus')
    const byName = new Map(series.data?.map((n) => [n.name, n.itemStyle?.color]))
    // The primary keeps the card's own salary color; the partner takes a lightness step
    // of the theme's validated blue ramp (index 6 of which IS PALETTE[0]).
    expect(byName.get('Salary — Me')).toBe(PALETTE[0])
    expect(byName.get('Salary — Sam')).toBe(SEQUENTIAL_BLUE[9])
    // The neighbours keep their fixed ENTITY slots — a split never reshuffles hues.
    expect(byName.get('RSU vests')).toBe(PALETTE[1])
    expect(byName.get('Other income')).toBe(PALETTE[4])
    // Both nodes feed Gross at their own figure; the column still sums to 307500.
    expect(series.links?.slice(0, 2)).toEqual([
      { source: 'Salary — Me', target: 'Gross income', value: 132000 },
      { source: 'Salary — Sam', target: 'Gross income', value: 88000 },
    ])
  })

  it('claims the split node names so a same-named category cannot duplicate one', () => {
    // The 2026-08-25 Overview crash, one door further in: echarts keys nodes on NAME, and
    // a spending category spelled exactly like a salary node would drop it and then throw
    // inside setOption.
    const series = sankeyOf(
      moneyFlowOption(
        flowOut({
          sources: {
            salary_and_bonus: '220000.00',
            rsu_vests: '80000.00',
            espp: '4000.00',
            investment_income: '2500.00',
            other_income: '1000.00',
            salary_people: [
              { name: 'Me', amount: '132000.00' },
              { name: 'Sam', amount: '88000.00' },
            ],
          },
          categories: [
            { name: 'Salary — Sam', amount: '24000.00' },
            { name: 'Food', amount: '6000.00' },
          ],
          other_spend: null,
          total_spend: '30000.00',
          saved: '90000.00',
        }),
      )!,
    )
    const names = series.data?.map((n) => n.name) ?? []
    expect(names).toContain('Salary — Sam')
    expect(names).toContain('Salary — Sam (spending)')
    expect(new Set(names).size).toBe(names.length)
  })

  it('draws ONE salary node when the split is empty', () => {
    // The byte-identity pin — the default fixture already asserts the full node list, and
    // this restates the contract at the seam that could break it.
    const series = sankeyOf(moneyFlowOption(flowOut())!)
    expect(series.data?.[0]).toMatchObject({
      name: 'Salary & bonus',
      value: 220000,
      depth: 0,
      itemStyle: { color: PALETTE[0] },
    })
  })
```

      …and extend the test file's import to
      `import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE, SEQUENTIAL_BLUE } from '../../charts/theme'`.

- [ ] **Run them — expect failure.** `npx vitest run src/components/overview/moneyFlowOptions.test.ts`
      Expected: the split test fails with the first node still named `Salary & bonus`.

- [ ] **Implement the types.** In `src/types/api.ts`, add above `MoneyFlowSources`:

```ts
/** One earner's slice of the salary source node. */
export interface MoneyFlowPersonSalary {
  name: string
  amount: string
}
```

      …and inside `MoneyFlowSources`, after `other_income`:

```ts
  /** EMPTY = today's single `Salary & bonus` node. Two or more entries (primary first)
   *  split it per earner and sum to `salary_and_bonus`, which stays the household total. */
  salary_people: MoneyFlowPersonSalary[]
```

- [ ] **Implement the builder.** In `src/components/overview/moneyFlowOptions.ts`, change the
      theme import to:

```ts
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE, SEQUENTIAL_BLUE } from '../../charts/theme'
```

      …and replace `SOURCES` + `STRUCTURAL_NAMES` (lines 28-59) with:

```ts
// The salary node's two spellings. One earner keeps the label the card has always drawn;
// a split names each earner (spec §4.3), and `people.name` is UNIQUE in the database, so
// two source nodes can never collide with each other.
const SALARY = 'Salary & bonus'
const SALARY_PREFIX = 'Salary — '

// The salary hue FAMILY, in split order. Slot 0 is PALETTE[0] verbatim — the single-node
// path and the primary earner draw the exact color they always have — and the rest are
// lightness steps of the theme's own validated ramp (SEQUENTIAL_BLUE, whose index 6 IS
// PALETTE[0]); no hue is invented here, which is charts/theme.ts's standing rule.
// #86b6ef measures L* 72.7 against PALETTE[0]'s 55.9: dE 28.5 normal, 25.1 protanope,
// 28.9 deuteranope, 15.1 tritanope — every one past the palette's own 8.4 adjacency floor
// — at 8.25:1 on the #171a21 surface. The third step covers a three-person household;
// beyond that the last tint repeats and the LABELS carry the distinction.
const SALARY_TINTS = [PALETTE[0], SEQUENTIAL_BLUE[9], SEQUENTIAL_BLUE[3]] as const

// The four FIXED sources, on FIXED PALETTE slots per ENTITY (the paycheck sankey's
// grammar): an omitted zero source never reshuffles its neighbours' hues. Salary is not
// here because it is one node or many; it is always emitted FIRST, on slot 0's family.
// Categories reuse slots 0..6 on the far right — a deliberate repetition: left is income
// identity, right is the /spending pages' own category slots (same entity, same hue as the
// stacked bars), and the MUTED intermediates keep the columns apart.
const SOURCES: {
  key: keyof Omit<MoneyFlowOut['sources'], 'salary_and_bonus' | 'salary_people'>
  label: string
  color: string
}[] = [
  { key: 'rsu_vests', label: 'RSU vests', color: PALETTE[1] },
  { key: 'espp', label: 'ESPP', color: PALETTE[2] },
  { key: 'investment_income', label: 'Investment income', color: PALETTE[3] },
  { key: 'other_income', label: 'Other income', color: PALETTE[4] },
]

// The claim seed: every structural node this builder can emit, seeded UNCONDITIONALLY
// (a zero-omitted source or a surplus year's absent Drawdown must not change how a
// colliding category renders from one year to the next). OTHER_SPEND is deliberately NOT
// seeded — the fold entry claims through the same set in emission order, so a real
// category named 'Other' keeps its name and the fold wears the suffix. The SPLIT labels
// are dynamic (they carry user text) and are added to the set per payload below.
const STRUCTURAL_NAMES = [
  GROSS,
  TAXES,
  PRE_TAX,
  RETAINED,
  TAKE_HOME,
  SAVED,
  DRAWDOWN,
  SALARY,
  ...SOURCES.map((source) => source.label),
]

/** The depth-0 salary node(s): one per earner on a split payload, else the single node. */
function salaryNodes(flow: MoneyFlowOut): { label: string; value: number; color: string }[] {
  const people = flow.sources.salary_people
  if (people.length < 2) {
    return [{ label: SALARY, value: Number(flow.sources.salary_and_bonus), color: PALETTE[0] }]
  }
  return people.map((person, index) => ({
    label: `${SALARY_PREFIX}${person.name}`,
    value: Number(person.amount),
    color: SALARY_TINTS[Math.min(index, SALARY_TINTS.length - 1)],
  }))
}
```

- [ ] **Implement the builder.** Replace the backstop, the `taken` seed and the source loop
      (lines 89-114) with:

```ts
  const salary = salaryNodes(flow)
  // Negative backstop (the paycheck sankey's refusal): the server refuses these itself,
  // but a negative ribbon must never be drawable from a payload that slipped through.
  // `saved` is exempt — it is signed by design and drawn as Drawdown below. The salary
  // TOTAL is checked alongside the per-earner slices: the split can only reconcile to a
  // number that is itself drawable.
  const structural = [
    flow.gross_income,
    flow.taxes.total,
    flow.pre_tax_savings,
    flow.take_home_cash,
    flow.retained_equity,
    flow.sources.salary_and_bonus,
    ...SOURCES.map((source) => flow.sources[source.key]),
    ...flow.categories.map((category) => category.amount),
    ...(flow.other_spend === null ? [] : [flow.other_spend]),
  ].map(Number)
  if (structural.some((value) => !Number.isFinite(value) || value < 0)) return null
  if (salary.some((node) => !Number.isFinite(node.value) || node.value < 0)) return null

  // The name-claim set (see STRUCTURAL_NAMES): category names pass through claimNodeName
  // so no node name can ever duplicate or cycle — echarts crashes on both, from inside
  // setOption, where the route boundary would blank the WHOLE Overview. The split labels
  // join the set because they carry USER TEXT on the left column for the first time: a
  // spending category spelled 'Salary — Sam' must wear the suffix, not take the node.
  const taken = new Set([...STRUCTURAL_NAMES, ...salary.map((node) => node.label)])

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []

  const sourceNodes = [
    ...salary,
    ...SOURCES.map((source) => ({
      label: source.label,
      value: Number(flow.sources[source.key]),
      color: source.color,
    })),
  ]
  for (const source of sourceNodes) {
    if (source.value < A_CENT) continue
    nodes.push({ name: source.label, value: source.value, depth: 0, itemStyle: { color: source.color } })
    links.push({ source: source.label, target: GROSS, value: source.value })
  }
```

- [ ] **Implement the sibling fixtures.** Add `salary_people: [],` to the `sources` object in
      `src/components/overview/MoneyFlowCard.test.tsx` (after `other_income`) and in
      `src/pages/OverviewPage.test.tsx` (after `other_income: '1000.00',`).

- [ ] **Run to pass.**
      `npx vitest run src/components/overview/moneyFlowOptions.test.ts src/components/overview/MoneyFlowCard.test.tsx src/pages/OverviewPage.test.tsx`
- [ ] **Typecheck:** `npx tsc -b`
- [ ] **Commit:** `feat(money-flow): draw one salary node per earner in the salary hue family`

---

## Task 7 — `calendar_events`: paydays per profiled person

**Files:**
- `backend/app/services/calendar_events.py` (`compose` signature :68-81, payday block :169-186)
- `backend/tests/test_calendar_events.py` (`_compose` :25-37, payday tests :159-184,
  same-day sort test :247-262, `test_computed_events_carry_no_event_id` :243)

### Steps

- [ ] **Write the failing tests.** In `backend/tests/test_calendar_events.py`:
      change the import to
      `from app.services.calendar_events import PaydaySource, compose`,
      replace `payday_semi_monthly=False,` in `_compose`'s defaults with
      `payday_sources=[],`, and replace every `payday_semi_monthly=True` call-site argument
      (4 of them: lines 162, 175, 244, 255) with
      `payday_sources=[PaydaySource(name="Me", semi_monthly=True)]`. **No assertion in those
      tests changes — that is the byte-identity pin.** Then append:

```python
def test_two_profiled_people_get_labelled_paydays():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[
                PaydaySource(name="Me", semi_monthly=True),
                PaydaySource(name="Sam", semi_monthly=True),
            ],
        ),
        "payday",
    )
    # Two chips per date, sorted by label within the day (compose's (date, type, label)).
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 8, 14), "Payday — Me", "Me"),
        (date(2026, 8, 14), "Payday — Sam", "Sam"),
        (date(2026, 8, 31), "Payday — Me", "Me"),
        (date(2026, 8, 31), "Payday — Sam", "Sam"),
    ]
    # The ICS UID is {type}-{date}-{slug(label)}: same-date chips must not collide.
    assert len({(e.event_date, e.label) for e in events}) == len(events)


def test_the_cadence_gate_is_per_person_and_the_label_is_not():
    # One semi-monthly earner beside a biweekly one: the biweekly side is omitted rather
    # than guessed (the standing rule), and the surviving chips are STILL labelled —
    # otherwise a two-earner household would read the remaining chips as household-wide.
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[
                PaydaySource(name="Me", semi_monthly=True),
                PaydaySource(name="Sam", semi_monthly=False),
            ],
        ),
        "payday",
    )
    assert [(e.event_date, e.label) for e in events] == [
        (date(2026, 8, 14), "Payday — Me"),
        (date(2026, 8, 31), "Payday — Me"),
    ]


def test_one_profiled_person_keeps_the_bare_unlabelled_payday():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[PaydaySource(name="Me", semi_monthly=True)],
        ),
        "payday",
    )
    assert all(e.label == "Payday" and e.detail is None and e.href == "/paycheck" for e in events)
```

- [ ] **Run them — expect failure.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_calendar_events.py -q`
      Expected: `ImportError: cannot import name 'PaydaySource'`.

- [ ] **Implement.** In `backend/app/services/calendar_events.py`, add after `CalendarEvent`
      (after line 65):

```python
@dataclass(frozen=True)
class PaydaySource:
    """One person's IN-FORCE paycheck profile, reduced to what the payday composer needs:
    the name that labels their chips and whether their cadence is the semi-monthly one
    this calendar can date (2026-08-27 spec §4.4). The ROUTER decides which profile is in
    force; nothing here reads a profile row."""

    name: str
    semi_monthly: bool
```

- [ ] **Implement.** In `compose`'s signature, replace `payday_semi_monthly: bool,` with:

```python
    payday_sources: list[PaydaySource],  # one per person WITH a profile, primary first
```

- [ ] **Implement.** Replace the payday block (lines 169-186) with:

```python
    # payday — ONLY the semi-monthly cadence (spec §5: pay_periods_per_year == 24; any
    # other cadence omits THAT PERSON's paydays entirely — the page legend says so in
    # words — because guessing biweekly anchors would be wrong money on the calendar).
    # The gate is PER PROFILE, so a semi-monthly earner still gets their chips beside a
    # biweekly partner's silence.
    #
    # Labels only when there is somebody to tell apart: a one-profile household keeps the
    # bare "Payday" it has always drawn (byte-identical, pinned). The count is of PROFILED
    # people, not of the semi-monthly ones — when one of two earners is omitted by the
    # cadence gate, the surviving chips especially need to say whose they are.
    labelled = len(payday_sources) > 1
    for source in payday_sources:
        if not source.semi_monthly:
            continue
        year, month = start.year, start.month
        while (year, month) <= (end.year, end.month):
            for payday in semi_monthly_paydays(year, month):
                if in_range(payday):
                    events.append(
                        CalendarEvent(
                            event_date=payday,
                            type="payday",
                            # IDENTITY in the label, this file's standing rule: the
                            # frontend's ICS UID is {type}-{date}-{slug(label)}, and two
                            # people paid the same day would otherwise merge into one
                            # event in a calendar app.
                            label=f"Payday — {source.name}" if labelled else "Payday",
                            detail=source.name if labelled else None,
                            href="/paycheck",
                        )
                    )
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
```

- [ ] **Run to pass.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_calendar_events.py -q`
      Expected: all green (the router still passes the old kwarg, so
      `tests/test_calendar_api.py` is RED until Task 8 — that is the intended order).
- [ ] **Commit:** `feat(calendar): compose paydays per profiled person, labelled when there are two`

---

## Task 8 — calendar route: resolve the in-force profile per person

**Files:**
- `backend/app/api/calendar.py` (imports :6-30, constants :34-38, latest-profile read
  :126-138, `compose(` call :159-171)
- `backend/tests/test_calendar_api.py` (imports :8-16, payday assertions :177-181,
  cadence test :198-210)

### Steps

- [ ] **Write the failing tests.** In `backend/tests/test_calendar_api.py`, add `Person` to
      the `from app.models import (...)` list, then append:

```python
async def test_calendar_labels_paydays_when_two_people_have_profiles(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    me = Person(name="Me", is_primary=True)
    sam = Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.flush()
    db.add_all(
        [
            PaycheckProfile(
                effective_date=date(2026, 1, 1),
                annual_salary=Decimal("120000"),
                person_id=me.id,
            ),
            PaycheckProfile(
                effective_date=date(2026, 2, 1),
                annual_salary=Decimal("90000"),
                person_id=sam.id,
            ),
        ]
    )
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")
    assert resp.status_code == 200
    paydays = [e for e in resp.json()["events"] if e["type"] == "payday"]
    assert [(e["date"], e["label"], e["detail"]) for e in paydays] == [
        ("2026-08-14", "Payday — Me", "Me"),
        ("2026-08-14", "Payday — Sam", "Sam"),
        ("2026-08-31", "Payday — Me", "Me"),
        ("2026-08-31", "Payday — Sam", "Sam"),
    ]


async def test_calendar_uses_each_persons_IN_FORCE_profile_not_the_newest_row(
    auth_client, db, monkeypatch
):
    # "In force" (spec §4.4), not "the latest row in the table": a raise dated next year —
    # which may even change cadence — must not silence the checks landing this month.
    freeze_today(monkeypatch)
    me = Person(name="Me", is_primary=True)
    db.add(me)
    await db.flush()
    db.add_all(
        [
            PaycheckProfile(
                effective_date=date(2026, 1, 1),
                annual_salary=Decimal("120000"),
                pay_periods_per_year=24,
                person_id=me.id,
            ),
            PaycheckProfile(
                effective_date=date(2027, 1, 1),
                annual_salary=Decimal("150000"),
                pay_periods_per_year=26,
                person_id=me.id,
            ),
        ]
    )
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")
    assert [e["date"] for e in resp.json()["events"] if e["type"] == "payday"] == [
        "2026-08-14",
        "2026-08-31",
    ]


async def test_calendar_falls_back_to_a_future_only_profile(auth_client, db, monkeypatch):
    # paycheck.py's own rule, mirrored: a brand-new user whose only profile starts next
    # month gets the checks that are COMING rather than an empty calendar.
    freeze_today(monkeypatch)
    me = Person(name="Me", is_primary=True)
    db.add(me)
    await db.flush()
    db.add(
        PaycheckProfile(
            effective_date=date(2026, 12, 1),
            annual_salary=Decimal("120000"),
            person_id=me.id,
        )
    )
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")
    assert [e["date"] for e in resp.json()["events"] if e["type"] == "payday"] == [
        "2026-08-14",
        "2026-08-31",
    ]
```

- [ ] **Run them — expect failure.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_calendar_api.py -q`
      Expected: `TypeError: compose() got an unexpected keyword argument
      'payday_semi_monthly'` on EVERY test in the file (Task 7 changed the signature), which
      this task repairs.

- [ ] **Implement.** In `backend/app/api/calendar.py`, extend the imports:

```python
from app.services.calendar_events import PaydaySource, compose
from app.services.people import load_people, primary_person
```

      …and add beside `MAX_SPAN_DAYS` (after line 38):

```python
# The one cadence this calendar can date (spec §5). Any other cadence omits that person's
# paydays entirely — worded on the page legend, never guessed here.
SEMI_MONTHLY_PERIODS = 24
# Used only when the roster has not been seeded at all, where there is exactly ONE payday
# source and the label is therefore never rendered.
UNNAMED_PERSON = "You"
```

- [ ] **Implement.** Replace the latest-profile read (lines 126-138) with:

```python
    # Paydays follow the profile IN FORCE for EACH person (spec §4.4), not "the newest row
    # in the table": a future-dated raise must not silence this month's checks, and a
    # two-earner household has two answers. Same rule as paycheck.py's `_default_profile`
    # — the latest row effective today or earlier, else the earliest future one — resolved
    # in ONE ordered pass rather than a query per person.
    people = await load_people(db)
    primary = primary_person(people)
    in_force: dict[int | None, PaycheckProfile] = {}
    for profile in (
        await db.execute(select(PaycheckProfile).order_by(PaycheckProfile.effective_date))
    ).scalars():
        # A NULL person_id is the pre-household spelling of "the primary" (the taxes
        # router's `_owner_column` rule), and with no roster at all every profile shares
        # the one None bucket — which is exactly the single unlabelled household.
        owner = profile.person_id if profile.person_id is not None else (
            None if primary is None else primary.id
        )
        # Rows arrive oldest-first, so a past row always supersedes and the FIRST future
        # row only lands when nothing past has.
        if profile.effective_date <= today or owner not in in_force:
            in_force[owner] = profile
    # Primary first, then by id (load_people's order) — the order the labels read in.
    owners: list[int | None] = [person.id for person in people if person.id in in_force]
    if None in in_force:
        owners.append(None)
    names = {person.id: person.name for person in people}
    payday_sources = [
        PaydaySource(
            name=UNNAMED_PERSON if owner is None else names.get(owner, UNNAMED_PERSON),
            semi_monthly=in_force[owner].pay_periods_per_year == SEMI_MONTHLY_PERIODS,
        )
        for owner in owners
    ]
```

- [ ] **Implement.** In the `compose(` call, replace `payday_semi_monthly=semi_monthly,` with
      `payday_sources=payday_sources,`.

- [ ] **Run to pass.**
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest tests/test_calendar_api.py tests/test_calendar_events.py -q`
      Expected: all green, including the untouched single-profile assertions at :177-181 and
      the cadence-26 omission at :198-210.
- [ ] **Commit:** `feat(calendar): read the in-force paycheck profile per person for paydays`

---

## Task 9 — calendar legend: say when payday chips carry a name

**Files:**
- `src/pages/CalendarPage.tsx` (legend note :407-413)
- `src/pages/CalendarPage.test.tsx`

### Steps

- [ ] **Write the failing test.** Append inside `CalendarPage.test.tsx`'s main describe:

```tsx
  it('tells the reader when payday chips carry a person name', async () => {
    render(<CalendarPage />)
    expect(
      await screen.findByText(
        /Paydays appear only for semi-monthly \(24 checks\/yr\) paycheck profiles — other cadences are omitted rather than guessed, and each chip carries the person's name once more than one person has a profile\./,
      ),
    ).toBeTruthy()
  })
```

- [ ] **Run it — expect failure.** `npx vitest run src/pages/CalendarPage.test.tsx`
      Expected: `Unable to find an element with the text: /Paydays appear only.../`.
- [ ] **Implement.** In `src/pages/CalendarPage.tsx`, replace the first sentence of the legend
      note (line 410) with:

```tsx
              Paydays appear only for semi-monthly (24 checks/yr) paycheck profiles — other
              cadences are omitted rather than guessed, and each chip carries the
              person&apos;s name once more than one person has a profile. Ex-dividend dates
              are confirmed announcements only: stocks typically publish 2–6 weeks ahead,
              ETFs often just days ahead, so a quiet stretch may simply be unannounced.
```

      (Delete the now-duplicated "Ex-dividend dates …" sentence that followed.)
- [ ] **Run to pass.** `npx vitest run src/pages/CalendarPage.test.tsx`
- [ ] **Commit:** `feat(calendar): legend says payday chips carry a name in a two-earner household`

---

## Task 10 — batch verification

**Files:** none changed — this task only runs things.

### Steps

- [ ] **Goldens untouched.** `git status --porcelain backend/tests/test_tax_service.py` prints
      NOTHING, and `git diff --stat HEAD -- backend/tests/test_tax_service.py` is empty. If
      either shows a change, revert it — the tax engine's goldens are not this batch's to move.
- [ ] **Full backend suite.** From `backend/`:
      `FINANCE_TEST_DB=finance_test_p3flow .venv/Scripts/python.exe -m pytest -q`
      Expected: 1042 baseline + the ~22 tests this plan adds, 0 failures.
- [ ] **Full frontend suite.** `npx vitest run`
      Expected: 1168 baseline + the ~9 tests this plan adds, 0 failures.
- [ ] **Lint + types.** From `backend/`: `.venv/Scripts/python.exe -m ruff check app tests` and
      `.venv/Scripts/python.exe -m ruff format --check app tests`. From the repo root:
      `npx tsc -b` and `npm run lint`.
- [ ] **Wire diff review.** Confirm the four new wire fields and nothing else:
      `WithholdingOut.partner_source`, `WithholdingOut.partner_salary`,
      `MoneyFlowSourcesOut.salary_people`, and the payday `label`/`detail` values. No event
      type, no endpoint path and no existing field changed shape.
- [ ] **Byte-identity spot check (manual, one command).** With a single-person database,
      `GET /api/v1/overview/money-flow` must still report
      `"salary_people": []`, `GET /api/v1/calendar` must still report `"label": "Payday"` with
      `"detail": null`, and `GET /api/v1/taxes/years/{Y}/withholding` must still report
      `"partner_source": "entered"`, `"partner_salary": null`.
- [ ] **Commit (only if anything moved):** `test(p3): batch verification for the withholding/flow/calendar plan`

---

## Risks & open questions (for the reconciliation pass)

1. **Plan 1 has not been written yet.** Every `person_id` assumption above is taken from spec
   §3/§4.1. Task 2 and Task 8 both fold a NULL `person_id` onto the primary, so they are
   correct whether the column is nullable or not — but the TEST seeding (`seed_profile(db,
   person_id=...)`) needs Plan 1's model change to exist.
2. **`_default_profile`'s signature is unreconciled** — today it is `(db, today)`, the batch
   brief says `(db, person_id)`. Task 8 deliberately does not call it.
3. **The calendar's payday rule changes from "newest row" to "in force"** (spec §4.4's own
   words). A household with a future-dated cadence change sees MORE paydays than before; a
   test pins the new behavior explicitly.
4. **`compose`'s `payday_semi_monthly` parameter is removed, not deprecated.** Five call-site
   arguments in `test_calendar_events.py` change; no assertion in that file does.
5. **Simulated mode still reports the two tracker figures on the wire** (they are stored
   facts) while excluding them from every total, with a named warning. The alternative —
   nulling them — would claim nothing is stored, which is false.
6. **The third salary tint measures 2.63:1 on the surface**, below the 3:1 target. It is
   unreachable for the shipped two-person household; if a third earner ever becomes real, that
   slot needs re-validation rather than reuse.
