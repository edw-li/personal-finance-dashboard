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
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
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
from app.api.paycheck import (
    MAX_PAY_PERIODS,
    MIN_PAY_PERIODS,
    PAY_PERIODS_MESSAGE,
    _default_profile,
)
from app.database import get_db
from app.models import (
    EsppLot,
    PaycheckProfile,
    Person,
    RsuGrant,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
)
from app.schemas.taxes import (
    BracketIn,
    BracketOut,
    BracketReviewFlags,
    BracketsIn,
    BracketsOut,
    CapitalGainsTaxOut,
    ChangedInput,
    ClonedBracketsOut,
    EsppSaleDetailOut,
    FilingStatus,
    IncomeTaxOut,
    IncompleteYearOut,
    SafeHarborOut,
    SaleDetailOut,
    TaxInputItemOut,
    TaxInputRowIn,
    TaxInputSectionOut,
    TaxInputsIn,
    TaxInputsOut,
    TaxPersonOut,
    TaxSummariesOut,
    TaxSummaryOut,
    TaxTotalsOut,
    TaxYearOut,
    TaxYearUpdate,
    WageTaxOut,
    WhatIfDelta,
    WhatIfIn,
    WhatIfOut,
    WithholdingLegOut,
    WithholdingOut,
    WithholdingPartnerLegOut,
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
from app.services.people import load_people, primary_person
from app.services.portfolio_calc import SHARE_Q, fold_transactions, load_portfolio
from app.services.scheduler import product_today
from app.services.tax_service import (
    JURISDICTION_WARN_MISSING,
    SUGGESTION_QUANTUM,
    Bracket,
    EarnerWages,
    JurisdictionResult,
    TaxBreakdown,
    compute_breakdown,
    derive_suggestions,
    earner_from_inputs,
    shift_earners,
)
from app.services.tax_whatif import (
    EsppSaleDetail,
    SaleDetail,
    apply_scenario,
    classify_sale,
    decompose_espp,
)
from app.tax_keys import (
    JURISDICTIONS,
    MARRIED_JOINT,
    MARRIED_SEPARATE,
    PER_PERSON_KEYS,
    SECTIONS,
    SINGLE,
    TAX_INPUT_DEFINITIONS,
)

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
FilingStatusQuery = Annotated[FilingStatus, Query()]
# See BracketReviewFlags: per-PERSON parameters clone verbatim, per-RETURN thresholds do not.
VERBATIM_OK_JURISDICTIONS = ("social_security", "disability")
REVIEW_JURISDICTIONS = ("federal", "state", "capital_gains", "medicare")
ZERO = Decimal("0")
# Above this the ratio is nonsense anyway (near-zero denominator), and quantize_pct would
# need more digits than the Decimal context has.
RATE_MAX_ABS = Decimal("1e12")
# Spelled once: the ONE per-person key whose suggestion comes from outside tax_inputs.
ANNUAL_SALARY_KEY = "annual_salary"


async def _require_year(db: AsyncSession, year: int) -> None:
    if await db.get(TaxYear, year) is None:
        raise HTTPException(status_code=404, detail=f"tax year {year} not found")


async def _ensure_year(db: AsyncSession, year: int) -> None:
    """Auto-create the parent row so the editors never need a separate "add year" call."""
    if await db.get(TaxYear, year) is None:
        db.add(TaxYear(year=year))
        await db.flush()  # the inputs/brackets FK to it inside this same transaction


BRACKETS_MISSING_WARNING = (
    "{year} is filed as {status} and has no {status} bracket table for: {jurisdictions}"
)
# A sentinel, not None: None is a legal person column (the pre-household spelling), so
# "this row belongs to somebody else" needs its own value.
OFF_RETURN = object()


@dataclass
class EngineFeed:
    """Everything `compute_breakdown` needs for one year, resolved ONCE.

    The summary, the trend feed, the what-if, the withholding card and the Overview
    money-flow all read this, so they can never disagree about which filing status was
    assumed, which bracket tables were selected, or whose W-2 rows were counted.
    """

    year: int
    filing_status: str
    inputs: dict[str, Decimal]
    earners: list[EarnerWages] | None
    tables: dict[str, list[Bracket]]
    brackets_missing_for_status: list[str] = dataclass_field(default_factory=list)
    # The raw rows `inputs`/`earners` were assembled FROM, carried along so a caller that
    # also needs "whose money is it" (the withholding card's partner block) re-reads this
    # list rather than issuing a second query: two queries can straddle a concurrent write
    # and disagree about the very rows the liability above was computed on.
    rows: list[TaxInput] = dataclass_field(default_factory=list)

    @property
    def computable(self) -> bool:
        """'single' always computes (the grandfathered path every stored year uses); a
        married status refuses rather than walk a single filer's thresholds."""
        return self.filing_status == SINGLE or not self.brackets_missing_for_status

    def warning(self) -> str:
        return BRACKETS_MISSING_WARNING.format(
            year=self.year,
            status=self.filing_status,
            jurisdictions=", ".join(self.brackets_missing_for_status),
        )


def _return_people(people: list[Person], filing_status: str) -> list[Person]:
    """The people whose per-person rows belong on THIS year's return.

    Married-joint is one return for two people, so both columns count. Single and MFS are
    one return for ONE person: an MFS return carries only that spouse's wages (the
    community-property caveat the page renders is exactly about what this does NOT model),
    and a partner's rows entered for a later year must never leak into a settled single
    year. An empty roster is a database older than the household migration — every row is
    simply the primary person's, spelled NULL.
    """
    if not people:
        return []
    return list(people) if filing_status == MARRIED_JOINT else people[:1]


def _owner_column(person_id: int | None, columns: list[int | None]):
    """Which person column a stored row belongs to, or OFF_RETURN when it belongs to
    somebody this year's return does not cover.

    A NULL person_id on a PER-PERSON key is the pre-household spelling of "the primary
    person", so it folds onto the first column — which is what makes a `create_all` test
    database (no people at all) read exactly as it did before the migration.
    """
    if person_id is None:
        return columns[0]
    if person_id in columns:
        return person_id
    return OFF_RETURN


def _assemble_inputs(rows: list[TaxInput], columns: list[int | None]) -> dict[str, Decimal]:
    """The engine's flat input dict: household keys verbatim, per-person keys SUMMED
    across the people on this return (spec §5.4)."""
    values: dict[str, Decimal] = {}
    for row in rows:
        if row.key in PER_PERSON_KEYS and _owner_column(row.person_id, columns) is OFF_RETURN:
            continue
        existing = values.get(row.key)
        values[row.key] = row.value if existing is None else existing + row.value
    return values


def _assemble_earners(rows: list[TaxInput], columns: list[int | None]) -> list[EarnerWages] | None:
    """One wage bundle per person on the return — or None when there is at most one.

    None is not a fallback: it is the instruction to the engine to synthesize the single
    bundle from `inputs` exactly as it always has, which is what keeps every single-filer
    year byte-identical.
    """
    per_person: dict[int | None, dict[str, Decimal]] = {}
    for row in rows:
        if row.key not in PER_PERSON_KEYS:
            continue
        column = _owner_column(row.person_id, columns)
        if column is OFF_RETURN:
            continue
        bucket = per_person.setdefault(column, {})
        existing = bucket.get(row.key)
        bucket[row.key] = row.value if existing is None else existing + row.value
    if len(per_person) < 2:
        return None
    # In COLUMN order (primary first), not sorted: `shift_earners` re-bases the what-if on
    # bundle[0] because that is the primary person's, and any other ordering silently moves
    # their sale onto the partner's wage base. A plain sort cannot express this — `sorted(…,
    # key=str)` would even put person 10 ahead of person 2 — while `columns` already carries
    # the order `_return_people` established, and mixes None in safely.
    return [earner_from_inputs(per_person[column]) for column in columns if column in per_person]


async def _filing_status(db: AsyncSession, year: int) -> str:
    """A year that does not exist reads as single — the engine's default, and the answer
    every GET-never-rejects path needs for an unknown year."""
    row = await db.get(TaxYear, year)
    return SINGLE if row is None else row.filing_status


async def _engine_tables(
    db: AsyncSession, year: int, filing_status: str = SINGLE
) -> dict[str, list[Bracket]]:
    """One year+status's bracket tables in the shape `compute_breakdown` (and `walk`) take.

    ONE loader for every engine caller — the summary, the what-if and the withholding card
    — so they can never disagree about which rows the engine saw. The full key order, not
    just bracket_index: `walk`/`stack` sort defensively, so this pins one table order
    across all of them rather than leaving it to whatever the planner returns.
    """
    rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year, TaxBracket.filing_status == filing_status)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    tables: dict[str, list[Bracket]] = {}
    for row in rows:
        tables.setdefault(row.jurisdiction, []).append((row.rate, row.threshold))
    return tables


def _missing_for_status(tables: dict[str, list[Bracket]], filing_status: str) -> list[str]:
    """Jurisdictions with no table under this status, in tax_keys order. Always empty for
    'single' — see EngineFeed.computable."""
    if filing_status == SINGLE:
        return []
    return [name for name in JURISDICTIONS if not tables.get(name)]


async def _engine_feed(
    db: AsyncSession, year: int, people: list[Person] | None = None
) -> EngineFeed:
    """One year's feed. `people` is an optional hoist for callers that loop over years —
    the roster is the same for all of them — and defaults to loading it here, so a
    single-year caller cannot forget it and read a stale one."""
    filing_status = await _filing_status(db, year)
    if people is None:
        people = await load_people(db)
    columns = [person.id for person in _return_people(people, filing_status)] or [None]
    rows = list((await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars())
    tables = await _engine_tables(db, year, filing_status)
    return EngineFeed(
        year=year,
        filing_status=filing_status,
        inputs=_assemble_inputs(rows, columns),
        earners=_assemble_earners(rows, columns),
        tables=tables,
        brackets_missing_for_status=_missing_for_status(tables, filing_status),
        rows=rows,
    )


def _breakdown_for(feed: EngineFeed) -> TaxBreakdown:
    return compute_breakdown(
        feed.year,
        feed.inputs,
        feed.tables,
        filing_status=feed.filing_status,
        earners=feed.earners,
    )


async def _profile_salaries(
    db: AsyncSession, columns: list[int | None], today: date
) -> dict[int, Decimal]:
    """Each person column's annual salary from THEIR paycheck profile in force, or no
    entry at all for a person who has none.

    `_default_profile` is the paycheck router's own "profile in force" rule, borrowed
    rather than re-derived (this module's cross-router note): the Paycheck page and the
    Taxes page must never disagree about which profile is current, which is also why the
    clock read here is `date.today()` — the same one that router reads. One query per
    person on a household of two or three.
    """
    salaries: dict[int, Decimal] = {}
    for column in columns:
        if column is None:
            continue  # the roster-less column: no person, so no profile can exist
        profile = await _default_profile(db, column, today)
        if profile is not None:
            salaries[column] = profile.annual_salary.quantize(
                SUGGESTION_QUANTUM, rounding=ROUND_HALF_UP
            )
    return salaries


async def _inputs_payload(db: AsyncSession, year: int) -> TaxInputsOut:
    """Every definition, one item per PERSON COLUMN, each with its own suggestions.

    Columns are the people this year's return covers (`_return_people`): one — the
    primary — for single and MFS, everybody for married-joint, and a single NULL column on
    a database with no roster, which reproduces today's payload byte for byte. Household
    keys always render exactly once, with person_id null.
    """
    definitions = list((await db.execute(select(TaxInputDefinition))).scalars())
    filing_status = await _filing_status(db, year)
    people = _return_people(await load_people(db), filing_status)
    columns: list[int | None] = [person.id for person in people] or [None]

    rows = list((await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars())
    household = {row.key: row.value for row in rows if row.key not in PER_PERSON_KEYS}
    owned: dict[int | None, dict[str, Decimal]] = {column: {} for column in columns}
    for row in rows:
        if row.key not in PER_PERSON_KEYS:
            continue
        column = _owner_column(row.person_id, columns)
        if column is not OFF_RETURN:
            owned[column][row.key] = row.value

    # One suggestion map per column: the derived-W2 chain is one PERSON's, and the
    # household references it also reads are shared, so a household key's suggestion is
    # the same in every column (which is why it can render once, from the first).
    suggestions = {
        column: derive_suggestions(year, household | values, filing_status)
        for column, values in owned.items()
    }
    # The HEAD of the derived-W2 chain. `annual_salary` has no sheet formula, so
    # derive_suggestions never offers one — but a person with a paycheck profile in force
    # has already told the app their salary, and this page should offer it rather than ask
    # twice (2026-08-27 spec §4.1). Per column, from THAT person's profile: a column whose
    # person has none keeps today's empty suggestion, and nothing downstream moves, because
    # gross_paycheck still divides the STORED annual_salary.
    for column, salary in (await _profile_salaries(db, columns, date.today())).items():
        suggestions[column][ANNUAL_SALARY_KEY] = salary
    by_section: dict[str, list[TaxInputItemOut]] = {}
    for definition in sorted(definitions, key=lambda d: (d.sort_order, d.key)):
        item_columns = columns if definition.is_per_person else [None]
        for column in item_columns:
            source = owned[column] if definition.is_per_person else household
            by_section.setdefault(definition.section, []).append(
                TaxInputItemOut(
                    key=definition.key,
                    label=definition.label,
                    sort_order=definition.sort_order,
                    is_derived=definition.is_derived,
                    is_per_person=definition.is_per_person,
                    person_id=column if definition.is_per_person else None,
                    value=source.get(definition.key),
                    # Presence here — not is_derived — is what the UI shows a chip for: the
                    # sheet computes capital_loss_deductions although it seeds as a plain
                    # input.
                    suggested=suggestions[column if definition.is_per_person else columns[0]].get(
                        definition.key
                    ),
                )
            )
    # tax_keys order first; a section seeded later still renders (appended, name order).
    ordered = [name for name in SECTIONS if name in by_section]
    ordered += sorted(set(by_section) - set(SECTIONS))
    return TaxInputsOut(
        year=year,
        filing_status=filing_status,
        people=[TaxPersonOut(id=person.id, name=person.name) for person in people],
        sections=[TaxInputSectionOut(section=name, items=by_section[name]) for name in ordered],
    )


async def _statuses_with_rows(db: AsyncSession, year: int) -> list[str]:
    """Every filing status this YEAR has at least one stored bracket row for, sorted.

    The editor's status tabs read it: "which tables have I already entered" is a question
    about the year, not about the tab currently open, so it rides on every brackets
    payload rather than being re-derived per tab.
    """
    return sorted(
        (
            await db.execute(
                select(TaxBracket.filing_status).where(TaxBracket.year == year).distinct()
            )
        )
        .scalars()
        .all()
    )


async def _brackets_payload(
    db: AsyncSession, year: int, filing_status: str = SINGLE
) -> BracketsOut:
    rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year, TaxBracket.filing_status == filing_status)
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
    return BracketsOut(
        year=year,
        filing_status=filing_status,
        statuses_with_rows=await _statuses_with_rows(db, year),
        jurisdictions=tables,
    )


async def _year_out(db: AsyncSession, row: TaxYear) -> TaxYearOut:
    inputs = (
        await db.execute(
            select(func.count()).select_from(TaxInput).where(TaxInput.year == row.year)
        )
    ).scalar_one()
    brackets = (
        await db.execute(
            select(func.count()).select_from(TaxBracket).where(TaxBracket.year == row.year)
        )
    ).scalar_one()
    return TaxYearOut(
        year=row.year,
        notes=row.notes,
        filing_status=row.filing_status,
        input_count=inputs,
        bracket_count=brackets,
    )


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
            filing_status=row.filing_status,
            input_count=input_counts.get(row.year, 0),
            bracket_count=bracket_counts.get(row.year, 0),
        )
        for row in years
    ]


@router.patch("/years/{year}", response_model=TaxYearOut)
async def update_year(
    year: YearPath, body: TaxYearUpdate, db: AsyncSession = Depends(get_db)
) -> TaxYearOut:
    """Set a year's filing status — the one field on a year row the editors can change.

    NO auto-create (the PUTs own that affordance): a status is a statement ABOUT a year
    that must already exist. Bracket tables are NOT moved or copied: flipping 2026 to
    married_joint while only single-filer tables exist is a legitimate intermediate state,
    reported by the summary's `brackets_missing_for_status` and fixed by the clone helper,
    never guessed at here. Stored inputs are untouched too — the partner's rows simply
    come onto the return.
    """
    row = await db.get(TaxYear, year)
    if row is None:
        raise HTTPException(status_code=404, detail=f"tax year {year} not found")
    row.filing_status = body.filing_status
    await db.commit()
    return await _year_out(db, row)


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
    """Bulk upsert of the (key, person) slots in the body; a null value unsets one slot.

    Re-import interplay (Plan 2 forward note): the taxes import is sheet-wins within the
    years it covers, so edits made here to an imported year are clobbered by the next
    re-import — for the PRIMARY person's sheet-tracked keys only, since the importer's
    sweeps are scoped to the sheet's own vocabulary and to that one person.
    """
    submitted = [TaxInputRowIn(key=key, value=value) for key, value in body.values.items()]
    submitted += list(body.rows)
    await _require_known_input_keys(db, [row.key for row in submitted])

    definitions = {
        definition.key: definition
        for definition in (await db.execute(select(TaxInputDefinition))).scalars()
    }
    people = await load_people(db)
    known_people = {person.id for person in people}
    primary = primary_person(people)
    # Which column a legacy person_id-NULL row is ALREADY read as. `_owner_column` folds a
    # per-person NULL onto columns[0], and `_return_people` only ever truncates the roster,
    # so under every filing status that column is people[0] — the primary.
    null_row_column = people[0].id if people else None

    # Resolve and quantize EVERY row before the first write: a 422 raised halfway through
    # a bulk upsert would otherwise leave the year half-edited (portfolio PATCH posture).
    resolved: dict[tuple[str, int | None], Decimal | None] = {}
    for row in submitted:
        definition = definitions[row.key]
        if not definition.is_per_person:
            if row.person_id is not None:
                raise HTTPException(
                    status_code=422,
                    detail=f"{row.key} is a household input — person_id must be null",
                )
            owner: int | None = None
        elif row.person_id is None:
            # Today's clients send no person at all; a per-person line with no owner is
            # the primary's, which is precisely what every stored row was before the
            # migration. On a roster-less database that is still NULL.
            owner = primary.id if primary is not None else None
        elif row.person_id not in known_people:
            raise HTTPException(status_code=422, detail=f"unknown person {row.person_id}")
        else:
            owner = row.person_id
        slot = (row.key, owner)
        if slot in resolved:
            raise HTTPException(
                status_code=422, detail=f"{row.key} appears twice for the same person"
            )
        resolved[slot] = _validated_input_value(row.key, row.value)

    await _ensure_year(db, year)
    existing = {
        (row.key, row.person_id): row
        for row in (await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars()
    }
    for (key, owner), value in resolved.items():
        row = existing.get((key, owner))
        if row is None and owner is not None and owner == null_row_column:
            # The pre-household spelling of the same slot: a NULL row on a per-person key,
            # written before the roster existed. ADOPT it rather than inserting a second
            # row the (year, key, person) unique key would rightly reject.
            #
            # Only the PRIMARY may, because every read path already attributes that row to
            # them: letting a PARTNER write take it over would move a value out of the
            # primary's column without the primary's line being touched, and a partner
            # `null` would DELETE money the summary was counting as the primary's. A
            # partner write of such a key therefore inserts its own row and leaves the NULL
            # one alone. POP, not get, belt-and-braces behind that guard: one legacy row
            # can only ever become ONE person's.
            row = existing.pop((key, None), None)
        if value is None:
            if row is not None:
                await db.delete(row)  # null means "unset this line", not "store 0"
        elif row is None:
            db.add(TaxInput(year=year, key=key, person_id=owner, value=value))
        else:
            row.person_id = owner
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
async def get_brackets(
    year: YearPath,
    filing_status: FilingStatusQuery = SINGLE,
    db: AsyncSession = Depends(get_db),
) -> BracketsOut:
    """One status's six tables. The default is 'single' rather than the YEAR's status on
    purpose: the editor renders status TABS and asks for the one it is showing, so the
    answer must depend on the request, not on a setting the user is mid-way through
    changing."""
    await _require_year(db, year)
    return await _brackets_payload(db, year, filing_status)


@router.put("/years/{year}/brackets", response_model=BracketsOut)
async def put_brackets(
    year: YearPath, body: BracketsIn, db: AsyncSession = Depends(get_db)
) -> BracketsOut:
    # Re-import interplay: same sheet-wins posture as PUT inputs — a SINGLE-status bracket
    # table edited here for an imported year is replaced by the next workbook import. The
    # married tables are invisible to the importer entirely.
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
        # (year, jurisdiction, filing_status, bracket_index) unique constraint.
        await db.execute(
            delete(TaxBracket).where(
                TaxBracket.year == year,
                TaxBracket.jurisdiction == name,
                TaxBracket.filing_status == body.filing_status,
            )
        )
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    filing_status=body.filing_status,
                    bracket_index=index,  # 1-based array order, renumbered on every replace
                    rate=rate,
                    threshold=threshold,
                )
            )
    await db.commit()
    return await _brackets_payload(db, year, body.filing_status)


@router.post("/years/{year}/clone-brackets-from/{source_year}", response_model=ClonedBracketsOut)
async def clone_brackets(
    year: YearPath,
    source_year: YearPath,
    target_status: FilingStatusQuery = SINGLE,
    db: AsyncSession = Depends(get_db),
) -> ClonedBracketsOut:
    """Seed a year+status from an existing year's SINGLE tables; then edited in place.

    The source is always 'single' — the helper's whole job is "start my married tables
    from my single ones", and the app ships no bracket values of its own (spec §2). The
    source year may be the target year: cloning 2026-single into 2026-married_joint is
    exactly the page's "Clone as MFJ" button, and the emptiness guard below is what keeps
    it from being a no-op or a duplicate.
    """
    source_rows = list(
        (
            await db.execute(
                select(TaxBracket)
                .where(TaxBracket.year == source_year, TaxBracket.filing_status == SINGLE)
                .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
            )
        ).scalars()
    )
    if not source_rows:
        raise HTTPException(
            status_code=404, detail=f"no single-filer brackets to clone from {source_year}"
        )
    existing = (
        await db.execute(
            select(func.count())
            .select_from(TaxBracket)
            .where(TaxBracket.year == year, TaxBracket.filing_status == target_status)
        )
    ).scalar_one()
    if existing:
        # Never a silent merge: clear the target explicitly (PUT brackets with []) first.
        raise HTTPException(
            status_code=409,
            detail=f"tax year {year} already has {existing} {target_status} brackets",
        )

    await _ensure_year(db, year)
    for row in source_rows:
        db.add(
            TaxBracket(
                year=year,
                jurisdiction=row.jurisdiction,
                filing_status=target_status,
                bracket_index=row.bracket_index,
                rate=row.rate,
                threshold=row.threshold,
            )
        )
    await db.commit()
    payload = await _brackets_payload(db, year, target_status)
    return ClonedBracketsOut(
        year=payload.year,
        filing_status=payload.filing_status,
        statuses_with_rows=payload.statuses_with_rows,
        jurisdictions=payload.jurisdictions,
        # The FIXED six-table classification, not "what happened to be in the source": the
        # flags describe which tables are status-SENSITIVE, which is a property of the tax
        # code rather than of this particular clone.
        review_flags=BracketReviewFlags(
            verbatim_ok=list(VERBATIM_OK_JURISDICTIONS), review=list(REVIEW_JURISDICTIONS)
        ),
    )


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


def _summary_out(breakdown: TaxBreakdown, feed: EngineFeed | None = None) -> TaxSummaryOut:
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
        filing_status=SINGLE if feed is None else feed.filing_status,
        federal=federal,
        state=state,
        medicare=medicare,
        social_security=social_security,
        disability=disability,
        capital_gains=capital_gains,
        totals=totals,
        warnings=warnings,
    )


def _missing_summary_out(feed: EngineFeed) -> TaxSummaryOut:
    """The refusal payload: the year, its status, the tables it is waiting for, and NO
    numbers at all. Computing this year against the tables that DO exist would walk a
    single filer's thresholds over two salaries and report the answer with a straight
    face — the one outcome the spec's risk table calls out by name."""
    return TaxSummaryOut(
        year=feed.year,
        filing_status=feed.filing_status,
        brackets_missing_for_status=feed.brackets_missing_for_status,
        warnings=[feed.warning()],
    )


@router.get("/years/{year}/summary", response_model=TaxSummaryOut)
async def get_summary(year: YearPath, db: AsyncSession = Depends(get_db)) -> TaxSummaryOut:
    await _require_year(db, year)
    feed = await _engine_feed(db, year)
    if not feed.computable:
        return _missing_summary_out(feed)
    return _summary_out(_breakdown_for(feed), feed)


@router.get("/summary", response_model=TaxSummariesOut)
async def get_all_summaries(db: AsyncSession = Depends(get_db)) -> TaxSummariesOut:
    """The trend feed: one summary per year that has at least one stored input.

    A year whose status has no tables is SKIPPED rather than served with null sections —
    `years` is consumed positionally by the chart builders — and named in `incomplete` so
    the page can offer the fix.
    """
    years = list((await db.execute(select(TaxYear.year).order_by(TaxYear.year))).scalars())
    # The roster is the one loop-invariant, so it is loaded once; the REST of `_engine_feed`
    # stays per-year on purpose — one resolver every caller shares is worth more than
    # batching a loop that is at most ~10 years long.
    people = await load_people(db)
    summaries: list[TaxSummaryOut] = []
    incomplete: list[IncompleteYearOut] = []
    for year in years:
        feed = await _engine_feed(db, year, people)
        # A year with no inputs computes an all-zero column — noise in a trend chart.
        if not feed.inputs:
            continue
        if not feed.computable:
            incomplete.append(
                IncompleteYearOut(
                    year=year,
                    filing_status=feed.filing_status,
                    brackets_missing_for_status=feed.brackets_missing_for_status,
                )
            )
            continue
        summaries.append(_summary_out(_breakdown_for(feed), feed))
    return TaxSummariesOut(years=summaries, incomplete=incomplete)


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
# per-jurisdiction (the card's copy says so). The 110% tier applies ONLY above the
# statutory prior-year AGI gate — 150000, halved filing separately (audit §3.2: the
# multiplier shipped, the gate never did).
SAFE_HARBOR_MULTIPLIER = Decimal("1.10")
SAFE_HARBOR_BASE_MULTIPLIER = Decimal("1.00")
SAFE_HARBOR_AGI_GATE = Decimal("150000")
SAFE_HARBOR_AGI_GATE_MFS = Decimal("75000")
SAFE_HARBOR_UNAVAILABLE = "prior year {year} has no computed tax — safe harbor unavailable"
SAFE_HARBOR_NOT_COMPUTABLE = (
    "prior year {year} cannot be computed under its filing status — safe harbor unavailable"
)
# The three tables the marginal-FICA walks read. Named separately from the engine's own
# jurisdiction sweep because an empty one is silent HERE: the summary would show a 0 medicare
# line, but this card would show a 0 vest-FICA leg with nothing to explain it.
FICA_JURISDICTIONS = ("medicare", "social_security", "disability")
# The two W-2 keys that make up an earner's wage base (`earner_from_inputs`'s own pair), and
# the two tracker-only keys the partner's withholding is entered under (2026-08-26 spec §5.6
# — real inputs, deliberately never in the engine's key set, exactly like
# capital_loss_deductions).
WAGE_KEYS = ("latest_w2_income", "other_w2_income")
PARTNER_FED_WITHHOLDING_KEY = "w2_fed_withholding"
PARTNER_STATE_WITHHOLDING_KEY = "w2_state_withholding"


def _bucket_input_rows(rows: Iterable[TaxInput]) -> dict[int | None, dict[str, Decimal]]:
    """The year's stored inputs bucketed by OWNER — None is the household bucket.

    The sibling of `_assemble_inputs`: that one answers "what does the engine see", this one
    answers "whose money is it", and the withholding card is the only place that needs both.
    """
    buckets: dict[int | None, dict[str, Decimal]] = {}
    for row in rows:
        buckets.setdefault(row.person_id, {})[row.key] = row.value
    return buckets


def _wage_base(values: dict[str, Decimal]) -> Decimal:
    return sum((values.get(key, ZERO) for key in WAGE_KEYS), ZERO)


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

    feed = await _engine_feed(db, year)
    tables = feed.tables
    liability = _breakdown_for(feed) if feed.computable else None
    warnings: list[str] = []
    if not feed.computable:
        warnings.append(feed.warning())
    warnings += [
        JURISDICTION_WARN_MISSING.format(j=name, year=year)
        for name in FICA_JURISDICTIONS
        if not tables.get(name)
    ]

    # --- the partner leg (2026-08-26 spec §5.6). The partner has no paycheck profile in this
    # batch, so their side is ENTERED, not simulated: wages from their own W-2 rows,
    # withholding from the two tracker-only keys. The people are the ones `_engine_feed`
    # already put on THIS return (`_return_people`) — so on an MFS year, whose return covers
    # one spouse, there is no partner leg at all, exactly as the liability above has no
    # partner wages in it. Every other non-primary person on a joint return folds into one
    # "partner": the design ships a household of two, and a third person's wages still belong
    # on the withheld side rather than nowhere.
    people = await load_people(db)
    partner_ids = [
        person.id for person in _return_people(people, feed.filing_status) if not person.is_primary
    ]
    # `feed.rows`, not a second query: the buckets below have to be the same rows the engine
    # was fed, or the two halves of this card describe two different households.
    buckets = _bucket_input_rows(feed.rows)
    partner_values: dict[str, Decimal] = {}
    for person_id in partner_ids:
        for key, value in buckets.get(person_id, {}).items():
            partner_values[key] = partner_values.get(key, ZERO) + value
    partner_wage_base = _wage_base(partner_values)
    # By SUBTRACTION, not by looking the primary up: household-owned (NULL) W-2 rows from
    # before the person migration, or a stray third bucket, then still land on the simulated
    # side instead of disappearing — and the two halves always add back to the figure the
    # engine taxed.
    primary_wage_base = _wage_base(feed.inputs) - partner_wage_base
    has_partner = bool(partner_ids)
    partner_fed = partner_values.get(PARTNER_FED_WITHHOLDING_KEY) if has_partner else None
    partner_state = partner_values.get(PARTNER_STATE_WITHHOLDING_KEY) if has_partner else None

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

    # Whose paycheck is whose (2026-08-27 spec §4.2). Before the person migration every
    # profile was the primary's and this route fed them all to one leg; with per-person
    # profiles that would price the primary's checks off the partner's salary.
    #
    # THREE ways, not a subtraction (the wage bases above can subtract because
    # `_assemble_inputs` has already dropped off-return people; nothing has filtered these
    # rows): a partner on this return simulates, the primary — including the NULL
    # person_id that is the pre-household spelling of "the primary", and everything when
    # the roster has no primary at all — feeds the existing leg, and a person this year's
    # return does NOT cover (the MFS spouse) is dropped in the same silence their W-2 rows
    # are.
    primary = primary_person(people)
    primary_profiles: list[PaycheckProfile] = []
    partner_profiles: list[PaycheckProfile] = []
    for profile in profiles:
        owner = getattr(profile, "person_id", None)
        if owner is not None and owner in partner_ids:
            partner_profiles.append(profile)
        elif owner is None or primary is None or owner == primary.id:
            primary_profiles.append(profile)

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
        profiles=primary_profiles,
        past_vests=past_vests,
        future_vests=future_vests,
        medicare=tables.get("medicare", []),
        social_security=tables.get("social_security", []),
        disability=tables.get("disability", []),
        primary_wages=primary_wage_base,
        partner_wages=partner_wage_base if has_partner else ZERO,
        partner_withheld_fed=partner_fed,
        partner_withheld_state=partner_state,
        # Non-empty flips the partner's leg from ENTERED to SIMULATED, and the service
        # words the ignoring of the tracker rows above.
        partner_profiles=partner_profiles,
    )
    warnings.extend(estimated.warnings)

    # Salary withholding + vest supplemental + vest marginal FICA, plus the partner's ENTERED
    # withholding. Salary-side FICA is NOT a term: the user's all-in withholding_pct already
    # carries it (withholding_calc's note). The partner's figure counts once in EACH leg on
    # purpose — their withholding inputs are a running snapshot of the same kind as their W-2
    # wage inputs, which is what the liability above is computed on, so both legs describe the
    # same household. The three partner_* fields below are what make that visible.
    #
    # The two partner terms are MUTUALLY EXCLUSIVE by construction — the service zeroes
    # whichever mode did not win — so both are added unconditionally rather than branched
    # on `partner_source`. A branch here and a branch there is how the two drift.
    total_ytd = _money(
        estimated.salary_ytd
        + estimated.vest_supplemental_ytd
        + estimated.vest_fica_ytd
        + estimated.partner_withheld_total
        + estimated.partner_salary_ytd
    )
    total_projected = _money(
        estimated.salary_projected
        + estimated.vest_supplemental_projected
        + estimated.vest_fica_projected
        + estimated.partner_withheld_total
        + estimated.partner_salary_projected
    )
    liability_total = None if liability is None else _money(liability.totals.total_tax)

    safe_harbor = None
    if await db.get(TaxYear, year - 1) is not None:
        prior_feed = await _engine_feed(db, year - 1)
        if not prior_feed.computable:
            warnings.append(SAFE_HARBOR_NOT_COMPUTABLE.format(year=year - 1))
        else:
            prior = _breakdown_for(prior_feed)
            # Quantize FIRST, then multiply: the threshold has to be the multiplier times
            # the number rendered beside it, not times a full-precision figure nobody can
            # see. The AGI gate is judged on the displayed figure for the same reason.
            prior_total = _money(prior.totals.total_tax)
            prior_agi = _money(prior.federal.agi)
            if prior_total <= ZERO:
                # A bare tax_years row (or one whose credits swallowed the tax) makes the
                # whole comparison vacuous: any withholding at all clears a zero-or-negative
                # threshold, so a met=True badge would be a false all-clear. Say why instead.
                warnings.append(SAFE_HARBOR_UNAVAILABLE.format(year=year - 1))
            else:
                gate = (
                    SAFE_HARBOR_AGI_GATE_MFS
                    if prior_feed.filing_status == MARRIED_SEPARATE
                    else SAFE_HARBOR_AGI_GATE
                )
                # The PRIOR year's status, not this year's: it is that return's AGI being
                # tested, and the wedding year is precisely when the two differ.
                multiplier = (
                    SAFE_HARBOR_MULTIPLIER if prior_agi > gate else SAFE_HARBOR_BASE_MULTIPLIER
                )
                threshold = _money(prior_total * multiplier)
                safe_harbor = SafeHarborOut(
                    prior_year=year - 1,
                    prior_total_tax=prior_total,
                    prior_agi=prior_agi,
                    multiplier=multiplier,
                    prior_filing_status=prior_feed.filing_status,
                    threshold=threshold,
                    # Judged on the DISPLAYED figures (paycheck.py's negative-net posture),
                    # so the badge can never contradict the two numbers rendered next to it.
                    met=total_projected >= threshold,
                )

    return WithholdingOut(
        year=year,
        filing_status=feed.filing_status,
        brackets_missing_for_status=feed.brackets_missing_for_status,
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
        balance_projected=(
            None if liability_total is None else _money(liability_total - total_projected)
        ),
        checks_elapsed=estimated.checks_elapsed,
        checks_total=estimated.checks_total,
        partner_wages=_money(partner_wage_base) if has_partner else None,
        partner_withheld_fed=None if partner_fed is None else _money(partner_fed),
        partner_withheld_state=None if partner_state is None else _money(partner_state),
        partner_source=estimated.partner_source,
        partner_salary=(
            None
            if estimated.partner_source != withholding_calc.PARTNER_SIMULATED
            else WithholdingPartnerLegOut(
                ytd=_money(estimated.partner_salary_ytd),
                projected=_money(estimated.partner_salary_projected),
                checks_elapsed=estimated.partner_checks_elapsed,
                checks_total=estimated.partner_checks_total,
            )
        ),
        additional_medicare_gap=_money(estimated.additional_medicare_gap),
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

    feed = await _engine_feed(db, year)
    if not feed.computable:
        # A POST, not a GET: refusing here is honest, where the summary's GET has to keep
        # answering. Computing a scenario against a single filer's thresholds would give
        # the user a delta they might act on.
        raise HTTPException(status_code=409, detail=feed.warning())
    stored = feed.inputs
    brackets = feed.tables

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
    baseline = _summary_out(
        compute_breakdown(
            year, stored, brackets, filing_status=feed.filing_status, earners=feed.earners
        ),
        feed,
    )
    scenario = _summary_out(
        compute_breakdown(
            year,
            scenario_inputs,
            brackets,
            filing_status=feed.filing_status,
            earners=shift_earners(feed.earners, stored, scenario_inputs),
        ),
        feed,
    )

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
