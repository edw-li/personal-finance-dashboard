"""The paycheck sheet's per-check waterfall.

Pure module — no DB, no HTTP, no FastAPI (the tax_service / espp_calc posture). It also
reads no clock: which profile is "current" is the endpoint's decision, never this
module's.

The chain runs at FULL precision and quantizes nothing, because `net_pay` is the
authoritative line and the DISPLAYED lines do not reconcile to it: on the real profile
4486.26 - 0.00 - 236.16 - 865.93 = 3384.17 against a true net of 3384.16. The router maps
every line through `half_up2` on the way out, which is the sheet's own display rounding.

Preconditions (enforced at the API boundary, not here): `pay_periods_per_year` >= 1 — THE
divide-by-zero guard (Plan 1 forward note) — and every pct in [0, 1]. A stored 0 periods
is unrepresentable, so nothing here defends against one.
"""

from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
MONEY_QUANTUM = Decimal("0.01")
MONTHS_PER_YEAR = Decimal("12")
# The eleven lines of one check, in the sheet's waterfall order — exactly the numeric fields
# of schemas.paycheck.BreakdownOut minus the monthly roll-up. The preview endpoint and the
# projection read `breakdown()`'s dict by these names, so the order lives in one place.
WATERFALL_KEYS = (
    "gross",
    "trad_401k",
    "dental_vision",
    "hsa",
    "taxable",
    "withholding",
    "post_tax",
    "roth_401k",
    "after_tax_401k",
    "espp",
    "net_pay",
)
# The paycheck lines that are SAVINGS — money that leaves the check but lands in an account
# the household owns. Dental/vision and withholding are costs; employer match is not
# modeled (limit_check.py's caveat); the take-home itself is what services/savings.py nets
# against spend as `cash_savings`, so it is deliberately not in this tuple. Lives here (not
# in a caller) because the paycheck preview sums it too and services/savings.py reads it for
# `payroll_monthly` — an import the other way would be a cycle.
PAYROLL_SAVING_KEYS = ("trad_401k", "roth_401k", "after_tax_401k", "espp", "hsa")


def half_up2(value: Decimal) -> Decimal:
    """ROUND(x, 2) for a computed OUTPUT: a PLAIN quantize, never money.py's bounded one
    (a GET must never 422/500 on data that is already stored).

    The `+ ZERO` collapses signed zeros — net_pay and monthly_net are genuinely
    negative-capable, so a -1e-9 net would otherwise reach the wire as "-0.00".
    """
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def breakdown(profile) -> dict[str, Decimal]:
    """One paycheck, in the sheet's waterfall order, at full precision.

    `profile` is a `paycheck_profiles` row (or anything with its columns). The keys are
    exactly the numeric fields of `schemas.paycheck.BreakdownOut`, so the router can
    quantize and splat them.

    Two deductions are per-check DOLLAR amounts (dental/vision, HSA) and are echoed
    unchanged — they belong to the waterfall's display even though nothing computes them.
    The pcts split three ways: `trad_401k_pct` is pre-tax (it shrinks `taxable`),
    `withholding_pct` applies to what is left, and roth / after-tax / espp all come out of
    post-tax pay while still being measured against GROSS.
    """
    periods = Decimal(profile.pay_periods_per_year)
    gross = profile.annual_salary / periods
    trad_401k = profile.trad_401k_pct * gross
    dental_vision = profile.dental_vision_per_check
    hsa = profile.hsa_per_check
    taxable = gross - (trad_401k + dental_vision + hsa)
    withholding = profile.withholding_pct * taxable
    post_tax = taxable - withholding
    roth_401k = profile.roth_401k_pct * gross
    after_tax_401k = profile.after_tax_401k_pct * gross
    espp = profile.espp_pct * gross
    net_pay = post_tax - (roth_401k + after_tax_401k + espp)
    return {
        "gross": gross,
        "trad_401k": trad_401k,
        "dental_vision": dental_vision,
        "hsa": hsa,
        "taxable": taxable,
        "withholding": withholding,
        "post_tax": post_tax,
        "roth_401k": roth_401k,
        "after_tax_401k": after_tax_401k,
        "espp": espp,
        "net_pay": net_pay,
        # The sheet's x2 generalized: the cadence is a column here, not a hardcoded 24.
        "monthly_net": net_pay * periods / MONTHS_PER_YEAR,
    }
