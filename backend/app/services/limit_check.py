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


def _item(key: str, label: str, annualized: Decimal, limits: dict[str, Decimal]) -> PaceItem:
    money = half_up2(annualized)
    limit = limits.get(key)
    if limit is None:
        return PaceItem(key=key, label=label, annualized=money, limit=None, ratio=None, tone="ok")
    ratio = (money / limit).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)
    if ratio > OVER_ABOVE:
        tone = "over"
    elif ratio >= WARN_AT:
        tone = "warn"
    else:
        tone = "ok"
    return PaceItem(key=key, label=label, annualized=money, limit=limit, ratio=ratio, tone=tone)


def paycheck_pace(profile, limits: dict[str, Decimal], hsa_coverage: str) -> list[PaceItem]:
    """The rows the Paycheck page's pace strip renders, in display order.

    Two rows are unconditional — a zero deferral is information ("you are putting in
    nothing"), and both 401(k) caps apply to everyone with a paycheck. The other two are
    OPT-IN and disappear when the opt-in is absent, because a 0-of-25,000 meter is noise.
    """
    salary = profile.annual_salary
    elective_pct = profile.trad_401k_pct + profile.roth_401k_pct
    items = [
        _item(
            LIMIT_401K_ELECTIVE,
            LIMIT_LABELS[LIMIT_401K_ELECTIVE],
            elective_pct * salary,
            limits,
        ),
        _item(
            LIMIT_415C_TOTAL,
            LIMIT_LABELS[LIMIT_415C_TOTAL] + TOTAL_ADDITIONS_CAVEAT,
            (elective_pct + profile.after_tax_401k_pct) * salary,
            limits,
        ),
    ]
    # 'none' is not a zero-dollar HSA — it is "no HDHP", so NEITHER cap applies. An
    # unrecognized string (hand-edited row) lands here too and is treated the same way:
    # picking one of the two tiers at random is the worst possible guess, and the two
    # differ by roughly 2x.
    hsa_key = HSA_LIMIT_KEY_BY_COVERAGE.get(hsa_coverage)
    if hsa_key is not None:
        items.append(
            _item(
                hsa_key,
                LIMIT_LABELS[hsa_key],
                # Per-check DOLLARS times the profile's own cadence — never a hardcoded
                # 24 (paycheck_calc's rule). Employer HSA contributions count against the
                # same cap and are not on the profile; the strip's hint says so.
                profile.hsa_per_check * Decimal(profile.pay_periods_per_year),
                limits,
            )
        )
    # espp_pct 0 is "not enrolled", which is a different statement from "enrolled at 0 %".
    if profile.espp_pct > ZERO:
        items.append(
            _item(LIMIT_ESPP_423, LIMIT_LABELS[LIMIT_ESPP_423], profile.espp_pct * salary, limits)
        )
    return items
