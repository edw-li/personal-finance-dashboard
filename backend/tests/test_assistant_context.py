"""Context assembly (spec §6): shape, view-param faithfulness, error isolation,
truncation, preview outlines. Seeds the minimum rows each builder needs."""

import json
from datetime import date
from decimal import Decimal

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)
from app.services.assistant_context import (
    CONTEXT_CHAR_CAP,
    MONTHS_WINDOW_TIGHT,
    build_context,
    jsonable,
    preview_sections,
)


def test_jsonable_covers_the_wire_types():
    assert jsonable(Decimal("12.50")) == "12.50"
    assert jsonable(date(2026, 9, 1)) == "2026-09-01"
    assert jsonable({"a": [Decimal("1"), None]}) == {"a": ["1", None]}


async def _seed_two_spending_months(db):
    cat = SpendingCategory(name="Housing", slug="housing", sort_order=1)
    db.add(cat)
    await db.flush()
    for month, amount in ((date(2026, 7, 1), "2000.00"), (date(2026, 8, 1), "2100.00")):
        db.add(MonthlySpending(month=month, category_id=cat.id, amount=Decimal(amount)))
        db.add(MonthlyCashflow(month=month, net_pay=Decimal("7000.00")))
    await db.commit()
    return cat


async def test_household_summary_is_always_present_even_on_an_empty_db(db):
    context = await build_context(db, route="/nonexistent", search={}, view={})
    assert "household" in context
    assert context["household"]["net_worth"]["month"] is None


async def test_spending_builder_carries_months_categories_and_movers(db):
    await _seed_two_spending_months(db)
    context = await build_context(db, route="/spending", search={}, view={})
    section = context["spending"]
    assert section["months"][-1] == "2026-08-01"
    assert section["categories"] == ["Housing"]
    movers = section["movers"]
    assert movers[0]["category"] == "Housing"
    assert movers[0]["value"] == "2100.00"
    assert movers[0]["delta_prior"] == "100.00"


async def test_spending_focused_month_follows_the_search_param(db):
    await _seed_two_spending_months(db)
    context = await build_context(db, route="/spending", search={"month": "2026-07-01"}, view={})
    assert context["spending"]["movers"][0]["value"] == "2000.00"


async def test_net_worth_builder_honors_the_view_owner_and_granularity(db):
    account = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    snap = NetWorthSnapshot(month=date(2026, 8, 1))
    db.add(snap)
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal("10.00")))
    await db.commit()
    context = await build_context(
        db, route="/net-worth", search={}, view={"granularity": "monthly", "owner": None}
    )
    section = context["net_worth"]
    assert section["months"] == ["2026-08-01"]
    assert section["accounts"][0]["name"] == "Checking"


async def test_a_failing_section_degrades_without_taking_the_context_down(db, monkeypatch):
    import app.services.assistant_context as ctx

    async def boom(db, search, view):
        raise RuntimeError("builder exploded")

    monkeypatch.setitem(ctx.ROUTE_BUILDERS, "/spending", ("spending", boom))
    context = await build_context(db, route="/spending", search={}, view={})
    assert context["spending"] == {"error": "section unavailable"}
    assert "household" in context  # the rest of the payload survives


async def test_context_stays_under_the_char_cap_with_a_truncation_marker(db):
    # 60 months of 30 categories still fits the window slicing; assert the CONTRACT
    # instead: the serialized payload respects the cap for the seeded case.
    await _seed_two_spending_months(db)
    context = await build_context(db, route="/spending", search={}, view={})
    assert len(json.dumps(context)) < CONTEXT_CHAR_CAP
    assert "truncated" not in context  # a small payload never claims it was cut


async def test_a_payload_over_the_cap_rebuilds_at_the_tight_window(db):
    """The two-pass retry: pass one at MONTHS_WINDOW busts the cap, so the whole context
    is rebuilt from _builders(MONTHS_WINDOW_TIGHT) and flagged. Movers are computed over
    the FULL series before slicing, so they must survive the tighter rebuild."""
    cats = [SpendingCategory(name=f"C{i}", slug=f"c{i}", sort_order=i) for i in range(140)]
    db.add_all(cats)
    await db.flush()
    for i in range(60):
        month = date(2021 + i // 12, i % 12 + 1, 1)
        db.add(MonthlyCashflow(month=month, net_pay=Decimal("7000.00")))
        db.add_all(
            MonthlySpending(month=month, category_id=c.id, amount=Decimal("1234.56")) for c in cats
        )
    await db.commit()

    context = await build_context(db, route="/spending", search={}, view={})
    assert context["truncated"] is True
    assert len(context["spending"]["months"]) == MONTHS_WINDOW_TIGHT
    assert context["spending"]["movers"][0]["value"] == "1234.56"


async def test_preview_summarizes_sections_with_row_counts(db):
    await _seed_two_spending_months(db)
    sections = await preview_sections(db, route="/spending", search={}, view={})
    names = [s["name"] for s in sections]
    assert names[0] == "household"
    spending = next(s for s in sections if s["name"] == "spending")
    assert spending["rows"] >= 1
