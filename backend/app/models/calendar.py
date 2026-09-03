"""User-entered calendar events, the generated-event override overlay and feed tokens
(2026-08-24 financial-calendar spec §9.3; 2026-09-03 calendar spec §6, §11, §13)."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# The two custom-event vocabularies. Pinned here (the REWARDS_CURRENCIES posture) so the
# schema Literal, the model CHECK and the services package spell exactly these.
DIRECTIONS = ("in", "out", "neutral")
RECURRENCES = ("none", "weekly", "monthly", "yearly")


class CustomEvent(Base):
    """Dashboard-only user events — a date, a title, an optional note, and since the
    2026-09-03 spec an optional amount with a direction and an rrule-lite recurrence. NOT
    in the spreadsheet: the importer never reads or writes this table (rsu_grants' posture,
    pinned in test_importer_apply.py). No page owns them: composed events carry href=None,
    and the id rides the wire so the calendar page can edit/delete in place."""

    __tablename__ = "custom_events"
    __table_args__ = (
        CheckConstraint("direction IN ('in', 'out', 'neutral')", name="direction_vocabulary"),
        CheckConstraint(
            "recurrence IN ('none', 'weekly', 'monthly', 'yearly')", name="recurrence_vocabulary"
        ),
    )

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
    # NULL = no money attached (an informational reminder). 2dp, the app's money scale.
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    direction: Mapped[str] = mapped_column(String(8), default="neutral", server_default="neutral")
    # rrule-lite (spec §6): the stored date is the series start; occurrences are expanded on
    # read by services/calendar/recurrence.py up to `until` (inclusive) or the window end.
    recurrence: Mapped[str] = mapped_column(String(8), default="none", server_default="none")
    until: Mapped[date | None] = mapped_column(Date)


class CalendarEventOverride(Base):
    """What the user typed ON a generated event (spec §13): done, hidden, a note, the
    figure actually paid. Keyed by the event's stable key — `source:entity_ref:date` — so
    idempotency is a property of the key function, not of any job. An override whose source
    vanishes is silently unmatched, which is harmless. Nothing derived is stored here."""

    __tablename__ = "calendar_event_overrides"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_key: Mapped[str] = mapped_column(String(120), unique=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    note: Mapped[str | None] = mapped_column(String(300))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CalendarFeedToken(Base):
    """One subscription credential for GET /calendar/feed.ics (spec §11). Only the sha256 of
    the plaintext is stored — the plaintext is returned by POST once and never again (the
    assistant key card's posture). `last_used_at` is bumped at most hourly."""

    __tablename__ = "calendar_feed_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    label: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
