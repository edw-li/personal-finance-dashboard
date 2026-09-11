"""What-if scenario math over the tax engine's input vocabulary.

Pure module — no DB, no HTTP (tax_service's posture). Every scenario delta lands on ONE
key, the COMPONENT (2026-09-11 spec §1.4): the totals the engine reads are computed from
the components now, so a sale that also bumped `ltcg_total` would either be discarded (the
engine rebuilds it) or, worse, read as a figure some other reader could trust. One leg, one
row, exactly the row the user would have typed. Overrides apply LAST, as absolute
replacements, so an override of a key a sale also touched wins (the response's
changed_inputs makes that visible); an override OF a computed total is a 422 upstream.

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


def first_anniversary(purchase: date) -> date:
    """The purchase date's first anniversary.

    February 29 has no anniversary in a non-leap year; the decision (2026-09-09 spec 4i) is
    March 1, which is also where the IRS's "the day after the anniversary" counting lands.
    """
    try:
        return purchase.replace(year=purchase.year + 1)
    except ValueError:
        return date(purchase.year + 1, 3, 1)


def is_long_term(purchase: date, sale: date) -> bool:
    """Long-term when the sale is STRICTLY AFTER the first anniversary (2026-09-09 spec 4i).

    This was `(sale - purchase).days > 365`, which is the right answer only when the
    holding period misses February 29: a lot bought 2027-03-01 and sold 2028-03-01 is 366
    days old and was called long-term, though it had been held exactly one year to the day
    and the statute wants one year AND a day. A calendar rule cannot drift with the
    calendar.
    """
    return sale > first_anniversary(purchase)


def qualified_discount_ratio(discount: Decimal) -> Decimal:
    """subscription = (1 - d) x the lookback FMV, so d of the grant FMV is sub x d/(1 - d).
    `discount` is bounded to [0, 0.15] by the setting's writer AND its reader, so the
    denominator can never reach zero."""
    return discount / (Decimal("1") - discount)


DATELESS_TERM_WARNING = "{ticker}: acquisition dates unknown — treated as long-term"
QUALIFIED_FMV_WARNING = "lot {lot_id}: grant-date FMV approximated from the subscription price"

# delta kind -> the COMPONENT key it moves. The total each one rolls up into is the
# engine's business (tax_service.materialize_*), which is why it is not named here.
DELTA_KEYS: dict[str, str] = {
    "brokerage_long": "ltcg_brokerage",
    "brokerage_short": "stcg_standard",
    "espp_ordinary": "w2_espp_sale_component",
    "espp_long": "ltcg_espp_component",
    "espp_short": "stcg_espp_component",
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
    discount: Decimal,
) -> EsppSaleDetail:
    proceeds = (shares * sale_price).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    total_gain = (shares * (sale_price - purchase_price)).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    qualified = today >= qualifying_date
    warnings: list[str] = []
    if qualified:
        cap = (shares * subscription_price * qualified_discount_ratio(discount)).quantize(
            MONEY_Q, rounding=ROUND_HALF_UP
        )
        ordinary = min(total_gain, cap)
        if ordinary < 0:
            # A qualified LOSS has no ordinary component. Cents-exponent zero, not the
            # module's raw ZERO: this figure serializes verbatim, and "0" beside a column
            # of "x.xx" strings would be the one odd cell (Tasks 1-2 review note).
            ordinary = ZERO.quantize(MONEY_Q)
        capital = total_gain - ordinary
        term = "long"  # a qualified disposition is >= 1y past purchase by definition
        warnings.append(QUALIFIED_FMV_WARNING.format(lot_id=lot_id))
    else:
        ordinary = (shares * (purchase_fmv - purchase_price)).quantize(
            MONEY_Q, rounding=ROUND_HALF_UP
        )
        capital = (shares * (sale_price - purchase_fmv)).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
        term = "long" if is_long_term(purchase_date, today) else "short"
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
    """(scenario inputs, aggregated warnings). Deltas first (one component per leg),
    overrides last as replacements; a null override sets the key to 0 — 'absent' semantics
    without churning the engine's missing-key warning.

    The totals in `stored` ride along untouched and stale, which is safe and deliberate:
    `compute_breakdown` rebuilds every one of them from the components this function just
    moved, so the scenario's tax follows the leg without this module owning a formula.
    """
    scenario = dict(stored)

    def bump(kind: str, amount: Decimal) -> None:
        if amount == 0:
            return
        component = DELTA_KEYS[kind]
        scenario[component] = scenario.get(component, ZERO) + amount

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
