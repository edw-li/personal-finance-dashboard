"""The ONE definition of savings (2026-09-04 honest-numbers spec §2).

Every page that says "saved" reads this module. Before it, four files each had their own
sentence: the matrix subtracted every category from net pay, the yearly rollup did the
same over a different window, the projection averaged a third window, and none of them
counted the 401(k)/ESPP/HSA money that never reaches net pay at all.

Per calendar month with a spending or cashflow row:

    living_spend    = sum of amounts over categories with kind 'living'
    tax_paid        = same over 'tax'      (income tax paid FROM take-home)
    transfers       = same over 'transfer' (money that stayed yours)
    cash_savings    = net_pay - living_spend - tax_paid       (None without net pay)
    payroll_savings = per person, the saving lines of the profile in force on the 1st
                                                              (None without net pay)
    total_savings   = cash_savings + payroll_savings          (None without net pay)
    cash_rate       = cash_savings / net_pay                  (None without net pay, or 0)
    total_rate      = total_savings / (net_pay + payroll_savings)          (same guard)

ROUNDING CONTRACT (spec §2, amended 2026-09-04). Every per-MONTH figure this module emits
is cents, ROUND_HALF_UP, via `half_up2`: each person's monthly payroll figure first (so
per-person rows a caller echoes sum exactly), then the month's own totals. Every PERIOD
scalar — `rollup`'s fields, and the projection's derived contribution and annual spend —
is built from those EMITTED month figures, never from a re-rounded raw sum: sum the
months, then (for a mean) divide and quantize exactly once at the end. The two rates are
quantized to the wire's 6dp. Callers add no rounding of their own.

The invariant this buys: `YearRollup.payroll_savings` equals the sum of
`MatrixOut.payroll_savings` over that year's matched months, to the cent, always.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MonthlyCashflow, MonthlySpending, PaycheckProfile, SpendingCategory
from app.services.money import quantize_pct
from app.services.paycheck_calc import MONTHS_PER_YEAR, PAYROLL_SAVING_KEYS, breakdown, half_up2

ZERO = Decimal("0.00")
LIVING = "living"
TAX = "tax"
TRANSFER = "transfer"
KINDS = (LIVING, TAX, TRANSFER)
# api.paycheck.MIN_PAY_PERIODS's fence, repeated as a plain int rather than imported: a
# service must not import a router. gross = salary / periods, so a stored 0 would be a
# DivisionByZero 500 inside `breakdown` — here it simply contributes nothing.
MIN_PAY_PERIODS = 1


@dataclass(frozen=True)
class MonthSavings:
    """One calendar month, every figure already in cents (rates at 6dp)."""

    month: date
    living_spend: Decimal
    tax_paid: Decimal
    transfers: Decimal
    net_pay: Decimal | None
    # None, not 0.00, when net_pay is None: a month nobody entered pay for has no
    # deductions ON RECORD, and printing $0.00 saved for it is the exact dishonesty this
    # program removes. Every sibling savings figure is None there too (spec §2).
    payroll_savings: Decimal | None
    cash_savings: Decimal | None
    total_savings: Decimal | None
    cash_rate: Decimal | None
    total_rate: Decimal | None
    has_spending_rows: bool

    @property
    def matched(self) -> bool:
        """Both halves of the month are on file, so it can be AVERAGED.

        Spending rows AND a net-pay row. A confirmed all-zero month with net pay counts —
        it is a real month of spending nothing. A net-pay-only month does not: there is
        no spend to average, and treating it as a $0 month is precisely the lie this
        program removes (health_checks names such a month instead).
        """
        return self.has_spending_rows and self.net_pay is not None


@dataclass(frozen=True)
class PeriodSavings:
    """A rollup over MATCHED months only — `net_pay` is those months' pay, i.e. the
    rates' honest denominator, never the period's full net-pay total."""

    months_matched: int
    living_spend: Decimal
    tax_paid: Decimal
    transfers: Decimal
    net_pay: Decimal
    payroll_savings: Decimal
    cash_savings: Decimal | None
    total_savings: Decimal | None
    cash_rate: Decimal | None
    total_rate: Decimal | None


def payroll_monthly(profile) -> Decimal:
    """One profile's payroll-deducted savings per MONTH, at full precision: the five
    saving lines of `breakdown` per check × the profile's cadence ÷ 12 (the `monthly_net`
    rule). Moved here from api/projection.py, which imports it back."""
    lines = breakdown(profile)
    per_check = sum((lines[key] for key in PAYROLL_SAVING_KEYS), Decimal(0))
    return per_check * Decimal(profile.pay_periods_per_year) / MONTHS_PER_YEAR


def payroll_by_month(
    profiles: Sequence[PaycheckProfile], months: Sequence[date]
) -> dict[date, Decimal]:
    """Σ over people of the profile in force on the 1st of each month, in cents.

    `months` must be ascending; one sorted walk per person, no queries (the table is
    tiny). NO future-profile fallback — that is `_default_profile`'s rule for TODAY's
    paycheck, and applying it to history would credit a January that predates the job.
    A person with no profile in force contributes 0 (spec §6). Each person's figure is
    rounded to cents BEFORE summing, so a caller echoing per-person rows sums exactly,
    and the month's total is emitted in cents too (the rounding contract above).
    """
    by_person: dict[int, list[PaycheckProfile]] = {}
    for profile in profiles:
        if profile.pay_periods_per_year < MIN_PAY_PERIODS:
            continue
        by_person.setdefault(profile.person_id, []).append(profile)
    totals = {month: ZERO for month in months}
    for history in by_person.values():
        history.sort(key=lambda p: p.effective_date)
        pointer = 0
        current: PaycheckProfile | None = None
        for month in months:
            while pointer < len(history) and history[pointer].effective_date <= month:
                current = history[pointer]
                pointer += 1
            if current is not None:
                totals[month] += half_up2(payroll_monthly(current))
    return {month: half_up2(total) for month, total in totals.items()}


def month_savings(
    month: date,
    by_kind: Mapping[str, Decimal] | None,
    net_pay: Decimal | None,
    payroll: Decimal,
) -> MonthSavings:
    """`by_kind` is None when the month has NO spending rows at all — distinct from a
    month whose rows are all $0.00, which is a mapping of zeros."""
    kinds = by_kind or {}
    # The rounding contract: every figure this function EMITS is cents, so a period
    # scalar can be the plain SUM of its months and still agree with the wire.
    living = half_up2(kinds.get(LIVING, ZERO))
    tax = half_up2(kinds.get(TAX, ZERO))
    transfer = half_up2(kinds.get(TRANSFER, ZERO))
    payroll = half_up2(payroll)
    if net_pay is None:
        # No pay on file means no deductions on file either (spec §2): payroll savings
        # are UNKNOWN — None, not 0.00 and not last month's guess.
        return MonthSavings(
            month=month,
            living_spend=living,
            tax_paid=tax,
            transfers=transfer,
            net_pay=None,
            payroll_savings=None,
            cash_savings=None,
            total_savings=None,
            cash_rate=None,
            total_rate=None,
            has_spending_rows=by_kind is not None,
        )
    cash = half_up2(net_pay - living - tax)
    total = half_up2(cash + payroll)
    # ONE guard for both rates (spec §2): a month with no take-home has no denominator,
    # and a payroll-only rate would print a flattering number for a month with no pay.
    # The rates read the EMITTED cash/total, so the wire's percentage matches the wire's
    # dollars rather than a shadow figure at full precision.
    rates_defined = net_pay != 0
    return MonthSavings(
        month=month,
        living_spend=living,
        tax_paid=tax,
        transfers=transfer,
        net_pay=net_pay,
        payroll_savings=payroll,
        cash_savings=cash,
        total_savings=total,
        cash_rate=quantize_pct(cash / net_pay) if rates_defined else None,
        total_rate=quantize_pct(total / (net_pay + payroll)) if rates_defined else None,
        has_spending_rows=by_kind is not None,
    )


def compose_months(
    months: Sequence[date],
    by_kind: Mapping[date, Mapping[str, Decimal]],
    net_pay: Mapping[date, Decimal],
    payroll: Mapping[date, Decimal],
) -> list[MonthSavings]:
    """One `MonthSavings` per month, in `months` order. Presence in `by_kind` IS "this
    month has spending rows"."""
    return [
        month_savings(month, by_kind.get(month), net_pay.get(month), payroll.get(month, ZERO))
        for month in months
    ]


def rollup(rows: Sequence[MonthSavings]) -> PeriodSavings:
    """Sum the MATCHED months — the EMITTED cent figures, never a re-rounded raw sum, so
    a year's payroll savings is exactly the months the matrix showed. Nothing matched =
    zeros and nulls, never a division."""
    matched = [row for row in rows if row.matched]
    living = sum((row.living_spend for row in matched), ZERO)
    tax = sum((row.tax_paid for row in matched), ZERO)
    transfer = sum((row.transfers for row in matched), ZERO)
    net_pay = sum((row.net_pay for row in matched if row.net_pay is not None), ZERO)
    # `matched` implies net_pay is not None, so payroll is never None here; the guard
    # states that rather than relying on the reader to re-derive it.
    payroll = sum((row.payroll_savings for row in matched if row.payroll_savings is not None), ZERO)
    if not matched:
        return PeriodSavings(0, living, tax, transfer, net_pay, payroll, None, None, None, None)
    cash = net_pay - living - tax
    total = cash + payroll
    rates_defined = net_pay != 0
    return PeriodSavings(
        months_matched=len(matched),
        living_spend=living,
        tax_paid=tax,
        transfers=transfer,
        net_pay=net_pay,
        payroll_savings=payroll,
        cash_savings=cash,
        total_savings=total,
        cash_rate=quantize_pct(cash / net_pay) if rates_defined else None,
        total_rate=quantize_pct(total / (net_pay + payroll)) if rates_defined else None,
    )


def matched_months(rows: Sequence[MonthSavings], limit: int) -> list[MonthSavings]:
    """The LAST `limit` matched months, still ascending — the derivation window."""
    matched = [row for row in rows if row.matched]
    return matched[-limit:] if limit > 0 else matched


async def load_payroll_by_month(db: AsyncSession, months: Sequence[date]) -> dict[date, Decimal]:
    profiles = list((await db.execute(select(PaycheckProfile))).scalars().all())
    return payroll_by_month(profiles, months)


async def load_month_savings(db: AsyncSession) -> list[MonthSavings]:
    """Every month with a spending or cashflow row, ascending. Three queries."""
    kind_rows = (
        await db.execute(
            select(MonthlySpending.month, SpendingCategory.kind, func.sum(MonthlySpending.amount))
            .join(SpendingCategory, SpendingCategory.id == MonthlySpending.category_id)
            .group_by(MonthlySpending.month, SpendingCategory.kind)
        )
    ).all()
    by_kind: dict[date, dict[str, Decimal]] = {}
    for month, kind, total in kind_rows:
        by_kind.setdefault(month, {})[kind] = Decimal(total)
    net_pay = {
        row.month: row.net_pay for row in (await db.execute(select(MonthlyCashflow))).scalars()
    }
    months = sorted(set(by_kind) | set(net_pay))
    return compose_months(months, by_kind, net_pay, await load_payroll_by_month(db, months))
