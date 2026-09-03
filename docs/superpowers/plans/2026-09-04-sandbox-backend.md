# Sandbox lane B — backend (`POST /paycheck/preview`, `niit_tax`, `forbid_writes` purity walk, `previewPaycheck()`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server half of `docs/superpowers/specs/2026-09-03-planning-sandboxes-design.md` §13–§14: a pure `POST /paycheck/preview` that answers a paycheck scenario without writing (baseline · scenario · delta across per-check/monthly/annual blocks, both pace strips, the moved fields, scenario-side warnings), the shared `_resolve_breakdown_profile` / `_scenario_profile` extraction so `GET /breakdown` and the preview select and validate one way, `niit_tax` on `WhatIfDelta`, a `forbid_writes` conftest guard with a purity walk over every sandbox route, and the frontend client + types for the new endpoint.

**Architecture:** The preview reuses everything the paycheck router already has: the same two selectors as `GET /breakdown` (explicit `profile_id` wins, else the owner's profile in force via `_resolve_person_id` + `_default_profile`), the writers' own validators word for word (`_positive_salary`, `_non_negative_per_check`, `_validated_pct`, `_validated_coverage`, `PAY_PERIODS_MESSAGE`), and the pure `paycheck_calc.breakdown` / `limit_check.paycheck_pace`, which accept "anything with its columns" — the scenario is a frozen dataclass copy of the ORM row with overrides applied, so nothing in the session is ever dirtied. Monthly and annual blocks scale the full-precision chain before quantizing; every delta is the difference of two `half_up2` figures. `PAYROLL_SAVING_KEYS` moves from `api/projection.py` into the pure `paycheck_calc` module (projection.py already imports from there; the reverse import would be a cycle). `forbid_writes` is a context-manager factory fixture that attaches a `before_flush` listener to the test session and fails on any flush carrying new/dirty/deleted objects; the purity walk discovers sandbox routes from `app.routes` and refuses to pass unless every one has a registered body and leaves every table's row count unchanged.

**Tech Stack:** FastAPI, pydantic v2, SQLAlchemy 2 async (`sync_session` events), pytest (asyncio auto mode; the conftest's `FINANCE_TEST_DB` guard), ruff; TypeScript + vitest for the client.

**Worktree / commands:** Branch `sandbox-backend`, worktree `.worktrees/sandbox-backend`. Backend from `<worktree>/backend` with the ROOT venv interpreter and this lane's private database:
`FINANCE_TEST_DB=finance_test_sandbox_be ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
(the path is relative to `.worktrees/sandbox-backend/backend`; `<venv-python>` below means that interpreter). Ruff: `<venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`. Frontend (Task 6 only) from the worktree root after `cmd /c mklink /J node_modules ..\..\node_modules`: `npx vitest run src/api/paycheck.test.ts`, `npx tsc -b`.

**Prerequisites on main:** none beyond current main. Independent of lane G (this lane's frontend touch is `src/types/api.ts` + `src/api/paycheck.ts`; G creates only `src/sandbox/*` and a JSON fixture).

**Shared-file hotspots (coordinate at merge):** `src/types/api.ts` (this lane appends the preview types and `niit_tax`; lanes P/T/J only READ them; lane A adds nothing here). `backend/tests/conftest.py` (this lane adds one fixture; lane A adds none). `backend/app/api/taxes.py` (one field in `what_if`; lane A imports `what_if` but does not edit the module). `backend/app/services/assistant_tools.py` — NOT touched here (lane A's).

**Overnight rule:** no file deletions. The local `PAYROLL_SAVING_KEYS` tuple in `projection.py` is REPLACED by an import (an edit, not a deletion).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/paycheck_calc.py` (modify) | `WATERFALL_KEYS`, `PAYROLL_SAVING_KEYS` (moved here from `api/projection.py`) |
| `backend/app/api/projection.py` (modify) | import `PAYROLL_SAVING_KEYS` from `paycheck_calc` instead of defining it |
| `backend/app/schemas/paycheck.py` (modify) | `ProfileOverrides`, `PreviewIn`, `PreviewLines`, `PreviewBlock`, `PreviewPace`, `ChangedField`, `PreviewOut` |
| `backend/app/api/paycheck.py` (modify) | `_resolve_breakdown_profile`, `_limits_for`, `_advisories`, `ScenarioProfile` + `_scenario_profile`, `_lines`/`_block`, `POST /preview`; `get_breakdown` rewired onto the shared helpers |
| `backend/tests/test_paycheck_preview_api.py` (new) | auth, empty overrides ≡ breakdown, parity with a real profile, 422 texts equal the writers', unknown key, 404, `profile_id` beats `person_id`, `changed`, scaling + `savings` pins, scenario-side warnings, pace scenario |
| `backend/app/schemas/taxes.py` (modify) | `WhatIfDelta.niit_tax: Decimal | None = None` |
| `backend/app/api/taxes.py` (modify) | `niit_tax` computed in `what_if` |
| `backend/tests/test_taxes_api.py` (modify) | the exact-delta pin gains `niit_tax`; the NIIT-threshold test asserts it; an older payload still validates |
| `backend/tests/conftest.py` (modify) | `forbid_writes` fixture |
| `backend/tests/test_sandbox_purity.py` (new) | route discovery + registered bodies; every sandbox route runs under `forbid_writes` with unchanged row counts |
| `src/types/api.ts` (modify) | `PaycheckPreviewOverrides`, `PaycheckPreviewLines`, `PaycheckPreviewBlock`, `PaycheckChangedField`, `PaycheckPreviewOut`; `WhatIfDelta.niit_tax` |
| `src/api/paycheck.ts` (modify) | `previewPaycheck()` via `apiReadOnly` |
| `src/api/paycheck.test.ts` (modify) | the preview rides `apiReadOnly`, never `api` |

---

### Task 1: `PAYROLL_SAVING_KEYS` and `WATERFALL_KEYS` move into the pure calc module

**Files:**
- Modify: `backend/app/services/paycheck_calc.py`, `backend/app/api/projection.py`
- Test: `backend/tests/test_paycheck_comp_api.py` (append two pins)

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_paycheck_comp_api.py` (after the four `test_paycheck_waterfall_*` tests, which already import `breakdown` from `paycheck_calc`):

```python
def test_waterfall_keys_are_the_breakdown_keys_in_sheet_order():
    """The preview and the projection read the chain by NAME; the tuples pin the names."""
    from app.services.paycheck_calc import PAYROLL_SAVING_KEYS, WATERFALL_KEYS

    lines = breakdown(
        type(
            "P",
            (),
            {
                "annual_salary": D("120000"),
                "pay_periods_per_year": 24,
                "trad_401k_pct": D("0.1"),
                "roth_401k_pct": D("0"),
                "after_tax_401k_pct": D("0"),
                "espp_pct": D("0.05"),
                "withholding_pct": D("0.2"),
                "dental_vision_per_check": D("0"),
                "hsa_per_check": D("100"),
            },
        )()
    )
    assert WATERFALL_KEYS == (
        "gross",
        "trad_401k",
        "dental_vision",
        "hsa",
        "taxable",
        "withholding",
        "post_tax",
        "roth_401k",
        "after_tax_401k",
        "espp",
        "net_pay",
    )
    assert set(WATERFALL_KEYS) | {"monthly_net"} == set(lines)
    assert PAYROLL_SAVING_KEYS == ("trad_401k", "roth_401k", "after_tax_401k", "espp", "hsa")
    assert sum(lines[key] for key in PAYROLL_SAVING_KEYS) == D("850")  # 500 + 0 + 0 + 250 + 100
```

(`D` is already `Decimal` in that file; check the alias at the top and use `Decimal` if not.)

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_paycheck_comp_api.py -q -k waterfall_keys`
Expected: FAIL — `ImportError: cannot import name 'PAYROLL_SAVING_KEYS'`.

- [ ] **Step 3: Implement**

`backend/app/services/paycheck_calc.py` — after `MONTHS_PER_YEAR = Decimal("12")` add:

```python
# The eleven lines of one check, in the sheet's waterfall order — exactly the numeric fields
# of schemas.paycheck.BreakdownOut minus the monthly roll-up. The preview endpoint and the
# projection read `breakdown()`'s dict by these names, so the order lives in one place.
WATERFALL_KEYS = (
    "gross",
    "trad_401k",
    "dental_vision",
    "hsa",
    "taxable",
    "withholding",
    "post_tax",
    "roth_401k",
    "after_tax_401k",
    "espp",
    "net_pay",
)
# The paycheck lines that are SAVINGS — money that leaves the check but lands in an account
# the household owns. Dental/vision and withholding are costs; employer match is not
# modeled (limit_check.py's caveat); the take-home itself is what the projection's
# `_trailing_savings` nets against spend, so it is deliberately not in this tuple. Lives
# here (not in api/projection.py) because the paycheck preview sums it too, and the
# projection router already imports from this module — the reverse import would be a cycle.
PAYROLL_SAVING_KEYS = ("trad_401k", "roth_401k", "after_tax_401k", "espp", "hsa")
```

`backend/app/api/projection.py` — change the calc import to
`from app.services.paycheck_calc import MONTHS_PER_YEAR, PAYROLL_SAVING_KEYS, breakdown, half_up2`
and replace the local block (the comment starting `# The paycheck lines that are SAVINGS` through `PAYROLL_SAVING_KEYS = ("trad_401k", "roth_401k", "after_tax_401k", "espp", "hsa")`) with the single line:

```python
# PAYROLL_SAVING_KEYS: imported from paycheck_calc (shared with the paycheck preview).
```

- [ ] **Step 4: Run the pins and the projection suite**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_paycheck_comp_api.py tests/test_projection_api.py -q`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/paycheck_calc.py backend/app/api/projection.py backend/tests/test_paycheck_comp_api.py
git commit -m "refactor(paycheck): WATERFALL_KEYS and PAYROLL_SAVING_KEYS live in the pure calc module"
```

---

### Task 2: Preview schemas and the shared resolver; `GET /breakdown` rewired

**Files:**
- Modify: `backend/app/schemas/paycheck.py`, `backend/app/api/paycheck.py`
- Test: `backend/tests/test_paycheck_preview_api.py` (new — the first four tests)

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_paycheck_preview_api.py
"""POST /paycheck/preview — the Paycheck "Try it" sandbox's one request (2026-09-03
planning-sandboxes spec §13). Pure: SELECTs only, proven by test_sandbox_purity.py. The
pins here are PARITY pins: the baseline half of every answer equals GET /breakdown field for
field, and the scenario half equals GET /breakdown of a REAL profile carrying those values —
one compute, two doors, never a second arithmetic."""

from datetime import date
from decimal import Decimal

import pytest

from app.api.paycheck import (
    CONTRIBUTIONS_WARNING,
    HSA_COVERAGE_MESSAGE,
    NEGATIVE_NET_WARNING,
    PAY_PERIODS_MESSAGE,
)
from app.models import ContributionLimit, Person

PROFILES = "/api/v1/paycheck/profiles"
BREAKDOWN = "/api/v1/paycheck/breakdown"
PREVIEW = "/api/v1/paycheck/preview"
D = Decimal

WATERFALL = (
    "gross",
    "trad_401k",
    "dental_vision",
    "hsa",
    "taxable",
    "withholding",
    "post_tax",
    "roth_401k",
    "after_tax_401k",
    "espp",
    "net_pay",
)


def profile_payload(**overrides) -> dict:
    body = {
        "effective_date": "2026-01-01",
        "annual_salary": "188930",
        "pay_periods_per_year": 24,
        "trad_401k_pct": "0.13",
        "roth_401k_pct": "0",
        "after_tax_401k_pct": "0.03",
        "espp_pct": "0.11",
        "withholding_pct": "0.334009167",
        "dental_vision_per_check": "12.50",
        "hsa_per_check": "100",
    }
    body.update(overrides)
    return body


async def create_profile(auth_client, **overrides) -> dict:
    resp = await auth_client.post(PROFILES, json=profile_payload(**overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def preview(auth_client, **body) -> dict:
    resp = await auth_client.post(PREVIEW, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
async def me(db):
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.commit()
    return person


async def test_preview_requires_auth(client):
    assert (await client.post(PREVIEW, json={})).status_code == 401


async def test_preview_404s_with_no_profiles_in_the_legacy_words(auth_client, me):
    resp = await auth_client.post(PREVIEW, json={})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no paycheck profiles"


async def test_preview_with_empty_overrides_echoes_the_breakdown(auth_client, me):
    """The legal no-op: baseline == scenario, every delta 0.00, and the baseline IS the
    GET's answer field for field — one quantization discipline, not two."""
    await create_profile(auth_client)
    shown = (await auth_client.get(BREAKDOWN)).json()

    body = await preview(auth_client)
    assert body["profile"] == shown["profile"]
    assert body["per_check"]["scenario"] == body["per_check"]["baseline"]
    for key in WATERFALL:
        assert body["per_check"]["baseline"][key] == shown[key]
    assert body["per_check"]["delta"] == {key: "0.00" for key in (*WATERFALL, "savings")}
    assert body["monthly"]["baseline"]["net_pay"] == shown["monthly_net"]
    assert body["monthly"]["delta"]["net_pay"] == "0.00"
    assert body["annual"]["delta"]["gross"] == "0.00"
    assert body["pace"]["baseline"] == shown["pace"]
    assert body["pace"]["scenario"] == shown["pace"]
    assert body["changed"] == []
    assert body["warnings"] == []


async def test_preview_selects_the_base_exactly_as_the_breakdown_does(auth_client, db, me):
    """Explicit row wins; absent = the primary's profile in force; a pinned id under a
    partner's person_id still means the row (GET /breakdown's three rules, one resolver)."""
    partner = Person(name="Partner", is_primary=False)
    db.add(partner)
    await db.commit()
    mine = await create_profile(auth_client, annual_salary="100000")
    theirs = await create_profile(auth_client, person_id=partner.id, annual_salary="80000")

    assert (await preview(auth_client))["profile"]["id"] == mine["id"]
    assert (await preview(auth_client, person_id=partner.id))["profile"]["id"] == theirs["id"]
    assert (await preview(auth_client, profile_id=theirs["id"], person_id=me.id))["profile"]["id"] == theirs["id"]
    resp = await auth_client.post(PREVIEW, json={"profile_id": 999999})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "paycheck profile not found"
    resp = await auth_client.post(PREVIEW, json={"person_id": 999999})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "person not found"
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_paycheck_preview_api.py -q`
Expected: the auth test fails with 404/405 (no route); the rest fail on the missing route too.

- [ ] **Step 3: Schemas** — append to `backend/app/schemas/paycheck.py`:

```python
class ProfileOverrides(BaseModel):
    """The knobs of a `POST /preview` scenario (2026-09-03 planning-sandboxes spec §13).

    Every field optional; unknown keys are REFUSED (`extra='forbid'`), so a mistyped knob
    422s instead of silently modelling the base profile. Values are validated in the router
    by the WRITERS' own helpers, word for word — a scenario obeys exactly the rules a stored
    row does, and its 422s read exactly like theirs.
    """

    model_config = ConfigDict(extra="forbid")

    annual_salary: Decimal | None = None
    pay_periods_per_year: int | None = None
    trad_401k_pct: Decimal | None = None
    roth_401k_pct: Decimal | None = None
    after_tax_401k_pct: Decimal | None = None
    espp_pct: Decimal | None = None
    withholding_pct: Decimal | None = None
    dental_vision_per_check: Decimal | None = None
    hsa_per_check: Decimal | None = None
    hsa_coverage: str | None = None


class PreviewIn(BaseModel):
    # The base: the same two selectors GET /breakdown takes — an explicit row wins, absent
    # means the primary's profile in force (the wire's back-compat rule).
    profile_id: int | None = Field(default=None, ge=1, le=INT32_MAX)
    person_id: int | None = Field(default=None, ge=1, le=INT32_MAX)
    overrides: ProfileOverrides = Field(default_factory=ProfileOverrides)


class PreviewLines(BaseModel):
    """The eleven waterfall lines plus `savings` (trad + Roth + after-tax + ESPP + HSA — the
    figure the projection consumes), each a 2dp display value of the full-precision chain.
    In a delta block every field is the difference of two such figures, so the Δ column can
    never contradict its neighbours."""

    gross: Decimal
    trad_401k: Decimal
    dental_vision: Decimal
    hsa: Decimal
    taxable: Decimal
    withholding: Decimal
    post_tax: Decimal
    roth_401k: Decimal
    after_tax_401k: Decimal
    espp: Decimal
    net_pay: Decimal
    savings: Decimal


class PreviewBlock(BaseModel):
    baseline: PreviewLines
    scenario: PreviewLines
    delta: PreviewLines


class PreviewPace(BaseModel):
    baseline: list[PaceItemOut]
    scenario: list[PaceItemOut]


class ChangedField(BaseModel):
    """One profile field the scenario moved — `before`/`after` as plain text because the
    fields are mixed (money, a 9dp fraction, an integer, a coverage tier)."""

    key: str
    label: str
    before: str
    after: str


class PreviewOut(BaseModel):
    profile: ProfileOut
    per_check: PreviewBlock
    # Scaled server-side on the full-precision chain by the profile's OWN cadence (each side
    # its own — a scenario may change pay_periods_per_year), then quantized.
    monthly: PreviewBlock
    annual: PreviewBlock
    pace: PreviewPace
    changed: list[ChangedField]
    # Scenario-side advisories only (CONTRIBUTIONS_WARNING / NEGATIVE_NET_WARNING).
    warnings: list[str]
```

- [ ] **Step 4: The router** — in `backend/app/api/paycheck.py`:

Imports: add `from dataclasses import dataclass`; extend the schema import to
`from app.schemas.paycheck import (BreakdownOut, ChangedField, PaceItemOut, PreviewBlock, PreviewIn, PreviewLines, PreviewOut, PreviewPace, ProfileIn, ProfileOut, ProfileOverrides, ProfileUpdate)`;
extend the calc import to
`from app.services.paycheck_calc import MONTHS_PER_YEAR, PAYROLL_SAVING_KEYS, WATERFALL_KEYS, breakdown, half_up2`.

After `NO_PRIMARY_PERSON_MESSAGE` add:

```python
ONE = Decimal("1")
# Every field a preview may override, in the order `changed` reports them, with the labels
# the sandbox prints (the profile form's own words — percents named as percents).
SCENARIO_FIELDS = (
    "annual_salary",
    "pay_periods_per_year",
    *PCT_FIELDS,
    "dental_vision_per_check",
    "hsa_per_check",
    "hsa_coverage",
)
FIELD_LABELS = {
    "annual_salary": "Annual salary",
    "pay_periods_per_year": "Pay periods per year",
    "trad_401k_pct": "Traditional 401(k) %",
    "roth_401k_pct": "Roth 401(k) %",
    "after_tax_401k_pct": "After-tax 401(k) %",
    "espp_pct": "ESPP %",
    "withholding_pct": "Withholding %",
    "dental_vision_per_check": "Dental & vision",
    "hsa_per_check": "HSA",
    "hsa_coverage": "HSA coverage",
}
```

Replace the body of `get_breakdown` and add the helpers and the route (place the helpers right after `_default_profile`, before `get_breakdown`):

```python
async def _resolve_breakdown_profile(
    db: AsyncSession, profile_id: int | None, person_id: int | None, today: date
) -> PaycheckProfile:
    """WHICH profile a breakdown or a preview is about — the one rule, two doors.

    An explicit row wins outright: `person_id` only names WHOSE profile in force to pick,
    and there is nothing to pick when the row itself is named. Absent both = the primary's
    profile in force. The roster-less answer is the legacy 404, word for word.

    Also the stored-data guard, and the one thing a read CAN reject: every writer bounds
    `pay_periods_per_year`, but the API's bounds cannot see a row put there by hand, and
    `gross = annual_salary / periods` turns a stored 0 into a DivisionByZero 500. Only the
    floor is fenced: an over-large period count computes fine.
    """
    if profile_id is not None:
        profile = await _get_profile(db, profile_id)
    else:
        owner = await _resolve_person_id(db, person_id)  # absent = the primary person
        profile = None if owner is None else await _default_profile(db, owner, today)
        if profile is None:
            raise HTTPException(status_code=404, detail="no paycheck profiles")
    if profile.pay_periods_per_year < MIN_PAY_PERIODS:
        raise HTTPException(status_code=422, detail=PAY_PERIODS_MESSAGE)
    return profile


async def _limits_for(db: AsyncSession, year: int) -> dict[str, Decimal]:
    """This year's entered caps. No limits entered yet is the NORMAL first-run state, not an
    error: paycheck_pace answers with null caps and the page offers a link to Settings."""
    return {
        row.key: row.value
        for row in (
            await db.execute(select(ContributionLimit).where(ContributionLimit.year == year))
        ).scalars()
    }


def _advisories(profile, net_pay: Decimal) -> list[str]:
    """Advisory only, never a 422: each pct is individually legal, and the sheet itself
    lets you model an over-committed check. Judged on the DISPLAYED net, so the warning
    can never contradict the number next to it: a -1e-9 net renders as 0.00 and says
    nothing."""
    warnings: list[str] = []
    if sum((getattr(profile, name) for name in CONTRIBUTION_FIELDS), ZERO) > 1:
        warnings.append(CONTRIBUTIONS_WARNING)
    if net_pay < 0:
        warnings.append(NEGATIVE_NET_WARNING)
    return warnings


@dataclass(frozen=True)
class ScenarioProfile:
    """A profile with overrides applied — "anything with its columns" for
    `paycheck_calc.breakdown` and `limit_check.paycheck_pace`. Never an ORM row: a preview
    must not dirty the session (the purity walk in tests/test_sandbox_purity.py)."""

    annual_salary: Decimal
    pay_periods_per_year: int
    trad_401k_pct: Decimal
    roth_401k_pct: Decimal
    after_tax_401k_pct: Decimal
    espp_pct: Decimal
    withholding_pct: Decimal
    dental_vision_per_check: Decimal
    hsa_per_check: Decimal
    hsa_coverage: str


def _scenario_profile(base: PaycheckProfile, overrides: ProfileOverrides) -> ScenarioProfile:
    """The base row's values with every PROVIDED override validated by the writers' own
    helpers — one rule, one sentence per field, on both sides of the wire. Raises before it
    returns anything."""
    periods = (
        base.pay_periods_per_year
        if overrides.pay_periods_per_year is None
        else overrides.pay_periods_per_year
    )
    if not MIN_PAY_PERIODS <= periods <= MAX_PAY_PERIODS:
        raise HTTPException(status_code=422, detail=PAY_PERIODS_MESSAGE)
    pcts = {
        name: (
            getattr(base, name)
            if getattr(overrides, name) is None
            else _validated_pct(getattr(overrides, name), name)
        )
        for name in PCT_FIELDS
    }
    return ScenarioProfile(
        annual_salary=(
            base.annual_salary
            if overrides.annual_salary is None
            else _positive_salary(overrides.annual_salary, "annual_salary")
        ),
        pay_periods_per_year=periods,
        dental_vision_per_check=(
            base.dental_vision_per_check
            if overrides.dental_vision_per_check is None
            else _non_negative_per_check(overrides.dental_vision_per_check, "dental_vision_per_check")
        ),
        hsa_per_check=(
            base.hsa_per_check
            if overrides.hsa_per_check is None
            else _non_negative_per_check(overrides.hsa_per_check, "hsa_per_check")
        ),
        hsa_coverage=(
            base.hsa_coverage
            if overrides.hsa_coverage is None
            else _validated_coverage(overrides.hsa_coverage)
        ),
        **pcts,
    )


def _lines(profile, scale: Decimal) -> dict[str, Decimal]:
    """The eleven lines plus `savings`, scaled on the FULL-precision chain and quantized
    once — so monthly.net_pay is exactly BreakdownOut.monthly_net for the same profile."""
    raw = breakdown(profile)
    chain = {key: raw[key] for key in WATERFALL_KEYS}
    chain["savings"] = sum((raw[key] for key in PAYROLL_SAVING_KEYS), ZERO)
    return {key: half_up2(value * scale) for key, value in chain.items()}


def _block(base, scenario, scale_of) -> PreviewBlock:
    """Baseline · scenario · delta at one cadence. Each side is scaled by ITS OWN period
    count (a scenario may change the cadence), and every delta is the difference of two
    already-quantized figures — the what-if endpoint's rule."""
    before = _lines(base, scale_of(base))
    after = _lines(scenario, scale_of(scenario))
    return PreviewBlock(
        baseline=PreviewLines(**before),
        scenario=PreviewLines(**after),
        delta=PreviewLines(**{key: after[key] - before[key] for key in before}),
    )


def _text(value) -> str:
    # `format(d, "f")`, never str(): a zero comes back from the driver as Decimal("0E-9").
    return format(value, "f") if isinstance(value, Decimal) else str(value)


@router.get("/breakdown", response_model=BreakdownOut)
async def get_breakdown(
    profile_id: IdQuery = None,
    person_id: IdQuery = None,
    db: AsyncSession = Depends(get_db),
) -> BreakdownOut:
    # The ONLY clock read for this route, deciding TWO things: which profile is in force,
    # and which year's contribution limits the pace rows are measured against. One read, so
    # a request that straddles midnight on 31 December cannot pair January's profile with
    # December's caps.
    today = date.today()
    profile = await _resolve_breakdown_profile(db, profile_id, person_id, today)
    lines = {name: half_up2(value) for name, value in breakdown(profile).items()}
    warnings = _advisories(profile, lines["net_pay"])
    limits = await _limits_for(db, today.year)
    pace = [
        PaceItemOut.model_validate(item)
        for item in paycheck_pace(profile, limits, profile.hsa_coverage)
    ]
    return BreakdownOut(
        profile=ProfileOut.model_validate(profile), warnings=warnings, pace=pace, **lines
    )


@router.post("/preview", response_model=PreviewOut)
async def preview(body: PreviewIn, db: AsyncSession = Depends(get_db)) -> PreviewOut:
    """The Paycheck sandbox's one request (2026-09-03 planning-sandboxes spec §13): the
    base profile — selected exactly as GET /breakdown selects it — against the same profile
    with `overrides` applied. NOTHING is stored: SELECTs only, no add/flush/commit anywhere
    in this call graph (tests/test_sandbox_purity.py proves it). `today` is read once for
    both the profile in force and the limits year, like the GET."""
    today = date.today()
    base = await _resolve_breakdown_profile(db, body.profile_id, body.person_id, today)
    scenario = _scenario_profile(base, body.overrides)

    per_check = _block(base, scenario, lambda p: ONE)
    monthly = _block(base, scenario, lambda p: Decimal(p.pay_periods_per_year) / MONTHS_PER_YEAR)
    annual = _block(base, scenario, lambda p: Decimal(p.pay_periods_per_year))

    limits = await _limits_for(db, today.year)
    pace = PreviewPace(
        baseline=[
            PaceItemOut.model_validate(item)
            for item in paycheck_pace(base, limits, base.hsa_coverage)
        ],
        scenario=[
            PaceItemOut.model_validate(item)
            for item in paycheck_pace(scenario, limits, scenario.hsa_coverage)
        ],
    )
    changed = [
        ChangedField(
            key=name,
            label=FIELD_LABELS[name],
            before=_text(getattr(base, name)),
            after=_text(getattr(scenario, name)),
        )
        for name in SCENARIO_FIELDS
        if getattr(base, name) != getattr(scenario, name)
    ]
    return PreviewOut(
        profile=ProfileOut.model_validate(base),
        per_check=per_check,
        monthly=monthly,
        annual=annual,
        pace=pace,
        changed=changed,
        warnings=_advisories(scenario, per_check.scenario.net_pay),
    )
```

Delete nothing else: the old inline body of `get_breakdown` is replaced by the version above (its comments now live on the helpers).

- [ ] **Step 5: Run**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_paycheck_preview_api.py tests/test_paycheck_comp_api.py -q`
Expected: all passed — the four new tests and every existing breakdown pin (the rewired GET is byte-identical).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/paycheck.py backend/app/api/paycheck.py backend/tests/test_paycheck_preview_api.py
git commit -m "feat(api): POST /paycheck/preview — pure scenario over the profile in force; GET /breakdown shares the resolver"
```

---

### Task 3: Preview parity, validation and figure pins

**Files:**
- Test: `backend/tests/test_paycheck_preview_api.py` (append)

- [ ] **Step 1: Write the tests**

```python
async def test_preview_scenario_equals_a_real_profile_with_those_values(auth_client, me):
    """Parity with the real compute: the scenario half equals GET /breakdown of a profile
    CREATED with the overridden values, then deleted — one arithmetic, two doors."""
    await create_profile(auth_client)
    overrides = {"trad_401k_pct": "0.15", "hsa_per_check": "250", "hsa_coverage": "family"}
    body = await preview(auth_client, overrides=overrides)

    twin = await create_profile(auth_client, effective_date="2019-01-01", **overrides)
    shown = (await auth_client.get(f"{BREAKDOWN}?profile_id={twin['id']}")).json()
    for key in WATERFALL:
        assert body["per_check"]["scenario"][key] == shown[key]
    assert body["monthly"]["scenario"]["net_pay"] == shown["monthly_net"]
    assert body["pace"]["scenario"] == shown["pace"]
    assert (await auth_client.delete(f"{PROFILES}/{twin['id']}")).status_code == 204
    # The preview modelled nothing into the database: the same request answers the same.
    assert (await preview(auth_client, overrides=overrides)) == body


@pytest.mark.parametrize(
    "overrides",
    [
        {"annual_salary": "0"},
        {"annual_salary": "-5"},
        {"hsa_per_check": "-1"},
        {"dental_vision_per_check": "-0.001"},
        {"trad_401k_pct": "13"},
        {"espp_pct": "-0.01"},
        {"pay_periods_per_year": 0},
        {"pay_periods_per_year": 367},
        {"hsa_coverage": "spouse"},
    ],
)
async def test_preview_422_texts_equal_the_writers(auth_client, me, overrides):
    """Every refusal reads exactly as the POST /profiles refusal for the same value — the
    writers' helpers, called by name, not a second phrasing."""
    await create_profile(auth_client)
    written = await auth_client.post(PROFILES, json=profile_payload(effective_date="2019-01-01", **overrides))
    assert written.status_code == 422, written.text
    previewed = await auth_client.post(PREVIEW, json={"overrides": overrides})
    assert previewed.status_code == 422, previewed.text
    assert previewed.json()["detail"] == written.json()["detail"]


async def test_preview_pinned_422_sentences(auth_client, me):
    await create_profile(auth_client)
    cases = {
        ("annual_salary", "0"): "annual_salary must be positive",
        ("hsa_per_check", "-1"): "hsa_per_check must be >= 0",
        ("trad_401k_pct", "13"): "trad_401k_pct must be between 0 and 1",
        ("pay_periods_per_year", 0): PAY_PERIODS_MESSAGE,
        ("hsa_coverage", "spouse"): HSA_COVERAGE_MESSAGE,
    }
    for (key, value), sentence in cases.items():
        resp = await auth_client.post(PREVIEW, json={"overrides": {key: value}})
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == sentence


async def test_preview_refuses_an_unknown_knob(auth_client, me):
    """extra='forbid': a mistyped knob must not silently model the base profile."""
    await create_profile(auth_client)
    resp = await auth_client.post(PREVIEW, json={"overrides": {"bonus_pct": "0.1"}})
    assert resp.status_code == 422
    assert "bonus_pct" in resp.text


async def test_preview_changed_lists_only_the_keys_that_moved(auth_client, me):
    await create_profile(auth_client)
    body = await preview(
        auth_client,
        # trad restated at its stored value moves nothing; the other two do.
        overrides={"trad_401k_pct": "0.130000000", "hsa_per_check": "250", "hsa_coverage": "family"},
    )
    assert body["changed"] == [
        {"key": "hsa_per_check", "label": "HSA", "before": "100.00", "after": "250.00"},
        {"key": "hsa_coverage", "label": "HSA coverage", "before": "self", "after": "family"},
    ]


async def test_preview_scaling_and_savings_pinned_by_hand(auth_client, me):
    """120,000 over 24 periods, trad 10 %, ESPP 5 %, HSA $100, withholding 20 %:
    gross 5000 · trad 500 · hsa 100 · taxable 4400 · withholding 880 · post-tax 3520 ·
    espp 250 · net 3270 · savings 500 + 250 + 100 = 850. Monthly = ×2, annual = ×24."""
    await create_profile(
        auth_client,
        annual_salary="120000",
        trad_401k_pct="0.10",
        after_tax_401k_pct="0",
        espp_pct="0.05",
        withholding_pct="0.20",
        dental_vision_per_check="0",
        hsa_per_check="100",
    )
    body = await preview(auth_client, overrides={"espp_pct": "0"})
    base = body["per_check"]["baseline"]
    assert (base["gross"], base["taxable"], base["withholding"], base["net_pay"]) == (
        "5000.00",
        "4400.00",
        "880.00",
        "3270.00",
    )
    assert base["savings"] == "850.00"
    assert body["monthly"]["baseline"]["savings"] == "1700.00"
    assert body["annual"]["baseline"]["savings"] == "20400.00"
    assert body["annual"]["baseline"]["gross"] == "120000.00"
    # Stop ESPP: net rises by the 250 that no longer leaves the check; savings fall by it.
    assert body["per_check"]["delta"]["net_pay"] == "250.00"
    assert body["per_check"]["delta"]["savings"] == "-250.00"
    assert body["monthly"]["delta"]["savings"] == "-500.00"
    assert body["annual"]["delta"]["espp"] == "-6000.00"


async def test_preview_scales_each_side_by_its_own_cadence(auth_client, me):
    """A scenario that changes pay_periods_per_year: the annual gross is unchanged (the
    salary is annual), the per-check gross moves, and monthly still equals annual ÷ 12."""
    await create_profile(auth_client, annual_salary="120000")
    body = await preview(auth_client, overrides={"pay_periods_per_year": 12})
    assert body["per_check"]["baseline"]["gross"] == "5000.00"
    assert body["per_check"]["scenario"]["gross"] == "10000.00"
    assert body["annual"]["delta"]["gross"] == "0.00"
    assert body["monthly"]["scenario"]["gross"] == "10000.00"
    assert body["changed"] == [
        {"key": "pay_periods_per_year", "label": "Pay periods per year", "before": "24", "after": "12"}
    ]


async def test_preview_warnings_are_the_scenario_side(auth_client, me):
    await create_profile(auth_client)
    calm = await preview(auth_client)
    assert calm["warnings"] == []
    hot = await preview(auth_client, overrides={"after_tax_401k_pct": "0.9", "espp_pct": "0.15"})
    assert hot["warnings"] == [CONTRIBUTIONS_WARNING, NEGATIVE_NET_WARNING]
    assert Decimal(hot["per_check"]["scenario"]["net_pay"]) < 0


async def test_preview_pace_scenario_reflects_the_overrides(auth_client, db, me):
    db.add(ContributionLimit(year=date.today().year, key="limit_401k_elective", value=D("24500.00")))
    await db.commit()
    await create_profile(auth_client, annual_salary="100000", trad_401k_pct="0.10", after_tax_401k_pct="0")
    body = await preview(auth_client, overrides={"trad_401k_pct": "0.245"})
    before = {row["key"]: row for row in body["pace"]["baseline"]}
    after = {row["key"]: row for row in body["pace"]["scenario"]}
    assert before["limit_401k_elective"]["ratio"] == "0.4082"
    assert after["limit_401k_elective"]["annualized"] == "24500.00"
    assert after["limit_401k_elective"]["ratio"] == "1.0000"
    assert after["limit_401k_elective"]["tone"] == "warn"
```

- [ ] **Step 2: Run**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_paycheck_preview_api.py -q`
Expected: all passed. If `test_preview_changed_lists_only_the_keys_that_moved` shows `before: "100.00"` as `"100"`, `_text` is not being applied to the base value (the ORM Decimal is `Decimal("100.00")` — `format(…, "f")` keeps its scale). If the parametrized writer-parity case for `dental_vision_per_check: "-0.001"` differs, the writer's `_non_negative_per_check` is judging the RAW value — the scenario must call the same helper (it does) rather than comparing the quantized copy.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_paycheck_preview_api.py
git commit -m "test(api): paycheck preview parity with the real compute, writer-identical 422s, scaling and savings pins"
```

---

### Task 4: `WhatIfDelta.niit_tax`

**Files:**
- Modify: `backend/app/schemas/taxes.py`, `backend/app/api/taxes.py`
- Test: `backend/tests/test_taxes_api.py` (modify two tests, append one)

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_taxes_api.py`:

(a) `test_what_if_empty_scenario_echoes_baseline` — the exact `body["delta"] == {…}` dict gains one line after `"capital_gains_tax": "0.00",`:

```python
        "niit_tax": "0.00",
```

(b) `test_what_if_override_crosses_the_niit_threshold` — after `assert body["delta"]["total_tax"] == "-5488.69"` add:

```python
    # C5's NIIT move now has its own delta line (2026-09-03 planning-sandboxes spec §13):
    # scenario NIIT 0.00 − baseline 75.59, the two summaries' subtraction and nothing else.
    assert body["delta"]["niit_tax"] == "-75.59"
    assert Decimal(body["delta"]["niit_tax"]) == Decimal(body["scenario"]["niit"]["tax"]) - Decimal(
        body["baseline"]["niit"]["tax"]
    )
```

(c) Append, after `test_what_if_writes_nothing`:

```python
def test_what_if_delta_without_a_niit_line_still_validates():
    """Additive: the assistant's compact result and stored older payloads carry no niit_tax."""
    from app.schemas.taxes import WhatIfDelta

    delta = WhatIfDelta(
        total_tax=Decimal("0.00"),
        take_home=Decimal("0.00"),
        federal_tax=Decimal("0.00"),
        state_tax=Decimal("0.00"),
        medicare_tax=Decimal("0.00"),
        social_security_tax=Decimal("0.00"),
        disability_tax=Decimal("0.00"),
        capital_gains_tax=Decimal("0.00"),
        effective_rate=None,
    )
    assert delta.niit_tax is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_taxes_api.py -q -k "what_if_empty or niit"`
Expected: the two API tests FAIL (no `niit_tax` key); the validation test fails on the unknown attribute.

- [ ] **Step 3: Implement**

`backend/app/schemas/taxes.py` — in `WhatIfDelta`, after `capital_gains_tax: Decimal`:

```python
    # NIIT (2026-09-03 planning-sandboxes spec §13): scenario.niit.tax − baseline.niit.tax
    # when both summaries carry a NIIT block, else None. Additive and defaulted, so the
    # assistant's compact result and older payloads keep validating.
    niit_tax: Decimal | None = None
```

`backend/app/api/taxes.py` — in `what_if`, inside the `WhatIfDelta(` construction after `capital_gains_tax=…,`:

```python
        niit_tax=(
            None
            if scenario.niit is None or baseline.niit is None
            else scenario.niit.tax - baseline.niit.tax
        ),
```

- [ ] **Step 4: Run the taxes suite**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_taxes_api.py tests/test_assistant_tools.py -q`
Expected: all passed (the assistant's compact result serializes the delta with `niit_tax` present — additive).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/taxes.py backend/app/api/taxes.py backend/tests/test_taxes_api.py
git commit -m "feat(api): WhatIfDelta.niit_tax — the two summaries' NIIT difference, null without a NIIT block"
```

---

### Task 5: `forbid_writes` and the purity walk

**Files:**
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_sandbox_purity.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_sandbox_purity.py
"""The sandbox conformance test (2026-09-03 planning-sandboxes spec §14): no sandbox path
writes. Routes are DISCOVERED from app.routes — every path ending in /preview or /what-if,
plus GET /projection — so a future preview endpoint without a registered body fails here
the day it is mounted. Each route is called with a valid body under `forbid_writes` (any
flush carrying new/dirty/deleted objects fails the test) and every table's row count must
be unchanged afterwards."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import func, select

from app.database import Base
from app.main import app
from app.models import Account, AccountBalance, NetWorthSnapshot, Person
from app.seed import seed_tax_definitions
from tests.test_tax_service import YEAR_BRACKETS, YEAR_INPUTS

PROFILES = "/api/v1/paycheck/profiles"

# (method, path) → a body that computes a NON-trivial scenario against `seed_everything`.
SANDBOX_BODIES: dict[tuple[str, str], dict | None] = {
    ("POST", "/api/v1/paycheck/preview"): {
        "overrides": {"trad_401k_pct": "0.15", "hsa_per_check": "250", "hsa_coverage": "family"}
    },
    ("POST", "/api/v1/taxes/what-if"): {
        "year": 2024,
        "overrides": {"qualified_dividends": "2500", "interest_total": None},
    },
    ("GET", "/api/v1/projection"): None,
}


def sandbox_routes() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods:
            if method in {"HEAD", "OPTIONS"}:
                continue
            is_sandbox = (
                route.path.endswith("/preview")
                or route.path.endswith("/what-if")
                or (route.path == "/api/v1/projection" and method == "GET")
            )
            if is_sandbox:
                found.append((method, route.path))
    return sorted(found)


async def row_counts(db) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in Base.metadata.sorted_tables:
        counts[table.name] = (
            await db.execute(select(func.count()).select_from(table))
        ).scalar_one()
    return counts


async def seed_everything(auth_client, db) -> None:
    """Enough for all three routes to answer 200: a person with a profile, the 2024 tax
    year through the real editors, and one investable snapshot. Committed BEFORE the
    guard is engaged."""
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    resp = await auth_client.post(
        PROFILES,
        json={
            "effective_date": "2020-01-01",
            "annual_salary": "120000",
            "pay_periods_per_year": 24,
            "trad_401k_pct": "0.10",
            "hsa_per_check": "100",
        },
    )
    assert resp.status_code == 201, resp.text
    await seed_tax_definitions(db)
    await db.commit()
    inputs = {key: str(value) for key, value in YEAR_INPUTS[2024].items()}
    resp = await auth_client.put("/api/v1/taxes/years/2024/inputs", json={"values": inputs})
    assert resp.status_code == 200, resp.text
    brackets = {
        name: [{"rate": str(rate), "threshold": str(threshold)} for rate, threshold in table]
        for name, table in YEAR_BRACKETS[2024].items()
    }
    resp = await auth_client.put(
        "/api/v1/taxes/years/2024/brackets", json={"jurisdictions": brackets}
    )
    assert resp.status_code == 200, resp.text
    taxable = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    snap = NetWorthSnapshot(month=date.today().replace(day=1))
    db.add_all([taxable, snap])
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=snap.id, account_id=taxable.id, balance=Decimal("100000.00"))
    )
    await db.commit()


def test_every_sandbox_route_has_a_registered_body():
    """Discovery ↔ registry, both ways: a new preview route must be added to SANDBOX_BODIES
    (and thereby walked), and a registered path must still be mounted."""
    assert set(sandbox_routes()) == set(SANDBOX_BODIES)


@pytest.mark.parametrize("method,path", sorted(SANDBOX_BODIES))
async def test_sandbox_route_writes_nothing(auth_client, db, forbid_writes, method, path):
    await seed_everything(auth_client, db)
    before = await row_counts(db)
    with forbid_writes():
        if method == "GET":
            resp = await auth_client.get(path)
        else:
            resp = await auth_client.post(path, json=SANDBOX_BODIES[(method, path)])
    assert resp.status_code == 200, resp.text
    db.expire_all()  # re-read from Postgres, not from the identity map
    assert await row_counts(db) == before


async def test_forbid_writes_catches_a_write(db, forbid_writes):
    """The guard itself: a flush with a new object inside the block fails loudly."""
    with pytest.raises(AssertionError, match="write attempted under forbid_writes"):
        with forbid_writes():
            db.add(Person(name="Ghost", is_primary=True))
            await db.flush()
    await db.rollback()
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_sandbox_purity.py -q`
Expected: FAIL — `fixture 'forbid_writes' not found` (the discovery test alone passes once Task 2 is in).

- [ ] **Step 3: Add the fixture** — in `backend/tests/conftest.py`, add `from contextlib import contextmanager` and `from sqlalchemy import event, text` (extend the existing `text` import), then append:

```python
@pytest.fixture
def forbid_writes(db):
    """A context-manager FACTORY: inside `with forbid_writes():` any flush of the shared test
    session that carries new, dirty or deleted objects fails the test (2026-09-03
    planning-sandboxes spec §14). A factory rather than an always-on fixture so a test can
    seed and commit first, then engage the guard around the one request under proof.

    Attached to the SYNC session underneath the AsyncSession — SQLAlchemy's ORM events are
    dispatched there. Removed in `finally`, so a failing assertion cannot leave the listener
    on a session the next test reuses.
    """

    @contextmanager
    def guard():
        def refuse(session, flush_context, instances):
            if session.new or session.dirty or session.deleted:
                raise AssertionError(
                    "write attempted under forbid_writes: "
                    f"new={list(session.new)} dirty={list(session.dirty)} "
                    f"deleted={list(session.deleted)}"
                )

        sync_session = db.sync_session
        event.listen(sync_session, "before_flush", refuse)
        try:
            yield
        finally:
            event.remove(sync_session, "before_flush", refuse)

    return guard
```

- [ ] **Step 4: Run**

Run: `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest tests/test_sandbox_purity.py -q`
Expected: 5 passed (1 discovery + 3 routes + the guard's own test). If the projection route 404s with "no net-worth snapshots", `investable_base` excludes the account — check the seed uses `group="taxable"` and a balance on THIS month's snapshot. If the what-if 409s, the 2024 year's filing status is not single — the PUTs above create it single by default.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_sandbox_purity.py
git commit -m "test(api): forbid_writes guard and the sandbox purity walk over every preview/what-if route and GET /projection"
```

---

### Task 6: Frontend client and types — `previewPaycheck()`

**Files:**
- Modify: `src/types/api.ts`, `src/api/paycheck.ts`
- Test: `src/api/paycheck.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `src/api/paycheck.test.ts` (add `previewPaycheck` to the file's existing `import { … } from './paycheck'`; if the file already mocks `./client`, reuse that mock instead of the spy below and assert on `apiReadOnly`'s calls the way `src/api/whatif.test.ts` does):

```ts
describe('previewPaycheck', () => {
  it('POSTs the scenario to /paycheck/preview through apiReadOnly — a preview is a read', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const body = { profile_id: 7, person_id: null, overrides: { trad_401k_pct: '0.15', hsa_coverage: 'family' as const } }
    await previewPaycheck(body)
    expect(spy.mock.calls[0][0]).toBe('/api/v1/paycheck/preview')
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect((spy.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify(body))
    spy.mockRestore()
  })
})
```

(Ensure `vi` and `describe/it/expect` are imported at the top of the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/api/paycheck.test.ts`
Expected: FAIL — `previewPaycheck` is not exported.

- [ ] **Step 3: Implement**

`src/types/api.ts` — after `PaycheckBreakdownOut`:

```ts
// --- paycheck: the "Try it" sandbox (POST /paycheck/preview, 2026-09-03 planning-sandboxes spec §13) ---
// Nothing is stored. `overrides` is the server's ProfileOverrides (extra keys 422): every
// field optional, in the WIRE vocabulary — fractions for the five pcts, money strings for
// the per-check amounts, the coverage tier as stored. The percent shift happens in
// SliderBox's box and nowhere else.

export interface PaycheckPreviewOverrides {
  annual_salary?: string
  pay_periods_per_year?: number
  trad_401k_pct?: string
  roth_401k_pct?: string
  after_tax_401k_pct?: string
  espp_pct?: string
  withholding_pct?: string
  dental_vision_per_check?: string
  hsa_per_check?: string
  hsa_coverage?: HsaCoverage
}

export interface PaycheckPreviewIn {
  /** The base — the same two selectors GET /breakdown takes; both null = the primary's
   *  profile in force. */
  profile_id: number | null
  person_id: number | null
  overrides: PaycheckPreviewOverrides
}

/** The eleven waterfall lines plus `savings` (trad + Roth + after-tax + ESPP + HSA), each a
 *  2dp string; in a `delta` block each is the difference of two such figures. */
export interface PaycheckPreviewLines {
  gross: string
  trad_401k: string
  dental_vision: string
  hsa: string
  taxable: string
  withholding: string
  post_tax: string
  roth_401k: string
  after_tax_401k: string
  espp: string
  net_pay: string
  savings: string
}

export interface PaycheckPreviewBlock {
  baseline: PaycheckPreviewLines
  scenario: PaycheckPreviewLines
  delta: PaycheckPreviewLines
}

export interface PaycheckChangedField {
  key: keyof PaycheckPreviewOverrides
  label: string
  before: string
  after: string
}

export interface PaycheckPreviewOut {
  profile: PaycheckProfileOut
  per_check: PaycheckPreviewBlock
  monthly: PaycheckPreviewBlock
  annual: PaycheckPreviewBlock
  pace: { baseline: PaceItem[]; scenario: PaceItem[] }
  changed: PaycheckChangedField[]
  /** Scenario-side advisories only — the breakdown's own two sentences. */
  warnings: string[]
}
```

`src/types/api.ts` — in `WhatIfDelta`, after `capital_gains_tax: string`:

```ts
  // NIIT delta (2026-09-03 planning-sandboxes spec §13). OPTIONAL: pinned fixtures and the
  // assistant's compact result predate it; null when either summary has no NIIT block.
  niit_tax?: string | null
```

`src/api/paycheck.ts` — change the client import to `import { api, apiReadOnly } from './client'`, add `PaycheckPreviewIn, PaycheckPreviewOut` to the type import, and append:

```ts
// The "Try it" sandbox's one request (2026-09-03 planning-sandboxes spec §13): the profile
// GET /breakdown would show, against the same profile with `overrides` applied. Pure —
// SELECTs only server-side — so it rides apiReadOnly and never touches the snapshot cache.
// 404 "no paycheck profiles" / "paycheck profile not found" / "person not found" and 422s
// in the profile writers' own words, rendered verbatim by the panel.
export function previewPaycheck(body: PaycheckPreviewIn): Promise<PaycheckPreviewOut> {
  return apiReadOnly<PaycheckPreviewOut>('/paycheck/preview', body)
}
```

- [ ] **Step 4: Run**

Run: `npx vitest run src/api/paycheck.test.ts && npx tsc -b`
Expected: PASS; types clean.

- [ ] **Step 5: Commit**

```bash
git add src/types/api.ts src/api/paycheck.ts src/api/paycheck.test.ts
git commit -m "feat(api-client): previewPaycheck() via apiReadOnly; PaycheckPreview* types; WhatIfDelta.niit_tax"
```

---

### Task 7: Ruff, whole backend suite, frontend types

- [ ] **Step 1: Backend**

Run (from `<worktree>/backend`): `FINANCE_TEST_DB=finance_test_sandbox_be <venv-python> -m pytest -q && <venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`
Expected: all passed (1309+ existing plus this lane's ~25); ruff clean. If `ruff format --check` flags the long `lambda` lines in `preview`, run `ruff format app/api/paycheck.py` and re-check.

- [ ] **Step 2: Frontend**

Run: `npx tsc -b && npx eslint src/api/paycheck.ts src/types/api.ts && npx vitest run src/api`
Expected: clean.

- [ ] **Step 3: Report**

The lane report names the wire shape of `PreviewOut` (for lane P), the `niit_tax` field (for lane T), the `forbid_writes` usage (`with forbid_writes(): …`) and the `SANDBOX_BODIES` registry (for anyone adding a preview route later).

---

## Self-review

**Spec coverage:** §13 `POST /paycheck/preview` request/response, base selection identical to `GET /breakdown` (explicit row wins, absent = primary, 404 words), `ProfileOverrides` `extra='forbid'` validated by the writers' helpers word for word, dataclass copy of the ORM row, `today` read once, `Lines` = eleven keys + `savings` over `PAYROLL_SAVING_KEYS`, monthly/annual scaled on the full-precision chain then quantized, deltas as differences of `half_up2` figures, SELECT-only handler → Tasks 1–3. §13 `_resolve_breakdown_profile`/`_scenario_profile` extraction with `get_breakdown` using the first → Task 2. §13 `WhatIfDelta.niit_tax` additive → Task 4. §14 pytest list (empty overrides ≡ breakdown field by field, overrides ≡ a real profile then deleted, every 422 text equals the writer's, unknown key, 404, `profile_id` beats `person_id`, `changed` only moved keys, scaling and `savings` pinned by hand; `niit_tax` equals the summaries' difference and validates absent; `forbid_writes` + the purity walk over `/preview`, `/what-if` and `GET /projection` with unchanged row counts) → Tasks 2–5. §15 lane B's `previewPaycheck()` and its types → Task 6. No migration, no change to `GET /projection` — honoured (projection.py only swaps a constant for an import). **Placeholders:** none. **Type consistency:** `PreviewIn.overrides: ProfileOverrides`, `PreviewOut.{profile, per_check, monthly, annual, pace{baseline,scenario}, changed[{key,label,before,after}], warnings}` match the TS `PaycheckPreviewOut`; `PAYROLL_SAVING_KEYS`/`WATERFALL_KEYS` names match between Task 1 and Task 2; `forbid_writes()` is called as a context-manager factory in both the fixture and every test.
