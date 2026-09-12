"""Deterministic, dated metric receipts consumed by pages, exports and assistant tools."""

from datetime import date
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.metrics import (
    ExcludedMonth,
    MetricComponent,
    MetricEvidence,
    MetricWindow,
    SpendingMetricsOut,
)
from app.services.month_review import ReviewBook, load_review_book, month_shift
from app.services.paycheck_calc import half_up2
from app.services.review_input_v1 import revision
from app.services.savings import MonthSavings, load_month_savings, rollup

ZERO = Decimal("0.00")
STATE_LABELS = {
    "not_started": "No entries",
    "in_progress": "In progress",
    "ready_to_review": "Not yet closed",
    "needs_review": "Inputs changed after review/adoption",
    "unreviewed_history": "Ambiguous or missing historical spending",
    "closed": "Unavailable",
}


def window_rows(
    rows: list[MonthSavings],
    book: ReviewBook,
    focus: date,
    *,
    inclusive: bool = False,
    matched: bool = False,
    count: int = 12,
) -> tuple[list[MonthSavings], MetricWindow]:
    """A fixed calendar window. Missing/ineligible months never pull older rows in."""
    start = month_shift(focus, -count + (1 if inclusive else 0))
    end = focus if inclusive else month_shift(focus, -1)
    by_month = {row.month: row for row in rows}
    included, excluded, selected = [], [], []
    legacy = 0
    for i in range(count):
        month = month_shift(start, i)
        state = book.months.get(month)
        row = by_month.get(month)
        eligible = state and (state.eligible_savings if matched else state.eligible_spending)
        if eligible and row and row.has_spending_rows and (not matched or row.matched):
            selected.append(row)
            included.append(month)
            legacy += int(state.state == "unreviewed_history")
        else:
            reason = (
                "No spending entries" if state is None or row is None else STATE_LABELS[state.state]
            )
            if (
                state
                and state.eligible_spending
                and matched
                and (row is None or row.net_pay is None)
            ):
                reason = "Take-home pay is missing"
            excluded.append(ExcludedMonth(month=month, reason=reason))
    return selected, MetricWindow(
        from_month=start,
        to_month=end,
        included=included,
        excluded=excluded,
        unreviewed_history_count=legacy,
    )


def planning_window(
    rows: list[MonthSavings], book: ReviewBook
) -> tuple[list[MonthSavings], MetricWindow | None]:
    if book.default_month is None:
        return [], None
    return window_rows(rows, book, book.default_month, inclusive=True, matched=True)


def category_comparison(
    book: ReviewBook, category_id: int, focus: date
) -> tuple[Decimal | None, int]:
    """The same prior-calendar eligibility policy, retaining missing category cells."""
    values = []
    for offset in range(-12, 0):
        month = month_shift(focus, offset)
        state = book.months.get(month)
        if not state or not state.eligible_spending:
            continue
        entry = next(
            (item for item in book.inputs[month]["spending"] if item["category_id"] == category_id),
            None,
        )
        if entry is not None:
            values.append(entry["amount"])
    count = len(values)
    return (half_up2(sum(values, ZERO) / count) if count else None), count


def average_evidence(
    rows: list[MonthSavings],
    book: ReviewBook,
    focus: date,
    *,
    inclusive: bool = False,
) -> MetricEvidence:
    selected, window = window_rows(rows, book, focus, inclusive=inclusive)
    count = len(selected)
    value = half_up2(sum((row.living_spend for row in selected), ZERO) / count) if count else None
    return MetricEvidence(
        id="living_spending_rolling_average" if inclusive else "living_spending_comparison_average",
        label="Rolling 12-month living average"
        if inclusive
        else "Previous 12 months living average",
        definition=(
            "Mean living spending in eligible months within the 12 calendar months "
            "ending at the selected month."
            if inclusive
            else "Mean living spending in eligible months within the 12 calendar months "
            "before the selected month; the selected month is excluded."
        ),
        value=value,
        window=window,
        completeness=(
            "unavailable"
            if not count
            else "mixed"
            if window.unreviewed_history_count
            else "incomplete"
            if window.excluded
            else "complete"
        ),
        components=[
            MetricComponent(label=f"Living spending · {row.month:%b %Y}", value=row.living_spend)
            for row in selected
        ],
        source_link=f"/spending?month={focus:%Y-%m-01}",
        source_label="Monthly spending entries",
        as_of=book.today,
        warnings=(
            (
                [f"{window.unreviewed_history_count} included months are unreviewed history."]
                if window.unreviewed_history_count
                else []
            )
            + (
                [
                    f"{len(window.excluded)} calendar months are excluded; "
                    "older months do not replace them."
                ]
                if window.excluded
                else []
            )
        ),
    )


async def load_spending_metrics(db: AsyncSession, month: date | None = None) -> SpendingMetricsOut:
    book = await load_review_book(db, extra_months=[month] if month else None)
    selected_month = month or book.default_month
    anchor = selected_month or book.today.replace(day=1)
    rows = await load_month_savings(db)
    state = book.months.get(selected_month) if selected_month else None
    row = next((row for row in rows if row.month == selected_month), None)
    completeness = (
        "unavailable"
        if row is None
        else "complete"
        if state and state.state == "closed"
        else "unreviewed_history"
        if state and state.legacy_eligible
        else "incomplete"
    )
    source = f"/spending?month={anchor:%Y-%m-01}"
    warnings = []
    if state and not state.eligible_spending:
        warnings.append("This month is not eligible for completed-month comparisons.")
    if row and row.net_pay is None:
        warnings.append("Take-home pay is missing; savings are unavailable.")
    monthly_window = MetricWindow(
        from_month=anchor,
        to_month=anchor,
        included=[anchor] if row else [],
        excluded=[],
        unreviewed_history_count=int(bool(state and state.legacy_eligible)),
    )
    living = row.living_spend if row and row.has_spending_rows else None
    tax = row.tax_paid if row and row.has_spending_rows else None
    transfer = row.transfers if row and row.has_spending_rows else None
    outflow = living + tax if living is not None and tax is not None else None
    cash = row.cash_savings if row and row.matched else None
    payroll = row.payroll_savings if row and row.net_pay is not None else None
    total = row.total_savings if row and row.matched else None
    pay = row.net_pay if row else None
    definitions = [
        (
            "living_spending",
            "Living spending",
            living,
            "USD",
            "Sum of categories classified as living. Tax paid from take-home "
            "and transfers are excluded.",
            [],
        ),
        (
            "tax_paid_from_take_home",
            "Tax paid from take-home",
            tax,
            "USD",
            "Sum of tax categories. Payroll withholding never reached take-home and is separate.",
            [],
        ),
        (
            "transfers",
            "Transfers",
            transfer,
            "USD",
            "Amounts classified as transfers remain within the household "
            "and are excluded from cash outflow.",
            [],
        ),
        (
            "cash_outflow",
            "Cash outflow",
            outflow,
            "USD",
            "Living spending plus tax paid from take-home; transfers are excluded.",
            [("Living spending", living), ("Tax paid from take-home", tax)],
        ),
        (
            "all_category_entries",
            "All category entries",
            outflow + transfer if outflow is not None and transfer is not None else None,
            "USD",
            "The raw sum of every category, including living, tax and transfer entries.",
            [
                ("Living spending", living),
                ("Tax paid from take-home", tax),
                ("Transfers", transfer),
            ],
        ),
        (
            "net_pay",
            "Take-home pay",
            pay,
            "USD",
            "Entered household take-home pay for this month. "
            "Missing pay is distinct from an entered zero.",
            [],
        ),
        (
            "cash_saved",
            "Cash saved",
            cash,
            "USD",
            "Take-home pay minus cash outflow. Requires both spending entries and take-home pay.",
            [("Take-home pay", pay), ("Cash outflow", outflow)],
        ),
        (
            "payroll_savings",
            "Employee payroll savings",
            payroll,
            "USD",
            "Employee 401(k), ESPP and HSA deductions from each person's payroll profile "
            "effective on the first of this month, converted to monthly amounts. "
            "Employer contributions are excluded.",
            [],
        ),
        (
            "total_saved",
            "Total saved",
            total,
            "USD",
            "Cash saved plus employee payroll savings. Employer contributions are excluded.",
            [("Cash saved", cash), ("Employee payroll savings", payroll)],
        ),
        (
            "cash_savings_rate",
            "Cash savings rate",
            row.cash_rate if row and row.matched else None,
            "ratio",
            "Cash saved divided by take-home pay. Undefined when take-home pay is zero or missing.",
            [("Cash saved", cash), ("Take-home pay", pay)],
        ),
        (
            "total_savings_rate",
            "Total savings rate",
            row.total_rate if row and row.matched else None,
            "ratio",
            "Total saved divided by take-home pay plus employee payroll savings. "
            "Undefined when take-home pay is zero or missing.",
            [("Total saved", total), ("Take-home pay", pay), ("Employee payroll savings", payroll)],
        ),
    ]
    metrics = [
        MetricEvidence(
            id=key,
            label=label,
            definition=definition,
            value=value,
            unit=unit,
            window=monthly_window,
            completeness="unavailable" if value is None else completeness,
            components=[MetricComponent(label=label, value=value) for label, value in components],
            source_link=source,
            source_label="Household spending and take-home entries",
            as_of=book.today,
            warnings=warnings
            + (
                ["Payroll savings are estimated from effective-dated profiles."]
                if key in {"payroll_savings", "total_saved", "total_savings_rate"}
                else []
            ),
        )
        for key, label, value, unit, definition, components in definitions
    ]
    # Period rates are ratios of summed cash/pay over the SAME eligible months, never
    # the mean of monthly percentages. The assistant receives the precomputed result.
    matched, matched_window = window_rows(rows, book, anchor, inclusive=True, matched=True)
    period = rollup(matched)
    metrics.append(
        MetricEvidence(
            id="rolling_cash_savings_rate",
            label="Rolling cash savings rate",
            definition=(
                "Sum of cash saved divided by summed take-home pay over the same "
                "eligible matched months in the 12-calendar-month window."
            ),
            value=period.cash_rate,
            unit="ratio",
            window=matched_window,
            completeness="unavailable"
            if period.cash_rate is None
            else "mixed"
            if matched_window.unreviewed_history_count
            else "incomplete"
            if matched_window.excluded
            else "complete",
            components=[
                MetricComponent(label="Cash saved", value=period.cash_savings),
                MetricComponent(label="Take-home pay", value=period.net_pay),
            ],
            source_link=source,
            source_label="Matched household spending and take-home entries",
            as_of=book.today,
        )
    )
    return SpendingMetricsOut(
        month=selected_month,
        input_revision=revision(
            {
                str(month): {
                    "inputs": item.input_revision,
                    "state": item.state,
                    "spending": item.eligible_spending,
                    "savings": item.eligible_savings,
                }
                for month, item in book.months.items()
                if month_shift(anchor, -12) <= month <= anchor
            }
        )
        if state
        else None,
        review=state,
        metrics=metrics,
        comparison=average_evidence(rows, book, anchor),
        rolling=average_evidence(rows, book, anchor, inclusive=True),
    )
