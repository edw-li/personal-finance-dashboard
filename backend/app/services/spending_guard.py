"""The empty-spending-month guard (2026-09-04 honest-numbers spec §4).

One rule, two callers: the months PUT refuses a body that records nothing unless the client
sets `confirm_zero`, and the importer applies the same test to a sheet row before writing
it — that is what "the importer passes confirm_zero=True only for months that carry a net
pay figure or any non-zero amount" means for a writer that never goes through HTTP.

The bug it removes, in production's own numbers (census 2026-09-04): Sep 2026 held 19 rows
of $0.00 and no net pay, so the footer read "Spending through Sep 2026", the movers read
−100%, and Housing's 12-month average came out $181/month low.
"""

from collections.abc import Iterable
from decimal import Decimal

EMPTY_MONTH_REFUSAL = (
    "Nothing to record: every category is $0.00 and no take-home was entered — "
    "set confirm_zero to write an empty month on purpose"
)


def records_something(amounts: Iterable[Decimal], net_pay: Decimal | None) -> bool:
    """True when a month's payload carries real content: any non-zero amount, or a
    take-home figure. Zeros alone are NOT content — a typed zero and an untouched blank
    are indistinguishable once they are stored, which is the whole bug."""
    return net_pay is not None or any(amount != 0 for amount in amounts)
