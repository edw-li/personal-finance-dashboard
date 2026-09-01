"""Context assembly (spec §6): compact JSON bundles from the EXISTING route functions,
mirroring exactly what the user's screen shows. Imports api modules from a service —
a deliberate, acyclic reverse edge (api.assistant imports THIS module; the imported api
modules do not import it back).

Every section is fenced: a failing builder degrades to {"error": "section unavailable"}
(GET-never-rejects law) — the assistant then says that section is missing instead of
the endpoint 500ing."""

import json
import logging
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Person

logger = logging.getLogger(__name__)

CONTEXT_CHAR_CAP = 50_000
# First pass serializes this many trailing months of series data; if the payload still
# busts the cap, one retry at the tight window sets {"truncated": true}.
MONTHS_WINDOW = 24
MONTHS_WINDOW_TIGHT = 12
UP_NEXT_DAYS = 60


def jsonable(value: Any) -> Any:
    """Decimal → plain string (the wire's own spelling), dates → ISO, models → dicts."""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, BaseModel):
        return jsonable(value.model_dump())
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [jsonable(v) for v in value]
    return value


def _tail(values: list, window: int) -> list:
    return values[-window:] if window > 0 else values


def _decimate(values: list, step: int = 12) -> list:
    """Month-grain → year-grain, ALWAYS keeping the terminal point.

    A bare `values[::step]` lands on the last element only when `len(values) % step == 1`;
    any other horizon length silently drops it, and the final value is the one the model
    is most often asked about ("where do I end up in 30 years?")."""
    if len(values) <= 1:
        return list(values)
    indices = list(range(0, len(values), step))
    if indices[-1] != len(values) - 1:
        indices.append(len(values) - 1)
    return [values[index] for index in indices]


def _view_owner(view: dict) -> str | None:
    raw = view.get("owner")
    return str(raw) if raw not in (None, "", "null") else None


def _view_year(view: dict) -> int | None:
    raw = view.get("year")
    try:
        year = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return year if 1900 <= year <= 2100 else None


async def _household(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.net_worth import summary as net_worth_summary
    from app.api.portfolio import holdings as portfolio_holdings
    from app.api.spending import matrix as spending_matrix
    from app.api.taxes import get_all_summaries

    people = (await db.execute(select(Person).order_by(Person.id))).scalars().all()
    nw = await net_worth_summary(owner=None, db=db)
    port = await portfolio_holdings(owner=None, db=db)
    spend = await spending_matrix(db=db)
    latest_index = len(spend.months) - 1
    current_year = date.today().year
    tax_summaries = await get_all_summaries(db=db)
    tax = next((y for y in tax_summaries.years if y.year == current_year), None)
    return {
        "today": date.today().isoformat(),
        "people": [{"id": p.id, "name": p.name, "is_primary": p.is_primary} for p in people],
        "net_worth": {
            "month": nw.month,
            "total": nw.net_worth,
            "mom_delta": nw.mom_delta,
            "mom_pct": nw.mom_pct,
        },
        "portfolio": {
            "market_value": port.totals.market_value,
            "day_change_amount": port.totals.day_change_amount,
            "prices_as_of_oldest_quote": port.as_of,
        },
        "spending": {
            "latest_month": spend.months[latest_index] if latest_index >= 0 else None,
            "latest_total": spend.totals[latest_index] if latest_index >= 0 else None,
            "latest_savings_rate": spend.savings_rate[latest_index] if latest_index >= 0 else None,
        },
        "tax_current_year": None
        if tax is None or tax.totals is None
        else {
            "year": tax.year,
            "filing_status": tax.filing_status,
            "gross_income": tax.totals.gross_income,
            "total_tax": tax.totals.total_tax,
            "effective_rate": tax.totals.effective_rate,
        },
    }


async def _overview(db: AsyncSession, search: dict, view: dict) -> dict:
    # Spec §6 amended (plan fact 9): up-next events + the money-flow summary — attention
    # is client-side math with no backend service, and household covers its freshness feed.
    from app.api.calendar import get_calendar
    from app.api.overview import money_flow

    today = date.today()
    events = await get_calendar(start=today, end=today + timedelta(days=UP_NEXT_DAYS), db=db)
    flow = await money_flow(year=None, db=db)
    return {
        "up_next": [{"date": e.date, "type": e.type, "label": e.label} for e in events.events[:10]],
        "money_flow": flow,
    }


def _movers(months: list, series: list, categories_by_id: dict, focus_index: int) -> list[dict]:
    """The spending page's what-changed table, server-side: value, Δ vs prior month,
    Δ vs the trailing-12 average of ENTERED months (absent ≠ zero — the A6 rule)."""
    movers: list[dict] = []
    for s in series:
        value = s.values[focus_index]
        if value is None:
            continue
        prior = s.values[focus_index - 1] if focus_index >= 1 else None
        window = [v for v in s.values[max(0, focus_index - 11) : focus_index + 1] if v is not None]
        average = sum(window, Decimal("0")) / len(window) if window else None
        movers.append(
            {
                "category": categories_by_id.get(s.category_id, str(s.category_id)),
                "value": value,
                "delta_prior": None if prior is None else value - prior,
                "delta_12mo_avg": None if average is None else value - average,
            }
        )
    movers.sort(key=lambda m: abs(m["delta_prior"] or 0), reverse=True)
    return movers[:8]


def _spending_builder(window: int):
    async def _spending(db: AsyncSession, search: dict, view: dict) -> dict:
        from app.api.spending import matrix as spending_matrix
        from app.api.spending import yearly as spending_yearly

        m = await spending_matrix(db=db)
        y = await spending_yearly(db=db)
        names = {c.id: c.name for c in m.categories}
        month_param = search.get("month") or view.get("focusMonth")
        focus_index = len(m.months) - 1
        if isinstance(month_param, str):
            try:
                focus_index = m.months.index(date.fromisoformat(month_param))
            except ValueError:
                pass  # a garbled ?month falls back to the latest (the page's own rule)
        slice_from = len(m.months) - min(window, len(m.months))
        return {
            "months": _tail(m.months, window),
            "categories": [c.name for c in m.categories],
            "series": [
                {
                    "category": names.get(s.category_id, str(s.category_id)),
                    "values": _tail(s.values, window),
                    "budgets": _tail(s.budgets, window),
                }
                for s in m.series
            ],
            "totals": _tail(m.totals, window),
            "net_pay": _tail(m.net_pay, window),
            "savings_rate": _tail(m.savings_rate, window),
            "focused_month": m.months[focus_index] if m.months else None,
            "movers": _movers(m.months, m.series, names, focus_index) if m.months else [],
            "yearly": y,
            "window_note": f"series show the last {min(window, len(m.months))} months"
            if slice_from > 0
            else None,
        }

    return _spending


def _net_worth_builder(window: int):
    async def _net_worth(db: AsyncSession, search: dict, view: dict) -> dict:
        from app.api.net_worth import summary as net_worth_summary
        from app.api.net_worth import timeseries as net_worth_timeseries

        granularity = view.get("granularity")
        granularity = granularity if granularity in ("monthly", "quarterly") else "monthly"
        owner = _view_owner(view)
        ts = await net_worth_timeseries(granularity=granularity, owner=owner, db=db)
        nw = await net_worth_summary(owner=owner, db=db)
        last = len(ts.months) - 1
        value_by_account = {s.account_id: s.values[last] for s in ts.series} if last >= 0 else {}
        return {
            "owner_scope": owner or "household",
            "granularity": granularity,
            "months": _tail(ts.months, window),
            "group_totals": {g: _tail(v, window) for g, v in ts.group_totals.items()},
            "net_worth": _tail(ts.net_worth, window),
            "summary": nw,
            "accounts": [
                {
                    "name": a.name,
                    "group": a.group,
                    "is_component": a.is_component,
                    "latest_balance": value_by_account.get(a.id),
                }
                for a in ts.accounts
            ],
        }

    return _net_worth


async def _portfolio(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.portfolio import allocation_view, holdings, list_dividends, realized
    from app.api.prices import compose_refresh_status
    from app.schemas.portfolio import DividendOut

    owner = _view_owner(view)
    h = await holdings(owner=owner, db=db)
    alloc = {
        by: await allocation_view(by=by, owner=owner, db=db)
        for by in ("industry", "type", "account")
    }
    real = await realized(owner=owner, db=db)
    # list_dividends orders pay_date DESC (api/portfolio.py:427), so the RECENT dozen is
    # the HEAD of that list, not its tail.
    dividend_rows = await list_dividends(security_id=None, owner=owner, db=db)
    dividends = [DividendOut.model_validate(r, from_attributes=True) for r in dividend_rows[:12]]
    status = await compose_refresh_status(db)
    return {
        "owner_scope": owner or "household",
        "totals": h.totals,
        "as_of": h.as_of,
        "holdings": [
            {
                "ticker": row.ticker,
                "name": row.name,
                "shares": row.shares,
                "price": row.price,
                "market_value": row.market_value,
                "weight_pct": row.weight_pct,
                "unrealized_gl": row.unrealized_gl,
                "unrealized_gl_pct": row.unrealized_gl_pct,
                "yield_pct": row.yield_pct,
                "annual_income": row.annual_income,
                "xirr_pct": row.xirr_pct,
            }
            for row in h.holdings
        ],
        "allocation": alloc,
        "realized": real,
        "recent_dividends": dividends,
        "last_refresh": None
        if status.last is None
        else {
            "at": status.last.at,
            "updated": status.last.updated,
            "failed_count": len(status.last.failed),
        },
        "open_ticker": view.get("ticker"),
    }


async def _taxes(db: AsyncSession, search: dict, view: dict) -> dict:
    from fastapi import HTTPException

    from app.api.taxes import get_brackets, get_inputs, get_summary, get_withholding

    year = _view_year(view) or date.today().year
    try:
        summary = await get_summary(year=year, db=db)
        inputs = await get_inputs(year=year, db=db)
        brackets = await get_brackets(year=year, filing_status=summary.filing_status, db=db)
    except HTTPException as exc:
        # _require_year (api/taxes.py:158) 404s a year with no stored row at all — "that
        # year hasn't been started" is an answer, not a section failure.
        return {"year": year, "error": exc.detail}
    flat_inputs = [
        {
            "key": item.key,
            "label": item.label,
            "person_id": item.person_id,
            "value": item.value,
        }
        for section in inputs.sections
        for item in section.items
        if item.value is not None
    ]
    withholding = None
    if year == date.today().year:
        try:
            withholding = await get_withholding(year=year, db=db)
        except HTTPException:
            withholding = None  # settled/ineligible year: the endpoint's own 422 refusal
    return {
        "year": year,
        "summary": summary,
        "inputs": flat_inputs,
        "brackets": brackets,
        "withholding": withholding,
    }


async def _espp(db: AsyncSession, search: dict, view: dict) -> dict:
    from fastapi import HTTPException

    from app.api.espp import list_lots, modeler

    lots = await list_lots(db=db)
    try:
        model: Any = await modeler(
            subscription_price=None, purchase_fmv=None, carry_forward=None, year=None, db=db
        )
    except HTTPException as exc:
        # "no live price for the espp ticker" (api/espp.py:559) — the page shows the same
        # empty modeler beside a full lots table, so the lots must NOT go down with it.
        model = {"error": exc.detail}
    return {"lots": lots, "modeler": model}


async def _comp(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.comp import list_events, vesting_schedule

    events = await list_events(db=db)
    schedule = await vesting_schedule(db=db)
    return {
        "focal_events": events,
        "ticker": schedule.ticker,
        "latest_price": schedule.latest_price,
        "grants": schedule.grants,
        "tiles": schedule.tiles,
        "vest_days": schedule.vest_days[-24:],
        "warnings": schedule.warnings,
    }


async def _paycheck(db: AsyncSession, search: dict, view: dict) -> dict:
    from fastapi import HTTPException

    from app.api.paycheck import get_breakdown

    person_raw = view.get("person")
    person_id = (
        int(person_raw) if isinstance(person_raw, int | str) and str(person_raw).isdigit() else None
    )
    try:
        breakdown = await get_breakdown(profile_id=None, person_id=person_id, db=db)
    except HTTPException as exc:
        return {"error": exc.detail}  # "no paycheck profiles" is an answer, not a failure
    return {"breakdown": breakdown}


async def _credit_cards(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.credit_cards import _all_rates, list_credit_cards, list_reward_categories
    from app.schemas.credit_cards import RewardCategoryOut, RewardRateOut

    cards = await list_credit_cards(db=db)
    categories = [
        RewardCategoryOut.model_validate(c, from_attributes=True)
        for c in await list_reward_categories(db=db)
    ]
    rates = [RewardRateOut.model_validate(r, from_attributes=True) for r in await _all_rates(db)]
    return {"cards": cards, "reward_categories": categories, "rates": rates}


async def _projection(db: AsyncSession, search: dict, view: dict) -> dict:
    from fastapi import HTTPException

    from app.api.projection import projection

    try:
        p = await projection(
            annual_return=None,
            monthly_contribution=None,
            annual_spend=None,
            swr=None,
            years=30,
            volatility=None,
            inflation=None,
            contribution_growth=None,
            retire=None,
            db=db,
        )
    except HTTPException as exc:
        return {"error": exc.detail}  # NO_SNAPSHOTS on a fresh database
    payload = p.model_dump()
    # Decimate month-grain series to year-grain: the model reads trends, not 360 points.
    # Every series is sampled at the SAME indices, so index i still names one month across
    # all of them — and the horizon's last month survives (see _decimate).
    for series_key in ("months", "projected", "coast"):
        payload[series_key] = _decimate(payload[series_key])
    if payload.get("bands"):
        payload["bands"] = {k: _decimate(v) for k, v in payload["bands"].items()}
    return payload


async def _calendar(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.calendar import get_calendar

    today = date.today()
    events = await get_calendar(start=today, end=today + timedelta(days=UP_NEXT_DAYS), db=db)
    return {"events": events.events}


async def _update(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.net_worth import timeseries as net_worth_timeseries

    ts = await net_worth_timeseries(granularity="monthly", owner=None, db=db)
    return {
        "covered_months": ts.months,
        "note": "unsaved wizard entries are client-side drafts the assistant cannot see",
    }


Builder = Callable[[AsyncSession, dict, dict], Awaitable[dict]]


# route → (section name, builder). Window-parameterized builders are FACTORIES so the
# cap retry can rebuild tighter (see build_context).
def _builders(window: int) -> dict[str, tuple[str, Builder]]:
    return {
        "/": ("overview", _overview),
        "/net-worth": ("net_worth", _net_worth_builder(window)),
        "/portfolio": ("portfolio", _portfolio),
        "/spending": ("spending", _spending_builder(window)),
        "/credit-cards": ("credit_cards", _credit_cards),
        "/paycheck": ("paycheck", _paycheck),
        "/comp": ("comp", _comp),
        "/espp": ("espp", _espp),
        "/taxes": ("taxes", _taxes),
        "/projection": ("projection", _projection),
        "/calendar": ("calendar", _calendar),
        "/update": ("update", _update),
    }


# Module-level default map — tests monkeypatch entries here (error-isolation test).
ROUTE_BUILDERS: dict[str, tuple[str, Builder]] = _builders(MONTHS_WINDOW)


async def _assemble(db: AsyncSession, route: str, search: dict, view: dict, builders: dict) -> dict:
    context: dict[str, Any] = {}
    try:
        context["household"] = jsonable(await _household(db, search, view))
    except Exception:
        logger.exception("assistant household summary failed")
        context["household"] = {"error": "section unavailable"}
    entry = builders.get(route)
    if entry is not None:
        name, builder = entry
        try:
            context[name] = jsonable(await builder(db, search, view))
        except Exception:
            logger.exception("assistant context builder failed: %s", route)
            context[name] = {"error": "section unavailable"}
    return context


async def build_context(db: AsyncSession, *, route: str, search: dict, view: dict) -> dict:
    context = await _assemble(db, route, search, view, ROUTE_BUILDERS)
    if len(json.dumps(context)) > CONTEXT_CHAR_CAP:
        context = await _assemble(db, route, search, view, _builders(MONTHS_WINDOW_TIGHT))
        context["truncated"] = True
    return context


async def preview_sections(db: AsyncSession, *, route: str, search: dict, view: dict) -> list[dict]:
    """The transparency chip's outline: section names + row counts, NO values beyond
    what a count reveals — runs the same builders so it can never drift from chat."""
    context = await build_context(db, route=route, search=search, view=view)

    def _rows(section: Any) -> int:
        if isinstance(section, list):
            return len(section)
        if isinstance(section, dict):
            list_lengths = [len(v) for v in section.values() if isinstance(v, list)]
            return max(list_lengths) if list_lengths else len(section)
        return 1

    return [{"name": name, "rows": _rows(section)} for name, section in context.items()]
