# Calendar B — ICS builder, authenticated download, token feed, Settings card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One server-side RFC 5545 builder serving both the "Add to calendar (.ics)" download and a subscription feed calendar apps can hold without churn (`docs/superpowers/specs/2026-09-03-calendar-design.md` §11): stable UIDs from the event key, `X-WR-CALNAME`, `VALARM` on deadline types, `RRULE` for recurring custom events, 75-octet folding on character boundaries, `ETag`/304, `60/hour` per IP, tokens hashed at rest with the plaintext shown once, and a Settings **Calendar feed** card (feed URL + Copy, token list with Revoke, the ritual due-day field, one warning sentence).

**Architecture:** `services/calendar/ics.py` renders `list[Event]` to text — pure, deterministic (DTSTAMP = the event date at `T000000Z`), so identical inputs give identical bytes and the feed's `ETag` is the body's sha256. `api/calendar.py` gains a bounded region 5 after Plan A's region 4: `GET /calendar/export.ics` (bearer, the 400-day fence) on the existing authenticated `router`; `GET /calendar/feed.ics?token=` on a SECOND router without the auth dependency (the token is the credential); token CRUD on the authenticated router. `main.py` includes the feed router. The frontend gets `src/api/calendarFeed.ts` (tokens + a raw-fetch download that saves through `download.ts`) and `CalendarFeedCard.tsx`. `src/utils/ics.ts` is NOT deleted tonight (retire list); Plan E swaps the Calendar page's action onto `downloadCalendarIcs`.

**Tech Stack:** FastAPI (a second `APIRouter`), slowapi (`limiter.limit`), hashlib/secrets, pytest; React 19 + vitest for the card.

**Worktree / commands:** Branch `calendar-b` from main AFTER Plan A merged; worktree `.worktrees/calendar-b` with a `node_modules` junction. Backend from `<worktree>/backend`: `FINANCE_TEST_DB=finance_test_cal_b ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`. Frontend from the worktree root: `npx vitest run <file>`.

**Shared-file hotspots (this lane's ONLY touches on them):** `backend/app/api/calendar.py` — append region 5 at the END of the file (Lane D edits region 1 mid-file; disjoint hunks merge cleanly); `backend/app/main.py` — one `include_router` line; `src/pages/SettingsPage.tsx` — one import + one JSX line after `<LimitsCard />`; `src/components/paletteRegistry.ts` — one entry in `SETTINGS_SECTIONS`; `src/types/api.ts` — append the two token types after the calendar block (Lane D appends elsewhere).

**Contracts inherited from Plan A:** `Event` (`event_date, type, source, entity_ref, key, label, short_label, detail, amount, direction, basis, href, items, event_id, person_id, recurrence, until, series_start, done, hidden, note, amount_overridden`), `Item`, `DEADLINE_TYPES`, `key()` from `services/calendar/model.py`; `_compose_for(db, start, end, today) -> (events, health, quoted_at)` and `_validated_span(start, end)` in `api/calendar.py`; `CalendarFeedToken` model (`user_id, token_hash, label, created_at, last_used_at`); `AppSettingsOut.calendar_update_due_day` + optional `AppSettingsUpdate.calendar_update_due_day`; `get_current_user` returns a `User`.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/calendar/ics.py` (new) | `escape_text`, `fold_line`, `amount_text`, `render` |
| `backend/tests/calendar/test_ics.py` (new) | validity, UID stability, alarms, RRULE, STATUS, escaping, the folding check |
| `backend/app/config.py` (modify) | `public_url: str \| None` |
| `backend/app/rate_limit.py` (modify) | `FEED_POLL = "60/hour"` |
| `backend/app/schemas/calendar.py` (append) | `FeedTokenIn`, `FeedTokenOut`, `FeedTokenCreated` |
| `backend/app/api/calendar.py` (append region 5) | `export.ics`, `feed_router` + `feed.ics`, token CRUD |
| `backend/app/main.py` (modify) | include `calendar.feed_router` |
| `backend/tests/calendar/test_feed_api.py` (new) | export auth/span/headers; feed 404/200/ETag/304/last-used/429; tokens once/hash/revoke |
| `src/types/api.ts` (append) | `FeedTokenOut`, `FeedTokenCreated` |
| `src/api/calendarFeed.ts` (+ test) (new) | `fetchFeedTokens`, `createFeedToken`, `revokeFeedToken`, `downloadCalendarIcs` |
| `src/components/settings/CalendarFeedCard.tsx` (+ test) (new) | the card |
| `src/components/settings/settings.css` (append) | `.feed-url` row |
| `src/pages/SettingsPage.tsx` (+ test) (modify) | mount the card; mock its API in the page test |
| `src/components/paletteRegistry.ts` (+ test) (modify) | the `calendar` Settings section |

---

### Task 1: `ics.py` — escaping and folding

**Files:**
- Create: `backend/app/services/calendar/ics.py`
- Test: `backend/tests/calendar/test_ics.py` (first half)

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/calendar/test_ics.py
"""The ICS builder (2026-09-03 calendar spec §11, §17): RFC 5545 validity, UID stability,
alarms only where they belong, RRULE for series, STATUS by basis, escaping, and the
75-octet folding check on UTF-8 character boundaries."""

from datetime import date
from decimal import Decimal

from app.services.calendar.generators.custom import CustomRow, custom_events
from app.services.calendar.ics import amount_text, escape_text, fold_line, render
from app.services.calendar.model import Item, Window, make_event


def unfold(text: str) -> str:
    return text.replace("\r\n ", "")


def physical_lines(text: str) -> list[str]:
    assert text.endswith("\r\n")
    return text[:-2].split("\r\n")


def q3(**over):
    fields = dict(
        detail="Q3 estimated payment", amount=Decimal("1200"), direction="out", basis="estimated", href="/taxes"
    )
    fields.update(over)
    return make_event(date(2026, 9, 15), "tax_deadline", "2026-q3", "Tax deadline — Q3 estimated payment", "Q3 est. tax", **fields)


def payday():
    return make_event(
        date(2026, 9, 15), "payday", "payday", "Payday — Me & Sam", "Payday · 2", detail="2 paychecks",
        amount=Decimal("6812.44"), direction="in", basis="scheduled", href="/paycheck",
        items=(Item("Me", Decimal("4000.00"), 1, None), Item("Sam", Decimal("2812.44"), 2, None)),
    )


def test_escape_text_is_rfc_5545_backslash_first():
    assert escape_text("a,b;c\nd\\e") == "a\\,b\\;c\\nd\\\\e"
    assert escape_text("crlf\r\nline") == "crlf\\nline"
    assert escape_text("lone\rcr") == "lone\\ncr"


def test_fold_line_leaves_short_lines_and_folds_on_character_boundaries():
    assert fold_line("SUMMARY:short") == "SUMMARY:short"
    folded = fold_line("DESCRIPTION:" + "é" * 60)  # 12 + 120 octets
    parts = folded.split("\r\n")
    assert len(parts) == 2 and parts[1].startswith(" ")
    for part in parts:
        assert len(part.encode("utf-8")) <= 75
        part.encode("utf-8").decode("utf-8")  # no split code point anywhere
    assert unfold(folded) == "DESCRIPTION:" + "é" * 60


def test_fold_line_first_line_is_exactly_75_octets_when_ascii():
    parts = fold_line("X:" + "a" * 200).split("\r\n")
    assert [len(p.encode()) for p in parts] == [75, 75, 54]  # 202 octets: 75 + (1+74) + (1+53)


def test_amount_text_signs_by_direction_and_tildes_estimates():
    assert amount_text(payday()) == "+$6,812.44"
    assert amount_text(q3()) == "~-$1,200.00"
    assert amount_text(q3(basis="confirmed", direction="neutral", amount=Decimal("300"))) == "$300.00"
    assert amount_text(q3(amount=None)) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_cal_b ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_ics.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module (rendering included — Task 2 tests it)**

```python
# backend/app/services/calendar/ics.py
"""One RFC 5545 builder for the download and the feed (2026-09-03 calendar spec §11).

Pure and DETERMINISTIC: no clock — DTSTAMP is the event date at T000000Z — so identical
inputs render identical bytes, which is what lets the feed's ETag turn most polls into a
304. UIDs are the event KEY (a function of source facts, never of a label), so a rename
updates a subscribed calendar instead of duplicating it. Lines over 75 octets fold with
CRLF + one space on UTF-8 CHARACTER boundaries (§3.1)."""

from decimal import Decimal

from .model import DEADLINE_TYPES, Event, key

PRODID = "-//finance-dashboard//calendar//EN"
CALNAME = "Finance dashboard"
REFRESH_INTERVAL = "PT12H"
UID_DOMAIN = "finance-dashboard"
# 09:00 three days before an all-day start: -(2 days + 15 hours) from midnight.
ALARM_TRIGGER = "-P2DT15H"
MAX_OCTETS = 75
FREQ = {"weekly": "WEEKLY", "monthly": "MONTHLY", "yearly": "YEARLY"}
SIGN = {"in": "+", "out": "-", "neutral": ""}


def escape_text(value: str) -> str:
    """RFC 5545 §3.3.11 TEXT escaping: backslash FIRST, then semicolon, comma, newlines
    (CRLF, lone CR and LF all become the literal `\\n`). Byte-identical to the retired
    frontend builder's escapeIcsText."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def fold_line(line: str) -> str:
    """Content lines longer than 75 octets fold into 75-octet physical lines; every
    continuation starts with one space (which counts toward its 75). Splits land between
    code points, never inside one."""
    if len(line.encode("utf-8")) <= MAX_OCTETS:
        return line
    parts: list[str] = []
    current: list[str] = []
    used = 0
    budget = MAX_OCTETS
    for char in line:
        size = len(char.encode("utf-8"))
        if used + size > budget:
            parts.append("".join(current))
            current, used, budget = [char], size, MAX_OCTETS - 1
        else:
            current.append(char)
            used += size
    parts.append("".join(current))
    return "\r\n ".join(parts)


def amount_text(event: Event) -> str | None:
    """"+$6,812.44", "-$395.00", "~+$41,200.00" — the sign is the direction, the tilde the
    estimate. ASCII hyphen-minus on purpose: calendar apps render it everywhere."""
    if event.amount is None:
        return None
    tilde = "~" if event.basis == "estimated" else ""
    return f"{tilde}{SIGN[event.direction]}${event.amount:,.2f}"


def _money(value: Decimal | None) -> str:
    return "—" if value is None else f"${value:,.2f}"


def _description(event: Event, public_url: str | None) -> str:
    amount = amount_text(event)
    lines = [
        f"Amount: {amount} ({event.direction}, {event.basis})" if amount else "Amount unknown"
    ]
    if event.done:
        lines.append("Done")
    lines.extend(
        f"- {item.label}: {_money(item.amount)}" + (f" ({item.detail})" if item.detail else "")
        for item in event.items
    )
    if event.detail:
        lines.append(event.detail)
    if event.note:
        lines.append(f"Note: {event.note}")
    if event.href:
        lines.append(f"{public_url.rstrip('/')}{event.href}" if public_url else event.href)
    return "\n".join(lines)


def _vevent(event: Event, *, series: bool, public_url: str | None) -> list[str]:
    # A recurring custom row renders ONCE, anchored on the series start, with an RRULE —
    # its UID is the key of that FIRST occurrence, so extending `until` updates the same
    # calendar entry rather than adding one.
    start = event.series_start if series and event.series_start is not None else event.event_date
    uid = key(event.source, event.entity_ref, start) if series else event.key
    amount = amount_text(event)
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}@{UID_DOMAIN}",
        f"DTSTAMP:{start:%Y%m%d}T000000Z",
        f"DTSTART;VALUE=DATE:{start:%Y%m%d}",
    ]
    if series and event.recurrence in FREQ:
        rrule = f"RRULE:FREQ={FREQ[event.recurrence]}"
        if event.until is not None:
            rrule += f";UNTIL={event.until:%Y%m%d}"
        lines.append(rrule)
    lines += [
        f"SUMMARY:{escape_text(event.label + (f' · {amount}' if amount else ''))}",
        f"DESCRIPTION:{escape_text(_description(event, public_url))}",
        f"CATEGORIES:{event.type}",
        f"STATUS:{'TENTATIVE' if event.basis == 'estimated' else 'CONFIRMED'}",
    ]
    if event.type in DEADLINE_TYPES and not event.done:
        lines += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{escape_text(event.label)}",
            f"TRIGGER:{ALARM_TRIGGER}",
            "END:VALARM",
        ]
    lines.append("END:VEVENT")
    return lines


def render(events: list[Event], *, public_url: str | None = None, calname: str = CALNAME) -> str:
    """The whole VCALENDAR as CRLF text. Hidden events are omitted entirely; a recurring
    custom series is one VEVENT; everything else is one VEVENT per event."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(calname)}",
        f"REFRESH-INTERVAL;VALUE=DURATION:{REFRESH_INTERVAL}",
        f"X-PUBLISHED-TTL:{REFRESH_INTERVAL}",
    ]
    rendered_series: set[int] = set()
    for event in events:
        if event.hidden:
            continue
        if event.recurrence is not None and event.event_id is not None:
            if event.event_id in rendered_series:
                continue
            rendered_series.add(event.event_id)
            lines += _vevent(event, series=True, public_url=public_url)
        else:
            lines += _vevent(event, series=False, public_url=public_url)
    lines.append("END:VCALENDAR")
    return "".join(f"{fold_line(line)}\r\n" for line in lines)
```

- [ ] **Step 4: Run the first four tests**

Run: `FINANCE_TEST_DB=finance_test_cal_b ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_ics.py -q`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/ics.py backend/tests/calendar/test_ics.py
git commit -m "feat(calendar): server-side ICS builder — escaping, 75-octet folding, signed amounts"
```

---

### Task 2: `render()` — validity, UIDs, alarms, RRULE, STATUS, hidden

**Files:**
- Test: `backend/tests/calendar/test_ics.py` (append)

- [ ] **Step 1: Append the render tests**

```python
def test_render_is_a_valid_publish_calendar_with_crlf_and_the_required_properties():
    text = render([payday(), q3()], public_url="https://finance.example.com")
    lines = physical_lines(text)
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-1] == "END:VCALENDAR"
    for required in (
        "VERSION:2.0", "PRODID:-//finance-dashboard//calendar//EN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Finance dashboard", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
    ):
        assert required in lines
    assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 2
    assert lines.count("BEGIN:VALARM") == lines.count("END:VALARM") == 1
    assert "\n" not in text.replace("\r\n", "")  # every newline is CRLF
    unfolded = unfold(text).split("\r\n")
    assert "UID:payroll:payday:2026-09-15@finance-dashboard" in unfolded
    assert "DTSTAMP:20260915T000000Z" in unfolded
    assert "DTSTART;VALUE=DATE:20260915" in unfolded
    assert "SUMMARY:Payday — Me & Sam · +$6\\,812.44" in unfolded
    assert "SUMMARY:Tax deadline — Q3 estimated payment · ~-$1\\,200.00" in unfolded
    assert (
        "DESCRIPTION:Amount: +$6\\,812.44 (in\\, scheduled)\\n- Me: $4\\,000.00\\n- Sam: $2\\,812.44"
        "\\n2 paychecks\\nhttps://finance.example.com/paycheck"
    ) in unfolded
    assert "CATEGORIES:payday" in unfolded and "CATEGORIES:tax_deadline" in unfolded


def test_uid_is_stable_across_renders_and_a_label_change():
    first = render([q3()])
    assert render([q3()]) == first  # byte-identical
    renamed = render([q3(label="Tax deadline — Q3 (renamed)", detail="renamed")])
    uid = next(line for line in unfold(first).split("\r\n") if line.startswith("UID:"))
    assert uid == "UID:tax:2026-q3:2026-09-15@finance-dashboard"
    assert uid in unfold(renamed).split("\r\n")


def test_status_follows_basis_and_alarms_only_deadline_types_never_done():
    from dataclasses import replace

    lines = unfold(render([payday(), q3(), replace(q3(), done=True)])).split("\r\n")
    assert lines.count("STATUS:CONFIRMED") == 1  # the scheduled payday
    assert lines.count("STATUS:TENTATIVE") == 2  # both estimated deadlines
    assert lines.count("BEGIN:VALARM") == 1  # the open deadline only
    assert "TRIGGER:-P2DT15H" in lines and "ACTION:DISPLAY" in lines
    assert "DESCRIPTION:Amount: ~-$1\\,200.00 (out\\, estimated)\\nDone\\nQ3 estimated payment\\n/taxes" in lines


def test_hidden_events_are_omitted_entirely():
    from dataclasses import replace

    text = render([replace(payday(), hidden=True), q3()])
    assert "payroll:payday" not in text and text.count("BEGIN:VEVENT") == 1


def test_a_recurring_custom_series_is_one_vevent_with_an_rrule():
    rows = [CustomRow(8, date(2026, 8, 5), "Piano lesson", None, recurrence="weekly", until=date(2026, 8, 19))]
    events = custom_events(rows, Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert len(events) == 3
    lines = unfold(render(events)).split("\r\n")
    assert lines.count("BEGIN:VEVENT") == 1
    assert "UID:custom:8:2026-08-05@finance-dashboard" in lines
    assert "DTSTART;VALUE=DATE:20260805" in lines
    assert "RRULE:FREQ=WEEKLY;UNTIL=20260819" in lines
    open_series = custom_events([CustomRow(9, date(2026, 1, 31), "Rent", None, amount=Decimal("2400"), direction="out", recurrence="monthly")], Window(date(2026, 1, 1), date(2026, 3, 31)))
    assert "RRULE:FREQ=MONTHLY" in unfold(render(open_series)).split("\r\n")


def test_summary_and_description_are_escaped():
    text = unfold(render([q3(label="Vest; big, day", detail="line one\nline two")]))
    assert "SUMMARY:Vest\\; big\\, day · ~-$1\\,200.00" in text
    assert "\\nline one\\nline two\\n" in text


def test_the_rfc_5545_folding_check_over_a_whole_calendar():
    long_note = "Ünïcödé " * 30  # multibyte text long enough to fold several times
    from dataclasses import replace

    text = render([replace(payday(), note=long_note), q3()])
    for line in physical_lines(text):
        assert len(line.encode("utf-8")) <= 75, line
        line.encode("utf-8").decode("utf-8")
    continuation = [line for line in physical_lines(text) if line.startswith(" ")]
    assert continuation, "a note that long must fold"
    assert all(len(line) > 1 for line in continuation)
    assert escape_text(long_note) in unfold(text)
```

- [ ] **Step 2: Run**

Run: `FINANCE_TEST_DB=finance_test_cal_b ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_ics.py -q`
Expected: 11 passed. If the description assertion fails on the `—` or `·` characters, check the escape order: only `\ ; , CR LF` are escaped — em dashes and middle dots pass through as UTF-8.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/calendar/test_ics.py
git commit -m "test(calendar): ICS validity, UID stability, alarms, RRULE, STATUS, hidden, folding check"
```

---

### Task 3: Config, rate limit, token schemas

**Files:**
- Modify: `backend/app/config.py`, `backend/app/rate_limit.py`, `backend/app/schemas/calendar.py`

- [ ] **Step 1: Edits**

`backend/app/config.py` — add to `Settings` after `nvidia_ca_bundle`:

```python
    # ── Calendar feed (2026-09-03 calendar spec §11) ───────────────────────────
    # The site's public origin, e.g. https://finance.example.com — prefixes the page links
    # inside ICS descriptions so a phone can open them. Unset → bare paths.
    public_url: str | None = None
```

`backend/app/rate_limit.py` — append:

```python
# The ICS feed is unauthenticated (the token is the credential): a per-IP ceiling well above
# any calendar app's poll cadence (12 h) and well below a token-guessing rate.
FEED_POLL = "60/hour"
```

`backend/app/schemas/calendar.py` — append:

```python
class FeedTokenIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("label must not be blank")
        return stripped


class FeedTokenOut(BaseModel):
    id: int
    label: str
    created_at: datetime
    last_used_at: datetime | None


class FeedTokenCreated(FeedTokenOut):
    """POST's answer: the plaintext rides ONCE (spec §11) and no GET ever returns it."""

    token: str
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/config.py backend/app/rate_limit.py backend/app/schemas/calendar.py
git commit -m "feat(api): public_url setting, FEED_POLL limit, feed-token wire shapes"
```

---

### Task 4: Routes — `export.ics`, `feed.ics`, token CRUD

**Files:**
- Modify: `backend/app/api/calendar.py` (append region 5), `backend/app/main.py`
- Test: `backend/tests/calendar/test_feed_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/calendar/test_feed_api.py
"""The two ICS routes and the token CRUD (2026-09-03 calendar spec §11, §17): the download
behind the bearer, the feed behind its token, ETag/304, the last-used throttle, the per-IP
ceiling, plaintext-once tokens."""

import hashlib
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from app.models import CalendarFeedToken

CALENDAR = "/api/v1/calendar"
TODAY = date(2026, 8, 24)


def freeze_today(monkeypatch):
    monkeypatch.setattr("app.api.calendar.product_today", lambda: TODAY)


async def make_token(auth_client, label="phone") -> tuple[int, str]:
    created = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": label})
    assert created.status_code == 201, created.text
    return created.json()["id"], created.json()["token"]


# --- export --------------------------------------------------------------------------------


async def test_export_requires_auth_and_validates_the_span(client, auth_client):
    assert (await client.get(f"{CALENDAR}/export.ics?start=2026-08-01&end=2026-08-31")).status_code == 401
    assert (await auth_client.get(f"{CALENDAR}/export.ics?start=2026-08-31&end=2026-08-01")).status_code == 422
    assert (await auth_client.get(f"{CALENDAR}/export.ics?start=2026-01-01&end=2027-02-06")).status_code == 422


async def test_export_returns_the_rendered_window_as_an_attachment(auth_client, monkeypatch):
    freeze_today(monkeypatch)
    await auth_client.post(f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance", "amount": "180", "direction": "out"})
    resp = await auth_client.get(f"{CALENDAR}/export.ics?start=2026-09-01&end=2026-09-30")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/calendar; charset=utf-8"
    assert resp.headers["content-disposition"] == 'attachment; filename="financial-calendar.ics"'
    text = resp.text
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert "SUMMARY:Car insurance · -$180.00" in text
    assert "UID:tax:2026-q3:2026-09-15@finance-dashboard" in text


# --- tokens --------------------------------------------------------------------------------


async def test_token_plaintext_is_returned_once_and_only_the_hash_is_stored(auth_client, db):
    token_id, plaintext = await make_token(auth_client, "  phone ")
    assert len(plaintext) >= 32
    row = await db.get(CalendarFeedToken, token_id)
    assert row.token_hash == hashlib.sha256(plaintext.encode()).hexdigest()
    assert row.label == "phone" and row.last_used_at is None and row.created_at is not None
    listed = (await auth_client.get(f"{CALENDAR}/feed-tokens")).json()
    assert listed == [{"id": token_id, "label": "phone", "created_at": listed[0]["created_at"], "last_used_at": None}]
    assert "token" not in listed[0]


async def test_token_validation_and_revoke(auth_client, client):
    assert (await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": "   "})).status_code == 422
    assert (await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": "x" * 61})).status_code == 422
    token_id, _ = await make_token(auth_client)
    assert (await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")).status_code == 204
    assert (await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")).status_code == 404
    assert (await client.get(f"{CALENDAR}/feed-tokens")).status_code == 401
    assert (await client.post(f"{CALENDAR}/feed-tokens", json={"label": "x"})).status_code == 401


# --- feed ----------------------------------------------------------------------------------


async def test_feed_404s_for_missing_unknown_and_revoked_tokens(client, auth_client):
    assert (await client.get(f"{CALENDAR}/feed.ics")).status_code == 422  # token is required
    unknown = await client.get(f"{CALENDAR}/feed.ics?token={'z' * 43}")
    assert unknown.status_code == 404 and unknown.json()["detail"] == "feed not found"
    token_id, plaintext = await make_token(auth_client)
    await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")
    assert (await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")).status_code == 404


async def test_feed_serves_the_calendar_with_etag_and_answers_304(client, auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    await auth_client.post(f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance"})
    token_id, plaintext = await make_token(auth_client)
    # No bearer on the feed: a calendar app has none.
    del client.headers["Authorization"]
    first = await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    assert first.status_code == 200, first.text
    assert first.headers["content-type"] == "text/calendar; charset=utf-8"
    assert first.headers["cache-control"] == "private, max-age=3600"
    etag = first.headers["etag"]
    assert etag == f'"{hashlib.sha256(first.content).hexdigest()}"'
    assert "SUMMARY:Car insurance" in first.text
    # Window: 30 days back, 365 forward — Q3 2026 and Q2 2027 are inside; Q4 2025 is not.
    assert "UID:tax:2026-q3:2026-09-15@" in first.text and "UID:tax:2027-q2:2027-06-15@" in first.text
    assert "UID:tax:2025-q4:2026-01-15@" not in first.text
    unchanged = await client.get(f"{CALENDAR}/feed.ics?token={plaintext}", headers={"If-None-Match": etag})
    assert unchanged.status_code == 304 and unchanged.content == b""
    assert unchanged.headers["etag"] == etag
    stale = await client.get(f"{CALENDAR}/feed.ics?token={plaintext}", headers={"If-None-Match": '"nope"'})
    assert stale.status_code == 200
    row = await db.get(CalendarFeedToken, token_id)
    assert row.last_used_at is not None


async def test_feed_bumps_last_used_at_most_hourly(client, auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    token_id, plaintext = await make_token(auth_client)
    del client.headers["Authorization"]
    row = await db.get(CalendarFeedToken, token_id)
    recent = datetime.now(UTC) - timedelta(minutes=10)
    row.last_used_at = recent
    await db.commit()
    await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    await db.refresh(row)
    assert row.last_used_at == recent  # inside the hour: untouched
    row.last_used_at = datetime.now(UTC) - timedelta(hours=2)
    await db.commit()
    await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    await db.refresh(row)
    assert row.last_used_at > recent


async def test_feed_is_rate_limited_per_ip(client):
    for _ in range(60):
        assert (await client.get(f"{CALENDAR}/feed.ics?token={'z' * 43}")).status_code == 404
    assert (await client.get(f"{CALENDAR}/feed.ics?token={'z' * 43}")).status_code == 429
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_cal_b ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_feed_api.py -q`
Expected: FAIL — 404s (routes missing).

- [ ] **Step 3: Append region 5 to `backend/app/api/calendar.py`**

Add these imports at the top of the file (merge into the existing import blocks, alphabetically): `import hashlib`, `import secrets`; `from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response`; `from app.config import settings`; `from app.models import CalendarFeedToken, User` (alongside the existing model names); `from app.rate_limit import FEED_POLL, limiter`; `from app.schemas.calendar import FeedTokenCreated, FeedTokenIn, FeedTokenOut` (alongside the others); `from app.services.calendar.ics import render`. Ensure `from datetime import UTC, date, datetime, timedelta` (Plan A left `timedelta` there for this).

Then append at the very end of the file:

```python
# --- 5. ICS: the download, the token feed, the tokens (spec §11) — Lane B --------------

ICS_MEDIA_TYPE = "text/calendar"  # Starlette appends "; charset=utf-8" to text/* itself
ICS_FILENAME = "financial-calendar.ics"
FEED_BACK_DAYS = 30
FEED_FORWARD_DAYS = 365
LAST_USED_BUMP = timedelta(hours=1)

# The feed router carries NO auth dependency: the token in the URL is the credential, and a
# calendar app holds nothing else. Included separately by main.py.
feed_router = APIRouter(prefix="/calendar", tags=["calendar"])


def _hash_token(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()


def _ics_response(text: str, extra_headers: dict[str, str]) -> Response:
    return Response(content=text.encode("utf-8"), media_type=ICS_MEDIA_TYPE, headers=extra_headers)


@router.get("/export.ics")
async def export_ics(start: date, end: date, db: AsyncSession = Depends(get_db)) -> Response:
    """The "Add to calendar (.ics)" download: the same window fence as GET /calendar, the
    same composer, rendered once."""
    _validated_span(start, end)
    events, _health, _quoted_at = await _compose_for(db, start, end, product_today())
    return _ics_response(
        render(events, public_url=settings.public_url),
        {"Content-Disposition": f'attachment; filename="{ICS_FILENAME}"'},
    )


@feed_router.get("/feed.ics")
@limiter.limit(FEED_POLL)
async def feed_ics(
    request: Request,
    token: str = Query(min_length=16, max_length=128),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The subscription feed: 30 days back, 365 forward. Unknown or revoked tokens 404 with
    one sentence — no oracle for token existence. The body's sha256 is the ETag; a matching
    If-None-Match is a 304 with no body, which is what makes a 12-hour poll cheap."""
    row = (
        await db.execute(select(CalendarFeedToken).where(CalendarFeedToken.token_hash == _hash_token(token)))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="feed not found")
    now = datetime.now(tz=UTC)
    if row.last_used_at is None or now - row.last_used_at >= LAST_USED_BUMP:
        row.last_used_at = now
        await db.commit()
    today = product_today()
    events, _health, _quoted_at = await _compose_for(
        db, today - timedelta(days=FEED_BACK_DAYS), today + timedelta(days=FEED_FORWARD_DAYS), today
    )
    body = render(events, public_url=settings.public_url).encode("utf-8")
    etag = f'"{hashlib.sha256(body).hexdigest()}"'
    headers = {"ETag": etag, "Cache-Control": "private, max-age=3600"}
    presented = {
        candidate.strip().removeprefix("W/")
        for candidate in request.headers.get("if-none-match", "").split(",")
    }
    if etag in presented:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type=ICS_MEDIA_TYPE, headers=headers)


def _token_out(row: CalendarFeedToken) -> FeedTokenOut:
    return FeedTokenOut(id=row.id, label=row.label, created_at=row.created_at, last_used_at=row.last_used_at)


@router.get("/feed-tokens", response_model=list[FeedTokenOut])
async def list_feed_tokens(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[FeedTokenOut]:
    rows = (
        await db.execute(
            select(CalendarFeedToken)
            .where(CalendarFeedToken.user_id == user.id)
            .order_by(CalendarFeedToken.created_at, CalendarFeedToken.id)
        )
    ).scalars()
    return [_token_out(row) for row in rows]


@router.post("/feed-tokens", response_model=FeedTokenCreated, status_code=201)
async def create_feed_token(
    body: FeedTokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> FeedTokenCreated:
    """Mint, store the hash, hand back the plaintext ONCE."""
    plaintext = secrets.token_urlsafe(32)
    row = CalendarFeedToken(user_id=user.id, token_hash=_hash_token(plaintext), label=body.label)
    db.add(row)
    await db.commit()
    await db.refresh(row)  # created_at is a server default
    return FeedTokenCreated(
        id=row.id, label=row.label, created_at=row.created_at, last_used_at=None, token=plaintext
    )


@router.delete("/feed-tokens/{token_id}", status_code=204)
async def revoke_feed_token(
    token_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    row = await db.get(CalendarFeedToken, token_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="feed token not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)
```

In `backend/app/main.py`, directly after `app.include_router(calendar.router, prefix="/api/v1")`, add:

```python
app.include_router(calendar.feed_router, prefix="/api/v1")  # unauthenticated: the token is the credential
```

- [ ] **Step 4: Run**

Run: `FINANCE_TEST_DB=finance_test_cal_b ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_feed_api.py tests/test_calendar_api.py tests/calendar -q`
Expected: all passed. If `test_feed_is_rate_limited_per_ip` sees 404 on the 61st call, the decorator order is wrong — `@limiter.limit` must sit UNDER `@feed_router.get` (as auth.py's `login` does). If the 304 test fails on `content-type`, the `Response(status_code=304)` must not carry a media type (it does not above).

- [ ] **Step 5: Ruff, commit**

Run: `../../../backend/.venv/Scripts/python.exe -m ruff check app tests && ../../../backend/.venv/Scripts/python.exe -m ruff format --check app tests`

```bash
git add backend/app/api/calendar.py backend/app/main.py backend/tests/calendar/test_feed_api.py
git commit -m "feat(api): GET /calendar/export.ics, token feed with ETag/304 and 60/hour, feed-token CRUD"
```

---

### Task 5: Frontend API surface — `calendarFeed.ts`

**Files:**
- Modify: `src/types/api.ts` (append after `CalendarOverrideOut`)
- Create: `src/api/calendarFeed.ts`, `src/api/calendarFeed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/api/calendarFeed.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setToken } from './client'
import { createFeedToken, downloadCalendarIcs, fetchFeedTokens, revokeFeedToken } from './calendarFeed'

vi.mock('../utils/download', () => ({ downloadText: vi.fn() }))
import { downloadText } from '../utils/download'

function ok(body: unknown, init: ResponseInit = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/calendar' : 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('calendarFeed api', () => {
  it('lists, creates and revokes tokens on /calendar/feed-tokens', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    await fetchFeedTokens()
    expect(spy.mock.calls[0][0]).toBe('/api/v1/calendar/feed-tokens')
    spy.mockResolvedValue(ok({ id: 1, label: 'phone', created_at: 'x', last_used_at: null, token: 't' }))
    await createFeedToken('phone')
    expect(spy.mock.calls[1][0]).toBe('/api/v1/calendar/feed-tokens')
    expect((spy.mock.calls[1][1] as RequestInit).method).toBe('POST')
    expect((spy.mock.calls[1][1] as RequestInit).body).toBe(JSON.stringify({ label: 'phone' }))
    spy.mockResolvedValue(new Response(null, { status: 204 }))
    await revokeFeedToken(1)
    expect(spy.mock.calls[2][0]).toBe('/api/v1/calendar/feed-tokens/1')
    expect((spy.mock.calls[2][1] as RequestInit).method).toBe('DELETE')
  })

  it('downloads export.ics with the bearer and saves the text as text/calendar', async () => {
    setToken('jwt-123')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'))
    await downloadCalendarIcs('2026-08-01', '2026-10-31')
    expect(spy.mock.calls[0][0]).toBe('/api/v1/calendar/export.ics?start=2026-08-01&end=2026-10-31')
    expect((spy.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer jwt-123' })
    expect(downloadText).toHaveBeenCalledWith('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'financial-calendar.ics', 'text/calendar;charset=utf-8')
  })

  it('throws an ApiError when the export fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"start must be on or before end"}', { status: 422 }))
    await expect(downloadCalendarIcs('2026-10-31', '2026-08-01')).rejects.toMatchObject({ status: 422, message: 'start must be on or before end' })
    expect(downloadText).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/api/calendarFeed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Types and module**

Append to `src/types/api.ts` after `CalendarOverrideOut`:

```ts
/** One subscription credential (GET/POST /calendar/feed-tokens). The plaintext token rides
 *  ONLY on the POST answer (`FeedTokenCreated`) — never on a list. */
export interface FeedTokenOut {
  id: number
  label: string
  created_at: string
  last_used_at: string | null
}

export interface FeedTokenCreated extends FeedTokenOut {
  token: string
}
```

```ts
// src/api/calendarFeed.ts
import { ApiError, api, getToken } from './client'
import type { FeedTokenCreated, FeedTokenOut } from '../types/api'
import { downloadText } from '../utils/download'

export function fetchFeedTokens(): Promise<FeedTokenOut[]> {
  return api<FeedTokenOut[]>('/calendar/feed-tokens')
}

/** The answer carries the plaintext ONCE — the card shows it and never asks again. */
export function createFeedToken(label: string): Promise<FeedTokenCreated> {
  return api<FeedTokenCreated>('/calendar/feed-tokens', { method: 'POST', body: JSON.stringify({ label }) })
}

export function revokeFeedToken(id: number): Promise<void> {
  return api<void>(`/calendar/feed-tokens/${id}`, { method: 'DELETE' })
}

/** The feed URL a calendar app subscribes to — built from the page's own origin so it works
 *  wherever the dashboard is served from. */
export function feedUrl(token: string): string {
  return `${window.location.origin}/api/v1/calendar/feed.ics?token=${encodeURIComponent(token)}`
}

/** "Add to calendar (.ics)": the server renders the window (2026-09-03 calendar spec §11)
 *  and the blob is saved through download.ts. A raw fetch rather than api(): the body is
 *  text/calendar, not JSON, and a GET has nothing to invalidate. */
export async function downloadCalendarIcs(start: string, end: string, filename = 'financial-calendar.ics'): Promise<void> {
  const token = getToken()
  const res = await fetch(`/api/v1/calendar/export.ics?start=${start}&end=${end}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let detail = `Export failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status)
  }
  downloadText(await res.text(), filename, 'text/calendar;charset=utf-8')
}
```

- [ ] **Step 4: Run**

Run: `npx vitest run src/api/calendarFeed.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/types/api.ts src/api/calendarFeed.ts src/api/calendarFeed.test.ts
git commit -m "feat(api-client): feed tokens, feedUrl, downloadCalendarIcs through the server renderer"
```

---

### Task 6: `CalendarFeedCard`

**Files:**
- Create: `src/components/settings/CalendarFeedCard.tsx`, `src/components/settings/CalendarFeedCard.test.tsx`
- Modify: `src/components/settings/settings.css` (append)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/CalendarFeedCard.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/calendarFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/calendarFeed')>()),
  fetchFeedTokens: vi.fn(),
  createFeedToken: vi.fn(),
  revokeFeedToken: vi.fn(),
}))
vi.mock('../../api/settings', () => ({ fetchAppSettings: vi.fn(), putAppSettings: vi.fn() }))
import { createFeedToken, fetchFeedTokens, revokeFeedToken } from '../../api/calendarFeed'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import ToastProvider from '../ToastProvider'
import CalendarFeedCard from './CalendarFeedCard'

const SETTINGS = { swr_pct: '0.040000', espp_ticker: 'NVDA', price_refresh_cron: '10 13 * * mon-fri', calendar_update_due_day: 1 }

function mount() {
  return render(
    <ToastProvider>
      <CalendarFeedCard />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchFeedTokens).mockResolvedValue([
    { id: 1, label: 'phone', created_at: '2026-09-01T10:00:00Z', last_used_at: null },
    { id: 2, label: 'laptop', created_at: '2026-09-02T10:00:00Z', last_used_at: '2026-09-03T08:00:00Z' },
  ])
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
})
afterEach(cleanup)

describe('CalendarFeedCard', () => {
  it('lists the feed links with created and last-used, and the warning sentence', async () => {
    mount()
    expect(await screen.findByText('phone')).toBeTruthy()
    expect(screen.getByText('laptop')).toBeTruthy()
    expect(screen.getAllByText('never')).toHaveLength(1)
    expect(screen.getByText(/Anyone holding a feed link can read your calendar/)).toBeTruthy()
    expect(document.getElementById('calendar')).not.toBeNull()
  })

  it('creates a link, shows its URL exactly once with Copy, and never shows it again', async () => {
    vi.mocked(createFeedToken).mockResolvedValue({ id: 3, label: 'watch', created_at: '2026-09-04T10:00:00Z', last_used_at: null, token: 'tok-abc' })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    mount()
    await screen.findByText('phone')
    fireEvent.change(screen.getByLabelText('Label for the new link'), { target: { value: ' watch ' } })
    fireEvent.click(screen.getByRole('button', { name: 'New feed link' }))
    await waitFor(() => expect(createFeedToken).toHaveBeenCalledWith('watch'))
    const url = (await screen.findByLabelText('Feed URL')) as HTMLInputElement
    expect(url.value).toBe(`${window.location.origin}/api/v1/calendar/feed.ics?token=tok-abc`)
    expect(screen.getByText(/shown once/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(url.value)
    // The list refetches; the new row carries no URL.
    vi.mocked(fetchFeedTokens).mockResolvedValue([{ id: 3, label: 'watch', created_at: '2026-09-04T10:00:00Z', last_used_at: null }])
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByLabelText('Feed URL')).toBeNull())
    expect(await screen.findByText('watch')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('revokes a link and refetches', async () => {
    vi.mocked(revokeFeedToken).mockResolvedValue(undefined)
    mount()
    await screen.findByText('phone')
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the phone link' }))
    await waitFor(() => expect(revokeFeedToken).toHaveBeenCalledWith(1))
    await waitFor(() => expect(fetchFeedTokens).toHaveBeenCalledTimes(2))
  })

  it('saves the due day with the other settings carried verbatim', async () => {
    vi.mocked(putAppSettings).mockResolvedValue({ ...SETTINGS, calendar_update_due_day: 5 })
    mount()
    const box = (await screen.findByLabelText('Monthly update reminder day')) as HTMLInputElement
    expect(box.value).toBe('1')
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder day' }))
    await waitFor(() =>
      expect(putAppSettings).toHaveBeenCalledWith({
        swr_pct: '0.040000',
        espp_ticker: 'NVDA',
        price_refresh_cron: '10 13 * * mon-fri',
        calendar_update_due_day: 5,
      }),
    )
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it('refuses a day outside 1–28 without calling the API', async () => {
    mount()
    const box = await screen.findByLabelText('Monthly update reminder day')
    fireEvent.change(box, { target: { value: '31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder day' }))
    expect(screen.getByRole('alert').textContent).toContain('between 1 and 28')
    expect(putAppSettings).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/CalendarFeedCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the card**

```tsx
// src/components/settings/CalendarFeedCard.tsx
import { useEffect, useRef, useState } from 'react'
import { createFeedToken, feedUrl, fetchFeedTokens, revokeFeedToken } from '../../api/calendarFeed'
import { ApiError } from '../../api/client'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import type { AppSettingsOut, FeedTokenOut } from '../../types/api'
import { formatDate, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

const MIN_DAY = 1
const MAX_DAY = 28

/**
 * The Settings Calendar-feed card (2026-09-03 calendar spec §11–§12): subscription links
 * (create → the URL shown ONCE with Copy; list with created / last used / Revoke) and the
 * monthly-update reminder day. The token plaintext lives in component state only while the
 * "shown once" panel is open; nothing here ever asks the server for it again.
 */
export default function CalendarFeedCard() {
  const [tokens, setTokens] = useState<FeedTokenOut[] | null>(null)
  const [settings, setSettings] = useState<AppSettingsOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [labelBox, setLabelBox] = useState('')
  const [fresh, setFresh] = useState<{ label: string; url: string } | null>(null)
  const [dayBox, setDayBox] = useState('')
  const [dayError, setDayError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const seqRef = useRef(0)
  const toast = useToast()

  // A plain function over stable setters, called from the effect and from Retry (the
  // LimitsCard idiom — a useCallback here trips preserve-manual-memoization).
  const load = () => {
    const seq = ++seqRef.current
    Promise.all([fetchFeedTokens(), fetchAppSettings()])
      .then(([list, appSettings]) => {
        if (seq !== seqRef.current) return
        setTokens(list)
        setSettings(appSettings)
        setDayBox(String(appSettings.calendar_update_due_day))
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load the calendar feed settings.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const create = () => {
    const label = labelBox.trim()
    if (label === '') return
    setBusy(true)
    setError(null)
    createFeedToken(label)
      .then((created) => {
        setFresh({ label: created.label, url: feedUrl(created.token) })
        setLabelBox('')
      })
      .catch((err: unknown) => setError(message(err, 'Could not create the feed link.')))
      .finally(() => setBusy(false))
  }

  const copy = () => {
    if (fresh === null) return
    navigator.clipboard
      .writeText(fresh.url)
      .then(() => toast.success('Feed URL copied'))
      .catch(() => toast.error('Could not copy — select the URL and copy it by hand'))
  }

  const dismissFresh = () => {
    setFresh(null)
    load()
  }

  const revoke = (token: FeedTokenOut) => {
    setBusy(true)
    setError(null)
    // No Undo: the plaintext is gone for good, which is the point of revoking.
    revokeFeedToken(token.id)
      .then(() => {
        toast.success(`Revoked the ${token.label} link — calendars using it will stop updating`)
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Could not revoke the link.')))
      .finally(() => setBusy(false))
  }

  const saveDay = () => {
    if (settings === null) return
    const day = Number(dayBox)
    if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY) {
      setDayError(`Pick a day between ${MIN_DAY} and ${MAX_DAY} — every month has one.`)
      return
    }
    setBusy(true)
    setDayError(null)
    setSavedNote(false)
    // The three other settings travel back VERBATIM (full-form PUT); only the day changes.
    putAppSettings({
      swr_pct: settings.swr_pct,
      espp_ticker: settings.espp_ticker,
      price_refresh_cron: settings.price_refresh_cron,
      calendar_update_due_day: day,
    })
      .then((saved) => {
        setSettings(saved)
        setDayBox(String(saved.calendar_update_due_day))
        setSavedNote(true)
      })
      .catch((err: unknown) => setDayError(message(err, 'Could not save the reminder day.')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6" id="calendar" role="region" aria-label="Calendar feed">
      <h2 className="eyebrow">
        Calendar feed
        <InfoHint text="Subscribe your phone or desktop calendar to the dashboard's events — vests, paydays, deadlines, your own reminders — with amounts. The link is the credential: anyone holding it can read the feed." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {tokens === null && error === null && <p className="empty-note">Loading…</p>}
      {tokens !== null && (
        <>
          {fresh !== null ? (
            <div className="settings-card-form feed-fresh" role="status">
              <label>
                Feed URL
                <input className="field-input feed-url" aria-label="Feed URL" readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <p className="settings-note">
                Copy it now — this link for <strong>{fresh.label}</strong> is shown once. Paste it into your
                calendar app as a subscription (Google: Other calendars → From URL; Apple: File → New Calendar
                Subscription).
              </p>
              <div className="settings-card-actions">
                <button type="button" className="button button-primary" onClick={copy}>
                  Copy
                </button>
                <button type="button" className="button" onClick={dismissFresh}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form
              className="settings-card-form"
              onSubmit={(e) => {
                e.preventDefault()
                create()
              }}
            >
              <label>
                Label for the new link
                <input
                  className="field-input"
                  aria-label="Label for the new link"
                  placeholder="phone, laptop…"
                  maxLength={60}
                  value={labelBox}
                  disabled={busy}
                  onChange={(e) => setLabelBox(e.target.value)}
                />
              </label>
              <div className="settings-card-actions">
                <button type="submit" className="button button-primary" disabled={busy || labelBox.trim() === ''}>
                  New feed link
                </button>
              </div>
            </form>
          )}
          {tokens.length === 0 ? (
            <p className="empty-note">No feed links yet.</p>
          ) : (
            <div className="settings-scroll">
              <table className="data-table feed-table">
                <thead>
                  <tr>
                    <th>Link</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <td>{token.label}</td>
                      <td>{formatDate(token.created_at)}</td>
                      <td>{token.last_used_at === null ? 'never' : formatDateTime(token.last_used_at)}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="button"
                          aria-label={`Revoke the ${token.label} link`}
                          disabled={busy}
                          onClick={() => revoke(token)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="settings-note">
            Anyone holding a feed link can read your calendar, amounts included. Revoke a link here if it
            leaks; the calendar app using it stops updating.
          </p>
          {settings !== null && (
            <form
              className="settings-card-form"
              onSubmit={(e) => {
                e.preventDefault()
                saveDay()
              }}
            >
              <label>
                Monthly update reminder day
                <input
                  className="field-input"
                  aria-label="Monthly update reminder day"
                  inputMode="numeric"
                  min={MIN_DAY}
                  max={MAX_DAY}
                  type="number"
                  value={dayBox}
                  disabled={busy}
                  onChange={(e) => {
                    setDayBox(e.target.value)
                    setDayError(null)
                    setSavedNote(false)
                  }}
                />
              </label>
              <p className="settings-note">
                The "Monthly update — enter last month" reminder lands on this day of each month, on the
                calendar and in the feed (with an alarm three days before).
              </p>
              <div className="settings-card-actions">
                <button type="submit" className="button button-primary" disabled={busy}>
                  Save reminder day
                </button>
              </div>
              {dayError && (
                <div className="error-banner" role="alert">
                  {dayError}
                </div>
              )}
              {savedNote && (
                <p className="settings-note" role="status">
                  Saved.
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  )
}
```

Append to `src/components/settings/settings.css`:

```css
/* Calendar feed card (2026-09-03 calendar spec §11): the once-shown URL is a wide, selectable
   monospace box; the token table reuses the accounts table's row-actions grammar. */
.feed-url {
  width: 100%;
  text-align: left;
}

.feed-fresh {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--accent);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.feed-table .row-actions {
  text-align: right;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run**

Run: `npx vitest run src/components/settings/CalendarFeedCard.test.tsx`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/CalendarFeedCard.tsx src/components/settings/CalendarFeedCard.test.tsx src/components/settings/settings.css
git commit -m "feat(settings): Calendar feed card — once-shown links, revoke, reminder day"
```

---

### Task 7: Mount the card; palette section; page test mock

**Files:**
- Modify: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `src/components/paletteRegistry.ts`, `src/components/paletteRegistry.test.ts`

- [ ] **Step 1: Mount**

In `src/pages/SettingsPage.tsx` add `import CalendarFeedCard from '../components/settings/CalendarFeedCard'` (alphabetically among the card imports) and, directly after `<LimitsCard />`:

```tsx
          {/* Calendar feed links + the monthly-update reminder day (2026-09-03 calendar spec
              §11–§12): its own fetch and error state, the same loadedOnce gate. */}
          <CalendarFeedCard />
```

In `src/components/paletteRegistry.ts` add to `SETTINGS_SECTIONS` after the `limits` entry:

```ts
  { id: 'calendar', label: 'Calendar feed', keywords: ['ics', 'subscribe', 'feed', 'token', 'reminder day', 'due day'] },
```

- [ ] **Step 2: Tests**

In `src/pages/SettingsPage.test.tsx`, beside the other `vi.mock('../api/...')` calls add:

```ts
vi.mock('../api/calendarFeed', () => ({
  fetchFeedTokens: vi.fn().mockResolvedValue([]),
  createFeedToken: vi.fn(),
  revokeFeedToken: vi.fn(),
  feedUrl: (token: string) => `http://localhost/api/v1/calendar/feed.ics?token=${token}`,
}))
```

and append a test inside the main describe:

```ts
  it('mounts the Calendar feed card with its anchor', async () => {
    renderPage()
    expect(await screen.findByRole('region', { name: 'Calendar feed' })).toBeTruthy()
    expect(document.getElementById('calendar')).not.toBeNull()
  })
```

(`renderPage` is whatever helper the file already uses to render the page with its mocks — reuse it by name.) In `src/components/paletteRegistry.test.ts` append:

```ts
  it('reaches the Calendar feed card as an anchored Settings section', () => {
    const entries = buildEntries({ month: '2026-09-01', run: { refreshPrices: () => {}, askAssistant: () => {} } })
    const hit = matchEntries('ics feed', entries)[0]
    expect(hit.id).toBe('section:calendar')
    expect(hit.to).toBe('/settings#calendar')
  })
```

- [ ] **Step 3: Run, lint**

Run: `npx tsc -b && npx eslint src/pages/SettingsPage.tsx src/components/paletteRegistry.ts src/components/settings/CalendarFeedCard.tsx src/api/calendarFeed.ts && npx vitest run src/pages/SettingsPage.test.tsx src/components/paletteRegistry.test.ts src/components/CommandPalette.test.tsx`
Expected: clean; all green.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx src/components/paletteRegistry.ts src/components/paletteRegistry.test.ts
git commit -m "feat(settings): mount the Calendar feed card; palette reaches #calendar"
```

---

### Task 8: Lane gate

- [ ] **Backend:** `FINANCE_TEST_DB=finance_test_cal_b ../../../backend/.venv/Scripts/python.exe -m pytest -q && ../../../backend/.venv/Scripts/python.exe -m ruff check app tests && ../../../backend/.venv/Scripts/python.exe -m ruff format --check app tests` — all green.
- [ ] **Frontend:** `npx tsc -b && npx eslint . && npx vitest run` — all green.
- [ ] Leave the branch for Plan E to merge (B merges FIRST of the three lanes — its `api/calendar.py` hunk is an append, so C and D rebase cleanly on it).

---

## Self-review

**Spec coverage:** §11 calendar properties (VERSION, PRODID, METHOD, X-WR-CALNAME, REFRESH-INTERVAL, X-PUBLISHED-TTL) → Task 1; per-event UID from the key, deterministic DTSTAMP, DTSTART;VALUE=DATE, SUMMARY = label + amount, DESCRIPTION (amount line, items, note, link with `public_url`), CATEGORIES, STATUS by basis, one VEVENT + RRULE for a recurring custom → Tasks 1–2; VALARM on deadline types, omitted when done, hidden omitted → Task 2; folding on UTF-8 boundaries, `escape_text` moved server-side unchanged → Tasks 1–2; download `GET /calendar/export.ics?start&end` behind the bearer with the 400-day fence, saved through `download.ts` → Tasks 4–5; feed `?token=`, 30/365 window, sha256 lookup, 404 "feed not found", hourly `last_used_at`, headers, ETag/If-None-Match → 304, `60/hour` → Task 4; tokens `token_urlsafe(32)`, plaintext once, hash stored, list/revoke → Tasks 4–6; Settings card (`id="calendar"`, URL + Copy, list with label/created/last used/Revoke, "New feed link", the due-day field §12, the warning sentence) → Tasks 6–7; §16 `public_url`, `FEED_POLL` → Task 3; §17 ICS validity list and feed/token tests → Tasks 2, 4. Deferred by design: swapping the Calendar page's action onto `downloadCalendarIcs` (Plan E — Lane C owns `CalendarPage.tsx`); deleting `src/utils/ics.ts` (end of night).

**Placeholders:** none.

**Type consistency:** `render(events, *, public_url=None, calname=CALNAME)`, `fold_line(line)`, `escape_text(value)`, `amount_text(event)` used identically in module, tests and routes; `_compose_for(db, start, end, today)` and `_validated_span(start, end)` are Plan A's names; `FeedTokenOut` / `FeedTokenCreated` match between `schemas/calendar.py`, `types/api.ts` and the card; `feedUrl(token)`, `createFeedToken(label)`, `revokeFeedToken(id)`, `fetchFeedTokens()`, `downloadCalendarIcs(start, end)` are the same across `calendarFeed.ts`, its test, the card and the Settings page mock; the card's `putAppSettings` body is the full-form `AppSettingsUpdate` with the optional due day supplied.
