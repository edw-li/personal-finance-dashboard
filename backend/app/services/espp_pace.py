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
from app.services.limit_check import OVER_ABOVE, RATIO_QUANTUM, WARN_AT, PaceHalf, PaceItem
from app.services.pace_walk import walk
from app.services.paycheck_calc import half_up2

ZERO = Decimal("0")
ONE = Decimal("1")
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


def _estimate(
    profiles: list, scenario, today: date, start: date, end: date
) -> tuple[Decimal, Decimal, str, date | None]:
    """One window's (amount, so_far, basis, backfilled_from), payday by payday.

    The walk itself is `pace_walk.walk` — ONE payday calendar for every pace row, so this
    window and the 401(k) / HSA rows beside it can never disagree about which paydays a year
    has or who priced them. This reads its 'espp' leg and nothing else.
    """
    walked = walk(profiles, scenario, today, start, end)
    return (
        walked.projected["espp"],
        walked.so_far["espp"],
        walked.basis,
        walked.backfilled_from,
    )


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
    # The window's own §2.6 figure: what is already behind today.
    so_far = ZERO
    for row in rows:
        if row.stored and row.period_end < today:
            # The purchase happened and the user typed the contribution: their number wins
            # over any estimate this module could build (spec §1.3).
            entered = half_up2(
                (row.semi_annual_base + row.additional_payments) * row.contribution_pct
            )
            halves.append(
                PaceHalf(
                    label=row.label,
                    start=row.period_start,
                    end=row.period_end,
                    amount=entered,
                    source="entered",
                    basis=None,
                )
            )
            # Wholly behind us: the purchase is done, so second-guessing it with an estimate
            # of the same months would be the one thing this module must never do.
            so_far += entered
            continue
        amount, half_so_far, basis, backfill = _estimate(
            profiles, scenario_from_today, today, row.period_start, row.period_end
        )
        so_far += half_so_far
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
        "so_far": half_up2(so_far),
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
