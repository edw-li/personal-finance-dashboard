"""Per-year contribution limits (2026-08-27 two-income-streams spec §3 item 3 / §4.5).

The app ships NO values — the brackets philosophy (spec §2): the IRS publishes new
numbers every autumn, a hardcoded table is wrong the moment it is written, and a wrong
cap is worse than an absent one. The user enters the figures per year in Settings, and an
ABSENT row is a first-class state meaning "not entered yet" — which is what the Paycheck
pace strip renders a call-to-action for.

Deliberately generic: `key` is a plain string, not an enum, so a later batch adds IRA or
catch-up keys by editing app/limit_keys.py with no migration. The DEFINITIONS (key,
label, sort order) live in code; this table holds only values.

Importer-immune: no sheet maps to contribution limits, so a re-import must neither
create, update nor delete a row (the custom_events / rsu_grants posture, pinned in
test_importer_apply.py).
"""

from decimal import Decimal

from sqlalchemy import CheckConstraint, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ContributionLimit(Base):
    __tablename__ = "contribution_limits"
    __table_args__ = (
        # One value per (year, key). The API's bulk PUT is a get-then-set upsert against
        # this key, and a null in the request DELETES the row rather than storing a zero.
        UniqueConstraint("year", "key"),
        # > 0, not >= 0. A zero cap is not a thing the IRS publishes, and this constraint
        # is precisely what lets services/limit_check.py divide by a stored limit with no
        # zero guard — the router mirrors it with a 422 so the sentence is user-worthy.
        CheckConstraint("value > 0", name="value_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # A plain int with NO FK to tax_years: limits are a calendar-year registry of their
    # own and must be enterable for a year that has no tax return yet (next year's caps
    # are published while this year's return is still open).
    year: Mapped[int] = mapped_column()
    key: Mapped[str] = mapped_column(String(40))
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
