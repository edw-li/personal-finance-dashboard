import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import (
    DividendPayment,
    Person,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    Security,
    SecurityDividendEvent,
)
from app.schemas.portfolio import (
    AllocationOut,
    AllocationSlice,
    DividendCreate,
    DividendEventOut,
    DividendOut,
    DividendUpdate,
    HoldingOut,
    HoldingsOut,
    HoldingsTotals,
    PortfolioAccountOut,
    PortfolioAccountUpdate,
    PortfolioHistoryOut,
    RealizedOut,
    RealizedRow,
    SecurityCreate,
    SecurityOut,
    SecurityUpdate,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
from app.services.money import (
    MONEY_MAX_ABS_10_2,
    MONEY_MAX_ABS_10_4,
    MONEY_MAX_ABS_12_2,
    quantize_money,
    quantize_pct,
    quantize_price,
    quantize_shares,
    require_reasonable_date,
)
from app.services.portfolio_accounts import portfolio_owner_clause, resolve_portfolio_account
from app.services.portfolio_calc import (
    allocation,
    build_holdings,
    fold_transactions,
    load_portfolio,
)
from app.services.value_history import baseline_closes_for, contribution_benchmark

router = APIRouter(
    prefix="/portfolio", tags=["portfolio"], dependencies=[Depends(get_current_user)]
)

# Must START alphanumeric: the provider maps '.' -> '-' for Yahoo, so ".NVDA"/"-NVDA"
# style degenerates would collide on one symbol while occupying two rows.
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")


def _normalize_ticker(raw: str) -> str:
    ticker = raw.strip().upper()
    if not TICKER_RE.fullmatch(ticker):
        raise HTTPException(
            status_code=422,
            detail="ticker must be 1-20 characters of A-Z, 0-9, dot or dash, starting alphanumeric",
        )
    return ticker


def _validated_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    return name


def _validated_account(raw: str) -> str:
    # A whitespace-only label passes min_length=1 and would fold a position under the
    # empty string (Task 9 review) — same posture as _validated_name.
    account = raw.strip()
    if not account:
        raise HTTPException(status_code=422, detail="account must not be blank")
    return account


# A bounded string, not an int: the value is either a person id or the literal "joint", and
# a length cap keeps a garbage query out of the parser. Same shape as net_worth.py's
# OwnerQuery — the SEMANTICS are shared in services/ownership.parse_owner.
OwnerQuery = Annotated[str | None, Query(max_length=32)]


def _owner_filter(owner: str | None) -> ColumnElement[bool] | None:
    """HTTP contract only — portfolio_owner_clause owns the SEMANTICS. Absent means the
    whole household, and the endpoint's answer is then byte-identical to the
    pre-ownership one."""
    if owner is None:
        return None
    try:
        return portfolio_owner_clause(owner)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/accounts", response_model=list[PortfolioAccountOut])
async def list_portfolio_accounts(db: AsyncSession = Depends(get_db)) -> list[PortfolioAccount]:
    """Every label the ledger has ever seen, label-ordered — the roster Settings edits.
    Rows are never deleted here: a label with no live transactions is still the identity
    of the history that used it."""
    return list(
        (await db.execute(select(PortfolioAccount).order_by(PortfolioAccount.label))).scalars()
    )


@router.patch("/accounts/{account_id}", response_model=PortfolioAccountOut)
async def update_portfolio_account(
    account_id: int, body: PortfolioAccountUpdate, db: AsyncSession = Depends(get_db)
) -> PortfolioAccount:
    """Ownership only. `person_id: null` is a REAL write — it is how an account becomes
    joint (the net-worth NULLABLE_ACCOUNT_FIELDS posture) — while an absent key is a no-op
    request. The label is immutable (PortfolioAccountUpdate forbids extras)."""
    account = await db.get(PortfolioAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="portfolio account not found")
    provided = body.model_dump(exclude_unset=True)
    if "person_id" not in provided:
        return account
    person_id = provided["person_id"]
    # FK target checked BEFORE the write, so a bad id 422s with a sentence instead of
    # surfacing asyncpg's ForeignKeyViolationError as a 500 (_validate_links' rule).
    if person_id is not None and (await db.get(Person, person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {person_id}")
    account.person_id = person_id
    await db.commit()
    return account


def _validated_annual_dividend(value: Decimal) -> Decimal:
    quantized = quantize_price(value, "annual_dividend", max_abs=MONEY_MAX_ABS_10_4)
    # Check the RAW value too: "-0.00001" quantizes to -0.0000 which compares == 0.
    if value < 0 or quantized < 0:
        raise HTTPException(status_code=422, detail="annual_dividend must be >= 0")
    return quantized


@router.get("/securities", response_model=list[SecurityOut])
async def list_securities(db: AsyncSession = Depends(get_db)) -> list[Security]:
    return list((await db.execute(select(Security).order_by(Security.ticker))).scalars())


@router.post("/securities", response_model=SecurityOut, status_code=201)
async def create_security(body: SecurityCreate, db: AsyncSession = Depends(get_db)) -> Security:
    ticker = _normalize_ticker(body.ticker)
    name = _validated_name(body.name)
    annual = body.annual_dividend
    if annual is not None:
        annual = _validated_annual_dividend(annual)
    ex_div_date = body.ex_div_date
    if ex_div_date is not None:
        ex_div_date = require_reasonable_date(ex_div_date, "ex_div_date")
    existing = (
        (await db.execute(select(Security).where(Security.ticker == ticker))).scalars().first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"security {ticker!r} already exists")
    security = Security(
        ticker=ticker,
        name=name,
        industry=body.industry,
        holding_type=body.holding_type,
        is_manual_priced=body.is_manual_priced,
        annual_dividend=annual,
        ex_div_date=ex_div_date,
    )
    db.add(security)
    await db.commit()
    return security


async def _get_security(db: AsyncSession, security_id: int) -> Security:
    security = await db.get(Security, security_id)
    if security is None:
        raise HTTPException(status_code=404, detail="security not found")
    return security


# ticker is the importer's natural key — PATCH never rewrites it (account-slug posture).
NON_NULLABLE_SECURITY_FIELDS = {"name", "holding_type", "is_manual_priced", "is_active"}


@router.patch("/securities/{security_id}", response_model=SecurityOut)
async def update_security(
    security_id: int, body: SecurityUpdate, db: AsyncSession = Depends(get_db)
) -> Security:
    security = await _get_security(db, security_id)
    # Validate EVERY field before touching the ORM object: a 422 raised halfway through a
    # multi-field PATCH would otherwise leave half the row mutated for the next autoflush.
    validated: dict[str, object] = {}
    for field_name, value in body.model_dump(exclude_unset=True).items():
        if value is None and field_name in NON_NULLABLE_SECURITY_FIELDS:
            continue  # explicit null on a NOT NULL column = no-op request
        if value is not None:
            if field_name == "name":
                value = _validated_name(value)
            elif field_name == "annual_dividend":
                value = _validated_annual_dividend(value)
            elif field_name == "ex_div_date":
                value = require_reasonable_date(value, "ex_div_date")
        validated[field_name] = value
    for field_name, value in validated.items():
        setattr(security, field_name, value)
    await db.commit()
    return security


@router.delete("/securities/{security_id}", status_code=204)
async def delete_security(security_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    security = await _get_security(db, security_id)
    txn_count = (
        await db.execute(
            select(func.count())
            .select_from(PositionTransaction)
            .where(PositionTransaction.security_id == security_id)
        )
    ).scalar_one()
    dividend_count = (
        await db.execute(
            select(func.count())
            .select_from(DividendPayment)
            .where(DividendPayment.security_id == security_id)
        )
    ).scalar_one()
    if txn_count or dividend_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"security has {txn_count} transactions and {dividend_count} dividends"
                " — deactivate it instead"
            ),
        )
    await db.delete(security)  # latest/history price rows CASCADE — derived data
    await db.commit()
    return Response(status_code=204)


def _validated_txn_fields(
    type_: str,
    shares: Decimal | None,
    price: Decimal | None,
    fees: Decimal | None,
    split_factor: Decimal | None,
) -> dict:
    """Type-shape law: buy/sell carry shares>0 + price>=0 (+ optional fees>=0, no
    split_factor); split carries split_factor>0 ONLY — shares/price stored as the
    Plan 1 dummy 0s so folding reads only the factor."""
    if type_ == "split":
        if split_factor is None:
            raise HTTPException(status_code=422, detail="split requires split_factor")
        factor = quantize_price(split_factor, "split_factor", max_abs=MONEY_MAX_ABS_10_4)
        if factor <= 0:
            raise HTTPException(status_code=422, detail="split_factor must be positive")
        if shares not in (None, Decimal("0")) or price not in (None, Decimal("0")):
            raise HTTPException(
                status_code=422, detail="split rows carry no shares/price (dummy 0s)"
            )
        if fees is not None:
            raise HTTPException(status_code=422, detail="split rows carry no fees")
        return {
            # Scale-explicit dummies: every numeric crosses the wire at its column scale.
            "shares": Decimal("0.000000"),
            "price": Decimal("0.0000"),
            "fees": None,
            "split_factor": factor,
        }
    if split_factor is not None:
        raise HTTPException(status_code=422, detail=f"{type_} rows carry no split_factor")
    if shares is None or price is None:
        raise HTTPException(status_code=422, detail=f"{type_} requires shares and price")
    quantized_shares = quantize_shares(shares, "shares")
    if quantized_shares <= 0:
        raise HTTPException(status_code=422, detail="shares must be positive")
    quantized_price = quantize_price(price, "price")
    if quantized_price < 0:
        raise HTTPException(status_code=422, detail="price must be >= 0")
    quantized_fees = None
    if fees is not None:
        quantized_fees = quantize_money(fees, "fees", max_abs=MONEY_MAX_ABS_10_2)
        if quantized_fees < 0:
            raise HTTPException(status_code=422, detail="fees must be >= 0")
    return {
        "shares": quantized_shares,
        "price": quantized_price,
        "fees": quantized_fees,
        "split_factor": None,
    }


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    security_id: int | None = None,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> list[PositionTransaction]:
    query = select(PositionTransaction).order_by(
        PositionTransaction.sort_index, PositionTransaction.id
    )
    if security_id is not None:
        query = query.where(PositionTransaction.security_id == security_id)
    owner_filter = _owner_filter(owner)
    if owner_filter is not None:
        query = query.join(
            PortfolioAccount, PortfolioAccount.id == PositionTransaction.portfolio_account_id
        ).where(owner_filter)
    return list((await db.execute(query)).scalars())


@router.post("/transactions", response_model=TransactionOut, status_code=201)
async def create_transaction(
    body: TransactionCreate, db: AsyncSession = Depends(get_db)
) -> PositionTransaction:
    if await db.get(Security, body.security_id) is None:
        raise HTTPException(status_code=422, detail=f"unknown security_id: {body.security_id}")
    fields = _validated_txn_fields(body.type, body.shares, body.price, body.fees, body.split_factor)
    if body.txn_date is not None:
        require_reasonable_date(body.txn_date, "txn_date")
    max_index = (
        await db.execute(select(func.coalesce(func.max(PositionTransaction.sort_index), 0)))
    ).scalar_one()
    # Resolve only after every 422 above: get-or-create flushes, and a label minted for a
    # request that then fails validation would be a row nobody asked for.
    account = await resolve_portfolio_account(db, _validated_account(body.account))
    # UI rows fold chronologically LAST (locked decision). A later sheet import may mint
    # the same sort_index for a new row — folding tie-breaks on id; accepted.
    txn = PositionTransaction(
        security_id=body.security_id,
        # The ROW, not the id: the response serializes `account` off this relationship.
        portfolio_account=account,
        type=body.type,
        txn_date=body.txn_date,
        sort_index=max_index + 10,
        source="ui",
        notes=body.notes,
        **fields,
    )
    db.add(txn)
    await db.commit()
    return txn


async def _get_transaction(db: AsyncSession, txn_id: int) -> PositionTransaction:
    txn = await db.get(PositionTransaction, txn_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return txn


@router.patch("/transactions/{txn_id}", response_model=TransactionOut)
async def update_transaction(
    txn_id: int, body: TransactionUpdate, db: AsyncSession = Depends(get_db)
) -> PositionTransaction:
    txn = await _get_transaction(db, txn_id)
    provided = body.model_dump(exclude_unset=True)
    # Validate the MERGED row so a type flip can't leave an inconsistent shape. An explicit
    # null on the NOT NULL type column reads as a no-op request (update_security posture).
    merged_type = provided.get("type") or txn.type
    merged = _validated_txn_fields(
        merged_type,
        provided.get("shares", txn.shares),
        provided.get("price", txn.price),
        provided.get("fees", txn.fees),
        provided.get("split_factor", txn.split_factor),
    )
    if "account" in provided:
        if provided["account"] is None:
            raise HTTPException(status_code=422, detail="account cannot be null")
        provided["account"] = _validated_account(provided["account"])
    if "txn_date" in provided and provided["txn_date"] is not None:
        require_reasonable_date(provided["txn_date"], "txn_date")
    # Resolve after the last raise and before the first mutation: get-or-create flushes,
    # and a flush of a half-mutated row is exactly what the rule below forbids.
    new_account = (
        await resolve_portfolio_account(db, provided["account"]) if "account" in provided else None
    )
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    if new_account is not None:
        txn.portfolio_account = new_account
    if "txn_date" in provided:
        txn.txn_date = provided["txn_date"]
    if "notes" in provided:
        txn.notes = provided["notes"]
    txn.type = merged_type
    txn.shares = merged["shares"]
    txn.price = merged["price"]
    txn.fees = merged["fees"]
    txn.split_factor = merged["split_factor"]
    # source/sort_index are ownership metadata — never PATCHable. Edits to
    # source='import' rows are legal but the next re-import reverts them (sheet wins).
    await db.commit()
    return txn


@router.delete("/transactions/{txn_id}", status_code=204)
async def delete_transaction(txn_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    txn = await _get_transaction(db, txn_id)
    await db.delete(txn)  # import-owned rows resurrect on the next re-import — documented
    await db.commit()
    return Response(status_code=204)


@router.get("/dividends", response_model=list[DividendOut])
async def list_dividends(
    security_id: int | None = None,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> list[DividendPayment]:
    query = select(DividendPayment).order_by(
        DividendPayment.pay_date.desc(), DividendPayment.id.desc()
    )
    if security_id is not None:
        query = query.where(DividendPayment.security_id == security_id)
    owner_filter = _owner_filter(owner)
    if owner_filter is not None:
        # Inner join: a dividend with no portfolio account is unattributed and stays
        # household-only (load_portfolio's rule, so the list and the analytics agree).
        query = query.join(
            PortfolioAccount, PortfolioAccount.id == DividendPayment.portfolio_account_id
        ).where(owner_filter)
    return list((await db.execute(query)).scalars())


def _validated_dividend_amount(amount: Decimal) -> Decimal:
    quantized = quantize_money(amount, "amount", max_abs=MONEY_MAX_ABS_12_2)
    if quantized <= 0:
        raise HTTPException(status_code=422, detail="amount must be positive")
    return quantized


@router.post("/dividends", response_model=DividendOut, status_code=201)
async def create_dividend(
    body: DividendCreate, db: AsyncSession = Depends(get_db)
) -> DividendPayment:
    if await db.get(Security, body.security_id) is None:
        raise HTTPException(status_code=422, detail=f"unknown security_id: {body.security_id}")
    require_reasonable_date(body.pay_date, "pay_date")
    amount = _validated_dividend_amount(body.amount)
    # Blank/whitespace collapse to None — never persist '' as a second spelling of "no
    # account" (Task 9 review I1), and never mint a portfolio_accounts row for it.
    label = (body.account or "").strip() or None
    account = None if label is None else await resolve_portfolio_account(db, label)
    dividend = DividendPayment(
        security_id=body.security_id,
        portfolio_account=account,
        pay_date=body.pay_date,
        amount=amount,
        notes=body.notes,
    )
    db.add(dividend)
    await db.commit()
    return dividend


async def _get_dividend(db: AsyncSession, dividend_id: int) -> DividendPayment:
    dividend = await db.get(DividendPayment, dividend_id)
    if dividend is None:
        raise HTTPException(status_code=404, detail="dividend not found")
    return dividend


@router.patch("/dividends/{dividend_id}", response_model=DividendOut)
async def update_dividend(
    dividend_id: int, body: DividendUpdate, db: AsyncSession = Depends(get_db)
) -> DividendPayment:
    dividend = await _get_dividend(db, dividend_id)
    provided = body.model_dump(exclude_unset=True)
    # Validate EVERY field before touching the ORM object (update_security posture): a 422
    # raised halfway through would leave part of the row dirty for the next autoflush.
    validated: dict[str, object] = dict(provided)
    for field_name in ("amount", "pay_date"):
        if field_name in provided and provided[field_name] is None:
            raise HTTPException(status_code=422, detail=f"{field_name} cannot be null")
    if "amount" in provided:
        validated["amount"] = _validated_dividend_amount(provided["amount"])
    if "pay_date" in provided:
        validated["pay_date"] = require_reasonable_date(provided["pay_date"], "pay_date")
    account_change = False
    new_account = None
    if "account" in provided:
        validated.pop("account")  # not a column any more — it is the relationship below
        account_change = True
        label = (provided["account"] or "").strip() or None
        new_account = None if label is None else await resolve_portfolio_account(db, label)
    for field_name, value in validated.items():
        setattr(dividend, field_name, value)
    if account_change:
        dividend.portfolio_account = new_account
    await db.commit()
    return dividend


@router.delete("/dividends/{dividend_id}", status_code=204)
async def delete_dividend(dividend_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    dividend = await _get_dividend(db, dividend_id)
    await db.delete(dividend)
    await db.commit()
    return Response(status_code=204)


@router.get("/dividend-events", response_model=list[DividendEventOut])
async def list_dividend_events(db: AsyncSession = Depends(get_db)) -> list[SecurityDividendEvent]:
    """The performance chart's OLDER-era ex-dividend markers — read-only, whole table,
    written only by services.dividend_events (2026-08-28 spec). These are annotations, not
    money: a marker carries a per-share amount because the imported book is dateless and
    the shares held on an old ex-date are unknowable. The ledger and the annotations never
    describe the same event — enforced by exclusion at write time, not by window arithmetic
    (an event dividend_payments carries with source='auto' is never annotated), so a marker
    here and a row in /portfolio/dividends are always two different events.

    NO `owner` query param, deliberately: the performance surface is whole-household by
    design (the weekly value series these annotate has no owner split), and a marker is a
    fact about a SECURITY, not about anyone's account. Ordered (ex_date, security_id) so
    the chart can walk it without sorting."""
    return list(
        (
            await db.execute(
                select(SecurityDividendEvent).order_by(
                    SecurityDividendEvent.ex_date, SecurityDividendEvent.security_id
                )
            )
        ).scalars()
    )


@router.get("/holdings", response_model=HoldingsOut)
async def holdings(owner: OwnerQuery = None, db: AsyncSession = Depends(get_db)) -> HoldingsOut:
    securities, txns, latest, history, dividends = await load_portfolio(
        db, owner_filter=_owner_filter(owner)
    )
    positions = fold_transactions(txns)
    rows = build_holdings(positions, securities, latest, history, dividends, today=date.today())

    total_mv = sum((h.market_value for h in rows if h.market_value is not None), Decimal("0"))
    total_cost = sum((h.cost_basis for h in rows), Decimal("0"))
    day_rows = [h for h in rows if h.day_change_amount is not None]
    day_amount = (
        sum((h.day_change_amount for h in day_rows), Decimal("0")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        if day_rows
        else None
    )
    day_pct = None
    if day_amount is not None:
        # Denominator = yesterday's value of the rows that HAVE day data — using all
        # priced MV understated the header pct 3x when only part of the book carried
        # a prior bar (Task 10 review I2). Can still zero out when long/short prior
        # values cancel — guard stays.
        day_basis = sum((h.market_value for h in day_rows), Decimal("0"))
        if day_basis - day_amount != 0:
            day_pct = quantize_pct(day_amount / (day_basis - day_amount))
    priced_cost = sum((h.cost_basis for h in rows if h.market_value is not None), Decimal("0"))
    unrealized_total = total_mv - priced_cost
    out_rows = [
        HoldingOut(
            security_id=h.security.id,
            ticker=h.security.ticker,
            name=h.security.name,
            industry=h.security.industry,
            holding_type=h.security.holding_type,
            is_manual_priced=h.security.is_manual_priced,
            shares=h.shares,
            avg_cost=h.avg_cost,
            cost_basis=h.cost_basis,
            price=h.price,
            quoted_at=h.quoted_at,
            price_source=h.price_source,
            day_change_pct=h.day_change_pct,
            day_change_amount=h.day_change_amount,
            market_value=h.market_value,
            weight_pct=(
                quantize_pct(h.market_value / total_mv)
                if h.market_value is not None and total_mv > 0
                else None
            ),
            unrealized_gl=h.unrealized_gl,
            unrealized_gl_pct=h.unrealized_gl_pct,
            realized_gl=h.realized_gl,
            dividends_collected=h.dividends_collected,
            annual_dividend=h.security.annual_dividend,
            annual_income=h.annual_income,
            yield_pct=h.yield_pct,
            yoc_pct=h.yoc_pct,
            xirr_pct=h.xirr_pct,
            accounts=h.accounts,
            warnings=h.warnings,
        )
        for h in rows
    ]
    all_realized = sum((p.realized_gl for p in positions.values()), Decimal("0"))
    all_dividends = sum((d.amount for d in dividends), Decimal("0"))
    totals = HoldingsTotals(
        market_value=total_mv.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        cost_basis=total_cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        unrealized_gl=unrealized_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        unrealized_gl_pct=quantize_pct(unrealized_total / priced_cost) if priced_cost > 0 else None,
        day_change_amount=day_amount,
        day_change_pct=day_pct,
        realized_gl=all_realized.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        dividends_collected=all_dividends.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        annual_income=sum(
            (h.annual_income for h in rows if h.annual_income is not None), Decimal("0")
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        unpriced_count=sum(1 for h in rows if h.market_value is None),
    )
    quote_times = [h.quoted_at for h in rows if h.quoted_at is not None]
    return HoldingsOut(
        # Two clocks on purpose: as_of (oldest) drives staleness, latest_quote_at
        # (newest) dates the live chart ping — see HoldingsOut.
        as_of=min(quote_times, default=None),
        latest_quote_at=max(quote_times, default=None),
        totals=totals,
        holdings=out_rows,
    )


@router.get("/allocation", response_model=AllocationOut)
async def allocation_view(
    by: Literal["industry", "type", "account"] = "industry",
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> AllocationOut:
    securities, txns, latest, _history, _dividends = await load_portfolio(
        db, with_history=False, with_dividends=False, owner_filter=_owner_filter(owner)
    )
    positions = fold_transactions(txns)
    buckets = allocation(positions, securities, latest, by)
    total = sum((value for _key, value, _count in buckets), Decimal("0"))
    return AllocationOut(
        by=by,
        total_market_value=total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        slices=[
            AllocationSlice(
                key=key,
                market_value=value,
                weight_pct=quantize_pct(value / total) if total > 0 else quantize_pct(Decimal("0")),
                holdings=count,
            )
            for key, value, count in buckets
        ],
    )


@router.get("/history", response_model=PortfolioHistoryOut)
async def value_history(db: AsyncSession = Depends(get_db)) -> PortfolioHistoryOut:
    """The imported weekly series behind the performance chart — empty arrays (not 404)
    until a workbook carrying the Portfolio sheet's value-history columns is imported.
    The benchmark leg is derived HERE, at read time: a stored column would go stale the
    moment a re-import overrides history rows (apply_portfolio_history's contract), and
    ~190 multiply-adds are free per request (2026-08-24 spec §2)."""
    rows = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    snapshot_dates = [row.snapshot_date for row in rows]
    closes = await baseline_closes_for(db, snapshot_dates)
    return PortfolioHistoryOut(
        dates=snapshot_dates,
        market_value=[row.market_value for row in rows],
        cost_basis=[row.cost_basis for row in rows],
        sp500=[row.sp500_value for row in rows],
        benchmark=contribution_benchmark(
            [(row.snapshot_date, row.market_value, row.cost_basis) for row in rows], closes
        ),
    )


@router.get("/realized", response_model=RealizedOut)
async def realized(owner: OwnerQuery = None, db: AsyncSession = Depends(get_db)) -> RealizedOut:
    securities, txns, _latest, _history, _dividends = await load_portfolio(
        db, with_history=False, with_dividends=False, owner_filter=_owner_filter(owner)
    )
    positions = fold_transactions(txns)
    per_security: dict[int, Decimal] = {}
    for pos in positions.values():
        per_security[pos.security_id] = (
            per_security.get(pos.security_id, Decimal("0")) + pos.realized_gl
        )
    rows = [
        RealizedRow(
            security_id=sec_id,
            ticker=securities[sec_id].ticker,
            name=securities[sec_id].name,
            realized_gl=value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        )
        for sec_id, value in sorted(
            per_security.items(),
            key=lambda kv: (kv[1], securities[kv[0]].ticker if kv[0] in securities else ""),
        )
        if value != 0 and sec_id in securities
    ]
    total = sum((v for v in per_security.values()), Decimal("0"))
    return RealizedOut(total=total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), rows=rows)
