"""Pure ESPP math: the chained 25k modeler and the lots table's computed columns.

The two-period chain is the Workbook reference golden (sub 170.79 / fmv 171.0 / carry 0
over the two real periods) and EVERY intermediate is pinned, not just the totals — the
chain's whole risk is that a single mis-rounded cent propagates through unused_25k and
carry_forward into the next period.

`lot_metrics` takes `today` as a parameter so nothing here depends on the day the suite
runs; only the endpoint reads `date.today()`.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.models import EsppLot
from app.services.espp_calc import (
    ANNUAL_LIMIT,
    OfferingInfo,
    RowPlan,
    StoredPeriod,
    ceil2,
    floor_int,
    half_up2,
    last_weekday_of,
    lot_metrics,
    plan_year_rows,
    position_totals,
    price5,
    running_avg_paid,
)
from app.services.espp_calc import (
    run_modeler as _run_modeler,
)

D = Decimal
DISCOUNT = D("0.15")


def run_modeler(rows, **kwargs):
    """Every golden in this file is the 15 % plan, so the discount is passed from ONE place;
    the parametrised test below hands its own in."""
    kwargs.setdefault("discount", DISCOUNT)
    return _run_modeler(rows, **kwargs)


# The sheet's what-if knobs, at the scale the router quantizes them to (5dp, the
# espp price family) — the modeler chain must land on the sheet's cents from these.
SUB = D("170.79000")
FMV = D("171.00000")


def period(
    id: int,
    label: str,
    base: str,
    pct: str,
    add: str = "0.00",
    start: date = date(2026, 1, 1),
    end: date = date(2026, 6, 30),
    sub: Decimal = SUB,
) -> RowPlan:
    """Column-scale values, as the router hands them over: base/add Numeric(12,2),
    contribution_pct Numeric(10,9). `sub` defaults to the golden's single price, so the
    chain tests below pin the same numbers they did before the price went per-row."""
    return RowPlan(
        period_id=id,
        stored=True,
        label=label,
        period_start=start,
        period_end=end,
        semi_annual_base=D(base),
        additional_payments=D(add),
        contribution_pct=D(pct),
        subscription_price=sub,
        offering_start=None,
    )


REAL_PERIODS = [
    period(1, "2026 H1", "81000.00", "0.140000000", end=date(2026, 2, 27)),
    period(2, "2026 H2", "94465.00", "0.110000000", end=date(2026, 8, 28)),
]


def lot(
    shares: str = "260.0000",
    purchase_price: str = "41.23265",
    purchase_date: date = date(2024, 2, 29),
    qualifying_date: date = date(2025, 9, 1),
    sold_date: date | None = None,
    sold_price: str | None = None,
    purchase_fmv: str = "79.11200",
) -> EsppLot:
    """A transient (never-flushed) ORM row at COLUMN scale: shares Numeric(12,4),
    prices Numeric(14,5). No session is involved — lot_metrics only reads attributes."""
    return EsppLot(
        id=1,
        purchase_date=purchase_date,
        qualifying_date=qualifying_date,
        shares=D(shares),
        subscription_price=D("48.50900"),
        purchase_fmv=D(purchase_fmv),
        purchase_price=D(purchase_price),
        sold_date=sold_date,
        sold_price=None if sold_price is None else D(sold_price),
        notes=None,
    )


# --- rounding helpers ---


def test_rounding_helpers_match_the_sheets_functions():
    # ROUNDUP(x, 2): the modeler's purchase price rounds AWAY from the employee.
    assert ceil2(D("145.1715")) == D("145.18")
    assert ceil2(D("145.18")) == D("145.18")  # an exact cent stays put
    assert ceil2(D("145.1701")) == D("145.18")
    # INT(): truncation toward -inf, never "round to nearest".
    assert floor_int(D("78.999")) == 78
    assert floor_int(D("78")) == 78
    # ROUND(x, 2)
    assert half_up2(D("10391.145")) == D("10391.15")
    assert half_up2(D("10720.489")) == D("10720.49")
    # Signed zeros never reach the wire (house law): quantizing a tiny negative keeps
    # the sign until `+ ZERO` collapses it.
    assert str(half_up2(D("-0.001"))) == "0.00"
    assert str(ceil2(D("-0.001"))) == "0.00"
    assert floor_int(D("-0.5")) == -1  # ROUND_FLOOR, not truncate-toward-zero


def test_annual_limit_is_the_25k_ceiling_at_money_scale():
    assert ANNUAL_LIMIT == D("25000")
    assert str(ANNUAL_LIMIT) == "25000.00"  # so the chained unused_25k stays 2dp


# --- the modeler chain ---


def test_two_period_golden_chain_pins_every_intermediate():
    result = run_modeler(REAL_PERIODS, purchase_fmv=FMV, carry_forward=D("0.00"))
    assert all(row.period.subscription_price == SUB for row in result.periods)
    assert result.purchase_fmv == FMV
    assert result.carry_forward == D("0.00")

    feb, aug = result.periods
    assert feb.period is REAL_PERIODS[0]
    assert feb.eligible_earnings == D("81000.00")
    assert feb.contribution == D("11340.00")
    assert feb.available == D("11340.00")
    assert feb.purchase_price == D("145.18")  # CEIL2(0.85 x 170.79 = 145.1715)
    assert feb.shares_before_limit == 78
    assert feb.unused_25k == D("25000.00")  # the limit at the START of the period
    assert feb.max_shares_25k == 146
    assert feb.over_limit is False
    assert feb.shares == 78
    assert feb.cost == D("11324.04")
    assert feb.carry_forward_out == D("15.96")
    assert feb.refund == D("0.00")
    assert feb.value_25k == D("13321.62")

    assert aug.period is REAL_PERIODS[1]
    assert aug.eligible_earnings == D("94465.00")
    assert aug.contribution == D("10391.15")
    assert aug.available == D("10407.11")  # 10391.15 + Feb's 15.96 carry
    assert aug.purchase_price == D("145.18")
    assert aug.shares_before_limit == 71
    assert aug.unused_25k == D("11678.38")  # 25000 - Feb's 13321.62
    assert aug.max_shares_25k == 68
    assert aug.over_limit is True
    assert aug.shares == 68  # capped by the 25k limit, not by cash
    assert aug.cost == D("9872.24")
    assert aug.carry_forward_out == D("0.00")  # over the limit: nothing carries
    assert aug.refund == D("534.87")  # ... the unspent cash comes back instead
    assert aug.value_25k == D("11613.72")

    assert result.totals.total_25k_value == D("24935.34")
    assert result.totals.out_of_pocket_cost == D("21196.28")
    assert result.totals.fmv_of_shares == D("24966.00")  # (78 + 68) x 171.00
    assert result.totals.remaining_25k == D("64.66")
    # 2026-09-07 spec §3.3: the meter's labels never sum on the client.
    assert result.totals.total_shares == 146  # 78 + 68
    assert result.totals.total_contribution == D("21731.15")  # 11340.00 + 10391.15
    assert result.totals.total_refund == D("534.87")  # only the capped August period refunds


def test_single_period_chain_and_the_carry_forward_seed():
    zero_carry = run_modeler(REAL_PERIODS[:1], purchase_fmv=FMV, carry_forward=D("0.00"))
    (only,) = zero_carry.periods
    assert only.available == D("11340.00")
    assert only.shares == 78
    assert only.carry_forward_out == D("15.96")
    assert zero_carry.totals.total_25k_value == D("13321.62")
    assert zero_carry.totals.out_of_pocket_cost == D("11324.04")
    assert zero_carry.totals.fmv_of_shares == D("13338.00")  # 78 x 171.00
    assert zero_carry.totals.remaining_25k == D("11678.38")

    # The seed carry is spendable cash in the FIRST period and nowhere else.
    seeded = run_modeler(REAL_PERIODS[:1], purchase_fmv=FMV, carry_forward=D("100.00"))
    (funded,) = seeded.periods
    assert funded.available == D("11440.00")
    assert funded.shares == 78  # 79 shares would cost 11469.22 — still short
    assert funded.carry_forward_out == D("115.96")
    assert seeded.totals == zero_carry.totals  # ... so the year's totals do not move


def test_three_period_chain_decrements_unused_25k_cumulatively():
    periods = [
        period(10, "P1", "10000.00", "0.100000000", end=date(2026, 3, 31), sub=D("100.00000")),
        period(11, "P2", "10000.00", "0.100000000", end=date(2026, 7, 31), sub=D("100.00000")),
        period(12, "P3", "10000.00", "0.100000000", end=date(2026, 11, 30), sub=D("100.00000")),
    ]
    result = run_modeler(periods, purchase_fmv=D("100.00000"), carry_forward=D("0.00"))
    p1, p2, p3 = result.periods
    assert [p.unused_25k for p in result.periods] == [
        D("25000.00"),
        D("23900.00"),  # - p1.value_25k
        D("22700.00"),  # - p2.value_25k
    ]
    assert [p.value_25k for p in result.periods] == [D("1100.00"), D("1200.00"), D("1200.00")]
    assert [p.max_shares_25k for p in result.periods] == [250, 239, 227]
    # Unspent cash rolls forward and buys the extra share the next period.
    assert [p.available for p in result.periods] == [D("1000.00"), D("1065.00"), D("1045.00")]
    assert [p.carry_forward_out for p in result.periods] == [D("65.00"), D("45.00"), D("25.00")]
    assert [p.shares for p in result.periods] == [11, 12, 12]
    assert p1.purchase_price == D("85.00") and p2.purchase_price == D("85.00")
    assert p3.over_limit is False
    assert result.totals.total_25k_value == D("3500.00")
    assert result.totals.out_of_pocket_cost == D("2975.00")
    assert result.totals.fmv_of_shares == D("3500.00")  # 35 shares x 100.00
    assert result.totals.remaining_25k == D("21500.00")
    # remaining_25k is the tail of the same chain the periods walked.
    assert result.totals.remaining_25k == p3.unused_25k - p3.value_25k


def test_over_limit_branch_swaps_carry_forward_for_a_refund():
    result = run_modeler(
        [period(20, "rich", "400000.00", "0.100000000", sub=D("100.00000"))],
        purchase_fmv=D("100.00000"),
        carry_forward=D("0.00"),
    )
    (row,) = result.periods
    assert row.available == D("40000.00")
    assert row.shares_before_limit == 470  # what the cash alone would buy
    assert row.max_shares_25k == 250  # ... what the 25k limit allows
    assert row.over_limit is True
    assert row.shares == 250
    assert row.cost == D("21250.00")
    assert row.refund == D("18750.00")  # 40000.00 - 21250.00
    assert row.carry_forward_out == D("0.00")
    assert result.totals.remaining_25k == D("0.00")


def test_over_limit_triggers_on_equality_not_strict_excess():
    # shares_before_limit == max_shares_25k: the sheet's `>=` still refunds the change
    # instead of carrying it (a `>` here would report carry 50.00 / refund 0.00).
    result = run_modeler(
        [period(21, "exact", "213000.00", "0.100000000", sub=D("100.00000"))],
        purchase_fmv=D("100.00000"),
        carry_forward=D("0.00"),
    )
    (row,) = result.periods
    assert row.shares_before_limit == row.max_shares_25k == 250
    assert row.over_limit is True
    assert row.shares == 250
    assert row.refund == D("50.00")
    assert row.carry_forward_out == D("0.00")


def test_an_over_limit_period_refunds_its_change_instead_of_funding_the_next_one():
    # The one shape that tells `carry_forward_out` and the CHAINED carry apart: if the
    # loop kept feeding `available - cost` forward regardless of the branch, the refund
    # would be spent twice — once back to the employee, once in the next period.
    result = run_modeler(
        [
            period(40, "over", "100000.00", "0.500000000", end=date(2026, 3, 31), sub=D("100")),
            period(41, "after", "10000.00", "0.100000000", end=date(2026, 9, 30), sub=D("100")),
        ],
        purchase_fmv=D("100.00000"),
        carry_forward=D("0.00"),
    )
    over, after = result.periods
    assert over.available == D("50000.00")
    assert over.shares_before_limit == 588 and over.max_shares_25k == 250
    assert over.over_limit is True
    assert over.shares == 250
    assert over.cost == D("21250.00")
    assert over.refund == D("28750.00")
    assert over.carry_forward_out == D("0.00")
    assert over.value_25k == D("25000.00")

    # The whole point: 1000.00 of fresh contribution and NOT a cent of the 28750 refund
    # (a leaking chain would report 29750.00 here).
    assert after.available == D("1000.00")
    assert after.unused_25k == D("0.00")  # the limit is spent, so nothing may be bought
    assert after.max_shares_25k == 0
    assert after.shares_before_limit == 11  # the cash alone would buy 11
    assert after.over_limit is True
    assert after.shares == 0
    assert after.cost == D("0.00")
    assert after.refund == D("1000.00")  # ... so all of it comes straight back
    assert after.carry_forward_out == D("0.00")
    assert after.value_25k == D("0.00")
    assert result.totals.out_of_pocket_cost == D("21250.00")
    assert result.totals.remaining_25k == D("0.00")


def test_purchase_price_takes_the_lower_of_subscription_and_fmv():
    lower_fmv = run_modeler(REAL_PERIODS[:1], purchase_fmv=D("100.00000"), carry_forward=D("0.00"))
    assert lower_fmv.periods[0].purchase_price == D("85.00")  # CEIL2(0.85 x 100)
    # ... while the 25k valuation always runs on the SUBSCRIPTION price.
    assert lower_fmv.periods[0].max_shares_25k == 146


def test_additional_payments_join_eligible_earnings():
    result = run_modeler(
        [period(30, "bonus", "81000.00", "0.140000000", add="9000.00")],
        purchase_fmv=FMV,
        carry_forward=D("0.00"),
    )
    (row,) = result.periods
    assert row.eligible_earnings == D("90000.00")
    assert row.contribution == D("12600.00")


def test_empty_period_list_models_an_untouched_year():
    result = run_modeler([], purchase_fmv=FMV, carry_forward=D("0.00"))
    assert result.periods == []
    assert result.totals.total_25k_value == D("0.00")
    assert result.totals.out_of_pocket_cost == D("0.00")
    assert result.totals.fmv_of_shares == D("0.00")
    assert result.totals.remaining_25k == D("25000.00")


def _plan(
    label: str,
    start: date,
    end: date,
    sub: str,
    base: str = "60000",
    additional: str = "0",
    pct: str = "0.140000000",
) -> RowPlan:
    """A planned row carrying its OWN subscription price — what the planner hands the
    modeler once offerings resolve per period."""
    return RowPlan(
        period_id=None,
        stored=False,
        label=label,
        period_start=start,
        period_end=end,
        semi_annual_base=D(base),
        additional_payments=D(additional),
        contribution_pct=D(pct),
        subscription_price=D(sub),
        offering_start=None,
    )


def test_run_modeler_prices_each_period_at_its_own_subscription():
    rows = [
        _plan("H1", date(2025, 9, 1), date(2026, 2, 27), "48.509"),
        _plan("H2", date(2026, 3, 1), date(2026, 8, 31), "120"),
    ]
    result = run_modeler(rows, purchase_fmv=D("180"), carry_forward=D("0"))
    # 0.85 x min(sub, fmv), ROUNDUP to a cent — per row now.
    assert result.periods[0].purchase_price == D("41.24")  # ceil2(0.85*48.509)
    assert result.periods[1].purchase_price == D("102.00")  # ceil2(0.85*120)
    # The 25k cap is valued at each period's OWN subscription price.
    assert result.periods[0].max_shares_25k == 515  # floor(25000/48.509)
    remaining = D("25000.00") - result.periods[0].value_25k
    assert result.periods[1].max_shares_25k == int(remaining / D("120"))
    # value_25k = shares x that period's subscription price (half_up2'd).
    assert result.periods[0].value_25k == half_up2(D(result.periods[0].shares) * D("48.509"))


def test_run_modeler_uniform_subscription_matches_the_old_single_knob_chain():
    """Back-compat pin (spec §8): all-same-subscription rows reproduce the pre-offerings
    chain byte for byte."""
    rows = [
        _plan(
            "1H24",
            date(2023, 9, 1),
            date(2024, 2, 29),
            "170.79000",
            base="60000",
            pct="0.140000000",
        ),
        _plan(
            "2H24",
            date(2024, 3, 1),
            date(2024, 8, 30),
            "170.79000",
            base="60000",
            pct="0.140000000",
        ),
    ]
    result = run_modeler(rows, purchase_fmv=D("170.79000"), carry_forward=D("100.00"))
    purchase_price = result.periods[0].purchase_price
    assert purchase_price == D("145.18")  # ceil2(0.85 * 170.79)
    first = result.periods[0]
    assert first.contribution == D("8400.00")
    assert first.available == D("8500.00")
    assert first.shares == 58
    assert first.cost == D("8420.44")
    assert first.carry_forward_out == D("79.56")
    assert result.totals.remaining_25k == D("25000.00") - result.totals.total_25k_value


def test_run_modeler_refuses_an_unpriced_row():
    row = RowPlan(
        period_id=None,
        stored=False,
        label="H1",
        period_start=date(2025, 9, 1),
        period_end=date(2026, 2, 27),
        semi_annual_base=D("1"),
        additional_payments=D("0"),
        contribution_pct=D("0.1"),
        subscription_price=None,
        offering_start=None,
    )
    # The router 422s an unpriced row long before here, so reaching the modeler with one
    # is a programming error, not user data.
    with pytest.raises(ValueError, match="unpriced row"):
        run_modeler([row], purchase_fmv=D("1"), carry_forward=D("0"))


# --- lot metrics ---


def test_lot_metrics_priced_unsold_lot():
    metrics = lot_metrics(lot(), current_price=D("174.1800"), today=date(2026, 8, 16))
    assert metrics["cost_basis"] == D("10720.49")  # 260 x 41.23265 = 10720.489
    assert metrics["market_value"] == D("45286.80")
    assert metrics["gain_amount"] == D("34566.31")
    assert metrics["gain_pct"] == D("3.224322")  # (174.18 - 41.23265) / 41.23265, 6dp
    assert metrics["is_sold"] is False
    assert metrics["qualified"] is True  # today is well past 2025-09-01
    assert metrics["days_until_qualified"] == 0


def test_lot_metrics_counts_down_to_the_qualifying_date():
    metrics = lot_metrics(
        lot(qualifying_date=date(2026, 8, 29)),
        current_price=D("174.1800"),
        today=date(2026, 8, 16),
    )
    assert metrics["qualified"] is False
    assert metrics["days_until_qualified"] == 13


def test_lot_metrics_qualifies_on_the_boundary_day():
    metrics = lot_metrics(
        lot(qualifying_date=date(2026, 8, 16)),
        current_price=D("174.1800"),
        today=date(2026, 8, 16),
    )
    assert metrics["qualified"] is True  # `>=`, not `>`
    assert metrics["days_until_qualified"] == 0


def test_lot_metrics_nulls_market_fields_when_the_soft_link_dangles():
    metrics = lot_metrics(lot(), current_price=None, today=date(2026, 8, 16))
    assert metrics["cost_basis"] == D("10720.49")  # stored data still computes
    assert metrics["market_value"] is None
    assert metrics["gain_amount"] is None
    assert metrics["gain_pct"] is None
    assert metrics["qualified"] is True  # ... and so do the date-only fields
    assert metrics["days_until_qualified"] == 0


def test_lot_metrics_sold_lot_realizes_at_the_sold_price():
    metrics = lot_metrics(
        lot(sold_date=date(2026, 3, 1), sold_price="120.00000"),
        current_price=D("174.1800"),  # ignored: the position is gone
        today=date(2026, 8, 16),
    )
    assert metrics["is_sold"] is True
    assert metrics["market_value"] == D("31200.00")  # 260 x 120, not x 174.18
    assert metrics["gain_amount"] == D("20479.51")
    assert metrics["gain_pct"] == D("1.910315")
    assert metrics["days_until_qualified"] is None  # nothing left to wait for
    assert metrics["qualified"] is True  # sold_date 2026-03-01 >= 2025-09-01


def test_lot_metrics_sold_before_qualifying_is_a_disqualifying_disposition():
    metrics = lot_metrics(
        lot(qualifying_date=date(2026, 9, 1), sold_date=date(2026, 3, 1), sold_price="120.00000"),
        current_price=None,
        # today is past the qualifying date — the SALE was not, and the sale is what counts.
        today=date(2027, 1, 1),
    )
    assert metrics["qualified"] is False
    assert metrics["days_until_qualified"] is None


def test_lot_metrics_collapses_signed_zeros_on_the_wire_values():
    # A price a hair BELOW the purchase price: the 6dp quantize keeps the sign
    # (Decimal("-0.000000")) unless the writer collapses it.
    metrics = lot_metrics(
        lot(shares="1.0000"), current_price=D("41.23264"), today=date(2026, 8, 16)
    )
    assert str(metrics["gain_pct"]) == "0.000000"
    assert str(metrics["gain_amount"]) == "0.00"


def test_lot_metrics_degrades_rather_than_dividing_by_a_zero_purchase_price():
    # Not reachable through the API (purchase_price > 0), but a GET must never 500 on
    # whatever is already stored.
    metrics = lot_metrics(
        lot(purchase_price="0.00000"), current_price=D("174.1800"), today=date(2026, 8, 16)
    )
    assert metrics["cost_basis"] == D("0.00")
    assert metrics["market_value"] == D("45286.80")
    assert metrics["gain_amount"] == D("45286.80")
    assert metrics["gain_pct"] is None


def test_lot_metrics_treats_a_sold_row_missing_its_price_as_unpriced():
    # The API enforces the pair, but a half-filled row must degrade, not crash.
    metrics = lot_metrics(
        lot(sold_date=date(2026, 3, 1)), current_price=D("174.1800"), today=date(2026, 8, 16)
    )
    assert metrics["is_sold"] is True
    assert metrics["market_value"] is None
    assert metrics["gain_amount"] is None
    assert metrics["gain_pct"] is None
    assert metrics["days_until_qualified"] is None


# --- the anatomy (2026-09-07 spec §3.1) ---


def test_lot_metrics_splits_value_into_paid_bargain_and_appreciation():
    metrics = lot_metrics(lot(), current_price=D("174.1800"), today=date(2026, 8, 16))
    assert metrics["fmv_value"] == D("20569.12")  # 260 x 79.112
    assert metrics["bargain_element"] == D("9848.63")  # fmv_value - cost_basis
    assert metrics["lookback_component"] == D("7956.78")  # 260 x (79.112 - 48.509)
    assert metrics["discount_component"] == D("1891.85")  # 260 x (48.509 - 41.23265)
    assert metrics["appreciation"] == D("24717.68")  # market_value - fmv_value


def test_lot_metrics_appreciation_is_realized_for_a_sold_lot_and_null_when_unpriced():
    sold = lot_metrics(
        lot(sold_date=date(2026, 3, 1), sold_price="120.00000"),
        current_price=D("174.1800"),
        today=date(2026, 8, 16),
    )
    assert sold["appreciation"] == D("10630.88")  # 31200.00 - 20569.12, at the SALE price
    unpriced = lot_metrics(lot(), current_price=None, today=date(2026, 8, 16))
    assert unpriced["appreciation"] is None
    assert unpriced["bargain_element"] == D("9848.63")  # purchase-day facts need no quote


def test_lot_metrics_appreciation_goes_negative_below_the_purchase_fmv():
    metrics = lot_metrics(lot(), current_price=D("70.0000"), today=date(2026, 8, 16))
    assert metrics["appreciation"] == D("-2369.12")  # 18200.00 - 20569.12


def test_lot_metrics_discount_component_goes_negative_for_an_over_typed_purchase_price():
    metrics = lot_metrics(
        lot(purchase_price="60.00000"), current_price=D("174.1800"), today=date(2026, 8, 16)
    )
    assert metrics["bargain_element"] == D("4969.12")  # 20569.12 - 15600.00
    assert metrics["lookback_component"] == D("7956.78")  # FMV vs subscription — unchanged
    assert metrics["discount_component"] == D("-2987.66")  # the whole over-payment lands here


def test_lot_metrics_lookback_is_zero_when_fmv_sat_below_the_subscription():
    metrics = lot_metrics(
        lot(purchase_fmv="40.00000", purchase_price="34.00000"),
        current_price=D("174.1800"),
        today=date(2026, 8, 16),
    )
    assert metrics["fmv_value"] == D("10400.00")
    assert metrics["lookback_component"] == D("0.00")
    assert metrics["discount_component"] == D("1560.00")  # the whole bargain is the discount


def test_running_avg_paid_walks_the_lots_in_chain_order():
    lots = [
        lot(shares="260.0000", purchase_price="41.23265", purchase_date=date(2024, 2, 29)),
        lot(shares="100.0000", purchase_price="127.50000", purchase_date=date(2024, 8, 30)),
        lot(shares="241.0000", purchase_price="41.23265", purchase_date=date(2025, 2, 28)),
    ]
    # Cumulative cost over cumulative shares at the lot price scale (5 dp):
    # 10720.49 / 260, 23470.49 / 360, 33407.56 / 601.
    assert running_avg_paid(lots) == [D("41.23265"), D("65.19581"), D("55.58662")]


def test_running_avg_paid_never_divides_by_zero_shares():
    # The API forbids a zero-share lot; a hand-edited row must still read (a GET never 500s).
    assert running_avg_paid([lot(shares="0.0000")]) == [None]
    assert running_avg_paid([]) == []


def test_price5_collapses_signed_zeros():
    assert str(price5(D("-0.000001"))) == "0.00000"


def test_position_totals_sums_held_and_sold_lots_apart():
    today = date(2026, 8, 16)
    price = D("174.1800")
    a = lot(shares="260.0000", purchase_date=date(2024, 2, 29))
    b = lot(
        shares="100.0000",
        purchase_price="127.50000",
        purchase_date=date(2024, 8, 30),
        sold_date=date(2026, 3, 1),
        sold_price="120.00000",
    )
    c = lot(shares="241.0000", purchase_date=date(2025, 2, 28))
    totals = position_totals([(row, lot_metrics(row, price, today)) for row in (a, b, c)])
    held, sold = totals["held"], totals["sold"]
    assert held["lots"] == 2
    assert held["shares"] == D("501.0000")
    assert held["cost_basis"] == D("20657.56")  # 10720.49 + 9937.07
    assert held["fmv_value"] == D("39635.11")  # 20569.12 + 19065.99
    assert held["market_value"] == D("87264.18")  # 45286.80 + 41977.38
    assert held["gain_amount"] == D("66606.62")
    # gain / cost — a MONEY ratio (the per-lot gain_pct is the sheet's PRICE ratio; the two
    # agree here only because both lots were bought at one price).
    assert held["gain_pct"] == D("3.224322")
    assert held["bargain_element"] == D("18977.55")
    assert held["lookback_component"] == D("15332.10")  # 7956.78 + 7375.32
    assert held["discount_component"] == D("3645.45")
    assert held["appreciation"] == D("47629.07")  # 24717.68 + 22911.39
    assert held["avg_paid"] == D("41.23265")  # 20657.56 / 501
    assert sold == {
        "lots": 1,
        "shares": D("100.0000"),
        "cost_basis": D("12750.00"),
        "proceeds": D("12000.00"),
        "gain_amount": D("-750.00"),
    }


def test_position_totals_null_the_quote_fields_when_a_held_lot_is_unpriced():
    today = date(2026, 8, 16)
    rows = [lot(), lot(purchase_date=date(2025, 2, 28))]
    totals = position_totals([(row, lot_metrics(row, None, today)) for row in rows])
    held = totals["held"]
    assert held["lots"] == 2
    assert held["cost_basis"] == D("21440.98")  # purchase-day facts always sum
    assert held["bargain_element"] == D("19697.26")
    assert (held["market_value"], held["gain_amount"], held["gain_pct"], held["appreciation"]) == (
        None,
        None,
        None,
        None,
    )
    assert held["avg_paid"] == D("41.23265")


def test_position_totals_skip_the_money_of_a_sold_row_missing_its_price():
    today = date(2026, 8, 16)
    # Stored shape the API rejects: sold_date without sold_price (lot_metrics reads it as
    # sold-but-unpriced). It counts as a sold lot and contributes to no money field.
    half = lot(sold_date=date(2026, 3, 1), sold_price=None)
    totals = position_totals([(half, lot_metrics(half, D("174.1800"), today))])
    assert totals["sold"] == {
        "lots": 1,
        "shares": D("260.0000"),
        "cost_basis": D("0.00"),
        "proceeds": D("0.00"),
        "gain_amount": D("0.00"),
    }
    assert totals["held"]["lots"] == 0
    assert totals["held"]["avg_paid"] is None
    assert totals["held"]["gain_pct"] is None


def test_position_totals_are_all_zeros_never_absent_when_empty():
    totals = position_totals([])
    assert str(totals["held"]["shares"]) == "0.0000"  # column scale, so the wire says 0.0000
    assert str(totals["held"]["cost_basis"]) == "0.00"
    assert totals["held"]["market_value"] == D("0.00")  # zeros, not None: nothing is unpriced
    assert totals["held"]["gain_pct"] is None
    assert str(totals["sold"]["proceeds"]) == "0.00"


# --- the purchase calendar and the year planner ---


def _stored(
    id_: int,
    label: str,
    start: date,
    end: date,
    base: str = "60000",
    additional: str = "0",
    pct: str = "0.140000000",
) -> StoredPeriod:
    """A stored espp_periods row for the PLANNER: both dates are positional because the
    planner slots rows by period_end and resolves offerings by period_start."""
    return StoredPeriod(
        id=id_,
        label=label,
        period_start=start,
        period_end=end,
        semi_annual_base=D(base),
        additional_payments=D(additional),
        contribution_pct=D(pct),
    )


def test_last_weekday_of_weekday_and_weekend_ends():
    assert last_weekday_of(2026, 2) == date(2026, 2, 27)  # Feb 28 2026 is a Saturday
    assert last_weekday_of(2025, 8) == date(2025, 8, 29)  # Aug 31 2025 is a Sunday
    assert last_weekday_of(2024, 2) == date(2024, 2, 29)  # leap Feb ending on a Thursday


def test_plan_year_rows_stored_rows_win_verbatim():
    stored = [
        _stored(1, "1H24", date(2023, 9, 1), date(2024, 2, 29)),
        _stored(2, "2H24", date(2024, 3, 1), date(2024, 8, 30)),
    ]
    offerings = [OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=D("48.50900"))]
    rows, warnings = plan_year_rows(2024, stored, offerings, D("180"), None)
    assert warnings == []
    assert [r.label for r in rows] == ["1H24", "2H24"]
    assert all(r.stored and r.period_id is not None for r in rows)
    # Boundary: period_start == offering_start resolves to that offering (<=, not <).
    assert rows[0].subscription_price == D("48.50900")
    assert rows[0].offering_start == date(2023, 9, 1)


def test_plan_year_rows_derives_empty_slots_with_carried_values():
    stored = [
        _stored(1, "2H25", date(2025, 3, 1), date(2025, 8, 29), base="70000", pct="0.150000000")
    ]
    offerings = [
        OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=D("48.509")),
        OfferingInfo(offering_start=date(2025, 9, 1), subscription_price=D("175.25")),
    ]
    rows, warnings = plan_year_rows(2026, stored, offerings, None, None)
    assert warnings == []
    assert [r.stored for r in rows] == [False, False]
    assert rows[0].label == "Sep 2025–Feb 2026"
    assert rows[0].period_start == date(2025, 9, 1)
    assert rows[0].period_end == last_weekday_of(2026, 2)
    assert rows[1].label == "Mar–Aug 2026"
    assert rows[1].period_start == date(2026, 3, 1)
    assert rows[1].period_end == last_weekday_of(2026, 8)
    # Values carry forward from the latest stored period overall.
    assert rows[0].semi_annual_base == D("70000")
    assert rows[0].contribution_pct == D("0.150000000")
    # Both slots start on/after 2025-09-01, so both wear the reset offering's price.
    assert all(r.subscription_price == D("175.25") for r in rows)
    assert all(r.offering_start == date(2025, 9, 1) for r in rows)


def test_plan_year_rows_mixed_year_after_a_mid_cycle_reset():
    offerings = [
        OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=D("48.509")),
        OfferingInfo(offering_start=date(2026, 3, 1), subscription_price=D("120")),
    ]
    rows, _ = plan_year_rows(2026, [], offerings, None, None)
    assert rows[0].subscription_price == D("48.509")  # Sep 2025 start: old offering
    assert rows[1].subscription_price == D("120")  # Mar 2026 start: reset offering


def test_plan_year_rows_gap_falls_back_to_quote_with_warning():
    rows, warnings = plan_year_rows(2024, [], [], D("99.9900"), None)
    assert all(r.subscription_price == D("99.9900") and r.offering_start is None for r in rows)
    assert any("no offering covers" in w for w in warnings)
    # And with no quote either, the rows are unpriced (the router's 422 case).
    rows2, _ = plan_year_rows(2024, [], [], None, None)
    assert all(r.subscription_price is None for r in rows2)


def test_plan_year_rows_override_prices_every_row_silently():
    offerings = [OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=D("48.509"))]
    stored = [_stored(1, "1H24", date(2023, 9, 1), date(2024, 2, 29))]
    rows, warnings = plan_year_rows(2024, stored, offerings, None, D("55"))
    # Stored row and derived slot alike: the override beats the covering offering and
    # carries none of its provenance.
    assert [r.stored for r in rows] == [True, False]
    assert all(r.subscription_price == D("55") and r.offering_start is None for r in rows)
    assert warnings == []
    # ... and with no offering at all it silences the fallback warning both rows would
    # otherwise raise.
    gap_rows, gap_warnings = plan_year_rows(2024, stored, [], None, D("55"))
    assert all(r.subscription_price == D("55") for r in gap_rows)
    assert gap_warnings == []


def test_plan_year_rows_zero_history_seeds_zero_with_warning():
    rows, warnings = plan_year_rows(2026, [], [], D("1"), None)
    assert all(r.semi_annual_base == D("0") and r.contribution_pct == D("0") for r in rows)
    assert any("no stored purchase periods" in w for w in warnings)


def test_plan_year_rows_anomalous_half_passes_through_verbatim():
    stored = [
        _stored(1, "A", date(2023, 9, 1), date(2024, 1, 15)),
        _stored(2, "B", date(2023, 10, 1), date(2024, 2, 29)),  # two rows in H1
    ]
    rows, _ = plan_year_rows(2024, stored, [], D("1"), None)
    # No derived filling for the year — stored data passes through in chain order.
    assert [r.label for r in rows] == ["A", "B"]
    assert all(r.stored for r in rows)


def test_purchase_price_follows_the_plan_discount():
    row = REAL_PERIODS[0]
    ten = run_modeler([row], purchase_fmv=FMV, carry_forward=D("0.00"), discount=D("0.10"))
    fifteen = run_modeler([row], purchase_fmv=FMV, carry_forward=D("0.00"))
    lower = min(row.subscription_price, FMV)
    # CEIL2((1 - discount) x min(sub, fmv)) — the sheet's ROUNDUP, at the plan's own rate.
    assert ten.periods[0].purchase_price == ceil2(D("0.90") * lower)
    assert fifteen.periods[0].purchase_price == ceil2(D("0.85") * lower)
    assert ten.periods[0].purchase_price > fifteen.periods[0].purchase_price
