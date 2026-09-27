from datetime import date

import pytest

from app.config import settings
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CalendarFeedToken,
    ContributionLimit,
    LifecycleRun,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    Person,
    PositionTransaction,
    Security,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
    User,
    UserPreference,
)
from app.services import clock
from app.tax_keys import JURISDICTIONS, MARRIED_JOINT
from tests.portfolio_factories import acct

ENDPOINT = "/api/v1/guide/setup"


@pytest.fixture(autouse=True)
def guide_environment(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", None)
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 27))


async def test_auth_required_and_empty_data_is_not_completed(client, auth_client, forbid_writes):
    headers = dict(client.headers)
    client.headers.pop("Authorization")
    assert (await client.get(ENDPOINT)).status_code == 401
    client.headers.update(headers)
    with forbid_writes():
        response = await auth_client.get(ENDPOINT)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["year"] == 2026
    assert len(body["steps"]) == 18
    assert not any(step["complete"] for step in body["steps"].values())


async def test_record_evidence_excludes_inactive_rows_and_dry_runs(auth_client, db, forbid_writes):
    db.add_all(
        [
            Person(name="One"),
            Account(name="Retired", slug="retired", group="cash", is_active=False),
            SpendingCategory(name="Retired", slug="retired", is_active=False),
            LifecycleRun(kind="import_xlsx", ok=True, dry_run=True),
            LifecycleRun(kind="snapshot", ok=False),
        ]
    )
    await db.commit()
    with forbid_writes():
        steps = (await auth_client.get(ENDPOINT)).json()["steps"]
    assert steps["setup-household"]["complete"]
    for task in ("accounts", "categories", "import", "snapshot"):
        assert not steps[f"setup-{task}"]["complete"]
    db.add_all(
        [
            Account(name="Current", slug="current", group="cash"),
            SpendingCategory(name="Current", slug="current"),
            LifecycleRun(kind="import_xlsx", ok=True, dry_run=False),
            LifecycleRun(kind="snapshot", ok=True, dry_run=False),
        ]
    )
    await db.commit()
    steps = (await auth_client.get(ENDPOINT)).json()["steps"]
    for task in ("accounts", "categories", "import", "snapshot"):
        assert steps[f"setup-{task}"]["complete"]


async def test_first_month_needs_all_feeds_in_the_same_month(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash")
    category = SpendingCategory(name="Food", slug="food")
    snapshot = NetWorthSnapshot(month=date(2026, 1, 1))
    db.add_all([account, category, snapshot])
    await db.flush()
    db.add_all(
        [
            AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=0),
            MonthlySpending(month=date(2026, 2, 1), category_id=category.id, amount=0),
            MonthlyCashflow(month=date(2026, 1, 1), net_pay=0),
        ]
    )
    await db.commit()
    assert not (await auth_client.get(ENDPOINT)).json()["steps"]["setup-first-month"]["complete"]
    db.add(MonthlySpending(month=date(2026, 1, 1), category_id=category.id, amount=0))
    await db.commit()
    step = (await auth_client.get(ENDPOINT)).json()["steps"]["setup-first-month"]
    assert step["complete"]  # An explicit zero is still an entered value.
    assert "January 2026" in step["evidence"]


async def test_older_imports_are_recognized_from_ledger_provenance(auth_client, db):
    security = Security(ticker="TEST", name="Test", holding_type="stock")
    db.add(security)
    await db.flush()
    db.add(
        PositionTransaction(
            security_id=security.id,
            portfolio_account=acct("Broker"),
            type="buy",
            shares=1,
            price=10,
            source="import",
            import_key=1,
        )
    )
    await db.commit()
    steps = (await auth_client.get(ENDPOINT)).json()["steps"]
    assert steps["setup-import"]["complete"]
    assert "imported ledger rows" in steps["setup-import"]["evidence"]
    assert steps["setup-portfolio"]["complete"]


async def test_calendar_and_preferences_are_personal_and_secrets_are_never_returned(
    auth_client,
    db,
    seeded_user,
    forbid_writes,
):
    other = User(email="other@example.test", password_hash="not-a-real-hash")
    db.add(other)
    await db.flush()
    db.add_all(
        [
            CalendarFeedToken(user_id=other.id, token_hash="a" * 64, label="Other phone"),
            AppSetting(key="calendar_update_due_day", value={"value": 7}),
            AppSetting(key="nvidia_api_key", value={"value": "secret-must-not-leak"}),
            *(
                UserPreference(user_id=other.id, key=key, value=value)
                for key, value in (
                    ("theme", "light"),
                    ("density", "compact"),
                    ("landing_page", "/"),
                )
            ),
        ]
    )
    await db.commit()
    with forbid_writes():
        response = await auth_client.get(ENDPOINT)
    steps = response.json()["steps"]
    assert steps["setup-assistant"]["complete"]
    assert not steps["setup-calendar"]["complete"]
    assert not steps["setup-appearance"]["complete"]
    assert "secret-must-not-leak" not in response.text
    assert "a" * 64 not in response.text
    db.add_all(
        [
            CalendarFeedToken(user_id=seeded_user.id, token_hash="b" * 64, label="My phone"),
            *(
                UserPreference(user_id=seeded_user.id, key=key, value=value)
                for key, value in (
                    ("theme", "light"),
                    ("density", "compact"),
                    ("landing_page", "/"),
                )
            ),
        ]
    )
    await db.commit()
    steps = (await auth_client.get(ENDPOINT)).json()["steps"]
    assert steps["setup-calendar"]["complete"]
    assert steps["setup-appearance"]["complete"]


async def test_annual_checks_require_current_year_and_matching_complete_tables(auth_client, db):
    db.add_all(
        [
            TaxYear(year=2026, filing_status=MARRIED_JOINT),
            TaxInputDefinition(key="test_input", label="Test", section="income"),
            ContributionLimit(year=2025, key="employee_401k", value=23000),
            AppSetting(key="swr_pct", value={"value": 0.04}),
        ]
    )
    await db.flush()
    db.add(TaxInput(year=2026, key="test_input", value=100))
    db.add_all(
        TaxBracket(
            year=2026,
            filing_status="single",
            jurisdiction=name,
            bracket_index=0,
            rate=0,
            threshold=0,
        )
        for name in JURISDICTIONS
    )
    await db.commit()
    steps = (await auth_client.get(ENDPOINT)).json()["steps"]
    assert not steps["setup-taxes"]["complete"]
    assert not steps["setup-limits"]["complete"]
    db.add(ContributionLimit(year=2026, key="employee_401k", value=24000))
    db.add_all(
        TaxBracket(
            year=2026,
            filing_status=MARRIED_JOINT,
            jurisdiction=name,
            bracket_index=0,
            rate=0,
            threshold=0,
        )
        for name in JURISDICTIONS[:-1]
    )
    await db.commit()
    assert not (await auth_client.get(ENDPOINT)).json()["steps"]["setup-taxes"]["complete"]
    db.add(
        TaxBracket(
            year=2026,
            filing_status=MARRIED_JOINT,
            jurisdiction=JURISDICTIONS[-1],
            bracket_index=0,
            rate=0,
            threshold=0,
        )
    )
    await db.commit()
    steps = (await auth_client.get(ENDPOINT)).json()["steps"]
    assert steps["setup-taxes"]["complete"]
    assert steps["setup-limits"]["complete"]
