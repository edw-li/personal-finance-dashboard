from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.models import (
    DividendPayment,
    LatestPrice,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    Security,
)
from tests.portfolio_factories import acct

SECURITIES = "/api/v1/portfolio/securities"
TRANSACTIONS = "/api/v1/portfolio/transactions"
DIVIDENDS = "/api/v1/portfolio/dividends"
HOLDINGS = "/api/v1/portfolio/holdings"
ALLOCATION = "/api/v1/portfolio/allocation"
REALIZED = "/api/v1/portfolio/realized"
HISTORY = "/api/v1/portfolio/history"


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
            portfolio_account=acct("RH Taxable"),
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


# --- transactions ---


async def _account_row(db, label: str) -> PortfolioAccount:
    """The portfolio_accounts row the API already minted for `label`. Hand-built rows in a
    test that ALSO posts that label must reuse it — the acct() factory's memo is per-test
    and knows nothing about the router's row, so it would collide on the unique label."""
    return (
        await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == label))
    ).scalar_one()


def _buy(security_id: int, **overrides) -> dict:
    """Minimal valid buy payload; overrides (or a `del`) shape each validation case."""
    return {
        "security_id": security_id,
        "account": "Fidelity Taxable",
        "type": "buy",
        "shares": "5",
        "price": "100",
        **overrides,
    }


async def test_create_buy_assigns_source_ui_and_max_plus_10_sort_index(auth_client, db):
    security = await _create_security(auth_client)
    first = await auth_client.post(TRANSACTIONS, json=_buy(security["id"]))
    assert first.status_code == 201, first.text
    assert first.json()["source"] == "ui"
    assert first.json()["sort_index"] == 10  # empty table: coalesce(max, 0) + 10

    db.add(
        PositionTransaction(
            security_id=security["id"],
            portfolio_account=await _account_row(db, "Fidelity Taxable"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            sort_index=260,  # sheet row 26 x 10
            source="import",
        )
    )
    await db.commit()

    after_import = await auth_client.post(TRANSACTIONS, json=_buy(security["id"]))
    assert after_import.status_code == 201, after_import.text
    body = after_import.json()
    assert body["source"] == "ui"  # UI rows are invisible to re-imports
    assert body["sort_index"] == 270  # max(ALL rows) + 10 -> folds chronologically LAST
    second = await auth_client.post(TRANSACTIONS, json=_buy(security["id"]))
    assert second.json()["sort_index"] == 280  # each UI row lands after the previous one


async def test_create_buy_quantizes_shares_price_fees(auth_client):
    security = await _create_security(auth_client)
    resp = await auth_client.post(
        TRANSACTIONS,
        json=_buy(security["id"], shares="1.0000005", price="10.00005", fees="1.005"),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Column scales at HALF_UP (Python's default banker's rounding would give 1.000000/1.00).
    assert body["shares"] == "1.000001"
    assert body["price"] == "10.0001"
    assert body["fees"] == "1.01"
    assert body["split_factor"] is None
    assert body["txn_date"] is None  # dateless rows are legal — XIRR just goes null


async def test_create_buy_sell_validation(auth_client):
    security = await _create_security(auth_client)
    no_shares = _buy(security["id"])
    del no_shares["shares"]
    missing = await auth_client.post(TRANSACTIONS, json=no_shares)
    assert missing.status_code == 422
    assert "shares" in missing.json()["detail"]  # buy/sell rows carry BOTH legs

    no_price = _buy(security["id"])
    del no_price["price"]
    assert (await auth_client.post(TRANSACTIONS, json=no_price)).status_code == 422

    zero_shares = await auth_client.post(TRANSACTIONS, json=_buy(security["id"], shares="0"))
    assert zero_shares.status_code == 422
    assert "positive" in zero_shares.json()["detail"]

    negative_fees = await auth_client.post(TRANSACTIONS, json=_buy(security["id"], fees="-0.01"))
    assert negative_fees.status_code == 422

    negative_price = await auth_client.post(TRANSACTIONS, json=_buy(security["id"], price="-100"))
    assert negative_price.status_code == 422
    assert "price" in negative_price.json()["detail"]

    negative_factor = await auth_client.post(
        TRANSACTIONS,
        json={"security_id": security["id"], "account": "A", "type": "split", "split_factor": "-2"},
    )
    assert negative_factor.status_code == 422

    fees_on_split = await auth_client.post(
        TRANSACTIONS,
        json={
            "security_id": security["id"],
            "account": "A",
            "type": "split",
            "split_factor": "2",
            "fees": "1",
        },
    )
    assert fees_on_split.status_code == 422
    assert "fees" in fees_on_split.json()["detail"]

    factor_on_buy = await auth_client.post(
        TRANSACTIONS, json=_buy(security["id"], split_factor="2")
    )
    assert factor_on_buy.status_code == 422  # only split rows carry a factor
    assert "split_factor" in factor_on_buy.json()["detail"]

    # Sells store POSITIVE shares (locked convention — folding subtracts).
    sell = await auth_client.post(TRANSACTIONS, json=_buy(security["id"], type="sell"))
    assert sell.status_code == 201, sell.text
    assert sell.json()["shares"] == "5.000000"
    negative_sell = await auth_client.post(
        TRANSACTIONS, json=_buy(security["id"], type="sell", shares="-5")
    )
    assert negative_sell.status_code == 422

    assert (await auth_client.get(TRANSACTIONS)).json() == [sell.json()]  # no partial writes


async def test_create_split_forces_dummy_shares_price(auth_client):
    security = await _create_security(auth_client)

    def split_payload(**overrides) -> dict:
        payload = _buy(security["id"], type="split")
        del payload["shares"]  # a split row carries the factor and nothing else ...
        del payload["price"]
        return {**payload, "split_factor": "3", **overrides}

    created = await auth_client.post(TRANSACTIONS, json=split_payload())
    assert created.status_code == 201, created.text
    body = created.json()
    # Plan 1 dummy convention: folding reads ONLY the factor off a split row.
    assert body["shares"] == "0.000000"
    assert body["price"] == "0.0000"
    assert body["fees"] is None
    assert body["split_factor"] == "3.0000"

    no_factor = split_payload()
    del no_factor["split_factor"]
    rejected = await auth_client.post(TRANSACTIONS, json=no_factor)
    assert rejected.status_code == 422
    assert "split_factor" in rejected.json()["detail"]

    with_shares = await auth_client.post(TRANSACTIONS, json=split_payload(shares="5"))
    assert with_shares.status_code == 422  # dummy 0s only
    zero_factor = await auth_client.post(TRANSACTIONS, json=split_payload(split_factor="0"))
    assert zero_factor.status_code == 422  # a 0x split would erase the position

    explicit_zeros = await auth_client.post(TRANSACTIONS, json=split_payload(shares="0", price="0"))
    assert explicit_zeros.status_code == 201, explicit_zeros.text  # spelling the dummies is fine


async def test_create_transaction_unknown_security_422(auth_client):
    resp = await auth_client.post(TRANSACTIONS, json=_buy(999))
    assert resp.status_code == 422  # a bare FK violation would surface as a 500
    assert "999" in resp.json()["detail"]
    assert (await auth_client.get(TRANSACTIONS)).json() == []


async def test_patch_transaction_validates_merged_row(auth_client):
    security = await _create_security(auth_client)
    buy = (await auth_client.post(TRANSACTIONS, json=_buy(security["id"]))).json()

    repriced = await auth_client.patch(f"{TRANSACTIONS}/{buy['id']}", json={"price": "10.00005"})
    assert repriced.status_code == 200, repriced.text
    assert repriced.json()["price"] == "10.0001"  # PATCH requantizes exactly like create
    assert repriced.json()["shares"] == "5.000000"  # untouched legs survive the merge

    flipped = await auth_client.patch(f"{TRANSACTIONS}/{buy['id']}", json={"type": "split"})
    assert flipped.status_code == 422  # the MERGED row would be a split with no factor
    assert "split_factor" in flipped.json()["detail"]

    # An explicit null on the NOT NULL type column is a no-op request, never a NULL write.
    noop = await auth_client.patch(f"{TRANSACTIONS}/{buy['id']}", json={"type": None})
    assert noop.status_code == 200, noop.text
    assert noop.json()["type"] == "buy"

    noted = await auth_client.patch(f"{TRANSACTIONS}/{buy['id']}", json={"notes": "backfilled"})
    assert noted.status_code == 200
    assert noted.json()["notes"] == "backfilled"
    cleared = await auth_client.patch(f"{TRANSACTIONS}/{buy['id']}", json={"notes": None})
    assert cleared.status_code == 200
    assert cleared.json()["notes"] is None

    split = (
        await auth_client.post(
            TRANSACTIONS,
            json={
                "security_id": security["id"],
                "account": "Fidelity Taxable",
                "type": "split",
                "split_factor": "2",
            },
        )
    ).json()
    refactored = await auth_client.patch(
        f"{TRANSACTIONS}/{split['id']}", json={"split_factor": "4"}
    )
    assert refactored.status_code == 200, refactored.text
    assert refactored.json()["split_factor"] == "4.0000"
    assert refactored.json()["shares"] == "0.000000"  # the dummies survive the merge

    assert (await auth_client.patch(f"{TRANSACTIONS}/999", json={"price": "1"})).status_code == 404


async def test_patch_transaction_never_touches_source_or_sort_index(auth_client, db):
    security = await _create_security(auth_client)
    imported = PositionTransaction(
        security_id=security["id"],
        portfolio_account=acct("Fidelity Taxable"),
        type="buy",
        shares=Decimal("2.000000"),
        price=Decimal("50.0000"),
        sort_index=130,
        source="import",
    )
    db.add(imported)
    await db.commit()

    resp = await auth_client.patch(
        f"{TRANSACTIONS}/{imported.id}",
        json={"price": "51.5", "source": "ui", "sort_index": 0, "id": 999},
    )
    assert resp.status_code == 200, resp.text  # editing an import-owned row is legal ...
    body = resp.json()
    assert body["price"] == "51.5000"
    # ... but ownership metadata is not in TransactionUpdate at all, so pydantic drops
    # those keys and the next re-import still reverts the row (sheet wins).
    assert body["source"] == "import"
    assert body["sort_index"] == 130
    assert body["id"] == imported.id


async def test_delete_transaction_hard_deletes(auth_client, db):
    security = await _create_security(auth_client)
    ui_row = (await auth_client.post(TRANSACTIONS, json=_buy(security["id"]))).json()
    import_row = PositionTransaction(
        security_id=security["id"],
        portfolio_account=await _account_row(db, "Fidelity Taxable"),
        type="buy",
        shares=Decimal("1.000000"),
        price=Decimal("1.0000"),
        sort_index=90,
        source="import",
    )
    db.add(import_row)
    await db.commit()

    # Both sources delete hard — import-owned rows simply resurrect on the next re-import.
    assert (await auth_client.delete(f"{TRANSACTIONS}/{ui_row['id']}")).status_code == 204
    assert (await auth_client.delete(f"{TRANSACTIONS}/{import_row.id}")).status_code == 204
    assert (await auth_client.get(TRANSACTIONS)).json() == []
    remaining = (await db.execute(select(PositionTransaction))).scalars().all()
    assert remaining == []  # gone from the table, not merely filtered out of the list
    assert (await auth_client.delete(f"{TRANSACTIONS}/{ui_row['id']}")).status_code == 404


async def test_list_transactions_filters_and_orders(auth_client, db):
    voo = await _create_security(auth_client)
    nvda = await _create_security(auth_client, ticker="NVDA", name="NVIDIA", holding_type="stock")
    rows = [
        PositionTransaction(
            security_id=voo["id"],
            portfolio_account=acct("Fidelity Taxable"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            sort_index=30,
        ),
        PositionTransaction(
            security_id=voo["id"],
            portfolio_account=acct("Fidelity Taxable"),
            type="buy",
            shares=Decimal("2"),
            price=Decimal("2"),
            sort_index=10,
        ),
        PositionTransaction(
            security_id=nvda["id"],
            portfolio_account=acct("Fidelity Taxable"),
            type="buy",
            shares=Decimal("3"),
            price=Decimal("3"),
            sort_index=10,
        ),
    ]
    db.add_all(rows)
    await db.commit()
    ids = [row.id for row in rows]
    assert ids[1] < ids[2]  # ... so the pair sharing sort_index 10 has a knowable id order

    listed = await auth_client.get(TRANSACTIONS)
    assert listed.status_code == 200, listed.text
    # (sort_index, id) — the folding order. NEVER txn_date, which is mostly NULL.
    assert [t["id"] for t in listed.json()] == [ids[1], ids[2], ids[0]]

    filtered = await auth_client.get(TRANSACTIONS, params={"security_id": nvda["id"]})
    assert [t["id"] for t in filtered.json()] == [ids[2]]
    assert (await auth_client.get(TRANSACTIONS, params={"security_id": 999})).json() == []


# --- dividends ---


async def test_dividend_crud_roundtrip(auth_client):
    security = await _create_security(auth_client)
    created = await auth_client.post(
        DIVIDENDS,
        json={
            "security_id": security["id"],
            "account": " Fidelity Taxable ",
            "pay_date": "2026-06-30",
            "amount": "12.345",
            "notes": "Q2",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["amount"] == "12.35"  # 2 dp, HALF_UP
    assert body["account"] == "Fidelity Taxable"  # stored trimmed, like every other text field
    assert body["notes"] == "Q2"

    # Blank/whitespace account collapses to None — never '' (Task 9 review I1).
    blank_account = await auth_client.post(
        DIVIDENDS,
        json={
            "security_id": security["id"],
            "account": "   ",
            "pay_date": "2026-06-30",
            "amount": "1",
        },
    )
    assert blank_account.status_code == 201
    assert blank_account.json()["account"] is None
    trimmed = await auth_client.patch(
        f"{DIVIDENDS}/{blank_account.json()['id']}", json={"account": "  Fidelity  "}
    )
    assert trimmed.status_code == 200
    assert trimmed.json()["account"] == "Fidelity"
    blanked = await auth_client.patch(
        f"{DIVIDENDS}/{blank_account.json()['id']}", json={"account": "  "}
    )
    assert blanked.status_code == 200
    assert blanked.json()["account"] is None
    # Remove the probe row so the ordering assertions below see the original id set.
    assert (
        await auth_client.delete(f"{DIVIDENDS}/{blank_account.json()['id']}")
    ).status_code == 204

    older = await auth_client.post(
        DIVIDENDS, json={"security_id": security["id"], "pay_date": "2026-03-31", "amount": "10"}
    )
    assert older.status_code == 201, older.text
    assert older.json()["account"] is None  # account is optional on a dividend
    same_day = await auth_client.post(
        DIVIDENDS, json={"security_id": security["id"], "pay_date": "2026-06-30", "amount": "1"}
    )
    assert same_day.status_code == 201, same_day.text

    listed = await auth_client.get(DIVIDENDS)
    assert listed.status_code == 200, listed.text
    # newest first; id desc breaks same-day ties so the newest entry still leads
    assert [d["id"] for d in listed.json()] == [
        same_day.json()["id"],
        body["id"],
        older.json()["id"],
    ]
    assert (await auth_client.get(DIVIDENDS, params={"security_id": 999})).json() == []

    patched = await auth_client.patch(
        f"{DIVIDENDS}/{body['id']}", json={"amount": "20.005", "notes": None}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["amount"] == "20.01"
    assert patched.json()["notes"] is None
    assert patched.json()["pay_date"] == "2026-06-30"  # a PATCH is never a PUT

    assert (await auth_client.delete(f"{DIVIDENDS}/{body['id']}")).status_code == 204
    assert [d["id"] for d in (await auth_client.get(DIVIDENDS)).json()] == [
        same_day.json()["id"],
        older.json()["id"],
    ]
    assert (await auth_client.delete(f"{DIVIDENDS}/{body['id']}")).status_code == 404
    assert (await auth_client.patch(f"{DIVIDENDS}/999", json={"amount": "1"})).status_code == 404


async def test_dividend_validation(auth_client):
    security = await _create_security(auth_client)

    def dividend(**overrides) -> dict:
        return {
            "security_id": security["id"],
            "pay_date": "2026-06-30",
            "amount": "5",
            **overrides,
        }

    zero = await auth_client.post(DIVIDENDS, json=dividend(amount="0"))
    assert zero.status_code == 422
    assert "amount" in zero.json()["detail"]
    assert (await auth_client.post(DIVIDENDS, json=dividend(amount="-5"))).status_code == 422
    unknown = await auth_client.post(DIVIDENDS, json=dividend(security_id=999))
    assert unknown.status_code == 422  # a bare FK violation would surface as a 500
    assert "999" in unknown.json()["detail"]
    long_account = await auth_client.post(DIVIDENDS, json=dividend(account="A" * 81))
    assert long_account.status_code == 422  # schema max_length, not a String(80) truncation
    too_big = await auth_client.post(DIVIDENDS, json=dividend(amount="10000000000"))
    assert too_big.status_code == 422  # Numeric(12,2) holds ten integer digits
    assert (await auth_client.get(DIVIDENDS)).json() == []  # no partial writes

    live = (await auth_client.post(DIVIDENDS, json=dividend())).json()
    for bad in ({"amount": None}, {"pay_date": None}, {"amount": "0"}, {"amount": "-5"}):
        resp = await auth_client.patch(f"{DIVIDENDS}/{live['id']}", json=bad)
        assert resp.status_code == 422, bad  # PATCH enforces create's rules
    assert (await auth_client.get(DIVIDENDS)).json() == [live]  # rejected PATCHes change nothing


async def test_transaction_and_dividend_dates_must_be_reasonable(auth_client):
    security = await _create_security(auth_client)
    # A mistyped year must 422 at the boundary, not travel into XIRR/day-Δ spans later.
    typo = await auth_client.post(TRANSACTIONS, json=_buy(security["id"], txn_date="1026-08-15"))
    assert typo.status_code == 422
    assert "txn_date" in typo.json()["detail"]

    dated = await auth_client.post(TRANSACTIONS, json=_buy(security["id"], txn_date="2026-08-15"))
    assert dated.status_code == 201, dated.text
    assert dated.json()["txn_date"] == "2026-08-15"
    txn_id = dated.json()["id"]

    patched_typo = await auth_client.patch(
        f"{TRANSACTIONS}/{txn_id}", json={"account": "Moved", "txn_date": "3026-01-01"}
    )
    assert patched_typo.status_code == 422
    assert "txn_date" in patched_typo.json()["detail"]
    # Validate-then-mutate: a 422 midway through a PATCH leaves NOTHING dirty for the
    # next autoflush — this GET would otherwise report account "Moved".
    assert (await auth_client.get(TRANSACTIONS)).json() == [dated.json()]

    cleared = await auth_client.patch(f"{TRANSACTIONS}/{txn_id}", json={"txn_date": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["txn_date"] is None  # clearing a date is legal; XIRR just goes null

    absurd = await auth_client.post(
        DIVIDENDS, json={"security_id": security["id"], "pay_date": "3026-01-01", "amount": "5"}
    )
    assert absurd.status_code == 422
    assert "pay_date" in absurd.json()["detail"]
    live = await auth_client.post(
        DIVIDENDS, json={"security_id": security["id"], "pay_date": "2026-06-30", "amount": "5"}
    )
    assert live.status_code == 201, live.text
    patched_div = await auth_client.patch(
        f"{DIVIDENDS}/{live.json()['id']}", json={"amount": "9", "pay_date": "1026-01-01"}
    )
    assert patched_div.status_code == 422
    assert "pay_date" in patched_div.json()["detail"]
    assert (await auth_client.get(DIVIDENDS)).json() == [live.json()]  # amount stayed at 5.00


async def test_blank_account_rejected_on_transactions(auth_client, db):
    sec = await _create_security(auth_client, ticker="BLNK")
    base = {"security_id": sec["id"], "type": "buy", "shares": "1", "price": "5"}
    resp = await auth_client.post("/api/v1/portfolio/transactions", json={**base, "account": "   "})
    assert resp.status_code == 422
    assert "account" in resp.json()["detail"]
    created = await auth_client.post(
        "/api/v1/portfolio/transactions", json={**base, "account": " Robinhood "}
    )
    assert created.status_code == 201
    assert created.json()["account"] == "Robinhood"
    txn_id = created.json()["id"]
    patched = await auth_client.patch(
        f"/api/v1/portfolio/transactions/{txn_id}", json={"account": "  "}
    )
    assert patched.status_code == 422


# --- computed views ---


def _latest(security_id: int, price: str, day: int) -> LatestPrice:
    """Seed a quote directly (no prices API yet). Prices are spelled at COLUMN scale: the
    shared test session hands the endpoint these very objects, not rows re-read from PG,
    so `550` would cross the wire as "550" instead of "550.0000". Only the relative order
    of `day` matters — as_of reports the OLDEST quote."""
    return LatestPrice(
        security_id=security_id,
        price=Decimal(price),
        quoted_at=datetime(2026, 8, day, tzinfo=UTC),
        source="yfinance",
    )


async def test_holdings_end_to_end_math(auth_client, db):
    # Dates are relative to today so XIRR is deterministic: the flow SPANS (365d, 180d) are
    # fixed, so the solved rate never depends on the day the suite runs.
    today = date.today()
    voo = await _create_security(auth_client, industry="Index Funds", annual_dividend="6")
    nvda = await _create_security(
        auth_client, ticker="NVDA", name="NVIDIA", industry="Technology", holding_type="stock"
    )
    dated = await auth_client.post(
        TRANSACTIONS,
        json=_buy(voo["id"], shares="10", price="500", txn_date=str(today - timedelta(days=365))),
    )
    assert dated.status_code == 201, dated.text
    dateless = await auth_client.post(TRANSACTIONS, json=_buy(nvda["id"], shares="5", price="100"))
    assert dateless.status_code == 201, dateless.text
    paid = await auth_client.post(
        DIVIDENDS,
        json={
            "security_id": voo["id"],
            "pay_date": str(today - timedelta(days=180)),
            "amount": "25",
        },
    )
    assert paid.status_code == 201, paid.text
    db.add_all(
        [
            _latest(voo["id"], "550.0000", day=13),
            _latest(nvda["id"], "200.0000", day=14),
            # Day Δ reads the close STRICTLY BEFORE the latest bar's date — 500, not 550.
            PriceHistory(
                security_id=voo["id"], price_date=date(2026, 8, 12), close=Decimal("500.0000")
            ),
            PriceHistory(
                security_id=voo["id"], price_date=date(2026, 8, 13), close=Decimal("550.0000")
            ),
        ]
    )
    await db.commit()

    resp = await auth_client.get(HOLDINGS)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [h["ticker"] for h in body["holdings"]] == ["VOO", "NVDA"]  # market value desc
    assert body["holdings"][0] == {
        "security_id": voo["id"],
        "ticker": "VOO",
        "name": "Vanguard S&P 500 ETF",
        "industry": "Index Funds",
        "holding_type": "etf",
        "is_manual_priced": False,
        "shares": "10.000000",
        "avg_cost": "500.0000",
        "cost_basis": "5000.00",
        "price": "550.0000",
        "quoted_at": body["as_of"],  # the oldest quote in the book is this row's
        "price_source": "yfinance",
        "day_change_pct": "0.100000",  # (550 - 500) / 500
        "day_change_amount": "500.00",  # 10 shares x 50
        "market_value": "5500.00",
        "weight_pct": "0.846154",  # 5500 / 6500
        "unrealized_gl": "500.00",
        "unrealized_gl_pct": "0.100000",
        "realized_gl": "0.00",
        "dividends_collected": "25.00",
        "annual_dividend": "6.0000",
        "annual_income": "60.00",
        "yield_pct": "0.010909",  # 6 / 550
        "yoc_pct": "0.012000",  # 6 / 500 (yield on the cost actually paid)
        "xirr_pct": "0.105253",  # -5000 @ -365d, +25 @ -180d, +5500 today
        "accounts": ["Fidelity Taxable"],
        "warnings": [],
    }
    # Money crosses the wire as STRINGS — Number()'s precision loss never touches the ledger.
    assert all(
        isinstance(body["holdings"][0][field], str)
        for field in ("shares", "cost_basis", "price", "market_value", "weight_pct")
    )
    # as_of is the OLDEST quote (conservative staleness); latest_quote_at is the NEWEST
    # (it dates the chart's live ping — a stale straggler must not drag that backwards).
    assert datetime.fromisoformat(body["as_of"]) == datetime(2026, 8, 13, tzinfo=UTC)
    assert datetime.fromisoformat(body["latest_quote_at"]) == datetime(2026, 8, 14, tzinfo=UTC)
    second = body["holdings"][1]
    assert datetime.fromisoformat(second["quoted_at"]) == datetime(2026, 8, 14, tzinfo=UTC)
    assert second["market_value"] == "1000.00"
    assert second["weight_pct"] == "0.153846"  # 1000 / 6500
    assert second["day_change_pct"] is None  # fewer than two bars -> no day Δ
    assert second["day_change_amount"] is None
    assert second["xirr_pct"] is None  # one dateless transaction gates XIRR off entirely
    assert second["yield_pct"] is None  # no annual_dividend on the security
    assert second["annual_income"] is None
    weights = sum(Decimal(h["weight_pct"]) for h in body["holdings"])
    assert abs(weights - 1) < Decimal("0.000002")  # quantization slack only

    assert body["totals"] == {
        "market_value": "6500.00",
        "cost_basis": "5500.00",
        "unrealized_gl": "1000.00",
        "unrealized_gl_pct": "0.181818",  # 1000 / 5500
        "day_change_amount": "500.00",  # NVDA contributes nothing — it has no prior bar
        # ... so NVDA's 1000 is out of the BASIS too: 500 / (5500 - 500), yesterday's value
        # of the rows that have day data. Diluting by the whole priced book read 0.083333
        # here and understated the header far worse on a mostly-barless book (review I2).
        "day_change_pct": "0.100000",
        "realized_gl": "0.00",
        "dividends_collected": "25.00",
        "annual_income": "60.00",
        "unpriced_count": 0,
    }
    assert Decimal(body["totals"]["market_value"]) == sum(
        Decimal(h["market_value"]) for h in body["holdings"]
    )
    assert Decimal(body["totals"]["unrealized_gl"]) == Decimal(
        body["totals"]["market_value"]
    ) - Decimal(body["totals"]["cost_basis"])


async def test_holdings_empty_portfolio(auth_client, db):
    # A priced security with no transactions must still produce nothing: rows come from
    # FOLDED positions, and as_of is read off those rows — never off the price table.
    security = await _create_security(auth_client)
    db.add(_latest(security["id"], "550.0000", day=14))
    await db.commit()

    resp = await auth_client.get(HOLDINGS)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "as_of": None,
        "latest_quote_at": None,
        "totals": {
            "market_value": "0.00",
            "cost_basis": "0.00",
            "unrealized_gl": "0.00",
            "unrealized_gl_pct": None,  # no priced cost -> no ratio, never a ZeroDivisionError
            "day_change_amount": None,
            "day_change_pct": None,
            "realized_gl": "0.00",
            "dividends_collected": "0.00",
            "annual_income": "0.00",
            "unpriced_count": 0,
        },
        "holdings": [],
    }


async def test_holdings_unpriced_holding_flagged(auth_client, db):
    priced = await _create_security(auth_client)
    unpriced = await _create_security(
        auth_client, ticker="PRIV", name="Private Fund", holding_type="private"
    )
    for security, shares, price in ((priced, "10", "100"), (unpriced, "5", "50")):
        created = await auth_client.post(
            TRANSACTIONS, json=_buy(security["id"], shares=shares, price=price)
        )
        assert created.status_code == 201, created.text
    db.add(_latest(priced["id"], "120.0000", day=14))
    await db.commit()

    resp = await auth_client.get(HOLDINGS)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [h["ticker"] for h in body["holdings"]] == ["VOO", "PRIV"]  # unpriced rows sort last
    assert datetime.fromisoformat(body["as_of"]) == datetime(2026, 8, 14, tzinfo=UTC)
    assert body["latest_quote_at"] == body["as_of"]  # one quote: the two clocks agree
    ghost = body["holdings"][1]
    assert ghost["shares"] == "5.000000"
    assert ghost["cost_basis"] == "250.00"  # cost is known even when value is not
    assert ghost["price"] is None
    assert ghost["quoted_at"] is None
    assert ghost["price_source"] is None
    assert ghost["market_value"] is None
    assert ghost["weight_pct"] is None  # an unpriced row cannot claim a share of the pie
    assert ghost["unrealized_gl"] is None
    assert body["holdings"][0]["weight_pct"] == "1.000000"  # weights span the PRICED book

    assert body["totals"] == {
        "market_value": "1200.00",  # excludes the unpriced row
        "cost_basis": "1250.00",  # ... but cost basis counts it
        "unrealized_gl": "200.00",  # 1200 - 1000, the PRICED cost only
        "unrealized_gl_pct": "0.200000",  # 200 / 1000
        "day_change_amount": None,
        "day_change_pct": None,
        "realized_gl": "0.00",
        "dividends_collected": "0.00",
        "annual_income": "0.00",
        "unpriced_count": 1,
    }
    # Pinned asymmetry: unrealized is MV minus PRICED cost, so it deliberately does NOT
    # equal market_value - cost_basis (which would read -50.00, a phantom loss).
    assert Decimal(body["totals"]["unrealized_gl"]) != Decimal(
        body["totals"]["market_value"]
    ) - Decimal(body["totals"]["cost_basis"])


async def test_allocation_by_each_dimension_weights_sum_to_one(auth_client, db):
    voo = await _create_security(auth_client, industry="Index Funds")
    nvda = await _create_security(
        auth_client, ticker="NVDA", name="NVIDIA", industry="Technology", holding_type="stock"
    )
    priv = await _create_security(  # industry None -> the "Uncategorized" bucket
        auth_client, ticker="PRIV", name="Private Fund", holding_type="private"
    )
    ghost = await _create_security(
        auth_client, ticker="ZI", name="ZoomInfo", industry="Technology", holding_type="stock"
    )
    for security, account, shares, price in (
        (voo, "Fidelity Taxable", "10", "300"),
        (nvda, "Fidelity Taxable", "4", "200"),
        (nvda, "Robinhood", "8", "200"),
        (priv, "Robinhood", "1", "400"),
        (ghost, "Robinhood", "9", "10"),  # never priced -> invisible to allocation
    ):
        created = await auth_client.post(
            TRANSACTIONS,
            json=_buy(security["id"], account=account, shares=shares, price=price),
        )
        assert created.status_code == 201, created.text
    db.add_all(
        [
            _latest(voo["id"], "500.0000", day=14),
            _latest(nvda["id"], "250.0000", day=14),
            _latest(priv["id"], "500.0000", day=14),
        ]
    )
    await db.commit()

    expected = {
        # VOO 10x500 = 5000 | NVDA 12x250 = 3000 (4 Fidelity, 8 Robinhood) | PRIV 1x500 = 500
        "industry": [
            {
                "key": "Index Funds",
                "market_value": "5000.00",
                "weight_pct": "0.588235",
                "holdings": 1,
            },
            {
                "key": "Technology",
                "market_value": "3000.00",
                "weight_pct": "0.352941",
                "holdings": 1,
            },
            {
                "key": "Uncategorized",
                "market_value": "500.00",
                "weight_pct": "0.058824",
                "holdings": 1,
            },
        ],
        "type": [
            {"key": "etf", "market_value": "5000.00", "weight_pct": "0.588235", "holdings": 1},
            {"key": "stock", "market_value": "3000.00", "weight_pct": "0.352941", "holdings": 1},
            {"key": "private", "market_value": "500.00", "weight_pct": "0.058824", "holdings": 1},
        ],
        # account is per-POSITION grain: NVDA counts in both buckets, VOO only in one.
        "account": [
            {
                "key": "Fidelity Taxable",
                "market_value": "6000.00",
                "weight_pct": "0.705882",
                "holdings": 2,
            },
            {
                "key": "Robinhood",
                "market_value": "2500.00",
                "weight_pct": "0.294118",
                "holdings": 2,
            },
        ],
    }
    for by, slices in expected.items():
        resp = await auth_client.get(ALLOCATION, params={"by": by})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["by"] == by
        # 8500, not 8590: the priceless ZI position is skipped, not valued at cost.
        assert body["total_market_value"] == "8500.00"
        assert body["slices"] == slices  # market-value DESC
        assert abs(sum(Decimal(s["weight_pct"]) for s in body["slices"]) - 1) < Decimal("0.000002")

    default = await auth_client.get(ALLOCATION)
    assert default.status_code == 200, default.text
    assert default.json()["by"] == "industry"  # the default dimension
    bad = await auth_client.get(ALLOCATION, params={"by": "banana"})
    assert bad.status_code == 422  # Literal query param, not free text


async def test_realized_rows_only_for_nonzero(auth_client):
    winner = await _create_security(auth_client)
    loser = await _create_security(
        auth_client, ticker="ZM", name="Zoom Video", holding_type="stock"
    )
    held = await _create_security(auth_client, ticker="SGOV", name="iShares 0-3 Month T-Bill")
    # Post order IS fold order: every UI row takes sort_index = max + 10, so buys land first.
    for payload in (
        _buy(winner["id"], shares="10", price="100"),
        _buy(loser["id"], shares="10", price="100"),
        _buy(held["id"], shares="10", price="100"),
        _buy(winner["id"], type="sell", shares="4", price="150"),
        _buy(loser["id"], type="sell", shares="5", price="80"),
    ):
        created = await auth_client.post(TRANSACTIONS, json=payload)
        assert created.status_code == 201, created.text

    resp = await auth_client.get(REALIZED)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rows"] == [
        # ascending: the worst loss leads. Buy-only SGOV folds to 0 and is omitted entirely.
        {
            "security_id": loser["id"],
            "ticker": "ZM",
            "name": "Zoom Video",
            "realized_gl": "-100.00",  # 5 x (80 - 100)
        },
        {
            "security_id": winner["id"],
            "ticker": "VOO",
            "name": "Vanguard S&P 500 ETF",
            "realized_gl": "200.00",  # 4 x (150 - 100)
        },
    ]
    assert body["total"] == "100.00"
    assert Decimal(body["total"]) == sum(Decimal(row["realized_gl"]) for row in body["rows"])


async def test_totals_include_fully_exited_positions(auth_client, db):
    # A liquidated security has no holdings ROW (zero shares) but its realized gain and
    # dividends are still real money — totals read the whole book, not the visible rows.
    exited = await _create_security(auth_client)
    live = await _create_security(auth_client, ticker="NVDA", name="NVIDIA", holding_type="stock")
    for payload in (
        _buy(exited["id"], shares="10", price="100"),
        _buy(exited["id"], type="sell", shares="10", price="120"),
        _buy(live["id"], shares="5", price="100"),
    ):
        created = await auth_client.post(TRANSACTIONS, json=payload)
        assert created.status_code == 201, created.text
    paid = await auth_client.post(
        DIVIDENDS,
        json={"security_id": exited["id"], "pay_date": "2026-06-30", "amount": "30"},
    )
    assert paid.status_code == 201, paid.text
    db.add(_latest(live["id"], "200.0000", day=14))
    await db.commit()

    body = (await auth_client.get(HOLDINGS)).json()
    assert [h["ticker"] for h in body["holdings"]] == ["NVDA"]  # the exited row is gone ...
    assert body["holdings"][0]["realized_gl"] == "0.00"
    assert body["holdings"][0]["dividends_collected"] == "0.00"
    # ... yet the header still reports what it earned: 10 x (120 - 100) and the payment.
    assert body["totals"]["realized_gl"] == "200.00"
    assert body["totals"]["dividends_collected"] == "30.00"
    assert body["totals"]["market_value"] == "1000.00"

    realized_body = (await auth_client.get(REALIZED)).json()
    assert realized_body["rows"] == [
        {
            "security_id": exited["id"],
            "ticker": "VOO",
            "name": "Vanguard S&P 500 ETF",
            "realized_gl": "200.00",
        }
    ]
    assert realized_body["total"] == "200.00"

    # by=account must SKIP the liquidated position entirely (zero-share filter) —
    # only the live security's account appears (Task 10 re-review R2r).
    by_account = (await auth_client.get(f"{ALLOCATION}?by=account")).json()
    assert [s["key"] for s in by_account["slices"]] == ["Fidelity Taxable"]
    assert by_account["total_market_value"] == "1000.00"


async def test_zero_total_market_value_book(auth_client, db):
    # A long and an oversold short can cancel to a zero-value book. Weights are then
    # undefined (never a ZeroDivisionError, never a fabricated 100%).
    long_sec = await _create_security(auth_client)
    short_sec = await _create_security(
        auth_client, ticker="NVDA", name="NVIDIA", holding_type="stock"
    )
    for payload in (
        _buy(long_sec["id"], shares="10", price="100"),
        _buy(short_sec["id"], shares="10", price="100"),
    ):
        created = await auth_client.post(TRANSACTIONS, json=payload)
        assert created.status_code == 201, created.text
    oversell = await auth_client.post(
        TRANSACTIONS, json=_buy(short_sec["id"], type="sell", shares="20", price="100")
    )
    assert oversell.status_code == 201, oversell.text  # bad data folds, it never 500s
    db.add_all(
        [_latest(long_sec["id"], "100.0000", day=14), _latest(short_sec["id"], "100.0000", day=14)]
    )
    await db.commit()

    body = (await auth_client.get(HOLDINGS)).json()
    assert body["totals"]["market_value"] == "0.00"
    assert [h["market_value"] for h in body["holdings"]] == ["1000.00", "-1000.00"]
    assert all(h["weight_pct"] is None for h in body["holdings"])  # 0 total -> no weights
    oversold = body["holdings"][1]
    assert oversold["shares"] == "-10.000000"
    assert oversold["warnings"] == [f"txn {oversell.json()['id']}: sell exceeds held shares"]

    resp = await auth_client.get(ALLOCATION, params={"by": "type"})
    assert resp.status_code == 200, resp.text
    allocation_body = resp.json()
    assert allocation_body["total_market_value"] == "0.00"
    # The zero-total fallback speaks the same 6dp vocabulary as a real weight (review M1).
    assert [s["weight_pct"] for s in allocation_body["slices"]] == ["0.000000", "0.000000"]
    assert [s["key"] for s in allocation_body["slices"]] == ["etf", "stock"]


async def test_day_pct_none_when_prior_values_cancel(auth_client, db):
    # Day Δ divides by YESTERDAY's value of the day-data rows; long and short prior values
    # can cancel to zero, so the guard is reachable with a non-null day amount above it.
    long_sec = await _create_security(auth_client)
    short_sec = await _create_security(
        auth_client, ticker="NVDA", name="NVIDIA", holding_type="stock"
    )
    for payload in (
        _buy(long_sec["id"], shares="10", price="100"),
        _buy(short_sec["id"], shares="10", price="100"),
        _buy(short_sec["id"], type="sell", shares="20", price="100"),  # oversell -> -10
    ):
        created = await auth_client.post(TRANSACTIONS, json=payload)
        assert created.status_code == 201, created.text
    for security in (long_sec, short_sec):
        db.add_all(
            [
                _latest(security["id"], "110.0000", day=14),
                PriceHistory(
                    security_id=security["id"],
                    price_date=date(2026, 8, 12),
                    close=Decimal("100.0000"),
                ),
                PriceHistory(
                    security_id=security["id"],
                    price_date=date(2026, 8, 13),
                    close=Decimal("110.0000"),
                ),
            ]
        )
    await db.commit()

    body = (await auth_client.get(HOLDINGS)).json()
    assert [h["day_change_amount"] for h in body["holdings"]] == ["100.00", "-100.00"]
    assert body["totals"]["day_change_amount"] == "0.00"  # a real, quantized zero ...
    assert body["totals"]["day_change_pct"] is None  # ... over a zero basis: no percentage


async def test_computed_views_require_auth(client):
    for url in (HOLDINGS, ALLOCATION, REALIZED, HISTORY):
        assert (await client.get(url)).status_code == 401, url


async def test_history_empty_is_empty_arrays_not_404(auth_client):
    resp = await auth_client.get(HISTORY)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "dates": [],
        "market_value": [],
        "cost_basis": [],
        "sp500": [],
        "benchmark": [],
    }


async def test_history_returns_parallel_arrays_ordered_by_date(auth_client, db):
    db.add_all(
        [
            # Inserted out of order on purpose: the endpoint must sort by snapshot_date.
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 30),
                market_value=Decimal("53413.36"),
                cost_basis=Decimal("55212.09"),
                sp500_value=Decimal("53001.35"),
            ),
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 23),
                market_value=Decimal("53619.00"),
                cost_basis=Decimal("53619.00"),
                sp500_value=Decimal("53619.00"),
            ),
        ]
    )
    await db.commit()

    body = (await auth_client.get(HISTORY)).json()
    assert body["dates"] == ["2023-10-23", "2023-10-30"]
    # Decimal strings on the wire (pydantic v2), aligned index-for-index
    assert body["market_value"] == ["53619.00", "53413.36"]
    assert body["cost_basis"] == ["53619.00", "55212.09"]
    assert body["sp500"] == ["53619.00", "53001.35"]
    # No VOO bars at all in this seed: the benchmark leg is ALL-null — the one degraded
    # shape (spec §4). Nulls, never a 500: the GET still answers.
    assert body["benchmark"] == [None, None]


async def test_history_carries_the_contribution_benchmark(auth_client, db):
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    db.add(voo)
    await db.flush()
    db.add_all(
        [
            PriceHistory(
                security_id=voo.id, price_date=date(2023, 10, 23), close=Decimal("400.0000")
            ),
            PriceHistory(
                security_id=voo.id, price_date=date(2023, 10, 30), close=Decimal("440.0000")
            ),
        ]
    )
    db.add_all(
        [
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 23),
                market_value=Decimal("1000.00"),
                cost_basis=Decimal("1000.00"),
                sp500_value=Decimal("1000.00"),
            ),
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 30),
                market_value=Decimal("1150.00"),
                cost_basis=Decimal("1200.00"),
                sp500_value=Decimal("1100.00"),
            ),
        ]
    )
    await db.commit()

    body = (await auth_client.get(HISTORY)).json()
    # Parity seed = mv[0]; then 1000 x 440/400 + (1200 - 1000) = 1300. Decimal strings
    # on the wire, aligned index-for-index with dates.
    assert body["benchmark"] == ["1000.00", "1300.00"]
    assert len(body["benchmark"]) == len(body["dates"])
