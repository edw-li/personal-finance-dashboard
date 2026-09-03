"""Read-only tools (spec §7): OpenAI function schemas + the in-process dispatcher.
Every failure is an error RESULT handed back to the model (it can correct itself) —
never an exception into the stream."""

import json
import logging
from datetime import date

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.assistant_context import ROUTE_BUILDERS, jsonable

logger = logging.getLogger(__name__)

TOOL_RESULT_CHAR_CAP = 20_000

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_page_data",
            "description": (
                "Fetch another dashboard page's data bundle for cross-page questions. "
                "Pages: / (overview), /net-worth, /portfolio, /spending, /credit-cards, "
                "/paycheck, /comp, /espp, /taxes, /projection, /calendar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "page": {"type": "string", "description": "route path, e.g. /spending"},
                    "params": {
                        "type": "object",
                        "description": (
                            "optional view params: year, month (YYYY-MM-01), "
                            "owner (person id or 'joint'), ticker, person"
                        ),
                    },
                },
                "required": ["page"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_month_detail",
            "description": "One spending month's full per-category breakdown and net pay.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {
                        "type": "string",
                        "description": "first-of-month ISO date, e.g. 2025-12-01",
                    }
                },
                "required": ["month"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_tax_whatif",
            "description": (
                "Model a tax scenario for a year through the app's deterministic what-if "
                "engine — nothing is stored. sales: [{security_id, shares, price?, term?}] "
                "(price omitted = latest quote; term 'long'|'short'). espp_sales: "
                "[{lot_id, sale_price?}]. overrides: {input_key: amount|null}."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer"},
                    "sales": {"type": "array", "items": {"type": "object"}},
                    "espp_sales": {"type": "array", "items": {"type": "object"}},
                    "overrides": {"type": "object"},
                },
                "required": ["year"],
            },
        },
    },
]


def _capped(result: dict) -> dict:
    if len(json.dumps(result)) > TOOL_RESULT_CHAR_CAP:
        capped: dict = {
            "truncated": True,
            "note": "result exceeded the size cap; ask narrower",
        }
        # The sandbox link outlives the truncation it is most needed after: a scenario big
        # enough to blow the cap is exactly the one whose numbers the reader has to go and
        # look at, and ~90 characters of URL is not what pushed it over.
        if isinstance(result.get("sandbox_url"), str):
            capped["sandbox_url"] = result["sandbox_url"]
        return capped
    return result


async def _get_page_data(db: AsyncSession, args: dict) -> dict:
    page = args.get("page")
    entry = ROUTE_BUILDERS.get(str(page))
    if entry is None:
        return {"error": f"unknown page: {page}"}
    params = args.get("params") or {}
    if not isinstance(params, dict):
        params = {}
    _name, builder = entry
    # `search` is the URL's spelling (strings); `view` is the page's own state, which the
    # builders read typed (owner ids, granularity) — so the raw params go through there.
    section = await builder(db, {k: str(v) for k, v in params.items()}, params)
    # The builder's own compact JSON, unwrapped (spec §7): the model named the page in the
    # call, so a {section_name: …} envelope would only add a level to reach through.
    return _capped(jsonable(section))


async def _get_month_detail(db: AsyncSession, args: dict) -> dict:
    from app.api.spending import get_month, list_categories

    try:
        month = date.fromisoformat(str(args.get("month")))
    except ValueError:
        return {"error": f"month must be an ISO first-of-month date, got {args.get('month')!r}"}
    try:
        payload = await get_month(month=month, db=db)
        names = {c.id: c.name for c in await list_categories(db=db)}
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    return _capped(
        jsonable(
            {
                "month": payload.month,
                "exists": payload.exists,
                "net_pay": payload.net_pay,
                "amounts": [
                    {"category": names.get(a.category_id, str(a.category_id)), "amount": a.amount}
                    for a in payload.amounts
                ],
                "budgets": [
                    {"category": names.get(b.category_id, str(b.category_id)), "amount": b.amount}
                    for b in payload.budgets
                ],
            }
        )
    )


async def _run_tax_whatif(db: AsyncSession, args: dict) -> dict:
    from app.api.taxes import what_if
    from app.schemas.taxes import WhatIfIn
    from app.services.sandbox_links import sandbox_link, whatif_entries

    try:
        body = WhatIfIn(
            year=args.get("year"),
            sales=args.get("sales") or [],
            espp_sales=args.get("espp_sales") or [],
            overrides=args.get("overrides") or {},
        )
    except ValidationError as exc:
        return {"error": f"invalid what-if arguments: {exc.errors()[:3]}"}
    try:
        out = await what_if(body=body, db=db)
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    # Compact (spec §7): both totals, the delta, details, warnings — never the two full
    # jurisdiction-by-jurisdiction summaries (they'd triple the tokens for no answer).
    return _capped(
        jsonable(
            {
                "year": out.year,
                "baseline_totals": out.baseline.totals,
                "scenario_totals": out.scenario.totals,
                "delta": out.delta,
                "changed_inputs": out.changed_inputs,
                "sale_details": out.sale_details,
                "espp_sale_details": out.espp_sale_details,
                "warnings": out.warnings,
                # The seam (spec §12): where the drawer can open THIS scenario live.
                # Encoded from the validated body, so the link models exactly what was
                # modelled -- the year included, being the scope it is only true within.
                "sandbox_url": sandbox_link("taxes", whatif_entries(body), year=body.year),
            }
        )
    )


async def execute_tool(db: AsyncSession, name: str, args: dict) -> dict:
    try:
        if name == "get_page_data":
            return await _get_page_data(db, args)
        if name == "get_month_detail":
            return await _get_month_detail(db, args)
        if name == "run_tax_whatif":
            return await _run_tax_whatif(db, args)
    except Exception:
        logger.exception("assistant tool failed: %s", name)
        return {"error": f"tool {name} failed internally"}
    return {"error": f"unknown tool: {name}"}
