"""User-entered calendar events (2026-08-24 financial-calendar spec §9.3)."""

from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CustomEvent(Base):
    """Dashboard-only informational events — a date, a title, an optional note. NOT in
    the spreadsheet: the importer never reads or writes this table (rsu_grants' posture,
    pinned in test_importer_apply.py). No page owns them: composed events carry
    href=None, and the id rides the wire so the calendar page can edit/delete in place."""

    __tablename__ = "custom_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_date: Mapped[date] = mapped_column(Date, index=True)  # `date` shadows the type
    label: Mapped[str] = mapped_column(String(120))
    detail: Mapped[str | None] = mapped_column(String(300))
    # NULL = HOUSEHOLD, not joint-ownership: an untagged reminder belongs to nobody in
    # particular. Unlike credit_cards, migration d3b8e05fa726 backfills NOTHING — every
    # pre-existing event was entered before anybody could tag it, and inventing an owner
    # would put a name on the chips the user never chose.
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="SET NULL"), default=None
    )
