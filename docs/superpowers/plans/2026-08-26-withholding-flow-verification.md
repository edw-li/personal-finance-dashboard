# Two-Earner Withholding + Money-Flow + Batch Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION DECISIONS (orchestrator, 2026-08-26 — authoritative; this resolves Step 0.5 in advance):** The tax-schema-engine plan landed **`_engine_feed(db, year)`** as the single person-summed loader: it OWNS both collapse points (`_stored_inputs` is deleted; `get_all_summaries` builds one feed per year), `api/overview.py` already imports `_engine_feed`, and `compose_money_flow` is already threaded with `filing_status`/`earners`. Therefore: **Tasks 1 and 2 are tests-only** per this plan's own reconciliation rule — keep every test, drop the body edits, and where test code references `_summed_inputs`/`_sum_input_rows`, assert through the public endpoints (or `_engine_feed`) instead. Do not re-introduce `_summed_inputs`. Everything from Task 3 onward stands as written (it never touches `compute_breakdown` arguments other than the inputs source, which is now the feed).

**Goal:** Close the last three gaps of the married-taxes batch per `docs/superpowers/specs/2026-08-26-household-foundation-married-taxes-design.md` §5.6/§5.7/§7 and `docs/superpowers/specs/2026-08-26-marriage-readiness-audit.md` §3.2/§3.4: (a) make `/taxes/years/{y}/withholding` a **two-earner** tracker — primary simulated exactly as today, partner annualized from their own tax-input rows — that names the **Additional-Medicare under-withholding trap** in dollars; (b) make every engine feed **person-summed** so the money-flow card and the Overview YTD tile stop silently dropping the partner's W-2 (the §3.4 landmine: partner cash without partner income drives `retained_equity` negative and blanks the card); (c) run the whole batch's verification — full suites, lint, build, and a real-data browser smoke of every married surface.

**Architecture:** Two collapse points are the whole money-flow story. `api/taxes.py:_stored_inputs:134-136` builds `{row.key: row.value}` and `api/taxes.py:get_all_summaries:519-521` builds `inputs_by_year[year][row.key] = row.value` — both are **dict overwrites keyed on `key` alone**, so once `tax_inputs` carries `person_id` the partner's `latest_w2_income` row silently replaces (or is replaced by) the primary's, planner-order-dependent. One new pure helper `_sum_input_rows` plus one new loader `_summed_inputs` fixes both, and `api/overview.py:20` inherits it by import (`money_flow.py` itself is a pure module and is **not edited** — it reads the dict the router hands it). The withholding side keeps `withholding_calc.py` pure: `estimate()` gains four keyword-only wage/withholding parameters that default to `ZERO`/`None`, so the single-earner path is arithmetically unchanged, and the additional-Medicare gap is derived from the **stored medicare table** (the surtax tier is data, the $200k per-employer floor is statute). The router owns person bucketing and the wire shape; the engine call at `taxes.py:592` is left **verbatim** so this plan cannot conflict with the tax-schema-engine plan's `filing_status=`/`earners=` arguments.

**Tech Stack:** FastAPI + async SQLAlchemy 2 + pydantic v2 (backend, `backend/.venv`), React 19 + TS + Vite (frontend), pytest / vitest, ruff (line-length 100), Postgres in Docker on `127.0.0.1:5433`.

---

## Preconditions (merged before this plan — treat as existing)

| Thing | Assumed shape | Used by |
|---|---|---|
| `people` table | `app.models.Person` — `id`, `name`, `is_primary` bool; exactly one primary ("Me"), partner optional | Tasks 2, 4, 6 |
| `tax_years.filing_status` | `String(20)` NOT NULL default `'single'`; `single \| married_joint \| married_separate` | Tasks 2, 4, 5 |
| `tax_inputs.person_id` | nullable FK → `people`; unique `(year, key, person_id)` NULLS NOT DISTINCT; NULL = household | Tasks 1, 2, 4 |
| Tracker keys | `w2_fed_withholding` / `w2_state_withholding` seeded in `tax_input_definitions`, `is_per_person=True`, **not** in `ENGINE_INPUT_KEYS` | Tasks 4, 6 |
| Engine | `compute_breakdown(year, inputs, brackets, *, filing_status=..., earners=[EarnerWages(w2_wages=...)])` | left verbatim |
| `_engine_tables` | status-aware (selects bracket rows by the year's filing status) | left verbatim |
| `brackets_missing_for_status` | `list[str]` on `TaxBreakdown` / summary + withholding responses | Tasks 4, 6 |
| Taxes UI | per-person input columns already render (separate plan) — the tracker keys are therefore already **editable** in `InputsForm` | Task 6 (drives the read-only partner section) |

### RECONCILIATION — interfaces this plan assumed (the tax-schema-engine plan does not exist on disk at authoring time)

`docs/superpowers/plans/2026-08-26-tax-schema-engine.md` was **absent** when this plan was written, so every name above is specced against the current `backend/app/api/taxes.py`. Before dispatching Task 1, run the greps in **Step 0.5** and apply these rules:

1. **If the engine plan already made `_stored_inputs` person-summing, or replaced it with its own summing loader** (`_engine_inputs`, `_summed_inputs`, …): Task 1 collapses to its *tests only* — keep every test, drop the body edits, and point them at the existing helper's name.
2. **`_stored_inputs` is deliberately left alone as a raw point-read** by this plan (`_inputs_payload:162` uses it for the editor's display values + `derive_suggestions`). Summing there is the Taxes-UI plan's call, not this one's. If the engine plan already changed it, do not change it back.
3. **Never edit the `compute_breakdown(...)` call at `api/taxes.py:592`** (or `:513`, `:540`, `:698`, `:873-874`) beyond swapping the *inputs argument* to `_summed_inputs(...)`. Whatever `filing_status=`/`earners=` arguments the engine plan added stay exactly as they are.
4. **`Person`**: if the household plan named the model `HouseholdMember` (or put it at a different module), rename in Tasks 2/4/6 only — nothing else depends on it.
5. **`TaxBreakdown.brackets_missing_for_status`**: Step 4.0 verifies it. If the engine plan surfaced the state only on `TaxSummaryOut` and not on the dataclass, Step 4.0 says exactly what to write instead.
6. **Safe-harbor AGI gate**: §5.6 assigns it to the engine plan, at `api/taxes.py:566`. Task 5 **verifies first, implements if absent** — either way it owns the boundary tests and the response field.

---

## Conventions that bind every task

- Money crosses the wire as **Decimal strings** (pydantic v2). Never a float, on either side.
- Python lines ≤ **100 chars** (ruff). Run `ruff check` + `ruff format` before every commit.
- Backend tests need the Docker DB up; `conftest.py` creates/drops `finance_test` off `settings.database_url`. **Exactly ONE pytest runner at a time** — the shared `finance_test` is not concurrency-safe.
- Exact pytest invocation (from `backend/pyproject.toml`: `testpaths = ["tests"]`, `asyncio_mode = "auto"`, both loop scopes session):
  `cd backend && .venv/Scripts/python.exe -m pytest tests/<file>.py -q`
- New backend tests write person-scoped rows **through the ORM**, never through the PUTs — the PUT's person vocabulary belongs to another plan and these tests must not depend on it.
- Never pipe a test run through `grep`/`head` before a commit gate (exit-code masking).
- Frontend: no `setState` in an effect's synchronous body; every `$`/`%` literal in a test must match `formatCurrency` / `formatPct` output exactly (when a literal disagrees with the util, fix the literal).

---

### Task 0: Environment + baseline + interface reconciliation (orchestrator, no subagent)

- [ ] **Step 0.1:** `cd C:/Users/edyli/personal-finance-dashboard && git status --short` — record what is dirty; work on a branch cut from local `main`.
- [ ] **Step 0.2:** Docker DB up: `docker ps --format "{{.Names}} {{.Ports}}"` must list `finance-dashboard-db-1` on `127.0.0.1:5433`. If not: `cmd //c start "" "Docker Desktop"`, wait, `docker start finance-dashboard-db-1`.
- [ ] **Step 0.3:** `cd backend && .venv/Scripts/python.exe -m alembic heads` — must be a **single** head. Record it; the batch's migrations are already applied by the preceding plans.
- [ ] **Step 0.4: Baseline gates — record the numbers, they are every later "expected" figure's base.**
  - `cd backend && .venv/Scripts/python.exe -m pytest -q` → record `N_py passed`.
  - `npm test` → record `N_ts passed` (known flake: TransactionsPanel "save changes" — rerun once if it is the sole failure).
- [ ] **Step 0.5: Reconciliation greps** — record each answer in the run log before dispatching Task 1:
  ```bash
  cd C:/Users/edyli/personal-finance-dashboard/backend
  grep -n "_stored_inputs\|_summed_inputs\|_engine_inputs\|_sum_input_rows" app/api/taxes.py app/api/overview.py
  grep -n "brackets_missing_for_status" app/services/tax_service.py app/schemas/taxes.py app/api/taxes.py
  grep -n "SAFE_HARBOR" app/api/taxes.py
  grep -rn "class Person\|__tablename__ = \"people\"" app/models/
  grep -n "filing_status" app/models/taxes.py
  grep -n "w2_fed_withholding\|w2_state_withholding\|is_per_person" app/tax_keys.py app/models/taxes.py
  ```
- [ ] **Step 0.6:** If **any** precondition grep comes back empty, STOP and report — this plan is the last task of the batch and cannot run ahead of the schema/engine/UI plans.

---

### Task 1: Person-summed engine feed (the two collapse points)

**Files:**
- Modify: `backend/app/api/taxes.py` — insert after `_stored_inputs` (currently `:134-136`); swap the inputs argument at `get_summary:513`, `get_withholding:592`, the prior-year read `:698`, and `what_if:755`; fix `get_all_summaries:519-521`.
- Modify: `backend/tests/test_taxes_api.py` (append).

- [ ] **Step 1.1: Failing test** — append to `backend/tests/test_taxes_api.py`:

```python
# --- person-summed engine feed (2026-08-26 spec §5.4/§5.7) ---
#
# `tax_inputs` is unique on (year, key, person_id), so ONE key legitimately carries several
# rows. Every engine caller must SUM them; a dict keyed on `key` alone silently keeps
# whichever row the planner returned last, which is a partner's whole W-2 disappearing from
# the liability, the money flow and the YTD tile depending on nothing but query order.


async def _seed_people(db):
    """(primary id, partner id) — the household this batch's fixtures share."""
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    return me.id, partner.id


async def _seed_two_earner_year(db, year: int, status: str = "married_joint"):
    """One married year: 240k of primary W-2 + 150k of partner W-2, flat MFJ tables."""
    me_id, partner_id = await _seed_people(db)
    db.add(TaxYear(year=year, filing_status=status))
    await db.flush()
    db.add_all(
        [
            TaxInput(
                year=year, key="latest_w2_income", value=Decimal("240000"), person_id=me_id
            ),
            TaxInput(
                year=year, key="latest_w2_income", value=Decimal("150000"), person_id=partner_id
            ),
            # A HOUSEHOLD key: one NULL row, which must survive the sum verbatim.
            TaxInput(year=year, key="interest_total", value=Decimal("2500"), person_id=None),
        ]
    )
    for name, table in (
        ("federal", [("0.1000", "0.00")]),
        ("state", [("0.0500", "0.00")]),
        ("medicare", [("0.0145", "0.00"), ("0.0235", "250000.00")]),
        ("social_security", [("0.0620", "0.00"), ("0.0000", "168600.00")]),
        ("disability", [("0.0110", "0.00")]),
        ("capital_gains", [("0.1500", "0.00")]),
    ):
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                    filing_status=status,
                )
            )
    await db.commit()
    return me_id, partner_id


async def test_summary_sums_w2_across_people_instead_of_keeping_one_row(
    auth_client, db, definitions
):
    await _seed_two_earner_year(db, 2026)
    resp = await auth_client.get(f"{YEARS}/2026/summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 240000 + 150000 — NOT 240000 and NOT 150000. This is the whole bug: a point read
    # returns one of the two and the assertion below fails on whichever the planner picked.
    assert body["medicare"]["w2_income"] == "390000.00"
    # The household key rides along untouched: gross = 390000 wages + 2500 interest.
    assert body["totals"]["gross_income"] == "392500.00"


async def test_all_summaries_feed_sums_people_too(auth_client, db, definitions):
    # /taxes/summary builds its OWN inputs dict in one all-years query (it does not call the
    # per-year loader), so it is a SECOND collapse point and needs its own pin — this is the
    # feed behind the Overview page's YTD effective-tax tile.
    await _seed_two_earner_year(db, 2026)
    resp = await auth_client.get(ALL_SUMMARY)  # the file's own constant, already defined
    assert resp.status_code == 200, resp.text
    years = resp.json()["years"]
    assert [row["year"] for row in years] == [2026]
    assert years[0]["medicare"]["w2_income"] == "390000.00"
    assert years[0]["totals"]["gross_income"] == "392500.00"


async def test_single_year_inputs_are_byte_identical_under_summing(auth_client, db, definitions):
    # The single path must not move: after the migration a single filer's per-person keys sit
    # on the PRIMARY person, and summing exactly one row is that row.
    me = Person(name="Me", is_primary=True)
    db.add(me)
    await db.flush()
    db.add(TaxYear(year=2025, filing_status="single"))
    await db.flush()
    db.add_all(
        [
            TaxInput(
                year=2025, key="latest_w2_income", value=Decimal("240000"), person_id=me.id
            ),
            TaxInput(year=2025, key="interest_total", value=Decimal("2500"), person_id=None),
            TaxInput(
                year=2025,
                key="unq_div_state_exempt_pct",
                value=Decimal("0.4500"),
                person_id=None,
            ),
        ]
    )
    db.add_all(
        [
            TaxBracket(
                year=2025,
                jurisdiction="federal",
                bracket_index=1,
                rate=Decimal("0.1000"),
                threshold=Decimal("0.00"),
                filing_status="single",
            ),
            TaxBracket(
                year=2025,
                jurisdiction="medicare",
                bracket_index=1,
                rate=Decimal("0.0145"),
                threshold=Decimal("0.00"),
                filing_status="single",
            ),
        ]
    )
    await db.commit()

    body = (await auth_client.get(f"{YEARS}/2025/summary")).json()
    assert body["medicare"]["w2_income"] == "240000.00"
    assert body["totals"]["gross_income"] == "242500.00"
    assert body["federal"]["tax"] == "24250.00"  # 10% of 242500, no deductions stored
```

  Add to that file's imports whatever is missing — it already imports `Decimal`, `TaxBracket`, `TaxInput`, `TaxYear` and defines `YEARS` / the `definitions` fixture; add `Person` to the `app.models` import.

- [ ] **Step 1.2: Run — expect a FAILURE that names the collapse.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q -k "sums_w2_across_people or all_summaries_feed_sums or byte_identical_under_summing"`
  Expected: `2 failed, 1 passed` — the two summing tests fail with `assert '240000.00' == '390000.00'` (or `'150000.00'`, planner-dependent); the single-year identity test already passes and stays passing.

- [ ] **Step 1.3: Minimal implementation** — in `backend/app/api/taxes.py`, insert **directly below** `_stored_inputs` (after line 136):

```python
def _sum_input_rows(rows: Iterable[TaxInput]) -> dict[str, Decimal]:
    """One year's stored inputs collapsed to the engine's flat {key: value} shape by SUMMING
    across `person_id` (2026-08-26 spec §5.4).

    `tax_inputs` is unique on (year, key, person_id) NULLS NOT DISTINCT, so a single key
    legitimately carries a household row (person_id NULL) AND one row per person. A dict
    comprehension keyed on `row.key` alone keeps whichever row the planner returned LAST —
    a partner's entire W-2 vanishing from the liability, the money flow and the YTD tile,
    nondeterministically. Household keys have exactly one NULL row, so the sum IS that row
    verbatim (percentage keys like `unq_div_state_exempt_pct` are household-only by
    definition and therefore cannot be summed into nonsense); per-person keys sum, which is
    the engine's household-total contract. The per-earner split the FICA walks need is a
    SEPARATE assembly (`earners=`) and never this dict.
    """
    summed: dict[str, Decimal] = {}
    for row in rows:
        summed[row.key] = summed.get(row.key, ZERO) + row.value
    return summed


async def _summed_inputs(db: AsyncSession, year: int) -> dict[str, Decimal]:
    """The engine feed for ONE year — every engine caller's loader.

    `_engine_tables`'s rule, applied to the other half of the feed: ONE loader, so the
    summary, the trend, the what-if, the withholding card and the Overview money flow can
    never disagree about what the engine saw. `_stored_inputs` above stays a raw point read
    on purpose: it feeds the inputs EDITOR, which renders (and suggests for) one person's
    column at a time.
    """
    rows = (await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars()
    return _sum_input_rows(rows)
```

  Then swap the four per-year call sites (inputs argument only — leave every other argument exactly as it stands):
  - `get_summary` (`:513`): `_summary_out(compute_breakdown(year, await _summed_inputs(db, year), tables))`
  - `get_withholding` (`:592`): `liability = compute_breakdown(year, await _summed_inputs(db, year), tables)`
  - the prior-year read (`:698`): `year - 1, await _summed_inputs(db, year - 1), await _engine_tables(db, year - 1)`
  - `what_if` (`:755`): `stored = await _summed_inputs(db, year)`

  And fix `get_all_summaries`'s own loop (`:519-521`), which loads every year in one query and therefore cannot call the loader:

```python
    inputs_by_year: dict[int, dict[str, Decimal]] = {}
    for row in (await db.execute(select(TaxInput))).scalars():
        # `+=`, never `=`: person rows SUM (`_sum_input_rows`'s rule, spelled out again here
        # because this endpoint deliberately loads all years in ONE query). This is the feed
        # behind the Overview page's YTD effective-tax tile.
        year_inputs = inputs_by_year.setdefault(row.year, {})
        year_inputs[row.key] = year_inputs.get(row.key, ZERO) + row.value
```

- [ ] **Step 1.4: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q`
  Expected: baseline for that file + 3, 0 failed.
- [ ] **Step 1.5: No-regression sweep** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_whatif.py tests/test_withholding_api.py tests/test_overview_api.py -q`
  Expected: all pass unchanged (the golden suite is the gate: single-path values must not move).
- [ ] **Step 1.6: Ruff** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 1.7: Commit** — `git add backend/app/api/taxes.py backend/tests/test_taxes_api.py && git commit -m "fix(money-flow): sum tax inputs across people at every engine call site"`

---

### Task 2: Money flow + Overview inherit the summed feed

**Files:**
- Modify: `backend/app/api/overview.py` — import line `:20`, call site `:88`, module docstring `:3-9`.
- Modify: `backend/tests/test_overview_api.py` (append).
- **Not** modified: `backend/app/services/money_flow.py`. It is a pure module: `SALARY_KEYS:40-51`, the `value(key)` reads at `:157-169`, `take_home_cash = net_pay_sum` at `:181` and the negative-residual guard at `:79-82`/`:232-233` all stay byte-identical. The fix is upstream, in the dict the router hands it — which is exactly why the guard becomes unreachable by normal married data entry rather than being weakened.

- [ ] **Step 2.1: Failing test** — append to `backend/tests/test_overview_api.py`:

```python
# --- married years (2026-08-26 spec §5.7) ---
#
# The audit's §3.4 landmine: partner CASH (household net pay) entered without partner INCOME
# reaching the engine drives `retained_equity` negative and the whole card refuses to render.
# With a point-read feed, entering the partner's W-2 does not fix it — the partner's row and
# the primary's row fight over one dict slot. These tests pin that the card renders.

MFJ_BRACKETS = (
    ("federal", [("0.1000", "0.00")]),
    ("state", [("0.0500", "0.00")]),
    ("medicare", [("0.0145", "0.00"), ("0.0235", "250000.00")]),
    ("social_security", [("0.0620", "0.00"), ("0.0000", "168600.00")]),
    ("disability", [("0.0110", "0.00")]),
    ("capital_gains", [("0.1500", "0.00")]),
)


async def _seed_married_flow_year(db, year: int, with_brackets: bool = True) -> None:
    """Two earners' W-2 rows + a full year of HOUSEHOLD net pay — the exact combination the
    audit says blanks the card today."""
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    db.add(TaxYear(year=year, filing_status="married_joint"))
    await db.flush()
    db.add_all(
        [
            TaxInput(year=year, key="latest_w2_income", value=Decimal("200000"), person_id=me.id),
            TaxInput(
                year=year, key="latest_w2_income", value=Decimal("150000"), person_id=partner.id
            ),
            TaxInput(
                year=year,
                key="trad_401k_contributions",
                value=Decimal("23000"),
                person_id=me.id,
            ),
            TaxInput(
                year=year,
                key="trad_401k_contributions",
                value=Decimal("4300"),
                person_id=partner.id,
            ),
        ]
    )
    if with_brackets:
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
    for month in range(1, 13):  # a FULL year of household take-home
        db.add(MonthlyCashflow(month=date(year, month, 1), net_pay=Decimal("20000.00")))
    await db.commit()


async def test_money_flow_renders_for_a_two_earner_year(auth_client, db, definitions):
    year = product_today().year
    await _seed_married_flow_year(db, year)
    resp = await auth_client.get(MONEY_FLOW)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Both W-2s reach the engine: 200000 + 150000.
    assert body["gross_income"] == "350000.00"
    assert body["sources"]["salary_and_bonus"] == "350000.00"
    # Both 401k rows too — a point read would have kept one of 23000 / 4300.
    assert body["pre_tax_savings"] == "27300.00"
    assert body["take_home_cash"] == "240000.00"
    # THE POINT: the residual is non-negative, so the guard at money_flow.py:232-233 never
    # fires and the card draws. With a point-read feed gross is 200000 (or 150000) against
    # 240000 of household cash and the card blanks itself.
    assert Decimal(body["retained_equity"]) >= 0
    assert body["renderable"] is True
    assert body["reason"] is None
    # Conservation still exact at 2dp (the card's whole contract).
    assert Decimal(body["taxes"]["total"]) + Decimal(body["pre_tax_savings"]) + Decimal(
        body["take_home_cash"]
    ) + Decimal(body["retained_equity"]) == Decimal(body["gross_income"])


async def test_money_flow_degrades_gracefully_when_the_status_has_no_brackets(
    auth_client, db, definitions
):
    # MFJ selected before any MFJ table exists: every jurisdiction walks empty, so the tax
    # column is 0 and the engine's own per-jurisdiction warnings ride the passthrough. The
    # card must still DRAW (an all-zero tax ribbon is honest and drawable) rather than 500.
    year = product_today().year
    await _seed_married_flow_year(db, year, with_brackets=False)
    resp = await auth_client.get(MONEY_FLOW)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["gross_income"] == "350000.00"
    assert body["taxes"]["total"] == "0.00"
    assert body["renderable"] is True
    assert f"no federal brackets for {year}: federal tax computed as 0" in body["warnings"]
    assert f"no medicare brackets for {year}: medicare tax computed as 0" in body["warnings"]


async def test_money_flow_single_year_is_unchanged_by_summing(auth_client, db, definitions):
    # The single path, through the real PUTs, against the taxes summary — the same
    # cross-check the rest of this file uses. Nothing here may move.
    year = product_today().year
    await seed_tax_year(auth_client, year)
    await seed_spending_year(db, year)
    body = (await auth_client.get(MONEY_FLOW)).json()
    summary = (await auth_client.get(f"{YEARS}/{year}/summary")).json()

    assert body["gross_income"] == summary["totals"]["gross_income"]
    assert body["taxes"]["total"] == summary["totals"]["total_tax"]
    assert body["sources"]["salary_and_bonus"] == "220000.00"  # 200000 + 15000 + 5000
    assert body["renderable"] is True
```

  Extend that file's imports: `from app.models import MonthlyCashflow, MonthlySpending, Person, SpendingCategory, TaxBracket, TaxInput, TaxYear`.

- [ ] **Step 2.2: Run — expect a FAILURE that is the landmine itself.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_overview_api.py -q -k "two_earner or no_brackets or single_year_is_unchanged"`
  Expected: `test_money_flow_renders_for_a_two_earner_year` fails on `assert '200000.00' == '350000.00'` (or `'150000.00'`), and — once that line is reached — on `renderable is True` with `NEGATIVE_RESIDUAL_REASON`. The graceful-degrade test fails the same way on `gross_income`. The single-year test passes and stays passing.
  *(If Task 1 is already merged, the first two may pass at Step 2.2 — the import at `overview.py:20` is what still needs swapping; confirm by checking that `overview.py` still names `_stored_inputs` before declaring the step green.)*

- [ ] **Step 2.3: Minimal implementation** — in `backend/app/api/overview.py`:

  Line 20 becomes:
```python
from app.api.taxes import YEAR_MAX, YEAR_MIN, _engine_tables, _money, _summed_inputs
```
  Line 88 becomes:
```python
    inputs = await _summed_inputs(db, year)
```
  And the module docstring's second sentence (`:3-9`) becomes:
```python
Reads only. `GET /overview/money-flow` (2026-08-25 spec §5) loads one year's tax inputs +
brackets exactly the way the taxes router does — its `_summed_inputs`/`_engine_tables`,
IMPORTED, one loader per concept (app_settings.py's cross-router-borrow precedent) —
sums the calendar year's spending/cashflow, and hands everything to the pure
services.money_flow.compose_money_flow. `_summed_inputs`, not `_stored_inputs`: a married
year carries one input row PER PERSON, and the flow's reconciliation invariant only holds
when both earners' income reaches the engine that the household's cash is measured against
(2026-08-26 spec §5.7). GETs never reject stored data: an unknown or empty year answers 200
with renderable=False and a reason sentence, never a 404.
```

- [ ] **Step 2.4: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_overview_api.py tests/test_money_flow.py -q`
  Expected: `test_money_flow.py` unchanged (pure module, untouched); `test_overview_api.py` baseline + 3, 0 failed.
- [ ] **Step 2.5: Ruff** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 2.6: Commit** — `git add backend/app/api/overview.py backend/tests/test_overview_api.py && git commit -m "fix(money-flow): person-summed inputs keep the residual invariant on married years"`

---

### Task 3: `withholding_calc` — partner leg + the Additional-Medicare gap (pure service)

**Files:**
- Modify: `backend/app/services/withholding_calc.py` — constants block (`:36-44`), `WithholdingEstimate` (`:50-64`), `estimate` signature (`:79-89`) and its tail (before the `return` at `:122`).
- Modify: `backend/tests/test_withholding_calc.py` (append).

Design notes that belong in the code, not just here:
- The surtax **tier is data**: the medicare table models Form 8959's 0.9% as a second row whose rate is base + surtax, so `rate = top - base` and `threshold = top floor` (250,000 on an MFJ table, 125,000 on MFS, 200,000 on single). A one-row table has no tier ⇒ gap 0, which is why every existing fixture is untouched.
- The **$200,000 per-employer floor is statute** (each employer withholds only above its own wages, whatever the return says) and belongs in code as a constant.
- Using the tier's own rate on **both** sides makes the gap purely a *threshold* effect — exactly the trap being named — instead of mixing a stored rate against a hardcoded one.
- For **one** earner the two sides are the same expression, so the gap is exactly `0` with no branch: that is what keeps the single path byte-identical even when its table carries a 200k tier.
- The gap is **signed**. Negative means over-withholding (one high earner, a low-earning spouse); the card does not shout about it but does not hide it either.

- [ ] **Step 3.1: Failing test** — append to `backend/tests/test_withholding_calc.py`:

```python
# --- two-earner block (2026-08-26 spec §5.6) ---

# An MFJ medicare table: 1.45% base, then the 0.9% surtax folded into a 2.35% row at the
# JOINT threshold. The single table below carries the same tier at 200,000.
MEDICARE_MFJ = [(D("0.0145"), D("0")), (D("0.0235"), D("250000"))]
MEDICARE_SINGLE = [(D("0.0145"), D("0")), (D("0.0235"), D("200000"))]

PARTNER_MISSING = (
    "partner withholding not entered — their W-2 withholding counts as 0 until you enter it"
)


def run(**over):
    """`estimate` with the salary/vest legs neutralised — these tests are about the
    two-earner block only, so no profiles and no vests."""
    kwargs = dict(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    kwargs.update(over)
    return estimate(**kwargs)


def test_additional_medicare_tier_is_read_off_the_stored_table():
    assert additional_medicare_tier(MEDICARE_MFJ) == (D("0.0090"), D("250000"))
    assert additional_medicare_tier(MEDICARE_SINGLE) == (D("0.0090"), D("200000"))
    # A flat table has no tier at all, and neither does an empty one.
    assert additional_medicare_tier(MEDICARE) is None
    assert additional_medicare_tier([]) is None
    # A terminal 0-rate row (the SS wage-base shape) is a CAP, not a surtax tier.
    assert additional_medicare_tier(SS) is None


def test_additional_medicare_gap_is_the_two_earner_trap_in_dollars():
    # 240k + 150k = 390k combined. Owed on a joint return: (390000 - 250000) x 0.9% = 1260.
    # Withheld by the two employers: only the 40k above ONE employer's 200k = 360. The
    # 900.00 difference is the trap: neither salary alone crosses 200k of its own employer's
    # wages far enough to cover a joint liability that starts at 250k.
    result = run(
        medicare=MEDICARE_MFJ, primary_wages=D("240000"), partner_wages=D("150000")
    )
    assert result.additional_medicare_gap == D("900.00")


def test_additional_medicare_gap_is_zero_for_one_earner_on_a_single_table():
    # The self-cancelling case, and the reason the single path needs no branch: one earner's
    # owed side and their employer's withheld side are the SAME expression.
    result = run(medicare=MEDICARE_SINGLE, primary_wages=D("390000"), partner_wages=ZERO_D)
    assert result.additional_medicare_gap == D("0.00")


def test_additional_medicare_gap_goes_negative_when_one_earner_carries_the_household():
    # 390k from one job on a JOINT table: the employer withholds above its own 200k while
    # the return only owes above 250k, so 450.00 is over-withheld. Signed, not clamped.
    result = run(medicare=MEDICARE_MFJ, primary_wages=D("390000"), partner_wages=ZERO_D)
    assert result.additional_medicare_gap == D("-450.00")


def test_additional_medicare_gap_is_zero_without_a_surtax_tier():
    result = run(medicare=MEDICARE, primary_wages=D("240000"), partner_wages=D("150000"))
    assert result.additional_medicare_gap == D("0.00")


def test_partner_withholding_sums_both_jurisdictions():
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_withheld_fed=D("18000"),
        partner_withheld_state=D("6000"),
    )
    assert result.partner_withheld_total == D("24000.00")
    assert result.warnings == []


def test_partner_with_wages_but_no_withholding_entered_warns_and_counts_zero():
    # Entered-not-simulated is the whole asymmetry of this leg: an empty field is a 0, and
    # a silent 0 here would understate the household's withholding without saying so.
    result = run(medicare=MEDICARE_MFJ, primary_wages=D("240000"), partner_wages=D("150000"))
    assert result.partner_withheld_total == D("0.00")
    assert result.warnings == [PARTNER_MISSING]


def test_one_entered_jurisdiction_is_enough_to_silence_the_warning():
    # Zero state withholding is a real answer (a no-income-tax state, or a W-4 that zeroed
    # it); only BOTH fields being unset means "not entered".
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_withheld_fed=D("18000"),
    )
    assert result.partner_withheld_total == D("18000.00")
    assert result.warnings == []


def test_no_partner_means_no_warning_and_no_partner_total():
    result = run(medicare=MEDICARE_MFJ, primary_wages=D("240000"))
    assert result.partner_withheld_total == D("0.00")
    assert result.warnings == []


def test_single_earner_defaults_leave_the_estimate_byte_identical():
    # The whole point of the defaults: the existing single-earner call site passes none of
    # the new arguments and gets exactly today's object back.
    base = estimate(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert base.salary_ytd == D("30855.00")
    assert base.salary_projected == D("67320.00")
    assert base.partner_withheld_total == D("0.00")
    assert base.additional_medicare_gap == D("0.00")
    assert base.warnings == []
```

  Extend that file's imports and add the one module constant the helper `run` needs:

```python
from app.services.withholding_calc import (
    WithholdingEstimate,
    additional_medicare_tier,
    check_dates,
    estimate,
)

ZERO_D = D("0")
```

- [ ] **Step 3.2: Run — expect an ImportError, then failures.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_calc.py -q`
  Expected: collection fails with `ImportError: cannot import name 'additional_medicare_tier' from 'app.services.withholding_calc'`.

- [ ] **Step 3.3: Minimal implementation** — in `backend/app/services/withholding_calc.py`:

  (a) after `CA_SUPPLEMENTAL` (`:39`), add:

```python
# Statute, not data: EVERY employer withholds the additional-Medicare surtax only above
# $200,000 of ITS OWN wages, whatever the employee's filing status is (IRC 3102(f)(1)). The
# THRESHOLD the return owes it at is data — it lives in the medicare bracket table, which
# the loader selects by filing status — which is precisely why the two can disagree.
EMPLOYER_ADDITIONAL_MEDICARE_FLOOR = Decimal("200000")
```

  (b) after `EARLY_CHECKS_WARNING` (`:44`), add:

```python
PARTNER_WITHHOLDING_MISSING_WARNING = (
    "partner withholding not entered — their W-2 withholding counts as 0 until you enter it"
)
```

  (c) add these two module functions above `estimate` (after `_cents`, `:77`):

```python
def additional_medicare_tier(medicare: list[Bracket]) -> tuple[Decimal, Decimal] | None:
    """(surtax rate, filing-status threshold) of the medicare table's additional tier.

    The tier is DATA. The table models Form 8959's 0.9% as a second row whose rate is the
    1.45% base PLUS the surtax, so the surtax is the top row's rate minus the first row's and
    the threshold is the top row's inclusive floor — 250,000 on an MFJ table, 125,000 on MFS,
    200,000 on a single one. None when the table is absent, flat, or terminates in a 0-rate
    CAP row (the social-security wage-base shape, which is not a surtax); a None tier makes
    the gap below 0, which is what leaves every pre-marriage year untouched.
    """
    if len(medicare) < 2:
        return None
    ordered = sorted(medicare, key=lambda bracket: bracket[1])
    base_rate = ordered[0][0]
    top_rate, top_threshold = ordered[-1]
    if top_rate <= base_rate:
        return None
    return top_rate - base_rate, top_threshold


def _additional_medicare_gap(
    medicare: list[Bracket], primary_wages: Decimal, partner_wages: Decimal
) -> Decimal:
    """What the RETURN owes in additional Medicare, minus what the EMPLOYERS will withhold.

    The trap (audit 3.2): each employer applies the surtax only above 200,000 of its own
    wages, while a joint return owes it above the status threshold on COMBINED wages — so two
    salaries that each fall short of 200,000 withhold nothing against a joint liability that
    starts at 250,000. The same rate is used on both sides deliberately: the gap is then
    purely the THRESHOLD effect this figure exists to name, and a hand-edited surtax rate
    moves both sides together instead of manufacturing a difference.

    For ONE earner the two sides are the same expression, so the result is exactly 0 with no
    branch — that is what keeps the single-filer path byte-identical. SIGNED: a negative gap
    is over-withholding (one high earner beside a low-earning spouse), which is honest and
    stays in the payload; the card decides what to shout about.
    """
    tier = additional_medicare_tier(medicare)
    if tier is None:
        return ZERO
    rate, threshold = tier
    combined = primary_wages + partner_wages
    owed = max(combined - threshold, ZERO) * rate
    withheld = sum(
        (
            max(wages - EMPLOYER_ADDITIONAL_MEDICARE_FLOOR, ZERO) * rate
            for wages in (primary_wages, partner_wages)
        ),
        ZERO,
    )
    return owed - withheld
```

  (d) `WithholdingEstimate` gains two defaulted fields, placed immediately above `warnings`:

```python
    vest_fica_ytd: Decimal
    vest_fica_projected: Decimal
    # --- the two-earner block (2026-08-26 spec 5.6). Both default to ZERO, which is exactly
    # what a single-earner call produces, so the existing card is unmoved.
    partner_withheld_total: Decimal = ZERO
    additional_medicare_gap: Decimal = ZERO
    warnings: list[str] = field(default_factory=list)
```

  (e) `estimate`'s signature gains four keyword-only parameters, after `disability`:

```python
    disability: list[Bracket],
    # The two-earner block (2026-08-26 spec 5.6). Wages are the year's stored W-2 figures
    # PER PERSON — the same numbers the liability is computed on — not the paycheck
    # simulation, because the additional-Medicare split is about what each EMPLOYER saw.
    # Withholding is entered, never simulated: the partner has no paycheck profile in this
    # batch. None means "no row stored" (which warns); Decimal("0") means "entered as zero".
    primary_wages: Decimal = ZERO,
    partner_wages: Decimal = ZERO,
    partner_withheld_fed: Decimal | None = None,
    partner_withheld_state: Decimal | None = None,
) -> WithholdingEstimate:
```

  (f) immediately **before** the `return WithholdingEstimate(` at `:122`, insert:

```python
    partner_withheld_total = (partner_withheld_fed or ZERO) + (partner_withheld_state or ZERO)
    if partner_wages > 0 and partner_withheld_fed is None and partner_withheld_state is None:
        # Only BOTH being unset is "not entered": an entered 0 is a real answer (a state with
        # no income tax, or a W-4 that zeroed it) and must not be nagged about.
        warnings.append(PARTNER_WITHHOLDING_MISSING_WARNING)
    gap = _additional_medicare_gap(medicare, primary_wages, partner_wages)
```

  (g) and the return gains the two fields, above `warnings=warnings`:

```python
        vest_fica_projected=_cents(fica_projected),
        partner_withheld_total=_cents(partner_withheld_total),
        additional_medicare_gap=_cents(gap),
        warnings=warnings,
    )
```

  (h) finally, extend the module docstring's opening paragraph with one sentence after the salary-side-FICA note (`:8`):

```
Salary-side FICA is NOT added anywhere: the user's all-in withholding_pct already carries it
(user decision, 2026-08-21). The partner leg (2026-08-26 spec 5.6) is the deliberate
opposite: no profile, no simulation — their W-2 wages and their two withholding figures are
read straight from the year's per-person tax inputs, and the module's only arithmetic on them
is the sum and the additional-Medicare gap below.
```

- [ ] **Step 3.4: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_calc.py -q`
  Expected: baseline for that file + 10, 0 failed.
- [ ] **Step 3.5: Regression** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q` → unchanged (the router still calls `estimate` without the new arguments until Task 4).
- [ ] **Step 3.6: Ruff** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 3.7: Commit** — `git add backend/app/services/withholding_calc.py backend/tests/test_withholding_calc.py && git commit -m "feat(withholding): partner leg and the Additional-Medicare gap in the estimate service"`

---

### Task 4: The withholding endpoint goes two-earner

**Files:**
- Modify: `backend/app/schemas/taxes.py` — `WithholdingOut` (`:217-227`).
- Modify: `backend/app/api/taxes.py` — the tracker section's constants (`:558-571`) and `get_withholding` (`:574-742`).
- Modify: `backend/tests/test_withholding_api.py` (append + one existing assertion, in Task 5).

Wire additions to `WithholdingOut` (all additive; every pre-existing field keeps today's value on a single year — pinned in Step 4.6):

| Field | Type | Meaning |
|---|---|---|
| `filing_status` | `str` | the year's status, so the card can label itself |
| `partner_wages` | `Decimal \| None` | **null** = not a married year, or no partner person exists |
| `partner_withheld_fed` | `Decimal \| None` | **null** = no `w2_fed_withholding` row for the partner (the "not entered" silence) |
| `partner_withheld_state` | `Decimal \| None` | same, for `w2_state_withholding` |
| `additional_medicare_gap` | `Decimal` | signed; `0.00` when there is no surtax tier or one earner |
| `brackets_missing_for_status` | `list[str]` | jurisdictions with no table for this status |

**Deliberate semantics, to be written into the code as a comment:** the partner's entered withholding is added to **both** `total.ytd` and `total.projected`. Their withholding inputs are a running snapshot of the same kind as their W-2 wage inputs — the very figures the liability above is computed on — so counting them once in each leg keeps the card's two columns describing the same household. The three `partner_*` fields exist precisely so a reader can see exactly what was added to both.

- [ ] **Step 4.0: RECONCILE (no code)** — record answers before writing:
  ```bash
  cd C:/Users/edyli/personal-finance-dashboard/backend
  grep -n "brackets_missing_for_status" app/services/tax_service.py app/schemas/taxes.py
  sed -n '585,600p' app/api/taxes.py     # what arguments compute_breakdown takes NOW
  grep -n "class Person" app/models/*.py
  ```
  - If `TaxBreakdown` carries `brackets_missing_for_status`, Step 4.3 passes it through as written.
  - If it does **not**, replace that one line with a local derivation and note it in the commit body:
    ```python
    missing_for_status = [name for name in JURISDICTIONS if not tables.get(name)]
    ```
    (`JURISDICTIONS` is already imported at `taxes.py:101`.)
  - **Do not** change the `compute_breakdown(...)` call's other arguments.

- [ ] **Step 4.1: Failing test** — append to `backend/tests/test_withholding_api.py`:

```python
# --- the two-earner tracker (2026-08-26 spec 5.6) ---

PARTNER_MISSING = (
    "partner withholding not entered — their W-2 withholding counts as 0 until you enter it"
)

# The married world's tables: the MFJ medicare tier at 250k is what makes the gap nonzero.
MFJ_BRACKETS: dict[str, list[tuple[str, str]]] = {
    "federal": [("0.1000", "0.00")],
    "state": [("0.0500", "0.00")],
    "medicare": [("0.0145", "0.00"), ("0.0235", "250000.00")],
    "social_security": [("0.0620", "0.00"), ("0.0000", "168600.00")],
    "disability": [("0.0110", "0.00")],
    "capital_gains": [("0.1500", "0.00")],
}


async def seed_household(db) -> tuple[int, int]:
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    await db.commit()
    return me.id, partner.id


async def seed_married_year(
    db,
    year: int,
    me_id: int,
    partner_id: int,
    *,
    status: str = "married_joint",
    partner_withholding: bool = True,
    jurisdictions: dict | None = None,
) -> None:
    """240k of primary W-2, 150k of partner W-2, and (optionally) the partner's two
    tracker-only withholding rows. Everything through the ORM: the person vocabulary of the
    inputs PUT belongs to another plan and this file must not depend on its shape."""
    db.add(TaxYear(year=year, filing_status=status))
    await db.flush()
    db.add_all(
        [
            TaxInput(
                year=year, key="latest_w2_income", value=Decimal("240000"), person_id=me_id
            ),
            TaxInput(
                year=year, key="latest_w2_income", value=Decimal("150000"), person_id=partner_id
            ),
        ]
    )
    if partner_withholding:
        db.add_all(
            [
                TaxInput(
                    year=year,
                    key="w2_fed_withholding",
                    value=Decimal("18000"),
                    person_id=partner_id,
                ),
                TaxInput(
                    year=year,
                    key="w2_state_withholding",
                    value=Decimal("6000"),
                    person_id=partner_id,
                ),
            ]
        )
    tables = MFJ_BRACKETS if jurisdictions is None else jurisdictions
    for name, table in tables.items():
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                    filing_status=status,
                )
            )
    await db.commit()


@pytest.fixture
async def married_world(db, definitions):
    me_id, partner_id = await seed_household(db)
    await seed_married_year(db, YEAR, me_id, partner_id)
    await seed_profile(db)  # the primary's side, simulated exactly as on a single year
    return me_id, partner_id


async def test_withholding_reports_the_partner_leg_from_their_own_input_rows(
    auth_client, married_world, frozen_today
):
    body = await get_withholding(auth_client)
    assert body["filing_status"] == "married_joint"
    assert body["partner_wages"] == "150000.00"
    assert body["partner_withheld_fed"] == "18000.00"
    assert body["partner_withheld_state"] == "6000.00"
    # The primary's side is UNCHANGED — the same simulation the single fixture pins.
    assert body["salary"] == {"ytd": "30855.00", "projected": "67320.00"}
    assert body["checks_elapsed"] == 11
    assert PARTNER_MISSING not in body["warnings"]


async def test_withholding_total_is_simulated_primary_plus_entered_partner(
    auth_client, married_world, frozen_today
):
    body = await get_withholding(auth_client)
    partner_total = Decimal(body["partner_withheld_fed"]) + Decimal(
        body["partner_withheld_state"]
    )
    assert partner_total == Decimal("24000.00")
    # Entered, not simulated: the partner's figures are a running snapshot of the same kind
    # as their W-2 wages, so they count once in EACH leg (no vests in this world).
    assert body["total"]["ytd"] == "54855.00"  # 30855.00 + 24000.00
    assert body["total"]["projected"] == "91320.00"  # 67320.00 + 24000.00
    assert Decimal(body["balance_projected"]) == Decimal(body["liability_total"]) - Decimal(
        body["total"]["projected"]
    )


async def test_withholding_liability_is_still_the_summary_total_on_a_married_year(
    auth_client, married_world, frozen_today
):
    # Never hand-derived: the MFJ breakdown belongs to the engine, and this card's job is to
    # show the SAME number the summary panel above it shows.
    body = await get_withholding(auth_client)
    summary = await auth_client.get(f"{YEARS}/{YEAR}/summary")
    assert summary.status_code == 200, summary.text
    assert body["liability_total"] == summary.json()["totals"]["total_tax"]


async def test_withholding_names_the_additional_medicare_gap(
    auth_client, married_world, frozen_today
):
    # 240k + 150k = 390k combined. Owed: (390000 - 250000) x 0.9% = 1260. Withheld by the two
    # employers: only 240000 crosses ANY employer's own 200k, by 40000 -> 360. The 900.00
    # difference is the trap this card exists to name.
    body = await get_withholding(auth_client)
    assert body["additional_medicare_gap"] == "900.00"


async def test_withholding_warns_when_the_partner_withholding_is_not_entered(
    auth_client, db, definitions, frozen_today
):
    me_id, partner_id = await seed_household(db)
    await seed_married_year(db, YEAR, me_id, partner_id, partner_withholding=False)
    await seed_profile(db)
    body = await get_withholding(auth_client)

    assert body["partner_wages"] == "150000.00"
    assert body["partner_withheld_fed"] is None
    assert body["partner_withheld_state"] is None
    assert PARTNER_MISSING in body["warnings"]
    # Counted as 0, not guessed: the total is the primary's simulation alone.
    assert body["total"]["projected"] == "67320.00"


async def test_withholding_reports_missing_brackets_for_the_status(
    auth_client, db, definitions, frozen_today
):
    # MFJ selected before any MFJ table exists: the card must say WHICH tables are missing
    # rather than presenting confident zeros.
    me_id, partner_id = await seed_household(db)
    await seed_married_year(db, YEAR, me_id, partner_id, jurisdictions={})
    await seed_profile(db)
    body = await get_withholding(auth_client)

    assert body["brackets_missing_for_status"] == [
        "federal",
        "state",
        "medicare",
        "social_security",
        "disability",
        "capital_gains",
    ]
    assert body["liability_total"] == "0.00"
    assert body["additional_medicare_gap"] == "0.00"  # no table, no tier, no gap


async def test_withholding_single_year_carries_the_new_fields_as_silence(
    auth_client, world, frozen_today
):
    # The single path, byte-identical on every pre-existing figure (the rest of this file is
    # the pin); the additive fields say "there is no second earner here" rather than 0.
    body = await get_withholding(auth_client)
    assert body["filing_status"] == "single"
    assert body["partner_wages"] is None
    assert body["partner_withheld_fed"] is None
    assert body["partner_withheld_state"] is None
    assert body["additional_medicare_gap"] == "0.00"
    assert body["brackets_missing_for_status"] == []
    assert body["liability_total"] == "115753.20"
    assert body["total"] == {"ytd": "51345.00", "projected": "96883.00"}
    assert body["warnings"] == []
```

  Extend that file's `app.models` import with `Person`, and make the existing `seed_tax_year` helper set the status explicitly so the single-year fixtures are unambiguous: `db.add(TaxYear(year=year, filing_status="single"))`.

- [ ] **Step 4.2: Run — expect failures.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q -k "partner or additional_medicare or missing_brackets or new_fields_as_silence"`
  Expected: every one fails with `KeyError: 'partner_wages'` / `KeyError: 'filing_status'` (pydantic drops unknown fields, so the keys are simply absent from the JSON).

- [ ] **Step 4.3: Minimal implementation.**

  (a) `backend/app/schemas/taxes.py` — `WithholdingOut` becomes:

```python
class WithholdingOut(BaseModel):
    year: int
    # The year's filing status, so the card can label itself and decide whether the
    # wedding-year safe-harbor note applies (2026-08-26 spec 5.6).
    filing_status: str
    liability_total: Decimal
    salary: WithholdingLegOut
    vest: WithholdingVestOut
    total: WithholdingLegOut
    balance_projected: Decimal  # liability - projected withholding; positive = will owe
    checks_elapsed: int
    checks_total: int
    # --- the partner leg. NULL is a different silence from 0 in all three: `partner_wages`
    # is null when the year is not married (or the household has no partner row) and 0.00
    # when a partner exists with no W-2 entered; the two withheld fields are null when no
    # tracker row is stored at all — the state that raises the "not entered" warning — and
    # 0.00 only when the user really entered a zero.
    partner_wages: Decimal | None
    partner_withheld_fed: Decimal | None
    partner_withheld_state: Decimal | None
    # SIGNED: positive is the under-withholding trap (each employer withholds the 0.9%
    # surtax only above 200k of its own wages; a joint return owes it above the status
    # threshold on combined wages), negative is over-withholding, 0.00 is one earner or a
    # table with no surtax tier.
    additional_medicare_gap: Decimal
    # Jurisdictions with no bracket table for THIS filing status — the call-to-action state,
    # never a silent zero.
    brackets_missing_for_status: list[str]
    safe_harbor: SafeHarborOut | None
    warnings: list[str]
```

  (b) `backend/app/api/taxes.py` — add to the tracker section's constants (after `FICA_JURISDICTIONS`, `:571`):

```python
# The two W-2 keys that make up an earner's wage base, and the two tracker-only keys the
# partner's withholding is entered under (2026-08-26 spec 5.6 — real inputs, deliberately
# never in ENGINE_INPUT_KEYS, exactly like capital_loss_deductions).
WAGE_KEYS = ("latest_w2_income", "other_w2_income")
PARTNER_FED_WITHHOLDING_KEY = "w2_fed_withholding"
PARTNER_STATE_WITHHOLDING_KEY = "w2_state_withholding"
MARRIED_STATUSES = frozenset({"married_joint", "married_separate"})


def _bucket_input_rows(rows: Iterable[TaxInput]) -> dict[int | None, dict[str, Decimal]]:
    """The year's stored inputs bucketed by OWNER — None is the household bucket.

    The sibling of `_sum_input_rows`: that one answers "what does the engine see", this one
    answers "whose money is it", and the withholding card is the only place that needs both.
    """
    buckets: dict[int | None, dict[str, Decimal]] = {}
    for row in rows:
        buckets.setdefault(row.person_id, {})[row.key] = row.value
    return buckets


def _wage_base(values: dict[str, Decimal]) -> Decimal:
    return sum((values.get(key, ZERO) for key in WAGE_KEYS), ZERO)
```

  (c) in `get_withholding`, replace the two lines at `:591-592` with:

```python
    tables = await _engine_tables(db, year)
    year_row = await db.get(TaxYear, year)  # _require_year already proved it exists
    filing_status = year_row.filing_status
    input_rows = list(
        (await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars()
    )
    # Loaded ONCE and used twice: the engine wants the household sum, the partner block below
    # wants the same rows bucketed by owner. Two queries could disagree under concurrent
    # writes; one row list cannot.
    summed_inputs = _sum_input_rows(input_rows)
    liability = compute_breakdown(year, summed_inputs, tables)

    # --- the partner leg (2026-08-26 spec 5.6). The partner has no paycheck profile in this
    # batch, so their side is ENTERED, not simulated: wages from their own W-2 rows,
    # withholding from the two tracker-only keys. Every non-primary person is folded into
    # one "partner" — the design ships a household of two, and a third person's wages still
    # belong on the withheld side rather than nowhere.
    buckets = _bucket_input_rows(input_rows)
    people = list((await db.execute(select(Person).order_by(Person.id))).scalars())
    partner_ids = [person.id for person in people if not person.is_primary]
    partner_values: dict[str, Decimal] = {}
    for person_id in partner_ids:
        for key, value in buckets.get(person_id, {}).items():
            partner_values[key] = partner_values.get(key, ZERO) + value
    partner_wage_base = _wage_base(partner_values)
    # By SUBTRACTION, not by looking the primary up: household-owned (NULL) W-2 rows from
    # before the migration, or a stray third bucket, then still land on the simulated side
    # instead of disappearing — and the two halves always add back to the figure the engine
    # taxed.
    primary_wage_base = _wage_base(summed_inputs) - partner_wage_base
    has_partner = filing_status in MARRIED_STATUSES and bool(partner_ids)
    partner_fed = partner_values.get(PARTNER_FED_WITHHOLDING_KEY) if has_partner else None
    partner_state = partner_values.get(PARTNER_STATE_WITHHOLDING_KEY) if has_partner else None

    warnings: list[str] = [
```

  (the `warnings: list[str] = [` line already exists at `:593` — keep its body verbatim).

  (d) the `withholding_calc.estimate(...)` call at `:671-680` gains four arguments:

```python
    estimated = withholding_calc.estimate(
        year=year,
        today=today,  # the SAME day the split above used — the service takes it on faith
        profiles=profiles,
        past_vests=past_vests,
        future_vests=future_vests,
        medicare=tables.get("medicare", []),
        social_security=tables.get("social_security", []),
        disability=tables.get("disability", []),
        primary_wages=primary_wage_base,
        partner_wages=partner_wage_base if has_partner else ZERO,
        partner_withheld_fed=partner_fed,
        partner_withheld_state=partner_state,
    )
```

  (e) the two totals at `:685-692` gain the partner term:

```python
    # Salary withholding + vest supplemental + vest marginal FICA, plus the partner's ENTERED
    # withholding. Salary-side FICA is NOT a term: the user's all-in withholding_pct already
    # carries it (withholding_calc's note). The partner's figure counts once in EACH leg on
    # purpose — their withholding inputs are a running snapshot of the same kind as their W-2
    # wage inputs, which is what the liability above is computed on, so both legs describe the
    # same household. The three partner_* fields below are what make that visible.
    total_ytd = _money(
        estimated.salary_ytd
        + estimated.vest_supplemental_ytd
        + estimated.vest_fica_ytd
        + estimated.partner_withheld_total
    )
    total_projected = _money(
        estimated.salary_projected
        + estimated.vest_supplemental_projected
        + estimated.vest_fica_projected
        + estimated.partner_withheld_total
    )
```

  (f) the `return WithholdingOut(` block gains the six fields:

```python
    return WithholdingOut(
        year=year,
        filing_status=filing_status,
        liability_total=liability_total,
        salary=WithholdingLegOut(
            ytd=_money(estimated.salary_ytd),
            projected=_money(estimated.salary_projected),
        ),
        vest=WithholdingVestOut(
            income_ytd=_money(estimated.vest_income_ytd),
            income_projected=_money(estimated.vest_income_projected),
            supplemental_ytd=_money(estimated.vest_supplemental_ytd),
            supplemental_projected=_money(estimated.vest_supplemental_projected),
            fica_ytd=_money(estimated.vest_fica_ytd),
            fica_projected=_money(estimated.vest_fica_projected),
        ),
        total=WithholdingLegOut(ytd=total_ytd, projected=total_projected),
        # Both sides are already at cents, so this subtracts exactly; `_money` is here for the
        # signed-zero collapse (withholding that lands ON the liability must read "0.00").
        balance_projected=_money(liability_total - total_projected),
        checks_elapsed=estimated.checks_elapsed,
        checks_total=estimated.checks_total,
        partner_wages=_money(partner_wage_base) if has_partner else None,
        partner_withheld_fed=None if partner_fed is None else _money(partner_fed),
        partner_withheld_state=None if partner_state is None else _money(partner_state),
        additional_medicare_gap=_money(estimated.additional_medicare_gap),
        brackets_missing_for_status=list(liability.brackets_missing_for_status),
        safe_harbor=safe_harbor,
        warnings=warnings,
    )
```

  (g) add `Person` to the `app.models` import block (`:38-46`).

- [ ] **Step 4.4: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q`
  Expected: baseline for that file + 7, 0 failed. **Every pre-existing test in the file must pass untouched** — that is the single-year byte-identity gate.
- [ ] **Step 4.5: Regression** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py tests/test_tax_service.py tests/test_withholding_calc.py -q` → all green.
- [ ] **Step 4.6: Ruff** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 4.7: Commit** — `git add backend/app/schemas/taxes.py backend/app/api/taxes.py backend/tests/test_withholding_api.py && git commit -m "feat(withholding): two-earner tracker — partner leg, Additional-Medicare gap, missing-brackets state"`

---

### Task 5: Safe-harbor AGI gate — verify, surface, pin

**Files:**
- Modify: `backend/app/api/taxes.py` — `SAFE_HARBOR_MULTIPLIER` (`:566`) and the safe-harbor block (`:695-717`).
- Modify: `backend/app/schemas/taxes.py` — `SafeHarborOut` (`:210-214`).
- Modify: `backend/tests/test_withholding_api.py` (append + **one** existing whole-dict assertion).

Statutory note for the code: IRC §6654(d)(1)(C) keys the 110% multiplier to the AGI **shown on the preceding year's return** exceeding $150,000 — **$75,000 for a married individual filing separately for that preceding taxable year**. So the halving reads the **prior** year's filing status, not the current one. This is exactly the wedding-year subtlety the panel labels.

- [ ] **Step 5.0: RECONCILE (no code)** — `cd backend && grep -n "SAFE_HARBOR\|prior.federal.agi\|150000\|75000" app/api/taxes.py`
  - If a gate is already there, Steps 5.3(a)/(b) reduce to adding the two response fields; keep every test.
  - If it is not, implement 5.3 in full.

- [ ] **Step 5.1: Failing test** — append to `backend/tests/test_withholding_api.py`:

```python
# --- safe-harbor prior-year AGI gate (2026-08-26 spec 5.6; IRC 6654(d)(1)(C)) ---


async def seed_prior_year(db, w2: str, status: str = "single") -> None:
    """A prior year the engine can price, at a chosen AGI and filing status."""
    db.add(TaxYear(year=YEAR - 1, filing_status=status))
    await db.flush()
    db.add(TaxInput(year=YEAR - 1, key="latest_w2_income", value=Decimal(w2)))
    for name, table in BRACKETS.items():
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=YEAR - 1,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                    filing_status=status,
                )
            )
    await db.commit()


async def test_safe_harbor_uses_110_pct_above_the_prior_year_agi_gate(
    auth_client, db, married_world, frozen_today
):
    # Prior-year AGI 400,000 > 150,000: the high-earner multiplier applies, and the response
    # says WHICH multiplier it was rather than leaving the reader to divide.
    await seed_prior_year(db, "400000")
    body = await get_withholding(auth_client)
    harbor = body["safe_harbor"]
    assert harbor["multiplier"] == "1.10"
    assert harbor["prior_filing_status"] == "single"
    assert Decimal(harbor["threshold"]) == (
        Decimal(harbor["prior_total_tax"]) * Decimal("1.10")
    ).quantize(Decimal("0.01"))


async def test_safe_harbor_drops_to_100_pct_below_the_gate(
    auth_client, db, married_world, frozen_today
):
    # Prior-year AGI 100,000 <= 150,000: the statutory gate the card never checked. 100% of
    # the prior year's tax IS the safe harbor, and the threshold must be exactly that.
    await seed_prior_year(db, "100000")
    body = await get_withholding(auth_client)
    harbor = body["safe_harbor"]
    assert harbor["multiplier"] == "1.00"
    assert harbor["threshold"] == harbor["prior_total_tax"]


@pytest.mark.parametrize(
    ("w2", "multiplier"),
    [("80000", "1.10"), ("70000", "1.00")],
)
async def test_safe_harbor_halves_the_gate_for_a_prior_year_filed_separately(
    auth_client, db, married_world, frozen_today, w2, multiplier
):
    # The gate is 75,000 when the PRECEDING year was filed separately (6654(d)(1)(C)(ii) —
    # the preceding year's status, not this year's), so 80,000 clears it and 70,000 does not.
    await seed_prior_year(db, w2, status="married_separate")
    body = await get_withholding(auth_client)
    assert body["safe_harbor"]["multiplier"] == multiplier
    assert body["safe_harbor"]["prior_filing_status"] == "married_separate"


async def test_safe_harbor_flags_a_prior_year_filed_under_a_different_status(
    auth_client, db, married_world, frozen_today
):
    # The wedding-year case: this year is MFJ, the reference return is a single filer's. The
    # number is still the legal safe harbor — the card just has to be able to SAY so.
    await seed_prior_year(db, "400000")
    body = await get_withholding(auth_client)
    assert body["filing_status"] == "married_joint"
    assert body["safe_harbor"]["prior_filing_status"] == "single"
```

  Also update the ONE existing whole-dict assertion in `test_withholding_safe_harbor_is_110_pct_of_the_prior_year` — the only deliberate wire change to a pre-existing payload in this plan:

```python
    assert body["safe_harbor"] == {
        "prior_year": YEAR - 1,
        "prior_total_tax": prior_tax,
        "threshold": "88718.52",  # 80653.20 x 1.10, at cents
        "multiplier": "1.10",  # AGI 400000 > 150000 — the high-earner gate is met
        "prior_filing_status": "single",
        "met": True,  # projected withholding 96883.00 clears it
    }
```

  (that test's existing `seed_tax_year(db, YEAR - 1, "400000.0000")` gives fed AGI 400,000, so the multiplier is unchanged and the threshold literal stands.)

- [ ] **Step 5.2: Run — expect failures.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q -k "safe_harbor"`
  Expected: the five new tests fail on `KeyError: 'multiplier'`; the amended whole-dict assertion fails on the two extra keys; the other pre-existing safe-harbor tests still pass.

- [ ] **Step 5.3: Minimal implementation.**

  (a) `backend/app/schemas/taxes.py` — `SafeHarborOut` becomes:

```python
class SafeHarborOut(BaseModel):
    prior_year: int
    prior_total_tax: Decimal
    # The statutory multiplier that was actually applied — 1.10 only when the prior year's
    # AGI cleared the gate, 1.00 otherwise. Surfaced rather than implied: the threshold is
    # rendered beside the prior-year figure, and the reader must not have to divide.
    multiplier: Decimal
    threshold: Decimal  # prior_total_tax x multiplier
    # The status the REFERENCE return was filed under. Different from this year's on a
    # wedding year, which is a labelling matter, never a math one.
    prior_filing_status: str
    met: bool  # projected total withholding >= threshold
```

  (b) `backend/app/api/taxes.py` — replace the `SAFE_HARBOR_MULTIPLIER` constant (`:564-567`) with:

```python
# The IRS prior-year safe harbor; "all-in" here, where the real rule is per-jurisdiction (the
# card's copy says so). The 110% tier is gated on the PRECEDING year's AGI — over $150,000,
# or $75,000 if that preceding year was filed separately (IRC 6654(d)(1)(C): the halving keys
# off the PRIOR year's status, not this year's, which is exactly the wedding-year subtlety the
# panel labels). Below the gate the safe harbor is a plain 100% of the prior year's tax.
SAFE_HARBOR_MULTIPLIER = Decimal("1.10")
SAFE_HARBOR_BASE_MULTIPLIER = Decimal("1.00")
SAFE_HARBOR_AGI_GATE = Decimal("150000")
SAFE_HARBOR_AGI_GATE_SEPARATE = Decimal("75000")
SAFE_HARBOR_UNAVAILABLE = "prior year {year} has no computed tax — safe harbor unavailable"
```

  (c) rewrite the safe-harbor block (`:695-717`) as:

```python
    safe_harbor = None
    prior_row = await db.get(TaxYear, year - 1)
    if prior_row is not None:
        prior = compute_breakdown(
            year - 1, await _summed_inputs(db, year - 1), await _engine_tables(db, year - 1)
        )
        # Quantize FIRST, then multiply: the threshold has to be the multiplier times the
        # number rendered beside it, not times a full-precision figure nobody can see.
        prior_total = _money(prior.totals.total_tax)
        if prior_total <= ZERO:
            # A bare tax_years row (or one whose credits swallowed the tax) makes the whole
            # comparison vacuous: any withholding at all clears a zero-or-negative threshold,
            # so a met=True badge would be a false all-clear. Say why instead.
            warnings.append(SAFE_HARBOR_UNAVAILABLE.format(year=year - 1))
        else:
            prior_status = prior_row.filing_status
            gate = (
                SAFE_HARBOR_AGI_GATE_SEPARATE
                if prior_status == "married_separate"
                else SAFE_HARBOR_AGI_GATE
            )
            # Federal AGI is the engine's "adjusted gross income shown on the return".
            prior_agi = prior.federal.agi if prior.federal.agi is not None else ZERO
            multiplier = (
                SAFE_HARBOR_MULTIPLIER if prior_agi > gate else SAFE_HARBOR_BASE_MULTIPLIER
            )
            threshold = _money(prior_total * multiplier)
            safe_harbor = SafeHarborOut(
                prior_year=year - 1,
                prior_total_tax=prior_total,
                multiplier=multiplier,
                threshold=threshold,
                prior_filing_status=prior_status,
                # Judged on the DISPLAYED figures (paycheck.py's negative-net posture), so the
                # badge can never contradict the two numbers rendered next to it.
                met=total_projected >= threshold,
            )
```

- [ ] **Step 5.4: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q`
  Expected: previous count + 6 (five new, one parametrized twice), 0 failed.
- [ ] **Step 5.5: Ruff** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 5.6: Commit** — `git add backend/app/schemas/taxes.py backend/app/api/taxes.py backend/tests/test_withholding_api.py && git commit -m "feat(withholding): safe-harbor prior-year AGI gate, with the applied multiplier in the response"`

---

### Task 6: WithholdingPanel — partner section, Additional-Medicare callout, missing-brackets CTA

**Files:**
- Modify: `src/types/api.ts` — the `WithholdingOut` block (`:613-645`).
- Modify: `src/components/taxes/WithholdingPanel.tsx`.
- Modify: `src/components/taxes/taxes.css` — the `/* --- will-I-owe (withholding) panel --- */` section (`:257-271`).
- Modify: `src/components/taxes/WithholdingPanel.test.tsx` — the `fixture()` factory plus new cases.
- **Not** modified: `src/api/taxes.ts` (same endpoint, same call).

**UX decision (read the components before disputing it): the partner section is READ-ONLY.** `InputsForm.tsx` renders every definition the server sends and PUTs the diff, and the two tracker keys are seeded definitions flagged `is_per_person`, so the Taxes page's inputs form **already edits them** in the partner column. A second editor on this card would be two write paths to one row — a save race with the form directly below it — for zero gain. The panel therefore *displays* the three partner figures and points at the form, exactly like the existing "make sure your W-2 inputs below include it" nudge.

- [ ] **Step 6.1: Failing test** — in `src/components/taxes/WithholdingPanel.test.tsx`, extend `fixture()` with the new fields and append the cases:

```ts
function fixture(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
  return {
    year: 2026,
    filing_status: 'single',
    liability_total: '123456.78',
    salary: { ytd: '58666.67', projected: '88000.00' },
    vest: {
      income_ytd: '31500.00',
      income_projected: '48000.00',
      supplemental_ytd: '10152.45',
      supplemental_projected: '15470.40',
      fica_ytd: '456.75',
      fica_projected: '1116.18',
    },
    total: { ytd: '69275.87', projected: '104586.58' },
    balance_projected: '18870.20',
    checks_elapsed: 16,
    checks_total: 24,
    partner_wages: null,
    partner_withheld_fed: null,
    partner_withheld_state: null,
    additional_medicare_gap: '0.00',
    brackets_missing_for_status: [],
    safe_harbor: {
      prior_year: 2025,
      prior_total_tax: '110000.00',
      multiplier: '1.10',
      threshold: '121000.00',
      prior_filing_status: 'single',
      met: false,
    },
    warnings: [],
    ...overrides,
  }
}

/** The married payload the partner cases share. */
function married(overrides: Partial<WithholdingOut> = {}): WithholdingOut {
  return fixture({
    filing_status: 'married_joint',
    partner_wages: '150000.00',
    partner_withheld_fed: '18000.00',
    partner_withheld_state: '6000.00',
    additional_medicare_gap: '900.00',
    ...overrides,
  })
}
```

```ts
  it('renders NO partner section on a single year', async () => {
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText('Partner — entered, not simulated')).toBeNull()
    expect(screen.queryByText(/Additional Medicare gap/)).toBeNull()
  })

  it('shows the partner figures and says which side is entered rather than simulated', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    expect(await screen.findByText('Partner — entered, not simulated')).toBeTruthy()
    expect(screen.getByText('$150,000.00')).toBeTruthy()
    expect(screen.getByText('$18,000.00')).toBeTruthy()
    expect(screen.getByText('$6,000.00')).toBeTruthy()
    // The card is read-only: the inputs form under it owns these three rows, and two write
    // paths to one row would race each other.
    expect(
      screen.getByText(
        /Your side is simulated from paycheck profiles; your partner’s is entered\. Edit all three in the inputs form below\./,
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('says "not entered" rather than $0.00 for a withholding row the server left null', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      married({ partner_withheld_fed: null, partner_withheld_state: null }),
    )
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('Partner — entered, not simulated')
    // Blank and zero say very different things about a withholding figure.
    expect(screen.getAllByText('not entered')).toHaveLength(2)
  })

  it('explains the Additional-Medicare trap in one sentence when the gap is positive', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText(
        /Additional Medicare gap ≈\$900\.00: each employer withholds the 0\.9% surtax only above \$200,000 of its own wages, but a joint return owes it on combined wages above a lower threshold — so two salaries that each fall short still leave this much unwithheld\./,
      ),
    ).toBeTruthy()
  })

  it('stays quiet about the gap when it is zero or negative', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married({ additional_medicare_gap: '0.00' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('Partner — entered, not simulated')
    expect(screen.queryByText(/Additional Medicare gap/)).toBeNull()
    cleanup()

    // Over-withholding is not a trap to shout about — the figure stays in the payload and
    // out of the copy.
    vi.mocked(fetchWithholding).mockResolvedValue(married({ additional_medicare_gap: '-450.00' }))
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('Partner — entered, not simulated')
    expect(screen.queryByText(/Additional Medicare gap/)).toBeNull()
  })

  it('calls the reader to the brackets editor when the status has no tables', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      married({ brackets_missing_for_status: ['federal', 'medicare'] }),
    )
    render(<WithholdingPanel year={2026} />)

    expect(
      await screen.findByText(
        /No federal, medicare bracket table for this year’s filing status — those lines compute as 0\. Add them in the brackets editor below, or clone another year’s and edit the thresholds\./,
      ),
    ).toBeTruthy()
  })

  it('labels a safe harbor that references a return filed under another status', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(married())
    render(<WithholdingPanel year={2026} />)

    // The wedding-year note: the number is still the legal safe harbor, only the household
    // behind it changed — a labelling matter, never a math one.
    expect(
      await screen.findByText(
        /That reference return was filed as single — still the legal safe harbor, just a different household\./,
      ),
    ).toBeTruthy()
  })

  it('says nothing about the reference status when it matches this year', async () => {
    render(<WithholdingPanel year={2026} />)
    await screen.findByText('$123,456.78')
    expect(screen.queryByText(/still the legal safe harbor/)).toBeNull()
  })
```

- [ ] **Step 6.2: Run — expect a type error, then failures.** `npx vitest run src/components/taxes/WithholdingPanel.test.tsx`
  Expected: the fixture's new keys are rejected by `WithholdingOut` (`Object literal may only specify known properties`), and once the type lands, seven cases fail on missing copy.

- [ ] **Step 6.3: Minimal implementation.**

  (a) `src/types/api.ts` — extend the `WithholdingOut` interface (keep the existing comments; add):

```ts
export interface WithholdingOut {
  year: number
  // 'single' | 'married_joint' | 'married_separate' — a plain string on the wire (the
  // backend validates it Python-side, like `group`), so the card compares rather than
  // switches on a union it would have to keep in lockstep.
  filing_status: string
  liability_total: string
  salary: WithholdingLegOut
  vest: {
    income_ytd: string
    income_projected: string
    supplemental_ytd: string
    supplemental_projected: string
    fica_ytd: string
    fica_projected: string
  }
  total: WithholdingLegOut
  balance_projected: string
  checks_elapsed: number
  checks_total: number
  // The partner leg — ENTERED, not simulated (the partner has no paycheck profile yet).
  // NULL is a different silence from "0.00" in all three: `partner_wages` is null when the
  // year is not married (or no partner person exists) and "0.00" when a partner exists with
  // no W-2 entered; the two withheld fields are null when nothing is stored — the state the
  // server also warns about — and "0.00" only when a zero was really entered.
  partner_wages: string | null
  partner_withheld_fed: string | null
  partner_withheld_state: string | null
  // SIGNED. Positive is the under-withholding trap (each employer withholds the 0.9% surtax
  // only above $200k of its own wages; a joint return owes it above a lower combined
  // threshold), negative is over-withholding, "0.00" is one earner or no surtax tier.
  additional_medicare_gap: string
  // Jurisdictions with no bracket table for THIS filing status — a call to action, never a
  // silent zero.
  brackets_missing_for_status: string[]
  safe_harbor: {
    prior_year: number
    prior_total_tax: string
    multiplier: string // 1.10 above the prior-year AGI gate, 1.00 below it
    threshold: string // prior_total_tax x multiplier
    prior_filing_status: string
    met: boolean
  } | null
  warnings: string[]
}
```

  (b) `src/components/taxes/WithholdingPanel.tsx` — insert the partner block **after** the `.drill-hint` year-to-date sentence and **before** the safe-harbor paragraph:

```tsx
          {/* The partner mini-section: read-only on purpose. The inputs form BELOW this card
              already edits all three rows (they are seeded per-person definitions), and a
              second editor here would be two write paths racing over one row. */}
          {withholding.partner_wages !== null && (
            <div className="withholding-partner">
              <h3 className="eyebrow">Partner — entered, not simulated</h3>
              <dl className="withholding-partner-facts">
                <div>
                  <dt>W-2 wages</dt>
                  <dd>{formatCurrency(withholding.partner_wages)}</dd>
                </div>
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
              </dl>
              <p className="drill-hint">
                Your side is simulated from paycheck profiles; your partner&rsquo;s is entered.
                Edit all three in the inputs form below.
              </p>
            </div>
          )}

          {/* One sentence, and only when it is real money: the trap is a THRESHOLD mismatch,
              so a negative gap (over-withholding) is left in the payload and out of the copy. */}
          {Number(withholding.additional_medicare_gap) > 0 && (
            <p className="hint withholding-trap">
              {`Additional Medicare gap ≈${formatCurrency(
                withholding.additional_medicare_gap,
              )}: each employer withholds the 0.9% surtax only above $200,000 of its own wages, but a joint return owes it on combined wages above a lower threshold — so two salaries that each fall short still leave this much unwithheld.`}
              <InfoHint text="Form 8959. Close it with a W-4 line 4(c) extra-withholding amount or a quarterly estimated payment." />
            </p>
          )}

          {withholding.brackets_missing_for_status.length > 0 && (
            <p className="hint withholding-cta">
              {`No ${withholding.brackets_missing_for_status.join(
                ', ',
              )} bracket table for this year\u2019s filing status — those lines compute as 0. Add them in the brackets editor below, or clone another year\u2019s and edit the thresholds.`}
            </p>
          )}
```

  and extend the existing safe-harbor paragraph with the wedding-year note, inside the same `{withholding.safe_harbor !== null && (` block, after the closing `</p>`:

```tsx
          {withholding.safe_harbor !== null &&
            withholding.safe_harbor.prior_filing_status !== withholding.filing_status && (
              <p className="hint">
                {`That reference return was filed as ${withholding.safe_harbor.prior_filing_status.replaceAll(
                  '_',
                  ' ',
                )} — still the legal safe harbor, just a different household.`}
              </p>
            )}
```

  (c) `src/components/taxes/taxes.css` — append to the withholding section:

```css
/* The partner mini-section: three read-only facts under the tiles. A definition list, not a
   grid of inputs — the inputs form below this card owns these rows (see the component's
   note), and the visual difference is the point. */
.withholding-partner {
  margin: 12px 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2, transparent);
}

.withholding-partner > .eyebrow {
  margin: 0 0 8px;
}

.withholding-partner-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
}

.withholding-partner-facts dt {
  font-size: 0.7rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.withholding-partner-facts dd {
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
}

/* The trap callout and the missing-brackets call to action are `.hint` sentences with a
   rule down the side — loud enough to read as a finding, quiet enough not to be an error
   banner (the card's warnings posture). */
.withholding-panel .withholding-trap,
.withholding-panel .withholding-cta {
  border-left: 3px solid var(--accent, currentColor);
  padding-left: 10px;
}
```

  If `--surface-2` / `--accent` are not declared in the app's token sheet, drop them for the plain fallbacks already in the rules (the `var(..., fallback)` forms above are written so both cases render).

- [ ] **Step 6.4: Run to pass** — `npx vitest run src/components/taxes/WithholdingPanel.test.tsx`
  Expected: baseline for that file + 8, 0 failed. Every `$`-literal must match `formatCurrency` (Intl USD, two decimals) — when a literal disagrees with the util, fix the literal.
- [ ] **Step 6.5: Typecheck + lint** — `npx tsc -b` (0 errors) and `npx eslint src/components/taxes src/types/api.ts` (0 errors).
- [ ] **Step 6.6: Regression** — `npx vitest run src/pages/TaxesPage.test.tsx src/components/taxes` → all green (the page mocks this module; a shape change must not leak).
- [ ] **Step 6.7: Commit** — `git add src/types/api.ts src/components/taxes/WithholdingPanel.tsx src/components/taxes/WithholdingPanel.test.tsx src/components/taxes/taxes.css && git commit -m "feat(withholding): partner section, Additional-Medicare callout and missing-brackets CTA"`

---

### Task 7: Batch verification — gates + real-data browser smoke (orchestrator, no subagent)

This is the batch's final gate, not just this plan's. Everything below runs against the **whole** married-taxes batch on the merge candidate.

#### 7A — Automated gates

- [ ] **Step 7.1: Backend suite** — `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: Step 0.4's `N_py` + ~26 from this plan (3 taxes-api, 3 overview-api, 10 withholding-calc, 7 withholding-api, 6 safe-harbor), **0 failed**. Do not pipe through `grep`/`head`.
- [ ] **Step 7.2: Ruff** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format --check app tests` (CI runs `--check`; both must exit 0).
- [ ] **Step 7.3: Alembic** — `cd backend && .venv/Scripts/python.exe -m alembic heads` → a **single** head; `alembic upgrade head` exits 0 (this plan adds no migration; the batch's must still be single-headed).
- [ ] **Step 7.4: Frontend suite** — `npm test`
  Expected: Step 0.4's `N_ts` + ~8. The TransactionsPanel "save changes" flake is pre-existing — rerun once if it is the **only** failure.
- [ ] **Step 7.5: Lint** — `npm run lint` → 0 errors (sanctioned pre-existing warnings only).
- [ ] **Step 7.6: Build** — `npm run build` (`tsc -b && vite build`) → exits 0. No new echarts registrations came from this plan, so the EChart chunk must be byte-comparable to main's.
- [ ] **Step 7.7:** Anything red → fix (a fix subagent for anything substantive), re-run the affected gate, commit.

#### 7B — Real-data browser smoke (the 2026-08-25 sankey lesson)

Chart tests mock echarts by house law, so real-echarts-with-real-data is a standing blind spot — and this batch changes what the money-flow sankey is fed. Smoke **before** merging.

- [ ] **Step 7.8: Dev servers** — backend: `cd backend && SCHEDULER_ENABLED=false .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000` (run_in_background). Frontend: `npm run dev` (5173, run_in_background). Both against the **dev** DB with the batch's migrations applied.
- [ ] **Step 7.9: Driver** — `scratchpad/repro_married_smoke.mjs`, puppeteer-core against headless Edge (`npm i --no-save puppeteer-core` if absent), `evaluateOnNewDocument` planting `localStorage.finance_token` (mint via `app.security.create_access_token` — read `backend/app/security.py` for the exact signature first). Capture `page.on('console')` and `page.on('pageerror')` and **FAIL the smoke on any error**. Screenshot each numbered step below and read the images back.

**The checklist — exact clicks, in order.** Every step must render without a console error and without a blanked card.

- [ ] **Step 7.10 — Settings → Household.** Open `/settings`. In the Household card: add a partner ("Partner"), set the marriage date. Reload; both persist.
- [ ] **Step 7.11 — Settings → Accounts card.** Create a partner-owned account (name, group, owner = Partner). Retire it (`is_active` off) — it leaves the active roster. Re-activate it — it comes back. Screenshot the roster with the owner select visible.
- [ ] **Step 7.12 — Net Worth.** Open `/net-worth`. Click each owner chip: **All → Me → Partner → Joint**; the chart and tiles redraw each time (no blank canvas, no stale series). Toggle **by-owner stacking** — the stack rebuilds per owner. Confirm the **marriage-date markLine** is drawn on the trend. Screenshot All + by-owner.
- [ ] **Step 7.13 — Monthly Update wizard.** Open the wizard. The balance grid is **grouped by owner with per-owner subtotals**, walking owner → group → components. The net-pay field reads **"Household take-home."** The partner account created in 7.11 appears automatically. Do **not** submit.
- [ ] **Step 7.14 — Taxes, scratch year.** Open `/taxes`. Create a **scratch year** (e.g. 2099 — a year no real data touches) via the inputs PUT affordance. Note it for cleanup in 7.18.
- [ ] **Step 7.15 — Taxes, married path on the scratch year.**
  - Flip the filing-status selector to **MFJ**; the page refetches.
  - **Clone brackets as MFJ** from a stored year; the per-table "review thresholds" badges appear on federal / state / capital_gains / medicare.
  - Enter **partner inputs** in the partner column, including the two tracker keys (`w2_fed_withholding`, `w2_state_withholding`), and a partner W-2 wage. Save.
  - The **summary panel** renders MFJ figures (no 500, no blank).
  - The **withholding panel** renders — *note: it is current-year only, so if the scratch year is not the current year the card is correctly absent; do the withholding checks on the REAL current year instead, after entering the partner rows there.*
  - On the current year: the **partner mini-section** shows the three figures, and the **Additional-Medicare callout** appears when the gap is positive (force it if needed: partner wages that put combined over the MFJ tier while each side stays under $200k).
  - Flip the scratch year to **MFS** with no MFS tables → the **missing-brackets call-to-action** renders (and the CA community-property caveat shows on the tax-year card).
- [ ] **Step 7.16 — Overview.** Open `/overview`. The **money-flow sankey draws** — this is the §3.4 landmine's acceptance test, so confirm specifically: no `renderable=false` reason sentence, no negative-residual blanking, and the salary ribbon reflects **both** earners. The **YTD effective-tax tile** shows a number, not `—`. Screenshot the full page.
- [ ] **Step 7.17 — Console sweep.** Zero `pageerror`s and zero console errors across every step. Any error → fix loop (subagent), re-run the smoke from 7.10.
- [ ] **Step 7.18 — Cleanup, with the caveat.** Delete the scratch tax year from 7.14 (`DELETE /taxes/years/{year}`, or the page's own affordance). **CAVEAT: if any cleanup deletion raises an approval prompt — the scratch year, the partner test account from 7.11, anything else — do NOT approve it and do NOT force it. Leave the artifact in place and put it on the morning list by name, with the exact command to remove it.** The no-deletions rule outranks tidiness.
- [ ] **Step 7.19 — Leave the dev servers running** for the user's morning visual pass (house precedent) and record in the morning report: what was seeded, which scratch artifacts remain, and the URLs to look at first (`/overview`, `/taxes`, `/net-worth`, `/settings`).
- [ ] **Step 7.20 — Commit any smoke fixes** — `git add <paths> && git commit -m "fix(money-flow): <what the smoke found>"` (or `feat(withholding): …` as appropriate).

---

## Self-review appendix (orchestrator, before dispatch)

- Spec §5.6 ↔ Tasks 3, 4, 5, 6. §5.7 ↔ Tasks 1, 2. §7 (testing/smoke) ↔ Tasks 1–6 tests + Task 7. Audit §3.2 (two-earner tracker + additional-Medicare trap) ↔ Tasks 3, 4, 6. Audit §3.4 (money-flow landmine) ↔ Tasks 1, 2, smoke 7.16.
- **Two collapse points, not one** — `_stored_inputs:134-136` *and* `get_all_summaries:519-521`. Fixing only the first leaves the Overview YTD tile wrong. Task 1 fixes both; Step 1.1's second test exists solely to keep it that way.
- **`money_flow.py` is never edited.** If a task tries to, it has misread the architecture: the module is pure and the dict it receives is the fix.
- **The engine call is never edited.** Only the *inputs argument* changes. Anything else is the tax-schema-engine plan's.
- **One deliberate wire change to a pre-existing payload:** `SafeHarborOut` gains `multiplier` + `prior_filing_status`, which breaks exactly one existing whole-dict assertion (`test_withholding_safe_harbor_is_110_pct_of_the_prior_year`). Step 5.1 updates it verbatim. Every other pre-existing assertion in `test_withholding_api.py` must pass untouched — that is the single-year byte-identity gate.
- **Wire-format literals** (`"900.00"`, `"1.10"`, `"$150,000.00"`) must match the real serializers (`_money`'s 2dp plain quantize; `formatCurrency`'s Intl USD). When a literal disagrees with reality, fix the literal, never the serializer.
- **Known ambiguity, decided here and flagged for review:** the partner's entered withholding is counted in **both** `total.ytd` and `total.projected`. If the user reads those inputs as year-to-date-only figures, the projected leg overstates by whatever is still to come. The three `partner_*` fields and the panel's "entered, not simulated" heading exist so the decomposition is always visible; revisit when per-person paycheck profiles land (P3) and the partner side can be simulated like the primary's.
