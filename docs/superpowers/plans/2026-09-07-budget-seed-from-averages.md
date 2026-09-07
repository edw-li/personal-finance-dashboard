# Budgets seeded from averages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything in `docs/superpowers/specs/2026-09-07-budget-seed-from-averages-design.md`: a one-click, Undo-able seed that writes every seedable living category's typical spend as a dated budget row, suggestion chips in every budget editor, and the Projection knobs card's "Use my budgets" preset.

**Architecture:** One new pure-ish module, `backend/app/services/budgets.py`, owns all budget arithmetic: the resolver moves in from the router, and `suggest()` turns a category's window series into a profile (`dormant | sparse | fixed | episodic | variable`) and a whole-dollar seed. `api/spending.py` gains `GET /spending/budgets/suggestions` and `POST /spending/budgets/seed` (one change batch, the wizard's `batch_id` contract). `api/projection.py` echoes `budget_annual_spend`. On the client, `BudgetPanel.tsx` grows the seed action, a re-seed confirm and per-editor chips (a small `BudgetSuggestions` component plus pure helpers in `budgetSeed.ts`); `ScenarioPanel.tsx` gains one button. No migration.

**Tech Stack:** Python 3.12 · FastAPI · SQLAlchemy 2 async · pydantic v2 · pytest · ruff — React 19 · TypeScript · Vite · vitest + Testing Library · Playwright-core probes (Edge).

**Rules for every task**
- Branch `budget-seed-from-averages` in the MAIN checkout `C:\Users\edyli\personal-finance-dashboard` (Task 0 creates it). Never push. Never touch `.worktrees/` (three stale ESPP worktrees live there and are the user's to clean).
- Backend tests run from `backend/` with THIS batch's own test database, so they cannot collide with anything else on 5433: Git Bash `FINANCE_TEST_DB=finance_test_b1 .venv/Scripts/python.exe -m pytest tests/<file> -q`; PowerShell `$env:FINANCE_TEST_DB="finance_test_b1"` first. Written `pytest …` below. `conftest.py` creates the database on first use.
- Finish every backend task with `.venv/Scripts/python.exe -m ruff format app tests && .venv/Scripts/python.exe -m ruff check app tests` (100-column house style — snippets are written densely, ruff reflows them).
- Frontend tests: `npx vitest run <file>` from the repo root; finish every frontend task with `npx tsc -b && npx eslint <touched files>`.
- Comments carry the *why*, matching each file's density. Every figure a test asserts below was computed with the spec's arithmetic before this plan was written (`scratchpad/figures.py`); a disagreement is a bug in the implementation, not in the expectation.
- Mid-plan, run only the named test files. The full suites run once, in Task 13.
- Commit after every task with the message given; `git add` only the files the task names.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/budgets.py` (new) | `resolve_budgets` (moved), `seed_window`, `ceil_dollars`, `Suggestion` + `suggest`, `load_suggestions`, `living_budget_total` |
| `backend/app/api/spending.py` (modify) | imports the resolver; `GET /budgets/suggestions`; `POST /budgets/seed` |
| `backend/app/schemas/spending.py` (modify) | `BudgetSuggestion`, `BudgetSuggestionsOut`, `BudgetSeedIn`, `BudgetSkip`, `BudgetSeedOut` |
| `backend/app/schemas/projection.py`, `backend/app/api/projection.py` (modify) | `budget_annual_spend`, `budget_month` echo |
| `backend/tests/test_budgets_service.py` (new) · `test_spending_api.py`, `test_activity_api.py`, `test_projection_api.py` (modify) | the pins |
| `src/types/api.ts`, `src/api/spending.ts` (modify) | wire types, two client functions |
| `src/components/spending/budgetSeed.ts` (new) + `budgetSeed.test.ts` | `MIN_SEED_MONTHS`, `seedCounts`, `skipSummary`, `profileCue` — pure |
| `src/components/spending/BudgetSuggestions.tsx` (new) | one editor's chips + cue |
| `src/components/spending/BudgetPanel.tsx`, `budgets.css`, `BudgetPanel.test.tsx` (modify) | seed, re-seed confirm, chips, Undo toast |
| `src/pages/SpendingPage.test.tsx` (modify) | the two new mock functions |
| `src/components/projection/ScenarioPanel.tsx` + `.test.tsx` (modify) | "Use my budgets" |
| `vite.config.ts`, `tools/probes/README.md`, `tools/probes/budget-seed/smoke.mjs` (new) | lane proxy override; the read-only browser smoke |

---

### Task 0: Orchestrator — branch, test database, baseline

**Files:** none changed.

- [ ] **1** From the main checkout on `main` (`git status` clean, HEAD is the plan commit): `git checkout -b budget-seed-from-averages`.
- [ ] **2** Confirm the dev database container is up: `docker ps --format '{{.Names}} {{.Ports}}'` shows `finance-dashboard-db-1 127.0.0.1:5433->5432/tcp`. If not: `cd backend && docker compose up -d db`.
- [ ] **3** Baseline the backend on the batch database: `cd backend && FINANCE_TEST_DB=finance_test_b1 .venv/Scripts/python.exe -m pytest tests/test_spending_api.py tests/test_projection_api.py tests/test_activity_api.py -q` → all pass (record the count).
- [ ] **4** Baseline the frontend files this plan touches: `npx vitest run src/components/spending src/pages/SpendingPage.test.tsx src/components/projection/ScenarioPanel.test.tsx` → all pass (record the count).

---

### Task 1: Move the resolver into `services/budgets.py`

Behavior-preserving. The matrix and the month GET keep working; the module exists for Task 2 to grow.

**Files:**
- Create: `backend/app/services/budgets.py`
- Modify: `backend/app/api/spending.py` (delete `_resolve_budgets`, ~lines 284–306; two call sites; one import)
- Test: `backend/tests/test_spending_api.py` (existing tests are the pin)

- [ ] **1 Create the module** with the resolver moved verbatim (only the docstring's spec reference is widened):

```python
"""Budget arithmetic — the ONE module (2026-09-07 budget-seed spec §1).

Three readers share it so they cannot drift: the spending matrix and the month GET resolve
budgets per month here; the Budget card's suggestions and the one-click seed take their
figures from `suggest`; the projection's "Use my budgets" echo sums the same resolution.
"""

from collections.abc import Sequence
from datetime import date
from decimal import Decimal

from app.models import CategoryBudget


def resolve_budgets(
    rows: Sequence[CategoryBudget], months: Sequence[date]
) -> dict[int, list[Decimal | None]]:
    """Per category, the resolved budget for each month: the amount of the row with the
    greatest effective_month <= month (2026-08-24 spec §2). `months` must be ascending (the
    matrix's order); one sorted walk per category, zero extra queries — the table is tiny."""
    by_category: dict[int, list[CategoryBudget]] = {}
    for row in rows:
        by_category.setdefault(row.category_id, []).append(row)
    resolved: dict[int, list[Decimal | None]] = {}
    for category_id, history in by_category.items():
        history.sort(key=lambda r: r.effective_month)
        values: list[Decimal | None] = []
        pointer = 0
        current: Decimal | None = None
        for month in months:
            while pointer < len(history) and history[pointer].effective_month <= month:
                current = history[pointer].amount
                pointer += 1
            values.append(current)
        resolved[category_id] = values
    return resolved
```

- [ ] **2 Point the router at it.** In `backend/app/api/spending.py`: delete the whole `_resolve_budgets` function (the `def _resolve_budgets(` block between `_kind_split` and `@router.get("/matrix"…`); add `from app.services.budgets import resolve_budgets` to the imports (alphabetically after `from app.importer.cells import slugify` and before `from app.models import …` — ruff's isort keeps `app.services.*` together, so place it next to the other `app.services` imports); replace both call sites `_resolve_budgets(budget_rows, months)` (matrix) and `_resolve_budgets(budget_rows, [month])` (month GET) with `resolve_budgets(...)`.

- [ ] **3 Run the pin**: `pytest tests/test_spending_api.py -q` → same count as Task 0, all pass. Then `ruff format` + `ruff check`.

- [ ] **4 Commit**

```bash
git add backend/app/services/budgets.py backend/app/api/spending.py
git commit -m "refactor(budgets): the resolver moves into services/budgets.py — the ONE module the seed, the chips and the projection echo will read"
```

---

### Task 2: The suggestion model — `seed_window`, `ceil_dollars`, `suggest`

Pure functions, TDD. Every expected figure below is from `scratchpad/figures.py` (mean/median at cents HALF_UP, sample standard deviation, cv at 4 dp, ceiling to whole dollars).

**Files:**
- Modify: `backend/app/services/budgets.py`
- Create: `backend/tests/test_budgets_service.py`

- [ ] **1 Write the failing tests**

```python
from datetime import date
from decimal import Decimal

from app.services.budgets import (
    FIXED_CV,
    MIN_SEED_MONTHS,
    SEED_WINDOW_MONTHS,
    ceil_dollars,
    seed_window,
    suggest,
)

D = Decimal


def m(year: int, month: int) -> date:
    return date(year, month, 1)


def series(start: date, amounts: list[str]) -> list[tuple[date, Decimal]]:
    """(month, amount) pairs from `start`, one per calendar month, ascending."""
    out = []
    for i, amount in enumerate(amounts):
        index = start.year * 12 + start.month - 1 + i
        out.append((date(index // 12, index % 12 + 1, 1), D(amount)))
    return out


# --- the window (spec §1) ---


def test_seed_window_skips_the_current_month_and_take_home_only_months_and_keeps_twelve():
    entered = [m(2025, 6 + i) for i in range(7)] + [m(2026, i) for i in range(1, 10)]  # Jun 2025 … Sep 2026
    window = seed_window(entered, [m(2026, 3)], current_month=m(2026, 9))
    assert window == [
        m(2025, 8), m(2025, 9), m(2025, 10), m(2025, 11), m(2025, 12),
        m(2026, 1), m(2026, 2), m(2026, 4), m(2026, 5), m(2026, 6), m(2026, 7), m(2026, 8),
    ]
    assert len(window) == SEED_WINDOW_MONTHS == 12


def test_seed_window_takes_what_exists_sorted_and_never_the_present_or_future():
    assert seed_window([m(2026, 8), m(2026, 7)], [], m(2026, 9)) == [m(2026, 7), m(2026, 8)]
    assert seed_window([], [], m(2026, 9)) == []
    assert seed_window([m(2026, 9), m(2026, 10)], [], m(2026, 9)) == []


def test_ceil_dollars_rounds_up_to_the_next_dollar_spelled_in_cents():
    assert ceil_dollars(D("2072.80")) == D("2073.00")
    assert ceil_dollars(D("1007.61")) == D("1008.00")
    assert ceil_dollars(D("194.6525")) == D("195.00")
    assert ceil_dollars(D("600.00")) == D("600.00")


# --- the profiles (spec §1 table) ---


def test_a_steady_cost_that_stepped_up_is_fixed_and_seeds_from_the_latest_month():
    s = suggest(1, "living", series(m(2025, 9), ["2030.00"] * 7 + ["2072.80"] * 5))
    assert (s.profile, s.months) == ("fixed", 12)
    assert (s.mean, s.median, s.latest, s.latest_month) == (
        D("2047.83"), D("2030.00"), D("2072.80"), m(2026, 8),
    )
    assert s.cv == D("0.0108") and s.cv < FIXED_CV
    assert (s.seed, s.skip_reason) == (D("2073.00"), None)


def test_a_variable_category_seeds_the_ceiling_of_its_mean():
    food = ["900.00", "1100.00", "1000.00", "1250.50", "850.00", "1000.25",
            "1120.00", "980.00", "1010.00", "1300.00", "940.00", "1049.25"]
    s = suggest(2, "living", series(m(2025, 9), food))
    assert s.profile == "variable"
    assert (s.mean, s.median, s.latest, s.cv) == (D("1041.67"), D("1005.13"), D("1049.25"), D("0.1279"))
    assert (s.seed, s.skip_reason) == (D("1042.00"), None)
    # Zeros interrupting a steady gift pull the mean UNDER the typical month — still variable.
    gifts = ["600.00", "600.00", "0.00", "750.00", "600.00", "600.00",
             "0.00", "600.00", "750.00", "600.00", "600.00", "600.00"]
    g = suggest(3, "living", series(m(2025, 9), gifts))
    assert (g.profile, g.mean, g.median, g.cv, g.seed) == ("variable", D("525.00"), D("600.00"), D("0.4796"), D("525.00"))


def test_a_zero_median_category_is_episodic_and_still_seeds_the_mean():
    travel = ["0.00"] * 3 + ["1525.63"] + ["0.00"] * 4 + ["810.20"] + ["0.00"] * 3
    s = suggest(4, "living", series(m(2025, 9), travel))
    assert (s.profile, s.median, s.mean, s.cv, s.seed) == ("episodic", D("0.00"), D("194.65"), D("2.4634"), D("195.00"))


def test_high_swing_with_a_positive_median_stays_variable():
    shopping = ["0.00", "2046.64", "307.66", "100.00", "50.00", "900.00",
                "0.00", "250.00", "600.00", "120.00", "80.00", "1300.00"]
    s = suggest(5, "living", series(m(2025, 9), shopping))
    assert (s.profile, s.mean, s.median, s.cv, s.seed) == ("variable", D("479.53"), D("185.00"), D("1.3308"), D("480.00"))


def test_dormant_when_nothing_or_nothing_net_was_spent():
    zeros = suggest(6, "living", series(m(2025, 9), ["0.00"] * 12))
    assert (zeros.profile, zeros.months, zeros.mean, zeros.cv, zeros.seed, zeros.skip_reason) == (
        "dormant", 12, D("0.00"), None, None, "dormant",
    )
    refunds = suggest(7, "living", series(m(2026, 5), ["-50.00", "0.00", "0.00", "10.00"]))
    assert (refunds.profile, refunds.mean, refunds.seed, refunds.skip_reason) == ("dormant", D("-10.00"), None, "dormant")
    absent = suggest(8, "living", [])
    assert (absent.profile, absent.months, absent.mean, absent.median, absent.latest, absent.latest_month) == (
        "dormant", 0, None, None, None, None,
    )
    assert (absent.seed, absent.skip_reason) == (None, "dormant")


def test_sparse_under_three_months_even_when_steady_and_fixed_at_exactly_three():
    assert MIN_SEED_MONTHS == 3
    two = suggest(9, "living", series(m(2026, 7), ["100.00", "120.00"]))
    assert (two.profile, two.months, two.mean, two.cv, two.seed, two.skip_reason) == (
        "sparse", 2, D("110.00"), D("0.1286"), None, "sparse",
    )
    three = suggest(10, "living", series(m(2026, 6), ["100.00", "105.00", "110.00"]))
    assert (three.profile, three.cv, three.seed) == ("fixed", D("0.0476"), D("110.00"))


def test_non_living_kinds_get_figures_but_no_seed():
    taxes = suggest(11, "tax", series(m(2025, 9), ["0.00"] * 11 + ["5044.00"]))
    assert (taxes.profile, taxes.mean, taxes.seed, taxes.skip_reason) == ("episodic", D("420.33"), None, "kind")
    transfer = suggest(12, "transfer", [])
    assert (transfer.profile, transfer.seed, transfer.skip_reason) == ("dormant", None, "kind")
```

- [ ] **2 Run to see them fail**: `pytest tests/test_budgets_service.py -q` → `ImportError` (no `seed_window`).

- [ ] **3 Implement.** Append to `backend/app/services/budgets.py` (extend the imports at the top: `from dataclasses import dataclass`, `from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal`, `from typing import Literal`, and `from app.services.savings import LIVING`):

```python
# The seed's vocabulary (spec §1). The window is COMPLETE months only — the 2026-09-07 preview
# found the seven-day-old current month inside an "entered months" window, dragging every mean
# down a twelfth and handing nine categories a fake $0 minimum.
SEED_WINDOW_MONTHS = 12
MIN_SEED_MONTHS = 3
FIXED_CV = Decimal("0.10")
CENTS = Decimal("0.01")
CV_QUANTUM = Decimal("0.0001")

Profile = Literal["dormant", "sparse", "fixed", "episodic", "variable"]
SkipReason = Literal["kind", "dormant", "sparse"]


def seed_window(
    entered: Sequence[date],
    without_spending: Sequence[date],
    current_month: date,
    limit: int = SEED_WINDOW_MONTHS,
) -> list[date]:
    """The months the averages read: the last `limit` months strictly before `current_month`
    that are entered (coverage's ONE definition) and carry spending rows — a take-home-only
    month has nothing to average, and an empty month is not entered at all."""
    skip = set(without_spending)
    complete = [month for month in sorted(entered) if month < current_month and month not in skip]
    return complete[-limit:]


def ceil_dollars(value: Decimal) -> Decimal:
    """A target reads as a chosen number: up to the next whole dollar, spelled in cents — a
    fixed cost never shows "over by $0.80"."""
    return value.to_integral_value(rounding=ROUND_CEILING).quantize(CENTS)


def _median(values: Sequence[Decimal]) -> Decimal:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


@dataclass(frozen=True)
class Suggestion:
    category_id: int
    profile: Profile
    months: int  # window months that carry a row for this category (absent ≠ zero)
    mean: Decimal | None  # cents, HALF_UP
    median: Decimal | None  # cents, HALF_UP
    latest: Decimal | None  # the last window month with a row
    latest_month: date | None
    cv: Decimal | None  # sample standard deviation ÷ mean, 4 dp; None under two months or at mean <= 0
    seed: Decimal | None  # whole dollars in cents; None when skipped
    skip_reason: SkipReason | None


def suggest(category_id: int, kind: str, series: Sequence[tuple[date, Decimal]]) -> Suggestion:
    """`series` = (month, amount) for every WINDOW month where the category has a row,
    ascending. The profile order is the spec's table: dormant, sparse, fixed, episodic,
    variable. A non-living kind keeps its figures for the chips but never a seed."""
    n = len(series)
    if n == 0:
        reason: SkipReason = "kind" if kind != LIVING else "dormant"
        return Suggestion(category_id, "dormant", 0, None, None, None, None, None, None, reason)
    amounts = [amount for _, amount in series]
    mean_exact = sum(amounts, Decimal(0)) / n
    latest_month, latest = series[-1]
    cv: Decimal | None = None
    if n >= 2 and mean_exact > 0:
        variance = sum(((a - mean_exact) ** 2 for a in amounts), Decimal(0)) / (n - 1)
        cv = (variance.sqrt() / mean_exact).quantize(CV_QUANTUM, rounding=ROUND_HALF_UP)
    median = _median(amounts)
    profile: Profile
    if mean_exact <= 0:
        profile = "dormant"
    elif n < MIN_SEED_MONTHS:
        profile = "sparse"
    elif cv is not None and cv < FIXED_CV:
        profile = "fixed"
    elif median == 0:
        profile = "episodic"
    else:
        profile = "variable"
    seed: Decimal | None
    skip: SkipReason | None
    if kind != LIVING:
        seed, skip = None, "kind"
    elif profile in ("dormant", "sparse"):
        seed, skip = None, profile
    else:
        # A fixed cost seeds from where it IS (the mean lags a step up: production's rent);
        # everything else seeds the mean, which conserves the annual total for modeling.
        seed, skip = ceil_dollars(latest if profile == "fixed" else mean_exact), None
    return Suggestion(
        category_id,
        profile,
        n,
        mean_exact.quantize(CENTS, rounding=ROUND_HALF_UP),
        median.quantize(CENTS, rounding=ROUND_HALF_UP),
        latest,
        latest_month,
        cv,
        seed,
        skip,
    )
```

- [ ] **4 Run**: `pytest tests/test_budgets_service.py -q` → 9 passed. `ruff format` + `ruff check` (mypy-style: if ruff/pyright complains about the `profile in ("dormant", "sparse")` narrowing, keep it — the literal union is what the dataclass field wants).

- [ ] **5 Commit**

```bash
git add backend/app/services/budgets.py backend/tests/test_budgets_service.py
git commit -m "feat(budgets): the suggestion model — complete-months window, fixed/variable/episodic profiles, whole-dollar seeds (spec §1)"
```

---

### Task 3: Loaders, schemas and `GET /spending/budgets/suggestions`

**Files:**
- Modify: `backend/app/services/budgets.py` (two async loaders)
- Modify: `backend/app/schemas/spending.py` (five models)
- Modify: `backend/app/api/spending.py` (one route, `_window_out`, imports)
- Test: `backend/tests/test_spending_api.py`

- [ ] **1 Write the failing tests.** Append to `backend/tests/test_spending_api.py`. It already imports `date`, `Decimal`, `ANY` and the models used here.

```python
# --- budgets seeded from averages (2026-09-07 spec §1–§2) ---


def _month(year: int, month: int) -> date:
    return date(year, month, 1)


async def _seed_budget_history(db) -> dict[str, int]:
    """Fourteen entered months (Jul 2025 – Aug 2026) plus the CURRENT month (Sep 2026, rent
    only — the routes' clock is pinned to 2026-09-07) across six categories: Rent (fixed;
    steps up in Apr 2026), Food (variable), Travel (episodic), Kids (dormant), Streaming
    (sparse — its first row is Jul 2026, so earlier months are ABSENT, not zero), Taxes (kind
    tax). The window is the last twelve complete months: Sep 2025 – Aug 2026, so Jul/Aug 2025
    and the partial September never reach a mean. Every figure below is scratchpad/figures.py's."""
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    food = SpendingCategory(name="Food", slug="food", sort_order=2)
    travel = SpendingCategory(name="Travel", slug="travel", sort_order=3)
    kids = SpendingCategory(name="Kids", slug="kids", sort_order=4)
    streaming = SpendingCategory(name="Streaming", slug="streaming", sort_order=5)
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=6, kind="tax")
    db.add_all([rent, food, travel, kids, streaming, taxes])
    await db.flush()
    months = [_month(2025, 7 + i) for i in range(6)] + [_month(2026, i) for i in range(1, 9)]
    food_amounts = ["700.00", "800.00", "900.00", "1100.00", "1000.00", "1250.50", "850.00",
                    "1000.25", "1120.00", "980.00", "1010.00", "1300.00", "940.00", "1049.25"]
    travel_amounts = ["0.00", "0.00", "0.00", "0.00", "0.00", "1525.63", "0.00", "0.00",
                      "0.00", "0.00", "810.20", "0.00", "0.00", "0.00"]
    for i, month in enumerate(months):
        rent_amount = "2072.80" if month >= _month(2026, 4) else "2030.00"
        db.add_all(
            [
                MonthlySpending(month=month, category_id=rent.id, amount=Decimal(rent_amount)),
                MonthlySpending(month=month, category_id=food.id, amount=Decimal(food_amounts[i])),
                MonthlySpending(month=month, category_id=travel.id, amount=Decimal(travel_amounts[i])),
                MonthlySpending(month=month, category_id=kids.id, amount=Decimal("0.00")),
                MonthlySpending(
                    month=month,
                    category_id=taxes.id,
                    amount=Decimal("5044.00" if month == _month(2026, 4) else "0.00"),
                ),
                MonthlyCashflow(month=month, net_pay=Decimal("9000.00")),
            ]
        )
        if month >= _month(2026, 7):
            db.add(MonthlySpending(month=month, category_id=streaming.id, amount=Decimal("15.99")))
    # The current month, seven days old: rent paid, nothing else — entered, never in the window.
    db.add(MonthlySpending(month=_month(2026, 9), category_id=rent.id, amount=Decimal("2030.00")))
    await db.commit()
    return {
        "rent": rent.id, "food": food.id, "travel": travel.id,
        "kids": kids.id, "streaming": streaming.id, "taxes": taxes.id,
    }


def _pin_today(monkeypatch, today: date) -> None:
    monkeypatch.setattr("app.api.spending.product_today", lambda: today)


async def test_budget_suggestions_window_and_profiles(auth_client, db, monkeypatch):
    ids = await _seed_budget_history(db)
    _pin_today(monkeypatch, date(2026, 9, 7))
    resp = await auth_client.get("/api/v1/spending/budgets/suggestions")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["window"] == {"from": "2025-09-01", "to": "2026-08-01", "months": 12}
    assert [s["category_id"] for s in body["suggestions"]] == [
        ids["rent"], ids["food"], ids["travel"], ids["kids"], ids["streaming"], ids["taxes"]
    ]
    by_id = {s["category_id"]: s for s in body["suggestions"]}
    assert by_id[ids["rent"]] == {
        "category_id": ids["rent"], "profile": "fixed", "months": 12, "mean": "2047.83",
        "median": "2030.00", "latest": "2072.80", "latest_month": "2026-08-01", "cv": "0.0108",
        "seed": "2073.00", "skip_reason": None,
    }
    assert (by_id[ids["food"]]["profile"], by_id[ids["food"]]["seed"]) == ("variable", "1042.00")
    assert (by_id[ids["travel"]]["profile"], by_id[ids["travel"]]["seed"]) == ("episodic", "195.00")
    kids = by_id[ids["kids"]]
    assert (kids["profile"], kids["mean"], kids["seed"], kids["skip_reason"]) == ("dormant", "0.00", None, "dormant")
    streaming = by_id[ids["streaming"]]
    assert (streaming["profile"], streaming["months"], streaming["mean"], streaming["skip_reason"]) == (
        "sparse", 2, "15.99", "sparse",
    )
    taxes = by_id[ids["taxes"]]
    assert (taxes["profile"], taxes["mean"], taxes["seed"], taxes["skip_reason"]) == ("episodic", "420.33", None, "kind")


async def test_budget_suggestions_with_nothing_entered(auth_client, db):
    db.add(SpendingCategory(name="Food", slug="food", sort_order=1))
    await db.commit()
    body = (await auth_client.get("/api/v1/spending/budgets/suggestions")).json()
    assert body["window"] is None
    assert body["suggestions"] == [
        {
            "category_id": ANY, "profile": "dormant", "months": 0, "mean": None, "median": None,
            "latest": None, "latest_month": None, "cv": None, "seed": None, "skip_reason": "dormant",
        }
    ]


async def test_budget_suggestions_list_only_active_categories(auth_client, db):
    db.add_all(
        [
            SpendingCategory(name="Food", slug="food", sort_order=1),
            SpendingCategory(name="Old", slug="old", sort_order=2, is_active=False),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/spending/budgets/suggestions")).json()
    assert len(body["suggestions"]) == 1
```

- [ ] **2 Run to see them fail**: `pytest tests/test_spending_api.py -q -k budget_suggestions` → 3 failed (404).

- [ ] **3 The loaders.** Append to `backend/app/services/budgets.py`; extend its imports with `from sqlalchemy import select`, `from sqlalchemy.ext.asyncio import AsyncSession`, `from app.models import CategoryBudget, MonthlySpending, SpendingCategory` (replace the existing models import) and `from app.services.coverage import load_coverage`.

```python
async def load_suggestions(db: AsyncSession, today: date) -> tuple[list[date], list[Suggestion]]:
    """The window and one Suggestion per ACTIVE category (the card lists only those), in the
    categories' own order. One coverage load (spec §3's ONE definition of entered), one
    categories query, one spending query bounded to the window."""
    coverage = await load_coverage(db)
    window = seed_window(coverage.entered, coverage.net_pay_without_spending, today.replace(day=1))
    categories = list(
        (
            await db.execute(
                select(SpendingCategory)
                .where(SpendingCategory.is_active)
                .order_by(SpendingCategory.sort_order, SpendingCategory.id)
            )
        )
        .scalars()
        .all()
    )
    by_category: dict[int, list[tuple[date, Decimal]]] = {c.id: [] for c in categories}
    if window:
        in_window = set(window)  # the window can straddle a gap month: bound, then filter
        rows = (
            await db.execute(
                select(MonthlySpending)
                .where(MonthlySpending.month >= window[0], MonthlySpending.month <= window[-1])
                .order_by(MonthlySpending.month)
            )
        ).scalars()
        for row in rows:
            if row.month in in_window and row.category_id in by_category:
                by_category[row.category_id].append((row.month, row.amount))
    return window, [suggest(c.id, c.kind, by_category[c.id]) for c in categories]


async def living_budget_total(db: AsyncSession, month: date) -> Decimal | None:
    """The ACTIVE living categories' budgets resolved for `month`, summed (spec §4) — an
    archived category's stale budget and a tax or transfer target are not modeled spend.
    None when no such category has a budget that month."""
    living_ids = set(
        (
            await db.execute(
                select(SpendingCategory.id).where(
                    SpendingCategory.is_active, SpendingCategory.kind == LIVING
                )
            )
        )
        .scalars()
        .all()
    )
    rows = [
        row
        for row in (await db.execute(select(CategoryBudget))).scalars()
        if row.category_id in living_ids
    ]
    amounts = [values[0] for values in resolve_budgets(rows, [month]).values() if values[0] is not None]
    return sum(amounts, Decimal("0.00")) if amounts else None
```

- [ ] **4 The schemas.** In `backend/app/schemas/spending.py` add `from app.schemas.projection import DerivedWindowOut` to the imports and append after `BudgetHistoryEntry`:

```python
# --- budgets seeded from averages (2026-09-07 spec §2) ---


class BudgetSuggestion(BaseModel):
    """One category's window figures and the seed the one-click action would write. `seed`
    is None with a `skip_reason` for a non-living kind, a dormant category or one with fewer
    than three window months; the figures still come through for the editor's chips."""

    model_config = ConfigDict(from_attributes=True)

    category_id: int
    profile: Literal["dormant", "sparse", "fixed", "episodic", "variable"]
    months: int
    mean: Decimal | None
    median: Decimal | None
    latest: Decimal | None
    latest_month: date | None
    cv: Decimal | None
    seed: Decimal | None
    skip_reason: Literal["kind", "dormant", "sparse"] | None


class BudgetSuggestionsOut(BaseModel):
    # The projection's window echo, reused: spelled `from`/`to` on the wire. None when nothing
    # is entered yet.
    window: DerivedWindowOut | None
    suggestions: list[BudgetSuggestion]


class BudgetSeedIn(BaseModel):
    effective_month: date


class BudgetSkip(BaseModel):
    category_id: int
    # `unchanged`: the budget already resolved for the effective month equals the seed — no
    # redundant history step is written.
    reason: Literal["kind", "dormant", "sparse", "unchanged"]


class BudgetSeedOut(BaseModel):
    effective_month: date
    window: DerivedWindowOut | None
    written: list[AmountEntry]
    skipped: list[BudgetSkip]
    # The change batch (the month PUT's contract): None when nothing changed, so the client
    # offers no Undo.
    batch_id: UUID | None
```

- [ ] **5 The route.** In `backend/app/api/spending.py`: extend the `app.schemas.spending` import with `BudgetSuggestion, BudgetSuggestionsOut` (keep it alphabetical), add `from app.schemas.projection import DerivedWindowOut`, `from app.services.scheduler import product_today`, and widen the budgets import to `from app.services.budgets import load_suggestions, resolve_budgets`. Then append after `delete_category_budget`:

```python
def _window_out(window: list[date]) -> DerivedWindowOut | None:
    return (
        DerivedWindowOut(from_month=window[0], to_month=window[-1], months=len(window))
        if window
        else None
    )


@router.get("/budgets/suggestions", response_model=BudgetSuggestionsOut)
async def budget_suggestions(db: AsyncSession = Depends(get_db)) -> BudgetSuggestionsOut:
    """The Budget card's figures (spec §2): read-only, no batch. `product_today`, never
    date.today(): the window's "current month" must agree with the rest of the ritual's clock."""
    window, suggestions = await load_suggestions(db, product_today())
    return BudgetSuggestionsOut(
        window=_window_out(window),
        suggestions=[BudgetSuggestion.model_validate(s) for s in suggestions],
    )
```

- [ ] **6 Run**: `pytest tests/test_spending_api.py -q` → all pass (the three new ones included). `ruff format` + `ruff check`.

- [ ] **7 Commit**

```bash
git add backend/app/services/budgets.py backend/app/schemas/spending.py backend/app/api/spending.py backend/tests/test_spending_api.py
git commit -m "feat(budgets): GET /spending/budgets/suggestions — the window and one profiled suggestion per active category (spec §2)"
```

---

### Task 4: `POST /spending/budgets/seed`

**Files:**
- Modify: `backend/app/api/spending.py`
- Test: `backend/tests/test_spending_api.py`

- [ ] **1 Write the failing tests.** Append to `backend/tests/test_spending_api.py`; add `from sqlalchemy import select` and `CategoryBudget, ChangeLog` to the `app.models` import at the top of the file.

```python
async def test_budget_seed_writes_one_batch_and_the_matrix_reads_it(auth_client, db, monkeypatch):
    ids = await _seed_budget_history(db)
    _pin_today(monkeypatch, date(2026, 9, 7))
    # A hand-set Food budget from Jan 2026: the seed must leave January alone and write a NEW
    # dated row. A Travel row AT the effective month: the seed updates it in place.
    await auth_client.put(
        f"/api/v1/spending/categories/{ids['food']}/budget",
        json={"amount": "900.00", "effective_month": "2026-01-01"},
    )
    await auth_client.put(
        f"/api/v1/spending/categories/{ids['travel']}/budget",
        json={"amount": "50.00", "effective_month": "2026-08-01"},
    )
    resp = await auth_client.post("/api/v1/spending/budgets/seed", json={"effective_month": "2026-08-01"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["effective_month"] == "2026-08-01"
    assert body["window"] == {"from": "2025-09-01", "to": "2026-08-01", "months": 12}
    assert body["written"] == [
        {"category_id": ids["rent"], "amount": "2073.00"},
        {"category_id": ids["food"], "amount": "1042.00"},
        {"category_id": ids["travel"], "amount": "195.00"},
    ]
    assert body["skipped"] == [
        {"category_id": ids["kids"], "reason": "dormant"},
        {"category_id": ids["streaming"], "reason": "sparse"},
        {"category_id": ids["taxes"], "reason": "kind"},
    ]
    assert body["batch_id"] is not None
    # ONE batch: Rent inserted, Food's new dated row inserted, Travel's August row updated —
    # one label, one month stamp, so the Activity card undoes them together.
    logged = (
        await db.execute(
            select(ChangeLog).where(ChangeLog.batch_id == body["batch_id"]).order_by(ChangeLog.id)
        )
    ).scalars().all()
    assert [(r.op, r.table_name, r.month) for r in logged] == [
        ("insert", "category_budgets", date(2026, 8, 1)),
        ("insert", "category_budgets", date(2026, 8, 1)),
        ("update", "category_budgets", date(2026, 8, 1)),
    ]
    assert {r.label for r in logged} == {"Seeded 3 budgets from averages, from Aug 2026"}
    assert logged[2].before["amount"] == "50.00" and logged[2].after["amount"] == "195.00"
    # History before the effective month is untouched: Food reads 900 Jan–Jul, 1042 from Aug on.
    matrix = (await auth_client.get("/api/v1/spending/matrix")).json()
    months = matrix["months"]
    food = next(s for s in matrix["series"] if s["category_id"] == ids["food"])
    assert food["budgets"][months.index("2025-12-01")] is None
    assert food["budgets"][months.index("2026-01-01")] == "900.00"
    assert food["budgets"][months.index("2026-07-01")] == "900.00"
    assert food["budgets"][months.index("2026-08-01")] == "1042.00"
    assert food["budgets"][months.index("2026-09-01")] == "1042.00"
    # Seeding again changes nothing: every seedable category is `unchanged`, no batch.
    again = await auth_client.post("/api/v1/spending/budgets/seed", json={"effective_month": "2026-08-01"})
    assert again.status_code == 200
    assert again.json()["written"] == []
    assert again.json()["batch_id"] is None
    assert again.json()["skipped"] == [
        {"category_id": ids["rent"], "reason": "unchanged"},
        {"category_id": ids["food"], "reason": "unchanged"},
        {"category_id": ids["travel"], "reason": "unchanged"},
        {"category_id": ids["kids"], "reason": "dormant"},
        {"category_id": ids["streaming"], "reason": "sparse"},
        {"category_id": ids["taxes"], "reason": "kind"},
    ]


async def test_budget_seed_validation(auth_client, db, monkeypatch):
    await _seed_budget_history(db)
    _pin_today(monkeypatch, date(2026, 9, 7))
    mid_month = await auth_client.post("/api/v1/spending/budgets/seed", json={"effective_month": "2026-08-15"})
    assert mid_month.status_code == 422
    # With the clock at Sep 2025 only Jul and Aug 2025 are complete: two months is not history.
    _pin_today(monkeypatch, date(2025, 9, 7))
    short = await auth_client.post("/api/v1/spending/budgets/seed", json={"effective_month": "2025-08-01"})
    assert short.status_code == 422
    assert "three complete months" in short.json()["detail"]
    assert (await db.execute(select(CategoryBudget))).scalars().all() == []
```

- [ ] **2 Run to see them fail**: `pytest tests/test_spending_api.py -q -k budget_seed` → 2 failed (404/405).

- [ ] **3 The route.** In `backend/app/api/spending.py`: extend the schemas import with `BudgetSeedIn, BudgetSeedOut, BudgetSkip`, the budgets import with `MIN_SEED_MONTHS`, and append after `budget_suggestions`:

```python
SEED_NEEDS_HISTORY = (
    "needs at least three complete months of spending before a budget can be suggested"
)


@router.post("/budgets/seed", response_model=BudgetSeedOut)
async def seed_budgets(
    body: BudgetSeedIn,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> BudgetSeedOut:
    """The one-click seed (spec §2): every suggestion with a seed becomes the category's
    budget row at `effective_month` — inserted, or updated in place when a row already sits on
    that month — in ONE change batch, so the Activity card's undo reverts it as a unit. A
    category whose budget already RESOLVES to the seed for that month is skipped as
    `unchanged` rather than given a redundant history step. History before the month is
    never touched: that is what effective-dated rows are for."""
    require_first_of_month(body.effective_month)
    window, suggestions = await load_suggestions(db, product_today())
    if len(window) < MIN_SEED_MONTHS:
        raise HTTPException(status_code=422, detail=SEED_NEEDS_HISTORY)
    budget_rows = list((await db.execute(select(CategoryBudget))).scalars().all())
    resolved = resolve_budgets(budget_rows, [body.effective_month])
    at_month = {r.category_id: r for r in budget_rows if r.effective_month == body.effective_month}
    written: list[AmountEntry] = []
    skipped: list[BudgetSkip] = []
    for s in suggestions:
        if s.seed is None:
            skipped.append(BudgetSkip(category_id=s.category_id, reason=s.skip_reason or "dormant"))
            continue
        if resolved.get(s.category_id, [None])[0] == s.seed:
            skipped.append(BudgetSkip(category_id=s.category_id, reason="unchanged"))
            continue
        existing = at_month.get(s.category_id)
        if existing is None:
            row = CategoryBudget(
                category_id=s.category_id, effective_month=body.effective_month, amount=s.seed
            )
            db.add(row)
            await db.flush()
            batch.record_insert(row, month=body.effective_month)
        else:
            before = row_image(existing)
            existing.amount = s.seed
            batch.record_update(existing, before, month=body.effective_month)
        written.append(AmountEntry(category_id=s.category_id, amount=s.seed))
    batch.label = f"Seeded {len(written)} budgets from averages, from {body.effective_month:%b %Y}"
    batch_id = await batch.commit()
    return BudgetSeedOut(
        effective_month=body.effective_month,
        window=_window_out(window),
        written=written,
        skipped=skipped,
        batch_id=batch_id,
    )
```

- [ ] **4 Run**: `pytest tests/test_spending_api.py -q` → all pass. `ruff format` + `ruff check`.

- [ ] **5 Commit**

```bash
git add backend/app/api/spending.py backend/tests/test_spending_api.py
git commit -m "feat(budgets): POST /spending/budgets/seed — every seedable category's suggestion as a dated row, one change batch, unchanged ones skipped (spec §2)"
```

---

### Task 5: The seed's batch undoes as a unit

**Files:**
- Test: `backend/tests/test_activity_api.py`

- [ ] **1 Write the test.** Add `from datetime import UTC, date, datetime, timedelta` (extend the existing line), `from decimal import Decimal`, and `MonthlySpending, SpendingCategory` to the `app.models` import. Append:

```python
async def test_undo_a_budget_seed_removes_every_row_it_wrote(auth_client, db, monkeypatch):
    """Rent 3 × 2030 → fixed (cv 0) → 2030; Food 900/1000/1100 → cv exactly 0.1000, NOT under
    the fixed line → variable → mean 1000; Taxes is a tax kind → skipped. Two inserts, one
    batch, one undo."""
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    food = SpendingCategory(name="Food", slug="food", sort_order=2)
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=3, kind="tax")
    db.add_all([rent, food, taxes])
    await db.flush()
    for month, food_amount in (
        (date(2026, 6, 1), "900.00"),
        (date(2026, 7, 1), "1000.00"),
        (date(2026, 8, 1), "1100.00"),
    ):
        db.add_all(
            [
                MonthlySpending(month=month, category_id=rent.id, amount=Decimal("2030.00")),
                MonthlySpending(month=month, category_id=food.id, amount=Decimal(food_amount)),
                MonthlySpending(month=month, category_id=taxes.id, amount=Decimal("0.00")),
            ]
        )
    await db.commit()
    monkeypatch.setattr("app.api.spending.product_today", lambda: date(2026, 9, 7))
    seeded = await auth_client.post(f"{SP}/budgets/seed", json={"effective_month": "2026-09-01"})
    assert seeded.status_code == 200, seeded.text
    assert [w["amount"] for w in seeded.json()["written"]] == ["2030.00", "1000.00"]
    assert await count_of(db, CategoryBudget) == 2
    resp = await auth_client.post(f"{ACTIVITY}/batches/{seeded.json()['batch_id']}/undo")
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "Undid: Seeded 2 budgets from averages, from Sep 2026"
    assert resp.json()["rows"] == 2
    assert await count_of(db, CategoryBudget) == 0
```

- [ ] **2 Run**: `pytest tests/test_activity_api.py -q` → all pass (this test needs no code change: the undo machinery is generic — if it fails, the route in Task 4 recorded rows wrongly). `ruff format` + `ruff check`.

- [ ] **3 Commit**

```bash
git add backend/tests/test_activity_api.py
git commit -m "test(budgets): a seed's batch undoes as a unit through the Activity route"
```

---

### Task 6: The projection echoes `budget_annual_spend`

**Files:**
- Modify: `backend/app/schemas/projection.py` (`ProjectionOut`)
- Modify: `backend/app/api/projection.py`
- Test: `backend/tests/test_projection_api.py`

- [ ] **1 Write the failing test.** Add `CategoryBudget` to the `app.models` import of `backend/tests/test_projection_api.py` and append:

```python
async def test_projection_echoes_the_budgets_annual_spend(auth_client, db):
    this_month = await _seed_book(db)
    # No budgets: the echo is null and the knobs card shows no preset.
    first = (await auth_client.get("/api/v1/projection")).json()
    assert first["budget_annual_spend"] is None and first["budget_month"] is None
    rent = (await db.execute(select(SpendingCategory).where(SpendingCategory.slug == "rent"))).scalar_one()
    fun = SpendingCategory(name="Fun", slug="fun", sort_order=2)
    tax = SpendingCategory(name="Taxes", slug="taxes", sort_order=3, kind="tax")
    old = SpendingCategory(name="Old", slug="old", sort_order=4, is_active=False)
    db.add_all([fun, tax, old])
    await db.flush()
    db.add_all(
        [
            CategoryBudget(category_id=rent.id, effective_month=month_add(this_month, -3), amount=Decimal("2000.00")),
            CategoryBudget(category_id=fun.id, effective_month=this_month, amount=Decimal("300.00")),
            # A row dated NEXT month is not yet in force; a tax kind and an archived category are
            # never modeled spend.
            CategoryBudget(category_id=fun.id, effective_month=month_add(this_month, 1), amount=Decimal("999.00")),
            CategoryBudget(category_id=tax.id, effective_month=this_month, amount=Decimal("5000.00")),
            CategoryBudget(category_id=old.id, effective_month=this_month, amount=Decimal("400.00")),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["budget_annual_spend"] == "27600.00"  # (2000 + 300) x 12
    assert body["budget_month"] == this_month.isoformat()
    # The DERIVED knob is untouched — the echo is a preset for the card, not a new default.
    assert body["annual_spend"] == "60000.00"
```

- [ ] **2 Run to see it fail**: `pytest tests/test_projection_api.py -q -k budgets_annual` → `KeyError: 'budget_annual_spend'`.

- [ ] **3 The schema.** In `backend/app/schemas/projection.py`, append to `ProjectionOut` after `derived_window`:

```python
    # 2026-09-07 budget-seed spec §4: twelve times the ACTIVE living categories' budgets
    # resolved for `start_month` — the knobs card's "Use my budgets" preset. None without
    # budgets; nullable-with-default so a stored older payload still validates.
    budget_annual_spend: Decimal | None = None
    budget_month: date | None = None
```

- [ ] **4 The route.** In `backend/app/api/projection.py` add `from app.services.budgets import living_budget_total` to the imports, and immediately before `return ProjectionOut(`:

```python
    # The budgets' own annual figure rides beside the derived one (spec §4): a preset the
    # card can offer, never a replacement for what the data derived.
    budget_total = await living_budget_total(db, start_month)
    budget_annual_spend = None if budget_total is None else budget_total * 12
```

and add to the `ProjectionOut(...)` call, after `derived_window=derived_window,`:

```python
        budget_annual_spend=budget_annual_spend,
        budget_month=None if budget_annual_spend is None else start_month,
```

- [ ] **5 Run**: `pytest tests/test_projection_api.py -q` → all pass. `ruff format` + `ruff check`.

- [ ] **6 Commit**

```bash
git add backend/app/schemas/projection.py backend/app/api/projection.py backend/tests/test_projection_api.py
git commit -m "feat(projection): echo budget_annual_spend — 12 × the active living budgets resolved for the start month (spec §4)"
```

---

### Task 7: Wire types, client functions, pure helpers and the chips component

**Files:**
- Modify: `src/types/api.ts` (after `CategoryBudgetEntry`; and `ProjectionOut` after `derived_window`)
- Modify: `src/api/spending.ts`
- Create: `src/components/spending/budgetSeed.ts`, `src/components/spending/budgetSeed.test.ts`, `src/components/spending/BudgetSuggestions.tsx`

- [ ] **1 Types.** In `src/types/api.ts`, directly after the `CategoryBudgetEntry` interface:

```ts
// --- budgets seeded from averages (2026-09-07 spec §2) ---

export type BudgetProfile = 'dormant' | 'sparse' | 'fixed' | 'episodic' | 'variable'
export type BudgetSkipReason = 'kind' | 'dormant' | 'sparse'

/** One category's window figures and the seed the one-click action would write. Figures are
 *  null when there is nothing to compute (no rows in the window); `seed` is null with a
 *  `skip_reason` for a non-living kind, a dormant category or fewer than three months. */
export interface BudgetSuggestion {
  category_id: number
  profile: BudgetProfile
  months: number
  mean: string | null
  median: string | null
  latest: string | null
  latest_month: string | null
  cv: string | null
  seed: string | null
  skip_reason: BudgetSkipReason | null
}

export interface BudgetSuggestionsOut {
  /** The projection's window echo, reused; null when nothing is entered yet. */
  window: DerivedWindowOut | null
  suggestions: BudgetSuggestion[]
}

export interface BudgetSeedOut {
  effective_month: string
  window: DerivedWindowOut | null
  written: AmountEntry[]
  /** `unchanged`: the budget already resolved to the seed that month — nothing written. */
  skipped: { category_id: number; reason: BudgetSkipReason | 'unchanged' }[]
  /** The change batch; null when nothing changed (then there is no Undo to offer). */
  batch_id: string | null
}
```

and in `ProjectionOut`, after the `derived_window` field:

```ts
  /** 12 × the active living categories' budgets resolved for `start_month` (2026-09-07
   *  budget-seed spec §4) — the knobs card's "Use my budgets" preset. Null without budgets;
   *  absent from an older backend, read as `?? null`. */
  budget_annual_spend?: string | null
  budget_month?: string | null
```

- [ ] **2 Client.** In `src/api/spending.ts`, add `BudgetSeedOut, BudgetSuggestionsOut` to the type import and append after `deleteCategoryBudget`:

```ts
// The Budget card's suggestion figures (spec §2): one GET, read-only.
export function fetchBudgetSuggestions(): Promise<BudgetSuggestionsOut> {
  return api<BudgetSuggestionsOut>('/spending/budgets/suggestions')
}

// The one-click seed (spec §2): every seedable category's suggestion becomes a dated budget
// row from `effectiveMonth` (YYYY-MM-01) in ONE change batch — the response's batch_id is
// the Undo.
export function seedBudgets(effectiveMonth: string): Promise<BudgetSeedOut> {
  return api<BudgetSeedOut>('/spending/budgets/seed', {
    method: 'POST',
    body: JSON.stringify({ effective_month: effectiveMonth }),
  })
}
```

- [ ] **3 Write the failing helper tests** — `src/components/spending/budgetSeed.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { BudgetSuggestion, SpendingMatrix } from '../../types/api'
import { MIN_SEED_MONTHS, profileCue, seedCounts, skipSummary } from './budgetSeed'

const suggestion = (
  over: Partial<BudgetSuggestion> & Pick<BudgetSuggestion, 'category_id'>,
): BudgetSuggestion => ({
  profile: 'variable',
  months: 12,
  mean: '100.00',
  median: '90.00',
  latest: '110.00',
  latest_month: '2026-08-01',
  cv: '0.2000',
  seed: '100.00',
  skip_reason: null,
  ...over,
})

const series: SpendingMatrix['series'] = [
  { category_id: 1, values: ['1.00'], budgets: [null] }, // unbudgeted → a write
  { category_id: 2, values: ['1.00'], budgets: ['80.00'] }, // budgeted, differs → a rewrite
  { category_id: 3, values: ['1.00'], budgets: ['100.00'] }, // already AT the seed → the server skips it
  { category_id: 4, values: ['1.00'], budgets: [null] }, // no seed → nothing
]

describe('seedCounts', () => {
  it('counts writes and the rewrites among them; unchanged and unseedable rows stay out', () => {
    const suggestions = [
      suggestion({ category_id: 1 }),
      suggestion({ category_id: 2 }),
      suggestion({ category_id: 3 }),
      suggestion({ category_id: 4, seed: null, profile: 'dormant', skip_reason: 'dormant' }),
    ]
    expect(seedCounts({ series }, 0, suggestions)).toEqual({ writes: 2, rewrites: 1 })
    expect(MIN_SEED_MONTHS).toBe(3)
  })
})

describe('skipSummary', () => {
  it('is null for nothing skipped, otherwise counts each reason in a fixed order', () => {
    expect(skipSummary([])).toBeNull()
    expect(
      skipSummary([
        { category_id: 5, reason: 'kind' },
        { category_id: 6, reason: 'dormant' },
        { category_id: 7, reason: 'dormant' },
        { category_id: 8, reason: 'unchanged' },
        { category_id: 9, reason: 'sparse' },
      ]),
    ).toBe('skipped 5 — 2 never spent, 1 too little history, 1 not living spend, 1 already at its average')
  })
})

describe('profileCue', () => {
  it('names the shape: steady, episodic, high-swing variable; quiet for an ordinary one', () => {
    expect(profileCue(suggestion({ category_id: 1, profile: 'fixed' }), 'living')).toMatch(/^Steady/)
    expect(profileCue(suggestion({ category_id: 1, profile: 'episodic' }), 'living')).toMatch(/annual envelope/)
    expect(profileCue(suggestion({ category_id: 1, cv: '1.3308' }), 'living')).toMatch(/^Varies a lot/)
    expect(profileCue(suggestion({ category_id: 1, cv: '0.4796' }), 'living')).toBeNull()
    expect(profileCue(suggestion({ category_id: 1, profile: 'sparse', months: 2 }), 'living')).toBe(
      'Only 2 complete months in the window — not enough to suggest.',
    )
    expect(profileCue(suggestion({ category_id: 1, profile: 'sparse', months: 1 }), 'living')).toBe(
      'Only 1 complete month in the window — not enough to suggest.',
    )
    expect(profileCue(suggestion({ category_id: 1, profile: 'dormant' }), 'living')).toBe(
      'Nothing spent in the window.',
    )
    // The kind reads first: a dormant transfer is still "not living spend".
    expect(profileCue(suggestion({ category_id: 1, profile: 'dormant' }), 'transfer')).toMatch(/^Not living spend/)
  })
})
```

- [ ] **4 Run to see them fail**: `npx vitest run src/components/spending/budgetSeed.test.ts` → cannot resolve `./budgetSeed`.

- [ ] **5 The helpers** — `src/components/spending/budgetSeed.ts`:

```ts
import type { BudgetSeedOut, BudgetSuggestion, SpendingMatrix } from '../../types/api'

// Pure companions of the Budget card's seed (2026-09-07 spec §3). Number() here is display-side
// math on server strings — the chart builders' license.

/** Mirrors the server's MIN_SEED_MONTHS: fewer complete months and nothing is seeded. */
export const MIN_SEED_MONTHS = 3

/**
 * What a seed from the focused month would do: `writes` = categories with a seed whose
 * resolved budget that month is not already the seed (the server skips those as unchanged);
 * `rewrites` = the writes that replace a budget already in force. Both are known client-side,
 * so the re-seed confirm can say them before anything is sent.
 */
export function seedCounts(
  matrix: Pick<SpendingMatrix, 'series'>,
  monthIndex: number,
  suggestions: BudgetSuggestion[],
): { writes: number; rewrites: number } {
  const budgetById = new Map(matrix.series.map((s) => [s.category_id, s.budgets[monthIndex] ?? null]))
  let writes = 0
  let rewrites = 0
  for (const s of suggestions) {
    if (s.seed === null) continue
    const resolved = budgetById.get(s.category_id) ?? null
    if (resolved !== null && Number(resolved) === Number(s.seed)) continue
    writes += 1
    if (resolved !== null) rewrites += 1
  }
  return { writes, rewrites }
}

type SkipReason = BudgetSeedOut['skipped'][number]['reason']

// Fixed order, so two seeds read alike: the spending shapes first, the bookkeeping last.
const SKIP_WORDS: [SkipReason, string][] = [
  ['dormant', 'never spent'],
  ['sparse', 'too little history'],
  ['kind', 'not living spend'],
  ['unchanged', 'already at its average'],
]

/** "skipped 6 — 3 never spent, 3 not living spend"; null when nothing was skipped. */
export function skipSummary(skipped: BudgetSeedOut['skipped']): string | null {
  if (skipped.length === 0) return null
  const counts = new Map<SkipReason, number>()
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1)
  const parts = SKIP_WORDS.filter(([reason]) => counts.has(reason)).map(
    ([reason, words]) => `${counts.get(reason)} ${words}`,
  )
  return `skipped ${skipped.length} — ${parts.join(', ')}`
}

/**
 * One line on the category's spending shape (spec §3.4 table); null when an ordinary
 * variable category needs no warning. The kind reads first: a tax payment or a transfer is
 * not spending to budget whatever its shape.
 */
export function profileCue(suggestion: BudgetSuggestion, kind: string): string | null {
  if (kind !== 'living') {
    return 'Not living spend — the seed leaves tax payments and transfers unbudgeted.'
  }
  switch (suggestion.profile) {
    case 'fixed':
      return 'Steady — within 10% every month; the latest month is the honest target.'
    case 'episodic':
      return '$0 most months, then spikes — the mean keeps the year honest, but a monthly meter reads empty, then over. An annual envelope is the real fix.'
    case 'variable':
      return suggestion.cv !== null && Number(suggestion.cv) >= 1
        ? 'Varies a lot — the median is the typical month; the mean keeps the yearly total honest.'
        : null
    case 'sparse':
      return `Only ${suggestion.months} complete ${suggestion.months === 1 ? 'month' : 'months'} in the window — not enough to suggest.`
    case 'dormant':
      return 'Nothing spent in the window.'
  }
}
```

- [ ] **6 Run**: `npx vitest run src/components/spending/budgetSeed.test.ts` → 3 passed.

- [ ] **7 The chips** — `src/components/spending/BudgetSuggestions.tsx`:

```tsx
import type { BudgetSuggestion } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { profileCue } from './budgetSeed'

/**
 * One editor's suggestion line (2026-09-07 spec §3.4): the seed the one-click action would
 * write, then a chip per statistic that exists — each sets the amount box — and the profile's
 * cue. Chips are `.button`s at the editor's size; figures in the monospace family. No colour
 * carries meaning here: the suggested chip is outlined, and it says "suggested".
 */
export default function BudgetSuggestions({
  categoryName,
  kind,
  suggestion,
  onPick,
}: {
  categoryName: string
  kind: string
  suggestion: BudgetSuggestion
  onPick: (amount: string) => void
}) {
  const chips: { key: string; label: string; value: string; suggested?: boolean }[] = []
  if (suggestion.seed !== null) {
    chips.push({ key: 'seed', label: 'suggested', value: suggestion.seed, suggested: true })
  }
  if (suggestion.mean !== null) chips.push({ key: 'mean', label: 'mean', value: suggestion.mean })
  if (suggestion.median !== null) chips.push({ key: 'median', label: 'median', value: suggestion.median })
  if (suggestion.latest !== null) chips.push({ key: 'latest', label: 'last month', value: suggestion.latest })
  const cue = profileCue(suggestion, kind)
  return (
    <div className="budget-suggest">
      {suggestion.seed === null && <span className="budget-suggest-none">no suggestion</span>}
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={`button budget-chip${chip.suggested ? ' is-suggested' : ''}`}
          aria-label={`Use ${categoryName} ${chip.label} ${formatCurrency(chip.value)}`}
          onClick={() => onPick(chip.value)}
        >
          {`${chip.label} ${formatCurrency(chip.value)}`}
        </button>
      ))}
      {cue !== null && <p className="drill-hint budget-suggest-cue">{cue}</p>}
    </div>
  )
}
```

- [ ] **8 Gate**: `npx tsc -b && npx eslint src/types/api.ts src/api/spending.ts src/components/spending/budgetSeed.ts src/components/spending/budgetSeed.test.ts src/components/spending/BudgetSuggestions.tsx` → clean.

- [ ] **9 Commit**

```bash
git add src/types/api.ts src/api/spending.ts src/components/spending/budgetSeed.ts src/components/spending/budgetSeed.test.ts src/components/spending/BudgetSuggestions.tsx
git commit -m "feat(budgets): wire types, the two client functions, the seed's pure helpers and the suggestion chips (spec §2, §3.4)"
```

---

### Task 8: The Budget card — seed, re-seed confirm, chips, Undo toast

One component, one rewrite: the file below is the complete new `BudgetPanel.tsx`. Tests first.

**Files:**
- Modify: `src/components/spending/BudgetPanel.tsx` (full replacement), `src/components/spending/budgets.css` (append), `src/components/spending/BudgetPanel.test.tsx`, `src/pages/SpendingPage.test.tsx`

- [ ] **1 Update the test harness** at the top of `src/components/spending/BudgetPanel.test.tsx`. Replace the `vi.mock('../../api/spending', …)` block and the import line under it, and extend `beforeEach`:

```ts
vi.mock('../../api/spending', () => ({
  putCategoryBudget: vi.fn(),
  deleteCategoryBudget: vi.fn(),
  fetchBudgetSuggestions: vi.fn(),
  seedBudgets: vi.fn(),
}))
vi.mock('../../api/lifecycle', () => ({ undoBatch: vi.fn() }))
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))

import { undoBatch } from '../../api/lifecycle'
import {
  deleteCategoryBudget,
  fetchBudgetSuggestions,
  putCategoryBudget,
  seedBudgets,
} from '../../api/spending'
import type { BudgetSeedOut, BudgetSuggestionsOut, SpendingMatrix } from '../../types/api'
```

Below the existing `matrix` fixture add:

```ts
// The same book with nothing budgeted: the card's empty state.
const blank: SpendingMatrix = {
  ...matrix,
  series: matrix.series.map((s) => ({ ...s, budgets: s.budgets.map(() => null) })),
  total_budget: [null, null],
}

const suggestions: BudgetSuggestionsOut = {
  window: { from: '2025-02-01', to: '2026-01-01', months: 12 },
  suggestions: [
    { category_id: 1, profile: 'variable', months: 12, mean: '412.35', median: '390.00', latest: '450.00', latest_month: '2026-01-01', cv: '0.2100', seed: '413.00', skip_reason: null },
    { category_id: 2, profile: 'fixed', months: 12, mean: '1995.00', median: '2000.00', latest: '2000.00', latest_month: '2026-01-01', cv: '0.0100', seed: '2000.00', skip_reason: null },
  ],
}

const seeded: BudgetSeedOut = {
  effective_month: '2026-01-01',
  window: suggestions.window,
  written: [{ category_id: 1, amount: '413.00' }, { category_id: 2, amount: '2000.00' }],
  skipped: [{ category_id: 3, reason: 'dormant' }],
  batch_id: 'b-1',
}
```

and in `beforeEach`, after the existing two `mockResolvedValue` lines:

```ts
  vi.mocked(fetchBudgetSuggestions).mockResolvedValue(suggestions)
  vi.mocked(seedBudgets).mockResolvedValue(seeded)
  vi.mocked(undoBatch).mockResolvedValue({} as never)
```

- [ ] **2 Write the failing tests.** Append to the file:

```ts
// --- seeded from averages (2026-09-07 spec §3) ---

it('offers Start from my averages in the empty state, seeds the FOCUSED month, refetches and toasts with Undo', async () => {
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  const button = (await screen.findByRole('button', { name: 'Start from my averages' })) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  const hint = screen.getByText(/Writes a budget for 2 living categories/).textContent ?? ''
  expect(hint).toMatch(/effective from Jan 2026/)
  expect(hint).toMatch(/Feb 2025–Jan 2026/)
  fireEvent.click(button)
  await waitFor(() => expect(seedBudgets).toHaveBeenCalledWith('2026-01-01'))
  await waitFor(() => expect(onBudgetsChanged).toHaveBeenCalledTimes(1))
  expect(toast.success).toHaveBeenCalledWith(
    'Seeded 2 budgets from averages, from Jan 2026',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
  )
  expect(screen.getByText('skipped 1 — 1 never spent')).toBeDefined()
  // Undo replays the batch, clears the status line and refetches.
  const options = vi.mocked(toast.success).mock.calls[0][1] as { action: { onAction: () => void } }
  options.action.onAction()
  await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('b-1'))
  await waitFor(() => expect(onBudgetsChanged).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('skipped 1 — 1 never spent')).toBeNull()
})

it('a seed that changed nothing offers no Undo', async () => {
  vi.mocked(seedBudgets).mockResolvedValue({ ...seeded, written: [], batch_id: null })
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start from my averages' }))
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Seeded 0 budgets from averages, from Jan 2026', undefined))
})

it('disables the seed with the reason under three complete months', async () => {
  vi.mocked(fetchBudgetSuggestions).mockResolvedValue({
    ...suggestions,
    window: { from: '2025-12-01', to: '2026-01-01', months: 2 },
  })
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  await screen.findByText(/needs at least three complete months of spending \(2 so far\)/)
  const button = screen.getByRole('button', { name: 'Start from my averages' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
})

it('degrades when the suggestions cannot load: seed disabled with the reason, editor intact, no chips', async () => {
  vi.mocked(fetchBudgetSuggestions).mockRejectedValue(new Error('boom'))
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  await screen.findByText(/couldn't load the suggestions/)
  expect((screen.getByRole('button', { name: 'Start from my averages' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByLabelText('Food budget amount')).toBeDefined()
  expect(screen.queryByRole('button', { name: /^Use Food/ })).toBeNull()
})

it('the editor shows suggestion chips and a chip fills the amount box; the cue names the shape', async () => {
  renderPanel(0)
  fireEvent.click(await screen.findByRole('button', { name: 'Use Food median $390.00' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$390.00')
  fireEvent.click(screen.getByRole('button', { name: 'Use Food suggested $413.00' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$413.00')
  expect(screen.getByRole('button', { name: 'Use Rent last month $2,000.00' })).toBeDefined()
  expect(screen.getByText(/^Steady — within 10% every month/)).toBeDefined()
})

it('re-seeding asks first, counting the budgets it rewrites, and only POSTs on Confirm', async () => {
  renderPanel(0) // Food budgeted at 400 (seed 413 → a rewrite); Rent unbudgeted (seed 2000 → new)
  fireEvent.click(await screen.findByRole('button', { name: 'Re-seed from averages' }))
  expect(seedBudgets).not.toHaveBeenCalled()
  expect(screen.getByText(/Rewrites 1 existing budget and sets 1 new one from Jan 2026\./)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByText(/Rewrites 1 existing/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Re-seed from averages' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(seedBudgets).toHaveBeenCalledWith('2026-01-01'))
})

it('a failed seed lands in the banner and refetches nothing', async () => {
  vi.mocked(seedBudgets).mockRejectedValue(new Error('down'))
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start from my averages' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/Failed to seed the budgets/)
  expect(onBudgetsChanged).not.toHaveBeenCalled()
})
```

- [ ] **3 Run to see them fail**: `npx vitest run src/components/spending/BudgetPanel.test.tsx` → the seven new tests fail (no such buttons); the eight old ones still pass.

- [ ] **4 Replace `src/components/spending/BudgetPanel.tsx`** with:

```tsx
import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import {
  deleteCategoryBudget,
  fetchBudgetSuggestions,
  putCategoryBudget,
  seedBudgets,
} from '../../api/spending'
import type {
  BudgetSuggestionsOut,
  CategoryBudgetEntry,
  CategoryOut,
  SpendingMatrix,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatMonth } from '../../utils/format'
import { budgetProgress } from '../../utils/spending'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { windowWords } from '../overview/ytd'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import BudgetSuggestions from './BudgetSuggestions'
import { MIN_SEED_MONTHS, seedCounts, skipSummary } from './budgetSeed'
import '../panels.css'
import './budgets.css'

interface EditorState {
  amount: string
  effectiveFrom: string // YYYY-MM; '-01' is appended at save (budgets are month-dated)
}

function failMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Budget card (spec §4.2): one 4px meter per BUDGETED category for the page's focused
 * month, unbudgeted actives collapsed below, and the app's first budget-management
 * surface — an inline effective-dated editor whose PUT response is the history it renders.
 * Plain HTML/CSS in the StatTile family, no ECharts.
 *
 * 2026-09-07 (budget-seed spec §3): the empty state's one action — "Start from my averages"
 * writes every seedable living category's typical spend as a dated row from the focused
 * month, one change batch, one Undo — a confirm-first re-seed once budgets exist, and a
 * suggestion line in every editor. The figures come from GET /spending/budgets/suggestions,
 * fetched once; if that fails the meters and the editor are untouched and the seed says why.
 */
export default function BudgetPanel({
  matrix,
  monthIndex,
  onBudgetsChanged,
}: {
  matrix: SpendingMatrix
  monthIndex: number
  onBudgetsChanged: () => void
}) {
  const toast = useToast()
  const [editors, setEditors] = useState<Record<number, EditorState>>({})
  // Histories arrive ONLY as PUT responses (spec §3 — no history GET exists), so the
  // expandable list appears per category once this session has saved it.
  const [histories, setHistories] = useState<Record<number, CategoryBudgetEntry[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<BudgetSuggestionsOut | null>(null)
  const [suggestionsFailed, setSuggestionsFailed] = useState(false)
  // The last seed's skip detail; cleared by its Undo, replaced by the next seed.
  const [seedStatus, setSeedStatus] = useState<string | null>(null)
  const [confirmReseed, setConfirmReseed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchBudgetSuggestions()
      .then((out) => {
        if (!cancelled) setSuggestions(out)
      })
      .catch(() => {
        if (!cancelled) setSuggestionsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const month = matrix.months[monthIndex]
  // A5 (2026-08-31 tier-1): default to the FOCUSED month — the month the meters read.
  // The old next-calendar-month default made a first budget save successfully and
  // visibly do nothing (the meters were reading a month the budget hadn't reached).
  // months entries are YYYY-MM-01 (or YYYY-MM in old fixtures); the input wants YYYY-MM.
  const defaultEffectiveFrom = month.slice(0, 7)
  const effectiveMonth = `${defaultEffectiveFrom}-01`

  const seriesById = new Map(matrix.series.map((s) => [s.category_id, s]))
  const rows = matrix.categories
    .filter((c) => c.is_active)
    .map((category) => {
      const series = seriesById.get(category.id)
      const spent = series?.values[monthIndex] ?? null
      const budget = series?.budgets[monthIndex] ?? null
      return { category, budget, progress: budgetProgress(spent, budget) }
    })
  const budgeted = rows.flatMap((row) =>
    row.progress === null ? [] : [{ ...row, progress: row.progress }],
  )
  const unbudgeted = rows.filter((row) => row.progress === null)
  const overCount = budgeted.filter((row) => row.progress.over).length

  const suggestionById = new Map((suggestions?.suggestions ?? []).map((s) => [s.category_id, s]))
  const seedWindow = suggestions?.window ?? null
  const counts = suggestions === null ? null : seedCounts(matrix, monthIndex, suggestions.suggestions)
  const canSeed =
    counts !== null && seedWindow !== null && seedWindow.months >= MIN_SEED_MONTHS && counts.writes > 0

  // The seed button's caption: what it would write, or why it cannot yet (spec §3.1).
  const seedHint = (): string => {
    if (suggestionsFailed) return "Not yet — couldn't load the suggestions."
    if (suggestions === null || counts === null) return 'Loading suggestions…'
    if (seedWindow === null || seedWindow.months < MIN_SEED_MONTHS) {
      return `Not yet — needs at least three complete months of spending (${seedWindow?.months ?? 0} so far).`
    }
    if (counts.writes === 0) {
      return 'Nothing to seed — every category is dormant, sparse, not living spend or already at its average.'
    }
    return `Writes a budget for ${counts.writes} living ${counts.writes === 1 ? 'category' : 'categories'} with three or more complete months, effective from ${formatMonth(month)}: the mean of ${windowWords(seedWindow)}, or the latest month for steady costs like rent. Everything stays editable; one Undo reverts it all.`
  }

  const seed = () => {
    setBusy(true)
    setError(null)
    setConfirmReseed(false)
    seedBudgets(effectiveMonth)
      .then((out) => {
        setSeedStatus(skipSummary(out.skipped))
        onBudgetsChanged()
        const n = out.written.length
        const done = `Seeded ${n} ${n === 1 ? 'budget' : 'budgets'} from averages, from ${formatMonth(month)}`
        const batchId = out.batch_id
        // The wizard's contract: a null batch means nothing changed, so there is no Undo.
        toast.success(
          done,
          batchId === null
            ? undefined
            : {
                action: {
                  label: 'Undo',
                  onAction: () => {
                    undoBatch(batchId)
                      .then(() => {
                        setSeedStatus(null)
                        toast.success(`Undone — the ${formatMonth(month)} seed is gone.`)
                        onBudgetsChanged()
                      })
                      .catch((err: unknown) => toast.error(failMessage(err, 'Undo failed')))
                  },
                },
              },
        )
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to seed the budgets')))
      .finally(() => setBusy(false))
  }

  const save = (category: CategoryOut, editor: EditorState) => {
    const trimmed = editor.amount.trim()
    // Blank ENDS the budget from that month (the stored null marker, spec §2); anything
    // else must be a non-negative amount — mirrors the server's 422s so the round trip
    // never surprises.
    const amount = trimmed === '' ? null : canonicalAmount(trimmed)
    if (amount !== null && (!isAmount(trimmed) || Number(amount) < 0)) {
      setError('Budget must be a non-negative amount (or blank to end the budget)')
      return
    }
    if (!/^\d{4}-\d{2}$/.test(editor.effectiveFrom)) {
      setError('Pick an effective-from month')
      return
    }
    setBusy(true)
    setError(null)
    putCategoryBudget(category.id, {
      amount,
      effective_month: `${editor.effectiveFrom}-01`,
    })
      .then((history) => {
        setHistories((cur) => ({ ...cur, [category.id]: history }))
        setEditors((cur) => {
          const next = { ...cur }
          delete next[category.id]
          return next
        })
        onBudgetsChanged()
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to save the budget')))
      .finally(() => setBusy(false))
  }

  const removeRow = (category: CategoryOut, effectiveMonthIso: string) => {
    setBusy(true)
    setError(null)
    deleteCategoryBudget(category.id, effectiveMonthIso)
      .then(() => {
        setHistories((cur) => ({
          ...cur,
          [category.id]: (cur[category.id] ?? []).filter(
            (h) => h.effective_month !== effectiveMonthIso,
          ),
        }))
        onBudgetsChanged()
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to delete the budget row')))
      .finally(() => setBusy(false))
  }

  const editorBlock = (category: CategoryOut, budget: string | null) => {
    const editor = editors[category.id] ?? {
      amount: budget ?? '',
      effectiveFrom: defaultEffectiveFrom,
    }
    const setEditor = (patch: Partial<EditorState>) =>
      setEditors((cur) => ({ ...cur, [category.id]: { ...editor, ...patch } }))
    const history = histories[category.id]
    const suggestion = suggestionById.get(category.id)
    return (
      <details className="budget-editor">
        <summary>Set budget</summary>
        <div className="budget-editor-form">
          <label>
            Monthly budget
            <AmountInput
              value={editor.amount}
              onValueChange={(next) => setEditor({ amount: next })}
              placeholder="blank ends the budget"
              aria-label={`${category.name} budget amount`}
            />
          </label>
          <label>
            Effective from
            <input
              type="month"
              className="field-input"
              aria-label={`${category.name} budget effective from`}
              value={editor.effectiveFrom}
              onChange={(e) => setEditor({ effectiveFrom: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button"
            aria-label={`Save ${category.name} budget`}
            disabled={busy}
            onClick={() => save(category, editor)}
          >
            Save
          </button>
          {/* A5: promoted into the control row (was parked between the form and the
              history list) — the past-dating warning must be read at the moment the date
              is chosen, one short line. */}
          <p className="drill-hint budget-editor-hint">
            Defaults to {formatMonth(month)} — the month the meters read. Dating it in the
            past re-writes what that era&apos;s budget was.
          </p>
          {suggestion !== undefined && (
            <BudgetSuggestions
              categoryName={category.name}
              kind={category.kind}
              suggestion={suggestion}
              onPick={(amount) => setEditor({ amount })}
            />
          )}
        </div>
        {history !== undefined && (
          <ul className="budget-history">
            {history.map((entry) => (
              <li key={entry.effective_month}>
                <span>
                  {`${formatMonth(entry.effective_month)} — ${
                    entry.amount === null ? 'budget ends' : formatCurrency(entry.amount)
                  }`}
                </span>
                <button
                  type="button"
                  className="button"
                  aria-label={`Delete the ${formatMonth(entry.effective_month)} budget row for ${category.name}`}
                  disabled={busy}
                  onClick={() => removeRow(category, entry.effective_month)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    )
  }

  const newCount = counts === null ? 0 : counts.writes - counts.rewrites

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Budgets — {formatMonth(month)}
        <InfoHint text="Each budgeted category's spend against its budget for the focused month. Budgets are effective-dated: a change applies from its month forward and never rewrites history. With no transaction feed there is no mid-month pacing — meters describe completed months and the live wizard entry. Start from my averages writes every living category's typical spend as an editable budget; the editor's chips offer the same figures one at a time." />
      </h2>
      <FeedBanner error={error} />
      {seedStatus !== null && (
        <p className="drill-hint budget-seed-status" role="status">
          {seedStatus}
        </p>
      )}
      {budgeted.length > 0 ? (
        <>
          <div className="budget-summary-row">
            <p className="drill-hint" role="status">
              {`${overCount} of ${budgeted.length} budgeted categories over in ${formatMonth(month)}`}
            </p>
            {canSeed && !confirmReseed && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setConfirmReseed(true)}
              >
                Re-seed from averages
              </button>
            )}
          </div>
          {confirmReseed && counts !== null && (
            <p className="drill-hint budget-reseed-confirm" role="status">
              {`Rewrites ${counts.rewrites} existing ${counts.rewrites === 1 ? 'budget' : 'budgets'} and sets ${newCount} new ${newCount === 1 ? 'one' : 'ones'} from ${formatMonth(month)}.`}
              <button type="button" className="button" disabled={busy} onClick={seed}>
                Confirm
              </button>
              <button type="button" className="button" onClick={() => setConfirmReseed(false)}>
                Cancel
              </button>
            </p>
          )}
          <div className="budget-rows">
            {budgeted.map(({ category, budget, progress }) => (
              <div className="budget-row" key={category.id}>
                <span className="budget-name">{category.name}</span>
                <div
                  className="budget-meter"
                  role="meter"
                  aria-label={`${category.name} spend vs budget`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.fillPct)}
                  aria-valuetext={`${formatCurrency(progress.spent)} of ${formatCurrency(progress.budget)}`}
                >
                  <div
                    className={`budget-fill${progress.over ? ' is-over' : ''}`}
                    style={{ width: `${progress.fillPct.toFixed(2)}%` }}
                  />
                  {/* Over-ness rides a POSITION channel (the tick past the track's end),
                      not colour alone — the summary line carries it in words too. */}
                  {progress.over && <span className="budget-overflow-tick" aria-hidden="true" />}
                </div>
                <span className={`budget-figures${progress.over ? ' delta-negative' : ''}`}>
                  {`${formatCurrency(progress.spent)} / ${formatCurrency(progress.budget)}`}
                </span>
                {editorBlock(category, budget)}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="budget-seed">
          <p className="empty-note">No budgets yet.</p>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !canSeed}
            onClick={seed}
          >
            Start from my averages
          </button>
          <p className="drill-hint budget-seed-hint">{seedHint()}</p>
        </div>
      )}
      {unbudgeted.length > 0 && (
        <details className="budget-unbudgeted">
          <summary>{`No budget — set one (${unbudgeted.length})`}</summary>
          <div className="budget-rows">
            {unbudgeted.map(({ category, budget }) => (
              <div className="budget-row" key={category.id}>
                <span className="budget-name">{category.name}</span>
                {editorBlock(category, budget)}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
```

- [ ] **5 Styles.** Append to `src/components/spending/budgets.css`:

```css
/* 2026-09-07 seed (budget-seed spec §3): the empty state's one action, the re-seed row and
   the editor's suggestion chips. Text tokens and the .button family only — nothing here is
   a chart, and no colour carries a meaning the words do not. */
.budget-seed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

.budget-seed .empty-note {
  margin: 0;
}

.budget-seed-hint,
.budget-seed-status {
  margin: 0;
  max-width: 64ch;
}

.budget-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.budget-summary-row .drill-hint {
  margin: 0;
}

.budget-reseed-confirm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.budget-suggest {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: var(--muted);
}

.budget-suggest-none {
  font-style: italic;
}

.budget-chip {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  font-variant-numeric: tabular-nums;
}

.budget-chip.is-suggested {
  border-color: var(--accent);
  color: var(--text);
}

.budget-suggest-cue {
  flex-basis: 100%;
  margin: 0;
}
```

- [ ] **6 The page test's mock.** In `src/pages/SpendingPage.test.tsx` the module mock on line 9 becomes:

```ts
vi.mock('../api/spending', () => ({
  fetchMatrix: vi.fn(),
  fetchYearly: vi.fn(),
  fetchBudgetSuggestions: vi.fn(),
  seedBudgets: vi.fn(),
}))
```

add `fetchBudgetSuggestions` to the file's `import { fetchMatrix, fetchYearly } from '../api/spending'` line, and in its top-level `beforeEach` (line ~186) after the `fetchYearly` line add:

```ts
  // The Budget card fetches its suggestions on mount; an empty answer keeps the page tests
  // about the page.
  vi.mocked(fetchBudgetSuggestions).mockResolvedValue({ window: null, suggestions: [] })
```

- [ ] **7 Run**: `npx vitest run src/components/spending src/pages/SpendingPage.test.tsx` → all pass (15 in `BudgetPanel.test.tsx`). Then the sweep for any other test that mounts the card: `npx vitest run src/components/Layout.test.tsx src/components/CommandPalette.test.tsx src/pages/OverviewPage.test.tsx` → all pass; if one fails with `fetchBudgetSuggestions is not a function`, give that file's `api/spending` mock the same two functions and resolved value as step 6.

- [ ] **8 Gate**: `npx tsc -b && npx eslint src/components/spending src/pages/SpendingPage.test.tsx` → clean.

- [ ] **9 Commit**

```bash
git add src/components/spending/BudgetPanel.tsx src/components/spending/budgets.css src/components/spending/BudgetPanel.test.tsx src/pages/SpendingPage.test.tsx
git commit -m "feat(budgets): the Budget card seeds from averages — empty-state action, confirm-first re-seed, suggestion chips, one-Undo toast (spec §3)"
```

---

### Task 9: Projection — "Use my budgets"

**Files:**
- Modify: `src/components/projection/ScenarioPanel.tsx`
- Test: `src/components/projection/ScenarioPanel.test.tsx`

- [ ] **1 Write the failing tests.** Append inside the file's `describe('ScenarioPanel', …)` block:

```ts
  it('offers Use my budgets under the annual-spend knob only when the echo carries it, sets the knob, then reads as in use', async () => {
    preview.mockImplementation(async () => ({ ...echo, budget_annual_spend: '61752.00', budget_month: '2026-09-01' }))
    mount()
    const button = await screen.findByRole('button', { name: 'Use my budgets · $61,752.00/yr' })
    expect(screen.getByText(/12 × the living-category budgets resolved for Sep 2026/)).toBeDefined()
    fireEvent.click(button)
    await waitFor(() => expect(url()).toContain('61752'))
    const inUse = screen.getByRole('button', { name: 'using your budgets' }) as HTMLButtonElement
    expect(inUse.disabled).toBe(true)
  })

  it('hides the budgets preset when the echo has none', async () => {
    mount()
    await screen.findByText(/derived over/)
    expect(screen.queryByRole('button', { name: /Use my budgets|using your budgets/ })).toBeNull()
  })
```

- [ ] **2 Run to see them fail**: `npx vitest run src/components/projection/ScenarioPanel.test.tsx` → the first new test fails (no such button); the second passes already.

- [ ] **3 Implement.** In `src/components/projection/ScenarioPanel.tsx`:

(a) widen the format import: `import { formatCurrency, formatMonth } from '../../utils/format'`.

(b) after `const derivedWindow = baseline?.derived_window ?? null` inside the `ORDER.map` callback, add:

```tsx
        // 2026-09-07 budget-seed spec §4: the budgets' own annual figure as a preset beside
        // the derived one. Absent from an older backend and null without budgets, so the
        // button exists only when the echo carries a number.
        const budgetAnnual = key === 'annual_spend' ? (baseline?.budget_annual_spend ?? null) : null
        const budgetMonth = baseline?.budget_month ?? null
        const showsBudgets = budgetAnnual !== null
```

(c) change the early return to `if (!showsBreakdown && !(windowed && derivedWindow !== null) && !showsBudgets) return slider`.

(d) inside the wrapping `<div key={key} className="slider-box">`, after the `{windowed && derivedWindow !== null && (…)}` span, add:

```tsx
            {budgetAnnual !== null && (
              <span className="projection-derived">
                <button
                  type="button"
                  className="button"
                  disabled={scenario.knobs.annual_spend === budgetAnnual}
                  onClick={() => knob('annual_spend')(budgetAnnual, true)}
                >
                  {scenario.knobs.annual_spend === budgetAnnual
                    ? 'using your budgets'
                    : `Use my budgets · ${formatCurrency(budgetAnnual)}/yr`}
                </button>
                {budgetMonth !== null &&
                  ` 12 × the living-category budgets resolved for ${formatMonth(budgetMonth)}.`}
              </span>
            )}
```

(e) extend `HINTS.annual_spend` with one sentence at its end: ` When budgets exist, "Use my budgets" sets this to twelve times the living-category budgets in force this month.`

- [ ] **4 Run**: `npx vitest run src/components/projection/ScenarioPanel.test.tsx` → all pass. `npx tsc -b && npx eslint src/components/projection/ScenarioPanel.tsx src/components/projection/ScenarioPanel.test.tsx` → clean.

- [ ] **5 Commit**

```bash
git add src/components/projection/ScenarioPanel.tsx src/components/projection/ScenarioPanel.test.tsx
git commit -m "feat(projection): Use my budgets — the knobs card's annual-spend preset from the budgets echo (spec §4)"
```

---

### Task 10: A lane's own server pair — proxy override

The probes README's "own pair of servers" recipe starts a second vite, but `vite.config.ts` hard-wires the proxy to 8000, so that vite still talked to the shared backend. One env var fixes it; Task 11 relies on it.

**Files:**
- Modify: `vite.config.ts` (the `server.proxy` block), `tools/probes/README.md` (the calendar recipe's `npm run dev` line)

- [ ] **1** In `vite.config.ts` replace the proxy entry:

```ts
  server: {
    proxy: {
      // 127.0.0.1, not localhost: Node >=17 resolves localhost to ::1 first, but
      // uvicorn binds IPv4 only — every dev API call would 500 with ECONNREFUSED ::1.
      // VITE_API_PROXY points a lane's vite (on its own port) at that lane's uvicorn instead
      // of whatever owns 8000 — the probes README's "own pair of servers" recipe needs it.
      '/api': process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000',
    },
  },
```

- [ ] **2** In `tools/probes/README.md`, the recipe line `npm run dev -- --port 5174 &` becomes `VITE_API_PROXY=http://127.0.0.1:8010 npm run dev -- --port 5174 &` with the comment above it extended: `# in the worktree: uvicorn on 8010, vite on 5174 — VITE_API_PROXY makes that vite talk to THAT uvicorn`.

- [ ] **3** `npx tsc -b` → clean (the config is type-checked by `tsconfig.node.json`). Commit:

```bash
git add vite.config.ts tools/probes/README.md
git commit -m "chore(dev): VITE_API_PROXY — a lane's vite can proxy to the lane's own uvicorn (the probes recipe assumed it already did)"
```

---

### Task 11: Verification — full gates, the API walk, the browser smoke

**Files:**
- Create: `tools/probes/budget-seed/smoke.mjs`
- Modify: `tools/probes/README.md` (one table row)

- [ ] **1 Full gates.** From the repo root:

```bash
(cd backend && FINANCE_TEST_DB=finance_test_b1 .venv/Scripts/python.exe -m pytest -q && .venv/Scripts/python.exe -m ruff format --check app tests && .venv/Scripts/python.exe -m ruff check app tests)
npx vitest run
npx tsc -b && npm run lint && npm run build
```

Expected: pytest all green (Task 0's count + 12 new: 9 service, 5 spending-api, 1 activity, 1 projection — minus none), vitest all green (+12: 3 helper, 7 panel, 2 scenario), lint 0 errors (the one sanctioned warning may remain), build clean with the echarts chunk under its 760 kB advisory. Record the counts for the report. The known pre-existing flakes (a `TransactionsPanel.test.tsx` timing case; a `waitFor` timeout in a page test under a full run) re-run green alone — re-run a red file once by itself before calling it a regression.

- [ ] **2 The lane's servers (dev database, 5433).** The shared uvicorn on 8000 runs WITHOUT `--reload` and answers with the code it booted on — never judge this branch through it. Start a pair on 8010/5174 in the main checkout:

```bash
(cd backend && SCHEDULER_ENABLED=0 .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010 > ../scratchpad/lane-uvicorn.log 2>&1 &)
VITE_API_PROXY=http://127.0.0.1:8010 npm run dev -- --port 5174 > scratchpad/lane-vite.log 2>&1 &
sleep 8; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/api/v1/health; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/
```

Expected: `200` and `200` (if `/api/v1/health` is not a route, any non-000 code proves the server is up).

- [ ] **3 The API walk (writes to the DEV database, then undoes).**

```bash
OUT=scratchpad/budget-seed-smoke && mkdir -p "$OUT"
curl -s http://127.0.0.1:8010/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN=$(cat "$OUT/token.txt"); H="Authorization: Bearer $TOKEN"; API=http://127.0.0.1:8010/api/v1
curl -s -H "$H" "$API/spending/budgets/suggestions" > "$OUT/suggestions.json"
node -e "const s=require('./$OUT/suggestions.json');console.log('window',s.window,'seedable',s.suggestions.filter(x=>x.seed!==null).length,'of',s.suggestions.length);for(const x of s.suggestions)console.log(x.category_id,x.profile,x.mean,x.median,x.latest,x.cv,x.seed,x.skip_reason)"
MONTH=$(curl -s -H "$H" "$API/spending/matrix" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s).months;process.stdout.write(m[m.length-1])})")
echo "focused month: $MONTH"
```

Read the printout against the spec's table: the dev book's window ends at its last complete entered month, dormant categories carry `seed null / dormant`, the `tax`/`transfer` kinds carry `kind`, and every seed is a whole-dollar figure.

**Order matters — hand-set FIRST, seed LAST.** The change log refuses to undo a batch when a LATER batch touched one of its rows ("Later changes touched these rows — undo those first"). A seed followed by a hand-set PUT on a seeded row (and then a DELETE of it) would leave the seed's undo 409ing and the dev book holding the other rows. So the walk runs in this order: one hand-set budget → the probe's seeded face → remove that row → the untouched seed → matrix → undo → the probe's empty face. Nothing later ever names a row the seed wrote.

**3a — one hand-set budget, so the card has something to rewrite.** A book seeded moments ago has every seedable category standing exactly at its seed, and `seedCounts` skips those as unchanged (`writes` 0, no "Re-seed from averages") — the probe would be judging a right card against a wrong state. Pick a living category whose seed is not 2500.00 (Housing, say; `$CAT` is its id from the suggestions printout):

```bash
CAT=<id of a living category with a seed>
curl -s -X PUT -H "$H" -H 'content-type: application/json' \
  -d "{\"amount\":\"2500.00\",\"effective_month\":\"$MONTH\"}" \
  "$API/spending/categories/$CAT/budget"   # → that category's history, one row
curl -s -H "$H" "$API/projection" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log('budget_annual_spend',p.budget_annual_spend,'budget_month',p.budget_month)})"
```

Expected: the card offers "Re-seed from averages" and its confirm line reads `Rewrites 1 existing budget and sets N−1 new ones from <Mon YYYY>` (N = the seedable count); Projection echoes `budget_annual_spend` `30000.00` (12 × 2500 — the hand-set row resolves forward to `start_month`). **Run the browser smoke (step 5) now, in this hand-set state.** Then take the row back out — nothing later has named it, so either verb is clean:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -H "$H" "$API/spending/categories/$CAT/budget/$MONTH"  # 204
```

**3b — the seed, the matrix, the undo (on the clean book).**

```bash
curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"effective_month\":\"$MONTH\"}" "$API/spending/budgets/seed" > "$OUT/seed.json"
node -e "const s=require('./$OUT/seed.json');console.log('written',s.written.length,'skipped',s.skipped.map(x=>x.reason).join(','),'batch',s.batch_id)"
curl -s -H "$H" "$API/spending/matrix" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log('total_budget at focused month',m.total_budget[m.total_budget.length-1])})"
curl -s -H "$H" "$API/projection" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log('budget_annual_spend',p.budget_annual_spend,'budget_month',p.budget_month)})"
```

Expected: `written` = the seedable count from the suggestions, `total_budget` at the focused month = the sum of the written seeds, `budget_annual_spend` = 12 × the living seeds (the dev book's start month is the CURRENT calendar month; the seeds resolve forward to it). Then undo:

```bash
BATCH=$(node -e "process.stdout.write(require('./$OUT/seed.json').batch_id ?? '')")
[ -n "$BATCH" ] && curl -s -X POST -H "$H" "$API/activity/batches/$BATCH/undo" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const u=JSON.parse(s);console.log(u.label,'rows',u.rows)})"
curl -s -H "$H" "$API/spending/matrix" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log('total_budget after undo',m.total_budget[m.total_budget.length-1])})"
```

Expected: `Undid: Seeded N budgets from averages, from <Mon YYYY> rows N`, then `total_budget after undo null` (or whatever it was before the walk — compare with a `GET /spending/matrix` taken before the seed if the dev book already held budgets). **Run the browser smoke again (step 5) in this empty state.**

- [ ] **4 The probe** — create `tools/probes/budget-seed/smoke.mjs` (read-only by construction; it reads the book's state over GETs and expects the matching face of the card):

```js
// tools/probes/budget-seed/smoke.mjs - the Budget card seed + Projection preset smoke (2026-09-07 spec).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced and
// answered from memory, so a click on Confirm here cannot write; the WRITE path is proven by the plan's
// API walk (seed → matrix → undo) and by the unit tests. Run it TWICE around that walk: once with budgets
// on the book (the re-seed row, the Projection preset) and once without (the empty state's action). The
// seeded run needs a book whose budgets DIFFER from the seeds — hand-set one budget at the focused month
// first — because a book seeded moments ago has nothing left to write, and the card offers no Re-seed then.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME.
// The first two lines spoof the node version: this box runs node 18, playwright-core wants 20.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'budget-seed-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8000'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, checks: [], writesBlocked: [], problems: [], files: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, name, ok, observed) => { report.checks.push({ theme, name, ok, observed }); if (!ok) problem(`${theme}: ${name} — observed ${JSON.stringify(observed)}`); return ok }
const note = (theme, name, observed) => report.checks.push({ theme, name, ok: null, observed })

// The book's state, read over GETs, decides which face of the card is expected.
const get = async (p) => { const r = await fetch(API + p, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json() }
const matrix = await get('/api/v1/spending/matrix')
const suggestions = await get('/api/v1/spending/budgets/suggestions')
const projection = await get('/api/v1/projection').catch((e) => ({ error: String(e) }))
const last = matrix.months.length - 1
// The card meters ACTIVE categories only, so a budget left on a retired one is not a budget it shows.
const activeIds = new Set(matrix.categories.filter((c) => c.is_active).map((c) => c.id))
const hasBudgets = matrix.series.some((s) => activeIds.has(s.category_id) && s.budgets[last] !== null)
const seedable = suggestions.suggestions.filter((s) => s.seed !== null).length
// The panel's own rule (seedCounts in src/components/spending/budgetSeed.ts): a seed whose resolved budget
// at the focused month ALREADY equals it is skipped as unchanged, so both affordances turn on `writes`, not
// on `seedable`. A book seeded moments ago has seedable > 0 and writes === 0 — and no Re-seed button.
const budgetAt = new Map(matrix.series.map((s) => [s.category_id, s.budgets[last] ?? null]))
const writes = suggestions.suggestions.filter((s) => {
  if (s.seed === null) return false
  const resolved = budgetAt.get(s.category_id) ?? null
  return resolved === null || Number(resolved) !== Number(s.seed)
}).length
const enoughHistory = (suggestions.window?.months ?? 0) >= 3
note('book', 'state', { months: matrix.months.length, focused: matrix.months[last], hasBudgets, seedable, writes, window: suggestions.window, budget_annual_spend: projection.budget_annual_spend ?? null, projectionError: projection.error ?? null })

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })
try {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th); localStorage.setItem('finance.chartDecals', 'off') }, [TOKEN, theme])
    const themeEntry = { value: theme, updated_at: new Date().toISOString() }
    await ctx.route('**/api/v1/**', async (route) => { const req = route.request(); const m = req.method()
      if (/\/api\/v1\/prefs/.test(req.url())) {
        if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch()).json() } catch { /* answered below */ } body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) }) }
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
      report.writesBlocked.push({ theme, method: m, url: req.url() })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    const shot = async (name, locator) => { const file = path.join(OUT, `${theme}-${name}.png`); await (locator ? locator.screenshot({ path: file }) : page.screenshot({ path: file })); report.files.push(path.basename(file)) }

    // A. /spending — the Budget card wears the face the book calls for.
    await page.goto(BASE + '/spending', { waitUntil: 'networkidle' }); await sleep(2500)
    const card = page.locator('section.card', { has: page.locator('h2.eyebrow', { hasText: 'Budgets' }) }).first()
    check(theme, 'the Budget card is on the page', (await card.count()) === 1, await card.count())
    await card.scrollIntoViewIfNeeded(); await sleep(1200)
    if (hasBudgets) {
      const reseed = card.getByRole('button', { name: 'Re-seed from averages' })
      const expected = enoughHistory && writes > 0 ? 1 : 0
      check(theme, 'a budgeted card offers Re-seed exactly when the book can seed', (await reseed.count()) === expected, { count: await reseed.count(), enoughHistory, writes })
      if (await reseed.count()) {
        await reseed.click(); await sleep(300)
        const confirm = await card.locator('.budget-reseed-confirm').textContent().catch(() => null)
        check(theme, 'Re-seed asks first, counting rewrites and new ones', /Rewrites \d+ existing budgets? and sets \d+ new ones? from /.test(confirm ?? ''), confirm)
        await shot('spending-reseed-confirm', card)
        await card.getByRole('button', { name: 'Cancel' }).click(); await sleep(200)
        check(theme, 'Cancel puts the confirm line away', (await card.locator('.budget-reseed-confirm').count()) === 0, null)
      }
    } else {
      const start = card.getByRole('button', { name: 'Start from my averages' })
      check(theme, 'the empty card offers Start from my averages', (await start.count()) === 1, await start.count())
      const disabled = (await start.count()) ? await start.isDisabled() : null
      check(theme, 'the seed is enabled exactly when the window has three months and something to write', disabled === !(enoughHistory && writes > 0), { disabled, enoughHistory, writes })
      const hint = await card.locator('.budget-seed-hint').textContent().catch(() => null)
      check(theme, 'the hint names the effective month, or the reason', /effective from|Not yet|Nothing to seed|Loading/.test(hint ?? ''), hint)
    }
    // B. One editor open: the chips and the cue ride in the control row.
    const firstEditor = card.locator('details.budget-editor').first()
    if (await firstEditor.count()) {
      await firstEditor.evaluate((el) => { el.open = true }); await sleep(300)
      const chips = await firstEditor.locator('.budget-chip').count()
      const withFigures = suggestions.suggestions.filter((s) => s.mean !== null).length
      check(theme, 'an open editor shows suggestion chips when the book has figures', withFigures === 0 || chips >= 1, { chips, withFigures })
      note(theme, 'first editor cue', await firstEditor.locator('.budget-suggest-cue').textContent().catch(() => null))
    }
    await shot('spending-budget-card', card)
    // C. /projection — the preset shows exactly when the echo carries a budget figure.
    await page.goto(BASE + '/projection', { waitUntil: 'networkidle' }); await sleep(3000)
    const preset = page.getByRole('button', { name: /Use my budgets|using your budgets/ })
    const expectPreset = projection.budget_annual_spend != null
    check(theme, 'Projection offers Use my budgets iff the echo has budget_annual_spend', (await preset.count()) === (expectPreset ? 1 : 0), { count: await preset.count(), expectPreset, echo: projection.budget_annual_spend ?? null })
    if (expectPreset && (await preset.count())) { await preset.scrollIntoViewIfNeeded(); await sleep(400); await shot('projection-preset', page.locator('.slider-box', { has: preset }).first()) }
    if (errors.length) problem(`${theme}: console — ${errors.slice(0, 4).join(' | ')}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}
if (report.problems.length) { console.error('BUDGET SEED SMOKE FAILED\n' + report.problems.join('\n')); process.exit(1) }
console.log(`BUDGET SEED SMOKE OK — ${report.checks.filter((c) => c.ok === true).length} checks, ${report.writesBlocked.length} writes fenced, files: ${report.files.join(', ')}`)
```

- [ ] **5 Run the probe** (twice, as step 3 directs — once in the hand-set state, once on the clean book after the undo):

```bash
TOKEN_FILE=scratchpad/budget-seed-smoke/token.txt SMOKE_OUT=scratchpad/budget-seed-smoke/seeded APP_BASE=http://localhost:5174 API_BASE=http://127.0.0.1:8010 node tools/probes/budget-seed/smoke.mjs
# … the undo from step 3 …
TOKEN_FILE=scratchpad/budget-seed-smoke/token.txt SMOKE_OUT=scratchpad/budget-seed-smoke/empty APP_BASE=http://localhost:5174 API_BASE=http://127.0.0.1:8010 node tools/probes/budget-seed/smoke.mjs
```

Expected: `BUDGET SEED SMOKE OK` both times, `writesBlocked` empty in the empty-state run (nothing is clicked that writes) and at most the fenced Confirm in the seeded run if the driver ever clicks it (it does not — Cancel is the path). Eyeball the PNGs in both themes: the seed block under the eyebrow, chips in the open editor, the preset under the annual-spend knob.

- [ ] **6 README row.** Add to the table in `tools/probes/README.md`, after the `espp-3/` row:

```
| `budget-seed/smoke.mjs` | The Budget card after the 2026-09-07 seed in both themes: the empty state's `Start from my averages` (enabled exactly when the book has three complete months and something to write) or a budgeted card's `Re-seed from averages` with its confirm line and Cancel, an open editor's suggestion chips and cue, and Projection's `Use my budgets` preset present iff the echo carries `budget_annual_spend`. Reads the book's state over GETs first and expects the matching face. READ-ONLY BY CONSTRUCTION — a write fence; the write path is the plan's API walk (seed → matrix → undo) | needs the dev stack — see below |
```

- [ ] **7 Stop the lane's servers** (yours to stop — the shared 8000/5173 pair stays): find the two PIDs with `netstat -ano | grep -E ':8010|:5174' | grep LISTEN` and `taskkill //PID <pid> //F` each (Git Bash) or `Stop-Process -Id <pid>` (PowerShell).

- [ ] **8 Commit**

```bash
git add tools/probes/budget-seed/smoke.mjs tools/probes/README.md
git commit -m "probe(budgets): read-only two-theme smoke of the seed card and the Projection preset; README row"
```

---

### Task 12: Merge to local main (never push)

- [ ] **1** `git checkout main && git merge --no-ff budget-seed-from-averages -m "merge(budget-seed): budgets seeded from averages — the suggestion model, GET suggestions + POST seed, the Budget card's seed/re-seed/chips, the Projection preset, the lane proxy override and the read-only smoke (2026-09-07 spec)"`.
- [ ] **2** On main: `(cd backend && FINANCE_TEST_DB=finance_test_b1 .venv/Scripts/python.exe -m pytest -q)` and `npx vitest run && npx tsc -b && npm run lint && npm run build` → green again (a merge without conflicts changes nothing, but the merged tree is what ships).
- [ ] **3** Update the spec's status line: in `docs/superpowers/specs/2026-09-07-budget-seed-from-averages-design.md`, under the title, add `**Status:** implemented 2026-09-07/08 (branch budget-seed-from-averages, merged to local main).` Commit: `git commit -am "docs(spec): budget-seed status — implemented"`.
- [ ] **4** Leave the branch in place (the user deletes branches). Do not push. Report: the counts, the smoke's two `OK` lines and where the PNGs are, the dev-database walk's before/after `total_budget`, and the one operational note — the shared uvicorn on 8000 still runs the pre-merge code until restarted.

---

## Self-review (done while writing)

- **Spec coverage:** §1 → Tasks 1–3; §2 → Tasks 3–4 (+5 for the undo unit); §3.1–3.4 → Task 8 (helpers and chips in Task 7); §4 → Tasks 6 and 9; §5 edges → Task 2's dormant/sparse tests, Task 4's unchanged/re-dated/NULL-marker behavior (the NULL marker at the effective month takes the update path — `existing.amount` from None to the seed — covered implicitly by the update branch; the later-dated hand row survives by the resolver's rule, pinned by the matrix assertions); §6 → every test named exists in a task; §7 out of scope untouched.
- **Type consistency:** `Suggestion` (py) ↔ `BudgetSuggestion` (py schema, ts); `seedBudgets(effectiveMonth)` ↔ `BudgetSeedIn.effective_month`; `window: DerivedWindowOut | null` spelled `from`/`to` on the wire in both GET and POST, matching `src/types/api.ts`'s `DerivedWindowOut`; `MIN_SEED_MONTHS = 3` on both sides; `skip_reason` literals identical on both sides plus `unchanged` only in `BudgetSkip`/`BudgetSeedOut.skipped`.
- **Placeholders:** none — every code step is complete; the one judgment call left to the implementer (Task 8 step 7's sweep) names the exact failure text and the exact fix.
