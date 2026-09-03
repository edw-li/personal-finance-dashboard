"""The assistant's sandbox encoder (2026-09-03 planning-sandboxes spec §12) — pinned to the SAME
parity fixture src/sandbox/scenarioUrl.test.ts reads, so the URL the server emits is the URL
the frontend decodes, byte for byte."""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.schemas.taxes import EsppSaleIn, SaleLegIn, WhatIfIn
from app.services.sandbox_links import (
    SANDBOX_NOUNS,
    SANDBOX_PATHS,
    espp_entry,
    knob_entry,
    override_entry,
    retire_entry,
    sale_entry,
    sandbox_link,
    tool_link,
    whatif_entries,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sandbox_entries.json"


def test_parity_fixture_urls_byte_for_byte():
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 4
    for case in cases:
        assert sandbox_link(case["page"], case["entries"]) == case["url"]


def test_year_scoped_fixture_urls_byte_for_byte():
    """The year rides in its OWN fixture section, not `cases`: the scope belongs to the
    Taxes PAGE, and the entries codec both frontends measure themselves against neither
    mints it nor knows about it."""
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["year_cases"]
    assert len(cases) >= 2
    for case in cases:
        assert sandbox_link(case["page"], case["entries"], year=case["year"]) == case["url"]


def test_only_the_three_sandbox_pages_are_linkable():
    assert set(SANDBOX_PATHS) == {"taxes", "paycheck", "projection"}
    # Every page that can be linked to can also be named in a label, or tool_link would
    # KeyError on the day a fourth sandbox is added to one dict and not the other.
    assert set(SANDBOX_NOUNS) == set(SANDBOX_PATHS)
    assert sandbox_link("taxes", []) == "/taxes"
    with pytest.raises(ValueError, match="not a sandbox page"):
        sandbox_link("settings", ["x:1"])
    with pytest.raises(ValueError, match="not a sandbox page"):
        sandbox_link("/taxes", [])


def test_the_year_scopes_the_taxes_link_and_leads_the_query():
    """Scope first, scenario after: a reader scanning the URL sees WHICH year before the
    legs, and the order is what the fixture pins byte for byte."""
    assert sandbox_link("taxes", [], year=2025) == "/taxes?year=2025"
    assert sandbox_link("taxes", ["espp:3"], year=2025) == "/taxes?year=2025&whatif=espp%3A3"
    # Paycheck has no year scope and Projection scopes by month inside its entries:
    # offering one is a caller bug, and dropping it silently would ship a wrong link.
    for page in ("paycheck", "projection"):
        with pytest.raises(ValueError, match="takes no year scope"):
            sandbox_link(page, [], year=2025)


def test_tool_link_labels_the_scope_and_refuses_everything_off_site():
    """The re-check on the way OUT: the URL has been through a model's tool result by the
    time the SSE frame is built, so the path is matched rather than trusted."""
    assert tool_link("/taxes?year=2025&whatif=espp%3A3") == {
        "to": "/taxes?year=2025&whatif=espp%3A3",
        "label": "Open 2025 in What-if →",
    }
    # No year in the URL, no year in the label -- never a bare "Open  in".
    assert tool_link("/taxes")["label"] == "Open in What-if →"
    # Each sandbox is named for itself; a /projection link must not read "What-if".
    assert tool_link("/projection?whatif=years%3A40")["label"] == "Open in Projection →"
    assert tool_link("/paycheck")["label"] == "Open in Paycheck →"
    for refused in (
        "/settings",
        "/taxes/x",
        "//evil.example/taxes",
        "https://evil.example/taxes",
        "javascript:alert(1)",
        "",
    ):
        assert tool_link(refused) is None, refused


def test_entry_encoders_speak_the_wire_vocabulary():
    assert sale_entry(7, Decimal("40")) == "sale:7:40"
    assert sale_entry(9, Decimal("10"), price=Decimal("62.50"), term="short") == "sale:9:10:62.50:S"
    assert sale_entry(11, Decimal("5"), term="short") == "sale:11:5::S"
    assert sale_entry(7, Decimal("40.000000"), term="long") == "sale:7:40.000000"
    assert espp_entry(3) == "espp:3"
    assert espp_entry(4, Decimal("150.0000")) == "espp:4:150.0000"
    assert override_entry("qualified_dividends", None) == "qualified_dividends:null"
    assert (
        override_entry("trad_401k_contributions", Decimal("23500"))
        == "trad_401k_contributions:23500"
    )
    assert override_entry("x", Decimal("0E-9")) == "x:0.000000000"  # never scientific notation
    assert knob_entry("annual_return", Decimal("0.06")) == "annual_return:0.06"
    assert knob_entry("hsa_coverage", "family") == "hsa_coverage:family"
    assert retire_entry(2, "2035-06") == "retire:2:2035-06"


def test_whatif_entries_follow_the_page_codecs_canonical_order():
    body = WhatIfIn(
        year=2024,
        sales=[
            SaleLegIn(security_id=9, shares=Decimal("10"), price=Decimal("62.50"), term="short"),
            SaleLegIn(security_id=7, shares=Decimal("40")),
        ],
        espp_sales=[EsppSaleIn(lot_id=4, sale_price=Decimal("150.0000")), EsppSaleIn(lot_id=3)],
        overrides={"trad_401k_contributions": Decimal("23500"), "qualified_dividends": None},
    )
    # Sales and ESPP legs keep the body's order (a leg list is positional); overrides sort.
    assert whatif_entries(body) == [
        "sale:9:10:62.50:S",
        "sale:7:40",
        "espp:4:150.0000",
        "espp:3",
        "qualified_dividends:null",
        "trad_401k_contributions:23500",
    ]
    assert sandbox_link("taxes", whatif_entries(WhatIfIn(year=2024))) == "/taxes"
