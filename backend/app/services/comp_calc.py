"""The Focal History sheet's computed columns for one comp event.

Pure module — no DB, no HTTP, no FastAPI, no clock. Unlike `paycheck_calc` (whose net
must stay full-precision so the displayed lines can disagree with it by a cent), these
columns are independent of each other, so this module quantizes its own outputs the way
`espp_calc.lot_metrics` does: money 2dp, percentages 6dp, both with a PLAIN quantize —
never money.py's bounded quantizers, because a GET must not reject stored data.

Null-tolerance IS the contract. Only `current_base` is NOT NULL, so every other column is
a maybe:
  - a delta needs its "after" value (`new_base`, `refresh_rsus` x `grant_price`),
  - a product needs BOTH operands — a half-filled pair is null, never zero,
  - a ratio needs a non-zero, non-absurd denominator — stored data may hold a zero the
    writer would reject today (defensive: a GET must never 500),
  - but the two TC lines always compute: a missing side simply contributes 0, which is
    what makes the open focal year (base only) render as base -> base.

`tc_before`/`tc_after` are the Plan-5 reading of spec §4's "TC before/after" — the sheet
has no such column. Total comp proxy = base + unvested equity value (the UI labels it
"Base + unvested equity"), with the refresh grant added on the "after" side.
"""

from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
MONEY_QUANTUM = Decimal("0.01")
PCT_QUANTUM = Decimal("0.000001")
# Above this a ratio is nonsense anyway (a near-zero denominator), and quantize_pct would
# need more digits than the Decimal context has — taxes.py's RATE_MAX_ABS, same value.
PCT_MAX_ABS = Decimal("1e12")


def half_up2(value: Decimal) -> Decimal:
    """2dp, with the house `+ ZERO` collapse: a base CUT is a real shape, and a delta
    that rounds to zero from below would otherwise render as "-0.00"."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def pct6(value: Decimal) -> Decimal:
    """6dp, same collapse: a one-cent cut against a six-figure base is -6e-8, i.e.
    Decimal("-0.000000")."""
    return value.quantize(PCT_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def _product(left: Decimal | None, right: Decimal | None) -> Decimal | None:
    """Full precision, and null unless BOTH operands are there."""
    return None if left is None or right is None else left * right


def _ratio(numerator: Decimal | None, denominator: Decimal | None) -> Decimal | None:
    """A 6dp percentage, or null when it cannot be one.

    Null on a missing/zero denominator (the plan's contract) — and ALSO past
    `PCT_MAX_ABS`, which is taxes.py's `_effective_rate` posture: the writer bounds each
    column separately, so a 0.0001 x 0.0001 equity pool under a 1e8 x 1e10 refresh grant
    is storable, and its ~1e26 ratio has more digits than `quantize` can represent
    (InvalidOperation — a 500 on a plain GET of data this very API accepted).
    """
    if numerator is None or denominator is None or denominator == 0:
        return None
    value = numerator / denominator
    return None if value.copy_abs() >= PCT_MAX_ABS else pct6(value)


def metrics(event) -> dict[str, Decimal | None]:
    """The seven computed columns for one `comp_events` row.

    `event` is the ORM row (or anything with its columns). The keys are exactly the
    computed fields of `schemas.comp.CompEventOut`, so the router can splat them.
    """
    current_base = event.current_base
    new_base = event.new_base
    # Full-precision products; the 2dp/6dp quantizes happen once, on the way out.
    unvested_equity = _product(event.unvested_rsus, event.unvested_price)
    equity_delta = _product(event.refresh_rsus, event.grant_price)
    base_delta = None if new_base is None else new_base - current_base
    # The TC lines read a missing side as 0 rather than dropping out, so they always
    # compute (spelled out rather than `or ZERO`: a real 0.00 equity pool is falsy too).
    equity_or_zero = ZERO if unvested_equity is None else unvested_equity
    delta_or_zero = ZERO if equity_delta is None else equity_delta
    return {
        "base_delta": None if base_delta is None else half_up2(base_delta),
        "base_delta_pct": _ratio(base_delta, current_base),
        "unvested_equity": None if unvested_equity is None else half_up2(unvested_equity),
        "equity_delta": None if equity_delta is None else half_up2(equity_delta),
        # The canonical shape (the sheet's r3/r4; its r5 drifted — plan D4): the new grant
        # measured against the equity already on the table, NOT against base.
        "equity_delta_pct": _ratio(equity_delta, unvested_equity),
        "tc_before": half_up2(current_base + equity_or_zero),
        "tc_after": half_up2(
            # No new base means the year's base did not move — "after" keeps the current
            # one, so the open focal year reads base -> base rather than base -> 0.
            (current_base if new_base is None else new_base) + equity_or_zero + delta_or_zero
        ),
    }
