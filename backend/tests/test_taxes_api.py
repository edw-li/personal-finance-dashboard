"""Taxes API: inputs/brackets editors, bracket cloning, and the computed summaries.

The 2024 fixtures are imported from `test_tax_service` on purpose — they are the Plan 5
Workbook reference pins, and one copy of them keeps a golden from drifting against the
engine's. Here they are pushed through the REAL endpoints (PUT inputs + PUT brackets), so
the summary golden also proves the DB round-trip: Numeric(14,4) inputs and Numeric(7,4)/
Numeric(12,2) brackets come back at column scale and still land on the canonical cents
(the sheet's, except the documented CA capital-gains divergence on the state chain — see
test_tax_service.py).
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text

from app.models import (
    EsppLot,
    LatestPrice,
    Person,
    PositionTransaction,
    Security,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
)
from app.seed import seed_tax_definitions
from app.services.tax_service import JURISDICTION_WARN_MISSING, SUGGESTION_KEYS
from app.tax_keys import JURISDICTIONS, SECTIONS, TAX_INPUT_DEFINITIONS
from tests.test_tax_service import YEAR_BRACKETS, YEAR_INPUTS

YEARS = "/api/v1/taxes/years"
ALL_SUMMARY = "/api/v1/taxes/summary"
WHAT_IF = "/api/v1/taxes/what-if"


@pytest.fixture
async def definitions(db):
    """The 43 tax_input_definitions rows — inputs FK to them, so they precede every seed."""
    await seed_tax_definitions(db)
    await db.commit()


def inputs_payload(year: int) -> dict[str, str]:
    return {key: str(value) for key, value in YEAR_INPUTS[year].items()}


def brackets_payload(year: int) -> dict:
    return {
        "jurisdictions": {
            name: [{"rate": str(rate), "threshold": str(threshold)} for rate, threshold in table]
            for name, table in YEAR_BRACKETS[year].items()
        }
    }


def rows(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"rate": rate, "threshold": threshold} for rate, threshold in pairs]


def items_by_key(body: dict) -> dict[str, dict]:
    return {item["key"]: item for section in body["sections"] for item in section["items"]}


async def put_inputs(auth_client, year: int, values: dict) -> dict:
    resp = await auth_client.put(f"{YEARS}/{year}/inputs", json={"values": values})
    assert resp.status_code == 200, resp.text  # fail here, not on a later KeyError
    return resp.json()


async def put_brackets(auth_client, year: int, jurisdictions: dict) -> dict:
    resp = await auth_client.put(f"{YEARS}/{year}/brackets", json={"jurisdictions": jurisdictions})
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- years ---


async def test_years_list_empty_then_reports_counts(auth_client, db, definitions):
    assert (await auth_client.get(YEARS)).json() == []

    db.add(TaxYear(year=2024, notes="imported"))
    db.add(TaxYear(year=2023))
    await db.flush()
    db.add_all(
        [
            # Column scale on purpose (conftest contract): Numeric(14,4) / (7,4) / (12,2).
            TaxInput(year=2024, key="annual_salary", value=Decimal("151000.0000")),
            TaxInput(year=2024, key="pay_periods", value=Decimal("18.0000")),
            TaxBracket(
                year=2024,
                jurisdiction="federal",
                bracket_index=1,
                rate=Decimal("0.1000"),
                threshold=Decimal("0.00"),
            ),
        ]
    )
    await db.commit()

    body = (await auth_client.get(YEARS)).json()
    assert [y["year"] for y in body] == [2023, 2024]  # ascending, not insertion order
    assert body[0] == {
        "year": 2023,
        "notes": None,
        "filing_status": "single",
        "input_count": 0,
        "bracket_count": 0,
    }
    assert body[1] == {
        "year": 2024,
        "notes": "imported",
        "filing_status": "single",
        "input_count": 2,
        "bracket_count": 1,
    }


async def test_delete_year_404_when_missing(auth_client, definitions):
    resp = await auth_client.delete(f"{YEARS}/2031")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "tax year 2031 not found"


async def test_delete_year_rejects_out_of_range_year(auth_client, definitions):
    # The century guard is on the delete path too, not just the readers/writers.
    assert (await auth_client.delete(f"{YEARS}/1899")).status_code == 422


async def test_delete_year_removes_the_whole_year_vertical(auth_client, db, definitions):
    """A phantom year (a typo'd 2030) leaves with everything under it, in one statement.

    The neighbor 2029 pins the WHERE clause: it is seeded with a vertical of its own and has
    to survive INTACT, so an unfiltered `delete(TaxYear)` fails here rather than passing.
    """
    await put_inputs(auth_client, 2030, {"annual_salary": "150000"})
    await put_brackets(auth_client, 2030, {"federal": rows(("0.10", "0"))})
    await put_inputs(auth_client, 2029, {"annual_salary": "140000"})
    await put_brackets(auth_client, 2029, {"federal": rows(("0.09", "0"))})

    assert (await auth_client.delete(f"{YEARS}/2030")).status_code == 204
    # 2030 gone and nothing recreated it; 2029 untouched, child counts and all.
    assert (await auth_client.get(YEARS)).json() == [
        {
            "year": 2029,
            "notes": None,
            "filing_status": "single",
            "input_count": 1,
            "bracket_count": 1,
        }
    ]
    assert (await auth_client.get(f"{YEARS}/2030/inputs")).status_code == 404
    n_inputs = (
        await db.execute(select(func.count()).select_from(TaxInput).where(TaxInput.year == 2030))
    ).scalar_one()
    n_brackets = (
        await db.execute(
            select(func.count()).select_from(TaxBracket).where(TaxBracket.year == 2030)
        )
    ).scalar_one()
    assert (n_inputs, n_brackets) == (0, 0)  # the DB-level CASCADE, not an ORM relationship
    # Definitions are year-independent seed data — a year delete must not touch them.
    n_defs = (await db.execute(select(func.count()).select_from(TaxInputDefinition))).scalar_one()
    assert n_defs == len(TAX_INPUT_DEFINITIONS)


async def test_empty_put_recreates_a_deleted_year(auth_client, definitions):
    """Deletion is not a tombstone: empty-PUT-creates stays law after the year is removed."""
    await put_inputs(auth_client, 2029, {})
    assert (await auth_client.delete(f"{YEARS}/2029")).status_code == 204
    await put_inputs(auth_client, 2029, {})

    years = [y["year"] for y in (await auth_client.get(YEARS)).json()]
    assert 2029 in years


# --- inputs ---


async def test_get_inputs_404_when_year_missing(auth_client, definitions):
    resp = await auth_client.get(f"{YEARS}/2024/inputs")
    assert resp.status_code == 404
    assert "2024" in resp.json()["detail"]


async def test_get_inputs_lists_every_definition_with_null_values(auth_client, definitions):
    await put_inputs(auth_client, 2024, {})  # auto-creates the bare year row

    body = (await auth_client.get(f"{YEARS}/2024/inputs")).json()
    assert body["year"] == 2024
    assert [section["section"] for section in body["sections"]] == list(SECTIONS)
    items = items_by_key(body)
    assert len(items) == len(TAX_INPUT_DEFINITIONS) == 45
    for section in body["sections"]:
        orders = [item["sort_order"] for item in section["items"]]
        assert orders == sorted(orders)
    assert items["gross_paycheck"]["label"] == "Gross Paycheck"
    assert items["gross_paycheck"]["is_derived"] is True
    assert all(item["value"] is None for item in items.values())
    # Suggestions are offered for every key derive_suggestions returns — an empty year
    # suggests zeros rather than nulls (an empty sheet cell IS a zero).
    assert {key for key, item in items.items() if item["suggested"] is not None} == set(
        SUGGESTION_KEYS
    )
    assert items["gross_paycheck"]["suggested"] == "0.0000"
    assert items["annual_salary"]["suggested"] is None


async def test_get_inputs_echoes_values_and_suggestions(auth_client, definitions):
    await put_inputs(auth_client, 2025, inputs_payload(2025))

    items = items_by_key((await auth_client.get(f"{YEARS}/2025/inputs")).json())
    assert items["annual_salary"]["value"] == "162000.0000"  # stored at Numeric(14,4)
    assert items["unq_div_state_exempt_pct"]["value"] == "0.9514"
    # The sheet's own gray-cell formulas: the stored 2025 column agrees with the engine.
    assert items["gross_paycheck"]["suggested"] == items["gross_paycheck"]["value"] == "6750.0000"
    assert (
        items["itemized_deduction"]["suggested"]
        == items["itemized_deduction"]["value"]
        == "27213.2820"
    )
    # Chips follow the suggestions map, not is_derived: capital_loss_deductions is stored
    # with is_derived=False yet the sheet computes it (Plan 5 Workbook reference).
    assert items["capital_loss_deductions"]["is_derived"] is False
    assert items["capital_loss_deductions"]["suggested"] == "0.0000"


async def test_put_inputs_creates_year_upserts_and_deletes(auth_client, definitions):
    created = await put_inputs(auth_client, 2027, {"annual_salary": "150000", "pay_periods": 18})
    items = items_by_key(created)
    assert items["annual_salary"]["value"] == "150000.0000"
    assert items["pay_periods"]["value"] == "18.0000"  # a JSON number is legal too
    years = (await auth_client.get(YEARS)).json()
    assert [(y["year"], y["input_count"]) for y in years] == [(2027, 2)]

    updated = await put_inputs(
        auth_client, 2027, {"annual_salary": "160000.12345", "pay_periods": None}
    )
    items = items_by_key(updated)
    assert items["annual_salary"]["value"] == "160000.1235"  # 4dp HALF_UP
    assert items["pay_periods"]["value"] is None  # null deletes the row
    assert (await auth_client.get(YEARS)).json()[0]["input_count"] == 1
    # Keys absent from the body are untouched, and the PUT body IS the GET shape.
    assert (await auth_client.get(f"{YEARS}/2027/inputs")).json() == updated


async def test_put_inputs_rejects_unknown_key_without_partial_write(auth_client, definitions):
    resp = await auth_client.put(
        f"{YEARS}/2024/inputs", json={"values": {"annual_salary": "1", "nope": "2"}}
    )
    assert resp.status_code == 422
    assert "nope" in resp.json()["detail"]
    assert (await auth_client.get(YEARS)).json() == []  # not even the year row


async def test_put_inputs_never_stores_a_signed_zero(auth_client, definitions):
    """A value that rounds to -0.0000 must echo as "0.0000", the way a later GET reads it.

    The UPDATE path is where it showed: the session keeps the written object
    (expire_on_commit=False), so the PUT echoes the API's own Decimal rather than
    Postgres's, and Postgres has no signed zero to hand back.
    """
    await put_inputs(auth_client, 2032, {"annual_salary": "1000"})  # seed, then UPDATE it
    body = await put_inputs(
        auth_client, 2032, {"annual_salary": "-0.00004", "pay_periods": "-0.00004"}
    )
    items = items_by_key(body)
    assert items["annual_salary"]["value"] == "0.0000"  # updated row
    assert items["pay_periods"]["value"] == "0.0000"  # inserted row
    assert (await auth_client.get(f"{YEARS}/2032/inputs")).json() == body  # byte-for-byte


async def test_put_inputs_bounds_the_year(auth_client, definitions):
    for year in (1800, 2200):
        resp = await auth_client.put(f"{YEARS}/{year}/inputs", json={"values": {}})
        assert resp.status_code == 422, year
    # Reads carry the same century guard (an int4 column would otherwise DataError).
    assert (await auth_client.get(f"{YEARS}/1800/inputs")).status_code == 422
    assert (await put_inputs(auth_client, 1900, {}))["year"] == 1900  # bounds are inclusive
    assert (await put_inputs(auth_client, 2100, {}))["year"] == 2100


async def test_put_inputs_rejects_out_of_range_and_non_numeric_values(auth_client, definitions):
    for value in ("10000000000", "-10000000000"):
        resp = await auth_client.put(
            f"{YEARS}/2024/inputs", json={"values": {"annual_salary": value}}
        )
        assert resp.status_code == 422, value  # Numeric(14,4) holds 10 integer digits
        assert "annual_salary" in resp.json()["detail"]
    non_numeric = await auth_client.put(
        f"{YEARS}/2024/inputs", json={"values": {"annual_salary": "abc"}}
    )
    assert non_numeric.status_code == 422  # pydantic's own Decimal parse
    ok = await put_inputs(auth_client, 2024, {"annual_salary": "9999999999.9999"})
    assert items_by_key(ok)["annual_salary"]["value"] == "9999999999.9999"


# --- brackets ---


async def test_get_brackets_404_then_all_six_jurisdictions(auth_client, definitions):
    assert (await auth_client.get(f"{YEARS}/2024/brackets")).status_code == 404

    await put_inputs(auth_client, 2024, {})
    body = (await auth_client.get(f"{YEARS}/2024/brackets")).json()
    assert body["year"] == 2024
    assert list(body["jurisdictions"]) == list(JURISDICTIONS)  # always all six keys
    assert all(table == [] for table in body["jurisdictions"].values())


async def test_put_brackets_replaces_one_jurisdiction_at_a_time(auth_client, definitions):
    first = await put_brackets(
        auth_client,
        2030,
        {
            "federal": rows(("0.10", "0"), ("0.20", "1000")),
            "state": rows(("0.05", "0")),
        },
    )
    assert first["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.1000", "threshold": "0.00"},
        {"bracket_index": 2, "rate": "0.2000", "threshold": "1000.00"},
    ]
    assert first["jurisdictions"]["medicare"] == []

    second = await put_brackets(auth_client, 2030, {"federal": rows(("0.01", "0"))})
    # Full replace of federal (indexes restart at 1), state untouched by omission.
    assert second["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.0100", "threshold": "0.00"}
    ]
    assert second["jurisdictions"]["state"] == [
        {"bracket_index": 1, "rate": "0.0500", "threshold": "0.00"}
    ]
    assert (await auth_client.get(f"{YEARS}/2030/brackets")).json() == second
    assert (await auth_client.get(YEARS)).json() == [
        {
            "year": 2030,
            "notes": None,
            "filing_status": "single",
            "input_count": 0,
            "bracket_count": 2,
        }
    ]


async def test_put_brackets_empty_list_deletes_that_jurisdiction(auth_client, definitions):
    await put_brackets(
        auth_client, 2030, {"federal": rows(("0.10", "0")), "state": rows(("0.05", "0"))}
    )
    body = await put_brackets(auth_client, 2030, {"state": []})
    assert body["jurisdictions"]["state"] == []  # legal: a full replace with nothing
    assert len(body["jurisdictions"]["federal"]) == 1


async def test_put_brackets_validation_rejects_bad_tables(auth_client, definitions):
    # Each case pins the DETAIL too: every guard here answers 422, so a body that trips the
    # wrong one would otherwise pass silently.
    cases = {
        "mis-scaled rate (37.43 meant as 37.43%)": (
            {"federal": rows(("37.43", "0"))},
            "jurisdictions.federal[1].rate must be between 0 and 1",
        ),
        "negative rate": (
            {"federal": rows(("-0.01", "0"))},
            "jurisdictions.federal[1].rate must be between 0 and 1",
        ),
        "first threshold not 0": (
            {"federal": rows(("0.10", "100"))},
            "federal: the first bracket threshold must be 0",
        ),
        "thresholds not ascending": (
            {"federal": rows(("0.10", "0"), ("0.20", "0"))},
            "federal: thresholds must be strictly ascending",
        ),
        # Equal thresholds away from the first row: the ascending guard, not the "first
        # threshold must be 0" one, has to be the one that fires.
        "equal thresholds mid-table": (
            {"federal": rows(("0.10", "0"), ("0.20", "1000"), ("0.30", "1000"))},
            "federal: thresholds must be strictly ascending",
        ),
        "13 rows": (
            {"federal": [{"rate": "0.10", "threshold": str(i * 1000)} for i in range(13)]},
            "federal: at most 12 brackets per jurisdiction",
        ),
        "unknown jurisdiction": (
            {"martian": rows(("0.10", "0"))},
            "unknown jurisdiction(s): ['martian']",
        ),
        "absurd threshold": (
            {"federal": rows(("0.10", "0"), ("0.20", "10000000000"))},
            "jurisdictions.federal[2].threshold: |value| must be below 10^10",
        ),
    }
    for label, (jurisdictions, detail) in cases.items():
        resp = await auth_client.put(
            f"{YEARS}/2031/brackets", json={"jurisdictions": jurisdictions}
        )
        assert resp.status_code == 422, label
        assert detail in resp.json()["detail"], label
    # A valid jurisdiction alongside an invalid one writes nothing at all.
    mixed = await auth_client.put(
        f"{YEARS}/2031/brackets",
        json={"jurisdictions": {"federal": rows(("0.10", "0")), "state": rows(("0.10", "5"))}},
    )
    assert mixed.status_code == 422
    assert "state: the first bracket threshold must be 0" in mixed.json()["detail"]
    assert (await auth_client.get(YEARS)).json() == []


async def test_put_brackets_rejects_a_mixed_body_on_its_first_table(auth_client, definitions):
    """All-or-nothing in BOTH orders: the mixed case above fails on the second jurisdiction,
    this one on the first — neither writes a bracket row, nor the year row itself."""
    resp = await auth_client.put(
        f"{YEARS}/2031/brackets",
        json={"jurisdictions": {"federal": rows(("0.10", "5")), "state": rows(("0.05", "0"))}},
    )
    assert resp.status_code == 422
    assert "federal: the first bracket threshold must be 0" in resp.json()["detail"]
    assert (await auth_client.get(YEARS)).json() == []
    assert (await auth_client.get(f"{YEARS}/2031/brackets")).status_code == 404


async def test_put_brackets_accepts_the_inclusive_boundaries(auth_client, definitions):
    """Both guards are inclusive: a rate of exactly 1 and exactly MAX_BRACKETS rows pass."""
    body = await put_brackets(
        auth_client,
        2031,
        {
            "federal": rows(("1", "0")),
            "state": [{"rate": "0.01", "threshold": str(index * 1000)} for index in range(12)],
        },
    )
    assert body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "1.0000", "threshold": "0.00"}
    ]
    assert len(body["jurisdictions"]["state"]) == 12
    assert body["jurisdictions"]["state"][-1]["bracket_index"] == 12
    assert (await auth_client.get(f"{YEARS}/2031/brackets")).json() == body


async def test_put_brackets_never_serializes_a_signed_zero(auth_client, definitions):
    """A rate/threshold that rounds to a signed zero renders as the GET renders it.

    Unlike the inputs UPDATE path, this one already survived the round trip — the ORM
    re-reads the replaced rows, and Postgres has no signed zero. The pin keeps the PUT
    echo tied to the GET so a future in-memory echo cannot reintroduce "-0.0000".
    """
    body = await put_brackets(auth_client, 2031, {"federal": rows(("-0.00004", "-0.004"))})
    assert body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.0000", "threshold": "0.00"}
    ]
    assert (await auth_client.get(f"{YEARS}/2031/brackets")).json() == body


# --- clone ---


async def test_clone_brackets_copies_every_jurisdiction(auth_client, db, definitions):
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])

    resp = await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2025
    source = (await auth_client.get(f"{YEARS}/2024/brackets")).json()
    assert body["jurisdictions"] == source["jurisdictions"]  # verbatim, index for index
    assert sum(len(table) for table in body["jurisdictions"].values()) == 25
    assert await db.get(TaxYear, 2025) is not None  # target year row created on the way
    copied = (await db.execute(select(TaxBracket).where(TaxBracket.year == 2025))).scalars().all()
    assert len(copied) == 25


async def test_clone_brackets_conflicts_and_missing_source(auth_client, definitions):
    await put_brackets(auth_client, 2024, {"federal": rows(("0.10", "0"))})
    assert (await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")).status_code == 200

    conflict = await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")
    assert conflict.status_code == 409
    assert "2025" in conflict.json()["detail"]

    missing = await auth_client.post(f"{YEARS}/2026/clone-brackets-from/2029")
    assert missing.status_code == 404
    assert "2029" in missing.json()["detail"]


async def test_clone_brackets_self_clone_is_never_a_no_op(auth_client, definitions):
    """Source == target hits the same two guards, so it can only 404 or 409 — never
    duplicate a year's own rows onto itself."""
    empty = await auth_client.post(f"{YEARS}/2029/clone-brackets-from/2029")
    assert empty.status_code == 404  # nothing to clone; the source check runs first
    assert "2029" in empty.json()["detail"]

    await put_brackets(auth_client, 2024, {"federal": rows(("0.10", "0"))})
    conflict = await auth_client.post(f"{YEARS}/2024/clone-brackets-from/2024")
    assert conflict.status_code == 409
    assert "2024" in conflict.json()["detail"]
    assert (await auth_client.get(YEARS)).json()[0]["bracket_count"] == 1  # still one row


async def test_clone_brackets_from_a_partial_source(auth_client, definitions):
    """Only the source's populated jurisdictions travel; the other five arrive as empty
    tables, not as absent keys."""
    await put_brackets(auth_client, 2024, {"state": rows(("0.05", "0"), ("0.09", "1000"))})

    resp = await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["jurisdictions"]["state"] == [
        {"bracket_index": 1, "rate": "0.0500", "threshold": "0.00"},
        {"bracket_index": 2, "rate": "0.0900", "threshold": "1000.00"},
    ]
    assert list(body["jurisdictions"]) == list(JURISDICTIONS)
    assert [name for name, table in body["jurisdictions"].items() if table] == ["state"]


# --- summaries ---


async def test_summary_2024_matches_the_sheet_except_the_state_chain(auth_client, definitions):
    """The 2024 wire golden. Sheet-exact everywhere but the state chain, which carries the
    deliberate CA capital-gains divergence (2026-08-25 spec §1) — the engine-level
    sheet-vs-canonical deltas are pinned in test_tax_service.py; this test pins the
    quantized strings the client actually renders."""
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])

    body = (await auth_client.get(f"{YEARS}/2024/summary")).json()
    assert body["year"] == 2024
    assert body["warnings"] == []  # every input present, every jurisdiction present
    assert body["federal"] == {
        "agi": "211776.20",
        "taxable_income": "197176.20",
        "tax": "40782.88",
        "effective_rate": "0.192575",
    }
    assert body["state"] == {
        "agi": "215301.15",
        "taxable_income": "209761.15",
        "tax": "15901.12",
        "effective_rate": "0.073855",
    }
    assert body["medicare"] == {
        "w2_income": "235724.46",
        "taxable_wages": "231274.46",
        "tax": "3634.95",
        "effective_rate": "0.015420",
    }
    assert body["social_security"]["taxable_wages"] == "168600.00"  # capped at the wage base
    assert body["social_security"]["tax"] == "10453.20"
    assert body["disability"] == {
        "w2_income": "235724.46",
        "taxable_wages": "235424.46",
        "tax": "1950.00",
        "effective_rate": "0.008272",
    }
    assert body["capital_gains"] == {
        "taxable_income": "197176.20",
        "gains_amount": "179.13",
        "tax": "33.68",
        "effective_rate": "0.188000",
    }
    assert body["totals"] == {
        "gross_income": "237973.17",
        "total_income": "211776.20",
        "total_tax": "72755.83",
        "take_home": "165217.34",
        "effective_rate": "0.305731",
    }


async def test_summary_2026_has_no_gains_so_no_capital_gains_rate(auth_client, definitions):
    """2026 is the pinned year with zero gains: the CG rate is the sheet's #DIV/0!, i.e.
    null rather than 0.000000. Its two headline canonical figures ride along."""
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])

    body = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["warnings"] == []
    assert body["capital_gains"] == {
        "taxable_income": "250304.21",
        "gains_amount": "0.00",
        "tax": "0.00",
        "effective_rate": None,
    }
    assert body["federal"]["tax"] == "57160.35"
    assert body["totals"]["total_tax"] == "98584.56"


async def test_summary_never_serializes_a_signed_zero(auth_client, definitions):
    """Exemption credits with no tax to offset drive state tax to -0.001, which quantizes
    to Decimal("-0.00") — "-0.00" on the wire unless the serializer collapses the sign."""
    await put_inputs(auth_client, 2033, {"state_exemption_credits": "0.001"})

    body = (await auth_client.get(f"{YEARS}/2033/summary")).json()
    assert body["state"]["tax"] == "0.00"
    assert body["totals"]["total_tax"] == "0.00"
    assert body["totals"]["take_home"] == "0.00"
    assert (await auth_client.get(ALL_SUMMARY)).json()["years"] == [body]


async def test_summary_404_when_year_missing(auth_client, definitions):
    resp = await auth_client.get(f"{YEARS}/2024/summary")
    assert resp.status_code == 404
    assert "2024" in resp.json()["detail"]


async def test_all_years_summary_skips_input_less_years(auth_client, definitions):
    await put_brackets(auth_client, 2023, brackets_payload(2023)["jurisdictions"])  # no inputs
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])
    await put_inputs(auth_client, 2025, {"annual_salary": "1"})  # sparse but non-empty

    body = (await auth_client.get(ALL_SUMMARY)).json()
    assert [year["year"] for year in body["years"]] == [2024, 2025]  # 2023 has no inputs
    assert body["years"][0]["totals"]["total_tax"] == "72755.83"

    sparse = body["years"][1]
    assert sparse["totals"]["total_tax"] == "0.00"
    assert sparse["federal"]["effective_rate"] is None  # 0 AGI: the sheet's #DIV/0!
    assert any(w.startswith("missing inputs defaulted to 0: ") for w in sparse["warnings"])
    assert JURISDICTION_WARN_MISSING.format(j="federal", year=2025) in sparse["warnings"]


async def test_summary_guards_absurd_but_legal_inputs(auth_client, definitions):
    """A GET must never 422/500 on values the API itself accepted (Task 1 review I3).

    Both factors below are bound-legal (|v| < 10^10) yet their product is ~10^20, which
    blows past every money column and — over a 0.0001 gross income — produces a ~10^23
    effective rate. Money serializes anyway (plain quantize, never money.py's bounded
    one); only the out-of-range rate degrades to null plus a warning.
    """
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])
    await put_inputs(
        auth_client,
        2024,
        {
            "unq_div_us_treasuries_etf": "9999999999.9999",
            "unq_div_state_exempt_pct": "-9999999999.9999",
            "unqualified_dividends": "0.0001",
        },
    )

    resp = await auth_client.get(f"{YEARS}/2024/summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["state"]["agi"] == "99999999999998000000.00"
    assert body["state"]["tax"] == "12299999999999735394.73"
    assert body["totals"]["total_tax"] == "12299999999999735394.73"
    assert body["totals"]["take_home"] == "-12299999999999735394.73"
    assert body["state"]["effective_rate"] == "0.123000"  # in range: still served
    assert body["totals"]["effective_rate"] is None  # ~10^23: nulled, not 500
    assert "totals effective rate out of range" in body["warnings"]
    # Stored rates render normalized in the NIIT advisory despite Numeric(7,4) scale.
    assert any(w.startswith("capital-gains rates 0.188/0.238 contradict") for w in body["warnings"])


# --- what-if ---


async def seeded_2024(auth_client) -> None:
    """The pinned 2024 column through the real editors — the what-if's baseline."""
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])


async def what_if(auth_client, **body) -> dict:
    resp = await auth_client.post(WHAT_IF, json={"year": 2024, **body})
    assert resp.status_code == 200, resp.text  # fail here, not on a later KeyError
    return resp.json()


async def seed_holding(db, *, held: str = "100.000000", quote: str | None = "62.5000") -> int:
    """100 NVDA at 50 (avg cost 50), DATELESS like the imported book, quoted at 62.50.

    Column scale on purpose (conftest contract): shares Numeric(16,6), prices Numeric(14,4).
    """
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add(security)
    await db.flush()
    db.add(
        PositionTransaction(
            security_id=security.id,
            account="Taxable",
            type="buy",
            txn_date=None,  # the dateless book: the term default has to warn
            shares=Decimal(held),
            price=Decimal("50.0000"),
            sort_index=1,
        )
    )
    if quote is not None:
        db.add(
            LatestPrice(
                security_id=security.id,
                price=Decimal(quote),
                quoted_at=datetime(2026, 8, 14, 20, 30, tzinfo=UTC),
                source="yfinance",
            )
        )
    await db.commit()
    return security.id


async def seed_lot(db, *, sold: bool = False) -> int:
    """One unsold ESPP lot, hand-computable: 10 sh, sub 100, FMV 120, price 85.

    The dates are chosen so BOTH the disposition and the term are the same on any day the
    suite runs — the router reads the real clock, so a lot whose qualifying date is decades
    out is always disqualified, and a purchase decades back is always long-term.
    """
    lot = EsppLot(
        purchase_date=date(2020, 2, 28),
        qualifying_date=date(2099, 1, 1),
        shares=Decimal("10.0000"),
        subscription_price=Decimal("100.00000"),
        purchase_fmv=Decimal("120.00000"),
        purchase_price=Decimal("85.00000"),
        sold_date=date(2021, 3, 1) if sold else None,
        sold_price=Decimal("99.00000") if sold else None,
    )
    db.add(lot)
    await db.commit()
    return lot.id


async def test_what_if_empty_scenario_echoes_baseline(auth_client, definitions):
    """The legal no-op: the engine runs twice over the same inputs, so the two panels are
    identical and every delta is a zero. The baseline is also the SUMMARY endpoint's body,
    field for field — one quantization discipline, not two."""
    await seeded_2024(auth_client)

    body = await what_if(auth_client)
    assert body["year"] == 2024
    assert body["scenario"] == body["baseline"]
    assert body["baseline"] == (await auth_client.get(f"{YEARS}/2024/summary")).json()
    assert body["delta"] == {
        "total_tax": "0.00",
        "take_home": "0.00",
        "federal_tax": "0.00",
        "state_tax": "0.00",
        "medicare_tax": "0.00",
        "social_security_tax": "0.00",
        "disability_tax": "0.00",
        "capital_gains_tax": "0.00",
        "effective_rate": "0.000000",
    }
    assert body["changed_inputs"] == []
    assert body["sale_details"] == []
    assert body["espp_sale_details"] == []
    assert body["warnings"] == []


async def test_what_if_long_sale_moves_ltcg_and_delta(auth_client, db, definitions):
    """A 40-share sale at the stored quote: average cost in, BOTH LTCG keys out."""
    await seeded_2024(auth_client)
    security_id = await seed_holding(db)

    body = await what_if(auth_client, sales=[{"security_id": security_id, "shares": "40"}])

    assert body["sale_details"] == [
        {
            "security_id": security_id,
            "ticker": "NVDA",
            "shares": "40.000000",
            "price": "62.5000",  # defaulted to the latest quote, at ITS column scale
            "proceeds": "2500.00",
            "cost_basis": "2000.00",  # 40 x the 50.00 average cost
            "gain": "500.00",
            "term": "long",
            "warnings": ["NVDA: acquisition dates unknown — treated as long-term"],
        }
    ]
    # The load-bearing pin: the COMPONENT key and the TOTAL the engine reads move together.
    assert body["changed_inputs"] == [
        {
            "key": "ltcg_brokerage",
            "label": "LTCG: Brokerage Gain/Loss",
            "before": "0.00",
            "after": "500.00",
        },
        {
            "key": "ltcg_total",
            "label": "Long Term Capital Gain/Loss",
            "before": "0.00",
            "after": "500.00",
        },
    ]
    assert body["warnings"] == ["NVDA: acquisition dates unknown — treated as long-term"]

    # The delta is the two RENDERED figures subtracted — never a third computation.
    scenario_tax = Decimal(body["scenario"]["totals"]["total_tax"])
    baseline_tax = Decimal(body["baseline"]["totals"]["total_tax"])
    assert Decimal(body["delta"]["total_tax"]) == scenario_tax - baseline_tax
    assert scenario_tax > baseline_tax  # 500 of long-term gain costs real tax
    assert Decimal(body["delta"]["capital_gains_tax"]) == Decimal(
        body["scenario"]["capital_gains"]["tax"]
    ) - Decimal(body["baseline"]["capital_gains"]["tax"])
    assert Decimal(body["delta"]["take_home"]) == Decimal(
        body["scenario"]["totals"]["take_home"]
    ) - Decimal(body["baseline"]["totals"]["take_home"])
    # The 2026-08-25 CA-CG fix's user-visible symptom: a long-term sale must move STATE
    # tax too — the panel can never again answer "Δ state ≈ $0" for a long sale.
    assert Decimal(body["delta"]["state_tax"]) == Decimal(
        body["scenario"]["state"]["tax"]
    ) - Decimal(body["baseline"]["state"]["tax"])
    assert Decimal(body["delta"]["state_tax"]) > 0
    # Nothing about the sale reached the stored year.
    assert (await auth_client.get(f"{YEARS}/2024/summary")).json() == body["baseline"]


async def test_what_if_espp_disqualified_hits_w2_and_fica(auth_client, db, definitions):
    """A disqualified disposition splits into W-2 ordinary income and a capital leg, and
    the ordinary half raises the engine's FICA wage bases — sheet-faithful (the sheet's
    ESPP component rolls into the W-2 total; real-world ESPP ordinary income is FICA-exempt).
    """
    await seeded_2024(auth_client)
    lot_id = await seed_lot(db)

    body = await what_if(auth_client, espp_sales=[{"lot_id": lot_id, "sale_price": "150.0000"}])

    assert body["espp_sale_details"] == [
        {
            "lot_id": lot_id,
            "purchase_date": "2020-02-28",
            "shares": "10.0000",
            "sale_price": "150.0000",
            "proceeds": "1500.00",
            "ordinary_income": "350.00",  # (120 - 85) x 10, the bargain element at purchase
            "capital_gain": "300.00",  # (150 - 120) x 10
            "term": "long",
            "disposition": "disqualified",
            "warnings": [],
        }
    ]
    assert body["changed_inputs"] == [
        {
            "key": "ltcg_espp_component",
            "label": "LTCG: ESPP Sale Component",
            "before": "0.00",
            "after": "300.00",
        },
        {
            "key": "ltcg_total",
            "label": "Long Term Capital Gain/Loss",
            "before": "0.00",
            "after": "300.00",
        },
        {
            "key": "other_w2_income",
            "label": "Other W2 Income",
            "before": "122474.46",
            "after": "122824.46",
        },
        {
            "key": "w2_espp_sale_component",
            "label": "W2: ESPP Sale Component",
            "before": "0.00",
            "after": "350.00",
        },
    ]
    # FICA moves with the W-2 line: Medicare has no cap, so the 350 meets the 2.35% tier.
    assert Decimal(body["delta"]["medicare_tax"]) > 0
    assert Decimal(body["delta"]["medicare_tax"]) == Decimal(
        body["scenario"]["medicare"]["tax"]
    ) - Decimal(body["baseline"]["medicare"]["tax"])
    assert body["scenario"]["medicare"]["taxable_wages"] == "231624.46"  # 231274.46 + 350
    # ...and does NOT move where the 2024 wage bases are already capped out.
    assert body["delta"]["social_security_tax"] == "0.00"  # capped at 168600
    assert body["delta"]["disability_tax"] == "0.00"  # 0-rate above 195000


async def test_what_if_oversell_422(auth_client, db, definitions):
    await seeded_2024(auth_client)
    security_id = await seed_holding(db)

    resp = await auth_client.post(
        WHAT_IF,
        json={"year": 2024, "sales": [{"security_id": security_id, "shares": "150"}]},
    )
    assert resp.status_code == 422
    # Both figures at share scale, so the sentence reads like the holdings table.
    assert (
        resp.json()["detail"]
        == "selling 150.000000 NVDA across the scenario — only 100.000000 held"
    )


async def test_what_if_duplicate_legs_cannot_oversell_in_aggregate(auth_client, db, definitions):
    """The fence sums ACROSS legs (branch review I1): two 60-share legs against a
    100-share position must 422 even though each leg alone would pass."""
    await seeded_2024(auth_client)
    security_id = await seed_holding(db)

    resp = await auth_client.post(
        WHAT_IF,
        json={
            "year": 2024,
            "sales": [
                {"security_id": security_id, "shares": "60"},
                {"security_id": security_id, "shares": "60"},
            ],
        },
    )
    assert resp.status_code == 422
    assert (
        resp.json()["detail"]
        == "selling 120.000000 NVDA across the scenario — only 100.000000 held"
    )


async def test_what_if_duplicate_lot_422(auth_client, db, definitions):
    """Listing a lot twice would double-count its ordinary income and capital gain."""
    await seeded_2024(auth_client)
    lot_id = await seed_lot(db)

    resp = await auth_client.post(
        WHAT_IF,
        json={
            "year": 2024,
            "espp_sales": [
                {"lot_id": lot_id, "sale_price": "150"},
                {"lot_id": lot_id, "sale_price": "160"},
            ],
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"lot {lot_id} appears more than once"


async def test_what_if_no_price_paths_422(auth_client, db, definitions):
    """Both defaulted-price branches refuse when nothing is quoted (branch review M2):
    a sale leg against an unquoted security, and an ESPP leg with no ESPP quote
    configured (no espp_ticker setting seeded here)."""
    await seeded_2024(auth_client)
    security_id = await seed_holding(db, quote=None)
    lot_id = await seed_lot(db)

    resp = await auth_client.post(
        WHAT_IF,
        json={"year": 2024, "sales": [{"security_id": security_id, "shares": "10"}]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "no price for NVDA — provide one"

    resp = await auth_client.post(WHAT_IF, json={"year": 2024, "espp_sales": [{"lot_id": lot_id}]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "no ESPP quote available — provide a sale_price"


async def test_what_if_unknown_security_404(auth_client, definitions):
    await seeded_2024(auth_client)

    resp = await auth_client.post(
        WHAT_IF, json={"year": 2024, "sales": [{"security_id": 9999, "shares": "1"}]}
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "unknown security 9999"


async def test_what_if_sold_lot_409(auth_client, db, definitions):
    """A sold lot has already happened — modelling its sale is a stale link, not a scenario."""
    await seeded_2024(auth_client)
    lot_id = await seed_lot(db, sold=True)

    resp = await auth_client.post(
        WHAT_IF, json={"year": 2024, "espp_sales": [{"lot_id": lot_id, "sale_price": "150"}]}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == f"lot {lot_id} already sold"

    missing = await auth_client.post(
        WHAT_IF, json={"year": 2024, "espp_sales": [{"lot_id": 9999, "sale_price": "150"}]}
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "unknown lot 9999"


async def test_what_if_unknown_override_key_422(auth_client, definitions):
    """Overrides speak the PUT-inputs vocabulary, down to the sentence."""
    await seeded_2024(auth_client)

    resp = await auth_client.post(
        WHAT_IF, json={"year": 2024, "overrides": {"nope": "2", "qualified_dividends": "2500"}}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "unknown input key(s): ['nope']"

    # A known key is a plain replacement, applied over the stored value.
    body = await what_if(auth_client, overrides={"qualified_dividends": "2500"})
    assert body["changed_inputs"] == [
        {
            "key": "qualified_dividends",
            "label": "Qualified Dividends",
            "before": "179.13",
            "after": "2500.00",
        }
    ]


async def test_what_if_year_404(auth_client, definitions):
    """The sandbox models a REAL year: no tax_years row, no scenario."""
    resp = await auth_client.post(WHAT_IF, json={"year": 2029})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "tax year 2029 not found"

    # The century guard rides on the body here, where a Path() bound cannot reach it — an
    # int4 column would otherwise answer a mistyped year with a bare DataError 500.
    out_of_range = await auth_client.post(WHAT_IF, json={"year": 99999999999})
    assert out_of_range.status_code == 422
    assert out_of_range.json()["detail"] == "year must be between 1900 and 2100"


async def test_what_if_writes_nothing(auth_client, db, definitions):
    """The whole feature's contract: a full scenario is a computation, not an edit."""
    await seeded_2024(auth_client)
    security_id = await seed_holding(db)
    lot_id = await seed_lot(db)
    before_payload = (await auth_client.get(f"{YEARS}/2024/inputs")).json()
    before_rows = {
        row.key: str(row.value)
        for row in (await db.execute(select(TaxInput).where(TaxInput.year == 2024))).scalars()
    }

    body = await what_if(
        auth_client,
        sales=[{"security_id": security_id, "shares": "40", "term": "short"}],
        espp_sales=[{"lot_id": lot_id, "sale_price": "150.0000"}],
        overrides={"qualified_dividends": "2500", "interest_total": None},
    )
    assert body["scenario"] != body["baseline"]  # the scenario really did move

    db.expire_all()  # re-read from Postgres, not from the identity map
    after_rows = {
        row.key: str(row.value)
        for row in (await db.execute(select(TaxInput).where(TaxInput.year == 2024))).scalars()
    }
    assert after_rows == before_rows  # byte-identical, key for key
    assert (await auth_client.get(f"{YEARS}/2024/inputs")).json() == before_payload
    # Nor did the scenario touch the lot it modelled, or invent a year row.
    lot = await db.get(EsppLot, lot_id)
    assert (lot.sold_date, lot.sold_price) == (None, None)
    years = (await db.execute(select(func.count()).select_from(TaxYear))).scalar_one()
    assert years == 1


async def test_taxes_endpoints_require_auth(client):
    assert (await client.get(YEARS)).status_code == 401
    assert (await client.delete(f"{YEARS}/2024")).status_code == 401
    assert (await client.get(f"{YEARS}/2024/inputs")).status_code == 401
    assert (await client.put(f"{YEARS}/2024/inputs", json={"values": {}})).status_code == 401
    assert (await client.get(f"{YEARS}/2024/brackets")).status_code == 401
    put_brackets_resp = await client.put(f"{YEARS}/2024/brackets", json={"jurisdictions": {}})
    assert put_brackets_resp.status_code == 401
    assert (await client.post(f"{YEARS}/2025/clone-brackets-from/2024")).status_code == 401
    assert (await client.get(f"{YEARS}/2024/summary")).status_code == 401
    assert (await client.get(ALL_SUMMARY)).status_code == 401
    assert (await client.post(WHAT_IF, json={"year": 2024})).status_code == 401


# --- filing status ---


@pytest.fixture
async def household(db):
    """Me + Partner. `create_all` seeds no people, so every OTHER test in this file runs
    on an empty roster — which is exactly the pre-household spelling the API still has to
    support."""
    from app.models import Person

    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.commit()
    return me, partner


async def set_status(auth_client, year: int, status: str) -> dict:
    resp = await auth_client.patch(f"{YEARS}/{year}", json={"filing_status": status})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_years_default_to_single_and_patch_sets_the_status(auth_client, definitions):
    await put_inputs(auth_client, 2026, {"annual_salary": "150000"})
    assert (await auth_client.get(YEARS)).json()[0]["filing_status"] == "single"

    body = await set_status(auth_client, 2026, "married_joint")
    assert body == {
        "year": 2026,
        "notes": None,
        "filing_status": "married_joint",
        "input_count": 1,
        "bracket_count": 0,
    }
    assert (await auth_client.get(YEARS)).json()[0]["filing_status"] == "married_joint"


async def test_patch_year_rejects_unknown_status_and_missing_year(auth_client, definitions):
    await put_inputs(auth_client, 2026, {})
    bad = await auth_client.patch(f"{YEARS}/2026", json={"filing_status": "widow"})
    assert bad.status_code == 422
    assert (await auth_client.get(YEARS)).json()[0]["filing_status"] == "single"
    # No auto-create: a status is a statement ABOUT a year that must already exist.
    missing = await auth_client.patch(f"{YEARS}/2027", json={"filing_status": "married_joint"})
    assert missing.status_code == 404
    assert "2027" in missing.json()["detail"]


async def test_single_summary_shape_is_unchanged(auth_client, definitions):
    """The additive keys, and nothing else: a single year still carries every section."""
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])

    body = (await auth_client.get(f"{YEARS}/2024/summary")).json()
    assert body["filing_status"] == "single"
    assert body["brackets_missing_for_status"] == []
    assert body["totals"]["total_tax"] == "72755.83"


async def test_single_year_with_no_brackets_still_computes(auth_client, definitions):
    """The grandfathered path: 'single' NEVER gates. A partial single-filer year has
    always computed with per-jurisdiction warnings, and stored history depends on it."""
    await put_inputs(auth_client, 2033, {"latest_w2_income": "1000"})

    body = (await auth_client.get(f"{YEARS}/2033/summary")).json()
    assert body["brackets_missing_for_status"] == []
    assert body["totals"]["total_tax"] == "0.00"
    assert JURISDICTION_WARN_MISSING.format(j="federal", year=2033) in body["warnings"]


async def test_married_year_without_its_tables_refuses_to_compute(auth_client, definitions):
    """Never garbage, never a 500: the single-filer tables are RIGHT THERE and would
    produce a confident, wrong number."""
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])
    await set_status(auth_client, 2026, "married_joint")

    resp = await auth_client.get(f"{YEARS}/2026/summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2026
    assert body["filing_status"] == "married_joint"
    assert body["brackets_missing_for_status"] == list(JURISDICTIONS)
    for section in (
        "federal",
        "state",
        "medicare",
        "social_security",
        "disability",
        "capital_gains",
        "totals",
    ):
        assert body[section] is None, section
    assert body["warnings"] == [
        "2026 is filed as married_joint and has no married_joint bracket table for: "
        "federal, state, medicare, social_security, disability, capital_gains"
    ]


async def test_trend_feed_skips_and_names_the_refused_years(auth_client, definitions):
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])
    await set_status(auth_client, 2026, "married_separate")

    body = (await auth_client.get(ALL_SUMMARY)).json()
    assert [year["year"] for year in body["years"]] == [2024]  # 2026 cannot be drawn
    assert body["incomplete"] == [
        {
            "year": 2026,
            "filing_status": "married_separate",
            "brackets_missing_for_status": list(JURISDICTIONS),
        }
    ]


def test_filing_status_literal_matches_the_constant():
    from typing import get_args

    from app.schemas.taxes import FilingStatus
    from app.tax_keys import FILING_STATUSES

    assert get_args(FilingStatus) == FILING_STATUSES


# --- per-person inputs ---


async def test_inputs_payload_shape_is_unchanged_without_a_roster(auth_client, definitions):
    """No people seeded (the `create_all` default): one column, person_id null, exactly
    the payload shipped today plus the additive keys."""
    await put_inputs(auth_client, 2024, {"annual_salary": "150000"})

    body = (await auth_client.get(f"{YEARS}/2024/inputs")).json()
    assert body["filing_status"] == "single"
    assert body["people"] == []
    items = items_by_key(body)
    assert len(items) == len(TAX_INPUT_DEFINITIONS) == 45
    assert items["annual_salary"]["value"] == "150000.0000"
    assert items["annual_salary"]["person_id"] is None
    assert items["annual_salary"]["is_per_person"] is True
    assert items["interest_total"]["is_per_person"] is False
    assert items["w2_fed_withholding"]["is_per_person"] is True
    assert items["w2_fed_withholding"]["suggested"] is None  # tracker-only, never derived


async def test_inputs_render_one_column_per_person_on_a_joint_year(
    auth_client, db, household, definitions
):
    me, partner = household
    await put_inputs(auth_client, 2026, {"annual_salary": "150000"})
    await set_status(auth_client, 2026, "married_joint")

    body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    assert body["people"] == [
        {"id": me.id, "name": "Me"},
        {"id": partner.id, "name": "Partner"},
    ]
    salary = [
        item
        for section in body["sections"]
        for item in section["items"]
        if item["key"] == "annual_salary"
    ]
    assert [item["person_id"] for item in salary] == [me.id, partner.id]
    # The legacy `values` write landed on the PRIMARY person.
    assert [item["value"] for item in salary] == ["150000.0000", None]
    # Household keys stay single-column.
    interest = [
        item
        for section in body["sections"]
        for item in section["items"]
        if item["key"] == "interest_total"
    ]
    assert [item["person_id"] for item in interest] == [None]


async def test_person_qualified_write_round_trip(auth_client, db, household, definitions):
    me, partner = household
    resp = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "values": {"interest_total": "2000"},
            "rows": [
                {"key": "annual_salary", "person_id": me.id, "value": "150000"},
                {"key": "annual_salary", "person_id": partner.id, "value": "90000"},
                {"key": "w2_fed_withholding", "person_id": partner.id, "value": "12000"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    await set_status(auth_client, 2026, "married_joint")

    body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    by_slot = {
        (item["key"], item["person_id"]): item["value"]
        for section in body["sections"]
        for item in section["items"]
    }
    assert by_slot[("annual_salary", me.id)] == "150000.0000"
    assert by_slot[("annual_salary", partner.id)] == "90000.0000"
    assert by_slot[("w2_fed_withholding", partner.id)] == "12000.0000"
    assert by_slot[("interest_total", None)] == "2000.0000"
    # The PUT body IS the GET shape.
    assert (await auth_client.get(f"{YEARS}/2026/inputs")).json() == body

    # A null clears one PERSON's row and leaves the other alone.
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "annual_salary", "person_id": partner.id, "value": None}]},
    )
    after = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    remaining = {
        (item["key"], item["person_id"]): item["value"]
        for section in after["sections"]
        for item in section["items"]
    }
    assert remaining[("annual_salary", partner.id)] is None
    assert remaining[("annual_salary", me.id)] == "150000.0000"


async def test_suggestions_are_computed_per_column(auth_client, db, household, definitions):
    """The derived-W2 chain is one PERSON's: the partner's pay_periods x gross_paycheck
    must not be built from the primary's salary."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "pay_periods", "person_id": me.id, "value": "24"},
                {"key": "gross_paycheck", "person_id": me.id, "value": "6000"},
                {"key": "pay_periods", "person_id": partner.id, "value": "24"},
                {"key": "gross_paycheck", "person_id": partner.id, "value": "4000"},
                {"key": "itemized_salt", "value": "9000"},
            ]
        },
    )
    await set_status(auth_client, 2026, "married_joint")

    body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    suggested = {
        (item["key"], item["person_id"]): item["suggested"]
        for section in body["sections"]
        for item in section["items"]
    }
    assert suggested[("latest_w2_income", me.id)] == "144000.0000"
    assert suggested[("latest_w2_income", partner.id)] == "96000.0000"
    # A household suggestion is column-invariant, so it renders once.
    assert suggested[("itemized_deduction", None)] == "9000.0000"


async def test_put_inputs_rejects_person_on_a_household_key(auth_client, household, definitions):
    me, _partner = household
    resp = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "interest_total", "person_id": me.id, "value": "5"}]},
    )
    assert resp.status_code == 422
    assert "interest_total" in resp.json()["detail"]
    assert (await auth_client.get(YEARS)).json() == []  # not even the year row


async def test_put_inputs_rejects_unknown_person_and_duplicate_slots(
    auth_client, household, definitions
):
    me, _partner = household
    unknown = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "annual_salary", "person_id": 9999, "value": "1"}]},
    )
    assert unknown.status_code == 422
    assert "9999" in unknown.json()["detail"]

    duplicate = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "values": {"annual_salary": "1"},
            "rows": [{"key": "annual_salary", "person_id": me.id, "value": "2"}],
        },
    )
    # `values` resolves to the primary person, so this IS the same slot twice.
    assert duplicate.status_code == 422
    assert "annual_salary" in duplicate.json()["detail"]
    assert (await auth_client.get(YEARS)).json() == []


async def test_a_legacy_null_row_is_adopted_not_duplicated(auth_client, db, household, definitions):
    """A row written before the roster existed carries person_id NULL on a per-person key.
    The next write must move it, never insert a second row the unique key would reject."""
    from app.models import TaxInput as TaxInputModel

    me, _partner = household
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(TaxInputModel(year=2026, key="annual_salary", value=Decimal("100000.0000")))
    await db.commit()

    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "annual_salary", "person_id": me.id, "value": "150000"}]},
    )
    stored = (
        (
            await db.execute(
                select(TaxInputModel).where(
                    TaxInputModel.year == 2026, TaxInputModel.key == "annual_salary"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(stored) == 1
    assert (stored[0].person_id, stored[0].value) == (me.id, Decimal("150000.0000"))


async def test_one_legacy_null_row_is_adopted_by_only_one_column(
    auth_client, db, household, definitions
):
    """Both columns written in ONE body, over a single legacy NULL row.

    Only one person can inherit that row; the other needs a fresh insert. Handing it to
    each of them in turn would keep just the last column's value and silently drop the
    first — a wrong-money bug on exactly the write the household migration invites."""
    from app.models import TaxInput as TaxInputModel

    me, partner = household
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(TaxInputModel(year=2026, key="annual_salary", value=Decimal("100000.0000")))
    await db.commit()

    resp = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "annual_salary", "person_id": me.id, "value": "150000"},
                {"key": "annual_salary", "person_id": partner.id, "value": "90000"},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    stored = {
        row.person_id: row.value
        for row in (
            await db.execute(
                select(TaxInputModel).where(
                    TaxInputModel.year == 2026, TaxInputModel.key == "annual_salary"
                )
            )
        ).scalars()
    }
    assert stored == {me.id: Decimal("150000.0000"), partner.id: Decimal("90000.0000")}


async def test_a_partner_write_never_adopts_the_primarys_legacy_null_row(
    auth_client, db, household, definitions
):
    """Only the PRIMARY may adopt a legacy NULL row — every read already says it is theirs.

    `_owner_column` folds a per-person NULL onto columns[0], so the summary has been
    counting that 100000 as the primary's all along. A partner write of the same key must
    therefore insert its OWN row: adopting would move the money into the partner's column
    without the primary's line being touched, and a partner `null` would delete it outright.
    """
    from app.models import TaxInput as TaxInputModel

    me, partner = household
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(TaxInputModel(year=2026, key="annual_salary", value=Decimal("100000.0000")))
    await db.commit()

    async def salaries() -> dict[int | None, Decimal]:
        return {
            row.person_id: row.value
            for row in (
                await db.execute(
                    select(TaxInputModel).where(
                        TaxInputModel.year == 2026, TaxInputModel.key == "annual_salary"
                    )
                )
            ).scalars()
        }

    async def write(person_id: int, value: str | None):
        resp = await auth_client.put(
            f"{YEARS}/2026/inputs",
            json={"rows": [{"key": "annual_salary", "person_id": person_id, "value": value}]},
        )
        assert resp.status_code == 200, resp.text

    await write(partner.id, "90000")
    assert await salaries() == {None: Decimal("100000.0000"), partner.id: Decimal("90000.0000")}

    # ...and unsetting the partner's line takes only the partner's row with it.
    await write(partner.id, None)
    assert await salaries() == {None: Decimal("100000.0000")}

    # The primary still adopts, exactly as before: one row, never two.
    await write(me.id, "150000")
    assert await salaries() == {me.id: Decimal("150000.0000")}


# --- brackets by status ---


async def test_brackets_default_to_single_and_statuses_are_independent(auth_client, definitions):
    await put_brackets(auth_client, 2026, {"federal": rows(("0.10", "0"))})
    joint = await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={"filing_status": "married_joint", "jurisdictions": {"federal": rows(("0.12", "0"))}},
    )
    assert joint.status_code == 200, joint.text
    assert joint.json()["filing_status"] == "married_joint"

    single_body = (await auth_client.get(f"{YEARS}/2026/brackets")).json()
    assert single_body["filing_status"] == "single"
    assert single_body["statuses_with_rows"] == ["married_joint", "single"]
    assert single_body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.1000", "threshold": "0.00"}
    ]
    joint_body = (
        await auth_client.get(f"{YEARS}/2026/brackets", params={"filing_status": "married_joint"})
    ).json()
    assert joint_body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.1200", "threshold": "0.00"}
    ]
    # A full replace of one status leaves the other's TABLES alone...
    await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={"filing_status": "married_joint", "jurisdictions": {"federal": []}},
    )
    after = (await auth_client.get(f"{YEARS}/2026/brackets")).json()
    assert after["filing_status"] == single_body["filing_status"]
    assert after["jurisdictions"] == single_body["jurisdictions"]
    # ...while the emptied status honestly drops off the year's tab list.
    assert after["statuses_with_rows"] == ["single"]


async def test_get_brackets_rejects_an_unknown_status(auth_client, definitions):
    await put_brackets(auth_client, 2026, {"federal": rows(("0.10", "0"))})
    resp = await auth_client.get(f"{YEARS}/2026/brackets", params={"filing_status": "widow"})
    assert resp.status_code == 422


async def test_clone_as_married_joint_copies_the_single_tables_with_review_flags(
    auth_client, definitions
):
    """The "Clone as MFJ" flow: same year, single tables in, MFJ tables out."""
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])

    resp = await auth_client.post(
        f"{YEARS}/2026/clone-brackets-from/2026", params={"target_status": "married_joint"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["filing_status"] == "married_joint"
    source = (await auth_client.get(f"{YEARS}/2026/brackets")).json()
    assert body["jurisdictions"] == source["jurisdictions"]  # verbatim, index for index
    assert body["review_flags"] == {
        "verbatim_ok": ["social_security", "disability"],
        "review": ["federal", "state", "capital_gains", "medicare"],
    }

    # A second clone into the same status is a 409, never a silent merge.
    conflict = await auth_client.post(
        f"{YEARS}/2026/clone-brackets-from/2026", params={"target_status": "married_joint"}
    )
    assert conflict.status_code == 409
    assert "2026" in conflict.json()["detail"]
    assert "married_joint" in conflict.json()["detail"]
    # ...and the single tables it cloned FROM are untouched.
    assert (await auth_client.get(f"{YEARS}/2026/brackets")).json() == source


async def test_clone_only_ever_reads_the_source_years_single_tables(auth_client, definitions):
    """MFJ tables are never a clone SOURCE: the helper's whole job is "start my married
    tables from my single ones"."""
    await auth_client.put(
        f"{YEARS}/2024/brackets",
        json={"filing_status": "married_joint", "jurisdictions": {"federal": rows(("0.12", "0"))}},
    )
    missing = await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")
    assert missing.status_code == 404
    assert "2024" in missing.json()["detail"]


async def test_clone_target_status_defaults_to_single(auth_client, definitions):
    await put_brackets(auth_client, 2024, {"federal": rows(("0.10", "0"))})
    body = (await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")).json()
    assert body["filing_status"] == "single"
    assert body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.1000", "threshold": "0.00"}
    ]


async def test_brackets_missing_state_clears_once_the_tables_are_cloned(auth_client, definitions):
    """End to end: flip to MFJ, get the call-to-action, clone, get numbers."""
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])
    await set_status(auth_client, 2026, "married_joint")
    assert (await auth_client.get(f"{YEARS}/2026/summary")).json()["totals"] is None

    await auth_client.post(
        f"{YEARS}/2026/clone-brackets-from/2026", params={"target_status": "married_joint"}
    )
    body = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["brackets_missing_for_status"] == []
    # Cloned verbatim from the single tables, so the figures are the single goldens.
    assert body["totals"]["total_tax"] == "98584.56"


async def test_married_year_reports_only_the_missing_tables(auth_client, definitions):
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await set_status(auth_client, 2026, "married_joint")
    await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={
            "filing_status": "married_joint",
            "jurisdictions": {"federal": rows(("0.10", "0")), "state": rows(("0.05", "0"))},
        },
    )
    body = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["brackets_missing_for_status"] == [
        "medicare",
        "social_security",
        "disability",
        "capital_gains",
    ]
    assert body["totals"] is None


async def test_married_joint_sums_both_people_and_splits_the_wage_base(
    auth_client, db, household, definitions
):
    """The end-to-end wrong-money fix: two W-2s, two Social-Security wage bases."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "latest_w2_income", "person_id": me.id, "value": "200000"},
                {"key": "latest_w2_income", "person_id": partner.id, "value": "100000"},
            ]
        },
    )
    tables = {
        "federal": rows(("0.10", "0")),
        "state": rows(("0.05", "0")),
        "medicare": rows(("0.0145", "0")),
        "social_security": rows(("0.062", "0"), ("0", "180000")),
        "disability": rows(("0.01", "0")),
        "capital_gains": rows(("0.15", "0")),
    }
    for status in ("single", "married_joint"):
        resp = await auth_client.put(
            f"{YEARS}/2026/brackets", json={"filing_status": status, "jurisdictions": tables}
        )
        assert resp.status_code == 200, resp.text

    single = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    # One shared wage base: min(300000, 180000) x .062.
    assert single["social_security"]["tax"] == "11160.00"
    assert single["social_security"]["w2_income"] == "200000.00"  # partner is off this return

    await set_status(auth_client, 2026, "married_joint")
    joint = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert joint["social_security"]["w2_income"] == "300000.00"  # both W-2s now
    # 180000 x .062 + 100000 x .062 = 11160 + 6200.
    assert joint["social_security"]["tax"] == "17360.00"
    assert joint["social_security"]["taxable_wages"] == "280000.00"
    assert joint["medicare"]["taxable_wages"] == "300000.00"  # combined walk, as designed


async def test_married_separate_covers_the_primary_person_alone(
    auth_client, db, household, definitions
):
    """An MFS return carries one spouse's income. The partner's rows stay stored — they
    belong to the joint year — but they are not on THIS return."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "latest_w2_income", "person_id": me.id, "value": "200000"},
                {"key": "latest_w2_income", "person_id": partner.id, "value": "100000"},
            ]
        },
    )
    await put_brackets(auth_client, 2026, {"medicare": rows(("0.0145", "0"))})
    await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={
            "filing_status": "married_separate",
            "jurisdictions": {
                name: (rows(("0.0145", "0")) if name == "medicare" else rows(("0.10", "0")))
                for name in JURISDICTIONS
            },
        },
    )
    await set_status(auth_client, 2026, "married_separate")

    body = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["medicare"]["w2_income"] == "200000.00"
    assert body["brackets_missing_for_status"] == []


# --- the what-if on a married year ---


async def test_what_if_refuses_a_year_whose_status_has_no_tables(auth_client, definitions):
    await seeded_2024(auth_client)
    await set_status(auth_client, 2024, "married_joint")

    resp = await auth_client.post(WHAT_IF, json={"year": 2024})
    assert resp.status_code == 409
    assert "married_joint" in resp.json()["detail"]


async def test_what_if_moves_the_primary_earners_fica_on_a_joint_year(
    auth_client, db, household, definitions
):
    """A what-if leg is the PRIMARY person's sale, so its wage delta lands on their
    bundle — with the partner's own wage base untouched beside it."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "latest_w2_income", "person_id": me.id, "value": "100000"},
                {"key": "latest_w2_income", "person_id": partner.id, "value": "100000"},
            ]
        },
    )
    tables = {
        "federal": rows(("0.10", "0")),
        "state": rows(("0.05", "0")),
        "medicare": rows(("0.0145", "0")),
        "social_security": rows(("0.062", "0"), ("0", "150000")),
        "disability": rows(("0.01", "0")),
        "capital_gains": rows(("0.15", "0")),
    }
    for status in ("single", "married_joint"):
        await auth_client.put(
            f"{YEARS}/2026/brackets", json={"filing_status": status, "jurisdictions": tables}
        )
    await set_status(auth_client, 2026, "married_joint")

    body = (
        await auth_client.post(
            WHAT_IF,
            json={"year": 2026, "overrides": {"other_w2_income": "80000"}},
        )
    ).json()
    # Baseline: 100000 + 100000, both under the 150000 base -> 200000 x .062 = 12400.
    assert body["baseline"]["social_security"]["tax"] == "12400.00"
    # Scenario: the primary's bundle becomes 180000, capped at 150000; the partner stays
    # at 100000. (150000 + 100000) x .062 = 15500.
    assert body["scenario"]["social_security"]["tax"] == "15500.00"
    assert body["delta"]["social_security_tax"] == "3100.00"


async def test_earner_bundles_follow_column_order_not_a_string_sort(auth_client, db, definitions):
    """Primary id=2, partner id=10 — the roster where the two orderings DISAGREE.

    Every other household test runs on conftest's RESTART IDENTITY ids (1, 2), where
    column order and `sorted(per_person, key=str)` happen to agree, so none of them can
    see the bug this pins: with a 10 in the roster the string sort puts "10" ahead of "2"
    and `shift_earners` — which re-bases the what-if on `earners[0]` because that is
    meant to be the PRIMARY's — silently moves the primary's sale onto the partner's
    wage base. Asymmetric wages (100000 vs 40000) and a Social Security cap at 150000
    make the two orderings answer with different money.

    PROVEN discriminating. Reverting `_assemble_earners`' last line to
    `[earner_from_inputs(per_person[c]) for c in sorted(per_person, key=str)]` fails it
    twice over:

        At index 0 diff: Decimal('40000.0000') != Decimal('100000')  # bundle[0] is theirs
        AssertionError: assert '13640.00' == '11780.00'              # social_security

    (13640 is the partner absorbing the 80000 leg and still sitting under the base —
    100000 + 120000 — while the primary's own wages never move. The BASELINE stays
    8680.00 under either ordering, because that side only ever sums the two bundles.)
    """
    from app.api.taxes import _engine_feed
    from app.models import Person

    # EXPLICIT ids. `people.id` is a plain identity column, so an explicit insert does not
    # advance the sequence — push it past 10 so a later auto-id person in this test could
    # not collide on 2.
    db.add_all(
        [
            Person(id=2, name="Me", is_primary=True),
            Person(id=10, name="Partner", is_primary=False),
        ]
    )
    await db.flush()
    await db.execute(text("SELECT setval('people_id_seq', 10, true)"))
    await db.commit()

    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "latest_w2_income", "person_id": 2, "value": "100000"},
                {"key": "latest_w2_income", "person_id": 10, "value": "40000"},
            ]
        },
    )
    tables = {
        "federal": rows(("0.10", "0")),
        "state": rows(("0.05", "0")),
        "medicare": rows(("0.0145", "0")),
        "social_security": rows(("0.062", "0"), ("0", "150000")),
        "disability": rows(("0.01", "0")),
        "capital_gains": rows(("0.15", "0")),
    }
    for status in ("single", "married_joint"):
        await auth_client.put(
            f"{YEARS}/2026/brackets", json={"filing_status": status, "jurisdictions": tables}
        )
    await set_status(auth_client, 2026, "married_joint")

    # The ordering contract itself: bundle[0] is the primary's, whatever the ids sort like.
    feed = await _engine_feed(db, 2026)
    assert [earner.w2_wages for earner in feed.earners] == [Decimal("100000"), Decimal("40000")]

    # ...and the money it decides. Baseline: 100000 + 40000, both under the 150000 base,
    # (140000) x .062 = 8680.
    body = (
        await auth_client.post(
            WHAT_IF, json={"year": 2026, "overrides": {"other_w2_income": "80000"}}
        )
    ).json()
    assert body["baseline"]["social_security"]["tax"] == "8680.00"
    # The 80000 is the PRIMARY's leg: their bundle becomes 180000, capped at 150000, next
    # to the partner's untouched 40000. (150000 + 40000) x .062 = 11780.
    assert body["scenario"]["social_security"]["tax"] == "11780.00"
    assert body["delta"]["social_security_tax"] == "3100.00"


# --- person-summed engine feed (2026-08-26 spec §5.4/§5.7) ---
#
# `tax_inputs` is unique on (year, key, person_id), so ONE key legitimately carries several
# rows. Every engine caller must SUM them; a dict keyed on `key` alone silently keeps
# whichever row the planner returned last, which is a partner's whole W-2 disappearing from
# the liability, the money flow and the YTD tile depending on nothing but query order.
# `_engine_feed`/`_assemble_inputs` own that sum; these pins are on the PUBLIC endpoints, so
# they keep holding whatever the loader is called next.


async def _seed_people(db):
    """(primary id, partner id) — the household this batch's fixtures share."""
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    return me.id, partner.id


async def _seed_two_earner_year(db, year: int, status: str = "married_joint"):
    """One married year: 240k of primary W-2 + 150k of partner W-2, flat MFJ tables."""
    me_id, partner_id = await _seed_people(db)
    db.add(TaxYear(year=year, filing_status=status))
    await db.flush()
    db.add_all(
        [
            TaxInput(year=year, key="latest_w2_income", value=Decimal("240000"), person_id=me_id),
            TaxInput(
                year=year, key="latest_w2_income", value=Decimal("150000"), person_id=partner_id
            ),
            # A HOUSEHOLD key: one NULL row, which must survive the sum verbatim.
            TaxInput(year=year, key="interest_total", value=Decimal("2500"), person_id=None),
        ]
    )
    for name, table in (
        ("federal", [("0.1000", "0.00")]),
        ("state", [("0.0500", "0.00")]),
        ("medicare", [("0.0145", "0.00"), ("0.0235", "250000.00")]),
        ("social_security", [("0.0620", "0.00"), ("0.0000", "168600.00")]),
        ("disability", [("0.0110", "0.00")]),
        ("capital_gains", [("0.1500", "0.00")]),
    ):
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                    filing_status=status,
                )
            )
    await db.commit()
    return me_id, partner_id


async def test_summary_sums_w2_across_people_instead_of_keeping_one_row(
    auth_client, db, definitions
):
    await _seed_two_earner_year(db, 2026)
    resp = await auth_client.get(f"{YEARS}/2026/summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 240000 + 150000 — NOT 240000 and NOT 150000. This is the whole bug: a point read
    # returns one of the two and the assertion below fails on whichever the planner picked.
    assert body["medicare"]["w2_income"] == "390000.00"
    # The household key rides along untouched: gross = 390000 wages + 2500 interest.
    assert body["totals"]["gross_income"] == "392500.00"


async def test_all_summaries_feed_sums_people_too(auth_client, db, definitions):
    # /taxes/summary builds ONE feed per year over an all-years roster read, so it is a
    # SECOND place the collapse could reappear and needs its own pin — this is the feed
    # behind the Overview page's YTD effective-tax tile.
    await _seed_two_earner_year(db, 2026)
    resp = await auth_client.get(ALL_SUMMARY)  # the file's own constant, already defined
    assert resp.status_code == 200, resp.text
    years = resp.json()["years"]
    assert [row["year"] for row in years] == [2026]
    assert years[0]["medicare"]["w2_income"] == "390000.00"
    assert years[0]["totals"]["gross_income"] == "392500.00"


async def test_single_year_inputs_are_byte_identical_under_summing(auth_client, db, definitions):
    # The single path must not move: after the migration a single filer's per-person keys sit
    # on the PRIMARY person, and summing exactly one row is that row.
    me = Person(name="Me", is_primary=True)
    db.add(me)
    await db.flush()
    db.add(TaxYear(year=2025, filing_status="single"))
    await db.flush()
    db.add_all(
        [
            TaxInput(year=2025, key="latest_w2_income", value=Decimal("240000"), person_id=me.id),
            TaxInput(year=2025, key="interest_total", value=Decimal("2500"), person_id=None),
            TaxInput(
                year=2025,
                key="unq_div_state_exempt_pct",
                value=Decimal("0.4500"),
                person_id=None,
            ),
        ]
    )
    db.add_all(
        [
            TaxBracket(
                year=2025,
                jurisdiction="federal",
                bracket_index=1,
                rate=Decimal("0.1000"),
                threshold=Decimal("0.00"),
                filing_status="single",
            ),
            TaxBracket(
                year=2025,
                jurisdiction="medicare",
                bracket_index=1,
                rate=Decimal("0.0145"),
                threshold=Decimal("0.00"),
                filing_status="single",
            ),
        ]
    )
    await db.commit()

    body = (await auth_client.get(f"{YEARS}/2025/summary")).json()
    assert body["medicare"]["w2_income"] == "240000.00"
    assert body["totals"]["gross_income"] == "242500.00"
    assert body["federal"]["tax"] == "24250.00"  # 10% of 242500, no deductions stored
