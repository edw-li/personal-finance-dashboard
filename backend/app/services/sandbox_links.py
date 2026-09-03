"""Deep links into the planning sandboxes (2026-09-03 planning-sandboxes spec §6, §12).

One repeated `whatif` query param, each value one entry `<kind>:<fields>` in the SERVER'S
wire vocabulary — the same grammar src/sandbox/scenarioUrl.ts decodes. `urlencode` with
`quote_plus` percent-encodes the colon exactly as the browser's URLSearchParams does, so the
strings here and there are byte-identical (tests/fixtures/sandbox_entries.json is the pin
both sides read). Allow-listed to the three sandbox paths: an assistant can only ever link
INTO a sandbox, never anywhere else. Pure — no DB, no HTTP.
"""

from decimal import Decimal
from urllib.parse import urlencode

from app.schemas.taxes import WhatIfIn

SANDBOX_PATHS: dict[str, str] = {
    "taxes": "/taxes",
    "paycheck": "/paycheck",
    "projection": "/projection",
}

WHATIF_PARAM = "whatif"


def _text(value: Decimal | int | str) -> str:
    # `format(d, "f")`, never str(): a driver zero is Decimal("0E-9"), which no URL should
    # carry and no JS decimal parser reads as a number (schemas/espp.py's Pct9 note).
    return format(value, "f") if isinstance(value, Decimal) else str(value)


def sandbox_link(page: str, entries: list[str]) -> str:
    """`/taxes?whatif=sale%3A7%3A40&whatif=…` — or the bare path with no entries."""
    path = SANDBOX_PATHS.get(page)
    if path is None:
        raise ValueError(f"{page!r} is not a sandbox page")
    if not entries:
        return path
    return f"{path}?{urlencode([(WHATIF_PARAM, entry) for entry in entries])}"


def sale_entry(
    security_id: int,
    shares: Decimal,
    price: Decimal | None = None,
    term: str | None = None,
) -> str:
    """`sale:<security_id>:<shares>[:<price>][:<S>]` — an empty price field is the API's omit
    case (the latest quote); long is the default and is omitted."""
    fields = [str(security_id), _text(shares)]
    short = term == "short"
    if price is not None or short:
        fields.append("" if price is None else _text(price))
    if short:
        fields.append("S")
    return ":".join(["sale", *fields])


def espp_entry(lot_id: int, sale_price: Decimal | None = None) -> str:
    fields = ["espp", str(lot_id)]
    if sale_price is not None:
        fields.append(_text(sale_price))
    return ":".join(fields)


def override_entry(key: str, value: Decimal | None) -> str:
    return f"{key}:{'null' if value is None else _text(value)}"


def knob_entry(key: str, value: Decimal | int | str) -> str:
    return f"{key}:{_text(value)}"


def retire_entry(person_id: int, month: str) -> str:
    return f"retire:{person_id}:{month}"


def whatif_entries(body: WhatIfIn) -> list[str]:
    """A what-if body as entries, in the Taxes codec's canonical order: sales · ESPP ·
    overrides sorted by key. The leg lists keep their order (they are positional)."""
    return [
        *(sale_entry(leg.security_id, leg.shares, leg.price, leg.term) for leg in body.sales),
        *(espp_entry(leg.lot_id, leg.sale_price) for leg in body.espp_sales),
        *(override_entry(key, body.overrides[key]) for key in sorted(body.overrides)),
    ]
