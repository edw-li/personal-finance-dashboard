"""GET /taxes/years/{year}/withholding — the "Will I owe?" tracker (2026-08-21 spec §4).

The endpoint is a pure READ over stored profiles / grants / brackets, so half of these pins
are about degradation rather than arithmetic: a hand-written profile the paycheck writers
would refuse, a grant `_validated_grant` would refuse, a vest older than every stored bar and
a missing quote all have to come back 200 with a warning.

The arithmetic pins are deliberately the SAME shape `test_withholding_calc` hand-derives —
2026, a $240k semi-monthly profile at 30% withholding, the small FICA tables — so a number
that moves here and not there (or vice versa) points at the router, not the service. "Today"
is frozen by monkeypatching `app.api.taxes.product_today`, the one clock this route reads.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import (
    AppSetting,
    LatestPrice,
    PaycheckProfile,
    PriceHistory,
    RsuGrant,
    Security,
    TaxBracket,
    TaxInput,
    TaxYear,
)
from app.seed import seed_tax_definitions

YEARS = "/api/v1/taxes/years"

# Mid-2026, so the year has both settled checks and vests still ahead of it — the only state
# in which this card says anything. Frozen in the PAST for test_rsu_api's reason: a pinned day
# still ahead of the seeded vests would keep passing if the monkeypatch silently stopped
# applying, while a past one fails loudly on the next run.
PINNED_TODAY = date(2026, 7, 1)
YEAR = PINNED_TODAY.year

NON_CURRENT_YEAR = "withholding tracking is only meaningful for the current year"
NO_TICKER_WARNING = "no ESPP/employer ticker configured — vests are excluded from the estimate"
NO_QUOTE_WARNING = "no current employer price — future vests are excluded from the projection"

# Small enough to hand-derive, real enough to exercise every walk: a flat federal/state pair,
# the three FICA families, and the SS wage base as its terminal 0-rate bracket.
BRACKETS: dict[str, list[tuple[str, str]]] = {
    "federal": [("0.1000", "0.00")],
    "state": [("0.0500", "0.00")],
    "medicare": [("0.0145", "0.00")],
    "social_security": [("0.0620", "0.00"), ("0.0000", "168600.00")],
    "disability": [("0.0110", "0.00")],
    "capital_gains": [("0.1500", "0.00")],
}

# NVDA closes straddling the seeded vests: 03-16 is the newest bar on or before the 03-18
# cliff (03-20 is dated AFTER it and must lose), and 06-17 lands exactly on a vest.
BARS: list[tuple[date, str]] = [
    (date(2026, 3, 16), "350.0000"),
    (date(2026, 3, 20), "380.0000"),
    (date(2026, 6, 17), "600.0000"),
]
QUOTE = "500.0000"


def url(year: int = YEAR) -> str:
    return f"{YEARS}/{year}/withholding"


@pytest.fixture
def frozen_today(monkeypatch):
    """`product_today` as the ROUTE sees it (test_rsu_api's patch-target convention)."""
    monkeypatch.setattr("app.api.taxes.product_today", lambda: PINNED_TODAY)


@pytest.fixture
async def definitions(db):
    """tax_inputs.key FKs to tax_input_definitions, so the seed precedes every input row."""
    await seed_tax_definitions(db)
    await db.commit()


async def seed_tax_year(db, year: int, w2_income: str, jurisdictions: dict | None = None) -> None:
    """A year the engine can price: one W2 input plus bracket tables at column scale."""
    db.add(TaxYear(year=year))
    await db.flush()  # the inputs/brackets FK to it
    db.add(TaxInput(year=year, key="latest_w2_income", value=Decimal(w2_income)))
    for name, table in (BRACKETS if jurisdictions is None else jurisdictions).items():
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                )
            )
    await db.commit()


async def seed_profile(db, **overrides) -> PaycheckProfile:
    """The check test_withholding_calc hand-derives: gross 10000, taxable 9350, hold 2805."""
    fields = {
        "effective_date": date(2025, 1, 1),
        "annual_salary": Decimal("240000.00"),
        "pay_periods_per_year": 24,
        "trad_401k_pct": Decimal("0.050000000"),
        "roth_401k_pct": Decimal("0"),
        "after_tax_401k_pct": Decimal("0"),
        "espp_pct": Decimal("0"),
        "withholding_pct": Decimal("0.300000000"),
        "dental_vision_per_check": Decimal("50.00"),
        "hsa_per_check": Decimal("100.00"),
    }
    fields.update(overrides)
    profile = PaycheckProfile(**fields)
    db.add(profile)
    await db.commit()
    return profile


async def seed_employer(db, quote: str | None = QUOTE, bars: list | None = None) -> Security:
    """app_settings['espp_ticker'] -> securities -> latest_prices/price_history, the same SOFT
    link the vest calendar walks. Any hop can be left out to exercise a degradation."""
    db.add(AppSetting(key="espp_ticker", value={"value": "NVDA"}))
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add(security)
    await db.flush()
    if quote is not None:
        db.add(
            LatestPrice(
                security_id=security.id,
                price=Decimal(quote),
                quoted_at=datetime(2026, 7, 1, 20, 15, tzinfo=UTC),
                source="yfinance",
            )
        )
    db.add_all(
        [
            PriceHistory(security_id=security.id, price_date=day, close=Decimal(close))
            for day, close in (BARS if bars is None else bars)
        ]
    )
    await db.commit()
    return security


async def seed_grant(
    db,
    label: str,
    shares: int,
    first_vest_date: date,
    cliff: str = "0.2500",
    kind: str = "new_hire",
) -> RsuGrant:
    grant = RsuGrant(
        kind=kind,
        label=label,
        shares=shares,
        grant_price=Decimal("45.1200"),
        first_vest_date=first_vest_date,
        cliff_pct=Decimal(cliff),
    )
    db.add(grant)
    await db.commit()
    return grant


async def seed_grants(db) -> None:
    """Two grants on the 3rd-Wednesday grid:

    "Offer letter" — 400 sh, 25% cliff from 2026-03-18: 100 / 25 / 25 / 25 in 2026 (two of
    them behind the frozen day), the remaining nine tranches in 2027-2029.
    "FY26 refresh" — 160 sh, 6.25% from 2026-09-16: 10 / 10 in 2026, all of it ahead.
    """
    await seed_grant(db, "Offer letter", 400, date(2026, 3, 18))
    await seed_grant(db, "FY26 refresh", 160, date(2026, 9, 16), cliff="0.0625", kind="refresh")


@pytest.fixture
async def world(db, definitions):
    await seed_tax_year(db, YEAR, "600000.0000")
    await seed_profile(db)
    await seed_employer(db)
    await seed_grants(db)


async def get_withholding(auth_client, year: int = YEAR) -> dict:
    resp = await auth_client.get(url(year))
    assert resp.status_code == 200, resp.text  # fail here, not on a later KeyError
    return resp.json()


# --- the two refusals ---


async def test_withholding_rejects_a_non_current_year(auth_client, db, definitions, frozen_today):
    # Both years exist and both are perfectly summarizable — the refusal is about the CARD,
    # not the data: a settled year has no "will I owe?" left to answer.
    await seed_tax_year(db, YEAR - 1, "600000.0000")
    await seed_tax_year(db, YEAR + 1, "600000.0000")

    past = await auth_client.get(url(YEAR - 1))
    assert past.status_code == 422
    assert past.json()["detail"] == NON_CURRENT_YEAR
    assert (await auth_client.get(url(YEAR + 1))).status_code == 422
    # ...and the year check runs BEFORE the 404, so a stale year that was never stored still
    # reports the reason the card cannot be drawn.
    assert (await auth_client.get(url(1999))).status_code == 422


async def test_withholding_404_when_the_current_year_has_no_row(
    auth_client, definitions, frozen_today
):
    resp = await auth_client.get(url())
    assert resp.status_code == 404
    assert resp.json()["detail"] == f"tax year {YEAR} not found"


async def test_withholding_year_path_keeps_the_century_fence(auth_client, frozen_today):
    # tax_years.year is an int4: an out-of-range year must 422 at the boundary, never reach
    # asyncpg as a bare DataError (YearPath, shared with every other route in this router).
    assert (await auth_client.get(url(99999999999))).status_code == 422


async def test_withholding_requires_auth(client):
    assert (await client.get(url())).status_code == 401


# --- the happy path ---


async def test_withholding_liability_is_the_summary_total_verbatim(
    auth_client, world, frozen_today
):
    body = await get_withholding(auth_client)
    summary = await auth_client.get(f"{YEARS}/{YEAR}/summary")
    assert summary.status_code == 200, summary.text

    # Same engine, same stored inputs, same bracket loader, same quantize — the card's
    # liability line must be the string the summary panel above it already shows.
    assert body["liability_total"] == summary.json()["totals"]["total_tax"]
    # 60000 fed + 30000 state + 8700 medicare + 10453.20 ss (capped at 168600) + 6600 sdi.
    assert body["liability_total"] == "115753.20"
    assert body["year"] == YEAR
    assert body["warnings"] == []


async def test_withholding_salary_leg_and_check_grid_echo_the_service(
    auth_client, world, frozen_today
):
    body = await get_withholding(auth_client)
    # Checks land on ceil(365 x i / 24); i=11 is day 168 (Jun 17), i=12 is day 183 (Jul 2).
    assert (body["checks_elapsed"], body["checks_total"]) == (11, 24)
    assert body["salary"] == {"ytd": "30855.00", "projected": "67320.00"}  # 11 and 24 x 2805


async def test_withholding_prices_past_vests_from_bars_and_the_future_from_the_quote(
    auth_client, world, frozen_today
):
    body = await get_withholding(auth_client)
    # Past: 100 sh on 03-18 at the 03-16 close of 350 (the 03-20 bar is dated after the vest
    # and is information it did not have) + 25 sh on 06-17 at that day's exact 600 bar.
    assert body["vest"]["income_ytd"] == "50000.00"  # 35000 + 15000
    # Future, at the latest quote only: 25 + 25 (Offer letter, Sep/Dec) + 10 + 10 (FY26
    # refresh) = 70 sh x 500. The nine 2027+ tranches are NOT in this year's projection.
    assert body["vest"]["income_projected"] == "85000.00"  # 50000 + 35000
    assert body["vest"]["supplemental_ytd"] == "16115.00"  # 50000 x (0.22 + 0.1023)
    assert body["vest"]["supplemental_projected"] == "27395.50"  # 85000 x 0.3223
    # Marginal FICA on top of 110000 of salary gross: 725 medicare + 3100 ss + 550 sdi.
    assert body["vest"]["fica_ytd"] == "4375.00"
    # Projected: full-year gross 240000 has already eaten the SS cap, so the vest leg's SS
    # marginal is 0 — 1232.50 medicare + 935 sdi only.
    assert body["vest"]["fica_projected"] == "2167.50"


async def test_withholding_totals_sum_their_legs_and_balance_against_the_liability(
    auth_client, world, frozen_today
):
    body = await get_withholding(auth_client)
    vest = body["vest"]
    # The card renders these three side by side; the total line has to be their exact sum,
    # judged on the STRINGS the frontend receives (it renders them verbatim).
    assert Decimal(body["total"]["ytd"]) == (
        Decimal(body["salary"]["ytd"])
        + Decimal(vest["supplemental_ytd"])
        + Decimal(vest["fica_ytd"])
    )
    assert Decimal(body["total"]["projected"]) == (
        Decimal(body["salary"]["projected"])
        + Decimal(vest["supplemental_projected"])
        + Decimal(vest["fica_projected"])
    )
    assert body["total"] == {"ytd": "51345.00", "projected": "96883.00"}
    # Positive = will owe. 115753.20 - 96883.00.
    assert Decimal(body["balance_projected"]) == Decimal(body["liability_total"]) - Decimal(
        body["total"]["projected"]
    )
    assert body["balance_projected"] == "18870.20"


# --- degradations ---


async def test_withholding_excludes_a_past_vest_with_no_bar_behind_it(
    auth_client, db, world, frozen_today
):
    # A single-tranche grant (cliff 1.0) vesting on 2026-01-21, older than every stored bar:
    # there is no price to value it with, so it leaves the income rather than counting as 0.
    await seed_grant(db, "Retention", 10, date(2026, 1, 21), cliff="1.0000")
    body = await get_withholding(auth_client)

    assert body["warnings"] == [
        "vest on 2026-01-21 has no stored price — excluded from the estimate"
    ]
    assert body["vest"]["income_ytd"] == "50000.00"  # unchanged: the 10 shares are not in it
    assert body["vest"]["income_projected"] == "85000.00"


async def test_withholding_skips_an_unschedulable_stored_grant(
    auth_client, db, world, frozen_today
):
    # Hand-written STRAIGHT to the table with a 30% cliff, which `_validated_grant` refuses
    # (it leaves 11.2 quarterly steps). The card must still answer for everything else.
    await seed_grant(db, "hand-edited cliff", 100, date(2026, 3, 18), cliff="0.3000")
    body = await get_withholding(auth_client)

    assert body["warnings"] == [
        "hand-edited cliff: stored grant cannot be scheduled — "
        "(1 - cliff_pct) must be a whole number of 6.25% steps"
    ]
    assert body["vest"]["income_ytd"] == "50000.00"  # the healthy grants are untouched
    assert body["liability_total"] == "115753.20"


async def test_withholding_excludes_future_vests_when_there_is_no_quote(
    auth_client, db, definitions, frozen_today
):
    # A ticker with history but no LatestPrice row: past vests still price off the bars, the
    # projection cannot value the future ones, and that is ONE warning, not one per vest.
    await seed_tax_year(db, YEAR, "600000.0000")
    await seed_profile(db)
    await seed_employer(db, quote=None)
    await seed_grants(db)
    body = await get_withholding(auth_client)

    assert body["warnings"] == [NO_QUOTE_WARNING]
    assert body["vest"]["income_ytd"] == "50000.00"
    assert body["vest"]["income_projected"] == "50000.00"  # nothing added for the future


async def test_withholding_without_an_employer_ticker_drops_the_whole_vest_leg(
    auth_client, db, definitions, frozen_today
):
    # No `espp_ticker` setting at all: the soft link breaks at its FIRST hop, so nothing can be
    # priced and every vest leaves the estimate. That is ONE root cause, not two per-date lines
    # plus a no-quote line restating it (the vest calendar makes the same call) — and the
    # salary side still answers in full.
    await seed_tax_year(db, YEAR, "600000.0000")
    await seed_profile(db)
    await seed_grants(db)
    body = await get_withholding(auth_client)

    assert body["warnings"] == [NO_TICKER_WARNING]
    assert body["vest"] == {
        "income_ytd": "0.00",
        "income_projected": "0.00",
        "supplemental_ytd": "0.00",
        "supplemental_projected": "0.00",
        "fica_ytd": "0.00",
        "fica_projected": "0.00",
    }
    assert body["total"] == body["salary"] == {"ytd": "30855.00", "projected": "67320.00"}


async def test_withholding_without_paycheck_profiles_zeroes_the_salary_leg(
    auth_client, db, definitions, frozen_today
):
    await seed_tax_year(db, YEAR, "600000.0000")
    await seed_employer(db)
    await seed_grants(db)
    body = await get_withholding(auth_client)

    assert body["salary"] == {"ytd": "0.00", "projected": "0.00"}
    assert (body["checks_elapsed"], body["checks_total"]) == (0, 0)
    assert any("paycheck profile" in warning for warning in body["warnings"])
    # The vest legs are still real money and still estimated — against a gross of 0, so the
    # whole vest income sits in the first FICA bracket: 50000 x (0.0145 + 0.062 + 0.011).
    assert body["vest"]["fica_ytd"] == "4375.00"
    assert body["total"]["ytd"] == "20490.00"  # 0 + 16115.00 + 4375.00


@pytest.mark.parametrize("periods", [0, 100_000])
async def test_withholding_fences_a_hand_written_pay_period_count(
    auth_client, db, world, frozen_today, periods
):
    """The stored-data fence, mirroring `paycheck.py`'s: `gross = annual_salary / periods`.

    Written through the ORM rather than the API — every writer bounds this column, so only a
    hand edit (or a future importer) can produce either of these. A GET must degrade to a
    named warning, never the DivisionByZero 500 the same row causes one line into the
    waterfall. BOTH bounds bind here, where paycheck.py's own read only fences the floor:
    `check_dates` builds one date (and one `breakdown` call) PER CHECK, so a six-figure period
    count is not a slow answer, it is no answer at all.
    """
    profile = (await db.execute(select(PaycheckProfile))).scalars().one()
    profile.pay_periods_per_year = periods
    await db.commit()

    body = await get_withholding(auth_client)
    assert body["salary"] == {"ytd": "0.00", "projected": "0.00"}
    assert (body["checks_elapsed"], body["checks_total"]) == (0, 0)
    fenced = [w for w in body["warnings"] if "2025-01-01" in w]
    assert fenced == [
        "paycheck profile effective 2025-01-01 excluded: "
        "pay_periods_per_year must be between 1 and 366"
    ]
    # The rest of the card still computes, including the engine's liability.
    assert body["liability_total"] == "115753.20"
    assert body["vest"]["income_ytd"] == "50000.00"


async def test_withholding_names_the_fica_tables_it_had_to_walk_empty(
    auth_client, db, definitions, frozen_today
):
    # No FICA brackets stored at all: the marginal-FICA leg can only be 0, and the card says
    # so in the engine's own words rather than presenting a confident zero.
    income_only = {name: BRACKETS[name] for name in ("federal", "state", "capital_gains")}
    await seed_tax_year(db, YEAR, "600000.0000", jurisdictions=income_only)
    await seed_profile(db)
    await seed_employer(db)
    await seed_grants(db)
    body = await get_withholding(auth_client)

    assert body["warnings"] == [
        "no medicare brackets for 2026: medicare tax computed as 0",
        "no social_security brackets for 2026: social_security tax computed as 0",
        "no disability brackets for 2026: disability tax computed as 0",
    ]
    assert body["vest"]["fica_ytd"] == "0.00"
    assert body["vest"]["fica_projected"] == "0.00"
    assert body["vest"]["supplemental_ytd"] == "16115.00"  # the supplemental leg is unaffected


# --- safe harbor ---


async def test_withholding_safe_harbor_is_null_without_a_prior_year(
    auth_client, world, frozen_today
):
    assert (await get_withholding(auth_client))["safe_harbor"] is None


async def test_withholding_safe_harbor_is_110_pct_of_the_prior_year(
    auth_client, db, world, frozen_today
):
    await seed_tax_year(db, YEAR - 1, "400000.0000")
    body = await get_withholding(auth_client)
    prior = await auth_client.get(f"{YEARS}/{YEAR - 1}/summary")
    assert prior.status_code == 200, prior.text

    prior_tax = prior.json()["totals"]["total_tax"]
    assert prior_tax == "80653.20"  # 40000 + 20000 + 5800 + 10453.20 + 4400
    assert body["safe_harbor"] == {
        "prior_year": YEAR - 1,
        "prior_total_tax": prior_tax,
        "threshold": "88718.52",  # 80653.20 x 1.10, at cents
        "met": True,  # projected withholding 96883.00 clears it
    }
    # 110% of the DISPLAYED prior figure, not of a full-precision one nobody can see: the two
    # numbers render side by side and the multiplication between them has to check out.
    assert Decimal(body["safe_harbor"]["threshold"]) == (
        Decimal(prior_tax) * Decimal("1.10")
    ).quantize(Decimal("0.01"))


async def test_withholding_safe_harbor_is_unavailable_when_the_prior_year_computes_nothing(
    auth_client, db, world, frozen_today
):
    # A bare tax_years row — the shape `_ensure_year` leaves behind, or a year created and
    # never filled in. 110% of nothing is nothing, and ANY withholding clears a zero
    # threshold, so a met=True badge here would be a false all-clear rather than a result.
    db.add(TaxYear(year=YEAR - 1))
    await db.commit()
    body = await get_withholding(auth_client)

    assert body["safe_harbor"] is None
    assert body["warnings"] == [
        f"prior year {YEAR - 1} has no computed tax — safe harbor unavailable"
    ]
    # The rest of the card is unaffected — this is one missing comparison, not a degradation.
    assert body["liability_total"] == "115753.20"
    assert body["total"]["projected"] == "96883.00"


async def test_withholding_safe_harbor_not_met_when_the_prior_year_was_bigger(
    auth_client, db, world, frozen_today
):
    await seed_tax_year(db, YEAR - 1, "600000.0000")
    body = await get_withholding(auth_client)

    assert body["safe_harbor"]["prior_total_tax"] == "115753.20"
    assert body["safe_harbor"]["threshold"] == "127328.52"  # 115753.20 x 1.10
    assert body["safe_harbor"]["met"] is False
    assert Decimal(body["total"]["projected"]) < Decimal(body["safe_harbor"]["threshold"])
