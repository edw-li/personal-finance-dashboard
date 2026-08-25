"""User-entered calendar events (2026-08-24 financial-calendar spec §9.3)."""

from datetime import date

from sqlalchemy import Date, String
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
