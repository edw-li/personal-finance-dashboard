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
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

from app.limit_keys import (
    HSA_LIMIT_KEY_BY_COVERAGE,
    LIMIT_401K_ELECTIVE,
    LIMIT_415C_TOTAL,
    LIMIT_ESPP_423,
    LIMIT_LABELS,
)
from app.services.pace_walk import Walked
from app.services.paycheck_calc import half_up2

ZERO = Decimal("0")
RATIO_QUANTUM = Decimal("0.0001")
# The Pct9 columns' own scale, and the cent: the two grains a "land exactly on the cap"
# target is floored to, so a projection built from one is never a hair OVER the cap.
RATE_QUANTUM = Decimal("0.000000001")
CENTS = Decimal("0.01")
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
# The one tier that covers anybody besides the employee: a per-head add-on can only be
# earned there (review decision 2026-09-07).
FAMILY_COVERAGE = "family"


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
    # The window's TAIL and the elections that land on the cap across it (2026-09-09 audit
    # item 5). `remaining_checks` / `remaining_gross` ride every walked row, because the walk
    # is one walk; the two targets ride the one row each answers for — a total elective RATE
    # (traditional + Roth) on the 402(g) row, an employee per-check AMOUNT on the HSA row.
    # Both are measured against what the walk has already counted, so a preset built from one
    # cannot ask for a full year of contributions in the months that are left. Zero means
    # "there is no room left"; null means the question has no answer here — nothing walked,
    # no cap entered, or no paydays left this year.
    remaining_checks: int | None = None
    remaining_gross: Decimal | None = None
    to_cap_rate: Decimal | None = None
    to_cap_per_check: Decimal | None = None


def _to_cap_rate(
    limit: Decimal | None, so_far: Decimal | None, walked: Walked | None
) -> Decimal | None:
    """The TOTAL elective rate (traditional + Roth) over the window's remaining gross that
    lands exactly on `limit`, given what the walk has already counted.

    FLOORED to the columns' 9 dp, so the projection it builds is at or under the cap and the
    4 dp ratio beside it reads 1.0000 rather than 1.0001. Zero when the cap is already met or
    passed — "stop", which is a real answer and the one a chip needs to disable itself with.
    None when there is nothing to answer with: no walk, no cap entered, or no paydays left.
    """
    if walked is None or so_far is None or limit is None:
        return None
    if walked.remaining_checks <= 0 or walked.remaining_gross <= ZERO:
        return None
    room = max(limit - so_far, ZERO)
    return (room / walked.remaining_gross).quantize(RATE_QUANTUM, rounding=ROUND_FLOOR)


def _to_cap_per_check(
    limit: Decimal | None, so_far: Decimal | None, walked: Walked | None
) -> Decimal | None:
    """`_to_cap_rate`'s twin in DOLLARS: the employee amount per remaining check that lands
    on `limit`. Floored to cents, for the same reason and with the same three nulls."""
    if walked is None or so_far is None or limit is None or walked.remaining_checks <= 0:
        return None
    room = max(limit - so_far, ZERO)
    return (room / Decimal(walked.remaining_checks)).quantize(CENTS, rounding=ROUND_FLOOR)


def _item(
    key: str,
    label: str,
    annualized: Decimal,
    limits: dict[str, Decimal],
    employer_match: Decimal | None = None,
    employer_hsa: Decimal | None = None,
    so_far: Decimal | None = None,
    backfilled_from: date | None = None,
    remaining_checks: int | None = None,
    remaining_gross: Decimal | None = None,
    to_cap_rate: Decimal | None = None,
    to_cap_per_check: Decimal | None = None,
) -> PaceItem:
    money = half_up2(annualized)
    # Quantized HERE and only here, beside the projection it sits under, so the two figures
    # in one row were rounded by one rule.
    walked_so_far = None if so_far is None else half_up2(so_far)
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
            so_far=walked_so_far,
            backfilled_from=backfilled_from,
            remaining_checks=remaining_checks,
            remaining_gross=remaining_gross,
            to_cap_rate=to_cap_rate,
            to_cap_per_check=to_cap_per_check,
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
        so_far=walked_so_far,
        backfilled_from=backfilled_from,
        remaining_checks=remaining_checks,
        remaining_gross=remaining_gross,
        to_cap_rate=to_cap_rate,
        to_cap_per_check=to_cap_per_check,
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

    The per-head term counts only under FAMILY coverage: self-only covers nobody else, so a
    count left on a row that has since dropped to self-only is ignored rather than paid for
    (review decision 2026-09-07). Zero altogether when coverage is 'none' or unrecognized —
    no HDHP is no HSA, so the policy is money that never arrives, and `paycheck_pace` drops
    the row for exactly the same reason. Full precision: the caller owns the rounding.
    """
    if hsa_coverage not in HSA_LIMIT_KEY_BY_COVERAGE:
        return ZERO
    if hsa_coverage != FAMILY_COVERAGE:
        return profile.hsa_employer_annual
    return profile.hsa_employer_annual + profile.hsa_employer_per_dependent * Decimal(
        profile.hsa_dependents
    )


def _total_additions_so_far(policy, walked: Walked, elective_cap: Decimal | None) -> Decimal:
    """415(c) so far: the capped elective already deferred, plus after-tax, plus the match
    those deferrals have already earned — the match follows contributions actually made, so
    it is re-earned on the so-far figure rather than prorated out of the year's, under the
    `policy` that was in force when they were made."""
    elective = walked.so_far["elective"]
    capped = elective if elective_cap is None else min(elective, elective_cap)
    earned = half_up2(employer_match(policy, elective, elective_cap))
    return capped + walked.so_far["after_tax"] + earned


def paycheck_pace(
    profile,
    limits: dict[str, Decimal],
    hsa_coverage: str,
    walked: Walked | None = None,
    base=None,
) -> list[PaceItem]:
    """The rows the Paycheck page's pace strip renders, in display order.

    Two rows are unconditional — a zero deferral is information ("you are putting in
    nothing"), and both 401(k) caps apply to everyone with a paycheck. The other two are
    OPT-IN and disappear when the opt-in is absent, because a 0-of-25,000 meter is noise.

    With a `walked` window (spec §2.6) every figure is the payday walk's: `annualized` is the
    PROJECTED year end and `so_far` is what is already behind today. Without one — the pure
    callers — the rows are exactly what they were before the walk existed: "a year at this
    rate", with a null `so_far`, because a rate has no past to point at.

    `base` is the profile whose EMPLOYER POLICY paid the past — the stored row in force
    before today, which a Try-it knob must not be able to rewrite (spec §2.5). It defaults to
    `profile`, which is the same row on every read but the sandbox's scenario half.
    """
    policy_so_far = profile if base is None else base
    salary = profile.annual_salary
    elective_pct = profile.trad_401k_pct + profile.roth_401k_pct
    elective = elective_pct * salary if walked is None else walked.projected["elective"]
    after_tax = (
        profile.after_tax_401k_pct * salary if walked is None else walked.projected["after_tax"]
    )
    # The 415(c) leg uses the CAPPED elective, because that is what actually lands in the
    # plan; the elective row above keeps the uncapped pace, because going over IS its news.
    elective_cap = limits.get(LIMIT_401K_ELECTIVE)
    capped_elective = elective if elective_cap is None else min(elective, elective_cap)
    # Quantized BEFORE it joins the sum, so the "incl. {employer_match} match" suffix is
    # exactly the addend behind the total and the two can never disagree by a cent.
    match = half_up2(employer_match(profile, elective, elective_cap))
    has_policy = profile.match_band_1 > ZERO or profile.match_band_2 > ZERO
    # One walk, one tail: every row it feeds names the same paydays ahead, so no two rows can
    # disagree about how much year is left to change.
    tail = (
        {}
        if walked is None
        else {
            "remaining_checks": walked.remaining_checks,
            "remaining_gross": walked.remaining_gross,
        }
    )
    elective_so_far = None if walked is None else walked.so_far["elective"]
    items = [
        _item(
            LIMIT_401K_ELECTIVE,
            LIMIT_LABELS[LIMIT_401K_ELECTIVE],
            elective,
            limits,
            so_far=elective_so_far,
            backfilled_from=None if walked is None else walked.backfilled_from,
            # The rate is the row's OWN cap against the row's OWN so-far: traditional and Roth
            # together, because 402(g) counts them together and a preset that moved only one
            # of them would aim at a cap the other half is already eating into.
            to_cap_rate=_to_cap_rate(elective_cap, elective_so_far, walked),
            **tail,
        ),
        _item(
            LIMIT_415C_TOTAL,
            LIMIT_LABELS[LIMIT_415C_TOTAL]
            + (TOTAL_ADDITIONS_MATCH if has_policy else TOTAL_ADDITIONS_CAVEAT),
            capped_elective + after_tax + match,
            limits,
            # Null unless there is something to say: a policy that earns nothing this year
            # renames the row (it exists) and shows no figure (it paid nothing). It is the
            # PROJECTED match either way — it qualifies the figure the meter is judged on.
            employer_match=match if match > ZERO else None,
            so_far=(
                None
                if walked is None
                else _total_additions_so_far(policy_so_far, walked, elective_cap)
            ),
            backfilled_from=None if walked is None else walked.backfilled_from,
            **tail,
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
        # Per-check DOLLARS times the profile's own cadence — never a hardcoded 24
        # (paycheck_calc's rule) — or, walked, the paydays the year actually has.
        employee = (
            profile.hsa_per_check * Decimal(profile.pay_periods_per_year)
            if walked is None
            else walked.projected["hsa_employee"]
        )
        items.append(
            _item(
                hsa_key,
                # The employer's deposit counts against the SAME cap, so a row that leaves
                # it out could never reach 100 % — the label owns that news, like 415(c)'s.
                LIMIT_LABELS[hsa_key] + (HSA_INCL_EMPLOYER if deposit > ZERO else ""),
                employee + deposit,
                limits,
                # Null unless there is something to say: no policy renders exactly the row
                # it rendered before there was one.
                employer_hsa=deposit if deposit > ZERO else None,
                # The deposit lands in ONE January check, so it joins the so-far figure the
                # moment that check has been cut and not a day before (spec §2.6) — at the
                # amount the policy in force THEN deposited, not the one a knob asks for now.
                so_far=(
                    None
                    if walked is None
                    else walked.so_far["hsa_employee"]
                    + (
                        half_up2(employer_hsa(policy_so_far, hsa_coverage))
                        if walked.first_payday_passed
                        else ZERO
                    )
                ),
                backfilled_from=None if walked is None else walked.backfilled_from,
                # The employee amount that lands on the cap. Measured against the deferrals
                # already made PLUS the employer's whole year — the deposit arrives whatever
                # the employee elects, so the room the remaining checks may fill is the cap
                # less both. Never the row's own `so_far`, which counts the deposit only once
                # the January check has been cut: a January reader would otherwise be told to
                # fill room the employer is about to take.
                to_cap_per_check=_to_cap_per_check(
                    limits.get(hsa_key),
                    None if walked is None else walked.so_far["hsa_employee"] + deposit,
                    walked,
                ),
                **tail,
            )
        )
    # espp_pct 0 is "not enrolled", which is a different statement from "enrolled at 0 %".
    # No `so_far` here even when walked: the router replaces this row with the PURCHASE-year
    # one (espp_pace), whose window is not this calendar year and which walks its own.
    if profile.espp_pct > ZERO:
        items.append(
            _item(LIMIT_ESPP_423, LIMIT_LABELS[LIMIT_ESPP_423], profile.espp_pct * salary, limits)
        )
    return items
