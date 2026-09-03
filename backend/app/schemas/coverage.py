from datetime import date

from pydantic import BaseModel


class CoverageOut(BaseModel):
    """Which months each hand-entered feed covers (2026-09-03 shell spec §7). Ascending
    first-of-month dates, one entry per month regardless of row count. The month ribbon
    reads it for its two-tone chips; the later coverage-honesty work reads it for reminders."""

    balances: list[date]
    spending: list[date]
    net_pay: list[date]
