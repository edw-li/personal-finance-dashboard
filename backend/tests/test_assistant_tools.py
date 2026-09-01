"""The three read-only tools (spec §7)."""

import json
from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory, TaxYear
from app.services.assistant_tools import TOOL_SCHEMAS, execute_tool


def test_tool_schemas_are_openai_shaped_and_exactly_three():
    assert [t["function"]["name"] for t in TOOL_SCHEMAS] == [
        "get_page_data",
        "get_month_detail",
        "run_tax_whatif",
    ]
    for tool in TOOL_SCHEMAS:
        assert tool["type"] == "function"
        assert "parameters" in tool["function"]
        assert tool["function"]["description"]


async def test_unknown_tool_returns_an_error_result_never_raises(db):
    result = await execute_tool(db, "rm_rf", {})
    assert result == {"error": "unknown tool: rm_rf"}


async def test_get_month_detail(db):
    cat = SpendingCategory(name="Travel", slug="travel", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 8, 1), category_id=cat.id, amount=Decimal("810.20")))
    db.add(MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("7264.46")))
    await db.commit()
    result = await execute_tool(db, "get_month_detail", {"month": "2026-08-01"})
    assert result["month"] == "2026-08-01"
    assert result["amounts"] == [{"category": "Travel", "amount": "810.20"}]
    assert result["net_pay"] == "7264.46"


async def test_get_month_detail_rejects_garbage_month(db):
    result = await execute_tool(db, "get_month_detail", {"month": "not-a-month"})
    assert "error" in result


async def test_get_page_data_reuses_the_context_builders(db):
    result = await execute_tool(db, "get_page_data", {"page": "/calendar"})
    assert "events" in result


async def test_get_page_data_unknown_page(db):
    result = await execute_tool(db, "get_page_data", {"page": "/nope"})
    assert "error" in result


async def test_run_tax_whatif_requires_an_existing_year(db):
    result = await execute_tool(db, "run_tax_whatif", {"year": 2026})
    assert "error" in result  # no tax year seeded → the route's 404, surfaced as a result


async def test_run_tax_whatif_compacts_the_engine_answer(db):
    db.add(TaxYear(year=2026))
    await db.commit()
    result = await execute_tool(db, "run_tax_whatif", {"year": 2026, "overrides": {}})
    # An empty scenario still answers: baseline == scenario, delta zeros.
    assert set(result) >= {"year", "baseline_totals", "scenario_totals", "delta", "warnings"}
    assert json.dumps(result)  # fully jsonable
