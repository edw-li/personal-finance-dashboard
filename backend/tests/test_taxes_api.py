"""Taxes API: inputs/brackets editors, bracket cloning, and the computed summaries.

The 2024 fixtures are imported from `test_tax_service` on purpose — they are the Plan 5
Workbook reference pins, and one copy of them keeps a golden from drifting against the
engine's. Here they are pushed through the REAL endpoints (PUT inputs + PUT brackets), so
the summary golden also proves the DB round-trip: Numeric(14,4) inputs and Numeric(7,4)/
Numeric(12,2) brackets come back at column scale and still land on the sheet's cents.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models import (
    EsppLot,
    LatestPrice,
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
    assert body[0] == {"year": 2023, "notes": None, "input_count": 0, "bracket_count": 0}
    assert body[1] == {"year": 2024, "notes": "imported", "input_count": 2, "bracket_count": 1}


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
        {"year": 2029, "notes": None, "input_count": 1, "bracket_count": 1}
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
    assert len(items) == len(TAX_INPUT_DEFINITIONS) == 43
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
        {"year": 2030, "notes": None, "input_count": 0, "bracket_count": 2}
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


async def test_summary_2024_matches_the_sheet(auth_client, definitions):
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
        "agi": "215122.02",
        "taxable_income": "209582.02",
        "tax": "15884.46",
        "effective_rate": "0.073839",
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
        "total_tax": "72739.17",
        "take_home": "165234.00",
        "effective_rate": "0.305661",
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
    assert body["years"][0]["totals"]["total_tax"] == "72739.17"

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
    # Nothing about the sale reached the stored year.
    assert (await auth_client.get(f"{YEARS}/2024/summary")).json() == body["baseline"]


async def test_what_if_espp_disqualified_hits_w2_and_fica(auth_client, db, definitions):
    """A disqualified disposition splits into W-2 ordinary income and a capital leg, and
    the ordinary half raises the engine's FICA wage bases — sheet-faithful (the sheet's
    ESPP component rolls into the W-2 total; real-world ESPP ordinary income is FICA-exempt).
    """
    await seeded_2024(auth_client)
    lot_id = await seed_lot(db)

    body = await what_if(
        auth_client, espp_sales=[{"lot_id": lot_id, "sale_price": "150.0000"}]
    )

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
    assert resp.json()["detail"] == "selling 150.000000 NVDA — only 100.000000 held"


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
