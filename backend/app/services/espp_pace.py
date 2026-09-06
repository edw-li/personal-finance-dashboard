"""The ESPP pace row: the PURCHASE year's two contribution windows (2026-09-06 spec §1).

Pure module — no DB, no HTTP, no clock (limit_check's posture). The caller hands over the
year's two `plan_year_rows` rows, the person's whole profile timeline, the scenario profile
that speaks for TODAY ONWARD, the entered §423 cap, the plan discount and `today`.

A window, not an annualization: 26 CFR 1.423-2(i) accrues the right to buy on each PURCHASE
date, so Sep–Dec checks fund next February's purchase and belong to NEXT year's cap.
A soft cap, because contribution dollars can never use the whole 25,000 — at most
`limit x (1 - discount)` of them ever buy stock, and the TONE is judged there so the verdict
can never disagree with the tick beside it. And every figure is a STATED ESTIMATE, never a
ledger (spec §5): the app has no per-paycheck history, so a past payday is priced from the
profile in force on it and paydays before the person's earliest profile borrow that earliest
profile — `backfilled_from` says so out loud.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.limit_keys import LIMIT_ESPP_423, LIMIT_LABELS
from app.services.business_days import semi_monthly_paydays
from app.services.limit_check import OVER_ABOVE, RATIO_QUANTUM, WARN_AT, PaceHalf, PaceItem
from app.services.paycheck_calc import MONTHS_PER_YEAR, half_up2

ZERO = Decimal("0")
ONE = Decimal("1")
# The only cadence `semi_monthly_paydays` describes; anything else takes the month basis.
SEMI_MONTHLY = 24
MONTH_NAMES = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


def _stamp(day: date) -> str:
    """'Sep 2025' — spelled here rather than through strftime, whose month names follow the
    process locale and would make the label untestable on another machine."""
    return f"{MONTH_NAMES[day.month - 1]} {day.year}"


def _months(start: date, end: date):
    """Every (year, month) from `start`'s month through `end`'s, inclusive."""
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def _in_force(profiles: list, day: date):
    """The latest profile effective on or before `day` — `_default_profile`'s rule without
    the DB. Before the earliest profile there is nothing to read, so the earliest one stands
    in: the strip's "at this rate" posture, applied backwards."""
    eligible = [p for p in profiles if p.effective_date <= day]
    if eligible:
        return max(eligible, key=lambda p: p.effective_date)
    return min(profiles, key=lambda p: p.effective_date)


def _estimate(
    profiles: list, scenario, today: date, start: date, end: date
) -> tuple[Decimal, str, date | None]:
    """One window's (amount, basis, backfilled_from), payday by payday.

    A semi-monthly month contributes its two real paydays (the 15th and the month end, each
    pulled BACK over weekends and holidays — payroll's own convention), priced by the profile
    in force on THAT day. Any other cadence has no payday calendar in this app, so the month
    contributes one twelfth of the annual rate instead and the row says "estimated by month";
    a window that mixes the two reports the coarser word. Paydays on or after `today` are
    priced by the SCENARIO — the in-force profile for the GET, the sandbox's knobs for the
    preview — so the row answers "if I change now, where do this year's purchases land?",
    never "what if I had changed in March".
    """
    earliest = min(p.effective_date for p in profiles)
    amount = ZERO
    by_month = False
    backfilled: date | None = None

    def priced_by(day: date):
        """Who prices `day` — PURE, so asking the question never records an answer."""
        return scenario if day >= today else _in_force(profiles, day)

    def borrowed(day: date) -> bool:
        """Did `priced_by` have to reach forward for a profile that did not exist yet?

        Asked only where a figure was actually PRICED, never on the cadence probe below: a
        window opening after the earliest profile has one real payday inside it and has
        borrowed nothing, and must not say it did.
        """
        return day < today and day < earliest

    for year, month in _months(start, end):
        mid = date(year, month, 15)
        # Clamped so a window that opens after the 15th still probes a date inside it. This
        # read decides the CADENCE only — it prices nothing, so it flags nothing.
        monthly = priced_by(min(max(mid, start), end))
        if monthly.pay_periods_per_year == SEMI_MONTHLY:
            for day in semi_monthly_paydays(year, month):
                if start <= day <= end:
                    payer = priced_by(day)
                    if borrowed(day):
                        backfilled = earliest
                    amount += payer.espp_pct * (
                        payer.annual_salary / Decimal(payer.pay_periods_per_year)
                    )
        else:
            by_month = True
            if start <= mid <= end:
                if borrowed(mid):
                    backfilled = earliest
                amount += monthly.espp_pct * (monthly.annual_salary / MONTHS_PER_YEAR)
    return half_up2(amount), ("months" if by_month else "paydays"), backfilled


def espp_pace_item(
    *,
    rows: list,
    profiles: list,
    scenario_from_today,
    limit: Decimal | None,
    discount: Decimal,
    today: date,
) -> PaceItem | None:
    """The ESPP row for the purchase year `rows` describes, or None when there is no row.

    `rows` is `plan_year_rows(Y, stored, [], None, None)` — the calendar generator's own call,
    so the strip and the calendar can never disagree about which halves exist. None comes back
    when the whole window AND the current rate are zero: a 0-of-25,000 meter is noise, which
    is today's "not enrolled" rule widened from the rate to the window.
    """
    if not rows or not profiles:
        return None
    halves: list[PaceHalf] = []
    backfilled_from: date | None = None
    for row in rows:
        if row.stored and row.period_end < today:
            # The purchase happened and the user typed the contribution: their number wins
            # over any estimate this module could build (spec §1.3).
            halves.append(
                PaceHalf(
                    label=row.label,
                    start=row.period_start,
                    end=row.period_end,
                    amount=half_up2(
                        (row.semi_annual_base + row.additional_payments) * row.contribution_pct
                    ),
                    source="entered",
                    basis=None,
                )
            )
            continue
        amount, basis, backfill = _estimate(
            profiles, scenario_from_today, today, row.period_start, row.period_end
        )
        if backfill is not None and (backfilled_from is None or backfill < backfilled_from):
            backfilled_from = backfill
        halves.append(
            PaceHalf(
                label=row.label,
                start=row.period_start,
                end=row.period_end,
                amount=amount,
                source="estimated",
                basis=basis,
            )
        )

    window = half_up2(sum((half.amount for half in halves), ZERO))
    if window <= ZERO and scenario_from_today.espp_pct <= ZERO:
        return None
    projected = half_up2(scenario_from_today.espp_pct * scenario_from_today.annual_salary)
    shared = {
        "key": LIMIT_ESPP_423,
        "label": LIMIT_LABELS[LIMIT_ESPP_423],
        "annualized": window,
        "measure": "window",
        "window_label": f"{_stamp(halves[0].start)} – {_stamp(halves[-1].end)} purchases",
        "halves": halves,
        "backfilled_from": backfilled_from,
        "projected_full_year": projected,
        # The rate behind `projected_full_year`, stated rather than left for the client to
        # re-derive (the strip's own "server figures only" rule).
        "current_rate": scenario_from_today.espp_pct,
    }
    # `half_up2`, not money.py's bounded quantizer — a pure module must never raise an
    # HTTPException, and a GET must never 500 on data that is already stored.
    soft_limit = None if limit is None else half_up2(limit * (ONE - discount))
    if soft_limit is None or soft_limit <= ZERO:
        # No cap entered (or a 100 % discount, which the setting's bounds forbid): the UI
        # renders a call-to-action, never a fabricated meter.
        return PaceItem(limit=None, ratio=None, tone="ok", **shared)
    ratio = (window / limit).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)
    soft_ratio = (window / soft_limit).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)
    if soft_ratio > OVER_ABOVE:
        tone = "over"
    elif soft_ratio >= WARN_AT:
        tone = "warn"
    else:
        tone = "ok"
    return PaceItem(
        limit=limit,
        ratio=ratio,
        tone=tone,
        soft_limit=soft_limit,
        soft_ratio=soft_ratio,
        projected_excess=max(ZERO, projected - soft_limit),
        **shared,
    )
