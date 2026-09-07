"""Contribution pace against the year's entered limits (2026-08-27 spec §4.5).

Pure module — no DB, no HTTP, no clock (the paycheck_calc / tax_service posture). The
caller decides WHICH year's limits to hand over and WHOSE profile to measure; `profile`
is a paycheck_profiles row, or anything carrying its columns.

Every figure is ANNUALIZED from the profile in force, which is a projection and not a
year-to-date total: this says "at this rate you would put in X", never "you have put in
X". The app has no per-paycheck ledger, so a mid-year percentage change is invisible
here — the strip is a pace indicator and its copy says so.

Rounding contract: `annualized` is quantized to cents FIRST and the ratio is computed
from THAT, then quantized to 4 dp, and the tone is judged on the quantized ratio. So the
percentage on screen is exactly the two numbers beside it divided, and a 94.996 % that
prints as 95.00 % can never be labelled `ok` — the paycheck router's "judged on the
DISPLAYED net, so the warning can never contradict the number next to it" rule.

The division needs no zero guard: contribution_limits carries CHECK (value > 0), and the
router mirrors it with a 422, so a stored limit of zero is unrepresentable.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.limit_keys import (
    HSA_LIMIT_KEY_BY_COVERAGE,
    LIMIT_401K_ELECTIVE,
    LIMIT_415C_TOTAL,
    LIMIT_ESPP_423,
    LIMIT_LABELS,
)
from app.services.paycheck_calc import half_up2

ZERO = Decimal("0")
RATIO_QUANTUM = Decimal("0.0001")
WARN_AT = Decimal("0.95")
OVER_ABOVE = Decimal("1")
# The 415(c) row names the one thing this app cannot see: employer match and profit
# sharing count against the same cap and are modeled nowhere (spec §6 caveat). The
# caveat rides the LABEL rather than a footnote so it cannot be separated from the meter.
TOTAL_ADDITIONS_CAVEAT = " (excludes employer match)"
# Its opposite, once a policy IS on the profile (2026-09-06 spec §2.1). The caveat rides the
# LABEL either way, so neither sentence can ever be separated from the meter it qualifies.
TOTAL_ADDITIONS_MATCH = " (incl. employer match)"
# The HSA row's own version, once an employer policy is on the profile (2026-09-07 spec).
# Short, because the figure rides the row beside it: the meter says the cap includes money
# the user never sees on a payslip, and the panel prints how much.
HSA_INCL_EMPLOYER = " (incl. employer)"


@dataclass(frozen=True)
class PaceHalf:
    """One purchase-year contribution window on the ESPP row (2026-09-06 spec §1.6).

    `source` is 'entered' (the stored period's own contribution, for a purchase that has
    already happened) or 'estimated'; `basis` names how an estimate was built — 'paydays' for
    a semi-monthly profile, 'months' for the per-month approximation — and is None on an
    entered half, which was never estimated at all.
    """

    label: str
    start: date
    end: date
    amount: Decimal
    source: str
    basis: str | None


@dataclass(frozen=True)
class PaceItem:
    """One contribution line, annualized, against the cap the user entered for the year.

    `limit` and `ratio` are None together and mean "nothing entered for this key this
    year". `tone` is then 'ok' in the sense of "no verdict" — the UI renders a
    call-to-action instead of a meter, never a fabricated 100 %.
    """

    key: str
    label: str
    annualized: Decimal
    limit: Decimal | None
    ratio: Decimal | None
    tone: str  # 'ok' | 'warn' | 'over'
    # Everything below is null on every row but the one that needs it, so ONE wire shape
    # serves four different meters (spec §1.6 / §2.3).
    measure: str = "annualized"  # 'annualized' | 'window' (ESPP: the purchase-year window)
    soft_limit: Decimal | None = None  # ESPP: limit x (1 - discount), the practical cap
    soft_ratio: Decimal | None = None  # ESPP: annualized / soft_limit — the tone is judged here
    window_label: str | None = None
    halves: list[PaceHalf] | None = None
    backfilled_from: date | None = None
    projected_full_year: Decimal | None = None
    projected_excess: Decimal | None = None
    current_rate: Decimal | None = None  # ESPP: the espp_pct the projection used (9 dp fraction)
    employer_match: Decimal | None = None  # 415(c) only, and only when it is > 0
    employer_hsa: Decimal | None = None  # HSA only, and only when it is > 0
    # What is already behind today, against `annualized`'s projected year end (spec §2.6).
    # None on a row nobody walked — the pure callers, whose figure is still "a year at this
    # rate" and has no past to point at.
    so_far: Decimal | None = None


def _item(
    key: str,
    label: str,
    annualized: Decimal,
    limits: dict[str, Decimal],
    employer_match: Decimal | None = None,
    employer_hsa: Decimal | None = None,
) -> PaceItem:
    money = half_up2(annualized)
    limit = limits.get(key)
    if limit is None:
        return PaceItem(
            key=key,
            label=label,
            annualized=money,
            limit=None,
            ratio=None,
            tone="ok",
            employer_match=employer_match,
            employer_hsa=employer_hsa,
        )
    ratio = (money / limit).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)
    if ratio > OVER_ABOVE:
        tone = "over"
    elif ratio >= WARN_AT:
        tone = "warn"
    else:
        tone = "ok"
    return PaceItem(
        key=key,
        label=label,
        annualized=money,
        limit=limit,
        ratio=ratio,
        tone=tone,
        employer_match=employer_match,
        employer_hsa=employer_hsa,
    )


def employer_match(profile, elective_annual: Decimal, limit: Decimal | None) -> Decimal:
    """The employer 401(k) match a profile's policy earns on a year of deferrals.

    `elective_annual` is traditional + Roth; after-tax contributions are never matched. The
    cap exists because payroll STOPS deferrals at the 402(g) limit and the match follows
    actual contributions — None when no limit is on file, which measures the uncapped rate,
    the honest "at this rate" answer. Full precision: the caller owns the rounding.
    """
    capped = elective_annual if limit is None else min(elective_annual, limit)
    first = min(capped, profile.match_band_1)
    second = min(max(capped - profile.match_band_1, ZERO), profile.match_band_2)
    return profile.match_rate_1 * first + profile.match_rate_2 * second


def employer_hsa(profile, hsa_coverage: str) -> Decimal:
    """A year of employer HSA deposits under this profile's policy.

    A flat annual figure for the employee's own coverage plus a per-head add-on for each
    ADDITIONAL covered individual — the shape of the real policy this was built for (2,000
    a year self-only, deposited in January, plus 500 per extra individual). It is annual,
    not per check, because the deposit lands as a lump: the pace strip only ever needs the
    year's total.

    Zero when coverage is 'none' or unrecognized — no HDHP is no HSA, so the policy is
    money that never arrives, and `paycheck_pace` drops the row for exactly the same
    reason. Full precision: the caller owns the rounding.
    """
    if hsa_coverage not in HSA_LIMIT_KEY_BY_COVERAGE:
        return ZERO
    return profile.hsa_employer_annual + profile.hsa_employer_per_dependent * Decimal(
        profile.hsa_dependents
    )


def paycheck_pace(profile, limits: dict[str, Decimal], hsa_coverage: str) -> list[PaceItem]:
    """The rows the Paycheck page's pace strip renders, in display order.

    Two rows are unconditional — a zero deferral is information ("you are putting in
    nothing"), and both 401(k) caps apply to everyone with a paycheck. The other two are
    OPT-IN and disappear when the opt-in is absent, because a 0-of-25,000 meter is noise.
    """
    salary = profile.annual_salary
    elective_pct = profile.trad_401k_pct + profile.roth_401k_pct
    elective = elective_pct * salary
    # The 415(c) leg uses the CAPPED elective, because that is what actually lands in the
    # plan; the elective row above keeps the uncapped pace, because going over IS its news.
    elective_cap = limits.get(LIMIT_401K_ELECTIVE)
    capped_elective = elective if elective_cap is None else min(elective, elective_cap)
    # Quantized BEFORE it joins the sum, so the "incl. {employer_match} match" suffix is
    # exactly the addend behind the total and the two can never disagree by a cent.
    match = half_up2(employer_match(profile, elective, elective_cap))
    has_policy = profile.match_band_1 > ZERO or profile.match_band_2 > ZERO
    items = [
        _item(LIMIT_401K_ELECTIVE, LIMIT_LABELS[LIMIT_401K_ELECTIVE], elective, limits),
        _item(
            LIMIT_415C_TOTAL,
            LIMIT_LABELS[LIMIT_415C_TOTAL]
            + (TOTAL_ADDITIONS_MATCH if has_policy else TOTAL_ADDITIONS_CAVEAT),
            capped_elective + profile.after_tax_401k_pct * salary + match,
            limits,
            # Null unless there is something to say: a policy that earns nothing this year
            # renames the row (it exists) and shows no figure (it paid nothing).
            employer_match=match if match > ZERO else None,
        ),
    ]
    # 'none' is not a zero-dollar HSA — it is "no HDHP", so NEITHER cap applies. An
    # unrecognized string (hand-edited row) lands here too and is treated the same way:
    # picking one of the two tiers at random is the worst possible guess, and the two
    # differ by roughly 2x.
    hsa_key = HSA_LIMIT_KEY_BY_COVERAGE.get(hsa_coverage)
    if hsa_key is not None:
        # Quantized BEFORE it joins the sum (the match's rule), so the "incl. X employer"
        # suffix is exactly the addend behind the total and the two can never disagree by
        # a cent.
        deposit = half_up2(employer_hsa(profile, hsa_coverage))
        items.append(
            _item(
                hsa_key,
                # The employer's deposit counts against the SAME cap, so a row that leaves
                # it out could never reach 100 % — the label owns that news, like 415(c)'s.
                LIMIT_LABELS[hsa_key] + (HSA_INCL_EMPLOYER if deposit > ZERO else ""),
                # Per-check DOLLARS times the profile's own cadence — never a hardcoded
                # 24 (paycheck_calc's rule) — plus the year's employer deposit.
                profile.hsa_per_check * Decimal(profile.pay_periods_per_year) + deposit,
                limits,
                # Null unless there is something to say: no policy renders exactly the row
                # it rendered before there was one.
                employer_hsa=deposit if deposit > ZERO else None,
            )
        )
    # espp_pct 0 is "not enrolled", which is a different statement from "enrolled at 0 %".
    if profile.espp_pct > ZERO:
        items.append(
            _item(LIMIT_ESPP_423, LIMIT_LABELS[LIMIT_ESPP_423], profile.espp_pct * salary, limits)
        )
    return items
