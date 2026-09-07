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

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
ONE = Decimal("1")
MONEY_QUANTUM = Decimal("0.01")
PCT_QUANTUM = Decimal("0.000001")
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


# The espp lot price family — Numeric(14,5), the one place in the app that is not 4dp.
PRICE5_QUANTUM = Decimal("0.00001")


def price5(value: Decimal) -> Decimal:
    """HALF_UP at the lot price scale, signed zero collapsed (the module's wire rule)."""
    return value.quantize(PRICE5_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def running_avg_paid(lots) -> list[Decimal | None]:
    """Average price paid per share TO DATE, one figure per lot, over `lots` in chain order
    ((purchase_date, id) — the router's own ordering; 2026-09-07 spec §3.1).

    Sold lots stay in the walk: this is what the purchases cost on average as they happened —
    the price chart's stepped rule — never a tax basis, and the wire name says "paid". None
    only where the cumulative share count is zero, which the API forbids but a hand-edited
    row could store: a GET must never divide by it. Each lot's cost is half_up2(shares x
    price), the same cents `lot_metrics` reports as cost_basis, so the two never drift.
    """
    cumulative_cost = ZERO
    cumulative_shares = ZERO
    averages: list[Decimal | None] = []
    for lot in lots:
        cumulative_cost += half_up2(lot.shares * lot.purchase_price)
        cumulative_shares += lot.shares
        averages.append(
            None if cumulative_shares == 0 else price5(cumulative_cost / cumulative_shares)
        )
    return averages


# Accumulators start AT column scale so an empty block still serializes "0.0000" / "0.00"
# rather than a bare "0" (Pct9's lesson: the wire text is the Decimal's own str()).
SHARES_ZERO = Decimal("0.0000")
MONEY_ZERO = Decimal("0.00")
HELD_SUMMED = (
    "cost_basis",
    "fmv_value",
    "bargain_element",
    "lookback_component",
    "discount_component",
)


def position_totals(rows) -> dict[str, dict]:
    """The lots envelope's totals block (2026-09-07 spec §3.2): held and sold lots summed
    apart, from the (lot, lot_metrics(lot, …)) pairs the router already built.

    Held: the quote-dependent fields (market_value, gain_amount, gain_pct, appreciation) go
    None as soon as ONE held lot is unpriced — a partial sum would be a smaller number
    pretending to be the position — while the purchase-day facts always sum. gain_pct is
    gain / cost, a MONEY ratio; the per-lot gain_pct is the sheet's PRICE ratio, and the two
    agree only while every lot was bought at one price (the schema docstring says so too).
    Sold: a row with a sold_date but no price counts in `lots` and `shares` and in no money
    field, so proceeds and gain stay over one and the same priced subset. No re-rounding:
    every operand is already at cents; `+ ZERO` only collapses a signed zero.
    """
    held: dict = {
        "lots": 0,
        "shares": SHARES_ZERO,
        "market_value": MONEY_ZERO,
        "gain_amount": MONEY_ZERO,
        "appreciation": MONEY_ZERO,
    }
    held.update({key: MONEY_ZERO for key in HELD_SUMMED})
    sold: dict = {
        "lots": 0,
        "shares": SHARES_ZERO,
        "cost_basis": MONEY_ZERO,
        "proceeds": MONEY_ZERO,
        "gain_amount": MONEY_ZERO,
    }
    unpriced_held = False
    for lot, metrics in rows:
        if metrics["is_sold"]:
            sold["lots"] += 1
            sold["shares"] += lot.shares
            if metrics["market_value"] is not None:
                sold["cost_basis"] += metrics["cost_basis"]
                sold["proceeds"] += metrics["market_value"]
                sold["gain_amount"] += metrics["gain_amount"]
            continue
        held["lots"] += 1
        held["shares"] += lot.shares
        for key in HELD_SUMMED:
            held[key] += metrics[key]
        if metrics["market_value"] is None:
            unpriced_held = True
        else:
            held["market_value"] += metrics["market_value"]
            held["gain_amount"] += metrics["gain_amount"]
            held["appreciation"] += metrics["appreciation"]
    if unpriced_held:
        held["market_value"] = held["gain_amount"] = held["appreciation"] = held["gain_pct"] = None
    else:
        held["gain_pct"] = (
            None if held["cost_basis"] == 0 else _pct6(held["gain_amount"] / held["cost_basis"])
        )
    held["avg_paid"] = None if held["shares"] == 0 else price5(held["cost_basis"] / held["shares"])
    for block in (held, sold):
        for key, value in block.items():
            if isinstance(value, Decimal):
                block[key] = value + ZERO
    return {"held": held, "sold": sold}


@dataclass(frozen=True)
class StoredPeriod:
    """One `espp_periods` row, as the router hands it over (already at column scale) — the
    PLANNER's input; `RowPlan` is the modeler's."""

    id: int
    label: str
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Decimal


def last_weekday_of(year: int, month: int) -> date:
    """The last Mon–Fri of a month — the documented approximation of "last trading day"
    (spec 2026-08-23 §3.2). No NYSE holiday falls on the last weekday of Feb or Aug, and
    the date is derivation/display only."""
    day = date(year, month, calendar.monthrange(year, month)[1])
    while day.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        day -= timedelta(days=1)
    return day


@dataclass(frozen=True)
class OfferingInfo:
    """One espp_offerings row, as the router hands it over. Input order does not matter:
    resolution takes the GREATEST offering_start at or before a period's start, and
    offering_start is UNIQUE, so no tie can exist."""

    offering_start: date
    subscription_price: Decimal


@dataclass(frozen=True)
class RowPlan:
    """One modeler row for the target year — a stored period verbatim, or a derived row
    filling an empty half-year slot (stored=False, period_id=None; it materializes only
    when the user saves it). subscription_price is None ONLY when nothing could price the
    row (no covering offering, no quote, no override) — the router turns that into the
    422; run_modeler refuses it as a programming error."""

    # Constructor invariant, relied on by every consumer: stored == (period_id is not None).
    period_id: int | None
    stored: bool
    label: str
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Decimal
    subscription_price: Decimal | None
    offering_start: date | None  # None = quote fallback or an override priced it


def _resolve_subscription(
    offerings: list[OfferingInfo],
    period_start: date,
    latest_quote: Decimal | None,
    override: Decimal | None,
) -> tuple[Decimal | None, date | None]:
    """Greatest offering_start <= period_start wins (<=: an offering starting the same
    day the period does covers it — spec §3.1). Override beats everything and carries no
    offering provenance; a gap falls back to the quote; no quote leaves it unpriced."""
    if override is not None:
        return override, None
    covering = max(
        (o for o in offerings if o.offering_start <= period_start),
        key=lambda o: o.offering_start,
        default=None,
    )
    if covering is not None:
        return covering.subscription_price, covering.offering_start
    return latest_quote, None


def plan_year_rows(
    year: int,
    stored_rows: list[StoredPeriod],
    offerings: list[OfferingInfo],
    latest_quote: Decimal | None,
    subscription_override: Decimal | None,
) -> tuple[list[RowPlan], list[str]]:
    """The modeled year's rows: stored wins, derive to fill (spec §3.3).

    `stored_rows` is EVERY stored period in chain order (period_end, id) — the whole list,
    not just the year's, because derived rows seed base/additional/pct from the latest
    stored period overall. Slots: H1 = period_end month 1–6 (the Feb purchase), H2 = 7–12
    (Aug). A half with more than one stored row is anomalous data and passes through
    verbatim with no derived filling — a GET never rejects what is stored.
    """
    warnings: list[str] = []

    def resolve(label: str, period_start: date) -> tuple[Decimal | None, date | None]:
        sub, off_start = _resolve_subscription(
            offerings, period_start, latest_quote, subscription_override
        )
        if sub is not None and off_start is None and subscription_override is None:
            warnings.append(
                f"no offering covers {label}; subscription defaulted to the latest quote"
            )
        return sub, off_start

    def planned(row: StoredPeriod) -> RowPlan:
        sub, off_start = resolve(row.label, row.period_start)
        return RowPlan(
            period_id=row.id,
            stored=True,
            label=row.label,
            period_start=row.period_start,
            period_end=row.period_end,
            semi_annual_base=row.semi_annual_base,
            additional_payments=row.additional_payments,
            contribution_pct=row.contribution_pct,
            subscription_price=sub,
            offering_start=off_start,
        )

    year_rows = [row for row in stored_rows if row.period_end.year == year]
    h1 = [row for row in year_rows if row.period_end.month <= 6]
    h2 = [row for row in year_rows if row.period_end.month > 6]
    if len(h1) > 1 or len(h2) > 1:
        return [planned(row) for row in year_rows], warnings

    seed = stored_rows[-1] if stored_rows else None
    if seed is None and (not h1 or not h2):
        warnings.append(
            "no stored purchase periods yet — derived rows are seeded at 0; "
            "edit and save them below"
        )

    def derived(label: str, start: date, end: date) -> RowPlan:
        sub, off_start = resolve(label, start)
        return RowPlan(
            period_id=None,
            stored=False,
            label=label,
            period_start=start,
            period_end=end,
            semi_annual_base=seed.semi_annual_base if seed else ZERO,
            additional_payments=seed.additional_payments if seed else ZERO,
            contribution_pct=seed.contribution_pct if seed else ZERO,
            subscription_price=sub,
            offering_start=off_start,
        )

    # The labels are the derived rows' identity in espp_periods (String(60)); the en dash
    # is the app's range separator.
    first = (
        planned(h1[0])
        if h1
        else derived(f"Sep {year - 1}–Feb {year}", date(year - 1, 9, 1), last_weekday_of(year, 2))
    )
    second = (
        planned(h2[0])
        if h2
        else derived(f"Mar–Aug {year}", date(year, 3, 1), last_weekday_of(year, 8))
    )
    return [first, second], warnings


@dataclass(frozen=True)
class PeriodResult:
    period: RowPlan
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
    # 2026-09-07 spec §3.3 — the chain meter's labels and tiles, exposed so no client sums.
    total_shares: int
    total_contribution: Decimal
    total_refund: Decimal


@dataclass(frozen=True)
class ModelerResult:
    purchase_fmv: Decimal
    carry_forward: Decimal
    periods: list[PeriodResult]
    totals: ModelerTotals


def run_modeler(
    rows: list[RowPlan],
    purchase_fmv: Decimal,
    carry_forward: Decimal,
    discount: Decimal,
) -> ModelerResult:
    """The sheet's chained per-period model over ONE calendar year.

    The subscription price is PER ROW now — offerings resolve it per period (2026-08-23
    spec §4), so a mid-cycle reset year chains two different prices. This is the day the
    old "computed once, echoed per period" shape was kept for. purchase_fmv stays one
    knob for the year, which keeps r31's every-share-at-the-last-FMV quirk a no-op by
    construction. `rows` must already be the target year's, in chain order; every row
    must be priced (the router 422s unpriced rows before calling). `discount` is the plan's
    fraction — 0.15 = 15 % off — and is the caller's to supply.

    The two branches are the whole model. Under the limit, the leftover cash CARRIES into
    the next period; at or over it, the purchase is capped at `max_shares_25k` and the
    leftover is REFUNDED instead (nothing carries). The trigger is `>=`, not `>`, so a
    purchase that exactly exhausts the limit refunds its change.
    """
    unused = ANNUAL_LIMIT
    carry = carry_forward
    results: list[PeriodResult] = []
    for row in rows:
        if row.subscription_price is None:
            raise ValueError(f"unpriced row {row.label!r} reached run_modeler")
        # (1 - discount) x min(sub, fmv), rounded UP to a cent (r18) — per period, per its
        # offering, at the plan's own rate (spec §1.5). The old module constant is gone, so
        # no caller can price a purchase at a discount nobody stored.
        purchase_price = ceil2((ONE - discount) * min(row.subscription_price, purchase_fmv))
        eligible = row.semi_annual_base + row.additional_payments
        contribution = half_up2(eligible * row.contribution_pct)
        available = contribution + carry
        shares_before_limit = floor_int(available / purchase_price)
        max_shares = floor_int(unused / row.subscription_price)
        over_limit = shares_before_limit >= max_shares
        shares = min(shares_before_limit, max_shares)
        cost = ceil2(Decimal(shares) * purchase_price)
        # The 25k limit is valued at the SUBSCRIPTION price, never at the discounted
        # purchase price — that is what makes max_shares_25k bite before the cash does.
        value_25k = half_up2(Decimal(shares) * row.subscription_price)
        # ONE expression for "what rolls into the next period": the reported
        # carry_forward_out and the chained `carry` must never be able to drift apart.
        carry_next = ZERO if over_limit else available - cost
        results.append(
            PeriodResult(
                period=row,
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
                carry_forward_out=half_up2(carry_next),
                refund=half_up2(available - cost if over_limit else ZERO),
                value_25k=value_25k,
            )
        )
        unused = unused - value_25k
        carry = carry_next

    total_shares = sum(row.shares for row in results)
    total_value = half_up2(sum((row.value_25k for row in results), ZERO))
    return ModelerResult(
        purchase_fmv=purchase_fmv,
        carry_forward=carry_forward,
        periods=results,
        totals=ModelerTotals(
            total_25k_value=total_value,
            out_of_pocket_cost=half_up2(sum((row.cost for row in results), ZERO)),
            # r31 values EVERY share at the LAST period's FMV — a faithful sheet quirk
            # that stays a no-op while one purchase_fmv knob drives the whole year.
            fmv_of_shares=half_up2(Decimal(total_shares) * purchase_fmv),
            remaining_25k=half_up2(ANNUAL_LIMIT - total_value),
            total_shares=total_shares,
            total_contribution=half_up2(sum((row.contribution for row in results), ZERO)),
            total_refund=half_up2(sum((row.refund for row in results), ZERO)),
        ),
    )


def lot_metrics(lot, current_price: Decimal | None, today: date) -> dict:
    """The `espp_lots` computed columns for one stored row.

    A lot is "sold" as soon as it carries a sold_date; the realized price then replaces
    the live quote for market_value/gain (and the countdown stops, because there is
    nothing left to hold). `current_price` is None whenever the espp_ticker soft link
    dangles at any hop — the market fields degrade to null and the date-only fields keep
    working, so the page still renders.

    Defensive on stored data (a GET must never 500), and each half-filled shape degrades
    DIFFERENTLY — the API rejects all three, so this is only about what is already stored:
      - sold_date set, sold_price null: still "sold", but unpriced — market_value,
        gain_amount and gain_pct go null and the countdown stays stopped.
      - sold_price set, sold_date null: read as UNSOLD (sold_date is the only flag), so
        the stored sale price is IGNORED and the row is priced off the live quote.
      - purchase_price == 0: only gain_pct goes null (its divisor); cost_basis,
        market_value and gain_amount all still compute.

    The five anatomy keys (fmv_value, bargain_element, lookback_component,
    discount_component, appreciation) are the lot's value on purchase day and its split —
    only `appreciation` needs a price, so only it can be None.
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

    # The anatomy (2026-09-07 spec §3.1). The bargain element is the lot's value on purchase
    # day less what it cost — the plan discount PLUS the lookback (FMV above the subscription
    # price). It is split from the two stored prices, never from the discount setting: an
    # over-typed purchase_price then shows up honestly as a NEGATIVE discount component
    # rather than as a lie about the lookback.
    fmv_value = half_up2(lot.shares * lot.purchase_fmv)
    bargain_element = (fmv_value - cost_basis) + ZERO
    lookback_component = half_up2(lot.shares * max(lot.purchase_fmv - lot.subscription_price, ZERO))
    discount_component = (bargain_element - lookback_component) + ZERO
    # Realized for a sold lot (market_value is at the sale price), None while unpriced.
    appreciation = None if market_value is None else (market_value - fmv_value) + ZERO

    # A disposition is judged on the SALE date; an unsold lot is judged on today.
    reference_date = lot.sold_date if is_sold else today
    return {
        "cost_basis": cost_basis,
        "market_value": market_value,
        "gain_amount": gain_amount,
        "gain_pct": gain_pct,
        "fmv_value": fmv_value,
        "bargain_element": bargain_element,
        "lookback_component": lookback_component,
        "discount_component": discount_component,
        "appreciation": appreciation,
        "qualified": reference_date >= lot.qualifying_date,
        "days_until_qualified": (None if is_sold else max(0, (lot.qualifying_date - today).days)),
        "is_sold": is_sold,
    }
