"""Deep links into the planning sandboxes (2026-09-03 planning-sandboxes spec §6, §12).

One repeated `whatif` query param, each value one entry `<kind>:<fields>` in the SERVER'S
wire vocabulary — the same grammar src/sandbox/scenarioUrl.ts decodes.

`urlencode` and the browser's URLSearchParams agree on every byte THIS grammar can
produce: both percent-encode the colon, both leave letters, digits, `.` and `-` bare.
They are NOT identical in general — `*` is bare for URLSearchParams and `%2A` here,
`~` is the other way round — and neither byte is reachable: a link is minted only
after `what_if` has validated the body, which leaves ints and Decimals and rejects any
override key outside the input vocabulary. tests/fixtures/sandbox_entries.json is the pin
both sides read. Allow-listed to the three sandbox paths: an assistant can only ever link
INTO a sandbox, never anywhere else. Pure — no DB, no HTTP.
"""

from decimal import Decimal
from urllib.parse import parse_qs, urlencode, urlsplit

from app.schemas.taxes import WhatIfIn

SANDBOX_PATHS: dict[str, str] = {
    "taxes": "/taxes",
    "paycheck": "/paycheck",
    "projection": "/projection",
}

WHATIF_PARAM = "whatif"

# The Taxes page's scope, URL-backed like the rest of the shell's scope params: a what-if
# is meaningless against the wrong year, so a link that dropped it would land the reader on
# whichever year the page happened to be remembering (spec §12).
YEAR_PARAM = "year"

# What a link into each sandbox offers to open. Only /taxes is reachable today --
# run_tax_whatif is the one tool that mints a sandbox_url -- but a label reading
# "What-if" over a /projection link would be wrong the day a projection tool lands, and
# the label is the whole of what a reader sees before deciding to leave the answer.
SANDBOX_NOUNS: dict[str, str] = {
    "taxes": "What-if",
    "paycheck": "Paycheck",
    "projection": "Projection",
}

# Built FROM SANDBOX_PATHS rather than written out again, so the allow-list tool_link()
# checks a URL against and the one sandbox_link() mints from cannot drift apart.
_PAGE_BY_PATH: dict[str, str] = {path: page for page, path in SANDBOX_PATHS.items()}


def _text(value: Decimal | int | str) -> str:
    # `format(d, "f")`, never str(): a driver zero is Decimal("0E-9"), which no URL should
    # carry and no JS decimal parser reads as a number (schemas/espp.py's Pct9 note).
    return format(value, "f") if isinstance(value, Decimal) else str(value)


def sandbox_link(page: str, entries: list[str], *, year: int | None = None) -> str:
    """`/taxes?year=2025&whatif=sale%3A7%3A40&whatif=…` — scope first, then the
    scenario, then the bare path when there is neither.

    `year` is the Taxes page's scope and only its scope: Paycheck has none, and Projection
    scopes by month inside its own entries. A year offered for either is a caller bug worth
    raising over rather than a field to drop on the floor."""
    path = SANDBOX_PATHS.get(page)
    if path is None:
        raise ValueError(f"{page!r} is not a sandbox page")
    if year is not None and page != "taxes":
        raise ValueError(f"{page!r} takes no year scope")
    params: list[tuple[str, str | int]] = []
    if year is not None:
        params.append((YEAR_PARAM, year))
    params.extend((WHATIF_PARAM, entry) for entry in entries)
    if not params:
        return path
    return f"{path}?{urlencode(params)}"


def tool_link(url: str) -> dict[str, str] | None:
    """The `link` an SSE `tool_result` carries, or None when `url` is not one this module
    could have minted.

    Re-derived from the URL rather than taken on trust: by the time a value reaches here it
    has been through a model's tool result. An exact match on the PATH against
    SANDBOX_PATHS, with the scheme and host both required to be empty so `//host/taxes` and
    `https://host/taxes` are refused, is the form of that check with nothing to get wrong."""
    parts = urlsplit(url)
    page = _PAGE_BY_PATH.get(parts.path)
    if page is None or parts.scheme or parts.netloc:
        return None
    # "Open 2025 in What-if →": the reader is being asked to leave the answer they are
    # reading, and the year is what makes that an answerable choice.
    years = parse_qs(parts.query).get(YEAR_PARAM)
    scope = f"{years[0]} " if years else ""
    return {"to": url, "label": f"Open {scope}in {SANDBOX_NOUNS[page]} →"}


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
