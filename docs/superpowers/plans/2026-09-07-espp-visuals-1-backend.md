# ESPP visuals — Lane 1 (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every server-side addition in `docs/superpowers/specs/2026-09-07-espp-visuals-design.md` §3: the per-lot anatomy fields (§3.1), the position `totals` block on the lots envelope (§3.2), three more modeler totals (§3.3) and the employer price backfill floor extended to the earliest ESPP lot or offering (§3.4). Additive wire changes only; no migration; nothing the page draws is computed on the client afterwards.

**Architecture:** `services/espp_calc.py` (pure) grows three things — five component keys in `lot_metrics`, a `running_avg_paid()` walk over the ordered lots, and `position_totals()` over `(lot, metrics)` pairs — plus three fields on `ModelerTotals`. `schemas/espp.py` mirrors them (`LotOut`, `HeldTotalsOut`/`SoldTotalsOut`/`LotTotalsOut`, `ModelerTotalsOut`). `api/espp.py` composes: `list_lots` runs the walk and the totals once; the write verbs re-read the chain for their one lot's average. `services/price_service.backfill_employer_history` takes the earliest of three anchors instead of one.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, pydantic v2, pytest, ruff.

**Rules for every task**
- Work from `C:\Users\edyli\personal-finance-dashboard\backend` (or the lane's worktree's `backend/`). Test: `FINANCE_TEST_DB=finance_test_e1 .venv/Scripts/python.exe -m pytest tests/<file> -q`, written `pytest …` below (PowerShell: `$env:FINANCE_TEST_DB="finance_test_e1"`). The `.venv` is the MAIN checkout's — in a worktree, call it by absolute path `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`.
- Finish every task with `.venv/Scripts/python.exe -m ruff format app tests && .venv/Scripts/python.exe -m ruff check app tests`. Snippets are written densely; ruff reflows them to the house 100-column style.
- Snippets carry only the comments that encode a rule. Match each file's own comment density when you write the real thing: every non-obvious decision gets a *why*.
- This lane touches **no** file under `src/` — `src/types/api.ts` was already changed on main before the lanes started (the optional fields; see the spec's §3 preamble). It touches **no** migration.
- Every figure the tests assert was computed with the module itself before the plan was written; a disagreement is a bug in the implementation, not in the expectation.

---

## File structure

| File | Responsibility |
|---|---|
| `app/services/espp_calc.py` (modify) | `price5`, five component keys in `lot_metrics`, `running_avg_paid`, `position_totals`, three `ModelerTotals` fields |
| `app/schemas/espp.py` (modify) | `LotOut` component fields, `HeldTotalsOut`, `SoldTotalsOut`, `LotTotalsOut`, `LotsOut.totals`, `ModelerTotalsOut` fields |
| `app/api/espp.py` (modify) | `_lot_out(lot, metrics, avg)`, `_running_average_for`, `list_lots` totals, write verbs' average, modeler totals |
| `app/services/price_service.py` (modify) | the three-anchor backfill floor |
| `tests/test_espp_calc.py`, `tests/test_espp_api.py`, `tests/test_price_service.py` (modify) | the pins |

---

### Task 1: The lot's anatomy — five component keys in `lot_metrics`

**Files:** Modify `app/services/espp_calc.py` (`lot_metrics`, near the end of the file) · Test `tests/test_espp_calc.py`

- [ ] **1 Widen the test helper** — in `tests/test_espp_calc.py`, give `lot()` one more keyword, defaulted so every existing call is unchanged:

```python
def lot(
    shares: str = "260.0000",
    purchase_price: str = "41.23265",
    purchase_date: date = date(2024, 2, 29),
    qualifying_date: date = date(2025, 9, 1),
    sold_date: date | None = None,
    sold_price: str | None = None,
    purchase_fmv: str = "79.11200",
) -> EsppLot:
```

and use it: `purchase_fmv=D(purchase_fmv),` replaces the literal `purchase_fmv=D("79.11200"),` inside the constructor call.

- [ ] **2 Write the failing tests** — append after `test_lot_metrics_treats_a_sold_row_missing_its_price_as_unpriced`:

```python
# --- the anatomy (2026-09-07 spec §3.1) ---


def test_lot_metrics_splits_value_into_paid_bargain_and_appreciation():
    metrics = lot_metrics(lot(), current_price=D("174.1800"), today=date(2026, 8, 16))
    assert metrics["fmv_value"] == D("20569.12")  # 260 x 79.112
    assert metrics["bargain_element"] == D("9848.63")  # fmv_value - cost_basis
    assert metrics["lookback_component"] == D("7956.78")  # 260 x (79.112 - 48.509)
    assert metrics["discount_component"] == D("1891.85")  # 260 x (48.509 - 41.23265)
    assert metrics["appreciation"] == D("24717.68")  # market_value - fmv_value


def test_lot_metrics_appreciation_is_realized_for_a_sold_lot_and_null_when_unpriced():
    sold = lot_metrics(
        lot(sold_date=date(2026, 3, 1), sold_price="120.00000"),
        current_price=D("174.1800"),
        today=date(2026, 8, 16),
    )
    assert sold["appreciation"] == D("10630.88")  # 31200.00 - 20569.12, at the SALE price
    unpriced = lot_metrics(lot(), current_price=None, today=date(2026, 8, 16))
    assert unpriced["appreciation"] is None
    assert unpriced["bargain_element"] == D("9848.63")  # purchase-day facts need no quote


def test_lot_metrics_appreciation_goes_negative_below_the_purchase_fmv():
    metrics = lot_metrics(lot(), current_price=D("70.0000"), today=date(2026, 8, 16))
    assert metrics["appreciation"] == D("-2369.12")  # 18200.00 - 20569.12


def test_lot_metrics_discount_component_goes_negative_for_an_over_typed_purchase_price():
    metrics = lot_metrics(
        lot(purchase_price="60.00000"), current_price=D("174.1800"), today=date(2026, 8, 16)
    )
    assert metrics["bargain_element"] == D("4969.12")  # 20569.12 - 15600.00
    assert metrics["lookback_component"] == D("7956.78")  # FMV vs subscription — unchanged
    assert metrics["discount_component"] == D("-2987.66")  # the whole over-payment lands here


def test_lot_metrics_lookback_is_zero_when_fmv_sat_below_the_subscription():
    metrics = lot_metrics(
        lot(purchase_fmv="40.00000", purchase_price="34.00000"),
        current_price=D("174.1800"),
        today=date(2026, 8, 16),
    )
    assert metrics["fmv_value"] == D("10400.00")
    assert metrics["lookback_component"] == D("0.00")
    assert metrics["discount_component"] == D("1560.00")  # the whole bargain is the discount
```

- [ ] **3 Fail:** `pytest tests/test_espp_calc.py -q -k "anatomy or splits_value or appreciation_is or goes_negative or lookback_is_zero"` → `KeyError: 'fmv_value'` (five failures).
- [ ] **4 Implement** — in `lot_metrics`, after the `gain_pct` block and before `reference_date`, add:

```python
    # The anatomy (2026-09-07 spec §3.1). The bargain element is the lot's value on purchase
    # day less what it cost — the plan discount PLUS the lookback (FMV above the subscription
    # price). It is split from the two stored prices, never from the discount setting: an
    # over-typed purchase_price then shows up honestly as a NEGATIVE discount component
    # rather than as a lie about the lookback.
    fmv_value = half_up2(lot.shares * lot.purchase_fmv)
    bargain_element = (fmv_value - cost_basis) + ZERO
    lookback_component = half_up2(lot.shares * max(lot.purchase_fmv - lot.subscription_price, ZERO))
    discount_component = (bargain_element - lookback_component) + ZERO
    # Realized for a sold lot (market_value is at the sale price), None while unpriced.
    appreciation = None if market_value is None else (market_value - fmv_value) + ZERO
```

and add the five keys to the returned dict, after `"gain_pct": gain_pct,`:

```python
        "fmv_value": fmv_value,
        "bargain_element": bargain_element,
        "lookback_component": lookback_component,
        "discount_component": discount_component,
        "appreciation": appreciation,
```

Extend the docstring's field list with one sentence: *"The five anatomy keys (fmv_value, bargain_element, lookback_component, discount_component, appreciation) are the lot's value on purchase day and its split — only `appreciation` needs a price, so only it can be None."*

- [ ] **5 Pass:** `pytest tests/test_espp_calc.py -q` → all green (the existing 60-odd cases included).
- [ ] **6 Commit:** `git add tests/test_espp_calc.py app/services/espp_calc.py && git commit -m "feat(espp): lot_metrics splits each lot into paid, bargain element (discount + lookback) and appreciation"`

---

### Task 2: `running_avg_paid` — the average price paid to date, per lot

**Files:** Modify `app/services/espp_calc.py` (new helpers after `_pct6`) · Test `tests/test_espp_calc.py`

- [ ] **1 Write the failing tests** — append; extend the module's import list with `price5, running_avg_paid`:

```python
def test_running_avg_paid_walks_the_lots_in_chain_order():
    lots = [
        lot(shares="260.0000", purchase_price="41.23265", purchase_date=date(2024, 2, 29)),
        lot(shares="100.0000", purchase_price="127.50000", purchase_date=date(2024, 8, 30)),
        lot(shares="241.0000", purchase_price="41.23265", purchase_date=date(2025, 2, 28)),
    ]
    # Cumulative cost over cumulative shares at the lot price scale (5 dp):
    # 10720.49 / 260, 23470.49 / 360, 33407.56 / 601.
    assert running_avg_paid(lots) == [D("41.23265"), D("65.19581"), D("55.58662")]


def test_running_avg_paid_never_divides_by_zero_shares():
    # The API forbids a zero-share lot; a hand-edited row must still read (a GET never 500s).
    assert running_avg_paid([lot(shares="0.0000")]) == [None]
    assert running_avg_paid([]) == []


def test_price5_collapses_signed_zeros():
    assert str(price5(D("-0.000001"))) == "0.00000"
```

- [ ] **2 Fail:** `pytest tests/test_espp_calc.py -q -k "running_avg or price5"` → `ImportError: cannot import name 'price5'`.
- [ ] **3 Implement** — in `app/services/espp_calc.py`, after `_pct6`:

```python
# The espp lot price family — Numeric(14,5), the one place in the app that is not 4dp.
PRICE5_QUANTUM = Decimal("0.00001")


def price5(value: Decimal) -> Decimal:
    """HALF_UP at the lot price scale, signed zero collapsed (the module's wire rule)."""
    return value.quantize(PRICE5_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def running_avg_paid(lots) -> list[Decimal | None]:
    """Average price paid per share TO DATE, one figure per lot, over `lots` in chain order
    ((purchase_date, id) — the router's own ordering; 2026-09-07 spec §3.1).

    Sold lots stay in the walk: this is what the purchases cost on average as they happened —
    the price chart's stepped rule — never a tax basis, and the wire name says "paid". None
    only where the cumulative share count is zero, which the API forbids but a hand-edited
    row could store: a GET must never divide by it. Each lot's cost is half_up2(shares x
    price), the same cents `lot_metrics` reports as cost_basis, so the two never drift.
    """
    cumulative_cost = ZERO
    cumulative_shares = ZERO
    averages: list[Decimal | None] = []
    for lot in lots:
        cumulative_cost += half_up2(lot.shares * lot.purchase_price)
        cumulative_shares += lot.shares
        averages.append(
            None if cumulative_shares == 0 else price5(cumulative_cost / cumulative_shares)
        )
    return averages
```

- [ ] **4 Pass:** `pytest tests/test_espp_calc.py -q` → green.
- [ ] **5 Commit:** `git add tests/test_espp_calc.py app/services/espp_calc.py && git commit -m "feat(espp): running_avg_paid — the average paid per share to date, one figure per lot"`

---

### Task 3: `position_totals` — held and sold lots summed apart

**Files:** Modify `app/services/espp_calc.py` (after `running_avg_paid`) · Test `tests/test_espp_calc.py`

- [ ] **1 Write the failing tests** — append; import `position_totals`:

```python
def test_position_totals_sums_held_and_sold_lots_apart():
    today = date(2026, 8, 16)
    price = D("174.1800")
    a = lot(shares="260.0000", purchase_date=date(2024, 2, 29))
    b = lot(
        shares="100.0000",
        purchase_price="127.50000",
        purchase_date=date(2024, 8, 30),
        sold_date=date(2026, 3, 1),
        sold_price="120.00000",
    )
    c = lot(shares="241.0000", purchase_date=date(2025, 2, 28))
    totals = position_totals([(row, lot_metrics(row, price, today)) for row in (a, b, c)])
    held, sold = totals["held"], totals["sold"]
    assert held["lots"] == 2
    assert held["shares"] == D("501.0000")
    assert held["cost_basis"] == D("20657.56")  # 10720.49 + 9937.07
    assert held["fmv_value"] == D("39635.11")  # 20569.12 + 19065.99
    assert held["market_value"] == D("87264.18")  # 45286.80 + 41977.38
    assert held["gain_amount"] == D("66606.62")
    # gain / cost — a MONEY ratio (the per-lot gain_pct is the sheet's PRICE ratio; the two
    # agree here only because both lots were bought at one price).
    assert held["gain_pct"] == D("3.224322")
    assert held["bargain_element"] == D("18977.55")
    assert held["lookback_component"] == D("15332.10")  # 7956.78 + 7375.32
    assert held["discount_component"] == D("3645.45")
    assert held["appreciation"] == D("47629.07")  # 24717.68 + 22911.39
    assert held["avg_paid"] == D("41.23265")  # 20657.56 / 501
    assert sold == {
        "lots": 1,
        "shares": D("100.0000"),
        "cost_basis": D("12750.00"),
        "proceeds": D("12000.00"),
        "gain_amount": D("-750.00"),
    }


def test_position_totals_null_the_quote_fields_when_a_held_lot_is_unpriced():
    today = date(2026, 8, 16)
    rows = [lot(), lot(purchase_date=date(2025, 2, 28))]
    totals = position_totals([(row, lot_metrics(row, None, today)) for row in rows])
    held = totals["held"]
    assert held["lots"] == 2
    assert held["cost_basis"] == D("21440.98")  # purchase-day facts always sum
    assert held["bargain_element"] == D("19697.26")
    assert (held["market_value"], held["gain_amount"], held["gain_pct"], held["appreciation"]) == (
        None,
        None,
        None,
        None,
    )
    assert held["avg_paid"] == D("41.23265")


def test_position_totals_skip_the_money_of_a_sold_row_missing_its_price():
    today = date(2026, 8, 16)
    # Stored shape the API rejects: sold_date without sold_price (lot_metrics reads it as
    # sold-but-unpriced). It counts as a sold lot and contributes to no money field.
    half = lot(sold_date=date(2026, 3, 1), sold_price=None)
    totals = position_totals([(half, lot_metrics(half, D("174.1800"), today))])
    assert totals["sold"] == {
        "lots": 1,
        "shares": D("260.0000"),
        "cost_basis": D("0.00"),
        "proceeds": D("0.00"),
        "gain_amount": D("0.00"),
    }
    assert totals["held"]["lots"] == 0
    assert totals["held"]["avg_paid"] is None
    assert totals["held"]["gain_pct"] is None


def test_position_totals_are_all_zeros_never_absent_when_empty():
    totals = position_totals([])
    assert str(totals["held"]["shares"]) == "0.0000"  # column scale, so the wire says 0.0000
    assert str(totals["held"]["cost_basis"]) == "0.00"
    assert totals["held"]["market_value"] == D("0.00")  # zeros, not None: nothing is unpriced
    assert totals["held"]["gain_pct"] is None
    assert str(totals["sold"]["proceeds"]) == "0.00"
```

- [ ] **2 Fail:** `pytest tests/test_espp_calc.py -q -k position_totals` → `ImportError: cannot import name 'position_totals'`.
- [ ] **3 Implement** — after `running_avg_paid`:

```python
# Accumulators start AT column scale so an empty block still serializes "0.0000" / "0.00"
# rather than a bare "0" (Pct9's lesson: the wire text is the Decimal's own str()).
SHARES_ZERO = Decimal("0.0000")
MONEY_ZERO = Decimal("0.00")
HELD_SUMMED = ("cost_basis", "fmv_value", "bargain_element", "lookback_component", "discount_component")


def position_totals(rows) -> dict[str, dict]:
    """The lots envelope's totals block (2026-09-07 spec §3.2): held and sold lots summed
    apart, from the (lot, lot_metrics(lot, …)) pairs the router already built.

    Held: the quote-dependent fields (market_value, gain_amount, gain_pct, appreciation) go
    None as soon as ONE held lot is unpriced — a partial sum would be a smaller number
    pretending to be the position — while the purchase-day facts always sum. gain_pct is
    gain / cost, a MONEY ratio; the per-lot gain_pct is the sheet's PRICE ratio, and the two
    agree only while every lot was bought at one price (the schema docstring says so too).
    Sold: a row with a sold_date but no price counts in `lots` and `shares` and in no money
    field, so proceeds and gain stay over one and the same priced subset. No re-rounding:
    every operand is already at cents; `+ ZERO` only collapses a signed zero.
    """
    held: dict = {"lots": 0, "shares": SHARES_ZERO, "market_value": MONEY_ZERO, "gain_amount": MONEY_ZERO, "appreciation": MONEY_ZERO}
    held.update({key: MONEY_ZERO for key in HELD_SUMMED})
    sold: dict = {"lots": 0, "shares": SHARES_ZERO, "cost_basis": MONEY_ZERO, "proceeds": MONEY_ZERO, "gain_amount": MONEY_ZERO}
    unpriced_held = False
    for lot, metrics in rows:
        if metrics["is_sold"]:
            sold["lots"] += 1
            sold["shares"] += lot.shares
            if metrics["market_value"] is not None:
                sold["cost_basis"] += metrics["cost_basis"]
                sold["proceeds"] += metrics["market_value"]
                sold["gain_amount"] += metrics["gain_amount"]
            continue
        held["lots"] += 1
        held["shares"] += lot.shares
        for key in HELD_SUMMED:
            held[key] += metrics[key]
        if metrics["market_value"] is None:
            unpriced_held = True
        else:
            held["market_value"] += metrics["market_value"]
            held["gain_amount"] += metrics["gain_amount"]
            held["appreciation"] += metrics["appreciation"]
    if unpriced_held:
        held["market_value"] = held["gain_amount"] = held["appreciation"] = held["gain_pct"] = None
    else:
        held["gain_pct"] = None if held["cost_basis"] == 0 else _pct6(held["gain_amount"] / held["cost_basis"])
    held["avg_paid"] = None if held["shares"] == 0 else price5(held["cost_basis"] / held["shares"])
    for block in (held, sold):
        for key, value in block.items():
            if isinstance(value, Decimal):
                block[key] = value + ZERO
    return {"held": held, "sold": sold}
```

- [ ] **4 Pass:** `pytest tests/test_espp_calc.py -q` → green.
- [ ] **5 Commit:** `git add tests/test_espp_calc.py app/services/espp_calc.py && git commit -m "feat(espp): position_totals — held and sold lots summed apart, quote fields null when any held lot is unpriced"`

---

### Task 4: The wire — `LotOut` components, `LotsOut.totals`, and the router's composition

**Files:** Modify `app/schemas/espp.py` (`LotOut`, before `LotsOut`) · Modify `app/api/espp.py` (`_lot_out`, `list_lots`, `create_lot`, `update_lot`) · Test `tests/test_espp_api.py`

- [ ] **1 Write the failing tests** — append after `test_lots_envelope_degrades_at_every_break_in_the_soft_link`:

```python
async def test_lots_envelope_carries_the_anatomy_and_the_position_totals(auth_client, priced_ticker):
    await create_lot(auth_client)  # 2024-02-29, 260 sh at 41.23265
    await create_lot(
        auth_client,
        purchase_date="2025-08-29",
        qualifying_date="2026-08-29",
        shares="100",
        subscription_price="150",
        purchase_fmv="200",
    )
    body = (await auth_client.get(LOTS)).json()
    first, second = body["lots"]
    assert (first["fmv_value"], first["bargain_element"]) == ("20569.12", "9848.63")
    assert (first["lookback_component"], first["discount_component"]) == ("7956.78", "1891.85")
    assert first["appreciation"] == "24717.68"
    assert first["avg_paid_to_date"] == "41.23265"
    assert second["purchase_price"] == "127.50000"  # 0.85 x 150, the lower price
    assert second["appreciation"] == "-2582.00"  # 17418.00 - 20000.00: under its FMV
    assert second["avg_paid_to_date"] == "65.19581"  # (10720.49 + 12750.00) / 360
    assert body["totals"]["held"] == {
        "lots": 2,
        "shares": "360.0000",
        "cost_basis": "23470.49",
        "fmv_value": "40569.12",
        "market_value": "62704.80",
        "gain_amount": "39234.31",
        "gain_pct": "1.671644",  # 39234.31 / 23470.49 — the money ratio
        "bargain_element": "17098.63",
        "lookback_component": "12956.78",
        "discount_component": "4141.85",
        "appreciation": "22135.68",
        "avg_paid": "65.19581",
    }
    assert body["totals"]["sold"] == {
        "lots": 0,
        "shares": "0.0000",
        "cost_basis": "0.00",
        "proceeds": "0.00",
        "gain_amount": "0.00",
    }


async def test_lots_totals_null_the_quote_fields_when_unpriced_and_sum_sold_lots_apart(
    auth_client,
):
    await create_lot(auth_client)
    await create_lot(
        auth_client,
        purchase_date="2024-08-30",
        qualifying_date="2025-09-01",
        shares="255",
        sold_date="2026-03-01",
        sold_price="120",
    )
    body = (await auth_client.get(LOTS)).json()  # no espp_ticker at all
    held = body["totals"]["held"]
    assert (held["lots"], held["shares"], held["cost_basis"]) == (1, "260.0000", "10720.49")
    assert held["bargain_element"] == "9848.63"  # purchase-day facts survive a missing quote
    assert (held["market_value"], held["gain_amount"], held["gain_pct"], held["appreciation"]) == (
        None,
        None,
        None,
        None,
    )
    assert held["avg_paid"] == "41.23265"
    assert body["totals"]["sold"] == {
        "lots": 1,
        "shares": "255.0000",
        "cost_basis": "10514.33",
        "proceeds": "30600.00",
        "gain_amount": "20085.67",
    }


async def test_write_verbs_answer_with_the_running_average(auth_client):
    await create_lot(auth_client)
    created = await create_lot(
        auth_client,
        purchase_date="2025-08-29",
        qualifying_date="2026-08-29",
        shares="100",
        subscription_price="150",
        purchase_fmv="200",
    )
    assert created["avg_paid_to_date"] == "65.19581"
    assert created["fmv_value"] == "20000.00"
    patched = await auth_client.patch(f"{LOTS}/{created['id']}", json={"shares": "50"})
    assert patched.status_code == 200, patched.text
    # (10720.49 + 6375.00) / 310 at 5 dp — the PATCH re-reads the chain it just changed.
    assert patched.json()["avg_paid_to_date"] == "55.14674"
```

- [ ] **2 Fail:** `pytest tests/test_espp_api.py -q -k "anatomy or unpriced_and_sum or running_average"` → `KeyError: 'fmv_value'` / `KeyError: 'totals'`.
- [ ] **3 Schemas** — in `app/schemas/espp.py`, add to `LotOut` after `is_sold: bool`:

```python
    # --- the anatomy (2026-09-07 spec §3.1): the lot's value on purchase day and its split.
    # Only `appreciation` needs a price, so only it can be null.
    fmv_value: Decimal
    bargain_element: Decimal
    lookback_component: Decimal
    discount_component: Decimal
    appreciation: Decimal | None
    # Average price paid per share over every lot bought up to and including this one, 5 dp —
    # the price chart's stepped rule (espp_calc.running_avg_paid). Null only for a stored
    # zero-share chain, which the API forbids.
    avg_paid_to_date: Decimal | None
```

and, before `class LotsOut`, the three totals shapes:

```python
class HeldTotalsOut(BaseModel):
    """The unsold lots summed. The four quote-dependent fields are null as soon as one held
    lot is unpriced; the purchase-day facts always sum. gain_pct is gain / cost — a MONEY
    ratio, unlike LotOut.gain_pct, which is the sheet's price ratio."""

    lots: int
    shares: Decimal
    cost_basis: Decimal
    fmv_value: Decimal
    market_value: Decimal | None
    gain_amount: Decimal | None
    gain_pct: Decimal | None
    bargain_element: Decimal
    lookback_component: Decimal
    discount_component: Decimal
    appreciation: Decimal | None
    avg_paid: Decimal | None


class SoldTotalsOut(BaseModel):
    """Lots carrying a sale. A sold row missing its price counts in lots and shares only."""

    lots: int
    shares: Decimal
    cost_basis: Decimal
    proceeds: Decimal
    gain_amount: Decimal


class LotTotalsOut(BaseModel):
    held: HeldTotalsOut
    sold: SoldTotalsOut
```

and on `LotsOut`, after `lots: list[LotOut]`: `totals: LotTotalsOut`.

- [ ] **4 Router** — in `app/api/espp.py`: extend the `app.schemas.espp` import with `HeldTotalsOut, LotTotalsOut, SoldTotalsOut` and the `app.services.espp_calc` import with `position_totals, running_avg_paid`. Replace `_lot_out`:

```python
def _lot_out(lot: EsppLot, metrics: dict, avg_paid_to_date: Decimal | None) -> LotOut:
    return LotOut(
        id=lot.id,
        purchase_date=lot.purchase_date,
        qualifying_date=lot.qualifying_date,
        shares=lot.shares,
        subscription_price=lot.subscription_price,
        purchase_fmv=lot.purchase_fmv,
        purchase_price=lot.purchase_price,
        sold_date=lot.sold_date,
        sold_price=lot.sold_price,
        notes=lot.notes,
        avg_paid_to_date=avg_paid_to_date,
        **metrics,
    )


async def _ordered_lots(db: AsyncSession) -> list[EsppLot]:
    """The chain in its one order, (purchase_date, id) — the list, the running average and
    the totals all read this same sequence."""
    return list(
        (await db.execute(select(EsppLot).order_by(EsppLot.purchase_date, EsppLot.id))).scalars()
    )


async def _running_average_for(db: AsyncSession, lot_id: int) -> Decimal | None:
    """The just-written lot's avg_paid_to_date, from the WHOLE chain — the write responses
    carry the same field the list does, so a client painting from one never meets a shape
    the other lacks (and a moved purchase_date re-slots the lot before this reads)."""
    rows = await _ordered_lots(db)
    for lot, average in zip(rows, running_avg_paid(rows), strict=True):
        if lot.id == lot_id:
            return average
    return None
```

Rewrite `list_lots`:

```python
@router.get("/lots", response_model=LotsOut)
async def list_lots(db: AsyncSession = Depends(get_db)) -> LotsOut:
    ticker, current_price, quoted_at = await _espp_quote(db)
    # One of the module's two `date.today()` reads (the modeler's year default is the
    # other); container-local by design (spec §9).
    today = date.today()
    rows = await _ordered_lots(db)
    metrics = [lot_metrics(lot, current_price, today) for lot in rows]
    totals = position_totals(list(zip(rows, metrics, strict=True)))
    return LotsOut(
        espp_ticker=ticker,
        current_price=current_price,
        quoted_at=quoted_at,
        lots=[
            _lot_out(lot, m, average)
            for lot, m, average in zip(rows, metrics, running_avg_paid(rows), strict=True)
        ],
        totals=LotTotalsOut(
            held=HeldTotalsOut(**totals["held"]), sold=SoldTotalsOut(**totals["sold"])
        ),
    )
```

and in `create_lot` and `update_lot`, replace each `return _lot_out(lot, current_price, date.today())` with:

```python
    return _lot_out(
        lot, lot_metrics(lot, current_price, date.today()), await _running_average_for(db, lot.id)
    )
```

- [ ] **5 Pass:** `pytest tests/test_espp_api.py -q` → green (the envelope test's `first[...]` assertions still hold — the new keys are additions).
- [ ] **6 Commit:** `git add app/schemas/espp.py app/api/espp.py tests/test_espp_api.py && git commit -m "feat(espp): the lots envelope carries each lot's anatomy, its running average paid and a held/sold totals block"`

---

### Task 5: Three more modeler totals

**Files:** Modify `app/services/espp_calc.py` (`ModelerTotals`, `run_modeler`) · Modify `app/schemas/espp.py` (`ModelerTotalsOut`) · Modify `app/api/espp.py` (the `ModelerTotalsOut(...)` call) · Test `tests/test_espp_calc.py`, `tests/test_espp_api.py`

- [ ] **1 Write the failing tests** — in `tests/test_espp_calc.py`, inside the reference-chain golden (the test asserting `result.totals.total_25k_value == D("24935.34")`), after `assert result.totals.remaining_25k == D("64.66")`:

```python
    # 2026-09-07 spec §3.3: the meter's labels never sum on the client.
    assert result.totals.total_shares == 146  # 78 + 68
    assert result.totals.total_contribution == D("21731.15")  # 11340.00 + 10391.15
    assert result.totals.total_refund == D("534.87")  # only the capped August period refunds
```

In `tests/test_espp_api.py`, the `assert body["totals"] == {...}` golden (the one with `"total_25k_value": "24935.34"`) gains three keys inside its dict literal:

```python
        "total_shares": "146",
        "total_contribution": "21731.15",
        "total_refund": "534.87",
```

- [ ] **2 Fail:** `pytest tests/test_espp_calc.py tests/test_espp_api.py -q -k "reference or golden or 24935 or modeler"` → `AttributeError: 'ModelerTotals' object has no attribute 'total_shares'` and the API dict mismatch.
- [ ] **3 Implement** — `ModelerTotals` gains three fields:

```python
@dataclass(frozen=True)
class ModelerTotals:
    total_25k_value: Decimal
    out_of_pocket_cost: Decimal
    fmv_of_shares: Decimal
    remaining_25k: Decimal
    # 2026-09-07 spec §3.3 — the chain meter's labels and tiles, exposed so no client sums.
    total_shares: int
    total_contribution: Decimal
    total_refund: Decimal
```

`run_modeler`'s `ModelerTotals(...)` call gains:

```python
            total_shares=total_shares,
            total_contribution=half_up2(sum((row.contribution for row in results), ZERO)),
            total_refund=half_up2(sum((row.refund for row in results), ZERO)),
```

`ModelerTotalsOut` gains (share counts are Decimals on this wire, like the periods'):

```python
    total_shares: Decimal
    total_contribution: Decimal
    total_refund: Decimal
```

and the router's `ModelerTotalsOut(...)` call gains:

```python
            total_shares=Decimal(result.totals.total_shares),
            total_contribution=result.totals.total_contribution,
            total_refund=result.totals.total_refund,
```

- [ ] **4 Pass:** `pytest tests/test_espp_calc.py tests/test_espp_api.py -q` → green.
- [ ] **5 Commit:** `git add app/services/espp_calc.py app/schemas/espp.py app/api/espp.py tests/test_espp_calc.py tests/test_espp_api.py && git commit -m "feat(espp): the modeler totals carry shares bought, contributions and refunds"`

---

### Task 6: The employer backfill floor — earliest of grant, lot, offering

**Files:** Modify `app/services/price_service.py` (`backfill_employer_history`, its imports) · Test `tests/test_price_service.py`

- [ ] **1 Write the failing tests** — extend the test module's `from app.models import (...)` with `EsppLot, EsppOffering`, then append after `test_employer_backfill_respects_manual_priced_employers`:

```python
def espp_lot(purchase):
    return EsppLot(
        purchase_date=purchase,
        qualifying_date=date(purchase.year + 1, 9, 1),
        shares=D("260.0000"),
        subscription_price=D("48.50900"),
        purchase_fmv=D("79.11200"),
        purchase_price=D("41.23265"),
    )


async def test_employer_backfill_reaches_the_earliest_espp_lot_when_it_predates_the_grants(db):
    await seed_employer(db)
    db.add(rsu_grant(date(2024, 9, 18)))
    db.add(espp_lot(date(2024, 2, 29)))
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(date(2024, 2, 15), "70"), bar(date(2024, 9, 4), "115")]})

    assert await backfill_employer_history(db, provider) == 2
    # The window opens a buffer before the FIRST PURCHASE, not the first vest: the ESPP price
    # chart draws every lot on the line (2026-09-07 spec §3.4).
    assert provider.calls == [("NVDA", date(2024, 2, 29) - timedelta(days=14))]


async def test_employer_backfill_reaches_the_earliest_offering_with_no_grant_at_all(db):
    await seed_employer(db)
    db.add(EsppOffering(offering_start=date(2023, 9, 1), subscription_price=D("48.50900")))
    db.add(espp_lot(date(2024, 2, 29)))
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(date(2023, 8, 21), "48.5")]})

    # No grant anywhere: the ESPP rows alone are reason enough to fetch, and the offering's
    # start is the oldest anchor of the three.
    assert await backfill_employer_history(db, provider) == 1
    assert provider.calls == [("NVDA", date(2023, 9, 1) - timedelta(days=14))]
```

- [ ] **2 Fail:** `pytest tests/test_price_service.py -q -k "earliest_espp_lot or earliest_offering"` → the first returns 0 with `provider.calls == [("NVDA", date(2024, 9, 4))]` (the vest floor), the second returns 0 with no calls.
- [ ] **3 Implement** — in `app/services/price_service.py`, extend the models import to `from app.models import AppSetting, EsppLot, EsppOffering, LatestPrice, PriceHistory, RsuGrant, Security`, and inside `backfill_employer_history` replace the block from `earliest_vest = (` through `needed = earliest_vest - timedelta(...)` with:

```python
    # Three anchors, the earliest wins (2026-09-07 spec §3.4): the vesting calendar prices past
    # tranches at their own closes, and the ESPP price chart draws every purchase on the line
    # and the subscription rule from each offering's start — so the deep window must reach the
    # oldest of the three. An absent source simply drops out; with none there is nothing to
    # reach for. `min` over dates, never over Optionals.
    anchors = [
        d
        for d in (
            (await db.execute(select(func.min(RsuGrant.first_vest_date)))).scalar_one_or_none(),
            (await db.execute(select(func.min(EsppLot.purchase_date)))).scalar_one_or_none(),
            (await db.execute(select(func.min(EsppOffering.offering_start)))).scalar_one_or_none(),
        )
        if d is not None
    ]
    if not anchors:
        return 0
    earliest = min(anchors)
    needed = earliest - timedelta(days=EMPLOYER_BACKFILL_BUFFER_DAYS)
```

Then rename the two later uses: the `logger.info("employer backfill: %d %s bars fetched for the window from %s (earliest vest %s)", ...)` line reads `(earliest anchor %s)` and passes `earliest`. Update the docstring's first paragraph to end: *"…back past the earliest of the earliest RSU vest, the earliest ESPP purchase and the earliest ESPP offering start (2026-09-07 spec §3.4: the ESPP price chart draws every lot and every offering's subscription rule on this history)."* and its skip list: *"Skips quietly when there is no employer ticker, no matching security, none of the three anchors, or the security is manual-priced…"*.

- [ ] **4 Pass:** `pytest tests/test_price_service.py -q` → green, including `test_employer_backfill_fetches_bars_back_to_the_earliest_grant` (grants-only books still key on the vest) and `..._skips_quietly_when_there_is_nothing_to_do` (no anchors at all → 0, no calls).
- [ ] **5 Commit:** `git add app/services/price_service.py tests/test_price_service.py && git commit -m "feat(prices): the employer backfill reaches the earliest ESPP lot or offering, not only the earliest vest"`

---

### Task 7: Lane gate

- [ ] **1** `pytest -q` (the whole backend suite) → green; record the count.
- [ ] **2** `.venv/Scripts/python.exe -m ruff format app tests && .venv/Scripts/python.exe -m ruff check app tests` → clean. Commit any reflow: `git commit -am "style(espp): ruff"` only if something changed.
- [ ] **3** `cd .. && .venv/Scripts/python.exe -m alembic check` is NOT required — this lane adds no column. Confirm with `git diff main --stat -- backend/alembic` → empty.
- [ ] **4** Report: the branch name, the commit list (`git log --oneline main..HEAD`), the pytest count, and any deviation from this plan with its reason.
