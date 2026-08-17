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

from app.models import EsppLot
from app.services.espp_calc import (
    ANNUAL_LIMIT,
    PeriodInputs,
    ceil2,
    floor_int,
    half_up2,
    lot_metrics,
    run_modeler,
)

D = Decimal

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
) -> PeriodInputs:
    """Column-scale values, as the router hands them over: base/add Numeric(12,2),
    contribution_pct Numeric(10,9)."""
    return PeriodInputs(
        id=id,
        label=label,
        period_start=start,
        period_end=end,
        semi_annual_base=D(base),
        additional_payments=D(add),
        contribution_pct=D(pct),
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
) -> EsppLot:
    """A transient (never-flushed) ORM row at COLUMN scale: shares Numeric(12,4),
    prices Numeric(14,5). No session is involved — lot_metrics only reads attributes."""
    return EsppLot(
        id=1,
        purchase_date=purchase_date,
        qualifying_date=qualifying_date,
        shares=D(shares),
        subscription_price=D("48.50900"),
        purchase_fmv=D("79.11200"),
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
    result = run_modeler(
        REAL_PERIODS, subscription_price=SUB, purchase_fmv=FMV, carry_forward=D("0.00")
    )
    assert result.subscription_price == SUB
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


def test_single_period_chain_and_the_carry_forward_seed():
    zero_carry = run_modeler(
        REAL_PERIODS[:1], subscription_price=SUB, purchase_fmv=FMV, carry_forward=D("0.00")
    )
    (only,) = zero_carry.periods
    assert only.available == D("11340.00")
    assert only.shares == 78
    assert only.carry_forward_out == D("15.96")
    assert zero_carry.totals.total_25k_value == D("13321.62")
    assert zero_carry.totals.out_of_pocket_cost == D("11324.04")
    assert zero_carry.totals.fmv_of_shares == D("13338.00")  # 78 x 171.00
    assert zero_carry.totals.remaining_25k == D("11678.38")

    # The seed carry is spendable cash in the FIRST period and nowhere else.
    seeded = run_modeler(
        REAL_PERIODS[:1], subscription_price=SUB, purchase_fmv=FMV, carry_forward=D("100.00")
    )
    (funded,) = seeded.periods
    assert funded.available == D("11440.00")
    assert funded.shares == 78  # 79 shares would cost 11469.22 — still short
    assert funded.carry_forward_out == D("115.96")
    assert seeded.totals == zero_carry.totals  # ... so the year's totals do not move


def test_three_period_chain_decrements_unused_25k_cumulatively():
    periods = [
        period(10, "P1", "10000.00", "0.100000000", end=date(2026, 3, 31)),
        period(11, "P2", "10000.00", "0.100000000", end=date(2026, 7, 31)),
        period(12, "P3", "10000.00", "0.100000000", end=date(2026, 11, 30)),
    ]
    result = run_modeler(
        periods,
        subscription_price=D("100.00000"),
        purchase_fmv=D("100.00000"),
        carry_forward=D("0.00"),
    )
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
        [period(20, "rich", "400000.00", "0.100000000")],
        subscription_price=D("100.00000"),
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
        [period(21, "exact", "213000.00", "0.100000000")],
        subscription_price=D("100.00000"),
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
            period(40, "over", "100000.00", "0.500000000", end=date(2026, 3, 31)),
            period(41, "after", "10000.00", "0.100000000", end=date(2026, 9, 30)),
        ],
        subscription_price=D("100.00000"),
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
    lower_fmv = run_modeler(
        REAL_PERIODS[:1],
        subscription_price=D("170.79000"),
        purchase_fmv=D("100.00000"),
        carry_forward=D("0.00"),
    )
    assert lower_fmv.periods[0].purchase_price == D("85.00")  # CEIL2(0.85 x 100)
    # ... while the 25k valuation always runs on the SUBSCRIPTION price.
    assert lower_fmv.periods[0].max_shares_25k == 146


def test_additional_payments_join_eligible_earnings():
    result = run_modeler(
        [period(30, "bonus", "81000.00", "0.140000000", add="9000.00")],
        subscription_price=SUB,
        purchase_fmv=FMV,
        carry_forward=D("0.00"),
    )
    (row,) = result.periods
    assert row.eligible_earnings == D("90000.00")
    assert row.contribution == D("12600.00")


def test_empty_period_list_models_an_untouched_year():
    result = run_modeler([], subscription_price=SUB, purchase_fmv=FMV, carry_forward=D("0.00"))
    assert result.periods == []
    assert result.totals.total_25k_value == D("0.00")
    assert result.totals.out_of_pocket_cost == D("0.00")
    assert result.totals.fmv_of_shares == D("0.00")
    assert result.totals.remaining_25k == D("25000.00")


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
