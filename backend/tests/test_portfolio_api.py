from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select

from app.models import DividendPayment, LatestPrice, PositionTransaction, PriceHistory, Security

SECURITIES = "/api/v1/portfolio/securities"


async def _create_security(auth_client, **fields) -> dict:
    """POST a security and return its body — fail loudly here, not on a later KeyError."""
    payload = {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf", **fields}
    resp = await auth_client.post(SECURITIES, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# --- securities ---


async def test_list_securities_ordered_by_ticker(auth_client, db):
    db.add_all(
        [
            Security(ticker="ZM", name="Zoom Video", holding_type="stock"),
            Security(ticker="AAPL", name="Apple", industry="Technology", holding_type="stock"),
        ]
    )
    await db.commit()
    resp = await auth_client.get(SECURITIES)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [s["ticker"] for s in body] == ["AAPL", "ZM"]  # ticker asc, not insertion order
    assert body[0]["industry"] == "Technology"
    assert body[1]["industry"] is None


async def test_create_security_normalizes_and_persists(auth_client, db):
    body = await _create_security(auth_client, ticker=" nvda ", name="NVIDIA", holding_type="stock")
    assert body["ticker"] == "NVDA"  # trimmed + upcased before it is ever stored
    assert body["name"] == "NVIDIA"
    assert body["industry"] is None
    assert body["holding_type"] == "stock"
    assert body["is_manual_priced"] is False
    assert body["is_active"] is True
    assert body["annual_dividend"] is None
    assert body["ex_div_date"] is None

    stored = await db.get(Security, body["id"])
    assert stored is not None
    assert stored.ticker == "NVDA"
    assert [s["ticker"] for s in (await auth_client.get(SECURITIES)).json()] == ["NVDA"]


async def test_create_security_conflicts_on_duplicate_ticker(auth_client):
    await _create_security(auth_client, ticker="voo")
    dup = await auth_client.post(
        SECURITIES, json={"ticker": " VoO ", "name": "Impostor", "holding_type": "etf"}
    )
    # Normalization runs BEFORE the uniqueness check, so casing/padding cannot sneak a
    # second row past the ticker natural key.
    assert dup.status_code == 409
    assert "VOO" in dup.json()["detail"]
    assert len((await auth_client.get(SECURITIES)).json()) == 1


async def test_create_security_rejects_bad_ticker_and_type(auth_client):
    bad_ticker = await auth_client.post(
        SECURITIES, json={"ticker": "BAD TICKER!", "name": "Nope", "holding_type": "stock"}
    )
    assert bad_ticker.status_code == 422  # spaces and punctuation fail the ticker regex
    blank_ticker = await auth_client.post(
        SECURITIES, json={"ticker": "   ", "name": "Nope", "holding_type": "stock"}
    )
    assert blank_ticker.status_code == 422  # survives min_length, dies after strip()
    bad_type = await auth_client.post(
        SECURITIES, json={"ticker": "OK", "name": "Nope", "holding_type": "banana"}
    )
    assert bad_type.status_code == 422  # Literal, not a free-text column
    assert (await auth_client.get(SECURITIES)).json() == []  # no partial writes


async def test_ticker_must_start_alphanumeric(auth_client):
    # Leading dot/dash tickers are degenerate: the provider maps '.' -> '-' for Yahoo, so
    # ".NVDA" and "-NVDA" would collide on one symbol while occupying two rows.
    for degenerate in (".", "-NVDA", ".BRK"):
        resp = await auth_client.post(
            SECURITIES, json={"ticker": degenerate, "name": "Nope", "holding_type": "stock"}
        )
        assert resp.status_code == 422, degenerate
    ok = await _create_security(auth_client, ticker="BRK.B", name="Berkshire Hathaway B")
    assert ok["ticker"] == "BRK.B"  # interior dots/dashes stay legal


async def test_blank_name_rejected(auth_client):
    blank = await auth_client.post(
        SECURITIES, json={"ticker": "BLNK", "name": "   ", "holding_type": "stock"}
    )
    assert blank.status_code == 422  # survives min_length, dies after strip()
    assert "name" in blank.json()["detail"]
    created = await _create_security(auth_client, ticker="GOOD", name="Good Name")
    patched_blank = await auth_client.patch(f"{SECURITIES}/{created['id']}", json={"name": "   "})
    assert patched_blank.status_code == 422  # PATCH enforces create's rule
    renamed = await auth_client.patch(f"{SECURITIES}/{created['id']}", json={"name": " Real Name "})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Real Name"  # stored trimmed, like create


async def test_create_security_bounds_annual_dividend(auth_client):
    # Numeric(10,4) holds six integer digits — 10^6 must 422, never a bare DBAPIError 500.
    too_big = await auth_client.post(
        SECURITIES,
        json={
            "ticker": "RICH",
            "name": "Too Rich",
            "holding_type": "stock",
            "annual_dividend": "1000000",
        },
    )
    assert too_big.status_code == 422
    assert "annual_dividend" in too_big.json()["detail"]
    negative = await auth_client.post(
        SECURITIES,
        json={
            "ticker": "NEG",
            "name": "Negative",
            "holding_type": "stock",
            "annual_dividend": "-0.01",
        },
    )
    assert negative.status_code == 422
    sub_quantum = await auth_client.post(
        SECURITIES,
        json={
            "ticker": "TINY",
            "name": "Barely Negative",
            "holding_type": "stock",
            "annual_dividend": "-0.00001",  # quantizes to -0.0000, which compares == 0
        },
    )
    assert sub_quantum.status_code == 422
    ok = await _create_security(auth_client, ticker="SCHD", annual_dividend="1.23456")
    assert ok["annual_dividend"] == "1.2346"  # 4 dp, HALF_UP

    # PATCH runs the identical guard.
    for bad in ("-1", "-0.00001", "1000000"):
        resp = await auth_client.patch(f"{SECURITIES}/{ok['id']}", json={"annual_dividend": bad})
        assert resp.status_code == 422, bad
    # A rejected PATCH must leave the row untouched — validate everything, then apply.
    rejected = await auth_client.patch(
        f"{SECURITIES}/{ok['id']}", json={"name": "Mutated", "annual_dividend": "-1"}
    )
    assert rejected.status_code == 422
    stored = (await auth_client.get(SECURITIES)).json()
    assert [s for s in stored if s["id"] == ok["id"]] == [ok]


async def test_ex_div_date_must_be_reasonable(auth_client):
    # A mistyped year must 422 at the boundary, not travel into XIRR/day-Δ spans later.
    absurd = await auth_client.post(
        SECURITIES,
        json={
            "ticker": "FUTR",
            "name": "Far Future",
            "holding_type": "stock",
            "ex_div_date": "9999-12-31",
        },
    )
    assert absurd.status_code == 422
    assert "ex_div_date" in absurd.json()["detail"]
    created = await _create_security(auth_client, ticker="NOW", name="Present Day")
    patched = await auth_client.patch(
        f"{SECURITIES}/{created['id']}", json={"ex_div_date": "9999-12-31"}
    )
    assert patched.status_code == 422
    assert "ex_div_date" in patched.json()["detail"]
    fine = await auth_client.patch(
        f"{SECURITIES}/{created['id']}", json={"ex_div_date": "2026-08-14"}
    )
    assert fine.status_code == 200, fine.text
    assert fine.json()["ex_div_date"] == "2026-08-14"


async def test_patch_security_updates_fields_never_ticker(auth_client):
    created = await _create_security(
        auth_client, ticker="MSFT", name="Microsoft", holding_type="stock"
    )
    resp = await auth_client.patch(
        f"{SECURITIES}/{created['id']}",
        json={
            "ticker": "AAPL",
            "name": "Microsoft Corporation",
            "industry": "Technology",
            "is_manual_priced": True,
            "is_active": False,
            "annual_dividend": "3.32",
            "ex_div_date": "2026-08-14",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ticker"] == "MSFT"  # ticker is the natural key — PATCH never rewrites it
    assert body["name"] == "Microsoft Corporation"
    assert body["industry"] == "Technology"
    assert body["is_manual_priced"] is True
    assert body["is_active"] is False
    assert body["annual_dividend"] == "3.3200"
    assert body["ex_div_date"] == "2026-08-14"
    assert (await auth_client.get(SECURITIES)).json() == [body]  # persisted, not just echoed

    ghost = await auth_client.patch(f"{SECURITIES}/999", json={"name": "Ghost"})
    assert ghost.status_code == 404
    over = await auth_client.patch(
        f"{SECURITIES}/{created['id']}", json={"annual_dividend": "1000000"}
    )
    assert over.status_code == 422  # same bound as create


async def test_patch_security_null_clears_nullable_only(auth_client):
    created = await _create_security(
        auth_client,
        ticker="T",
        name="AT&T",
        holding_type="stock",
        industry="Telecom",
        annual_dividend="1.11",
        ex_div_date="2026-07-09",
    )
    assert created["industry"] == "Telecom"
    cleared = await auth_client.patch(
        f"{SECURITIES}/{created['id']}",
        json={"industry": None, "annual_dividend": None, "ex_div_date": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["industry"] is None
    assert cleared.json()["annual_dividend"] is None
    assert cleared.json()["ex_div_date"] is None

    # NOT NULL columns read an explicit null as a no-op request, never a NULL write
    # (same PATCH posture as accounts).
    noop = await auth_client.patch(
        f"{SECURITIES}/{created['id']}",
        json={"name": None, "holding_type": None, "is_manual_priced": None, "is_active": None},
    )
    assert noop.status_code == 200, noop.text
    body = noop.json()
    assert body["name"] == "AT&T"
    assert body["holding_type"] == "stock"
    assert body["is_manual_priced"] is False
    assert body["is_active"] is True


async def test_patch_single_field_leaves_others_untouched(auth_client):
    created = await _create_security(
        auth_client,
        ticker="JEPI",
        name="JPMorgan Equity Premium",
        industry="ETF",
        annual_dividend="4.5",
        ex_div_date="2026-06-01",
    )
    resp = await auth_client.patch(f"{SECURITIES}/{created['id']}", json={"is_active": False})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_active"] is False
    # exclude_unset: omitted fields keep their stored values — a PATCH is never a PUT.
    assert body["name"] == "JPMorgan Equity Premium"
    assert body["industry"] == "ETF"
    assert body["annual_dividend"] == "4.5000"
    assert body["ex_div_date"] == "2026-06-01"


async def test_delete_security_guarded_when_referenced(auth_client, db):
    held = await _create_security(auth_client, ticker="SGOV", name="iShares 0-3 Month T-Bill")
    db.add(
        PositionTransaction(
            security_id=held["id"],
            account="RH Taxable",
            type="buy",
            shares=Decimal("10.000000"),
            price=Decimal("100.0000"),
        )
    )
    db.add(
        DividendPayment(security_id=held["id"], pay_date=date(2026, 6, 30), amount=Decimal("5.00"))
    )
    await db.commit()
    guarded = await auth_client.delete(f"{SECURITIES}/{held['id']}")
    assert guarded.status_code == 409  # history is real data — deactivate instead
    assert "1 transactions" in guarded.json()["detail"]
    assert "1 dividends" in guarded.json()["detail"]
    assert (await db.get(Security, held["id"])) is not None

    priced = await _create_security(auth_client, ticker="PRIV", name="Private Holding")
    db.add(
        LatestPrice(
            security_id=priced["id"],
            price=Decimal("12.3400"),
            quoted_at=datetime(2026, 8, 14, tzinfo=UTC),
            source="manual",
        )
    )
    db.add(
        PriceHistory(
            security_id=priced["id"], price_date=date(2026, 8, 14), close=Decimal("12.3400")
        )
    )
    await db.commit()
    resp = await auth_client.delete(f"{SECURITIES}/{priced['id']}")
    assert resp.status_code == 204  # derived price rows never block a delete
    assert (await db.get(Security, priced["id"])) is None
    leftovers = (
        (await db.execute(select(LatestPrice).where(LatestPrice.security_id == priced["id"])))
        .scalars()
        .all()
    )
    assert leftovers == []  # ... they CASCADE away with it

    assert (await auth_client.delete(f"{SECURITIES}/999")).status_code == 404


async def test_delete_guard_fires_for_dividend_only_security(auth_client, db):
    paid = await _create_security(auth_client, ticker="O", name="Realty Income")
    db.add(DividendPayment(security_id=paid["id"], pay_date=date(2026, 1, 1), amount=Decimal("5")))
    await db.commit()
    guarded = await auth_client.delete(f"{SECURITIES}/{paid['id']}")
    assert guarded.status_code == 409  # zero transactions must not disarm the guard
    assert "1 dividends" in guarded.json()["detail"]
    assert (await db.get(Security, paid["id"])) is not None


async def test_securities_require_auth(client):
    assert (await client.get(SECURITIES)).status_code == 401
    assert (
        await client.post(
            SECURITIES, json={"ticker": "VOO", "name": "Vanguard", "holding_type": "etf"}
        )
    ).status_code == 401
    assert (await client.patch(f"{SECURITIES}/1", json={"name": "X"})).status_code == 401
    assert (await client.delete(f"{SECURITIES}/1")).status_code == 401
