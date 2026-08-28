# Card Owners + Household Advantage + Calendar Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-28):** (1) Your migration A's `down_revision` is
> the portfolio-backend plan's **`c9f4a7e2b168`** — Task 0's `alembic heads` capture remains
> the source of truth; your ids `c7a2f4e91b53 → d3b8e05fa726` stand. (2) The single-owner
> wallet definition (own ∪ joint, conservative premium) and the ≤-epsilon tile-hide are
> BLESSED as the spec. (3) The `person_suffix()` extraction touches
> `services/calendar_events.py`, which no sibling plan touches — safe. (4) Wave 2, alongside
> the portfolio-UI plan (zero shared files); your Task-8 smoke runs LAST, after all four
> merges.

**Goal:** Give credit cards and custom calendar events the owner dimension the rest of the
household already has, and cash the one number that ownership unlocks on the cards page.
Two migrations add `credit_cards.person_id` (backfilled to the primary person) and
`custom_events.person_id` (backfilled NULL = household). Cards CRUD carries the column at
both enumeration sites — including the two verbatim full-object rebuilds in the archive and
Undo flows, which are the known silent-clear hazard. The roster form swaps its free-text
"Primary holder" box for a real person select; the page grows owner chips (All / names /
Joint) that every derived surface inherits, owner badges on the matrix headers, and a new
pure `householdAdvantage()` tile that says how much the merged wallet beats the best single
wallet by. The calendar's event form gains a person select whose tag the server stamps into
the event label, so chips, list rows and the ICS summary all carry `— <name>` for free.
This plan also carries the batch's FINAL VERIFICATION gate — all suites plus a real-data
browser smoke of everything Plans 1–4 touched.

**Architecture:** Additive everywhere. `person_id` is nullable on both new columns and NULL
means what the household convention says it means — **joint** for a card (either spouse can
hold it), **household** for a calendar event (nobody in particular). The backfills differ
for exactly that reason and each migration says so in its docstring. Ownership is never
recomputed: the router echoes the stored column and the frontend reads it.

The cards page filters **once**, at `activeCards`, and every derived surface — the roster
table, the rewards matrix, the four KPI tiles, the card-value bars, and the credit-line
history chart — already consumes `activeCards` or a memo derived from it, so wiring the
chips there is the whole job (verified at `CreditCardsPage.tsx:102,137,184-234`). The
owner-scope vocabulary is the net-worth one, reused verbatim: absent = household, a person
id = **that person's cards plus the joint ones**, `joint` = NULL-only. The drill-in view
deliberately opts OUT of the scope — it renders instead of the grid and the chips, so its
math is always the household's; otherwise another owner's card would read "archived" when
it is merely out of scope.

`householdAdvantage()` is pure and lives beside `optimize()`. It prices the household wallet
and each single-owner wallet with **the same formula** — `optimalTotal + counted credits −
every annual fee in that wallet` — and returns their difference, or `null` when the answer
would be dishonest: fewer than two distinct non-joint owners hold active cards, or the delta
is not positive. The delta genuinely can be negative (a partner's high-fee card that wins no
category subtracts its fee from the household total but not from the other spouse's wallet),
which is exactly why the tile hides rather than printing a zero. It reuses `computeVerdicts`
and skips `optimize`'s marginal-value loop entirely, so the cost is `1 + owners` verdict
passes, not `1 + owners` full optimizations.

The calendar's person tag is stamped **server-side**, in `compose()`, using one shared
`person_suffix()` helper that the payday grammar now also calls — one definition of
`" — <name>"` for the whole app. Stamping in the composer is what makes the chips, the list
rows and the ICS `SUMMARY` (which is the label verbatim) all carry the name with no extra
wiring. The cost is a hazard the frontend must handle in two places: the edit form and the
delete-Undo re-POST both start from the STAMPED label and must peel the suffix back off, or
the next save stamps it twice. `CalendarEventOut` therefore carries `person_id` alongside
`id`, and `calendarView.stripPersonSuffix` is the one peeler.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 + Alembic (real-DB pytest),
React 19 + TypeScript + Vitest. No new dependencies. Two Alembic migrations, chained on the
batch head captured in Task 0.

**Spec:** `docs/superpowers/specs/2026-08-28-household-portfolio-projection-design.md` —
§3 items 2–3 (the two columns), §4.2 (cards), §4.4 (calendar), §5 (frontend), §7 (testing),
§9 Plan 4. Supporting audit: `docs/superpowers/specs/2026-08-26-marriage-readiness-audit.md`
§3.6 (the attachment points and the verbatim-rebuild hazard). **Do NOT flip the spec's
status line when done** — this is wave 2 of the batch; the orchestrator tracks batch status.

**Scope boundary (wave 2 of the batch).** In scope: migrations 2 and 3, cards CRUD +
schemas + model, `rewardsMath` owner support and `householdAdvantage`, `CardsPanel`,
`RewardsMatrix`, `CreditCardsPage`, `CardDetail` (display only), custom-event CRUD +
`compose` + calendar schemas, `calendarView`, `CalendarPage`, their tests, and the batch
verification gate. Explicitly NOT in this plan: `portfolio_accounts` and portfolio owner
params (Plan 1), portfolio/Settings owner UI (Plan 2), dual-career projection (Plan 3), any
owner query param on `/credit-cards` (the chips are client-side — the card list is small and
already fetched whole), authorized-user strategy modeling, per-category winner-by-owner
annotation, person tags on computed calendar events other than paydays, and making
`primary_holder` editable again.

**Preconditions checked in Task 0 (which STOPS if any is missing):**

| # | Interface | Owner | Used here for |
|---|---|---|---|
| P1 | `people` table with `Person(id, name, is_primary)` and the partial unique index `ux_people_single_primary` | household foundation (merged) | both backfills and both FKs |
| P2 | `GET /api/v1/household` returns `{people: [{id, name, is_primary}], marriage_date}` and `src/api/household.ts` exports `fetchHousehold` | household foundation (merged) | the roster both pages fetch |
| P3 | `services/calendar_events.compose(..., payday_sources=[PaydaySource(name, semi_monthly)])` stamps `"Payday — <name>"` when more than one person has a profile | two-income batch (merged) | the suffix grammar this plan factors out and reuses |
| P4 | A single alembic head | Plan 1 (this batch) or baseline | `down_revision` of migration A |

**Pinned wire contract (sibling plans and the verification task depend on these exact shapes):**

| Endpoint | Change |
|---|---|
| `GET/POST/PATCH /api/v1/credit-cards[/{id}]` | `CreditCardOut` gains `person_id: int \| null`; `CreditCardIn` gains `person_id: int \| null = null`. Unknown id → **422** `unknown person_id: {n}` |
| `GET /api/v1/calendar` | each `CalendarEventOut` gains `person_id: int \| null` (set for `custom` rows only, exactly like `id`); a tagged custom row's `label` is `"<stored label> — <person name>"` |
| `POST/PATCH /api/v1/calendar/events` | `CustomEventIn` gains `person_id: int \| null = null`; `CustomEventOut` gains `person_id: int \| null`. Unknown id → **422** `unknown person_id: {n}` |

**House rules that bind every task:** GETs never reject stored data; server sentences render
verbatim in the UI; Decimal/date values cross the wire as strings; comments explain
constraints, not narration; migrations chain onto the head captured in Task 0 and a shipped
revision is immutable (README §4.3); **task subagents never run `alembic upgrade`** — only
Task 8's orchestrator step does, and only against the dev database; no file deletions —
anything that looks deletable goes on the morning list; **never push**.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/models/credit_cards.py` | `CreditCard.person_id` (line 38 neighbourhood) |
| `backend/alembic/versions/20260828_0900_c7a2f4e91b53_credit_card_person_owner.py` | migration A (new) |
| `backend/app/schemas/credit_cards.py` | `person_id` on `CreditCardOut` (:66) and `CreditCardIn` (:85) |
| `backend/app/api/credit_cards.py` | `_validated_card_values` (:380-393) and `_card_out` (:318-339) — the two enumeration sites |
| `backend/tests/test_credit_cards_api.py` | `card_body` helper + owner roundtrip tests |
| `backend/app/models/calendar.py` | `CustomEvent.person_id` |
| `backend/alembic/versions/20260828_0901_d3b8e05fa726_custom_event_person_owner.py` | migration B (new) |
| `backend/app/schemas/calendar.py` | `person_id` on `CalendarEventOut`, `CustomEventIn`, `CustomEventOut` |
| `backend/app/services/calendar_events.py` | `person_suffix`, `CustomRow`, `CalendarEvent.person_id`, label stamping |
| `backend/app/api/calendar.py` | person validation + `CustomRow` feed + `person_id` echo |
| `backend/tests/test_calendar_events.py` | `CustomRow` call sites + suffix pin |
| `backend/tests/test_calendar_api.py` | tagged/untagged custom-event pins |
| `src/types/api.ts` | `person_id` on `CreditCardOut`/`CreditCardIn`/`CalendarEvent`/`CustomEventBody`/`CustomEventOut` |
| `src/components/creditcards/rewardsMath.ts` | `MathCard.ownerId`, `ownerMatches`, `netOf`, `householdAdvantage` |
| `src/components/creditcards/rewardsMath.test.ts` | the hand-checkable advantage fixture |
| `src/components/creditcards/CardsPanel.tsx` | owner select, Owner column, archive/Undo carry |
| `src/components/creditcards/RewardsMatrix.tsx` | owner badge on card headers |
| `src/pages/CreditCardsPage.tsx` | roster fetch, owner chips, scoped `activeCards`, advantage tile |
| `src/pages/CreditCardsPage.css` | the chips row |
| `src/pages/CreditCardsPage.test.tsx` | household mock + chips/tile/badge/rebuild pins |
| `src/components/calendar/calendarView.ts` (+test) | `personSuffix`, `stripPersonSuffix` |
| `src/utils/ics.test.ts` | SUMMARY carries the suffix |
| `src/pages/CalendarPage.tsx` (+test) | person select, strip-before-edit, strip-before-Undo |
| `src/pages/CalendarPage.css` | the form's person field |

NOT touched, on purpose: `src/api/creditCards.ts` and `src/api/calendar.ts` (their bodies are
typed by `types/api.ts` — the functions themselves are unchanged), `backend/app/importer/`
(neither table is ever imported — both models already say so and `test_importer_apply.py`
already pins it), `backend/app/seed.py`, `src/components/calendar/EventDetails.tsx` (it
renders `event.label`, which now arrives stamped).

---

## Phase 0 — Environment and precondition verification

### Task 0: Verify the checkout, the venv, the head, and the sibling interfaces

**Files:** none (verification only)

- [ ] **Step 1: Confirm a clean tree and the branch.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git status --porcelain
cd /c/Users/edyli/personal-finance-dashboard && git rev-parse --abbrev-ref HEAD
```

Expected: empty porcelain output. If the tree is dirty or the branch is not the one the
orchestrator prepared, STOP and report — do not stash or switch.

- [ ] **Step 2: Backend smoke** (proves the venv and the dev Postgres answer).

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest tests/test_health.py -q
```

Expected: `1 passed`. If it fails on connection, run
`cd /c/Users/edyli/personal-finance-dashboard/backend && docker compose up -d db` and retry
once; if it still fails, read `backend/app/config.py` for the dev `DATABASE_URL` default —
do not guess.

- [ ] **Step 3: Capture the migration head this plan chains onto.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic heads
```

Expected: exactly ONE line. Write it down — call it `$HEAD`. If Plan 1 (portfolio accounts)
has landed this is its migration; if the batch is being run out of order it is
`b5f2c8d31e7a` (the 2026-08-27 baseline). **If there are two heads, STOP and report** — a
branched history is not something this plan may resolve. Every `down_revision` placeholder
below that reads `$HEAD` gets this exact value.

- [ ] **Step 4: Verify P1/P2 — the roster exists on both sides.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && grep -n "is_primary\|ux_people_single_primary" app/models/household.py
cd /c/Users/edyli/personal-finance-dashboard && grep -n "fetchHousehold" src/api/household.ts
```

Expected: the `Person` model with `is_primary` and the partial unique index; `fetchHousehold`
exported. If either is missing, STOP — both backfills and both selects depend on it.

- [ ] **Step 5: Verify P3 — the payday suffix grammar is where this plan expects it.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && grep -n "Payday — \|PaydaySource\|labelled" app/services/calendar_events.py
```

Expected: `label=f"Payday — {source.name}" if labelled else "Payday"` around line 207. Task 2
factors that literal into `person_suffix()`; if the line has moved or changed shape, record
the new text and adapt the edit — the byte-identical output is what matters, not the line
number.

- [ ] **Step 6: Confirm the cards page's single filter point.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && grep -n "activeCards\|activeCard\b" src/pages/CreditCardsPage.tsx
```

Expected: `activeCards` defined once (≈:137) and consumed by `kpis` (≈:186-195), the matrix
(≈:317-318) and `lineCards` (≈:220-226); `activeCard` (the drill) defined at ≈:163. If
another consumer of `cards` that should be scoped has appeared, add it to Task 5's list.

- [ ] **Step 7: Frontend smoke.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/creditcards/rewardsMath.test.ts
```

Expected: green. If node modules are missing, run `npm ci` once and retry.

No commit for this task.

---

## Phase 1 — Backend: the two owner columns

### Task 1: `credit_cards.person_id` — model, migration A, schemas, both enumeration sites

**Files:**
- `backend/tests/test_credit_cards_api.py` (`card_body` at :13-28; append the new tests after `test_card_patch_full_replace_and_rename_clash`, ≈:327)
- `backend/app/models/credit_cards.py` (:38-39)
- `backend/app/schemas/credit_cards.py` (:66, :85)
- `backend/app/api/credit_cards.py` (imports :10-18, `_card_out` :318-339, `_validated_card_values` :347-393)
- `backend/alembic/versions/20260828_0900_c7a2f4e91b53_credit_card_person_owner.py` (new)

- [ ] **Step 1: Write the failing tests.** In `backend/tests/test_credit_cards_api.py`, add
`"person_id": None,` to the `card_body` default so every existing body sends the column
explicitly (full-replace house style). Replace lines 13-28 with:

```python
def card_body(name: str = "Venture X", **over) -> dict:
    body = {
        "name": name,
        "annual_fee": "395.00",
        "rewards_currency": "miles",
        "point_value_cents": "1.7",
        "primary_holder": "Ed",
        "authorized_users": None,
        "opened_on": "2023-05-12",
        "is_active": True,
        "account_id": None,
        "notes": None,
        "sort_order": 0,
        # NULL is JOINT, never "unknown" — the migration backfilled every pre-existing card
        # to the primary person, so an omitted owner here is a deliberate joint card.
        "person_id": None,
    }
    body.update(over)
    return body
```

Then add `Person` to the model import at line 8:

```python
from app.models import (
    Account,
    CardCredit,
    CreditCard,
    CreditLimitEvent,
    Person,
    RewardCategory,
    RewardRate,
)
```

And append these two tests immediately after `test_card_patch_full_replace_and_rename_clash`:

```python
async def test_card_owner_roundtrips_and_null_means_joint(auth_client, db):
    me = Person(name="Me", is_primary=True)
    sam = Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.commit()

    created = await auth_client.post(CARDS, json=card_body(person_id=sam.id))
    assert created.status_code == 201, created.text
    assert created.json()["person_id"] == sam.id
    card_id = created.json()["id"]

    # The list is the page's only card source — the column must ride it too.
    listed = await auth_client.get(CARDS)
    assert [c["person_id"] for c in listed.json()] == [sam.id]

    # Full replace: an explicit null is how a card becomes JOINT (the accounts precedent).
    joint = await auth_client.patch(f"{CARDS}/{card_id}", json=card_body(person_id=None))
    assert joint.status_code == 200
    assert joint.json()["person_id"] is None

    back = await auth_client.patch(f"{CARDS}/{card_id}", json=card_body(person_id=me.id))
    assert back.status_code == 200
    assert back.json()["person_id"] == me.id


async def test_card_owner_must_exist(auth_client):
    ghost = await auth_client.post(CARDS, json=card_body(person_id=999))
    assert ghost.status_code == 422
    # The server's own sentence — the UI renders it verbatim (net_worth.py's wording).
    assert ghost.json()["detail"] == "unknown person_id: 999"
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest tests/test_credit_cards_api.py -q
```

Expected: the two new tests fail (`KeyError: 'person_id'` on the echo, and a 201 where 422
was expected — pydantic ignores the unknown body key today). Every pre-existing test in the
file still passes: an extra key in the request body is ignored, and no existing assertion
enumerates the response keys.

- [ ] **Step 3: Add the model column.** In `backend/app/models/credit_cards.py`, replace the
class docstring and the columns through `authorized_users` (lines 21-39) with — the two
`CheckConstraint`s are unchanged, reproduced here only so the replacement is a whole block:

```python
class CreditCard(Base):
    """One real card account. OWNERSHIP is `person_id` (NULL = joint — either spouse can
    hold the card); `primary_holder`/`authorized_users` stay as INFORMATIONAL text, e.g.
    the exact name embossed on the plastic (2026-08-28 spec §3 item 2)."""

    __tablename__ = "credit_cards"
    __table_args__ = (
        CheckConstraint("annual_fee >= 0", name="annual_fee_non_negative"),
        CheckConstraint("point_value_cents > 0", name="point_value_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    annual_fee: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    rewards_currency: Mapped[str] = mapped_column(String(20))  # one of REWARDS_CURRENCIES
    # Valuation of ONE point/mile in cents; cash stays 1.0. The optimizer's whole
    # cross-currency comparison hangs off this column (spec §1).
    point_value_cents: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("1"))
    # NULL = JOINT, never "unowned": migration c7a2f4e91b53 backfilled every pre-existing
    # card to the primary person, so NULL only ever arrives from a deliberate choice.
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="SET NULL"), default=None
    )
    primary_holder: Mapped[str | None] = mapped_column(String(80))
    authorized_users: Mapped[str | None] = mapped_column(String(200))  # free-form, comma chips
```

`ForeignKey` is already imported at line 13 — no import change is needed in this file.

- [ ] **Step 4: Add the schema fields.** In `backend/app/schemas/credit_cards.py`, insert
`person_id: int | None` into `CreditCardOut` immediately before `primary_holder` (:66):

```python
class CreditCardOut(BaseModel):
    id: int
    name: str
    slug: str
    annual_fee: Decimal
    rewards_currency: str
    point_value_cents: Decimal
    person_id: int | None
    primary_holder: str | None
    authorized_users: str | None
    opened_on: date | None
    is_active: bool
    account_id: int | None
    notes: str | None
    sort_order: int
    credits: list[CardCreditOut]
    current_limit: Decimal | None
    limit_events: list[CreditLimitEventOut]
```

and into `CreditCardIn` immediately before `primary_holder` (:85):

```python
class CreditCardIn(BaseModel):
    """POST and PATCH body — the FULL card, house full-replace style."""

    name: str = Field(min_length=1, max_length=120)
    annual_fee: Decimal = Decimal("0")
    rewards_currency: str
    point_value_cents: Decimal = Decimal("1")
    # NULL = joint. The bound mirrors account_id's: a person id is a plain int PK, and a
    # 10-digit garbage value must 422 in the parser rather than reach the FK.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    primary_holder: str | None = Field(default=None, max_length=80)
    authorized_users: str | None = Field(default=None, max_length=200)
    opened_on: date | None = None
    is_active: bool = True
    account_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    notes: str | None = Field(default=None, max_length=300)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
```

- [ ] **Step 5: Wire both enumeration sites.** In `backend/app/api/credit_cards.py`, add
`Person` to the model import (lines 10-18):

```python
from app.models import (
    Account,
    CardCredit,
    CreditCard,
    CreditLimitEvent,
    Person,
    RewardCategory,
    RewardRate,
    SpendingCategory,
)
```

Replace `_card_out` (:318-339) with:

```python
def _card_out(
    card: CreditCard, credits: list[CardCredit], events: list[CreditLimitEvent]
) -> CreditCardOut:
    return CreditCardOut(
        id=card.id,
        name=card.name,
        slug=card.slug,
        annual_fee=card.annual_fee,
        rewards_currency=card.rewards_currency,
        point_value_cents=card.point_value_cents,
        # ENUMERATION SITE 1 of 2 (the other is _validated_card_values' dict). A column
        # missing from either one is silently dropped on the wire — the audit's §3.6 hazard.
        person_id=card.person_id,
        primary_holder=card.primary_holder,
        authorized_users=card.authorized_users,
        opened_on=card.opened_on,
        is_active=card.is_active,
        account_id=card.account_id,
        notes=card.notes,
        sort_order=card.sort_order,
        credits=[CardCreditOut.model_validate(credit) for credit in credits],
        # Events arrive ascending by effective_date — the LAST one is current.
        current_limit=events[-1].limit_amount if events else None,
        limit_events=[CreditLimitEventOut.model_validate(event) for event in events],
    )
```

Replace the tail of `_validated_card_values` — the `account_id` check plus the returned dict
(:372-393) — with:

```python
    if body.account_id is not None:
        account = await db.get(Account, body.account_id)
        if account is None:
            raise HTTPException(status_code=404, detail="account not found")
        if account.group != "liability":
            raise HTTPException(
                status_code=422, detail="linked account must be in the liability group"
            )
    # 422, not 404: the net-worth router's sentence for the same mistake, and the UI renders
    # it verbatim. Checked BEFORE the write so a bad id never surfaces as asyncpg's
    # ForeignKeyViolationError inside a 500.
    if body.person_id is not None and (await db.get(Person, body.person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {body.person_id}")
    return {
        "name": body.name,
        "slug": slug,
        "annual_fee": fee,
        "rewards_currency": body.rewards_currency,
        "point_value_cents": point_value,
        # ENUMERATION SITE 2 of 2 (the other is _card_out). Both verbs share this dict, so
        # create and full-replace patch carry ownership by construction.
        "person_id": body.person_id,
        "primary_holder": body.primary_holder,
        "authorized_users": body.authorized_users,
        "opened_on": body.opened_on,
        "is_active": body.is_active,
        "account_id": body.account_id,
        "notes": body.notes,
        "sort_order": body.sort_order,
    }
```

- [ ] **Step 6: Run to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest tests/test_credit_cards_api.py tests/test_models_credit_cards.py -q
```

Expected: all green, including the two new tests.

- [ ] **Step 7: Write migration A.** Create
`backend/alembic/versions/20260828_0900_c7a2f4e91b53_credit_card_person_owner.py` with
COMPLETE content — replace `$HEAD` in `down_revision` with the revision captured in Task 0
Step 3:

```python
"""credit card person owner

`credit_cards.person_id` — a nullable FK to people where NULL means JOINT (either spouse can
hold the card). Every existing card is backfilled to the PRIMARY person, so NULL keeps
meaning exactly what it says going forward: a card the household shares, not a card whose
owner nobody recorded (2026-08-28 spec §3 item 2).

`primary_holder` and `authorized_users` are deliberately LEFT ALONE. They stop being the
ownership vocabulary but stay as informational text — the exact name embossed on the card —
and no attempt is made to parse a name out of them into `person_id`: a free-text column that
has only ever held one household's spelling of one person is not evidence.

Revision ID: c7a2f4e91b53
Revises: $HEAD
Create Date: 2026-08-28 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7a2f4e91b53"
down_revision: str | Sequence[str] | None = "$HEAD"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FOREIGN_KEY = "fk_credit_cards_person_id_people"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("credit_cards", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "credit_cards", "people", ["person_id"], ["id"], ondelete="SET NULL"
    )
    bind = op.get_bind()
    cards = bind.scalar(sa.text("SELECT count(*) FROM credit_cards"))
    if cards:
        # LOUD, not silent. The column is nullable, so an un-backfilled roster would upgrade
        # cleanly and then read as "every card is joint" the moment the owner chips land —
        # wrong money on a page whose whole new number is a per-owner comparison. A database
        # with cards but no primary person is hand-edited; it gets a sentence, not a shrug.
        primary = bind.scalar(sa.text("SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1"))
        if primary is None:
            raise RuntimeError(
                f"{cards} credit_cards rows would be left owner-less: NULL person_id means "
                "JOINT from here on, so seed the people table (app.seed.seed_people) before "
                "upgrading"
            )
    # The scalar subquery is safe: ux_people_single_primary caps the primary at one row, and
    # an EMPTY cards table with an empty roster simply updates nothing.
    op.execute(
        "UPDATE credit_cards SET person_id = "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
        "WHERE person_id IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Ownership is lost, and that is the honest outcome: nothing else on the row records it
    # (primary_holder was never written from person_id). Re-upgrading re-backfills everything
    # to the primary person, which is where this migration found them.
    op.drop_constraint(FOREIGN_KEY, "credit_cards", type_="foreignkey")
    op.drop_column("credit_cards", "person_id")
```

- [ ] **Step 8: Verify the chain is single-headed and matches the model.** Do NOT run
`alembic upgrade` — Task 8 owns that.

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic heads
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic history -r-3:
```

Expected: exactly one head, `c7a2f4e91b53`, whose parent is `$HEAD`. If two heads appear, the
`down_revision` is wrong — fix it before continuing.

- [ ] **Step 9: Full backend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest -q
```

Expected: green, count = baseline 1131 + 2.

- [ ] **Step 10: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(credit-cards): person_id owner column on cards"
```

---

### Task 2: `custom_events.person_id` — model, migration B, the shared suffix, stamped labels

**Files:**
- `backend/tests/test_calendar_events.py` (`_compose` helper :25-38; `test_custom_rows_render_and_clip` :232-247; `test_custom_rows_sort_with_computed_events` :258-273)
- `backend/tests/test_calendar_api.py` (`test_custom_event_crud_roundtrip` :237-288; append new tests at the end)
- `backend/app/services/calendar_events.py` (`CalendarEvent` :55-66, `compose` signature :80-93, payday label :207, custom loop :256-270)
- `backend/app/models/calendar.py`
- `backend/app/schemas/calendar.py` (:23-33, :39-68)
- `backend/app/api/calendar.py` (imports :15-30, custom_rows load :177-186, response map :201-213, CRUD :233-253)
- `backend/alembic/versions/20260828_0901_d3b8e05fa726_custom_event_person_owner.py` (new)

- [ ] **Step 1: Write the failing composer tests.** In
`backend/tests/test_calendar_events.py`, change the import at the top of the file to bring in
both new names (the existing line reads
`from app.services.calendar_events import PaydaySource, compose`):

```python
from app.services.calendar_events import CustomRow, PaydaySource, compose, person_suffix
```

Replace the two tuple call sites. `test_custom_rows_render_and_clip` becomes:

```python
def test_custom_rows_render_and_clip():
    events = _of_type(
        _compose(
            date(2026, 9, 1),
            date(2026, 9, 30),
            custom_rows=[
                CustomRow(7, date(2026, 9, 12), "Car insurance renewal", "policy 8841"),
                CustomRow(8, date(2026, 10, 2), "Out of range", None),
            ],
        ),
        "custom",
    )
    assert [(e.event_date, e.label, e.detail, e.href, e.event_id) for e in events] == [
        (date(2026, 9, 12), "Car insurance renewal", "policy 8841", None, 7)
    ]
    # UNTAGGED rows are byte-identical to before the person column: no suffix, no detail
    # change, and person_id rides as None.
    assert events[0].person_id is None
```

and `test_custom_rows_sort_with_computed_events`'s literal becomes:

```python
        custom_rows=[CustomRow(3, date(2026, 9, 15), "Zoo membership", None)],
```

Append this new test at the end of the file:

```python
def test_a_tagged_custom_row_wears_the_person_suffix():
    # The SAME grammar the payday chips use — one helper, so an event tagged to Sam and a
    # payday of Sam's read identically and the frontend has one shape to strip.
    events = _of_type(
        _compose(
            date(2026, 9, 1),
            date(2026, 9, 30),
            custom_rows=[
                CustomRow(9, date(2026, 9, 12), "Dentist", "cleaning", person_id=2, person_name="Sam")
            ],
        ),
        "custom",
    )
    assert [(e.label, e.detail, e.person_id) for e in events] == [
        ("Dentist — Sam", "cleaning", 2)
    ]


def test_person_suffix_is_the_one_grammar_paydays_already_use():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[
                PaydaySource(name="Me", semi_monthly=True),
                PaydaySource(name="Sam", semi_monthly=True),
            ],
        ),
        "payday",
    )
    assert {e.label for e in events} == {"Payday" + person_suffix("Me"), "Payday" + person_suffix("Sam")}
    assert person_suffix("Sam") == " — Sam"
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest tests/test_calendar_events.py -q
```

Expected: a collection error — `ImportError: cannot import name 'CustomRow'`. That is the
correct first failure.

- [ ] **Step 3: Implement the composer changes.** In
`backend/app/services/calendar_events.py`, add the suffix helper and the row dataclass, and
give `CalendarEvent` a `person_id`. Replace lines 55-78 (from `@dataclass(frozen=True)` above
`CalendarEvent` through the end of `PaydaySource`) with:

```python
def person_suffix(name: str) -> str:
    """The ONE person-tag grammar: `"<label> — <name>"`. Paydays have carried it since the
    two-income batch and tagged custom events now share the definition, so the frontend's
    strip-before-edit (`calendarView.stripPersonSuffix`) only ever has one shape to peel."""
    return f" — {name}"


@dataclass(frozen=True)
class CalendarEvent:
    """One calendar entry. `event_date`, not `date` — the DailyBar.bar_date naming
    convention (an attribute named `date` shadows the type). The WIRE field is `date`
    (schemas/calendar.py maps it)."""

    event_date: date
    type: str  # one of EVENT_TYPES
    label: str
    detail: str | None
    href: str | None  # None for custom events — no page owns them (spec §9.3)
    event_id: int | None = None  # custom rows only: the frontend's edit/delete handle
    # custom rows only, exactly like event_id: the tag the page's select seeds from, and
    # what tells the page whether `label` carries a suffix it must strip before editing.
    person_id: int | None = None


@dataclass(frozen=True)
class CustomRow:
    """One stored custom event plus the owner's NAME, resolved by the router — this module
    never reads a person row (its no-DB posture). A dataclass rather than a widening tuple:
    six positional fields at a call site is where a silent field swap lives."""

    event_id: int
    event_date: date
    label: str
    detail: str | None
    person_id: int | None = None
    person_name: str | None = None


@dataclass(frozen=True)
class PaydaySource:
    """One person's IN-FORCE paycheck profile, reduced to what the payday composer needs:
    the name that labels their chips and whether their cadence is the semi-monthly one
    this calendar can date (2026-08-27 spec §4.4). The ROUTER decides which profile is in
    force; nothing here reads a profile row."""

    name: str
    semi_monthly: bool
```

Change the `custom_rows` parameter annotation in `compose`'s signature (:90) from

```python
    custom_rows: list[tuple[int, date, str, str | None]],  # (id, event_date, label, detail)
```

to

```python
    custom_rows: list[CustomRow],
```

Replace the payday label line (:207) so the grammar has one definition:

```python
                            label="Payday" + person_suffix(source.name) if labelled else "Payday",
```

**Precedence guard:** that expression parses as
`("Payday" + person_suffix(...)) if labelled else "Payday"` — `+` binds tighter than the
conditional — and the existing payday tests pin both branches byte-for-byte, so a mistake
here fails loudly. If it reads ambiguously to you, write it with explicit parentheses.

Replace the custom-rows loop (:256-270) with:

```python
    # custom — user-entered informational rows (spec §9.3). No page owns them: href is
    # None and the id rides along so the frontend can edit/delete. The router loads only
    # rows in range; the clip keeps compose total over its inputs regardless.
    #
    # A TAGGED row's name is stamped into the LABEL, not carried beside it: the label is
    # what the grid chip, the list row and the ICS SUMMARY all render, so one stamp reaches
    # all three. person_id rides too, because the page has to strip the suffix back off
    # before it can re-save the row.
    for row in custom_rows:
        if in_range(row.event_date):
            label = (
                row.label if row.person_name is None else row.label + person_suffix(row.person_name)
            )
            events.append(
                CalendarEvent(
                    event_date=row.event_date,
                    type="custom",
                    label=label,
                    detail=row.detail,
                    href=None,
                    event_id=row.event_id,
                    person_id=row.person_id,
                )
            )
```

- [ ] **Step 4: Run the composer tests to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest tests/test_calendar_events.py -q
```

Expected: green — including every pre-existing payday and sort test, unchanged.

- [ ] **Step 5: Write the failing router tests.** In `backend/tests/test_calendar_api.py`,
add `"person_id": None` to the three exact-dict assertions inside
`test_custom_event_crud_roundtrip` — the created body, the composed custom event, and the
patched body. The replacements are:

```python
    assert body == {
        "id": event_id,
        "date": "2026-09-12",
        "label": "Car insurance renewal",
        "detail": None,
        "person_id": None,
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
            "person_id": None,
        }
    ]
```

and

```python
    assert updated.json() == {
        "id": event_id,
        "date": "2026-09-13",
        "label": "Renewal",
        "detail": "moved a day",
        "person_id": None,
    }
```

Then append these two tests at the end of the file:

```python
async def test_custom_event_person_tag_stamps_the_label(auth_client, db):
    me = Person(name="Me", is_primary=True)
    sam = Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.commit()

    created = await auth_client.post(
        f"{CALENDAR}/events",
        json={"date": "2026-09-12", "label": "Dentist", "detail": None, "person_id": sam.id},
    )
    assert created.status_code == 201, created.text
    # The STORED label is what the user typed — the suffix is composed, never persisted, so
    # a rename of Sam re-reads correctly and a re-save cannot compound it.
    assert created.json() == {
        "id": created.json()["id"],
        "date": "2026-09-12",
        "label": "Dentist",
        "detail": None,
        "person_id": sam.id,
    }
    event_id = created.json()["id"]

    listed = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    custom = [e for e in listed.json()["events"] if e["type"] == "custom"]
    assert [(e["label"], e["person_id"]) for e in custom] == [("Dentist — Sam", sam.id)]

    # Full replace: an explicit null untags the row and the label goes back to bare.
    cleared = await auth_client.patch(
        f"{CALENDAR}/events/{event_id}",
        json={"date": "2026-09-12", "label": "Dentist", "detail": None, "person_id": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["person_id"] is None
    after = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e["label"] for e in after.json()["events"] if e["type"] == "custom"] == ["Dentist"]


async def test_custom_event_person_must_exist(auth_client):
    ghost = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "ok", "person_id": 999}
    )
    assert ghost.status_code == 422
    assert ghost.json()["detail"] == "unknown person_id: 999"
```

- [ ] **Step 6: Run them and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest tests/test_calendar_api.py -q
```

Expected: the roundtrip test fails on the extra `person_id` key, both new tests fail (no such
column, no 422). Note the failure text — the router still returns 201 for `person_id: 999`
because pydantic drops the unknown key.

- [ ] **Step 7: Add the model column.** Replace
`backend/app/models/calendar.py` with COMPLETE content:

```python
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
```

- [ ] **Step 8: Add the schema fields.** In `backend/app/schemas/calendar.py`, replace
`CalendarEventOut` (:23-33) and the two custom-event schemas (:39-68) with:

```python
class CalendarEventOut(BaseModel):
    # `date: date` is safe in a pydantic body — an annotation-only statement never binds
    # the name, so the type still resolves. (The SQLAlchemy models rename to *_date
    # because mapped_column ASSIGNS; that hazard does not exist here.)
    date: date
    type: CalendarEventType
    label: str
    detail: str | None
    href: str | None  # null for custom events — they have no page (spec §9.3)
    id: int | None  # set only for custom events, the frontend's edit/delete handle
    # Set only for custom events too. `label` already carries " — <name>" when this is not
    # null; the page needs the id both to seed its select and to know there is a suffix to
    # strip before it re-saves the row.
    person_id: int | None


class CalendarOut(BaseModel):
    events: list[CalendarEventOut]


class CustomEventIn(BaseModel):
    """POST/PATCH body — full replace: the form always submits all four fields."""

    date: date
    label: str = Field(min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=300)
    # NULL = household. The bound mirrors the accounts router's: a garbage 10-digit value
    # 422s in the parser rather than reaching the FK.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)

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
    label: str  # as STORED — unstamped; the suffix is composed, never persisted
    detail: str | None
    person_id: int | None
```

- [ ] **Step 9: Wire the router.** In `backend/app/api/calendar.py`:

Add `Person` to the model import (lines 15-25):

```python
from app.models import (
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
```

Extend the services import (line 27):

```python
from app.services.calendar_events import CustomRow, PaydaySource, compose
```

Replace the `custom_rows` load (:177-186) with — note this sits AFTER `names` is built at
:160, which is where the person names come from, so no second query is added:

```python
    custom_rows = [
        CustomRow(
            event_id=row.id,
            event_date=row.event_date,
            label=row.label,
            detail=row.detail,
            person_id=row.person_id,
            # `names` was built above from load_people. A tag pointing at a person who is
            # somehow absent degrades to UNSTAMPED rather than 500ing (GET-never-rejects) —
            # the row still renders, just without its name.
            person_name=None if row.person_id is None else names.get(row.person_id),
        )
        for row in (
            await db.execute(
                select(CustomEvent)
                .where(CustomEvent.event_date >= start, CustomEvent.event_date <= end)
                .order_by(CustomEvent.event_date, CustomEvent.id)
            )
        ).scalars()
    ]
```

Replace the response mapping (:201-213) with:

```python
    return CalendarOut(
        events=[
            CalendarEventOut(
                date=event.event_date,
                type=event.type,
                label=event.label,
                detail=event.detail,
                href=event.href,
                id=event.event_id,
                person_id=event.person_id,
            )
            for event in events
        ]
    )
```

Replace `_custom_out` and the two write routes (:220-253) with:

```python
def _custom_out(row: CustomEvent) -> CustomEventOut:
    return CustomEventOut(
        id=row.id,
        date=row.event_date,
        label=row.label,
        detail=row.detail,
        person_id=row.person_id,
    )


async def _get_custom_event(db: AsyncSession, event_id: int) -> CustomEvent:
    row = (
        await db.execute(select(CustomEvent).where(CustomEvent.id == event_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="custom event not found")
    return row


async def _validated_person_id(db: AsyncSession, person_id: int | None) -> int | None:
    """422 with the net-worth router's sentence, checked before the write so a bad id never
    surfaces as asyncpg's ForeignKeyViolationError inside a 500."""
    if person_id is not None and (await db.get(Person, person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {person_id}")
    return person_id


@router.post("/events", response_model=CustomEventOut, status_code=201)
async def create_custom_event(
    body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    row = CustomEvent(
        event_date=body.date,
        label=body.label,
        detail=body.detail,
        person_id=await _validated_person_id(db, body.person_id),
    )
    db.add(row)
    await db.commit()
    return _custom_out(row)


@router.patch("/events/{event_id}", response_model=CustomEventOut)
async def update_custom_event(
    event_id: int, body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    """Full replace — the form always submits all four fields (spec §9.3). An explicit null
    person_id is how a tagged event goes back to being the household's."""
    row = await _get_custom_event(db, event_id)
    row.person_id = await _validated_person_id(db, body.person_id)
    row.event_date = body.date
    row.label = body.label
    row.detail = body.detail
    await db.commit()
    return _custom_out(row)
```

- [ ] **Step 10: Run the router tests to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest tests/test_calendar_api.py tests/test_calendar_events.py -q
```

Expected: green.

- [ ] **Step 11: Write migration B.** Create
`backend/alembic/versions/20260828_0901_d3b8e05fa726_custom_event_person_owner.py` with
COMPLETE content:

```python
"""custom event person owner

`custom_events.person_id` — a nullable FK to people where NULL means HOUSEHOLD (2026-08-28
spec §3 item 3).

NO BACKFILL, deliberately, and this is the one place in the household retrofit where that is
right: every pre-existing custom event was entered before anybody could tag it, so assigning
it to the primary person would put a name on chips the user never chose. NULL already means
exactly what those rows mean. There is therefore no zero-people guard here either — nothing
is being resolved against the roster.

Revision ID: d3b8e05fa726
Revises: c7a2f4e91b53
Create Date: 2026-08-28 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3b8e05fa726"
down_revision: str | Sequence[str] | None = "c7a2f4e91b53"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FOREIGN_KEY = "fk_custom_events_person_id_people"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("custom_events", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "custom_events", "people", ["person_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Tags are lost; the labels are not, because the suffix was only ever composed and never
    # stored (api/calendar.py's _custom_out returns the label as typed).
    op.drop_constraint(FOREIGN_KEY, "custom_events", type_="foreignkey")
    op.drop_column("custom_events", "person_id")
```

- [ ] **Step 12: Verify the chain, then the full suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic heads
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest -q
```

Expected: exactly one head, `d3b8e05fa726`; suite green at baseline 1131 + 6.

- [ ] **Step 13: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(calendar): person_id on custom events with a shared label suffix"
```

---

## Phase 2 — Cards frontend

### Task 3: Types, owner-aware math cards, `ownerMatches`, and `householdAdvantage`

**Files:**
- `src/types/api.ts` (`CreditCardOut` ≈:1461-1481, `CreditCardIn` ≈:1482-1496)
- `src/components/creditcards/rewardsMath.test.ts` (`card` factory :13-15; append new describes)
- `src/components/creditcards/rewardsMath.ts` (`MathCard` :11-18, `optimize` :200-241, `toMathCards` :245-256)

- [ ] **Step 1: Write the failing math tests.** In
`src/components/creditcards/rewardsMath.test.ts`, extend the imports:

```ts
import { describe, expect, it } from 'vitest'
import type { RewardCategoryOut, SpendingMatrix } from '../../types/api'
import {
  effectiveRate,
  householdAdvantage,
  optimize,
  ownerMatches,
  resolveWeight,
  suggestedAnnualSpend,
  type MathCard,
  type MathCategory,
  type MathRate,
} from './rewardsMath'
```

Give the `card` factory the new field (line 13-15) — `ownerId: null` is JOINT, so every
existing optimize test keeps its exact meaning:

```ts
function card(id: number, name: string, over: Partial<MathCard> = {}): MathCard {
  return {
    id, name, annualFee: 0, pointValueCents: 1, isActive: true, countedCredits: 0,
    ownerId: null, ...over,
  }
}
```

Append these two describes at the end of the file:

```ts
describe('ownerMatches', () => {
  // The net-worth grammar, reused verbatim: a PERSON's scope includes the joint rows,
  // because that is what joint means; `joint` is the NULL-only slice; null is everybody.
  it('gives a person their own cards PLUS the joint ones', () => {
    expect(ownerMatches(1, 1)).toBe(true)
    expect(ownerMatches(null, 1)).toBe(true)
    expect(ownerMatches(2, 1)).toBe(false)
  })

  it('scopes `joint` to NULL owners only, and null to everything', () => {
    expect(ownerMatches(null, 'joint')).toBe(true)
    expect(ownerMatches(1, 'joint')).toBe(false)
    expect(ownerMatches(1, null)).toBe(true)
    expect(ownerMatches(null, null)).toBe(true)
  })
})

describe('householdAdvantage', () => {
  // HAND-CHECKABLE fixture. Two $10,000 categories, no fees, no credits, 1¢ points:
  //   Alice's A  3x Groceries -> 3% of 10,000 = 300
  //   Bob's   B  3x Dining    -> 300
  //   JOINT   J  2x on BOTH   -> 200 per category
  // household {A,B,J}: 300 + 300 = 600
  // Alice {A,J}:       300 + 200 = 500      Bob {B,J}: 200 + 300 = 500
  // advantage = 600 - 500 = 100
  const A = card(1, 'A card', { ownerId: 1 })
  const B = card(2, 'B card', { ownerId: 2 })
  const J = card(3, 'Joint card', { ownerId: null })
  const CATS = [category(10, 'Groceries', { weight: 10000 }), category(11, 'Dining', { weight: 10000 })]
  const RATES = [rate(1, 10, 3), rate(2, 11, 3), rate(3, 10, 2), rate(3, 11, 2)]

  it('prices the joint card into BOTH single-owner wallets', () => {
    expect(householdAdvantage([A, B, J], CATS, RATES)).toBeCloseTo(100)
  })

  it('would read 300 if joint cards were excluded — the rule is pinned, not incidental', () => {
    // Same fixture minus the joint card: each wallet earns only its own category.
    expect(householdAdvantage([A, B], CATS, RATES)).toBeCloseTo(300)
  })

  it('is null when fewer than two people hold active cards', () => {
    expect(householdAdvantage([A, J], CATS, RATES)).toBeNull()
    // An ARCHIVED card of Bob's does not conjure a second owner.
    const archivedB = card(4, 'Old B', { ownerId: 2, isActive: false })
    expect(householdAdvantage([A, J, archivedB], CATS, RATES)).toBeNull()
  })

  it('is null when merging does not win — fees can make the delta negative', () => {
    // Bob's card carries a $600 fee and wins one category worth $300. The household pays
    // that fee; Alice's own wallet does not, so merging LOSES money and the tile hides
    // rather than printing a negative or a zero.
    const pricey = card(2, 'B card', { ownerId: 2, annualFee: 600 })
    expect(householdAdvantage([A, pricey, J], CATS, RATES)).toBeNull()
  })

  it('ignores cards nobody could use — an empty rate set has no advantage', () => {
    expect(householdAdvantage([A, B, J], CATS, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/creditcards/rewardsMath.test.ts
```

Expected: failure — `householdAdvantage`/`ownerMatches` are not exported, and TypeScript
flags `ownerId` as an unknown property on `MathCard`.

- [ ] **Step 3: Add the wire fields.** In `src/types/api.ts`, add `person_id` to both card
shapes, immediately before `primary_holder` in each:

```ts
export interface CreditCardOut {
  id: number
  name: string
  slug: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  point_value_cents: string
  /** Owner; null = JOINT (either spouse can hold the card). Never "unknown": the migration
   *  backfilled every pre-existing card to the primary person. */
  person_id: number | null
  primary_holder: string | null
  authorized_users: string | null
  opened_on: string | null
  is_active: boolean
  account_id: number | null
  notes: string | null
  sort_order: number
  credits: CardCreditOut[]
  /** Latest limit event's amount; null when no events yet. */
  current_limit: string | null
  limit_events: CreditLimitEventOut[]
}

/** POST and PATCH body — full object, house style. */
export interface CreditCardIn {
  name: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  point_value_cents: string
  person_id: number | null
  primary_holder: string | null
  authorized_users: string | null
  opened_on: string | null
  is_active: boolean
  account_id: number | null
  notes: string | null
  sort_order: number
}
```

- [ ] **Step 4: Implement the math.** In `src/components/creditcards/rewardsMath.ts`, extend
the import block at the top:

```ts
import type { OwnerScope } from '../../api/netWorth'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  SpendingMatrix,
} from '../../types/api'
```

Add `ownerId` to `MathCard` (:11-18):

```ts
export interface MathCard {
  id: number
  name: string
  annualFee: number
  pointValueCents: number
  isActive: boolean
  countedCredits: number
  /** Owner; null = JOINT. Only householdAdvantage reads it — optimize() is owner-blind by
   *  design, because the whole lineup is what the matrix is answering about. */
  ownerId: number | null
}
```

Replace `optimize` (:200-241) so the lineup-net formula has ONE definition, then append the
two new exports right after it:

```ts
/** The lineup's net: what the whole set earns, plus what its credits are worth, minus every
 *  annual fee in it. ONE definition — optimize()'s KPI and householdAdvantage's two sides
 *  must be priced identically or the difference between them means nothing. */
function netOf(actives: MathCard[], optimalTotal: number): number {
  return (
    optimalTotal +
    actives.reduce((acc, c) => acc + c.countedCredits, 0) -
    actives.reduce((acc, c) => acc + c.annualFee, 0)
  )
}

export function optimize(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
): OptimizerResult {
  const actives = cards.filter((c) => c.isActive)
  const verdicts = computeVerdicts(actives, categories, rates)
  const optimalTotal = totalOf(verdicts)

  const cardEarnings = new Map<number, number>()
  for (const card of actives) cardEarnings.set(card.id, 0)
  for (const v of verdicts.values())
    for (const a of v.allocations)
      cardEarnings.set(a.cardId, (cardEarnings.get(a.cardId) ?? 0) + a.earnings)

  const cardValues: CardValue[] = actives.map((card) => {
    const without = computeVerdicts(
      actives.filter((c) => c.id !== card.id),
      categories,
      rates,
    )
    const marginal = optimalTotal - totalOf(without)
    const wonCategoryIds = [...verdicts.values()]
      .filter((v) => v.primaryCardId === card.id)
      .map((v) => v.categoryId)
    return {
      cardId: card.id,
      marginal,
      countedCredits: card.countedCredits,
      annualFee: card.annualFee,
      net: marginal + card.countedCredits - card.annualFee,
      wonCategoryIds,
    }
  })

  return { verdicts, cardEarnings, cardValues, optimalTotal, lineupNet: netOf(actives, optimalTotal) }
}

/** Owner-scope membership, the net-worth grammar verbatim: absent (null) is the whole
 *  household, a person id is THEIR cards plus the JOINT ones — either spouse can hold a
 *  joint card — and 'joint' is the NULL-owned slice alone. */
export function ownerMatches(personId: number | null, scope: OwnerScope): boolean {
  if (scope === null) return true
  if (scope === 'joint') return personId === null
  return personId === scope || personId === null
}

/**
 * "Merging our wallets is worth $X/yr": the household lineup's net minus the BEST single
 * owner's, where a single-owner wallet is that person's active cards ∪ the joint ones.
 *
 * Returns null — the tile is absent, never zero — when there is nothing honest to say:
 * fewer than two distinct non-joint owners hold active cards (one person owning everything
 * has no merge to price), or the delta is not positive. The delta really can be negative:
 * lineup net subtracts EVERY fee in the wallet, so a partner's high-fee card that wins no
 * category costs the household more than it costs the other spouse's wallet.
 *
 * Cost is `1 + owners` verdict passes, not `1 + owners` optimizations — nothing here needs
 * the per-card marginal loop that dominates optimize().
 */
export function householdAdvantage(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
): number | null {
  const actives = cards.filter((c) => c.isActive)
  const owners = [...new Set(actives.map((c) => c.ownerId).filter((id) => id !== null))]
  if (owners.length < 2) return null
  const netFor = (wallet: MathCard[]): number =>
    netOf(wallet, totalOf(computeVerdicts(wallet, categories, rates)))
  const household = netFor(actives)
  const best = Math.max(
    ...owners.map((owner) =>
      netFor(actives.filter((c) => c.ownerId === owner || c.ownerId === null)),
    ),
  )
  const delta = household - best
  // TIE_EPSILON, not > 0: float dust from three independent sums must not render as
  // "$0/yr" under a headline that claims the household wins.
  return delta > TIE_EPSILON ? delta : null
}
```

Carry the owner through the wire adapter (:245-256):

```ts
export function toMathCards(cards: CreditCardOut[]): MathCard[] {
  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    annualFee: Number(c.annual_fee),
    pointValueCents: Number(c.point_value_cents),
    isActive: c.is_active,
    ownerId: c.person_id,
    countedCredits: c.credits
      .filter((credit) => credit.counts)
      .reduce((acc, credit) => acc + Number(credit.annual_value), 0),
  }))
}
```

- [ ] **Step 5: Run to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/creditcards/rewardsMath.test.ts
```

Expected: green, including every pre-existing optimize test unchanged.

- [ ] **Step 6: Typecheck** (the page and its test still build fixtures without `person_id`,
so expect errors there — they are Tasks 4 and 5's job; record them and continue).

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
```

Expected: errors ONLY in `src/pages/CreditCardsPage.test.tsx` (fixtures missing
`person_id`). If anything else errors, fix it before committing.

- [ ] **Step 7: Commit** (the fixture errors are resolved in Task 4; commit the math layer
now so the two frontend tasks stay reviewable).

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(credit-cards): owner-aware math cards, ownerMatches, householdAdvantage"
```

---

### Task 4: `CardsPanel` — person select, Owner column, and the two verbatim rebuilds

**Files:**
- `src/pages/CreditCardsPage.test.tsx` (mocks :13-34, fixtures :78-105, `snapshotFixture` :175-185)
- `src/components/creditcards/CardsPanel.tsx` (form state :20-35, props :47-55, `startEdit` :73-88, `buildBody` :92-141, `toggleArchive` :172-194, `remove`/Undo :196-256, form markup :323-330, table :394-465)
- `src/pages/CreditCardsPage.tsx` (the `<CardsPanel />` mount at :304 — pass the roster through)

- [ ] **Step 1: Write the failing tests.** In `src/pages/CreditCardsPage.test.tsx`:

Add the household mock next to the others (after the `../api/netWorth` mock, ≈:34):

```ts
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
```

and extend the value imports (after the `../api/spending` import, ≈:71):

```ts
import { fetchHousehold } from '../api/household'
```

Give the three card fixtures an owner. Replace `person_id`-less literals as follows —
`vx()` (:78-89) gains `person_id: 1,` right after `is_active: true, account_id: null,`;
`SAVOR` (:93-99) gains `person_id: 1,`; `RH` (:101-106) gains `person_id: 2,`:

```ts
function vx(over: Partial<CreditCardOut> = {}): CreditCardOut {
  return {
    id: 1, name: 'Venture X', slug: 'venture-x', annual_fee: '395.00',
    rewards_currency: 'miles', point_value_cents: '1.7000', primary_holder: 'Ed',
    authorized_users: 'P2', opened_on: '2023-05-12', is_active: true, account_id: null,
    person_id: 1, notes: null, sort_order: 0,
    credits: [{ id: 11, label: '$300 travel credit', annual_value: '300.00', counts: true }],
    current_limit: '30000.00',
    limit_events: [
      { id: 21, effective_date: '2023-05-12', limit_amount: '20000.00', note: 'opened' },
      { id: 22, effective_date: '2026-01-15', limit_amount: '30000.00', note: null },
    ],
    ...over,
  }
}

const SAVOR: CreditCardOut = {
  id: 2, name: 'SavorOne', slug: 'savorone', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', primary_holder: 'Ed', authorized_users: null, opened_on: null,
  is_active: true, account_id: null, person_id: 1, notes: null, sort_order: 1, credits: [],
  current_limit: '10000.00',
  limit_events: [{ id: 23, effective_date: '2024-02-01', limit_amount: '10000.00', note: null }],
}

const RH: CreditCardOut = {
  id: 3, name: 'RH Gold', slug: 'rh-gold', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', primary_holder: 'Ed', authorized_users: null, opened_on: null,
  is_active: true, account_id: null, person_id: 2, notes: null, sort_order: 2, credits: [],
  current_limit: null, limit_events: [],
}
```

Add the roster to `seedHappyPath` (the two-person household is what the chips and badges
need; the single-person case gets its own test in Task 5):

```ts
const PEOPLE = [
  { id: 1, name: 'Ed', is_primary: true },
  { id: 2, name: 'Sam', is_primary: false },
]

function seedHappyPath() {
  vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, RH])
  vi.mocked(fetchRewardCategories).mockResolvedValue(CATEGORIES)
  vi.mocked(fetchRewardRates).mockResolvedValue(RATES)
  vi.mocked(fetchCategories).mockResolvedValue([])
  vi.mocked(fetchMatrix).mockResolvedValue(EMPTY_MATRIX)
  vi.mocked(fetchAccounts).mockResolvedValue([])
  vi.mocked(fetchHousehold).mockResolvedValue({ people: PEOPLE, marriage_date: null })
  vi.mocked(fetchSummary).mockResolvedValue({
    month: null, net_worth: null, mom_delta: null, mom_pct: null, groups: [], owner_totals: [],
  })
  vi.mocked(fetchMonthBalances).mockResolvedValue({
    month: '2026-08-01', exists: false, recorded_on: null, notes: null, balances: [],
  })
}
```

Append this describe at the end of the file:

```ts
describe('CreditCardsPage — card ownership', () => {
  it('shows the owner per row and defaults a NEW card to the primary person', async () => {
    renderPage()
    await screen.findByText('Card roster')
    const roster = document.querySelector('.roster-table') as HTMLElement
    const owners = Array.from(roster.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td')[1].textContent,
    )
    expect(owners).toEqual(['Ed', 'Ed', 'Sam'])
    // The fresh form follows the roster once /household lands — Joint must be a CHOICE.
    const select = screen.getByLabelText('Owner') as HTMLSelectElement
    expect(select.value).toBe('1')
  })

  it('sends person_id on create and leaves primary_holder alone', async () => {
    vi.mocked(createCreditCard).mockResolvedValue(vx())
    renderPage()
    await screen.findByText('Card roster')
    fireEvent.change(screen.getByLabelText('Card name'), { target: { value: 'Blue Cash' } })
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    await waitFor(() => expect(createCreditCard).toHaveBeenCalled())
    const body = vi.mocked(createCreditCard).mock.calls[0][0]
    expect(body.person_id).toBe(2)
    // The form has no holder box any more; a new card simply has no embossed name yet.
    expect(body.primary_holder).toBeNull()
  })

  it('ARCHIVE rebuilds the whole card verbatim — person_id must survive', async () => {
    vi.mocked(updateCreditCard).mockResolvedValue(RH)
    renderPage()
    await screen.findByText('Card roster')
    fireEvent.click(screen.getByRole('button', { name: 'Archive RH Gold' }))
    await waitFor(() => expect(updateCreditCard).toHaveBeenCalled())
    const [id, body] = vi.mocked(updateCreditCard).mock.calls[0]
    expect(id).toBe(3)
    expect(body.is_active).toBe(false)
    // The audit's §3.6 hazard, pinned: a column missing from this rebuild silently CLEARS
    // — and a cleared person_id reads as "joint", which is a different card.
    expect(body.person_id).toBe(2)
    expect(body.primary_holder).toBe('Ed')
  })

  it('UNDO after delete re-POSTs the card verbatim — person_id must survive', async () => {
    vi.mocked(deleteCreditCard).mockResolvedValue(undefined)
    vi.mocked(createCreditCard).mockResolvedValue(RH)
    render(
      <MemoryRouter initialEntries={['/credit-cards']}>
        <ToastProvider>
          <CreditCardsPage />
        </ToastProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Card roster')
    fireEvent.click(screen.getByRole('button', { name: 'Delete RH Gold' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    fireEvent.click(undo)
    await waitFor(() => expect(createCreditCard).toHaveBeenCalled())
    expect(vi.mocked(createCreditCard).mock.calls[0][0].person_id).toBe(2)
  })
})
```

Add the two imports this describe needs, at the top of the file with the others:

```ts
import ToastProvider from '../components/ToastProvider'
```

and extend the `../api/creditCards` value import with `deleteCreditCard`:

```ts
import {
  createCreditCard,
  deleteCreditCard,
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
  updateCardCredit,
  updateCreditCard,
  updateRewardCategory,
} from '../api/creditCards'
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/CreditCardsPage.test.tsx
```

Expected: the four new tests fail (`Unable to find a label 'Owner'`; the archive/Undo bodies
have no `person_id`; the roster's second column is still the free-text holder).

- [ ] **Step 3: Implement `CardsPanel`.** In `src/components/creditcards/CardsPanel.tsx`:

Extend the type import (line 13):

```ts
import type {
  AccountOut,
  CreditCardIn,
  CreditCardOut,
  PersonOut,
  RewardsCurrency,
} from '../../types/api'
```

Replace the form-state block (lines 20-35) with:

```ts
interface CardFormState {
  name: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  /** '' = Joint; OWNER_UNSET = untouched, so a fresh form FOLLOWS the primary person. */
  person_id: string
  point_value_cents: string
  authorized_users: string
  opened_on: string
  account_id: string // '' = none; select values are strings
  notes: string
}

// A fresh form's owner box has not been chosen yet and must default to the primary person
// once /household lands — but '' is a REAL value here (Joint), so "not chosen" needs its
// own token. Without it a slow roster fetch would silently make every new card joint.
const OWNER_UNSET = 'unset'

const EMPTY_CARD: CardFormState = {
  name: '', annual_fee: '', rewards_currency: 'cash', person_id: OWNER_UNSET,
  point_value_cents: '', authorized_users: '', opened_on: '', account_id: '', notes: '',
}
```

Replace the component signature and the derived lookups (lines 47-71) with:

```ts
export default function CardsPanel({
  cards,
  accounts,
  people,
  onChanged,
}: {
  cards: CreditCardOut[]
  accounts: AccountOut[]
  /** Primary first, then by id — the page's ordering, so the select reads like the chips. */
  people: PersonOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<CardFormState>(EMPTY_CARD)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // A card is paid from a LIABILITY account and nothing else — offering the cash and
  // taxable accounts would only be a way to link the wrong row.
  const liabilityAccounts = accounts.filter((a) => a.group === 'liability')
  // Every account, not just the liability ones: an archived or regrouped account is still
  // the name the stored account_id points at, and the table must not blank it out.
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  // The migration backfilled every existing card to the primary person, so that is what a
  // new one means too until the user says otherwise.
  const defaultOwner = people.find((p) => p.is_primary)
  const ownerValue =
    form.person_id === OWNER_UNSET
      ? defaultOwner === undefined
        ? ''
        : String(defaultOwner.id)
      : form.person_id

  const set = (field: keyof CardFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))
```

Replace `startEdit` (lines 73-88) with:

```ts
  const startEdit = (card: CreditCardOut) => {
    setEditingId(card.id)
    // The server's own quantized strings, verbatim: nothing is reformatted on the way into
    // a box whose contents are about to be sent straight back.
    setForm({
      name: card.name,
      annual_fee: card.annual_fee,
      rewards_currency: card.rewards_currency,
      person_id: card.person_id === null ? '' : String(card.person_id),
      point_value_cents: card.point_value_cents,
      authorized_users: card.authorized_users ?? '',
      opened_on: card.opened_on ?? '',
      account_id: card.account_id === null ? '' : String(card.account_id),
      notes: card.notes ?? '',
    })
  }
```

Replace the returned body inside `buildBody` (lines 118-141) with:

```ts
    return {
      name,
      // The wire belt: blur usually canonicalized already, but a submit reached without one
      // (a mouse user who types and clicks Save) must not ship "$95" to a Decimal column.
      // Expressionless throughout, matching the boxes themselves.
      annual_fee: fee === '' ? '0' : canonicalAmount(fee, { expressions: false }),
      rewards_currency: form.rewards_currency,
      // A blank point value means "a point is a cent" — the cash-back identity, and the
      // only default that leaves a plain cashback card's math unchanged.
      point_value_cents:
        pointValue === '' ? '1' : canonicalAmount(pointValue, { expressions: false }),
      person_id: ownerValue === '' ? null : Number(ownerValue),
      // The embossed name is INFORMATIONAL and this form no longer edits it (person_id is
      // the ownership vocabulary now) — so it comes from the STORED row, exactly like
      // is_active and sort_order, and a new card simply has none yet.
      primary_holder: stored?.primary_holder ?? null,
      authorized_users: form.authorized_users.trim() || null,
      opened_on: form.opened_on || null,
      // The two columns this form has no box for. On a full-replace PATCH an omitted or
      // guessed value would silently unarchive a card, or shuffle the roster's order, on
      // every unrelated edit — so they come from the STORED row and only Archive moves
      // is_active.
      is_active: stored?.is_active ?? true,
      account_id: form.account_id === '' ? null : Number(form.account_id),
      notes: form.notes.trim() || null,
      sort_order: stored?.sort_order ?? 0,
    }
```

Replace the `updateCreditCard` call inside `toggleArchive` (lines 178-190) with:

```ts
    updateCreditCard(card.id, {
      name: card.name,
      annual_fee: card.annual_fee,
      rewards_currency: card.rewards_currency,
      point_value_cents: card.point_value_cents,
      // VERBATIM REBUILD 1 of 2. Every nullable column must be listed: this is a
      // full-replace PATCH, so a column omitted here is CLEARED, and a cleared person_id
      // silently turns the card joint (2026-08-26 audit §3.6).
      person_id: card.person_id,
      primary_holder: card.primary_holder,
      authorized_users: card.authorized_users,
      opened_on: card.opened_on,
      is_active: !card.is_active,
      account_id: card.account_id,
      notes: card.notes,
      sort_order: card.sort_order,
    })
```

Replace the `createCreditCard` call inside the Undo action (lines 217-229) with:

```ts
              createCreditCard({
                name: card.name,
                annual_fee: card.annual_fee,
                rewards_currency: card.rewards_currency,
                point_value_cents: card.point_value_cents,
                // VERBATIM REBUILD 2 of 2 — same hazard as toggleArchive's.
                person_id: card.person_id,
                primary_holder: card.primary_holder,
                authorized_users: card.authorized_users,
                opened_on: card.opened_on,
                is_active: card.is_active,
                account_id: card.account_id,
                notes: card.notes,
                sort_order: card.sort_order,
              })
```

Replace the "Primary holder" form field (lines 323-330) with the owner select — the option
order mirrors Settings → Accounts (Joint first, then the roster):

```tsx
        <label>
          Owner
          <select
            className="field-input"
            value={ownerValue}
            onChange={(e) => set('person_id')(e.target.value)}
          >
            <option value="">Joint</option>
            {people.map((person) => (
              <option key={person.id} value={String(person.id)}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
```

Add the Owner column to the table. In the header (lines 396-405) insert `<th>Owner</th>`
after `<th>Card</th>`:

```tsx
          <thead>
            <tr>
              <th>Card</th>
              <th>Owner</th>
              <th>Holder</th>
              <th>Auth. users</th>
              <th>Opened</th>
              <th className="num">Limit</th>
              <th>Linked account</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
```

and in the body insert the matching cell immediately after the name cell (after line 418,
before `<td>{card.primary_holder ?? '—'}</td>`):

```tsx
                {/* NULL is JOINT, never "unknown": the migration backfilled every
                    pre-existing card to the primary person. `Holder` beside it is the
                    embossed name — informational, and no longer editable here. */}
                <td>
                  {card.person_id === null ? 'Joint' : (ownerName.get(card.person_id) ?? '—')}
                </td>
```

- [ ] **Step 4: Pass the roster in.** In `src/pages/CreditCardsPage.tsx` this task only wires
the prop; Task 5 adds the fetch. Add the state and effect now so the panel compiles, placed
immediately after the `fromCache` state (≈:74):

```ts
  // The roster rides its OWN fetch, outside the six-call snapshot: it changes once a year,
  // and folding it into the snapshot would invalidate every cached cards payload
  // (NetWorthPage's fetchHousehold pattern). A failure degrades to no roster — the owner
  // select then offers Joint alone and the chips do not render.
  const [people, setPeople] = useState<PersonOut[]>([])
  useEffect(() => {
    fetchHousehold()
      .then((data) => setPeople(data.people))
      .catch(() => setPeople([]))
  }, [])
  const orderedPeople = useMemo(
    () => [...people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id),
    [people],
  )
```

Add the imports it needs — `fetchHousehold` beside the other API imports (≈:10) and
`PersonOut` in the type import (≈:30-38):

```ts
import { fetchHousehold } from '../api/household'
```

```ts
import type {
  AccountOut,
  CategoryOut,
  CreditCardOut,
  PersonOut,
  RewardCategoryOut,
  RewardRateOut,
  RewardRatePut,
  SpendingMatrix,
} from '../types/api'
```

and change the mount (:304) to pass it:

```tsx
            {cards !== null && (
              <CardsPanel
                cards={cards}
                accounts={accounts}
                people={orderedPeople}
                onChanged={load}
              />
            )}
```

- [ ] **Step 5: Run to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/CreditCardsPage.test.tsx
```

Expected: green, including every pre-existing test on the page.

- [ ] **Step 6: Typecheck and lint.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && npm run lint
```

Expected: clean.

- [ ] **Step 7: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(credit-cards): person select on the roster form, owner-safe archive and undo"
```

---

### Task 5: Page owner chips, matrix badges, and the household-advantage tile

**Files:**
- `src/pages/CreditCardsPage.test.tsx` (append a describe)
- `src/pages/CreditCardsPage.tsx` (memos :137-234, KPI row :278-301, chips mount ≈:277)
- `src/pages/CreditCardsPage.css`
- `src/components/creditcards/RewardsMatrix.tsx` (props :40-58, header :217-234)

- [ ] **Step 1: Write the failing tests.** Append this describe to
`src/pages/CreditCardsPage.test.tsx`:

```ts
describe('CreditCardsPage — owner chips and the household advantage', () => {
  it('scopes the roster, the matrix, the KPIs and the credit line to the chosen owner', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    // All: three cards in the matrix header, and the KPI count agrees.
    expect(screen.getByRole('button', { name: 'Open RH Gold details' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Sam' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open SavorOne details' })).toBeNull(),
    )
    // Sam's scope = Sam's cards ∪ the joint ones. Nothing here is joint, so only RH Gold.
    expect(screen.getByRole('button', { name: 'Open RH Gold details' })).toBeTruthy()
    const activeTile = screen
      .getAllByText('Active cards')[0]
      .closest('.stat-tile') as HTMLElement
    expect(activeTile.querySelector('.stat-value')?.textContent).toBe('1')
    // The credit-line chart only has series for cards in scope (RH Gold has no events at
    // all, so the card falls back to its empty note).
    expect(screen.getByText(/No limit history yet/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open RH Gold details' })).toBeNull(),
    )
  })

  it('hides the chips entirely for a one-person household', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue({
      people: [{ id: 1, name: 'Ed', is_primary: true }],
      marriage_date: null,
    })
    renderPage()
    await screen.findByText('Card roster')
    expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  })

  it('badges each matrix column with its owner', async () => {
    renderPage()
    const header = await screen.findByRole('button', { name: 'Open RH Gold details' })
    expect(header.textContent).toContain('Sam')
    const joint = await screen.findByRole('button', { name: 'Open Venture X details' })
    expect(joint.textContent).toContain('Ed')
  })

  it('shows the advantage tile only when merging genuinely wins', async () => {
    renderPage()
    await screen.findByText('Card roster')
    // The fixture: Ed holds VX + SavorOne, Sam holds RH Gold (3x Dining, no fee). Ed alone
    // already wins Dining with SavorOne's 3x, so RH Gold adds nothing — no tile.
    expect(screen.queryByText('Household wallet advantage')).toBeNull()

    cleanup()
    // Give Sam a card that wins a category nobody else can: 5x Groceries at 1¢ = 5%.
    const winner: CreditCardOut = { ...RH, id: 4, name: 'Sam Grocery', slug: 'sam-grocery' }
    vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, winner])
    vi.mocked(fetchRewardRates).mockResolvedValue([
      ...RATES,
      { id: 36, card_id: 4, category_id: 10, multiplier: '5.00', note: null, monthly_cap: null },
    ])
    renderPage()
    await screen.findByText('Card roster')
    const tile = (await screen.findByText('Household wallet advantage')).closest(
      '.stat-tile',
    ) as HTMLElement
    // Groceries weight 7,800: household takes 5% (390) vs Ed's best 3.4% (265.20) —
    // the merge is worth 390 − 265.20 = $124.80/yr.
    expect(tile.querySelector('.stat-value')?.textContent).toBe('$124.80/yr')
    expect(tile.textContent).toContain('beats the best single wallet')
  })
})
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/CreditCardsPage.test.tsx
```

Expected: the four new tests fail — no chips group, no owner text in the matrix headers, no
advantage tile.

**If the $124.80 figure does not match**, recompute it from the fixture rather than editing
the implementation: Groceries weight is `7800.00` and Dining `6000.00` in `CATEGORIES`, VX is
2x @ 1.7¢ (3.4%), SavorOne 3x @ 1¢, RH/Sam Grocery 1¢. Household best on Groceries is 5% ×
7800 = 390; Ed's wallet best is 3.4% × 7800 = 265.20; Dining is 3% × 6000 = 180 for both, and
credits (+300) and fees (−395) are identical on both sides because Sam's card has neither.
Write down the arithmetic in the test comment and use the number it gives.

**Adapt the selectors to the file's conventions.** The credit-line assertion above
(`No limit history yet`) depends on the page having finished loading; if it proves timing-
sensitive, replace it with the assertion the neighbouring credit-line tests already use
(`data-series-names` on the `echart` stub) rather than adding a wait to the component.

- [ ] **Step 3: Implement the page.** In `src/pages/CreditCardsPage.tsx`:

Extend the imports:

```ts
import type { OwnerScope } from '../api/netWorth'
```

```ts
import {
  householdAdvantage,
  optimize,
  ownerMatches,
  resolveWeight,
  suggestedAnnualSpend,
  toMathCards,
  toMathCategories,
  toMathRates,
} from '../components/creditcards/rewardsMath'
```

Add the scope state beside `fromCache` (≈:74):

```ts
  // null = the whole household, and that scope is byte-identical to the pre-ownership page.
  const [owner, setOwner] = useState<OwnerScope>(null)
```

Replace the memo block from `activeCards` through `result` (lines 137-166) with — note
`activeCard` MOVES ABOVE the card sets, because they now depend on it:

```ts
  const activeCategories = useMemo(
    () => (categories ?? []).filter((c) => c.is_active),
    [categories],
  )

  const activeCard = useMemo(
    () => (cardParam === null ? null : ((cards ?? []).find((c) => c.slug === cardParam) ?? null)),
    [cards, cardParam],
  )

  const householdCards = useMemo(() => (cards ?? []).filter((c) => c.is_active), [cards])
  const scopedCards = useMemo(
    () => householdCards.filter((c) => ownerMatches(c.person_id, owner)),
    [householdCards, owner],
  )
  // ONE filter point for the whole page: the roster table, the matrix, the four KPI tiles,
  // the card-value bars and the credit-line history all read this or a memo derived from it.
  //
  // The DRILL opts out on purpose. It renders INSTEAD of the grid and the chips, so a person
  // chip left active must not make another owner's card fall out of the optimizer — the only
  // other reason a card has no value is that it is archived, and the detail says exactly
  // that in words.
  const activeCards = activeCard === null ? scopedCards : householdCards

  const suggested = useMemo(
    () => (matrix ? suggestedAnnualSpend(matrix) : new Map<number, number>()),
    [matrix],
  )
  const weights = useMemo(() => {
    const out = new Map<number, number | null>()
    for (const category of categories ?? []) out.set(category.id, resolveWeight(category, suggested))
    return out
  }, [categories, suggested])

  const result = useMemo(
    () =>
      optimize(
        toMathCards(activeCards),
        toMathCategories(categories ?? [], weights),
        toMathRates(rates ?? []),
      ),
    [activeCards, categories, rates, weights],
  )

  // Scope-INDEPENDENT by design: "is merging our wallets worth it" is a household question,
  // and the answer must not change because a chip is filtering the table below it.
  const advantage = useMemo(
    () =>
      householdAdvantage(
        toMathCards(householdCards),
        toMathCategories(categories ?? [], weights),
        toMathRates(rates ?? []),
      ),
    [householdCards, categories, rates, weights],
  )

  const ownerNames = useMemo(
    () => new Map(orderedPeople.map((p) => [p.id, p.name])),
    [orderedPeople],
  )
  // One person means there is nothing to choose between: no chips (NetWorthPage's rule).
  const ownerScopes: { scope: OwnerScope; label: string }[] =
    orderedPeople.length > 1
      ? [
          { scope: null, label: 'All' },
          ...orderedPeople.map((p) => ({ scope: p.id as OwnerScope, label: p.name })),
          { scope: 'joint' as OwnerScope, label: 'Joint' },
        ]
      : []
```

Delete the now-duplicated `activeCard` memo that used to sit at lines 163-166.

Add the chips row and the tile. Replace the opening of the non-drill branch (lines 276-301)
with:

```tsx
      ) : (
        <>
          {ownerScopes.length > 0 && (
            <div className="cards-owner-row">
              <span className="eyebrow">Whose card</span>
              <div className="segmented" role="group" aria-label="Owner">
                {ownerScopes.map(({ scope, label }) => (
                  <button
                    key={label}
                    type="button"
                    className={owner === scope ? 'active' : ''}
                    aria-pressed={owner === scope}
                    onClick={() => setOwner(scope)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <InfoHint text="A person's view is their own cards plus the joint ones — either of you can hold a joint card. Joint shows only the shared cards. The roster, the matrix, the tiles and the credit-line chart all follow this." />
            </div>
          )}

          {kpis && (
            <div className="kpi-row">
              <StatTile
                label="Total credit line"
                value={formatCurrency(kpis.totalLine)}
                hint="Sum of every active card's current limit."
              />
              <StatTile
                label="Optimal rewards (est.)"
                value={`${formatCurrency(kpis.optimal)}/yr`}
                hint="What the whole lineup earns per year if every weighted category goes on its best card. An estimate from your spend weights — actual card usage isn't tracked."
              />
              <StatTile
                label="Net after fees (est.)"
                value={`${formatCurrency(kpis.net)}/yr`}
                hint="Optimal rewards plus counted credits minus annual fees, across active cards."
              />
              <StatTile
                label="Active cards"
                value={String(kpis.count)}
                hint="Archived cards keep their history but sit outside the matrix and the math."
              />
              {/* ABSENT rather than zero when it has nothing honest to say (spec §6): one
                  person owning every card has no merge to price, and fees can make the
                  merge genuinely lose. */}
              {advantage !== null && (
                <StatTile
                  label="Household wallet advantage"
                  value={`${formatCurrency(advantage)}/yr`}
                  delta="beats the best single wallet"
                  tone="positive"
                  hint="Both wallets are priced the same way — optimal rewards plus counted credits minus every annual fee in that wallet — and a single-owner wallet is that person's cards PLUS the joint ones, because either of you can hold a joint card. Hidden when only one person holds cards, or when merging doesn't win."
                />
              )}
            </div>
          )}
```

Pass the badge map to the matrix (:317-326):

```tsx
            {activeCards.length > 0 && activeCategories.length > 0 ? (
              <RewardsMatrix
                cards={activeCards}
                categories={activeCategories}
                rates={rates ?? []}
                result={result}
                weights={weights}
                ownerNames={ownerNames}
                busy={busy}
                onCardClick={(card) => setCardParam(card.slug)}
                onSaveRates={saveRates}
              />
            ) : (
```

- [ ] **Step 4: Implement the matrix badge.** In
`src/components/creditcards/RewardsMatrix.tsx`, add the prop (lines 40-58):

```tsx
export default function RewardsMatrix({
  cards,
  categories,
  rates,
  result,
  weights,
  ownerNames,
  busy,
  onCardClick,
  onSaveRates,
}: {
  cards: CreditCardOut[] // ACTIVE cards, page-sorted
  categories: RewardCategoryOut[] // ACTIVE categories, page-sorted
  rates: RewardRateOut[]
  result: OptimizerResult
  weights: Map<number, number | null>
  /** id -> name for the whole roster. SIZE is the gate: a one-person household has nobody
   *  to tell apart, so no badge is drawn at all. */
  ownerNames: Map<number, string>
  busy: boolean
  onCardClick: (card: CreditCardOut) => void
  onSaveRates: (puts: RewardRatePut[]) => Promise<void>
}) {
```

and the badge inside the column-header button (lines 217-234):

```tsx
              {cards.map((card) => (
                <th key={card.id} className="num">
                  <button
                    type="button"
                    id={`card-col-${card.id}`}
                    className="matrix-card-btn"
                    aria-label={`Open ${card.name} details`}
                    onClick={() => onCardClick(card)}
                  >
                    {card.name}
                    <span className="sub">
                      {formatCurrency(card.annual_fee)} · {card.rewards_currency}
                      {Number(card.point_value_cents) !== 1 &&
                        ` ${Number(card.point_value_cents)}¢`}
                    </span>
                    {ownerNames.size > 1 && (
                      <span className="sub">
                        {card.person_id === null
                          ? 'Joint'
                          : (ownerNames.get(card.person_id) ?? '—')}
                      </span>
                    )}
                  </button>
                </th>
              ))}
```

`.rewards-matrix .sub` is already `display: block` (matrix.css:15-20), so the badge stacks
under the economics line with no new CSS.

- [ ] **Step 5: Add the chips-row CSS.** Append to `src/pages/CreditCardsPage.css`:

```css
/* The owner chips sit above the tiles, mirroring NetWorthPage's `.networth-owner-row`
   exactly — same gap, same wrap, same flattened eyebrow — so the two pages' scope rows
   read as one control. */
.cards-owner-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.cards-owner-row .eyebrow {
  margin: 0;
}
```

- [ ] **Step 6: Run to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/CreditCardsPage.test.tsx src/components/creditcards/rewardsMath.test.ts
```

Expected: green.

- [ ] **Step 7: Typecheck, lint, full frontend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && npm run lint
cd /c/Users/edyli/personal-finance-dashboard && npm test
```

Expected: clean, clean, green.

- [ ] **Step 8: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(credit-cards): owner chips, matrix badges, household-advantage tile"
```

---

## Phase 3 — Calendar frontend

### Task 6: The suffix vocabulary and the ICS pin

**Files:**
- `src/types/api.ts` (`CalendarEvent` ≈:1264-1271, `CustomEventBody` ≈:1278-1282, `CustomEventOut` ≈:1284-1289)
- `src/components/calendar/calendarView.test.ts` (append a describe)
- `src/components/calendar/calendarView.ts`
- `src/utils/ics.test.ts` (append a case to the `buildIcs` describe)

- [ ] **Step 1: Write the failing tests.** Append to
`src/components/calendar/calendarView.test.ts`:

```ts
describe('person suffix', () => {
  it('is the server grammar verbatim — one shape to build and one to peel', () => {
    expect(personSuffix('Sam')).toBe(' — Sam')
    expect(stripPersonSuffix('Dentist — Sam', 'Sam')).toBe('Dentist')
  })

  it('leaves the label alone when the name is unknown or absent', () => {
    // A roster that has not loaded, or a person renamed since the fetch: a visible stale
    // suffix is recoverable, a wrongly-truncated title is not.
    expect(stripPersonSuffix('Dentist — Sam', undefined)).toBe('Dentist — Sam')
    expect(stripPersonSuffix('Dentist', 'Sam')).toBe('Dentist')
  })

  it('peels only the TRAILING occurrence', () => {
    expect(stripPersonSuffix('Sam — Sam', 'Sam')).toBe('Sam')
    expect(stripPersonSuffix('Call — Sam about it', 'Sam')).toBe('Call — Sam about it')
  })
})
```

and extend that file's import:

```ts
import {
  EVENT_COLORS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  eventKey,
  groupByDate,
  hrefLabel,
  personSuffix,
  stripPersonSuffix,
} from './calendarView'
```

Append to the `buildIcs` describe in `src/utils/ics.test.ts`:

```ts
  it('carries a person-tagged label straight into SUMMARY', () => {
    // The server stamps the name into the label, so the ICS export inherits it with no
    // work here — this pins that the label really is the SUMMARY.
    const tagged = event({
      type: 'custom',
      label: 'Dentist — Sam',
      detail: null,
      href: null,
      id: 41,
      person_id: 2,
    })
    expect(buildIcs([tagged])).toContain('SUMMARY:Dentist — Sam')
    // The UID still keys on the id, so tagging or untagging UPDATES rather than duplicates.
    expect(eventUid(tagged)).toBe('custom-41@finance-dashboard')
  })
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/calendar/calendarView.test.ts src/utils/ics.test.ts
```

Expected: `personSuffix`/`stripPersonSuffix` are not exported, and `person_id` is not a
`CalendarEvent` property.

- [ ] **Step 3: Add the wire fields.** In `src/types/api.ts`:

```ts
export interface CalendarEvent {
  date: string // ISO YYYY-MM-DD
  type: CalendarEventType
  label: string
  detail: string | null
  href: string | null // null for custom events — they have no page (spec §9.3)
  id: number | null // set only for custom events, the edit/delete handle
  /** Set only for custom events too. When it is not null the server has already stamped
   *  " — <name>" onto `label`, and anything that re-saves the row must strip it first
   *  (calendarView.stripPersonSuffix). */
  person_id: number | null
}
```

```ts
// POST/PATCH body — full replace (the form always submits all four fields).
export interface CustomEventBody {
  date: string
  label: string
  detail: string | null
  /** null = household. */
  person_id: number | null
}

export interface CustomEventOut {
  id: number
  date: string
  /** As STORED — unstamped. The suffix is composed by GET /calendar, never persisted. */
  label: string
  detail: string | null
  person_id: number | null
}
```

- [ ] **Step 4: Implement the helpers.** Append to
`src/components/calendar/calendarView.ts`:

```ts
// The person-tag grammar, mirroring the server's services/calendar_events.person_suffix:
// a tagged event reads "<label> — <name>" on the grid chip, in the list row, and in the ICS
// SUMMARY (which is the label verbatim).
export function personSuffix(name: string): string {
  return ` — ${name}`
}

/** The label the user actually TYPED. GET /calendar stamps the owner's name onto a tagged
 *  event, so the edit form and the delete-Undo re-POST must peel it back off — otherwise the
 *  next save stores "Dentist — Sam" and the composer stamps it again. Nothing is stripped
 *  when the name is unknown (a roster that has not loaded, or a person renamed since the
 *  fetch): a visible stale suffix is recoverable, a wrongly-truncated title is not. */
export function stripPersonSuffix(label: string, name: string | undefined): string {
  if (name === undefined) return label
  const suffix = personSuffix(name)
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label
}
```

- [ ] **Step 5: Run to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/calendar/calendarView.test.ts src/utils/ics.test.ts
```

Expected: green. `npx tsc -b` will still fail in `CalendarPage.tsx`/`CalendarPage.test.tsx`
(fixtures and bodies missing `person_id`) — that is Task 7.

- [ ] **Step 6: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(calendar): person-suffix vocabulary shared with the server"
```

---

### Task 7: `CalendarPage` — person select, strip-before-edit, strip-before-Undo

**Files:**
- `src/pages/CalendarPage.test.tsx` (mocks :11-27, `fixtureEvents` :35-62, append a describe)
- `src/pages/CalendarPage.tsx` (imports :1-24, state :45-72, `openAddForm` :158-164, `startEdit` :166-174, `saveForm` :176-193, `removeEvent` :195-226, derived :228-238, form markup :269-318)
- `src/pages/CalendarPage.css`

- [ ] **Step 1: Write the failing tests.** In `src/pages/CalendarPage.test.tsx`:

Add the household mock beside the others (after the `../utils/ics` mock, ≈:21):

```ts
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
```

and its value import beside the others (≈:28):

```ts
import { fetchHousehold } from '../api/household'
```

Add `person_id: null` to all four objects in `fixtureEvents()` (every `CalendarEvent` literal
in the file needs it — search for `id: null` and `id: 41`), and seed the roster wherever the
existing `beforeEach` sets up mocks. If the file has no shared `beforeEach` mock seed, add one
next to `clearSnapshots()`:

```ts
  vi.mocked(fetchHousehold).mockResolvedValue({
    people: [
      { id: 1, name: 'Ed', is_primary: true },
      { id: 2, name: 'Sam', is_primary: false },
    ],
    marriage_date: null,
  })
```

Append this describe at the end of the file:

```ts
describe('CalendarPage — person tags', () => {
  it('sends the chosen person and defaults to Household', async () => {
    vi.mocked(createCustomEvent).mockResolvedValue({
      id: 99, date: DAY_15, label: 'Dentist', detail: null, person_id: 2,
    })
    renderPage()
    await screen.findByText('Car insurance')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const select = screen.getByLabelText('Person') as HTMLSelectElement
    expect(select.value).toBe('') // Household — a tag is always a deliberate choice
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dentist' } })
    fireEvent.change(select, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    await waitFor(() => expect(createCustomEvent).toHaveBeenCalled())
    expect(vi.mocked(createCustomEvent).mock.calls[0][0].person_id).toBe(2)
  })

  it('hides the select for a one-person household and sends null', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue({
      people: [{ id: 1, name: 'Ed', is_primary: true }],
      marriage_date: null,
    })
    vi.mocked(createCustomEvent).mockResolvedValue({
      id: 99, date: DAY_15, label: 'Dentist', detail: null, person_id: null,
    })
    renderPage()
    await screen.findByText('Car insurance')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    expect(screen.queryByLabelText('Person')).toBeNull()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dentist' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    await waitFor(() => expect(createCustomEvent).toHaveBeenCalled())
    expect(vi.mocked(createCustomEvent).mock.calls[0][0].person_id).toBeNull()
  })

  it('STRIPS the stamped suffix before editing — a re-save must not stamp it twice', async () => {
    renderPage([
      {
        date: DAY_15, type: 'custom', label: 'Dentist — Sam', detail: null, href: null,
        id: 41, person_id: 2,
      },
    ])
    fireEvent.click(await screen.findByRole('button', { name: /Dentist — Sam/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Dentist')
    expect((screen.getByLabelText('Person') as HTMLSelectElement).value).toBe('2')
    vi.mocked(updateCustomEvent).mockResolvedValue({
      id: 41, date: DAY_15, label: 'Dentist', detail: null, person_id: 2,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateCustomEvent).toHaveBeenCalled())
    expect(vi.mocked(updateCustomEvent).mock.calls[0][1]).toMatchObject({
      label: 'Dentist',
      person_id: 2,
    })
  })

  it('STRIPS the suffix before the delete-Undo re-POST too', async () => {
    vi.mocked(deleteCustomEvent).mockResolvedValue(undefined)
    vi.mocked(createCustomEvent).mockResolvedValue({
      id: 42, date: DAY_15, label: 'Dentist', detail: null, person_id: 2,
    })
    renderPage([
      {
        date: DAY_15, type: 'custom', label: 'Dentist — Sam', detail: null, href: null,
        id: 41, person_id: 2,
      },
    ])
    fireEvent.click(await screen.findByRole('button', { name: /Dentist — Sam/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(createCustomEvent).toHaveBeenCalled())
    expect(vi.mocked(createCustomEvent).mock.calls[0][0]).toMatchObject({
      label: 'Dentist',
      person_id: 2,
    })
  })
})
```

**Adapt, do not fight, the file's existing helpers:** `renderPage` already accepts a payload
and wraps in `MemoryRouter` + `ToastProvider`; reuse it exactly as the other tests do. If a
selector above does not match the file's conventions (`getByRole('button', { name: … })` vs a
`.cal-chip` query), match the neighbouring tests rather than changing the component.

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/CalendarPage.test.tsx
```

Expected: no `Person` label; the edit form seeds `"Dentist — Sam"`; the Undo re-POST carries
the stamped label and no `person_id`.

- [ ] **Step 3: Implement.** In `src/pages/CalendarPage.tsx`:

Extend the imports (lines 1-24):

```ts
import { fetchHousehold } from '../api/household'
import {
  EVENT_COLORS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  eventKey,
  groupByDate,
  stripPersonSuffix,
} from '../components/calendar/calendarView'
import type { CalendarEvent, PersonOut } from '../types/api'
```

Add the roster and the form field to the state block (after `const [fDetail, …]`, ≈:57):

```ts
  const [fPerson, setFPerson] = useState('') // '' = Household; a tag is always deliberate
  // Its own fetch, outside the per-month snapshot: the roster does not change with the
  // month, and folding it in would invalidate every cached month (NetWorthPage's pattern).
  const [people, setPeople] = useState<PersonOut[]>([])
  useEffect(() => {
    fetchHousehold()
      .then((data) => setPeople(data.people))
      .catch(() => setPeople([]))
  }, [])
```

Add the two derived values beside `today`/`weeks`/`byDate` (≈:228), and the raw-label peeler:

```ts
  // Primary first, then by id — the order every other person control on the site uses.
  const orderedPeople = [...people].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
  )
  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  // GET /calendar stamps " — <name>" into a tagged event's label. Anything that re-saves
  // the row starts from the STAMPED text, so it peels first — otherwise the next compose
  // stamps a second copy.
  const rawLabel = (event: CalendarEvent): string =>
    event.person_id === null
      ? event.label
      : stripPersonSuffix(event.label, ownerName.get(event.person_id))
```

Replace `openAddForm` and `startEdit` (lines 158-174) with:

```ts
  const openAddForm = () => {
    setForm({ mode: 'add' })
    setFDate(todayIso())
    setFLabel('')
    setFDetail('')
    setFPerson('')
    setFormError(null)
  }

  const startEdit = (event: CalendarEvent) => {
    if (event.id === null) return
    setForm({ mode: 'edit', id: event.id })
    setFDate(event.date)
    setFLabel(rawLabel(event))
    setFDetail(event.detail ?? '')
    setFPerson(event.person_id === null ? '' : String(event.person_id))
    setFormError(null)
    setOpen(null)
  }
```

Replace the body construction in `saveForm` (line 180) with:

```ts
    const body = {
      date: fDate,
      label: fLabel.trim(),
      detail: detail === '' ? null : detail,
      person_id: fPerson === '' ? null : Number(fPerson),
    }
```

Replace the Undo re-POST inside `removeEvent` (line 212) with:

```ts
              createCustomEvent({
                date: event.date,
                // The RAW label — see rawLabel: the closure holds the stamped one.
                label: rawLabel(event),
                detail: event.detail,
                person_id: event.person_id,
              })
```

Add the select to the form, immediately after the Note field (after line 304, before the
Save button):

```tsx
                {orderedPeople.length > 1 && (
                  <label className="cal-form-field">
                    Person
                    <select
                      className="field-input cal-form-input"
                      value={fPerson}
                      onChange={(e) => setFPerson(e.target.value)}
                    >
                      <option value="">Household</option>
                      {orderedPeople.map((person) => (
                        <option key={person.id} value={String(person.id)}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
```

Extend the legend note (lines 409-415) with one sentence so the grammar is worded, not
implied — replace the closing of that paragraph:

```tsx
            <p className="drill-hint">
              Paydays appear only for semi-monthly (24 checks/yr) paycheck profiles — other
              cadences are omitted rather than guessed, and each chip carries the
              person&apos;s name once more than one person has a profile. Your own events
              carry a name the same way when you tag one. Ex-dividend dates are confirmed
              announcements only: stocks typically publish 2–6 weeks ahead, ETFs often just
              days ahead, so a quiet stretch may simply be unannounced.
            </p>
```

- [ ] **Step 4: Style the new field.** Append to `src/pages/CalendarPage.css`:

```css
/* The person picker holds WORDS, not figures: .field-input is the house's right-aligned
   monospace money box, and a name wearing it reads as an amount (roster.css's rule). */
.cal-form select.cal-form-input {
  text-align: left;
  font-family: inherit;
}
```

- [ ] **Step 5: Run to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/CalendarPage.test.tsx
```

Expected: green, including every pre-existing calendar test.

- [ ] **Step 6: Typecheck, lint, both full suites.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && npm run lint
cd /c/Users/edyli/personal-finance-dashboard && npm test
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest -q
```

Expected: clean, clean, green, green.

- [ ] **Step 7: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(calendar): person select on the event form with suffix-safe edit and undo"
```

---

## Phase 4 — Batch verification

### Task 8: Full gates + dev-DB migration + real-data browser smoke (ORCHESTRATOR-EXECUTED)

This task verifies the WHOLE 2026-08-28 batch (Plans 1–4), not just this plan. It is the last
thing that runs and the **orchestrator** runs it — do not delegate it to a task subagent,
because the browser half needs the user's real database and the running dev servers.

**Files:** none (verification only; any fix found here gets its own commit)

- [ ] **Step 1: Full backend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p4cards .venv/Scripts/python.exe -m pytest -q
```

Expected: green, count ≥ the 1131 baseline plus the batch's new tests. Record the exact
number. A failure here is a STOP.

- [ ] **Step 2: Frontend gates, in this order.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npm test
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && npm run lint
cd /c/Users/edyli/personal-finance-dashboard && npm run build
```

Expected: green, green, clean (0 errors, 0 warnings), successful production build. Record the
vitest count against the 1213 baseline.

- [ ] **Step 3: Migration chain is single-headed and matches the models.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic heads
```

Expected: exactly ONE head — `d3b8e05fa726` unless a later plan added another. Two heads is a
STOP.

- [ ] **Step 4: Apply to the DEV database and verify.** This is the ONLY step in the whole
batch that runs `alembic upgrade`, and it runs against the dev database that
`backend/app/config.py` resolves — never a production or backup URL.

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic upgrade head
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic check
```

Expected: the upgrade applies Plan 1's migration plus `c7a2f4e91b53` and `d3b8e05fa726` with
no error, and `check` reports no new operations (the models and the chain agree). If the
credit-cards migration raises its zero-people `RuntimeError`, STOP — the dev roster is not
seeded, and that is the guard doing its job.

- [ ] **Step 5: Start the dev servers against the REAL database** and wait for both to answer.

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
cd /c/Users/edyli/personal-finance-dashboard && npm run dev
```

Run each in the background. Confirm `http://localhost:8000/api/v1/health` answers and the
Vite URL loads. Sign in as the user. Keep a browser console open for every step below — the
2026-08-25 production incident was an ECharts `setOption` TypeError that no test could see.

- [ ] **Step 6: Browser smoke — Portfolio (Plans 1 + 2).**
  - [ ] Open `/portfolio`. With more than one person on the roster, the **owner chips** render
        under the page header: All / each name / Joint.
  - [ ] Press each chip in turn. The holdings table, the allocation donut, the dividends
        panel, the realized table and the transactions list all follow; every total in the
        card matches the rows shown beneath it (no household total over a filtered table).
  - [ ] Press **All** and confirm the page returns to exactly what it showed on load.
  - [ ] Confirm the **performance card** carries the one-line "always the whole household"
        hint while a person chip is active, and that its series does NOT change between chips.
  - [ ] Open `/settings` → **Accounts** → the **Portfolio accounts** table. Change one
        account's owner select, reload `/portfolio`, and confirm the chips move that
        account's holdings to the new owner. **Change it back** and confirm the original view
        returns.
  - [ ] Console clean throughout.

- [ ] **Step 7: Browser smoke — Credit cards (this plan).**
  - [ ] Open `/credit-cards`. The **owner chips** render (All / names / Joint) above the
        tiles, and the roster table has an **Owner** column showing a name or `Joint` — no
        blanks and no `—`, because the migration backfilled everything.
  - [ ] Press a person chip. The roster, the matrix columns, the four KPI tiles, the
        card-value bars and the credit-line chart ALL narrow together; the "Active cards"
        tile equals the number of matrix columns.
  - [ ] Press **Joint**. Only NULL-owned cards remain. Press **All** to restore.
  - [ ] Confirm each matrix column header carries its owner badge under the fee line.
  - [ ] Add a scratch card named `ZZ Smoke Card` with the owner select set to the **partner**,
        no fee, `cash`. Confirm it appears in the roster with that owner and in the matrix
        under the partner chip.
  - [ ] Give it a bonus multiplier on a weighted category that beats every existing card, and
        confirm the **Household wallet advantage** tile appears with a positive figure and
        the "beats the best single wallet" line. Hover its InfoHint and confirm it names the
        rule (single-owner wallet = own cards + joint).
  - [ ] Set the scratch card's owner back to **Joint** and confirm the tile DISAPPEARS (one
        person now holds every owned card — the tile is absent rather than zero).
  - [ ] **Archive** the scratch card, then **Unarchive** it, and confirm its Owner column
        value is unchanged both times. This is the verbatim-rebuild hazard in the real app.
  - [ ] **Delete** the scratch card, press **Undo** in the toast, and confirm the restored row
        keeps its owner. Then delete it again for real (teardown, Step 10).
  - [ ] Open one real card's details. The **Holder** chip still shows the embossed name; the
        form no longer offers a holder box. Console clean.

- [ ] **Step 8: Browser smoke — Projection (Plan 3).**
  - [ ] Open `/projection`. One **retirement-month knob** renders per person with an in-force
        paycheck profile, labelled by name, all blank.
  - [ ] Screenshot / note the headline figures with all knobs blank.
  - [ ] Set one person's retirement month inside the horizon. The chart gains a **dashed
        markLine** labelled with that person's name at that month, and the balance curve bends
        after it.
  - [ ] Clear the knob and confirm the headline figures return to the Step-8 note
        **byte-identically** — no retirement params must mean the pre-batch answer.
  - [ ] Set a retirement for a person with no in-force profile (if one exists) and confirm the
        server's 422 sentence renders verbatim rather than a generic error.
  - [ ] Console clean.

- [ ] **Step 9: Browser smoke — Calendar (this plan).**
  - [ ] Open `/calendar`. Press **Add event**, and with a two-person roster confirm the
        **Person** select is present and defaults to **Household**.
  - [ ] Create `ZZ Smoke Event` on a date in the shown month tagged to the **partner**. The
        grid chip and the list row both read `ZZ Smoke Event — <name>`.
  - [ ] Press **Add to calendar (.ics)**, open the downloaded file, and confirm its
        `SUMMARY:` line carries the same suffix and the `UID:` is `custom-<id>@…`.
  - [ ] Press the chip → **Edit**. The Title box shows `ZZ Smoke Event` with **no** suffix and
        the Person select shows the partner. Save unchanged and confirm the chip still reads
        with exactly ONE suffix (this is the double-stamp hazard).
  - [ ] Set the Person select back to **Household**, save, and confirm the suffix disappears.
  - [ ] Confirm a pre-existing untagged event's chip text is unchanged from before the batch.
  - [ ] **Delete** the scratch event, press **Undo**, confirm the restored row is correct, then
        delete it again for real (teardown, Step 10).
  - [ ] Console clean.

- [ ] **Step 10: Teardown of every scratch item.**
  - [ ] `ZZ Smoke Card` deleted from `/credit-cards` (and its matrix multiplier gone with it).
  - [ ] `ZZ Smoke Event` deleted from `/calendar`.
  - [ ] Any portfolio-account owner re-tag from Step 6 reverted.
  - [ ] Any projection knob cleared.
  - [ ] Re-open each page once and confirm the app is back to the user's real data only.

- [ ] **Step 11: Record the outcome.**
  - [ ] Write the pytest count, the vitest count, the alembic head, and the browser results
        into the run report.
  - [ ] Anything that looks deletable — `credit_cards.primary_holder` now that `person_id`
        owns ownership, the `authorized_users` free-text column, a superseded fixture — goes
        on the **morning list**. This batch deletes nothing.
  - [ ] Any defect found in Steps 6–9 gets a `fix(...)` commit of its own and a re-run of the
        affected gate; do not fold fixes into the feature commits above.
  - [ ] **Do not push.** The batch stays on the local branch for the user's review.

- [ ] **Step 12: Final commit** (only if Step 11 produced changes).

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "fix(credit-cards): batch verification follow-ups"
```

---

## Forward notes

- **`primary_holder` is now read-only everywhere.** It survives on the wire and in
  `CardDetail`'s chip row as the embossed-name note, but no form writes it any more. If the
  user wants to correct one, the next batch adds a small box in `CardDetail` beside the
  Holder chip — deliberately not here, because the whole point of this change is that the
  free-text column stopped being the ownership vocabulary. Morning-list note.
- **The chips are client-side on purpose.** The cards payload is a handful of rows already
  fetched whole, so an `owner` query param on `/credit-cards` would add a round trip and a
  second scope-consistency surface for no gain. If the roster ever grows past a page's worth,
  the net-worth `_owner_filter` helper ports over unchanged.
- **`householdAdvantage` prices wallets, not people.** It deliberately does not model
  authorized users: adding a spouse as an AU on one card is a different question (one fee,
  two cards' worth of spend) and needs an AU-strategy model the spec parks. The tile's
  InfoHint says "wallet" for exactly that reason.
- **A joint card counts for both single wallets, and that is a choice.** It reflects reality —
  either spouse can pull a joint card out — but it makes the advantage figure CONSERVATIVE:
  the more the household puts on joint plastic, the smaller the merge premium looks. The
  fixture in `rewardsMath.test.ts` pins both the rule and what the number would be without
  it, so a future change of heart has to argue with a test.
- **The calendar suffix is composed, never stored.** Renaming a person instantly re-labels
  every one of their events, and untagging restores the exact typed label — because the
  database only ever held what the user typed. The cost is the two peel sites (edit form and
  Undo), both pinned by tests; a third re-save path added later must peel too.
- **Person deletion is still impossible** (`api/household.py` has no DELETE route), so both
  new FKs' `ondelete="SET NULL"` is belt-and-braces. If a delete route ever lands, note that
  SET NULL silently turns that person's cards joint and their events household — which is the
  right default, but it deserves a confirmation sentence in the UI at that time.
</content>
</invoke>
