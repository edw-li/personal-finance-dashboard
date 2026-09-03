# Calendar A — Foundations: migrations, v2 wire, `services/calendar/` package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the calendar its money model per `docs/superpowers/specs/2026-09-03-calendar-design.md` §4–§7, §12–§13, §16: the four Alembic migrations, the three model changes, the v2 wire shapes (Python + TS), the `services/calendar/` package (model, key function, fold, recurrence, overlay, one pure generator per family with rsu pricing and payroll net pay), `GET /calendar` rebuilt on the package with a `sources[]` health list, `PUT/DELETE /calendar/overrides/{key}`, custom-event money + recurrence, the `calendar_update_due_day` setting, export coverage for the two new tables — and every existing suite green on the new shape so Lanes B/C/D start from one truth.

**Architecture:** Generated events are computed on read and never stored (approach C). Every event carries `amount / direction / basis / items[]` and a stable `key = "<source>:<entity_ref>:<date>"` that is a function of source facts, never of a label. Same-day `rsu_vest` and `payday` events fold server-side into one event with `items[]`. User edits on generated events live in `calendar_event_overrides` keyed by that key and are applied after folding. The old `services/calendar_events.py` and its tests stay in place UNTOUCHED tonight (no deletions — see the retire list); the router stops importing it.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Postgres; pytest (asyncio auto); React 19 + TypeScript + vitest for the type/fixture half.

**Worktree / commands:** This lane runs FIRST and ALONE, on branch `calendar-a` (worktree `.worktrees/calendar-a`, `node_modules` junction to the root). Backend from `<worktree>/backend` with the ROOT venv and a private test database:
`FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
Frontend from the worktree root: `npx vitest run <file>`. Postgres must be up (`docker compose -f backend/docker-compose.yml up -d db` from the ROOT checkout).

**Prerequisites:** Plans 1a/1b/1c/2/3 merged (HEAD carries the shell primitives and Plan 3's `CalendarPage` on `PageFrame`); alembic head is `b8e4d17c2a90` (`users.token_version`, Plan 1c) — VERIFY with `ls backend/alembic/versions | tail -1` before Task 1 and chain onto whatever the real head is (README §4.3).

**Two additive wire fields beyond spec §6, decided here so the lanes agree:** `hidden: bool` (the list view needs it to offer Unhide) and `amount_overridden: bool` (how the drawer knows to say "your figure"); plus, on custom events only, `recurrence / until / series_start` (the edit form and the ICS `RRULE` need the series, not just the occurrence). Also `CalendarOut.quote_as_of` (the strip's tilde tooltip names the quote date).

**Retire at the end of the night (NOT in this plan — no deletions tonight):** `backend/app/services/calendar_events.py` + `backend/tests/test_calendar_events.py` (superseded by the package; left in place, untouched, still green), `src/utils/ics.ts` + `src/utils/ics.test.ts` (Lane B supersedes; Plan E swaps the caller).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/alembic/versions/20260904_0900_a1c3e5b7d9f2_custom_event_money_recurrence.py` (new) | `custom_events.amount/direction/recurrence/until` + two check constraints |
| `backend/alembic/versions/20260904_0901_b2d4f6a8c0e3_calendar_event_overrides.py` (new) | the overlay table |
| `backend/alembic/versions/20260904_0902_c3e5a7b9d1f4_calendar_feed_tokens.py` (new) | the feed-token table (Lane B fills the routes) |
| `backend/alembic/versions/20260904_0903_d4f6b8c0e2a5_card_credit_reset_cadence.py` (new) | `card_credits.reset_cadence` (Lane D fills the API/UI) |
| `backend/app/models/calendar.py` (modify) | `CustomEvent` +4 columns; `CalendarEventOverride`; `CalendarFeedToken`; `DIRECTIONS`, `RECURRENCES` |
| `backend/app/models/credit_cards.py` (modify) | `CardCredit.reset_cadence`, `CREDIT_RESET_CADENCES` |
| `backend/app/models/__init__.py` (modify) | exports |
| `backend/app/services/calendar/__init__.py` (new) | `Sources`, `compose()` |
| `backend/app/services/calendar/model.py` (new) | `Event`, `Item`, `Window`, vocabularies, `key()`, `make_event()`, `money()`, `shorten()` |
| `backend/app/services/calendar/fold.py` (new) | `fold_same_day()` |
| `backend/app/services/calendar/recurrence.py` (new) | `expand()` |
| `backend/app/services/calendar/overrides.py` (new) | `Override`, `apply()` |
| `backend/app/services/calendar/generators/{__init__,rsu,payroll,espp,dividends,taxes,ritual,custom}.py` (new) | one pure module per family (`cards.py` is Lane D's) |
| `backend/app/schemas/calendar.py` (rewrite) | v2 wire shapes |
| `backend/app/schemas/app_settings.py`, `backend/app/api/app_settings.py` (modify) | `calendar_update_due_day` (1–28, default 1) + `read_update_due_day()` |
| `backend/app/api/calendar.py` (rewrite) | loaders → `Sources`; `GET /calendar` v2; custom CRUD with money/recurrence; overrides PUT/DELETE; bounded regions for Lanes B and D |
| `backend/app/api/export.py` (modify) | the two new tables in `EXPORTED_TABLES` |
| `backend/tests/calendar/__init__.py` + `test_models.py`, `test_recurrence.py`, `test_fold.py`, `test_overrides.py`, `test_generators.py`, `test_compose.py`, `test_overrides_api.py` (new) | the package's literals-driven suite |
| `backend/tests/test_calendar_api.py` (modify) | v2 assertions, pricing, folding, health, recurrence round-trip |
| `backend/tests/test_app_settings_api.py`, `backend/tests/test_importer_apply.py` (modify) | due-day bounds; importer-immunity pins for the two new tables |
| `src/types/api.ts` (modify) | v2 `CalendarEvent`, `CalendarItem`, `SourceHealth`, `CalendarResponse`, `CustomEventBody/Out`, `CalendarOverrideBody/Out`, settings due day |
| `src/api/calendar.ts` (modify) | `putCalendarOverride`, `deleteCalendarOverride` |
| `src/testing/calendarFixtures.ts` (new) | `calendarEvent()` — the ONE fixture builder every calendar test uses |
| `src/components/calendar/calendarView.ts` (+ test) (modify) | the three card types in the exhaustive maps (Lane C replaces the map with source colors) |
| `src/pages/CalendarPage.tsx` (+ test), `src/utils/ics.test.ts`, `src/components/overview/upNext.test.ts`, `src/pages/OverviewPage.test.tsx` (modify) | v2 bodies/fixtures so tsc + vitest stay green |

**Contracts the lanes rely on (defined in this plan):** `Event` fields and `make_event()` kwargs (Task 4); `Sources` fields incl. the pre-declared `cards` and `tax_facts` slots (Task 9); `compose(window, today=, sources=, overrides=)`; `_compose_for(db, start, end, today) -> (events, health, quote_as_of)` in `api/calendar.py` (Lane B's feed calls it); `SourceHealthOut(source, status, note)`; `CalendarEventOut` field list (Task 10); TS `CalendarEvent` (Task 13); `calendarEvent()` fixture (Task 13).

---

### Task 1: The four migrations

**Files:**
- Create: the four files under `backend/alembic/versions/`

- [ ] **Step 1: Confirm the head**

Run (from `<worktree>/backend`): `ls alembic/versions | tail -2 && ../../../backend/.venv/Scripts/python.exe -m alembic heads`
Expected: the newest file is `20260903_0900_b8e4d17c2a90_users_token_version.py` and `heads` prints `b8e4d17c2a90 (head)`. If it prints something else, use THAT id as the first `down_revision` below and never touch an existing file.

- [ ] **Step 2: Write the four migrations**

```python
# backend/alembic/versions/20260904_0900_a1c3e5b7d9f2_custom_event_money_recurrence.py
"""custom events carry money and a recurrence rule

`custom_events.amount` (2dp, nullable — an informational reminder has no money),
`direction` (in/out/neutral, default neutral) and the rrule-lite pair `recurrence`
(none/weekly/monthly/yearly) + `until` (inclusive, nullable) — 2026-09-03 calendar spec §6,
§16. Both vocabularies are CHECK-constrained here AND repeated on the model, because the
test database is built by create_all (Person's rule). server_defaults so existing rows read
neutral/none and `alembic check` stays clean (paycheck_profiles.hsa_coverage's precedent).

Revision ID: a1c3e5b7d9f2
Revises: b8e4d17c2a90
Create Date: 2026-09-04 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c3e5b7d9f2"
down_revision: str | Sequence[str] | None = "b8e4d17c2a90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "custom_events", sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True)
    )
    op.add_column(
        "custom_events",
        sa.Column("direction", sa.String(length=8), nullable=False, server_default="neutral"),
    )
    op.add_column(
        "custom_events",
        sa.Column("recurrence", sa.String(length=8), nullable=False, server_default="none"),
    )
    op.add_column("custom_events", sa.Column("until", sa.Date(), nullable=True))
    op.create_check_constraint(
        op.f("ck_custom_events_direction_vocabulary"),
        "custom_events",
        "direction IN ('in', 'out', 'neutral')",
    )
    op.create_check_constraint(
        op.f("ck_custom_events_recurrence_vocabulary"),
        "custom_events",
        "recurrence IN ('none', 'weekly', 'monthly', 'yearly')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("ck_custom_events_recurrence_vocabulary"), "custom_events", type_="check"
    )
    op.drop_constraint(op.f("ck_custom_events_direction_vocabulary"), "custom_events", type_="check")
    op.drop_column("custom_events", "until")
    op.drop_column("custom_events", "recurrence")
    op.drop_column("custom_events", "direction")
    op.drop_column("custom_events", "amount")
```

```python
# backend/alembic/versions/20260904_0901_b2d4f6a8c0e3_calendar_event_overrides.py
"""calendar event overrides

The user-edit OVERLAY for generated calendar events (2026-09-03 calendar spec §4 approach
C, §13): only what the user typed — done, hidden, a note, the figure actually paid — keyed
by the event's stable `source:entity_ref:date` key. Nothing derived is ever stored here, so
`rsu_grants`' and `credit_cards`' docstrings stay true. Dashboard-only and importer-immune
(the custom_events posture). Additive; downgrade drops the table.

Revision ID: b2d4f6a8c0e3
Revises: a1c3e5b7d9f2
Create Date: 2026-09-04 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4f6a8c0e3"
down_revision: str | Sequence[str] | None = "a1c3e5b7d9f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "calendar_event_overrides",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_key", sa.String(length=120), nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_event_overrides")),
        sa.UniqueConstraint("event_key", name=op.f("uq_calendar_event_overrides_event_key")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("calendar_event_overrides")
```

```python
# backend/alembic/versions/20260904_0902_c3e5a7b9d1f4_calendar_feed_tokens.py
"""calendar feed tokens

The credential behind GET /calendar/feed.ics?token= (2026-09-03 calendar spec §11): the
sha256 of a `secrets.token_urlsafe(32)` plaintext that is shown ONCE, a label, and a
last-used stamp for the Settings card. Hash at rest — a database read never yields a
working feed URL. Cascades with the user. Additive; downgrade drops the table.

Revision ID: c3e5a7b9d1f4
Revises: b2d4f6a8c0e3
Create Date: 2026-09-04 09:02:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e5a7b9d1f4"
down_revision: str | Sequence[str] | None = "b2d4f6a8c0e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "calendar_feed_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_calendar_feed_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_feed_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_calendar_feed_tokens_token_hash")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("calendar_feed_tokens")
```

```python
# backend/alembic/versions/20260904_0903_d4f6b8c0e2a5_card_credit_reset_cadence.py
"""card_credits.reset_cadence

When a recurring card credit resets (2026-09-03 calendar spec §6 card row): `calendar`
(January 1) or `anniversary` (the card's opened_on anniversary). Default `calendar` — the
common shape — with a server_default so every existing credit reads it and `alembic check`
stays clean. CHECK-constrained here and on the model (create_all builds the test schema).

Revision ID: d4f6b8c0e2a5
Revises: c3e5a7b9d1f4
Create Date: 2026-09-04 09:03:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6b8c0e2a5"
down_revision: str | Sequence[str] | None = "c3e5a7b9d1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "card_credits",
        sa.Column("reset_cadence", sa.String(length=12), nullable=False, server_default="calendar"),
    )
    op.create_check_constraint(
        op.f("ck_card_credits_reset_cadence_vocabulary"),
        "card_credits",
        "reset_cadence IN ('calendar', 'anniversary')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f("ck_card_credits_reset_cadence_vocabulary"), "card_credits", type_="check")
    op.drop_column("card_credits", "reset_cadence")
```

- [ ] **Step 3: Chain check**

Run: `../../../backend/.venv/Scripts/python.exe -m alembic heads`
Expected: exactly one head, `d4f6b8c0e2a5 (head)`.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/20260904_0900_a1c3e5b7d9f2_custom_event_money_recurrence.py backend/alembic/versions/20260904_0901_b2d4f6a8c0e3_calendar_event_overrides.py backend/alembic/versions/20260904_0902_c3e5a7b9d1f4_calendar_feed_tokens.py backend/alembic/versions/20260904_0903_d4f6b8c0e2a5_card_credit_reset_cadence.py
git commit -m "feat(db): calendar migrations — custom event money/recurrence, override overlay, feed tokens, card credit reset cadence"
```

---

### Task 2: Models

**Files:**
- Modify: `backend/app/models/calendar.py`, `backend/app/models/credit_cards.py`, `backend/app/models/__init__.py`
- Test: `backend/tests/calendar/__init__.py` (empty), `backend/tests/calendar/test_models.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/calendar/__init__.py
```

```python
# backend/tests/calendar/test_models.py
"""DB-level contracts for the calendar tables (2026-09-03 calendar spec §16): the custom
event defaults, the overlay's unique key, the token's cascade, the credit cadence default."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    CalendarEventOverride,
    CalendarFeedToken,
    CardCredit,
    CreditCard,
    CustomEvent,
    User,
)
from app.security import hash_password


async def test_custom_event_defaults_to_neutral_and_no_recurrence(db):
    db.add(CustomEvent(event_date=date(2026, 9, 12), label="Car insurance", detail=None))
    await db.commit()
    row = (await db.execute(select(CustomEvent))).scalars().one()
    assert (row.amount, row.direction, row.recurrence, row.until) == (None, "neutral", "none", None)


async def test_custom_event_vocabularies_are_check_constrained(db):
    db.add(CustomEvent(event_date=date(2026, 9, 12), label="x", detail=None, direction="sideways"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    db.add(CustomEvent(event_date=date(2026, 9, 12), label="x", detail=None, recurrence="daily"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_override_key_is_unique_and_hidden_defaults_false(db):
    db.add(CalendarEventOverride(event_key="rsu:vest:2026-09-16", note="sold 10"))
    await db.commit()
    row = (await db.execute(select(CalendarEventOverride))).scalars().one()
    assert row.hidden is False and row.done_at is None and row.updated_at is not None
    db.add(CalendarEventOverride(event_key="rsu:vest:2026-09-16", amount=Decimal("1.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_feed_token_cascades_with_its_user(db):
    user = User(email="feed@example.com", password_hash=hash_password("correct-horse"))
    db.add(user)
    await db.flush()
    db.add(
        CalendarFeedToken(
            user_id=user.id,
            token_hash="a" * 64,
            label="phone",
            last_used_at=datetime(2026, 9, 1, tzinfo=UTC),
        )
    )
    await db.commit()
    assert (await db.execute(select(CalendarFeedToken))).scalars().one().created_at is not None
    await db.delete(user)
    await db.commit()
    assert (await db.execute(select(CalendarFeedToken))).scalars().first() is None


async def test_card_credit_reset_cadence_defaults_to_calendar_and_is_constrained(db):
    card = CreditCard(
        name="Venture X",
        slug="venture-x",
        annual_fee=Decimal("395.00"),
        rewards_currency="miles",
        point_value_cents=Decimal("1.7"),
    )
    db.add(card)
    await db.flush()
    db.add(CardCredit(card_id=card.id, label="$300 travel credit", annual_value=Decimal("300")))
    await db.commit()
    assert (await db.execute(select(CardCredit))).scalars().one().reset_cadence == "calendar"
    db.add(
        CardCredit(
            card_id=card.id, label="x", annual_value=Decimal("1"), reset_cadence="quarterly"
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'CalendarEventOverride'`.

- [ ] **Step 3: Write the models**

Replace `backend/app/models/calendar.py`:

```python
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
```

In `backend/app/models/credit_cards.py`, add after `REWARDS_CURRENCIES`:

```python
# When a recurring credit resets (2026-09-03 calendar spec §6): the calendar year, or the
# card's opened_on anniversary. The calendar's card generator dates `card_credit` events by it.
CREDIT_RESET_CADENCES = ("calendar", "anniversary")
```

and change `CardCredit`:

```python
class CardCredit(Base):
    """A recurring credit on a card (e.g. the $300 travel credit). `counts` is the
    user's "I actually use this" toggle — only counted credits enter the
    worth-keeping math (spec §1 economics decision)."""

    __tablename__ = "card_credits"
    __table_args__ = (
        CheckConstraint("annual_value >= 0", name="annual_value_non_negative"),
        CheckConstraint(
            "reset_cadence IN ('calendar', 'anniversary')", name="reset_cadence_vocabulary"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(120))
    annual_value: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    counts: Mapped[bool] = mapped_column(default=True)
    # server_default repeated from migration d4f6b8c0e2a5 so `alembic check` stays clean.
    reset_cadence: Mapped[str] = mapped_column(
        String(12), default="calendar", server_default="calendar"
    )
```

In `backend/app/models/__init__.py`: change the calendar import to `from app.models.calendar import DIRECTIONS, RECURRENCES, CalendarEventOverride, CalendarFeedToken, CustomEvent`, add `CREDIT_RESET_CADENCES` to the credit_cards import, and add `"CREDIT_RESET_CADENCES"`, `"CalendarEventOverride"`, `"CalendarFeedToken"`, `"DIRECTIONS"`, `"RECURRENCES"` to `__all__` (keep it sorted).

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_models.py tests/test_models_credit_cards.py -q`
Expected: all passed (the session-scoped `engine` fixture rebuilds the schema with `create_all`, so the new columns and tables exist).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/calendar.py backend/app/models/credit_cards.py backend/app/models/__init__.py backend/tests/calendar/__init__.py backend/tests/calendar/test_models.py
git commit -m "feat(models): custom event money + recurrence, calendar_event_overrides, calendar_feed_tokens, card_credits.reset_cadence"
```

---

### Task 3: Migration rehearsal against a scratch database

- [ ] **Step 1: Create a scratch database and upgrade it**

Run (from `<worktree>/backend`; the URL matches `app/config.py`'s default):

```bash
../../../backend/.venv/Scripts/python.exe -c "import asyncio, asyncpg
async def main():
    c = await asyncpg.connect('postgresql://finance:finance@localhost:5433/postgres')
    await c.execute('DROP DATABASE IF EXISTS finance_mig_cal')
    await c.execute('CREATE DATABASE finance_mig_cal')
    await c.close()
asyncio.run(main())"
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_mig_cal ../../../backend/.venv/Scripts/python.exe -m alembic upgrade head
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_mig_cal ../../../backend/.venv/Scripts/python.exe -m alembic check
```

Expected: `upgrade` ends at `d4f6b8c0e2a5`; `check` prints `No new upgrade operations detected.` — the models and the migrations agree column for column (server_defaults included). If `check` proposes an operation, fix the MODEL or MIGRATION it names (never a shipped revision) and re-run.

- [ ] **Step 2: Downgrade round trip**

Run: `DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_mig_cal ../../../backend/.venv/Scripts/python.exe -m alembic downgrade b8e4d17c2a90 && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_mig_cal ../../../backend/.venv/Scripts/python.exe -m alembic upgrade head`
Expected: both succeed. (Leave `finance_mig_cal` for the end-of-night cleanup list.)

---

### Task 4: `services/calendar/model.py` — the event model and key function

**Files:**
- Create: `backend/app/services/calendar/__init__.py` (a stub for now — Task 9 fills it), `backend/app/services/calendar/model.py`, `backend/app/services/calendar/generators/__init__.py` (empty)
- Test: `backend/tests/calendar/test_model.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/calendar/test_model.py
from datetime import date
from decimal import Decimal

import pytest

from app.services.calendar.model import (
    DEADLINE_TYPES,
    EVENT_TYPES,
    FOLDABLE_TYPES,
    SOURCE_FAMILIES,
    TYPE_SOURCE,
    Item,
    Window,
    key,
    make_event,
    money,
    shorten,
)


def test_vocabularies_are_the_spec_lists():
    assert EVENT_TYPES == (
        "rsu_vest", "espp_purchase", "espp_qualify", "ex_dividend", "payday", "offering_start",
        "tax_deadline", "update_due", "custom", "card_fee", "card_credit", "card_anniversary",
    )
    assert SOURCE_FAMILIES == ("rsu", "espp", "dividend", "payroll", "tax", "card", "ritual", "custom")
    assert set(TYPE_SOURCE) == set(EVENT_TYPES)
    assert set(TYPE_SOURCE.values()) == set(SOURCE_FAMILIES)
    assert FOLDABLE_TYPES == ("rsu_vest", "payday")
    assert DEADLINE_TYPES == ("tax_deadline", "update_due", "card_fee")


def test_key_is_source_ref_date_and_never_the_label():
    assert key("rsu", "vest", date(2026, 9, 16)) == "rsu:vest:2026-09-16"
    assert key("ritual", "2026-08", date(2026, 9, 1)) == "ritual:2026-08:2026-09-01"
    with pytest.raises(ValueError):
        key("rsu", "has:colon", date(2026, 9, 16))


def test_make_event_derives_source_and_key_and_validates():
    event = make_event(
        date(2026, 9, 16), "rsu_vest", "vest", "RSU vest — 2025 offer", "RSU vest",
        amount=Decimal("12500"), direction="in", basis="estimated", href="/comp",
        items=(Item("2025 offer", Decimal("12500.00"), detail="25 sh"),),
    )
    assert (event.source, event.key) == ("rsu", "rsu:vest:2026-09-16")
    assert event.amount == Decimal("12500.00")  # quantized to cents on the way in
    assert (event.done, event.hidden, event.note, event.amount_overridden) == (False, False, None, False)
    # The ritual reminder keys on its NOMINAL due date even when re-dated to today.
    redated = make_event(
        date(2026, 9, 3), "update_due", "2026-08", "Monthly update — enter August 2026",
        "Monthly update", key_date=date(2026, 9, 1), href="/update",
    )
    assert redated.key == "ritual:2026-08:2026-09-01" and redated.event_date == date(2026, 9, 3)
    with pytest.raises(ValueError):
        make_event(date(2026, 9, 16), "rsu_vest", "vest", "x", "y", direction="sideways")
    with pytest.raises(ValueError):
        make_event(date(2026, 9, 16), "not_a_type", "vest", "x", "y")
    with pytest.raises(ValueError):
        make_event(date(2026, 9, 16), "rsu_vest", "vest", "x", "a" * 25)  # short_label > 24


def test_money_and_shorten():
    assert money(Decimal("12.345")) == Decimal("12.35")
    assert str(money(Decimal("-0.001"))) == "0.00"  # signed zero collapsed
    assert shorten("Car insurance renewal — policy 8841") == "Car insurance renewal …"
    assert shorten("Dentist") == "Dentist"
    assert len(shorten("x" * 80)) == 24


def test_window_contains_and_months():
    window = Window(date(2026, 8, 1), date(2026, 10, 31))
    assert window.contains(date(2026, 8, 1)) and window.contains(date(2026, 10, 31))
    assert not window.contains(date(2026, 11, 1))
    assert window.months() == [date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1)]
    assert Window(date(2026, 12, 15), date(2027, 1, 10)).months() == [date(2026, 12, 1), date(2027, 1, 1)]
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_model.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.calendar`.

- [ ] **Step 3: Write the module**

`backend/app/services/calendar/__init__.py` — for now only the docstring (Task 9 adds `Sources` and `compose`):

```python
"""The calendar engine (2026-09-03 calendar spec §5): generated events are computed on read
from the services the owning pages already use, folded per (type, date) for vests and
paydays, and overlaid with the user's overrides. `compose()` is the only public entry."""
```

`backend/app/services/calendar/generators/__init__.py` — empty file.

```python
# backend/app/services/calendar/model.py
"""The event model with money (2026-09-03 calendar spec §6). Pure — no DB, no HTTP, no
clock. `Event` is what every generator returns and what fold, overrides, the router, the
ICS renderer and the assistant all read; `key` is the ONE identity grammar."""

import re
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.models.calendar import DIRECTIONS, RECURRENCES

# The wire vocabulary: the nine v1 types plus the three card types. schemas/calendar.py's
# Literal and the frontend's CalendarEventType spell exactly these twelve.
EVENT_TYPES = (
    "rsu_vest",
    "espp_purchase",
    "espp_qualify",
    "ex_dividend",
    "payday",
    "offering_start",
    "tax_deadline",
    "update_due",
    "custom",
    "card_fee",
    "card_credit",
    "card_anniversary",
)
# Seven derived families plus custom — the eight palette slots (spec §7 color rule).
SOURCE_FAMILIES = ("rsu", "espp", "dividend", "payroll", "tax", "card", "ritual", "custom")
TYPE_SOURCE: dict[str, str] = {
    "rsu_vest": "rsu",
    "espp_purchase": "espp",
    "espp_qualify": "espp",
    "offering_start": "espp",
    "ex_dividend": "dividend",
    "payday": "payroll",
    "tax_deadline": "tax",
    "update_due": "ritual",
    "custom": "custom",
    "card_fee": "card",
    "card_credit": "card",
    "card_anniversary": "card",
}
BASES = ("confirmed", "scheduled", "estimated")
# Only these two families fold (spec §7): a fee and a credit on one card the same day are
# two facts.
FOLDABLE_TYPES = ("rsu_vest", "payday")
# Types that carry a VALARM in ICS and a "Mark done" affordance in the drawer.
DEADLINE_TYPES = ("tax_deadline", "update_due", "card_fee")

# entity_ref: no colons, so the key's three fields split unambiguously; ≤ 60 chars so the
# whole key fits String(120). KEY_RE is the overrides router's path validator (spec §13).
ENTITY_REF_RE = re.compile(r"^[A-Za-z0-9._-]{1,60}$")
KEY_RE = re.compile(r"^[a-z]+:[A-Za-z0-9._-]{1,60}:\d{4}-\d{2}-\d{2}$")

SHORT_LABEL_MAX = 24
MONEY_QUANTUM = Decimal("0.01")
ZERO = Decimal("0")


def money(value: Decimal) -> Decimal:
    """2dp, half-up, signed zero collapsed — paycheck_calc.half_up2's posture: a PLAIN
    quantize, because a read must never trap on stored data."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def shorten(text: str, limit: int = SHORT_LABEL_MAX) -> str:
    """A chip-sized label: the text itself when it fits, else a word-boundary cut plus an
    ellipsis, never longer than `limit`."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 2]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return f"{cut.rstrip()} …"[:limit]


def key(source: str, entity_ref: str, day: date) -> str:
    """`<source>:<entity_ref>:<date>` — a pure function of source facts (an id, a date, a
    fixed word), never of a label, so a rename can never churn an ICS UID."""
    if not ENTITY_REF_RE.fullmatch(entity_ref):
        raise ValueError(f"entity_ref {entity_ref!r} must match {ENTITY_REF_RE.pattern}")
    return f"{source}:{entity_ref}:{day.isoformat()}"


@dataclass(frozen=True)
class Item:
    """One constituent of a folded event (a grant's tranche, a person's paycheck)."""

    label: str
    amount: Decimal | None
    person_id: int | None = None
    detail: str | None = None


@dataclass(frozen=True)
class Window:
    start: date
    end: date

    def contains(self, day: date) -> bool:
        return self.start <= day <= self.end

    def months(self) -> list[date]:
        """First-of-month dates for every month the window touches, ascending."""
        out: list[date] = []
        year, month = self.start.year, self.start.month
        while (year, month) <= (self.end.year, self.end.month):
            out.append(date(year, month, 1))
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        return out


@dataclass(frozen=True)
class Event:
    """One calendar entry. `event_date`, not `date` (the type would be shadowed); the WIRE
    field is `date`. `key` is stored, not derived from event_date: the ritual reminder is
    re-dated to today while overdue and its key must not move with it."""

    event_date: date
    type: str
    source: str
    entity_ref: str
    key: str
    label: str
    short_label: str
    detail: str | None
    amount: Decimal | None
    direction: str
    basis: str
    href: str | None
    items: tuple[Item, ...] = ()
    event_id: int | None = None  # custom rows only
    person_id: int | None = None  # custom rows only
    recurrence: str | None = None  # custom rows only, None when the row does not recur
    until: date | None = None
    series_start: date | None = None
    # --- the overlay (spec §13), applied by overrides.apply
    done: bool = False
    hidden: bool = False
    note: str | None = None
    amount_overridden: bool = False

    def __post_init__(self) -> None:
        if self.type not in EVENT_TYPES:
            raise ValueError(f"unknown event type {self.type!r}")
        if self.source != TYPE_SOURCE[self.type]:
            raise ValueError(f"{self.type} belongs to {TYPE_SOURCE[self.type]}, not {self.source}")
        if self.direction not in DIRECTIONS:
            raise ValueError(f"unknown direction {self.direction!r}")
        if self.basis not in BASES:
            raise ValueError(f"unknown basis {self.basis!r}")
        if self.recurrence is not None and self.recurrence not in RECURRENCES:
            raise ValueError(f"unknown recurrence {self.recurrence!r}")
        if not KEY_RE.fullmatch(self.key):
            raise ValueError(f"malformed key {self.key!r}")
        if len(self.short_label) > SHORT_LABEL_MAX:
            raise ValueError(f"short_label longer than {SHORT_LABEL_MAX}: {self.short_label!r}")


def make_event(
    event_date: date,
    type: str,
    entity_ref: str,
    label: str,
    short_label: str,
    *,
    detail: str | None = None,
    amount: Decimal | None = None,
    direction: str = "neutral",
    basis: str = "scheduled",
    href: str | None = None,
    items: tuple[Item, ...] = (),
    event_id: int | None = None,
    person_id: int | None = None,
    key_date: date | None = None,
    recurrence: str | None = None,
    until: date | None = None,
    series_start: date | None = None,
) -> Event:
    """The generators' constructor: derives `source` from the type and `key` from
    (source, entity_ref, key_date or event_date); quantizes the amount to cents."""
    source = TYPE_SOURCE.get(type)
    if source is None:
        raise ValueError(f"unknown event type {type!r}")
    return Event(
        event_date=event_date,
        type=type,
        source=source,
        entity_ref=entity_ref,
        key=key(source, entity_ref, key_date or event_date),
        label=label,
        short_label=short_label,
        detail=detail,
        amount=None if amount is None else money(amount),
        direction=direction,
        basis=basis,
        href=href,
        items=items,
        event_id=event_id,
        person_id=person_id,
        recurrence=recurrence,
        until=until,
        series_start=series_start,
    )
```

- [ ] **Step 4: Run the test**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_model.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/__init__.py backend/app/services/calendar/model.py backend/app/services/calendar/generators/__init__.py backend/tests/calendar/test_model.py
git commit -m "feat(calendar): event model with money, stable key grammar, window"
```

---

### Task 5: `recurrence.py` — rrule-lite

**Files:**
- Create: `backend/app/services/calendar/recurrence.py`
- Test: `backend/tests/calendar/test_recurrence.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/calendar/test_recurrence.py
from datetime import date

import pytest

from app.services.calendar.model import Window
from app.services.calendar.recurrence import expand

W = Window(date(2026, 1, 1), date(2026, 12, 31))


def test_none_is_the_single_date_clipped_to_the_window():
    assert expand("none", date(2026, 9, 12), None, W) == [date(2026, 9, 12)]
    assert expand("none", date(2027, 1, 1), None, W) == []


def test_weekly_steps_seven_days_and_until_is_inclusive():
    assert expand("weekly", date(2026, 9, 1), date(2026, 9, 15), W) == [
        date(2026, 9, 1), date(2026, 9, 8), date(2026, 9, 15),
    ]


def test_weekly_from_the_distant_past_only_yields_window_dates():
    dates = expand("weekly", date(1999, 1, 5), None, Window(date(2026, 9, 1), date(2026, 9, 30)))
    assert dates == [date(2026, 9, 1), date(2026, 9, 8), date(2026, 9, 15), date(2026, 9, 22), date(2026, 9, 29)]


def test_monthly_clamps_the_29th_to_31st_to_month_end():
    assert expand("monthly", date(2026, 1, 31), date(2026, 5, 1), W) == [
        date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30),
    ]
    # Once clamped, the ORIGINAL day returns when the month allows it (Mar 31 above).


def test_yearly_clamps_leap_day():
    assert expand("yearly", date(2024, 2, 29), None, Window(date(2024, 1, 1), date(2028, 12, 31))) == [
        date(2024, 2, 29), date(2025, 2, 28), date(2026, 2, 28), date(2027, 2, 28), date(2028, 2, 29),
    ]


def test_occurrences_before_the_window_are_dropped_and_the_window_end_stops_the_series():
    assert expand("monthly", date(2026, 7, 15), None, Window(date(2026, 9, 1), date(2026, 10, 31))) == [
        date(2026, 9, 15), date(2026, 10, 15),
    ]


def test_unknown_rule_raises():
    with pytest.raises(ValueError):
        expand("daily", date(2026, 1, 1), None, W)
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_recurrence.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```python
# backend/app/services/calendar/recurrence.py
"""rrule-lite for custom events (2026-09-03 calendar spec §2, §6): weekly / monthly /
yearly with an inclusive `until`, expanded server-side. Whole-series semantics only — no
exceptions, no BYDAY. Pure."""

import calendar as _calendar  # the stdlib module — this package is `app.services.calendar`
from datetime import date, timedelta

from app.models.calendar import RECURRENCES

from .model import Window


def _nth(rule: str, start: date, n: int) -> date:
    if rule == "weekly":
        return start + timedelta(days=7 * n)
    if rule == "monthly":
        serial = start.year * 12 + (start.month - 1) + n
        year, month = serial // 12, serial % 12 + 1
        # Clamp 29–31 to the month's last day; the original day returns when it fits.
        return date(year, month, min(start.day, _calendar.monthrange(year, month)[1]))
    if rule == "yearly":
        year = start.year + n
        return date(year, start.month, min(start.day, _calendar.monthrange(year, start.month)[1]))
    raise ValueError(f"unknown recurrence {rule!r}")


def expand(rule: str, start: date, until: date | None, window: Window) -> list[date]:
    """Every occurrence of the series inside `window`, ascending. `until` is inclusive; the
    window end stops an open series. `start` itself is the first occurrence."""
    if rule not in RECURRENCES:
        raise ValueError(f"unknown recurrence {rule!r}")
    if rule == "none":
        return [start] if window.contains(start) else []
    last = window.end if until is None else min(until, window.end)
    # Skip straight to the first candidate for a long-running weekly series; monthly and
    # yearly series are at most a few hundred steps even from decades back.
    n = max(0, (window.start - start).days // 7) if rule == "weekly" else 0
    out: list[date] = []
    while True:
        occurrence = _nth(rule, start, n)
        if occurrence > last:
            return out
        if occurrence >= window.start:
            out.append(occurrence)
        n += 1
```

- [ ] **Step 4: Run the test**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_recurrence.py -q`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/recurrence.py backend/tests/calendar/test_recurrence.py
git commit -m "feat(calendar): rrule-lite expansion with month-end and leap-day clamps"
```

---

### Task 6: Generators — rsu (priced), payroll (net pay), espp, dividends, taxes (dates), ritual, custom

**Files:**
- Create: `backend/app/services/calendar/generators/rsu.py`, `payroll.py`, `espp.py`, `dividends.py`, `taxes.py`, `ritual.py`, `custom.py`
- Test: `backend/tests/calendar/test_generators.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/calendar/test_generators.py
"""One pure module per family, driven by literals (2026-09-03 calendar spec §6 table).
Date facts: 2026-03-18 / 06-17 / 09-16 / 12-16 are third Wednesdays; Aug 15 2026 is a
Saturday (payday → Fri 14th); Aug 31 2026 is a Monday."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar.generators.custom import CustomRow, custom_events
from app.services.calendar.generators.dividends import ExDividend, ex_dividend_events
from app.services.calendar.generators.espp import espp_events
from app.services.calendar.generators.payroll import PaydaySource, payday_events
from app.services.calendar.generators.ritual import ritual_events
from app.services.calendar.generators.rsu import SUPPLEMENTAL, vest_events
from app.services.calendar.generators.taxes import tax_deadline_events
from app.services.calendar.model import Window
from app.services.espp_calc import OfferingInfo, StoredPeriod

TODAY = date(2026, 8, 24)
Q3 = Window(date(2026, 8, 1), date(2026, 10, 31))


def grant(label="2025 offer", shares=400, cliff="0.25", first_vest=date(2026, 3, 18)):
    return SimpleNamespace(
        label=label, shares=shares, cliff_pct=Decimal(cliff), first_vest_date=first_vest, vest_quantum=1
    )


# --- rsu ---------------------------------------------------------------------------------


def test_vest_events_are_priced_by_the_quote_and_carry_one_item():
    [event] = vest_events([grant()], Q3, quote=Decimal("500"))
    assert (event.event_date, event.type, event.key) == (date(2026, 9, 16), "rsu_vest", "rsu:vest:2026-09-16")
    assert (event.label, event.short_label) == ("RSU vest — 2025 offer", "RSU vest")
    assert (event.amount, event.direction, event.basis, event.href) == (Decimal("12500.00"), "in", "estimated", "/comp")
    assert event.items == (
        __import__("app.services.calendar.model", fromlist=["Item"]).Item("2025 offer", Decimal("12500.00"), None, "25 sh"),
    )
    # 22% federal + 10.23% CA supplemental — the sell-to-cover legs withholding_calc uses.
    assert SUPPLEMENTAL == Decimal("0.3223")
    assert event.detail == "25 sh — 2025 offer · ≈ $8,471.25 after sell-to-cover"


def test_vest_events_without_a_quote_are_unpriced_and_byte_identical_to_v1_detail():
    [event] = vest_events([grant()], Q3, quote=None)
    assert event.amount is None
    assert event.detail == "25 sh — 2025 offer"
    assert event.items[0].amount is None


def test_bad_grant_degrades_with_a_warning(caplog):
    events = vest_events([grant(label="hand-edited", cliff="0.30"), grant()], Q3, quote=None)
    assert [e.label for e in events] == ["RSU vest — 2025 offer"]
    assert any("hand-edited" in record.message for record in caplog.records)


# --- payroll -----------------------------------------------------------------------------


def test_single_earner_payday_keeps_the_bare_label_and_carries_net_pay():
    events = payday_events([PaydaySource("Me", True, Decimal("5000"), 1)], Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert [(e.event_date, e.label, e.amount, e.key) for e in events] == [
        (date(2026, 8, 14), "Payday", Decimal("5000.00"), "payroll:payday:2026-08-14"),
        (date(2026, 8, 31), "Payday", Decimal("5000.00"), "payroll:payday:2026-08-31"),
    ]
    assert events[0].items[0].label == "Me" and events[0].items[0].person_id == 1
    assert (events[0].direction, events[0].basis, events[0].href, events[0].short_label) == ("in", "scheduled", "/paycheck", "Payday")


def test_two_profiled_people_are_labelled_and_the_cadence_gate_is_per_person():
    events = payday_events(
        [PaydaySource("Me", True, Decimal("5000"), 1), PaydaySource("Sam", False, Decimal("3000"), 2)],
        Window(date(2026, 8, 1), date(2026, 8, 31)),
    )
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 8, 14), "Payday — Me", "Me"),
        (date(2026, 8, 31), "Payday — Me", "Me"),
    ]


def test_payday_without_a_computable_net_is_unpriced():
    [event, _] = payday_events([PaydaySource("Me", True, None, 1)], Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert event.amount is None and event.items[0].amount is None


# --- espp --------------------------------------------------------------------------------


def test_espp_events_keep_v1_dates_and_labels_with_stable_keys():
    stored = [
        StoredPeriod(1, "1H26", date(2025, 9, 1), date(2026, 2, 27), Decimal("60000"), Decimal("0"), Decimal("0.14"))
    ]
    events = espp_events(
        stored, [OfferingInfo(date(2026, 9, 1), Decimal("120"))], [(date(2024, 8, 30), date(2026, 9, 1))],
        Window(date(2026, 1, 1), date(2026, 12, 31)),
    )
    by_type = {}
    for e in events:
        by_type.setdefault(e.type, []).append(e)
    assert [(e.event_date, e.label, e.key) for e in by_type["espp_purchase"]] == [
        (date(2026, 2, 27), "ESPP purchase — 1H26", "espp:purchase:2026-02-27"),
        (date(2026, 8, 31), "ESPP purchase — Mar–Aug 2026", "espp:purchase:2026-08-31"),
    ]
    assert [(e.label, e.key) for e in by_type["espp_qualify"]] == [
        ("ESPP lot qualifies — 2024-08-30", "espp:qualify-2024-08-30:2026-09-01")
    ]
    assert [(e.label, e.detail, e.key) for e in by_type["offering_start"]] == [
        ("ESPP offering starts", "subscription price 120", "espp:offering:2026-09-01")
    ]
    assert all(e.href == "/espp" and e.amount is None for e in events)
    assert by_type["espp_purchase"][0].direction == "neutral"


# --- dividends ---------------------------------------------------------------------------


def test_ex_dividend_estimates_shares_times_per_share_and_stays_null_without_them():
    priced, bare = ex_dividend_events(
        [
            ExDividend("NVDA", date(2026, 9, 3), Decimal("10"), Decimal("0.01")),
            ExDividend("SCHD", date(2026, 9, 10)),
            ExDividend("VTI", date(2026, 11, 1), Decimal("5"), Decimal("1")),  # clipped
        ],
        Q3,
    )
    assert (priced.label, priced.short_label, priced.key) == ("Ex-dividend — NVDA", "Ex-div NVDA", "dividend:NVDA:2026-09-03")
    assert (priced.amount, priced.direction, priced.basis, priced.href) == (Decimal("0.10"), "in", "estimated", "/portfolio")
    assert priced.detail == "NVDA · 10 sh × $0.010000"
    assert bare.amount is None and bare.detail == "SCHD"


# --- tax (dates only here; Lane D adds the amounts) ---------------------------------------


def test_tax_deadlines_are_the_five_forward_adjusted_dates_with_stable_refs():
    events = tax_deadline_events(Window(date(2026, 1, 1), date(2026, 12, 31)), TODAY, {})
    assert [(e.event_date, e.detail, e.entity_ref, e.short_label) for e in events] == [
        (date(2026, 1, 15), "Q4 2025 estimated payment", "2025-q4", "Q4 est. tax"),
        (date(2026, 4, 15), "federal filing + Q1 estimated payment", "2026-q1", "Filing + Q1 est."),
        (date(2026, 6, 15), "Q2 estimated payment", "2026-q2", "Q2 est. tax"),
        (date(2026, 9, 15), "Q3 estimated payment", "2026-q3", "Q3 est. tax"),
        (date(2026, 10, 15), "extension filing deadline", "2026-extension", "Extension deadline"),
    ]
    assert all(e.label == f"Tax deadline — {e.detail}" and e.href == "/taxes" for e in events)
    assert all(e.amount is None and e.direction == "out" and e.basis == "scheduled" for e in events)
    assert events[3].key == "tax:2026-q3:2026-09-15"


def test_tax_deadline_rolls_forward_over_weekend_and_holiday():
    events = tax_deadline_events(Window(date(2028, 1, 1), date(2028, 1, 31)), date(2028, 1, 1), {})
    assert [(e.event_date, e.entity_ref) for e in events] == [(date(2028, 1, 18), "2027-q4")]


# --- ritual ------------------------------------------------------------------------------


def test_ritual_emits_per_month_suppresses_entered_and_redates_overdue():
    events = ritual_events(Q3, TODAY, 1, {date(2026, 6, 1)})
    # Aug 1 → enter July (missing, overdue → today, key unchanged); Sep 1 → enter August
    # (scheduled); Oct 1 → enter September.
    assert [(e.event_date, e.label, e.key, e.detail) for e in events] == [
        (TODAY, "Monthly update — enter July 2026", "ritual:2026-07:2026-08-01", "Overdue — was due 2026-08-01"),
        (date(2026, 9, 1), "Monthly update — enter August 2026", "ritual:2026-08:2026-09-01", "Enter August 2026 balances and spending"),
        (date(2026, 10, 1), "Monthly update — enter September 2026", "ritual:2026-09:2026-10-01", "Enter September 2026 balances and spending"),
    ]
    assert all(e.href == "/update" and e.short_label == "Monthly update" and e.basis == "scheduled" for e in events)


def test_ritual_honours_the_due_day_and_an_entered_month():
    events = ritual_events(Q3, TODAY, 5, {date(2026, 7, 1)})
    assert [(e.event_date, e.key) for e in events] == [
        (date(2026, 9, 5), "ritual:2026-08:2026-09-05"),
        (date(2026, 10, 5), "ritual:2026-09:2026-10-05"),
    ]


def test_overdue_ritual_outside_the_window_is_dropped():
    # Viewing a past month: today is not in the window, so the re-dated reminder has nowhere
    # to land and is dropped rather than drawn on the wrong day.
    events = ritual_events(Window(date(2026, 5, 1), date(2026, 5, 31)), TODAY, 1, set())
    assert events == []


# --- custom ------------------------------------------------------------------------------


def test_custom_rows_carry_money_and_expand_recurrence():
    rows = [
        CustomRow(7, date(2026, 9, 12), "Car insurance renewal", "policy 8841", amount=Decimal("1200"), direction="out"),
        CustomRow(8, date(2026, 8, 5), "Piano lesson", None, recurrence="weekly", until=date(2026, 8, 19), person_id=2, person_name="Sam"),
    ]
    events = custom_events(rows, Q3)
    single = [e for e in events if e.event_id == 7]
    series = [e for e in events if e.event_id == 8]
    assert [(e.key, e.amount, e.direction, e.basis, e.href) for e in single] == [
        ("custom:7:2026-09-12", Decimal("1200.00"), "out", "confirmed", None)
    ]
    assert single[0].short_label == "Car insurance renewal …" and single[0].recurrence is None
    assert [(e.event_date, e.key, e.label) for e in series] == [
        (date(2026, 8, 5), "custom:8:2026-08-05", "Piano lesson — Sam"),
        (date(2026, 8, 12), "custom:8:2026-08-12", "Piano lesson — Sam"),
        (date(2026, 8, 19), "custom:8:2026-08-19", "Piano lesson — Sam"),
    ]
    assert (series[0].recurrence, series[0].until, series[0].series_start, series[0].person_id) == (
        "weekly", date(2026, 8, 19), date(2026, 8, 5), 2,
    )
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_generators.py -q`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the seven generators**

```python
# backend/app/services/calendar/generators/rsu.py
"""RSU vests (2026-09-03 calendar spec §6 rsu row): one event per grant tranche, priced at
the latest employer quote — the fold merges same-day tranches into one chip with items."""

import logging
from datetime import date
from decimal import Decimal

from app.services import rsu_vesting
from app.services.withholding_calc import CA_SUPPLEMENTAL, FED_SUPPLEMENTAL

from ..model import Event, Item, Window, make_event, money

logger = logging.getLogger(__name__)

# The sell-to-cover legs withholding_calc prices a vest with. Marginal FICA is NOT here: it
# depends on year-to-date wages, which no single event can know — so the detail says
# "≈" and the gross stays the amount (spec §6).
SUPPLEMENTAL = FED_SUPPLEMENTAL + CA_SUPPLEMENTAL


def after_sell_to_cover(gross: Decimal) -> Decimal:
    return money(gross * (1 - SUPPLEMENTAL))


def vest_events(grants: list, window: Window, *, quote: Decimal | None) -> list[Event]:
    """`grants` are grant-shaped rows (label, shares, cliff_pct, first_vest_date,
    vest_quantum). A row rsu_vesting refuses drops its events with a warning (GET-never-
    rejects); zero-share tranches are real vest events and stay (comp.py keeps them too)."""
    events: list[Event] = []
    for grant in grants:
        try:
            tranches = rsu_vesting.schedule(grant)
        except (ValueError, OverflowError) as exc:
            logger.warning("calendar: grant %r cannot be scheduled — %s", grant.label, exc)
            continue
        for vest_date, shares in tranches:
            if not window.contains(vest_date):
                continue
            value = None if quote is None else money(quote * shares)
            detail = f"{shares} sh — {grant.label}"
            if value is not None:
                detail += f" · ≈ ${after_sell_to_cover(value):,.2f} after sell-to-cover"
            events.append(
                make_event(
                    vest_date,
                    "rsu_vest",
                    "vest",  # ONE ref per date: the fold merges the grants (spec §6 key note)
                    f"RSU vest — {grant.label}",
                    "RSU vest",
                    detail=detail,
                    amount=value,
                    direction="in",
                    basis="estimated",
                    href="/comp",
                    items=(Item(grant.label, value, None, f"{shares} sh"),),
                )
            )
    return events
```

```python
# backend/app/services/calendar/generators/payroll.py
"""Paydays (spec §6 payroll row): semi-monthly only — any other cadence omits THAT
person's paydays and the router names them in the health footer. Net pay per check is the
router's `paycheck_calc.breakdown(profile)['net_pay']`, passed in."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.business_days import semi_monthly_paydays

from ..model import Event, Item, Window, make_event


def person_suffix(name: str) -> str:
    """The ONE person-tag grammar: `"<label> — <name>"` (calendar_events.person_suffix's
    definition, kept byte-identical — the frontend's stripPersonSuffix peels it)."""
    return f" — {name}"


@dataclass(frozen=True)
class PaydaySource:
    name: str
    semi_monthly: bool
    net_pay: Decimal | None = None  # None = not computable (a hand-edited profile)
    person_id: int | None = None


def payday_events(sources: list[PaydaySource], window: Window) -> list[Event]:
    """Labels carry the name only when there is somebody to tell apart (v1's rule, pinned):
    a one-profile household keeps the bare "Payday". The count is of PROFILED people."""
    labelled = len(sources) > 1
    events: list[Event] = []
    for source in sources:
        if not source.semi_monthly:
            continue
        for month in window.months():
            for payday in semi_monthly_paydays(month.year, month.month):
                if not window.contains(payday):
                    continue
                events.append(
                    make_event(
                        payday,
                        "payday",
                        "payday",
                        ("Payday" + person_suffix(source.name)) if labelled else "Payday",
                        "Payday",
                        detail=source.name if labelled else None,
                        amount=source.net_pay,
                        direction="in",
                        basis="scheduled",
                        href="/paycheck",
                        items=(Item(source.name, source.net_pay, source.person_id, None),),
                    )
                )
    return events
```

```python
# backend/app/services/calendar/generators/espp.py
"""ESPP dates (spec §6 espp row): purchase period ends (stored + derived), unsold lots'
qualifying dates, offering starts. Amounts are Lane D's (the modeler's contribution)."""

from datetime import date

from app.services.espp_calc import OfferingInfo, StoredPeriod, plan_year_rows

from ..model import Event, Window, make_event


def espp_events(
    stored_periods: list[StoredPeriod],
    offerings: list[OfferingInfo],
    unsold_lots: list[tuple[date, date]],  # (purchase_date, qualifying_date)
    window: Window,
) -> list[Event]:
    events: list[Event] = []
    # Pricing inputs deliberately empty: the calendar needs labels and end dates only.
    for year in range(window.start.year, window.end.year + 1):
        rows, _warnings = plan_year_rows(year, stored_periods, [], None, None)
        for row in rows:
            if window.contains(row.period_end):
                events.append(
                    make_event(
                        row.period_end,
                        "espp_purchase",
                        "purchase",
                        f"ESPP purchase — {row.label}",
                        "ESPP purchase",
                        detail=row.label,
                        direction="neutral",  # converts already-deducted pay (spec §6)
                        basis="estimated",
                        href="/espp",
                    )
                )
    for purchase_date, qualifying_date in unsold_lots:
        if window.contains(qualifying_date):
            events.append(
                make_event(
                    qualifying_date,
                    "espp_qualify",
                    f"qualify-{purchase_date.isoformat()}",
                    f"ESPP lot qualifies — {purchase_date.isoformat()}",
                    "ESPP lot qualifies",
                    detail=f"{purchase_date.isoformat()} lot qualifies",
                    basis="confirmed",
                    href="/espp",
                )
            )
    for offering in offerings:
        if window.contains(offering.offering_start):
            events.append(
                make_event(
                    offering.offering_start,
                    "offering_start",
                    "offering",
                    "ESPP offering starts",
                    "ESPP offering",
                    detail=f"subscription price {offering.subscription_price}",
                    basis="confirmed",
                    href="/espp",
                )
            )
    return events
```

```python
# backend/app/services/calendar/generators/dividends.py
"""Ex-dividend dates on HELD securities (spec §6 dividend row): held shares × the latest
stored per-share amount, or null when either is unknown. Pay dates stay out."""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..model import Event, Window, make_event, money, shorten

_REF_SAFE = re.compile(r"[^A-Za-z0-9._-]")


@dataclass(frozen=True)
class ExDividend:
    ticker: str
    ex_date: date
    shares: Decimal | None = None
    per_share: Decimal | None = None


def ex_dividend_events(announced: list[ExDividend], window: Window) -> list[Event]:
    events: list[Event] = []
    for item in announced:
        if not window.contains(item.ex_date):
            continue
        priced = item.shares is not None and item.per_share is not None
        amount = money(item.shares * item.per_share) if priced else None
        detail = item.ticker
        if priced:
            detail += f" · {item.shares.normalize():f} sh × ${item.per_share:.6f}"
        events.append(
            make_event(
                item.ex_date,
                "ex_dividend",
                _REF_SAFE.sub("-", item.ticker)[:60],
                f"Ex-dividend — {item.ticker}",
                shorten(f"Ex-div {item.ticker}"),
                detail=detail,
                amount=amount,
                direction="in",
                basis="estimated",
                href="/portfolio",
            )
        )
    return events
```

```python
# backend/app/services/calendar/generators/taxes.py
"""Federal tax deadlines (spec §6 tax row): the five statutory dates, forward-adjusted.
Amounts — the safe-harbor shortfall split across remaining payment dates and the prior
year's balance on Apr 15 — arrive with Lane D through `TaxFacts`; this module already
accepts the dict so the signature never moves."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.business_days import next_business_day

from ..model import Event, Window, make_event


@dataclass(frozen=True)
class TaxFacts:
    """One tax year's withholding picture, reduced to what the generator prices with
    (filled by api/calendar.py from the withholding tracker — Lane D)."""

    year: int
    effective_threshold: Decimal | None = None
    total_projected: Decimal | None = None
    effective_leg: str | None = None  # "prior-year" | "current-year"
    prior_year_balance: Decimal | None = None  # positive balance owed for year-1 (Apr 15 filing)


def nominal_dates(year: int) -> list[tuple[date, str, str, str]]:
    """(nominal date, detail, entity_ref, short_label) — Jan 15 of Y is Y-1's Q4."""
    return [
        (date(year, 1, 15), f"Q4 {year - 1} estimated payment", f"{year - 1}-q4", "Q4 est. tax"),
        (date(year, 4, 15), "federal filing + Q1 estimated payment", f"{year}-q1", "Filing + Q1 est."),
        (date(year, 6, 15), "Q2 estimated payment", f"{year}-q2", "Q2 est. tax"),
        (date(year, 9, 15), "Q3 estimated payment", f"{year}-q3", "Q3 est. tax"),
        (date(year, 10, 15), "extension filing deadline", f"{year}-extension", "Extension deadline"),
    ]


def tax_deadline_events(window: Window, today: date, facts_by_year: dict[int, TaxFacts]) -> list[Event]:
    events: list[Event] = []
    for year in range(window.start.year, window.end.year + 1):
        for nominal, which, ref, short in nominal_dates(year):
            due = next_business_day(nominal)
            if not window.contains(due):
                continue
            events.append(
                make_event(
                    due,
                    "tax_deadline",
                    ref,
                    f"Tax deadline — {which}",
                    short,
                    detail=which,
                    direction="out",
                    basis="scheduled",
                    href="/taxes",
                )
            )
    return events
```

```python
# backend/app/services/calendar/generators/ritual.py
"""The monthly-update reminder (spec §6 ritual row, §12): one event per month in the
window on the configured due day, for the PREVIOUS month; suppressed once that month's
snapshot exists; re-dated to today while overdue with its key unchanged."""

from datetime import date

from ..model import Event, Window, make_event

_MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)  # our own literal — calendar.month_name is locale-dependent


def _previous_month(month: date) -> date:
    return date(month.year - 1, 12, 1) if month.month == 1 else date(month.year, month.month - 1, 1)


def ritual_events(window: Window, today: date, due_day: int, entered_months: set[date]) -> list[Event]:
    events: list[Event] = []
    for month in window.months():
        nominal = date(month.year, month.month, due_day)
        previous = _previous_month(month)
        if previous in entered_months:
            continue
        overdue = nominal < today
        event_date = today if overdue else nominal
        if not window.contains(event_date):
            continue
        name = f"{_MONTH_NAMES[previous.month - 1]} {previous.year}"
        events.append(
            make_event(
                event_date,
                "update_due",
                previous.strftime("%Y-%m"),
                f"Monthly update — enter {name}",
                "Monthly update",
                detail=(
                    f"Overdue — was due {nominal.isoformat()}"
                    if overdue
                    else f"Enter {name} balances and spending"
                ),
                basis="scheduled",
                href="/update",
                key_date=nominal,
            )
        )
    return events
```

```python
# backend/app/services/calendar/generators/custom.py
"""User-entered rows (spec §6 custom row): stored money, expanded by their recurrence.
`key = custom:<id>:<occurrence>`; a tagged row wears the person suffix on its label."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..model import Event, Window, make_event, shorten
from ..recurrence import expand
from .payroll import person_suffix


@dataclass(frozen=True)
class CustomRow:
    """One stored custom event plus the owner's NAME, resolved by the router — this module
    never reads a person row."""

    event_id: int
    event_date: date
    label: str
    detail: str | None
    person_id: int | None = None
    person_name: str | None = None
    amount: Decimal | None = None
    direction: str = "neutral"
    recurrence: str = "none"
    until: date | None = None


def custom_events(rows: list[CustomRow], window: Window) -> list[Event]:
    events: list[Event] = []
    for row in rows:
        label = row.label if row.person_name is None else row.label + person_suffix(row.person_name)
        recurring = row.recurrence != "none"
        for occurrence in expand(row.recurrence, row.event_date, row.until, window):
            events.append(
                make_event(
                    occurrence,
                    "custom",
                    str(row.event_id),
                    label,
                    shorten(label),
                    detail=row.detail,
                    amount=row.amount,
                    direction=row.direction,
                    basis="confirmed",
                    href=None,
                    event_id=row.event_id,
                    person_id=row.person_id,
                    recurrence=row.recurrence if recurring else None,
                    until=row.until if recurring else None,
                    series_start=row.event_date if recurring else None,
                )
            )
    return events
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_generators.py -q`
Expected: 15 passed. If `test_ex_dividend…` fails on `10 sh`, `Decimal("10").normalize()` formats as `1E+1` — the `:f` format in the module renders `10`; keep the `:f`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/generators backend/tests/calendar/test_generators.py
git commit -m "feat(calendar): pure generators — priced vests, net-pay paydays, espp, ex-dividends, tax dates, ritual, recurring custom"
```

---

### Task 7: `fold.py` — same-day folding for vests and paydays

**Files:**
- Create: `backend/app/services/calendar/fold.py`
- Test: `backend/tests/calendar/test_fold.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/calendar/test_fold.py
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar.fold import fold_same_day
from app.services.calendar.generators.payroll import PaydaySource, payday_events
from app.services.calendar.generators.rsu import vest_events
from app.services.calendar.model import Window

SEP = Window(date(2026, 9, 1), date(2026, 9, 30))


def grant(label, shares):
    # All four vest quarterly from 2026-03-18 at a 25% cliff: Sep 16 carries 6.25% each.
    return SimpleNamespace(label=label, shares=shares, cliff_pct=Decimal("0.25"), first_vest_date=date(2026, 3, 18), vest_quantum=1)


FOUR = [grant("2025 offer", 400), grant("2026 refresh", 160), grant("2024 refresh", 160), grant("2023 refresh", 80)]


def test_four_grants_on_one_date_fold_into_one_priced_event_with_sorted_items():
    [folded] = fold_same_day(vest_events(FOUR, SEP, quote=Decimal("500")))
    assert (folded.event_date, folded.type, folded.key) == (date(2026, 9, 16), "rsu_vest", "rsu:vest:2026-09-16")
    assert (folded.label, folded.short_label) == ("RSU vest — 4 grants", "RSU vest · 4 grants")
    assert folded.amount == Decimal("25000.00")  # (25 + 10 + 10 + 5) sh × $500
    assert [(i.label, i.amount, i.detail) for i in folded.items] == [
        ("2023 refresh", Decimal("2500.00"), "5 sh"),
        ("2024 refresh", Decimal("5000.00"), "10 sh"),
        ("2025 offer", Decimal("12500.00"), "25 sh"),
        ("2026 refresh", Decimal("5000.00"), "10 sh"),
    ]
    assert folded.detail == (
        "2023 refresh: 5 sh; 2024 refresh: 10 sh; 2025 offer: 25 sh; 2026 refresh: 10 sh"
        " · ≈ $16,942.50 after sell-to-cover"
    )
    assert (folded.direction, folded.basis, folded.href) == ("in", "estimated", "/comp")


def test_a_folded_total_is_null_when_any_constituent_is_unpriced():
    events = vest_events(FOUR[:2], SEP, quote=Decimal("500"))
    unpriced = events[1].__class__(**{**events[1].__dict__, "amount": None})
    [folded] = fold_same_day([events[0], unpriced])
    assert folded.amount is None
    assert folded.detail.endswith("2026 refresh: 10 sh")  # no after-tax sentence without a total


def test_a_single_grant_is_left_exactly_as_generated():
    [single] = vest_events(FOUR[:1], SEP, quote=None)
    assert fold_same_day([single]) == [single]


def test_two_people_fold_into_one_payday_with_per_person_items():
    events = payday_events(
        [PaydaySource("Me", True, Decimal("5000"), 1), PaydaySource("Sam", True, Decimal("3750"), 2)],
        Window(date(2026, 8, 1), date(2026, 8, 31)),
    )
    folded = fold_same_day(events)
    assert [(e.event_date, e.label, e.short_label, e.amount, e.detail) for e in folded] == [
        (date(2026, 8, 14), "Payday — Me & Sam", "Payday · 2", Decimal("8750.00"), "2 paychecks"),
        (date(2026, 8, 31), "Payday — Me & Sam", "Payday · 2", Decimal("8750.00"), "2 paychecks"),
    ]
    assert [(i.label, i.amount, i.person_id) for i in folded[0].items] == [("Me", Decimal("5000.00"), 1), ("Sam", Decimal("3750.00"), 2)]
    assert folded[0].key == "payroll:payday:2026-08-14"


def test_single_earner_label_stays_byte_identical():
    events = payday_events([PaydaySource("Me", True, Decimal("5000"), 1)], Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert [e.label for e in fold_same_day(events)] == ["Payday", "Payday"]


def test_other_families_never_fold():
    from app.services.calendar.generators.custom import CustomRow, custom_events

    rows = [CustomRow(1, date(2026, 9, 12), "a", None), CustomRow(2, date(2026, 9, 12), "b", None)]
    assert len(fold_same_day(custom_events(rows, SEP))) == 2
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_fold.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```python
# backend/app/services/calendar/fold.py
"""Same-day folding (2026-09-03 calendar spec §7): rsu_vest and payday events sharing a
date merge into ONE event whose `items` keep the constituents (sorted by label) and whose
amount is the sum — or null when any part is null, because a partial sum would read as a
total. Every other family passes through untouched."""

from dataclasses import replace
from decimal import Decimal

from .generators.rsu import after_sell_to_cover
from .model import FOLDABLE_TYPES, Event, Item


def _total(items: tuple[Item, ...]) -> Decimal | None:
    if any(item.amount is None for item in items):
        return None
    return sum((item.amount for item in items if item.amount is not None), Decimal("0"))


def _merge(group: list[Event]) -> Event:
    first = group[0]
    items = tuple(sorted((item for event in group for item in event.items), key=lambda i: i.label))
    total = _total(items)
    if first.type == "rsu_vest":
        detail = "; ".join(f"{item.label}: {item.detail}" for item in items)
        if total is not None:
            detail += f" · ≈ ${after_sell_to_cover(total):,.2f} after sell-to-cover"
        return replace(
            first,
            label=f"RSU vest — {len(items)} grants",
            short_label=f"RSU vest · {len(items)} grants",
            detail=detail,
            amount=total,
            items=items,
        )
    # payday: one chip for the household's checks that day, every person named in items.
    return replace(
        first,
        label="Payday — " + " & ".join(item.label for item in items),
        short_label=f"Payday · {len(items)}",
        detail=f"{len(items)} paychecks",
        amount=total,
        items=items,
        person_id=None,
    )


def fold_same_day(events: list[Event]) -> list[Event]:
    groups: dict[tuple[str, object], list[Event]] = {}
    passthrough: list[Event] = []
    for event in events:
        if event.type in FOLDABLE_TYPES:
            groups.setdefault((event.type, event.event_date), []).append(event)
        else:
            passthrough.append(event)
    folded = [group[0] if len(group) == 1 else _merge(group) for group in groups.values()]
    return passthrough + folded
```

- [ ] **Step 4: Run the test**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_fold.py -q`
Expected: 6 passed. (`$16,942.50` = 25000 × (1 − 0.3223).)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/fold.py backend/tests/calendar/test_fold.py
git commit -m "feat(calendar): fold same-day vests and paydays into one event with items"
```

---

### Task 8: `overrides.py` — the overlay

**Files:**
- Create: `backend/app/services/calendar/overrides.py`
- Test: `backend/tests/calendar/test_overrides.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/calendar/test_overrides.py
from datetime import date
from decimal import Decimal

from app.services.calendar.model import make_event
from app.services.calendar.overrides import Override, apply


def q3():
    return make_event(date(2026, 9, 15), "tax_deadline", "2026-q3", "Tax deadline — Q3 estimated payment", "Q3 est. tax", amount=Decimal("1200"), direction="out", basis="estimated", href="/taxes")


def test_apply_sets_done_hidden_note_and_the_users_figure():
    [event] = apply([q3()], {"tax:2026-q3:2026-09-15": Override("tax:2026-q3:2026-09-15", True, False, "paid via EFTPS", Decimal("1250"))})
    assert (event.done, event.hidden, event.note) == (True, False, "paid via EFTPS")
    assert (event.amount, event.basis, event.amount_overridden) == (Decimal("1250.00"), "confirmed", True)


def test_a_null_override_amount_leaves_the_derived_figure():
    [event] = apply([q3()], {"tax:2026-q3:2026-09-15": Override("tax:2026-q3:2026-09-15", False, True, None, None)})
    assert (event.amount, event.basis, event.amount_overridden, event.hidden) == (Decimal("1200.00"), "estimated", False, True)


def test_orphan_keys_are_ignored_and_unmatched_events_untouched():
    original = q3()
    assert apply([original], {"rsu:vest:2099-01-01": Override("rsu:vest:2099-01-01", True, True, None, None)}) == [original]
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_overrides.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```python
# backend/app/services/calendar/overrides.py
"""The user-edit overlay (2026-09-03 calendar spec §13), applied AFTER folding so an
override on a folded key lands on the folded event. A key with no event is silently
unmatched — harmless. An override amount wins and turns the basis to `confirmed` (the
user paid it); the drawer says "your figure" through `amount_overridden`."""

from dataclasses import dataclass, replace
from decimal import Decimal

from .model import Event, money


@dataclass(frozen=True)
class Override:
    key: str
    done: bool
    hidden: bool
    note: str | None
    amount: Decimal | None


def apply(events: list[Event], overrides: dict[str, Override]) -> list[Event]:
    if not overrides:
        return list(events)
    out: list[Event] = []
    for event in events:
        override = overrides.get(event.key)
        if override is None:
            out.append(event)
            continue
        changes: dict = {"done": override.done, "hidden": override.hidden, "note": override.note}
        if override.amount is not None:
            changes.update(amount=money(override.amount), basis="confirmed", amount_overridden=True)
        out.append(replace(event, **changes))
    return out
```

- [ ] **Step 4: Run the test**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_overrides.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/overrides.py backend/tests/calendar/test_overrides.py
git commit -m "feat(calendar): override overlay — done, hidden, note, the user's figure"
```

---

### Task 9: `compose()` and `Sources`

**Files:**
- Modify: `backend/app/services/calendar/__init__.py`
- Test: `backend/tests/calendar/test_compose.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/calendar/test_compose.py
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar import Sources, compose
from app.services.calendar.generators.custom import CustomRow
from app.services.calendar.generators.payroll import PaydaySource
from app.services.calendar.model import Window
from app.services.calendar.overrides import Override

TODAY = date(2026, 8, 24)


def test_compose_runs_every_family_folds_overlays_and_sorts():
    grants = [
        SimpleNamespace(label="A", shares=400, cliff_pct=Decimal("0.25"), first_vest_date=date(2026, 3, 18), vest_quantum=1),
        SimpleNamespace(label="B", shares=160, cliff_pct=Decimal("0.25"), first_vest_date=date(2026, 3, 18), vest_quantum=1),
    ]
    sources = Sources(
        grants=grants,
        quote=Decimal("500"),
        payday_sources=[PaydaySource("Me", True, Decimal("5000"), 1)],
        custom_rows=[CustomRow(3, date(2026, 9, 15), "Zoo membership", None, amount=Decimal("120"), direction="out")],
        entered_months={date(2026, 7, 1), date(2026, 8, 1), date(2026, 9, 1)},
    )
    events = compose(
        Window(date(2026, 9, 15), date(2026, 9, 16)),
        today=TODAY,
        sources=sources,
        overrides={"rsu:vest:2026-09-16": Override("rsu:vest:2026-09-16", False, False, "sell 10", None)},
    )
    assert [(e.event_date, e.type, e.label) for e in events] == [
        (date(2026, 9, 15), "custom", "Zoo membership"),
        (date(2026, 9, 15), "payday", "Payday"),
        (date(2026, 9, 15), "tax_deadline", "Tax deadline — Q3 estimated payment"),
        (date(2026, 9, 16), "rsu_vest", "RSU vest — 2 grants"),
    ]
    vest = events[-1]
    assert (vest.amount, vest.note, len(vest.items)) == (Decimal("17500.00"), "sell 10", 2)
    assert {e.key for e in events} == {
        "custom:3:2026-09-15", "payroll:payday:2026-09-15", "tax:2026-q3:2026-09-15", "rsu:vest:2026-09-16",
    }


def test_compose_with_empty_sources_yields_only_the_always_on_families():
    events = compose(Window(date(2026, 9, 1), date(2026, 9, 30)), today=TODAY, sources=Sources())
    # Tax Q3 + the ritual reminders for August (Sep 1) — nothing else exists.
    assert sorted({e.type for e in events}) == ["tax_deadline", "update_due"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_compose.py -q`
Expected: FAIL — `ImportError: cannot import name 'Sources'`.

- [ ] **Step 3: Write `__init__.py`**

```python
# backend/app/services/calendar/__init__.py
"""The calendar engine (2026-09-03 calendar spec §5): generated events are computed on read
from the services the owning pages already use, folded per (type, date) for vests and
paydays, and overlaid with the user's overrides. `compose()` is the only public entry.

Pure — no DB, no HTTP, no clock (`today` is a PARAMETER). The ROUTER loads `Sources`;
pytest drives this with literals."""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.services.espp_calc import OfferingInfo, StoredPeriod

from .fold import fold_same_day
from .generators import custom, dividends, espp, payroll, ritual, rsu, taxes
from .generators.custom import CustomRow
from .generators.dividends import ExDividend
from .generators.payroll import PaydaySource
from .generators.taxes import TaxFacts
from .model import Event, Window
from .overrides import Override
from .overrides import apply as apply_overrides


@dataclass
class Sources:
    """Everything the generators read, as plain values. `cards` is filled by Lane D's card
    generator (`generators/cards.py`); `tax_facts` by Lane D's withholding link."""

    grants: list = field(default_factory=list)  # grant-shaped rows (rsu_vesting.schedule)
    quote: Decimal | None = None  # latest employer quote; None = vests unpriced
    stored_periods: list[StoredPeriod] = field(default_factory=list)
    offerings: list[OfferingInfo] = field(default_factory=list)
    unsold_lots: list[tuple[date, date]] = field(default_factory=list)
    ex_dividends: list[ExDividend] = field(default_factory=list)  # HELD securities only
    payday_sources: list[PaydaySource] = field(default_factory=list)
    custom_rows: list[CustomRow] = field(default_factory=list)
    due_day: int = 1
    entered_months: set[date] = field(default_factory=set)  # first-of-month snapshot months
    tax_facts: dict[int, TaxFacts] = field(default_factory=dict)
    cards: list = field(default_factory=list)  # Lane D: generators.cards.CardFacts


def compose(
    window: Window,
    *,
    today: date,
    sources: Sources,
    overrides: dict[str, Override] | None = None,
) -> list[Event]:
    """Every event in the window, folded, overlaid, sorted by (date, type, label)."""
    events: list[Event] = []
    events += rsu.vest_events(sources.grants, window, quote=sources.quote)
    events += espp.espp_events(sources.stored_periods, sources.offerings, sources.unsold_lots, window)
    events += dividends.ex_dividend_events(sources.ex_dividends, window)
    events += payroll.payday_events(sources.payday_sources, window)
    events += taxes.tax_deadline_events(window, today, sources.tax_facts)
    events += ritual.ritual_events(window, today, sources.due_day, sources.entered_months)
    events += custom.custom_events(sources.custom_rows, window)
    composed = apply_overrides(fold_same_day(events), overrides or {})
    composed.sort(key=lambda event: (event.event_date, event.type, event.label))
    return composed


__all__ = ["Sources", "compose"]
```

- [ ] **Step 4: Run the whole package suite**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar -q`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/__init__.py backend/tests/calendar/test_compose.py
git commit -m "feat(calendar): compose() — generators, fold, overlay, one sort"
```

---

### Task 10: v2 wire schemas and the due-day setting

**Files:**
- Rewrite: `backend/app/schemas/calendar.py`
- Modify: `backend/app/schemas/app_settings.py`, `backend/app/api/app_settings.py`
- Test: `backend/tests/test_app_settings_api.py` (append)

- [ ] **Step 1: Write the failing settings tests**

Append to `backend/tests/test_app_settings_api.py`:

```python
async def test_get_reports_the_default_calendar_due_day(auth_client):
    assert (await auth_client.get(SETTINGS)).json()["calendar_update_due_day"] == 1


async def test_put_stores_the_due_day_and_omitting_it_keeps_the_stored_value(auth_client, db):
    r = await auth_client.put(SETTINGS, json={**VALID_BODY, "calendar_update_due_day": 5})
    assert r.status_code == 200, r.text
    assert r.json()["calendar_update_due_day"] == 5
    assert (await db.get(AppSetting, "calendar_update_due_day")).value == {"value": 5}
    # The app-settings form does not know this field (the Calendar feed card owns it):
    # a PUT without it must not reset the day to 1.
    again = await auth_client.put(SETTINGS, json=VALID_BODY)
    assert again.json()["calendar_update_due_day"] == 5


@pytest.mark.parametrize("bad", [0, 29])
async def test_put_rejects_a_due_day_outside_1_to_28(auth_client, bad):
    r = await auth_client.put(SETTINGS, json={**VALID_BODY, "calendar_update_due_day": bad})
    assert r.status_code == 422
    assert r.json()["detail"] == "calendar_update_due_day: must be between 1 and 28"
```

Also extend the two existing exact-body assertions in that file — `test_get_returns_effective_defaults_on_an_empty_table` and the two `r.json() == {...}` blocks in `test_put_round_trips_and_stores_the_envelope` / `test_put_updates_rows_that_already_exist` — with `"calendar_update_due_day": 1`.

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_app_settings_api.py -q`
Expected: FAIL — KeyError `calendar_update_due_day` / 200 where 422 is expected.

- [ ] **Step 3: Settings schema + router**

`backend/app/schemas/app_settings.py`:

```python
"""App-settings wire shapes. GET/PUT both speak EFFECTIVE values: what a reader would
actually use (fallbacks applied), never the raw envelope."""

from decimal import Decimal

from pydantic import BaseModel


class AppSettingsOut(BaseModel):
    swr_pct: Decimal
    espp_ticker: str | None
    price_refresh_cron: str
    # Day of month (1–28) the monthly-update reminder lands on (2026-09-03 calendar spec §12).
    calendar_update_due_day: int


class AppSettingsUpdate(BaseModel):
    """Full-form PUT (the paycheck/espp whole-form law) for the three original settings.
    `calendar_update_due_day` is the ONE additive exception: None = leave the stored value —
    two Settings cards write this endpoint (the app-settings form and the Calendar feed
    card), and a card that does not show a field must not be able to reset it."""

    swr_pct: Decimal
    espp_ticker: str | None = None
    price_refresh_cron: str
    calendar_update_due_day: int | None = None
```

In `backend/app/api/app_settings.py` add, after `_read_espp_ticker`:

```python
DEFAULT_UPDATE_DUE_DAY = 1
MAX_UPDATE_DUE_DAY = 28  # every month has a 28th — the reminder can never miss a month


async def read_update_due_day(db: AsyncSession) -> int:
    """app_settings['calendar_update_due_day'] envelope {"value": 1..28}; any unexpected
    shape falls back to the default (get_swr_pct's posture). Imported by api/calendar.py."""
    setting = await db.get(AppSetting, "calendar_update_due_day")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_UPDATE_DUE_DAY
    raw = setting.value.get("value")
    if isinstance(raw, bool) or not isinstance(raw, int):
        return DEFAULT_UPDATE_DUE_DAY
    return raw if 1 <= raw <= MAX_UPDATE_DUE_DAY else DEFAULT_UPDATE_DUE_DAY


def _validated_due_day(value: int) -> int:
    if not 1 <= value <= MAX_UPDATE_DUE_DAY:
        raise HTTPException(
            status_code=422,
            detail=f"calendar_update_due_day: must be between 1 and {MAX_UPDATE_DUE_DAY}",
        )
    return value
```

Change `get_settings` to return `calendar_update_due_day=await read_update_due_day(db)`, and in `put_settings`:

```python
    due_day = (
        await read_update_due_day(db)
        if body.calendar_update_due_day is None
        else _validated_due_day(body.calendar_update_due_day)
    )
```

(before the write loop), add `("calendar_update_due_day", {"value": due_day}),` to the `for key, value in (...)` tuple, and add `calendar_update_due_day=due_day` to the returned `AppSettingsOut`.

- [ ] **Step 4: The calendar schemas**

Replace `backend/app/schemas/calendar.py`:

```python
"""Wire shapes for the calendar (2026-09-03 calendar spec §6 v2, additive over v1). Money
is a 2dp Decimal string on the wire; `null` amount = unknowable, never 0."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CalendarEventType = Literal[
    "rsu_vest",
    "espp_purchase",
    "espp_qualify",
    "ex_dividend",
    "payday",
    "offering_start",
    "tax_deadline",
    "update_due",
    "custom",
    "card_fee",
    "card_credit",
    "card_anniversary",
]
CalendarSource = Literal["rsu", "espp", "dividend", "payroll", "tax", "card", "ritual", "custom"]
Direction = Literal["in", "out", "neutral"]
Basis = Literal["confirmed", "scheduled", "estimated"]
Recurrence = Literal["none", "weekly", "monthly", "yearly"]
HealthStatus = Literal["ok", "partial", "off"]


class CalendarItemOut(BaseModel):
    label: str
    amount: Decimal | None
    person_id: int | None
    detail: str | None


class CalendarEventOut(BaseModel):
    # `date: date` is safe in a pydantic body — an annotation-only statement never binds
    # the name, so the type still resolves.
    date: date
    type: CalendarEventType
    source: CalendarSource
    key: str  # "<source>:<entity_ref>:<date>" — stable identity, the ICS UID stem
    entity_ref: str
    label: str  # full sentence: drawer, list, ICS SUMMARY
    short_label: str  # ≤ 24 chars for the chip
    detail: str | None
    amount: Decimal | None  # 2dp; null = unknowable
    direction: Direction
    basis: Basis  # stored fact · stored parameter · quote or model
    items: list[CalendarItemOut]
    href: str | None
    id: int | None  # custom rows only
    person_id: int | None  # custom rows only
    recurrence: Recurrence | None  # custom rows that recur; the edit form needs the series
    until: date | None
    series_start: date | None
    done: bool  # overlay
    hidden: bool  # overlay — the list offers Unhide, the grid removes it before counting
    note: str | None  # overlay
    amount_overridden: bool  # overlay — "your figure"


class SourceHealthOut(BaseModel):
    """One line of the source-health footer (spec §3): which families are on, partial
    (producing with a named gap) or off (nothing configured)."""

    source: CalendarSource
    status: HealthStatus
    note: str | None


class CalendarOut(BaseModel):
    events: list[CalendarEventOut]
    sources: list[SourceHealthOut] = Field(default_factory=list)
    quote_as_of: datetime | None = None  # the employer quote every vest estimate rides


class CustomEventIn(BaseModel):
    """POST/PATCH body — full replace. The four money/recurrence fields default so v1
    clients (and every existing test body) stay valid."""

    date: date
    label: str = Field(min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=300)
    # NULL = household. The bound mirrors the accounts router's: a garbage 10-digit value
    # 422s in the parser rather than reaching the FK.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    amount: Decimal | None = None
    direction: Direction = "neutral"
    recurrence: Recurrence = "none"
    until: date | None = None

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("label must not be blank")
        return stripped

    @field_validator("detail")
    @classmethod
    def _detail_stripped(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def _until_needs_a_series(self) -> "CustomEventIn":
        if self.until is not None and self.recurrence == "none":
            raise ValueError("until requires a recurrence")
        if self.until is not None and self.until < self.date:
            raise ValueError("until must be on or after date")
        return self


class CustomEventOut(BaseModel):
    id: int
    date: date
    label: str  # as STORED — unstamped; the suffix is composed, never persisted
    detail: str | None
    person_id: int | None
    amount: Decimal | None
    direction: Direction
    recurrence: Recurrence
    until: date | None


class OverrideIn(BaseModel):
    """PUT body — full replace (spec §13)."""

    done: bool
    hidden: bool
    note: str | None = Field(default=None, max_length=300)
    amount: Decimal | None = None

    @field_validator("note")
    @classmethod
    def _note_stripped(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class OverrideOut(OverrideIn):
    key: str
```

- [ ] **Step 5: Run the settings tests**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_app_settings_api.py -q`
Expected: all passed. (`tests/test_calendar_api.py` is RED now — the router still builds v1 `CalendarEventOut`s; Task 11 fixes it.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/calendar.py backend/app/schemas/app_settings.py backend/app/api/app_settings.py backend/tests/test_app_settings_api.py
git commit -m "feat(api): calendar v2 wire shapes; calendar_update_due_day setting (1–28)"
```

---

### Task 11: `GET /calendar` on the package, custom CRUD with money, overrides routes

**Files:**
- Rewrite: `backend/app/api/calendar.py`
- Modify: `backend/app/api/export.py`, `backend/tests/test_calendar_api.py`
- Create: `backend/tests/calendar/test_overrides_api.py`

- [ ] **Step 1: Update `tests/test_calendar_api.py` for the v2 shape**

Keep every existing test; change these assertions:

In `test_calendar_composes_the_whole_household_datebook`:

```python
    assert [(e["date"], e["detail"], e["amount"], e["key"]) for e in by_type["rsu_vest"]] == [
        ("2026-09-16", "25 sh — 2025 offer", None, "rsu:vest:2026-09-16")
    ]  # the broken grant is silently absent; no ticker → unpriced (amount null, never 0)
```

and replace the `update_due` assertion with:

```python
    # August's reminder (enter July) was due Aug 1 — overdue, re-dated to today with its key
    # unchanged; September's (enter August) is scheduled.
    assert [(e["date"], e["label"], e["key"], e["href"]) for e in by_type["update_due"]] == [
        ("2026-08-24", "Monthly update — enter July 2026", "ritual:2026-07:2026-08-01", "/update"),
        ("2026-09-01", "Monthly update — enter August 2026", "ritual:2026-08:2026-09-01", "/update"),
    ]
```

add after the payday assertion:

```python
    # 120000 / 24 checks, no deductions → net 5000 per check, folded across ONE person.
    assert {e["amount"] for e in by_type["payday"]} == {"5000.00"}
    assert by_type["payday"][0]["items"] == [
        {"label": "Me", "amount": "5000.00", "person_id": by_type["payday"][0]["items"][0]["person_id"], "detail": None}
    ]
    assert resp.json()["quote_as_of"] is None
    assert [s["source"] for s in resp.json()["sources"]] == ["rsu", "espp", "dividend", "payroll", "tax", "ritual", "custom"]
```

In `test_calendar_update_due_absent_when_previous_month_entered` (rename it `test_calendar_update_due_only_scheduled_when_previous_month_entered`):

```python
    assert [(e["date"], e["label"]) for e in resp.json()["events"] if e["type"] == "update_due"] == [
        ("2026-09-01", "Monthly update — enter August 2026")
    ]
```

In `test_custom_event_crud_roundtrip`, every exact `CustomEventOut` dict gains `"amount": None, "direction": "neutral", "recurrence": "none", "until": None`, and the listed event becomes:

```python
    assert [e for e in listed.json()["events"] if e["type"] == "custom"] == [
        {
            "date": "2026-09-12", "type": "custom", "source": "custom", "key": f"custom:{event_id}:2026-09-12",
            "entity_ref": str(event_id), "label": "Car insurance renewal", "short_label": "Car insurance renewal",
            "detail": None, "amount": None, "direction": "neutral", "basis": "confirmed", "items": [],
            "href": None, "id": event_id, "person_id": None, "recurrence": None, "until": None,
            "series_start": None, "done": False, "hidden": False, "note": None, "amount_overridden": False,
        }
    ]
```

In `test_custom_event_person_tag_stamps_the_label`, the `created.json() == {...}` dict gains the same four defaults.

Append these tests:

```python
async def test_calendar_prices_vests_from_the_employer_quote(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    from datetime import UTC, datetime

    from app.models import AppSetting, LatestPrice

    nvda = Security(ticker="NVDA", name="NVDA Inc", holding_type="stock")
    db.add_all([nvda, AppSetting(key="espp_ticker", value={"value": "NVDA"})])
    await db.flush()
    db.add(LatestPrice(security_id=nvda.id, price=Decimal("500.0000"), quoted_at=datetime(2026, 8, 21, 20, tzinfo=UTC), source="yfinance"))
    db.add_all(
        [
            RsuGrant(kind="new_hire", label="2025 offer", focal_year=None, shares=400, grant_price=Decimal("100"), first_vest_date=date(2026, 3, 18), cliff_pct=Decimal("0.25"), vest_quantum=1),
            RsuGrant(kind="refresh", label="2026 refresh", focal_year=2026, shares=160, grant_price=Decimal("100"), first_vest_date=date(2026, 3, 18), cliff_pct=Decimal("0.25"), vest_quantum=1),
        ]
    )
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    [vest] = [e for e in body["events"] if e["type"] == "rsu_vest"]
    assert (vest["label"], vest["short_label"], vest["amount"], vest["basis"]) == ("RSU vest — 2 grants", "RSU vest · 2 grants", "17500.00", "estimated")
    assert [(i["label"], i["amount"], i["detail"]) for i in vest["items"]] == [("2025 offer", "12500.00", "25 sh"), ("2026 refresh", "5000.00", "10 sh")]
    assert body["quote_as_of"] == "2026-08-21T20:00:00Z"
    assert next(s for s in body["sources"] if s["source"] == "rsu") == {"source": "rsu", "status": "ok", "note": "valued at the NVDA quote"}


async def test_calendar_folds_two_paydays_and_names_an_omitted_cadence(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    me = Person(name="Me", is_primary=True)
    sam = Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.flush()
    db.add_all(
        [
            PaycheckProfile(effective_date=date(2026, 1, 1), annual_salary=Decimal("120000"), person_id=me.id),
            PaycheckProfile(effective_date=date(2026, 2, 1), annual_salary=Decimal("90000"), person_id=sam.id),
        ]
    )
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")).json()
    paydays = [e for e in body["events"] if e["type"] == "payday"]
    assert [(e["date"], e["label"], e["short_label"], e["amount"]) for e in paydays] == [
        ("2026-08-14", "Payday — Me & Sam", "Payday · 2", "8750.00"),
        ("2026-08-31", "Payday — Me & Sam", "Payday · 2", "8750.00"),
    ]
    assert [(i["label"], i["amount"], i["person_id"]) for i in paydays[0]["items"]] == [("Me", "5000.00", me.id), ("Sam", "3750.00", sam.id)]
    assert next(s for s in body["sources"] if s["source"] == "payroll") == {"source": "payroll", "status": "ok", "note": None}

    # Flip Sam to biweekly: her chips are omitted and the footer says so.
    sam_profile = (await db.execute(select(PaycheckProfile).where(PaycheckProfile.person_id == sam.id))).scalars().one()
    sam_profile.pay_periods_per_year = 26
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")).json()
    assert [e["label"] for e in body["events"] if e["type"] == "payday"] == ["Payday — Me", "Payday — Me"]
    assert next(s for s in body["sources"] if s["source"] == "payroll") == {
        "source": "payroll", "status": "partial", "note": "Sam: paid on another cadence — paydays omitted",
    }


async def test_custom_event_money_and_recurrence_round_trip(auth_client):
    created = await auth_client.post(
        f"{CALENDAR}/events",
        json={"date": "2026-01-31", "label": "Rent", "amount": "2400", "direction": "out", "recurrence": "monthly", "until": "2026-04-30"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["amount"], body["direction"], body["recurrence"], body["until"]) == ("2400.00", "out", "monthly", "2026-04-30")
    listed = (await auth_client.get(f"{CALENDAR}?start=2026-02-01&end=2026-05-31")).json()["events"]
    rent = [e for e in listed if e["type"] == "custom"]
    assert [(e["date"], e["key"], e["amount"], e["series_start"], e["recurrence"]) for e in rent] == [
        ("2026-02-28", f"custom:{body['id']}:2026-02-28", "2400.00", "2026-01-31", "monthly"),
        ("2026-03-31", f"custom:{body['id']}:2026-03-31", "2400.00", "2026-01-31", "monthly"),
        ("2026-04-30", f"custom:{body['id']}:2026-04-30", "2400.00", "2026-01-31", "monthly"),
    ]
    # Whole-series edit: the PATCH moves every occurrence.
    patched = await auth_client.patch(
        f"{CALENDAR}/events/{body['id']}",
        json={"date": "2026-01-31", "label": "Rent", "amount": "2500", "direction": "out", "recurrence": "monthly", "until": "2026-03-31"},
    )
    assert patched.status_code == 200
    listed = (await auth_client.get(f"{CALENDAR}?start=2026-02-01&end=2026-05-31")).json()["events"]
    assert [e["amount"] for e in listed if e["type"] == "custom"] == ["2500.00", "2500.00"]


async def test_custom_event_money_validation(auth_client):
    base = {"date": "2026-09-12", "label": "ok"}
    assert (await auth_client.post(f"{CALENDAR}/events", json={**base, "direction": "sideways"})).status_code == 422
    assert (await auth_client.post(f"{CALENDAR}/events", json={**base, "recurrence": "daily"})).status_code == 422
    assert (await auth_client.post(f"{CALENDAR}/events", json={**base, "until": "2026-12-31"})).status_code == 422  # until without a series
    assert (await auth_client.post(f"{CALENDAR}/events", json={**base, "recurrence": "weekly", "until": "2026-09-01"})).status_code == 422  # before date
    too_big = await auth_client.post(f"{CALENDAR}/events", json={**base, "amount": "10000000000"})
    assert too_big.status_code == 422  # Numeric(12,2) fence via quantize_money
```

- [ ] **Step 2: Write the overrides API test**

```python
# backend/tests/calendar/test_overrides_api.py
"""PUT/DELETE /calendar/overrides/{key} (2026-09-03 calendar spec §13) and the overlay
riding GET /calendar."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import CalendarEventOverride, NetWorthSnapshot

CALENDAR = "/api/v1/calendar"
Q3 = "tax:2026-q3:2026-09-15"


def freeze_today(monkeypatch):
    monkeypatch.setattr("app.api.calendar.product_today", lambda: date(2026, 8, 24))


async def test_put_upserts_full_replace_and_get_applies_it(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    db.add(NetWorthSnapshot(month=date(2026, 7, 1)))
    await db.commit()
    first = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json={"done": True, "hidden": False, "note": " paid ", "amount": "1250"})
    assert first.status_code == 200, first.text
    assert first.json() == {"key": Q3, "done": True, "hidden": False, "note": "paid", "amount": "1250.00"}
    [q3] = [e for e in (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()["events"] if e["key"] == Q3]
    assert (q3["done"], q3["note"], q3["amount"], q3["basis"], q3["amount_overridden"]) == (True, "paid", "1250.00", "confirmed", True)

    # Full replace: a second PUT without the amount CLEARS it (and the row is reused).
    second = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json={"done": False, "hidden": True, "note": None, "amount": None})
    assert second.json() == {"key": Q3, "done": False, "hidden": True, "note": None, "amount": None}
    rows = (await db.execute(select(CalendarEventOverride))).scalars().all()
    assert len(rows) == 1 and rows[0].done_at is None and rows[0].hidden is True
    [q3] = [e for e in (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()["events"] if e["key"] == Q3]
    assert (q3["hidden"], q3["amount"], q3["amount_overridden"]) == (True, None, False)


async def test_delete_clears_and_404s_when_unknown(auth_client):
    await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json={"done": True, "hidden": False, "note": None, "amount": None})
    assert (await auth_client.delete(f"{CALENDAR}/overrides/{Q3}")).status_code == 204
    assert (await auth_client.delete(f"{CALENDAR}/overrides/{Q3}")).status_code == 404


async def test_key_grammar_is_validated(auth_client):
    body = {"done": True, "hidden": False, "note": None, "amount": None}
    assert (await auth_client.put(f"{CALENDAR}/overrides/nokey", json=body)).status_code == 422
    assert (await auth_client.put(f"{CALENDAR}/overrides/RSU:vest:2026-09-16", json=body)).status_code == 422
    assert (await auth_client.put(f"{CALENDAR}/overrides/rsu:vest:2026-9-16", json=body)).status_code == 422
    assert (await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json={**body, "note": "x" * 301})).status_code == 422
    assert (await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json={**body, "amount": "1e15"})).status_code == 422


async def test_an_orphan_override_is_harmless(auth_client, monkeypatch):
    freeze_today(monkeypatch)
    assert (await auth_client.put(f"{CALENDAR}/overrides/rsu:vest:2099-01-01", json={"done": True, "hidden": True, "note": None, "amount": None})).status_code == 200
    assert (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).status_code == 200


async def test_overrides_require_auth(client):
    assert (await client.put(f"{CALENDAR}/overrides/{Q3}", json={"done": True, "hidden": False, "note": None, "amount": None})).status_code == 401
```

- [ ] **Step 3: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_calendar_api.py tests/calendar/test_overrides_api.py -q`
Expected: FAIL — v1 payload shapes, 404/405 on the overrides routes.

- [ ] **Step 4: Rewrite the router**

Replace `backend/app/api/calendar.py`:

```python
"""The calendar router (2026-09-03 calendar spec §5, §13, §16): LOADERS only — every
rule lives in services/calendar, driven here as plain values. Regions, in order:

  1. loaders  → `_load_sources` (Lane D appends card / tax / dividend facts HERE)
  2. `_compose_for` + GET /calendar
  3. custom events CRUD
  4. overrides PUT/DELETE
  5. (Lane B appends the ICS export, the token feed and token CRUD AFTER this file's end)

GET-never-rejects: every degradable source degrades inside the loaders or compose();
nothing stored can 500 this."""

from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.app_settings import read_update_due_day
from app.api.deps import get_current_user
from app.api.espp import _espp_quote
from app.database import get_db
from app.models import (
    CalendarEventOverride,
    CustomEvent,
    EsppLot,
    EsppOffering,
    EsppPeriod,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PositionTransaction,
    RsuGrant,
    Security,
)
from app.schemas.calendar import (
    CalendarEventOut,
    CalendarItemOut,
    CalendarOut,
    CustomEventIn,
    CustomEventOut,
    OverrideIn,
    OverrideOut,
    SourceHealthOut,
)
from app.services import rsu_vesting
from app.services.calendar import Sources, compose
from app.services.calendar.generators.custom import CustomRow
from app.services.calendar.generators.dividends import ExDividend
from app.services.calendar.generators.payroll import PaydaySource
from app.services.calendar.model import KEY_RE, Event, Window
from app.services.calendar.overrides import Override
from app.services.espp_calc import OfferingInfo, StoredPeriod
from app.services.money import MONEY_MAX_ABS_12_2, quantize_money
from app.services.paycheck_calc import breakdown, half_up2
from app.services.people import load_people, primary_person
from app.services.portfolio_calc import SHARE_Q, fold_transactions
from app.services.scheduler import product_today

router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
# A year plus wrap slack; the frontend asks for ~3-month windows, the fence is only
# against a runaway query composing decades of derived events.
MAX_SPAN_DAYS = 400
# The one cadence this calendar can date (spec §5). Any other cadence omits that person's
# paydays entirely — named in the health footer, never guessed here.
SEMI_MONTHLY_PERIODS = 24
# Used only when the roster has not been seeded at all, where there is exactly ONE payday
# source and the label is therefore never rendered.
UNNAMED_PERSON = "You"
# The overrides key grammar (spec §13), checked by the path parser so a malformed key 422s.
KEY_PATTERN = KEY_RE.pattern


# --- 1. loaders --------------------------------------------------------------------------


def _health(source: str, status: str, note: str | None = None) -> SourceHealthOut:
    return SourceHealthOut(source=source, status=status, note=note)


async def _held_ex_dividends(db: AsyncSession) -> list[ExDividend]:
    """(ticker, next_ex_div_date, held shares) for ACTIVE securities carrying an
    announcement that are actually HELD — folded shares > 0 summed across accounts
    (allocation()'s zero-share rule, SHARE_Q quantize included so dust does not count).
    Lane D adds the per-share estimate."""
    candidates = list(
        (
            await db.execute(
                select(Security)
                .where(Security.is_active.is_(True), Security.next_ex_div_date.is_not(None))
                .order_by(Security.ticker)
            )
        ).scalars()
    )
    if not candidates:
        return []
    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(PositionTransaction.sort_index, PositionTransaction.id)
            )
        ).scalars()
    )
    shares_by_sec: dict[int, Decimal] = {}
    for pos in fold_transactions(txns).values():
        shares_by_sec[pos.security_id] = shares_by_sec.get(pos.security_id, ZERO) + pos.shares
    held: list[ExDividend] = []
    for security in candidates:
        shares = shares_by_sec.get(security.id, ZERO).quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        if shares > 0:
            held.append(ExDividend(security.ticker, security.next_ex_div_date, shares, None))
    return held


def _schedulable(grant: RsuGrant) -> bool:
    try:
        rsu_vesting.schedule(grant)
    except (ValueError, OverflowError):
        return False
    return True


async def _payday_sources(db: AsyncSession, today: date) -> tuple[list[PaydaySource], SourceHealthOut]:
    """Paydays follow the profile IN FORCE for EACH person (2026-08-27 spec §4.4), not "the
    newest row": the latest row effective today or earlier, else the earliest future one —
    paycheck.py's `_default_profile` rule, resolved in ONE ordered pass."""
    people = await load_people(db)
    primary = primary_person(people)
    in_force: dict[int | None, PaycheckProfile] = {}
    for profile in (
        await db.execute(select(PaycheckProfile).order_by(PaycheckProfile.effective_date))
    ).scalars():
        # A NULL person_id is the pre-household spelling of "the primary"; with no roster
        # every profile shares the one None bucket — the single unlabelled household.
        owner = profile.person_id if profile.person_id is not None else (None if primary is None else primary.id)
        if profile.effective_date <= today or owner not in in_force:
            in_force[owner] = profile
    owners: list[int | None] = [person.id for person in people if person.id in in_force]
    if None in in_force:
        owners.append(None)
    names = {person.id: person.name for person in people}
    sources: list[PaydaySource] = []
    omitted: list[str] = []
    for owner in owners:
        profile = in_force[owner]
        name = UNNAMED_PERSON if owner is None else names.get(owner, UNNAMED_PERSON)
        semi_monthly = profile.pay_periods_per_year == SEMI_MONTHLY_PERIODS
        # Net pay per check from the same waterfall the Paycheck page shows; a hand-edited
        # cadence breakdown cannot divide by is left unpriced rather than invented.
        net = half_up2(breakdown(profile)["net_pay"]) if profile.pay_periods_per_year >= 1 else None
        sources.append(PaydaySource(name, semi_monthly, net, owner))
        if not semi_monthly:
            omitted.append(name)
    if not sources:
        return sources, _health("payroll", "off", "no paycheck profile")
    if omitted:
        return sources, _health("payroll", "partial", f"{', '.join(omitted)}: paid on another cadence — paydays omitted")
    return sources, _health("payroll", "ok")


async def _custom_rows(db: AsyncSession, window: Window, names: dict[int, str]) -> list[CustomRow]:
    """Rows whose occurrences CAN land in the window: a single date inside it, or a series
    that started on or before the window end and has not ended before the window start."""
    rows = (
        await db.execute(
            select(CustomEvent)
            .where(
                CustomEvent.event_date <= window.end,
                (CustomEvent.recurrence != "none") | (CustomEvent.event_date >= window.start),
                (CustomEvent.until.is_(None)) | (CustomEvent.until >= window.start),
            )
            .order_by(CustomEvent.event_date, CustomEvent.id)
        )
    ).scalars()
    return [
        CustomRow(
            event_id=row.id,
            event_date=row.event_date,
            label=row.label,
            detail=row.detail,
            person_id=row.person_id,
            # A tag pointing at a person who is somehow absent degrades to UNSTAMPED rather
            # than 500ing (GET-never-rejects) — the row still renders, without its name.
            person_name=None if row.person_id is None else names.get(row.person_id),
            amount=row.amount,
            direction=row.direction,
            recurrence=row.recurrence,
            until=row.until,
        )
        for row in rows
    ]


async def _load_sources(
    db: AsyncSession, window: Window, today: date
) -> tuple[Sources, list[SourceHealthOut], datetime | None]:
    """Every generator input as plain values, plus the health footer and the quote stamp.
    Health rows come out in SOURCE_FAMILIES order; Lane D inserts `card` between tax and
    ritual and refines the tax and dividend notes."""
    health: list[SourceHealthOut] = []

    grants = list((await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id))).scalars())
    ticker, quote, quoted_at = await _espp_quote(db)
    unschedulable = [grant.label for grant in grants if not _schedulable(grant)]
    if not grants:
        health.append(_health("rsu", "off", "no RSU grants entered"))
    elif quote is None:
        health.append(
            _health(
                "rsu",
                "partial",
                "no ESPP/employer ticker configured — vest values unknown"
                if ticker is None
                else f"no current {ticker} price — vest values unknown",
            )
        )
    elif unschedulable:
        health.append(_health("rsu", "partial", f"{len(unschedulable)} grant(s) cannot be scheduled"))
    else:
        health.append(_health("rsu", "ok", f"valued at the {ticker} quote"))

    stored_periods = [
        StoredPeriod(
            id=row.id,
            label=row.label,
            period_start=row.period_start,
            period_end=row.period_end,
            semi_annual_base=row.semi_annual_base,
            additional_payments=row.additional_payments,
            contribution_pct=row.contribution_pct,
        )
        for row in (await db.execute(select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))).scalars()
    ]
    offerings = [
        OfferingInfo(offering_start=row.offering_start, subscription_price=row.subscription_price)
        for row in (await db.execute(select(EsppOffering).order_by(EsppOffering.offering_start))).scalars()
    ]
    unsold_lots = [
        (row.purchase_date, row.qualifying_date)
        for row in (
            await db.execute(select(EsppLot).where(EsppLot.sold_date.is_(None)).order_by(EsppLot.purchase_date))
        ).scalars()
    ]
    health.append(
        _health("espp", "ok")
        if stored_periods
        else _health("espp", "partial", "no purchase periods stored — purchase dates are derived")
    )

    ex_dividends = await _held_ex_dividends(db)
    health.append(
        _health("dividend", "ok") if ex_dividends else _health("dividend", "off", "no announced ex-dividend dates on held securities")
    )

    payday_sources, payroll_health = await _payday_sources(db, today)
    health.append(payroll_health)

    health.append(_health("tax", "ok", "statutory dates; amounts arrive with the withholding tracker"))

    due_day = await read_update_due_day(db)
    entered_months = set((await db.execute(select(NetWorthSnapshot.month))).scalars().all())
    health.append(_health("ritual", "ok", f"reminder on day {due_day} of each month"))

    names = {person.id: person.name for person in await load_people(db)}
    custom_rows = await _custom_rows(db, window, names)
    health.append(_health("custom", "ok"))

    sources = Sources(
        grants=grants,
        quote=quote,
        stored_periods=stored_periods,
        offerings=offerings,
        unsold_lots=unsold_lots,
        ex_dividends=ex_dividends,
        payday_sources=payday_sources,
        custom_rows=custom_rows,
        due_day=due_day,
        entered_months=entered_months,
    )
    return sources, health, quoted_at


async def _overrides(db: AsyncSession) -> dict[str, Override]:
    rows = (await db.execute(select(CalendarEventOverride))).scalars()
    return {
        row.event_key: Override(row.event_key, row.done_at is not None, row.hidden, row.note, row.amount)
        for row in rows
    }


# --- 2. compose + GET --------------------------------------------------------------------


async def _compose_for(
    db: AsyncSession, start: date, end: date, today: date
) -> tuple[list[Event], list[SourceHealthOut], datetime | None]:
    """Shared by GET /calendar and Lane B's ICS routes: load, compose, overlay."""
    window = Window(start, end)
    sources, health, quoted_at = await _load_sources(db, window, today)
    events = compose(window, today=today, sources=sources, overrides=await _overrides(db))
    return events, health, quoted_at


def _event_out(event: Event) -> CalendarEventOut:
    return CalendarEventOut(
        date=event.event_date,
        type=event.type,
        source=event.source,
        key=event.key,
        entity_ref=event.entity_ref,
        label=event.label,
        short_label=event.short_label,
        detail=event.detail,
        amount=event.amount,
        direction=event.direction,
        basis=event.basis,
        items=[
            CalendarItemOut(label=item.label, amount=item.amount, person_id=item.person_id, detail=item.detail)
            for item in event.items
        ],
        href=event.href,
        id=event.event_id,
        person_id=event.person_id,
        recurrence=event.recurrence,
        until=event.until,
        series_start=event.series_start,
        done=event.done,
        hidden=event.hidden,
        note=event.note,
        amount_overridden=event.amount_overridden,
    )


def _validated_span(start: date, end: date) -> None:
    if start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end")
    if (end - start).days > MAX_SPAN_DAYS:
        raise HTTPException(status_code=422, detail=f"start to end must span at most {MAX_SPAN_DAYS} days")


@router.get("", response_model=CalendarOut)
async def get_calendar(start: date, end: date, db: AsyncSession = Depends(get_db)) -> CalendarOut:
    """{events, sources, quote_as_of} for [start, end] INCLUSIVE, sorted by (date, type,
    label). 422 on a reversed pair or a span past 400 days."""
    _validated_span(start, end)
    # product_today, never date.today(): the reminder date and the fold's "today" must
    # agree with the scheduler-zone day (comp.py's clock rule).
    events, health, quoted_at = await _compose_for(db, start, end, product_today())
    return CalendarOut(events=[_event_out(event) for event in events], sources=health, quote_as_of=quoted_at)


# --- 3. custom events: the one stored, user-owned source (spec §9.3 + money §6) ---------


def _custom_out(row: CustomEvent) -> CustomEventOut:
    return CustomEventOut(
        id=row.id,
        date=row.event_date,
        label=row.label,
        detail=row.detail,
        person_id=row.person_id,
        amount=row.amount,
        direction=row.direction,
        recurrence=row.recurrence,
        until=row.until,
    )


async def _get_custom_event(db: AsyncSession, event_id: int) -> CustomEvent:
    row = (await db.execute(select(CustomEvent).where(CustomEvent.id == event_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="custom event not found")
    return row


async def _validated_person_id(db: AsyncSession, person_id: int | None) -> int | None:
    """422 with the net-worth router's sentence, checked before the write so a bad id never
    surfaces as asyncpg's ForeignKeyViolationError inside a 500."""
    if person_id is not None and (await db.get(Person, person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {person_id}")
    return person_id


def _validated_amount(value: Decimal | None) -> Decimal | None:
    # Numeric(12,2): quantize_money's bounded quantize 422s a figure the column cannot hold.
    return None if value is None else quantize_money(value, "amount", max_abs=MONEY_MAX_ABS_12_2)


@router.post("/events", response_model=CustomEventOut, status_code=201)
async def create_custom_event(body: CustomEventIn, db: AsyncSession = Depends(get_db)) -> CustomEventOut:
    row = CustomEvent(
        event_date=body.date,
        label=body.label,
        detail=body.detail,
        person_id=await _validated_person_id(db, body.person_id),
        amount=_validated_amount(body.amount),
        direction=body.direction,
        recurrence=body.recurrence,
        until=body.until,
    )
    db.add(row)
    await db.commit()
    return _custom_out(row)


@router.patch("/events/{event_id}", response_model=CustomEventOut)
async def update_custom_event(
    event_id: int, body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    """Full replace — the form always submits every field. Whole-series edits only: a
    recurring row is one row, so this moves every occurrence at once (spec §2)."""
    row = await _get_custom_event(db, event_id)
    row.person_id = await _validated_person_id(db, body.person_id)
    row.event_date = body.date
    row.label = body.label
    row.detail = body.detail
    row.amount = _validated_amount(body.amount)
    row.direction = body.direction
    row.recurrence = body.recurrence
    row.until = body.until
    await db.commit()
    return _custom_out(row)


@router.delete("/events/{event_id}", status_code=204)
async def delete_custom_event(event_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_custom_event(db, event_id))
    await db.commit()
    return Response(status_code=204)


# --- 4. overrides: the user's edits on generated events (spec §13) ----------------------


def _override_out(row: CalendarEventOverride) -> OverrideOut:
    return OverrideOut(key=row.event_key, done=row.done_at is not None, hidden=row.hidden, note=row.note, amount=row.amount)


@router.put("/overrides/{key}", response_model=OverrideOut)
async def put_override(
    body: OverrideIn,
    key: str = Path(pattern=KEY_PATTERN, max_length=120),
    db: AsyncSession = Depends(get_db),
) -> OverrideOut:
    """Upsert, full replace (the house law): a PUT without an amount clears the figure."""
    amount = _validated_amount(body.amount)
    row = (
        await db.execute(select(CalendarEventOverride).where(CalendarEventOverride.event_key == key))
    ).scalar_one_or_none()
    if row is None:
        row = CalendarEventOverride(event_key=key)
        db.add(row)
    # done_at keeps WHEN it was ticked; a re-PUT with done=True on an already-done row
    # leaves the original stamp alone.
    if body.done and row.done_at is None:
        row.done_at = datetime.now(tz=__import__("datetime").UTC)
    elif not body.done:
        row.done_at = None
    row.hidden = body.hidden
    row.note = body.note
    row.amount = amount
    await db.commit()
    return _override_out(row)


@router.delete("/overrides/{key}", status_code=204)
async def delete_override(
    key: str = Path(pattern=KEY_PATTERN, max_length=120), db: AsyncSession = Depends(get_db)
) -> Response:
    row = (
        await db.execute(select(CalendarEventOverride).where(CalendarEventOverride.event_key == key))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="override not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)
```

Replace the `__import__("datetime").UTC` dodge with a proper import: change the top import to `from datetime import UTC, date, datetime, timedelta` and write `datetime.now(tz=UTC)`. (`timedelta` is kept for Lane B's feed window.)

In `backend/app/api/export.py`: import `CalendarEventOverride, CalendarFeedToken` from `app.models` and add, after `(CustomEvent, "custom_events"),`:

```python
    (CalendarEventOverride, "calendar_event_overrides"),
    (CalendarFeedToken, "calendar_feed_tokens"),
```

- [ ] **Step 5: Run the router suites**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_calendar_api.py tests/calendar tests/test_export_api.py tests/test_assistant_context.py tests/test_assistant_tools.py -q`
Expected: all passed. `ruff` may flag the unused `timedelta` import — keep it only if Lane B is imminent; otherwise drop it and let Lane B add it. Run `../../../backend/.venv/Scripts/python.exe -m ruff check app tests && ../../../backend/.venv/Scripts/python.exe -m ruff format --check app tests` and fix what it names (line length 100 — wrap the long test assertions above).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/calendar.py backend/app/api/export.py backend/tests/test_calendar_api.py backend/tests/calendar/test_overrides_api.py
git commit -m "feat(api): GET /calendar on services/calendar — money, folding, overlay, health; overrides PUT/DELETE; custom money + recurrence"
```

---

### Task 12: Importer-immunity pins for the two new tables

**Files:**
- Modify: `backend/tests/test_importer_apply.py` (append)

- [ ] **Step 1: Write the pins**

Append (the file already imports `select`, `date`, `build_workbook` and `CustomEvent`; add `CalendarEventOverride, CalendarFeedToken, User` to its `from app.models import (...)` and `from app.security import hash_password`):

```python
def override_row(row: CalendarEventOverride) -> tuple:
    return tuple(getattr(row, column.key) for column in CalendarEventOverride.__table__.columns)


async def test_importer_never_writes_calendar_event_overrides(db):
    """calendar_event_overrides is dashboard-only (2026-09-03 calendar spec §13, the
    custom_events posture): a re-import must neither create, update nor delete a row."""
    from app.importer.service import run_import

    db.add(CalendarEventOverride(event_key="tax:2026-q3:2026-09-15", hidden=True, note="kept"))
    await db.commit()
    before = {row.id: override_row(row) for row in (await db.execute(select(CalendarEventOverride))).scalars()}
    assert len(before) == 1
    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True
    after = {
        row.id: override_row(row)
        for row in (
            await db.execute(select(CalendarEventOverride).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("calendar_event_overrides" not in sheet.entities for sheet in report.sheets.values())


async def test_importer_never_writes_calendar_feed_tokens(db):
    """calendar_feed_tokens is dashboard-only (2026-09-03 calendar spec §11): same pin."""
    from app.importer.service import run_import

    user = User(email="pin@example.com", password_hash=hash_password("correct-horse"))
    db.add(user)
    await db.flush()
    db.add(CalendarFeedToken(user_id=user.id, token_hash="b" * 64, label="phone"))
    await db.commit()
    before = {
        row.id: (row.user_id, row.token_hash, row.label, row.created_at, row.last_used_at)
        for row in (await db.execute(select(CalendarFeedToken))).scalars()
    }
    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True
    after = {
        row.id: (row.user_id, row.token_hash, row.label, row.created_at, row.last_used_at)
        for row in (
            await db.execute(select(CalendarFeedToken).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("calendar_feed_tokens" not in sheet.entities for sheet in report.sheets.values())
```

- [ ] **Step 2: Run**

Run: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q -k "calendar"`
Expected: 3 passed (the existing custom_events pin plus the two new ones).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_importer_apply.py
git commit -m "test(importer): pin importer immunity for calendar_event_overrides and calendar_feed_tokens"
```

---

### Task 13: Frontend v2 types, client functions, the fixture builder, green suites

**Files:**
- Modify: `src/types/api.ts`, `src/api/calendar.ts`, `src/components/calendar/calendarView.ts`, `src/components/calendar/calendarView.test.ts`, `src/pages/CalendarPage.tsx`, `src/pages/CalendarPage.test.tsx`, `src/utils/ics.test.ts`, `src/components/overview/upNext.test.ts`, `src/pages/OverviewPage.test.tsx`
- Create: `src/testing/calendarFixtures.ts`

- [ ] **Step 1: Types**

In `src/types/api.ts` replace the `// --- calendar ---` block through `CustomEventOut` with:

```ts
// --- calendar ---

export type CalendarEventType =
  | 'rsu_vest'
  | 'espp_purchase'
  | 'espp_qualify'
  | 'ex_dividend'
  | 'payday'
  | 'offering_start'
  | 'tax_deadline'
  | 'update_due'
  | 'custom'
  | 'card_fee'
  | 'card_credit'
  | 'card_anniversary'

/** The seven derived families plus custom — the eight chip palette slots (2026-09-03
 *  calendar spec §7). */
export type CalendarSource = 'rsu' | 'espp' | 'dividend' | 'payroll' | 'tax' | 'card' | 'ritual' | 'custom'
export type CalendarDirection = 'in' | 'out' | 'neutral'
/** stored fact · stored parameter · quote or model */
export type CalendarBasis = 'confirmed' | 'scheduled' | 'estimated'
export type CalendarRecurrence = 'none' | 'weekly' | 'monthly' | 'yearly'

export interface CalendarItem {
  label: string
  amount: string | null
  person_id: number | null
  detail: string | null
}

// One forward-looking event with money (2026-09-03 calendar spec §6). `key` is
// "<source>:<entity_ref>:<date>" — stable identity, the ICS UID stem, the overrides
// handle. Same-day vests and paydays arrive FOLDED: one event, constituents in `items`.
export interface CalendarEvent {
  date: string // ISO YYYY-MM-DD
  type: CalendarEventType
  source: CalendarSource
  key: string
  entity_ref: string
  label: string // full sentence: drawer, list, ICS SUMMARY
  short_label: string // ≤ 24 chars for the chip
  detail: string | null
  amount: string | null // 2dp decimal string; null = unknowable, never 0
  direction: CalendarDirection
  basis: CalendarBasis
  items: CalendarItem[]
  href: string | null // null for custom events — they have no page
  id: number | null // custom rows only, the edit/delete handle
  /** Custom rows only. When not null the server has stamped " — <name>" onto `label`;
   *  anything that re-saves the row strips it first (calendarView.stripPersonSuffix). */
  person_id: number | null
  /** Custom rows that recur: the series the edit form must round-trip. */
  recurrence: CalendarRecurrence | null
  until: string | null
  series_start: string | null
  // --- the user's overlay (spec §13)
  done: boolean
  hidden: boolean
  note: string | null
  amount_overridden: boolean
}

export interface SourceHealth {
  source: CalendarSource
  status: 'ok' | 'partial' | 'off'
  note: string | null
}

export interface CalendarResponse {
  events: CalendarEvent[]
  sources: SourceHealth[]
  /** The employer quote every vest estimate rides (ISO datetime), or null. */
  quote_as_of: string | null
}

// POST/PATCH body — full replace (the form always submits every field).
export interface CustomEventBody {
  date: string
  label: string
  detail: string | null
  /** null = household. */
  person_id: number | null
  amount: string | null
  direction: CalendarDirection
  recurrence: CalendarRecurrence
  /** Inclusive series end; only with a recurrence. */
  until: string | null
}

export interface CustomEventOut {
  id: number
  date: string
  /** As STORED — unstamped. The suffix is composed by GET /calendar, never persisted. */
  label: string
  detail: string | null
  person_id: number | null
  amount: string | null
  direction: CalendarDirection
  recurrence: CalendarRecurrence
  until: string | null
}

/** PUT /calendar/overrides/{key} — full replace. */
export interface CalendarOverrideBody {
  done: boolean
  hidden: boolean
  note: string | null
  amount: string | null
}

export interface CalendarOverrideOut extends CalendarOverrideBody {
  key: string
}
```

and replace the app-settings pair with:

```ts
export interface AppSettingsOut {
  swr_pct: string
  espp_ticker: string | null
  price_refresh_cron: string
  /** Day of month (1–28) the monthly-update reminder lands on (2026-09-03 calendar spec §12). */
  calendar_update_due_day: number
}

// PUT is full-form for the three original settings; the due day is optional (omitted =
// keep the stored value) because two Settings cards write this endpoint.
export type AppSettingsUpdate = Omit<AppSettingsOut, 'calendar_update_due_day'> & {
  calendar_update_due_day?: number
}
```

- [ ] **Step 2: Client functions**

Append to `src/api/calendar.ts` (and add `CalendarOverrideBody, CalendarOverrideOut` to its type import):

```ts
// The user's edits on GENERATED events (2026-09-03 calendar spec §13) — keyed by the
// event's stable key, full replace. encodeURIComponent keeps the colons path-safe.
export function putCalendarOverride(key: string, body: CalendarOverrideBody): Promise<CalendarOverrideOut> {
  return api<CalendarOverrideOut>(`/calendar/overrides/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteCalendarOverride(key: string): Promise<void> {
  return api<void>(`/calendar/overrides/${encodeURIComponent(key)}`, { method: 'DELETE' })
}
```

- [ ] **Step 3: The fixture builder**

```ts
// src/testing/calendarFixtures.ts
import type { CalendarEvent, CalendarEventType, CalendarSource } from '../types/api'

// The ONE way tests build a calendar event (2026-09-03 calendar spec §6): every v2 field
// has a sensible default, so a fixture states only what it is about. Source, key and href
// follow the type the way the server derives them.
export const TYPE_SOURCE: Record<CalendarEventType, CalendarSource> = {
  rsu_vest: 'rsu',
  espp_purchase: 'espp',
  espp_qualify: 'espp',
  offering_start: 'espp',
  ex_dividend: 'dividend',
  payday: 'payroll',
  tax_deadline: 'tax',
  update_due: 'ritual',
  custom: 'custom',
  card_fee: 'card',
  card_credit: 'card',
  card_anniversary: 'card',
}

const DEFAULT_REF: Record<CalendarEventType, string> = {
  rsu_vest: 'vest',
  espp_purchase: 'purchase',
  espp_qualify: 'qualify',
  offering_start: 'offering',
  ex_dividend: 'NVDA',
  payday: 'payday',
  tax_deadline: 'q3',
  update_due: '2026-08',
  custom: '1',
  card_fee: '1-fee',
  card_credit: 'credit-1',
  card_anniversary: '1',
}

const DEFAULT_HREF: Record<CalendarEventType, string | null> = {
  rsu_vest: '/comp',
  espp_purchase: '/espp',
  espp_qualify: '/espp',
  offering_start: '/espp',
  ex_dividend: '/portfolio',
  payday: '/paycheck',
  tax_deadline: '/taxes',
  update_due: '/update',
  custom: null,
  card_fee: '/credit-cards',
  card_credit: '/credit-cards',
  card_anniversary: '/credit-cards',
}

export function calendarEvent(
  over: Partial<CalendarEvent> & Pick<CalendarEvent, 'date' | 'type' | 'label'>,
): CalendarEvent {
  const source = over.source ?? TYPE_SOURCE[over.type]
  const id = over.id ?? null
  const entity_ref = over.entity_ref ?? (over.type === 'custom' && id !== null ? String(id) : DEFAULT_REF[over.type])
  return {
    source,
    entity_ref,
    key: `${source}:${entity_ref}:${over.date}`,
    short_label: over.label.slice(0, 24),
    detail: null,
    amount: null,
    direction: 'neutral',
    basis: 'scheduled',
    items: [],
    href: DEFAULT_HREF[over.type],
    id,
    person_id: null,
    recurrence: null,
    until: null,
    series_start: null,
    done: false,
    hidden: false,
    note: null,
    amount_overridden: false,
    ...over,
  }
}
```

- [ ] **Step 4: Keep the exhaustive maps compiling**

In `src/components/calendar/calendarView.ts` add to `EVENT_COLORS`:

```ts
  // The three card types share the card family's slot until Lane C colors by SOURCE.
  card_fee: 'var(--chart-7)',
  card_credit: 'var(--chart-7)',
  card_anniversary: 'var(--chart-7)',
```

to `EVENT_TYPE_LABELS`: `card_fee: 'Card annual fee', card_credit: 'Card credit resets', card_anniversary: 'Card anniversary',` and to `EVENT_TYPE_ORDER` (before `'custom'`): `'card_fee', 'card_credit', 'card_anniversary',`. Add `'/credit-cards': 'Credit cards'` to `HREF_LABELS`.

In `calendarView.test.ts`: the `toEqual` literal gains the three card entries; the second test becomes

```ts
  it('names every type in the legend order', () => {
    expect(EVENT_TYPE_ORDER).toHaveLength(12)
    for (const type of EVENT_TYPE_ORDER) {
      expect(EVENT_COLORS[type]).toBeDefined()
      expect(EVENT_TYPE_LABELS[type].length).toBeGreaterThan(0)
    }
  })
```

(the "every type its own slot" pin goes — twelve types cannot each own one of nine slots; Lane C replaces the map with `SOURCE_COLORS`, eight-for-eight). Replace every object-literal event in that file with `calendarEvent({...})` from `../../testing/calendarFixtures` (dropping the fields the builder defaults).

- [ ] **Step 5: Bodies and fixtures**

`src/pages/CalendarPage.tsx`: in `saveForm`'s `body` add `amount: null, direction: 'neutral', recurrence: 'none', until: null,` (Lane C wires the real fields); in the delete-Undo `createCustomEvent({...})` add `amount: event.amount, direction: event.direction, recurrence: event.recurrence ?? 'none', until: event.until,`.

`src/pages/CalendarPage.test.tsx`: `fixtureEvents()` and every inline event literal → `calendarEvent({...})` (import from `../testing/calendarFixtures`); the `next-month seed` literal in the snapshot suite gains nothing else (the builder fills it). Every `toHaveBeenCalledWith({ date, label, detail, person_id })` on `createCustomEvent`/`updateCustomEvent` becomes

```ts
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: todayIsoStr,
      label: 'Car wash',
      detail: null,
      person_id: null,
      amount: null,
      direction: 'neutral',
      recurrence: 'none',
      until: null,
    })
```

(same four trailing fields on the Edit and Undo assertions; `mockResolvedValue` payloads for `createCustomEvent`/`updateCustomEvent` gain `amount: null, direction: 'neutral', recurrence: 'none', until: null`). Where the test renders `{ events: payload }`, pass `{ events: payload, sources: [], quote_as_of: null }`.

`src/utils/ics.test.ts`: the `event()` helper's literal → `calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 2025 offer', detail: '25 sh — 2025 offer', ...over })`.

`src/components/overview/upNext.test.ts`: `ev(date)` → `calendarEvent({ date, type: 'payday', label: \`Event ${date}\` })`.

`src/pages/OverviewPage.test.tsx`: `upNextEvents()` builds with `calendarEvent`; every `fetchCalendar` mock payload gains `sources: [], quote_as_of: null`.

`src/components/overview/upNext.ts` needs no change (it reads `date` only).

- [ ] **Step 6: Type-check, lint, run**

Run: `npx tsc -b && npx eslint src/types/api.ts src/api/calendar.ts src/testing/calendarFixtures.ts src/components/calendar src/pages/CalendarPage.tsx src/pages/CalendarPage.test.tsx src/utils/ics.test.ts src/components/overview src/pages/OverviewPage.test.tsx && npx vitest run src/components/calendar src/pages/CalendarPage.test.tsx src/utils/ics.test.ts src/components/overview src/pages/OverviewPage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: clean; all green. `SettingsPage.test.tsx` still passes because the page never sends `calendar_update_due_day` and the type made it optional.

- [ ] **Step 7: Commit**

```bash
git add src/types/api.ts src/api/calendar.ts src/testing/calendarFixtures.ts src/components/calendar/calendarView.ts src/components/calendar/calendarView.test.ts src/pages/CalendarPage.tsx src/pages/CalendarPage.test.tsx src/utils/ics.test.ts src/components/overview/upNext.test.ts src/pages/OverviewPage.test.tsx
git commit -m "feat(types): calendar v2 wire shapes, override client, calendarEvent() fixture builder"
```

---

### Task 14: Whole-suite gate, then merge to main

- [ ] **Step 1: Backend** — from `<worktree>/backend`: `FINANCE_TEST_DB=finance_test_cal_a ../../../backend/.venv/Scripts/python.exe -m pytest -q && ../../../backend/.venv/Scripts/python.exe -m ruff check app tests && ../../../backend/.venv/Scripts/python.exe -m ruff format --check app tests`
Expected: everything green (the old `tests/test_calendar_events.py` still passes untouched against the old module). `alembic heads` → `d4f6b8c0e2a5`.

- [ ] **Step 2: Frontend** — `npx tsc -b && npx eslint . && npx vitest run`
Expected: clean, all green.

- [ ] **Step 3: Merge** — from the ROOT checkout: `git merge --no-ff calendar-a -m "Merge branch 'calendar-a' — calendar foundations"`. Lanes B, C and D branch from this commit.

---

## Self-review

**Spec coverage:** §4 approach C (compute on read + `calendar_event_overrides`) → Tasks 1, 2, 8, 11; §5 module map (`model`, `fold`, `generators/`, `recurrence`, `overrides`, `__init__.compose`) → Tasks 4–9 (`ics.py` is Lane B, `cards.py` Lane D); §6 wire shape + key grammar (+ the additive fields named in the header) → Tasks 4, 10, 13; §6 table — rsu priced with after-sell-to-cover detail, payroll folded with net pay, espp dates, dividend shares×per_share seam (`ExDividend`), tax dates with `TaxFacts` seam, ritual per month / suppressed / re-dated / month-keyed, custom money + recurrence with clamps → Tasks 6, 7; §7 fold rule (sum or null, items sorted by label, "RSU vest · 4 grants", "Payday · 2", other families never fold) → Task 7; §12 due-day setting (1–28, default 1) → Task 10; §13 overrides PUT full-replace / DELETE 404 / key regex ≤ 120 / export + importer-immune → Tasks 11, 12; §16 migrations (all four, chained, rehearsed) and export tuples → Tasks 1, 3, 11; §17 pytest list for folding, generators, overlay, key stability, due-day bounds, importer pins → Tasks 6–12; §20 label-pinned tests updated so lanes inherit green → Tasks 11, 13. Left for lanes by design: ICS/feed/tokens (B), page/chips/drawer/strip/Up next (C), cards/tax amounts/ESPP contribution/dividend per-share/health refinements/reset-cadence API+UI (D).

**Placeholders:** none — every step carries its code and its command.

**Type consistency:** `make_event(event_date, type, entity_ref, label, short_label, *, detail, amount, direction, basis, href, items, event_id, person_id, key_date, recurrence, until, series_start)` is used identically in Tasks 6–9 and 11; `PaydaySource(name, semi_monthly, net_pay, person_id)`, `ExDividend(ticker, ex_date, shares, per_share)`, `CustomRow(event_id, event_date, label, detail, person_id, person_name, amount, direction, recurrence, until)`, `TaxFacts(year, effective_threshold, total_projected, effective_leg, prior_year_balance)`, `Override(key, done, hidden, note, amount)`, `Sources(...)` with the pre-declared `tax_facts` and `cards` slots, `compose(window, today=, sources=, overrides=)`, `_compose_for(db, start, end, today) -> (events, health, quoted_at)`, `SourceHealthOut(source, status, note)`, and the TS `CalendarEvent` / `calendarEvent()` builder match across every task and are the names Lanes B–D import.
