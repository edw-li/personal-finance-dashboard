# Calendar D — New sources: cards, tax amounts with the harbor verdict, ESPP contribution, ex-dividend estimates, health list, reset-cadence UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the money the foundations left null and add the card family, per `docs/superpowers/specs/2026-09-03-calendar-design.md` §6 (card, tax, espp, dividend rows) and §3: `card_fee` / `card_credit` / `card_anniversary` from `opened_on` anniversaries and `card_credits.reset_cadence` (with the `opened_on` nudge on the roster and the cadence toggle on the card detail), estimated-tax amounts as the safe-harbor shortfall split across the remaining payment dates with the verdict in the detail and the prior year's balance on Apr 15, the ESPP purchase contribution, held shares × latest per-share on ex-dividend dates, and the `sources[]` health list completed (card row, tax/dividend notes).

**Architecture:** Every new figure is derived from a service the owning page already uses and passed into the pure generators as plain values: `generators/cards.py` (new) reads `CardFacts`; `generators/taxes.py` gains arithmetic over Plan A's `TaxFacts`; `generators/espp.py` computes the modeler's `contribution` line from the row's own fields; `generators/dividends.py` already prices `ExDividend(shares, per_share)` — the loader now supplies both. The router's region 1 (`_load_sources`) grows three loaders and the health rows; `api/taxes.py`'s withholding route body becomes a reusable `withholding_estimate(db, year, today)` so the calendar prices the current AND the prior year without a second implementation. Frontend: the credit-card API/UI learns `reset_cadence`; the roster nudges for missing `opened_on`.

**Tech Stack:** FastAPI + SQLAlchemy async + pytest; React 19 + vitest for the two credit-card touches.

**Worktree / commands:** Branch `calendar-d` from main AFTER Plan A merged; worktree `.worktrees/calendar-d` with a `node_modules` junction. Backend from `<worktree>/backend`: `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`. Frontend from the worktree root: `npx vitest run <file>`.

**Shared-file hotspots (this lane's ONLY touches):** `backend/app/api/calendar.py` — region 1 only (`_held_ex_dividends`, new `_card_facts` / `_tax_facts`, the health rows and the `Sources(...)` call; Lane B appends region 5 at the END — disjoint); `backend/app/services/calendar/__init__.py` — the `cards` import and one `events +=` line; `src/types/api.ts` — the credit-card block only (Lane B appends after the calendar block). Never `main.py`, `SettingsPage.tsx`, `paletteRegistry.ts`, `OverviewPage.tsx`, `CalendarPage.tsx`.

**Contracts inherited from Plan A:** `make_event(...)`, `Event`, `Item`, `Window`, `money`, `shorten` (`services/calendar/model.py`); `Sources` with the pre-declared `tax_facts: dict[int, TaxFacts]` and `cards: list` slots; `TaxFacts(year, effective_threshold, total_projected, effective_leg, prior_year_balance)` and `nominal_dates(year)` in `generators/taxes.py`; `ExDividend(ticker, ex_date, shares, per_share)`; `_health(source, status, note)`, `_load_sources(db, window, today) -> (Sources, health, quoted_at)` in `api/calendar.py`; `CardCredit.reset_cadence` column + `CREDIT_RESET_CADENCES`; `calendarEvent()` fixture (not needed here). From `api/taxes.py`: `get_withholding`'s body, `_require_year`, `WithholdingOut.safe_harbor: SafeHarborOut | None` (`threshold`, `current_year_threshold`, `effective_threshold`, `met`), `WithholdingOut.total.projected`, `WithholdingOut.balance_projected`.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/calendar/generators/cards.py` (new) | `CardCreditFacts`, `CardFacts`, `anniversary()`, `card_events()` |
| `backend/app/services/calendar/__init__.py` (modify) | run the card generator |
| `backend/tests/calendar/test_cards_generator.py` (new) | fee/anniversary incl. Feb 29, both credit cadences, "falls off 5/24", NULL opened_on |
| `backend/app/services/calendar/generators/taxes.py` (modify) | shortfall split, verdict, Apr 15 prior balance |
| `backend/tests/calendar/test_taxes_generator.py` (new) | harbor met → 0 + verdict; shortfall split; past dates null; Apr 15 filing balance; missing facts |
| `backend/app/services/calendar/generators/espp.py` (modify) | purchase contribution |
| `backend/tests/calendar/test_generators.py` (modify) | ESPP contribution pin |
| `backend/app/api/taxes.py` (modify) | `withholding_estimate(db, year, today)` extracted from the route |
| `backend/app/api/calendar.py` (modify, region 1) | `_card_facts`, `_tax_facts`, dividend per-share, health rows, `Sources(cards=, tax_facts=)` |
| `backend/tests/test_calendar_api.py` (modify) | card events + health through the API; tax amounts through the API (seeded like `test_withholding_api`) |
| `backend/app/schemas/credit_cards.py`, `backend/app/api/credit_cards.py` (modify) | `reset_cadence` on `CardCreditIn/Out` |
| `backend/tests/test_credit_cards_api.py` (modify) | cadence round-trip + 422 |
| `src/types/api.ts` (modify) | `CardCreditResetCadence`, `reset_cadence` on `CardCreditOut/In` |
| `src/components/creditcards/CardDetail.tsx` (modify) | cadence toggle per credit; bodies carry `reset_cadence` |
| `src/components/creditcards/CardsPanel.tsx` (modify) | the `opened_on` nudge |
| `src/pages/CreditCardsPage.test.tsx` (modify) | fixtures + two tests |

---

### Task 1: `generators/cards.py` — fees, anniversaries, credit resets

**Files:**
- Create: `backend/app/services/calendar/generators/cards.py`, `backend/tests/calendar/test_cards_generator.py`
- Modify: `backend/app/services/calendar/__init__.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/calendar/test_cards_generator.py
"""The card family (2026-09-03 calendar spec §6 card row): opened_on anniversaries → fee
and anniversary events, counted credits → reset events by cadence, NULL opened_on → nothing."""

from datetime import date
from decimal import Decimal

from app.services.calendar import Sources, compose
from app.services.calendar.generators.cards import CardCreditFacts, CardFacts, anniversary, card_events
from app.services.calendar.model import Window

YEAR_2026 = Window(date(2026, 1, 1), date(2026, 12, 31))
TODAY = date(2026, 8, 24)


def venture_x(**over) -> CardFacts:
    fields = dict(
        card_id=7,
        name="Venture X",
        annual_fee=Decimal("395.00"),
        opened_on=date(2024, 5, 12),
        credits=(CardCreditFacts(5, "$300 travel credit", Decimal("300.00"), "calendar"),),
    )
    fields.update(over)
    return CardFacts(**fields)


def test_anniversary_clamps_feb_29():
    assert anniversary(date(2024, 2, 29), 2025) == date(2025, 2, 28)
    assert anniversary(date(2024, 2, 29), 2028) == date(2028, 2, 29)
    assert anniversary(date(2024, 5, 12), 2026) == date(2026, 5, 12)


def test_fee_and_anniversary_on_the_opened_on_anniversary_year_two_falls_off_5_24():
    events = card_events([venture_x()], YEAR_2026, TODAY)
    fee = next(e for e in events if e.type == "card_fee")
    anniv = next(e for e in events if e.type == "card_anniversary")
    assert (fee.event_date, fee.key, fee.label, fee.short_label) == (
        date(2026, 5, 12), "card:7-fee:2026-05-12", "Venture X annual fee", "Card fee",
    )
    assert (fee.amount, fee.direction, fee.basis, fee.href) == (Decimal("395.00"), "out", "confirmed", "/credit-cards")
    assert fee.detail == "$395.00 annual fee — year 2"
    assert (anniv.key, anniv.amount, anniv.direction) == ("card:7:2026-05-12", None, "neutral")
    assert anniv.detail == "Year 2 with Venture X — falls off 5/24"
    year_three = card_events([venture_x()], Window(date(2027, 1, 1), date(2027, 12, 31)), TODAY)
    assert next(e for e in year_three if e.type == "card_anniversary").detail == "Year 3 with Venture X"


def test_no_fee_event_for_a_no_fee_card_and_no_anniversary_in_the_opening_year():
    events = card_events([venture_x(annual_fee=Decimal("0"))], YEAR_2026, TODAY)
    assert [e.type for e in events if e.type != "card_credit"] == ["card_anniversary"]
    opening_year = card_events([venture_x()], Window(date(2024, 1, 1), date(2024, 12, 31)), TODAY)
    assert [e.type for e in opening_year] == ["card_credit"]  # Jan 1 2024 credit reset only


def test_credit_resets_by_cadence():
    calendar_reset = card_events([venture_x()], YEAR_2026, TODAY)
    credit = next(e for e in calendar_reset if e.type == "card_credit")
    assert (credit.event_date, credit.key, credit.label, credit.short_label) == (
        date(2026, 1, 1), "card:credit-5:2026-01-01", "Venture X — $300 travel credit resets", "Credit resets",
    )
    assert (credit.amount, credit.direction, credit.basis, credit.detail) == (Decimal("300.00"), "neutral", "confirmed", "$300.00 to use this year")
    on_anniversary = card_events(
        [venture_x(credits=(CardCreditFacts(5, "$300 travel credit", Decimal("300.00"), "anniversary"),))], YEAR_2026, TODAY
    )
    assert [e.event_date for e in on_anniversary if e.type == "card_credit"] == [date(2026, 5, 12)]


def test_a_card_without_opened_on_emits_nothing_but_a_calendar_credit_still_resets():
    events = card_events([venture_x(opened_on=None)], YEAR_2026, TODAY)
    assert [e.type for e in events] == ["card_credit"]
    anniversary_credit = venture_x(opened_on=None, credits=(CardCreditFacts(5, "x", Decimal("1"), "anniversary"),))
    assert card_events([anniversary_credit], YEAR_2026, TODAY) == []


def test_compose_runs_the_card_generator_and_never_folds_a_fee_with_a_credit():
    same_day = venture_x(opened_on=date(2024, 1, 1), credits=(CardCreditFacts(5, "credit", Decimal("300"), "calendar"),))
    events = compose(Window(date(2026, 1, 1), date(2026, 1, 1)), today=TODAY, sources=Sources(cards=[same_day]))
    assert sorted(e.type for e in events if e.source == "card") == ["card_anniversary", "card_credit", "card_fee"]
```

- [ ] **Step 2: Run to verify it fails** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_cards_generator.py -q` → FAIL (module not found).

- [ ] **Step 3: Write the generator and wire it**

```python
# backend/app/services/calendar/generators/cards.py
"""Card events (2026-09-03 calendar spec §6 card row): `opened_on` anniversaries → a
`card_fee` (when annual_fee > 0) and a `card_anniversary`; counted credits → a
`card_credit` on their reset date (`calendar` = Jan 1, `anniversary` = the card's
anniversary). No `opened_on` → no fee or anniversary (the router counts those cards in the
health footer). Pure — CardFacts are plain values."""

import calendar as _calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..model import Event, Window, make_event, shorten

HREF = "/credit-cards"
# 5/24: an account opened 24 months ago stops counting against Chase's new-card rule.
FALLS_OFF_YEAR = 2


@dataclass(frozen=True)
class CardCreditFacts:
    credit_id: int
    label: str
    annual_value: Decimal
    reset_cadence: str  # "calendar" | "anniversary"


@dataclass(frozen=True)
class CardFacts:
    card_id: int
    name: str
    annual_fee: Decimal
    opened_on: date | None
    credits: tuple[CardCreditFacts, ...] = ()  # counted credits only (the router filters)


def anniversary(opened_on: date, year: int) -> date:
    """The opening date's anniversary in `year`; a Feb 29 opening lands on Feb 28."""
    day = min(opened_on.day, _calendar.monthrange(year, opened_on.month)[1])
    return date(year, opened_on.month, day)


def card_events(cards: list[CardFacts], window: Window, today: date) -> list[Event]:
    events: list[Event] = []
    for card in cards:
        for year in range(window.start.year, window.end.year + 1):
            if card.opened_on is not None:
                years_open = year - card.opened_on.year
                anniv = anniversary(card.opened_on, year)
                if years_open >= 1 and window.contains(anniv):
                    detail = f"Year {years_open} with {card.name}"
                    if years_open == FALLS_OFF_YEAR:
                        detail += " — falls off 5/24"
                    events.append(
                        make_event(
                            anniv,
                            "card_anniversary",
                            str(card.card_id),
                            f"{card.name} anniversary",
                            shorten(f"{card.name} anniv."),
                            detail=detail,
                            basis="confirmed",
                            href=HREF,
                        )
                    )
                    if card.annual_fee > 0:
                        events.append(
                            make_event(
                                anniv,
                                "card_fee",
                                f"{card.card_id}-fee",
                                f"{card.name} annual fee",
                                "Card fee",
                                detail=f"${card.annual_fee:,.2f} annual fee — year {years_open}",
                                amount=card.annual_fee,
                                direction="out",
                                basis="confirmed",
                                href=HREF,
                            )
                        )
            for credit in card.credits:
                if credit.reset_cadence == "calendar":
                    reset = date(year, 1, 1)
                elif card.opened_on is not None and year > card.opened_on.year:
                    reset = anniversary(card.opened_on, year)
                else:
                    continue  # an anniversary reset needs an opened_on (health footer names it)
                if window.contains(reset):
                    events.append(
                        make_event(
                            reset,
                            "card_credit",
                            f"credit-{credit.credit_id}",
                            f"{card.name} — {credit.label} resets",
                            "Credit resets",
                            detail=f"${credit.annual_value:,.2f} to use this year",
                            amount=credit.annual_value,
                            direction="neutral",  # a credit is value to use, not cash in
                            basis="confirmed",
                            href=HREF,
                        )
                    )
    return events
```

In `backend/app/services/calendar/__init__.py`: change the generators import to `from .generators import cards, custom, dividends, espp, payroll, ritual, rsu, taxes`, add `from .generators.cards import CardFacts` and annotate the slot `cards: list[CardFacts] = field(default_factory=list)`, and insert `events += cards.card_events(sources.cards, window, today)` directly after the `taxes.tax_deadline_events(...)` line.

- [ ] **Step 4: Run** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar -q` → all passed (6 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/generators/cards.py backend/app/services/calendar/__init__.py backend/tests/calendar/test_cards_generator.py
git commit -m "feat(calendar): card generator — fees and anniversaries from opened_on, credit resets by cadence"
```

---

### Task 2: Tax amounts — the shortfall split and the harbor verdict

**Files:**
- Modify: `backend/app/services/calendar/generators/taxes.py`
- Create: `backend/tests/calendar/test_taxes_generator.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/calendar/test_taxes_generator.py
"""Tax amounts (2026-09-03 calendar spec §6 tax row): the safe-harbor shortfall split evenly
across the REMAINING current-year payment dates, the verdict in the detail, the prior year's
positive balance on Apr 15, nulls everywhere the tracker cannot see."""

from datetime import date
from decimal import Decimal

from app.services.calendar.generators.taxes import TaxFacts, payment_dates, tax_deadline_events
from app.services.calendar.model import Window

TODAY = date(2026, 8, 24)
YEAR = Window(date(2026, 1, 1), date(2027, 1, 31))


def by_ref(events):
    return {e.entity_ref: e for e in events}


def test_payment_dates_are_the_four_estimated_dates_forward_adjusted():
    assert payment_dates(2026) == [date(2026, 4, 15), date(2026, 6, 15), date(2026, 9, 15), date(2027, 1, 15)]
    assert payment_dates(2027)[3] == date(2028, 1, 18)  # Sat Jan 15 → Sun → MLK Mon → Tue


def test_shortfall_splits_across_remaining_dates_with_the_verdict_and_leaves_past_dates_null():
    facts = {2026: TaxFacts(2026, effective_threshold=Decimal("30000"), total_projected=Decimal("27600"), effective_leg="prior-year")}
    events = by_ref(tax_deadline_events(YEAR, TODAY, facts))
    # Remaining as of Aug 24: Sep 15 2026 and Jan 15 2027 → 2400 / 2 each.
    assert (events["2026-q3"].amount, events["2026-q3"].basis, events["2026-q3"].direction) == (Decimal("1200.00"), "estimated", "out")
    assert events["2026-q3"].detail == "Shortfall $2,400.00 to the prior-year leg — $1,200.00 of it here"
    assert (events["2026-q4"].event_date, events["2026-q4"].amount) == (date(2027, 1, 15), Decimal("1200.00"))
    # Past dates are history: null amount, the plain v1 detail, scheduled basis.
    assert (events["2026-q1"].amount, events["2026-q1"].detail, events["2026-q1"].basis) == (None, "federal filing + Q1 estimated payment", "scheduled")
    assert events["2026-q2"].amount is None
    assert events["2026-extension"].amount is None
    assert events["2025-q4"].amount is None  # last year's Q4, due Jan 15 2026 — history too


def test_uneven_split_puts_the_remainder_on_the_last_date():
    facts = {2026: TaxFacts(2026, Decimal("1000.01"), Decimal("0"), "current-year")}
    events = by_ref(tax_deadline_events(YEAR, TODAY, facts))
    assert (events["2026-q3"].amount, events["2026-q4"].amount) == (Decimal("500.00"), Decimal("500.01"))


def test_harbor_met_is_zero_with_the_verdict():
    facts = {2026: TaxFacts(2026, Decimal("30000"), Decimal("31000"), "current-year")}
    q3 = by_ref(tax_deadline_events(YEAR, TODAY, facts))["2026-q3"]
    assert (q3.amount, q3.detail) == (Decimal("0.00"), "Safe harbor met — no payment needed")


def test_apr_15_carries_the_prior_years_balance_plus_its_q1_share():
    early = date(2026, 2, 1)  # every 2026 payment date is still ahead
    facts = {2026: TaxFacts(2026, Decimal("4000"), Decimal("0"), "prior-year", prior_year_balance=Decimal("1500"))}
    q1 = by_ref(tax_deadline_events(YEAR, early, facts))["2026-q1"]
    assert q1.amount == Decimal("2500.00")  # 4000 / 4 + 1500
    assert q1.detail == "Shortfall $4,000.00 to the prior-year leg — $1,000.00 of it here · files 2025: balance ≈ $1,500.00"
    # Balance known, harbor unknown: the filing balance stands alone.
    only_balance = {2026: TaxFacts(2026, None, None, None, prior_year_balance=Decimal("1500"))}
    q1 = by_ref(tax_deadline_events(YEAR, early, only_balance))["2026-q1"]
    assert (q1.amount, q1.detail) == (Decimal("1500.00"), "files 2025: balance ≈ $1,500.00")


def test_no_facts_or_incomplete_facts_leave_v1_dates_only():
    events = tax_deadline_events(YEAR, TODAY, {})
    assert all(e.amount is None and e.basis == "scheduled" for e in events)
    partial = {2026: TaxFacts(2026, None, Decimal("27600"), None)}
    assert all(e.amount is None for e in tax_deadline_events(YEAR, TODAY, partial))
```

- [ ] **Step 2: Run to verify it fails** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_taxes_generator.py -q` → FAIL (`payment_dates` missing; amounts None).

- [ ] **Step 3: Add the arithmetic** — replace `tax_deadline_events` in `backend/app/services/calendar/generators/taxes.py` with the block below and add `payment_dates`; keep `TaxFacts` and `nominal_dates` exactly as Plan A wrote them, and add `from ..model import money` to the imports.

```python
def payment_dates(tax_year: int) -> list[date]:
    """The four estimated-payment due dates of ONE tax year, forward-adjusted: Apr 15, Jun 15,
    Sep 15 of the year and Jan 15 of the next (that Q4 date belongs to THIS tax year)."""
    return [
        next_business_day(date(tax_year, 4, 15)),
        next_business_day(date(tax_year, 6, 15)),
        next_business_day(date(tax_year, 9, 15)),
        next_business_day(date(tax_year + 1, 1, 15)),
    ]


def _split(total: Decimal, count: int) -> list[Decimal]:
    """Even cent shares; the LAST date absorbs the rounding remainder so the parts sum exactly."""
    share = money(total / count)
    return [share] * (count - 1) + [money(total - share * (count - 1))]


def _priced(
    due: date, ref: str, tax_year: int, today: date, facts: TaxFacts | None
) -> tuple[Decimal | None, str | None]:
    """(amount, verdict) for one payment date, or (None, None) when the tracker cannot see it:
    a past date (history), a year without facts, or facts without both harbor figures."""
    if facts is None or due < today:
        return None, None
    amount: Decimal | None = None
    parts: list[str] = []
    if facts.effective_threshold is not None and facts.total_projected is not None:
        remaining = [d for d in payment_dates(tax_year) if d >= today]
        if due in remaining:
            shortfall = max(Decimal("0"), facts.effective_threshold - facts.total_projected)
            share = _split(shortfall, len(remaining))[remaining.index(due)]
            amount = share
            leg = facts.effective_leg or "current-year"
            parts.append(
                "Safe harbor met — no payment needed"
                if shortfall == 0
                else f"Shortfall ${shortfall:,.2f} to the {leg} leg — ${share:,.2f} of it here"
            )
    if ref.endswith("-q1") and facts.prior_year_balance is not None and facts.prior_year_balance > 0:
        amount = (amount or Decimal("0")) + facts.prior_year_balance
        parts.append(f"files {tax_year - 1}: balance ≈ ${facts.prior_year_balance:,.2f}")
    if amount is None:
        return None, None
    return money(amount), " · ".join(parts)


def tax_deadline_events(window: Window, today: date, facts_by_year: dict[int, TaxFacts]) -> list[Event]:
    events: list[Event] = []
    for year in range(window.start.year, window.end.year + 1):
        for nominal, which, ref, short in nominal_dates(year):
            due = next_business_day(nominal)
            if not window.contains(due):
                continue
            # Jan 15 of Y is tax year Y-1's Q4; the extension is Y-1's return; the rest are Y's.
            tax_year = year - 1 if ref.endswith("-q4") or ref.endswith("-extension") else year
            amount, verdict = (
                (None, None) if ref.endswith("-extension") else _priced(due, ref, tax_year, today, facts_by_year.get(tax_year))
            )
            events.append(
                make_event(
                    due,
                    "tax_deadline",
                    ref,
                    f"Tax deadline — {which}",
                    short,
                    detail=verdict if verdict is not None else which,
                    amount=amount,
                    direction="out",
                    basis="estimated" if amount is not None else "scheduled",
                    href="/taxes",
                )
            )
    return events
```

- [ ] **Step 4: Run** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_taxes_generator.py tests/calendar/test_generators.py -q` → all passed (Plan A's date-only pins still hold with `{}`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/generators/taxes.py backend/tests/calendar/test_taxes_generator.py
git commit -m "feat(calendar): tax deadlines carry the safe-harbor shortfall split, the verdict and the filing balance"
```

---

### Task 3: The loaders — `withholding_estimate`, card facts, tax facts, dividend per-share, health rows

**Files:**
- Modify: `backend/app/api/taxes.py`, `backend/app/api/calendar.py` (region 1 only)
- Test: `backend/tests/test_calendar_api.py` (append)

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_calendar_api.py` (add `CardCredit, CreditCard, SecurityDividendEvent, TaxBracket, TaxInput, TaxYear` to its `from app.models import (...)` and `from app.seed import seed_tax_definitions`):

```python
async def test_calendar_card_events_and_the_card_health_row(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    venture = CreditCard(name="Venture X", slug="venture-x", annual_fee=Decimal("395.00"), rewards_currency="miles", point_value_cents=Decimal("1.7"), opened_on=date(2024, 5, 12))
    undated = CreditCard(name="SavorOne", slug="savorone", annual_fee=Decimal("0"), rewards_currency="cash", point_value_cents=Decimal("1"), opened_on=None)
    archived = CreditCard(name="Old", slug="old", annual_fee=Decimal("95"), rewards_currency="cash", point_value_cents=Decimal("1"), opened_on=date(2020, 1, 15), is_active=False)
    db.add_all([venture, undated, archived])
    await db.flush()
    db.add_all(
        [
            CardCredit(card_id=venture.id, label="$300 travel credit", annual_value=Decimal("300"), counts=True, reset_cadence="anniversary"),
            CardCredit(card_id=venture.id, label="ignored", annual_value=Decimal("50"), counts=False),
        ]
    )
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-05-01&end=2026-05-31")).json()
    cards = [e for e in body["events"] if e["source"] == "card"]
    assert [(e["type"], e["date"], e["key"], e["amount"], e["direction"]) for e in cards] == [
        ("card_anniversary", "2026-05-12", f"card:{venture.id}:2026-05-12", None, "neutral"),
        ("card_credit", "2026-05-12", f"card:credit-{cards[1]['entity_ref'].split('-')[1]}:2026-05-12", "300.00", "neutral"),
        ("card_fee", "2026-05-12", f"card:{venture.id}-fee:2026-05-12", "395.00", "out"),
    ]
    assert next(e for e in cards if e["type"] == "card_anniversary")["detail"] == "Year 2 with Venture X — falls off 5/24"
    assert [s["source"] for s in body["sources"]] == ["rsu", "espp", "dividend", "payroll", "tax", "card", "ritual", "custom"]
    assert next(s for s in body["sources"] if s["source"] == "card") == {
        "source": "card", "status": "partial", "note": "1 card(s) without an opened date — no fee or anniversary events",
    }


async def test_calendar_tax_amounts_ride_the_withholding_tracker(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    # Without a 2026 tax year: dates only, and the footer says why.
    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    q3 = next(e for e in body["events"] if e["key"] == "tax:2026-q3:2026-09-15")
    assert (q3["amount"], q3["basis"]) == (None, "scheduled")
    assert next(s for s in body["sources"] if s["source"] == "tax") == {"source": "tax", "status": "partial", "note": "no 2026 tax year entered — dates only"}

    # A priceable 2026: one W-2 input, flat brackets, a semi-monthly profile (test_withholding_api's shape).
    await seed_tax_definitions(db)
    db.add(TaxYear(year=2026, filing_status="single"))
    await db.flush()
    db.add(TaxInput(year=2026, key="latest_w2_income", value=Decimal("240000")))
    for name, table in {
        "federal": [("0.1000", "0.00")], "state": [("0.0500", "0.00")], "medicare": [("0.0145", "0.00")],
        "social_security": [("0.0620", "0.00"), ("0.0000", "168600.00")], "disability": [("0.0110", "0.00")], "capital_gains": [("0.1500", "0.00")],
    }.items():
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(TaxBracket(year=2026, jurisdiction=name, bracket_index=index, rate=Decimal(rate), threshold=Decimal(threshold)))
    db.add(PaycheckProfile(person_id=(await seed_primary(db)).id, effective_date=date(2025, 1, 1), annual_salary=Decimal("240000"), withholding_pct=Decimal("0.05")))
    await db.commit()

    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    q3 = next(e for e in body["events"] if e["key"] == "tax:2026-q3:2026-09-15")
    # 5% withholding against a ~15% liability: a shortfall, split across Sep 15 and Jan 15.
    assert q3["basis"] == "estimated" and Decimal(q3["amount"]) > 0
    assert q3["detail"].startswith("Shortfall $") and "current-year leg — $" in q3["detail"]
    assert next(s for s in body["sources"] if s["source"] == "tax")["status"] == "ok"


async def test_calendar_prices_ex_dividends_from_the_latest_stored_per_share(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    nvda = Security(ticker="NVDA", name="NVDA Inc", holding_type="stock", next_ex_div_date=date(2026, 9, 3))
    db.add(nvda)
    await db.flush()
    db.add(PositionTransaction(security_id=nvda.id, portfolio_account=acct("RH Taxable"), type="buy", shares=Decimal("10"), price=Decimal("100"), sort_index=10))
    db.add_all(
        [
            SecurityDividendEvent(security_id=nvda.id, ex_date=date(2026, 3, 4), per_share=Decimal("0.010000")),
            SecurityDividendEvent(security_id=nvda.id, ex_date=date(2026, 6, 3), per_share=Decimal("0.020000")),  # the latest wins
        ]
    )
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    [ex] = [e for e in body["events"] if e["type"] == "ex_dividend"]
    assert (ex["amount"], ex["basis"], ex["detail"]) == ("0.20", "estimated", "NVDA · 10 sh × $0.020000")
    assert next(s for s in body["sources"] if s["source"] == "dividend") == {"source": "dividend", "status": "ok", "note": None}
```

- [ ] **Step 2: Run to verify they fail** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_calendar_api.py -q -k "card_events or tax_amounts or per_share"` → FAIL.

- [ ] **Step 3: Extract `withholding_estimate` in `backend/app/api/taxes.py`**

Turn the route into a thin wrapper: everything from `await _require_year(db, year)` down to the final `return WithholdingOut(...)` moves VERBATIM into a new function directly above the route, with `today` as a parameter instead of a local:

```python
async def withholding_estimate(db: AsyncSession, year: int, today: date) -> WithholdingOut:
    """The withholding tracker's whole computation for ONE year as of `today`, callable
    from other routers (the calendar prices its tax deadlines with it — 2026-09-03 calendar
    spec §6). Raises the route's own 404 when the year has no row. Everything below is the
    former route body, unchanged."""
    await _require_year(db, year)
    feed = await _engine_feed(db, year)
    # … the rest of the former body, byte-identical …


@router.get("/years/{year}/withholding", response_model=WithholdingOut)
async def get_withholding(year: YearPath, db: AsyncSession = Depends(get_db)) -> WithholdingOut:
    """Estimated all-in withholding for the CURRENT year vs the engine's liability.

    `product_today` is the one clock this route reads (comp.py's note), read ONCE — the same
    day decides the year check, which checks have been received, and which vests are behind
    us; `withholding_estimate` never re-reads it."""
    today = product_today()
    if year != today.year:
        raise HTTPException(status_code=422, detail=NON_CURRENT_YEAR_MESSAGE)
    return await withholding_estimate(db, year, today)
```

Run `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q` → all passed, unchanged.

- [ ] **Step 4: Region 1 of `backend/app/api/calendar.py`**

Imports to add (merge alphabetically into the existing blocks): `from app.api.taxes import withholding_estimate`; `CardCredit, CreditCard, SecurityDividendEvent` in the `app.models` import; `from app.services.business_days import next_business_day`; `from app.services.calendar.generators.cards import CardCreditFacts, CardFacts`; `from app.services.calendar.generators.taxes import TaxFacts`.

Replace the tail of `_held_ex_dividends` (from `held: list[ExDividend] = []`) with:

```python
    ids = [security.id for security in candidates]
    # Ascending by ex_date, so building the dict keeps the LATEST per-share per security.
    latest_per_share: dict[int, Decimal] = dict(
        (
            await db.execute(
                select(SecurityDividendEvent.security_id, SecurityDividendEvent.per_share)
                .where(SecurityDividendEvent.security_id.in_(ids))
                .order_by(SecurityDividendEvent.security_id, SecurityDividendEvent.ex_date)
            )
        ).all()
    )
    held: list[ExDividend] = []
    for security in candidates:
        shares = shares_by_sec.get(security.id, ZERO).quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        if shares > 0:
            held.append(ExDividend(security.ticker, security.next_ex_div_date, shares, latest_per_share.get(security.id)))
    return held
```

Add two loaders after `_payday_sources`:

```python
async def _card_facts(db: AsyncSession) -> tuple[list[CardFacts], SourceHealthOut]:
    """Active cards with their COUNTED credits. A card without `opened_on` still resets its
    calendar-cadence credits but has no fee or anniversary — the footer counts those."""
    cards = list(
        (
            await db.execute(
                select(CreditCard).where(CreditCard.is_active.is_(True)).order_by(CreditCard.sort_order, CreditCard.id)
            )
        ).scalars()
    )
    if not cards:
        return [], _health("card", "off", "no cards entered")
    credits_by_card: dict[int, list[CardCreditFacts]] = {}
    for credit in (
        await db.execute(
            select(CardCredit)
            .where(CardCredit.card_id.in_([card.id for card in cards]), CardCredit.counts.is_(True))
            .order_by(CardCredit.id)
        )
    ).scalars():
        credits_by_card.setdefault(credit.card_id, []).append(
            CardCreditFacts(credit.id, credit.label, credit.annual_value, credit.reset_cadence)
        )
    facts = [
        CardFacts(card.id, card.name, card.annual_fee, card.opened_on, tuple(credits_by_card.get(card.id, [])))
        for card in cards
    ]
    undated = sum(1 for card in cards if card.opened_on is None)
    if undated:
        return facts, _health("card", "partial", f"{undated} card(s) without an opened date — no fee or anniversary events")
    return facts, _health("card", "ok")


async def _tax_facts(db: AsyncSession, window: Window, today: date) -> tuple[dict[int, TaxFacts], SourceHealthOut]:
    """ONE withholding computation for the current year when the window holds future dates,
    plus the prior year's when Apr 15 (the filing) is ahead and inside the window — the
    spec's "one computation per year touching the window" (§16, §20)."""
    if window.end < today:
        return {}, _health("tax", "ok", "statutory dates; amounts are estimated for the current year only")
    try:
        current = await withholding_estimate(db, today.year, today)
    except HTTPException:
        return {}, _health("tax", "partial", f"no {today.year} tax year entered — dates only")
    prior_balance: Decimal | None = None
    filing = next_business_day(date(today.year, 4, 15))
    if filing >= today and window.contains(filing):
        try:
            prior = await withholding_estimate(db, today.year - 1, today)
        except HTTPException:
            prior = None
        if prior is not None and prior.balance_projected is not None and prior.balance_projected > 0:
            prior_balance = prior.balance_projected
    harbor = current.safe_harbor
    if harbor is None:
        facts = TaxFacts(today.year, None, current.total.projected, None, prior_balance)
        return {today.year: facts}, _health("tax", "partial", "no safe-harbor leg yet — estimated payments unknown")
    leg = "prior-year" if harbor.threshold is not None and harbor.threshold == harbor.effective_threshold else "current-year"
    facts = TaxFacts(today.year, harbor.effective_threshold, current.total.projected, leg, prior_balance)
    note = "safe harbor met" if harbor.met else f"safe-harbor shortfall split across the remaining {today.year} payments"
    return {today.year: facts}, _health("tax", "ok", note)
```

In `_load_sources`: replace the `health.append(_health("tax", "ok", "statutory dates; …"))` line with

```python
    tax_facts, tax_health = await _tax_facts(db, window, today)
    health.append(tax_health)
    cards, card_health = await _card_facts(db)
    health.append(card_health)
```

change the dividend health to

```python
    unpriced = sum(1 for item in ex_dividends if item.per_share is None)
    if not ex_dividends:
        health.append(_health("dividend", "off", "no announced ex-dividend dates on held securities"))
    elif unpriced:
        health.append(_health("dividend", "partial", f"{unpriced} announced date(s) without a stored per-share amount"))
    else:
        health.append(_health("dividend", "ok"))
```

and add `tax_facts=tax_facts, cards=cards,` to the `Sources(...)` call.

- [ ] **Step 5: Run** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_calendar_api.py tests/calendar tests/test_withholding_api.py tests/test_assistant_context.py -q` → all passed. Plan A's `test_calendar_composes_the_whole_household_datebook` pins the health list as seven sources — update that assertion to the eight-source list (with `card` after `tax`). Then ruff.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/taxes.py backend/app/api/calendar.py backend/tests/test_calendar_api.py
git commit -m "feat(api): calendar loads card facts, tax facts via withholding_estimate, dividend per-share; eight-source health"
```

---

### Task 4: ESPP purchase contribution

**Files:**
- Modify: `backend/app/services/calendar/generators/espp.py`, `backend/tests/calendar/test_generators.py`

- [ ] **Step 1: Write the failing test** — append to `backend/tests/calendar/test_generators.py`:

```python
def test_espp_purchase_carries_the_modelers_contribution_and_stays_null_when_nothing_is_entered():
    stored = [
        StoredPeriod(1, "1H26", date(2025, 9, 1), date(2026, 2, 27), Decimal("60000"), Decimal("2500"), Decimal("0.14"))
    ]
    events = espp_events(stored, [], [], Window(date(2026, 1, 1), date(2026, 12, 31)))
    purchases = {e.event_date: e for e in events if e.type == "espp_purchase"}
    # (60000 + 2500) × 0.14 = 8750.00 — run_modeler's `contribution` line, no price needed.
    first = purchases[date(2026, 2, 27)]
    assert (first.amount, first.direction, first.basis) == (Decimal("8750.00"), "neutral", "estimated")
    assert first.detail == "1H26 · contribution ≈ $8,750.00"
    # The derived Mar–Aug row seeds from the latest stored period, so it is priced too.
    assert purchases[date(2026, 8, 31)].amount == Decimal("8750.00")
    # Nothing stored: derived rows seed at 0 → unknowable, not "$0.00".
    bare = {e.event_date: e for e in espp_events([], [], [], Window(date(2026, 1, 1), date(2026, 12, 31))) if e.type == "espp_purchase"}
    assert bare[date(2026, 8, 31)].amount is None and bare[date(2026, 8, 31)].detail == "Mar–Aug 2026"
```

- [ ] **Step 2: Run to verify it fails** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_generators.py -q -k contribution` → FAIL (amount None).

- [ ] **Step 3: Price the purchase** — in `backend/app/services/calendar/generators/espp.py` import `half_up2` alongside `plan_year_rows` (`from app.services.espp_calc import OfferingInfo, StoredPeriod, half_up2, plan_year_rows`) and replace the purchase `make_event(...)` with:

```python
            # run_modeler's contribution line — eligible earnings × the period's rate — needs
            # no price, so the calendar computes exactly the figure the modeler would (spec §6
            # espp row). Derived rows with nothing to seed from are unknowable, never $0.00.
            eligible = row.semi_annual_base + row.additional_payments
            contribution = half_up2(eligible * row.contribution_pct) if eligible > 0 else None
            events.append(
                make_event(
                    row.period_end,
                    "espp_purchase",
                    "purchase",
                    f"ESPP purchase — {row.label}",
                    "ESPP purchase",
                    detail=row.label if contribution is None else f"{row.label} · contribution ≈ ${contribution:,.2f}",
                    amount=contribution,
                    direction="neutral",  # converts already-deducted pay (spec §6)
                    basis="estimated",
                    href="/espp",
                )
            )
```

Plan A's `test_espp_events_keep_v1_dates_and_labels_with_stable_keys` asserts `e.amount is None` for all ESPP events with a stored period of base 60000 × 0.14 — change that assertion to cover only `espp_qualify` and `offering_start` (`assert all(e.amount is None for e in events if e.type != "espp_purchase")`).

- [ ] **Step 4: Run** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/calendar/test_generators.py tests/test_calendar_api.py -q` → all passed (the API datebook test's derived Aug 31 purchase stays `detail == "Mar–Aug 2026"` because nothing is stored there).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/calendar/generators/espp.py backend/tests/calendar/test_generators.py
git commit -m "feat(calendar): ESPP purchases carry the modeler's contribution"
```

---

### Task 5: `card_credits.reset_cadence` on the credit-card API

**Files:**
- Modify: `backend/app/schemas/credit_cards.py`, `backend/app/api/credit_cards.py`, `backend/tests/test_credit_cards_api.py`

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_credit_cards_api.py`:

```python
async def test_credit_reset_cadence_round_trips_defaults_and_validates(auth_client):
    card = (await auth_client.post(CARDS, json=card_body())).json()
    defaulted = await auth_client.post(
        f"{CARDS}/{card['id']}/credits", json={"label": "Travel credit", "annual_value": "300.00", "counts": True}
    )
    assert defaulted.status_code == 201, defaulted.text
    assert defaulted.json()["reset_cadence"] == "calendar"  # v1 clients keep working
    credit = defaulted.json()
    flipped = await auth_client.patch(
        f"{CARDS}/credits/{credit['id']}",
        json={"label": "Travel credit", "annual_value": "300.00", "counts": True, "reset_cadence": "anniversary"},
    )
    assert flipped.status_code == 200, flipped.text
    assert flipped.json()["reset_cadence"] == "anniversary"
    listed = (await auth_client.get(CARDS)).json()
    assert listed[0]["credits"][0]["reset_cadence"] == "anniversary"
    bad = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "x", "annual_value": "1", "counts": True, "reset_cadence": "quarterly"},
    )
    assert bad.status_code == 422
```

- [ ] **Step 2: Run to verify it fails** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_credit_cards_api.py -q -k reset_cadence` → FAIL (`KeyError: 'reset_cadence'`).

- [ ] **Step 3: Schema + router**

`backend/app/schemas/credit_cards.py` — add `from typing import Literal` and `from app.models.credit_cards import CREDIT_RESET_CADENCES, REWARDS_CURRENCIES`; then:

```python
CreditResetCadence = Literal["calendar", "anniversary"]


class CardCreditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    annual_value: Decimal
    counts: bool
    reset_cadence: CreditResetCadence


class CardCreditIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    annual_value: Decimal
    counts: bool = True
    # When the credit resets (2026-09-03 calendar spec §6): the calendar year (Jan 1) or the
    # card's opened_on anniversary. Defaults keep v1 clients valid.
    reset_cadence: CreditResetCadence = "calendar"

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("label must not be blank")
        return value
```

(`CREDIT_RESET_CADENCES` is imported so the Literal and the model constant sit side by side; add `assert set(CREDIT_RESET_CADENCES) == {"calendar", "anniversary"}` nowhere — the API test pins the vocabulary.)

`backend/app/api/credit_cards.py` — in `create_card_credit` add `reset_cadence=body.reset_cadence,` to the `CardCredit(...)` constructor; in `update_card_credit` add `credit.reset_cadence = body.reset_cadence` beside `credit.counts = body.counts`.

- [ ] **Step 4: Run** — `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest tests/test_credit_cards_api.py tests/test_models_credit_cards.py -q` → all passed. Then ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/credit_cards.py backend/app/api/credit_cards.py backend/tests/test_credit_cards_api.py
git commit -m "feat(api): card credits carry reset_cadence (calendar | anniversary)"
```

---

### Task 6: Frontend — the cadence toggle on the card detail, the `opened_on` nudge on the roster

**Files:**
- Modify: `src/types/api.ts` (credit-card block), `src/components/creditcards/CardDetail.tsx`, `src/components/creditcards/CardsPanel.tsx`, `src/pages/CreditCardsPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — in `src/pages/CreditCardsPage.test.tsx` give every credit in the fixtures `reset_cadence: 'calendar'` (the `vx()` builder's credit and any other literal), add `reset_cadence: 'calendar'` to the existing "toggling a credit's counts" expected body, and append inside the main describe:

```tsx
  it('flips a credit\'s reset cadence with a full-body PATCH', async () => {
    vi.mocked(updateCardCredit).mockResolvedValue({
      id: 11, label: '$300 travel credit', annual_value: '300.00', counts: true, reset_cadence: 'anniversary',
    })
    renderPage('/credit-cards?card=venture-x')
    fireEvent.click(await screen.findByRole('button', { name: '$300 travel credit resets on the card anniversary' }))
    await waitFor(() =>
      expect(updateCardCredit).toHaveBeenCalledWith(11, {
        label: '$300 travel credit',
        annual_value: '300.00',
        counts: true,
        reset_cadence: 'anniversary',
      }),
    )
  })

  it('adding a credit sends the calendar cadence by default', async () => {
    vi.mocked(createCardCredit).mockResolvedValue({ id: 12, label: 'Lounge', annual_value: '100.00', counts: true, reset_cadence: 'calendar' })
    renderPage('/credit-cards?card=venture-x')
    fireEvent.change(await screen.findByLabelText('Credit label'), { target: { value: 'Lounge' } })
    fireEvent.change(screen.getByLabelText('Credit annual value'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credit' }))
    await waitFor(() => expect(createCardCredit).toHaveBeenCalledWith(1, { label: 'Lounge', annual_value: '100', counts: true, reset_cadence: 'calendar' }))
  })

  it('the roster nudges for active cards without an opened date', async () => {
    renderPage()
    await screen.findByText('Card roster')
    // SAVOR carries opened_on: null in the fixture; Venture X is dated.
    expect(screen.getByText(/1 active card has no opened date/)).toBeTruthy()
    expect(screen.getByText(/fees, anniversaries and credit resets reach the calendar/)).toBeTruthy()
  })
```

(`updateCardCredit` / `createCardCredit` are already mocked in that file's `vi.mock('../api/creditCards', …)` block; `renderPage` is its existing helper.)

- [ ] **Step 2: Run to verify they fail** — `npx tsc -b; npx vitest run src/pages/CreditCardsPage.test.tsx` → tsc FAILS (`reset_cadence` not on `CardCreditOut`); the three tests FAIL.

- [ ] **Step 3: Types** — in `src/types/api.ts` (the credit-card block):

```ts
/** When a recurring credit resets (2026-09-03 calendar spec §6): the calendar year (Jan 1)
 *  or the card's opened_on anniversary. */
export type CardCreditResetCadence = 'calendar' | 'anniversary'

export interface CardCreditOut {
  id: number
  label: string
  annual_value: string
  counts: boolean
  reset_cadence: CardCreditResetCadence
}

export interface CardCreditIn {
  label: string
  annual_value: string
  counts: boolean
  reset_cadence: CardCreditResetCadence
}
```

- [ ] **Step 4: `CardDetail.tsx`** — `addCredit` sends `reset_cadence: 'calendar'`; `toggleCredit` and the delete-Undo re-POST carry `reset_cadence: credit.reset_cadence`; add beside `toggleCredit`:

```tsx
  const toggleCadence = (creditId: number) => {
    const credit = card.credits.find((c) => c.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    setError(null)
    // Full-object PATCH (house style): only the cadence changes, everything else travels back.
    updateCardCredit(creditId, {
      label: credit.label,
      annual_value: credit.annual_value,
      counts: credit.counts,
      reset_cadence: credit.reset_cadence === 'calendar' ? 'anniversary' : 'calendar',
    })
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setLocalBusy(false))
  }
```

and in the credit row's `.credit-row-actions`, before the counts button:

```tsx
                <button
                  type="button"
                  className="button"
                  aria-pressed={credit.reset_cadence === 'anniversary'}
                  aria-label={`${credit.label} resets on the card anniversary`}
                  title={
                    card.opened_on === null && credit.reset_cadence === 'anniversary'
                      ? 'Needs the card\'s opened date to land on the calendar'
                      : 'When the credit resets — the calendar dates its reset event by this'
                  }
                  disabled={anyBusy}
                  onClick={() => toggleCadence(credit.id)}
                >
                  {credit.reset_cadence === 'anniversary' ? 'Resets on anniversary' : 'Resets Jan 1'}
                </button>
```

- [ ] **Step 5: `CardsPanel.tsx`** — directly after the roster `</table>` (inside the `cards.length === 0 ? … : (…)` else branch, wrap the table and the note in a fragment):

```tsx
          {undated.length > 0 && (
            <p className="drill-hint">
              {undated.length === 1 ? '1 active card has' : `${undated.length} active cards have`} no opened date —
              add one ({undated.map((c) => c.name).join(', ')}) so fees, anniversaries and credit resets reach the
              calendar.
            </p>
          )}
```

with, above the `return`: `const undated = cards.filter((card) => card.is_active && card.opened_on === null)`.

- [ ] **Step 6: Run, lint** — `npx tsc -b && npx eslint src/components/creditcards src/types/api.ts && npx vitest run src/pages/CreditCardsPage.test.tsx src/components/creditcards` → clean; all green. (Other files that build `CardCreditIn`/`CardCreditOut` literals — `grep -rn "annual_value:" src --include=*.tsx --include=*.ts` — gain `reset_cadence: 'calendar'` if tsc names them.)

- [ ] **Step 7: Commit**

```bash
git add src/types/api.ts src/components/creditcards/CardDetail.tsx src/components/creditcards/CardsPanel.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): credit reset-cadence toggle; roster nudge for cards without an opened date"
```

---

### Task 7: Lane gate

- [ ] **Backend:** `FINANCE_TEST_DB=finance_test_cal_d ../../../backend/.venv/Scripts/python.exe -m pytest -q && ../../../backend/.venv/Scripts/python.exe -m ruff check app tests && ../../../backend/.venv/Scripts/python.exe -m ruff format --check app tests` — all green.
- [ ] **Frontend:** `npx tsc -b && npx eslint . && npx vitest run` — all green.
- [ ] Leave the branch for Plan E to merge (D merges SECOND, after B).

---

## Self-review

**Spec coverage:** §6 card row (`opened_on` anniversaries → `card_fee` when `annual_fee > 0` and `card_anniversary`; counted `card_credits` → `card_credit` on the reset date; `reset_cadence` calendar = Jan 1 / anniversary; year-two "falls off 5/24"; no `opened_on` → nothing + a health entry; fee out/confirmed, credit neutral/confirmed, anniversary null) → Tasks 1, 3; §6 tax row (current-year payment dates carry `max(0, effective_threshold − total_projected)` split evenly across the remaining dates, out/estimated; Apr 15 filing carries the prior year's positive `balance_projected`; extension null; detail is the verdict "Safe harbor met — no payment needed" / "Shortfall $X to the {prior-year, current-year} leg") → Tasks 2, 3; §6 espp row (purchase = the modeler's `contribution`, neutral, estimated) → Task 4; §6 dividend row (held shares × latest stored `per_share`, in, estimated, null when none) → Task 3 (the generator itself is Plan A's); §3/§16 `sources[]` health list completed (card row; tax and dividend notes) → Task 3; §16 `card_credits.reset_cadence` on `models/credit_cards.py` (Plan A) / `api/credit_cards.py` / `schemas/credit_cards.py` → Task 5; the roster `opened_on` nudge and the cadence UI (§18 Lane D) → Task 6; §17 pytest list (card fee incl. Feb 29 opened_on, both cadences, "falls off 5/24", NULL opened_on + health entry; harbor met → 0 with the verdict, shortfall split, missing prior year handled) → Tasks 1–3; §20 "one withholding computation per year touching the window" → Task 3's `_tax_facts`.

**Placeholders:** none.

**Type consistency:** `CardCreditFacts(credit_id, label, annual_value, reset_cadence)` and `CardFacts(card_id, name, annual_fee, opened_on, credits)` match between `cards.py`, its test, `__init__.py`'s slot annotation and `_card_facts`; `TaxFacts(year, effective_threshold, total_projected, effective_leg, prior_year_balance)` is Plan A's dataclass used positionally the same way in `test_taxes_generator.py` and `_tax_facts`; `payment_dates(tax_year)` / `nominal_dates(year)` are the module's two date helpers; `withholding_estimate(db, year, today)` is the name both the route wrapper and `_tax_facts` call; `ExDividend(ticker, ex_date, shares, per_share)` is Plan A's; `CreditResetCadence` (Python) / `CardCreditResetCadence` (TS) spell the same two values; the credit PATCH body (`label, annual_value, counts, reset_cadence`) is identical in `CardDetail.tsx` and the page tests.
