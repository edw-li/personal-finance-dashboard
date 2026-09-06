# Lane A — backend: ESPP purchase-year pace, employer match, discount setting, partial settings PUT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All backend work in the 2026-09-06 spec §1–§2 and §3.5 — the ESPP pace row grades the *purchase* year against a discount-derived practical cap, the 415(c) row counts an employer 401(k) match stored per profile, the ESPP discount becomes a setting, `PUT /settings` becomes partial.

**Architecture:** One migration adds four match columns to `paycheck_profiles`. `services/limit_check.py` grows a pure `employer_match()` and the widened `PaceItem`/`PaceHalf` row. A new pure `services/espp_pace.py` builds the two purchase windows by walking paydays through the person's profile timeline. `api/paycheck.py` loads the periods, the timeline and the discount and swaps the ESPP row in for GET and preview. `api/app_settings.py` gains `read_espp_discount` and an exclude-unset partial PUT; every hardcoded 0.85 / 15 / 15÷85 takes the discount as a parameter.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic, pydantic v2, pytest, ruff.

**Rules for every task**
- Work from `C:\Users\edyli\personal-finance-dashboard\backend`. Test: `FINANCE_TEST_DB=finance_test_pa .venv/Scripts/python.exe -m pytest tests/<file> -q`, written `pytest …` below (PowerShell: `$env:FINANCE_TEST_DB="finance_test_pa"`).
- Finish every task with `.venv/Scripts/python.exe -m ruff format app tests && .venv/Scripts/python.exe -m ruff check app tests`. Snippets are written densely (single blank lines, packed calls); ruff reflows them to the house 100-column style.
- Snippets carry only the comments that encode a rule. Match each file's own comment density when you write the real thing: every non-obvious decision gets a *why*.
- This lane touches **no** file under `src/`, and **never** `app/services/savings.py`.

---

### Task 1: The match columns (migration + model)

**Files:** Create `alembic/versions/20260906_0900_f6b8d2e4a7c1_paycheck_profile_match_tiers.py` · Modify `app/models/comp.py:39-70` · Test `tests/test_models_comp.py`

- [ ] **1 Write the failing test** — append to `tests/test_models_comp.py`:

```python
async def test_paycheck_profile_match_columns_round_trip(db):
    me = Person(name="Match", is_primary=True)
    db.add(me)
    await db.flush()
    db.add(PaycheckProfile(person_id=me.id, effective_date=date(2026, 1, 1),
                           annual_salary=Decimal("100000")))
    db.add(PaycheckProfile(person_id=me.id, effective_date=date(2026, 2, 1),
                           annual_salary=Decimal("188930"), match_rate_1=Decimal("1"),
                           match_band_1=Decimal("6000.00"), match_rate_2=Decimal("0.5"),
                           match_band_2=Decimal("11000.00")))
    await db.commit()
    bare, policy = (await db.execute(select(PaycheckProfile).where(
        PaycheckProfile.person_id == me.id).order_by(PaycheckProfile.effective_date))).scalars()
    # Zero bands mean "no match" — the only honest backfill for a row nobody was asked about.
    assert (bare.match_rate_1, bare.match_band_1) == (Decimal("0"), Decimal("0"))
    assert (bare.match_rate_2, bare.match_band_2) == (Decimal("0"), Decimal("0"))
    assert policy.match_rate_2 == Decimal("0.5")  # Numeric(10,9) keeps a half-rate exactly
    assert (policy.match_rate_1, policy.match_band_2) == (Decimal("1"), Decimal("11000.00"))
```

- [ ] **2 Fail:** `pytest tests/test_models_comp.py -q` → `TypeError: 'match_rate_1' is an invalid keyword argument`.
- [ ] **3 Add the columns** — in `app/models/comp.py`, between the `hsa_coverage` line and `notes:`:

```python
    # Employer 401(k) match, per person and effective-dated with the rest of the row (spec
    # §2.1): `rate_1` on the first `band_1` DOLLARS of elective deferrals, `rate_2` on the
    # next `band_2`. Zero bands mean "no match" — the app has never asked, so it must not
    # invent a policy. server_defaults repeated from the migration (hsa_coverage's rule).
    match_rate_1: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0, server_default="0")
    match_band_1: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    match_rate_2: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0, server_default="0")
    match_band_2: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
```

- [ ] **4 Write the migration** — copy `alembic/versions/20260827_0901_a2c6b8d40f19_paycheck_profile_hsa_coverage.py` (imports and header verbatim), set `revision = "f6b8d2e4a7c1"` and `down_revision = "e5a7c1d3f6b8"`, `Create Date: 2026-09-06 09:00:00.000000`, and replace its docstring body with: *"One person's employer 401(k) match policy (2026-09-06 spec §2.1): `match_rate_1` on the first `match_band_1` dollars of elective deferrals, `match_rate_2` on the next `match_band_2`. All NOT NULL with server_default '0' (the hsa_coverage template) — zero bands mean "no match", the only honest backfill. Validated in Python (api/paycheck.py), not by CHECK constraints: the bounds share the writers' 422 vocabulary and may move."* Replace the two operation bodies with:

```python
_COLUMNS = (("match_rate_1", sa.Numeric(10, 9)), ("match_band_1", sa.Numeric(12, 2)),
            ("match_rate_2", sa.Numeric(10, 9)), ("match_band_2", sa.Numeric(12, 2)))

def upgrade() -> None:
    """Upgrade schema."""
    for name, kind in _COLUMNS:
        op.add_column("paycheck_profiles",
                      sa.Column(name, kind, server_default="0", nullable=False))

def downgrade() -> None:
    """Downgrade schema."""
    for name, _kind in reversed(_COLUMNS):
        op.drop_column("paycheck_profiles", name)
```

- [ ] **5 Pass:** `pytest tests/test_models_comp.py tests/test_restore.py tests/test_export_api.py tests/test_importer_apply.py -q`. Export serialises every column automatically and `app/lifecycle/restore.py:196-200,377-379` already warns on an absent snapshot column then strips it so the column default applies — nothing to change there; these suites prove it.
- [ ] **6 Commit:** `git add -A backend && git commit -m "feat(paycheck): store a two-tier employer 401(k) match on the profile"`

---

### Task 2: Match on the wire — validation, overrides, `in_force`

**Files:** `app/schemas/paycheck.py:26-63,66-84,134-154` · `app/api/paycheck.py:87-126,133-196,260-325,433-495` · Test `tests/test_paycheck_comp_api.py`

- [ ] **1 Write the failing tests** — append to `tests/test_paycheck_comp_api.py`:

```python
MATCH = {"match_rate_1": "1", "match_band_1": "6000",
         "match_rate_2": "0.5", "match_band_2": "11000"}

async def test_profile_round_trips_the_match_policy(auth_client, me):
    created = await auth_client.post(
        PROFILES, json={"effective_date": "2026-01-01", "annual_salary": "188930", **MATCH})
    assert created.status_code == 201, created.text
    assert created.json()["match_rate_1"] == "1.000000000"
    assert created.json()["match_rate_2"] == "0.500000000"
    assert created.json()["match_band_1"] == "6000.00"
    bare = await auth_client.post(
        PROFILES, json={"effective_date": "2026-02-01", "annual_salary": "100000"})
    assert bare.json()["match_rate_1"] == "0.000000000"
    assert bare.json()["match_band_2"] == "0.00"

@pytest.mark.parametrize(("field", "value", "message"), [
    # A 50 meant as 50 % is the Plan 1 mis-scale guard; the ceiling is 2 because a 200 %
    # match is a real plan shape and 1.0 is not the maximum.
    ("match_rate_1", "50", "match_rate_1 must be between 0 and 2"),
    ("match_rate_2", "-0.1", "match_rate_2 must be between 0 and 2"),
    ("match_band_1", "-1", "match_band_1 must be >= 0")])
async def test_profile_refuses_a_bad_match_policy(auth_client, me, field, value, message):
    resp = await auth_client.post(PROFILES, json={
        "effective_date": "2026-03-01", "annual_salary": "100000", field: value})
    assert resp.status_code == 422
    assert resp.json()["detail"] == message

async def test_patch_validates_the_match_as_a_whole_row(auth_client, me):
    created = await auth_client.post(
        PROFILES, json={"effective_date": "2026-04-01", "annual_salary": "100000", **MATCH})
    pid = created.json()["id"]
    bad = await auth_client.patch(f"{PROFILES}/{pid}", json={"match_rate_2": "3"})
    assert bad.status_code == 422
    assert bad.json()["detail"] == "match_rate_2 must be between 0 and 2"
    good = await auth_client.patch(f"{PROFILES}/{pid}", json={"match_band_2": "12000"})
    assert good.json()["match_band_2"] == "12000.00"
    assert good.json()["match_rate_1"] == "1.000000000"  # untouched by the merge

async def test_profiles_list_marks_the_one_in_force(auth_client, me):
    old = await auth_client.post(
        PROFILES, json={"effective_date": "2020-01-01", "annual_salary": "100000"})
    now = await auth_client.post(
        PROFILES, json={"effective_date": date.today().isoformat(), "annual_salary": "110000"})
    later = await auth_client.post(PROFILES, json={
        "effective_date": (date.today() + timedelta(days=400)).isoformat(),
        "annual_salary": "120000"})
    rows = {row["id"]: row["in_force"] for row in (await auth_client.get(PROFILES)).json()}
    # `_default_profile`'s rule, one place: the latest effective TODAY or earlier.
    assert rows[now.json()["id"]] is True
    assert rows[old.json()["id"]] is False
    assert rows[later.json()["id"]] is False
    assert (await auth_client.get(BREAKDOWN)).json()["profile"]["in_force"] is True
```

- [ ] **2 Fail:** `pytest tests/test_paycheck_comp_api.py -q -k "match or in_force"` → `KeyError: 'match_rate_1'` / `'in_force'`.
- [ ] **3 Schemas** — in `app/schemas/paycheck.py`, for each of `match_rate_1`, `match_band_1`, `match_rate_2`, `match_band_2`: add to `ProfileIn` above `notes:` as `<name>: Decimal = Decimal("0")` (comment: the defaults match the columns' server_default so an old client stores what the migration backfilled); to `ProfileUpdate` above `notes:` and to `ProfileOverrides` after `hsa_coverage` as `<name>: Decimal | None = None`. In `ProfileOut` above `notes: str | None` add `match_rate_1: Pct9`, `match_band_1: Decimal`, `match_rate_2: Pct9`, `match_band_2: Decimal`, then:

```python
    # Is THIS the row `_default_profile` would pick for its owner today (spec §2.3)? The
    # Settings summary and the Paycheck page must never disagree about whose policy is live,
    # so the server answers once instead of both clients re-deriving it.
    in_force: bool
```

- [ ] **4 Router** — in `app/api/paycheck.py`:

(a) after the `CONTRIBUTION_FIELDS` block:

```python
MATCH_RATE_FIELDS = ("match_rate_1", "match_rate_2")
MATCH_BAND_FIELDS = ("match_band_1", "match_band_2")
MATCH_FIELDS = (*MATCH_RATE_FIELDS, *MATCH_BAND_FIELDS)
# 2, not 1: a 200 % match is a real plan shape, so 1.0 is not the ceiling. The mis-scale
# guard is still `_validated_pct`'s — a 50 meant as 50 % must never reach the formula.
MATCH_RATE_MAX = Decimal(2)
```

(b) `SCENARIO_FIELDS`: replace `    "hsa_coverage",\n)` with `    "hsa_coverage",\n    *MATCH_FIELDS,\n)`.
(c) `FIELD_LABELS`: after the `hsa_coverage` entry add `"match_rate_1": "Match rate (first band)"`, `"match_band_1": "Match band 1"`, `"match_rate_2": "Match rate (second band)"`, `"match_band_2": "Match band 2"`.
(d) after `_validated_pct`:

```python
def _validated_match_rate(value: Decimal, field: str) -> Decimal:
    """A match rate at the pcts' own 9 dp, bounded at 2 rather than 1: a 200 % match is a
    real plan, while a 50 meant as 50 % is still the Plan 1 mis-scale mistake."""
    quantized = _quantize_bounded(value, field, PCT_QUANTUM_9, PCT_INPUT_MAX_ABS) + ZERO
    if value < 0 or not 0 <= quantized <= MATCH_RATE_MAX:
        raise HTTPException(status_code=422, detail=f"{field} must be between 0 and 2")
    return quantized

def _validated_band(value: Decimal, field: str) -> Decimal:
    """Dollars of elective deferrals a rate applies to — the salary column's own bound."""
    quantized = quantize_money(value, field, max_abs=MONEY_MAX_ABS_12_2) + ZERO
    if value < 0 or quantized < 0:
        raise HTTPException(status_code=422, detail=f"{field} must be >= 0")
    return quantized
```

(e) `_validated_profile`: add a `match: dict[str, Decimal]` parameter after `pcts`, and append to the returned dict after the `**{name: _validated_pct(...)}` entry:

```python
        **{name: _validated_match_rate(match[name], name) for name in MATCH_RATE_FIELDS},
        **{name: _validated_band(match[name], name) for name in MATCH_BAND_FIELDS},
```

(f) `create_profile` call: add `match={name: getattr(body, name) for name in MATCH_FIELDS},`
(g) `update_profile` call: add `match={name: _merged(provided, name, getattr(profile, name)) for name in MATCH_FIELDS},`
(h) `ScenarioProfile`: add `match_rate_1: Decimal`, `match_band_1: Decimal`, `match_rate_2: Decimal`, `match_band_2: Decimal` after `hsa_coverage: str`.
(i) `_scenario_profile`: insert above `return ScenarioProfile(`, and add `**match,` beside `**pcts,`:

```python
    match = {name: (getattr(base, name) if getattr(overrides, name) is None
                    else (_validated_match_rate if name in MATCH_RATE_FIELDS else _validated_band)(
                        getattr(overrides, name), name))
             for name in MATCH_FIELDS}
```

(j) after `_default_profile`:

```python
async def _mark_in_force(db: AsyncSession, profiles: list[PaycheckProfile], today: date) -> None:
    """Stamp the transient `in_force` flag `ProfileOut` reads (2026-09-06 spec §2.3).

    ONE rule — `_default_profile`'s — asked once per OWNER, so the Settings summary and the
    Paycheck page can never disagree about whose policy is live. The attribute is UNMAPPED:
    it lives on the instance for this response, never marks the row dirty, and so stays
    invisible to the preview's purity walk (tests/test_sandbox_purity.py)."""
    winners: dict[int, int | None] = {}
    for profile in profiles:
        if profile.person_id not in winners:
            current = await _default_profile(db, profile.person_id, today)
            winners[profile.person_id] = None if current is None else current.id
    for profile in profiles:
        profile.in_force = winners[profile.person_id] == profile.id
```

(k) call it on every route returning a `ProfileOut`. `list_profiles`: bind the query to `rows = list(...)`, then `await _mark_in_force(db, rows, date.today())`, then `return rows`. `create_profile` / `update_profile`: insert `await _mark_in_force(db, [profile], date.today())` above `return profile`. `get_breakdown`: `await _mark_in_force(db, [profile], today)` above its `return`. `preview`: `await _mark_in_force(db, [base], today)` above its `return`.

- [ ] **5 Pass:** `pytest tests/test_paycheck_comp_api.py tests/test_paycheck_preview_api.py tests/test_sandbox_purity.py -q`
- [ ] **6 Commit:** `git add -A backend && git commit -m "feat(paycheck): the match policy and in_force cross the profile wire"`

---

### Task 3: `employer_match()` and the 415(c) composition

**Files:** `app/services/limit_check.py:34-121` · `app/schemas/paycheck.py:87-104` · Test `tests/test_limit_check.py`

- [ ] **1 Write the failing tests** — in `tests/test_limit_check.py` add `employer_match` to the `app.services.limit_check` import and, after `FakeProfile.hsa_per_check`, the four fields `match_rate_1`, `match_band_1`, `match_rate_2`, `match_band_2`, each `: Decimal = Decimal("0")`. Then append:

```python
POLICY = {"match_rate_1": Decimal("1"), "match_band_1": Decimal("6000.00"),
          "match_rate_2": Decimal("0.5"), "match_band_2": Decimal("11000.00")}

def test_employer_match_golden():
    # 100 % of the first 6,000 + 50 % of the next 11,000 = 6,000 + 5,500.
    assert employer_match(FakeProfile(**POLICY), Decimal("24500.00"), None) == Decimal("11500.00")
    # Deferrals past the end of the second band earn nothing more...
    assert employer_match(FakeProfile(**POLICY), Decimal("50000.00"), None) == Decimal("11500.00")
    # ...and inside the first band the match simply follows the money.
    assert employer_match(FakeProfile(**POLICY), Decimal("2500.00"), None) == Decimal("2500.00")
    assert employer_match(FakeProfile(), Decimal("24500.00"), None) == Decimal("0")

def test_employer_match_caps_the_elective_at_the_402g_limit():
    """Payroll stops deferrals at the limit and the match follows actual contributions —
    13 % of 188,930 is 24,560.90, but only 24,500 of it is ever deferred."""
    p = FakeProfile(annual_salary=Decimal("188930.00"), trad_401k_pct=Decimal("0.13"), **POLICY)
    elective = p.trad_401k_pct * p.annual_salary
    assert employer_match(p, elective, Decimal("24500.00")) == Decimal("11500.00")

def test_total_additions_includes_the_match_and_renames_the_row():
    profile = FakeProfile(annual_salary=Decimal("188930.00"), trad_401k_pct=Decimal("0.13"),
                          after_tax_401k_pct=Decimal("0.03"), **POLICY)
    limits = {LIMIT_401K_ELECTIVE: Decimal("24500.00"), LIMIT_415C_TOTAL: Decimal("72000.00")}
    row = by_key(paycheck_pace(profile, limits, "none"))[LIMIT_415C_TOTAL]
    assert row.annualized == Decimal("41667.90")  # 24,500 capped + 5,667.90 + 11,500
    assert row.employer_match == Decimal("11500.00")
    assert row.ratio == Decimal("0.5787")
    assert row.tone == "ok"
    assert row.label == "415(c) total additions (incl. employer match)"

def test_no_policy_keeps_todays_caveat_and_a_null_match():
    row = by_key(paycheck_pace(FakeProfile(), {}, "none"))[LIMIT_415C_TOTAL]
    assert row.label == "415(c) total additions (excludes employer match)"
    assert row.employer_match is None

def test_a_policy_that_earns_nothing_this_year_still_renames_the_row():
    """Bands are the POLICY; the match is this year's pace. Somebody deferring nothing has
    the first and not the second — the label says one, `employer_match` the other."""
    row = by_key(paycheck_pace(
        FakeProfile(trad_401k_pct=Decimal("0"), **POLICY), {}, "none"))[LIMIT_415C_TOTAL]
    assert row.label == "415(c) total additions (incl. employer match)"
    assert row.employer_match is None

def test_every_row_carries_the_default_measure_and_no_espp_extras():
    for item in paycheck_pace(FakeProfile(espp_pct=Decimal("0.11")), {}, "none"):
        assert item.measure == "annualized"
        assert item.soft_limit is None and item.soft_ratio is None
        assert item.halves is None and item.window_label is None
        assert item.current_rate is None
```

- [ ] **2 Fail:** `pytest tests/test_limit_check.py -q` → `ImportError: cannot import name 'employer_match'`.
- [ ] **3 Widen the row and add the formula** — in `app/services/limit_check.py` add `from datetime import date` to the imports and, after `TOTAL_ADDITIONS_CAVEAT`, `TOTAL_ADDITIONS_MATCH = " (incl. employer match)"` (comment: its opposite, once a policy IS on the profile — the caveat rides the LABEL either way, so it can never be separated from the meter). Above `class PaceItem`:

```python
@dataclass(frozen=True)
class PaceHalf:
    """One purchase-year contribution window on the ESPP row (2026-09-06 spec §1.6).

    `source` is 'entered' (the stored period's own contribution, for a purchase that has
    already happened) or 'estimated'; `basis` names how an estimate was built — 'paydays' for
    a semi-monthly profile, 'months' for the per-month approximation — and is None on an
    entered half, which was never estimated at all."""

    label: str
    start: date
    end: date
    amount: Decimal
    source: str
    basis: str | None
```

In `PaceItem`, after `tone: str`:

```python
    # Everything below is null on every row but the one that needs it, so ONE wire shape
    # serves four different meters (spec §1.6 / §2.3).
    measure: str = "annualized"  # 'annualized' | 'window' (ESPP: the purchase-year window)
    soft_limit: Decimal | None = None  # ESPP: limit x (1 - discount), the practical cap
    soft_ratio: Decimal | None = None  # ESPP: annualized / soft_limit — the tone is judged here
    window_label: str | None = None
    halves: list[PaceHalf] | None = None
    backfilled_from: date | None = None
    projected_full_year: Decimal | None = None
    projected_excess: Decimal | None = None
    current_rate: Decimal | None = None  # ESPP: the espp_pct the projection used (9 dp fraction)
    employer_match: Decimal | None = None  # 415(c) only, and only when it is > 0
```

Give `_item` a keyword parameter `employer_match: Decimal | None = None`, passed to both `PaceItem(...)` constructions inside it. Add above `paycheck_pace`:

```python
def employer_match(profile, elective_annual: Decimal, limit: Decimal | None) -> Decimal:
    """The employer 401(k) match a profile's policy earns on a year of deferrals.

    `elective_annual` is traditional + Roth; after-tax contributions are never matched. The
    cap exists because payroll STOPS deferrals at the 402(g) limit and the match follows
    actual contributions — None when no limit is on file, which measures the uncapped rate,
    the honest "at this rate" answer. Full precision: the caller owns the rounding.
    """
    capped = elective_annual if limit is None else min(elective_annual, limit)
    first = min(capped, profile.match_band_1)
    second = min(max(capped - profile.match_band_1, ZERO), profile.match_band_2)
    return profile.match_rate_1 * first + profile.match_rate_2 * second
```

Replace `paycheck_pace`'s first statements — `salary = …` through the 415(c) `_item(...)` and its closing `),` — with:

```python
    salary = profile.annual_salary
    elective_pct = profile.trad_401k_pct + profile.roth_401k_pct
    elective = elective_pct * salary
    # The 415(c) leg uses the CAPPED elective, because that is what actually lands in the
    # plan; the elective row above keeps the uncapped pace, because going over IS its news.
    elective_cap = limits.get(LIMIT_401K_ELECTIVE)
    capped_elective = elective if elective_cap is None else min(elective, elective_cap)
    # Quantized BEFORE it joins the sum, so the "incl. {employer_match} match" suffix is
    # exactly the addend behind the total and the two can never disagree by a cent.
    match = half_up2(employer_match(profile, elective, elective_cap))
    has_policy = profile.match_band_1 > ZERO or profile.match_band_2 > ZERO
    items = [
        _item(LIMIT_401K_ELECTIVE, LIMIT_LABELS[LIMIT_401K_ELECTIVE], elective, limits),
        _item(LIMIT_415C_TOTAL,
              LIMIT_LABELS[LIMIT_415C_TOTAL]
              + (TOTAL_ADDITIONS_MATCH if has_policy else TOTAL_ADDITIONS_CAVEAT),
              capped_elective + profile.after_tax_401k_pct * salary + match, limits,
              # Null unless there is something to say: a policy that earns nothing this year
              # renames the row (it exists) and shows no figure (it paid nothing).
              employer_match=match if match > ZERO else None),
    ]
```

- [ ] **4 Mirror it on the wire** — in `app/schemas/paycheck.py`, above `class PaceItemOut` add a `PaceHalfOut(BaseModel)` with `model_config = ConfigDict(from_attributes=True)`, the docstring "One purchase-year window on the ESPP row (2026-09-06 spec §1.6).", and fields `label: str`, `start: date`, `end: date`, `amount: Decimal`, `source: str  # 'entered' | 'estimated'`, `basis: str | None  # 'paydays' | 'months'; null on an entered half`. Then add the same ten fields to `PaceItemOut` after `tone: str`, in the same order and with the same types as on `PaceItem` but **without defaults** (`measure: str`, `soft_limit: Decimal | None`, `soft_ratio: Decimal | None`, `window_label: str | None`, `halves: list[PaceHalfOut] | None`, `backfilled_from: date | None`, `projected_full_year: Decimal | None`, `projected_excess: Decimal | None`, `current_rate: Decimal | None`, `employer_match: Decimal | None`), carrying the same four comments: `measure` says what `annualized` holds; `soft_limit`/`soft_ratio` are the practical cap and the ratio the tone is judged on; `current_rate` is the ESPP percentage the projection used, so the note line can print "At your current 12%" without re-deriving it; `employer_match` is 415(c) only and only when > 0.

- [ ] **5 Pass:** `pytest tests/test_limit_check.py tests/test_paycheck_comp_api.py tests/test_paycheck_preview_api.py -q`
- [ ] **6 Commit:** `git add -A backend && git commit -m "feat(paycheck): the 415(c) row counts the employer match"`

---

### Task 4: `BreakdownOut.employer_match`

**Files:** `app/schemas/paycheck.py:107-131` · `app/api/paycheck.py:547-568` · Test `tests/test_paycheck_comp_api.py`

- [ ] **1 Write the failing test** — append to `tests/test_paycheck_comp_api.py`:

```python
async def test_breakdown_reports_the_employer_match_per_check(auth_client, db, me):
    from app.models import ContributionLimit

    db.add(ContributionLimit(year=date.today().year, key="limit_401k_elective",
                             value=D("24500.00")))
    await db.commit()
    await auth_client.post(PROFILES, json={
        "effective_date": "2026-05-01", "annual_salary": "188930",
        "pay_periods_per_year": 24, "trad_401k_pct": "0.13", **MATCH})
    # 11,500 a year over 24 checks. Not a waterfall line: it never touches this pay.
    assert (await auth_client.get(BREAKDOWN)).json()["employer_match"] == "479.17"

async def test_breakdown_employer_match_is_zero_without_a_policy(auth_client, me):
    await auth_client.post(PROFILES, json={
        "effective_date": "2026-06-01", "annual_salary": "100000", "trad_401k_pct": "0.1"})
    assert (await auth_client.get(BREAKDOWN)).json()["employer_match"] == "0.00"
```

- [ ] **2 Fail:** `pytest tests/test_paycheck_comp_api.py -q -k employer_match` → `KeyError: 'employer_match'`.
- [ ] **3 Add the field** — in `app/schemas/paycheck.py`, in `BreakdownOut` above `warnings: list[str]`, `employer_match: Decimal` (comment: the employer's 401(k) match for ONE check — never a waterfall line, because it is not part of this pay; the page prints it as a muted note under the waterfall, spec §2.3).
- [ ] **4 Compute it** — in `app/api/paycheck.py` add `LIMIT_401K_ELECTIVE` to the `app.limit_keys` import and `employer_match` to the `app.services.limit_check` import; replace `get_breakdown`'s `return BreakdownOut(...)` with:

```python
    # Per check from the ANNUAL policy, not the other way round: the bands are annual
    # dollars, so the year is the only place the tiers can be applied honestly.
    elective_annual = (profile.trad_401k_pct + profile.roth_401k_pct) * profile.annual_salary
    match_per_check = half_up2(
        employer_match(profile, elective_annual, limits.get(LIMIT_401K_ELECTIVE))
        / Decimal(profile.pay_periods_per_year))
    await _mark_in_force(db, [profile], today)
    return BreakdownOut(profile=ProfileOut.model_validate(profile), warnings=warnings, pace=pace,
                        employer_match=match_per_check, **lines)
```

- [ ] **5 Pass:** `pytest tests/test_paycheck_comp_api.py -q`
- [ ] **6 Commit:** `git add -A backend && git commit -m "feat(paycheck): the breakdown reports the employer match per check"`

---

### Task 5: `espp_discount_pct` and the partial settings PUT

**Files:** `app/schemas/app_settings.py` · `app/api/app_settings.py:43-68,128-180` · `app/seed.py:64-68` · Test `tests/test_app_settings_api.py`

- [ ] **1 Write the failing tests** — in `tests/test_app_settings_api.py` add `"espp_discount_pct": "0.15",` to the expected dicts in `test_get_returns_effective_defaults_on_an_empty_table` and `test_put_round_trips_and_stores_the_envelope` (a PUT of `VALID_BODY` never writes the discount, so both read the un-stored default). Then append:

```python
@pytest.mark.parametrize("bad", [{"value": "garbage"}, {"value": "0.9"}, {"value": True}, "0.1"])
async def test_discount_reader_degrades_to_the_423_maximum(auth_client, db, bad):
    db.add(AppSetting(key="espp_discount_pct", value=bad))
    await db.commit()
    assert (await auth_client.get(SETTINGS)).json()["espp_discount_pct"] == "0.15"

async def test_put_stores_the_discount_as_a_plain_string(auth_client, db):
    r = await auth_client.put(SETTINGS, json={"espp_discount_pct": "0.10"})
    assert r.status_code == 200, r.text
    assert r.json()["espp_discount_pct"] == "0.100000"
    assert (await db.get(AppSetting, "espp_discount_pct")).value == {"value": "0.100000"}

@pytest.mark.parametrize("bad", ["0.2", "-0.01", "15"])
async def test_put_refuses_a_discount_outside_the_423_range(auth_client, bad):
    r = await auth_client.put(SETTINGS, json={"espp_discount_pct": bad})
    assert r.status_code == 422
    assert r.json()["detail"] == "espp_discount_pct must be between 0 and 0.15 (the §423 maximum)"

async def test_put_is_partial_and_leaves_absent_fields_alone(auth_client):
    await auth_client.put(SETTINGS, json=VALID_BODY)
    # One card, one field: saving the discount must not reset the ticker or the cron.
    body = (await auth_client.put(SETTINGS, json={"espp_discount_pct": "0.05"})).json()
    assert body["espp_discount_pct"] == "0.050000"
    assert body["espp_ticker"] == "NVDA"
    assert body["price_refresh_cron"] == "10 13 * * mon-fri"
    assert body["swr_pct"] == "0.045000"
    before = (await auth_client.get(SETTINGS)).json()
    assert (await auth_client.put(SETTINGS, json={})).json() == before  # an empty PUT is a no-op

async def test_partial_put_does_not_reschedule_when_the_cron_is_absent(auth_client, monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr("app.api.app_settings.reschedule_price_refresh",
                        lambda cron: calls.append(cron) or True)
    assert (await auth_client.put(SETTINGS, json={"swr_pct": "0.05"})).status_code == 200
    assert calls == []  # nothing to hot-apply, so the live job is left alone
```

- [ ] **2 Fail:** `pytest tests/test_app_settings_api.py -q` → `KeyError: 'espp_discount_pct'`.
- [ ] **3 Schemas** — in `app/schemas/app_settings.py` add `espp_discount_pct: Decimal` to `AppSettingsOut` after `espp_ticker` (comment: the plan's ESPP discount as a FRACTION, 0.15 = 15 % off; plan-wide, not per offering — spec §1.5), and replace `AppSettingsUpdate` entirely:

```python
class AppSettingsUpdate(BaseModel):
    """PARTIAL PUT (2026-09-06 spec §3.5): several Settings cards write this one endpoint,
    and a card that does not show a field must not be able to reset it. ABSENT keeps the
    stored value; PRESENT is validated and written — which is why `espp_ticker: null` still
    CLEARS the ticker, the one field whose empty value is a real user intention."""

    swr_pct: Decimal | None = None
    espp_ticker: str | None = None
    espp_discount_pct: Decimal | None = None
    price_refresh_cron: str | None = None
    calendar_update_due_day: int | None = None
```

- [ ] **4 Reader, validator, partial writer** — in `app/api/app_settings.py`, after `_read_espp_ticker`:

```python
# The §423 statutory maximum discount, and the plan the app was built against.
DEFAULT_ESPP_DISCOUNT = Decimal("0.15")
MAX_ESPP_DISCOUNT = Decimal("0.15")
ESPP_DISCOUNT_MESSAGE = "espp_discount_pct must be between 0 and 0.15 (the §423 maximum)"

def _validated_discount(value: Decimal) -> Decimal:
    # What the reader discards, the writer refuses (_validated_swr's rule). `+ ZERO` is the
    # house signed-zero collapse: "-0" clears `< 0` and would store as "-0.000000".
    if not value.is_finite() or value < 0 or value > MAX_ESPP_DISCOUNT:
        raise HTTPException(status_code=422, detail=ESPP_DISCOUNT_MESSAGE)
    return quantize_pct(value) + ZERO
```

and `read_espp_discount`, which is `net_worth_calc.get_swr_pct` copied line for line with four substitutions — key `"espp_discount_pct"`, fallback `DEFAULT_ESPP_DISCOUNT`, the final bound `parsed > MAX_ESPP_DISCOUNT` in place of `parsed > 1`, and this docstring:

```python
async def read_espp_discount(db: AsyncSession) -> Decimal:
    """app_settings['espp_discount_pct'] envelope {"value": "0.15"}; any unexpected shape
    falls back to the §423 maximum (get_swr_pct's posture, bounds included). Imported by
    api/espp.py, api/paycheck.py and api/taxes.py — every figure the discount prices reads
    it here, so there is exactly one place a plan-wide rate can come from."""
```

Add `espp_discount_pct=await read_espp_discount(db),` to `get_settings`'s `AppSettingsOut(...)`, then replace the whole body of `put_settings` with:

```python
    """PARTIAL by field (2026-09-06 spec §3.5): `model_dump(exclude_unset=True)` is the house
    PATCH convention, so an absent key keeps the stored value while an explicit null is the
    writing card's own intention — which is what still lets a card clear the ticker.
    Validation, and the cron's hot-apply, run only on PRESENT fields."""
    provided = body.model_dump(exclude_unset=True)
    updates: dict[str, dict] = {}
    if "swr_pct" in provided and body.swr_pct is not None:
        updates["swr_pct"] = {"value": format(_validated_swr(body.swr_pct), "f")}
    if "espp_ticker" in provided:
        # The one field whose null MEANS something: an empty ticker is "unconfigured".
        ticker = ("" if body.espp_ticker is None or not body.espp_ticker.strip()
                  else _normalize_ticker(body.espp_ticker))
        updates["espp_ticker"] = {"value": ticker}
    if "espp_discount_pct" in provided and body.espp_discount_pct is not None:
        updates["espp_discount_pct"] = {
            "value": format(_validated_discount(body.espp_discount_pct), "f")}
    if "price_refresh_cron" in provided and body.price_refresh_cron is not None:
        updates["price_refresh_cron"] = {"value": _validated_cron(body.price_refresh_cron)}
    if "calendar_update_due_day" in provided and body.calendar_update_due_day is not None:
        updates["calendar_update_due_day"] = {
            "value": _validated_due_day(body.calendar_update_due_day)}
    # Every raise is behind us — write only now, so a 422 on the third field cannot leave the
    # first two committed. Envelope {"value": ...} is the readers' convention, and a Decimal
    # stores as a plain-notation STRING so the reader re-reads it losslessly.
    for key, value in updates.items():
        setting = await db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=value))
        else:
            setting.value = value
    await db.commit()
    # AFTER the commit, and ONLY when the cron was actually written: the stored value is what
    # a crashed reschedule (or a scheduler-less process) falls back to at the next boot.
    if "price_refresh_cron" in updates:
        reschedule_price_refresh(updates["price_refresh_cron"]["value"])
    # One answer, one code path: the response is the GET's effective read, so a partial save
    # can never echo a field it did not write.
    return await get_settings(db)
```

- [ ] **5 Seed the default** — in `app/seed.py`'s `DEFAULT_SETTINGS`, after `espp_ticker`: `    "espp_discount_pct": {"value": "0.15"},  # the §423 maximum, and NVIDIA's plan`
- [ ] **6 Pass:** `pytest tests/test_app_settings_api.py tests/test_seed.py tests/test_household_api.py -q`
- [ ] **7 Commit:** `git add -A backend && git commit -m "feat(settings): the ESPP discount is a setting and the PUT is partial"`

---

### Task 6: Every discount consumer reads the setting

**Files:** `app/services/espp_calc.py:30,249-275` · `app/services/tax_whatif.py:27-28,118-120` · `app/api/espp.py:45,165-193,268-316,512-640` · `app/api/taxes.py:1480-1504` · `app/schemas/espp.py:177-198` · Tests `tests/test_espp_calc.py`, `tests/test_espp_api.py`, `tests/test_tax_whatif.py`

- [ ] **1 Write the failing tests** — in `tests/test_espp_calc.py` change the import to `run_modeler as _run_modeler` and add below the imports:

```python
DISCOUNT = D("0.15")

def run_modeler(rows, **kwargs):
    """Every golden in this file is the 15 % plan, so the discount is passed from ONE place;
    the parametrised test below hands its own in."""
    kwargs.setdefault("discount", DISCOUNT)
    return _run_modeler(rows, **kwargs)

def test_purchase_price_follows_the_plan_discount():
    row = REAL_PERIODS[0]
    ten = run_modeler([row], purchase_fmv=FMV, carry_forward=D("0.00"), discount=D("0.10"))
    fifteen = run_modeler([row], purchase_fmv=FMV, carry_forward=D("0.00"))
    lower = min(row.subscription_price, FMV)
    # CEIL2((1 - discount) x min(sub, fmv)) — the sheet's ROUNDUP, at the plan's own rate.
    assert ten.periods[0].purchase_price == ceil2(D("0.90") * lower)
    assert fifteen.periods[0].purchase_price == ceil2(D("0.85") * lower)
    assert ten.periods[0].purchase_price > fifteen.periods[0].purchase_price
```

In `tests/test_espp_api.py`:

```python
async def test_espp_prices_follow_the_discount_setting(auth_client, db):
    from app.models import AppSetting

    db.add(AppSetting(key="espp_discount_pct", value={"value": "0.10"}))
    await db.commit()
    created = await create_lot(auth_client)  # lot_payload's defaults: sub 48.509, fmv 79.112
    assert created["purchase_price"] == "43.65810"  # 0.90 x 48.509, 5 dp, no ceil
    body = (await auth_client.get(MODELER, params={
        "subscription_price": "170.79", "purchase_fmv": "171", "year": "2026"})).json()
    assert body["discount_pct"] == "0.100000"
    assert body["periods"][0]["purchase_price"] == "153.72"  # CEIL2(0.90 x 170.79)
```

In `tests/test_tax_whatif.py`:

```python
def test_qualified_ordinary_cap_follows_the_plan_discount():
    from app.services.tax_whatif import qualified_discount_ratio

    # subscription = (1 - d) x the lookback FMV, so d of the grant FMV is sub x d/(1 - d).
    assert qualified_discount_ratio(Decimal("0.15")) == Decimal(15) / Decimal(85)
    assert qualified_discount_ratio(Decimal("0.10")) == Decimal(10) / Decimal(90)
```

- [ ] **2 Fail:** `pytest tests/test_espp_calc.py tests/test_espp_api.py tests/test_tax_whatif.py -q` → `TypeError: run_modeler() got an unexpected keyword argument 'discount'`.
- [ ] **3 `espp_calc`** — delete `DISCOUNT = Decimal("0.85")`, add `ONE = Decimal("1")` beside `ZERO`, add `discount: Decimal,` as `run_modeler`'s fourth parameter (after `carry_forward`), note it in the docstring (`` `discount` is the plan's fraction — 0.15 = 15 % off — and is the caller's to supply ``), and replace the `purchase_price = ...` line with `purchase_price = ceil2((ONE - discount) * min(row.subscription_price, purchase_fmv))`, rewording its "0.85 x min(sub, fmv), rounded UP to a cent (r18)" comment to "(1 - discount) x …, at the plan's own rate (spec §1.5) — the old module constant is gone, so no caller can price a purchase at a discount nobody stored".
- [ ] **4 `tax_whatif`** — replace `QUALIFIED_DISCOUNT_RATIO = Decimal(15) / Decimal(85)` with:

```python
def qualified_discount_ratio(discount: Decimal) -> Decimal:
    """subscription = (1 - d) x the lookback FMV, so d of the grant FMV is sub x d/(1 - d).
    `discount` is bounded to [0, 0.15] by the setting's writer AND its reader, so the
    denominator can never reach zero."""
    return discount / (Decimal("1") - discount)
```

Add `discount: Decimal,` to `decompose_espp`'s keyword-only parameters and use `qualified_discount_ratio(discount)` in place of the constant in its `cap = (...)` expression.

- [ ] **5 Routers** — `app/api/espp.py`: drop `DISCOUNT,` from the `espp_calc` import, add `from app.api.app_settings import read_espp_discount`. Give `_validated_lot` a final `discount: Decimal,` parameter and replace its default-price line with `price = _quantize5((Decimal("1") - discount) * min(subscription, fmv), "purchase_price")`, rewording the existing "0.85 x the lower price … with NO ceil" comment to "(1 - discount) x the lower price". Pass `discount=await read_espp_discount(db),` at both `_validated_lot(...)` call sites (`create_lot`, `update_lot`). In `modeler`, add `discount = await read_espp_discount(db)` beside `today = date.today()`, pass `discount=discount` to `run_modeler(...)`, and add `discount_pct=discount,` to the `ModelerOut(...)`.
  `app/schemas/espp.py` — in `ModelerOut` after `carry_forward: Decimal`, `discount_pct: Decimal` (comment: the plan discount these purchase prices were computed with, spec §1.5, so the page prints the figure it was priced with instead of a hardcoded 15 %).
  `app/api/taxes.py` — add `from app.api.app_settings import read_espp_discount`, hoist `espp_discount = await read_espp_discount(db)` above the loop that builds `espp_details` (one read per request), and pass `discount=espp_discount,` to `decompose_espp(...)`.
- [ ] **6 Pass:** `pytest tests/test_espp_calc.py tests/test_espp_api.py tests/test_tax_whatif.py tests/test_taxes_api.py tests/calendar -q`
- [ ] **7 Commit:** `git add -A backend && git commit -m "feat(espp): every price reads the plan discount from the setting"`

---

### Task 7: `services/espp_pace.py` — the purchase-year window

**Files:** Create `app/services/espp_pace.py` · Test `tests/test_espp_pace.py` (new)

- [ ] **1 Write the failing tests** — create `tests/test_espp_pace.py`:

```python
"""The ESPP pace row's purchase-year windows (2026-09-06 spec §1).

Pure module, so no database: plain objects stand in for the profile rows. The golden is
production's own timeline — 11 % until 2026-08-17 then 12 % on 188,930 over 24 checks, no
stored periods, today 2026-09-06 — and each half is twelve semi-monthly paydays priced by
whichever profile was in force on each. H1's twelve are all at 11 %; H2's are all at 11 %
except Aug 31, the first payday on or after the raise.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.espp_calc import StoredPeriod, plan_year_rows
from app.services.espp_pace import espp_pace_item

D = Decimal
DISCOUNT = D("0.15")
LIMIT = D("25000.00")
TODAY = date(2026, 9, 6)

@dataclass
class FakeProfile:
    effective_date: date
    annual_salary: Decimal = D("188930.00")
    pay_periods_per_year: int = 24
    espp_pct: Decimal = D("0.110000000")

EDWARD = [FakeProfile(effective_date=date(2026, 1, 1)),
          FakeProfile(effective_date=date(2026, 8, 17), espp_pct=D("0.120000000"))]

def rows_for(year: int, stored: list | None = None):
    plans, _warnings = plan_year_rows(year, stored or [], [], None, None)
    return plans

def item(**kwargs):
    args = {"rows": rows_for(2026), "profiles": EDWARD, "scenario_from_today": EDWARD[-1],
            "limit": LIMIT, "discount": DISCOUNT, "today": TODAY}
    return espp_pace_item(**{**args, **kwargs})

def test_the_windows_are_the_purchase_years_two_halves():
    halves = item().halves
    assert [h.label for h in halves] == ["Sep 2025–Feb 2026", "Mar–Aug 2026"]
    assert (halves[0].start, halves[0].end) == (date(2025, 9, 1), date(2026, 2, 27))
    assert (halves[1].start, halves[1].end) == (date(2026, 3, 1), date(2026, 8, 31))
    only = FakeProfile(effective_date=date(2020, 1, 1))
    leap = espp_pace_item(rows=rows_for(2024), profiles=[only], scenario_from_today=only,
                          limit=LIMIT, discount=DISCOUNT, today=date(2024, 9, 6)).halves
    assert leap[0].end == date(2024, 2, 29)  # a Thursday: the last weekday of the month

def test_the_golden_window_and_verdict():
    row = item()
    assert row.key == "limit_espp_423"
    assert row.measure == "window"
    assert row.window_label == "Sep 2025 – Aug 2026 purchases"
    assert [h.amount for h in row.halves] == [D("10391.15"), D("10469.87")]
    assert [h.source for h in row.halves] == ["estimated", "estimated"]
    assert [h.basis for h in row.halves] == ["paydays", "paydays"]
    assert row.annualized == D("20861.02")
    assert (row.limit, row.ratio) == (LIMIT, D("0.8344"))
    assert row.soft_limit == D("21250.00")  # 25,000 x (1 - 0.15)
    assert row.soft_ratio == D("0.9817")
    # Judged on soft_ratio, so the verdict agrees with the tick even though the HARD ratio
    # is a comfortable 0.83.
    assert row.tone == "warn"
    assert row.projected_full_year == D("22671.60")
    assert row.projected_excess == D("1421.60")
    assert row.current_rate == D("0.120000000")  # the scenario's rate, so the note can say "12%"
    assert row.backfilled_from is None

def test_a_stored_half_wins_only_once_its_purchase_has_happened():
    stored = [StoredPeriod(id=1, label="Sep 2025–Feb 2026", period_start=date(2025, 9, 1),
                           period_end=date(2026, 2, 27), semi_annual_base=D("90000.00"),
                           additional_payments=D("0.00"), contribution_pct=D("0.100000000"))]
    past = item(rows=rows_for(2026, stored)).halves[0]
    assert past.source == "entered"
    assert past.amount == D("9000.00")  # the number the user typed, not an estimate
    assert past.basis is None
    # The SAME row read before its purchase date is still an estimate: nothing was bought.
    assert item(rows=rows_for(2026, stored),
                today=date(2026, 1, 5)).halves[0].source == "estimated"

def test_paydays_before_the_earliest_profile_borrow_it_and_say_so():
    row = item(profiles=EDWARD[1:], scenario_from_today=EDWARD[1])
    assert row.backfilled_from == date(2026, 8, 17)
    assert row.annualized == D("22671.60")  # 24 paydays at 12 % of 188,930 / 24

def test_a_non_semi_monthly_cadence_estimates_by_month():
    biweekly = FakeProfile(effective_date=date(2020, 1, 1), pay_periods_per_year=26,
                           espp_pct=D("0.120000000"))
    row = item(profiles=[biweekly], scenario_from_today=biweekly)
    assert [h.basis for h in row.halves] == ["months", "months"]
    # Six months x 0.12 x 188,930 / 12 = 11,335.80 a half.
    assert [h.amount for h in row.halves] == [D("11335.80"), D("11335.80")]

def test_the_scenario_only_moves_paydays_from_today_onward():
    """The knob answers "if I change NOW, where do this year's purchases land?" — it can
    never rewrite a check that has already been cut."""
    scenario = FakeProfile(effective_date=date(2026, 8, 17), espp_pct=D("0.200000000"))
    row = item(scenario_from_today=scenario, today=date(2026, 6, 1))
    assert row.halves[0].amount == D("10391.15")  # wholly in the past: untouched
    assert row.halves[1].amount > D("10469.87")  # Jun 15 onward at 20 %

def test_a_missing_limit_is_a_call_to_action_with_no_meter():
    row = item(limit=None)
    assert (row.limit, row.ratio, row.soft_limit, row.soft_ratio) == (None, None, None, None)
    assert row.projected_excess is None
    assert row.tone == "ok"
    assert row.annualized == D("20861.02")  # the window is still true without a cap

def test_row_visibility_follows_the_window_and_the_current_rate():
    zero = FakeProfile(effective_date=date(2020, 1, 1), espp_pct=D("0"))
    assert item(profiles=[zero], scenario_from_today=zero) is None
    # A zero window plus a live rate IS the news: the first purchase is still ahead.
    now = FakeProfile(effective_date=TODAY, espp_pct=D("0.100000000"))
    row = item(profiles=[zero, now], scenario_from_today=now)
    assert row is not None
    assert row.annualized == D("0.00")
    assert row.projected_full_year == D("18893.00")
```

- [ ] **2 Fail:** `pytest tests/test_espp_pace.py -q` → `ModuleNotFoundError: No module named 'app.services.espp_pace'`.
- [ ] **3 Write the module** — create `app/services/espp_pace.py`:

```python
"""The ESPP pace row: the PURCHASE year's two contribution windows (2026-09-06 spec §1).

Pure module — no DB, no HTTP, no clock (limit_check's posture). The caller hands over the
year's two `plan_year_rows` rows, the person's whole profile timeline, the scenario profile
that speaks for TODAY ONWARD, the entered §423 cap, the plan discount and `today`.

A window, not an annualization: 26 CFR 1.423-2(i) accrues the right to buy on each PURCHASE
date, so Sep–Dec checks fund next February's purchase and belong to NEXT year's cap.
A soft cap, because contribution dollars can never use the whole 25,000 — at most
`limit x (1 - discount)` of them ever buy stock, and the TONE is judged there so the verdict
can never disagree with the tick beside it. And every figure is a STATED ESTIMATE, never a
ledger (spec §5): the app has no per-paycheck history, so a past payday is priced from the
profile in force on it and paydays before the person's earliest profile borrow that earliest
profile — `backfilled_from` says so out loud.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.limit_keys import LIMIT_ESPP_423, LIMIT_LABELS
from app.services.business_days import semi_monthly_paydays
from app.services.limit_check import OVER_ABOVE, RATIO_QUANTUM, WARN_AT, PaceHalf, PaceItem
from app.services.paycheck_calc import MONTHS_PER_YEAR, half_up2

ZERO = Decimal("0")
ONE = Decimal("1")
# The only cadence `semi_monthly_paydays` describes; anything else takes the month basis.
SEMI_MONTHLY = 24
MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

def _stamp(day: date) -> str:
    """"Sep 2025" — spelled here rather than through strftime, whose month names follow the
    process locale and would make the label untestable on another machine."""
    return f"{MONTH_NAMES[day.month - 1]} {day.year}"

def _months(start: date, end: date):
    """Every (year, month) from `start`'s month through `end`'s, inclusive."""
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)

def _in_force(profiles: list, day: date):
    """The latest profile effective on or before `day` — `_default_profile`'s rule without
    the DB. Before the earliest profile there is nothing to read, so the earliest one stands
    in: the strip's "at this rate" posture, applied backwards."""
    eligible = [p for p in profiles if p.effective_date <= day]
    if eligible:
        return max(eligible, key=lambda p: p.effective_date)
    return min(profiles, key=lambda p: p.effective_date)

def _estimate(profiles: list, scenario, today: date, start: date,
              end: date) -> tuple[Decimal, str, date | None]:
    """One window's (amount, basis, backfilled_from), payday by payday.

    A semi-monthly month contributes its two real paydays (the 15th and the month end, each
    pulled BACK over weekends and holidays — payroll's own convention), priced by the profile
    in force on THAT day. Any other cadence has no payday calendar in this app, so the month
    contributes one twelfth of the annual rate instead and the row says "estimated by month";
    a window that mixes the two reports the coarser word. Paydays on or after `today` are
    priced by the SCENARIO — the in-force profile for the GET, the sandbox's knobs for the
    preview — so the row answers "if I change now, where do this year's purchases land?",
    never "what if I had changed in March"."""
    earliest = min(p.effective_date for p in profiles)
    amount = ZERO
    by_month = False
    backfilled: date | None = None

    def source(day: date):
        nonlocal backfilled
        if day >= today:
            return scenario
        if day < earliest:
            backfilled = earliest
        return _in_force(profiles, day)

    for year, month in _months(start, end):
        mid = date(year, month, 15)
        # Clamped so a window that opens after the 15th still probes a date inside it.
        monthly = source(min(max(mid, start), end))
        if monthly.pay_periods_per_year == SEMI_MONTHLY:
            for day in semi_monthly_paydays(year, month):
                if start <= day <= end:
                    payer = source(day)
                    amount += payer.espp_pct * (
                        payer.annual_salary / Decimal(payer.pay_periods_per_year))
        else:
            by_month = True
            if start <= mid <= end:
                amount += monthly.espp_pct * (monthly.annual_salary / MONTHS_PER_YEAR)
    return half_up2(amount), ("months" if by_month else "paydays"), backfilled

def espp_pace_item(*, rows: list, profiles: list, scenario_from_today, limit: Decimal | None,
                   discount: Decimal, today: date) -> PaceItem | None:
    """The ESPP row for the purchase year `rows` describes, or None when there is no row.

    `rows` is `plan_year_rows(Y, stored, [], None, None)` — the calendar generator's own call,
    so the strip and the calendar can never disagree about which halves exist. None comes back
    when the whole window AND the current rate are zero: a 0-of-25,000 meter is noise, which
    is today's "not enrolled" rule widened from the rate to the window."""
    if not rows or not profiles:
        return None
    halves: list[PaceHalf] = []
    backfilled_from: date | None = None
    for row in rows:
        if row.stored and row.period_end < today:
            # The purchase happened and the user typed the contribution: their number wins
            # over any estimate this module could build (spec §1.3).
            halves.append(PaceHalf(
                label=row.label, start=row.period_start, end=row.period_end,
                amount=half_up2(
                    (row.semi_annual_base + row.additional_payments) * row.contribution_pct),
                source="entered", basis=None))
            continue
        amount, basis, backfill = _estimate(
            profiles, scenario_from_today, today, row.period_start, row.period_end)
        if backfill is not None and (backfilled_from is None or backfill < backfilled_from):
            backfilled_from = backfill
        halves.append(PaceHalf(label=row.label, start=row.period_start, end=row.period_end,
                               amount=amount, source="estimated", basis=basis))

    window = half_up2(sum((half.amount for half in halves), ZERO))
    if window <= ZERO and scenario_from_today.espp_pct <= ZERO:
        return None
    projected = half_up2(scenario_from_today.espp_pct * scenario_from_today.annual_salary)
    shared = {
        "key": LIMIT_ESPP_423,
        "label": LIMIT_LABELS[LIMIT_ESPP_423],
        "annualized": window,
        "measure": "window",
        "window_label": f"{_stamp(halves[0].start)} – {_stamp(halves[-1].end)} purchases",
        "halves": halves,
        "backfilled_from": backfilled_from,
        "projected_full_year": projected,
        # The rate behind `projected_full_year`, stated rather than left for the client to
        # re-derive (the strip's own "server figures only" rule).
        "current_rate": scenario_from_today.espp_pct,
    }
    # `half_up2`, not money.py's bounded quantizer — a pure module must never raise an
    # HTTPException, and a GET must never 500 on data that is already stored.
    soft_limit = None if limit is None else half_up2(limit * (ONE - discount))
    if soft_limit is None or soft_limit <= ZERO:
        # No cap entered (or a 100 % discount, which the setting's bounds forbid): the UI
        # renders a call-to-action, never a fabricated meter.
        return PaceItem(limit=None, ratio=None, tone="ok", **shared)
    ratio = (window / limit).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)
    soft_ratio = (window / soft_limit).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)
    if soft_ratio > OVER_ABOVE:
        tone = "over"
    elif soft_ratio >= WARN_AT:
        tone = "warn"
    else:
        tone = "ok"
    return PaceItem(limit=limit, ratio=ratio, tone=tone, soft_limit=soft_limit,
                    soft_ratio=soft_ratio, projected_excess=max(ZERO, projected - soft_limit),
                    **shared)
```

- [ ] **4 Pass:** `pytest tests/test_espp_pace.py -q` (8 tests)
- [ ] **5 Commit:** `git add -A backend && git commit -m "test(espp): a pure purchase-year pace service with a practical cap"`

---

### Task 8: Wire the ESPP row into the breakdown and the preview

**Files:** `app/api/paycheck.py:547-615` · Tests `tests/test_paycheck_comp_api.py`, `tests/test_paycheck_preview_api.py`

- [ ] **1 Write the failing tests** — append to `tests/test_paycheck_comp_api.py`:

```python
async def test_breakdown_espp_row_grades_the_purchase_year(auth_client, db, me):
    from app.models import AppSetting, ContributionLimit

    db.add(ContributionLimit(year=date.today().year, key="limit_espp_423", value=D("25000.00")))
    await db.commit()
    await auth_client.post(PROFILES, json={
        "effective_date": "2020-01-01", "annual_salary": "188930",
        "pay_periods_per_year": 24, "espp_pct": "0.11"})
    rows = {r["key"]: r for r in (await auth_client.get(BREAKDOWN)).json()["pace"]}
    assert rows["limit_espp_423"]["measure"] == "window"
    assert rows["limit_espp_423"]["soft_limit"] == "21250.00"  # 25,000 x (1 - 0.15)
    assert len(rows["limit_espp_423"]["halves"]) == 2
    assert rows["limit_espp_423"]["window_label"].endswith("purchases")
    assert rows["limit_espp_423"]["projected_full_year"] == "20782.30"  # 11 % of 188,930
    assert rows["limit_espp_423"]["current_rate"] == "0.110000000"
    # Every other row keeps the annualized shape and none of the ESPP extras.
    assert rows["limit_401k_elective"]["measure"] == "annualized"
    assert rows["limit_401k_elective"]["soft_limit"] is None
    assert rows["limit_401k_elective"]["halves"] is None

    db.add(AppSetting(key="espp_discount_pct", value={"value": "0.10"}))
    await db.commit()
    again = {r["key"]: r for r in (await auth_client.get(BREAKDOWN)).json()["pace"]}
    assert again["limit_espp_423"]["soft_limit"] == "22500.00"  # 25,000 x (1 - 0.10)
```

and to `tests/test_paycheck_preview_api.py`:

```python
async def test_preview_espp_row_moves_with_the_rate_override(auth_client, db, me):
    db.add(ContributionLimit(year=date.today().year, key="limit_espp_423", value=D("25000.00")))
    await db.commit()
    await auth_client.post(PROFILES, json=profile_payload(effective_date="2020-01-01"))
    body = (await auth_client.post(PREVIEW, json={"overrides": {"espp_pct": "0.2"}})).json()
    before = {row["key"]: row for row in body["pace"]["baseline"]}["limit_espp_423"]
    after = {row["key"]: row for row in body["pace"]["scenario"]}["limit_espp_423"]
    # Only paydays from today onward move, so the window rises without doubling.
    assert D(after["annualized"]) > D(before["annualized"])
    assert after["projected_full_year"] == "37786.00"  # 20 % of 188,930
    assert before["soft_limit"] == after["soft_limit"] == "21250.00"
```

- [ ] **2 Fail:** `pytest tests/test_paycheck_comp_api.py tests/test_paycheck_preview_api.py -q -k espp` → `assert 'annualized' == 'window'`.
- [ ] **3 Assemble the row** — in `app/api/paycheck.py` add the imports `from app.api.app_settings import read_espp_discount`, `LIMIT_ESPP_423` (beside `LIMIT_401K_ELECTIVE`), `EsppPeriod` on the `app.models` import, `from app.services.espp_calc import StoredPeriod, plan_year_rows`, `from app.services.espp_pace import espp_pace_item`, and `PaceItem` on the `limit_check` import. Add above `get_breakdown`:

```python
async def _espp_pace_rows(db: AsyncSession, profile, person_id: int, scenario,
                          limits: dict[str, Decimal], today: date) -> list[PaceItem]:
    """`paycheck_pace`'s rows with the ESPP one replaced by the PURCHASE-year row (§1.6).

    The windows are planned exactly as the calendar generator plans them —
    `plan_year_rows(Y, stored, [], None, None)`, pricing inputs deliberately empty — so the
    strip and the calendar can never disagree about which halves exist. `person_id` is a
    parameter because a `ScenarioProfile` has no owner. SELECTs only: this runs inside the
    preview, which writes nothing (tests/test_sandbox_purity.py)."""
    items = paycheck_pace(profile, limits, profile.hsa_coverage)
    stored = list((await db.execute(
        select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))).scalars())
    rows, _warnings = plan_year_rows(
        today.year,
        [StoredPeriod(id=row.id, label=row.label, period_start=row.period_start,
                      period_end=row.period_end, semi_annual_base=row.semi_annual_base,
                      additional_payments=row.additional_payments,
                      contribution_pct=row.contribution_pct) for row in stored],
        [], None, None)
    profiles = list((await db.execute(
        select(PaycheckProfile).where(PaycheckProfile.person_id == person_id)
        .order_by(PaycheckProfile.effective_date))).scalars())
    espp = espp_pace_item(rows=rows, profiles=profiles, scenario_from_today=scenario,
                          limit=limits.get(LIMIT_ESPP_423),
                          discount=await read_espp_discount(db), today=today)
    # limit_check already emits ESPP last, so appending keeps the display order intact.
    kept = [item for item in items if item.key != LIMIT_ESPP_423]
    return kept if espp is None else [*kept, espp]
```

In `get_breakdown` replace the `pace = [...]` comprehension, and in `preview` the `PreviewPace(...)` construction, with:

```python
    pace = [PaceItemOut.model_validate(item) for item in await _espp_pace_rows(
        db, profile, profile.person_id, profile, limits, today)]
```
```python
    pace = PreviewPace(
        baseline=[PaceItemOut.model_validate(item) for item in await _espp_pace_rows(
            db, base, base.person_id, base, limits, today)],
        scenario=[PaceItemOut.model_validate(item) for item in await _espp_pace_rows(
            db, scenario, base.person_id, scenario, limits, today)])
```

- [ ] **4 Pass:** `pytest tests/test_paycheck_comp_api.py tests/test_paycheck_preview_api.py tests/test_sandbox_purity.py tests/test_limits_api.py -q`. The parity pins at `tests/test_paycheck_preview_api.py:102-103,142` must still hold — the preview's baseline is the GET's rows from the same call.
- [ ] **5 Commit:** `git add -A backend && git commit -m "feat(paycheck): the pace strip grades the ESPP purchase year"`

---

### Task 9: The projection's employer leg

**Files:** `app/schemas/projection.py:22-43` · `app/api/projection.py:130-158,223-231,305-326` · Test `tests/test_projection_api.py`

- [ ] **1 Write the failing tests** — in `tests/test_projection_api.py` add `"employer": "0.00",` to the `contribution_breakdown ==` dict in `test_projection_derived_contribution_adds_payroll_savings` and `"employer_monthly": "0.00",` to its `by_person` row; then append:

```python
MATCHED_PROFILE = {
    "trad_401k_pct": Decimal("0.10"),
    "match_rate_1": Decimal("1"), "match_band_1": Decimal("1200.00"),
    "match_rate_2": Decimal("0.5"), "match_band_2": Decimal("1200.00")}

async def test_projection_adds_the_employer_match_as_its_own_leg(auth_client, db):
    await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **MATCHED_PROFILE)
    body = (await auth_client.get("/api/v1/projection")).json()
    # 24,000 salary, 10 % elective = 2,400 a year: 100 % of the first 1,200 + 50 % of the
    # next 1,200 = 1,800 a year = 150.00 a month, and it is the EMPLOYER's money.
    breakdown = body["contribution_breakdown"]
    assert breakdown["payroll"] == "200.00"
    assert breakdown["employer"] == "150.00"
    assert breakdown["total"] == "4350.00"
    assert breakdown["by_person"][0]["employer_monthly"] == "150.00"
    assert body["monthly_contribution"] == "4350.00"

async def test_projection_retirement_also_drops_the_employer_match(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **MATCHED_PROFILE)
    body = (await auth_client.get(
        "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
        f"&retire={alex.id}:{_month_param(month_add(this_month, 6))}")).json()
    # Both sides stay symmetric: the leg the profile added is the leg retiring removes —
    # take-home 1,800 + payroll 200 + employer 150.
    assert body["retirements"][0]["monthly_drop"] == "2150.00"
```

- [ ] **2 Fail:** `pytest tests/test_projection_api.py -q -k "employer or payroll"` → `KeyError: 'employer'`.
- [ ] **3 Schemas** — in `app/schemas/projection.py` add `employer_monthly: Decimal` to `PayrollSavingOut` after `monthly` (comment: the EMPLOYER's 401(k) match for the same profile, per month — spec §2.3 — a separate leg because it is not the person's own deduction and never touches net pay) and `employer: Decimal` to `ContributionBreakdownOut` after `payroll` (comment: Σ of `by_person`'s `employer_monthly`; kept apart from `payroll` on purpose — the Spending page's savings rate stays employee-only, `services/savings.py` untouched). Update that class's docstring to say `` `payroll` and `employer` are the sums of `by_person`'s two columns. ``
- [ ] **4 Compute the leg** — in `app/api/projection.py` add `_limits_for` to the `app.api.paycheck` import, `from app.limit_keys import LIMIT_401K_ELECTIVE`, `from app.services.limit_check import employer_match`, and `MONTHS_PER_YEAR` to the `paycheck_calc` import. Above `_payroll_savings`:

```python
def employer_monthly(profile, limits: dict[str, Decimal]) -> Decimal:
    """One profile's employer 401(k) match, per month, in cents. The bands are ANNUAL dollars
    of elective deferrals, so the year is the only place the tiers can be applied honestly —
    divide afterwards, never before."""
    elective = (profile.trad_401k_pct + profile.roth_401k_pct) * profile.annual_salary
    return half_up2(
        employer_match(profile, elective, limits.get(LIMIT_401K_ELECTIVE)) / MONTHS_PER_YEAR)
```

Change `_payroll_savings`'s return annotation to `tuple[Decimal, Decimal, list[PayrollSavingOut], list[str]]`, add `employer_total = ZERO` beside `total = ZERO` and `limits = await _limits_for(db, today.year)` above the loop, then replace its `if monthly <= ZERO: continue` line plus the row append and the `return` with:

```python
        employer = employer_monthly(profile, limits)
        if monthly <= ZERO and employer <= ZERO:
            continue
        rows.append(PayrollSavingOut(person_id=person.id, name=person.name, monthly=monthly,
                                     employer_monthly=employer))
        total += monthly
        employer_total += employer
    return total, employer_total, rows, warnings
```

In the caller, replace the unpack with `payroll, employer, by_person, payroll_warnings = await _payroll_savings(db, today)` and the two lines that build the answer with:

```python
        monthly_contribution = (cash_part + payroll + employer).quantize(
            CENT, rounding=ROUND_HALF_UP)
        contribution_breakdown = ContributionBreakdownOut(
            cash=cash_part, payroll=payroll, employer=employer,
            total=monthly_contribution, by_person=by_person)
```

In `_resolve_retirements`, add `limits = await _limits_for(db, today.year)` above the loop over the params and, after the existing `drop += half_up2(payroll_monthly(profile))`:

```python
        # The employer's leg stops with the job too — the same figure `_payroll_savings`
        # added for this person, so a retirement removes exactly what the profile put in.
        drop += employer_monthly(profile, limits)
```

- [ ] **5 Pass:** `pytest tests/test_projection_api.py tests/test_savings_service.py tests/test_sandbox_purity.py -q` — `test_savings_service.py` untouched and green.
- [ ] **6 Commit:** `git add -A backend && git commit -m "feat(projection): the employer match is its own contribution leg"`

---

### Task 10: Full suite, lint, migration check

- [ ] **1 Lint:** `.venv/Scripts/python.exe -m ruff format app tests`, then `.venv/Scripts/python.exe -m ruff check app tests` → `All checks passed!`
- [ ] **2 Full suite:** `FINANCE_TEST_DB=finance_test_pa .venv/Scripts/python.exe -m pytest -q` → 0 failed. Any failure is a real regression; fix it, never skip it.
- [ ] **3 Migration chain:** `.venv/Scripts/python.exe -m alembic heads` → exactly one head, `f6b8d2e4a7c1 (head)`. Then against the dev database, `.venv/Scripts/python.exe -m alembic upgrade head && .venv/Scripts/python.exe -m alembic check` → the upgrade applies `f6b8d2e4a7c1` and `check` reports `No new upgrade operations detected.` (the model's repeated `server_default`s are what make that true).
- [ ] **4 Commit anything lint moved:** `git add -A backend && git commit -m "chore(paycheck): ruff pass over the pace and match lane"` (skip if `git status` is clean).

---

## Handoff notes for lanes B, C and V

- **Wire names are fixed** by spec §1.6/§2.3 and pinned above: `measure`, `soft_limit`, `soft_ratio`, `window_label`, `halves[{label,start,end,amount,source,basis}]`, `backfilled_from`, `projected_full_year`, `projected_excess`, `current_rate`, `employer_match`, `in_force`, `espp_discount_pct`, `discount_pct`, `employer_monthly`, `employer`.
- **`employer_match` is null unless it is > 0**; independently, the 415(c) LABEL reads "(incl. employer match)" whenever any band is > 0. Lane B renders the suffix on non-null.
- **`halves[].basis` is null on an entered half** — it was never estimated.
- **The ESPP row is absent** when the window and the current rate are both zero; lane B must keep handling a pace list with no `limit_espp_423` row.
- Two figures in the spec's §1.4 worked example are three cents high (H2 10,469.90 and the window 20,861.05). Enumerating the twelve real paydays of each half gives 10,469.87 and 20,861.02, which is what Task 7's golden pins; every downstream figure is unchanged — soft cap 21,250.00, `soft_ratio` 0.9817, tone `warn`, projected 22,671.60, excess 1,421.60.
