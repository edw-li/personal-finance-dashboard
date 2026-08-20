# Tax What-If Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /taxes/what-if` models prospective brokerage sales, ESPP lot sales, and raw input overrides against a stored tax year — baseline vs. scenario vs. delta through the golden-tested engine, nothing stored — with a What-if card on /taxes and deep links from the holding drill-in and the ESPP lots table.

**Architecture:** A pure scenario service (`tax_whatif.py`, no DB/HTTP — tax_service's posture) classifies sales via the average-cost fold and decomposes ESPP dispositions from stored lot fields, mapping every delta onto BOTH the component input key and the total key the engine actually reads. The router loads stored inputs+brackets once, runs `compute_breakdown` twice, and maps both through the existing `_summary_out` so quantization discipline is shared with `/years/{year}/summary`.

**Tech Stack:** FastAPI + async SQLAlchemy (read-only queries; zero writes), pydantic v2, React 19 + TS + vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-tax-what-if-sandbox-design.md`

**Binding rules:** implementation subagents on Opus; pytest `-W error`; frontend gates `npm run test` / `npm run lint` (1 sanctioned warning) / `npm run build`; server figures render verbatim; NO migrations in this feature (alembic head must not move — `alembic check` still clean).

---

### Task 1: Pure scenario service + schemas

**Files:**
- Create: `backend/app/services/tax_whatif.py`
- Modify: `backend/app/schemas/taxes.py` (append the What-if schemas)
- Test: `backend/tests/test_tax_whatif.py` (new)

- [x] **Step 1: Write the service** (complete file). Read `backend/app/services/tax_service.py` and `backend/app/tax_keys.py` first — the key-mapping comment below is the load-bearing design fact.

```python
"""What-if scenario math over the tax engine's input vocabulary.

Pure module — no DB, no HTTP (tax_service's posture). The engine reads the TOTAL keys
(stcg_total / ltcg_total / other_w2_income); the component keys feed only gross_income
and the suggestion formulas. Every scenario delta therefore lands on BOTH the component
key and the total the engine consumes — exactly how the sheet's own gray formulas roll
components up. Overrides apply LAST, as absolute replacements, so an override of a key a
sale also touched wins (the response's changed_inputs makes that visible).

ESPP decomposition restores the sheet's importer-ignored "ESPP Taxation Calculator":
disposition from the stored qualifying_date, the disqualified bargain element from the
purchase-date FMV, the qualified ordinary clamp reconstructing the grant-date FMV from
the subscription price (subscription = 85% of the lookback FMV — approximate in a
falling market, and every qualified leg says so). Ordinary income lands in
other_w2_income, which raises the engine's FICA wage bases — sheet-faithful (its ESPP
component rolls into the W-2 total); real-world ESPP ordinary income is FICA-exempt and
the page hint carries that caveat.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
MONEY_Q = Decimal("0.01")
LONG_TERM_DAYS = 365
# subscription = 0.85 × lookback FMV, so 15% of the grant FMV is subscription × 15/85.
QUALIFIED_DISCOUNT_RATIO = Decimal(15) / Decimal(85)

DATELESS_TERM_WARNING = (
    "{ticker}: acquisition dates unknown — treated as long-term"
)
QUALIFIED_FMV_WARNING = (
    "lot {lot_id}: grant-date FMV approximated from the subscription price"
)

# delta kind -> (component key, engine total key). None = the engine reads it directly.
DELTA_KEYS: dict[str, tuple[str, str | None]] = {
    "brokerage_long": ("ltcg_brokerage", "ltcg_total"),
    "brokerage_short": ("stcg_standard", "stcg_total"),
    "espp_ordinary": ("w2_espp_sale_component", "other_w2_income"),
    "espp_long": ("ltcg_espp_component", "ltcg_total"),
    "espp_short": ("stcg_espp_component", "stcg_total"),
}


@dataclass
class SaleDetail:
    security_id: int
    ticker: str
    shares: Decimal
    price: Decimal
    proceeds: Decimal
    cost_basis: Decimal
    gain: Decimal
    term: str  # 'long' | 'short'
    warnings: list[str] = field(default_factory=list)


@dataclass
class EsppSaleDetail:
    lot_id: int
    purchase_date: date
    shares: Decimal
    sale_price: Decimal
    proceeds: Decimal
    ordinary_income: Decimal
    capital_gain: Decimal
    term: str  # 'long' | 'short'
    disposition: str  # 'qualified' | 'disqualified'
    warnings: list[str] = field(default_factory=list)


def classify_sale(
    *,
    security_id: int,
    ticker: str,
    shares: Decimal,
    price: Decimal,
    held_shares: Decimal,
    held_cost_basis: Decimal,
    has_dateless: bool,
    term: str | None,
) -> SaleDetail:
    """Average-cost classification (the app's only basis method). The caller has already
    validated shares/price positive and shares <= held_shares (422s are the router's)."""
    avg = held_cost_basis / held_shares if held_shares > 0 else ZERO
    basis = (shares * avg).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    proceeds = (shares * price).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    detail = SaleDetail(
        security_id=security_id,
        ticker=ticker,
        shares=shares,
        price=price,
        proceeds=proceeds,
        cost_basis=basis,
        gain=proceeds - basis,
        term=term or "long",
    )
    if term is None and has_dateless:
        detail.warnings.append(DATELESS_TERM_WARNING.format(ticker=ticker))
    return detail


def decompose_espp(
    *,
    lot_id: int,
    purchase_date: date,
    qualifying_date: date,
    shares: Decimal,
    subscription_price: Decimal,
    purchase_fmv: Decimal,
    purchase_price: Decimal,
    sale_price: Decimal,
    today: date,
) -> EsppSaleDetail:
    proceeds = (shares * sale_price).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    total_gain = (shares * (sale_price - purchase_price)).quantize(
        MONEY_Q, rounding=ROUND_HALF_UP
    )
    qualified = today >= qualifying_date
    warnings: list[str] = []
    if qualified:
        cap = (shares * subscription_price * QUALIFIED_DISCOUNT_RATIO).quantize(
            MONEY_Q, rounding=ROUND_HALF_UP
        )
        ordinary = min(total_gain, cap)
        if ordinary < 0:
            ordinary = ZERO  # a qualified LOSS has no ordinary component
        capital = total_gain - ordinary
        term = "long"  # a qualified disposition is >= 1y past purchase by definition
        warnings.append(QUALIFIED_FMV_WARNING.format(lot_id=lot_id))
    else:
        ordinary = (shares * (purchase_fmv - purchase_price)).quantize(
            MONEY_Q, rounding=ROUND_HALF_UP
        )
        capital = (shares * (sale_price - purchase_fmv)).quantize(
            MONEY_Q, rounding=ROUND_HALF_UP
        )
        term = "long" if (today - purchase_date).days > LONG_TERM_DAYS else "short"
    return EsppSaleDetail(
        lot_id=lot_id,
        purchase_date=purchase_date,
        shares=shares,
        sale_price=sale_price,
        proceeds=proceeds,
        ordinary_income=ordinary,
        capital_gain=capital,
        term=term,
        disposition="qualified" if qualified else "disqualified",
        warnings=warnings,
    )


def apply_scenario(
    stored: dict[str, Decimal],
    sales: list[SaleDetail],
    espp_sales: list[EsppSaleDetail],
    overrides: dict[str, Decimal | None],
) -> tuple[dict[str, Decimal], list[str]]:
    """(scenario inputs, aggregated warnings). Deltas first (component + engine total in
    lockstep), overrides last as replacements; a null override sets the key to 0 —
    'absent' semantics without churning the engine's missing-key warning."""
    scenario = dict(stored)

    def bump(kind: str, amount: Decimal) -> None:
        if amount == 0:
            return
        component, total = DELTA_KEYS[kind]
        scenario[component] = scenario.get(component, ZERO) + amount
        if total is not None:
            scenario[total] = scenario.get(total, ZERO) + amount

    warnings: list[str] = []
    for sale in sales:
        bump("brokerage_long" if sale.term == "long" else "brokerage_short", sale.gain)
        warnings.extend(sale.warnings)
    for lot in espp_sales:
        bump("espp_ordinary", lot.ordinary_income)
        bump("espp_long" if lot.term == "long" else "espp_short", lot.capital_gain)
        warnings.extend(lot.warnings)
    for key, value in overrides.items():
        scenario[key] = ZERO if value is None else value
    return scenario, warnings
```

- [x] **Step 2: Append the schemas** to `backend/app/schemas/taxes.py` (match the file's existing pydantic style; `TaxSummaryOut` already lives there):

```python
class SaleLegIn(BaseModel):
    security_id: int
    shares: Decimal
    price: Decimal | None = None  # None -> the security's latest price
    term: Literal["long", "short"] | None = None  # None -> 'long' (+ warning if dateless)


class EsppSaleIn(BaseModel):
    lot_id: int
    sale_price: Decimal | None = None  # None -> the ESPP ticker's latest quote


class WhatIfIn(BaseModel):
    year: int
    sales: list[SaleLegIn] = Field(default_factory=list, max_length=20)
    espp_sales: list[EsppSaleIn] = Field(default_factory=list, max_length=20)
    overrides: dict[str, Decimal | None] = Field(default_factory=dict)


class WhatIfDelta(BaseModel):
    total_tax: Decimal
    take_home: Decimal
    federal_tax: Decimal
    state_tax: Decimal
    medicare_tax: Decimal
    social_security_tax: Decimal
    disability_tax: Decimal
    capital_gains_tax: Decimal
    effective_rate: Decimal | None  # fraction delta; None when either side is None


class ChangedInput(BaseModel):
    key: str
    label: str
    before: Decimal  # 0 when the key was absent
    after: Decimal


class SaleDetailOut(BaseModel):
    security_id: int
    ticker: str
    shares: Decimal
    price: Decimal
    proceeds: Decimal
    cost_basis: Decimal
    gain: Decimal
    term: str
    warnings: list[str]


class EsppSaleDetailOut(BaseModel):
    lot_id: int
    purchase_date: date
    shares: Decimal
    sale_price: Decimal
    proceeds: Decimal
    ordinary_income: Decimal
    capital_gain: Decimal
    term: str
    disposition: str
    warnings: list[str]


class WhatIfOut(BaseModel):
    year: int
    baseline: TaxSummaryOut
    scenario: TaxSummaryOut
    delta: WhatIfDelta
    changed_inputs: list[ChangedInput]
    sale_details: list[SaleDetailOut]
    espp_sale_details: list[EsppSaleDetailOut]
    warnings: list[str]
```

(Add `Literal` / `Field` to the file's imports if absent.)

- [x] **Step 3: Unit tests** at `backend/tests/test_tax_whatif.py` — pure, no DB. Hand-computed, each its own test:

1. `test_classify_sale_average_cost` — held 100 sh / basis 5000 (avg 50), sell 40 @ 62.50 → proceeds 2500.00, basis 2000.00, gain 500.00, term 'long', no warnings when `has_dateless=False`.
2. `test_classify_sale_dateless_default_warns` — `term=None, has_dateless=True` → term 'long' + the warning; explicit `term='short'` → no warning.
3. `test_decompose_disqualified_gain` — purchase 2026-02-28, qualifying 2028-02-28, today 2026-08-20; shares 10, sub 100, fmv 120, purchase_price 85, sale 150 → ordinary (120−85)×10 = 350.00; capital (150−120)×10 = 300.00; term 'short' (173 days); disposition 'disqualified'.
4. `test_decompose_disqualified_long_term_boundary` — same lot, today = purchase_date + 366 days → term 'long'; + 365 days exactly → 'short'.
5. `test_decompose_disqualified_capital_loss` — sale 110 < fmv 120 → capital −100.00 (loss flows negative).
6. `test_decompose_qualified_clamped_by_discount` — today ≥ qualifying; sub 100, purchase_price 85, sale 150, shares 10 → cap = 10×100×15/85 = 176.47; total gain 650.00 → ordinary 176.47, capital 473.53, term 'long', FMV warning present.
7. `test_decompose_qualified_clamped_by_gain` — sale 90 → total gain 50.00 < cap → ordinary 50.00, capital 0.00.
8. `test_decompose_qualified_loss_has_no_ordinary` — sale 80 → total gain −50.00 → ordinary 0.00, capital −50.00.
9. `test_apply_scenario_dual_key_mapping` — one long sale gain 500 → `ltcg_brokerage` AND `ltcg_total` both +500 over stored; one espp short lot (ordinary 350, capital 300) → `w2_espp_sale_component`+350, `other_w2_income`+350, `stcg_espp_component`+300, `stcg_total`+300.
10. `test_apply_scenario_overrides_win_and_null_zeroes` — override on `ltcg_total` after a sale delta replaces it; `{"qualified_dividends": None}` lands ZERO.

- [x] **Step 4: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_whatif.py -q` → PASS. `ruff check .` clean.

- [x] **Step 5: Commit** — `git commit -am "feat: tax what-if scenario service — sale classification, ESPP decomposition, engine key mapping"`

---

### Task 2: The endpoint

**Files:**
- Modify: `backend/app/api/taxes.py` (new route + helpers; reuse `_summary_out`, `_stored_inputs`, `_require_year`)
- Test: `backend/tests/test_taxes_api.py` (extend)

- [ ] **Step 1: Add the route.** Read the whole of `api/taxes.py` first (the PUT-inputs handler shows the override-key validation vocabulary to reuse — unknown keys 422 with its exact wording, values quantized with its exact helper). Then append:

```python
@router.post("/what-if", response_model=WhatIfOut)
async def what_if(body: WhatIfIn, db: AsyncSession = Depends(get_db)) -> WhatIfOut:
    """Baseline vs scenario through the engine — NOTHING is stored. today is read here
    (paycheck.py's clock posture) for ESPP disposition dating."""
    year = body.year
    if not YEAR_MIN <= year <= YEAR_MAX:
        raise HTTPException(status_code=422, detail=YEAR_MESSAGE)
    await _require_year(db, year)
    today = date.today()

    stored = await _stored_inputs(db, year)
    bracket_rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    brackets: dict[str, list[Bracket]] = {}
    for row in bracket_rows:
        brackets.setdefault(row.jurisdiction, []).append((row.rate, row.threshold))

    # Overrides: the PUT-inputs vocabulary — unknown keys 422, values quantized 4dp.
    overrides: dict[str, Decimal | None] = {}
    for key, value in body.overrides.items():
        # Reuse the PUT handler's own known-key check and value quantizer VERBATIM
        # (extract a module-level helper if the PUT inlines them — one vocabulary).
        overrides[key] = _validated_input_value(key, value)

    # Brokerage legs: average-cost fold, summed per security across accounts.
    sale_details: list[SaleDetail] = []
    if body.sales:
        securities, txns, latest, _history, _dividends = await load_portfolio(
            db, with_history=False, with_dividends=False
        )
        folded = fold_transactions(txns)
        per_sec: dict[int, dict] = {}
        for pos in folded.values():
            agg = per_sec.setdefault(
                pos.security_id,
                {"shares": ZERO, "cost_basis": ZERO, "has_dateless": False},
            )
            agg["shares"] += pos.shares
            agg["cost_basis"] += pos.cost_basis
            agg["has_dateless"] = agg["has_dateless"] or pos.has_dateless_txn
        for leg in body.sales:
            security = securities.get(leg.security_id)
            if security is None:
                raise HTTPException(
                    status_code=404, detail=f"unknown security {leg.security_id}"
                )
            shares = quantize_shares(leg.shares, "shares")
            if shares <= 0:
                raise HTTPException(status_code=422, detail="shares must be positive")
            agg = per_sec.get(leg.security_id)
            held = agg["shares"].quantize(SHARE_Q, rounding=ROUND_HALF_UP) if agg else ZERO
            if shares > held:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"selling {shares} {security.ticker} — only {held} held"
                    ),
                )
            if leg.price is not None:
                price = quantize_price(leg.price, "price")
                if price <= 0:
                    raise HTTPException(status_code=422, detail="price must be positive")
            else:
                quote = latest.get(leg.security_id)
                if quote is None:
                    raise HTTPException(
                        status_code=422,
                        detail=f"no price for {security.ticker} — provide one",
                    )
                price = quote.price
            sale_details.append(
                classify_sale(
                    security_id=security.id,
                    ticker=security.ticker,
                    shares=shares,
                    price=price,
                    held_shares=agg["shares"],
                    held_cost_basis=agg["cost_basis"],
                    has_dateless=agg["has_dateless"],
                    term=leg.term,
                )
            )

    # ESPP legs.
    espp_details: list[EsppSaleDetail] = []
    if body.espp_sales:
        _ticker, quote_price, _quoted_at = await _espp_quote_for_whatif(db)
        for leg in body.espp_sales:
            lot = await db.get(EsppLot, leg.lot_id)
            if lot is None:
                raise HTTPException(status_code=404, detail=f"unknown lot {leg.lot_id}")
            if lot.sold_date is not None:
                raise HTTPException(status_code=409, detail=f"lot {leg.lot_id} already sold")
            if leg.sale_price is not None:
                sale_price = quantize_price(leg.sale_price, "sale_price")
                if sale_price <= 0:
                    raise HTTPException(
                        status_code=422, detail="sale_price must be positive"
                    )
            elif quote_price is not None:
                sale_price = quote_price
            else:
                raise HTTPException(
                    status_code=422,
                    detail="no ESPP quote available — provide a sale_price",
                )
            espp_details.append(
                decompose_espp(
                    lot_id=lot.id,
                    purchase_date=lot.purchase_date,
                    qualifying_date=lot.qualifying_date,
                    shares=lot.shares,
                    subscription_price=lot.subscription_price,
                    purchase_fmv=lot.purchase_fmv,
                    purchase_price=lot.purchase_price,
                    sale_price=sale_price,
                    today=today,
                )
            )

    scenario_inputs, scenario_warnings = apply_scenario(
        stored, sale_details, espp_details, overrides
    )
    baseline = _summary_out(compute_breakdown(year, stored, brackets))
    scenario = _summary_out(compute_breakdown(year, scenario_inputs, brackets))

    changed: list[ChangedInput] = []
    labels = {key: label for key, label, _s, _o, _d in TAX_INPUT_DEFINITIONS}
    for key in sorted(set(stored) | set(scenario_inputs)):
        before = stored.get(key, ZERO)
        after = scenario_inputs.get(key, ZERO)
        if before != after:
            changed.append(
                ChangedInput(
                    key=key,
                    label=labels.get(key, key),
                    before=_money(before),
                    after=_money(after),
                )
            )

    def rate_delta(a: Decimal | None, b: Decimal | None) -> Decimal | None:
        return None if a is None or b is None else quantize_pct(a - b)

    delta = WhatIfDelta(
        total_tax=scenario.totals.total_tax - baseline.totals.total_tax,
        take_home=scenario.totals.take_home - baseline.totals.take_home,
        federal_tax=scenario.federal.tax - baseline.federal.tax,
        state_tax=scenario.state.tax - baseline.state.tax,
        medicare_tax=scenario.medicare.tax - baseline.medicare.tax,
        social_security_tax=scenario.social_security.tax - baseline.social_security.tax,
        disability_tax=scenario.disability.tax - baseline.disability.tax,
        capital_gains_tax=scenario.capital_gains.tax - baseline.capital_gains.tax,
        effective_rate=rate_delta(
            scenario.totals.effective_rate, baseline.totals.effective_rate
        ),
    )
    return WhatIfOut(
        year=year,
        baseline=baseline,
        scenario=scenario,
        delta=delta,
        changed_inputs=changed,
        sale_details=[SaleDetailOut(**vars(d)) for d in sale_details],
        espp_sale_details=[EsppSaleDetailOut(**vars(d)) for d in espp_details],
        warnings=scenario_warnings,
    )
```

Notes for the implementer: (a) `_espp_quote_for_whatif` — `api/espp.py` already has `_espp_quote(db)`; import it (rename nothing) rather than duplicating; if importing across routers is unprecedented in this repo, lift `_espp_quote` into a small shared helper module instead and update espp.py — pick whichever the codebase's precedent supports (check how routers share `money.py` helpers). (b) `_validated_input_value` — extract from the PUT-inputs handler if inline; identical wording. (c) Imports needed: `load_portfolio`, `fold_transactions`, `SHARE_Q` from portfolio_calc; `quantize_shares`, `quantize_price` from money (verify exact names in `services/money.py` — if `quantize_shares` doesn't exist, use the module's actual share quantizer); `EsppLot` model; the whatif service; new schemas; `TAX_INPUT_DEFINITIONS`. (d) `YEAR_MESSAGE`/`YEAR_MIN`/`YEAR_MAX` already exist in the file — reuse.

- [ ] **Step 2: API tests** in `backend/tests/test_taxes_api.py` (follow its `auth_client` fixture idioms; seed inputs/brackets like the summary tests do):

1. `test_what_if_empty_scenario_echoes_baseline` — seeded year: `scenario == baseline` field-for-field, all deltas "0.00", `changed_inputs == []`.
2. `test_what_if_long_sale_moves_ltcg_and_delta` — seed a security + dateless buy (100 sh @ 50) + latest price 62.50 + a year with real brackets; sell 40 (price defaulted) → `changed_inputs` carries ltcg_brokerage AND ltcg_total (+500.00 each); `delta.total_tax == scenario − baseline` recomputed in-test; the dateless warning present.
3. `test_what_if_espp_disqualified_hits_w2_and_fica` — seeded lot + explicit sale_price → `other_w2_income` moved; `delta.medicare_tax > 0` (sheet-faithful FICA movement).
4. `test_what_if_oversell_422`, `test_what_if_unknown_security_404`, `test_what_if_sold_lot_409`, `test_what_if_unknown_override_key_422`, `test_what_if_year_404`.
5. `test_what_if_writes_nothing` — after a full scenario call, `tax_inputs` rows for the year are byte-identical to what was seeded.

- [ ] **Step 3: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_whatif.py tests/test_taxes_api.py -q` → PASS; `ruff check .` clean; full backend suite once green.

- [ ] **Step 4: Commit** — `git commit -am "feat: POST /taxes/what-if — baseline vs scenario vs delta through the engine, nothing stored"`

---

### Task 3: Frontend client + types

**Files:**
- Create: `src/api/whatif.ts`
- Modify: `src/types/api.ts`

- [ ] **Step 1: Types** — mirror the wire schemas exactly (Decimals as strings, dates as strings):

```ts
export interface SaleLegIn {
  security_id: number
  shares: string
  price?: string
  term?: 'long' | 'short'
}

export interface EsppSaleIn {
  lot_id: number
  sale_price?: string
}

export interface WhatIfDelta {
  total_tax: string
  take_home: string
  federal_tax: string
  state_tax: string
  medicare_tax: string
  social_security_tax: string
  disability_tax: string
  capital_gains_tax: string
  effective_rate: string | null
}

export interface ChangedInput {
  key: string
  label: string
  before: string
  after: string
}

export interface SaleDetailOut {
  security_id: number
  ticker: string
  shares: string
  price: string
  proceeds: string
  cost_basis: string
  gain: string
  term: string
  warnings: string[]
}

export interface EsppSaleDetailOut {
  lot_id: number
  purchase_date: string
  shares: string
  sale_price: string
  proceeds: string
  ordinary_income: string
  capital_gain: string
  term: string
  disposition: string
  warnings: string[]
}

export interface WhatIfOut {
  year: number
  baseline: TaxSummaryOut
  scenario: TaxSummaryOut
  delta: WhatIfDelta
  changed_inputs: ChangedInput[]
  sale_details: SaleDetailOut[]
  espp_sale_details: EsppSaleDetailOut[]
  warnings: string[]
}
```

- [ ] **Step 2: Client** at `src/api/whatif.ts`:

```ts
import type { EsppSaleIn, SaleLegIn, WhatIfOut } from '../types/api'
import { api } from './client'

export interface WhatIfBody {
  year: number
  sales: SaleLegIn[]
  espp_sales: EsppSaleIn[]
  overrides?: Record<string, string | null>
}

export function runWhatIf(body: WhatIfBody): Promise<WhatIfOut> {
  return api<WhatIfOut>('/taxes/what-if', { method: 'POST', body: JSON.stringify(body) })
}
```

- [ ] **Step 3: Commit** — `git commit -am "feat: what-if API client + wire types"`

---

### Task 4: WhatIfPanel + TaxesPage wiring

**Files:**
- Create: `src/components/taxes/WhatIfPanel.tsx`
- Modify: `src/components/taxes/taxes.css` (panel form rows)
- Modify: `src/pages/TaxesPage.tsx` (render under SummaryPanel)
- Test: `src/components/taxes/WhatIfPanel.test.tsx` (new)

- [ ] **Step 1: The panel.** House idioms bind: promise callbacks (no setState in effect bodies), seqRef guard on the run, `role="alert"` errors with server sentences verbatim, advisory warnings in the amber register, server figures rendered verbatim, EChart-free (this card is tiles + tables). Structure (write the full component; abbreviated JSX contracts below are binding):

```tsx
export default function WhatIfPanel({ year }: { year: number }) {
  // Feeds load LAZILY on first open (the page is long; two GETs the user may never use).
  const [open, setOpen] = useState(false)
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null)
  const [lots, setLots] = useState<EsppLotsResponse | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [legs, setLegs] = useState<SaleLegForm[]>([])
  const [esppLegs, setEsppLegs] = useState<EsppLegForm[]>([])
  const [result, setResult] = useState<WhatIfOut | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  ...
}
```

- `SaleLegForm = { securityId: string; shares: string; price: string; term: 'long' | 'short' }`;
  `EsppLegForm = { lotId: string; salePrice: string }` — strings as typed, converted at
  submit (blank price = omit, the projection page's blank-omit convention).
- "Add sale" prefills the FIRST held security not already in a leg: shares = its full
  `holding.shares`, price = `holding.price ?? ''`; the security `<select>` lists held
  tickers. "Add ESPP sale" prefills the first unsold lot; the select labels lots
  `"{formatDate(purchase_date)} — {formatShares(shares)} sh"`.
- Run: client fences in the box's vocabulary (shares > 0 and ≤ held — the oversell 422
  is the server's, but the obvious case refuses locally; price blank or > 0), then
  `runWhatIf({year, sales, espp_sales})` with seq guard; a year switch (prop change)
  clears `result` via `useEffect` keyed on `year` (a stale scenario under a new year's
  heading would lie) — set state only in promise/effect-callback positions per house
  rules (clearing on prop change: use a `key={year}` remount from the PAGE instead of an
  effect — simpler and matches the editors' keying pattern; do that).
- Result block: three delta tiles (`Δ total tax` with tone — MORE tax is negative tone;
  `Δ take-home` tone positive-up; `Effective rate` shown as
  `before → after`), the two detail tables, changed-inputs list
  (`{label}: {before} → {after}`), warnings in `.tax-warnings`.
- The card renders closed as `<section className="card">` with an "Open what-if" button
  (aria-expanded), NOT a native `<details>` (house segmented/button idiom + testability).

- [ ] **Step 2: TaxesPage wiring** — under `<SummaryPanel …/>` inside the `detail !== null` block:

```tsx
          <WhatIfPanel key={`whatif-${detail.summary.year}`} year={detail.summary.year} />
```

(Keyed by year: a year switch remounts — fresh legs, no stale scenario; same-year
reloads leave typed legs alone. Mirrors the editors' keying comment.)

- [ ] **Step 3: CSS** — add to `taxes.css` a `.whatif-form` grid in the file's existing
  form-row vocabulary (copy `.new-year-form`'s row treatment; do not invent new spacing).

- [ ] **Step 4: Tests** (`WhatIfPanel.test.tsx`, mock `../../api/whatif` + portfolio/espp
  clients like TaxesPage.test.tsx mocks its api modules): opens lazily (no fetch before
  the open click; both feeds after); add-sale prefills from holdings; run posts the
  typed body (blank price omitted) and renders delta tiles + changed-inputs verbatim;
  server 422 renders verbatim in `role="alert"`; warnings render in the advisory
  register not the banner; a second run's stale first response never lands (seq guard);
  year-key remount clears the scenario (render with new key).

- [ ] **Step 5: Run** `npm run test && npm run lint && npm run build` → green.

- [ ] **Step 6: Commit** — `git commit -am "feat: what-if panel on /taxes — sale legs, ESPP legs, delta tiles"`

---

### Task 5: Deep links

**Files:**
- Modify: `src/components/portfolio/HoldingDetailPanel.tsx` (link under the facts dl)
- Modify: `src/pages/EsppPage.tsx` (per-unsold-lot link in the lots table)
- Modify: `src/components/taxes/WhatIfPanel.tsx` + `src/pages/TaxesPage.tsx` (read the params)
- Test: extend `HoldingDetailPanel.test.tsx`, `EsppPage.test.tsx`, `WhatIfPanel.test.tsx`

- [ ] **Step 1: Emit links.** HoldingDetailPanel, after the XIRR hint block:

```tsx
      <p className="hint">
        <Link to={`/taxes?whatif=${encodeURIComponent(holding.ticker)}`}>
          Model selling {holding.ticker} in Taxes →
        </Link>
      </p>
```

EsppPage lots table row actions (unsold rows only): `<Link className="button" to={`/taxes?whatif-lot=${lot.id}`}>Model sale →</Link>` (match the row-actions button sizing; import Link).

- [ ] **Step 2: Consume them.** WhatIfPanel gains optional props `initialTicker?: string | null` and `initialLotId?: number | null`; when either is non-null the panel mounts OPEN, loads feeds, and seeds one leg once the feed lands (ticker → matching holding's prefill; lot id → matching unsold lot). TaxesPage reads `useSearchParams()` once per mount and passes them through; it does NOT clear the params (a reload re-seeding the same leg is honest).

- [ ] **Step 3: Tests** — the links render (holding panel; unsold lot rows only), and WhatIfPanel with `initialTicker` auto-opens + seeds the leg after the mocked feed resolves.

- [ ] **Step 4: Run gates; commit** — `git commit -am "feat: what-if deep links from holdings and ESPP lots"`

---

### Task 6: Whole-feature gate

- [ ] **Step 1:** `cd backend && .venv/Scripts/python.exe -m pytest -q` → all green; `ruff check .`; `alembic check` (head unmoved).
- [ ] **Step 2:** `npm run test && npm run lint && npm run build` → green.
- [ ] **Step 3:** Tick all plan checkboxes; commit any stragglers — `git commit -am "chore: what-if feature gate green"`.

---

## Self-review notes (spec → plan)

- Spec §2 request/validation/response → Tasks 1 (schemas) + 2 (route, 404/409/422s, delta from quantized summaries, `_summary_out` reuse).
- Spec §3 classification → Task 1 `classify_sale` + tests 1-2; oversell 422 in Task 2.
- Spec §4 ESPP math → Task 1 `decompose_espp` + tests 3-8 (both clamps, both terms, loss branches, FMV warning).
- Spec §5 key mapping → Task 1 `DELTA_KEYS` + test 9; FICA movement pinned in Task 2 test 3.
- Spec §7 frontend → Tasks 3-5 (panel, lazy feeds, keyed remount, deep links; overrides UI deliberately absent).
- Nothing-stored → Task 2 test 5.
- Type consistency: `SaleDetail`/`SaleDetailOut` field names match 1:1 (constructed via `vars()`); `WhatIfBody` mirrors `WhatIfIn`; panel props (`year`, `initialTicker`, `initialLotId`) consistent across Tasks 4-5.
