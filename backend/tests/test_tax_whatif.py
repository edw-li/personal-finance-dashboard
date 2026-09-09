"""Pure what-if scenario math: sale classification, ESPP decomposition, key mapping.

No DB, no HTTP — the service is `tax_service`'s posture, so every figure below is
hand-computed from the spec's formulas (§3, §4, §5) and pinned as an exact Decimal.
`today` is a parameter, never a clock read, so nothing here depends on the day the suite
runs; only the router reads the clock (`clock.product_today()`).

The dual-key assertions in the last two tests are the load-bearing ones: the engine reads
the TOTAL keys, so a delta that moved only its component key would compute a scenario
identical to the baseline and the whole feature would silently answer "no change".
"""

from datetime import date, timedelta
from decimal import Decimal

from app.services.tax_whatif import (
    DATELESS_TERM_WARNING,
    QUALIFIED_FMV_WARNING,
    ZERO,
    EsppSaleDetail,
    SaleDetail,
    apply_scenario,
    classify_sale,
    decompose_espp,
    first_anniversary,
    is_long_term,
)

D = Decimal

PURCHASE = date(2026, 2, 28)
QUALIFYING = date(2028, 2, 28)  # the stored lot already encodes the 2y/1y rule
TODAY = date(2026, 8, 20)  # 173 days past purchase: disqualified, short-term


def espp(
    *,
    sale_price: str,
    today: date = TODAY,
    purchase_date: date = PURCHASE,
    shares: str = "10",
    subscription_price: str = "100",
    purchase_fmv: str = "120",
    purchase_price: str = "85",
    discount: str = "0.15",
) -> EsppSaleDetail:
    """One lot's decomposition. Defaults are the spec's worked example, the 15 % plan."""
    return decompose_espp(
        lot_id=7,
        purchase_date=purchase_date,
        # Two years past the purchase, the way a stored lot encodes the 2y/1y rule.
        qualifying_date=purchase_date.replace(year=purchase_date.year + 2),
        shares=D(shares),
        subscription_price=D(subscription_price),
        purchase_fmv=D(purchase_fmv),
        purchase_price=D(purchase_price),
        sale_price=D(sale_price),
        today=today,
        discount=D(discount),
    )


# --- brokerage classification ---


def test_classify_sale_average_cost():
    """avg = 5000 / 100 = 50; 40 shares out at 62.50 realize 500.00 of gain."""
    detail = classify_sale(
        security_id=12,
        ticker="NVDA",
        shares=D("40"),
        price=D("62.50"),
        held_shares=D("100"),
        held_cost_basis=D("5000"),
        has_dateless=False,
        term=None,
    )
    assert str(detail.proceeds) == "2500.00"
    assert str(detail.cost_basis) == "2000.00"
    assert str(detail.gain) == "500.00"
    assert detail.term == "long"  # the default, and no warning without dateless rows
    assert detail.warnings == []
    assert (detail.security_id, detail.ticker) == (12, "NVDA")


def test_classify_sale_dateless_default_warns():
    """The imported book has no acquisition dates, so the default term is an ASSUMPTION —
    it says so. An explicit term is the user's own word and never warns."""
    defaulted = classify_sale(
        security_id=12,
        ticker="NVDA",
        shares=D("40"),
        price=D("62.50"),
        held_shares=D("100"),
        held_cost_basis=D("5000"),
        has_dateless=True,
        term=None,
    )
    assert defaulted.term == "long"
    assert defaulted.warnings == [DATELESS_TERM_WARNING.format(ticker="NVDA")]
    assert defaulted.warnings == ["NVDA: acquisition dates unknown — treated as long-term"]

    stated = classify_sale(
        security_id=12,
        ticker="NVDA",
        shares=D("40"),
        price=D("62.50"),
        held_shares=D("100"),
        held_cost_basis=D("5000"),
        has_dateless=True,
        term="short",
    )
    assert stated.term == "short"
    assert stated.warnings == []


# --- ESPP decomposition ---


def test_decompose_disqualified_gain():
    """Bargain element at PURCHASE is the W-2 income; the rest is capital."""
    detail = espp(sale_price="150")
    assert detail.disposition == "disqualified"
    assert str(detail.ordinary_income) == "350.00"  # (120 - 85) x 10
    assert str(detail.capital_gain) == "300.00"  # (150 - 120) x 10
    assert str(detail.proceeds) == "1500.00"
    assert detail.term == "short"  # 173 days held
    assert detail.warnings == []  # the FMV caveat is the QUALIFIED branch's
    assert (detail.lot_id, detail.purchase_date) == (7, PURCHASE)


def test_decompose_disqualified_long_term_boundary():
    """One year AND a day: the anniversary itself is still short, the next day crosses.

    PURCHASE is 2026-02-28 and the year after it has no February 29, so day 365 IS the
    anniversary and these two pins read the same under the day count they were written for
    and the anniversary rule that replaced it (2026-09-09 spec 4i). The leap cases below
    are where the two disagree.
    """
    assert espp(sale_price="150", today=PURCHASE + timedelta(days=366)).term == "long"
    assert espp(sale_price="150", today=PURCHASE + timedelta(days=365)).term == "short"
    assert PURCHASE + timedelta(days=365) == first_anniversary(PURCHASE)
    # Both dates are still short of the qualifying date, so the branch is unchanged.
    assert espp(sale_price="150", today=PURCHASE + timedelta(days=366)).disposition == (
        "disqualified"
    )


def test_long_term_is_the_anniversary_not_a_day_count():
    """4i (2026-09-09 spec): GOLDEN MOVED where the holding period spans February 29.

    `(sale - purchase).days > 365` called a lot bought 2027-03-01 and sold 2028-03-01
    long-term, because 2028 is a leap year and the span is 366 days — but it had been held
    exactly one year to the day, and the statute wants one year and a day. The rule is a
    calendar one now, so it cannot drift with the calendar.
    """
    bought = date(2027, 3, 1)
    assert (date(2028, 3, 1) - bought).days == 366  # the day count that used to say "long"
    assert not is_long_term(bought, date(2028, 3, 1))
    assert is_long_term(bought, date(2028, 3, 2))
    # The ESPP decomposition reads the same rule.
    assert espp(sale_price="150", purchase_date=bought, today=date(2028, 3, 1)).term == "short"
    assert espp(sale_price="150", purchase_date=bought, today=date(2028, 3, 2)).term == "long"


def test_february_29_has_its_anniversary_on_march_1():
    """A leap-day purchase has no anniversary in a non-leap year; the decision is March 1,
    so the sale must be March 2 or later to be long-term."""
    leap_day = date(2028, 2, 29)
    assert first_anniversary(leap_day) == date(2029, 3, 1)
    assert not is_long_term(leap_day, date(2029, 2, 28))
    assert not is_long_term(leap_day, date(2029, 3, 1))
    assert is_long_term(leap_day, date(2029, 3, 2))
    # And a purchase whose anniversary year IS a leap year keeps its own date.
    assert first_anniversary(date(2027, 2, 28)) == date(2028, 2, 28)
    assert is_long_term(date(2027, 2, 28), date(2028, 2, 29))


def test_decompose_disqualified_capital_loss():
    """A sale below the purchase-date FMV is a capital LOSS, and it flows negative into
    the engine's netting — the ordinary bargain element is unaffected by it."""
    detail = espp(sale_price="110")
    assert str(detail.ordinary_income) == "350.00"
    assert str(detail.capital_gain) == "-100.00"  # (110 - 120) x 10


def test_decompose_qualified_clamped_by_discount():
    """cap = shares x subscription x 15/85 = 176.470588... -> 176.47 at cents."""
    detail = espp(sale_price="150", today=QUALIFYING)
    assert detail.disposition == "qualified"
    assert str(detail.ordinary_income) == "176.47"  # total gain 650.00 exceeds the cap
    assert str(detail.capital_gain) == "473.53"  # 650.00 - 176.47
    assert detail.term == "long"
    assert detail.warnings == [QUALIFIED_FMV_WARNING.format(lot_id=7)]
    assert detail.warnings == ["lot 7: grant-date FMV approximated from the subscription price"]


def test_decompose_qualified_clamped_by_gain():
    """The other end of the min(): a small gain is ordinary in full, nothing capital."""
    detail = espp(sale_price="90", today=QUALIFYING)
    assert str(detail.ordinary_income) == "50.00"  # (90 - 85) x 10, below the 176.47 cap
    assert str(detail.capital_gain) == "0.00"
    assert detail.term == "long"


def test_decompose_qualified_loss_has_no_ordinary():
    """A qualified LOSS has no bargain element to report: the clamp floors it at zero and
    the whole loss stays capital. The zero carries the CENTS exponent — this figure
    serializes verbatim into a column of "x.xx" strings (Tasks 1-2 review note)."""
    detail = espp(sale_price="80", today=QUALIFYING)
    assert detail.ordinary_income == ZERO
    assert str(detail.ordinary_income) == "0.00"
    assert str(detail.capital_gain) == "-50.00"  # (80 - 85) x 10


# --- key mapping ---


def test_apply_scenario_dual_key_mapping():
    """Every delta lands on BOTH the component key and the total the engine reads."""
    stored = {
        "ltcg_brokerage": D("1000.00"),
        "ltcg_total": D("1000.00"),
        "other_w2_income": D("2000.00"),
        "annual_salary": D("150000.00"),  # untouched by any leg
    }
    sale = SaleDetail(
        security_id=12,
        ticker="NVDA",
        shares=D("40"),
        price=D("62.50"),
        proceeds=D("2500.00"),
        cost_basis=D("2000.00"),
        gain=D("500.00"),
        term="long",
    )
    lot = EsppSaleDetail(
        lot_id=7,
        purchase_date=PURCHASE,
        shares=D("10"),
        sale_price=D("150"),
        proceeds=D("1500.00"),
        ordinary_income=D("350.00"),
        capital_gain=D("300.00"),
        term="short",
        disposition="disqualified",
    )

    scenario, warnings = apply_scenario(stored, [sale], [lot], {})

    assert str(scenario["ltcg_brokerage"]) == "1500.00"  # component += 500
    assert str(scenario["ltcg_total"]) == "1500.00"  # AND the engine's total
    assert str(scenario["w2_espp_sale_component"]) == "350.00"  # absent key starts at 0
    assert str(scenario["other_w2_income"]) == "2350.00"
    assert str(scenario["stcg_espp_component"]) == "300.00"
    assert str(scenario["stcg_total"]) == "300.00"
    assert scenario["annual_salary"] == D("150000.00")
    assert warnings == []
    assert stored["ltcg_total"] == D("1000.00")  # the caller's dict is never mutated


def test_apply_scenario_overrides_win_and_null_zeroes():
    """Overrides are absolute replacements applied LAST, so one lands on top of a key the
    sale delta just moved; a null override means "treat this key as absent" -> 0."""
    stored = {"ltcg_total": D("1000.00"), "qualified_dividends": D("719.81")}
    sale = SaleDetail(
        security_id=12,
        ticker="NVDA",
        shares=D("40"),
        price=D("62.50"),
        proceeds=D("2500.00"),
        cost_basis=D("2000.00"),
        gain=D("500.00"),
        term="long",
        warnings=["NVDA: acquisition dates unknown — treated as long-term"],
    )

    scenario, warnings = apply_scenario(
        stored,
        [sale],
        [],
        {"ltcg_total": D("42.00"), "qualified_dividends": None},
    )

    assert str(scenario["ltcg_total"]) == "42.00"  # the override, not 1500.00
    assert str(scenario["ltcg_brokerage"]) == "500.00"  # the component still carries it
    assert scenario["qualified_dividends"] == ZERO
    assert warnings == ["NVDA: acquisition dates unknown — treated as long-term"]


def test_qualified_ordinary_cap_follows_the_plan_discount():
    from app.services.tax_whatif import qualified_discount_ratio

    # subscription = (1 - d) x the lookback FMV, so d of the grant FMV is sub x d/(1 - d).
    assert qualified_discount_ratio(Decimal("0.15")) == Decimal(15) / Decimal(85)
    assert qualified_discount_ratio(Decimal("0.10")) == Decimal(10) / Decimal(90)
