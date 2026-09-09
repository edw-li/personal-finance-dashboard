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
from app.services import clock
from app.services.assistant_context import (
    CONTEXT_CHAR_CAP,
    MONTHS_WINDOW_TIGHT,
    _decimate,
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


async def test_spending_focused_month_accepts_the_shells_short_month_grammar(db):
    """`useScope` writes `month=YYYY-MM` into the URL (src/components/shell/useScope.ts);
    date.fromisoformat refuses the reduced form, so the builder used to fall through to the
    latest month and answer about August while the reader was looking at March."""
    cat = await _seed_two_spending_months(db)
    db.add(MonthlySpending(month=date(2026, 3, 1), category_id=cat.id, amount=Decimal("1500.00")))
    db.add(MonthlyCashflow(month=date(2026, 3, 1), net_pay=Decimal("7000.00")))
    await db.commit()
    context = await build_context(db, route="/spending", search={"month": "2026-03"}, view={})
    assert context["spending"]["focused_month"] == "2026-03-01"
    assert context["spending"]["movers"][0]["value"] == "1500.00"


async def test_a_garbled_month_still_falls_back_to_the_latest(db):
    await _seed_two_spending_months(db)
    context = await build_context(db, route="/spending", search={"month": "last-tuesday"}, view={})
    assert context["spending"]["focused_month"] == "2026-08-01"


async def _seed_two_snapshots(db):
    account = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month, balance in ((date(2026, 3, 1), "10.00"), (date(2026, 8, 1), "90.00")):
        snap = NetWorthSnapshot(month=month)
        db.add(snap)
        await db.flush()
        db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal(balance)))
    await db.commit()
    return account


async def test_net_worth_builder_follows_the_viewed_month(db):
    """The ribbon's month is the whole point of the section: the summary, the per-account
    values and the echoed `viewed_month` all stand on the month the reader clicked."""
    await _seed_two_snapshots(db)
    context = await build_context(db, route="/net-worth", search={"month": "2026-03"}, view={})
    section = context["net_worth"]
    assert section["viewed_month"] == "2026-03-01"
    assert section["summary"]["month"] == "2026-03-01"
    assert section["accounts"][0]["latest_balance"] == "10.00"


async def test_net_worth_builder_falls_back_to_the_latest_month(db):
    """A month with no snapshot would 404 inside net_worth_summary and take the whole
    section down; the spending builder's rule — fall back to the latest — holds here too."""
    await _seed_two_snapshots(db)
    context = await build_context(db, route="/net-worth", search={"month": "2026-05"}, view={})
    section = context["net_worth"]
    assert section["viewed_month"] == "2026-08-01"
    assert section["summary"]["month"] == "2026-08-01"
    assert section["accounts"][0]["latest_balance"] == "90.00"


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

    # ...and that flag is NOT a section: the transparency chip would otherwise list
    # {"name": "truncated", "rows": 1} beside the real ones, reading as data the assistant
    # supposedly consulted. Asserted here because this is the only case that sets it.
    names = [s["name"] for s in await preview_sections(db, route="/spending", search={}, view={})]
    assert "truncated" not in names
    assert names == ["household", "spending"]


def test_decimate_always_keeps_the_terminal_point():
    """Plain `series[::12]` only lands on the tail when len % 12 == 1 — a horizon whose
    length is anything else would lose its FINAL value, which is the whole answer to
    "where do I end up?"."""
    assert _decimate(list(range(25))) == [0, 12, 24]  # already ends on the tail
    assert _decimate(list(range(24))) == [0, 12, 23]  # 23 would have been dropped
    assert _decimate([7]) == [7]
    assert _decimate([]) == []


async def test_projection_section_decimates_to_year_grain_keeping_the_last_month(db):
    """The /projection builder's series stay index-aligned after decimation, and the
    30-year horizon's last month survives it."""
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(account)
    await db.flush()
    snap = NetWorthSnapshot(month=clock.product_today().replace(day=1))
    db.add(snap)
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal("100000.00")))
    await db.commit()

    section = (await build_context(db, route="/projection", search={}, view={}))["projection"]
    start = date.fromisoformat(section["start_month"])
    assert section["months"][-1] == date(start.year + 30, start.month, 1).isoformat()
    lengths = {len(section[key]) for key in ("months", "projected", "coast")}
    lengths |= {len(band) for band in (section["bands"] or {}).values()}
    assert lengths == {31}  # t0 plus one point per projected year


async def _seed_investable_base(db):
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(account)
    await db.flush()
    snap = NetWorthSnapshot(month=clock.product_today().replace(day=1))
    db.add(snap)
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal("100000.00")))
    await db.commit()


async def test_projection_section_runs_the_scenario_the_page_is_showing(db):
    """The Projection page's knobs live in the URL as repeated `whatif=` entries and reach
    the drawer through useAssistantView. Without them the assistant explained the DERIVED
    run while the reader was looking at a 20% one."""
    await _seed_investable_base(db)
    section = (
        await build_context(
            db,
            route="/projection",
            search={},
            view={"whatif": ["annual_return:0.2", "years:10"]},
        )
    )["projection"]
    assert section["annual_return"] == "0.200000"
    assert section["years"] == 10
    assert section["scenario_entries"] == ["annual_return:0.2", "years:10"]


async def test_projection_section_drops_entries_the_grammar_does_not_name(db):
    """Unknown keys, unparseable values and a malformed retirement are dropped rather than
    422ing the section; `scenario_entries` echoes only what actually ran."""
    await _seed_investable_base(db)
    section = (
        await build_context(
            db,
            route="/projection",
            search={},
            view={
                "whatif": [
                    "nonsense:1",
                    "annual_return:banana",
                    "volatility:NaN",
                    "retire:soon",
                    "years:900",
                    "inflation:0.01",
                ]
            },
        )
    )["projection"]
    assert section["scenario_entries"] == ["inflation:0.01"]
    assert section["inflation"] == "0.010000"
    assert section["years"] == 30  # the builder's own horizon, not the 900 that was dropped


async def test_projection_section_reads_a_single_whatif_off_the_url(db):
    """URLSearchParams collapses repeats, so the drawer's `search` bag can only ever carry
    the LAST `whatif=`; a bare string is decoded like a one-entry list."""
    await _seed_investable_base(db)
    section = (
        await build_context(
            db, route="/projection", search={"whatif": "annual_return:0.2"}, view={}
        )
    )["projection"]
    assert section["annual_return"] == "0.200000"
    assert section["scenario_entries"] == ["annual_return:0.2"]


async def test_projection_section_with_no_scenario_still_runs_the_derived_projection(db):
    await _seed_investable_base(db)
    section = (await build_context(db, route="/projection", search={}, view={}))["projection"]
    assert section["scenario_entries"] == []
    assert section["years"] == 30


async def test_preview_summarizes_sections_with_row_counts(db):
    await _seed_two_spending_months(db)
    sections = await preview_sections(db, route="/spending", search={}, view={})
    names = [s["name"] for s in sections]
    assert names[0] == "household"
    spending = next(s for s in sections if s["name"] == "spending")
    assert spending["rows"] >= 1


async def test_spending_context_carries_both_savings_definitions(db):
    await _seed_two_spending_months(db)
    section = (await build_context(db, route="/spending", search={}, view={}))["spending"]
    assert section["living_total"] == ["2000.00", "2100.00"]
    assert section["tax_total"] == ["0.00", "0.00"]
    assert section["transfer_total"] == ["0.00", "0.00"]
    assert section["cash_savings"] == ["5000.00", "4900.00"]
    assert section["payroll_savings"] == ["0.00", "0.00"]  # no paycheck profile on file
    assert section["total_savings"] == ["5000.00", "4900.00"]
    assert section["savings_rate"] == ["0.714286", "0.700000"]
    assert section["total_savings_rate"] == ["0.714286", "0.700000"]
    # The yearly rollup rides along with its new fields, so the model can quote a year.
    assert section["yearly"]["years"][0]["months_matched"] == 2


async def test_household_context_carries_the_latest_savings_figures(db):
    await _seed_two_spending_months(db)
    spending = (await build_context(db, route="/nonexistent", search={}, view={}))["household"][
        "spending"
    ]
    assert spending["latest_month"] == "2026-08-01"
    assert spending["latest_total"] == "2100.00"
    assert spending["latest_living_spend"] == "2100.00"
    assert spending["latest_tax_paid"] == "0.00"
    assert spending["latest_transfers"] == "0.00"
    assert spending["latest_savings_rate"] == "0.700000"
    assert spending["latest_payroll_savings"] == "0.00"
    assert spending["latest_total_savings"] == "4900.00"
    assert spending["latest_total_savings_rate"] == "0.700000"
