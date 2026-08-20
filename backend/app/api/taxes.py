"""Taxes API: the inputs/brackets editors, the engine-computed summaries, and the
nothing-stored what-if sandbox (spec §5).

The stored `tax_inputs` / `tax_brackets` rows are the engine's only feed, so this router is
deliberately thin: validate at the boundary (money.py's vocabulary), hand full-precision
Decimals to `tax_service`, and quantize on the way out.

Write endpoints are bounded by the column families they land in — inputs Numeric(14,4),
bracket rates Numeric(7,4) with the 0..1 mis-scale guard, thresholds Numeric(12,2) — while
READ endpoints must never reject stored data: `_money` / `_effective_rate` below explain
why the summary serializer cannot reuse money.py's bounded quantizers.
"""

from collections.abc import Iterable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user

# The espp router owns the espp_ticker -> securities -> latest_prices soft link; the
# what-if borrows it rather than minting a second copy (app_settings.py imports
# portfolio.py's _normalize_ticker on the same precedent).
from app.api.espp import _espp_quote
from app.database import get_db
from app.models import EsppLot, TaxBracket, TaxInput, TaxInputDefinition, TaxYear
from app.schemas.taxes import (
    BracketIn,
    BracketOut,
    BracketsIn,
    BracketsOut,
    CapitalGainsTaxOut,
    ChangedInput,
    EsppSaleDetailOut,
    IncomeTaxOut,
    SaleDetailOut,
    TaxInputItemOut,
    TaxInputSectionOut,
    TaxInputsIn,
    TaxInputsOut,
    TaxSummariesOut,
    TaxSummaryOut,
    TaxTotalsOut,
    TaxYearOut,
    WageTaxOut,
    WhatIfDelta,
    WhatIfIn,
    WhatIfOut,
)
from app.services.money import (
    MONEY_MAX_ABS_12_2,
    MONEY_MAX_ABS_14_4,
    MONEY_QUANTUM,
    quantize_money,
    quantize_pct,
    quantize_price,
    quantize_shares,
)
from app.services.portfolio_calc import SHARE_Q, fold_transactions, load_portfolio
from app.services.tax_service import (
    Bracket,
    JurisdictionResult,
    TaxBreakdown,
    compute_breakdown,
    derive_suggestions,
)
from app.services.tax_whatif import (
    EsppSaleDetail,
    SaleDetail,
    apply_scenario,
    classify_sale,
    decompose_espp,
)
from app.tax_keys import JURISDICTIONS, SECTIONS, TAX_INPUT_DEFINITIONS

router = APIRouter(prefix="/taxes", tags=["taxes"], dependencies=[Depends(get_current_user)])

# Century guard on every route, not just the writers: `tax_years.year` is an int4, so a
# mistyped 99999999999 would surface as a bare asyncpg DataError 500 on a plain GET.
YEAR_MIN = 1900
YEAR_MAX = 2100
YearPath = Annotated[int, Path(ge=YEAR_MIN, le=YEAR_MAX)]
# The what-if carries its year in the BODY, where a Path() bound cannot reach it, so the
# same guard is spelled out there — with a sentence of its own, because pydantic's is not
# available off the path.
YEAR_MESSAGE = f"year must be between {YEAR_MIN} and {YEAR_MAX}"

MAX_BRACKETS = 12
ZERO = Decimal("0")
# Above this the ratio is nonsense anyway (near-zero denominator), and quantize_pct would
# need more digits than the Decimal context has.
RATE_MAX_ABS = Decimal("1e12")


async def _require_year(db: AsyncSession, year: int) -> None:
    if await db.get(TaxYear, year) is None:
        raise HTTPException(status_code=404, detail=f"tax year {year} not found")


async def _ensure_year(db: AsyncSession, year: int) -> None:
    """Auto-create the parent row so the editors never need a separate "add year" call."""
    if await db.get(TaxYear, year) is None:
        db.add(TaxYear(year=year))
        await db.flush()  # the inputs/brackets FK to it inside this same transaction


async def _stored_inputs(db: AsyncSession, year: int) -> dict[str, Decimal]:
    rows = (await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars()
    return {row.key: row.value for row in rows}


async def _inputs_payload(db: AsyncSession, year: int) -> TaxInputsOut:
    definitions = list((await db.execute(select(TaxInputDefinition))).scalars())
    stored = await _stored_inputs(db, year)
    suggestions = derive_suggestions(year, stored)
    by_section: dict[str, list[TaxInputItemOut]] = {}
    for definition in sorted(definitions, key=lambda d: (d.sort_order, d.key)):
        by_section.setdefault(definition.section, []).append(
            TaxInputItemOut(
                key=definition.key,
                label=definition.label,
                sort_order=definition.sort_order,
                is_derived=definition.is_derived,
                value=stored.get(definition.key),
                # Presence here — not is_derived — is what the UI shows a chip for: the
                # sheet computes capital_loss_deductions although it seeds as a plain input.
                suggested=suggestions.get(definition.key),
            )
        )
    # tax_keys order first; a section seeded later still renders (appended, name order).
    ordered = [name for name in SECTIONS if name in by_section]
    ordered += sorted(set(by_section) - set(SECTIONS))
    return TaxInputsOut(
        year=year,
        sections=[TaxInputSectionOut(section=name, items=by_section[name]) for name in ordered],
    )


async def _brackets_payload(db: AsyncSession, year: int) -> BracketsOut:
    rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    tables: dict[str, list[BracketOut]] = {name: [] for name in JURISDICTIONS}
    for row in rows:
        # setdefault, not [...]: the importer could carry a jurisdiction this API cannot
        # write, and a GET must still show it rather than silently drop it.
        tables.setdefault(row.jurisdiction, []).append(
            BracketOut(bracket_index=row.bracket_index, rate=row.rate, threshold=row.threshold)
        )
    return BracketsOut(year=year, jurisdictions=tables)


@router.get("/years", response_model=list[TaxYearOut])
async def list_years(db: AsyncSession = Depends(get_db)) -> list[TaxYearOut]:
    years = list((await db.execute(select(TaxYear).order_by(TaxYear.year))).scalars())
    input_counts = dict(
        (await db.execute(select(TaxInput.year, func.count()).group_by(TaxInput.year))).all()
    )
    bracket_counts = dict(
        (await db.execute(select(TaxBracket.year, func.count()).group_by(TaxBracket.year))).all()
    )
    return [
        TaxYearOut(
            year=row.year,
            notes=row.notes,
            input_count=input_counts.get(row.year, 0),
            bracket_count=bracket_counts.get(row.year, 0),
        )
        for row in years
    ]


@router.delete("/years/{year}", status_code=204)
async def delete_year(year: YearPath, db: AsyncSession = Depends(get_db)) -> Response:
    """Remove a tax year and everything under it — the exit for a typo'd year.

    Every write auto-creates its year (`_ensure_year`), so a mistyped 2103 would otherwise
    linger forever. Core DELETE, not an ORM cascade: both child FKs carry ondelete=CASCADE
    in Postgres and `TaxYear` declares no relationships, so one statement removes the whole
    year vertical (put_brackets' core-statement precedent). `tax_input_definitions` is
    year-independent seed data and is untouched. Deletion is not a tombstone either — any
    write path recreates the year, so empty-PUT-creates stays law. Re-import interplay: same
    sheet-wins posture as the PUTs — deleting an IMPORTED year is undone by the next workbook
    import, which recreates it from the sheet.
    """
    await _require_year(db, year)
    await db.execute(delete(TaxYear).where(TaxYear.year == year))
    await db.commit()
    return Response(status_code=204)


@router.get("/years/{year}/inputs", response_model=TaxInputsOut)
async def get_inputs(year: YearPath, db: AsyncSession = Depends(get_db)) -> TaxInputsOut:
    await _require_year(db, year)
    return await _inputs_payload(db, year)


async def _require_known_input_keys(db: AsyncSession, keys: Iterable[str]) -> None:
    """The definition table is the only place that knows which keys are seeded, so every
    endpoint that speaks the input vocabulary (PUT inputs, the what-if overrides) asks it
    the same question and reports an unknown key with the same sentence."""
    known = set((await db.execute(select(TaxInputDefinition.key))).scalars())
    unknown = sorted(set(keys) - known)
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown input key(s): {unknown}")


def _validated_input_value(key: str, value: Decimal | None) -> Decimal | None:
    """One input value at the tax_inputs column scale, Numeric(14,4); null stays null.

    `+ ZERO` is tax_service._rate's trick: -0.00004 quantizes to Decimal("-0.0000"), and
    this session keeps the written object (expire_on_commit=False), so without the
    collapse the PUT echoes "-0.0000" where a later GET reads Postgres's plain "0.0000".

    The `values.` field prefix is the PUT's, kept verbatim for the what-if overrides too:
    one vocabulary means a bad input value is reported identically wherever it arrives.
    """
    if value is None:
        return None
    return quantize_price(value, f"values.{key}", max_abs=MONEY_MAX_ABS_14_4) + ZERO


@router.put("/years/{year}/inputs", response_model=TaxInputsOut)
async def put_inputs(
    year: YearPath, body: TaxInputsIn, db: AsyncSession = Depends(get_db)
) -> TaxInputsOut:
    # Re-import interplay (Plan 2 forward note): the taxes import is sheet-wins within the
    # years it covers, so edits made here to an imported year are clobbered by the next
    # re-import. Cutover order is documented, not guarded.
    await _require_known_input_keys(db, body.values)
    # Quantize EVERY value before the first write: a 422 raised halfway through a bulk
    # upsert would otherwise leave the year half-edited (portfolio PATCH posture).
    quantized = {key: _validated_input_value(key, value) for key, value in body.values.items()}

    await _ensure_year(db, year)
    existing = {
        row.key: row
        for row in (await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars()
    }
    for key, value in quantized.items():
        row = existing.get(key)
        if value is None:
            if row is not None:
                await db.delete(row)  # null means "unset this line", not "store 0"
        elif row is None:
            db.add(TaxInput(year=year, key=key, value=value))
        else:
            row.value = value
    await db.commit()
    return await _inputs_payload(db, year)


def _validated_table(name: str, table: list[BracketIn]) -> list[Bracket]:
    """One jurisdiction's replacement rows, as (rate, threshold) at column scale.

    An empty list is legal — it is a full replace with nothing, i.e. delete every row.
    """
    if len(table) > MAX_BRACKETS:
        raise HTTPException(
            status_code=422, detail=f"{name}: at most {MAX_BRACKETS} brackets per jurisdiction"
        )
    validated: list[Bracket] = []
    previous: Decimal | None = None
    for index, row in enumerate(table, start=1):
        field = f"jurisdictions.{name}[{index}]"
        # `+ ZERO` on both (tax_service._rate's collapse): a "-0.00004" rate / "-0.004"
        # threshold quantizes to a SIGNED zero, which renders "-0.0000"/"-0.00". Postgres
        # has no signed zero, so today the replaced rows are re-read clean anyway — this
        # keeps the written value itself out of the -0 vocabulary, like PUT inputs.
        rate = quantize_price(row.rate, f"{field}.rate") + ZERO
        if not 0 <= rate <= 1:
            # The Plan 1 mis-scale guard: a 37.43 meant as 37.43% must never reach a walk.
            raise HTTPException(status_code=422, detail=f"{field}.rate must be between 0 and 1")
        threshold = (
            quantize_money(row.threshold, f"{field}.threshold", max_abs=MONEY_MAX_ABS_12_2) + ZERO
        )
        if previous is None:
            if threshold != 0:
                raise HTTPException(
                    status_code=422, detail=f"{name}: the first bracket threshold must be 0"
                )
        elif threshold <= previous:
            raise HTTPException(
                status_code=422, detail=f"{name}: thresholds must be strictly ascending"
            )
        previous = threshold
        validated.append((rate, threshold))
    return validated


@router.get("/years/{year}/brackets", response_model=BracketsOut)
async def get_brackets(year: YearPath, db: AsyncSession = Depends(get_db)) -> BracketsOut:
    await _require_year(db, year)
    return await _brackets_payload(db, year)


@router.put("/years/{year}/brackets", response_model=BracketsOut)
async def put_brackets(
    year: YearPath, body: BracketsIn, db: AsyncSession = Depends(get_db)
) -> BracketsOut:
    # Re-import interplay: same sheet-wins posture as PUT inputs — a bracket table edited
    # here for an imported year is replaced by the next workbook import.
    unknown = sorted(set(body.jurisdictions) - set(JURISDICTIONS))
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown jurisdiction(s): {unknown}")
    # Validate every jurisdiction before touching any of them: a mixed body must write all
    # of its tables or none.
    validated = {name: _validated_table(name, table) for name, table in body.jurisdictions.items()}

    await _ensure_year(db, year)
    for name, table in validated.items():
        # Core DELETE rather than ORM deletes: the unit of work flushes INSERTs before
        # DELETEs, so replacing a table in place would trip the
        # (year, jurisdiction, bracket_index) unique constraint.
        await db.execute(
            delete(TaxBracket).where(TaxBracket.year == year, TaxBracket.jurisdiction == name)
        )
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    bracket_index=index,  # 1-based array order, renumbered on every replace
                    rate=rate,
                    threshold=threshold,
                )
            )
    await db.commit()
    return await _brackets_payload(db, year)


@router.post("/years/{year}/clone-brackets-from/{source_year}", response_model=BracketsOut)
async def clone_brackets(
    year: YearPath, source_year: YearPath, db: AsyncSession = Depends(get_db)
) -> BracketsOut:
    """Seed a new year from an existing one; the rates/thresholds are then edited in place."""
    source_rows = list(
        (
            await db.execute(
                select(TaxBracket)
                .where(TaxBracket.year == source_year)
                .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
            )
        ).scalars()
    )
    if not source_rows:
        raise HTTPException(status_code=404, detail=f"no brackets to clone from {source_year}")
    existing = (
        await db.execute(
            select(func.count()).select_from(TaxBracket).where(TaxBracket.year == year)
        )
    ).scalar_one()
    if existing:
        # Never a silent merge: clear the target explicitly (PUT brackets with []) first.
        raise HTTPException(
            status_code=409, detail=f"tax year {year} already has {existing} brackets"
        )

    await _ensure_year(db, year)
    for row in source_rows:
        db.add(
            TaxBracket(
                year=year,
                jurisdiction=row.jurisdiction,
                bracket_index=row.bracket_index,
                rate=row.rate,
                threshold=row.threshold,
            )
        )
    await db.commit()
    return await _brackets_payload(db, year)


def _money(value: Decimal | None) -> Decimal:
    """2dp with a PLAIN quantize — never money.py's bounded one (Task 1 review I3).

    Engine outputs are unbounded: two bound-legal inputs (|v| < 10^10) multiply into a
    ~10^20 state AGI, so a bounded quantizer would 422 a GET on data this very API
    accepted. The reachable maximum is ~10^21 (that product walked through 12 brackets),
    which still fits the 28-digit Decimal context at cents.

    `+ ZERO` mirrors tax_service._rate: a tiny negative (a state tax of -0.001 after
    exemption credits) quantizes to Decimal("-0.00"), which would serialize as "-0.00".
    """
    quantized = (ZERO if value is None else value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    return quantized + ZERO


def _effective_rate(
    value: Decimal | None, jurisdiction: str, warnings: list[str]
) -> Decimal | None:
    """6dp effective rate, or None + a warning when the ratio is absurd.

    A near-zero denominator over a ~10^20 numerator reaches ~10^24, which quantize_pct
    cannot represent — degrade to null rather than 500 on stored data.
    """
    if value is None:
        return None
    if value.copy_abs() >= RATE_MAX_ABS:
        warnings.append(f"{jurisdiction} effective rate out of range")
        return None
    return quantize_pct(value)


def _income_out(result: JurisdictionResult, name: str, warnings: list[str]) -> IncomeTaxOut:
    return IncomeTaxOut(
        agi=_money(result.agi),
        taxable_income=_money(result.taxable_income),
        tax=_money(result.tax),
        effective_rate=_effective_rate(result.effective_rate, name, warnings),
    )


def _wage_out(result: JurisdictionResult, name: str, warnings: list[str]) -> WageTaxOut:
    return WageTaxOut(
        w2_income=_money(result.w2_income),
        taxable_wages=_money(result.taxable_wages),
        tax=_money(result.tax),
        effective_rate=_effective_rate(result.effective_rate, name, warnings),
    )


def _summary_out(breakdown: TaxBreakdown) -> TaxSummaryOut:
    warnings = list(breakdown.warnings)  # engine warnings first, serializer's appended after
    federal = _income_out(breakdown.federal, "federal", warnings)
    state = _income_out(breakdown.state, "state", warnings)
    medicare = _wage_out(breakdown.medicare, "medicare", warnings)
    social_security = _wage_out(breakdown.social_security, "social_security", warnings)
    disability = _wage_out(breakdown.disability, "disability", warnings)
    gains = breakdown.capital_gains
    capital_gains = CapitalGainsTaxOut(
        taxable_income=_money(gains.taxable_income),
        gains_amount=_money(gains.gains_amount),
        tax=_money(gains.tax),
        effective_rate=_effective_rate(gains.effective_rate, "capital_gains", warnings),
    )
    totals = TaxTotalsOut(
        gross_income=_money(breakdown.totals.gross_income),
        total_income=_money(breakdown.totals.total_income),
        total_tax=_money(breakdown.totals.total_tax),
        take_home=_money(breakdown.totals.take_home),
        effective_rate=_effective_rate(breakdown.totals.effective_rate, "totals", warnings),
    )
    return TaxSummaryOut(
        year=breakdown.year,
        federal=federal,
        state=state,
        medicare=medicare,
        social_security=social_security,
        disability=disability,
        capital_gains=capital_gains,
        totals=totals,
        warnings=warnings,
    )


@router.get("/years/{year}/summary", response_model=TaxSummaryOut)
async def get_summary(year: YearPath, db: AsyncSession = Depends(get_db)) -> TaxSummaryOut:
    await _require_year(db, year)
    rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    brackets: dict[str, list[Bracket]] = {}
    for row in rows:
        brackets.setdefault(row.jurisdiction, []).append((row.rate, row.threshold))
    return _summary_out(compute_breakdown(year, await _stored_inputs(db, year), brackets))


@router.get("/summary", response_model=TaxSummariesOut)
async def get_all_summaries(db: AsyncSession = Depends(get_db)) -> TaxSummariesOut:
    """The trend feed: one summary per year that has at least one stored input."""
    inputs_by_year: dict[int, dict[str, Decimal]] = {}
    for row in (await db.execute(select(TaxInput))).scalars():
        inputs_by_year.setdefault(row.year, {})[row.key] = row.value
    brackets_by_year: dict[int, dict[str, list[Bracket]]] = {}
    # The full key order, not just bracket_index: the per-year GET orders the same way, and
    # `walk`/`stack` sort defensively, so this pins ONE table order across both endpoints
    # rather than leaving it to whatever the planner returns.
    bracket_rows = (
        await db.execute(
            select(TaxBracket).order_by(
                TaxBracket.year, TaxBracket.jurisdiction, TaxBracket.bracket_index
            )
        )
    ).scalars()
    for row in bracket_rows:
        year_tables = brackets_by_year.setdefault(row.year, {})
        year_tables.setdefault(row.jurisdiction, []).append((row.rate, row.threshold))
    years = list((await db.execute(select(TaxYear.year).order_by(TaxYear.year))).scalars())
    return TaxSummariesOut(
        years=[
            _summary_out(
                compute_breakdown(year, inputs_by_year[year], brackets_by_year.get(year, {}))
            )
            for year in years
            # A year with no inputs computes an all-zero column — noise in a trend chart.
            if inputs_by_year.get(year)
        ]
    )


@router.post("/what-if", response_model=WhatIfOut)
async def what_if(body: WhatIfIn, db: AsyncSession = Depends(get_db)) -> WhatIfOut:
    """Baseline vs scenario through the engine — NOTHING is stored. today is read here
    (paycheck.py's clock posture) for ESPP disposition dating."""
    year = body.year
    if not YEAR_MIN <= year <= YEAR_MAX:
        raise HTTPException(status_code=422, detail=YEAR_MESSAGE)
    await _require_year(db, year)
    today = date.today()

    stored = await _stored_inputs(db, year)
    bracket_rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    brackets: dict[str, list[Bracket]] = {}
    for row in bracket_rows:
        brackets.setdefault(row.jurisdiction, []).append((row.rate, row.threshold))

    # Overrides: the PUT-inputs vocabulary — unknown keys 422, values quantized 4dp.
    await _require_known_input_keys(db, body.overrides)
    overrides: dict[str, Decimal | None] = {
        key: _validated_input_value(key, value) for key, value in body.overrides.items()
    }

    # Brokerage legs: average-cost fold, summed per security across accounts.
    sale_details: list[SaleDetail] = []
    if body.sales:
        securities, txns, latest, _history, _dividends = await load_portfolio(
            db, with_history=False, with_dividends=False
        )
        folded = fold_transactions(txns)
        per_sec: dict[int, dict] = {}
        for pos in folded.values():
            agg = per_sec.setdefault(
                pos.security_id,
                {"shares": ZERO, "cost_basis": ZERO, "has_dateless": False},
            )
            agg["shares"] += pos.shares
            agg["cost_basis"] += pos.cost_basis
            agg["has_dateless"] = agg["has_dateless"] or pos.has_dateless_txn
        for leg in body.sales:
            security = securities.get(leg.security_id)
            if security is None:
                raise HTTPException(
                    status_code=404, detail=f"unknown security {leg.security_id}"
                )
            shares = quantize_shares(leg.shares, "shares")
            if shares <= 0:
                raise HTTPException(status_code=422, detail="shares must be positive")
            agg = per_sec.get(leg.security_id)
            held = agg["shares"].quantize(SHARE_Q, rounding=ROUND_HALF_UP) if agg else ZERO
            if shares > held:
                raise HTTPException(
                    status_code=422,
                    detail=(f"selling {shares} {security.ticker} — only {held} held"),
                )
            if leg.price is not None:
                price = quantize_price(leg.price, "price")
                if price <= 0:
                    raise HTTPException(status_code=422, detail="price must be positive")
            else:
                quote = latest.get(leg.security_id)
                if quote is None:
                    raise HTTPException(
                        status_code=422,
                        detail=f"no price for {security.ticker} — provide one",
                    )
                price = quote.price
            sale_details.append(
                classify_sale(
                    security_id=security.id,
                    ticker=security.ticker,
                    shares=shares,
                    price=price,
                    held_shares=agg["shares"],
                    held_cost_basis=agg["cost_basis"],
                    has_dateless=agg["has_dateless"],
                    term=leg.term,
                )
            )

    # ESPP legs.
    espp_details: list[EsppSaleDetail] = []
    if body.espp_sales:
        _ticker, quote_price, _quoted_at = await _espp_quote(db)
        for leg in body.espp_sales:
            lot = await db.get(EsppLot, leg.lot_id)
            if lot is None:
                raise HTTPException(status_code=404, detail=f"unknown lot {leg.lot_id}")
            if lot.sold_date is not None:
                raise HTTPException(status_code=409, detail=f"lot {leg.lot_id} already sold")
            if leg.sale_price is not None:
                sale_price = quantize_price(leg.sale_price, "sale_price")
                if sale_price <= 0:
                    raise HTTPException(
                        status_code=422, detail="sale_price must be positive"
                    )
            elif quote_price is not None:
                sale_price = quote_price
            else:
                raise HTTPException(
                    status_code=422,
                    detail="no ESPP quote available — provide a sale_price",
                )
            espp_details.append(
                decompose_espp(
                    lot_id=lot.id,
                    purchase_date=lot.purchase_date,
                    qualifying_date=lot.qualifying_date,
                    shares=lot.shares,
                    subscription_price=lot.subscription_price,
                    purchase_fmv=lot.purchase_fmv,
                    purchase_price=lot.purchase_price,
                    sale_price=sale_price,
                    today=today,
                )
            )

    scenario_inputs, scenario_warnings = apply_scenario(
        stored, sale_details, espp_details, overrides
    )
    baseline = _summary_out(compute_breakdown(year, stored, brackets))
    scenario = _summary_out(compute_breakdown(year, scenario_inputs, brackets))

    changed: list[ChangedInput] = []
    labels = {key: label for key, label, _s, _o, _d in TAX_INPUT_DEFINITIONS}
    for key in sorted(set(stored) | set(scenario_inputs)):
        before = stored.get(key, ZERO)
        after = scenario_inputs.get(key, ZERO)
        if before != after:
            changed.append(
                ChangedInput(
                    key=key,
                    label=labels.get(key, key),
                    before=_money(before),
                    after=_money(after),
                )
            )

    def rate_delta(a: Decimal | None, b: Decimal | None) -> Decimal | None:
        return None if a is None or b is None else quantize_pct(a - b)

    delta = WhatIfDelta(
        total_tax=scenario.totals.total_tax - baseline.totals.total_tax,
        take_home=scenario.totals.take_home - baseline.totals.take_home,
        federal_tax=scenario.federal.tax - baseline.federal.tax,
        state_tax=scenario.state.tax - baseline.state.tax,
        medicare_tax=scenario.medicare.tax - baseline.medicare.tax,
        social_security_tax=scenario.social_security.tax - baseline.social_security.tax,
        disability_tax=scenario.disability.tax - baseline.disability.tax,
        capital_gains_tax=scenario.capital_gains.tax - baseline.capital_gains.tax,
        effective_rate=rate_delta(
            scenario.totals.effective_rate, baseline.totals.effective_rate
        ),
    )
    return WhatIfOut(
        year=year,
        baseline=baseline,
        scenario=scenario,
        delta=delta,
        changed_inputs=changed,
        sale_details=[SaleDetailOut(**vars(d)) for d in sale_details],
        espp_sale_details=[EsppSaleDetailOut(**vars(d)) for d in espp_details],
        warnings=scenario_warnings,
    )
