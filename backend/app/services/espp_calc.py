"""The ESPP sheet's math: the per-period chained 25k modeler and the lots table's
computed columns.

Pure module — no DB, no HTTP, no FastAPI. `today` is a PARAMETER of `lot_metrics`, never
`date.today()`, so the endpoint owns the clock and the tests stay deterministic.

The helper names map to the sheet's functions one for one: `half_up2` is ROUND(x, 2),
`ceil2` is ROUNDUP(x, 2) (the modeler's purchase price always rounds AWAY from the
employee) and `floor_int` is INT(). Note the asymmetry the workbook actually has: the
modeler's purchase price is ROUNDUP'd to a cent, while the LOTS table stores the plain
0.85 x min(sub, fmv) at 5dp — `ceil2` must never be applied to a stored lot.

Every quantize collapses signed zeros with `+ ZERO`: a tiny negative rounds to
Decimal("-0.00"), which pydantic would render as "-0.00" on the wire (tax_service._rate's
documented trick). Outputs use PLAIN quantize, never money.py's bounded quantizers — a
GET must never 422/500 on data that is already stored.

Preconditions (enforced at the API boundary, not here): subscription_price > 0 and
purchase_fmv > 0, so `purchase_price` is at least 0.01 and neither division can trap.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
MONEY_QUANTUM = Decimal("0.01")
PCT_QUANTUM = Decimal("0.000001")
DISCOUNT = Decimal("0.85")
# The IRS §423 limit, spelled at money scale so the chained unused_25k stays 2dp.
ANNUAL_LIMIT = Decimal("25000.00")


def half_up2(value: Decimal) -> Decimal:
    """ROUND(x, 2)."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def ceil2(value: Decimal) -> Decimal:
    """ROUNDUP(x, 2) — toward +inf, so an exact cent stays put."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_CEILING) + ZERO


def floor_int(value: Decimal) -> int:
    """INT() — toward -inf, never to nearest."""
    return int(value.to_integral_value(rounding=ROUND_FLOOR))


def _pct6(value: Decimal) -> Decimal:
    return value.quantize(PCT_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


@dataclass(frozen=True)
class PeriodInputs:
    """One `espp_periods` row, as the router hands it over (already at column scale)."""

    id: int
    label: str
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Decimal


@dataclass(frozen=True)
class PeriodResult:
    period: PeriodInputs
    eligible_earnings: Decimal
    contribution: Decimal
    available: Decimal
    purchase_price: Decimal
    shares_before_limit: int
    unused_25k: Decimal  # the limit remaining at the START of this period
    max_shares_25k: int
    over_limit: bool
    shares: int
    cost: Decimal
    carry_forward_out: Decimal
    refund: Decimal
    value_25k: Decimal


@dataclass(frozen=True)
class ModelerTotals:
    total_25k_value: Decimal
    out_of_pocket_cost: Decimal
    fmv_of_shares: Decimal
    remaining_25k: Decimal


@dataclass(frozen=True)
class ModelerResult:
    subscription_price: Decimal
    purchase_fmv: Decimal
    carry_forward: Decimal
    periods: list[PeriodResult]
    totals: ModelerTotals


def run_modeler(
    periods: list[PeriodInputs],
    subscription_price: Decimal,
    purchase_fmv: Decimal,
    carry_forward: Decimal,
) -> ModelerResult:
    """The sheet's chained per-period model over ONE calendar year.

    `periods` must already be filtered to that year and sorted by period_end — the chain
    is order-dependent: each period spends the previous one's unspent contribution
    (carry_forward) against what is left of the 25k limit (unused_25k).

    The two branches are the whole model. Under the limit, the leftover cash CARRIES into
    the next period; at or over it, the purchase is capped at `max_shares_25k` and the
    leftover is REFUNDED instead (nothing carries). The trigger is `>=`, not `>`, so a
    purchase that exactly exhausts the limit refunds its change.
    """
    unused = ANNUAL_LIMIT
    carry = carry_forward
    # 0.85 x min(sub, fmv), rounded UP to a cent (r18). Both knobs are per-year what-ifs,
    # so this is constant across the chain — computed once, echoed per period.
    purchase_price = ceil2(DISCOUNT * min(subscription_price, purchase_fmv))
    results: list[PeriodResult] = []
    for period in periods:
        eligible = period.semi_annual_base + period.additional_payments
        contribution = half_up2(eligible * period.contribution_pct)
        available = contribution + carry
        shares_before_limit = floor_int(available / purchase_price)
        max_shares = floor_int(unused / subscription_price)
        over_limit = shares_before_limit >= max_shares
        shares = min(shares_before_limit, max_shares)
        cost = ceil2(Decimal(shares) * purchase_price)
        # The 25k limit is valued at the SUBSCRIPTION price, never at the discounted
        # purchase price — that is what makes max_shares_25k bite before the cash does.
        value_25k = half_up2(Decimal(shares) * subscription_price)
        results.append(
            PeriodResult(
                period=period,
                eligible_earnings=eligible,
                contribution=contribution,
                available=available,
                purchase_price=purchase_price,
                shares_before_limit=shares_before_limit,
                unused_25k=unused,
                max_shares_25k=max_shares,
                over_limit=over_limit,
                shares=shares,
                cost=cost,
                carry_forward_out=half_up2(ZERO if over_limit else available - cost),
                refund=half_up2(available - cost if over_limit else ZERO),
                value_25k=value_25k,
            )
        )
        unused = unused - value_25k
        carry = ZERO if over_limit else available - cost

    total_shares = sum(row.shares for row in results)
    total_value = half_up2(sum((row.value_25k for row in results), ZERO))
    return ModelerResult(
        subscription_price=subscription_price,
        purchase_fmv=purchase_fmv,
        carry_forward=carry_forward,
        periods=results,
        totals=ModelerTotals(
            total_25k_value=total_value,
            out_of_pocket_cost=half_up2(sum((row.cost for row in results), ZERO)),
            # r31 values EVERY share at the LAST period's FMV — a faithful sheet quirk
            # that happens to be a no-op here, since one purchase_fmv knob drives the
            # whole year. Kept as the documented shape for the day that changes.
            fmv_of_shares=half_up2(Decimal(total_shares) * purchase_fmv),
            remaining_25k=half_up2(ANNUAL_LIMIT - total_value),
        ),
    )


def lot_metrics(lot, current_price: Decimal | None, today: date) -> dict:
    """The `espp_lots` computed columns for one stored row.

    A lot is "sold" as soon as it carries a sold_date; the realized price then replaces
    the live quote for market_value/gain (and the countdown stops, because there is
    nothing left to hold). `current_price` is None whenever the espp_ticker soft link
    dangles at any hop — the market fields degrade to null and the date-only fields keep
    working, so the page still renders.

    Defensive on stored data (a GET must never 500): a half-filled sold row and a zero
    purchase_price both degrade to nulls rather than raising.
    """
    is_sold = lot.sold_date is not None
    price = lot.sold_price if is_sold else current_price
    cost_basis = half_up2(lot.shares * lot.purchase_price)

    market_value = gain_amount = gain_pct = None
    if price is not None:
        market_value = half_up2(lot.shares * price)
        # Difference of two already-quantized 2dp values, so this needs no rounding —
        # `+ ZERO` only guarantees no signed zero ever reaches the wire.
        gain_amount = (market_value - cost_basis) + ZERO
        if lot.purchase_price != 0:
            # The sheet's r16 shape: a PRICE ratio, not market_value/cost_basis.
            gain_pct = _pct6((price - lot.purchase_price) / lot.purchase_price)

    # A disposition is judged on the SALE date; an unsold lot is judged on today.
    reference_date = lot.sold_date if is_sold else today
    return {
        "cost_basis": cost_basis,
        "market_value": market_value,
        "gain_amount": gain_amount,
        "gain_pct": gain_pct,
        "qualified": reference_date >= lot.qualifying_date,
        "days_until_qualified": (None if is_sold else max(0, (lot.qualifying_date - today).days)),
        "is_sold": is_sold,
    }
