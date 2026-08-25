# Calendar Revision Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement financial-calendar spec §9 — section spacing, click→details popover/inline flow, user-entered custom events (table + CRUD + UI), and two bundled drive-by fixes.

**Architecture:** One additive migration (`custom_events` chained on `d2f8a6b3c1e7`) feeds `compose()` a ninth event type `custom` with `href = null` and an `id` riding the wire; the frontend swaps chip/list links for a shared `EventDetails` body rendered in a grid popover or an inline list expansion, plus an add/edit form driven by three new CRUD endpoints. Spacing rides the house `card-grid` wrapper.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pytest; React 19 + TS + vitest. No new dependencies.

**House rules (binding):** GETs never reject stored data; wire strings verbatim; comments explain constraints, not narration; color never the sole channel; NEVER `git push`; no file deletions. Backend tests: `cd backend && .venv/Scripts/python.exe -m pytest` against dockerized `finance_test` (loopback 5433 — do NOT run concurrent pytest sessions). Frontend: `npx vitest run` / `npm run lint` / `npm run build` from repo root. Targeted test files while iterating; full suites at the gates.

**Execution mode:** inline by the orchestrator on branch `calendar-revisions` (user-approved §9 design, 2026-08-24). Commits per task. Merge `--no-ff` after a code-review pass.

---

### Task 0: Branch + environment

- [ ] `git checkout -b calendar-revisions` from main (`b052f40` or later)
- [ ] Verify Docker DB up: `docker ps --filter name=finance-dashboard-db-1` (start via `docker compose up -d db` if not)
- [ ] Sanity: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_calendar_api.py -q` → 5 passed

### Task 1: `custom_events` table — model, migration, importer pin

**Files:**
- Create: `backend/app/models/calendar.py`
- Create: `backend/alembic/versions/20260824_2200_e7c5a9f4b2d8_custom_events.py`
- Modify: `backend/app/models/__init__.py` (import + `__all__`, alphabetical)
- Test: `backend/tests/test_importer_apply.py` (append)

- [ ] **Step 1: model** — new module (verify the `Base` import path against `app/models/spending.py` and copy it):

```python
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
```

- [ ] **Step 2: export** — in `models/__init__.py` add `from app.models.calendar import CustomEvent` (after the `app_setting` import, import-block order) and `"CustomEvent",` to `__all__` between `"CompEvent"` and `"DIVIDEND_SOURCES"`.

- [ ] **Step 3: migration** — mirror `20260824_0901_d2f8a6b3c1e7_securities_next_ex_div_date.py`'s shape:

```python
"""custom events

User-entered informational calendar events (2026-08-24 financial-calendar spec §9.3) —
dashboard-only, single-date, no page link. Additive; downgrade drops the table.

Revision ID: e7c5a9f4b2d8
Revises: d2f8a6b3c1e7
Create Date: 2026-08-24 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7c5a9f4b2d8"
down_revision: str | Sequence[str] | None = "d2f8a6b3c1e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "custom_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("detail", sa.String(length=300), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_custom_events_event_date"), "custom_events", ["event_date"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_custom_events_event_date"), table_name="custom_events")
    op.drop_table("custom_events")
```

- [ ] **Step 4: importer pin (test-first)** — append to `test_importer_apply.py`, mirroring `test_importer_never_writes_rsu_grants` (lines ~898-930) byte-for-byte in structure, including its `populate_existing` re-select idiom (open the existing test and copy its exact select form):

```python
async def test_importer_never_writes_custom_events(db):
    """Custom calendar events are dashboard-only (2026-08-24 spec §9.3): no sheet maps to
    them, so a re-import must leave the table byte-identical."""
    from app.importer.service import run_import
    from app.models import CustomEvent

    db.add(CustomEvent(event_date=date(2026, 9, 12), label="pre-import", detail="kept"))
    await db.commit()
    before = {
        row.id: (row.event_date, row.label, row.detail)
        for row in (await db.execute(select(CustomEvent))).scalars()
    }
    assert len(before) == 1

    report = await run_import(build_workbook(), db, dry_run=False)
    assert report.applied is True

    after = {
        row.id: (row.event_date, row.label, row.detail)
        for row in (
            await db.execute(select(CustomEvent).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
```

- [ ] **Step 5: run** — `pytest tests/test_importer_apply.py::test_importer_never_writes_custom_events -q` → PASS (conftest `create_all` picks the model up)
- [ ] **Step 6: commit** — `git add -A && git commit -m "feat(calendar): custom_events table — model, migration e7c5a9f4b2d8, importer pin"`

### Task 2: compose() emits `custom`; wire gains `id` + nullable `href`

**Files:**
- Modify: `backend/app/services/calendar_events.py`
- Modify: `backend/app/schemas/calendar.py`
- Test: `backend/tests/test_calendar_events.py`

- [ ] **Step 1: failing test** — `_compose` helper defaults gain `custom_rows=[]`; append:

```python
def test_custom_rows_render_and_clip():
    events = _of_type(
        _compose(
            date(2026, 9, 1),
            date(2026, 9, 30),
            custom_rows=[
                (7, date(2026, 9, 12), "Car insurance renewal", "policy 8841"),
                (8, date(2026, 10, 2), "Out of range", None),
            ],
        ),
        "custom",
    )
    assert [(e.event_date, e.label, e.detail, e.href, e.event_id) for e in events] == [
        (date(2026, 9, 12), "Car insurance renewal", "policy 8841", None, 7)
    ]


def test_computed_events_carry_no_event_id():
    events = _compose(date(2026, 1, 1), date(2026, 12, 31), payday_semi_monthly=True)
    assert events and all(e.event_id is None for e in events)
```

- [ ] **Step 2: run to fail** — `pytest tests/test_calendar_events.py -q` → TypeError (unexpected kwarg)
- [ ] **Step 3: implement** — in `calendar_events.py`: EVENT_TYPES gains `"custom"` (last) and its comment says *nine*; `CalendarEvent` becomes

```python
    event_date: date
    type: str  # one of EVENT_TYPES
    label: str
    detail: str | None
    href: str | None  # None for custom events — no page owns them (spec §9.3)
    event_id: int | None = None  # custom rows only: the edit/delete handle
```

compose signature gains (after `announced_ex_divs`):

```python
    custom_rows: list[tuple[int, date, str, str | None]],  # (id, event_date, label, detail)
```

and after the update_due block, before the sort:

```python
    # custom — user-entered informational rows (spec §9.3). No page owns them: href is
    # None and the id rides along so the frontend can edit/delete. The router loads only
    # rows in range; the clip keeps compose total over its inputs regardless.
    for event_id, event_date, label, detail in custom_rows:
        if in_range(event_date):
            events.append(
                CalendarEvent(
                    event_date=event_date,
                    type="custom",
                    label=label,
                    detail=detail,
                    href=None,
                    event_id=event_id,
                )
            )
```

- [ ] **Step 4: schemas** — `CalendarEventType` Literal gains `"custom"`; `CalendarEventOut` fields become

```python
    date: date
    type: CalendarEventType
    label: str
    detail: str | None
    href: str | None  # null for custom events — they have no page (spec §9.3)
    id: int | None  # set only for custom events, the frontend's edit/delete handle
```

and append (with `Field`, `field_validator` imported from pydantic):

```python
class CustomEventIn(BaseModel):
    """POST/PATCH body — full replace: the form always submits all three fields."""

    date: date
    label: str = Field(min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=300)

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


class CustomEventOut(BaseModel):
    id: int
    date: date
    label: str
    detail: str | None
```

Router temporarily breaks (missing kwarg + missing `id=`/`href=`) — Task 3 fixes it; do NOT run test_calendar_api.py between these steps.

- [ ] **Step 5: run** — `pytest tests/test_calendar_events.py -q` → all PASS
- [ ] **Step 6: commit** — `feat(calendar): compose emits custom events; wire gains id + nullable href`

### Task 3: CRUD endpoints + GET wiring

**Files:**
- Modify: `backend/app/api/calendar.py`
- Test: `backend/tests/test_calendar_api.py`

- [ ] **Step 1: failing tests** — append (CRUD roundtrip incl. trim + empty-detail→null; validation matrix: blank label 422 / label ×121 422 / detail ×301 422 / PATCH+DELETE unknown-id 404; range filter before/inside/after; POST requires auth). Use the exact test bodies from spec-plan draft:

```python
async def test_custom_event_crud_roundtrip(auth_client):
    created = await auth_client.post(
        f"{CALENDAR}/events",
        json={"date": "2026-09-12", "label": "  Car insurance renewal ", "detail": ""},
    )
    assert created.status_code == 201
    body = created.json()
    event_id = body["id"]
    # Whitespace trims; an empty detail stores as null.
    assert body == {
        "id": event_id,
        "date": "2026-09-12",
        "label": "Car insurance renewal",
        "detail": None,
    }

    listed = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e for e in listed.json()["events"] if e["type"] == "custom"] == [
        {
            "date": "2026-09-12",
            "type": "custom",
            "label": "Car insurance renewal",
            "detail": None,
            "href": None,
            "id": event_id,
        }
    ]

    updated = await auth_client.patch(
        f"{CALENDAR}/events/{event_id}",
        json={"date": "2026-09-13", "label": "Renewal", "detail": "moved a day"},
    )
    assert updated.status_code == 200
    assert updated.json() == {
        "id": event_id,
        "date": "2026-09-13",
        "label": "Renewal",
        "detail": "moved a day",
    }

    deleted = await auth_client.delete(f"{CALENDAR}/events/{event_id}")
    assert deleted.status_code == 204
    after = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e for e in after.json()["events"] if e["type"] == "custom"] == []


async def test_custom_event_validation(auth_client):
    blank = await auth_client.post(f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "   "})
    assert blank.status_code == 422
    over = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "x" * 121}
    )
    assert over.status_code == 422
    long_detail = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "ok", "detail": "y" * 301}
    )
    assert long_detail.status_code == 422
    missing = await auth_client.patch(
        f"{CALENDAR}/events/999", json={"date": "2026-09-12", "label": "ok"}
    )
    assert missing.status_code == 404
    gone = await auth_client.delete(f"{CALENDAR}/events/999")
    assert gone.status_code == 404


async def test_custom_events_load_only_the_requested_range(auth_client):
    for day, label in (("2026-08-31", "before"), ("2026-09-15", "inside"), ("2026-10-01", "after")):
        resp = await auth_client.post(f"{CALENDAR}/events", json={"date": day, "label": label})
        assert resp.status_code == 201
    listed = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e["label"] for e in listed.json()["events"] if e["type"] == "custom"] == ["inside"]


async def test_custom_event_requires_auth(client):
    resp = await client.post(f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "nope"})
    assert resp.status_code == 401
```

- [ ] **Step 2: implement** — in `api/calendar.py`: imports gain `Response` (fastapi), `CustomEvent` (models), `CustomEventIn, CustomEventOut` (schemas). GET loads, after the snapshot probe:

```python
    custom_rows = [
        (row.id, row.event_date, row.label, row.detail)
        for row in (
            await db.execute(
                select(CustomEvent)
                .where(CustomEvent.event_date >= start, CustomEvent.event_date <= end)
                .order_by(CustomEvent.event_date, CustomEvent.id)
            )
        ).scalars()
    ]
```

passes `custom_rows=custom_rows` to `compose(...)`, and the Out mapping gains `href=event.href, id=event.event_id` (href was already passed — it now carries None through). Then the CRUD block at the end (single-user posture, comp.py's grammar):

```python
def _custom_out(row: CustomEvent) -> CustomEventOut:
    return CustomEventOut(id=row.id, date=row.event_date, label=row.label, detail=row.detail)


async def _get_custom_event(db: AsyncSession, event_id: int) -> CustomEvent:
    row = (
        await db.execute(select(CustomEvent).where(CustomEvent.id == event_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="custom event not found")
    return row


@router.post("/events", response_model=CustomEventOut, status_code=201)
async def create_custom_event(
    body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    row = CustomEvent(event_date=body.date, label=body.label, detail=body.detail)
    db.add(row)
    await db.commit()
    return _custom_out(row)


@router.patch("/events/{event_id}", response_model=CustomEventOut)
async def update_custom_event(
    event_id: int, body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    """Full replace — the form always submits all three fields (spec §9.3)."""
    row = await _get_custom_event(db, event_id)
    row.event_date = body.date
    row.label = body.label
    row.detail = body.detail
    await db.commit()
    return _custom_out(row)


@router.delete("/events/{event_id}", status_code=204)
async def delete_custom_event(event_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_custom_event(db, event_id))
    await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 3: run** — `pytest tests/test_calendar_api.py tests/test_calendar_events.py -q` → all PASS
- [ ] **Step 4: backend gate** — `.venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format --check app tests` → clean (fix reflows if flagged)
- [ ] **Step 5: commit** — `feat(calendar): custom-event CRUD + GET wiring`

### Task 4: frontend wire types + api client + fixture sweep

**Files:**
- Modify: `src/types/api.ts` (~1015-1039), `src/api/calendar.ts`
- Sweep: every `CalendarEvent` literal (tsc finds them: `CalendarPage.test.tsx`, `src/utils/ics.test.ts`, `src/components/calendar/calendarView.test.ts`, `src/components/overview/upNext.test.ts`, `src/pages/OverviewPage.test.tsx`)

- [ ] **Step 1:** `CalendarEventType` gains `| 'custom'`; `CalendarEvent` becomes `href: string | null` + `id: number | null` (comment: *null except custom — the edit/delete handle*); add:

```ts
// POST/PATCH body — full replace (the form always submits all three fields).
export interface CustomEventBody {
  date: string
  label: string
  detail: string | null
}

export interface CustomEventOut {
  id: number
  date: string
  label: string
  detail: string | null
}
```

- [ ] **Step 2:** `api/calendar.ts` — check how an existing DELETE caller handles the 204 body (`src/api/comp.ts` deleteGrant) and mirror it exactly:

```ts
export function createCustomEvent(body: CustomEventBody): Promise<CustomEventOut> {
  return api<CustomEventOut>('/calendar/events', { method: 'POST', body: JSON.stringify(body) })
}

export function updateCustomEvent(id: number, body: CustomEventBody): Promise<CustomEventOut> {
  return api<CustomEventOut>(`/calendar/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCustomEvent(id: number): Promise<void> {
  return api<void>(`/calendar/events/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 3: sweep** — `npx tsc -b` (or `npm run build`) and add `id: null` to every flagged fixture literal. In `ics.test.ts` only the `event()` base needs it.
- [ ] **Step 4:** `npx vitest run src/utils/ics.test.ts src/components/calendar src/components/overview/upNext.test.ts` → PASS; commit `feat(calendar): frontend wire types + custom-event api client`

### Task 5: view vocabulary — color/label/order, hrefLabel, eventKey

**Files:** `src/components/calendar/calendarView.ts` + its test.

- [ ] **Step 1: failing tests** — append (import MUTED; check the existing color-map pin and extend it with `custom: MUTED`):

```ts
it('colors custom with the muted theme token, labels and orders it last', () => {
  expect(EVENT_COLORS.custom).toBe(MUTED)
  expect(EVENT_TYPE_LABELS.custom).toBe('Custom')
  expect(EVENT_TYPE_ORDER.at(-1)).toBe('custom')
})

it('hrefLabel names the app pages and falls back to "page"', () => {
  expect(hrefLabel('/comp')).toBe('Comp')
  expect(hrefLabel('/espp')).toBe('ESPP')
  expect(hrefLabel('/portfolio')).toBe('Portfolio')
  expect(hrefLabel('/paycheck')).toBe('Paycheck')
  expect(hrefLabel('/taxes')).toBe('Taxes')
  expect(hrefLabel('/update')).toBe('Monthly update')
  expect(hrefLabel('/nowhere')).toBe('page')
})

it('eventKey keys custom rows by id and computed rows by identity triple', () => {
  expect(eventKey({ date: '2026-09-12', type: 'custom', label: 'Car', detail: null, href: null, id: 41 })).toBe('custom-41')
  expect(eventKey({ date: '2026-09-16', type: 'payday', label: 'Payday', detail: null, href: '/paycheck', id: null })).toBe('payday-2026-09-16-Payday')
})
```

- [ ] **Step 2: implement** in `calendarView.ts`:

```ts
import { MUTED, PALETTE } from '../../charts/theme'
```

`EVENT_COLORS` gains (with comment):

```ts
  // User-entered rows: the palette caps chart slots at 8 (fixed order IS the CVD
  // mechanism), so custom wears the theme's MUTED gray — "entered, not derived".
  custom: MUTED,
```

`EVENT_TYPE_LABELS` gains `custom: 'Custom'`; `EVENT_TYPE_ORDER` appends `'custom'`; append:

```ts
// Popover footer vocabulary (spec §9.2): the page a computed event opens. A fixed map,
// not string munging — hrefs are wire values.
export const HREF_LABELS: Record<string, string> = {
  '/comp': 'Comp',
  '/espp': 'ESPP',
  '/portfolio': 'Portfolio',
  '/paycheck': 'Paycheck',
  '/taxes': 'Taxes',
  '/update': 'Monthly update',
}

export function hrefLabel(href: string): string {
  return HREF_LABELS[href] ?? 'page'
}

// React-key identity (spec §9.4): custom labels may repeat, so the id keys them;
// computed events key on the ICS-UID triple.
export function eventKey(event: CalendarEvent): string {
  return event.id !== null ? `custom-${event.id}` : `${event.type}-${event.date}-${event.label}`
}
```

- [ ] **Step 3:** `npx vitest run src/components/calendar/calendarView.test.ts` → PASS; commit `feat(calendar): view vocabulary for custom events + hrefLabel/eventKey`

### Task 6: ICS — id-keyed custom UIDs + lone-CR escape

**Files:** `src/utils/ics.ts` + test.

- [ ] **Step 1: failing tests** — append:

```ts
it('keys custom events by id so a rename UPDATES instead of duplicating', () => {
  const custom = event({ type: 'custom', label: 'Car insurance', href: null, id: 41 })
  expect(eventUid(custom)).toBe('custom-41@finance-dashboard')
  expect(eventUid({ ...custom, label: 'Renamed' })).toBe(eventUid(custom))
})

it('escapes a lone carriage return', () => {
  expect(escapeIcsText('a\rb')).toBe('a\\nb')
})
```

- [ ] **Step 2: implement** — `escapeIcsText` inserts `.replaceAll('\r', '\\n')` between the `'\r\n'` and `'\n'` lines (comment: `// lone CR — pasted text can carry one (spec §9.4)`); `eventUid` becomes:

```ts
export function eventUid(event: CalendarEvent): string {
  // Custom events key on the id (spec §9.3): a rename must UPDATE the event in a
  // subscribed calendar, not duplicate it. Computed events keep label identity.
  if (event.id !== null) return `custom-${event.id}@finance-dashboard`
  return `${event.type}-${event.date}-${slugify(event.label)}@finance-dashboard`
}
```

Also update the file-head comment's "href is always present" DESCRIPTION note: custom events have no href, `filter(Boolean)` already yields a detail-only (or empty) description.

- [ ] **Step 3:** `npx vitest run src/utils/ics.test.ts` → PASS; commit `feat(calendar): ICS custom UIDs by id + lone-CR escape`

### Task 7: the page — spacing, popover/inline details, add/edit form

**Files:**
- Create: `src/components/calendar/EventDetails.tsx`
- Modify: `src/pages/CalendarPage.tsx`, `src/pages/CalendarPage.css`, `src/components/panels.css` (comment truth only)
- Test: `src/pages/CalendarPage.test.tsx`

- [ ] **Step 1: EventDetails** (shared body — grid popover AND list expansion render it):

```tsx
import { NavLink } from 'react-router-dom'
import type { CalendarEvent } from '../../types/api'
import { formatDate } from '../../utils/format'
import { EVENT_COLORS, EVENT_TYPE_LABELS, hrefLabel } from './calendarView'

interface Props {
  event: CalendarEvent
  onEdit: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
  deleting: boolean
}

// The one details body (spec §9.2): type + date, label, detail, then the navigation —
// an explicit "Open {page} →" for computed events, Edit/Delete for custom ones.
export default function EventDetails({ event, onEdit, onDelete, deleting }: Props) {
  return (
    <div className="cal-event-details">
      <div className="cal-event-type">
        <span
          className="cal-legend-dot"
          style={{ backgroundColor: EVENT_COLORS[event.type] }}
          aria-hidden="true"
        />
        {EVENT_TYPE_LABELS[event.type]} · {formatDate(event.date)}
      </div>
      <div className="cal-event-label">{event.label}</div>
      {event.detail !== null && event.detail !== event.label && (
        <div className="cal-event-detail">{event.detail}</div>
      )}
      <div className="cal-event-actions">
        {event.href !== null && (
          <NavLink to={event.href} className="cal-event-open">
            Open {hrefLabel(event.href)} →
          </NavLink>
        )}
        {event.type === 'custom' && (
          <>
            <button type="button" className="button" onClick={() => onEdit(event)}>
              Edit
            </button>
            <button
              type="button"
              className="button"
              disabled={deleting}
              onClick={() => onDelete(event)}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: CalendarPage rework** — all of:
  - imports: `createCustomEvent, deleteCustomEvent, updateCustomEvent` from api/calendar; `eventKey` from calendarView; `EventDetails`; `todayIso` already imported.
  - state: `open: { key: string; surface: 'grid' | 'list' } | null`, `form: { mode: 'add' } | { mode: 'edit'; id: number } | null`, `fDate/fLabel/fDetail` strings, `saving`, `formError`, `deleting`, refs `anchorRef` (HTMLElement), `popoverRef` (HTMLDivElement).
  - `toggleEvent(event, surface, anchor)`: same key+surface → close; else store anchor, open.
  - effect on `[open]`: focus `popoverRef` when grid; document `keydown` Escape → close + `anchorRef.current?.focus()`; when grid also document `mousedown` outside (not in popover, not in anchor) → close; full cleanup.
  - handlers: `openAddForm` (today/blank/blank), `startEdit(event)` (guard `id === null`; prefill; `setOpen(null)`), `saveForm` (trim label; empty detail → null; POST or PATCH → close form, `setBusy(true); load(month)`; ApiError → formError), `removeEvent(event)` (DELETE → close popover, reload; ApiError → page `setError`).
  - wrapper div: `className={`card-grid loading-dim${busy ? ' is-loading' : ''}`}` and all three sections get `card span-12` (form card conditional, FIRST in the grid).
  - header gains `<button type="button" className="button" onClick={openAddForm}>Add event</button>` BEFORE the ICS button.
  - form card JSX: eyebrow `Add event`/`Edit event`, optional error-banner (role=alert), `.cal-form` with three wrapping `<label className="cal-form-field">` (Date `input type="date"`, Title maxLength 120, `Note (optional)` maxLength 300, all `field-input cal-form-input`), primary submit `Save event`/`Save changes` disabled when `saving || fLabel.trim() === '' || fDate === ''`, plain `Cancel` → `setForm(null)`.
  - grid chips: each event renders inside `<div key={key} className="cal-chip-slot">`; the chip is `<button type="button" className="cal-chip" aria-expanded={isOpen} aria-haspopup="dialog" style={{ borderLeftColor: EVENT_COLORS[event.type] }} onClick={(e) => toggleEvent(event, 'grid', e.currentTarget)}>{event.label}</button>` (the `title` attr is gone — the popover replaces it); when open, sibling `<div ref={popoverRef} role="dialog" aria-label={event.label} tabIndex={-1} className={`cal-popover${dayIndex % 7 >= 5 ? ' cal-popover-right' : ''}`}><EventDetails event={event} onEdit={startEdit} onDelete={removeEvent} deleting={deleting} /></div>`. The day-cell map gains the index: `weeks.flat().map((day, dayIndex) => ...)`.
  - list rows: `<li key={eventKey(event)}>` with `<button type="button" className="row-toggle cal-list-item" aria-expanded={isOpen} onClick={(e) => toggleEvent(event, 'list', e.currentTarget)}>` carrying the label + detail spans (NavLink deleted), then `{isOpen && <div className="cal-list-expansion"><EventDetails ... /></div>}`.
  - empty-note copy becomes: `No events in this window — vests, purchases and paydays appear once grants, periods and a paycheck profile are entered. Add your own with Add event.`
- [ ] **Step 3: CSS** — `CalendarPage.css`: `.cal-chip` re-based as a button (add `width: 100%; text-align: left; font-family: inherit; border: none; cursor: pointer;` keep `border-left: 3px solid var(--border)`, move `margin-top` to the slot); new rules `.cal-chip-slot { position: relative; margin-top: 3px; }`, `.cal-popover` (absolute, `top: calc(100% + 4px); left: 0; z-index: 2;` width 260px, surface-2 bg, border, radius 8, padding, `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4)`), `.cal-popover-right { left: auto; right: 0; }`, `.cal-event-type/-label/-detail/-actions/-open` (per design), `.cal-event-actions .button { padding: 0.25rem 0.6rem; font-size: 0.75rem; }`, `.cal-list-expansion` (left-rule indent), `.cal-form/.cal-form-field` (flex wrap, labeled columns; `.cal-form-field .field-input { width: 170px; text-align: left; font-family: inherit; }`, note field 260px). `panels.css`: InfoHint's z-index comment now reads `/* The app's bubble layer (shared with the calendar popover): floats over chart canvases and table rows. */`
- [ ] **Step 4: tests** — `CalendarPage.test.tsx`: mock module gains `createCustomEvent: vi.fn(), updateCustomEvent: vi.fn(), deleteCustomEvent: vi.fn()`; fixtures gain `id: null` and a fourth event `{ date: DAY_15, type: 'custom', label: 'Car insurance', detail: 'policy 8841', href: null, id: 41 }`. Update: chips query `button.cal-chip`; chip-link assertion replaced; legend test loops NINE names (+'Custom'). New tests:
  - popover opens on chip click (detail text + `Open Comp →` link with href `/comp`), Escape closes and refocuses the chip
  - outside mousedown closes; opening a second chip closes the first (single `.cal-popover` in the document)
  - custom chip popover has Edit + Delete buttons and NO link
  - list row click expands inline details (`.cal-list-expansion` contains the detail)
  - structural spacing pin: `document.querySelector('.card-grid.loading-dim')` non-null
  - add flow: click `Add event`, type Title ` Car insurance `, click `Save event` → `createCustomEvent` called with `{ date: todayIso(), label: 'Car insurance', detail: null }` (mock resolves `{ id: 99, date: todayIso(), label: 'Car insurance', detail: null }`) → `fetchCalendar` called a 2nd time
  - edit flow: open custom popover → Edit → Title prefilled `Car insurance` → change to `Renewal`, click `Save changes` → `updateCustomEvent` called with `(41, { date: DAY_15, label: 'Renewal', detail: 'policy 8841' })` → refetch
  - delete flow: open custom popover → Delete → `deleteCustomEvent(41)` → refetch
- [ ] **Step 5:** `npx vitest run src/pages/CalendarPage.test.tsx` → PASS; commit `feat(calendar): popover/inline details flow, add-edit form, card-grid spacing`

### Task 8: Up-next strip — custom rows render without a link

**Files:** `src/pages/OverviewPage.tsx` (+`OverviewPage.css` if `.up-next-plain` needs a rule), test.

- [ ] **Step 1: failing test** — in `OverviewPage.test.tsx`, add to the up-next fixture a custom event (nearest date so it lands in the strip): `{ date: <fixture-consistent>, type: 'custom', label: 'Car insurance', detail: null, href: null, id: 41 }`; assert the strip shows `Car insurance` but `screen.getByText('Car insurance').closest('a')` is null, while a computed item still renders inside an anchor.
- [ ] **Step 2: implement** — the strip's `<li>` keys by `eventKey(event)` (import from `../components/calendar/calendarView`) and branches:

```tsx
{event.href !== null ? (
  <NavLink to={event.href} className="up-next-link">
    <span className="up-next-date">{formatDate(event.date)}</span> {event.label}
  </NavLink>
) : (
  <span className="up-next-link up-next-plain">
    <span className="up-next-date">{formatDate(event.date)}</span> {event.label}
  </span>
)}
```

Check `.up-next-link` hover styling in OverviewPage.css; if it underlines, add `.up-next-plain { cursor: default; } .up-next-plain:hover { text-decoration: none; }`.

- [ ] **Step 3:** `npx vitest run src/pages/OverviewPage.test.tsx` → PASS; commit `feat(calendar): Up-next renders custom events as plain rows`

### Task 9: gates, review, merge

- [ ] Full frontend: `npx vitest run` (expect 777 + new ≈ 790s, 0 fail), `npm run lint` (0 errors, 1 sanctioned warning), `npm run build` (chunk ≤ 730 advisory — EventDetails is page-chunk code, StatTile chunk should be byte-stable; update the vite comment ONLY if the number moved)
- [ ] Full backend: `.venv/Scripts/python.exe -m pytest -q` (expect 845 + ~8 new) + ruff check/format
- [ ] Alembic: scratch-DB round-trip `upgrade head → check → downgrade -1 → upgrade head` (house ritual; single head `e7c5a9f4b2d8`)
- [ ] Code review (superpowers:code-reviewer subagent, BASE=branch-point HEAD=tip); fix Important+ findings on-branch
- [ ] Merge: `git checkout main && git merge --no-ff calendar-revisions -m "merge: calendar revisions — spacing, popover flow, custom events"`; re-run combined suites on main; update memory + report

## Self-review notes

- Spec §9.1 → Task 7 wrapper; §9.2 → Tasks 5, 7 (popover/list/labels) + Up-next unchanged-links in Task 8; §9.3 → Tasks 1-4, 7 (form), 5 (color); §9.4 → Task 6 (CR) + Tasks 5/7 (keys); §9.5 covered across task tests. No placeholders; names cross-checked (`eventKey`, `hrefLabel`, `event_id`, `CustomEventIn/Out`, `custom_rows` consistent throughout).
