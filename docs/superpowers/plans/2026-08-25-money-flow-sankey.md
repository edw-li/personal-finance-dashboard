# Annual Money-Flow Sankey (Overview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One card on `/` that answers "where did this year's money go?" — a 4-column, fully reconciled sankey: five income sources → Gross income → {Taxes, Pre-tax savings, Retained equity & other, Take-home cash} → the year's top-7 spending categories + Other + Saved (or a red Drawdown). Every figure is server-composed from the year's stored tax inputs run through the real tax engine plus the calendar year's entered spending/net-pay, conservation is exact **by construction** (two balancing nodes), and anything the math cannot honestly draw refuses with a sentence instead of a wrong picture.

**Architecture:** A new PURE service (`backend/app/services/money_flow.py`, tax_service's no-DB/no-HTTP posture) takes the year's inputs/brackets dicts, the year's per-category sums and net-pay sum/coverage, and composes one full-precision payload: named sources are plain input sums, **Other income balances** the sources column against the engine's `gross_income`, **Retained equity & other is the residual** of gross − taxes − pre-tax − take-home, and the category fold is the /spending pages' top-7-positive-plus-Other rule. A new thin router (`backend/app/api/overview.py`, mounted at `/api/v1/overview`) loads the year exactly the way the taxes router does (its `_stored_inputs`/`_engine_tables`/`_money`, **imported** — one loader/serializer per concept, the documented cross-router-borrow posture) and quantizes to 2dp at the schema boundary. The frontend gets wire types, a one-function client (`src/api/overview.ts`), a pure builder on the pinned sankey grammar (`src/components/overview/moneyFlowOptions.ts` — explicit depth pinning like the paycheck sankey, spending-sankey Saved/Drawdown semantics, a Taxes tooltip that lists the six jurisdictions), and a presentational `MoneyFlowCard` mounted on OverviewPage between the Recent-spending card and Up next, fed by a second isolated fetch copied from the Up-next pattern so a tax-engine hiccup dents one card and never the page.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 (real-DB pytest), React 19 + TypeScript + ECharts 6 + Vitest. **No new dependencies, no migrations** (spec: this batch is compute/UI only).

**Spec:** `docs/superpowers/specs/2026-08-25-five-feature-batch-design.md` §5 ("Annual money-flow Sankey") — the node-math table, honesty rules, warnings list and placement are binding; cite it for any ambiguity.

**Overnight protocol:** this plan runs **LAST**, after all sibling merges — work happens in the MAIN checkout on branch `money-flow-sankey` (the orchestrator creates it; Task 0 verifies a clean `git status`, the correct branch, and both smoke tests before anything else). Earlier merges HAVE changed `src/pages/OverviewPage.tsx` (and its test) and the tax engine — **state AGI now includes capital gains** — so re-read files immediately before editing them, anchor edits by role rather than line number, and NEVER hand-compute engine expectations in fixtures: either use CG-free inputs or assert against `compute_breakdown`'s own output. Backend venv `.venv/Scripts/python`; dev Postgres localhost:5433. No file deletions. Never push. Frequent small commits.

**House rules that bind every task:** GETs never reject stored data (an unknown year is a 200 with `renderable: false` + a reason, never a 404); server sentences render verbatim; Decimal strings on the wire; plain quantize on read paths (engine outputs are unbounded — money.py's bounded quantizers would 422 a GET); `+ ZERO` on wire-bound Decimals (the borrowed `_money` already does both); comments explain constraints, not narration.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/money_flow.py` | PURE compose: node math, balancing/residual, fold, warnings, refusal |
| `backend/app/schemas/overview.py` | `MoneyFlowOut` (+ `MoneyFlowSourcesOut`/`MoneyFlowTaxesOut`/`MoneyFlowCategoryOut`) |
| `backend/app/api/overview.py` | `GET /overview/money-flow?year=` — loads, composes, quantizes 2dp |
| `backend/app/main.py` | import + mount the overview router |
| `src/types/api.ts` | `MoneyFlowOut` wire types (appended `--- overview: money flow ---` section) |
| `src/api/overview.ts` | `fetchMoneyFlow(year?)` |
| `src/components/overview/moneyFlowOptions.ts` | pure builder: 4 pinned columns, Saved/Drawdown, six-jurisdiction Taxes tooltip |
| `src/components/overview/MoneyFlowCard.tsx` (+`moneyFlow.css`) | card: year chips, chart, warnings line, refusal note, inline retry |
| `src/pages/OverviewPage.tsx` | isolated flow fetch (Up-next pattern) + card mount in the card grid |
| Backend tests | `backend/tests/test_money_flow.py` (new), `backend/tests/test_overview_api.py` (new) |
| Frontend tests | `src/components/overview/moneyFlowOptions.test.ts`, `MoneyFlowCard.test.tsx` (new), `src/pages/OverviewPage.test.tsx` (repairs + 3 new tests) |

---

## Phase 0 — Environment & branch verification

### Task 0: Verify the checkout the orchestrator prepared

**Files:** none (environment only)

- [ ] **Step 1: Confirm the branch and a clean tree.**

```bash
git status --porcelain   # expected: EMPTY output
git rev-parse --abbrev-ref HEAD   # expected: money-flow-sankey
```

If the branch is wrong or the tree is dirty, STOP and report — do not "fix" it by switching or stashing; the orchestrator owns branch setup. The sibling waves (CA-tax fix, system status, polish, chart affordances) are expected to be merged already — `git log --oneline -5` should show their merge commits; if it does not, report before proceeding.

- [ ] **Step 2: Backend smoke test** (proves the venv + the 5433 dev Postgres answer).

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q`
Expected: PASS. If it errors on connection, bring the container up (`cd backend && docker compose up -d db`) and retry once; if it still fails, read `backend/app/config.py` for the dev DATABASE_URL default before proceeding — do not guess.

- [ ] **Step 3: Frontend smoke.**

Run: `npx vitest run src/utils/months.test.ts` → PASS.

- [ ] **Step 4: Confirm the engine's post-fix shape** (this plan's fixtures depend on it).

Run: `cd backend && .venv/Scripts/python -c "import inspect; from app.services import tax_service; src = inspect.getsource(tax_service.compute_breakdown); print('cg in state_agi:', 'cg_amount' in src.split('state_agi')[1][:400])"`
Expected: `cg in state_agi: True`. If False, the CA capital-gains fix has not merged — STOP and report (Task 1's CG-carrying test asserts THROUGH the engine either way, but the protocol said this plan runs last).

---

## Phase 1 — Backend

### Task 1: The pure compose service — node math, balancing, residual, fold, warnings, refusal

**Files:**
- Create: `backend/app/services/money_flow.py`
- Test: `backend/tests/test_money_flow.py`

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_money_flow.py`. No DB, no fixtures: the service is handed dicts. The fixture inputs are **CG-free** so their plain sums are hand-checkable; every engine-derived figure (gross, all seven tax lines) is asserted THROUGH `compute_breakdown` itself, and one CG-carrying test proves the identities survive the engine's state-AGI capital-gains fold without a single hand-derived golden.

```python
"""Pure-service tests for the Overview money-flow composition (2026-08-25 spec §5).

No DB, no HTTP — compose_money_flow is handed dicts. Engine-derived expectations are
asserted THROUGH compute_breakdown (never hand-derived: state AGI now folds capital
gains in, and these tests must not re-implement the engine); the plain input sums (the
named sources, pre-tax savings) are hand-checkable because they never touch the engine,
and the main fixture is deliberately CG-free so even its engine figures are stable.
"""

from decimal import ROUND_HALF_UP, Decimal

from app.services.money_flow import (
    NEGATIVE_RESIDUAL_REASON,
    NET_PAY_COVERAGE_WARNING,
    NO_INPUTS_REASON,
    NO_INPUTS_WARNING,
    NO_NET_PAY_WARNING,
    NO_SPENDING_WARNING,
    SPENDING_COVERAGE_WARNING,
    compose_money_flow,
)
from app.services.tax_service import compute_breakdown

D = Decimal

# Flat single-bracket tables for every jurisdiction: no cap rows, no NIIT advisory
# (it needs >= 3 capital-gains brackets), no missing-jurisdiction warnings.
BRACKETS = {
    "federal": [(D("0.10"), D("0"))],
    "state": [(D("0.05"), D("0"))],
    "medicare": [(D("0.0145"), D("0"))],
    "social_security": [(D("0.062"), D("0"))],
    "disability": [(D("0.011"), D("0"))],
    "capital_gains": [(D("0.15"), D("0"))],
}

# CG-free (every capital-gains key absent): the state-AGI capital-gains fold cannot move
# these figures, whatever the engine does to CG years.
INPUTS = {
    "latest_w2_income": D("200000"),
    "w2_bonuses": D("15000"),
    "w2_salary_checkpoint": D("5000"),
    "w2_stock_rsus_sold": D("80000"),
    "w2_espp_sale_component": D("4000"),
    # Exactly the sheet's other_w2_income component sum (rsu + bonuses + checkpoint +
    # espp, employer-HSA/w2_other at 0), so the balancing node below reduces to the one
    # income line the named sources do NOT carry: other_income_1099 = 1000.
    "other_w2_income": D("104000"),
    "stcg_standard": D("1200"),
    "stcg_total": D("1200"),
    "unqualified_dividends": D("800"),
    "interest_total": D("500"),
    "other_income_1099": D("1000"),
    "trad_401k_contributions": D("23000"),
    "hsa_contributions": D("4000"),
    "hsa_contributions_employer": D("300"),
    "standard_deduction": D("15000"),
}

CATEGORY_SUMS = {
    "Rent": D("24000.00"),
    "Food": D("6000.00"),
    "Travel": D("4200.00"),
    "Utilities": D("3000.00"),
    "Insurance": D("2400.00"),
    "Fun": D("1800.00"),
    "Fitness": D("1200.00"),
    "Gifts": D("900.00"),
    "Misc": D("500.00"),
    "Refunds": D("-25.00"),  # net-refund year: excluded by the positive-only fold
}


def compose(**over):
    kwargs = dict(
        year=2026,
        inputs=INPUTS,
        brackets=BRACKETS,
        category_sums=CATEGORY_SUMS,
        net_pay_sum=D("120000.00"),
        net_pay_months=12,
        spending_months=12,
        available_years=[2024, 2025, 2026],
    )
    kwargs.update(over)
    return compose_money_flow(**kwargs)


def test_named_sources_balancing_node_and_engine_figures():
    flow = compose()
    assert flow.year == 2026
    assert flow.available_years == [2024, 2025, 2026]
    # Named sources are plain input sums (spec §5's node table) — hand-checkable.
    assert flow.sources.salary_and_bonus == D("220000")  # 200000 + 15000 + 5000
    assert flow.sources.rsu_vests == D("80000")
    assert flow.sources.espp == D("4000")
    assert flow.sources.investment_income == D("2500")  # 1200 + 800 + 500 (+ 0 CG keys)
    # Gross and every tax line are ENGINE outputs, asserted through the engine itself.
    breakdown = compute_breakdown(2026, INPUTS, BRACKETS)
    assert flow.gross_income == breakdown.totals.gross_income
    # The BALANCING node: with other_w2_income stored at its component sum, exactly the
    # 1099 line remains.
    assert flow.sources.other_income == D("1000")
    assert flow.taxes.total == breakdown.totals.total_tax
    assert flow.taxes.federal == breakdown.federal.tax
    assert flow.taxes.state == breakdown.state.tax
    assert flow.taxes.medicare == breakdown.medicare.tax
    assert flow.taxes.social_security == breakdown.social_security.tax
    assert flow.taxes.disability == breakdown.disability.tax
    assert flow.taxes.capital_gains == breakdown.capital_gains.tax
    assert flow.pre_tax_savings == D("27300")  # 23000 + 4000 + 300
    assert flow.take_home_cash == D("120000.00")
    assert flow.renderable is True
    assert flow.reason is None
    assert flow.warnings == []


def test_conservation_is_exact_by_construction():
    flow = compose()
    sources = flow.sources
    assert (
        sources.salary_and_bonus
        + sources.rsu_vests
        + sources.espp
        + sources.investment_income
        + sources.other_income
        == flow.gross_income
    )
    assert (
        flow.taxes.total + flow.pre_tax_savings + flow.take_home_cash + flow.retained_equity
        == flow.gross_income
    )
    assert flow.saved == flow.take_home_cash - flow.total_spend


def test_conservation_holds_on_a_cg_carrying_year_too():
    # CG inputs present: every engine figure is taken FROM the engine (state AGI now
    # folds cg_amount in — hand-derived goldens are banned here), and both identities
    # must still be exact at full precision.
    inputs = {
        **INPUTS,
        "ltcg_total": D("30000"),
        "ltcg_brokerage": D("30000"),
        "qualified_dividends": D("2000"),
        "other_capital_gains": D("500"),
    }
    flow = compose(inputs=inputs)
    breakdown = compute_breakdown(2026, inputs, BRACKETS)
    assert flow.gross_income == breakdown.totals.gross_income
    assert flow.taxes.total == breakdown.totals.total_tax
    assert flow.taxes.state == breakdown.state.tax
    # investment_income gains the three CG components: 2500 + 30000 + 2000 + 500.
    assert flow.sources.investment_income == D("35000")
    sources = flow.sources
    assert (
        sources.salary_and_bonus
        + sources.rsu_vests
        + sources.espp
        + sources.investment_income
        + sources.other_income
        == flow.gross_income
    )
    assert (
        flow.taxes.total + flow.pre_tax_savings + flow.take_home_cash + flow.retained_equity
        == flow.gross_income
    )
    assert flow.renderable is True


def test_category_fold_top7_plus_other_positive_only():
    flow = compose()
    assert [(c.name, c.amount) for c in flow.categories] == [
        ("Rent", D("24000.00")),
        ("Food", D("6000.00")),
        ("Travel", D("4200.00")),
        ("Utilities", D("3000.00")),
        ("Insurance", D("2400.00")),
        ("Fun", D("1800.00")),
        ("Fitness", D("1200.00")),
    ]
    # Gifts + Misc fold into Other; the net-refund category is EXCLUDED — a link cannot
    # be negative, so the fold restates spending GROSS (buildYearSlices' documented rule).
    assert flow.other_spend == D("1400.00")
    assert flow.total_spend == D("44000.00")
    assert flow.saved == D("76000.00")


def test_fold_with_seven_or_fewer_categories_has_no_other():
    flow = compose(category_sums={"Rent": D("2000.00"), "Food": D("500.00")})
    assert [c.name for c in flow.categories] == ["Rent", "Food"]
    assert flow.other_spend is None
    assert flow.total_spend == D("2500.00")


def test_saved_goes_negative_as_a_drawdown_figure_not_a_refusal():
    flow = compose(net_pay_sum=D("40000.00"))
    assert flow.saved == D("-4000.00")
    # Nothing STRUCTURAL broke: a deficit year is drawable (the builder adds a red
    # Drawdown source, the spending sankey's semantics), so no refusal here.
    assert flow.renderable is True
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_money_flow.py -q` → FAIL (`ModuleNotFoundError: No module named 'app.services.money_flow'`).

- [ ] **Step 3: Append the refusal + warning tests** to the same file:

```python
def test_negative_other_income_refuses_with_reason_and_still_carries_figures():
    # Dropping the stored other_w2_income total below its own components makes the named
    # sources exceed engine gross — the classic stored-total-vs-component drift.
    inputs = {**INPUTS, "other_w2_income": D("0")}
    flow = compose(inputs=inputs)
    assert flow.renderable is False
    assert flow.sources.other_income == D("-103000")
    assert flow.reason == (
        "The named income sources exceed the engine's gross income for 2026 by 103000.00 "
        "— check the W-2 component inputs against the stored totals."
    )
    # The refusal still returns every figure it could compute (spec §5).
    assert flow.gross_income == compute_breakdown(2026, inputs, BRACKETS).totals.gross_income
    assert flow.take_home_cash == D("120000.00")
    assert flow.total_spend == D("44000.00")


def test_negative_residual_refuses():
    flow = compose(net_pay_sum=D("400000.00"))
    assert flow.renderable is False
    assert flow.retained_equity < 0
    # The gap is engine-derived, so derive it through the engine here too.
    breakdown = compute_breakdown(2026, INPUTS, BRACKETS)
    gap = -(
        breakdown.totals.gross_income
        - breakdown.totals.total_tax
        - D("27300")
        - D("400000.00")
    )
    assert flow.reason == NEGATIVE_RESIDUAL_REASON.format(
        year=2026, gap=gap.quantize(D("0.01"), rounding=ROUND_HALF_UP)
    )


def test_non_positive_gross_with_data_present_refuses():
    flow = compose(inputs={"latest_w2_income": D("-50000")})
    assert flow.renderable is False
    assert flow.reason == (
        "Gross income for 2026 is -50000.00 — the flow needs a positive gross to draw."
    )


def test_empty_year_refuses_with_the_no_inputs_sentence():
    flow = compose(
        inputs={},
        category_sums={},
        net_pay_sum=D("0.00"),
        net_pay_months=0,
        spending_months=0,
        available_years=[],
    )
    assert flow.renderable is False
    assert flow.reason == NO_INPUTS_REASON.format(year=2026)
    assert NO_INPUTS_WARNING.format(year=2026) in flow.warnings
    assert flow.available_years == []
    assert flow.gross_income == D("0")


def test_coverage_warnings_partial_months_in_order():
    flow = compose(net_pay_months=7, spending_months=5)
    # Full-list equality pins the warning ORDER: engine passthrough (none here) first,
    # then net-pay coverage, then spending coverage.
    assert flow.warnings == [
        NET_PAY_COVERAGE_WARNING.format(n=7),
        SPENDING_COVERAGE_WARNING.format(n=5),
    ]
    assert flow.renderable is True


def test_coverage_warnings_zero_months():
    flow = compose(
        net_pay_sum=D("0.00"), net_pay_months=0, category_sums={}, spending_months=0
    )
    assert NO_NET_PAY_WARNING.format(year=2026) in flow.warnings
    assert NO_SPENDING_WARNING.format(year=2026) in flow.warnings
    # Take-home 0 is NOT a refusal: the left half still draws; Saved/Drawdown and the
    # category fan simply vanish (zero branches are omitted by the builder).
    assert flow.renderable is True
    assert flow.take_home_cash == D("0.00")
    assert flow.saved == D("0.00")


def test_engine_bracket_warnings_pass_through_and_missing_keys_do_not():
    brackets = {name: table for name, table in BRACKETS.items() if name != "state"}
    flow = compose(brackets=brackets)
    assert "no state brackets for 2026: state tax computed as 0" in flow.warnings
    # The engine's missing-keys sentence is the Taxes editor's, not this card's: INPUTS
    # leaves several engine keys unset, so the engine DID emit it — and it must not
    # reach the payload.
    assert not any(w.startswith("missing inputs defaulted to 0") for w in flow.warnings)
```

- [ ] **Step 4: Run to verify failure again** — `cd backend && .venv/Scripts/python -m pytest tests/test_money_flow.py -q` → same ModuleNotFoundError (all tests collected, none passing).

- [ ] **Step 5: Implement the service** — create `backend/app/services/money_flow.py`:

```python
"""Annual money-flow composition for the Overview sankey (2026-08-25 spec §5).

Pure module — no DB, no HTTP (tax_service's posture): the router loads the year's stored
tax inputs/brackets and the calendar year's spending sums, and this module turns them
into ONE reconciled payload. Everything is full-precision Decimal; quantization is the
schema layer's job (the taxes router's `_money` plain-quantize + `+ ZERO`, because half
these figures are engine outputs and engine outputs are unbounded).

Conservation is exact by construction, not by rounding luck:
- `sources.other_income` BALANCES the sources column: engine gross_income minus the four
  named sources, so sources always sum to gross. It naturally carries other_income_1099,
  employer HSA, w2_other, and any stored-total-vs-component drift.
- `retained_equity` is the RESIDUAL of the middle column: gross − taxes − pre-tax savings
  − take-home cash (≈ vest shares kept + ESPP contributions + W-2-vs-cash timing).
A negative balancing/residual node means the stored inputs contradict each other, and a
sankey ribbon cannot be negative — the payload then says renderable=False with a human
`reason` sentence (the paycheck sankey's refusal posture) while still carrying every
figure it could compute, so the card can say what it knows.
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from app.services.tax_service import (
    MISSING_INPUTS_WARNING,
    Bracket,
    TaxBreakdown,
    compute_breakdown,
)

ZERO = Decimal("0")
MONTHS_IN_YEAR = 12
# The /spending pages' fold width (SpendingPage's TOP_N): top 7 categories by the year's
# sum, the positive remainder folded into "Other".
TOP_N_CATEGORIES = 7

# The named source definitions (spec §5's node table). Investment income is the engine's
# gross-income COMPONENT definition (stcg_standard/ltcg_brokerage, never the netted
# totals), so the balancing node cannot double-count a total against its components.
SALARY_KEYS = ("latest_w2_income", "w2_bonuses", "w2_salary_checkpoint")
RSU_KEY = "w2_stock_rsus_sold"
ESPP_KEY = "w2_espp_sale_component"
INVESTMENT_KEYS = (
    "stcg_standard",
    "unqualified_dividends",
    "interest_total",
    "ltcg_brokerage",
    "qualified_dividends",
    "other_capital_gains",
)
PRETAX_KEYS = ("trad_401k_contributions", "hsa_contributions", "hsa_contributions_employer")

# The engine's own missing-keys warning is EXCLUDED from the passthrough: it names every
# unset form key (normal for a partially entered year — the engine's missing-key-is-zero
# rule is exactly the zero this module uses too) and belongs to the Taxes editor. An
# entirely empty year gets the single NO_INPUTS_WARNING sentence instead.
_ENGINE_MISSING_PREFIX = MISSING_INPUTS_WARNING.split("{keys}")[0]

NO_INPUTS_WARNING = "no tax inputs stored for {year}"
NO_NET_PAY_WARNING = "no net pay entered for {year}"
NET_PAY_COVERAGE_WARNING = "net pay entered {n}/12 months"
NO_SPENDING_WARNING = "no spending entered for {year}"
SPENDING_COVERAGE_WARNING = "spending entered {n}/12 months"

NO_INPUTS_REASON = (
    "No tax inputs are stored for {year} — enter the year on the Taxes page to draw its "
    "money flow."
)
NON_POSITIVE_GROSS_REASON = (
    "Gross income for {year} is {gross} — the flow needs a positive gross to draw."
)
NEGATIVE_OTHER_INCOME_REASON = (
    "The named income sources exceed the engine's gross income for {year} by {gap} — "
    "check the W-2 component inputs against the stored totals."
)
NEGATIVE_TAXES_REASON = "Total tax for {year} is {taxes} — a negative ribbon cannot be drawn."
NEGATIVE_PRETAX_REASON = (
    "Pre-tax savings for {year} sum to {pretax} — a negative ribbon cannot be drawn."
)
NEGATIVE_RESIDUAL_REASON = (
    "Taxes, pre-tax savings and take-home cash exceed gross income for {year} by {gap} — "
    "the retained-equity residual would be negative."
)


def _display(value: Decimal) -> Decimal:
    """2dp HALF_UP for embedding a figure in a reason sentence — reasons are prose, and
    prose carries display-rounded numbers (the payload itself is quantized at the schema
    layer, where the router's `_money` also collapses signed zeros)."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class MoneyFlowSources:
    salary_and_bonus: Decimal
    rsu_vests: Decimal
    espp: Decimal
    investment_income: Decimal
    other_income: Decimal


@dataclass
class MoneyFlowTaxes:
    total: Decimal
    federal: Decimal
    state: Decimal
    medicare: Decimal
    social_security: Decimal
    disability: Decimal
    capital_gains: Decimal


@dataclass
class MoneyFlowCategory:
    name: str
    amount: Decimal


@dataclass
class MoneyFlow:
    year: int
    available_years: list[int]
    renderable: bool
    reason: str | None
    sources: MoneyFlowSources
    gross_income: Decimal
    taxes: MoneyFlowTaxes
    pre_tax_savings: Decimal
    take_home_cash: Decimal
    retained_equity: Decimal
    categories: list[MoneyFlowCategory]
    other_spend: Decimal | None
    total_spend: Decimal
    saved: Decimal
    warnings: list[str] = field(default_factory=list)


def compose_money_flow(
    year: int,
    inputs: dict[str, Decimal],
    brackets: dict[str, list[Bracket]],
    category_sums: dict[str, Decimal],
    net_pay_sum: Decimal,
    net_pay_months: int,
    spending_months: int,
    available_years: list[int],
) -> MoneyFlow:
    """One reconciled year of money flow (spec §5's node table).

    `inputs`/`brackets` are the taxes router's stored shapes, handed to the engine
    verbatim; `category_sums` is the calendar year's SIGNED per-category spend by name;
    `net_pay_sum`/`net_pay_months` are the year's monthly_cashflow sum and coverage;
    `spending_months` counts distinct entered spending months. This function never
    re-derives an engine figure: gross income and every tax line are compute_breakdown's
    own outputs (the state-AGI capital-gains fold rides along for free).
    """

    def value(key: str) -> Decimal:
        found = inputs.get(key)
        return ZERO if found is None else found

    breakdown: TaxBreakdown = compute_breakdown(year, inputs, brackets)

    salary_and_bonus = sum((value(key) for key in SALARY_KEYS), ZERO)
    rsu_vests = value(RSU_KEY)
    espp = value(ESPP_KEY)
    investment_income = sum((value(key) for key in INVESTMENT_KEYS), ZERO)
    gross_income = breakdown.totals.gross_income
    named = salary_and_bonus + rsu_vests + espp + investment_income
    other_income = gross_income - named  # BALANCING node: sources sum to gross, always

    taxes = MoneyFlowTaxes(
        total=breakdown.totals.total_tax,
        federal=breakdown.federal.tax,
        state=breakdown.state.tax,
        medicare=breakdown.medicare.tax,
        social_security=breakdown.social_security.tax,
        disability=breakdown.disability.tax,
        capital_gains=breakdown.capital_gains.tax,
    )
    pre_tax_savings = sum((value(key) for key in PRETAX_KEYS), ZERO)
    take_home_cash = net_pay_sum
    # RESIDUAL node: the middle column always sums back to gross.
    retained_equity = gross_income - taxes.total - pre_tax_savings - take_home_cash

    # Top-7 + Other fold, positive-only (buildYearSlices' documented rule: a link cannot
    # be negative, so net-refund categories are excluded and the fold restates spending
    # GROSS). Ties break by name so the order — and therefore the palette slots the
    # builder assigns — is deterministic.
    positive = sorted(
        ((name, amount) for name, amount in category_sums.items() if amount > 0),
        key=lambda entry: (-entry[1], entry[0]),
    )
    categories = [
        MoneyFlowCategory(name=name, amount=amount)
        for name, amount in positive[:TOP_N_CATEGORIES]
    ]
    folded = sum((amount for _name, amount in positive[TOP_N_CATEGORIES:]), ZERO)
    other_spend = folded if folded > 0 else None
    total_spend = sum((entry.amount for entry in categories), ZERO) + (other_spend or ZERO)
    saved = take_home_cash - total_spend  # SIGNED: the builder draws Saved or Drawdown

    # Engine warnings first (the summary serializer's convention), ours appended after.
    warnings: list[str] = [
        warning
        for warning in breakdown.warnings
        if not warning.startswith(_ENGINE_MISSING_PREFIX)
    ]
    if not inputs:
        warnings.append(NO_INPUTS_WARNING.format(year=year))
    if net_pay_months == 0:
        warnings.append(NO_NET_PAY_WARNING.format(year=year))
    elif net_pay_months < MONTHS_IN_YEAR:
        warnings.append(NET_PAY_COVERAGE_WARNING.format(n=net_pay_months))
    if spending_months == 0:
        warnings.append(NO_SPENDING_WARNING.format(year=year))
    elif spending_months < MONTHS_IN_YEAR:
        warnings.append(SPENDING_COVERAGE_WARNING.format(n=spending_months))

    # Refusal (spec §5 honesty rules): ONE reason, first structural failure wins. A
    # negative saved is NOT here — a deficit is drawable (red Drawdown source). Negative
    # take_home_cash is unreachable (net_pay writes reject negatives).
    reason: str | None = None
    if gross_income <= 0:
        reason = (
            NO_INPUTS_REASON.format(year=year)
            if not inputs
            else NON_POSITIVE_GROSS_REASON.format(year=year, gross=_display(gross_income))
        )
    elif other_income < 0:
        reason = NEGATIVE_OTHER_INCOME_REASON.format(year=year, gap=_display(-other_income))
    elif taxes.total < 0:
        reason = NEGATIVE_TAXES_REASON.format(year=year, taxes=_display(taxes.total))
    elif pre_tax_savings < 0:
        reason = NEGATIVE_PRETAX_REASON.format(year=year, pretax=_display(pre_tax_savings))
    elif retained_equity < 0:
        reason = NEGATIVE_RESIDUAL_REASON.format(year=year, gap=_display(-retained_equity))

    return MoneyFlow(
        year=year,
        available_years=available_years,
        renderable=reason is None,
        reason=reason,
        sources=MoneyFlowSources(
            salary_and_bonus=salary_and_bonus,
            rsu_vests=rsu_vests,
            espp=espp,
            investment_income=investment_income,
            other_income=other_income,
        ),
        gross_income=gross_income,
        taxes=taxes,
        pre_tax_savings=pre_tax_savings,
        take_home_cash=take_home_cash,
        retained_equity=retained_equity,
        categories=categories,
        other_spend=other_spend,
        total_spend=total_spend,
        saved=saved,
        warnings=warnings,
    )
```

- [ ] **Step 6: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_money_flow.py -q` → ALL PASS (13 tests).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(overview): pure money-flow compose service"`

### Task 2: Schemas + `/overview/money-flow` router + mount

**Files:**
- Create: `backend/app/schemas/overview.py`, `backend/app/api/overview.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_overview_api.py`

- [ ] **Step 1: Write the failing API tests** — create `backend/tests/test_overview_api.py`. Tax data goes through the REAL taxes PUTs (test_taxes_api's posture — the FK to `tax_input_definitions` demands the seed first); spending is seeded directly like `_seed_spending`. Engine figures are cross-checked against the taxes SUMMARY endpoint — the same stored rows through the same loaders must land on the same cents, with zero hand math.

```python
"""Overview money-flow endpoint (2026-08-25 spec §5): loading, windows, quantization.

Node math is pinned in test_money_flow.py; here the year's inputs/brackets go through the
REAL taxes PUTs and the spending tables, and the payload is cross-checked against the
taxes summary endpoint — never against hand-derived engine numbers (state AGI now folds
capital gains in; these fixtures are CG-free anyway, so the flat-bracket figures are
exact cents and the conservation identities survive 2dp quantization verbatim).
"""

from datetime import date
from decimal import Decimal

import pytest

from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory
from app.seed import seed_tax_definitions
from app.services.scheduler import product_today

MONEY_FLOW = "/api/v1/overview/money-flow"
YEARS = "/api/v1/taxes/years"


@pytest.fixture
async def definitions(db):
    """tax_input_definitions rows — tax_inputs FK to them, so they precede every PUT."""
    await seed_tax_definitions(db)
    await db.commit()


INPUT_VALUES = {
    "latest_w2_income": "200000",
    "w2_bonuses": "15000",
    "w2_salary_checkpoint": "5000",
    "w2_stock_rsus_sold": "80000",
    "w2_espp_sale_component": "4000",
    "other_w2_income": "104000",
    "stcg_standard": "1200",
    "stcg_total": "1200",
    "unqualified_dividends": "800",
    "interest_total": "500",
    "other_income_1099": "1000",
    "trad_401k_contributions": "23000",
    "hsa_contributions": "4000",
    "hsa_contributions_employer": "300",
    "standard_deduction": "15000",
}

BRACKET_TABLES = {
    "federal": [{"rate": "0.10", "threshold": "0"}],
    "state": [{"rate": "0.05", "threshold": "0"}],
    "medicare": [{"rate": "0.0145", "threshold": "0"}],
    "social_security": [{"rate": "0.062", "threshold": "0"}],
    "disability": [{"rate": "0.011", "threshold": "0"}],
    "capital_gains": [{"rate": "0.15", "threshold": "0"}],
}


async def seed_tax_year(auth_client, year: int) -> None:
    resp = await auth_client.put(f"{YEARS}/{year}/inputs", json={"values": INPUT_VALUES})
    assert resp.status_code == 200, resp.text
    resp = await auth_client.put(
        f"{YEARS}/{year}/brackets", json={"jurisdictions": BRACKET_TABLES}
    )
    assert resp.status_code == 200, resp.text


async def seed_spending_year(db, year: int) -> None:
    """8 positive categories + 1 net-refund, 2 spending months and 7 net-pay months
    inside `year`, plus December-of-the-PRIOR-year rows that a sloppy calendar window
    would let in."""
    amounts = {
        "Rent": "24000.00",
        "Food": "6000.00",
        "Travel": "4200.00",
        "Utilities": "3000.00",
        "Insurance": "2400.00",
        "Fun": "1800.00",
        "Fitness": "1200.00",
        "Gifts": "900.00",
        "Refunds": "-25.00",
    }
    for i, (name, amount) in enumerate(amounts.items(), start=1):
        cat = SpendingCategory(name=name, slug=name.lower(), sort_order=i)
        db.add(cat)
        await db.flush()
        db.add(
            MonthlySpending(month=date(year, 1, 1), category_id=cat.id, amount=Decimal(amount))
        )
        if name == "Rent":
            db.add(
                MonthlySpending(
                    month=date(year, 2, 1), category_id=cat.id, amount=Decimal("0.00")
                )
            )
            db.add(
                MonthlySpending(
                    month=date(year - 1, 12, 1), category_id=cat.id, amount=Decimal("999.00")
                )
            )
    for month in range(1, 8):  # 7/12 months of net pay
        db.add(MonthlyCashflow(month=date(year, month, 1), net_pay=Decimal("10000.00")))
    db.add(MonthlyCashflow(month=date(year - 1, 12, 1), net_pay=Decimal("55555.00")))
    await db.commit()


async def test_money_flow_requires_auth(client):
    assert (await client.get(MONEY_FLOW)).status_code == 401


async def test_money_flow_composes_the_year_and_cross_checks_the_engine(
    auth_client, db, definitions
):
    await seed_tax_year(auth_client, 2026)
    await seed_spending_year(db, 2026)
    resp = await auth_client.get(f"{MONEY_FLOW}?year=2026")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["year"] == 2026
    assert body["available_years"] == [2026]
    assert body["renderable"] is True
    assert body["reason"] is None
    # Plain input sums as 2dp Decimal strings on the wire.
    assert body["sources"]["salary_and_bonus"] == "220000.00"
    assert body["sources"]["rsu_vests"] == "80000.00"
    assert body["sources"]["espp"] == "4000.00"
    assert body["sources"]["investment_income"] == "2500.00"
    assert body["sources"]["other_income"] == "1000.00"
    assert body["pre_tax_savings"] == "27300.00"
    # Engine figures cross-checked against the taxes summary endpoint — same stored
    # rows, same loaders, same cents.
    summary = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["gross_income"] == summary["totals"]["gross_income"]
    assert body["taxes"]["total"] == summary["totals"]["total_tax"]
    assert body["taxes"]["federal"] == summary["federal"]["tax"]
    assert body["taxes"]["state"] == summary["state"]["tax"]
    assert body["taxes"]["medicare"] == summary["medicare"]["tax"]
    assert body["taxes"]["social_security"] == summary["social_security"]["tax"]
    assert body["taxes"]["disability"] == summary["disability"]["tax"]
    assert body["taxes"]["capital_gains"] == summary["capital_gains"]["tax"]
    # Calendar-year windows: 7 x 10000 net pay INSIDE the year; the prior-December rows
    # (net pay 55555, Rent 999) stay out.
    assert body["take_home_cash"] == "70000.00"
    assert "net pay entered 7/12 months" in body["warnings"]
    assert "spending entered 2/12 months" in body["warnings"]
    # Top-7 fold + Other; Gifts folds, the refund row is excluded.
    assert [c["name"] for c in body["categories"]] == [
        "Rent", "Food", "Travel", "Utilities", "Insurance", "Fun", "Fitness",
    ]
    assert body["categories"][0]["amount"] == "24000.00"
    assert body["other_spend"] == "900.00"
    assert body["total_spend"] == "43500.00"
    assert body["saved"] == "26500.00"
    # Conservation at the WIRE: with flat brackets every term is exact cents, so both
    # identities survive quantization verbatim (in general the wire tolerates the
    # paycheck sankey's documented ±$0.01 reconciliation drift).
    sources_sum = sum(Decimal(v) for v in body["sources"].values())
    assert sources_sum == Decimal(body["gross_income"])
    mid = (
        Decimal(body["taxes"]["total"])
        + Decimal(body["pre_tax_savings"])
        + Decimal(body["take_home_cash"])
        + Decimal(body["retained_equity"])
    )
    assert mid == Decimal(body["gross_income"])


async def test_money_flow_defaults_to_the_current_product_year(auth_client, definitions):
    year = product_today().year
    await seed_tax_year(auth_client, year)
    body = (await auth_client.get(MONEY_FLOW)).json()
    assert body["year"] == year
    assert body["renderable"] is True


async def test_money_flow_unknown_year_is_200_with_a_reason(auth_client, definitions):
    await seed_tax_year(auth_client, 2026)
    resp = await auth_client.get(f"{MONEY_FLOW}?year=2031")
    assert resp.status_code == 200  # GETs never reject: the payload explains instead
    body = resp.json()
    assert body["renderable"] is False
    assert body["reason"] == (
        "No tax inputs are stored for 2031 — enter the year on the Taxes page to draw "
        "its money flow."
    )
    assert "no tax inputs stored for 2031" in body["warnings"]
    assert body["available_years"] == [2026]  # the selector still knows where data lives
    assert body["gross_income"] == "0.00"


async def test_money_flow_on_an_empty_database(auth_client):
    body = (await auth_client.get(MONEY_FLOW)).json()
    assert body["year"] == product_today().year
    assert body["renderable"] is False
    assert body["available_years"] == []


async def test_money_flow_year_bounds(auth_client):
    # The taxes routers' century guard, on the query param: an unstorable year can hold
    # no data, and date(year, 1, 1) below must never see garbage.
    assert (await auth_client.get(f"{MONEY_FLOW}?year=1899")).status_code == 422
    assert (await auth_client.get(f"{MONEY_FLOW}?year=2101")).status_code == 422
    assert (await auth_client.get(f"{MONEY_FLOW}?year=abc")).status_code == 422


async def test_money_flow_available_years_lists_every_inputs_year(auth_client, definitions):
    await seed_tax_year(auth_client, 2024)
    await seed_tax_year(auth_client, 2026)
    # A year with BRACKETS only (no inputs) must not appear — "years having any tax
    # inputs" (spec §5), the same rule the trend feed uses.
    resp = await auth_client.put(
        f"{YEARS}/2025/brackets",
        json={"jurisdictions": {"federal": [{"rate": "0.10", "threshold": "0"}]}},
    )
    assert resp.status_code == 200
    body = (await auth_client.get(f"{MONEY_FLOW}?year=2026")).json()
    assert body["available_years"] == [2024, 2026]
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_overview_api.py -q` → FAIL (404s — the route does not exist; the auth test may pass by accident of the 401-before-404 ordering, that is fine).

- [ ] **Step 3: Schemas** — create `backend/app/schemas/overview.py`:

```python
from decimal import Decimal

from pydantic import BaseModel


class MoneyFlowSourcesOut(BaseModel):
    salary_and_bonus: Decimal
    rsu_vests: Decimal
    espp: Decimal
    investment_income: Decimal
    # BALANCING node: engine gross minus the four named sources (1099 income, employer
    # HSA, w2_other, and any stored-total-vs-component drift live here).
    other_income: Decimal


class MoneyFlowTaxesOut(BaseModel):
    total: Decimal
    federal: Decimal
    state: Decimal
    medicare: Decimal
    social_security: Decimal
    disability: Decimal
    capital_gains: Decimal


class MoneyFlowCategoryOut(BaseModel):
    name: str
    amount: Decimal


class MoneyFlowOut(BaseModel):
    year: int
    # Years having any stored tax inputs — the card's chip row (spec §5).
    available_years: list[int]
    # False + reason when a structural node went negative or the year has no positive
    # gross: the card renders the reason sentence VERBATIM instead of a chart. The
    # figures below are still populated — a refusal explains itself with the numbers it
    # refused over.
    renderable: bool
    reason: str | None
    warnings: list[str]
    sources: MoneyFlowSourcesOut
    gross_income: Decimal
    taxes: MoneyFlowTaxesOut
    pre_tax_savings: Decimal
    take_home_cash: Decimal
    # RESIDUAL: gross − taxes − pre-tax − take-home (≈ vest shares kept + ESPP
    # contributions + W-2-vs-cash timing).
    retained_equity: Decimal
    # Top-7 by the year's sum, biggest first, positive-only (the /spending fold).
    categories: list[MoneyFlowCategoryOut]
    # The folded positive remainder beyond the top 7; None when nothing folded.
    other_spend: Decimal | None
    total_spend: Decimal
    # SIGNED: take_home_cash − total_spend. Negative = the builder draws a red Drawdown
    # source with the spending sankey's pro-rata semantics.
    saved: Decimal
```

- [ ] **Step 4: Router** — create `backend/app/api/overview.py`:

```python
"""Overview API: cross-domain, server-composed payloads for the dashboard's cards.

Reads only. `GET /overview/money-flow` (2026-08-25 spec §5) loads one year's tax inputs +
brackets exactly the way the taxes router does — its `_stored_inputs`/`_engine_tables`,
IMPORTED, one loader per concept (app_settings.py's cross-router-borrow precedent) —
sums the calendar year's spending/cashflow, and hands everything to the pure
services.money_flow.compose_money_flow. GETs never reject stored data: an unknown or
empty year answers 200 with renderable=False and a reason sentence, never a 404.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.taxes import YEAR_MAX, YEAR_MIN, _engine_tables, _money, _stored_inputs
from app.database import get_db
from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory, TaxInput
from app.schemas.overview import (
    MoneyFlowCategoryOut,
    MoneyFlowOut,
    MoneyFlowSourcesOut,
    MoneyFlowTaxesOut,
)
from app.services.money_flow import MoneyFlow, compose_money_flow
from app.services.scheduler import product_today

router = APIRouter(prefix="/overview", tags=["overview"], dependencies=[Depends(get_current_user)])

# The taxes routes' century guard, on a QUERY param this time: tax_years.year is int4 and
# the spending window below builds date(year, 1, 1) — either would 500 on a garbage year.
YearQuery = Annotated[int | None, Query(ge=YEAR_MIN, le=YEAR_MAX)]


def _money_flow_out(flow: MoneyFlow) -> MoneyFlowOut:
    """Quantize the service's full-precision figures to 2dp at the schema boundary.

    `_money` (borrowed from the taxes router) is the plain-quantize + `+ ZERO`
    serializer for ENGINE-DERIVED figures — they are unbounded, so money.py's bounded
    quantizers would 422 a GET on data the API itself accepted."""
    return MoneyFlowOut(
        year=flow.year,
        available_years=flow.available_years,
        renderable=flow.renderable,
        reason=flow.reason,
        warnings=flow.warnings,
        sources=MoneyFlowSourcesOut(
            salary_and_bonus=_money(flow.sources.salary_and_bonus),
            rsu_vests=_money(flow.sources.rsu_vests),
            espp=_money(flow.sources.espp),
            investment_income=_money(flow.sources.investment_income),
            other_income=_money(flow.sources.other_income),
        ),
        gross_income=_money(flow.gross_income),
        taxes=MoneyFlowTaxesOut(
            total=_money(flow.taxes.total),
            federal=_money(flow.taxes.federal),
            state=_money(flow.taxes.state),
            medicare=_money(flow.taxes.medicare),
            social_security=_money(flow.taxes.social_security),
            disability=_money(flow.taxes.disability),
            capital_gains=_money(flow.taxes.capital_gains),
        ),
        pre_tax_savings=_money(flow.pre_tax_savings),
        take_home_cash=_money(flow.take_home_cash),
        retained_equity=_money(flow.retained_equity),
        categories=[
            MoneyFlowCategoryOut(name=entry.name, amount=_money(entry.amount))
            for entry in flow.categories
        ],
        other_spend=None if flow.other_spend is None else _money(flow.other_spend),
        total_spend=_money(flow.total_spend),
        saved=_money(flow.saved),
    )


@router.get("/money-flow", response_model=MoneyFlowOut)
async def money_flow(year: YearQuery = None, db: AsyncSession = Depends(get_db)) -> MoneyFlowOut:
    if year is None:
        # The product clock, not date.today(): the prod container runs UTC, where a PT
        # evening is already tomorrow — and on Dec 31 that would be next YEAR.
        year = product_today().year

    inputs = await _stored_inputs(db, year)
    brackets = await _engine_tables(db, year)

    # Calendar-year window as [Jan 1, next Jan 1): months are first-of-month dates, so
    # the half-open bound can never leak a neighbouring December in.
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    category_rows = (
        await db.execute(
            select(SpendingCategory.name, func.sum(MonthlySpending.amount))
            .join(SpendingCategory, SpendingCategory.id == MonthlySpending.category_id)
            .where(MonthlySpending.month >= start, MonthlySpending.month < end)
            .group_by(SpendingCategory.name)
        )
    ).all()
    category_sums = {name: Decimal(total) for name, total in category_rows}
    spending_months = (
        await db.execute(
            select(func.count(func.distinct(MonthlySpending.month))).where(
                MonthlySpending.month >= start, MonthlySpending.month < end
            )
        )
    ).scalar_one()
    # monthly_cashflow.month is the PK, so one row per month: len() IS the coverage.
    pay_rows = list(
        (
            await db.execute(
                select(MonthlyCashflow.net_pay).where(
                    MonthlyCashflow.month >= start, MonthlyCashflow.month < end
                )
            )
        ).scalars()
    )
    net_pay_sum = sum(pay_rows, Decimal("0.00"))
    # "Years having any tax inputs" (spec §5) — the same membership rule the taxes trend
    # feed applies (a bare tax_years row or a brackets-only year is not a data year).
    available_years = sorted((await db.execute(select(TaxInput.year).distinct())).scalars().all())

    flow = compose_money_flow(
        year=year,
        inputs=inputs,
        brackets=brackets,
        category_sums=category_sums,
        net_pay_sum=net_pay_sum,
        net_pay_months=len(pay_rows),
        spending_months=spending_months,
        available_years=available_years,
    )
    return _money_flow_out(flow)
```

- [ ] **Step 5: Mount.** In `backend/app/main.py`: add `overview,` to the `from app.api import (...)` block (alphabetical: after `net_worth`, before `paycheck`), and append after the last `include_router` line (`app_settings`):

```python
app.include_router(overview.router, prefix="/api/v1")
```

- [ ] **Step 6: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_overview_api.py tests/test_money_flow.py -q` → ALL PASS. Then the full backend suite once here (cheap insurance that the borrow of `_money`/`_stored_inputs`/`_engine_tables` changed nothing): `cd backend && .venv/Scripts/python -m pytest -q` → ALL PASS.

- [ ] **Step 7: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → no reformats (or re-run the touched tests and commit the reflow).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(overview): money-flow endpoint + schemas + mount"`

---

## Phase 2 — Frontend

### Task 3: Wire types + API client

`MoneyFlowOut` is a NEW type consumed by nothing yet, so no existing fixtures break — this task must leave the tree compiling and the suite green untouched.

**Files:**
- Modify: `src/types/api.ts`
- Create: `src/api/overview.ts`

- [ ] **Step 1: types/api.ts.** APPEND at the very end of the file (after the `--- app settings ---` block — appending is the merge-safest anchor; sibling plans have edited this file):

```ts
// --- overview: money flow ---
// GET /overview/money-flow?year= (2026-08-25 spec §5) — one server-composed, reconciled
// year; all money 2dp Decimal strings. Conservation is structural: the five sources sum
// to gross_income (other_income balances), and taxes.total + pre_tax_savings +
// take_home_cash + retained_equity == gross_income (retained_equity is the residual) —
// at 2dp the paycheck sankey's ±$0.01 reconciliation drift is tolerated.

export interface MoneyFlowSources {
  salary_and_bonus: string
  rsu_vests: string
  espp: string
  investment_income: string
  /** BALANCING node: engine gross minus the four named sources (1099 income, employer
   * HSA, w2_other, stored-total drift). A negative here made renderable false. */
  other_income: string
}

export interface MoneyFlowTaxes {
  total: string
  federal: string
  state: string
  medicare: string
  social_security: string
  disability: string
  capital_gains: string
}

export interface MoneyFlowCategory {
  name: string
  amount: string
}

export interface MoneyFlowOut {
  year: number
  /** Years with any stored tax inputs — the card's chip row. */
  available_years: number[]
  /** false + reason: render the SERVER's sentence verbatim instead of a chart. */
  renderable: boolean
  reason: string | null
  warnings: string[]
  sources: MoneyFlowSources
  gross_income: string
  taxes: MoneyFlowTaxes
  pre_tax_savings: string
  take_home_cash: string
  /** Residual: gross − taxes − pre-tax − take-home (≈ vest shares kept + ESPP + timing). */
  retained_equity: string
  /** Top-7 by year sum, biggest first, positive-only (the /spending fold). */
  categories: MoneyFlowCategory[]
  /** The folded positive remainder; null when nothing folded. */
  other_spend: string | null
  total_spend: string
  /** SIGNED: take_home_cash − total_spend; negative draws a red Drawdown source. */
  saved: string
}
```

- [ ] **Step 2: Client** — create `src/api/overview.ts`:

```ts
import { api } from './client'
import type { MoneyFlowOut } from '../types/api'

// Omitting `year` lets the SERVER pick (the current product year — its clock, not the
// browser's). An unknown year still answers 200 with renderable: false + a reason.
export function fetchMoneyFlow(year?: number): Promise<MoneyFlowOut> {
  return api<MoneyFlowOut>(
    year === undefined ? '/overview/money-flow' : `/overview/money-flow?year=${year}`,
  )
}
```

- [ ] **Step 3: Verify** — `npx tsc -b` → clean; `npx eslint src/types/api.ts src/api/overview.ts` → clean.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(overview): money-flow wire types + client"`

### Task 4: The pure builder — 4 pinned columns on the shared sankey grammar

**Files:**
- Create: `src/components/overview/moneyFlowOptions.ts`
- Test: `src/components/overview/moneyFlowOptions.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/components/overview/moneyFlowOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from '../../charts/theme'
import type { MoneyFlowOut } from '../../types/api'
import { moneyFlowOption } from './moneyFlowOptions'

// A conservation-consistent wire payload (sources sum to gross; the mid column sums back
// to gross; saved = take-home − total_spend), strings exactly as the server quantizes.
// These are FIXTURE figures shaped like the server's, not engine assertions — the engine
// truth is pinned backend-side.
function flowOut(over: Partial<MoneyFlowOut> = {}): MoneyFlowOut {
  return {
    year: 2026,
    available_years: [2024, 2025, 2026],
    renderable: true,
    reason: null,
    warnings: [],
    sources: {
      salary_and_bonus: '220000.00',
      rsu_vests: '80000.00',
      espp: '4000.00',
      investment_income: '2500.00',
      other_income: '1000.00',
    },
    gross_income: '307500.00',
    taxes: {
      total: '67016.05',
      federal: '26520.00',
      state: '14225.00',
      medicare: '4345.65',
      social_security: '18581.40',
      disability: '3344.00',
      capital_gains: '0.00',
    },
    pre_tax_savings: '27300.00',
    take_home_cash: '120000.00',
    retained_equity: '93183.95',
    categories: [
      { name: 'Rent', amount: '24000.00' },
      { name: 'Food', amount: '6000.00' },
      { name: 'Travel', amount: '4200.00' },
      { name: 'Utilities', amount: '3000.00' },
      { name: 'Insurance', amount: '2400.00' },
      { name: 'Fun', amount: '1800.00' },
      { name: 'Fitness', amount: '1200.00' },
    ],
    other_spend: '1400.00',
    total_spend: '44000.00',
    saved: '76000.00',
    ...over,
  }
}

// Option readers (spendingSankeyOptions.test.ts posture).
interface NodeLike {
  name?: string
  value?: number
  depth?: number
  itemStyle?: { color?: string }
}
interface LinkLike {
  source?: string
  target?: string
  value?: number
}
interface SankeyLike {
  type?: string
  nodeWidth?: number
  layoutIterations?: number
  data?: NodeLike[]
  links?: LinkLike[]
}
function sankeyOf(option: EChartsOption): SankeyLike {
  return (option as unknown as { series: SankeyLike[] }).series[0]
}
function tooltipOf(option: EChartsOption): (params: unknown) => string {
  return (option as unknown as { tooltip: { formatter: (params: unknown) => string } })
    .tooltip.formatter
}

describe('moneyFlowOption — the four pinned columns', () => {
  it('emits sources, gross, the mid four and the spend fan in data order with pinned depths', () => {
    const option = moneyFlowOption(flowOut())
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    // The shared mark spec rides every option (charts/sankey.ts owns the numbers).
    expect(series.type).toBe('sankey')
    expect(series.nodeWidth).toBe(12)
    expect(series.layoutIterations).toBe(0)
    expect(series.data?.map((n) => n.name)).toEqual([
      'Salary & bonus', 'RSU vests', 'ESPP', 'Investment income', 'Other income',
      'Gross income',
      'Taxes', 'Pre-tax savings', 'Retained equity & other', 'Take-home cash',
      'Rent', 'Food', 'Travel', 'Utilities', 'Insurance', 'Fun', 'Fitness', 'Other',
      'Saved',
    ])
    expect(series.data?.map((n) => n.depth)).toEqual([
      0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    ])
    expect(series.data?.map((n) => n.itemStyle?.color)).toEqual([
      PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[3], PALETTE[4], // fixed source slots
      MUTED, // Gross restates money in transit (paycheck's intermediate vocabulary)
      PALETTE[7], PALETTE[5], PALETTE[6], // Taxes / Pre-tax / Retained fixed slots
      MUTED, // Take-home: the second intermediate
      PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[3], PALETTE[4], PALETTE[5], PALETTE[6],
      OTHER_SERIES_COLOR, // the folded remainder wears the gray Other color
      POSITIVE, // Saved: the kept-money-is-green cross-chart convention
    ])
  })

  it('carries every link at its server figure and conserves the take-home fan', () => {
    const series = sankeyOf(moneyFlowOption(flowOut())!)
    expect(series.links).toEqual([
      { source: 'Salary & bonus', target: 'Gross income', value: 220000 },
      { source: 'RSU vests', target: 'Gross income', value: 80000 },
      { source: 'ESPP', target: 'Gross income', value: 4000 },
      { source: 'Investment income', target: 'Gross income', value: 2500 },
      { source: 'Other income', target: 'Gross income', value: 1000 },
      { source: 'Gross income', target: 'Taxes', value: 67016.05 },
      { source: 'Gross income', target: 'Pre-tax savings', value: 27300 },
      { source: 'Gross income', target: 'Retained equity & other', value: 93183.95 },
      { source: 'Gross income', target: 'Take-home cash', value: 120000 },
      { source: 'Take-home cash', target: 'Rent', value: 24000 },
      { source: 'Take-home cash', target: 'Food', value: 6000 },
      { source: 'Take-home cash', target: 'Travel', value: 4200 },
      { source: 'Take-home cash', target: 'Utilities', value: 3000 },
      { source: 'Take-home cash', target: 'Insurance', value: 2400 },
      { source: 'Take-home cash', target: 'Fun', value: 1800 },
      { source: 'Take-home cash', target: 'Fitness', value: 1200 },
      { source: 'Take-home cash', target: 'Other', value: 1400 },
      { source: 'Take-home cash', target: 'Saved', value: 76000 },
    ])
  })

  it('omits a zero source without reshuffling its neighbours', () => {
    // espp zeroed, the freed 4000 moved into other_income — conservation intact.
    const series = sankeyOf(
      moneyFlowOption(flowOut({
        sources: {
          salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '0.00',
          investment_income: '2500.00', other_income: '5000.00',
        },
      }))!,
    )
    const names = series.data?.map((n) => n.name)
    expect(names).not.toContain('ESPP')
    const byName = new Map(series.data?.map((n) => [n.name, n.itemStyle?.color]))
    expect(byName.get('RSU vests')).toBe(PALETTE[1]) // fixed per ENTITY, not per index
    expect(byName.get('Investment income')).toBe(PALETTE[3])
  })

  it('draws a deficit as a red Drawdown source splitting each category pro-rata', () => {
    const option = moneyFlowOption(flowOut({
      take_home_cash: '22000.00',
      retained_equity: '191183.95',
      saved: '-22000.00',
    }))
    const series = sankeyOf(option!)
    const drawdown = series.data?.find((n) => n.name === 'Drawdown')
    expect(drawdown).toEqual({
      name: 'Drawdown', value: 22000, depth: 2, itemStyle: { color: NEGATIVE },
    })
    expect(series.data?.map((n) => n.name)).not.toContain('Saved')
    // 22000 take-home over 44000 spend: exactly half of every category from each source.
    expect(series.links).toContainEqual({ source: 'Take-home cash', target: 'Rent', value: 12000 })
    expect(series.links).toContainEqual({ source: 'Drawdown', target: 'Rent', value: 12000 })
    expect(series.links).toContainEqual({ source: 'Take-home cash', target: 'Other', value: 700 })
    expect(series.links).toContainEqual({ source: 'Drawdown', target: 'Other', value: 700 })
  })

  it('refuses a non-renderable payload and backstops a negative figure', () => {
    expect(moneyFlowOption(flowOut({ renderable: false, reason: 'nope' }))).toBeNull()
    // The server refuses negatives itself; a payload that slipped through must not draw.
    expect(moneyFlowOption(flowOut({ retained_equity: '-0.01' }))).toBeNull()
  })

  it('lists the six jurisdictions on the Taxes node and delegates everything else', () => {
    const format = tooltipOf(moneyFlowOption(flowOut())!)
    const taxes = format({ dataType: 'node', name: 'Taxes' })
    expect(taxes).toContain('<strong>$67,016.05</strong>')
    expect(taxes).toContain('Federal $26,520.00')
    expect(taxes).toContain('State $14,225.00')
    expect(taxes).toContain('Medicare $4,345.65')
    expect(taxes).toContain('Social Security $18,581.40')
    expect(taxes).toContain('Disability $3,344.00')
    expect(taxes).toContain('Capital gains $0.00')
    // Every other node/edge reads the shared factory's server-figure echo.
    expect(format({ dataType: 'node', name: 'Rent' })).toContain('$24,000.00')
    expect(
      format({ dataType: 'edge', data: { source: 'Take-home cash', target: 'Saved' } }),
    ).toContain('$76,000.00')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/overview/moneyFlowOptions.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/components/overview/moneyFlowOptions.ts`:

```ts
// Pure option builder for the Overview annual money-flow card (2026-08-25 spec §5) — no
// React, no fetching (spendingSankeyOptions' posture). Every node value is the SERVER's
// own 2dp figure parsed once for display, and the tooltip echoes those figures verbatim
// through the shared factory — never a layout-derived link sum (the ±$0.01
// reconciliation drift the paycheck sankey documents is invisible at link-width scale).
import type { EChartsOption } from '../../charts/echarts'
import { SANKEY_MARKS, makeSankeyTooltipFormatter } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from '../../charts/theme'
import type { MoneyFlowOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'

// Fixed node names. A user category with one of these exact names would merge with the
// app node (sankey nodes key on name) — the spending sankey's accepted 'Other'
// collision, a little wider here.
const GROSS = 'Gross income'
const TAXES = 'Taxes'
const PRE_TAX = 'Pre-tax savings'
const RETAINED = 'Retained equity & other'
const TAKE_HOME = 'Take-home cash'
const SAVED = 'Saved'
const DRAWDOWN = 'Drawdown'
const OTHER_SPEND = 'Other'

// The five sources in the spec's own order, on FIXED PALETTE slots per ENTITY (the
// paycheck sankey's grammar): an omitted zero source never reshuffles its neighbours'
// hues. Categories reuse slots 0..6 on the far right — a deliberate repetition: left is
// income identity, right is the /spending pages' own category slots (same entity, same
// hue as the stacked bars), and the MUTED intermediates keep the columns apart.
const SOURCES: {
  key: keyof MoneyFlowOut['sources']
  label: string
  color: string
}[] = [
  { key: 'salary_and_bonus', label: 'Salary & bonus', color: PALETTE[0] },
  { key: 'rsu_vests', label: 'RSU vests', color: PALETTE[1] },
  { key: 'espp', label: 'ESPP', color: PALETTE[2] },
  { key: 'investment_income', label: 'Investment income', color: PALETTE[3] },
  { key: 'other_income', label: 'Other income', color: PALETTE[4] },
]

// The Taxes tooltip's six jurisdiction lines, in the engine's own order (tax_keys).
const JURISDICTION_LINES: { key: keyof MoneyFlowOut['taxes']; label: string }[] = [
  { key: 'federal', label: 'Federal' },
  { key: 'state', label: 'State' },
  { key: 'medicare', label: 'Medicare' },
  { key: 'social_security', label: 'Social Security' },
  { key: 'disability', label: 'Disability' },
  { key: 'capital_gains', label: 'Capital gains' },
]

// Cent arithmetic on display floats (the spending sankey's constants): float dust must
// neither invent a node nor leak into a link, and sub-cent slivers are dropped — a
// zero-width link is tooltip noise (the vesting-tooltip lesson).
const A_CENT = 0.005
const cents = (value: number) => Math.round(value * 100) / 100

/**
 * "Where the year's money went", 4 pinned columns (spec §5): sources → Gross income →
 * {Taxes, Pre-tax savings, Retained equity & other, Take-home cash} → categories +
 * Saved/Drawdown. layoutIterations 0 makes data order the vertical order, so nodes are
 * emitted column by column, biggest-first where the server sorted them. Null = the card
 * renders the payload's reason (or its generic note) instead of a chart.
 */
export function moneyFlowOption(flow: MoneyFlowOut): EChartsOption | null {
  if (!flow.renderable) return null
  // Negative backstop (the paycheck sankey's refusal): the server refuses these itself,
  // but a negative ribbon must never be drawable from a payload that slipped through.
  // `saved` is exempt — it is signed by design and drawn as Drawdown below.
  const structural = [
    flow.gross_income,
    flow.taxes.total,
    flow.pre_tax_savings,
    flow.take_home_cash,
    flow.retained_equity,
    ...SOURCES.map((source) => flow.sources[source.key]),
    ...flow.categories.map((category) => category.amount),
    ...(flow.other_spend === null ? [] : [flow.other_spend]),
  ].map(Number)
  if (structural.some((value) => !Number.isFinite(value) || value < 0)) return null

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []

  for (const source of SOURCES) {
    const value = Number(flow.sources[source.key])
    if (value < A_CENT) continue
    nodes.push({ name: source.label, value, depth: 0, itemStyle: { color: source.color } })
    links.push({ source: source.label, target: GROSS, value })
  }
  const gross = Number(flow.gross_income)
  if (links.length === 0 || gross < A_CENT) return null
  nodes.push({ name: GROSS, value: gross, depth: 1, itemStyle: { color: MUTED } })

  // The middle column: three terminals on fixed slots, Take-home MUTED because it is
  // the second intermediate (money still in transit toward the spend fan).
  const mid: [string, number, string][] = [
    [TAXES, Number(flow.taxes.total), PALETTE[7]],
    [PRE_TAX, Number(flow.pre_tax_savings), PALETTE[5]],
    [RETAINED, Number(flow.retained_equity), PALETTE[6]],
    [TAKE_HOME, Number(flow.take_home_cash), MUTED],
  ]
  for (const [name, value, color] of mid) {
    if (value < A_CENT) continue
    nodes.push({ name, value, depth: 2, itemStyle: { color } })
    links.push({ source: GROSS, target: name, value })
  }

  // Take-home fans into the year's categories with the spending sankey's exact
  // Saved/Drawdown semantics: surplus → green Saved; deficit → a red Drawdown source
  // beside Take-home, every category split pro-rata between the two — money is
  // fungible, and naming WHICH categories the drawdown funded would fabricate
  // causality.
  const takeHome = Number(flow.take_home_cash)
  const spent = Number(flow.total_spend)
  const saved = Number(flow.saved)
  const deficit = saved <= -A_CENT
  if (deficit) {
    nodes.push({
      name: DRAWDOWN,
      value: cents(-saved),
      depth: 2,
      itemStyle: { color: NEGATIVE },
    })
  }
  const slices = [
    ...flow.categories.map((category, slot) => ({
      // Slot i = PALETTE[i], the /spending fold's exact assignment (biggest-first). The
      // server pins the fold at 7 (TOP_N_CATEGORIES, tested backend-side), so slots 0..6
      // always land inside the 8-slot palette; the folded remainder wears gray Other.
      name: category.name,
      value: Number(category.amount),
      color: PALETTE[slot],
    })),
    ...(flow.other_spend === null
      ? []
      : [{ name: OTHER_SPEND, value: Number(flow.other_spend), color: OTHER_SERIES_COLOR }]),
  ]
  for (const slice of slices) {
    if (slice.value < A_CENT) continue
    nodes.push({ name: slice.name, value: slice.value, depth: 3, itemStyle: { color: slice.color } })
    if (deficit) {
      const fromTakeHome = spent > 0 ? cents((slice.value * takeHome) / spent) : 0
      const fromDrawdown = cents(slice.value - fromTakeHome)
      if (fromTakeHome >= A_CENT) {
        links.push({ source: TAKE_HOME, target: slice.name, value: fromTakeHome })
      }
      if (fromDrawdown >= A_CENT) {
        links.push({ source: DRAWDOWN, target: slice.name, value: fromDrawdown })
      }
    } else {
      links.push({ source: TAKE_HOME, target: slice.name, value: slice.value })
    }
  }
  if (!deficit && saved >= A_CENT) {
    nodes.push({ name: SAVED, value: saved, depth: 3, itemStyle: { color: POSITIVE } })
    links.push({ source: TAKE_HOME, target: SAVED, value: saved })
  }

  // The Taxes node alone gets an extended tooltip (spec §5: the six jurisdictions,
  // server figures verbatim); everything else delegates to the shared factory so node
  // values can never drift from the page's figures. Labels here are fixed constants —
  // no user text, nothing to escape.
  const base = makeSankeyTooltipFormatter(nodes, links)
  const taxLines = JURISDICTION_LINES.map(
    (line) => `${line.label} ${formatCurrency(flow.taxes[line.key])}`,
  ).join('<br/>')
  const formatter = (params: unknown): string => {
    const p = (Array.isArray(params) ? params[0] : params) as {
      dataType?: string
      name?: string
    } | null
    if (p && p.dataType !== 'edge' && p.name === TAXES) {
      return `<strong>${formatCurrency(flow.taxes.total)}</strong><br/>${TAXES}<br/>${taxLines}`
    }
    return base(params)
  }

  return {
    tooltip: { trigger: 'item', formatter },
    series: [{ ...SANKEY_MARKS, data: nodes, links }],
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/overview/moneyFlowOptions.test.ts` → ALL PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(overview): money-flow sankey option builder"`

### Task 5: `MoneyFlowCard` — chips, chart, warnings, refusal note, inline retry

The card is PRESENTATIONAL: the page owns the isolated fetch (Task 6, the Up-next pattern), so these tests are plain props in, DOM out — no API mocks.

**Files:**
- Create: `src/components/overview/MoneyFlowCard.tsx`, `src/components/overview/moneyFlow.css`
- Test: `src/components/overview/MoneyFlowCard.test.tsx`

- [ ] **Step 1: Write the failing tests** — create `src/components/overview/MoneyFlowCard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MoneyFlowOut } from '../../types/api'

// echarts needs a real canvas and is never rendered in jsdom (house law); what the chart
// DRAWS is pinned in moneyFlowOptions.test.ts.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', { 'data-testid': 'echart' }) }
})

import MoneyFlowCard from './MoneyFlowCard'

function flowOut(over: Partial<MoneyFlowOut> = {}): MoneyFlowOut {
  return {
    year: 2026,
    available_years: [2024, 2025, 2026],
    renderable: true,
    reason: null,
    warnings: ['net pay entered 7/12 months'],
    sources: {
      salary_and_bonus: '220000.00',
      rsu_vests: '80000.00',
      espp: '4000.00',
      investment_income: '2500.00',
      other_income: '1000.00',
    },
    gross_income: '307500.00',
    taxes: {
      total: '67016.05',
      federal: '26520.00',
      state: '14225.00',
      medicare: '4345.65',
      social_security: '18581.40',
      disability: '3344.00',
      capital_gains: '0.00',
    },
    pre_tax_savings: '27300.00',
    take_home_cash: '120000.00',
    retained_equity: '93183.95',
    categories: [
      { name: 'Rent', amount: '24000.00' },
      { name: 'Food', amount: '6000.00' },
    ],
    other_spend: null,
    total_spend: '30000.00',
    saved: '90000.00',
    ...over,
  }
}

const onRetry = vi.fn()
const onYearChange = vi.fn()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderCard(flow: MoneyFlowOut | null, failed = false) {
  return render(
    <MoneyFlowCard flow={flow} failed={failed} onRetry={onRetry} onYearChange={onYearChange} />,
  )
}

it('renders the chart, the year chips with the active year, and the warnings line', () => {
  renderCard(flowOut())
  expect(screen.getByText('Money flow — 2026')).toBeDefined()
  expect(screen.getByTestId('echart')).toBeDefined()
  const chips = screen.getByRole('group', { name: 'Money-flow year' })
  const buttons = Array.from(chips.querySelectorAll('button'))
  expect(buttons.map((b) => b.textContent)).toEqual(['2024', '2025', '2026'])
  expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
  expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
  // Server warning sentences render verbatim, muted, under the chart.
  expect(screen.getByText('net pay entered 7/12 months')).toBeDefined()
  // The InfoHint explains the residual and the sources (spec §5's card copy).
  expect(screen.getByLabelText(/vest shares kept \+ ESPP contributions \+ timing/)).toBeDefined()
})

it('hands a chip press to onYearChange', () => {
  renderCard(flowOut())
  fireEvent.click(screen.getByRole('button', { name: '2024' }))
  expect(onYearChange).toHaveBeenCalledWith(2024)
})

it('renders the refusal reason verbatim instead of a chart — chips stay for the escape', () => {
  renderCard(
    flowOut({
      renderable: false,
      reason: 'No tax inputs are stored for 2031 — enter the year on the Taxes page to draw its money flow.',
      warnings: ['no tax inputs stored for 2031'],
    }),
  )
  expect(screen.queryByTestId('echart')).toBeNull()
  expect(
    screen.getByText(
      'No tax inputs are stored for 2031 — enter the year on the Taxes page to draw its money flow.',
    ),
  ).toBeDefined()
  // The chip row survives a refusal: available_years is how the user gets OUT of an
  // empty year.
  expect(screen.getByRole('group', { name: 'Money-flow year' })).toBeDefined()
  expect(screen.getByText('no tax inputs stored for 2031')).toBeDefined()
})

it('joins multiple warnings with the house dot separator', () => {
  renderCard(flowOut({ warnings: ['net pay entered 7/12 months', 'spending entered 5/12 months'] }))
  expect(
    screen.getByText('net pay entered 7/12 months · spending entered 5/12 months'),
  ).toBeDefined()
})

it('a failed fetch renders the inline error with a working Retry', () => {
  renderCard(null, true)
  expect(screen.getByText(/Couldn't load the money flow/)).toBeDefined()
  expect(screen.queryByTestId('echart')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the money flow' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('renders only the header while the first fetch is in flight', () => {
  renderCard(null, false)
  expect(screen.getByText('Money flow')).toBeDefined()
  expect(screen.queryByTestId('echart')).toBeNull()
  expect(screen.queryByRole('group', { name: 'Money-flow year' })).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/overview/MoneyFlowCard.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement the card** — create `src/components/overview/MoneyFlowCard.tsx`:

```tsx
import { useMemo } from 'react'
import type { MoneyFlowOut } from '../../types/api'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import { moneyFlowOption } from './moneyFlowOptions'
import '../panels.css'
import './moneyFlow.css'

/**
 * The annual money-flow card (2026-08-25 spec §5): presentational only — OverviewPage
 * owns the ISOLATED fetch (the Up-next pattern) and hands the payload down, so a
 * tax-engine hiccup dents this card and never the snapshot. Year chips come from the
 * payload's available_years; the active chip is the payload's own echoed year, so the
 * chip row can never disagree with the chart beside it.
 */
export default function MoneyFlowCard({
  flow,
  failed,
  onRetry,
  onYearChange,
}: {
  flow: MoneyFlowOut | null
  failed: boolean
  onRetry: () => void
  onYearChange: (year: number) => void
}) {
  const option = useMemo(() => (flow === null ? null : moneyFlowOption(flow)), [flow])
  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        {flow === null ? 'Money flow' : `Money flow — ${flow.year}`}
        <InfoHint text="Where the year's money went. Income comes from the year's tax inputs through the tax engine; take-home cash is the entered monthly net pay; the right-hand fan is the year's entered spending. Retained equity & other is the residual — ≈ vest shares kept + ESPP contributions + timing between W-2 income and cash." />
      </h2>
      {flow !== null && flow.available_years.length > 0 && (
        <div className="segmented money-flow-years" role="group" aria-label="Money-flow year">
          {flow.available_years.map((year) => (
            <button
              key={year}
              type="button"
              className={year === flow.year ? 'active' : ''}
              aria-pressed={year === flow.year}
              onClick={() => onYearChange(year)}
            >
              {year}
            </button>
          ))}
        </div>
      )}
      {failed ? (
        <p className="drill-hint">
          Couldn&apos;t load the money flow.{' '}
          <button
            type="button"
            className="button"
            aria-label="Retry loading the money flow"
            onClick={onRetry}
          >
            Retry
          </button>
        </p>
      ) : flow === null ? null : (
        <>
          {option !== null ? (
            // ~17 nodes at most (5 sources + gross + 4 mid + 7 categories + Other +
            // Saved), so 380px keeps every ribbon legible (spec §5's card sizing).
            <EChart option={option} height={380} />
          ) : (
            // The SERVER's refusal sentence, verbatim; the fallback covers only a
            // renderable payload the builder's negative backstop still refused.
            <p className="empty-note">
              {flow.reason ?? 'Nothing to draw for this year yet.'}
            </p>
          )}
          {flow.warnings.length > 0 && (
            <p className="drill-hint">{flow.warnings.join(' · ')}</p>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: CSS** — create `src/components/overview/moneyFlow.css`:

```css
/* Money-flow card chrome (2026-08-25 spec §5). The chips reuse panels.css's .segmented
   grammar (RangeChips' family); only the breathing room under the eyebrow lives here. */

.money-flow-years {
  margin-bottom: 0.75rem;
}
```

- [ ] **Step 5: Run** — `npx vitest run src/components/overview/MoneyFlowCard.test.tsx` → ALL PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(overview): MoneyFlowCard with year chips, warnings and inline retry"`

### Task 6: OverviewPage integration — the second isolated fetch + test repairs

**RE-READ `src/pages/OverviewPage.tsx` AND `src/pages/OverviewPage.test.tsx` IN FULL before touching them** — the sibling waves (system status swapped the refresh-status fetch, chart affordances added click-throughs, polish added aria) have edited both. Every anchor below is by ROLE, not line number; if an anchor is missing, find its renamed successor before proceeding, and adapt mechanically (e.g. if `RefreshStatus` became a system-status payload, the flow additions are unaffected — they touch none of the snapshot's eleven clients).

**Files:**
- Modify: `src/pages/OverviewPage.tsx`, `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing tests.** In `src/pages/OverviewPage.test.tsx`:
  1. Add the mock block after the `../api/calendar` mock (same shape — the money flow is the page's SECOND isolated fetch):
```tsx
// The money-flow card is the page's second isolated fetch (spec §5): its failure must
// dent one card, never the snapshot — and vice versa.
vi.mock('../api/overview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/overview')>()),
  fetchMoneyFlow: vi.fn(),
}))
```
  2. Extend the post-mock import block with `import { fetchMoneyFlow } from '../api/overview'` (alphabetical: after `../api/netWorth`, before `../api/portfolio`), and add `MoneyFlowOut` to the type import list.
  3. Add the fixture factory after `matrixOut` (conservation-consistent, current-year so the chips read naturally):
```tsx
function moneyFlowOut(over: Partial<MoneyFlowOut> = {}): MoneyFlowOut {
  return {
    year: CURRENT_YEAR,
    available_years: [CURRENT_YEAR - 1, CURRENT_YEAR],
    renderable: true,
    reason: null,
    warnings: [],
    sources: {
      salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '4000.00',
      investment_income: '2500.00', other_income: '1000.00',
    },
    gross_income: '307500.00',
    taxes: {
      total: '67016.05', federal: '26520.00', state: '14225.00', medicare: '4345.65',
      social_security: '18581.40', disability: '3344.00', capital_gains: '0.00',
    },
    pre_tax_savings: '27300.00',
    take_home_cash: '120000.00',
    retained_equity: '93183.95',
    categories: [
      { name: 'Rent', amount: '24000.00' },
      { name: 'Food', amount: '6000.00' },
    ],
    other_spend: null,
    total_spend: '30000.00',
    saved: '90000.00',
    ...over,
  }
}
```
  4. `Payload` interface gains `flow: MoneyFlowOut`; `serve()`'s defaults gain `flow: moneyFlowOut(),` and its arming block gains `vi.mocked(fetchMoneyFlow).mockResolvedValue(payload.flow)`; `failAll()` gains `vi.mocked(fetchMoneyFlow).mockImplementation(boom)`.
  5. **Chart-count repairs** (the sankey is a fourth mocked EChart, LAST in the card grid; it has no xAxis so its `data-categories` is empty):
     - In `'feeds the spark, the performance lines and the bars'`: `expect(charts).toHaveLength(3)` → `toHaveLength(4)`, and add `expect(categoriesOf(charts[3])).toBe('')` with a one-line comment (`// the money-flow sankey has no category axis`). The `charts[0..2]` assertions stay byte-identical.
     - In `'keeps the tiles up and cues the staleness when a reload fails'`: `expect(screen.getAllByTestId('echart')).toHaveLength(3)` → `toHaveLength(4)`.
  6. **Empty-database repair**: the `'renders dashes and per-slot empty notes rather than a page of zeros'` test's `serve({...})` gains
```tsx
      flow: moneyFlowOut({
        renderable: false,
        reason:
          'No tax inputs are stored for 2031 — enter the year on the Taxes page to draw its money flow.',
        available_years: [],
        warnings: ['no tax inputs stored for 2031'],
      }),
```
  and, beside the other empty-state assertions, add:
```tsx
    // The money-flow card refuses with the SERVER's sentence — no fourth chart.
    expect(screen.getByText(/No tax inputs are stored for 2031/)).toBeTruthy()
```
  (its existing `expect(screen.queryAllByTestId('echart')).toHaveLength(0)` now also proves the refusal drew nothing).
  7. Append three new tests at the end of the file:
```tsx
it('a money-flow failure dents only its card, and its Retry refetches the flow alone', async () => {
  serve()
  vi.mocked(fetchMoneyFlow).mockRejectedValue(new ApiError('flow down', 500))
  renderPage()
  await screen.findByText(/Couldn't load the money flow/)
  screen.getByText(/Net worth —/) // the snapshot half rendered normally
  expect(screen.queryByRole('alert')).toBeNull() // no page-level banner fired

  vi.mocked(fetchMoneyFlow).mockResolvedValue(moneyFlowOut())
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the money flow' }))
  await screen.findByText(`Money flow — ${CURRENT_YEAR}`)
  expect(fetchSummary).toHaveBeenCalledTimes(1) // the snapshot was never refetched
})

it('money-flow year chips refetch the picked year and nothing else', async () => {
  serve()
  renderPage()
  await screen.findByText(`Money flow — ${CURRENT_YEAR}`)
  fireEvent.click(screen.getByRole('button', { name: String(CURRENT_YEAR - 1) }))
  await waitFor(() => expect(fetchMoneyFlow).toHaveBeenLastCalledWith(CURRENT_YEAR - 1))
  expect(fetchSummary).toHaveBeenCalledTimes(1)
})

it('Refresh refetches the money flow alongside the snapshot', async () => {
  serve()
  renderPage()
  await screen.findByText(`Money flow — ${CURRENT_YEAR}`)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(fetchMoneyFlow).toHaveBeenCalledTimes(2))
  // No year pinned by a chip yet, so the reload keeps the server-default call shape.
  expect(vi.mocked(fetchMoneyFlow).mock.calls[1]).toEqual([undefined])
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pages/OverviewPage.test.tsx` → the three new tests FAIL (no card rendered) and the repaired chart-count tests FAIL (still 3 charts); nothing else may break.

- [ ] **Step 3: Implement the page wiring.** In `src/pages/OverviewPage.tsx` (after re-reading it):
  1. Imports: add `import { fetchMoneyFlow } from '../api/overview'` (alphabetical among the `../api/*` imports, after `netWorth`, before `portfolio`); add `import MoneyFlowCard from '../components/overview/MoneyFlowCard'` beside the other overview-component imports; add `MoneyFlowOut,` to the `import type {...} from '../types/api'` list (alphabetical: after `HoldingsResponse`, before `NetWorthSummary`).
  2. State + loader, directly below the Up-next block (`loadUpNext`) — it is the same pattern, second verse:
```tsx
  // The money-flow card is the SECOND isolated fetch (spec §5, the Up-next pattern):
  // its own state, its own seq, its own inline error — a tax-engine hiccup dents one
  // card and never the snapshot, and vice versa.
  const [flow, setFlow] = useState<MoneyFlowOut | null>(null)
  const [flowFailed, setFlowFailed] = useState(false)
  // null = let the server pick the year (the current product year); a chip click pins it.
  const [flowYear, setFlowYear] = useState<number | null>(null)
  const flowSeq = useRef(0)

  const loadFlow = (year: number | null) => {
    const seq = ++flowSeq.current
    fetchMoneyFlow(year ?? undefined)
      .then((data) => {
        if (seq !== flowSeq.current) return
        setFlow(data)
        setFlowFailed(false)
      })
      .catch(() => {
        if (seq !== flowSeq.current) return
        setFlowFailed(true)
      })
  }
```
  3. The mount effect gains `loadFlow(null)` after `loadUpNext()`; `reload()` gains `loadFlow(flowYear)` after `loadUpNext()`.
  4. Mount the card INSIDE the `card-grid` div, immediately after the "Recent spending" `<section>` closes (so the grid order reads: net-worth trend, performance, recent spending, money flow — and Up next still follows the grid):
```tsx
            <MoneyFlowCard
              flow={flow}
              failed={flowFailed}
              onRetry={() => loadFlow(flowYear)}
              onYearChange={(year) => {
                setFlowYear(year)
                loadFlow(year)
              }}
            />
```

- [ ] **Step 4: Run** — `npx vitest run src/pages/OverviewPage.test.tsx` → ALL PASS (repaired counts included). Then the neighbours that share fixtures/mocks with nothing here, as a sanity sweep: `npx vitest run src/components/overview` → ALL PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(overview): mount the money-flow card behind an isolated fetch"`

---

## Phase 3 — Verification

### Task 7: Full verification (STOP here — the orchestrator merges)

**Files:** none (verification only; fix-forward anything red, in the task where it belongs)

- [ ] **Step 1: Full backend suite** — `cd backend && .venv/Scripts/python -m pytest -q` → ALL PASS (record the count; the pre-plan baseline was 853 — expect that plus this plan's ~19 new tests, adjusted for whatever the sibling waves added).
- [ ] **Step 2: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → if anything reformats, re-run the touched test files and commit the reflow.
- [ ] **Step 3: Full frontend suite** — `npx vitest run` → ALL PASS (record the count; baseline 791 plus this plan's ~15).
- [ ] **Step 4: Types** — `npx tsc -b` → clean, no output.
- [ ] **Step 5: Lint** — `npx eslint .` → clean.
- [ ] **Step 6: Commit anything the verification steps touched** — `git add -A && git commit -m "chore(overview): money-flow verification sweep"` (skip if the tree is already clean), then `git status --porcelain` → EMPTY.
- [ ] **Step 7: STOP.** Do not merge, do not push, do not delete anything — the orchestrator reviews and merges this branch. Leave a summary listing: both test counts; the new route (`GET /api/v1/overview/money-flow?year=`); the two structural conventions reviewers should sanity-check on real data (Other income balances the sources column, Retained equity & other is the mid-column residual — both refuse with a sentence when negative); the deliberate palette repetition (sources wear slots 0–4 on the left, categories reuse slots 0–6 on the right — same-entity-same-hue with /spending won over hue uniqueness, MUTED intermediates keep the columns apart); and the accepted node-name collision (a user category literally named "Taxes"/"Saved"/etc. would merge with the app node — the spending sankey's documented 'Other' posture).
