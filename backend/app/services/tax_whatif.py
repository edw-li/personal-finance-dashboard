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
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
MONEY_Q = Decimal("0.01")
LONG_TERM_DAYS = 365
# subscription = 0.85 × lookback FMV, so 15% of the grant FMV is subscription × 15/85.
QUALIFIED_DISCOUNT_RATIO = Decimal(15) / Decimal(85)

DATELESS_TERM_WARNING = "{ticker}: acquisition dates unknown — treated as long-term"
QUALIFIED_FMV_WARNING = "lot {lot_id}: grant-date FMV approximated from the subscription price"

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
