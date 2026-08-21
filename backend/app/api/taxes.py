"""Taxes API: the inputs/brackets editors, the engine-computed summaries, and the
nothing-stored what-if sandbox (spec §5).

The stored `tax_inputs` / `tax_brackets` rows are the engine's only feed, so this router is
deliberately thin: validate at the boundary (money.py's vocabulary), hand full-precision
Decimals to `tax_service`, and quantize on the way out.

Write endpoints are bounded by the column families they land in — inputs Numeric(14,4),
bracket rates Numeric(7,4) with the 0..1 mis-scale guard, thresholds Numeric(12,2) — while
READ endpoints must never reject stored data: `_money` / `_effective_rate` below explain
why the summary serializer cannot reuse money.py's bounded quantizers.

The last endpoint, `/years/{year}/withholding` (2026-08-21 spec §4), is the one place this
router reaches outside its own two tables: paycheck profiles, RSU grants and employer prices,
all read through the routers that own them. It is a pure read with four soft links, so it
degrades where the editors above raise — see its section comment.
"""

from collections.abc import Iterable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

# Cross-router borrows, on app_settings.py's precedent (it imports portfolio.py's
# _normalize_ticker): the espp router owns the espp_ticker -> securities -> latest_prices soft
# link, the comp router owns the employer close history and the on-or-before lookup the vest
# calendar reads, and the paycheck router owns THE divide-by-zero rule for a stored profile.
# Every one of them is one concept with one owner — a second copy here could only drift.
from app.api.comp import _close_on_or_before, _employer_bars
from app.api.deps import get_current_user
from app.api.espp import _espp_quote
from app.api.paycheck import MAX_PAY_PERIODS, MIN_PAY_PERIODS, PAY_PERIODS_MESSAGE
from app.database import get_db
from app.models import (
    EsppLot,
    PaycheckProfile,
    RsuGrant,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
)
from app.schemas.taxes import (
    BracketIn,
    BracketOut,
    BracketsIn,
    BracketsOut,
    CapitalGainsTaxOut,
    ChangedInput,
    EsppSaleDetailOut,
    IncomeTaxOut,
    SafeHarborOut,
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
    WithholdingLegOut,
    WithholdingOut,
    WithholdingVestOut,
)
from app.services import rsu_vesting, withholding_calc
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
from app.services.scheduler import product_today
from app.services.tax_service import (
    JURISDICTION_WARN_MISSING,
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


async def _engine_tables(db: AsyncSession, year: int) -> dict[str, list[Bracket]]:
    """One year's bracket tables in the shape `compute_breakdown` (and `walk`) take them.

    ONE loader for every engine caller — the summary, the what-if and the withholding card —
    so they can never disagree about which rows the engine saw. The full key order, not just
    bracket_index: `walk`/`stack` sort defensively, so this pins one table order across all of
    them rather than leaving it to whatever the planner returns.
    """
    rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    tables: dict[str, list[Bracket]] = {}
    for row in rows:
        tables.setdefault(row.jurisdiction, []).append((row.rate, row.threshold))
    return tables


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
    tables = await _engine_tables(db, year)
    return _summary_out(compute_breakdown(year, await _stored_inputs(db, year), tables))


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


# --- the "Will I owe?" tracker (2026-08-21 spec §4): the engine's liability for the year
# against an all-in withholding ESTIMATE built from stored profiles, grants and prices.
#
# Nothing here is stored, and every input is a soft link that can break: the employer ticker,
# a bar behind a vest date, a grant row `_validated_grant` would refuse, a profile the paycheck
# writers would refuse. Each of those degrades to an exclusion plus a warning naming it — the
# GET-never-rejects law, which binds harder here than on the summary because this payload is
# assembled from four tables the taxes editors do not own.

NON_CURRENT_YEAR_MESSAGE = "withholding tracking is only meaningful for the current year"
# The ROOT CAUSE, kept separate from the two symptom warnings below: with no ticker every vest
# is unpriceable at once, and the per-date/no-quote lines would only restate this one. Same
# call comp.py's vest calendar makes, in the same words (Task 6 review).
NO_TICKER_WARNING = "no ESPP/employer ticker configured — vests are excluded from the estimate"
NO_QUOTE_WARNING = "no current employer price — future vests are excluded from the projection"
# The IRS prior-year safe harbor for high earners; "all-in" here, where the real rule is
# per-jurisdiction (the card's copy says so).
SAFE_HARBOR_MULTIPLIER = Decimal("1.10")
SAFE_HARBOR_UNAVAILABLE = "prior year {year} has no computed tax — safe harbor unavailable"
# The three tables the marginal-FICA walks read. Named separately from the engine's own
# jurisdiction sweep because an empty one is silent HERE: the summary would show a 0 medicare
# line, but this card would show a 0 vest-FICA leg with nothing to explain it.
FICA_JURISDICTIONS = ("medicare", "social_security", "disability")


@router.get("/years/{year}/withholding", response_model=WithholdingOut)
async def get_withholding(year: YearPath, db: AsyncSession = Depends(get_db)) -> WithholdingOut:
    """Estimated all-in withholding for the CURRENT year vs the engine's liability.

    `product_today` is the one clock this route reads (comp.py's note: the prod container runs
    UTC, so date.today() is already tomorrow on a PT evening), and it is read ONCE — the
    same day decides the year check, which checks have been received, and which vests are
    behind us. `withholding_calc` never re-reads a vest tuple's date, so that single value is
    what keeps the past/future split and the check grid consistent with each other.
    """
    today = product_today()
    if year != today.year:
        # Before `_require_year`: a settled year may well be stored and summarizable, and the
        # reason this card cannot be drawn for it has nothing to do with whether it exists.
        raise HTTPException(status_code=422, detail=NON_CURRENT_YEAR_MESSAGE)
    await _require_year(db, year)

    tables = await _engine_tables(db, year)
    liability = compute_breakdown(year, await _stored_inputs(db, year), tables)
    warnings: list[str] = [
        JURISDICTION_WARN_MISSING.format(j=name, year=year)
        for name in FICA_JURISDICTIONS
        if not tables.get(name)
    ]

    # Profiles: the stored-data fence, mirroring paycheck.py's breakdown guard — same rule,
    # same words (PAY_PERIODS_MESSAGE), read from the other end. BOTH bounds bind here, where
    # paycheck.py's own read fences only the floor: `check_dates` builds one date — and one
    # `breakdown` call — PER CHECK, so a hand-written 10^9 periods is not a slow answer, it is
    # no answer at all. An excluded profile is dropped, never defaulted to 24: inventing a
    # cadence would put a made-up salary figure next to a real liability.
    profiles: list[PaycheckProfile] = []
    for profile in (
        await db.execute(select(PaycheckProfile).order_by(PaycheckProfile.effective_date))
    ).scalars():
        if not MIN_PAY_PERIODS <= profile.pay_periods_per_year <= MAX_PAY_PERIODS:
            warnings.append(
                f"paycheck profile effective {profile.effective_date} excluded: "
                f"{PAY_PERIODS_MESSAGE}"
            )
            continue
        profiles.append(profile)

    # Vests: past ones are worth what the stock was worth THEN (the newest stored close on or
    # before the vest), future ones ride the latest quote — comp.py's vest calendar makes the
    # same two calls, and shares the helpers so the two pages cannot price a vest differently.
    ticker, latest_price, _quoted_at = await _espp_quote(db)
    bar_days, bar_closes = await _employer_bars(db, ticker)
    grants = list(
        (
            await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id))
        ).scalars()
    )
    past_vests: list[withholding_calc.VestTuple] = []
    future_vests: list[withholding_calc.VestTuple] = []
    unpriced: set[date] = set()
    missing_quote = False
    for grant in grants:
        try:
            vest_events = rsu_vesting.schedule(grant)
        except (ValueError, OverflowError) as exc:
            # A hand-edited row only — the writer enforces rsu_vesting's precondition. Name it
            # and drop it (the vest calendar's posture), because the card still has to answer.
            warnings.append(f"{grant.label}: stored grant cannot be scheduled — {exc}")
            continue
        for vest_date, shares in vest_events:
            if vest_date.year != year:
                continue  # a prior year's withholding is history; a later one is not this card
            if vest_date <= today:
                close = _close_on_or_before(bar_days, bar_closes, vest_date)
                if close is None:
                    # EXCLUDED, not valued at 0: the vest happened and its income is real —
                    # a confident zero would understate the bill without saying so.
                    unpriced.add(vest_date)
                else:
                    past_vests.append((vest_date, shares, close))
            elif latest_price is None:
                missing_quote = True
            else:
                future_vests.append((vest_date, shares, latest_price))
    if ticker is None:
        # One root cause instead of N symptoms: the soft link is broken at its FIRST hop, so
        # every line below would be the same sentence with a different date on it. The
        # exclusions themselves already happened above — this is what names them.
        warnings.append(NO_TICKER_WARNING)
    else:
        # One warning per unpriced DATE, not per row (two grants vesting the same day is one
        # hole), and they are the only signal here: a ticker IS configured, so a missing bar
        # is a real gap in the price history rather than a setting nobody filled in. The
        # missing quote is one warning for the whole projection, not one per future vest.
        warnings.extend(
            f"vest on {day} has no stored price — excluded from the estimate"
            for day in sorted(unpriced)
        )
        if missing_quote:
            warnings.append(NO_QUOTE_WARNING)

    estimated = withholding_calc.estimate(
        year=year,
        today=today,  # the SAME day the split above used — the service takes it on faith
        profiles=profiles,
        past_vests=past_vests,
        future_vests=future_vests,
        medicare=tables.get("medicare", []),
        social_security=tables.get("social_security", []),
        disability=tables.get("disability", []),
    )
    warnings.extend(estimated.warnings)

    # Salary withholding + vest supplemental + vest marginal FICA. Salary-side FICA is NOT a
    # term: the user's all-in withholding_pct already carries it (withholding_calc's note).
    total_ytd = _money(
        estimated.salary_ytd + estimated.vest_supplemental_ytd + estimated.vest_fica_ytd
    )
    total_projected = _money(
        estimated.salary_projected
        + estimated.vest_supplemental_projected
        + estimated.vest_fica_projected
    )
    liability_total = _money(liability.totals.total_tax)

    safe_harbor = None
    if await db.get(TaxYear, year - 1) is not None:
        prior = compute_breakdown(
            year - 1, await _stored_inputs(db, year - 1), await _engine_tables(db, year - 1)
        )
        # Quantize FIRST, then take 110% of that: the threshold has to be 1.10 x the number
        # rendered beside it, not 1.10 x a full-precision figure nobody can see.
        prior_total = _money(prior.totals.total_tax)
        if prior_total <= ZERO:
            # A bare tax_years row (or one whose credits swallowed the tax) makes the whole
            # comparison vacuous: any withholding at all clears a zero-or-negative threshold,
            # so a met=True badge would be a false all-clear. Say why instead.
            warnings.append(SAFE_HARBOR_UNAVAILABLE.format(year=year - 1))
        else:
            threshold = _money(prior_total * SAFE_HARBOR_MULTIPLIER)
            safe_harbor = SafeHarborOut(
                prior_year=year - 1,
                prior_total_tax=prior_total,
                threshold=threshold,
                # Judged on the DISPLAYED figures (paycheck.py's negative-net posture), so the
                # badge can never contradict the two numbers rendered next to it.
                met=total_projected >= threshold,
            )

    return WithholdingOut(
        year=year,
        liability_total=liability_total,
        salary=WithholdingLegOut(
            ytd=_money(estimated.salary_ytd),
            projected=_money(estimated.salary_projected),
        ),
        vest=WithholdingVestOut(
            income_ytd=_money(estimated.vest_income_ytd),
            income_projected=_money(estimated.vest_income_projected),
            supplemental_ytd=_money(estimated.vest_supplemental_ytd),
            supplemental_projected=_money(estimated.vest_supplemental_projected),
            fica_ytd=_money(estimated.vest_fica_ytd),
            fica_projected=_money(estimated.vest_fica_projected),
        ),
        total=WithholdingLegOut(ytd=total_ytd, projected=total_projected),
        # Both sides are already at cents, so this subtracts exactly; `_money` is here for the
        # signed-zero collapse (withholding that lands ON the liability must read "0.00").
        balance_projected=_money(liability_total - total_projected),
        checks_elapsed=estimated.checks_elapsed,
        checks_total=estimated.checks_total,
        safe_harbor=safe_harbor,
        warnings=warnings,
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
    brackets = await _engine_tables(db, year)

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
        # The oversell fence sums ACROSS legs: two legs naming the same security must not
        # each pass against the full position (branch review I1 — an impossible sale is a
        # typo, and splitting it across rows doesn't make it possible).
        requested: dict[int, Decimal] = {}
        for leg in body.sales:
            security = securities.get(leg.security_id)
            if security is None:
                raise HTTPException(status_code=404, detail=f"unknown security {leg.security_id}")
            shares = quantize_shares(leg.shares, "shares")
            if shares <= 0:
                raise HTTPException(status_code=422, detail="shares must be positive")
            agg = per_sec.get(leg.security_id)
            held = agg["shares"].quantize(SHARE_Q, rounding=ROUND_HALF_UP) if agg else ZERO
            requested[leg.security_id] = requested.get(leg.security_id, ZERO) + shares
            if requested[leg.security_id] > held:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"selling {requested[leg.security_id]} {security.ticker} "
                        f"across the scenario — only {held} held"
                    ),
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
        # One sale per lot: listing a lot twice would double-count its ordinary income
        # and capital gain into the scenario (branch review I1's ESPP half).
        seen_lots: set[int] = set()
        _ticker, quote_price, _quoted_at = await _espp_quote(db)
        for leg in body.espp_sales:
            if leg.lot_id in seen_lots:
                raise HTTPException(
                    status_code=422, detail=f"lot {leg.lot_id} appears more than once"
                )
            seen_lots.add(leg.lot_id)
            lot = await db.get(EsppLot, leg.lot_id)
            if lot is None:
                raise HTTPException(status_code=404, detail=f"unknown lot {leg.lot_id}")
            if lot.sold_date is not None:
                raise HTTPException(status_code=409, detail=f"lot {leg.lot_id} already sold")
            if leg.sale_price is not None:
                sale_price = quantize_price(leg.sale_price, "sale_price")
                if sale_price <= 0:
                    raise HTTPException(status_code=422, detail="sale_price must be positive")
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
        effective_rate=rate_delta(scenario.totals.effective_rate, baseline.totals.effective_rate),
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
