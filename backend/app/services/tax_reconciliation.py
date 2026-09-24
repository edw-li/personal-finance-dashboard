"""Your typed tax inputs against your own records (2026-09-23 spec §W3) — the "Will I owe?"
card's reconciliation.

The user's decision is binding here: tax inputs stay TYPED BY HAND and are never fed or
overwritten. So this module only compares. Per person on the return it lines each typed input
up beside what Paycheck, Comp and ESPP project for it — salary wages, the traditional 401(k),
the employee's HSA deferral, RSU income and ESPP sale income — prices each difference as a
change in the year's liability, flags the ones worth more than $250 of tax, and says what the
balance would be if every line matched. Nothing is written; the headline balance stays the one
on the typed inputs.

Pure — no DB, no clock, no HTTP (tax_service's posture). The router gathers the facts (each
person's materialized inputs, their COUNTED check grid already capped at the year's stored
limits, the vest and ESPP projections) and hands over a pricer: the year's liability, at cents,
with some (key, person, value) replacements laid over the stored rows by the inputs preview's
own adoption rule. One overlay per row, one with all of them — an engine run each, never a
query.

The flags are STATELESS (§W3, the controller's choice): flagged = |tax effect| > 250.00, with
no memory between calls, so every reader — the Taxes card, the Overview, the assistant — sees
the same flags and a restart changes nothing. The one row that moves with live quotes, RSU
income, is judged at the close on or before the 1st of the month inside a ±10 % band of the
not-yet-vested income, which is how "hysteresis so live quotes don't flicker" is met without
state; the figures it SHOWS stay on today's quote.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.schemas.taxes import (
    ReconciliationApplyOut,
    ReconciliationFactsOut,
    ReconciliationOut,
    ReconciliationRowOut,
)

ZERO = Decimal("0")
CENT = Decimal("0.01")
WHOLE = Decimal("1")
# The flag line (§W3): a difference is worth reading only when it moves the year's tax by
# more than this. Strictly more — $250.00 of effect is the line, not over it.
FLAG_ABOVE = Decimal("250.00")
# The RSU row's band (§W3): the not-yet-vested income can move this much with the quote
# before the flag notices — ±10 % of it, so a ±8 % quote move on a matched row never flags.
QUOTE_TOLERANCE = Decimal("0.10")

# (key, person_id, value): one input slot replaced in memory — person None is a household key
# (or the pre-household spelling of the primary, which the router's adoption rule resolves).
Overlay = tuple[str, int | None, Decimal]
# The year's liability at cents with these replacements laid over the stored rows.
Pricer = Callable[[Sequence[Overlay]], Decimal]

SALARY_KEYS = ("pay_periods", "annual_salary", "w2_salary_checkpoint")
CHECKPOINT_KEY = "w2_salary_checkpoint"
LATEST_W2_KEY = "latest_w2_income"
TRAD_401K_KEY = "trad_401k_contributions"
HSA_KEY = "hsa_contributions"
RSU_KEY = "w2_stock_rsus_sold"
ESPP_ORDINARY_KEY = "w2_espp_sale_component"
ESPP_LONG_KEY = "ltcg_espp_component"
ESPP_SHORT_KEY = "stcg_espp_component"
ESPP_KEYS = (ESPP_ORDINARY_KEY, ESPP_LONG_KEY, ESPP_SHORT_KEY)

NO_PROFILE_NOTE = (
    "{name} has no paycheck profile, so their inputs are not reconciled — their withholding "
    "comes from the entered W-2 rows"
)
# The primary's own sentence: their withholding does NOT come from W-2 rows (their salary leg
# is simply 0), so the partner's wording would be untrue of them.
PRIMARY_NO_PROFILE_NOTE = (
    "{name} has no paycheck profile, so their paycheck inputs are not reconciled — add one on "
    "the Paycheck page to project their salary"
)
NEVER_RECONCILED_NOTE = (
    "Never reconciled: dental and vision, the employer's HSA deposit, bonuses, dividends and "
    "interest, and brokerage gains — check those against your W-2 and 1099s by hand."
)


@dataclass(frozen=True)
class PaycheckFacts:
    """One person's counted-check sums (§W1–§W2), the 401(k) and HSA already capped (§W3)."""

    checks: int
    first_check: date | None
    gross: Decimal
    trad_401k: Decimal
    hsa: Decimal
    trad_capped_at: Decimal | None = None
    hsa_capped_at: Decimal | None = None


@dataclass(frozen=True)
class PersonFacts:
    """A person on the return: their materialized inputs and, when they have a usable
    paycheck profile, their grid. `paycheck` None → a note and no paycheck rows."""

    person_id: int | None
    name: str | None
    bucket: Mapping[str, Decimal]
    paycheck: PaycheckFacts | None


@dataclass(frozen=True)
class RsuFacts:
    """This year's vests: `projected` is the card's own `vest.income_projected` (past vests at
    their vest-day close, later ones at today's quote) and `future_income` its not-yet-vested
    part; the two `reference_*` figures price that part at the close on or before the 1st of
    the month instead — None when no such price exists."""

    projected: Decimal
    future_income: Decimal
    reference_projected: Decimal | None
    reference_future: Decimal | None
    reference_price: Decimal | None
    reference_date: date | None


@dataclass(frozen=True)
class EsppFacts:
    """This year's SOLD lots decomposed as the what-if decomposes a sale (§W3, after §W5)."""

    ordinary: Decimal
    long_term: Decimal
    short_term: Decimal
    lots: int


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP) + ZERO


def cap_401k(trad: Decimal, roth: Decimal, limit: Decimal | None) -> tuple[Decimal, Decimal | None]:
    """(traditional deferral payroll would take, the cap when it stopped it).

    `paycheck_calc.breakdown` never caps; payroll does. Over the 402(g) limit the deferrals
    stop, and the limit is shared by the two rates — traditional takes its share of the whole
    elective sum. No limit stored → uncapped (the caller notes it).
    """
    elective = trad + roth
    if limit is None or elective <= limit:
        return _cents(trad), None
    share = trad / elective if elective > ZERO else ZERO
    return _cents(limit * share), _cents(limit)


def cap_hsa(
    employee: Decimal, limit: Decimal | None, deposit: Decimal
) -> tuple[Decimal, Decimal | None]:
    """(employee HSA deferral payroll would take, the cap when it stopped it).

    The employer's deposit counts against the SAME cap (the Paycheck pace's own rule), so the
    employee's room is the limit less the deposit, never below 0. `limit` None — coverage
    'none' or no stored limit — caps nothing.
    """
    if limit is None:
        return _cents(employee), None
    room = max(limit - deposit, ZERO)
    if employee <= room:
        return _cents(employee), None
    return _cents(room), _cents(room)


@dataclass
class _Row:
    """A row being built: its wire fields, and the overlay that would match it."""

    out: dict
    overlays: list[Overlay]
    unchanged: bool  # the overlay would store exactly what is stored — no engine run needed
    # What the FLAG is priced on, when that is not the shown effect: the RSU row's overlay at
    # the reference close, after the band — [] when the band absorbs the whole difference.
    # None: the flag reads the shown effect (every other row, and RSU with no reference).
    flag_overlays: list[Overlay] | None = None


def _row(
    *,
    key: str,
    person: PersonFacts,
    label: str,
    source: str,
    typed: Decimal | None,
    typed_keys: Sequence[str],
    projected: Decimal,
    overlays: list[Overlay],
    unchanged: bool,
    facts: ReconciliationFactsOut,
) -> _Row | None:
    """One row — or None when neither side has anything to say (§W3: "each only when either
    side is non-zero")."""
    typed_cents = None if typed is None else _cents(typed)
    if (typed_cents is None or typed_cents == ZERO) and projected == ZERO:
        return None
    return _Row(
        out={
            "key": key,
            "person_id": person.person_id,
            "person_name": person.name,
            "label": label,
            "source": source,
            "typed": typed_cents,
            "typed_keys": list(typed_keys),
            "projected": projected,
            "difference": _cents(projected - (typed_cents or ZERO)),
            "facts": facts,
        },
        overlays=overlays,
        unchanged=unchanged,
    )


def _paycheck_rows(person: PersonFacts, paycheck: PaycheckFacts) -> list[_Row | None]:
    bucket = person.bucket
    pid = person.person_id
    rows: list[_Row | None] = []

    # Salary wages: the typed side is what the engine taxes as salary — pay periods × salary
    # / 24 plus the checkpoint — against the grid's gross over COUNTED checks (§W1). Matching
    # moves the difference onto the checkpoint at full precision, so the overlaid wages land
    # exactly on the projection.
    entered = any(key in bucket for key in SALARY_KEYS)
    checkpoint = bucket.get(CHECKPOINT_KEY, ZERO)
    typed_salary = bucket.get(LATEST_W2_KEY, ZERO) + checkpoint if entered else None
    rows.append(
        _row(
            key="salary",
            person=person,
            label="Salary wages",
            source="paycheck",
            typed=typed_salary,
            typed_keys=SALARY_KEYS,
            projected=paycheck.gross,
            overlays=[(CHECKPOINT_KEY, pid, checkpoint + paycheck.gross - (typed_salary or ZERO))],
            unchanged=typed_salary == paycheck.gross,
            facts=ReconciliationFactsOut(
                typed_pay_periods=(
                    None
                    if bucket.get("pay_periods") is None
                    else bucket["pay_periods"].quantize(WHOLE, rounding=ROUND_HALF_UP)
                ),
                typed_checkpoint=(
                    None if bucket.get(CHECKPOINT_KEY) is None else _cents(bucket[CHECKPOINT_KEY])
                ),
                projected_checks=paycheck.checks,
                projected_from=paycheck.first_check,
            ),
        )
    )
    for key, label, projected, capped_at in (
        ("trad_401k", "Traditional 401(k)", paycheck.trad_401k, paycheck.trad_capped_at),
        ("hsa", "HSA (paycheck)", paycheck.hsa, paycheck.hsa_capped_at),
    ):
        input_key = TRAD_401K_KEY if key == "trad_401k" else HSA_KEY
        typed = bucket.get(input_key)
        rows.append(
            _row(
                key=key,
                person=person,
                label=label,
                source="paycheck",
                typed=typed,
                typed_keys=(input_key,),
                projected=projected,
                overlays=[(input_key, pid, projected)],
                unchanged=typed == projected,
                facts=ReconciliationFactsOut(
                    projected_checks=paycheck.checks,
                    projected_from=paycheck.first_check,
                    capped_at=capped_at,
                ),
            )
        )
    return rows


def _rsu_flag_overlays(person: PersonFacts, rsu: RsuFacts) -> list[Overlay] | None:
    """The RSU flag's own overlay (§W3, stateless hysteresis): the not-yet-vested vests priced
    at the close on or before the 1st of the month, and the difference from the typed figure
    shrunk toward zero by QUOTE_TOLERANCE of that not-yet-vested income before it is priced.
    A quote move inside the month cannot touch it; a new reference close on the 1st can."""
    if rsu.reference_projected is None or rsu.reference_future is None:
        return None
    typed = person.bucket.get(RSU_KEY, ZERO)
    difference = rsu.reference_projected - typed
    band = QUOTE_TOLERANCE * rsu.reference_future
    beyond = max(abs(difference) - band, ZERO)
    if beyond == ZERO:
        return []
    shrunk = beyond if difference > ZERO else -beyond
    return [(RSU_KEY, person.person_id, typed + shrunk)]


def _rsu_row(person: PersonFacts, rsu: RsuFacts) -> _Row | None:
    typed = person.bucket.get(RSU_KEY)
    row = _row(
        key="rsu",
        person=person,
        label="RSU income",
        source="comp",
        typed=typed,
        typed_keys=(RSU_KEY,),
        projected=rsu.projected,
        overlays=[(RSU_KEY, person.person_id, rsu.projected)],
        unchanged=typed == rsu.projected,
        facts=ReconciliationFactsOut(
            future_vest_income=rsu.future_income,
            quote_tolerance=(
                None
                if rsu.reference_future is None
                else _cents(QUOTE_TOLERANCE * rsu.reference_future)
            ),
            reference_price=rsu.reference_price,
            reference_date=rsu.reference_date,
        ),
    )
    if row is not None:
        row.flag_overlays = _rsu_flag_overlays(person, rsu)
    return row


def _espp_row(
    person: PersonFacts, espp: EsppFacts, household: Mapping[str, Decimal]
) -> _Row | None:
    # The ordinary component is the primary's (a per-person key); the two capital components
    # are the return's (household keys) — the what-if's own mapping, one leg per component.
    stored = [
        person.bucket.get(ESPP_ORDINARY_KEY),
        household.get(ESPP_LONG_KEY),
        household.get(ESPP_SHORT_KEY),
    ]
    present = [value for value in stored if value is not None]
    typed = sum(present, ZERO) if present else None
    projected = _cents(espp.ordinary + espp.long_term + espp.short_term)
    replacements = [espp.ordinary, espp.long_term, espp.short_term]
    return _row(
        key="espp",
        person=person,
        label="ESPP sale income",
        source="espp",
        typed=typed,
        typed_keys=ESPP_KEYS,
        projected=projected,
        overlays=[
            (ESPP_ORDINARY_KEY, person.person_id, espp.ordinary),
            (ESPP_LONG_KEY, None, espp.long_term),
            (ESPP_SHORT_KEY, None, espp.short_term),
        ],
        unchanged=[value or ZERO for value in stored] == replacements,
        facts=ReconciliationFactsOut(),
    )


def reconcile(
    *,
    people: Sequence[PersonFacts],
    primary_id: int | None,
    rsu: RsuFacts | None,
    espp: EsppFacts,
    household: Mapping[str, Decimal],
    liability: Decimal,
    withheld_projected: Decimal,
    price: Pricer,
    notes: Sequence[str] = (),
) -> ReconciliationOut:
    """The rows, in column order (salary, 401(k), HSA per person; the primary's RSU and ESPP
    after their paycheck rows), each priced and flagged, plus the balance if they matched.

    `people` is the return's people, primary first; `primary_id` names whose the equity is
    (the app models no partner equity — rsu_grants and ESPP lots have no owner). `liability`
    and `withheld_projected` are the card's own two figures, at cents.
    """
    built: list[_Row] = []
    out_notes: list[str] = []
    for person in people:
        is_primary = person.person_id == primary_id
        if person.paycheck is None:
            template = PRIMARY_NO_PROFILE_NOTE if is_primary else NO_PROFILE_NOTE
            out_notes.append(template.format(name=person.name or "This person"))
        else:
            built += [row for row in _paycheck_rows(person, person.paycheck) if row is not None]
        if is_primary:
            equity = [
                None if rsu is None else _rsu_row(person, rsu),
                _espp_row(person, espp, household),
            ]
            built += [row for row in equity if row is not None]

    rows: list[ReconciliationRowOut] = []
    for row in built:
        effect = ZERO if row.unchanged else price(row.overlays) - liability
        if row.flag_overlays is None:
            flag_effect = effect
        elif row.flag_overlays:
            flag_effect = price(row.flag_overlays) - liability
        else:
            flag_effect = ZERO  # the band absorbs the whole difference
        apply = None
        if row.out["key"] == "rsu" and row.out["typed"] != row.out["projected"]:
            apply = ReconciliationApplyOut(
                key=RSU_KEY, person_id=row.out["person_id"], value=row.out["projected"]
            )
        rows.append(
            ReconciliationRowOut(
                **row.out,
                tax_effect=_cents(effect),
                flagged=abs(flag_effect) > FLAG_ABOVE,
                apply=apply,
            )
        )

    moving = [overlay for row in built if not row.unchanged for overlay in row.overlays]
    liability_if_matched = price(moving) if moving else liability
    return ReconciliationOut(
        rows=rows,
        flagged_count=sum(1 for row in rows if row.flagged),
        liability_if_matched=_cents(liability_if_matched),
        balance_if_matched=_cents(liability_if_matched - withheld_projected),
        flag_above=FLAG_ABOVE,
        notes=[*out_notes, *notes, NEVER_RECONCILED_NOTE],
    )
