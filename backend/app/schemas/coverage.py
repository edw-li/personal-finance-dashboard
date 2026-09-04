from datetime import date

from pydantic import BaseModel


class CoverageLatestOut(BaseModel):
    """The newest month each feed covers — None when the feed has nothing. `spending` is
    the newest ENTERED month, which is what the footer and the freshness cue name."""

    balances: date | None
    spending: date | None
    net_pay: date | None


class CoverageOut(BaseModel):
    """Which months each hand-entered feed covers (2026-09-03 shell spec §7, extended by
    the 2026-09-04 honest-numbers spec §3). Ascending first-of-month dates, one entry per
    month regardless of row count.

    `spending` lists ENTERED months only — a month whose rows are all $0.00 with no
    take-home is in `spending_empty`, and a month inside the balances window with nothing
    at all is in `spending_missing`. `balances` and `net_pay` are unchanged.
    """

    balances: list[date]
    spending: list[date]
    net_pay: list[date]
    spending_empty: list[date]
    spending_missing: list[date]
    net_pay_missing: list[date]
    latest: CoverageLatestOut
